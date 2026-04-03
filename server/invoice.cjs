const express = require('express');
const router = express.Router();
const { getSupabase, getGoogleOAuth2, google } = require('./shared.cjs');
const PDFDocument = require('pdfkit');

// --- Config ---
const CRON_SECRET = process.env.INVOICE_CRON_SECRET || '';

const supabase = new Proxy({}, { get: (_, prop) => getSupabase()[prop] });

// --- Column mapping (camelCase <-> snake_case) ---
const SNAKE_MAP = {
  companyName: 'company_name', contactName: 'contact_name', postalCode: 'postal_code',
  invoiceNumber: 'invoice_number', draftId: 'draft_id', fromSchedule: 'from_schedule',
  sentAt: 'sent_at', createdAt: 'created_at', clientId: 'client_id',
  dayOfMonth: 'day_of_month', templateId: 'template_id',
  senderName: 'sender_name', senderCompany: 'sender_company',
  senderPostalCode: 'sender_postal_code', senderAddress: 'sender_address',
  senderPhone: 'sender_phone', senderEmail: 'sender_email',
  bankName: 'bank_name', bankBranch: 'bank_branch', bankAccount: 'bank_account',
  bankAccountName: 'bank_account_name', bankSwift: 'bank_swift',
  updatedAt: 'updated_at',
  accountName: 'account_name', sellerId: 'seller_id', marketplaceId: 'marketplace_id',
  refreshToken: 'refresh_token', spApiClientId: 'sp_api_client_id', spApiClientSecret: 'sp_api_client_secret',
  ruleType: 'rule_type', amazonAccountId: 'amazon_account_id',
  yearMonth: 'year_month', totalSales: 'total_sales', totalAdSpend: 'total_ad_spend',
  fetchedAt: 'fetched_at',
  fixedItems: 'fixed_items', autoFetchAmazon: 'auto_fetch_amazon', sendMode: 'send_mode',
  feeRulesConfig: 'fee_rules_config', defaultItems: 'default_items',
};
const CAMEL_MAP = Object.fromEntries(Object.entries(SNAKE_MAP).map(([k, v]) => [v, k]));

const toSnake = (obj) => {
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    result[SNAKE_MAP[k] || k] = v;
  }
  return result;
};

const toCamel = (obj) => {
  if (!obj) return obj;
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    result[CAMEL_MAP[k] || k] = v;
  }
  return result;
};

const toCamelArray = (arr) => (arr || []).map(toCamel);

// --- OAuth helpers ---
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.send',
];

const getCallbackUrl = (req) => `${req.protocol}://${req.get('host')}/api/invoice/auth/callback`;

const getOAuth2Client = (redirectUri) => getGoogleOAuth2(redirectUri);

const getAuthorizedClient = async () => {
  const oauth2Client = getGoogleOAuth2();
  if (!oauth2Client) throw new Error('Google OAuth未設定');

  const { data, error } = await supabase.from('oauth_tokens').select('*').eq('id', 'gmail').single();
  if (error || !data) throw new Error('未認証です。先にGoogle認証を行ってください。');

  oauth2Client.setCredentials({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    scope: data.scope,
    token_type: data.token_type,
    expiry_date: Number(data.expiry_date),
  });

  oauth2Client.on('tokens', async (tokens) => {
    const updates = { access_token: tokens.access_token, updated_at: new Date().toISOString() };
    if (tokens.refresh_token) updates.refresh_token = tokens.refresh_token;
    if (tokens.expiry_date) updates.expiry_date = tokens.expiry_date;
    await supabase.from('oauth_tokens').update(updates).eq('id', 'gmail');
  });

  return oauth2Client;
};

// === Auth Routes ===
router.get('/auth/status', async (req, res) => {
  const hasCredentials = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const { data } = await supabase.from('oauth_tokens').select('id').eq('id', 'gmail').single();
  res.json({ hasCredentials, hasToken: !!data });
});

router.get('/auth/login', (req, res) => {
  const callbackUrl = getCallbackUrl(req);
  const oauth2Client = getOAuth2Client(callbackUrl);
  if (!oauth2Client) return res.status(400).json({ error: 'Google OAuth未設定' });
  const url = oauth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'consent' });
  res.json({ url });
});

router.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  const callbackUrl = getCallbackUrl(req);
  const oauth2Client = getOAuth2Client(callbackUrl);
  if (!oauth2Client) return res.status(400).send('Google OAuth未設定');
  try {
    const { tokens } = await oauth2Client.getToken(code);
    await supabase.from('oauth_tokens').upsert({
      id: 'gmail',
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      scope: tokens.scope,
      token_type: tokens.token_type,
      expiry_date: tokens.expiry_date,
      updated_at: new Date().toISOString(),
    });
    res.send('<html><body><script>window.close();</script><p>認証成功！このウィンドウを閉じてください。</p></body></html>');
  } catch (err) {
    res.status(500).send('認証エラー: ' + err.message);
  }
});

// === Clients Routes ===
router.get('/clients', async (req, res) => {
  const { data, error } = await supabase.from('clients').select('*').order('created_at');
  if (error) return res.status(500).json({ error: error.message });
  res.json(toCamelArray(data));
});

router.post('/clients', async (req, res) => {
  const row = toSnake(req.body);
  delete row.id;
  const { data, error } = await supabase.from('clients').insert(row).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(toCamel(data));
});

router.put('/clients/:id', async (req, res) => {
  const row = toSnake(req.body);
  delete row.id;
  const { data, error } = await supabase.from('clients').update(row).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(toCamel(data));
});

router.delete('/clients/:id', async (req, res) => {
  const { error } = await supabase.from('clients').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// === Templates Routes ===
router.get('/templates', async (req, res) => {
  const { data, error } = await supabase.from('email_templates').select('*').order('created_at');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ templates: toCamelArray(data) });
});

router.post('/templates', async (req, res) => {
  const row = toSnake(req.body);
  delete row.id;
  const { data, error } = await supabase.from('email_templates').insert(row).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(toCamel(data));
});

router.put('/templates/:id', async (req, res) => {
  const row = toSnake(req.body);
  delete row.id;
  const { data, error } = await supabase.from('email_templates').update(row).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(toCamel(data));
});

router.delete('/templates/:id', async (req, res) => {
  const { error } = await supabase.from('email_templates').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// === Gmail Routes ===
const buildRawEmail = ({ to, subject, body, pdfBase64, pdfFilename }) => {
  const boundary = 'boundary_' + Date.now();
  let parts = [
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(body).toString('base64'),
  ];
  if (pdfBase64 && pdfFilename) {
    const encodedFilename = `=?UTF-8?B?${Buffer.from(pdfFilename).toString('base64')}?=`;
    parts = parts.concat([
      `--${boundary}`,
      'Content-Type: application/pdf',
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${encodedFilename}"`,
      '',
      pdfBase64,
    ]);
  }
  parts.push(`--${boundary}--`);
  return Buffer.from(parts.join('\r\n')).toString('base64url');
};

router.post('/gmail/draft', async (req, res) => {
  try {
    const { to, subject, body, pdfBase64, pdfFilename, invoiceNumber } = req.body;
    const auth = await getAuthorizedClient();
    const gmail = google.gmail({ version: 'v1', auth });

    const raw = buildRawEmail({ to, subject, body, pdfBase64, pdfFilename });
    const draft = await gmail.users.drafts.create({
      userId: 'me',
      requestBody: { message: { raw } },
    });

    await supabase.from('invoice_history').insert({
      type: 'draft',
      to,
      subject,
      invoice_number: invoiceNumber || '',
      draft_id: draft.data.id,
    });

    res.json({ success: true, draftId: draft.data.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/gmail/send', async (req, res) => {
  try {
    const { to, subject, body, pdfBase64, pdfFilename, invoiceNumber } = req.body;
    const auth = await getAuthorizedClient();
    const gmail = google.gmail({ version: 'v1', auth });

    const raw = buildRawEmail({ to, subject, body, pdfBase64, pdfFilename });
    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });

    await supabase.from('invoice_history').insert({
      type: 'sent',
      to,
      subject,
      invoice_number: invoiceNumber || '',
      sent_at: new Date().toISOString(),
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === History Routes ===
router.get('/history', async (req, res) => {
  const { data, error } = await supabase.from('invoice_history').select('*').order('created_at');
  if (error) return res.status(500).json({ error: error.message });
  res.json(toCamelArray(data));
});

router.delete('/history/:id', async (req, res) => {
  const { error } = await supabase.from('invoice_history').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// === Schedules Routes ===
router.get('/schedules', async (req, res) => {
  const { data, error } = await supabase.from('schedules').select('*').order('created_at');
  if (error) return res.status(500).json({ error: error.message });
  res.json(toCamelArray(data));
});

router.post('/schedules', async (req, res) => {
  const row = toSnake(req.body);
  delete row.id;
  row.active = true;
  const { data, error } = await supabase.from('schedules').insert(row).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(toCamel(data));
});

router.put('/schedules/:id', async (req, res) => {
  const row = toSnake(req.body);
  delete row.id;
  const { data, error } = await supabase.from('schedules').update(row).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(toCamel(data));
});

router.delete('/schedules/:id', async (req, res) => {
  const { error } = await supabase.from('schedules').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// === Settings Routes ===
router.get('/settings', async (req, res) => {
  const { data, error } = await supabase.from('invoice_settings').select('*').eq('id', 'default').single();
  if (error) return res.status(500).json({ error: error.message });
  const result = toCamel(data);
  delete result.id;
  delete result.updatedAt;
  res.json(result);
});

router.put('/settings', async (req, res) => {
  const row = toSnake(req.body);
  delete row.id;
  row.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from('invoice_settings').update(row).eq('id', 'default').select().single();
  if (error) return res.status(500).json({ error: error.message });
  const result = toCamel(data);
  delete result.id;
  delete result.updatedAt;
  res.json(result);
});

// === Invoice Number Route ===
router.get('/invoice-number', async (req, res) => {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
  const { data } = await supabase.from('invoice_history').select('invoice_number').like('invoice_number', `%${dateStr}%`);
  const count = (data || []).length + 1;
  res.json({ number: `INV-${dateStr}-${String(count).padStart(3, '0')}` });
});

// === Data Export / Import Routes ===
router.get('/data/export', async (req, res) => {
  const [clients, templates, history, schedules] = await Promise.all([
    supabase.from('clients').select('*'),
    supabase.from('email_templates').select('*'),
    supabase.from('invoice_history').select('*'),
    supabase.from('schedules').select('*'),
  ]);
  res.json({
    clients: toCamelArray(clients.data),
    templates: { templates: toCamelArray(templates.data) },
    history: toCamelArray(history.data),
    schedules: toCamelArray(schedules.data),
    exportedAt: new Date().toISOString(),
  });
});

// === Amazon SP-API Helper ===
const getSpApiAccessToken = async (account) => {
  const res = await fetch('https://api.amazon.com/auth/o2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: account.refresh_token,
      client_id: account.sp_api_client_id,
      client_secret: account.sp_api_client_secret,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('SP-API token error: ' + JSON.stringify(data));
  return data.access_token;
};

const SP_API_BASE = 'https://sellingpartnerapi-fe.amazon.com';

const fetchSalesMetrics = async (account, startDate, endDate) => {
  const token = await getSpApiAccessToken(account);
  const interval = `${startDate}T00:00:00Z--${endDate}T23:59:59Z`;
  const url = `${SP_API_BASE}/sales/v1/orderMetrics?marketplaceIds=${account.marketplace_id}&interval=${encodeURIComponent(interval)}&granularity=Total`;
  const res = await fetch(url, {
    headers: { 'x-amz-access-token': token, 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  if (data.errors) throw new Error(data.errors.map(e => e.message).join(', '));
  const metrics = data.payload?.[0] || {};
  return Math.round(parseFloat(metrics.totalSales?.amount || '0'));
};

// Calculate fee from tiered rules
const calcTieredFee = (amount, tiers) => {
  let fee = 0;
  const sorted = [...tiers].sort((a, b) => a.min - b.min);
  for (const tier of sorted) {
    const min = tier.min || 0;
    const max = tier.max ?? Infinity;
    if (amount <= min) continue;
    const taxable = Math.min(amount, max) - min;
    fee += Math.round(taxable * (tier.rate / 100));
  }
  return fee;
};

// === Amazon Accounts Routes ===
router.get('/clients/:clientId/amazon-accounts', async (req, res) => {
  const { data, error } = await supabase.from('amazon_accounts').select('*')
    .eq('client_id', req.params.clientId).order('created_at');
  if (error) return res.status(500).json({ error: error.message });
  // Hide secrets in response
  res.json(toCamelArray(data).map(a => ({ ...a, refreshToken: '***', spApiClientSecret: '***' })));
});

router.post('/clients/:clientId/amazon-accounts', async (req, res) => {
  const row = toSnake(req.body);
  delete row.id;
  row.client_id = req.params.clientId;
  const { data, error } = await supabase.from('amazon_accounts').insert(row).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(toCamel(data));
});

router.delete('/amazon-accounts/:id', async (req, res) => {
  const { error } = await supabase.from('amazon_accounts').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// === Amazon Account Connection Test ===
router.post('/amazon-accounts/:id/test', async (req, res) => {
  try {
    const { data: account, error } = await supabase.from('amazon_accounts')
      .select('*').eq('id', req.params.id).single();
    if (error || !account) return res.status(404).json({ error: 'Account not found' });

    // Step 1: Test token exchange
    let token;
    try {
      token = await getSpApiAccessToken(account);
    } catch (e) {
      return res.json({ success: false, step: 'token', error: e.message });
    }

    // Step 2: Try Sales API (getOrderMetrics for today - lightweight)
    const today = new Date().toISOString().slice(0, 10);
    const interval = `${today}T00:00:00Z--${today}T23:59:59Z`;
    const salesUrl = `${SP_API_BASE}/sales/v1/orderMetrics?marketplaceIds=${account.marketplace_id}&interval=${encodeURIComponent(interval)}&granularity=Total`;
    const salesRes = await fetch(salesUrl, {
      headers: { 'x-amz-access-token': token, 'Content-Type': 'application/json' },
    });
    const salesData = await salesRes.json();

    if (salesData.errors) {
      // Try sellers API as fallback
      const sellersUrl = `${SP_API_BASE}/sellers/v1/marketplaceParticipations`;
      const sellersRes = await fetch(sellersUrl, {
        headers: { 'x-amz-access-token': token, 'Content-Type': 'application/json' },
      });
      const sellersData = await sellersRes.json();

      if (sellersData.errors) {
        return res.json({
          success: false,
          step: 'api',
          tokenOk: true,
          error: salesData.errors.map(e => e.message).join(', '),
          hint: 'Amazon Developer Central → アプリ設定 → 「IAM ARN」のIAMロールに必要なポリシーが付与されているか確認してください。また、Seller Centralでアプリの認可が完了しているか確認してください。',
        });
      }

      const marketplaces = (sellersData.payload || []).map(p => ({
        id: p.marketplace?.id,
        name: p.marketplace?.name,
        country: p.marketplace?.countryCode,
      }));
      return res.json({ success: true, tokenOk: true, salesApiOk: false, marketplaces,
        note: 'Sellers APIは成功。Sales APIはアプリのロール設定が必要です。' });
    }

    const todaySales = salesData.payload?.[0]?.totalSales?.amount || '0';
    res.json({
      success: true, tokenOk: true, salesApiOk: true,
      todaySales: `¥${Math.round(parseFloat(todaySales)).toLocaleString()}`,
      message: '全ての接続テストに成功しました',
    });
  } catch (err) {
    res.json({ success: false, step: 'unknown', error: err.message });
  }
});

// === Amazon Account Edit ===
router.put('/amazon-accounts/:id', async (req, res) => {
  const row = toSnake(req.body);
  delete row.id;
  delete row.client_id;
  const { data, error } = await supabase.from('amazon_accounts').update(row).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(toCamel(data));
});

// === Fee Rules Routes ===
router.get('/clients/:clientId/fee-rules', async (req, res) => {
  const { data, error } = await supabase.from('fee_rules').select('*')
    .eq('client_id', req.params.clientId).order('created_at');
  if (error) return res.status(500).json({ error: error.message });
  res.json(toCamelArray(data));
});

router.post('/clients/:clientId/fee-rules', async (req, res) => {
  const row = toSnake(req.body);
  delete row.id;
  row.client_id = req.params.clientId;
  const { data, error } = await supabase.from('fee_rules').insert(row).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(toCamel(data));
});

router.put('/fee-rules/:id', async (req, res) => {
  const row = toSnake(req.body);
  delete row.id;
  const { data, error } = await supabase.from('fee_rules').update(row).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(toCamel(data));
});

router.delete('/fee-rules/:id', async (req, res) => {
  const { error } = await supabase.from('fee_rules').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// === Fetch Sales Data from SP-API ===
router.post('/amazon-accounts/:id/fetch-sales', async (req, res) => {
  try {
    const { yearMonth } = req.body; // e.g. "2026-03"
    if (!yearMonth) return res.status(400).json({ error: 'yearMonth is required' });

    const { data: account, error: accErr } = await supabase.from('amazon_accounts')
      .select('*').eq('id', req.params.id).single();
    if (accErr || !account) return res.status(404).json({ error: 'Account not found' });

    const [y, m] = yearMonth.split('-').map(Number);
    const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const endDate = `${y}-${String(m).padStart(2, '0')}-${lastDay}`;

    const totalSales = await fetchSalesMetrics(account, startDate, endDate);

    // Upsert monthly data
    const { data, error } = await supabase.from('amazon_monthly_data').upsert({
      amazon_account_id: req.params.id,
      year_month: yearMonth,
      total_sales: totalSales,
      fetched_at: new Date().toISOString(),
    }, { onConflict: 'amazon_account_id,year_month' }).select().single();

    if (error) return res.status(500).json({ error: error.message });
    res.json(toCamel(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manual update of ad spend
router.put('/amazon-monthly-data/:accountId/:yearMonth', async (req, res) => {
  const { totalAdSpend } = req.body;
  const { data, error } = await supabase.from('amazon_monthly_data').upsert({
    amazon_account_id: req.params.accountId,
    year_month: req.params.yearMonth,
    total_ad_spend: totalAdSpend,
  }, { onConflict: 'amazon_account_id,year_month' }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(toCamel(data));
});

// === Calculate Fees for Client ===
router.get('/clients/:clientId/calculate-fees', async (req, res) => {
  try {
    const { yearMonth } = req.query;
    if (!yearMonth) return res.status(400).json({ error: 'yearMonth is required' });

    // Get accounts for this client
    const { data: accounts } = await supabase.from('amazon_accounts')
      .select('id, account_name').eq('client_id', req.params.clientId);

    // Get monthly data for all accounts
    const accountIds = (accounts || []).map(a => a.id);
    let monthlyData = [];
    if (accountIds.length > 0) {
      const { data } = await supabase.from('amazon_monthly_data')
        .select('*').in('amazon_account_id', accountIds).eq('year_month', yearMonth);
      monthlyData = data || [];
    }

    // Aggregate: total sales and ad spend across all accounts
    let totalSales = 0;
    let totalAdSpend = 0;
    const accountDetails = [];
    for (const acc of (accounts || [])) {
      const md = monthlyData.find(d => d.amazon_account_id === acc.id);
      const sales = Number(md?.total_sales || 0);
      const adSpend = Number(md?.total_ad_spend || 0);
      totalSales += sales;
      totalAdSpend += adSpend;
      accountDetails.push({ accountName: acc.account_name, sales, adSpend });
    }

    // Get fee rules
    const { data: rules } = await supabase.from('fee_rules')
      .select('*').eq('client_id', req.params.clientId).eq('active', true);

    // Calculate fees
    const feeItems = [];
    for (const rule of (rules || [])) {
      if (rule.rule_type === 'sales_performance') {
        const fee = calcTieredFee(totalSales, rule.tiers || []);
        feeItems.push({
          description: rule.description || '売上成果報酬',
          ruleType: 'sales_performance',
          baseAmount: totalSales,
          fee,
          tiers: rule.tiers,
        });
      } else if (rule.rule_type === 'adspend_percentage') {
        const fee = calcTieredFee(totalAdSpend, rule.tiers || []);
        feeItems.push({
          description: rule.description || '広告運用費',
          ruleType: 'adspend_percentage',
          baseAmount: totalAdSpend,
          fee,
          tiers: rule.tiers,
        });
      }
    }

    res.json({ yearMonth, totalSales, totalAdSpend, accountDetails, feeItems });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === Server-side PDF Generation ===
let cachedFont = null;
const loadFont = async (baseUrl) => {
  if (cachedFont) return cachedFont;
  const res = await fetch(`${baseUrl}/fonts/NotoSansJP-Regular.woff`);
  cachedFont = Buffer.from(await res.arrayBuffer());
  return cachedFont;
};

const generateInvoicePDFBuffer = async (baseUrl, { invoiceNumber, issueDate, dueDate, client, sender, items, notes }) => {
  const font = await loadFont(baseUrl);
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
  doc.registerFont('JP', font);
  doc.font('JP');

  const BLUE = '#2563eb';
  const fmt = (d) => { const dt = new Date(d); return `${dt.getFullYear()}年${dt.getMonth()+1}月${dt.getDate()}日`; };
  const fmtYen = (n) => `¥${Number(n).toLocaleString()}`;
  const pw = 515; // page width minus margins

  // Header
  doc.fontSize(26).fillColor(BLUE).text('INVOICE', 40, 40);
  doc.fontSize(11).fillColor('#1a1a1a').text(sender.sender_name || '', 300, 40, { align: 'right', width: pw - 260 });
  if (sender.sender_company) doc.fontSize(8).fillColor('#666').text(sender.sender_company, 300, 56, { align: 'right', width: pw - 260 });
  if (sender.sender_address) doc.fontSize(8).fillColor('#666').text(sender.sender_address, 300, 68, { align: 'right', width: pw - 260 });
  if (sender.sender_phone) doc.fontSize(8).fillColor('#666').text('TEL: ' + sender.sender_phone, 300, 80, { align: 'right', width: pw - 260 });

  doc.moveTo(40, 98).lineTo(40 + pw, 98).strokeColor(BLUE).lineWidth(2).stroke();

  // Meta + Bill To
  let y = 110;
  doc.fontSize(8).fillColor('#888').text('請求書番号', 40, y);
  doc.fontSize(9).fillColor('#1a1a1a').text(invoiceNumber, 120, y);
  doc.fontSize(8).fillColor('#888').text('請求日', 40, y + 16);
  doc.fontSize(9).fillColor('#1a1a1a').text(fmt(issueDate), 120, y + 16);
  doc.fontSize(8).fillColor('#888').text('支払期限', 40, y + 32);
  doc.fontSize(9).fillColor('#1a1a1a').text(fmt(dueDate), 120, y + 32);

  doc.fontSize(8).fillColor('#888').text('請求先 / BILL TO', 300, y);
  doc.fontSize(13).fillColor('#1a1a1a').text(`${client.company_name} 御中`, 300, y + 14, { width: pw - 260 });
  if (client.contact_name) doc.fontSize(9).fillColor('#444').text(`${client.contact_name} 様`, 300, y + 32);
  if (client.address) doc.fontSize(8).fillColor('#666').text(client.address, 300, y + 44);

  // Table header
  y = 200;
  doc.rect(40, y, pw, 24).fill(BLUE);
  doc.fontSize(8).fillColor('#fff');
  doc.text('品目', 48, y + 7, { width: 250 });
  doc.text('単価', 300, y + 7, { width: 80, align: 'right' });
  doc.text('数量', 385, y + 7, { width: 40, align: 'center' });
  doc.text('金額', 430, y + 7, { width: 120, align: 'right' });
  y += 28;

  // Table rows
  let subtotal = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const price = item.itemType === 'fixed' ? item.unitPrice : Math.round((item.baseAmount || 0) * (item.rate || 0) / 100);
    const amount = item.itemType === 'fixed' ? price * (item.quantity || 1) : price;
    subtotal += amount;

    if (i % 2 === 1) doc.rect(40, y, pw, 22).fill('#f8fafc');
    doc.fontSize(9).fillColor('#1a1a1a');
    doc.text(item.description || '', 48, y + 6, { width: 250 });
    if (item.itemType === 'fixed') {
      doc.text(fmtYen(item.unitPrice), 300, y + 6, { width: 80, align: 'right' });
      doc.text(String(item.quantity || 1), 385, y + 6, { width: 40, align: 'center' });
    } else {
      doc.text(`${fmtYen(item.baseAmount || 0)} × ${item.rate}%`, 300, y + 6, { width: 80, align: 'right' });
      doc.text('-', 385, y + 6, { width: 40, align: 'center' });
    }
    doc.text(fmtYen(amount), 430, y + 6, { width: 120, align: 'right' });
    doc.moveTo(40, y + 22).lineTo(40 + pw, y + 22).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
    y += 24;
  }

  // Totals
  y += 8;
  doc.fontSize(9).fillColor('#666').text('小計 (SUB-TOTAL)', 350, y, { width: 100, align: 'right' });
  doc.fontSize(10).fillColor('#1a1a1a').text(fmtYen(subtotal), 460, y, { width: 95, align: 'right' });
  y += 20;
  doc.rect(350, y, 205, 30).fill(BLUE);
  doc.fontSize(11).fillColor('#fff').text('合計 (TOTAL)', 360, y + 8, { width: 90 });
  doc.fontSize(14).fillColor('#fff').text(fmtYen(subtotal), 450, y + 6, { width: 95, align: 'right' });
  y += 40;

  // Notes + Payment side by side
  if (notes) {
    doc.rect(40, y, pw / 2 - 8, 60).fill('#fffbeb');
    doc.moveTo(40, y).lineTo(40, y + 60).strokeColor('#f59e0b').lineWidth(3).stroke();
    doc.fontSize(8).fillColor('#92400e').text('備考 / NOTES', 50, y + 8);
    doc.fontSize(8).fillColor('#1a1a1a').text(notes, 50, y + 20, { width: pw / 2 - 30 });
  }
  const px = notes ? 40 + pw / 2 + 8 : 40;
  const pWidth = notes ? pw / 2 - 8 : pw;
  doc.rect(px, y, pWidth, 80).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
  doc.fontSize(8).fillColor(BLUE).text('お振込先 / PAYMENT', px + 10, y + 8);
  const payRows = [
    ['通貨', sender.currency], ['口座名義', sender.bank_account_name],
    ['銀行', sender.bank_name], ['支店', sender.bank_branch], ['口座番号', sender.bank_account],
  ].filter(([,v]) => v);
  let py = y + 22;
  for (const [k, v] of payRows) {
    doc.fontSize(7).fillColor('#888').text(k, px + 10, py, { width: 60 });
    doc.fontSize(8).fillColor('#1a1a1a').text(v, px + 75, py);
    py += 12;
  }

  // Footer
  doc.fontSize(8).fillColor('#888').text('Thank You For Your Business', 40, 770, { width: pw, align: 'center' });

  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
};

// === Template variable replacement (server-side) ===
const applyServerTemplateVars = (text, { client, items, subtotal, invoiceNumber, issueDate, dueDate, sender }) => {
  const fmt = (d) => { const dt = new Date(d); return `${dt.getFullYear()}年${dt.getMonth()+1}月${dt.getDate()}日`; };
  const fmtYen = (n) => `¥${Number(n).toLocaleString()}`;
  const itemsText = items.map(i => {
    const price = i.itemType === 'fixed' ? i.unitPrice * (i.quantity || 1) : Math.round((i.baseAmount || 0) * (i.rate || 0) / 100);
    return `・${i.description}：${fmtYen(price)}`;
  }).join('\n');

  return text
    .replace(/\{会社名\}/g, client.company_name || '')
    .replace(/\{担当者名\}/g, client.contact_name || '')
    .replace(/\{請求項目\}/g, itemsText)
    .replace(/\{品目\}/g, items.map(i => i.description).filter(Boolean).join('、'))
    .replace(/\{合計金額\}/g, fmtYen(subtotal))
    .replace(/\{小計\}/g, fmtYen(subtotal))
    .replace(/\{請求書番号\}/g, invoiceNumber || '')
    .replace(/\{請求日\}/g, fmt(issueDate))
    .replace(/\{支払期限\}/g, fmt(dueDate))
    .replace(/\{差出人名\}/g, sender.sender_name || '')
    .replace(/\{会社名_差出人\}/g, sender.sender_company || '');
};

// === Cron endpoint (called by Vercel Cron) ===
router.get('/cron', async (req, res) => {
  if (CRON_SECRET && req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const today = new Date();
  const dayOfMonth = today.getDate();

  const { data: schedules } = await supabase.from('schedules').select('*').eq('active', true).eq('day_of_month', dayOfMonth);
  if (!schedules || schedules.length === 0) return res.json({ message: 'No schedules for today' });

  // Load settings (sender info)
  const { data: sender } = await supabase.from('invoice_settings').select('*').eq('id', 'default').single();

  let processed = 0;
  for (const schedule of schedules) {
    const { data: client } = await supabase.from('clients').select('*').eq('id', schedule.client_id).single();
    const { data: template } = await supabase.from('email_templates').select('*').eq('id', schedule.template_id).single();
    if (!client || !template) continue;

    try {
      // --- Build invoice items ---
      let items = [...(schedule.fixed_items || [])];

      // Auto-fetch Amazon data if enabled
      if (schedule.auto_fetch_amazon) {
        const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const yearMonth = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;

        // Fetch sales from SP-API for all accounts
        const { data: accounts } = await supabase.from('amazon_accounts').select('*').eq('client_id', client.id);
        let totalSales = 0, totalAdSpend = 0;
        for (const acc of (accounts || [])) {
          try {
            const [y, m] = yearMonth.split('-').map(Number);
            const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
            const lastDay = new Date(y, m, 0).getDate();
            const endDate = `${y}-${String(m).padStart(2, '0')}-${lastDay}`;
            const sales = await fetchSalesMetrics(acc, startDate, endDate);
            totalSales += sales;

            // Get cached ad spend
            const { data: md } = await supabase.from('amazon_monthly_data')
              .select('total_ad_spend').eq('amazon_account_id', acc.id).eq('year_month', yearMonth).single();
            totalAdSpend += Number(md?.total_ad_spend || 0);

            // Cache sales
            await supabase.from('amazon_monthly_data').upsert({
              amazon_account_id: acc.id, year_month: yearMonth, total_sales: sales, fetched_at: new Date().toISOString(),
            }, { onConflict: 'amazon_account_id,year_month' });
          } catch (e) {
            console.error(`[cron] SP-API fetch error for ${acc.account_name}:`, e.message);
          }
        }

        // Calculate fees from schedule's fee rules config
        const feeRules = schedule.fee_rules_config || [];
        for (const rule of feeRules) {
          const base = rule.ruleType === 'sales_performance' ? totalSales : totalAdSpend;
          const fee = calcTieredFee(base, rule.tiers || []);
          if (fee > 0) {
            const effectiveRate = base > 0 ? Math.round((fee / base) * 10000) / 100 : 0;
            items.push({
              description: rule.description || (rule.ruleType === 'sales_performance' ? '売上成果報酬' : '広告運用費'),
              itemType: rule.ruleType === 'sales_performance' ? 'performance' : 'adspend',
              baseAmount: base, rate: effectiveRate, unitPrice: 0, quantity: 1,
            });
          }
        }
      }

      // --- Generate invoice ---
      const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
      const { data: histCount } = await supabase.from('invoice_history').select('invoice_number').like('invoice_number', `%${dateStr}%`);
      const invoiceNumber = `INV-${dateStr}-${String((histCount || []).length + 1).padStart(3, '0')}`;
      const issueDate = today.toISOString().slice(0, 10);
      const dueDate = new Date(today.getFullYear(), today.getMonth() + 1, today.getDate()).toISOString().slice(0, 10);

      let subtotal = 0;
      for (const item of items) {
        const price = item.itemType === 'fixed' ? (item.unitPrice || 0) * (item.quantity || 1) : Math.round((item.baseAmount || 0) * (item.rate || 0) / 100);
        subtotal += price;
      }

      // Generate PDF
      const pdfBuffer = await generateInvoicePDFBuffer(baseUrl, {
        invoiceNumber, issueDate, dueDate, client, sender: sender || {}, items, notes: schedule.notes || '',
      });
      const pdfBase64 = pdfBuffer.toString('base64');
      const d = new Date(issueDate);
      const pdfFilename = `請求書_${client.company_name}_${d.getFullYear()}年${String(d.getMonth()+1).padStart(2,'0')}月.pdf`;

      // Apply template variables to email
      const vars = { client, items, subtotal, invoiceNumber, issueDate, dueDate, sender: sender || {} };
      const emailSubject = applyServerTemplateVars(template.subject, vars);
      const emailBody = applyServerTemplateVars(template.body, vars);

      // Send or create draft
      const auth = await getAuthorizedClient();
      const gmail = google.gmail({ version: 'v1', auth });
      const raw = buildRawEmail({ to: client.email, subject: emailSubject, body: emailBody, pdfBase64, pdfFilename });

      let historyEntry = {
        type: schedule.send_mode === 'send' ? 'sent' : 'draft',
        to: client.email,
        subject: emailSubject,
        invoice_number: invoiceNumber,
        from_schedule: true,
      };

      if (schedule.send_mode === 'send') {
        await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
        historyEntry.sent_at = new Date().toISOString();
      } else {
        const draft = await gmail.users.drafts.create({ userId: 'me', requestBody: { message: { raw } } });
        historyEntry.draft_id = draft.data.id;
      }

      await supabase.from('invoice_history').insert(historyEntry);
      processed++;
      console.log(`[cron] ${schedule.send_mode === 'send' ? 'Sent' : 'Draft created'} for ${client.company_name}`);
    } catch (err) {
      console.error(`[cron] Error for schedule ${schedule.id}:`, err.message);
    }
  }
  res.json({ success: true, processed });
});

module.exports = router;

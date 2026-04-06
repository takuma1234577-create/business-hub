const express = require('express');
const router = express.Router();
const { getSupabase } = require('./shared.cjs');

// 遅延読み込み（暗号化キー未設定時のクラッシュ回避）
function getCrypto() { return require('./crypto-utils.cjs'); }
function getScrapers() { return require('./scrapers/index.cjs'); }

const SUPPORTED_INSTITUTIONS = [
  { code: 'rakuten_bank', name: '楽天銀行', type: 'bank', status: 'supported' },
  { code: 'rakuten_card', name: '楽天カード', type: 'credit_card', status: 'supported' },
  { code: 'sbi_net', name: '住信SBIネット銀行', type: 'bank', status: 'supported' },
  { code: 'smbc_card', name: '三井住友カード', type: 'credit_card', status: 'supported' },
  { code: 'mufg', name: '三菱UFJ銀行', type: 'bank', status: 'planned' },
  { code: 'smbc', name: '三井住友銀行', type: 'bank', status: 'planned' },
  { code: 'mizuho', name: 'みずほ銀行', type: 'bank', status: 'planned' },
  { code: 'yucho', name: 'ゆうちょ銀行', type: 'bank', status: 'planned' },
  { code: 'amazon_card', name: 'Amazon Mastercard', type: 'credit_card', status: 'planned' },
  { code: 'koza_shinkin', name: 'コザ信用金庫', type: 'bank', status: 'planned' },
];

const supabase = new Proxy({}, { get: (_, prop) => getSupabase()[prop] });

// カラムマッピング
const SNAKE_MAP = {
  accountId: 'account_id', institutionCode: 'institution_code',
  loginIdEncrypted: 'login_id_encrypted', passwordEncrypted: 'password_encrypted',
  extraAuthEncrypted: 'extra_auth_encrypted', encryptionKeyId: 'encryption_key_id',
  lastSyncAt: 'last_sync_at', syncStatus: 'sync_status', syncError: 'sync_error',
  isActive: 'is_active', createdAt: 'created_at', updatedAt: 'updated_at',
  credentialId: 'credential_id', startedAt: 'started_at', completedAt: 'completed_at',
  transactionsFound: 'transactions_found', transactionsImported: 'transactions_imported',
  transactionsSkipped: 'transactions_skipped', errorMessage: 'error_message',
};
const CAMEL_MAP = Object.fromEntries(Object.entries(SNAKE_MAP).map(([k, v]) => [v, k]));
const toCamel = (obj) => {
  if (!obj) return obj;
  const r = {};
  for (const [k, v] of Object.entries(obj)) r[CAMEL_MAP[k] || k] = v;
  return r;
};
const toCamelArray = (arr) => (arr || []).map(toCamel);

// =====================
// 対応金融機関一覧
// =====================
router.get('/institutions', (_req, res) => {
  res.json(SUPPORTED_INSTITUTIONS);
});

// =====================
// CREDENTIALS CRUD
// =====================

// 一覧（認証情報は返さない）
router.get('/credentials', async (_req, res) => {
  try {
    const { data, error } = await supabase.from('bank_credentials')
      .select('id, account_id, institution_code, encryption_key_id, last_sync_at, sync_status, sync_error, is_active, created_at, updated_at')
      .order('created_at', { ascending: false });
    if (error) throw error;

    // 金融機関名を付与
    const result = toCamelArray(data).map(cred => {
      const inst = SUPPORTED_INSTITUTIONS.find(i => i.code === cred.institutionCode);
      return { ...cred, institutionName: inst?.name || cred.institutionCode };
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 追加
router.post('/credentials', async (req, res) => {
  try {
    const { accountId, institutionCode, loginId, password, extraAuth } = req.body;
    if (!accountId || !institutionCode || !loginId || !password) {
      return res.status(400).json({ error: '口座ID、金融機関、ログインID、パスワードは必須です' });
    }

    const row = {
      account_id: accountId,
      institution_code: institutionCode,
      login_id_encrypted: getCrypto().encrypt(loginId),
      password_encrypted: getCrypto().encrypt(password),
      extra_auth_encrypted: extraAuth ? JSON.stringify(
        Object.fromEntries(Object.entries(extraAuth).map(([k, v]) => [k, getCrypto().encrypt(String(v))]))
      ) : null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase.from('bank_credentials').insert(row).select(
      'id, account_id, institution_code, last_sync_at, sync_status, sync_error, is_active, created_at, updated_at'
    ).single();
    if (error) throw error;

    res.json(toCamel(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 更新
router.put('/credentials/:id', async (req, res) => {
  try {
    const { loginId, password, extraAuth, isActive } = req.body;
    const row = { updated_at: new Date().toISOString() };

    if (loginId) row.login_id_encrypted = getCrypto().encrypt(loginId);
    if (password) row.password_encrypted = getCrypto().encrypt(password);
    if (extraAuth !== undefined) {
      row.extra_auth_encrypted = extraAuth ? JSON.stringify(
        Object.fromEntries(Object.entries(extraAuth).map(([k, v]) => [k, getCrypto().encrypt(String(v))]))
      ) : null;
    }
    if (isActive !== undefined) row.is_active = isActive;

    const { data, error } = await supabase.from('bank_credentials')
      .update(row).eq('id', req.params.id)
      .select('id, account_id, institution_code, last_sync_at, sync_status, sync_error, is_active, created_at, updated_at')
      .single();
    if (error) throw error;

    res.json(toCamel(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 削除
router.delete('/credentials/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('bank_credentials').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================
// SYNC TRIGGER
// =====================

// 個別同期（Railway経由 or ローカル実行）
router.post('/trigger/:credentialId', async (req, res) => {
  try {
    const { credentialId } = req.params;
    const { daysBack = 30 } = req.body || {};

    const { data: cred, error: credErr } = await supabase.from('bank_credentials')
      .select('*').eq('id', credentialId).single();
    if (credErr || !cred) return res.status(404).json({ error: '認証情報が見つかりません' });
    if (!cred.is_active) return res.status(400).json({ error: 'この接続は無効化されています' });

    const SCRAPER_URL = process.env.RAILWAY_SCRAPER_URL || process.env.RENDER_SCRAPER_URL;

    if (SCRAPER_URL) {
      // 外部スクレイパーサーバーにジョブ投入
      const { data: job, error: jobErr } = await supabase.from('scraping_jobs').insert({
        credential_id: credentialId,
        account_id: cred.account_id,
        status: 'pending',
        session_data: { daysBack },
      }).select().single();
      if (jobErr) throw jobErr;

      const axios = require('axios');
      await axios.post(`${SCRAPER_URL}/scrape`, { jobId: job.id }, {
        headers: { Authorization: `Bearer ${process.env.SCRAPER_API_SECRET || ''}` },
        timeout: 10000,
      });

      await supabase.from('bank_credentials').update({
        sync_status: 'running', sync_error: 'スクレイパーサーバーで処理中...',
      }).eq('id', credentialId);

      res.json({ jobId: job.id, status: 'pending', mode: 'remote' });
    } else {
      // Railway未設定 → ローカル実行（既存のフォールバック）
      const { data: job, error: jobErr } = await supabase.from('scraping_jobs').insert({
        credential_id: credentialId,
        account_id: cred.account_id,
        status: 'running',
        started_at: new Date().toISOString(),
      }).select().single();
      if (jobErr) throw jobErr;

      await supabase.from('bank_credentials').update({
        sync_status: 'running', sync_error: null,
      }).eq('id', credentialId);

      const result = await executeScraping(cred, job.id, daysBack);
      res.json(result);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2FAコード送信（Railway転送）
router.post('/jobs/:jobId/2fa', async (req, res) => {
  try {
    const { jobId } = req.params;
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: '2FAコードは必須です' });

    const SCRAPER_URL = process.env.RAILWAY_SCRAPER_URL || process.env.RENDER_SCRAPER_URL;
    if (SCRAPER_URL) {
      const axios = require('axios');
      const { data } = await axios.post(`${SCRAPER_URL}/scrape/${jobId}/2fa`, { code }, {
        headers: { Authorization: `Bearer ${process.env.SCRAPER_API_SECRET || ''}` },
      });
      res.json(data);
    } else {
      // Railwayなし: Supabaseに直接書き込み（ローカル実行用）
      const { data: job } = await supabase.from('scraping_jobs').select('session_data').eq('id', jobId).single();
      const sessionData = (job?.session_data || {});
      sessionData.twoFactorCode = code;
      await supabase.from('scraping_jobs').update({ session_data: sessionData }).eq('id', jobId);
      res.json({ success: true });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 全件同期
router.post('/trigger-all', async (_req, res) => {
  try {
    const { data: creds, error } = await supabase.from('bank_credentials')
      .select('id').eq('is_active', true);
    if (error) throw error;

    const jobs = [];
    for (const cred of (creds || [])) {
      const { data: fullCred } = await supabase.from('bank_credentials')
        .select('*').eq('id', cred.id).single();
      if (!fullCred) continue;

      const { data: job } = await supabase.from('scraping_jobs').insert({
        credential_id: cred.id,
        account_id: fullCred.account_id,
        status: 'running',
        started_at: new Date().toISOString(),
      }).select().single();

      if (job) {
        await supabase.from('bank_credentials').update({
          sync_status: 'running', sync_error: null, updated_at: new Date().toISOString(),
        }).eq('id', cred.id);

        executeScraping(fullCred, job.id, 30).catch(err =>
          console.error(`Scraping error for ${cred.id}:`, err.message)
        );
        jobs.push({ credentialId: cred.id, jobId: job.id });
      }
    }

    res.json({ triggered: jobs.length, jobs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================
// JOBS
// =====================

router.get('/jobs', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 20;
    const { data, error } = await supabase.from('scraping_jobs')
      .select('*').order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    res.json(toCamelArray(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/jobs/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('scraping_jobs')
      .select('*').eq('id', req.params.id).single();
    if (error) throw error;
    res.json(toCamel(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================
// CRON（Vercelクロンジョブ用）
// =====================

router.get('/cron', async (req, res) => {
  // Vercelクロンの認証（CRON_SECRETが設定されている場合）
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: creds, error } = await supabase.from('bank_credentials')
      .select('*').eq('is_active', true);
    if (error) throw error;

    let triggered = 0;
    for (const cred of (creds || [])) {
      const { data: job } = await supabase.from('scraping_jobs').insert({
        credential_id: cred.id,
        account_id: cred.account_id,
        status: 'running',
        started_at: new Date().toISOString(),
      }).select().single();

      if (job) {
        await supabase.from('bank_credentials').update({
          sync_status: 'running', sync_error: null, updated_at: new Date().toISOString(),
        }).eq('id', cred.id);

        executeScraping(cred, job.id, 7).catch(err =>
          console.error(`Cron scraping error for ${cred.id}:`, err.message)
        );
        triggered++;
      }
    }

    res.json({ success: true, triggered });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================
// スクレイピング実行ロジック
// =====================

async function executeScraping(credential, jobId, daysBack) {
  try {
    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - daysBack);
    const fromStr = fromDate.toISOString().split('T')[0];
    const toStr = toDate.toISOString().split('T')[0];

    let transactions = [];

    // 1. まずPuppeteer/HTTPスクレイピングを試行（銀行サイトに直接アクセス）
    try {
      const loginId = getCrypto().decrypt(credential.login_id_encrypted);
      const password = getCrypto().decrypt(credential.password_encrypted);
      let extraAuth = {};
      if (credential.extra_auth_encrypted) {
        const parsed = JSON.parse(credential.extra_auth_encrypted);
        extraAuth = Object.fromEntries(
          Object.entries(parsed).map(([k, v]) => [k, getCrypto().decrypt(String(v))])
        );
      }

      const { getScraper } = getScrapers();
      const scraper = getScraper(credential.institution_code, { loginId, password, extraAuth });

      // ステータスコールバック（DB更新）
      const onStatus = async (msg) => {
        console.log(`[${credential.institution_code}] ${msg}`);
        await supabase.from('bank_credentials').update({
          sync_error: msg, updated_at: new Date().toISOString(),
        }).eq('id', credential.id).catch(() => {});
      };

      transactions = await scraper.fetchTransactions(fromStr, toStr, onStatus);
      console.log(`[${credential.institution_code}] スクレイピング: ${transactions.length}件取得`);
    } catch (scrapeErr) {
      console.log(`[${credential.institution_code}] スクレイピング失敗: ${scrapeErr.message}`);

      // 2FA待ちの場合はそのままthrow
      if (scrapeErr.message.includes('タイムアウト') || scrapeErr.message.includes('2FA')) {
        throw scrapeErr;
      }

      // 2. フォールバック: Gmail解析
      try {
        const { fetchTransactionsViaGmail, INSTITUTION_PARSERS } = require('./scrapers/gmail-parser.cjs');
        if (INSTITUTION_PARSERS[credential.institution_code]) {
          console.log(`[${credential.institution_code}] Gmail解析にフォールバック...`);
          transactions = await fetchTransactionsViaGmail(credential.institution_code, fromStr, toStr);
          console.log(`[${credential.institution_code}] Gmail: ${transactions.length}件取得`);
        }
      } catch (gmailErr) {
        console.log(`[${credential.institution_code}] Gmail解析も失敗: ${gmailErr.message}`);
      }

      if (transactions.length === 0) {
        throw new Error(`取引の取得に失敗しました: ${scrapeErr.message}`);
      }
    }

    // 重複チェック＆登録
    let imported = 0, skipped = 0;
    for (const tx of transactions) {
      // 同じ口座・日付・金額・摘要の重複チェック
      const { data: existing } = await supabase.from('financial_transactions')
        .select('id')
        .eq('account_id', credential.account_id)
        .eq('transaction_date', tx.date)
        .eq('amount', tx.amount)
        .eq('description', tx.description)
        .limit(1);

      if (existing && existing.length > 0) {
        skipped++;
        continue;
      }

      const { error: insertErr } = await supabase.from('financial_transactions').insert({
        account_id: credential.account_id,
        transaction_date: tx.date,
        description: tx.description,
        amount: tx.amount,
        balance_after: tx.balanceAfter,
        source: 'api',
        raw_data: tx.rawData,
        updated_at: new Date().toISOString(),
      });

      if (insertErr) {
        console.error('Insert error:', insertErr.message);
        skipped++;
      } else {
        imported++;
      }
    }

    // 口座残高更新
    if (imported > 0) {
      const { data: latest } = await supabase.from('financial_transactions')
        .select('balance_after')
        .eq('account_id', credential.account_id)
        .not('balance_after', 'is', null)
        .order('transaction_date', { ascending: false })
        .limit(1);

      if (latest && latest.length > 0 && latest[0].balance_after != null) {
        await supabase.from('financial_accounts')
          .update({ balance: latest[0].balance_after, updated_at: new Date().toISOString() })
          .eq('id', credential.account_id);
      }
    }

    // ジョブ完了
    await supabase.from('scraping_jobs').update({
      status: 'success',
      completed_at: new Date().toISOString(),
      transactions_found: transactions.length,
      transactions_imported: imported,
      transactions_skipped: skipped,
    }).eq('id', jobId);

    await supabase.from('bank_credentials').update({
      sync_status: 'success',
      sync_error: null,
      last_sync_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', credential.id);

    return { status: 'success', found: transactions.length, imported, skipped, jobId };

  } catch (err) {
    console.error('executeScraping error:', err.message);

    const is2fa = err.message.includes('タイムアウト') || err.message.includes('2FA');

    await supabase.from('scraping_jobs').update({
      status: is2fa ? 'awaiting_2fa' : 'error',
      completed_at: new Date().toISOString(),
      error_message: err.message,
    }).eq('id', jobId);

    await supabase.from('bank_credentials').update({
      sync_status: is2fa ? 'awaiting_2fa' : 'error',
      sync_error: err.message,
      updated_at: new Date().toISOString(),
    }).eq('id', credential.id);

    throw err;
  }
}

module.exports = router;

const express = require('express');
const router = express.Router();
const { getSupabase, getAnthropicClient, getGoogleAuthClient, google } = require('./shared.cjs');

const SPREADSHEET_ID = '1r0Sg5hzHbZ3Z5ZjZkwxYg6EbrPhYwk9MkPpWy8i0Ylk';
const GMAIL_SENDER = 'takuma1234577@gmail.com';

// 固定テンプレートからメール本文を生成
function generateEmailFromTemplate(lead) {
  const subject = `Amazonでの御社製品について【ご提案】`;
  const body = `初めまして、AmazonセラーのTakuと申します。

たまたまAmazonを見ていたところ、御社の製品を見つけ、凄く良い商品だと思ったのですが、広告や商品ページを見て、改善点がかなりたくさんあり、凄くもったいないと思い、いても立ってもいられず、ホームページから連絡先を見つけ、お声かけさせていただきました。

私自身、Amazonコンサルを行なっているのですが、御社の素晴らしい商品と私のAmazonでの知見、経験を活かせば、御社のAmazonビジネスを必ず引き上げることができると確信しました。

素晴らしい製品をお持ちで、私も御社の製品に関わりたいと強く思っていることもあり、1ヶ月は無料でもいいので、是非、お力添えできればと思っております。

•広告の点検•改善
•商品ページの改善
•集客、セッション数の強化
•SEO対策
•CVR•CTR改善

この辺りは1ヶ月でもできるかと思っております。とにかく、凄くいい商品なのにもったいないと思ったため、恐縮ですが、私の知見で少しでも多くの人にこの商品が届いて欲しいと思い、連絡しました。

このメールが担当者さまに届いてるかわかりませんが、是非、ご興味ある場合は一度ミーティングでもさせていただければと思います。

ご興味ある場合は、以下URLより打ち合わせ登録お願いします↓
https://timerex.net/s/takuma1234577_419d/301a4f6c

【私について】
ランサーズ↓
https://www.lancers.jp/profile/tatti13577?ref=header_menu

ホームページ↓
https://amazon-migiude-lp.vercel.app

御社のブランドのAmazonビジネスを広げていけると確信しております。

Takuma`;

  return { subject, body };
}

// AI生成用プロンプト（メール作成タブのAI生成で使用）
const EMAIL_SYSTEM_PROMPT = `あなたはAmazonエキスパートのTakuです。
リード情報をもとにパーソナライズされた営業メールを生成します。
初月無料コンサルでクロージングしてください。
JSON形式で { "subject": "件名", "body": "本文" } を返してください。`;

// テーブル初期化
async function ensureTable() {
  const sb = getSupabase();
  // テーブルが存在するかチェック（エラーなら作成不要 - Supabaseで手動作成前提）
  try {
    await sb.from('sales_email_leads').select('id').limit(1);
  } catch {
    console.log('[SalesEmail] Table not found. Please create sales_email_leads table.');
  }
}
ensureTable();

// GET /leads - リード一覧取得
router.get('/leads', async (_req, res) => {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from('sales_email_leads')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('[SalesEmail] Fetch leads error:', err.message);
    res.json([]);
  }
});

// POST /leads - リード手動追加
router.post('/leads', async (req, res) => {
  try {
    const sb = getSupabase();
    const { company_name, contact_name, email, challenges, category } = req.body;
    const { data, error } = await sb
      .from('sales_email_leads')
      .insert({
        company_name,
        contact_name: contact_name || '',
        email,
        challenges: challenges || '',
        category: category || '',
        status: 'unsent',
      })
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('[SalesEmail] Add lead error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /leads/:id
router.delete('/leads/:id', async (req, res) => {
  try {
    const sb = getSupabase();
    await sb.from('sales_email_leads').delete().eq('id', req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /sheet-preview - スプレッドシートの中身を確認
router.get('/sheet-preview', async (_req, res) => {
  try {
    const auth = await getGoogleAuthClient('sheets');
    const sheets = google.sheets({ version: 'v4', auth });
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'A1:G10',
    });
    res.json({ rows: result.data.values || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /sync-sheet - スプレッドシートからリード同期
router.post('/sync-sheet', async (_req, res) => {
  try {
    const auth = await getGoogleAuthClient('sheets');
    const sheets = google.sheets({ version: 'v4', auth });
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'A2:G',
    });

    const rows = result.data.values || [];
    const sb = getSupabase();
    let added = 0;

    for (let i = 0; i < rows.length; i++) {
      // 実際のカラム: A:会社名, B:Amazon店舗URL, C:会社URL, D:メール, E:ジャンル, F:商品名, G:困りごと
      const [company, , , email, category, productName, challenges] = rows[i];
      if (!email) continue;

      // 重複チェック
      const { data: existing } = await sb
        .from('sales_email_leads')
        .select('id')
        .eq('email', email)
        .limit(1);
      if (existing && existing.length > 0) continue;

      await sb.from('sales_email_leads').insert({
        company_name: company || '',
        contact_name: '',
        email,
        challenges: `${productName ? productName + ' - ' : ''}${challenges || ''}`,
        category: category || '',
        status: 'unsent',
        row_index: i + 2,
      });
      added++;
    }

    res.json({ synced: added, total_rows: rows.length });
  } catch (err) {
    console.error('[SalesEmail] Sync error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /preview - メールプレビュー生成
router.post('/preview', async (req, res) => {
  try {
    const { company_name, contact_name, challenges, category } = req.body;
    const anthropic = await getAnthropicClient();
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: EMAIL_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `会社名：${company_name}\n担当者名：${contact_name || '担当者'}\n課題・悩み：${challenges || '不明'}\n業種・商品カテゴリ：${category || '不明'}\n\n上記のリード情報をもとに、パーソナライズされた営業メールを生成してください。\nJSON形式で { "subject": "件名", "body": "本文" } のみを返してください。`,
        },
      ],
    });

    const text = response.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('');

    // JSONパース
    const jsonMatch = text.match(/\{[\s\S]*"subject"[\s\S]*"body"[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON parse failed');
    const parsed = JSON.parse(jsonMatch[0]);
    res.json(parsed);
  } catch (err) {
    console.error('[SalesEmail] Preview error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// テンプレートでメール送信する共通関数
async function sendLeadsWithTemplate(sb, leads, dry_run = false) {
  let gmailClient = null;
  if (!dry_run) {
    const auth = await getGoogleAuthClient('gmail');
    gmailClient = google.gmail({ version: 'v1', auth });
  }

  const details = [];
  let sent = 0;
  let errors = 0;
  let consecutiveErrors = 0;

  for (const lead of leads) {
    if (consecutiveErrors >= 3) {
      details.push({ company: lead.company_name, success: false, error: '連続エラーのため停止' });
      errors++;
      continue;
    }

    try {
      const { subject, body } = generateEmailFromTemplate(lead);

      if (!dry_run && gmailClient) {
        const emailContent = [
          `To: ${lead.email}`,
          `From: ${GMAIL_SENDER}`,
          `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
          'MIME-Version: 1.0',
          'Content-Type: text/plain; charset=UTF-8',
          '',
          body,
        ].join('\r\n');

        const encodedMessage = Buffer.from(emailContent)
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');

        await gmailClient.users.messages.send({
          userId: 'me',
          requestBody: { raw: encodedMessage },
        });
      }

      await sb
        .from('sales_email_leads')
        .update({
          status: dry_run ? 'unsent' : 'sent',
          sent_at: dry_run ? null : new Date().toISOString(),
          generated_subject: subject,
          generated_body: body,
        })
        .eq('id', lead.id);

      details.push({ company: lead.company_name, success: true });
      sent++;
      consecutiveErrors = 0;

      // スパム対策: 送信間隔 2〜4秒
      if (!dry_run && leads.indexOf(lead) < leads.length - 1) {
        const delay = 2000 + Math.random() * 2000;
        await new Promise((r) => setTimeout(r, delay));
      }
    } catch (err) {
      console.error(`[SalesEmail] Error for ${lead.company_name}:`, err.message);
      await sb.from('sales_email_leads').update({ status: 'error' }).eq('id', lead.id);
      details.push({ company: lead.company_name, success: false, error: err.message });
      errors++;
      consecutiveErrors++;
    }
  }

  return { total: leads.length, sent, errors, details };
}

// POST /send - メール一括送信（手動）
router.post('/send', async (req, res) => {
  try {
    const { dry_run = true, limit = 10 } = req.body;
    const sb = getSupabase();

    const { data: leads, error: fetchErr } = await sb
      .from('sales_email_leads')
      .select('*')
      .eq('status', 'unsent')
      .order('created_at', { ascending: true })
      .limit(limit);
    if (fetchErr) throw fetchErr;
    if (!leads || leads.length === 0) {
      return res.json({ total: 0, sent: 0, errors: 0, details: [] });
    }

    const result = await sendLeadsWithTemplate(sb, leads, dry_run);
    res.json(result);
  } catch (err) {
    console.error('[SalesEmail] Send error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /cron - 1日1回自動実行: スプレッドシート同期 → 未送信リードに自動メール送信
router.get('/cron', async (_req, res) => {
  console.log('[SalesEmail/cron] Starting daily auto-send...');
  const results = {};

  try {
    const sb = getSupabase();

    // Step 1: スプレッドシートからリード同期
    try {
      const auth = await getGoogleAuthClient('sheets');
      const sheets = google.sheets({ version: 'v4', auth });
      const sheetResult = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'A2:G',
      });

      const rows = sheetResult.data.values || [];
      let added = 0;

      for (let i = 0; i < rows.length; i++) {
        const [company, , , email, category, productName, challenges] = rows[i];
        if (!email) continue;

        const { data: existing } = await sb
          .from('sales_email_leads')
          .select('id')
          .eq('email', email)
          .limit(1);
        if (existing && existing.length > 0) continue;

        await sb.from('sales_email_leads').insert({
          company_name: company || '',
          contact_name: '',
          email,
          challenges: `${productName ? productName + ' - ' : ''}${challenges || ''}`,
          category: category || '',
          status: 'unsent',
          row_index: i + 2,
        });
        added++;
      }
      results.sync = { added, total_rows: rows.length };
      console.log(`[SalesEmail/cron] Synced ${added} new leads from ${rows.length} rows`);
    } catch (err) {
      console.error('[SalesEmail/cron] Sync error:', err.message);
      results.sync = { error: err.message };
    }

    // Step 2: 未送信リードにテンプレートメール自動送信
    try {
      const { data: unsent } = await sb
        .from('sales_email_leads')
        .select('*')
        .eq('status', 'unsent')
        .order('created_at', { ascending: true })
        .limit(10);

      if (unsent && unsent.length > 0) {
        const sendResult = await sendLeadsWithTemplate(sb, unsent, false);
        results.send = sendResult;
        console.log(`[SalesEmail/cron] Sent ${sendResult.sent}/${sendResult.total} emails`);
      } else {
        results.send = { total: 0, sent: 0, message: '未送信リードなし' };
      }
    } catch (err) {
      console.error('[SalesEmail/cron] Send error:', err.message);
      results.send = { error: err.message };
    }

    res.json({ ok: true, results });
  } catch (err) {
    console.error('[SalesEmail/cron] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /compose - メール作成して送信 or 下書き保存
router.post('/compose', async (req, res) => {
  try {
    const { to, subject, body, company_name, mode } = req.body;
    if (!to || !subject || !body) {
      return res.status(400).json({ error: '宛先、件名、本文を入力してください' });
    }

    const auth = await getGoogleAuthClient('gmail');
    const gmail = google.gmail({ version: 'v1', auth });

    const emailContent = [
      `To: ${to}`,
      `From: ${GMAIL_SENDER}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      body,
    ].join('\r\n');

    const encodedMessage = Buffer.from(emailContent)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    let resultStatus;
    if (mode === 'send') {
      await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw: encodedMessage },
      });
      resultStatus = 'sent';
    } else {
      await gmail.users.drafts.create({
        userId: 'me',
        requestBody: { message: { raw: encodedMessage } },
      });
      resultStatus = 'draft';
    }

    // DBにログ保存
    const sb = getSupabase();
    await sb.from('sales_email_leads').insert({
      company_name: company_name || to,
      contact_name: '',
      email: to,
      challenges: '（手動作成メール）',
      category: '',
      status: resultStatus === 'sent' ? 'sent' : 'unsent',
      generated_subject: subject,
      generated_body: body,
      sent_at: resultStatus === 'sent' ? new Date().toISOString() : null,
    });

    res.json({ status: resultStatus, to, subject });
  } catch (err) {
    console.error('[SalesEmail] Compose error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

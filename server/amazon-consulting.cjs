const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const ADMIN_EMAIL = 'takuma1234577@gmail.com';
const TIMEREX_URL = 'https://timerex.net/s/takuma1234577_419d/301a4f6c';
const SPREADSHEET_ID = '1I82ET0kOl1RmVpeS46iblpJYhowofTGcLefJrJhPFAk';

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_ANON_KEY || ''
  );
}

// Gmail送信（business-hub内部の既存APIを利用）
async function sendEmailInternal(req, to, subject, body) {
  const protocol = req.protocol;
  const host = req.get('host');
  const res = await fetch(`${protocol}://${host}/api/invoice/gmail/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, subject, body }),
  });
  if (!res.ok) throw new Error(`Email send failed: ${res.status}`);
  return res.json();
}

// Googleスプレッドシート追記（business-hub内部の既存APIを利用）
async function appendToSheet(req, row) {
  try {
    const protocol = req.protocol;
    const host = req.get('host');
    await fetch(`${protocol}://${host}/api/settings/sheets/append`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Sheet1!A:I',
        row,
      }),
    });
  } catch (e) {
    console.error('[consulting] Sheet append failed:', e.message);
  }
}

// POST /contact - フォーム送信受付
router.post('/contact', async (req, res) => {
  try {
    const { company, name, email, revenue, productUrl, category, challenges, message } = req.body;
    if (!company || !name || !email) {
      return res.status(400).json({ error: '必須項目が不足しています' });
    }

    const now = new Date();
    const submittedAt = now.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    const challengeText = Array.isArray(challenges) ? challenges.join(' / ') : '';
    const challengeList = Array.isArray(challenges) && challenges.length
      ? challenges.map(c => `・${c}`).join('\n')
      : 'なし';

    const formSummary = `
【会社名】${company}
【お名前】${name}
【メールアドレス】${email}
【現在のAmazon月商】${revenue || '未入力'}
【Amazon商品URL】${productUrl || '未入力'}
【商品カテゴリ】${category || '未入力'}
【現在お抱えの課題】
${challengeList}
【その他相談したいこと】
${message || 'なし'}
【申込日時】${submittedAt}
    `.trim();

    // 1. Supabaseに保存
    const supabase = getSupabase();
    await supabase.from('consulting_submissions').insert({
      company, name, email,
      revenue: revenue || null,
      product_url: productUrl || null,
      category: category || null,
      challenges: Array.isArray(challenges) ? challenges : [],
      message: message || null,
      submitted_at: now.toISOString(),
    });

    // 2. Googleスプレッドシートに記録
    await appendToSheet(req, [
      submittedAt, company, name, email,
      revenue || '', productUrl || '', category || '',
      challengeText, message || '',
    ]);

    // 3. 管理者への通知メール
    await sendEmailInternal(req, ADMIN_EMAIL,
      `【新規相談】${company} ${name}様`,
      `新しい無料戦略診断の申し込みがありました。\n\n${formSummary}\n\n---\n自動送信メールです。`
    );

    // 4. お客様への自動返信メール
    await sendEmailInternal(req, email,
      '【Amazonの右腕】無料戦略診断のお申し込みありがとうございます',
      `${name}様\n\nこの度は「Amazonの右腕」の無料戦略診断にお申し込みいただき、\n誠にありがとうございます。\n\n━━━━━━━━━━━━━━━━━━━━━━\n■ 次のステップ：初回面談のご予約\n━━━━━━━━━━━━━━━━━━━━━━\n\n以下のリンクから、ご都合のよい日時をお選びください。\n60分の無料戦略診断を実施いたします。\n\n▼ 初回面談を予約する\n${TIMEREX_URL}\n\n━━━━━━━━━━━━━━━━━━━━━━\n■ お申し込み内容の確認\n━━━━━━━━━━━━━━━━━━━━━━\n\n${formSummary}\n\n━━━━━━━━━━━━━━━━━━━━━━\n\n面談では、貴社のAmazon事業の現状分析と\n具体的な改善ポイントをご提案いたします。\n無理な営業は一切いたしませんので、ご安心ください。\n\nご不明点がございましたら、お気軽にご返信ください。\n\n─────────────────────\nAmazonの右腕\n代表 宇良 琢真\nEmail: ${ADMIN_EMAIL}\n─────────────────────`
    );

    res.json({ success: true });
  } catch (err) {
    console.error('[consulting] contact error:', err.message);
    res.status(500).json({ error: 'メール送信に失敗しました。しばらくしてから再度お試しください。' });
  }
});

// POST /webhook/timerex - TimeRex予約確定Webhook
router.post('/webhook/timerex', async (req, res) => {
  try {
    const body = req.body;
    const guestEmail = body.guest?.email || body.email || body.attendee?.email || body.booking?.guest_email;
    if (!guestEmail) {
      return res.json({ ok: true, message: 'No email found, skipped' });
    }

    console.log(`[timerex] webhook received: ${guestEmail}`);

    // Supabaseからsubmissionを検索
    const supabase = getSupabase();
    const { data: submission } = await supabase
      .from('consulting_submissions')
      .select('*')
      .eq('email', guestEmail)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!submission) {
      return res.json({ ok: true, message: 'No matching submission' });
    }

    // ステータスを「面談予約済み」に更新
    await supabase.from('consulting_submissions')
      .update({ status: 'booked' })
      .eq('id', submission.id);

    res.json({ ok: true, message: 'Processed' });
  } catch (err) {
    console.error('[timerex] webhook error:', err.message);
    res.json({ ok: true, message: 'Error but acknowledged' });
  }
});

// GET /webhook/timerex - ヘルスチェック
router.get('/webhook/timerex', (_req, res) => {
  res.json({ status: 'ok', endpoint: 'timerex-webhook' });
});

// GET /submissions - 申込一覧
router.get('/submissions', async (_req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('consulting_submissions')
      .select('*')
      .order('submitted_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('[consulting] submissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /submissions/:id/status - ステータス更新
router.put('/submissions/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('consulting_submissions')
      .update({ status })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /submissions/:id
router.delete('/submissions/:id', async (req, res) => {
  try {
    const supabase = getSupabase();
    await supabase.from('consulting_submissions').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

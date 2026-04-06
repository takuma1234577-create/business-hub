/**
 * Email Auto-Responder Module
 *
 * Shopify等からの問い合わせメールをGmail APIで取得し、
 * FITPEAK RAG（ナレッジベース + Claude）を使って自動返信する。
 *
 * 環境変数（shared.cjs経由）:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 *   ANTHROPIC_API_KEY
 *   VOYAGE_API_KEY
 *   SUPABASE_URL, SUPABASE_ANON_KEY
 */

const express = require('express');
const { getSupabase, getGoogleOAuth2, google } = require('./shared.cjs');
const { generateFITPEAKReply } = require('./fitpeak-rag.cjs');

const router = express.Router();
const supabase = new Proxy({}, { get: (_, prop) => getSupabase()[prop] });

// ── Gmail クライアント取得 ──
async function getGmailClient() {
  const oauth2Client = getGoogleOAuth2();
  if (!oauth2Client) throw new Error('Google OAuth未設定');

  const { data: tokenData, error: tokenErr } = await supabase
    .from('oauth_tokens')
    .select('*')
    .eq('id', 'gmail')
    .single();
  if (tokenErr || !tokenData) throw new Error('Gmail未認証。設定画面からGmail認証を行ってください。');

  oauth2Client.setCredentials({
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    scope: tokenData.scope,
    token_type: tokenData.token_type,
    expiry_date: Number(tokenData.expiry_date),
  });

  oauth2Client.on('tokens', async (tokens) => {
    const updates = { access_token: tokens.access_token, updated_at: new Date().toISOString() };
    if (tokens.refresh_token) updates.refresh_token = tokens.refresh_token;
    await supabase.from('oauth_tokens').update(updates).eq('id', 'gmail');
  });

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

// ── メール本文を取得 ──
function extractEmailBody(message) {
  let text = '';
  const parts = message.payload?.parts || [];

  if (parts.length > 0) {
    for (const part of parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        text += Buffer.from(part.body.data, 'base64url').toString('utf8');
      }
      // multipart/alternative の中のtext/plain
      if (part.parts) {
        for (const sub of part.parts) {
          if (sub.mimeType === 'text/plain' && sub.body?.data) {
            text += Buffer.from(sub.body.data, 'base64url').toString('utf8');
          }
        }
      }
    }
  } else if (message.payload?.body?.data) {
    text = Buffer.from(message.payload.body.data, 'base64url').toString('utf8');
  }

  return text.trim();
}

// ── メールヘッダーからフィールドを取得 ──
function getHeader(message, name) {
  const headers = message.payload?.headers || [];
  const header = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return header?.value || '';
}

// ── メール本文からお客様のメッセージを抽出 ──
function extractCustomerMessage(body, subject) {
  // Shopifyの問い合わせフォーム経由の場合、本文にメッセージが含まれる
  // 一般的なパターンを処理
  let message = body;

  // Shopify通知メールのパターン: 「メッセージ:」以降を抽出
  const patterns = [
    /(?:メッセージ|Message|Body|本文|内容)[:\s：]\s*([\s\S]+?)(?:\n\n---|\n\n--|$)/i,
    /(?:お問い合わせ内容|inquiry|question)[:\s：]\s*([\s\S]+?)(?:\n\n---|\n\n--|$)/i,
  ];

  for (const pat of patterns) {
    const match = body.match(pat);
    if (match?.[1]?.trim()) {
      message = match[1].trim();
      break;
    }
  }

  // フッター（署名、免責事項等）を除去
  message = message
    .replace(/--\s*\n[\s\S]*$/m, '')
    .replace(/_{3,}[\s\S]*$/m, '')
    .replace(/\*この(メール|email)[\s\S]*/i, '')
    .trim();

  // 件名も文脈として含める
  if (subject && !message.includes(subject)) {
    message = `件名: ${subject}\n\n${message}`;
  }

  return message;
}

// ── Reply-To や From からお客様のメールアドレスを取得 ──
function getCustomerEmail(message) {
  // Reply-To が設定されていればそれがお客様のアドレス
  const replyTo = getHeader(message, 'Reply-To');
  if (replyTo) {
    const match = replyTo.match(/<([^>]+)>/);
    return match ? match[1] : replyTo.trim();
  }

  // From から取得
  const from = getHeader(message, 'From');
  const match = from.match(/<([^>]+)>/);
  return match ? match[1] : from.trim();
}

// ── 設定を取得 ──
async function getSettings() {
  const { data, error } = await supabase
    .from('email_auto_reply_settings')
    .select('*')
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return {
      enabled: false,
      gmail_query: 'from:noreply@shopify.com is:unread',
      max_emails_per_run: 10,
      reply_prefix: '',
      reply_suffix: '\n\n---\nFITPEAK カスタマーサポート',
    };
  }
  return data;
}

// ── Cron / 手動トリガー: 未読メールを処理して自動返信 ──
async function processEmails() {
  const settings = await getSettings();
  if (!settings.enabled) {
    return { skipped: true, reason: 'Email auto-reply is disabled' };
  }

  const gmail = await getGmailClient();
  const query = settings.gmail_query || 'from:noreply@shopify.com is:unread';
  const maxEmails = settings.max_emails_per_run || 10;

  // 未読メールを検索
  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults: maxEmails,
  });

  const messages = listRes.data.messages || [];
  if (messages.length === 0) {
    return { processed: 0, message: 'No new emails found' };
  }

  const results = [];

  for (const msg of messages) {
    try {
      // 既に処理済みかチェック
      const { data: existing } = await supabase
        .from('email_auto_reply_logs')
        .select('id')
        .eq('gmail_message_id', msg.id)
        .limit(1);

      if (existing && existing.length > 0) {
        results.push({ id: msg.id, status: 'already_processed' });
        continue;
      }

      // メール詳細を取得
      const detail = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'full',
      });

      const subject = getHeader(detail.data, 'Subject');
      const from = getHeader(detail.data, 'From');
      const customerEmail = getCustomerEmail(detail.data);
      const body = extractEmailBody(detail.data);
      const customerMessage = extractCustomerMessage(body, subject);

      if (!customerMessage || customerMessage.length < 5) {
        // メッセージが短すぎる場合はスキップ
        await supabase.from('email_auto_reply_logs').insert({
          gmail_message_id: msg.id,
          customer_email: customerEmail,
          subject,
          customer_message: body.slice(0, 500),
          status: 'skipped',
          error: 'メッセージが短すぎます',
        });
        results.push({ id: msg.id, status: 'skipped', reason: 'message too short' });
        continue;
      }

      // RAGでAI返信を生成
      let aiReply;
      try {
        aiReply = await generateFITPEAKReply(customerMessage);
      } catch (err) {
        console.error('[email-autoresponder] RAG error:', err.message);
        await supabase.from('email_auto_reply_logs').insert({
          gmail_message_id: msg.id,
          customer_email: customerEmail,
          subject,
          customer_message: customerMessage.slice(0, 1000),
          status: 'error',
          error: `AI生成エラー: ${err.message}`,
        });
        results.push({ id: msg.id, status: 'error', error: err.message });
        continue;
      }

      // プレフィックス/サフィックスを付加
      const fullReply = [
        settings.reply_prefix || '',
        aiReply,
        settings.reply_suffix || '',
      ]
        .filter(Boolean)
        .join('\n\n');

      // Gmailで返信を送信
      const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
      const threadId = detail.data.threadId;
      const messageId = getHeader(detail.data, 'Message-ID');
      const references = getHeader(detail.data, 'References');

      const emailLines = [
        `To: ${customerEmail}`,
        `Subject: ${replySubject}`,
        `In-Reply-To: ${messageId}`,
        `References: ${references ? references + ' ' : ''}${messageId}`,
        'Content-Type: text/plain; charset=UTF-8',
        '',
        fullReply,
      ];
      const rawEmail = Buffer.from(emailLines.join('\r\n')).toString('base64url');

      await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: rawEmail,
          threadId,
        },
      });

      // 元のメールを既読にする
      await gmail.users.messages.modify({
        userId: 'me',
        id: msg.id,
        requestBody: {
          removeLabelIds: ['UNREAD'],
        },
      });

      // ログに記録
      await supabase.from('email_auto_reply_logs').insert({
        gmail_message_id: msg.id,
        customer_email: customerEmail,
        subject,
        customer_message: customerMessage.slice(0, 2000),
        ai_reply: fullReply.slice(0, 2000),
        status: 'sent',
      });

      results.push({ id: msg.id, status: 'sent', to: customerEmail });
    } catch (err) {
      console.error('[email-autoresponder] Error processing message:', msg.id, err.message);
      results.push({ id: msg.id, status: 'error', error: err.message });
    }
  }

  return { processed: results.length, results };
}

// ===========================================================================
// API Routes
// ===========================================================================

// GET /settings - 設定を取得
router.get('/settings', async (_req, res) => {
  try {
    const settings = await getSettings();
    return res.json(settings);
  } catch (err) {
    console.error('GET /email-auto-reply/settings error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// PUT /settings - 設定を更新
router.put('/settings', async (req, res) => {
  try {
    const { enabled, gmail_query, max_emails_per_run, reply_prefix, reply_suffix } = req.body;

    const { data: existing } = await supabase
      .from('email_auto_reply_settings')
      .select('id')
      .limit(1)
      .maybeSingle();

    const payload = { updated_at: new Date().toISOString() };
    if (enabled !== undefined) payload.enabled = enabled;
    if (gmail_query !== undefined) payload.gmail_query = gmail_query;
    if (max_emails_per_run !== undefined) payload.max_emails_per_run = max_emails_per_run;
    if (reply_prefix !== undefined) payload.reply_prefix = reply_prefix;
    if (reply_suffix !== undefined) payload.reply_suffix = reply_suffix;

    let result;
    if (existing) {
      const { data, error } = await supabase
        .from('email_auto_reply_settings')
        .update(payload)
        .eq('id', existing.id)
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      result = data;
    } else {
      const { data, error } = await supabase
        .from('email_auto_reply_settings')
        .insert({ ...payload, enabled: enabled ?? false, gmail_query: gmail_query || 'from:noreply@shopify.com is:unread' })
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      result = data;
    }

    return res.json(result);
  } catch (err) {
    console.error('PUT /email-auto-reply/settings error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /trigger - 手動で自動返信を実行
router.post('/trigger', async (_req, res) => {
  try {
    const result = await processEmails();
    return res.json(result);
  } catch (err) {
    console.error('POST /email-auto-reply/trigger error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /cron - Vercel Cron用エンドポイント
router.get('/cron', async (_req, res) => {
  try {
    const result = await processEmails();
    return res.json(result);
  } catch (err) {
    console.error('GET /email-auto-reply/cron error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /logs - 処理ログを取得
router.get('/logs', async (req, res) => {
  try {
    const { page = '1', pageSize = '20', status } = req.query;
    const currentPage = Math.max(1, parseInt(page, 10) || 1);
    const size = Math.min(100, parseInt(pageSize, 10) || 20);
    const from = (currentPage - 1) * size;
    const to = from + size - 1;

    let query = supabase
      .from('email_auto_reply_logs')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error, count } = await query;
    if (error) return res.status(500).json({ error: error.message });

    return res.json({
      data: data || [],
      pagination: {
        page: currentPage,
        pageSize: size,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / size),
      },
    });
  } catch (err) {
    console.error('GET /email-auto-reply/logs error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /logs/:id - ログを削除
router.delete('/logs/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('email_auto_reply_logs')
      .delete()
      .eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /email-auto-reply/logs/:id error:', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;

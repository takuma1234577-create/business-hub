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
const { generateFITPEAKReply, embedText } = require('./fitpeak-rag.cjs');
const { notifyLineAboutEmail } = require('./cross-channel-notify.cjs');

// ── メール内容をナレッジベースに同期 ──
async function syncEmailToKnowledge({ gmailMessageId, customerEmail, subject, customerMessage, aiReply }) {
  try {
    if (!customerMessage || !aiReply) return;
    const content = `質問: ${customerMessage}\n\n回答: ${aiReply}`;
    const title = (subject || 'Email inquiry').slice(0, 200);
    const embedding = await embedText(content, 'document');

    await supabase.from('knowledge_chunks').upsert({
      source: 'shopify_email',
      source_id: gmailMessageId,
      category: 'message',
      title,
      content,
      metadata: {
        customer_email: customerEmail || null,
        subject: subject || null,
        synced_from: 'email_auto_reply',
      },
      embedding,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'source,source_id' });
    console.log(`[email→knowledge] synced: ${gmailMessageId}`);
  } catch (err) {
    console.error('[email→knowledge] sync failed:', err.message);
  }
}

const router = express.Router();
const supabase = new Proxy({}, { get: (_, prop) => getSupabase()[prop] });

// ── 販売チャネルに紐づくGmailトークンIDを取得 ──
async function getChannelGmailTokenId() {
  // Shopifyチャネルに紐づくgmail_token_idを探す
  const { data: store } = await supabase
    .from('channel_stores')
    .select('gmail_token_id')
    .not('gmail_token_id', 'is', null)
    .limit(1)
    .maybeSingle();
  if (!store?.gmail_token_id) {
    throw new Error('Gmail未連携。API設定 → 販売チャネル連携からGmailを認証してください。');
  }
  return store.gmail_token_id;
}

// ── Gmail クライアント取得（販売チャネルのトークンを使用）──
async function getGmailClient() {
  const oauth2Client = getGoogleOAuth2();
  if (!oauth2Client) throw new Error('Google OAuth未設定');

  const tokenId = await getChannelGmailTokenId();
  const { data: tokenData, error: tokenErr } = await supabase
    .from('oauth_tokens')
    .select('*')
    .eq('id', tokenId)
    .single();
  if (tokenErr || !tokenData) throw new Error('Gmail未認証。API設定 → 販売チャネル連携からGmailを認証してください。');

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
    await supabase.from('oauth_tokens').update(updates).eq('id', tokenId);
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
  // Shopifyの問い合わせフォーム: 構造化されたフィールドを抽出
  // フォーマット例:
  //   名前:\n木下拓郎\n\nメール:\nxxx@gmail.com\n\nコメント:\nメッセージ本文
  const shopifyMatch = body.match(
    /名前[:\s：]\s*\n?(.+?)(?:\n\n|\n).*?(?:メール|Email)[:\s：]\s*\n?(.+?)(?:\n\n|\n).*?(?:コメント|Comment|メッセージ|Message)[:\s：]\s*\n?([\s\S]+?)$/im
  );

  if (shopifyMatch) {
    const name = shopifyMatch[1].trim();
    const email = shopifyMatch[2].trim();
    const comment = shopifyMatch[3]
      .replace(/--\s*\n[\s\S]*$/m, '')
      .replace(/\*この(メール|email)[\s\S]*/i, '')
      .trim();
    return `お客様名: ${name}\nメール: ${email}\n\nお問い合わせ内容:\n${comment}`;
  }

  // 一般的なパターン
  let message = body;
  const patterns = [
    /(?:メッセージ|Message|Body|本文|内容|コメント|Comment)[:\s：]\s*([\s\S]+?)(?:\n\n---|\n\n--|$)/i,
    /(?:お問い合わせ内容|inquiry|question)[:\s：]\s*([\s\S]+?)(?:\n\n---|\n\n--|$)/i,
  ];

  for (const pat of patterns) {
    const match = body.match(pat);
    if (match?.[1]?.trim()) {
      message = match[1].trim();
      break;
    }
  }

  // フッター除去
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
      mode: 'draft',
      gmail_query: 'from:noreply@shopify.com is:unread',
      max_emails_per_run: 10,
      reply_prefix: '',
      reply_suffix: '\n\n---\nFITPEAK カスタマーサポート',
    };
  }
  return data;
}

// ── DBからAnthropicキーを最新に更新 ──
async function refreshAnthropicKey() {
  try {
    const { data } = await supabase
      .from('api_keys')
      .select('api_key_encrypted')
      .eq('id', 'anthropic')
      .eq('is_active', true)
      .maybeSingle();
    if (!data) return;
    const crypto = require('crypto');
    const secret = process.env.BANK_CREDENTIAL_ENCRYPTION_KEY || process.env.SUPABASE_ANON_KEY || 'default-key';
    const key = crypto.scryptSync(secret, 'api-keys-salt', 32);
    const { iv, data: enc, tag } = JSON.parse(data.api_key_encrypted);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    let decrypted = decipher.update(enc, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    process.env.ANTHROPIC_API_KEY = decrypted;
  } catch (err) {
    console.error('[email-autoresponder] refreshAnthropicKey error:', err.message);
  }
}

// ── Cron / 手動トリガー: 未読メールを処理して自動返信 ──
async function processEmails() {
  const settings = await getSettings();
  if (!settings.enabled) {
    return { skipped: true, reason: 'Email auto-reply is disabled' };
  }

  // DBから最新のAPIキーをロード（環境変数の古いキーを上書き）
  await refreshAnthropicKey();

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
        aiReply = await generateFITPEAKReply(customerMessage, { channel: 'Email', customerName: customerEmail, email: customerEmail });
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

      // Gmail返信メールを構成
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

      const mode = settings.mode || 'draft'; // 'draft' or 'send'
      let resultStatus;

      if (mode === 'send') {
        // 直接送信
        await gmail.users.messages.send({
          userId: 'me',
          requestBody: { raw: rawEmail, threadId },
        });
        resultStatus = 'sent';
      } else {
        // 下書きとして保存
        await gmail.users.drafts.create({
          userId: 'me',
          requestBody: {
            message: { raw: rawEmail, threadId },
          },
        });
        resultStatus = 'draft';
      }

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
        status: resultStatus,
      });

      // ナレッジベースに同期（非同期・失敗してもメイン処理は続行）
      syncEmailToKnowledge({
        gmailMessageId: msg.id,
        customerEmail,
        subject,
        customerMessage,
        aiReply: fullReply,
      }).catch(() => {});

      // メールで対応した旨をLINEに通知（同一顧客がLINEにもいる場合）
      const customerNameMatch = customerMessage.match(/お客様名[:：]\s*(.+)/);
      const custName = customerNameMatch ? customerNameMatch[1].trim() : '';
      notifyLineAboutEmail(customerEmail, custName).catch(() => {});

      results.push({ id: msg.id, status: resultStatus, to: customerEmail });
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

// POST /preview - Gmailを検索してマッチするメールをプレビュー（処理はしない）
router.post('/preview', async (req, res) => {
  try {
    const { query } = req.body;
    const gmail = await getGmailClient();
    const searchQuery = query || 'is:unread';

    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: searchQuery,
      maxResults: 10,
    });

    const messages = listRes.data.messages || [];
    if (messages.length === 0) {
      return res.json({ query: searchQuery, count: 0, emails: [] });
    }

    const emails = [];
    for (const msg of messages.slice(0, 10)) {
      try {
        const detail = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'full',
        });
        const subject = getHeader(detail.data, 'Subject');
        const from = getHeader(detail.data, 'From');
        const date = getHeader(detail.data, 'Date');
        const body = extractEmailBody(detail.data);
        emails.push({
          id: msg.id,
          subject,
          from,
          date,
          snippet: body.slice(0, 300),
          customerEmail: getCustomerEmail(detail.data),
        });
      } catch (err) {
        emails.push({ id: msg.id, error: err.message });
      }
    }

    return res.json({ query: searchQuery, count: listRes.data.resultSizeEstimate || messages.length, emails });
  } catch (err) {
    console.error('POST /email-auto-reply/preview error:', err);
    return res.status(500).json({ error: err.message });
  }
});

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
    const { enabled, mode, gmail_query, max_emails_per_run, reply_prefix, reply_suffix } = req.body;

    const { data: existing } = await supabase
      .from('email_auto_reply_settings')
      .select('id')
      .limit(1)
      .maybeSingle();

    const payload = { updated_at: new Date().toISOString() };
    if (enabled !== undefined) payload.enabled = enabled;
    if (mode !== undefined) payload.mode = mode;
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

// POST /sync-knowledge - 既存ログを一括でナレッジベースに同期
router.post('/sync-knowledge', async (_req, res) => {
  try {
    // 成功したログのみ対象
    const { data: logs, error } = await supabase
      .from('email_auto_reply_logs')
      .select('gmail_message_id, customer_email, subject, customer_message, ai_reply')
      .in('status', ['sent', 'draft'])
      .not('ai_reply', 'is', null)
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) return res.status(500).json({ error: error.message });

    let synced = 0, failed = 0;
    for (const log of (logs || [])) {
      try {
        await syncEmailToKnowledge({
          gmailMessageId: log.gmail_message_id,
          customerEmail: log.customer_email,
          subject: log.subject,
          customerMessage: log.customer_message,
          aiReply: log.ai_reply,
        });
        synced++;
        // Voyage APIレート制限対策
        await new Promise(r => setTimeout(r, 22000));
      } catch { failed++; }
    }
    return res.json({ total: logs?.length || 0, synced, failed });
  } catch (err) {
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

// POST /compose/ai - AIでメール本文を生成
router.post('/compose/ai', async (req, res) => {
  try {
    const { to, subject, context, tone } = req.body;
    if (!context) return res.status(400).json({ error: 'メールの内容・目的を入力してください' });

    await refreshAnthropicKey();
    const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const toneMap = {
      formal: '丁寧でフォーマルなビジネス敬語',
      friendly: '丁寧だが親しみやすいビジネス調',
      casual: 'カジュアルで親しみやすい口調',
    };
    const toneDesc = toneMap[tone] || toneMap.formal;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: `あなたはFITPEAKのカスタマーサポート担当です。以下のルールでメールを作成してください：
- 文体: ${toneDesc}
- 署名は含めない（別途追加されます）
- 件名と本文をJSON形式で返す: { "subject": "件名", "body": "本文" }
- 件名が既に指定されている場合はそれを使用
- メール本文のみを出力。余計な説明は不要`,
      messages: [{
        role: 'user',
        content: `宛先: ${to || '未指定'}\n${subject ? `件名: ${subject}\n` : ''}目的・内容:\n${context}`,
      }],
    });

    const text = response.content.filter(c => c.type === 'text').map(c => c.text).join('');
    const jsonMatch = text.match(/\{[\s\S]*"subject"[\s\S]*"body"[\s\S]*\}/);
    if (!jsonMatch) {
      return res.json({ subject: subject || '', body: text });
    }
    const parsed = JSON.parse(jsonMatch[0]);
    res.json({ subject: parsed.subject || subject || '', body: parsed.body });
  } catch (err) {
    console.error('POST /compose/ai error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /compose/send - メールを作成して送信 or 下書き保存
router.post('/compose/send', async (req, res) => {
  try {
    const { to, subject, body, mode } = req.body;
    if (!to || !subject || !body) {
      return res.status(400).json({ error: '宛先、件名、本文を入力してください' });
    }

    const gmail = await getGmailClient();

    const emailLines = [
      `To: ${to}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      body,
    ];
    const rawEmail = Buffer.from(emailLines.join('\r\n')).toString('base64url');

    let resultStatus;
    if (mode === 'send') {
      await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw: rawEmail },
      });
      resultStatus = 'sent';
    } else {
      await gmail.users.drafts.create({
        userId: 'me',
        requestBody: { message: { raw: rawEmail } },
      });
      resultStatus = 'draft';
    }

    // ログに記録
    await supabase.from('email_auto_reply_logs').insert({
      gmail_message_id: `compose_${Date.now()}`,
      customer_email: to,
      subject,
      customer_message: '（手動作成メール）',
      ai_reply: body,
      status: resultStatus,
    });

    res.json({ status: resultStatus, to, subject });
  } catch (err) {
    console.error('POST /compose/send error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

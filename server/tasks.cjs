/**
 * Task Manager (AI Secretary) - Consolidated Backend Routes
 *
 * All routes from the original Todolist_tool backend consolidated into
 * a single CommonJS Express Router for the unified business-hub server.
 *
 * Mounted at '/api/tasks' by the main server.
 *
 * Routes:
 *   Tasks:     GET /, POST /, PUT /:id, PATCH /:id/status, DELETE /:id, POST /generate-daily
 *   Customers: GET /customers, GET /customers/:id, POST /customers, PUT /customers/:id
 *   Meetings:  GET /meetings, GET /meetings/customer/:customerId, POST /meetings/import/text, POST /meetings/import/file
 *   Emails:    GET /emails, POST /emails/fetch, GET /emails/auth/status, GET /emails/auth, GET /emails/auth/callback
 *   Chatwork:  GET /chatwork/rooms, POST /chatwork/fetch, GET /chatwork/rooms/:roomId/messages
 *   Health:    GET /health
 */

const { Router } = require('express');
const { getSupabase, getGoogleOAuth2, getChatworkHeaders, getChatworkToken, getAnthropicClient, google } = require('./shared.cjs');
const axios = require('axios');
const multer = require('multer');
const path = require('path');
const os = require('os');
const fs = require('fs');

const router = Router();

// ============================================================
// Supabase Client (delegated to shared.cjs)
// ============================================================
// getSupabase() is imported from ./shared.cjs

// ============================================================
// Claude AI Service
// ============================================================

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

function getClaudeClient() {
  return getAnthropicClient();
}

async function extractTasksFromMessages(context) {
  const client = getClaudeClient();

  const chatworkText = context.chatworkMessages.map(room => {
    const msgs = room.messages.map(m => {
      const time = new Date(m.send_time * 1000).toLocaleString('ja-JP');
      const role = m.is_self ? '[自分]' : `[${m.account_name}]`;
      return `  ${time} ${role}: ${m.body}`;
    }).join('\n');
    return `【${room.room_name}（${room.customer_name || '不明'}）】\n${msgs}`;
  }).join('\n\n');

  const pendingText = context.pendingTasks.map(t =>
    `- ${t.title}${t.customer_name ? `（${t.customer_name}）` : ''}: ${t.description || ''}`
  ).join('\n');

  const actionText = context.meetingActionItems.map(t =>
    `- ${t.title}${t.customer_name ? `（${t.customer_name}）` : ''}: ${t.content}`
  ).join('\n');

  const prompt = `あなたはAmazonコンサルタントの優秀な秘書です。
以下の情報を元に、今日対応すべきタスクリストを作成してください。

## Chatworkメッセージ（直近48時間）
${chatworkText || 'メッセージなし'}

## 未完了タスク
${pendingText || 'なし'}

## 議事録のアクションアイテム
${actionText || 'なし'}

## 出力形式
以下のJSON形式で出力してください（マークダウンコードブロックなし）：
[
  {
    "title": "タスクのタイトル（簡潔に）",
    "description": "詳細説明（なぜ必要か、何をすべきか）",
    "priority": "high/medium/low",
    "customer_name": "顧客名または null",
    "source": "chatwork/meeting/pending/manual",
    "due_hint": "今日/今週/緊急 など（任意）"
  }
]

優先度の基準：
- high（🔴）: 今日中に対応が必要、クレーム、緊急依頼
- medium（🟡）: 今週中に対応、通常の依頼
- low（🟢）: いつかやる、情報確認系

重複するタスクは統合してください。`;

  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('Task extraction JSON parse error:', err);
    console.error('Response:', text);
    return [];
  }
}

async function analyzeEmails(emails) {
  if (emails.length === 0) return [];
  const client = getClaudeClient();

  const emailText = emails.map((e, i) => `
【メール${i + 1}】ID: ${e.gmail_id}
送信者: ${e.from_name || ''} <${e.from_address || ''}>
件名: ${e.subject || '（件名なし）'}
本文: ${(e.body_snippet || '').substring(0, 500)}
`).join('\n');

  const prompt = `以下のメールを分析して、各メールに重要度・カテゴリ・要約・推奨アクションを付与してください。

${emailText}

## 出力形式（JSONのみ、コードブロックなし）
[
  {
    "gmail_id": "メールID",
    "importance": "high/medium/low",
    "category": "コンサル/FITPEAK/アプリ開発/法務・税務/その他",
    "summary": "1〜2行の要約",
    "recommended_action": "推奨アクション（返信が必要、確認のみ、対応不要 など）"
  }
]

重要度の基準：
- high: 即対応が必要、クレーム、契約・法務関連
- medium: 通常の業務連絡、要返信
- low: 情報提供、ニュースレター、FYI系`;

  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('Email analysis JSON parse error:', err);
    return [];
  }
}

async function analyzeMeetingNote(content, customerName) {
  const client = getClaudeClient();

  const prompt = `以下の議事録を分析して、サマリーとアクションアイテムを抽出してください。
${customerName ? `\n顧客名: ${customerName}` : ''}

## 議事録
${content}

## 出力形式（JSONのみ、コードブロックなし）
{
  "summary": "議事録の要点を3〜5行でまとめたもの",
  "action_items": [
    {
      "title": "アクションアイテムのタイトル",
      "description": "詳細と背景",
      "priority": "high/medium/low",
      "due_hint": "期限のヒント（任意）"
    }
  ]
}`;

  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { summary: '', action_items: [] };
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('Meeting analysis JSON parse error:', err);
    return { summary: text, action_items: [] };
  }
}

async function analyzeImage(imagePath, mimeType) {
  const client = getClaudeClient();
  const imageData = fs.readFileSync(imagePath);
  const base64 = imageData.toString('base64');

  const validMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  const safeMimeType = validMimeTypes.includes(mimeType) ? mimeType : 'image/jpeg';

  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: safeMimeType,
            data: base64,
          },
        },
        {
          type: 'text',
          text: '画像内のテキストをすべて読み取ってください（OCR）。その後、画像の内容を日本語で要約してください。\n\n出力形式（JSONのみ）:\n{"ocr_text": "読み取ったテキスト", "summary": "内容の要約"}',
        },
      ],
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { ocr_text: '', summary: text };
    return JSON.parse(jsonMatch[0]);
  } catch {
    return { ocr_text: '', summary: text };
  }
}

async function generateDailyTaskSummary(tasks) {
  const client = getClaudeClient();

  const taskList = tasks.map((t, i) => {
    const priority = t.priority === 'high' ? '🔴' : t.priority === 'medium' ? '🟡' : '🟢';
    return `${i + 1}. ${priority} ${t.title}${t.customer_name ? `（${t.customer_name}）` : ''}\n   ${t.description || ''}${t.due_hint ? `\n   期限: ${t.due_hint}` : ''}`;
  }).join('\n\n');

  const today = new Date().toLocaleDateString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
  });

  const prompt = `${today}の今日のタスクリストです。全体のサマリーと今日の重点事項を3〜5行でまとめてください。

${taskList}

日本語で、秘書としてのアドバイスを含めて書いてください。`;

  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].type === 'text' ? response.content[0].text : '';
}

// ============================================================
// File Parser Service
// ============================================================

function getFileType(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext)) return 'image';
  if (ext === '.pdf') return 'pdf';
  if (['.txt', '.md', '.csv'].includes(ext)) return 'text';
  if (['.mp4', '.mov', '.avi', '.mkv', '.wmv'].includes(ext)) return 'video';
  return 'unknown';
}

function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

async function extractPdfText(filePath) {
  try {
    const pdfParse = require('pdf-parse');
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    return data.text || '';
  } catch (err) {
    console.error('PDF parse error:', err);
    throw new Error('Failed to read PDF');
  }
}

async function parseFile(filePath, filename) {
  const fileType = getFileType(filename);

  switch (fileType) {
    case 'image': {
      const mimeType = getMimeType(filename);
      const result = await analyzeImage(filePath, mimeType);
      return {
        content: result.ocr_text,
        ocr_text: result.ocr_text,
        summary: result.summary,
        file_type: 'image',
      };
    }
    case 'pdf': {
      const text = await extractPdfText(filePath);
      return { content: text, file_type: 'pdf' };
    }
    case 'text': {
      const text = fs.readFileSync(filePath, 'utf-8');
      return { content: text, file_type: 'text' };
    }
    case 'video': {
      return {
        content: `動画ファイル: ${filename}（手動メモが必要です）`,
        file_type: 'video',
        summary: `動画ファイル「${filename}」が添付されました。内容は手動でメモを追加してください。`,
      };
    }
    default:
      return {
        content: '',
        file_type: 'unknown',
        summary: 'サポートされていないファイル形式です',
      };
  }
}

// ============================================================
// Chatwork Service
// ============================================================

const CHATWORK_BASE_URL = 'https://api.chatwork.com/v2';

// getChatworkHeaders() is imported from ./shared.cjs

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getChatworkRooms() {
  try {
    const response = await axios.get(`${CHATWORK_BASE_URL}/rooms`, {
      headers: getChatworkHeaders(),
    });
    return response.data;
  } catch (error) {
    console.error('Chatwork rooms fetch error:', error.message);
    throw new Error(`Chatwork rooms fetch failed: ${error.message}`);
  }
}

async function getChatworkMyProfile() {
  try {
    const response = await axios.get(`${CHATWORK_BASE_URL}/me`, {
      headers: getChatworkHeaders(),
    });
    return response.data;
  } catch (error) {
    console.error('Profile fetch error:', error.message);
    throw error;
  }
}

async function getChatworkRecentMessages(roomId) {
  try {
    await sleep(300);
    const response = await axios.get(`${CHATWORK_BASE_URL}/rooms/${roomId}/messages`, {
      headers: getChatworkHeaders(),
      params: { force: 1 },
    });
    return response.data || [];
  } catch (error) {
    if (error.response && error.response.status === 204) return [];
    console.error(`Room ${roomId} message fetch error:`, error.message);
    return [];
  }
}

async function fetchAndSaveAllChatworkMessages() {
  const [rooms, myProfile] = await Promise.all([
    getChatworkRooms(),
    getChatworkMyProfile(),
  ]);

  const myAccountId = myProfile.account_id;
  const now = Math.floor(Date.now() / 1000);
  const since48h = now - 48 * 60 * 60;
  let totalMessages = 0;

  for (const room of rooms) {
    try {
      if (room.unread_num === 0 && room.last_update_time < since48h) {
        continue;
      }

      const messages = await getChatworkRecentMessages(room.room_id);
      const recentMessages = messages.filter(m => m.send_time >= since48h);

      if (recentMessages.length > 0) {
        await dbSaveChatworkMessages(
          recentMessages.map(m => ({
            room_id: String(room.room_id),
            message_id: m.message_id,
            account_id: String(m.account.account_id),
            account_name: m.account.name,
            body: m.body,
            send_time: m.send_time,
            is_self: m.account.account_id === myAccountId,
          }))
        );
        totalMessages += recentMessages.length;
      }

      await sleep(500);
    } catch (err) {
      console.error(`Room ${room.room_id} processing error:`, err);
    }
  }

  console.log(`Chatwork: ${rooms.length} rooms, ${totalMessages} messages fetched`);
  return { rooms, totalMessages, myAccountId };
}

async function getChatworkCachedMessages(roomId) {
  const since48h = Math.floor(Date.now() / 1000) - 48 * 60 * 60;
  return dbGetChatworkMessagesByRoom(roomId, since48h);
}

// ============================================================
// Gmail Service
// ============================================================

const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

function getGmailOAuthClient() {
  const redirectUri = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}/api/tasks/emails/auth/callback`
    : `http://localhost:${process.env.PORT || 3001}/api/tasks/emails/auth/callback`;

  const client = getGoogleOAuth2(redirectUri);
  if (!client) {
    throw new Error(
      'Gmail credentials not configured. ' +
      'Set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET env vars.'
    );
  }
  return client;
}

function getGmailAuthUrl() {
  const oAuth2Client = getGmailOAuthClient();
  return oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: GMAIL_SCOPES,
  });
}

async function saveGmailToken(code) {
  const oAuth2Client = getGmailOAuthClient();
  const { tokens } = await oAuth2Client.getToken(code);
  await dbSetSetting('gmail_token', JSON.stringify(tokens));
  console.log('Gmail token saved');
}

async function isGmailAuthenticated() {
  try {
    const token = await dbGetSetting('gmail_token');
    return !!token;
  } catch {
    return false;
  }
}

async function getGmailAuthenticatedClient() {
  const oAuth2Client = getGmailOAuthClient();

  const tokenJson = await dbGetSetting('gmail_token');
  if (!tokenJson) {
    throw new Error('Gmail authentication required. Visit /api/tasks/emails/auth');
  }

  const token = JSON.parse(tokenJson);
  oAuth2Client.setCredentials(token);

  oAuth2Client.on('tokens', async (tokens) => {
    if (tokens.refresh_token) {
      const existing = JSON.parse(tokenJson);
      await dbSetSetting('gmail_token', JSON.stringify({ ...existing, ...tokens }));
    }
  });

  return oAuth2Client;
}

function parseFromHeader(from) {
  const match = from.match(/^(.+?)\s*<(.+)>$/);
  if (match) return { name: match[1].trim().replace(/^"|"$/g, ''), email: match[2] };
  return { name: from, email: from };
}

function getEmailBody(payload) {
  if (!payload) return '';

  if (payload.body && payload.body.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body && part.body.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf-8');
      }
    }
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body && part.body.data) {
        const html = Buffer.from(part.body.data, 'base64').toString('utf-8');
        return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      }
    }
  }

  return '';
}

async function fetchRecentEmails(maxResults) {
  maxResults = maxResults || 50;
  const auth = await getGmailAuthenticatedClient();
  const gmail = google.gmail({ version: 'v1', auth });

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const query = `after:${Math.floor(since.getTime() / 1000)} -from:noreply -from:no-reply`;

  const listResponse = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults,
  });

  const messageIds = listResponse.data.messages || [];
  const messages = [];

  for (const { id } of messageIds) {
    if (!id) continue;
    try {
      const msg = await gmail.users.messages.get({
        userId: 'me',
        id,
        format: 'full',
      });

      const headers = msg.data.payload ? msg.data.payload.headers || [] : [];
      const getHeader = (name) =>
        (headers.find(h => h.name && h.name.toLowerCase() === name.toLowerCase()) || {}).value || '';

      const from = getHeader('from');
      const { name: fromName, email: fromEmail } = parseFromHeader(from);
      const subject = getHeader('subject');
      const date = getHeader('date');

      messages.push({
        id,
        threadId: msg.data.threadId || '',
        from: fromEmail,
        fromName,
        subject,
        snippet: msg.data.snippet || '',
        body: getEmailBody(msg.data.payload),
        receivedAt: date,
      });
    } catch (err) {
      console.error(`Message ${id} fetch error:`, err);
    }
  }

  return messages;
}

async function fetchAndSaveGmailEmails() {
  const emails = await fetchRecentEmails();

  await dbSaveGmailMessages(
    emails.map(e => ({
      gmail_id: e.id,
      thread_id: e.threadId,
      from_address: e.from,
      from_name: e.fromName,
      subject: e.subject,
      body_snippet: e.snippet,
      body_full: e.body.substring(0, 5000),
      received_at: e.receivedAt,
    }))
  );

  console.log(`Gmail: ${emails.length} emails fetched`);
  return { count: emails.length };
}

// ============================================================
// Database Queries (inlined from db/queries.ts)
// ============================================================

const priorityOrder = { high: 1, medium: 2, low: 3 };
const statusOrder = { pending: 1, in_progress: 2, done: 3 };

// ----- Customers -----

async function dbGetAllCustomers() {
  const { data, error } = await getSupabase()
    .from('customers').select('*').order('name');
  if (error) throw error;
  return data || [];
}

async function dbGetCustomerById(id) {
  const { data, error } = await getSupabase()
    .from('customers').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

async function dbCreateCustomer(input) {
  const { data, error } = await getSupabase()
    .from('customers')
    .insert(input)
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function dbUpdateCustomer(id, input) {
  const filtered = Object.fromEntries(
    Object.entries(input).filter(([_, v]) => v !== undefined)
  );
  if (Object.keys(filtered).length === 0) return;
  const { error } = await getSupabase()
    .from('customers')
    .update({ ...filtered, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

// ----- Tasks -----

async function dbGetAllTasks(status) {
  let query = getSupabase()
    .from('tasks')
    .select('*, customers(name)');

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data || []).map(row => ({
    ...row,
    customer_name: row.customers ? row.customers.name : null,
    customers: undefined,
  }));

  rows.sort((a, b) => {
    if (status) {
      return (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3) ||
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
    return (statusOrder[a.status] || 3) - (statusOrder[b.status] || 3) ||
      (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3) ||
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return rows;
}

async function dbGetTasksByCustomer(customerId) {
  const { data, error } = await getSupabase()
    .from('tasks')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function dbCreateTask(input) {
  const { data, error } = await getSupabase()
    .from('tasks')
    .insert({
      customer_id: input.customer_id != null ? input.customer_id : null,
      title: input.title,
      description: input.description != null ? input.description : null,
      source: input.source || 'manual',
      source_ref: input.source_ref != null ? input.source_ref : null,
      priority: input.priority || 'medium',
      due_date: input.due_date != null ? input.due_date : null,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function dbUpdateTaskStatus(id, status) {
  const update = {
    status,
    updated_at: new Date().toISOString(),
    completed_at: status === 'done' ? new Date().toISOString() : null,
  };
  const { error } = await getSupabase()
    .from('tasks')
    .update(update)
    .eq('id', id);
  if (error) throw error;
}

async function dbUpdateTask(id, input) {
  const filtered = Object.fromEntries(
    Object.entries(input).filter(([_, v]) => v !== undefined)
  );
  if (Object.keys(filtered).length === 0) return;
  const { error } = await getSupabase()
    .from('tasks')
    .update({ ...filtered, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

async function dbDeleteTask(id) {
  const { error } = await getSupabase()
    .from('tasks')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

// ----- Meeting Notes -----

async function dbGetAllMeetingNotes() {
  const { data, error } = await getSupabase()
    .from('meeting_notes')
    .select('*, customers(name)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(row => ({
    ...row,
    customer_name: row.customers ? row.customers.name : null,
    customers: undefined,
  }));
}

async function dbGetMeetingNotesByCustomer(customerId) {
  const { data, error } = await getSupabase()
    .from('meeting_notes')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function dbCreateMeetingNote(input) {
  const { data, error } = await getSupabase()
    .from('meeting_notes')
    .insert({
      customer_id: input.customer_id != null ? input.customer_id : null,
      title: input.title,
      content: input.content,
      meeting_date: input.meeting_date != null ? input.meeting_date : null,
      file_path: input.file_path != null ? input.file_path : null,
      file_type: input.file_type != null ? input.file_type : null,
      action_items: input.action_items != null ? input.action_items : null,
      summary: input.summary != null ? input.summary : null,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

// ----- Chatwork Messages -----

async function dbSaveChatworkMessages(messages) {
  const rows = messages.map(msg => ({
    ...msg,
    is_self: msg.is_self ? 1 : 0,
  }));
  const { error } = await getSupabase()
    .from('chatwork_messages')
    .upsert(rows, { onConflict: 'message_id' });
  if (error) throw error;
}

async function dbGetChatworkMessagesByRoom(roomId, since) {
  let query = getSupabase()
    .from('chatwork_messages')
    .select('*')
    .eq('room_id', roomId);

  if (since) {
    query = query.gte('send_time', since).order('send_time', { ascending: true });
  } else {
    query = query.order('send_time', { ascending: false }).limit(100);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

// ----- Gmail Messages -----

async function dbSaveGmailMessages(messages) {
  const rows = messages.map(msg => ({
    gmail_id: msg.gmail_id,
    thread_id: msg.thread_id != null ? msg.thread_id : null,
    from_address: msg.from_address != null ? msg.from_address : null,
    from_name: msg.from_name != null ? msg.from_name : null,
    subject: msg.subject != null ? msg.subject : null,
    body_snippet: msg.body_snippet != null ? msg.body_snippet : null,
    body_full: msg.body_full != null ? msg.body_full : null,
    received_at: msg.received_at != null ? msg.received_at : null,
    importance: msg.importance != null ? msg.importance : null,
    category: msg.category != null ? msg.category : null,
    summary: msg.summary != null ? msg.summary : null,
    recommended_action: msg.recommended_action != null ? msg.recommended_action : null,
  }));
  const { error } = await getSupabase()
    .from('gmail_messages')
    .upsert(rows, { onConflict: 'gmail_id' });
  if (error) throw error;
}

async function dbUpdateGmailAnalysis(gmail_id, input) {
  const filtered = Object.fromEntries(
    Object.entries(input).filter(([_, v]) => v !== undefined)
  );
  if (Object.keys(filtered).length === 0) return;
  const { error } = await getSupabase()
    .from('gmail_messages')
    .update(filtered)
    .eq('gmail_id', gmail_id);
  if (error) throw error;
}

async function dbGetGmailMessages(limit) {
  limit = limit || 50;
  const { data, error } = await getSupabase()
    .from('gmail_messages')
    .select('*')
    .order('received_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// ----- Daily Reports -----

async function dbSaveDailyReport(date, tasks, summary) {
  const { error } = await getSupabase()
    .from('daily_reports')
    .upsert({
      report_date: date,
      generated_tasks: JSON.stringify(tasks),
      summary,
    }, { onConflict: 'report_date' });
  if (error) throw error;
}

async function dbGetDailyReport(date) {
  const { data, error } = await getSupabase()
    .from('daily_reports')
    .select('*')
    .eq('report_date', date)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ----- Attachments -----

async function dbCreateAttachment(input) {
  const { data, error } = await getSupabase()
    .from('attachments')
    .insert({
      meeting_note_id: input.meeting_note_id != null ? input.meeting_note_id : null,
      task_id: input.task_id != null ? input.task_id : null,
      file_name: input.file_name,
      file_path: input.file_path,
      file_type: input.file_type != null ? input.file_type : null,
      file_size: input.file_size != null ? input.file_size : null,
      ocr_text: input.ocr_text != null ? input.ocr_text : null,
      ai_summary: input.ai_summary != null ? input.ai_summary : null,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

// ----- Settings -----

async function dbGetSetting(key) {
  const { data, error } = await getSupabase()
    .from('task_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error) throw error;
  return data ? data.value : null;
}

async function dbSetSetting(key, value) {
  const { error } = await getSupabase()
    .from('task_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
}

// ============================================================
// Multer Setup (file uploads to /tmp)
// ============================================================

const UPLOAD_DIR = path.join(os.tmpdir(), 'task-uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (_, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const allowed = ['.pdf', '.txt', '.md', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.mov'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

// ============================================================
// ROUTES: Health
// ============================================================

router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'task-manager',
    timestamp: new Date().toISOString(),
    env: {
      chatwork: !!process.env.CHATWORK_API_TOKEN,
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      supabase: !!process.env.SUPABASE_URL,
      gmail: !!process.env.GOOGLE_CLIENT_ID,
    },
  });
});

// ============================================================
// ROUTES: Tasks (mounted at / relative to /api/tasks)
// ============================================================

// GET / - List all tasks
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    const tasks = await dbGetAllTasks(status);
    res.json({ success: true, data: tasks });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST / - Create task
router.post('/', async (req, res) => {
  try {
    const { customer_id, title, description, priority, due_date, source } = req.body;
    if (!title) {
      return res.status(400).json({ success: false, error: 'タイトルは必須です' });
    }
    const id = await dbCreateTask({ customer_id, title, description, priority, due_date, source });
    res.json({ success: true, data: { id } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /:id - Update task
router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { title, description, priority, status, due_date, customer_id } = req.body;
    await dbUpdateTask(id, { title, description, priority, status, due_date, customer_id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /:id/status - Update task status
router.patch('/:id/status', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { status } = req.body;
    if (!['pending', 'in_progress', 'done'].includes(status)) {
      return res.status(400).json({ success: false, error: '無効なステータスです' });
    }
    await dbUpdateTaskStatus(id, status);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /:id - Delete task
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await dbDeleteTask(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /generate-daily - Generate daily tasks with AI
router.post('/generate-daily', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const existing = await dbGetDailyReport(today);
    if (existing && !req.body.force) {
      const tasks = existing.generated_tasks ? JSON.parse(existing.generated_tasks) : [];
      return res.json({ success: true, data: { tasks, summary: existing.summary, cached: true } });
    }

    // Fetch Chatwork messages
    console.log('Fetching Chatwork messages...');
    let chatworkData = null;
    try {
      chatworkData = await fetchAndSaveAllChatworkMessages();
    } catch (err) {
      console.error('Chatwork fetch error (skipping):', err);
    }

    // Get customers
    const customers = await dbGetAllCustomers();

    // Organize Chatwork messages by customer
    const chatworkMessages = [];

    if (chatworkData) {
      const since48h = Math.floor(Date.now() / 1000) - 48 * 60 * 60;
      for (const room of chatworkData.rooms) {
        const messages = await dbGetChatworkMessagesByRoom(String(room.room_id), since48h);
        if (messages.length > 0) {
          const customer = customers.find(c => c.chatwork_room_id === String(room.room_id));
          chatworkMessages.push({
            room_name: room.name,
            customer_name: customer ? customer.name : undefined,
            messages: messages.map(m => ({
              account_name: m.account_name,
              body: m.body,
              send_time: m.send_time,
              is_self: m.is_self === 1,
            })),
          });
        }
      }
    }

    // Get pending tasks
    const pendingTasks = await dbGetAllTasks('pending');

    // Get meeting action items
    const meetingNotes = await dbGetAllMeetingNotes();
    const meetingActionItems = meetingNotes
      .filter(n => n.action_items)
      .flatMap(n => {
        try {
          const items = JSON.parse(n.action_items || '[]');
          return items.map(item => ({
            title: item.title || '',
            content: item.description || '',
            customer_name: n.customer_name,
          }));
        } catch {
          return [];
        }
      });

    // Extract tasks with Claude
    console.log('Generating tasks with Claude API...');
    const extractedTasks = await extractTasksFromMessages({
      chatworkMessages,
      pendingTasks,
      meetingActionItems,
    });

    // Generate summary
    const summary = await generateDailyTaskSummary(extractedTasks);

    // Save to DB
    await dbSaveDailyReport(today, extractedTasks, summary);

    // Auto-register high priority tasks
    for (const task of extractedTasks.filter(t => t.priority === 'high')) {
      const customer = customers.find(c => c.name === task.customer_name);
      await dbCreateTask({
        customer_id: customer ? customer.id : undefined,
        title: task.title,
        description: task.description,
        source: task.source || 'ai',
        priority: task.priority,
      });
    }

    res.json({
      success: true,
      data: {
        tasks: extractedTasks,
        summary,
        chatwork_rooms: chatworkData ? chatworkData.rooms.length : 0,
        cached: false,
      },
    });
  } catch (err) {
    console.error('Daily task generation error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// ROUTES: Customers (mounted at /customers relative to /api/tasks)
// ============================================================

// GET /customers - List all customers
router.get('/customers', async (_req, res) => {
  try {
    const customers = await dbGetAllCustomers();
    res.json({ success: true, data: customers });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /customers/:id - Customer detail with tasks and meetings
router.get('/customers/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const customer = await dbGetCustomerById(id);
    if (!customer) {
      return res.status(404).json({ success: false, error: '顧客が見つかりません' });
    }
    const tasks = await dbGetTasksByCustomer(id);
    const meetings = await dbGetMeetingNotesByCustomer(id);
    res.json({ success: true, data: { ...customer, tasks, meetings } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /customers - Create customer
router.post('/customers', async (req, res) => {
  try {
    const { name, chatwork_room_id, business_description, contract_type, notes } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, error: '顧客名は必須です' });
    }
    const id = await dbCreateCustomer({ name, chatwork_room_id, business_description, contract_type, notes });
    res.json({ success: true, data: { id } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /customers/:id - Update customer
router.put('/customers/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, chatwork_room_id, business_description, contract_type, notes } = req.body;
    await dbUpdateCustomer(id, { name, chatwork_room_id, business_description, contract_type, notes });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// ROUTES: Meetings (mounted at /meetings relative to /api/tasks)
// ============================================================

// GET /meetings - List all meeting notes
router.get('/meetings', async (_req, res) => {
  try {
    const notes = await dbGetAllMeetingNotes();
    res.json({ success: true, data: notes });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /meetings/customer/:customerId - Meeting notes by customer
router.get('/meetings/customer/:customerId', async (req, res) => {
  try {
    const notes = await dbGetMeetingNotesByCustomer(parseInt(req.params.customerId));
    res.json({ success: true, data: notes });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /meetings/import/text - Import meeting note from text
router.post('/meetings/import/text', async (req, res) => {
  try {
    const { customer_id, title, content, meeting_date } = req.body;
    if (!content) {
      return res.status(400).json({ success: false, error: '議事録テキストは必須です' });
    }

    const customers = await dbGetAllCustomers();
    const customer = customer_id ? customers.find(c => c.id === parseInt(customer_id)) : undefined;

    console.log('Analyzing meeting note with Claude API...');
    const analysis = await analyzeMeetingNote(content, customer ? customer.name : undefined);

    const id = await dbCreateMeetingNote({
      customer_id: customer ? customer.id : undefined,
      title: title || `議事録 ${new Date().toLocaleDateString('ja-JP')}`,
      content,
      meeting_date,
      action_items: JSON.stringify(analysis.action_items),
      summary: analysis.summary,
    });

    // Register action items as tasks
    for (const item of analysis.action_items) {
      await dbCreateTask({
        customer_id: customer ? customer.id : undefined,
        title: item.title,
        description: item.description,
        source: 'meeting',
        source_ref: String(id),
        priority: item.priority,
      });
    }

    res.json({
      success: true,
      data: {
        id,
        summary: analysis.summary,
        action_items: analysis.action_items,
        tasks_created: analysis.action_items.length,
      },
    });
  } catch (err) {
    console.error('Meeting note import error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /meetings/import/file - Import meeting note from file upload
router.post('/meetings/import/file', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'ファイルが必要です' });
  }

  try {
    const { customer_id, title, meeting_date } = req.body;
    const { filename, originalname, size } = req.file;
    const filePath = path.join(UPLOAD_DIR, filename);

    const customers = await dbGetAllCustomers();
    const customer = customer_id ? customers.find(c => c.id === parseInt(customer_id)) : undefined;

    console.log(`Parsing file: ${originalname}`);
    const parsed = await parseFile(filePath, originalname);

    let analysis = { summary: '', action_items: [] };

    if (parsed.file_type !== 'video' && parsed.content) {
      console.log('Analyzing content with Claude API...');
      analysis = await analyzeMeetingNote(parsed.content, customer ? customer.name : undefined);
    }

    const noteId = await dbCreateMeetingNote({
      customer_id: customer ? customer.id : undefined,
      title: title || `${originalname} （${new Date().toLocaleDateString('ja-JP')}）`,
      content: parsed.content || '',
      meeting_date,
      file_path: filename,
      file_type: parsed.file_type,
      action_items: JSON.stringify(analysis.action_items),
      summary: parsed.summary || analysis.summary,
    });

    // Record attachment
    await dbCreateAttachment({
      meeting_note_id: Number(noteId),
      file_name: originalname,
      file_path: filename,
      file_type: parsed.file_type,
      file_size: size,
      ocr_text: parsed.ocr_text,
      ai_summary: parsed.summary || analysis.summary,
    });

    // Register action items as tasks
    for (const item of analysis.action_items) {
      await dbCreateTask({
        customer_id: customer ? customer.id : undefined,
        title: item.title,
        description: item.description,
        source: 'meeting',
        source_ref: String(noteId),
        priority: item.priority,
      });
    }

    res.json({
      success: true,
      data: {
        id: noteId,
        file_type: parsed.file_type,
        summary: parsed.summary || analysis.summary,
        action_items: analysis.action_items,
        tasks_created: analysis.action_items.length,
      },
    });
  } catch (err) {
    console.error('File upload error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// ROUTES: Emails (mounted at /emails relative to /api/tasks)
// ============================================================

// GET /emails/auth/status - Check Gmail auth status
router.get('/emails/auth/status', async (_req, res) => {
  const authenticated = await isGmailAuthenticated();
  res.json({ success: true, data: { authenticated } });
});

// GET /emails/auth - Get Gmail auth URL
router.get('/emails/auth', (_req, res) => {
  try {
    const authUrl = getGmailAuthUrl();
    res.json({ success: true, data: { auth_url: authUrl } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /emails/auth/callback - Gmail OAuth callback
router.get('/emails/auth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ success: false, error: 'コードが必要です' });
  }
  try {
    await saveGmailToken(code);
    res.send('<html><body><h2>Gmail認証が完了しました。このタブを閉じてください。</h2></body></html>');
  } catch (err) {
    res.status(500).send(`<html><body><h2>認証エラー: ${err.message}</h2></body></html>`);
  }
});

// GET /emails - List emails from cache
router.get('/emails', async (_req, res) => {
  try {
    const emails = await dbGetGmailMessages(50);
    res.json({ success: true, data: emails });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /emails/fetch - Fetch emails + AI analysis
router.post('/emails/fetch', async (req, res) => {
  try {
    const authenticated = await isGmailAuthenticated();
    if (!authenticated) {
      return res.status(401).json({
        success: false,
        error: 'Gmail認証が必要です',
        auth_url: getGmailAuthUrl(),
      });
    }

    console.log('Fetching emails from Gmail...');
    const { count } = await fetchAndSaveGmailEmails();

    let analyzedCount = 0;
    try {
      console.log('Analyzing emails with Claude API...');
      const emails = await dbGetGmailMessages(count);

      const analyses = await analyzeEmails(emails.slice(0, 20));
      analyzedCount = analyses.length;

      for (const a of analyses) {
        await dbUpdateGmailAnalysis(a.gmail_id, {
          importance: a.importance,
          category: a.category,
          summary: a.summary,
          recommended_action: a.recommended_action,
        });
      }
    } catch (aiErr) {
      console.error('Email analysis error (fetch succeeded):', aiErr.message);
    }

    const allEmails = await dbGetGmailMessages(50);
    res.json({
      success: true,
      data: {
        fetched: count,
        analyzed: analyzedCount,
        emails: allEmails,
      },
    });
  } catch (err) {
    console.error('Email fetch error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// ROUTES: Chatwork (mounted at /chatwork relative to /api/tasks)
// ============================================================

// GET /chatwork/rooms - List Chatwork rooms
router.get('/chatwork/rooms', async (_req, res) => {
  try {
    const rooms = await getChatworkRooms();
    res.json({ success: true, data: rooms });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /chatwork/fetch - Fetch and save Chatwork messages
router.post('/chatwork/fetch', async (_req, res) => {
  try {
    const result = await fetchAndSaveAllChatworkMessages();
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /chatwork/rooms/:roomId/messages - Get cached messages for a room
router.get('/chatwork/rooms/:roomId/messages', async (req, res) => {
  try {
    const messages = await getChatworkCachedMessages(req.params.roomId);
    res.json({ success: true, data: messages });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================

module.exports = router;

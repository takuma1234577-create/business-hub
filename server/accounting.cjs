const express = require('express');
const router = express.Router();
const { getSupabase, getGoogleOAuth2, getAnthropicClient, google } = require('./shared.cjs');
const multer = require('multer');
const crypto = require('crypto');

const supabase = new Proxy({}, { get: (_, prop) => getSupabase()[prop] });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// --- Column mapping ---
const SNAKE_MAP = {
  documentType: 'document_type', documentDate: 'document_date', dueDate: 'due_date',
  vendorName: 'vendor_name', vendorAddress: 'vendor_address',
  amountExcludingTax: 'amount_excluding_tax', taxAmount: 'tax_amount',
  amountIncludingTax: 'amount_including_tax', documentNumber: 'document_number',
  accountTitle: 'account_title', aiConfidence: 'ai_confidence', aiRawResponse: 'ai_raw_response',
  originalFilename: 'original_filename', fileHash: 'file_hash',
  googleDriveFileId: 'google_drive_file_id', googleDriveUrl: 'google_drive_url',
  supabaseStoragePath: 'supabase_storage_path',
  sourceEmailId: 'source_email_id', sourceUrl: 'source_url',
  createdAt: 'created_at', updatedAt: 'updated_at',
  sourceType: 'source_type', searchKeywords: 'search_keywords', isActive: 'is_active',
  lastFetchedAt: 'last_fetched_at', sourceId: 'source_id', startedAt: 'started_at',
  completedAt: 'completed_at', documentsFound: 'documents_found',
  documentsSaved: 'documents_saved', documentsSkipped: 'documents_skipped',
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
  for (const [k, v] of Object.entries(obj)) result[CAMEL_MAP[k] || k] = v;
  return result;
};
const toCamelArray = (arr) => (arr || []).map(toCamel);

// =====================
// DOCUMENTS CRUD
// =====================

// GET /documents - 一覧取得
router.get('/documents', async (req, res) => {
  try {
    const { status, type, search, page = '1', limit = '20' } = req.query;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;

    let query = supabase.from('accounting_documents').select('*', { count: 'exact' });

    if (status) query = query.eq('status', status);
    if (type) query = query.eq('document_type', type);
    if (search) query = query.or(`vendor_name.ilike.%${search}%,document_number.ilike.%${search}%,original_filename.ilike.%${search}%`);

    query = query.order('created_at', { ascending: false }).range(from, to);

    const { data, error, count } = await query;
    if (error) throw error;

    res.json({ documents: toCamelArray(data), total: count || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /documents/:id - 詳細取得
router.get('/documents/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('accounting_documents').select('*').eq('id', req.params.id).single();
    if (error) throw error;
    res.json(toCamel(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /documents - 手動作成
router.post('/documents', async (req, res) => {
  try {
    const row = toSnake(req.body);
    row.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from('accounting_documents').insert(row).select().single();
    if (error) throw error;
    res.json(toCamel(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /documents/:id - 更新
router.put('/documents/:id', async (req, res) => {
  try {
    const row = toSnake(req.body);
    row.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from('accounting_documents').update(row).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(toCamel(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /documents/:id - 削除
router.delete('/documents/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('accounting_documents').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /documents/bulk-status - 一括ステータス更新
router.put('/documents/bulk-status', async (req, res) => {
  try {
    const { ids, status } = req.body;
    const { error } = await supabase.from('accounting_documents')
      .update({ status, updated_at: new Date().toISOString() })
      .in('id', ids);
    if (error) throw error;
    res.json({ success: true, updated: ids.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /documents/upload - ファイルアップロード + AI解析
router.post('/documents/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'ファイルが必要です' });

    const file = req.file;
    const hash = crypto.createHash('sha256').update(file.buffer).digest('hex');

    // 重複チェック
    const { data: existing } = await supabase.from('accounting_documents')
      .select('id').eq('file_hash', hash).limit(1);
    if (existing && existing.length > 0) {
      return res.status(409).json({ error: '同じファイルが既に登録されています', existingId: existing[0].id });
    }

    // Supabase Storageにアップロード
    const ext = file.originalname.split('.').pop() || 'pdf';
    const storagePath = `accounting/${Date.now()}_${hash.slice(0, 8)}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(storagePath, file.buffer, { contentType: file.mimetype });

    if (uploadError) {
      console.error('Storage upload failed:', uploadError.message);
      // ストレージ失敗でもDB登録は続行
    }

    // DB登録
    const row = {
      source: 'manual',
      status: 'pending',
      original_filename: file.originalname,
      file_hash: hash,
      supabase_storage_path: uploadError ? null : storagePath,
      document_type: 'other',
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase.from('accounting_documents').insert(row).select().single();
    if (error) throw error;

    // AI解析を非同期で実行
    analyzeDocument(data.id, file.buffer, file.mimetype, file.originalname).catch(err =>
      console.error('AI analysis failed for', data.id, err.message)
    );

    res.json(toCamel(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /documents/:id/analyze - AI再解析
router.post('/documents/:id/analyze', async (req, res) => {
  try {
    const { data: doc, error } = await supabase.from('accounting_documents')
      .select('*').eq('id', req.params.id).single();
    if (error) throw error;

    // Supabase Storageからファイル取得
    if (!doc.supabase_storage_path) {
      return res.status(400).json({ error: 'ファイルが見つかりません' });
    }

    const { data: fileData, error: dlError } = await supabase.storage
      .from('documents')
      .download(doc.supabase_storage_path);
    if (dlError) throw dlError;

    const buffer = Buffer.from(await fileData.arrayBuffer());
    const mimeType = doc.supabase_storage_path.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg';

    await analyzeDocument(doc.id, buffer, mimeType, doc.original_filename);

    const { data: updated } = await supabase.from('accounting_documents')
      .select('*').eq('id', doc.id).single();
    res.json(toCamel(updated));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================
// AI解析
// =====================

async function analyzeDocument(docId, buffer, mimeType, filename) {
  try {
    const anthropic = getAnthropicClient();

    // PDFの場合はbase64エンコード
    const base64 = buffer.toString('base64');
    const mediaType = mimeType.startsWith('image/') ? mimeType : 'image/png';

    // Claude APIでVision解析
    const content = [];

    if (mimeType === 'application/pdf') {
      content.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: base64 },
      });
    } else {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data: base64 },
      });
    }

    content.push({
      type: 'text',
      text: `この書類を解析して、以下の情報をJSON形式で返してください。
ファイル名: ${filename || '不明'}

必ず以下のキーを持つJSONオブジェクトを返してください（値がない場合はnull）:
{
  "document_type": "invoice" | "receipt" | "sales" | "import_permit" | "other",
  "document_date": "YYYY-MM-DD",
  "due_date": "YYYY-MM-DD",
  "vendor_name": "取引先名",
  "vendor_address": "取引先住所",
  "amount_excluding_tax": 数値,
  "tax_amount": 数値,
  "amount_including_tax": 数値,
  "currency": "JPY" | "USD" | "CNY" 等,
  "document_number": "書類番号",
  "account_title": "勘定科目（日本語）",
  "confidence": 0.0〜1.0
}

JSONのみを返してください。説明は不要です。`,
    });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content }],
    });

    const text = response.content[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI応答からJSONを抽出できませんでした');

    const parsed = JSON.parse(jsonMatch[0]);

    // DB更新
    const updates = {
      document_type: parsed.document_type || 'other',
      document_date: parsed.document_date || null,
      due_date: parsed.due_date || null,
      vendor_name: parsed.vendor_name || null,
      vendor_address: parsed.vendor_address || null,
      amount_excluding_tax: parsed.amount_excluding_tax || null,
      tax_amount: parsed.tax_amount || null,
      amount_including_tax: parsed.amount_including_tax || null,
      currency: parsed.currency || 'JPY',
      document_number: parsed.document_number || null,
      account_title: parsed.account_title || null,
      ai_confidence: parsed.confidence || null,
      ai_raw_response: parsed,
      updated_at: new Date().toISOString(),
    };

    await supabase.from('accounting_documents').update(updates).eq('id', docId);
    return updates;
  } catch (err) {
    console.error('analyzeDocument error:', err.message);
    await supabase.from('accounting_documents').update({
      ai_raw_response: { error: err.message },
      updated_at: new Date().toISOString(),
    }).eq('id', docId);
    throw err;
  }
}

// =====================
// DASHBOARD
// =====================

router.get('/dashboard/stats', async (req, res) => {
  try {
    const { data: docs, error } = await supabase.from('accounting_documents').select('status, document_type, amount_including_tax, document_date, created_at');
    if (error) throw error;

    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const thisYear = `${now.getFullYear()}`;

    const stats = {
      totalDocuments: docs.length,
      pendingCount: 0,
      confirmedCount: 0,
      journalizedCount: 0,
      thisMonthTotal: 0,
      thisYearTotal: 0,
      byType: { invoice: 0, receipt: 0, sales: 0, import_permit: 0, other: 0 },
    };

    for (const doc of docs) {
      if (doc.status === 'pending') stats.pendingCount++;
      else if (doc.status === 'confirmed') stats.confirmedCount++;
      else if (doc.status === 'journalized') stats.journalizedCount++;

      if (doc.document_type) stats.byType[doc.document_type] = (stats.byType[doc.document_type] || 0) + 1;

      const amt = Number(doc.amount_including_tax) || 0;
      const dateStr = doc.document_date || doc.created_at || '';
      if (dateStr.startsWith(thisMonth)) stats.thisMonthTotal += amt;
      if (dateStr.startsWith(thisYear)) stats.thisYearTotal += amt;
    }

    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================
// SOURCES CRUD
// =====================

router.get('/sources', async (_req, res) => {
  try {
    const { data, error } = await supabase.from('accounting_sources').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json(toCamelArray(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/sources', async (req, res) => {
  try {
    const row = toSnake(req.body);
    const { data, error } = await supabase.from('accounting_sources').insert(row).select().single();
    if (error) throw error;
    res.json(toCamel(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/sources/:id', async (req, res) => {
  try {
    const row = toSnake(req.body);
    const { data, error } = await supabase.from('accounting_sources').update(row).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(toCamel(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/sources/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('accounting_sources').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================
// FETCH LOGS
// =====================

router.get('/fetch-logs', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 20;
    const { data, error } = await supabase.from('accounting_fetch_logs')
      .select('*').order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    res.json(toCamelArray(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================
// GMAIL SCAN
// =====================

router.post('/gmail/scan', async (req, res) => {
  try {
    const oauth2Client = getGoogleOAuth2();
    if (!oauth2Client) return res.status(400).json({ error: 'Google OAuth未設定' });

    const { data: tokenData, error: tokenErr } = await supabase.from('oauth_tokens')
      .select('*').eq('id', 'gmail').single();
    if (tokenErr || !tokenData) return res.status(401).json({ error: 'Gmail未認証' });

    oauth2Client.setCredentials({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      scope: tokenData.scope,
      token_type: tokenData.token_type,
      expiry_date: Number(tokenData.expiry_date),
    });

    // トークンリフレッシュ時の自動保存
    oauth2Client.on('tokens', async (tokens) => {
      const updates = { access_token: tokens.access_token, updated_at: new Date().toISOString() };
      if (tokens.refresh_token) updates.refresh_token = tokens.refresh_token;
      await supabase.from('oauth_tokens').update(updates).eq('id', 'gmail');
    });

    // ログ作成
    const { data: log } = await supabase.from('accounting_fetch_logs')
      .insert({ status: 'running', source_id: null }).select().single();

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // 会計関連メールを検索
    const keywords = ['請求書', 'invoice', 'receipt', 'レシート', '領収書', '売上', '輸入許可', 'B/L', '通関'];
    const query = keywords.map(k => `subject:${k} OR body:${k}`).join(' OR ');
    const after = new Date();
    after.setDate(after.getDate() - 30); // 過去30日
    const afterStr = `${after.getFullYear()}/${after.getMonth() + 1}/${after.getDate()}`;

    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: `(${query}) after:${afterStr} has:attachment`,
      maxResults: 50,
    });

    const messages = listRes.data.messages || [];
    let found = 0, saved = 0, skipped = 0;

    for (const msg of messages) {
      found++;
      try {
        const detail = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'full' });

        // 既に取得済みかチェック
        const { data: existingDoc } = await supabase.from('accounting_documents')
          .select('id').eq('source_email_id', msg.id).limit(1);
        if (existingDoc && existingDoc.length > 0) { skipped++; continue; }

        // メールヘッダーから情報取得
        const headers = detail.data.payload?.headers || [];
        const subject = headers.find(h => h.name === 'Subject')?.value || '';
        const from = headers.find(h => h.name === 'From')?.value || '';
        const date = headers.find(h => h.name === 'Date')?.value || '';

        // 添付ファイルを取得
        const parts = detail.data.payload?.parts || [];
        for (const part of parts) {
          if (!part.filename || !part.body?.attachmentId) continue;

          const ext = (part.filename.split('.').pop() || '').toLowerCase();
          if (!['pdf', 'png', 'jpg', 'jpeg', 'gif'].includes(ext)) continue;

          const attachment = await gmail.users.messages.attachments.get({
            userId: 'me', messageId: msg.id, id: part.body.attachmentId,
          });

          const buffer = Buffer.from(attachment.data.data, 'base64url');
          const hash = crypto.createHash('sha256').update(buffer).digest('hex');

          // 重複チェック
          const { data: dup } = await supabase.from('accounting_documents')
            .select('id').eq('file_hash', hash).limit(1);
          if (dup && dup.length > 0) { skipped++; continue; }

          // ストレージにアップロード
          const storagePath = `accounting/${Date.now()}_${hash.slice(0, 8)}.${ext}`;
          await supabase.storage.from('documents').upload(storagePath, buffer, {
            contentType: part.mimeType || 'application/octet-stream',
          });

          // DB登録
          const docDate = date ? new Date(date).toISOString().split('T')[0] : null;
          const { data: newDoc } = await supabase.from('accounting_documents').insert({
            source: 'gmail',
            status: 'pending',
            document_type: 'other',
            original_filename: part.filename,
            file_hash: hash,
            supabase_storage_path: storagePath,
            source_email_id: msg.id,
            vendor_name: from.replace(/<.*>/, '').trim() || null,
            document_date: docDate,
            notes: `件名: ${subject}`,
            updated_at: new Date().toISOString(),
          }).select().single();

          if (newDoc) {
            saved++;
            // AI解析を非同期実行
            analyzeDocument(newDoc.id, buffer, part.mimeType || 'application/pdf', part.filename)
              .catch(err => console.error('Gmail doc analysis failed:', err.message));
          }
        }
      } catch (msgErr) {
        console.error('Error processing message:', msg.id, msgErr.message);
      }
    }

    // ログ更新
    if (log) {
      await supabase.from('accounting_fetch_logs').update({
        status: 'success',
        completed_at: new Date().toISOString(),
        documents_found: found,
        documents_saved: saved,
        documents_skipped: skipped,
      }).eq('id', log.id);
    }

    res.json({ found, saved, skipped });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

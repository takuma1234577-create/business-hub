const express = require('express');
const router = express.Router();
const { getSupabase, getGoogleOAuth2, getAnthropicClient, google } = require('./shared.cjs');
const multer = require('multer');
const crypto = require('crypto');

const supabase = new Proxy({}, { get: (_, prop) => getSupabase()[prop] });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// =====================
// Google Drive ヘルパー
// =====================

const DRIVE_FOLDER_MAP = {
  sales: '売上明細',
  invoice: '請求書',
  receipt: '領収書',
  import_permit: '輸入許可証',
  other: 'その他',
};

async function getDriveClient() {
  const oauth2Client = getGoogleOAuth2();
  if (!oauth2Client) return null;

  const { data: tokenData, error } = await supabase.from('oauth_tokens')
    .select('*').eq('id', 'drive').single();
  if (error || !tokenData) return null;

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
    await supabase.from('oauth_tokens').update(updates).eq('id', 'drive');
  });

  return google.drive({ version: 'v3', auth: oauth2Client });
}

async function getOrCreateFolder(drive, name, parentId) {
  // 既存フォルダを検索
  const query = parentId
    ? `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    : `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const res = await drive.files.list({ q: query, fields: 'files(id, name)', spaces: 'drive' });
  if (res.data.files && res.data.files.length > 0) return res.data.files[0].id;

  // 作成
  const meta = { name, mimeType: 'application/vnd.google-apps.folder' };
  if (parentId) meta.parents = [parentId];
  const created = await drive.files.create({ requestBody: meta, fields: 'id' });
  return created.data.id;
}

async function uploadDocumentToDrive(docId) {
  try {
    const drive = await getDriveClient();
    if (!drive) return null;

    const { data: doc } = await supabase.from('accounting_documents').select('*').eq('id', docId).single();
    if (!doc || doc.google_drive_file_id) return doc?.google_drive_file_id || null;

    // ファイルをSupabase Storageからダウンロード
    if (!doc.supabase_storage_path) return null;
    const { data: fileData, error: dlErr } = await supabase.storage.from('documents').download(doc.supabase_storage_path);
    if (dlErr) throw dlErr;
    const buffer = Buffer.from(await fileData.arrayBuffer());

    // フォルダ階層: 会計書類 / {year} / {document_type_label}
    const year = doc.document_date ? doc.document_date.substring(0, 4) : new Date().getFullYear().toString();
    const typeLabel = DRIVE_FOLDER_MAP[doc.document_type] || 'その他';

    const rootId = await getOrCreateFolder(drive, '会計書類', null);
    const yearId = await getOrCreateFolder(drive, year, rootId);
    const typeId = await getOrCreateFolder(drive, typeLabel, yearId);

    // アップロード
    const ext = (doc.original_filename || '').split('.').pop() || 'pdf';
    const mimeMap = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif' };
    const mimeType = mimeMap[ext.toLowerCase()] || 'application/octet-stream';

    const { Readable } = require('stream');
    const uploaded = await drive.files.create({
      requestBody: {
        name: doc.original_filename || `document_${docId}.${ext}`,
        parents: [typeId],
      },
      media: { mimeType, body: Readable.from(buffer) },
      fields: 'id, webViewLink',
    });

    const fileId = uploaded.data.id;
    const webViewLink = uploaded.data.webViewLink;

    // DB更新
    await supabase.from('accounting_documents').update({
      google_drive_file_id: fileId,
      google_drive_url: webViewLink,
      updated_at: new Date().toISOString(),
    }).eq('id', docId);

    return fileId;
  } catch (err) {
    console.error('uploadDocumentToDrive error:', err.message);
    return null;
  }
}

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
  accountType: 'account_type', accountName: 'account_name', institutionName: 'institution_name',
  accountNumberMasked: 'account_number_masked', branchName: 'branch_name',
  accountId: 'account_id', transactionDate: 'transaction_date', balanceAfter: 'balance_after',
  counterparty: 'counterparty', isMatched: 'is_matched', matchedDocumentId: 'matched_document_id',
  rawData: 'raw_data', institutionType: 'institution_type', nameKana: 'name_kana',
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

    // 確認済み/仕訳済みになったらGoogle Driveに自動アップロード
    if ((row.status === 'confirmed' || row.status === 'journalized') && !data.google_drive_file_id) {
      uploadDocumentToDrive(data.id).catch(err => console.error('Drive upload failed:', err.message));
    }

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

    // 確認済み/仕訳済みのドキュメントをGoogle Driveに自動アップロード
    if (status === 'confirmed' || status === 'journalized') {
      for (const id of ids) {
        uploadDocumentToDrive(id).catch(err => console.error('Drive upload failed:', err.message));
      }
    }

    res.json({ success: true, updated: ids.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /documents/:id/upload-to-drive - 手動でGoogle Driveにアップロード
router.post('/documents/:id/upload-to-drive', async (req, res) => {
  try {
    const fileId = await uploadDocumentToDrive(req.params.id);
    if (!fileId) return res.status(400).json({ error: 'Google Drive認証が未設定か、ファイルが見つかりません' });
    const { data } = await supabase.from('accounting_documents').select('*').eq('id', req.params.id).single();
    res.json(toCamel(data));
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

    // AI解析を非同期で実行 → 完了後にGoogle Driveへアップロード
    analyzeDocument(data.id, file.buffer, file.mimetype, file.originalname)
      .then(() => uploadDocumentToDrive(data.id))
      .catch(err => console.error('AI analysis/drive failed for', data.id, err.message));

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
    const anthropic = await getAnthropicClient();

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
      model: 'claude-sonnet-4-6',
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
            // AI解析を非同期実行 → 完了後にGoogle Driveへアップロード
            analyzeDocument(newDoc.id, buffer, part.mimeType || 'application/pdf', part.filename)
              .then(() => uploadDocumentToDrive(newDoc.id))
              .catch(err => console.error('Gmail doc analysis/drive failed:', err.message));
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

// =====================
// FINANCIAL INSTITUTIONS & BRANCHES (MASTER)
// =====================

// GET /institutions/search?q=xxx&type=bank|credit_card
router.get('/institutions/search', async (req, res) => {
  try {
    const { q = '', type } = req.query;
    let query = supabase.from('financial_institutions')
      .select('id, code, name, name_kana, institution_type')
      .eq('is_active', true)
      .order('code');

    if (type === 'credit_card') {
      query = query.eq('institution_type', 'credit_card');
    } else if (type) {
      query = query.in('institution_type', ['bank', 'credit_union', 'securities', 'other']);
    }

    if (q.trim()) {
      query = query.or(`name.ilike.%${q}%,name_kana.ilike.%${q}%,code.ilike.%${q}%`);
    }

    query = query.limit(30);

    const { data, error } = await query;
    if (error) throw error;
    res.json(toCamelArray(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /institutions/:id/branches/search?q=xxx
router.get('/institutions/:id/branches/search', async (req, res) => {
  try {
    const { q = '' } = req.query;
    let query = supabase.from('financial_branches')
      .select('id, code, name, name_kana')
      .eq('institution_id', req.params.id)
      .eq('is_active', true)
      .order('code');

    if (q.trim()) {
      query = query.or(`name.ilike.%${q}%,name_kana.ilike.%${q}%,code.ilike.%${q}%`);
    }

    query = query.limit(30);

    const { data, error } = await query;
    if (error) throw error;
    res.json(toCamelArray(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================
// FINANCIAL ACCOUNTS CRUD
// =====================

router.get('/financial-accounts', async (_req, res) => {
  try {
    const { data, error } = await supabase.from('financial_accounts')
      .select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json(toCamelArray(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/financial-accounts/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('financial_accounts')
      .select('*').eq('id', req.params.id).single();
    if (error) throw error;
    res.json(toCamel(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/financial-accounts', async (req, res) => {
  try {
    const row = toSnake(req.body);
    row.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from('financial_accounts').insert(row).select().single();
    if (error) throw error;
    res.json(toCamel(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/financial-accounts/:id', async (req, res) => {
  try {
    const row = toSnake(req.body);
    row.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from('financial_accounts')
      .update(row).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(toCamel(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/financial-accounts/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('financial_accounts').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================
// TRANSACTIONS CRUD
// =====================

router.get('/transactions', async (req, res) => {
  try {
    const { accountId, dateFrom, dateTo, search, isMatched, page = '1', limit = '50' } = req.query;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;

    let query = supabase.from('financial_transactions').select('*', { count: 'exact' });

    if (accountId) query = query.eq('account_id', accountId);
    if (dateFrom) query = query.gte('transaction_date', dateFrom);
    if (dateTo) query = query.lte('transaction_date', dateTo);
    if (isMatched === 'true') query = query.eq('is_matched', true);
    if (isMatched === 'false') query = query.eq('is_matched', false);
    if (search) query = query.or(`description.ilike.%${search}%,counterparty.ilike.%${search}%,memo.ilike.%${search}%`);

    query = query.order('transaction_date', { ascending: false }).range(from, to);

    const { data, error, count } = await query;
    if (error) throw error;

    res.json({ transactions: toCamelArray(data), total: count || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/transactions/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('financial_transactions')
      .select('*').eq('id', req.params.id).single();
    if (error) throw error;
    res.json(toCamel(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/transactions', async (req, res) => {
  try {
    const row = toSnake(req.body);
    row.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from('financial_transactions').insert(row).select().single();
    if (error) throw error;
    res.json(toCamel(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/transactions/:id', async (req, res) => {
  try {
    const row = toSnake(req.body);
    row.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from('financial_transactions')
      .update(row).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(toCamel(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/transactions/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('financial_transactions').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================
// CSV IMPORT
// =====================

// CSVパースプリセット（日本の銀行・カード会社向け）
const CSV_PRESETS = {
  // 汎用（日付, 摘要, 出金, 入金, 残高）
  generic: { dateCol: 0, descCol: 1, withdrawCol: 2, depositCol: 3, balanceCol: 4, encoding: 'utf-8', skipRows: 1 },
  // 三菱UFJ銀行
  mufg: { dateCol: 0, descCol: 1, withdrawCol: 2, depositCol: 3, balanceCol: 4, encoding: 'shift_jis', skipRows: 1 },
  // 三井住友銀行
  smbc: { dateCol: 0, descCol: 1, withdrawCol: 2, depositCol: 3, balanceCol: 4, encoding: 'shift_jis', skipRows: 1 },
  // みずほ銀行
  mizuho: { dateCol: 0, descCol: 1, withdrawCol: 3, depositCol: 2, balanceCol: 4, encoding: 'shift_jis', skipRows: 1 },
  // 楽天銀行
  rakuten_bank: { dateCol: 0, descCol: 1, withdrawCol: 2, depositCol: 3, balanceCol: 4, encoding: 'utf-8', skipRows: 1 },
  // クレジットカード汎用（日付, 摘要, 金額）
  credit_card_generic: { dateCol: 0, descCol: 1, amountCol: 2, encoding: 'utf-8', skipRows: 1 },
  // 楽天カード
  rakuten_card: { dateCol: 0, descCol: 1, amountCol: 4, encoding: 'utf-8', skipRows: 1 },
  // Amazon Mastercard
  amazon_card: { dateCol: 0, descCol: 1, amountCol: 4, encoding: 'utf-8', skipRows: 1 },
};

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { result.push(current.trim()); current = ''; }
      else { current += ch; }
    }
  }
  result.push(current.trim());
  return result;
}

function parseDate(val) {
  if (!val) return null;
  // YYYY/MM/DD, YYYY-MM-DD, YYYY年MM月DD日 対応
  const cleaned = val.replace(/年|月/g, '-').replace(/日/g, '').replace(/\//g, '-').trim();
  const m = cleaned.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

function parseAmount(val) {
  if (!val || val.trim() === '' || val.trim() === '-') return 0;
  return parseFloat(val.replace(/[,¥￥\s]/g, '')) || 0;
}

router.post('/transactions/import-csv', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'CSVファイルが必要です' });

    const { accountId, mappingPreset = 'generic' } = req.body;
    if (!accountId) return res.status(400).json({ error: '口座IDが必要です' });

    // 口座存在確認
    const { data: account, error: accErr } = await supabase.from('financial_accounts')
      .select('account_type').eq('id', accountId).single();
    if (accErr) return res.status(404).json({ error: '口座が見つかりません' });

    const preset = CSV_PRESETS[mappingPreset] || CSV_PRESETS.generic;
    const isCreditCard = account.account_type === 'credit_card' || mappingPreset.includes('card');

    // Shift_JIS対応
    let csvText;
    if (preset.encoding === 'shift_jis') {
      const { TextDecoder: TD } = require('util');
      try {
        const decoder = new TD('shift_jis');
        csvText = decoder.decode(req.file.buffer);
      } catch {
        csvText = req.file.buffer.toString('utf-8');
      }
    } else {
      csvText = req.file.buffer.toString('utf-8');
    }

    // BOM除去
    if (csvText.charCodeAt(0) === 0xFEFF) csvText = csvText.slice(1);

    const lines = csvText.split(/\r?\n/).filter(l => l.trim());
    const dataLines = lines.slice(preset.skipRows);

    let imported = 0, skipped = 0;
    const rows = [];

    for (const line of dataLines) {
      const cols = parseCsvLine(line);
      const date = parseDate(cols[preset.dateCol]);
      const desc = (cols[preset.descCol] || '').trim();
      if (!date || !desc) { skipped++; continue; }

      let amount;
      if (isCreditCard && preset.amountCol !== undefined) {
        // カード: 金額列 (支出はマイナス)
        amount = -Math.abs(parseAmount(cols[preset.amountCol]));
      } else {
        // 銀行: 出金/入金
        const withdraw = parseAmount(cols[preset.withdrawCol]);
        const deposit = parseAmount(cols[preset.depositCol]);
        amount = deposit > 0 ? deposit : -withdraw;
      }

      if (amount === 0) { skipped++; continue; }

      const balanceAfter = preset.balanceCol !== undefined ? parseAmount(cols[preset.balanceCol]) || null : null;

      rows.push({
        account_id: accountId,
        transaction_date: date,
        description: desc,
        amount,
        balance_after: balanceAfter,
        source: 'csv_import',
        raw_data: { columns: cols, preset: mappingPreset },
        updated_at: new Date().toISOString(),
      });
    }

    // バッチインサート (100件ずつ)
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      const { error } = await supabase.from('financial_transactions').insert(batch);
      if (error) {
        console.error('Batch insert error:', error.message);
        skipped += batch.length;
      } else {
        imported += batch.length;
      }
    }

    // 口座残高を最新取引から更新
    if (imported > 0) {
      const { data: latest } = await supabase.from('financial_transactions')
        .select('balance_after')
        .eq('account_id', accountId)
        .not('balance_after', 'is', null)
        .order('transaction_date', { ascending: false })
        .limit(1);
      if (latest && latest.length > 0 && latest[0].balance_after != null) {
        await supabase.from('financial_accounts')
          .update({ balance: latest[0].balance_after, updated_at: new Date().toISOString() })
          .eq('id', accountId);
      }
    }

    res.json({ imported, skipped });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================
// AI仕訳分類
// =====================

// POST /transactions/classify-ai - AIで勘定科目を自動分類
router.post('/transactions/classify-ai', async (req, res) => {
  try {
    const { accountId, transactionIds } = req.body;
    if (!accountId) return res.status(400).json({ error: '口座IDが必要です' });

    const anthropic = await getAnthropicClient();

    // 分類対象の取引を取得
    let query = supabase.from('financial_transactions').select('*').eq('account_id', accountId);
    if (transactionIds && transactionIds.length > 0) {
      query = query.in('id', transactionIds);
    } else {
      query = query.is('account_title', null);
    }
    query = query.order('transaction_date', { ascending: false }).limit(100);

    const { data: txns, error: txErr } = await query;
    if (txErr) throw txErr;
    if (!txns || txns.length === 0) return res.json({ classified: 0, results: [] });

    // 勘定科目マスターを取得
    const { data: accounts } = await supabase.from('account_titles').select('id, code, name, category').eq('is_active', true);
    const accountList = (accounts || []).map(a => ({ id: a.id, code: a.code, name: a.name, category: a.category }));

    // 口座情報を取得（相手勘定用）
    const { data: facc } = await supabase.from('financial_accounts').select('account_type, account_name').eq('id', accountId).single();

    // バッチでAI分類（20件ずつ）
    const allResults = [];
    for (let i = 0; i < txns.length; i += 20) {
      const batch = txns.slice(i, i + 20);
      const txnList = batch.map(t => ({
        id: t.id,
        date: t.transaction_date,
        description: t.description,
        amount: t.amount,
        counterparty: t.counterparty || '',
      }));

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: `以下の銀行/カード取引に対して、最も適切な勘定科目を分類してください。

口座: ${facc?.account_name || '不明'} (${facc?.account_type === 'credit_card' ? 'クレジットカード' : '銀行口座'})

勘定科目マスター:
${JSON.stringify(accountList, null, 0)}

取引一覧:
${JSON.stringify(txnList, null, 0)}

各取引について以下のJSON配列で返してください。JSONのみ返してください。
[
  {
    "id": "取引ID",
    "accountTitleId": "勘定科目ID",
    "accountTitleName": "勘定科目名",
    "counterAccountTitleId": "相手勘定科目ID（入金なら売上高等、出金なら普通預金等）",
    "counterAccountTitleName": "相手勘定科目名",
    "confidence": 0.0〜1.0
  }
]

ルール:
- 出金(amount < 0): 費用科目を借方、現金/預金科目を貸方に
- 入金(amount > 0): 現金/預金科目を借方、収益科目を貸方に
- 振込手数料は「支払手数料」
- 不明な場合は最も近い科目を推測してconfidenceを低く設定`
        }],
      });

      const text = response.content[0]?.text || '';
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          allResults.push(...parsed);
        } catch { /* skip invalid batch */ }
      }
    }

    // DB更新
    let classified = 0;
    for (const r of allResults) {
      try {
        const accountName = r.accountTitleName || null;
        await supabase.from('financial_transactions').update({
          account_title: accountName,
          category: accountName,
          updated_at: new Date().toISOString(),
        }).eq('id', r.id);
        classified++;
      } catch { /* skip */ }
    }

    res.json({ classified, results: allResults });
  } catch (err) {
    let msg = err.message;
    if (msg.includes('credit balance') || msg.includes('billing')) {
      msg = 'Anthropic APIのクレジット残高が不足しています。';
    }
    res.status(500).json({ error: msg });
  }
});

// POST /transactions/auto-journal - 分類済み取引から仕訳を一括作成
router.post('/transactions/auto-journal', async (req, res) => {
  try {
    const { accountId, transactionIds, classificationResults } = req.body;
    if (!transactionIds || transactionIds.length === 0) {
      return res.status(400).json({ error: '取引IDが必要です' });
    }

    // 勘定科目マスターを取得
    const { data: accounts } = await supabase.from('account_titles').select('id, code, name, category').eq('is_active', true);
    const nameToId = {};
    const idToAccount = {};
    for (const a of (accounts || [])) {
      nameToId[a.name] = a.id;
      idToAccount[a.id] = a;
    }

    // 口座情報を取得
    const { data: facc } = await supabase.from('financial_accounts')
      .select('account_type, account_name').eq('id', accountId).single();

    // 普通預金の勘定科目IDを探す
    const depositAccount = (accounts || []).find(a => a.name === '普通預金') || (accounts || []).find(a => a.category === 'asset' && a.name.includes('預金'));
    const depositAccountId = depositAccount?.id;

    // 取引を取得
    const { data: txns, error } = await supabase.from('financial_transactions')
      .select('*').in('id', transactionIds);
    if (error) throw error;

    // classificationResults をマップ化
    const classMap = {};
    if (classificationResults) {
      for (const r of classificationResults) {
        classMap[r.id] = r;
      }
    }

    let created = 0, errors = 0;

    for (const tx of (txns || [])) {
      try {
        const classification = classMap[tx.id];
        const accountTitleName = classification?.accountTitleName || tx.account_title;
        const counterAccountTitleId = classification?.counterAccountTitleId;

        if (!accountTitleName) { errors++; continue; }

        const expenseAccountId = classification?.accountTitleId || nameToId[accountTitleName];
        if (!expenseAccountId) { errors++; continue; }

        const counterAcctId = counterAccountTitleId || depositAccountId;
        if (!counterAcctId) { errors++; continue; }

        const amount = Math.abs(tx.amount);
        const isExpense = tx.amount < 0;

        // 仕訳作成
        const lines = isExpense
          ? [
              { accountTitleId: expenseAccountId, debitAmount: amount, creditAmount: 0 },
              { accountTitleId: counterAcctId, debitAmount: 0, creditAmount: amount },
            ]
          : [
              { accountTitleId: counterAcctId, debitAmount: amount, creditAmount: 0 },
              { accountTitleId: expenseAccountId, debitAmount: 0, creditAmount: amount },
            ];

        const { data: entry, error: entryErr } = await supabase.from('journal_entries').insert({
          entry_date: tx.transaction_date,
          description: tx.description + (tx.counterparty ? ` (${tx.counterparty})` : ''),
          source: 'csv_auto',
          updated_at: new Date().toISOString(),
        }).select().single();
        if (entryErr) { errors++; continue; }

        const lineRows = lines.map((l, i) => ({
          journal_entry_id: entry.id,
          account_title_id: l.accountTitleId,
          debit_amount: l.debitAmount,
          credit_amount: l.creditAmount,
          sort_order: i,
        }));

        await supabase.from('journal_entry_lines').insert(lineRows);
        created++;
      } catch {
        errors++;
      }
    }

    res.json({ created, errors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

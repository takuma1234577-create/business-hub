const express = require('express');
const router = express.Router();
const { getSupabase, getAnthropicClient } = require('./shared.cjs');
const multer = require('multer');
const crypto = require('crypto');

const supabase = new Proxy({}, { get: (_, prop) => getSupabase()[prop] });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

// 書類種別定義
const DOCUMENT_TYPES = [
  { id: 'bs_pl', label: '決算書（B/S・P/L）', category: '決算書' },
  { id: 'shareholders_equity', label: '株主資本等変動計算書', category: '決算書' },
  { id: 'cash_flow', label: 'キャッシュフロー計算書', category: '決算書' },
  { id: 'individual_notes', label: '個別注記表', category: '決算書' },
  { id: 'tax_return_1', label: '法人税申告書（別表一）', category: '申告書' },
  { id: 'tax_return_2', label: '法人税申告書（別表二）', category: '申告書' },
  { id: 'tax_return_4', label: '法人税申告書（別表四）', category: '申告書' },
  { id: 'tax_return_5', label: '法人税申告書（別表五）', category: '申告書' },
  { id: 'tax_return_other', label: '法人税申告書（その他別表）', category: '申告書' },
  { id: 'consumption_tax', label: '消費税申告書', category: '申告書' },
  { id: 'local_tax', label: '地方税申告書', category: '申告書' },
  { id: 'tax_payment_list', label: '納付税額一覧表', category: '税金' },
  { id: 'account_breakdown', label: '科目内訳明細書', category: '内訳書' },
  { id: 'account_detail_bs', label: '勘定科目内訳書（B/S）', category: '内訳書' },
  { id: 'account_detail_pl', label: '勘定科目内訳書（P/L）', category: '内訳書' },
  { id: 'business_overview', label: '事業概況説明書', category: '概況' },
  { id: 'trial_balance', label: '残高試算表', category: '試算表' },
  { id: 'general_ledger', label: '総勘定元帳', category: '帳簿' },
  { id: 'journal', label: '仕訳帳', category: '帳簿' },
  { id: 'depreciation', label: '減価償却明細', category: '明細' },
  { id: 'salary_summary', label: '給与台帳・賃金台帳', category: '明細' },
  { id: 'other', label: 'その他', category: 'その他' },
];

// =====================
// 書類種別一覧
// =====================
router.get('/document-types', (_req, res) => {
  res.json(DOCUMENT_TYPES);
});

// =====================
// 事業年度 CRUD
// =====================
router.get('/years', async (_req, res) => {
  try {
    const { data, error } = await supabase.from('fiscal_years')
      .select('*').order('start_date', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/years', async (req, res) => {
  try {
    const { yearLabel, startDate, endDate, notes } = req.body;
    const { data, error } = await supabase.from('fiscal_years').insert({
      year_label: yearLabel, start_date: startDate, end_date: endDate, notes: notes || null,
    }).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/years/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('fiscal_years').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================
// 書類アップロード + AI解析
// =====================
router.get('/documents', async (req, res) => {
  try {
    const { fiscalYearId } = req.query;
    let query = supabase.from('fiscal_documents').select('*').order('created_at', { ascending: false });
    if (fiscalYearId) query = query.eq('fiscal_year_id', fiscalYearId);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/documents/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'ファイルが必要です（最大30MB）' });
    const { fiscalYearId, documentType, documentSubtype } = req.body;
    if (!fiscalYearId) return res.status(400).json({ error: '事業年度が選択されていません' });
    if (!documentType) return res.status(400).json({ error: '書類種別が選択されていません' });

    console.log(`[fiscal-upload] file=${req.file.originalname} size=${req.file.size} type=${documentType} yearId=${fiscalYearId}`);

    const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    const ext = req.file.originalname.split('.').pop() || 'pdf';
    const storagePath = `fiscal/${Date.now()}_${hash.slice(0, 8)}.${ext}`;

    // Storageアップロード
    await supabase.storage.from('documents').upload(storagePath, req.file.buffer, {
      contentType: req.file.mimetype,
    }).catch(() => null);

    // DB登録
    const { data: doc, error } = await supabase.from('fiscal_documents').insert({
      fiscal_year_id: fiscalYearId,
      document_type: documentType,
      document_subtype: documentSubtype || null,
      original_filename: req.file.originalname,
      supabase_storage_path: storagePath,
      file_hash: hash,
      ai_status: 'analyzing',
    }).select().single();
    if (error) throw error;

    // 非同期でAI解析
    analyzeDocument(doc.id, req.file.buffer, req.file.mimetype, documentType, fiscalYearId)
      .catch(err => console.error('Fiscal doc analysis failed:', err.message));

    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/documents/:id', async (req, res) => {
  try {
    // 関連メトリクスも削除
    await supabase.from('fiscal_year_metrics').delete().eq('source_document_id', req.params.id);
    const { error } = await supabase.from('fiscal_documents').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================
// メトリクス（KPI）取得
// =====================
router.get('/metrics', async (req, res) => {
  try {
    const { fiscalYearId } = req.query;
    let query = supabase.from('fiscal_year_metrics').select('*').order('display_order');
    if (fiscalYearId) query = query.eq('fiscal_year_id', fiscalYearId);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 年度比較用データ取得
router.get('/comparison', async (req, res) => {
  try {
    const { data: years, error: yErr } = await supabase.from('fiscal_years')
      .select('*').order('start_date', { ascending: true });
    if (yErr) throw yErr;

    const yearIds = (years || []).map(y => y.id);
    if (yearIds.length === 0) return res.json({ years: [], metrics: {} });

    const { data: metrics, error: mErr } = await supabase.from('fiscal_year_metrics')
      .select('*').in('fiscal_year_id', yearIds).order('display_order');
    if (mErr) throw mErr;

    // カテゴリ→メトリクスキー→年度別値 にグループ化
    const grouped = {};
    for (const m of (metrics || [])) {
      if (!grouped[m.category]) grouped[m.category] = {};
      if (!grouped[m.category][m.metric_key]) {
        grouped[m.category][m.metric_key] = { label: m.metric_label, values: {} };
      }
      grouped[m.category][m.metric_key].values[m.fiscal_year_id] = m.metric_value ?? m.metric_text;
    }

    res.json({ years, metrics: grouped });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================
// AI解析ロジック
// =====================
async function analyzeDocument(docId, buffer, mimeType, documentType, fiscalYearId) {
  try {
    const anthropic = getAnthropicClient();
    const base64 = buffer.toString('base64');
    const typeLabel = DOCUMENT_TYPES.find(t => t.id === documentType)?.label || documentType;

    const content = [];
    if (mimeType === 'application/pdf') {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } });
    } else {
      content.push({ type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } });
    }

    content.push({
      type: 'text',
      text: `この「${typeLabel}」を詳細に読み取り、以下のJSON形式で全ての数値データを抽出してください。

JSONのみを返してください。説明やコメントは不要です。

{
  "summary": "この書類の概要（1-2文）",
  "metrics": [
    {
      "category": "カテゴリ名",
      "key": "metric_key_in_english",
      "label": "日本語ラベル",
      "value": 数値（円の場合は整数）,
      "text": "数値でない場合のテキスト値（あれば）"
    }
  ]
}

カテゴリ分類ルール:
- 決算書(B/S): "資産", "負債", "純資産"
- 決算書(P/L): "売上・収益", "売上原価", "販管費", "営業外損益", "特別損益", "税金・利益"
- 法人税申告書: "法人税", "所得金額", "税額計算"
- 消費税申告書: "消費税"
- 地方税申告書: "地方税"
- 納付税額一覧表: "納付税額"
- 科目内訳明細書: "売掛金内訳", "買掛金内訳", "借入金内訳", "固定資産内訳" 等、科目名をカテゴリに
- 事業概況説明書: "会社概要", "事業内容", "従業員", "取引状況"
- 株主資本等変動計算書: "株主資本変動"
- キャッシュフロー計算書: "営業CF", "投資CF", "財務CF"
- 減価償却明細: "減価償却"
- 給与台帳: "人件費"
- その他: 適切なカテゴリ名を付与

全ての数値を漏れなく抽出してください。特に：
- 金額は全て数値（整数）で返す
- 合計、小計、差引なども含める
- 税率・税額・所得金額なども含める
- 従業員数、株数などの非金額数値も含める
- 期首残高・期末残高がある場合は両方含める`,
    });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      messages: [{ role: 'user', content }],
    });

    const text = response.content[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI応答からJSONを抽出できませんでした');

    const parsed = JSON.parse(jsonMatch[0]);

    // DB更新
    await supabase.from('fiscal_documents').update({
      ai_status: 'done',
      ai_extracted: parsed,
      ai_summary: parsed.summary || null,
      updated_at: new Date().toISOString(),
    }).eq('id', docId);

    // メトリクスを保存
    if (parsed.metrics && Array.isArray(parsed.metrics)) {
      const rows = parsed.metrics.map((m, i) => ({
        fiscal_year_id: fiscalYearId,
        source_document_id: docId,
        category: m.category || 'その他',
        metric_key: m.key || `metric_${i}`,
        metric_label: m.label || m.key,
        metric_value: typeof m.value === 'number' ? m.value : null,
        metric_text: m.text || null,
        display_order: i,
      }));

      // 100件ずつバッチ挿入
      for (let i = 0; i < rows.length; i += 100) {
        await supabase.from('fiscal_year_metrics').insert(rows.slice(i, i + 100));
      }
    }
  } catch (err) {
    console.error('Fiscal analysis error:', err.message);
    let errorMsg = err.message;
    if (errorMsg.includes('credit balance') || errorMsg.includes('billing')) {
      errorMsg = 'Anthropic APIのクレジット残高が不足しています。Plans & Billingからチャージしてください。';
    }
    await supabase.from('fiscal_documents').update({
      ai_status: 'error',
      ai_error: errorMsg,
      updated_at: new Date().toISOString(),
    }).eq('id', docId);
  }
}

module.exports = router;

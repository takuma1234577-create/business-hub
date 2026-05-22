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
// 会社プロフィール（決算月・設立期）
// =====================

router.get('/profile', async (_req, res) => {
  try {
    const { data } = await supabase.from('company_profile').select('*').single();
    res.json(data || { fiscal_end_month: null, first_period_start: null, period_count: null });
  } catch {
    res.json({ fiscal_end_month: null, first_period_start: null, period_count: null });
  }
});

router.post('/profile', async (req, res) => {
  try {
    const { fiscalEndMonth, firstPeriodStart } = req.body;
    if (!fiscalEndMonth || !firstPeriodStart) {
      return res.status(400).json({ error: '決算月と第1期開始日を入力してください' });
    }

    // upsert profile
    const { data: existing } = await supabase.from('company_profile').select('id').limit(1).single();
    const profileData = {
      fiscal_end_month: fiscalEndMonth,
      first_period_start: firstPeriodStart,
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      await supabase.from('company_profile').update(profileData).eq('id', existing.id);
    } else {
      await supabase.from('company_profile').insert(profileData);
    }

    // 事業年度を自動生成
    const startDate = new Date(firstPeriodStart);
    const endMonth = fiscalEndMonth; // 1-12
    const currentYear = new Date().getFullYear();
    const generatedYears = [];

    let periodNum = 1;
    let periodStart = new Date(startDate);

    while (true) {
      // 期末日を計算
      let endYear = periodStart.getFullYear();
      let endMonthDate = endMonth;

      // 第1期は開始日から次の決算月末まで（端数期間対応）
      if (periodNum === 1) {
        // 開始月が決算月より後なら翌年の決算月末
        if (periodStart.getMonth() + 1 > endMonth) {
          endYear = periodStart.getFullYear() + 1;
        }
      } else {
        // 第2期以降は前期末+1日から12ヶ月後の決算月末
        endYear = periodStart.getFullYear();
        if (periodStart.getMonth() + 1 > endMonth) {
          endYear += 1;
        }
      }

      const lastDay = new Date(endYear, endMonthDate, 0).getDate();
      const periodEnd = new Date(endYear, endMonthDate - 1, lastDay);

      // 現在の日付を含む年度まで生成（未来の年度は作らない）
      if (periodStart > new Date()) break;

      generatedYears.push({
        year_label: `第${periodNum}期（${periodEnd.getFullYear()}年${endMonthDate}月期）`,
        start_date: periodStart.toISOString().split('T')[0],
        end_date: periodEnd.toISOString().split('T')[0],
        is_current: false,
      });

      // 次の期の開始日
      periodStart = new Date(periodEnd);
      periodStart.setDate(periodStart.getDate() + 1);
      periodNum++;

      if (periodNum > 30) break; // 安全弁
    }

    // 現在の期をマーク
    const today = new Date().toISOString().split('T')[0];
    for (const y of generatedYears) {
      if (y.start_date <= today && y.end_date >= today) {
        y.is_current = true;
      }
    }

    // 既存の年度と照合して重複しないものだけ追加
    const { data: existingYears } = await supabase.from('fiscal_years').select('start_date, end_date');
    const existingRanges = new Set((existingYears || []).map(y => `${y.start_date}_${y.end_date}`));

    const newYears = generatedYears.filter(y => !existingRanges.has(`${y.start_date}_${y.end_date}`));
    if (newYears.length > 0) {
      const { error } = await supabase.from('fiscal_years').insert(newYears);
      if (error) throw error;
    }

    // is_current更新
    await supabase.from('fiscal_years').update({ is_current: false }).neq('id', '');
    const currentFY = generatedYears.find(y => y.is_current);
    if (currentFY) {
      await supabase.from('fiscal_years')
        .update({ is_current: true })
        .eq('start_date', currentFY.start_date)
        .eq('end_date', currentFY.end_date);
    }

    res.json({ success: true, generated: newYears.length, total: generatedYears.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
    const { fiscalYearId, targetMonth } = req.query;
    let query = supabase.from('fiscal_documents').select('*').order('created_at', { ascending: false });
    if (fiscalYearId) query = query.eq('fiscal_year_id', fiscalYearId);
    if (targetMonth) query = query.eq('target_month', targetMonth);
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
    const { fiscalYearId, documentType, documentSubtype, targetMonth } = req.body;
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
      target_month: targetMonth || null,
    }).select().single();
    if (error) throw error;

    // ファイルをStorageに保存済みなので、解析は別エンドポイントで実行
    // 小さいファイル（5MB以下）は同期で試みる
    if (req.file.size < 5 * 1024 * 1024) {
      try {
        await analyzeDocument(doc.id, req.file.buffer, req.file.mimetype, documentType, fiscalYearId, targetMonth || null);
        const { data: updatedDoc } = await supabase.from('fiscal_documents').select('*').eq('id', doc.id).single();
        return res.json(updatedDoc || doc);
      } catch (e) {
        console.error('[fiscal-upload] sync analysis failed, will retry via analyze endpoint:', e.message);
      }
    }
    // 大きいファイルはpendingで返し、フロントから/analyze を叩いてもらう
    res.json(doc);
  } catch (err) {
    const msg = typeof err.message === 'string' ? err.message : JSON.stringify(err.message || err);
    res.status(500).json({ error: msg });
  }
});

// 解析実行（大きいファイル用・Storageから取得して解析）
router.post('/documents/:id/analyze', async (req, res) => {
  try {
    const docId = req.params.id;
    const { data: doc } = await supabase.from('fiscal_documents')
      .select('*').eq('id', docId).single();
    if (!doc) return res.status(404).json({ error: '書類が見つかりません' });
    if (doc.ai_status === 'done') return res.json(doc);

    // Storageからファイル取得
    const { data: fileData, error: dlErr } = await supabase.storage
      .from('documents').download(doc.supabase_storage_path);
    if (dlErr || !fileData) return res.status(500).json({ error: 'ファイルの取得に失敗しました' });

    const buffer = Buffer.from(await fileData.arrayBuffer());
    const mimeType = doc.supabase_storage_path.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg';

    await supabase.from('fiscal_documents').update({ ai_status: 'analyzing' }).eq('id', docId);
    await analyzeDocument(docId, buffer, mimeType, doc.document_type, doc.fiscal_year_id, doc.target_month);

    const { data: updated } = await supabase.from('fiscal_documents').select('*').eq('id', docId).single();
    res.json(updated || doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/documents/:id', async (req, res) => {
  try {
    const docId = req.params.id;
    // 関連メトリクスを削除
    await supabase.from('fiscal_year_metrics').delete().eq('source_document_id', docId);
    // 関連仕訳を削除（journal_entry_linesはON DELETE CASCADEで自動削除）
    const { data: deleted } = await supabase.from('journal_entries').delete().eq('fiscal_document_id', docId).select('id');
    // 書類本体を削除
    const { error } = await supabase.from('fiscal_documents').delete().eq('id', docId);
    if (error) throw error;
    res.json({ success: true, deletedJournals: deleted?.length || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================
// メトリクス（KPI）取得
// =====================
router.get('/metrics', async (req, res) => {
  try {
    const { fiscalYearId, targetMonth } = req.query;
    let query = supabase.from('fiscal_year_metrics').select('*').order('display_order');
    if (fiscalYearId) query = query.eq('fiscal_year_id', fiscalYearId);
    if (targetMonth) query = query.eq('target_month', targetMonth);
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
async function analyzeDocument(docId, buffer, mimeType, documentType, fiscalYearId, targetMonth) {
  try {
    const anthropic = await getAnthropicClient();
    const base64 = buffer.toString('base64');
    const typeLabel = DOCUMENT_TYPES.find(t => t.id === documentType)?.label || documentType;

    const contentBlock = [];
    if (mimeType === 'application/pdf') {
      contentBlock.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } });
    } else {
      contentBlock.push({ type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } });
    }

    contentBlock.push({
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

メトリクスのカテゴリ分類:
- 決算書(B/S): "資産", "負債", "純資産"
- 決算書(P/L): "売上・収益", "売上原価", "販管費", "営業外損益", "特別損益", "税金・利益"
- 法人税申告書: "法人税", "所得金額", "税額計算"
- 消費税申告書: "消費税"
- 地方税申告書: "地方税"
- 納付税額一覧表: "納付税額"
- 科目内訳明細書: 科目名をカテゴリに
- 事業概況説明書: "会社概要", "事業内容", "従業員", "取引状況"
- 株主資本等変動計算書: "株主資本変動"
- キャッシュフロー計算書: "営業CF", "投資CF", "財務CF"
- 減価償却明細: "減価償却"
- その他: 適切なカテゴリ名

全ての数値を漏れなく抽出。金額は全て整数。合計・小計も含める。`,
    });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 16384,
      messages: [{ role: 'user', content: contentBlock }],
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
        target_month: targetMonth || null,
        display_order: i,
      }));
      for (let i = 0; i < rows.length; i += 100) {
        await supabase.from('fiscal_year_metrics').insert(rows.slice(i, i + 100));
      }
    }

    // B/S・P/LはメトリクスデータからUI側で直接表示（仕訳は生成しない）
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

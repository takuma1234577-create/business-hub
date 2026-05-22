const express = require('express');
const router = express.Router();
const { getSupabase, getAnthropicClient } = require('./shared.cjs');
const multer = require('multer');

const supabase = new Proxy({}, { get: (_, prop) => getSupabase()[prop] });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// =====================
// 勘定科目マスター
// =====================

router.get('/account-titles', async (req, res) => {
  try {
    const { category } = req.query;
    let query = supabase.from('account_titles').select('*').eq('is_active', true).order('display_order');
    if (category) query = query.eq('category', category);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================
// 会計期間
// =====================

router.get('/fiscal-periods', async (_req, res) => {
  try {
    const { data, error } = await supabase.from('fiscal_periods').select('*').order('start_date', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/fiscal-periods', async (req, res) => {
  try {
    const { name, startDate, endDate } = req.body;
    const { data, error } = await supabase.from('fiscal_periods').insert({
      name, start_date: startDate, end_date: endDate,
    }).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================
// 仕訳 CRUD
// =====================

router.get('/journal-entries', async (req, res) => {
  try {
    const { periodId, dateFrom, dateTo, search, page = '1', limit = '50' } = req.query;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;

    let query = supabase.from('journal_entries').select(`
      *, journal_entry_lines(*, account_titles(id, code, name, category))
    `, { count: 'exact' });

    if (periodId) query = query.eq('fiscal_period_id', periodId);
    if (dateFrom) query = query.gte('entry_date', dateFrom);
    if (dateTo) query = query.lte('entry_date', dateTo);
    if (search) query = query.ilike('description', `%${search}%`);

    query = query.order('entry_date', { ascending: false }).order('created_at', { ascending: false }).range(from, to);

    const { data, error, count } = await query;
    if (error) throw error;

    res.json({ entries: data || [], total: count || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/journal-entries', async (req, res) => {
  try {
    const { entryDate, description, referenceNumber, source, fiscalPeriodId, lines } = req.body;

    if (!lines || lines.length < 2) {
      return res.status(400).json({ error: '仕訳には最低2行必要です' });
    }

    // 借方・貸方の合計チェック
    const totalDebit = lines.reduce((s, l) => s + (Number(l.debitAmount) || 0), 0);
    const totalCredit = lines.reduce((s, l) => s + (Number(l.creditAmount) || 0), 0);
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      return res.status(400).json({ error: `借方合計(${totalDebit})と貸方合計(${totalCredit})が一致しません` });
    }

    const { data: entry, error: entryErr } = await supabase.from('journal_entries').insert({
      entry_date: entryDate,
      description: description || null,
      reference_number: referenceNumber || null,
      source: source || 'manual',
      fiscal_period_id: fiscalPeriodId || null,
      updated_at: new Date().toISOString(),
    }).select().single();
    if (entryErr) throw entryErr;

    const lineRows = lines.map((l, i) => ({
      journal_entry_id: entry.id,
      account_title_id: l.accountTitleId,
      debit_amount: Number(l.debitAmount) || 0,
      credit_amount: Number(l.creditAmount) || 0,
      description: l.description || null,
      sort_order: i,
    }));

    const { error: linesErr } = await supabase.from('journal_entry_lines').insert(lineRows);
    if (linesErr) throw linesErr;

    // 完全なデータを返す
    const { data: full } = await supabase.from('journal_entries').select(`
      *, journal_entry_lines(*, account_titles(id, code, name, category))
    `).eq('id', entry.id).single();

    res.json(full);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/journal-entries/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('journal_entries').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================
// 仕訳データの日付範囲
// =====================

router.get('/date-range', async (req, res) => {
  try {
    const { data: earliest } = await supabase.from('journal_entries')
      .select('entry_date').order('entry_date', { ascending: true }).limit(1).single();
    const { data: latest } = await supabase.from('journal_entries')
      .select('entry_date').order('entry_date', { ascending: false }).limit(1).single();
    res.json({
      earliest: earliest?.entry_date || null,
      latest: latest?.entry_date || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================
// 年度サマリー (Dashboard用)
// =====================

router.get('/fiscal-summary', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) return res.status(400).json({ error: 'startDate, endDate が必要です' });

    // 当期の仕訳を取得
    const { data: entries } = await supabase.from('journal_entries')
      .select('id').gte('entry_date', startDate).lte('entry_date', endDate);
    const entryIds = (entries || []).map(e => e.id);

    const { data: accounts } = await supabase.from('account_titles').select('*').eq('is_active', true);
    const accountMap = {};
    for (const a of (accounts || [])) accountMap[a.id] = a;

    // 当期のP/L集計
    let totalRevenue = 0, totalExpenses = 0;
    const plItems = {};
    if (entryIds.length > 0) {
      const { data: lines } = await supabase.from('journal_entry_lines')
        .select('debit_amount, credit_amount, account_title_id')
        .in('journal_entry_id', entryIds);
      for (const line of (lines || [])) {
        const acct = accountMap[line.account_title_id];
        if (!acct) continue;
        if (acct.category === 'revenue') {
          const amt = (Number(line.credit_amount) || 0) - (Number(line.debit_amount) || 0);
          totalRevenue += amt;
          if (!plItems[acct.subcategory]) plItems[acct.subcategory] = 0;
          plItems[acct.subcategory] += amt;
        } else if (acct.category === 'expense') {
          const amt = (Number(line.debit_amount) || 0) - (Number(line.credit_amount) || 0);
          totalExpenses += amt;
          if (!plItems[acct.subcategory]) plItems[acct.subcategory] = 0;
          plItems[acct.subcategory] += amt;
        }
      }
    }

    // B/S: endDate時点の全残高
    const { data: allEntries } = await supabase.from('journal_entries')
      .select('id').lte('entry_date', endDate);
    const allIds = (allEntries || []).map(e => e.id);
    let totalAssets = 0, totalLiabilities = 0, totalEquity = 0;
    if (allIds.length > 0) {
      const { data: allLines } = await supabase.from('journal_entry_lines')
        .select('debit_amount, credit_amount, account_title_id')
        .in('journal_entry_id', allIds);
      for (const line of (allLines || [])) {
        const acct = accountMap[line.account_title_id];
        if (!acct) continue;
        if (acct.category === 'asset') {
          totalAssets += (Number(line.debit_amount) || 0) - (Number(line.credit_amount) || 0);
        } else if (acct.category === 'liability') {
          totalLiabilities += (Number(line.credit_amount) || 0) - (Number(line.debit_amount) || 0);
        } else if (acct.category === 'equity') {
          totalEquity += (Number(line.credit_amount) || 0) - (Number(line.debit_amount) || 0);
        }
      }
    }

    const netIncome = totalRevenue - totalExpenses;
    const salesRevenue = plItems['売上高'] || 0;
    const costOfSales = plItems['売上原価'] || 0;
    const grossProfit = salesRevenue - costOfSales;
    const sgaExpenses = plItems['販売費及び一般管理費'] || 0;
    const operatingIncome = grossProfit - sgaExpenses;

    res.json({
      totalRevenue, totalExpenses, netIncome,
      salesRevenue, costOfSales, grossProfit, sgaExpenses, operatingIncome,
      totalAssets, totalLiabilities, totalEquity: totalEquity + netIncome,
      journalCount: entryIds.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================
// 貸借対照表 (B/S)
// =====================

router.get('/balance-sheet', async (req, res) => {
  try {
    const { asOfDate } = req.query;
    if (!asOfDate) return res.status(400).json({ error: 'asOfDate が必要です' });

    // 指定日までの全仕訳明細を集計
    const { data, error } = await supabase.from('journal_entry_lines')
      .select('debit_amount, credit_amount, account_titles(id, code, name, category, subcategory, display_order)')
      .lte('journal_entries.entry_date', asOfDate)
      .not('journal_entries', 'is', null);

    // RPC or join approach - use a different query
    const { data: entries, error: entriesErr } = await supabase.from('journal_entries')
      .select('id').lte('entry_date', asOfDate);
    if (entriesErr) throw entriesErr;

    const entryIds = (entries || []).map(e => e.id);
    if (entryIds.length === 0) {
      return res.json({ asOfDate, assets: [], liabilities: [], equity: [], totalAssets: 0, totalLiabilities: 0, totalEquity: 0, netIncome: 0 });
    }

    const { data: lines, error: linesErr } = await supabase.from('journal_entry_lines')
      .select('debit_amount, credit_amount, account_title_id')
      .in('journal_entry_id', entryIds);
    if (linesErr) throw linesErr;

    const { data: accounts } = await supabase.from('account_titles').select('*').eq('is_active', true);
    const accountMap = {};
    for (const a of (accounts || [])) accountMap[a.id] = a;

    // 勘定科目ごとに集計
    const balances = {};
    for (const line of (lines || [])) {
      const acct = accountMap[line.account_title_id];
      if (!acct) continue;
      if (!balances[acct.id]) balances[acct.id] = { ...acct, balance: 0 };

      // 資産・費用: 借方+ 貸方-  / 負債・資本・収益: 貸方+ 借方-
      if (acct.category === 'asset' || acct.category === 'expense') {
        balances[acct.id].balance += (Number(line.debit_amount) || 0) - (Number(line.credit_amount) || 0);
      } else {
        balances[acct.id].balance += (Number(line.credit_amount) || 0) - (Number(line.debit_amount) || 0);
      }
    }

    const all = Object.values(balances).filter(b => Math.abs(b.balance) > 0.01);
    const assets = all.filter(b => b.category === 'asset').sort((a, b) => a.display_order - b.display_order);
    const liabilities = all.filter(b => b.category === 'liability').sort((a, b) => a.display_order - b.display_order);
    const equityItems = all.filter(b => b.category === 'equity').sort((a, b) => a.display_order - b.display_order);

    // 当期純利益 = 収益合計 - 費用合計
    const totalRevenue = all.filter(b => b.category === 'revenue').reduce((s, b) => s + b.balance, 0);
    const totalExpense = all.filter(b => b.category === 'expense').reduce((s, b) => s + b.balance, 0);
    const netIncome = totalRevenue - totalExpense;

    const totalAssets = assets.reduce((s, b) => s + b.balance, 0);
    const totalLiabilities = liabilities.reduce((s, b) => s + b.balance, 0);
    const totalEquity = equityItems.reduce((s, b) => s + b.balance, 0) + netIncome;

    res.json({ asOfDate, assets, liabilities, equity: equityItems, totalAssets, totalLiabilities, totalEquity, netIncome });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================
// 損益計算書 (P/L)
// =====================

router.get('/profit-loss', async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;
    if (!dateFrom || !dateTo) return res.status(400).json({ error: 'dateFrom, dateTo が必要です' });

    const { data: entries, error: entriesErr } = await supabase.from('journal_entries')
      .select('id').gte('entry_date', dateFrom).lte('entry_date', dateTo);
    if (entriesErr) throw entriesErr;

    const entryIds = (entries || []).map(e => e.id);
    if (entryIds.length === 0) {
      return res.json({ dateFrom, dateTo, revenue: [], expenses: [], totalRevenue: 0, totalExpenses: 0, netIncome: 0 });
    }

    const { data: lines, error: linesErr } = await supabase.from('journal_entry_lines')
      .select('debit_amount, credit_amount, account_title_id')
      .in('journal_entry_id', entryIds);
    if (linesErr) throw linesErr;

    const { data: accounts } = await supabase.from('account_titles').select('*').eq('is_active', true);
    const accountMap = {};
    for (const a of (accounts || [])) accountMap[a.id] = a;

    const balances = {};
    for (const line of (lines || [])) {
      const acct = accountMap[line.account_title_id];
      if (!acct || (acct.category !== 'revenue' && acct.category !== 'expense')) continue;
      if (!balances[acct.id]) balances[acct.id] = { ...acct, balance: 0 };

      if (acct.category === 'expense') {
        balances[acct.id].balance += (Number(line.debit_amount) || 0) - (Number(line.credit_amount) || 0);
      } else {
        balances[acct.id].balance += (Number(line.credit_amount) || 0) - (Number(line.debit_amount) || 0);
      }
    }

    const all = Object.values(balances).filter(b => Math.abs(b.balance) > 0.01);
    const revenue = all.filter(b => b.category === 'revenue').sort((a, b) => a.display_order - b.display_order);
    const expenses = all.filter(b => b.category === 'expense').sort((a, b) => a.display_order - b.display_order);

    const totalRevenue = revenue.reduce((s, b) => s + b.balance, 0);
    const totalExpenses = expenses.reduce((s, b) => s + b.balance, 0);

    // P/L構造化
    const salesRevenue = revenue.filter(r => r.subcategory === '売上高');
    const otherRevenue = revenue.filter(r => r.subcategory === '営業外収益');
    const specialRevenue = revenue.filter(r => r.subcategory === '特別利益');

    const costOfSales = expenses.filter(e => e.subcategory === '売上原価');
    const sgaExpenses = expenses.filter(e => e.subcategory === '販売費及び一般管理費');
    const otherExpenses = expenses.filter(e => e.subcategory === '営業外費用');
    const specialExpenses = expenses.filter(e => e.subcategory === '特別損失');
    const taxExpenses = expenses.filter(e => e.subcategory === '法人税等');

    const totalSales = salesRevenue.reduce((s, b) => s + b.balance, 0);
    const totalCost = costOfSales.reduce((s, b) => s + b.balance, 0);
    const grossProfit = totalSales - totalCost;

    const totalSga = sgaExpenses.reduce((s, b) => s + b.balance, 0);
    const operatingIncome = grossProfit - totalSga;

    const totalOtherRevenue = otherRevenue.reduce((s, b) => s + b.balance, 0);
    const totalOtherExpense = otherExpenses.reduce((s, b) => s + b.balance, 0);
    const ordinaryIncome = operatingIncome + totalOtherRevenue - totalOtherExpense;

    const totalSpecialRevenue = specialRevenue.reduce((s, b) => s + b.balance, 0);
    const totalSpecialExpense = specialExpenses.reduce((s, b) => s + b.balance, 0);
    const incomeBeforeTax = ordinaryIncome + totalSpecialRevenue - totalSpecialExpense;

    const totalTax = taxExpenses.reduce((s, b) => s + b.balance, 0);
    const netIncome = incomeBeforeTax - totalTax;

    res.json({
      dateFrom, dateTo,
      salesRevenue, costOfSales, grossProfit,
      sgaExpenses, operatingIncome,
      otherRevenue, otherExpenses, ordinaryIncome,
      specialRevenue, specialExpenses, incomeBeforeTax,
      taxExpenses, netIncome,
      totalRevenue, totalExpenses,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================
// 決算書アップロード（AI解析→仕訳自動生成）
// =====================

router.post('/import-financial-statement', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'ファイルが必要です' });

    const { fiscalPeriodId, statementType, sourceDocumentId } = req.body;
    // statementType: 'bs' (貸借対照表), 'pl' (損益計算書), 'journal' (仕訳帳), 'tax_return' (決算書/確定申告)

    const anthropic = await getAnthropicClient();
    const base64 = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype;

    // 勘定科目一覧を取得
    const { data: accounts } = await supabase.from('account_titles').select('id, code, name, category, subcategory');
    const accountList = (accounts || []).map(a => `${a.code}:${a.name}(${a.category})`).join(', ');

    const content = [];
    if (mimeType === 'application/pdf') {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } });
    } else {
      content.push({ type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } });
    }

    content.push({
      type: 'text',
      text: `この${statementType === 'bs' ? '貸借対照表' : statementType === 'pl' ? '損益計算書' : statementType === 'journal' ? '仕訳帳' : '決算書'}を読み取り、仕訳データに変換してください。

利用可能な勘定科目: ${accountList}

以下のJSON配列形式で返してください。説明やコメントは不要です。JSONのみ返してください。

[
  {
    "date": "YYYY-MM-DD",
    "description": "摘要",
    "lines": [
      {"account_code": "勘定科目コード", "debit": 金額or0, "credit": 金額or0}
    ]
  }
]

重要なルール:
- 貸借対照表の場合: 各科目の残高を開始仕訳として作成。資産科目は借方、負債・純資産科目は貸方に記入。
- 損益計算書の場合: 各科目の金額を仕訳として作成。費用科目は借方、収益科目は貸方に記入。
- 仕訳帳の場合: そのまま各仕訳を転記。
- 決算書の場合: B/SとP/Lの両方を読み取り、全ての仕訳を生成。
- 各仕訳の借方合計と貸方合計は必ず一致させてください。
- 金額は数値のみ（カンマや円記号なし）。
- 勘定科目コードは上記リストから最も近いものを選択。`,
    });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [{ role: 'user', content }],
    });

    const text = response.content[0]?.text || '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('AI応答からJSONを抽出できませんでした');

    const parsed = JSON.parse(jsonMatch[0]);

    // 勘定科目コード→IDマッピング
    const codeToId = {};
    for (const a of (accounts || [])) codeToId[a.code] = a.id;

    let created = 0, skipped = 0;

    for (const entry of parsed) {
      try {
        const lines = (entry.lines || []).map(l => ({
          accountTitleId: codeToId[l.account_code],
          debitAmount: Number(l.debit) || 0,
          creditAmount: Number(l.credit) || 0,
        })).filter(l => l.accountTitleId && (l.debitAmount > 0 || l.creditAmount > 0));

        if (lines.length < 2) { skipped++; continue; }

        // 貸借バランスチェック
        const totalDebit = lines.reduce((s, l) => s + l.debitAmount, 0);
        const totalCredit = lines.reduce((s, l) => s + l.creditAmount, 0);
        if (Math.abs(totalDebit - totalCredit) > 1) { skipped++; continue; }

        const { data: je, error: jeErr } = await supabase.from('journal_entries').insert({
          entry_date: entry.date || new Date().toISOString().split('T')[0],
          description: entry.description || '決算書取り込み',
          source: 'ai_import',
          fiscal_document_id: sourceDocumentId || null,
          fiscal_period_id: fiscalPeriodId || null,
          updated_at: new Date().toISOString(),
        }).select().single();
        if (jeErr) { skipped++; continue; }

        const lineRows = lines.map((l, i) => ({
          journal_entry_id: je.id,
          account_title_id: l.accountTitleId,
          debit_amount: l.debitAmount,
          credit_amount: l.creditAmount,
          sort_order: i,
        }));

        await supabase.from('journal_entry_lines').insert(lineRows);
        created++;
      } catch {
        skipped++;
      }
    }

    res.json({ created, skipped, total: parsed.length });
  } catch (err) {
    const rawMsg = typeof err.message === 'string' ? err.message : JSON.stringify(err.message || err.error || err);
    console.error('[import-financial-statement] Error:', rawMsg);
    let msg = rawMsg;
    if (msg.includes('credit balance') || msg.includes('billing')) {
      msg = 'Anthropic APIのクレジット残高が不足しています。Plans & Billingからチャージしてください。';
    }
    if (msg.includes('Could not process image') || msg.includes('too many pages') || msg.includes('max_tokens')) {
      msg = 'PDFが大きすぎます。ページ数を減らして再度アップロードしてください。';
    }
    res.status(500).json({ error: msg });
  }
});

module.exports = router;

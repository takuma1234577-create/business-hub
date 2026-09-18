/**
 * FITPEAK 商品在庫管理
 *
 * - Amazon FBA在庫：SP-API fba/inventory から日次スナップショット
 * - 販売数：SP-API 売上・トラフィックレポート（子ASIN別・30日/90日窓）
 * - 在庫フロー：たお太郎側のロット台帳（発注中→検品・梱包中→準備完了→輸送中→Amazon納品済み）
 * - 資材在庫：化粧箱・説明書・カード類（たお太郎が更新）
 * - 判定：残り在庫日数 ≤ リードタイム＋安全在庫 → 今すぐ発注 ／ 未完了ロットがあれば追加発注不可
 *
 * 公開API（認証不要・キー付き）：/api/public/inventory/:key/... たお太郎の担当者用
 */
const express = require('express');
const axios = require('axios');
const zlib = require('zlib');
const { getSupabase, getChatworkHeaders } = require('./shared.cjs');
const { getAccessToken } = require('./amazon.cjs');

const router = express.Router();
const publicRouter = express.Router();

const STATUS_LABELS = {
  ordered: '発注中（生産中）',
  inspecting: '検品・梱包中',
  ready: '準備完了在庫',
  shipping: '輸送中',
  received: 'Amazon納品済み',
  cancelled: 'キャンセル',
};
const OPEN_STATUSES = ['ordered', 'inspecting', 'ready', 'shipping'];
const BLOCKING_STATUSES = ['ordered', 'inspecting', 'ready']; // これがあると追加発注不可
const MATERIAL_USE_STATUSES = ['ordered', 'inspecting'];      // これから資材を使う数量

const CHATWORK_BASE_URL = 'https://api.chatwork.com/v2';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
async function getSettings() {
  const sb = getSupabase();
  const { data } = await sb.from('inventory_settings').select('*').eq('id', 1).maybeSingle();
  if (data) return data;
  const { data: created } = await sb.from('inventory_settings').insert({ id: 1 }).select('*').single();
  return created;
}

function toDate(d) { return d.toISOString().slice(0, 10); }
function addDays(d, n) { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; }
function ceilTo(n, lot) { return Math.ceil(n / lot) * lot; }

async function loadAll() {
  const sb = getSupabase();
  const [{ data: products }, { data: lots }, { data: materials }, { data: sales }, settings] = await Promise.all([
    sb.from('inventory_products').select('*').order('sort_order').order('product').order('color').order('size'),
    sb.from('inventory_lots').select('*').order('created_at', { ascending: false }),
    sb.from('inventory_materials').select('*').order('sort_order'),
    sb.from('inventory_sales_windows').select('*'),
    getSettings(),
  ]);
  // 各商品の最新スナップショット
  const { data: snaps } = await sb.from('inventory_amazon_snapshots')
    .select('product_id, fulfillable, inbound, reserved, fetched_at')
    .order('fetched_at', { ascending: false }).limit(2000);
  const latest = {};
  for (const s of snaps || []) if (!latest[s.product_id]) latest[s.product_id] = s;
  return { products: products || [], lots: lots || [], materials: materials || [], sales: sales || [], settings, latest };
}

/** 判定ロジック（fitpeak-gear-knowledge/scripts/reorder_calc.py と同じ） */
function computeDashboard({ products, lots, materials, sales, settings, latest }) {
  const s = settings;
  const lt = s.lead_time_days, sd = s.safety_days, cv = s.coverage_days, pd = s.prepare_days;
  const thresholdNow = lt + sd, thresholdPrep = thresholdNow + pd;
  const horizon = lt + cv + sd;
  const lot = Math.max(1, s.lot_size || 50);
  const salesByAsin = {};
  for (const w of sales) { salesByAsin[w.asin] = salesByAsin[w.asin] || {}; salesByAsin[w.asin][w.window_days] = w; }

  // 資材：商品ごとの「これから資材を使う数量」
  const usePerProduct = {};
  for (const l of lots) if (MATERIAL_USE_STATUSES.includes(l.status)) {
    const p = products.find(p => p.id === l.product_id);
    if (p) usePerProduct[p.product] = (usePerProduct[p.product] || 0) + l.qty;
  }
  const totalUse = Object.values(usePerProduct).reduce((a, b) => a + b, 0);
  const materialRows = materials.map(m => {
    const use = m.product === '共通' ? totalUse : (usePerProduct[m.product] || 0);
    const pipelineNeed = Math.ceil(use * Number(m.per_unit || 1));
    const buffer = Math.ceil((s.material_buffer_units || 0) * Number(m.per_unit || 1));
    const needTotal = pipelineNeed + buffer;
    let state = 'unknown';
    if (m.quantity !== null && m.quantity !== undefined) {
      state = m.quantity < pipelineNeed ? 'short' : m.quantity < needTotal ? 'low' : 'ok';
    }
    return { ...m, pipeline_need: pipelineNeed, buffer, need_total: needTotal,
      shortage: m.quantity == null ? null : m.quantity - needTotal, state };
  });
  const materialStateFor = (product) => {
    const rel = materialRows.filter(m => m.product === product || m.product === '共通');
    if (rel.some(m => m.state === 'short')) return 'short';
    if (rel.some(m => m.state === 'unknown')) return 'unknown';
    if (rel.some(m => m.state === 'low')) return 'low';
    return 'ok';
  };

  const today = new Date();
  const rows = products.map(p => {
    const snap = latest[p.id];
    const fulfillable = snap ? snap.fulfillable : null;
    const inbound = snap ? snap.inbound : 0;
    const sw = salesByAsin[p.asin] || {};
    const u90 = sw[90] ? sw[90].units : null;
    const u30 = sw[30] ? sw[30].units : null;
    let daily = null, dailySrc = null;
    if (u90 !== null) { daily = u90 / 90; dailySrc = '90日平均'; }
    else if (u30 !== null) { daily = u30 / 30; dailySrc = '30日平均'; }

    const byStatus = { ordered: 0, inspecting: 0, ready: 0, shipping: 0 };
    for (const l of lots) if (l.product_id === p.id && byStatus[l.status] !== undefined) byStatus[l.status] += l.qty;
    const pipeline = byStatus.ordered + byStatus.inspecting + byStatus.ready + byStatus.shipping;
    const blocking = byStatus.ordered + byStatus.inspecting + byStatus.ready;
    const amazonTotal = (fulfillable || 0) + (inbound || 0);
    const total = amazonTotal + pipeline;

    const warnings = [];
    let status, amazonDays = null, totalDays = null, stockoutDate = null, recommended = 0, need = null;
    if (p.discontinued) {
      status = 'discontinued';
      if (daily > 0) { amazonDays = Math.round(amazonTotal / daily); totalDays = Math.round(total / daily); }
    } else if (fulfillable === null) {
      status = 'no_snapshot';
      warnings.push('Amazon在庫が未取得です（在庫を更新してください）');
    } else if (daily === null) {
      status = 'unknown';
      warnings.push('販売実績が未取得のため日販を計算できません');
    } else if (daily <= 0) {
      status = 'ok';
      warnings.push('過去90日の販売が0。在庫切れ期間が長い場合は実需を見誤るので確認してください');
    } else {
      amazonDays = Math.round(amazonTotal / daily);
      totalDays = Math.round(total / daily);
      stockoutDate = toDate(addDays(today, Math.floor(total / daily)));
      need = daily * horizon;
      const raw = need - total;
      recommended = raw <= 0 ? 0 : Math.max(ceilTo(raw, lot), s.min_qty || 0);
      if (blocking > 0) status = 'ordered';
      else if (totalDays <= thresholdNow) status = 'now';
      else if (totalDays <= thresholdPrep) status = 'prepare';
      else status = 'ok';
      if (u30 !== null && u90) {
        const d30 = u30 / 30;
        if (d30 > daily * 1.4) warnings.push(`直近30日の日販(${d30.toFixed(1)})が90日平均より4割以上高い。加速中`);
        else if (d30 < daily * 0.6) warnings.push(`直近30日の日販(${d30.toFixed(1)})が90日平均より4割以上低い。減速中`);
      }
      if (amazonDays < lt && blocking === 0 && byStatus.shipping === 0) {
        warnings.push(`今日発注しても到着前に約${lt - amazonDays}日の在庫切れ見込み。航空便・販売抑制を検討`);
      }
      if (status === 'ordered') recommended = 0;
    }
    return {
      id: p.id, product: p.product, color: p.color, size: p.size, asin: p.asin, seller_sku: p.seller_sku,
      discontinued: p.discontinued, active: p.active, note: p.note,
      fulfillable, inbound, reserved: snap ? snap.reserved : null, fetched_at: snap ? snap.fetched_at : null,
      units_90d: u90, units_30d: u30, daily, daily_src: dailySrc,
      amazon_days: amazonDays, ordered: byStatus.ordered, inspecting: byStatus.inspecting, ready: byStatus.ready,
      shipping: byStatus.shipping, pipeline, total, total_days: totalDays, stockout_date: stockoutDate,
      status, recommended, material_state: materialStateFor(p.product), warnings,
    };
  });

  // 色単位の標準ロット（例：リストラップ黒＝1,000個/回）
  const stdLots = s.color_standard_lots || {};
  const groups = {};
  for (const r of rows) (groups[`${r.product}|${r.color}`] = groups[`${r.product}|${r.color}`] || []).push(r);
  for (const [key, grp] of Object.entries(groups)) {
    const std = stdLots[key];
    if (!std || !grp.some(r => r.status === 'now')) continue;
    const ok = grp.filter(r => r.daily > 0 && !r.discontinued && r.status !== 'ordered');
    const sum = ok.reduce((a, r) => a + r.recommended, 0);
    if (!ok.length || sum >= std) continue;
    const needMore = std - sum, dsum = ok.reduce((a, r) => a + r.daily, 0);
    let added = 0;
    ok.forEach((r, i) => {
      const add = i === ok.length - 1 ? needMore - added : Math.round(needMore * r.daily / dsum / lot) * lot;
      r.recommended += add; added += add;
      if (r.status !== 'now') { r.status = 'now'; r.warnings.push(`同色の標準ロット（${std}個/回）に合わせて今回の発注に同乗`); }
    });
    ok[0].warnings.push(`${key.replace('|', ' ')}：同色合計を標準ロット ${std}個 に引き上げ（段階価格の条件）`);
  }

  const order = { now: 0, prepare: 1, ordered: 2, unknown: 3, no_snapshot: 3, ok: 4, discontinued: 5 };
  rows.sort((a, b) => (order[a.status] - order[b.status]) || ((a.total_days ?? 1e9) - (b.total_days ?? 1e9)));
  return { rows, materials: materialRows, settings: s, status_labels: STATUS_LABELS };
}

// ---------------------------------------------------------------------------
// SP-API: FBA在庫スナップショット
// ---------------------------------------------------------------------------
async function syncAmazonInventory() {
  const sb = getSupabase();
  const { token, endpoint, marketplaceId } = await getAccessToken();
  const items = [];
  let nextToken = null;
  do {
    const params = new URLSearchParams({ details: 'true', granularityType: 'Marketplace', granularityId: marketplaceId, marketplaceIds: marketplaceId });
    if (nextToken) params.set('nextToken', nextToken);
    let response;
    for (let retry = 0; retry < 4; retry++) {
      try {
        response = await axios.get(`${endpoint}/fba/inventory/v1/summaries?${params}`, { headers: { 'x-amz-access-token': token } });
        break;
      } catch (e) {
        if (e.response?.status === 429 && retry < 3) { await new Promise(r => setTimeout(r, (retry + 1) * 2000)); continue; }
        throw e;
      }
    }
    items.push(...(response.data.payload?.inventorySummaries || []));
    nextToken = response.data.pagination?.nextToken || null;
  } while (nextToken);

  const { data: products } = await sb.from('inventory_products').select('id, asin, seller_sku');
  const byAsin = {}; for (const p of products || []) if (p.asin) byAsin[p.asin] = p;
  const agg = {}; // asin → 合計（同一ASINに複数SKUがあれば合算）
  const unknown = [];
  for (const it of items) {
    const d = it.inventoryDetails || {};
    const rec = {
      fulfillable: d.fulfillableQuantity ?? 0,
      inbound: (d.inboundWorkingQuantity ?? 0) + (d.inboundShippedQuantity ?? 0) + (d.inboundReceivingQuantity ?? 0),
      reserved: d.reservedQuantity?.totalReservedQuantity ?? 0,
    };
    if (byAsin[it.asin]) {
      const a = (agg[it.asin] = agg[it.asin] || { fulfillable: 0, inbound: 0, reserved: 0, sku: it.sellerSku });
      a.fulfillable += rec.fulfillable; a.inbound += rec.inbound; a.reserved += rec.reserved;
    } else if (/FITPEAK/i.test(it.productName || '') && (it.totalQuantity || rec.inbound) > 0) {
      unknown.push({ asin: it.asin, sku: it.sellerSku, name: it.productName, ...rec });
    }
  }
  const now = new Date().toISOString();
  const snapRows = Object.entries(agg).map(([asin, a]) => ({ product_id: byAsin[asin].id, fulfillable: a.fulfillable, inbound: a.inbound, reserved: a.reserved, fetched_at: now }));
  if (snapRows.length) await sb.from('inventory_amazon_snapshots').insert(snapRows);
  for (const [asin, a] of Object.entries(agg)) if (a.sku && !byAsin[asin].seller_sku) await sb.from('inventory_products').update({ seller_sku: a.sku }).eq('id', byAsin[asin].id);
  // 未登録のFITPEAK商品は「未整理」として登録（管理画面で商品名・色・サイズを整える）
  for (const u of unknown) {
    const { data: created } = await sb.from('inventory_products')
      .upsert({ product: '未整理', color: u.asin, size: '', asin: u.asin, seller_sku: u.sku, active: false, note: u.name, sort_order: 999 }, { onConflict: 'product,color,size' })
      .select('id').maybeSingle();
    if (created) await sb.from('inventory_amazon_snapshots').insert({ product_id: created.id, fulfillable: u.fulfillable, inbound: u.inbound, reserved: u.reserved, fetched_at: now });
  }
  await sb.from('inventory_settings').update({ last_inventory_sync: now }).eq('id', 1);
  return { matched: snapRows.length, unknown: unknown.length, total_items: items.length };
}

// ---------------------------------------------------------------------------
// SP-API: 売上・トラフィックレポート（子ASIN別・期間合計）
// ---------------------------------------------------------------------------
async function requestSalesReport(windowDays) {
  const sb = getSupabase();
  const { token, endpoint, marketplaceId } = await getAccessToken();
  const end = addDays(new Date(), -1);          // 昨日まで（当日は集計未確定）
  const start = addDays(end, -(windowDays - 1));
  const body = {
    reportType: 'GET_SALES_AND_TRAFFIC_REPORT',
    reportOptions: { dateGranularity: 'DAY', asinGranularity: 'CHILD' },
    dataStartTime: `${toDate(start)}T00:00:00Z`,
    dataEndTime: `${toDate(end)}T23:59:59Z`,
    marketplaceIds: [marketplaceId],
  };
  const r = await axios.post(`${endpoint}/reports/2021-06-30/reports`, body, { headers: { 'x-amz-access-token': token, 'Content-Type': 'application/json' } });
  const { data } = await sb.from('inventory_report_jobs').insert({
    report_id: r.data.reportId, window_days: windowDays, period_start: toDate(start), period_end: toDate(end), status: 'requested',
  }).select('*').single();
  return data;
}

async function processReportJobs() {
  const sb = getSupabase();
  const { data: jobs } = await sb.from('inventory_report_jobs').select('*').eq('status', 'requested').order('created_at').limit(5);
  if (!jobs || !jobs.length) return { processed: 0 };
  const { token, endpoint } = await getAccessToken();
  const headers = { 'x-amz-access-token': token };
  let processed = 0;
  for (const job of jobs) {
    try {
      const st = await axios.get(`${endpoint}/reports/2021-06-30/reports/${job.report_id}`, { headers });
      const ps = st.data.processingStatus;
      if (ps === 'IN_QUEUE' || ps === 'IN_PROGRESS') continue;
      if (ps !== 'DONE') {
        await sb.from('inventory_report_jobs').update({ status: 'failed', error: `processingStatus=${ps}`, updated_at: new Date().toISOString() }).eq('id', job.id);
        continue;
      }
      const doc = await axios.get(`${endpoint}/reports/2021-06-30/documents/${st.data.reportDocumentId}`, { headers });
      const raw = await axios.get(doc.data.url, { responseType: 'arraybuffer' });
      let buf = Buffer.from(raw.data);
      if (doc.data.compressionAlgorithm === 'GZIP') buf = zlib.gunzipSync(buf);
      const json = JSON.parse(buf.toString('utf8'));
      const byAsin = {};
      for (const e of json.salesAndTrafficByAsin || []) {
        const asin = e.childAsin || e.parentAsin; if (!asin) continue;
        const a = (byAsin[asin] = byAsin[asin] || { units: 0, amount: 0 });
        a.units += e.salesByAsin?.unitsOrdered || 0;
        a.amount += Number(e.salesByAsin?.orderedProductSales?.amount || 0);
      }
      const rows = Object.entries(byAsin).map(([asin, a]) => ({
        asin, window_days: job.window_days, period_start: job.period_start, period_end: job.period_end,
        units: a.units, sales_amount: a.amount, fetched_at: new Date().toISOString(),
      }));
      // 期間内に売上0のASIN（登録済み）も0で埋める
      const { data: products } = await sb.from('inventory_products').select('asin');
      for (const p of products || []) if (p.asin && !byAsin[p.asin]) rows.push({ asin: p.asin, window_days: job.window_days, period_start: job.period_start, period_end: job.period_end, units: 0, sales_amount: 0, fetched_at: new Date().toISOString() });
      if (rows.length) await sb.from('inventory_sales_windows').upsert(rows, { onConflict: 'asin,window_days' });
      await sb.from('inventory_report_jobs').update({ status: 'done', updated_at: new Date().toISOString() }).eq('id', job.id);
      await sb.from('inventory_settings').update({ last_sales_sync_date: job.period_end }).eq('id', 1);
      processed++;
    } catch (e) {
      const msg = e.response?.data ? JSON.stringify(e.response.data).slice(0, 500) : e.message;
      await sb.from('inventory_report_jobs').update({ status: 'failed', error: msg, updated_at: new Date().toISOString() }).eq('id', job.id);
    }
  }
  return { processed };
}

// ---------------------------------------------------------------------------
// 管理API
// ---------------------------------------------------------------------------
router.get('/dashboard', async (req, res) => {
  try { res.json(computeDashboard(await loadAll())); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/lots', async (req, res) => {
  try {
    const sb = getSupabase();
    const { data } = await sb.from('inventory_lots').select('*, inventory_products(product,color,size,asin)').order('created_at', { ascending: false }).limit(500);
    res.json({ lots: data || [], status_labels: STATUS_LABELS });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

async function createLot(body, who) {
  const sb = getSupabase();
  const qty = parseInt(body.qty, 10);
  if (!body.product_id || !qty) throw new Error('商品と数量は必須です');
  const status = STATUS_LABELS[body.status] ? body.status : 'ordered';
  const { data, error } = await sb.from('inventory_lots').insert({
    lot_code: body.lot_code || null, product_id: body.product_id, qty, status,
    ordered_at: body.ordered_at || toDate(new Date()), updated_by: body.updated_by || who || null,
    tracking: body.tracking || null, note: body.note || null, status_updated_at: new Date().toISOString(),
  }).select('*').single();
  if (error) throw new Error(error.message);
  return data;
}
async function updateLot(id, body, who) {
  const sb = getSupabase();
  const patch = {};
  if (body.status !== undefined) { if (!STATUS_LABELS[body.status]) throw new Error('不正なステータス'); patch.status = body.status; patch.status_updated_at = new Date().toISOString(); }
  if (body.qty !== undefined) patch.qty = parseInt(body.qty, 10);
  for (const k of ['lot_code', 'tracking', 'note', 'ordered_at']) if (body[k] !== undefined) patch[k] = body[k] || null;
  patch.updated_by = body.updated_by || who || null;
  const { data, error } = await sb.from('inventory_lots').update(patch).eq('id', id).select('*').single();
  if (error) throw new Error(error.message);
  return data;
}
async function updateMaterial(id, body, who) {
  const sb = getSupabase();
  const { data: cur } = await sb.from('inventory_materials').select('*').eq('id', id).maybeSingle();
  if (!cur) throw new Error('資材が見つかりません');
  const patch = { updated_by: body.updated_by || who || null, updated_at: new Date().toISOString() };
  if (body.quantity !== undefined && body.quantity !== null && body.quantity !== '') patch.quantity = parseInt(body.quantity, 10);
  if (body.delta) patch.quantity = (cur.quantity || 0) + parseInt(body.delta, 10);
  if (body.note !== undefined) patch.note = body.note || null;
  const { data, error } = await sb.from('inventory_materials').update(patch).eq('id', id).select('*').single();
  if (error) throw new Error(error.message);
  if (patch.quantity !== undefined && patch.quantity !== cur.quantity) {
    await sb.from('inventory_material_logs').insert({ material_id: id, delta: patch.quantity - (cur.quantity || 0), reason: body.reason || (body.delta ? '入出庫' : '数量更新'), created_by: patch.updated_by });
  }
  return data;
}

router.post('/lots', async (req, res) => { try { res.json(await createLot(req.body, '宇良')); } catch (e) { res.status(400).json({ error: e.message }); } });
router.patch('/lots/:id', async (req, res) => { try { res.json(await updateLot(req.params.id, req.body, '宇良')); } catch (e) { res.status(400).json({ error: e.message }); } });
router.delete('/lots/:id', async (req, res) => {
  try { await getSupabase().from('inventory_lots').delete().eq('id', req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/materials', async (req, res) => {
  try { const d = computeDashboard(await loadAll()); res.json({ materials: d.materials }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/materials', async (req, res) => {
  try {
    const b = req.body || {};
    const { data, error } = await getSupabase().from('inventory_materials').insert({ product: b.product || '共通', name: b.name, unit: b.unit || '枚', per_unit: b.per_unit || 1, sort_order: b.sort_order || 99 }).select('*').single();
    if (error) throw new Error(error.message);
    res.json(data);
  } catch (e) { res.status(400).json({ error: e.message }); }
});
router.patch('/materials/:id', async (req, res) => { try { res.json(await updateMaterial(req.params.id, req.body, '宇良')); } catch (e) { res.status(400).json({ error: e.message }); } });
router.delete('/materials/:id', async (req, res) => {
  try { await getSupabase().from('inventory_materials').delete().eq('id', req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.get('/materials/:id/logs', async (req, res) => {
  try { const { data } = await getSupabase().from('inventory_material_logs').select('*').eq('material_id', req.params.id).order('created_at', { ascending: false }).limit(100); res.json({ logs: data || [] }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/products', async (req, res) => {
  try { const { data } = await getSupabase().from('inventory_products').select('*').order('sort_order'); res.json({ products: data || [] }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/products', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.product) throw new Error('商品名は必須です');
    const { data, error } = await getSupabase().from('inventory_products').insert({ product: b.product, color: b.color || '', size: b.size || '', asin: b.asin || null, seller_sku: b.seller_sku || null, sort_order: b.sort_order || 99, discontinued: !!b.discontinued, note: b.note || null }).select('*').single();
    if (error) throw new Error(error.message);
    res.json(data);
  } catch (e) { res.status(400).json({ error: e.message }); }
});
router.patch('/products/:id', async (req, res) => {
  try {
    const b = req.body || {}; const patch = { updated_at: new Date().toISOString() };
    for (const k of ['product', 'color', 'size', 'asin', 'seller_sku', 'sort_order', 'discontinued', 'active', 'note']) if (b[k] !== undefined) patch[k] = b[k] === '' && (k === 'asin' || k === 'seller_sku' || k === 'note') ? null : b[k];
    const { data, error } = await getSupabase().from('inventory_products').update(patch).eq('id', req.params.id).select('*').single();
    if (error) throw new Error(error.message);
    res.json(data);
  } catch (e) { res.status(400).json({ error: e.message }); }
});
router.delete('/products/:id', async (req, res) => {
  try {
    const { error } = await getSupabase().from('inventory_products').delete().eq('id', req.params.id);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.get('/settings', async (req, res) => { try { res.json(await getSettings()); } catch (e) { res.status(500).json({ error: e.message }); } });
router.patch('/settings', async (req, res) => {
  try {
    const b = req.body || {}; const patch = { updated_at: new Date().toISOString() };
    for (const k of ['lead_time_days', 'safety_days', 'coverage_days', 'prepare_days', 'lot_size', 'min_qty', 'material_buffer_units']) if (b[k] !== undefined) patch[k] = parseInt(b[k], 10);
    for (const k of ['partner_name', 'chatwork_room_id', 'chatwork_template']) if (b[k] !== undefined) patch[k] = b[k] || null;
    if (b.color_standard_lots !== undefined) patch.color_standard_lots = b.color_standard_lots;
    if (b.regenerate_key) patch.partner_key = require('crypto').randomBytes(16).toString('hex');
    const { data, error } = await getSupabase().from('inventory_settings').update(patch).eq('id', 1).select('*').single();
    if (error) throw new Error(error.message);
    res.json(data);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/sync/amazon-inventory', async (req, res) => {
  try { res.json(await syncAmazonInventory()); }
  catch (e) { res.status(500).json({ error: e.response?.data ? JSON.stringify(e.response.data) : e.message }); }
});
router.post('/sync/sales', async (req, res) => {
  try {
    const jobs = [];
    for (const w of [90, 30]) jobs.push(await requestSalesReport(w));
    res.json({ jobs });
  } catch (e) { res.status(500).json({ error: e.response?.data ? JSON.stringify(e.response.data) : e.message }); }
});
router.post('/sync/process-reports', async (req, res) => {
  try { res.json(await processReportJobs()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.get('/sync/status', async (req, res) => {
  try {
    const sb = getSupabase();
    const [{ data: jobs }, settings] = await Promise.all([sb.from('inventory_report_jobs').select('*').order('created_at', { ascending: false }).limit(10), getSettings()]);
    res.json({ jobs: jobs || [], last_inventory_sync: settings.last_inventory_sync, last_sales_sync_date: settings.last_sales_sync_date });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Chatwork：資材残数の確認メッセージを投稿
router.get('/chatwork/rooms', async (req, res) => {
  try { const r = await axios.get(`${CHATWORK_BASE_URL}/rooms`, { headers: getChatworkHeaders() }); res.json({ rooms: (r.data || []).map(x => ({ room_id: x.room_id, name: x.name, type: x.type })) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/chatwork/ask-materials', async (req, res) => {
  try {
    const s = await getSettings();
    const roomId = req.body?.room_id || s.chatwork_room_id;
    if (!roomId) throw new Error('Chatworkのルームが未設定です（設定タブで選択）');
    const base = (process.env.PUBLIC_BASE_URL || req.headers.origin || `https://${req.headers.host}`).replace(/\/$/, '');
    const link = `${base}/inventory-partner?k=${s.partner_key}`;
    const body = (req.body?.message || s.chatwork_template || '資材の残数を教えてください。') + `\n${link}`;
    const r = await axios.post(`${CHATWORK_BASE_URL}/rooms/${roomId}/messages`, new URLSearchParams({ body }).toString(), { headers: { ...getChatworkHeaders(), 'Content-Type': 'application/x-www-form-urlencoded' } });
    res.json({ ok: true, message_id: r.data?.message_id });
  } catch (e) { res.status(500).json({ error: e.response?.data ? JSON.stringify(e.response.data) : e.message }); }
});

// 発注候補（fitpeak-order の orders.json 形式）
router.get('/order-proposal', async (req, res) => {
  try {
    const d = computeDashboard(await loadAll());
    const orders = d.rows.filter(r => r.status === 'now' && r.recommended > 0).map(r => ({ product: r.product, color: r.color, size: r.size, qty: r.recommended, asin: r.asin }));
    res.json({ orders, generated_at: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// cron（10分ごとに呼ばれる）：レポート取り込みは毎回、在庫・販売の再取得は1日1回
router.get('/cron', async (req, res) => {
  const result = {};
  try {
    result.reports = await processReportJobs();
    const s = await getSettings();
    const last = s.last_inventory_sync ? new Date(s.last_inventory_sync).getTime() : 0;
    if (Date.now() - last > 20 * 60 * 60 * 1000) {
      result.inventory = await syncAmazonInventory();
      const { data: pending } = await getSupabase().from('inventory_report_jobs').select('id').eq('status', 'requested');
      if (!pending || !pending.length) { result.sales = []; for (const w of [90, 30]) result.sales.push((await requestSalesReport(w)).id); }
    }
    res.json({ ok: true, ...result });
  } catch (e) { console.error('[inventory/cron]', e.message); res.status(500).json({ error: e.message, ...result }); }
});

// ---------------------------------------------------------------------------
// 公開API（たお太郎 担当者用・キー付き）
// ---------------------------------------------------------------------------
async function checkKey(req, res, next) {
  try {
    const s = await getSettings();
    const key = String(req.params.key || '');
    if (!key || !s.partner_key || key !== s.partner_key) return res.status(403).json({ error: 'invalid key' });
    req.inventorySettings = s; next();
  } catch (e) { res.status(500).json({ error: e.message }); }
}
publicRouter.get('/:key/context', checkKey, async (req, res) => {
  try {
    const all = await loadAll();
    const d = computeDashboard(all);
    const products = all.products.filter(p => p.active).map(p => ({ id: p.id, product: p.product, color: p.color, size: p.size, discontinued: p.discontinued }));
    const lots = all.lots.filter(l => OPEN_STATUSES.includes(l.status)).map(l => {
      const p = all.products.find(x => x.id === l.product_id) || {};
      return { ...l, product: p.product, color: p.color, size: p.size };
    });
    // 原価・売上は渡さない
    const materials = d.materials.map(m => ({ id: m.id, product: m.product, name: m.name, unit: m.unit, quantity: m.quantity, updated_at: m.updated_at, updated_by: m.updated_by, note: m.note, pipeline_need: m.pipeline_need, need_total: m.need_total, state: m.state }));
    res.json({ partner_name: req.inventorySettings.partner_name, products, lots, materials, status_labels: STATUS_LABELS });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
publicRouter.post('/:key/lots', checkKey, async (req, res) => { try { res.json(await createLot(req.body, req.inventorySettings.partner_name)); } catch (e) { res.status(400).json({ error: e.message }); } });
publicRouter.patch('/:key/lots/:id', checkKey, async (req, res) => { try { res.json(await updateLot(req.params.id, req.body, req.inventorySettings.partner_name)); } catch (e) { res.status(400).json({ error: e.message }); } });
publicRouter.patch('/:key/materials/:id', checkKey, async (req, res) => { try { res.json(await updateMaterial(req.params.id, req.body, req.inventorySettings.partner_name)); } catch (e) { res.status(400).json({ error: e.message }); } });

module.exports = router;
module.exports.publicRouter = publicRouter;
module.exports.computeDashboard = computeDashboard;

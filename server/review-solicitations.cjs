// Amazon公式「レビューをリクエスト」ボタンと同じ SP-API Solicitations
// (createProductReviewAndSellerFeedbackSolicitation) を自動で送る。
//
// 規則:
//  - 出荷済み注文のうち、配達(配達予定が無ければ出荷)から delayDays(最低5)〜30日のものだけ
//  - getSolicitationActionsForOrder で送れると返された注文だけ送る
//  - 1注文1回。送信済み(sent / already_sent)は二度と触らない
//  - 送れなかった注文(not_offered / failed)は24時間後に再確認
//  - 1日の上限(日本時間の暦日)を守る
//  - 403(役割不足)なら注文を失敗扱いにせず、必要な役割を返して止まる
// 外部依存(sp / store)は引数で受け取る。実装は amazon-analytics.cjs。

const DAY = 86400000;
const MIN_DAYS = 5;
const MAX_DAYS = 30;
const RECHECK_MS = DAY;
const MAX_CHECKS_PER_RUN = 30;              // 1回の実行で確認する注文数(レート1rps対策)
const DONE = new Set(['sent', 'already_sent']);

const ROLES = [
  [/^\/orders\//, 'Inventory and Order Tracking（在庫と注文の追跡）'],
  [/^\/fba\/inventory\//, 'Amazon Fulfillment（Amazonフルフィルメント）'],
  [/^\/solicitations\//, 'Buyer Solicitation（購入者への依頼）'],
  [/^\/messaging\//, 'Buyer Communication（購入者とのコミュニケーション）'],
  [/^\/reports\//, 'Reports はレポート種類ごとの役割（売上・トラフィックは Brand Analytics）'],
  [/^\/catalog\//, 'Product Listing（商品の出品）'],
];
function roleForPath(path) {
  const hit = ROLES.find(([re]) => re.test(path || ''));
  return hit ? hit[1] : '不明';
}

function jstDayStart(now = new Date()) {
  const jst = new Date(now.getTime() + 9 * 3600000);
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()) - 9 * 3600000);
}

function refDate(o) {
  return o.LatestDeliveryDate || o.EarliestDeliveryDate || o.LatestShipDate || o.LastUpdateDate || o.PurchaseDate;
}

function pickEligibleOrders(orders, { now = new Date(), minDays = 7, maxDays = MAX_DAYS } = {}) {
  const lo = Math.max(MIN_DAYS, minDays);
  const hi = Math.min(MAX_DAYS, maxDays);
  return (orders || []).filter(o => {
    if (o.OrderStatus !== 'Shipped') return false;
    const t = Date.parse(refDate(o));
    if (!Number.isFinite(t)) return false;
    const days = (now.getTime() - t) / DAY;
    return days >= lo && days <= hi;
  });
}

const isForbidden = (err) => err?.response?.status === 403;
const errMsg = (err) => err?.response?.data?.errors?.[0]?.message || err?.message || String(err);
const isAlreadySent = (msg) => /already|previously|solicitation.*exist|既に/i.test(msg || '');

async function runReviewSolicitations({ sp, store, settings, now = new Date(), sleep = (ms) => new Promise(r => setTimeout(r, ms)), log = () => {} }) {
  if (!settings?.enabled) return { skipped: true, reason: 'Auto-send is disabled' };
  const maxPerDay = settings.maxPerDay || 20;
  const minDays = settings.delayDays || 7;

  const sentToday = await store.countSentSince(jstDayStart(now).toISOString());
  let remaining = maxPerDay - (sentToday || 0);
  if (remaining <= 0) return { skipped: true, reason: 'Daily limit reached', sentToday };

  let orders;
  try {
    orders = await sp.getOrders({ createdAfter: new Date(now.getTime() - (MAX_DAYS + 20) * DAY).toISOString() });
  } catch (err) {
    if (isForbidden(err)) return { error: 'forbidden', api: 'orders', status: 403, role: roleForPath('/orders/') };
    throw err;
  }

  const eligible = pickEligibleOrders(orders, { now, minDays, maxDays: MAX_DAYS });
  const ids = eligible.map(o => o.AmazonOrderId);
  const records = new Map((await store.getRecords(ids)).map(r => [r.amazon_order_id, r]));
  const due = eligible.filter(o => {
    const r = records.get(o.AmazonOrderId);
    if (!r) return true;
    if (DONE.has(r.status)) return false;
    // sending のまま残った行(実行中断)は作成から24時間後、それ以外は最後の確認から24時間後
    const last = r.status === 'sending' ? Date.parse(r.created_at || 0) : Date.parse(r.checked_at || 0);
    return !Number.isFinite(last) || now.getTime() - last >= RECHECK_MS;
  });

  const result = { eligible: eligible.length, checked: 0, sent: 0, notOffered: 0, alreadySent: 0, failed: 0, sentToday: sentToday || 0 };

  for (const o of due.slice(0, MAX_CHECKS_PER_RUN)) {
    if (remaining <= 0) break;
    const id = o.AmazonOrderId;
    const prev = records.get(id);
    if (!(await store.claim(id, prev?.status || null))) continue;
    const stamp = () => new Date().toISOString();
    result.checked++;

    let actions;
    try {
      actions = await sp.getSolicitationActions(id);
    } catch (err) {
      await store.update(id, { status: prev?.status || 'not_offered', checked_at: prev?.checked_at || null, error_message: errMsg(err) });
      if (isForbidden(err)) return { ...result, error: 'forbidden', api: 'solicitations', status: 403, role: roleForPath('/solicitations/') };
      result.failed++;
      await sleep(1100);
      continue;
    }

    if (!actions.includes('productReviewAndSellerFeedback')) {
      await store.update(id, { status: 'not_offered', checked_at: stamp(), error_message: null });
      result.notOffered++;
      await sleep(1100);
      continue;
    }

    try {
      await sp.sendReviewRequest(id);
      await store.update(id, { status: 'sent', sent_at: stamp(), checked_at: stamp(), error_message: null, source: 'auto' });
      result.sent++;
      remaining--;
      log(`sent ${id}`);
    } catch (err) {
      const msg = errMsg(err);
      if (isAlreadySent(msg)) {
        await store.update(id, { status: 'already_sent', checked_at: stamp(), error_message: msg });
        result.alreadySent++;
      } else {
        await store.update(id, { status: 'failed', checked_at: stamp(), error_message: msg });
        if (isForbidden(err)) return { ...result, error: 'forbidden', api: 'solicitations', status: 403, role: roleForPath('/solicitations/') };
        result.failed++;
      }
    }
    await sleep(1100);
  }
  return result;
}

module.exports = { runReviewSolicitations, pickEligibleOrders, jstDayStart, roleForPath, refDate };

// Amazon公式「レビューをリクエスト」(SP-API Solicitations) の自動送信。node server/__tests__/review-solicitations.test.cjs
const assert = require('node:assert/strict');
const { runReviewSolicitations, pickEligibleOrders, jstDayStart, roleForPath } = require('../review-solicitations.cjs');

const now = new Date('2026-10-09T12:00:00Z');
const ago = (d) => new Date(now.getTime() - d * 86400000).toISOString();
const order = (id, deliveredDaysAgo, extra = {}) => ({
  AmazonOrderId: id, OrderStatus: 'Shipped', PurchaseDate: ago(deliveredDaysAgo + 3),
  LatestShipDate: ago(deliveredDaysAgo + 1), LatestDeliveryDate: ago(deliveredDaysAgo), ...extra,
});
const forbidden = () => Object.assign(new Error('Request failed with status code 403'), { response: { status: 403, data: { errors: [{ code: 'Unauthorized' }] } } });

function fakeStore(rows = {}, sentToday = 0) {
  const calls = { claimed: [], updates: [] };
  return {
    calls, rows,
    async getRecords(ids) { return ids.filter(id => rows[id]).map(id => ({ amazon_order_id: id, ...rows[id] })); },
    async countSentSince() { return sentToday; },
    async claim(id) { if (rows[id] && rows[id].status !== 'not_offered' && rows[id].status !== 'failed') return false; rows[id] = { status: 'sending' }; calls.claimed.push(id); return true; },
    async update(id, fields) { rows[id] = { ...rows[id], ...fields }; calls.updates.push([id, fields.status]); },
  };
}
function fakeSp({ orders = [], offered = () => true, sendErr = null, ordersErr = null, actionsErr = null } = {}) {
  const calls = { actions: [], sent: [] };
  return {
    calls,
    async getOrders() { if (ordersErr) throw ordersErr; return orders; },
    async getSolicitationActions(id) { if (actionsErr) throw actionsErr; calls.actions.push(id); return offered(id) ? ['productReviewAndSellerFeedback'] : []; },
    async sendReviewRequest(id) { if (sendErr) throw sendErr; calls.sent.push(id); },
  };
}
const settings = { enabled: true, delayDays: 7, maxPerDay: 20 };
const sleep = async () => {};

(async () => {
  // 1. 対象期間: 配達(無ければ出荷)から delayDays(最低5)〜30日。未出荷・期間外は除外
  const eligible = pickEligibleOrders([
    order('A', 8), order('B', 3), order('C', 31), order('D', 10, { OrderStatus: 'Unshipped' }),
    order('E', 6), order('F', 12, { LatestDeliveryDate: undefined, LatestShipDate: ago(12) }),
  ], { now, minDays: 7, maxDays: 30 });
  assert.deepEqual(eligible.map(o => o.AmazonOrderId), ['A', 'F']);
  assert.deepEqual(pickEligibleOrders([order('E', 6)], { now, minDays: 2, maxDays: 30 }).map(o => o.AmazonOrderId), ['E']);
  assert.deepEqual(pickEligibleOrders([order('G', 4)], { now, minDays: 2, maxDays: 30 }), [], 'never earlier than 5 days');

  // 2. 送れる注文だけ送る。アクションが無い注文は送らず not_offered で記録
  {
    const store = fakeStore();
    const sp = fakeSp({ orders: [order('A', 8), order('B', 9)], offered: id => id === 'A' });
    const r = await runReviewSolicitations({ sp, store, settings, now, sleep });
    assert.deepEqual(sp.calls.sent, ['A']);
    assert.equal(r.sent, 1); assert.equal(r.notOffered, 1);
    assert.equal(store.rows.A.status, 'sent'); assert.equal(store.rows.B.status, 'not_offered');
  }

  // 3. 送信済み(sent/already_sent)は二度と触らない。not_offered は24時間たってから再確認
  {
    const store = fakeStore({ A: { status: 'sent' }, B: { status: 'already_sent' }, C: { status: 'not_offered', checked_at: ago(0.5) }, D: { status: 'not_offered', checked_at: ago(2) } });
    const sp = fakeSp({ orders: ['A', 'B', 'C', 'D'].map(id => order(id, 8)) });
    const r = await runReviewSolicitations({ sp, store, settings, now, sleep });
    assert.deepEqual(sp.calls.actions, ['D']);
    assert.deepEqual(sp.calls.sent, ['D']); assert.equal(r.sent, 1);
  }

  // 4. 1日の上限(JSTの暦日)を守る
  {
    const store = fakeStore({}, 19);
    const sp = fakeSp({ orders: ['A', 'B', 'C'].map(id => order(id, 8)) });
    const r = await runReviewSolicitations({ sp, store, settings, now, sleep });
    assert.equal(sp.calls.sent.length, 1); assert.equal(r.sent, 1);
    const full = fakeStore({}, 20); const sp2 = fakeSp({ orders: [order('A', 8)] });
    const r2 = await runReviewSolicitations({ sp: sp2, store: full, settings, now, sleep });
    assert.equal(r2.skipped, true); assert.equal(sp2.calls.sent.length, 0);
    assert.equal(jstDayStart(new Date('2026-10-09T16:00:00Z')).toISOString(), '2026-10-09T15:00:00.000Z');
  }

  // 5. 無効設定なら何もしない
  {
    const sp = fakeSp({ orders: [order('A', 8)] });
    const r = await runReviewSolicitations({ sp, store: fakeStore(), settings: { enabled: false }, now, sleep });
    assert.equal(r.skipped, true); assert.equal(sp.calls.sent.length, 0);
  }

  // 6. 注文APIが403 → 注文を失敗扱いにせず、必要な役割を返して止まる
  {
    const store = fakeStore();
    const r = await runReviewSolicitations({ sp: fakeSp({ ordersErr: forbidden() }), store, settings, now, sleep });
    assert.equal(r.error, 'forbidden'); assert.equal(r.api, 'orders'); assert.match(r.role, /Inventory and Order Tracking/);
    assert.equal(Object.keys(store.rows).length, 0);
  }
  // 7. Solicitations が403 → 同様に止まり、確保した注文は未送信に戻す(次回再確認できる)
  {
    const store = fakeStore();
    const r = await runReviewSolicitations({ sp: fakeSp({ orders: [order('A', 8)], actionsErr: forbidden() }), store, settings, now, sleep });
    assert.equal(r.error, 'forbidden'); assert.equal(r.api, 'solicitations'); assert.match(r.role, /Buyer Solicitation/);
    assert.notEqual(store.rows.A?.status, 'sent'); assert.notEqual(store.rows.A?.status, 'sending');
  }
  // 8. Amazonが「送信済み」と返したら already_sent で記録して数えない
  {
    const store = fakeStore();
    const err = Object.assign(new Error('x'), { response: { status: 400, data: { errors: [{ message: 'A solicitation has already been sent for this order' }] } } });
    const r = await runReviewSolicitations({ sp: fakeSp({ orders: [order('A', 8)], sendErr: err }), store, settings, now, sleep });
    assert.equal(store.rows.A.status, 'already_sent'); assert.equal(r.sent, 0);
  }
  // 9. 同時実行で既に確保された注文は送らない(二重送信防止)
  {
    const store = fakeStore(); store.claim = async () => false;
    const sp = fakeSp({ orders: [order('A', 8)] });
    await runReviewSolicitations({ sp, store, settings, now, sleep });
    assert.equal(sp.calls.sent.length, 0);
  }
  // 10. 役割の対応表
  assert.match(roleForPath('/fba/inventory/v1/summaries'), /Amazon Fulfillment/);
  assert.match(roleForPath('/reports/2021-06-30/reports'), /Reports/i);

  console.log('OK   review-solicitations');
})().catch(e => { console.error(e); process.exit(1); });

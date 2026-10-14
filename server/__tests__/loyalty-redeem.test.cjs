// ポイントを使う流れ（仕様書 v1 第11項）：割引コードの発行・注文確定・返品・定期請求の割引
// 実行: node --test server/__tests__/loyalty-redeem.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createDb, pgRpc } = require('./helpers/loyalty-pg.cjs');
const loyalty = require('../loyalty.cjs');

let h, base, server, shop, deps, notices;

// Shopify の偽物：クエリの種類ごとに決まった応答を返し、呼び出しを記録する
function fakeShopify() {
  const s = { calls: [], fail: null, orders: {}, contractDiscounts: [], seq: 0 };
  s.call = async (query, vars) => {
    s.calls.push({ query, vars });
    if (s.fail && s.fail.test(query)) throw new Error('Shopify error');
    if (/discountCodeBasicCreate/.test(query)) return { discountCodeBasicCreate: { codeDiscountNode: { id: `gid://shopify/DiscountCodeNode/${++s.seq}` }, userErrors: [] } };
    if (/discountCodeDelete/.test(query)) return { discountCodeDelete: { deletedCodeDiscountId: vars.id, userErrors: [] } };
    if (/subscriptionContractUpdate/.test(query)) return { subscriptionContractUpdate: { draft: { id: 'gid://shopify/SubscriptionDraft/1' }, userErrors: [] } };
    if (/subscriptionDraftDiscountAdd/.test(query)) {
      const id = `gid://shopify/SubscriptionManualDiscount/${++s.seq}`;
      s.contractDiscounts.push({ id, title: vars.input.title });
      return { subscriptionDraftDiscountAdd: { discountAdded: { id }, userErrors: [] } };
    }
    if (/subscriptionDraftDiscountRemove/.test(query)) {
      s.contractDiscounts = s.contractDiscounts.filter((d) => d.id !== vars.discountId);
      return { subscriptionDraftDiscountRemove: { discountRemoved: { id: vars.discountId }, userErrors: [] } };
    }
    if (/subscriptionDraftCommit/.test(query)) return { subscriptionDraftCommit: { contract: { id: 'c' }, userErrors: [] } };
    if (/subscriptionContract\(/.test(query)) return { subscriptionContract: { discounts: { nodes: s.contractDiscounts } } };
    if (/order\(/.test(query)) return { order: s.orders[vars.id] || null };
    throw new Error('unexpected query: ' + query.slice(0, 60));
  };
  s.named = (re) => s.calls.filter((c) => re.test(c.query));
  return s;
}

test.beforeEach(async () => {
  h = await createDb();
  shop = fakeShopify();
  notices = [];
  deps = {
    rpc: pgRpc(h.db),
    findMemberIdByAuthUser: async (authUserId) =>
      (await h.db.query(`select id from members where auth_user_id = $1`, [authUserId])).rows[0]?.id || null,
    findShopifyOrder: async () => null,
    shopify: shop.call,
    findHoldById: async (id) => (await h.db.query(`select * from point_holds where id = $1`, [id])).rows[0] || null,
    findHoldByCode: async (code) => (await h.db.query(`select * from point_holds where discount_code = $1`, [code])).rows[0] || null,
    findUsedHoldsByOrder: async (orderId) =>
      (await h.db.query(`select * from point_holds where shopify_order_id = $1 and status = 'used'`, [orderId])).rows,
    findBillingHold: async (subId, cycleNo) =>
      (await h.db.query(`select * from point_holds where subscription_id = $1 and cycle_no = $2`, [subId, cycleNo])).rows[0] || null,
    memberShopifyCustomerId: async () => null,
    notify: async (text) => { notices.push(text); },
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const u = req.headers['x-test-user'];
    if (u) req.fitpeakUser = JSON.parse(u);
    next();
  });
  app.use('/loyalty', loyalty.createMemberRouter(deps));
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.afterEach(() => new Promise((r) => server.close(r)));

async function customer(points = 0, status = 'active') {
  const authId = (await h.one(`select gen_random_uuid() id`)).id;
  const m = await h.member(status);
  await h.db.query(`update members set auth_user_id = $1 where id = $2`, [authId, m.id]);
  await h.db.query(`update subscriptions set amount = 3000, shopify_contract_id = $2 where id = $1`, [m.subId, '9' + Math.floor(Math.random() * 1e9)]);
  if (points) {
    const req = (await h.one(`select lp_request_adjust($1, $2, 'テスト', 'staff') id`, [m.id, points])).id;
    await h.one(`select lp_approve_adjust($1, 'owner', 'test-pin-1234')`, [req]);
  }
  const sub = await h.one(`select * from subscriptions where id = $1`, [m.subId]);
  return { ...m, sub, user: { id: authId, email: `line_${authId}@line.fitpeak.co` } };
}

function call(method, path, user, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (user) headers['x-test-user'] = JSON.stringify(user);
  return fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
    .then(async (r) => ({ status: r.status, body: await r.json() }));
}

// ── A. 購入時の割引コード ─────────────────────────────────

test('割引コード発行：ポイントを仮押さえし、1回限り・金額固定・24時間弱で切れるコードを作る', async () => {
  const c = await customer(500);
  const r = await call('POST', '/loyalty/redeem', c.user, { points: 300, redirect: '/products/creashot' });
  assert.equal(r.status, 200);
  assert.match(r.body.code, /^MFP[A-HJ-NP-Z2-9]{16}$/);
  assert.equal(r.body.url, `https://fitpeak.co/discount/${r.body.code}?redirect=${encodeURIComponent('/products/creashot')}`);
  assert.equal(await h.balance(c.id), 200);

  const [created] = shop.named(/discountCodeBasicCreate/);
  const input = created.vars.input;
  assert.equal(input.code, r.body.code);
  assert.equal(input.usageLimit, 1);
  assert.equal(input.customerGets.value.discountAmount.amount, '300');
  assert.equal(input.customerGets.value.discountAmount.appliesOnEachItem, false);
  assert.equal(input.customerGets.appliesOnSubscription, true);
  assert.equal(input.recurringCycleLimit, 1, '定期は初回の1回だけ');
  const hold = await h.one(`select expires_at, shopify_discount_id from point_holds where discount_code = $1`, [r.body.code]);
  assert.ok(new Date(input.endsAt) < new Date(hold.expires_at), 'コードは仮押さえより先に切れる');
  assert.equal(hold.shopify_discount_id, 'gid://shopify/DiscountCodeNode/1');
});

test('割引コード発行：ポイント数の不正・残高不足・外部サイトへの戻り先は受け付けない', async () => {
  const c = await customer(100);
  for (const points of [0, -5, 1.5, 'abc', null]) {
    assert.equal((await call('POST', '/loyalty/redeem', c.user, { points })).status, 400, String(points));
  }
  const short = await call('POST', '/loyalty/redeem', c.user, { points: 101 });
  assert.equal(short.status, 400);
  assert.equal(short.body.code, 'insufficient_points');
  for (const redirect of ['//evil.example', 'https://evil.example', 'javascript:alert(1)']) {
    const r = await call('POST', '/loyalty/redeem', c.user, { points: 1, redirect });
    assert.ok(r.body.url.endsWith(`?redirect=${encodeURIComponent('/cart')}`), redirect);
  }
  assert.equal(shop.named(/discountCodeBasicCreate/).length, 3);
});

test('割引コード発行：Shopify で作れなかったら仮押さえを解除してポイントを戻す', async () => {
  const c = await customer(100);
  shop.fail = /discountCodeBasicCreate/;
  const r = await call('POST', '/loyalty/redeem', c.user, { points: 60 });
  assert.equal(r.status, 502);
  assert.equal(await h.balance(c.id), 100);
});

test('割引コードの取り消し：ポイントを戻して Shopify のコードも消す。他人のは消せない', async () => {
  const c = await customer(100);
  const other = await customer(0);
  const r = await call('POST', '/loyalty/redeem', c.user, { points: 60 });
  assert.equal((await call('POST', `/loyalty/redeem/${r.body.hold_id}/cancel`, other.user)).status, 404);
  const ok = await call('POST', `/loyalty/redeem/${r.body.hold_id}/cancel`, c.user);
  assert.equal(ok.status, 200);
  assert.equal(await h.balance(c.id), 100);
  assert.equal(shop.named(/discountCodeDelete/)[0].vars.id, 'gid://shopify/DiscountCodeNode/1');
});

test('注文作成：使われたコードの仮押さえを確定。知らないコードは無視、再配信しても壊れない', async () => {
  const c = await customer(100);
  const r = await call('POST', '/loyalty/redeem', c.user, { points: 60 });
  const order = { id: 7001, discount_codes: [{ code: r.body.code.toLowerCase(), amount: '60.00' }, { code: 'OTHERCODE', amount: '500' }] };
  await loyalty.onOrderCreated(deps, order);
  await loyalty.onOrderCreated(deps, order);
  const hold = await h.one(`select status, used_amount, shopify_order_id from point_holds where discount_code = $1`, [r.body.code]);
  assert.deepEqual([hold.status, hold.used_amount, hold.shopify_order_id], ['used', 60, '7001']);
  assert.equal(await h.balance(c.id), 40);
  assert.equal(notices.length, 0);
});

test('注文作成：カートが少なく一部しか割り引かれなかったら、使った分だけ確定して残りを戻す', async () => {
  const c = await customer(100);
  const r = await call('POST', '/loyalty/redeem', c.user, { points: 60 });
  await loyalty.onOrderCreated(deps, { id: 7002, discount_codes: [{ code: r.body.code, amount: '45' }] });
  assert.equal(await h.balance(c.id), 55);
});

test('注文作成：仮押さえより大きい割引額は確定せず、オーナーに通知する', async () => {
  const c = await customer(100);
  const r = await call('POST', '/loyalty/redeem', c.user, { points: 60 });
  await loyalty.onOrderCreated(deps, { id: 7003, discount_codes: [{ code: r.body.code, amount: '61' }] });
  const hold = await h.one(`select status from point_holds where discount_code = $1`, [r.body.code]);
  assert.equal(hold.status, 'held');
  assert.equal(notices.length, 1);
  assert.match(notices[0], /7003/);
});

test('返品・キャンセル：使ったポイントを返金の割合で戻す。何度呼んでも合計は使った分まで', async () => {
  const c = await customer(1000);
  const r = await call('POST', '/loyalty/redeem', c.user, { points: 1000 });
  await loyalty.onOrderCreated(deps, { id: 8001, discount_codes: [{ code: r.body.code, amount: '1000' }] });
  assert.equal(await h.balance(c.id), 0);
  const gid = 'gid://shopify/Order/8001';
  shop.orders[gid] = { cancelledAt: null, totalPriceSet: { shopMoney: { amount: '5000' } }, totalRefundedSet: { shopMoney: { amount: '2500' } }, lineItems: { nodes: [{ quantity: 2, refundableQuantity: 1 }] } };
  await loyalty.onOrderRefunded(deps, 8001);
  await loyalty.onOrderRefunded(deps, 8001);
  assert.equal(await h.balance(c.id), 500);
  shop.orders[gid] = { ...shop.orders[gid], cancelledAt: '2026-10-15T00:00:00Z' };
  await loyalty.onOrderRefunded(deps, 8001);
  await loyalty.onOrderRefunded(deps, 8001);
  assert.equal(await h.balance(c.id), 1000);
});

test('返金割合の計算', () => {
  const o = (total, refunded, qty = 1, refundable = 1, cancelled = null) => ({
    cancelledAt: cancelled,
    totalPriceSet: { shopMoney: { amount: String(total) } },
    totalRefundedSet: { shopMoney: { amount: String(refunded) } },
    lineItems: { nodes: [{ quantity: qty, refundableQuantity: refundable }] },
  });
  assert.equal(loyalty.computeRefundTarget(o(5000, 0), 1000), 0);
  assert.equal(loyalty.computeRefundTarget(o(5000, 1000), 999), 199);
  assert.equal(loyalty.computeRefundTarget(o(5000, 9999), 1000), 1000);
  assert.equal(loyalty.computeRefundTarget(o(5000, 0, 1, 1, '2026-10-15'), 1000), 1000);
  assert.equal(loyalty.computeRefundTarget(o(0, 0, 4, 1), 1000), 750, '全額ポイント払いは返品した個数の割合');
});

// ── B. 定期の請求 ─────────────────────────────────────

test('請求での利用設定：本人の契約だけ変えられる', async () => {
  const c = await customer(100);
  const other = await customer(0);
  assert.equal((await call('PUT', `/loyalty/billing-prefs/${c.subId}`, other.user, { mode: 'all' })).status, 404);
  assert.equal((await call('PUT', `/loyalty/billing-prefs/${c.subId}`, c.user, { mode: 'fixed', points: 0 })).status, 400);
  assert.equal((await call('PUT', `/loyalty/billing-prefs/${c.subId}`, c.user, { mode: 'fixed', points: 50 })).status, 200);
  const g = await call('GET', '/loyalty/billing-prefs', c.user);
  assert.equal(g.body[0].mode, 'fixed');
  assert.equal(g.body[0].points, 50);
});

test('請求直前：設定があれば契約に1回限りの割引を付ける。やり直しても二重に付けない', async () => {
  const c = await customer(100);
  await h.one(`select lp_set_billing_pref($1, $2, 'all', null)`, [c.id, c.subId]);
  const r1 = await loyalty.prepareBillingDiscount(deps, c.sub, 2);
  assert.equal(r1.amount, 100);
  const [added] = shop.named(/subscriptionDraftDiscountAdd/);
  assert.equal(added.vars.input.value.fixedAmount.amount, 100);
  assert.equal(added.vars.input.recurringCycleLimit, 1);
  assert.equal(shop.named(/subscriptionDraftCommit/).length, 1);
  await loyalty.prepareBillingDiscount(deps, c.sub, 2);
  assert.equal(shop.named(/subscriptionDraftDiscountAdd/).length, 1);
  assert.equal(await h.balance(c.id), 0);
});

test('請求直前：割引は付いたのに記録に失敗していたら、契約の割引を見つけて記録し直す（二重に付けない）', async () => {
  const c = await customer(100);
  await h.one(`select lp_set_billing_pref($1, $2, 'fixed', 40)`, [c.id, c.subId]);
  const held = (await h.one(`select lp_hold_for_billing($1, 2, 3000) r`, [c.subId])).r;
  shop.contractDiscounts.push({ id: 'gid://shopify/SubscriptionManualDiscount/77', title: `My FITPEAKポイント（${held.hold_id}）` });
  await loyalty.prepareBillingDiscount(deps, c.sub, 2);
  assert.equal(shop.named(/subscriptionDraftDiscountAdd/).length, 0);
  const hold = await h.one(`select shopify_discount_id from point_holds where id = $1`, [held.hold_id]);
  assert.equal(hold.shopify_discount_id, 'gid://shopify/SubscriptionManualDiscount/77');
});

test('請求直前：Shopify で割引を付けられなければ、ポイントを戻して通常どおり請求させる', async () => {
  const c = await customer(100);
  await h.one(`select lp_set_billing_pref($1, $2, 'all', null)`, [c.id, c.subId]);
  shop.fail = /subscriptionDraftDiscountAdd/;
  const r = await loyalty.prepareBillingDiscount(deps, c.sub, 2);
  assert.equal(r, null);
  assert.equal(await h.balance(c.id), 100);
});

test('課金成功：注文の割引額で確定。課金が最終的に失敗したら、ポイントを戻して契約の割引も外す', async () => {
  const c = await customer(200);
  await h.one(`select lp_set_billing_pref($1, $2, 'fixed', 80)`, [c.id, c.subId]);
  await loyalty.prepareBillingDiscount(deps, c.sub, 2);
  shop.orders['gid://shopify/Order/9001'] = { totalDiscountsSet: { shopMoney: { amount: '80.0' } } };
  await loyalty.onBillingSucceeded(deps, c.sub, 2, '9001');
  const used = await h.one(`select status, used_amount from point_holds where subscription_id = $1 and cycle_no = 2`, [c.subId]);
  assert.deepEqual([used.status, used.used_amount], ['used', 80]);

  await loyalty.prepareBillingDiscount(deps, c.sub, 3);
  assert.equal(shop.contractDiscounts.length, 2);
  await loyalty.onBillingExhausted(deps, c.sub, 3);
  assert.equal(await h.balance(c.id), 120);
  assert.equal(shop.named(/subscriptionDraftDiscountRemove/).length, 1);
});

test('解約：使われていない定期の仮押さえを戻し、契約の割引を外す', async () => {
  const c = await customer(200);
  await h.one(`select lp_set_billing_pref($1, $2, 'fixed', 80)`, [c.id, c.subId]);
  await loyalty.prepareBillingDiscount(deps, c.sub, 2);
  await loyalty.onSubscriptionCancelled(deps, c.sub);
  assert.equal(await h.balance(c.id), 200);
  assert.equal(shop.named(/subscriptionDraftDiscountRemove/).length, 1);
});

// 毎日のログインポイント＋クレアショットチャレンジ：API層のテスト
// 実行: node --test server/__tests__/loyalty-api.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createDb, pgRpc } = require('./helpers/loyalty-pg.cjs');
const { createMemberRouter, createAdminRouter } = require('../loyalty.cjs');

let h, base, server, orders;

async function startApp() {
  const app = express();
  app.use(express.json());
  // my-fitpeak-auth.cjs の代わり：テストではヘッダーで本人を決める（本番は Supabase の JWT 検証）
  app.use((req, _res, next) => {
    const u = req.headers['x-test-user'];
    if (u) req.fitpeakUser = JSON.parse(u);
    next();
  });
  const deps = {
    rpc: pgRpc(h.db),
    findMemberIdByAuthUser: async (authUserId) =>
      (await h.db.query(`select id from members where auth_user_id = $1`, [authUserId])).rows[0]?.id || null,
    findShopifyOrder: async (num) => orders[num] || null,
  };
  app.use('/loyalty', createMemberRouter(deps));
  app.use('/admin/loyalty', createAdminRouter(deps));
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
}

test.beforeEach(async () => {
  h = await createDb();
  orders = {};
  await startApp();
});
test.afterEach(() => new Promise((r) => server.close(r)));

async function customer(status = 'active', extra = {}) {
  const authId = (await h.one(`select gen_random_uuid() id`)).id;
  const m = await h.member(status);
  await h.db.query(`update members set auth_user_id = $1 where id = $2`, [authId, m.id]);
  return { ...m, user: { id: authId, email: `line_${authId}@line.fitpeak.co`, ...extra } };
}

function call(method, path, user, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (user) headers['x-test-user'] = JSON.stringify(user);
  return fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
    .then(async (r) => ({ status: r.status, body: await r.json() }));
}

test('ログインしていなければ 401（管理トークンでの代理操作もさせない）', async () => {
  assert.equal((await call('GET', '/loyalty')).status, 401);
  assert.equal((await call('POST', '/loyalty/login')).status, 401);
});

test('会員が見つからなければ 404', async () => {
  const r = await call('POST', '/loyalty/login', { id: '00000000-0000-0000-0000-000000000000', email: 'x@example.com' });
  assert.equal(r.status, 404);
});

test('POST /login で今日の1ptが付き、状態も一緒に返る。2回目は already', async () => {
  const c = await customer();
  const r1 = await call('POST', '/loyalty/login', c.user);
  assert.equal(r1.status, 200);
  assert.equal(r1.body.login.status, 'granted');
  assert.equal(r1.body.status.balance, 1);
  const r2 = await call('POST', '/loyalty/login', c.user);
  assert.equal(r2.body.login.status, 'already');
  assert.equal(r2.body.status.balance, 1);
});

test('画面から送られた会員IDやポイント数は無視する', async () => {
  const c = await customer();
  const other = await customer();
  await call('POST', '/loyalty/login', c.user, { member_id: other.id, points: 1000 });
  assert.equal(await h.balance(c.id), 1);
  assert.equal(await h.balance(other.id), 0);
});

test('チャレンジ：他人の権利は404、形式不正は400、期限切れは410、自分のは結果が返る', async () => {
  const c = await customer();
  const other = await customer();
  const d = await h.loginDays(c.id, 28);
  assert.equal((await call('POST', `/loyalty/challenges/${d.challenge_id}/draw`, other.user)).status, 404);
  assert.equal((await call('POST', `/loyalty/challenges/not-a-uuid/draw`, c.user)).status, 400);
  const ok = await call('POST', `/loyalty/challenges/${d.challenge_id}/draw`, c.user);
  assert.equal(ok.status, 200);
  assert.ok(['win', 'lose'].includes(ok.body.result));

  const c2 = await customer();
  const d2 = await h.loginDays(c2.id, 28);
  await h.addDays(31);
  assert.equal((await call('POST', `/loyalty/challenges/${d2.challenge_id}/draw`, c2.user)).status, 410);
});

test('定期契約の紐づけ：注文番号＋注文時のメールが一致したときだけ。別の会員の契約は 409', async () => {
  const c = await customer(null);
  const other = await customer(null);
  await h.one(`insert into subscriptions (shopify_contract_id, status, first_order_id, shopify_customer_id) values ('gid://c/9', 'active', '9001', '555') returning id`);
  orders['1234'] = { id: '9001', name: '#1234', email: 'Taro@Example.com', customerId: '555' };

  const bad = await call('POST', '/loyalty/link', c.user, { orderNumber: '#1234', email: 'someone@example.com' });
  assert.equal(bad.status, 404);
  const none = await call('POST', '/loyalty/link', c.user, { orderNumber: '#9999', email: 'taro@example.com' });
  assert.equal(none.status, 404);
  const ok = await call('POST', '/loyalty/link', c.user, { orderNumber: '1234', email: ' taro@example.com ' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.linked, 1);
  assert.equal((await call('POST', '/loyalty/login', c.user)).body.login.status, 'granted');
  const taken = await call('POST', '/loyalty/link', other.user, { orderNumber: '1234', email: 'taro@example.com' });
  assert.equal(taken.status, 409);
});

test('紐づけの試行は1時間に10回まで', async () => {
  const c = await customer(null);
  for (let i = 0; i < 10; i++) {
    assert.equal((await call('POST', '/loyalty/link', c.user, { orderNumber: '1', email: 'a@example.com' })).status, 404);
  }
  assert.equal((await call('POST', '/loyalty/link', c.user, { orderNumber: '1', email: 'a@example.com' })).status, 429);
});

test('確認済みのメールでログインしている人は、同じメールの契約が自動で紐づく（未確認なら紐づけない）', async () => {
  const unconfirmed = await customer(null, { email: 'hanako@example.com' });
  await h.one(`insert into subscriptions (shopify_contract_id, status, email) values ('gid://c/10', 'active', 'hanako@example.com') returning id`);
  assert.equal((await call('POST', '/loyalty/login', unconfirmed.user)).body.login.status, 'not_eligible');
  const confirmed = await customer(null, { email: 'hanako@example.com', email_confirmed_at: '2026-10-01T00:00:00Z' });
  assert.equal((await call('POST', '/loyalty/login', confirmed.user)).body.login.status, 'granted');
});

test('管理 cron：期限切れのチャレンジ・仮押さえ・ポイントを処理して件数を返す', async () => {
  const c = await customer();
  await h.loginDays(c.id, 28);
  await h.addDays(400);
  const r = await call('POST', '/admin/loyalty/cron');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { expiredChallenges: 1, releasedHolds: 0, expiredPoints: 1 });
});

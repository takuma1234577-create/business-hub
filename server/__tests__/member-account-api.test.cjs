// My FITPEAK アカウントのプロフィール（公開項目）API と、通っているジムの検索
// 実行: node --test server/__tests__/member-account-api.test.cjs
// 非公開項目（本名・メール・住所）はこのAPIを通らない（ブラウザが本人のログインで DB 関数を直接呼ぶ）。
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createDb, pgRpc } = require('./helpers/gotore-pg.cjs');
const { createAccountRouter, searchGyms } = require('../my-fitpeak-account.cjs');

const DIRECTORY = {
  reviews: [{ key: 'one-step-渋谷', name: 'ONE STEP', pref: '東京都', city: '渋谷区' }],
  stores: [['東京都', '渋谷区', 'エニタイムフィットネス 渋谷店'], ['東京都', '新宿区', 'エニタイムフィットネス 新宿店'], ['大阪府', '大阪市', 'JOYFIT24 梅田']],
};

let h, base, server, owner;
test.beforeEach(async () => {
  h = await createDb();
  owner = [];
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { const u = req.headers['x-test-user']; if (u) req.fitpeakUser = JSON.parse(u); next(); });
  app.use('/account', createAccountRouter({
    rpc: pgRpc(h.db),
    findMemberIdByAuthUser: async (id) => (await h.db.query(`select id from members where auth_user_id = $1`, [id])).rows[0]?.id || null,
    directory: async () => DIRECTORY,
    notifyOwner: async (text) => { owner.push(text); },
  }));
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.afterEach(() => new Promise((r) => server.close(r)));

async function user() {
  const authId = (await h.one(`select gen_random_uuid() id`)).id;
  const id = await h.member();
  await h.db.query(`update members set auth_user_id = $1 where id = $2`, [authId, id]);
  return { id, user: { id: authId } };
}
const call = (method, path, u, body) => fetch(base + path, {
  method, headers: { 'Content-Type': 'application/json', ...(u && { 'x-test-user': JSON.stringify(u.user) }) },
  body: body ? JSON.stringify(body) : undefined,
}).then(async (r) => ({ status: r.status, body: await r.json() }));

const PUB = { display_name: 'はな', pref: '東京都', city: '渋谷区', age_band: '25-34', gender: 'female',
  gyms: [{ kind: 'review', key: 'one-step-渋谷' }, { kind: 'store', key: 'store:東京都:渋谷区:エニタイムフィットネス 渋谷店' }] };

test('ジム検索：店舗レビューとチェーン店舗から名前で探す（都道府県で絞れる・最大20件）', () => {
  const r = searchGyms(DIRECTORY, 'エニタイム', '東京都');
  assert.deepEqual(r.map((x) => x.name), ['エニタイムフィットネス 渋谷店', 'エニタイムフィットネス 新宿店']);
  assert.equal(r[0].key, 'store:東京都:渋谷区:エニタイムフィットネス 渋谷店');
  assert.equal(r[0].kind, 'store');
  assert.equal(searchGyms(DIRECTORY, 'one step', '')[0].kind, 'review', '大文字小文字・全角半角を区別しない');
  assert.deepEqual(searchGyms(DIRECTORY, '', '東京都'), [], '空の検索は何も返さない');
});

test('ログインしていなければ 401', async () => {
  assert.equal((await call('GET', '/account/public')).status, 401);
  assert.equal((await call('GET', '/account/gyms?q=x')).status, 401);
});

test('公開項目を保存すると、ジムの名前は収録データの正式名で保存される（送られた名前は信用しない）', async () => {
  const u = await user();
  const r = await call('PUT', '/account/public', u, { ...PUB, gyms: [{ kind: 'review', key: 'one-step-渋谷', name: '偽の名前' }] });
  assert.equal(r.status, 200);
  const g = await call('GET', '/account/public', u);
  assert.equal(g.body.public.gyms[0].name, 'ONE STEP');
  assert.ok(Array.isArray(g.body.missing));
  assert.equal(g.body.private, undefined, 'このAPIは非公開項目を返さない');
});

test('収録データに無いジムのキーは 400', async () => {
  const u = await user();
  const r = await call('PUT', '/account/public', u, { ...PUB, gyms: [{ kind: 'store', key: 'store:東京都:渋谷区:架空ジム' }] });
  assert.equal(r.status, 400);
});

test('「その他」のジムは運営に確認依頼を送る（ジム名と地域だけ。会員の名前や連絡先は送らない）', async () => {
  const u = await user();
  const r = await call('PUT', '/account/public', u, { ...PUB, gyms: [{ kind: 'other', name: '駅前マッスルジム' }] });
  assert.equal(r.status, 200);
  assert.equal(owner.length, 1);
  assert.match(owner[0], /駅前マッスルジム/);
  assert.match(owner[0], /東京都渋谷区/);
  assert.ok(!owner[0].includes('はな'));
  await call('PUT', '/account/public', u, { ...PUB, gyms: [{ kind: 'other', name: '駅前マッスルジム' }] });
  assert.equal(owner.length, 1, '同じジムで何度も送らない');
});

test('入力の誤りは日本語の理由で 400', async () => {
  const u = await user();
  const r = await call('PUT', '/account/public', u, { ...PUB, display_name: 'LINE ID: abc' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /連絡先/);
});

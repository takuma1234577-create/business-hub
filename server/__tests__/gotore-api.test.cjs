// 合トレ仲間さがし：API層のテスト
// 実行: node --test server/__tests__/gotore-api.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createDb, pgRpc } = require('./helpers/gotore-pg.cjs');
const { createPublicRouter, createMemberRouter } = require('../gotore.cjs');

let h, base, server, pushed, articles, pushFails;

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
    pushLine: async (to, text) => { if (pushFails) throw new Error('LINE down'); pushed.push({ to, text }); },
    lookupArticle: async (handle) => articles[handle] || null,
    baseUrl: 'https://my.fitpeak.co',
  };
  app.use('/public', createPublicRouter(deps));
  app.use('/gotore', createMemberRouter(deps));
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
}

test.beforeEach(async () => {
  h = await createDb();
  pushed = [];
  pushFails = false;
  articles = {};
  await startApp();
});
test.afterEach(() => new Promise((r) => server.close(r)));

async function user() {
  const authId = (await h.one(`select gen_random_uuid() id`)).id;
  const id = await h.member();
  await h.db.query(`update members set auth_user_id = $1 where id = $2`, [authId, id]);
  const line = (await h.one(`select line_user_id from members where id = $1`, [id])).line_user_id;
  return { id, line, user: { id: authId, email: `line_${authId}@line.fitpeak.co` } };
}

function call(method, path, u, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (u) headers['x-test-user'] = JSON.stringify(u.user);
  return fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
    .then(async (r) => ({ status: r.status, body: await r.json() }));
}

const PROFILE = { nickname: 'たろう', gender: 'male', age_band: '25-34', level: 'intermediate', bio: '', agree: true };
const POST = { slots: ['wd_night'], parts: ['chest'], goals: ['spot'], gender_pref: 'any', note: '' };

test('ジム記事の枠：初めて見るジムは記事を確かめてから登録し、件数を返す', async () => {
  articles['gym-a'] = { name: 'ONE STEP', pref: '東京都', city: '渋谷区' };
  const r = await call('GET', '/public/gym?handle=gym-a');
  assert.equal(r.status, 200);
  assert.equal(r.body.gym.name, 'ONE STEP');
  assert.equal(r.body.open_posts, 0);
  assert.equal((await call('GET', '/public/gym?handle=fake')).status, 404, '実在しない記事のジムは作らない');
});

test('ログインしていなければ 401（管理トークンでの代理操作もさせない）', async () => {
  assert.equal((await call('GET', '/gotore/me')).status, 401);
  assert.equal((await call('POST', '/gotore/posts', null, { handle: 'gym-a', ...POST })).status, 401);
});

test('会員が見つからなければ 404', async () => {
  const r = await call('GET', '/gotore/me', { user: { id: '00000000-0000-0000-0000-000000000000' } });
  assert.equal(r.status, 404);
});

test('募集〜申請〜承認〜チャットの各段階で、相手にLINEで知らせる（リンク付き）', async () => {
  await h.gym('gym-a');
  const a = await user();
  const b = await user();
  assert.equal((await call('PUT', '/gotore/profile', a, PROFILE)).status, 200);
  assert.equal((await call('PUT', '/gotore/profile', b, { ...PROFILE, nickname: 'じろう' })).status, 200);
  await call('POST', '/gotore/gyms/gym-a/watch', b, { on: true });

  const p = await call('POST', '/gotore/posts', a, { handle: 'gym-a', ...POST });
  assert.equal(p.status, 200);
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].to, b.line);
  assert.match(pushed[0].text, /ONE STEP/);
  assert.match(pushed[0].text, /https:\/\/my\.fitpeak\.co\/my-fitpeak\/gotore\/gym\/gym-a/);

  const rq = await call('POST', `/gotore/posts/${p.body.post_id}/request`, b, { message: 'よろしくです' });
  assert.equal(rq.status, 200);
  assert.equal(pushed[1].to, a.line);
  assert.match(pushed[1].text, /じろう/);

  const ans = await call('POST', `/gotore/requests/${rq.body.request_id}/answer`, a, { accept: true });
  assert.equal(ans.status, 200);
  assert.equal(pushed[2].to, b.line);
  assert.match(pushed[2].text, new RegExp(`/my-fitpeak/gotore/chat/${ans.body.match_id}`));

  const msg = await call('POST', `/gotore/matches/${ans.body.match_id}/messages`, b, { body: '火曜どうですか' });
  assert.equal(msg.status, 200);
  assert.equal(pushed[3].to, a.line);
  assert.ok(!pushed[3].text.includes('火曜どうですか'), 'LINEの通知に本文は載せない（通知のプレビューから漏れないように）');

  const chat = await call('GET', `/gotore/matches/${ans.body.match_id}`, a);
  assert.equal(chat.body.messages.length, 1);
  assert.equal(JSON.stringify(ans.body).includes('Uline'), false, '画面にLINEのIDを返さない');
});

test('DBの拒否理由は 400 でそのまま見せる', async () => {
  await h.gym('gym-a');
  const a = await user();
  const r = await call('POST', '/gotore/posts', a, { handle: 'gym-a', ...POST });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /プロフィール/);
});

test('LINEへの送信が失敗しても、募集自体は成功する', async () => {
  await h.gym('gym-a');
  const a = await user();
  const b = await user();
  await call('PUT', '/gotore/profile', a, PROFILE);
  await call('POST', '/gotore/gyms/gym-a/watch', b, { on: true });
  pushFails = true;
  assert.equal((await call('POST', '/gotore/posts', a, { handle: 'gym-a', ...POST })).status, 200);
});

test('地域別ランキング記事のエリア掲示板（area:都道府県:市区町村）は記事を見に行かずに作る', async () => {
  const r = await call('GET', `/public/gym?handle=${encodeURIComponent('area:東京都:渋谷区')}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.gym.name, '渋谷区のジム（エリア全体）');
  assert.equal(r.body.gym.pref, '東京都');
  assert.equal(r.body.gym.city, '渋谷区');
  const p = await call('GET', `/public/gym?handle=${encodeURIComponent('area:北海道:')}`);
  assert.equal(p.body.gym.name, '北海道のジム（エリア全体）');
  assert.equal(p.body.gym.city, null);
  for (const bad of ['area:ほげ県:渋谷区', 'area:東京都:<script>', 'area:東京都:' + 'あ'.repeat(30) + '市']) {
    assert.equal((await call('GET', `/public/gym?handle=${encodeURIComponent(bad)}`)).status, 404, bad);
  }
});

test('短いリンク /gotore/b/:id は掲示板のキーを返す', async () => {
  await h.gym('gym-a');
  const a = await user();
  const id = (await h.call('gt_gym_public', { p_handle: 'gym-a' })).gym.id;
  const r = await call('GET', `/gotore/b/${id}`, a);
  assert.equal(r.status, 200);
  assert.equal(r.body.handle, 'gym-a');
  assert.equal((await call('GET', '/gotore/b/not-a-uuid', a)).status, 404);
});

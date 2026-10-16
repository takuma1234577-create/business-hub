// My FITPEAK: my.fitpeak.co でログイン中の人を、画面の新しい場所（fitpeak.co/a）へログインしたまま移す
// 実行: node --test server/__tests__/myfp-migrate.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createMigrateRouter } = require('../my-fitpeak-migrate.cjs');

const USERS = {
  'tok-alice': { id: 'u-alice', email: 'alice@example.com' },
  'tok-bob': { id: 'u-bob', email: 'bob@example.com' },
};

let server, base, issued, appUrl, logs;
const origLog = console.log, origErr = console.error, origWarn = console.warn;

async function start() {
  const app = express();
  app.use(express.json());
  app.use('/api/my-fitpeak', createMigrateRouter({
    getUserFromToken: async (t) => USERS[t] || null,
    issueTokenHash: async (email) => { issued.push(email); return `hash-for-${email.split('@')[0]}-${issued.length}`; },
    appBase: () => appUrl,
    apiBase: () => 'https://my.fitpeak.co',
  }));
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/my-fitpeak`;
}

test.beforeEach(async () => {
  issued = [];
  appUrl = 'https://fitpeak.co/a';
  logs = [];
  const cap = (...a) => logs.push(a.map(String).join(' '));
  console.log = cap; console.error = cap; console.warn = cap;
  await start();
});
test.afterEach(() => {
  console.log = origLog; console.error = origErr; console.warn = origWarn;
  return new Promise((r) => server.close(r));
});

function migrate(token, body = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${base}/auth/migrate`, { method: 'POST', headers, body: JSON.stringify(body) });
}

test('本人のセッションから、画面の新しい場所のログインURLを出す（token_hash はフラグメントだけ）', async () => {
  const res = await migrate('tok-alice', { next: '/my-fitpeak/pro' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const data = await res.json();
  assert.deepEqual(Object.keys(data), ['url']);
  const u = new URL(data.url);
  assert.equal(`${u.origin}${u.pathname}`, 'https://fitpeak.co/a/my-fitpeak/login');
  assert.equal(u.search, '');
  const h = new URLSearchParams(u.hash.slice(1));
  assert.equal(h.get('lt'), 'hash-for-alice-1');
  assert.equal(h.get('next'), '/my-fitpeak/pro');
  assert.deepEqual(issued, ['alice@example.com']);
});

test('他人のメール・member_id・line_user_id を送っても、本人のトークンしか出ない', async () => {
  const res = await migrate('tok-alice', { email: 'bob@example.com', member_id: 'm-bob', line_user_id: 'Ubob', user_id: 'u-bob' });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.match(data.url, /lt=hash-for-alice-/);
  assert.deepEqual(issued, ['alice@example.com']);
  // 応答にメールを出さない
  assert.doesNotMatch(JSON.stringify(data), /alice@example\.com|bob@example\.com/);
});

test('ログインしていない・トークンが不正なら 401（トークンを出さない）', async () => {
  for (const t of [null, 'bad-token', 'tok-alice-x']) {
    const res = await migrate(t, { email: 'alice@example.com' });
    assert.equal(res.status, 401, String(t));
    const body = await res.text();
    assert.doesNotMatch(body, /hash-for/);
  }
  // クエリやCookieでトークンを渡しても認めない
  const r = await fetch(`${base}/auth/migrate?access_token=tok-alice`, { method: 'POST', headers: { Cookie: 'sb=tok-alice' } });
  assert.equal(r.status, 401);
  assert.deepEqual(issued, []);
});

test('社内の管理トークン形式（Supabaseの会員ではない）では出さない', async () => {
  const res = await migrate('admin-token-xyz');
  assert.equal(res.status, 401);
  assert.deepEqual(issued, []);
});

test('戻り先が外部なら /my-fitpeak に戻す', async () => {
  for (const next of ['https://evil.example', '//evil.example', '/my-fitpeak//evil.example', '/other']) {
    const data = await (await migrate('tok-alice', { next })).json();
    assert.equal(new URLSearchParams(new URL(data.url).hash.slice(1)).get('next'), '/my-fitpeak', next);
  }
});

test('画面がまだ my.fitpeak.co のままなら移行しない（トークンを作らない）', async () => {
  appUrl = 'https://my.fitpeak.co';
  const res = await migrate('tok-alice');
  assert.equal(res.status, 409);
  assert.deepEqual(issued, []);
});

test('毎回新しいトークン（1回限り）を作る', async () => {
  const a = await (await migrate('tok-alice')).json();
  const b = await (await migrate('tok-alice')).json();
  assert.notEqual(a.url, b.url);
});

test('ログにメール・トークンを出さない', async () => {
  await migrate('tok-alice', { next: '/my-fitpeak' });
  await migrate('bad-token');
  const all = logs.join('\n');
  assert.doesNotMatch(all, /alice@example\.com|hash-for|tok-alice|bad-token/);
});

test('トークン発行に失敗しても詳細（メール等）を返さない', async () => {
  server.close();
  const app = express();
  app.use(express.json());
  app.use('/api/my-fitpeak', createMigrateRouter({
    getUserFromToken: async (t) => USERS[t] || null,
    issueTokenHash: async (email) => { throw new Error(`failed for ${email}`); },
    appBase: () => appUrl,
    apiBase: () => 'https://my.fitpeak.co',
  }));
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/my-fitpeak`;
  const res = await migrate('tok-alice');
  assert.equal(res.status, 500);
  assert.doesNotMatch(await res.text(), /alice/);
  assert.doesNotMatch(logs.join('\n'), /alice/);
});

test('画面の場所の問い合わせは誰でも可・個人情報なし', async () => {
  const res = await fetch(`${base}/auth/app-location`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { moved: true, appUrl: 'https://fitpeak.co/a' });
  appUrl = 'https://my.fitpeak.co';
  assert.deepEqual(await (await fetch(`${base}/auth/app-location`)).json(), { moved: false, appUrl: 'https://my.fitpeak.co' });
});

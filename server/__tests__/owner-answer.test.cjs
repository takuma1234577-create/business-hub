// AIマップから、判断待ちへの回答（承認/却下）をAI組織へ渡す。node server/__tests__/owner-answer.test.cjs
const assert = require('node:assert/strict');
const { sendOwnerAnswer } = require('../owner-answer.cjs');
const ENV = { BROKER_KEYS: 'claude:aaa,org:orgsecret', AI_ORG_URL: 'https://org.example' };
const ID = '88078081-4d4b-4e2a-a69b-a47c2dd44b9f';

(async () => {
  const calls = [];
  const ok = (status, body) => async (url, init) => { calls.push({ url, init }); return { ok: status < 400, status, json: async () => body }; };
  let r = await sendOwnerAnswer({ id: ID, action: 'approve', extra: 'x' }, { env: ENV, fetchImpl: ok(200, { ok: true, title: '承認しました', message: '次の巡回で反映' }) });
  assert.deepEqual([r.ok, r.status, r.data.title], [true, 200, '承認しました']);
  assert.equal(calls[0].url, 'https://org.example/api/owner-answer');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer orgsecret');
  assert.deepEqual(JSON.parse(calls[0].init.body), { id: ID, action: 'approve' });
  // 入力が不正ならAI組織へ送らない
  calls.length = 0;
  assert.equal((await sendOwnerAnswer({ id: 'x', action: 'approve' }, { env: ENV, fetchImpl: ok(200, {}) })).status, 400);
  assert.equal((await sendOwnerAnswer({ id: ID, action: 'delete' }, { env: ENV, fetchImpl: ok(200, {}) })).status, 400);
  assert.equal(calls.length, 0);
  // 組織が断った(409)・鍵なし・通信エラー
  r = await sendOwnerAnswer({ id: ID, action: 'reject' }, { env: ENV, fetchImpl: ok(409, { ok: false, message: '回答済みです' }) });
  assert.deepEqual([r.ok, r.status, r.data.message], [false, 409, '回答済みです']);
  assert.equal((await sendOwnerAnswer({ id: ID, action: 'reject' }, { env: {}, fetchImpl: ok(200, {}) })).status, 500);
  r = await sendOwnerAnswer({ id: ID, action: 'reject' }, { env: ENV, fetchImpl: async () => { throw new Error('timeout'); } });
  assert.deepEqual([r.ok, r.status], [false, 502]);
  console.log('OK   判断待ちへの回答の受け渡し');
})();

// 公式LINEに届いた文章を、オーナー判定のため AI組織へ転送する。node server/__tests__/owner-relay.test.cjs
const assert = require('node:assert/strict');
const { relayOwnerMessage, orgKey } = require('../owner-relay.cjs');

const ENV = { BROKER_KEYS: 'claude:aaa,org:orgsecret', AI_ORG_URL: 'https://org.example' };
assert.equal(orgKey(ENV), 'orgsecret');
assert.equal(orgKey({}), '');

(async () => {
  const calls = [];
  const ok = (body) => async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => body }; };
  // オーナーなら handled:true と返信文
  let r = await relayOwnerMessage({ lineUserId: 'Uowner', text: 'こうして', env: ENV, fetchImpl: ok({ handled: true, reply: '受け取りました' }) });
  assert.deepEqual(r, { handled: true, reply: '受け取りました' });
  assert.equal(calls[0].url, 'https://org.example/api/owner-reply');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer orgsecret');
  assert.deepEqual(JSON.parse(calls[0].init.body), { line_user_id: 'Uowner', text: 'こうして' });
  // オーナーでなければ handled:false（通常のお客様の扱い）
  r = await relayOwnerMessage({ lineUserId: 'Ucustomer', text: 'こんにちは', env: ENV, fetchImpl: ok({ handled: false }) });
  assert.deepEqual(r, { handled: false });
  // 失敗・遅延・鍵なしのときは、止めずに handled:false（お客様への返信を妨げない）
  r = await relayOwnerMessage({ lineUserId: 'U', text: 'x', env: ENV, fetchImpl: async () => { throw new Error('timeout'); } });
  assert.deepEqual(r, { handled: false });
  r = await relayOwnerMessage({ lineUserId: 'U', text: 'x', env: ENV, fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) });
  assert.deepEqual(r, { handled: false });
  r = await relayOwnerMessage({ lineUserId: 'U', text: 'x', env: {}, fetchImpl: ok({ handled: true }) });
  assert.deepEqual(r, { handled: false });                         // 鍵がなければ呼ばない
  // 空の文章は転送しない
  const n = calls.length; r = await relayOwnerMessage({ lineUserId: 'U', text: '  ', env: ENV, fetchImpl: ok({ handled: true }) });
  assert.deepEqual(r, { handled: false }); assert.equal(calls.length, n);
  console.log('OK   オーナーの文章の転送');
})();

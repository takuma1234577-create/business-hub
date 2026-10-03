// AI組織に頼んで、オーナーのLINEへ通知する。node server/__tests__/owner-notify.test.cjs
const assert = require('node:assert/strict');
const { notifyOwner } = require('../owner-notify.cjs');
const ENV = { BROKER_KEYS: 'claude:aaa,org:orgsecret', AI_ORG_URL: 'https://org.example' };

(async () => {
  const calls = [];
  const ok = async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({ ok: true }) }; };
  let r = await notifyOwner({ kind: 'info', text: '対応しました' }, { env: ENV, fetchImpl: ok });
  assert.deepEqual(r, { ok: true });
  assert.equal(calls[0].url, 'https://org.example/api/owner-notify');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer orgsecret');
  assert.deepEqual(JSON.parse(calls[0].init.body), { kind: 'info', text: '対応しました' });
  // 失敗・鍵なし・通信エラーは ok:false（呼び出し側が代わりの経路を選べる）
  assert.deepEqual(await notifyOwner({ kind: 'info', text: 'x' }, { env: {}, fetchImpl: ok }), { ok: false, error: 'no_key' });
  assert.equal((await notifyOwner({ kind: 'info', text: 'x' }, { env: ENV, fetchImpl: async () => ({ ok: false, status: 502, json: async () => ({}) }) })).ok, false);
  assert.equal((await notifyOwner({ kind: 'info', text: 'x' }, { env: ENV, fetchImpl: async () => { throw new Error('timeout'); } })).ok, false);
  console.log('OK   オーナーへの通知');
})();

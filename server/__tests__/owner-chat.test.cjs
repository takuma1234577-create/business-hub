// AIマップのチャットに書いた指示を、AI組織へ渡す。node server/__tests__/owner-chat.test.cjs
const assert = require('node:assert/strict');
const { sendOwnerChat } = require('../owner-chat.cjs');
const ENV = { BROKER_KEYS: 'claude:aaa,org:orgsecret', AI_ORG_URL: 'https://org.example' };

(async () => {
  const calls = [];
  const ok = (status, body) => async (url, init) => { calls.push({ url, init }); return { ok: status < 400, status, json: async () => body }; };
  let r = await sendOwnerChat({ room: 'exec', to: 'op-uiux', body: '最初の画面にボタンを', extra: 'ignored' }, { env: ENV, fetchImpl: ok(200, { ok: true, task_id: 't1', target: 'op-uiux', room: 'exec' }) });
  assert.deepEqual(r, { ok: true, status: 200, data: { ok: true, task_id: 't1', target: 'op-uiux', room: 'exec' } });
  assert.equal(calls[0].url, 'https://org.example/api/owner-chat');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer orgsecret');
  assert.deepEqual(JSON.parse(calls[0].init.body), { room: 'exec', to: 'op-uiux', body: '最初の画面にボタンを' });   // 余計な項目は渡さない
  // 組織が断った(400)ときは、理由をそのまま返す
  r = await sendOwnerChat({ room: 'exec', body: '' }, { env: ENV, fetchImpl: ok(400, { error: '本文が空です' }) });
  assert.deepEqual([r.ok, r.status, r.data.error], [false, 400, '本文が空です']);
  // 鍵なし・通信エラー
  assert.deepEqual(await sendOwnerChat({ room: 'exec', body: 'x' }, { env: {}, fetchImpl: ok(200, {}) }), { ok: false, status: 500, data: { error: '組織との連携の鍵が未設定です' } });
  r = await sendOwnerChat({ room: 'exec', body: 'x' }, { env: ENV, fetchImpl: async () => { throw new Error('timeout'); } });
  assert.deepEqual([r.ok, r.status], [false, 502]);
  console.log('OK   チャットからの指示の受け渡し');
})();

// 合トレナビ：公式LINEの Webhook から合トレの会話へ振り分ける部分（line-crm.cjs から呼ぶ）
// 実行: node --test server/__tests__/gotore-line-route.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const { routeLineEvent } = require('../gotore-line-chat.cjs');

const fake = (impl) => ({
  calls: [],
  async onText(a) { this.calls.push(['text', a]); return impl(a); },
  async onPostback(a) { this.calls.push(['postback', a]); return impl(a); },
});

test('本人は Webhook の source.userId で決める（文字・ボタンの両方）', async () => {
  const c = fake(() => ({ messages: [{ type: 'text', text: 'ok' }], log: 'x' }));
  await routeLineEvent(c, { type: 'message', source: { userId: 'U1' }, message: { type: 'text', text: '合トレ募集' } });
  await routeLineEvent(c, { type: 'postback', source: { userId: 'U2' }, postback: { data: 'action=gotore&s=list&line=U9' } });
  assert.deepEqual(c.calls, [['text', { lineUserId: 'U1', text: '合トレ募集' }], ['postback', { lineUserId: 'U2', data: 'action=gotore&s=list&line=U9' }]]);
});

test('合トレで扱わないとき・エラーのとき・userId が無いときは null（従来の処理へ流す）', async () => {
  assert.equal(await routeLineEvent(fake(() => null), { type: 'message', source: { userId: 'U1' }, message: { type: 'text', text: 'こんにちは' } }), null);
  assert.equal(await routeLineEvent(fake(() => { throw new Error('db down'); }), { type: 'message', source: { userId: 'U1' }, message: { type: 'text', text: '合トレ募集' } }), null);
  assert.equal(await routeLineEvent(fake(() => ({ messages: [] })), { type: 'message', source: {}, message: { type: 'text', text: '合トレ募集' } }), null);
  assert.equal(await routeLineEvent(fake(() => ({ messages: [] })), { type: 'message', source: { userId: 'U1' }, message: { type: 'image' } }), null);
  assert.equal(await routeLineEvent(fake(() => ({ messages: [] })), { type: 'follow', source: { userId: 'U1' } }), null);
});

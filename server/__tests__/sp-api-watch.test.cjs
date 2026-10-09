// SP-APIの資格情報の期限と403を見張り、オーナーのLINEへ知らせる判断。node server/__tests__/sp-api-watch.test.cjs
const assert = require('node:assert/strict');
const { decideNotice, runSpApiWatch } = require('../sp-api-watch.cjs');
const DAY = 86400000;
const now = new Date('2026-11-01T00:00:00Z');
const exp = (days) => new Date(now.getTime() + days * DAY).toISOString();

(async () => {
  // 余裕があれば何も送らない
  assert.equal(decideNotice({ now, expiresAt: exp(60), probeStatus: 200, last: null }), null);
  // 30日前に1回だけ
  let n = decideNotice({ now, expiresAt: exp(29), probeStatus: 200, last: null });
  assert.equal(n.key, 'expiry30'); assert.match(n.text, /30日|期限/);
  assert.equal(decideNotice({ now, expiresAt: exp(25), probeStatus: 200, last: { key: 'expiry30', at: now.toISOString() } }), null);
  // 7日前は段階が進むので送る(その後は黙る)
  n = decideNotice({ now, expiresAt: exp(6), probeStatus: 200, last: { key: 'expiry30', at: now.toISOString() } });
  assert.equal(n.key, 'expiry7');
  assert.equal(decideNotice({ now, expiresAt: exp(5), probeStatus: 200, last: { key: 'expiry7', at: now.toISOString() } }), null);
  // 期限切れは24時間ごとに繰り返す
  n = decideNotice({ now, expiresAt: exp(-1), probeStatus: 200, last: { key: 'expiry7', at: new Date(now - 2 * DAY).toISOString() } });
  assert.equal(n.key, 'expired');
  assert.equal(decideNotice({ now, expiresAt: exp(-1), probeStatus: 200, last: { key: 'expired', at: new Date(now - 3600000).toISOString() } }), null);
  assert.equal(decideNotice({ now, expiresAt: exp(-1), probeStatus: 200, last: { key: 'expired', at: new Date(now - 25 * 3600000).toISOString() } }).key, 'expired');
  // 403/401は期限に関係なく最優先、24時間ごと
  n = decideNotice({ now, expiresAt: exp(100), probeStatus: 403, last: null });
  assert.equal(n.key, 'api403'); assert.match(n.text, /403/);
  assert.equal(decideNotice({ now, expiresAt: exp(100), probeStatus: 403, last: { key: 'api403', at: now.toISOString() } }), null);
  // 通信エラー(0)や5xxは資格情報の問題ではないので送らない
  assert.equal(decideNotice({ now, expiresAt: exp(100), probeStatus: 0, last: null }), null);
  assert.equal(decideNotice({ now, expiresAt: exp(100), probeStatus: 503, last: null }), null);
  // 期限が未登録なら期限通知はせず、403だけ見る
  assert.equal(decideNotice({ now, expiresAt: null, probeStatus: 200, last: null }), null);
  // 実行: 通知に失敗したら「送った」と記録しない(次回また試す)
  const saved = [];
  const base = { now, getState: async () => ({ expiresAt: exp(3), last: null }), probe: async () => 200, saveLast: async (v) => saved.push(v) };
  let r = await runSpApiWatch({ ...base, notify: async () => ({ ok: false, error: 'http_502' }) });
  assert.equal(r.sent, false); assert.equal(saved.length, 0);
  r = await runSpApiWatch({ ...base, notify: async (p) => { assert.equal(p.kind, 'info'); return { ok: true }; } });
  assert.equal(r.sent, true); assert.equal(saved[0].key, 'expiry7');
  console.log('OK   SP-APIの期限・403の通知判断');
})().catch((e) => { console.error(e); process.exit(1); });

// 未処理のお客様対応の再通知。node server/__tests__/escalation-reminder.test.cjs
const assert = require('node:assert/strict');
const { pickStale, buildDigest, remindStale } = require('../escalation-reminder.cjs');

const now = new Date('2026-10-06T12:00:00Z');
const h = (n) => new Date(now.getTime() - n * 3600000).toISOString();
const rows = [
  { id: 'a', status: 'pending', customer_name: '古い人', original_message: '連絡がない', created_at: h(24 * 20), last_reminded_at: null },
  { id: 'b', status: 'pending', customer_name: '新しい人', original_message: 'さっき', created_at: h(2), last_reminded_at: null },
  { id: 'c', status: 'pending', customer_name: '昨日通知済み', original_message: 'x', created_at: h(24 * 3), last_reminded_at: h(5) },
  { id: 'd', status: 'pending', customer_name: '通知から丸1日', original_message: 'y', created_at: h(24 * 3), last_reminded_at: h(25) },
  { id: 'e', status: 'resolved', customer_name: '処理済み', original_message: 'z', created_at: h(24 * 9), last_reminded_at: null },
];

// 24時間たった未処理だけが対象。通知済みは24時間あけて再通知。処理済みと新しい案件は対象外
assert.deepEqual(pickStale(rows, now).map((r) => r.id).sort(), ['a', 'd']);

// 文面: 件数と、いちばん古い日数、上位の相手が入る。絵文字なし
const text = buildDigest(pickStale(rows, now), now);
assert.match(text, /2件/);
assert.match(text, /20日/);
assert.match(text, /古い人/);
assert.doesNotMatch(text, /[\u{1F300}-\u{1FAFF}✅❌]/u);

// 対象が0件なら何も送らない
(async () => {
  let sent = 0;
  const none = await remindStale({ rows: [rows[1], rows[4]], now, notify: async () => { sent++; return { ok: true }; }, markReminded: async () => {} });
  assert.equal(sent, 0);
  assert.equal(none.reminded, 0);

  // 送れたら、対象の案件だけ「通知済み」に記録する。送れなければ記録しない（次回また通知する）
  let marked = null;
  const ok = await remindStale({ rows, now, notify: async (p) => { sent++; assert.equal(p.kind, 'info'); return { ok: true }; }, markReminded: async (ids) => { marked = ids; } });
  assert.equal(sent, 1);
  assert.deepEqual(marked.sort(), ['a', 'd']);
  assert.equal(ok.reminded, 2);

  marked = null;
  const ng = await remindStale({ rows, now, notify: async () => ({ ok: false, error: 'x' }), markReminded: async (ids) => { marked = ids; } });
  assert.equal(marked, null);
  assert.equal(ng.reminded, 0);
  console.log('escalation-reminder: OK');
})();

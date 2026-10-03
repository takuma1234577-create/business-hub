// カスタマーサービス部門が読む、レビューの状況の要約。node server/__tests__/cs-reviews.test.cjs
const assert = require('node:assert/strict');
process.env.SUPABASE_URL ||= 'http://localhost:54321'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'sb_secret_dummy';
const { summarizeReviews } = require('../cs-ai.cjs');

const now = new Date('2026-10-03T12:00:00Z'); const ago = (d) => new Date(now - d * 86400000).toISOString();
const products = [
  { asin: 'A1', title: 'リストラップ', average_rating: 4.2, rating_count: 160, previous_rating: 4.4, previous_count: 152 },       // 0.2下がった → 警告
  { asin: 'A2', title: 'パワーグリップ', average_rating: 4.1, rating_count: 50, previous_rating: 4.1, previous_count: 49 },
  { asin: 'A3', title: 'ナイロンベルト', average_rating: null, rating_count: null, previous_rating: null, previous_count: null },       // まだ取れていない
];
const snaps = [
  { asin: 'A2', star_1: 2, star_2: 1, star_3: 3, star_4: 14, star_5: 30, rating_count: 50, average_rating: 4.1, checked_at: ago(0) },
  { asin: 'A2', star_1: 0, star_2: 1, star_3: 3, star_4: 14, star_5: 31, rating_count: 49, average_rating: 4.2, checked_at: ago(7) },  // 1つ星が2件増えた → 警告
];
const sol = [{ status: 'sent', sent_at: ago(1), created_at: ago(1) }, { status: 'sent', sent_at: ago(2), created_at: ago(2) }, { status: 'failed', error_message: 'Solicitations role missing', created_at: ago(2) }, { status: 'sent', sent_at: ago(40), created_at: ago(40) }];
const signals = [
  { category: 'complaint', urgency_score: 0.9, needs_human_response: true, refund_or_complaint: true, created_at: ago(1), source: 'amazon_review' },
  { category: 'praise', urgency_score: 0.1, needs_human_response: false, refund_or_complaint: false, created_at: ago(20), source: 'amazon_review' },
];

const s = summarizeReviews({ products, snapshots: snaps, solicitations: sol, signals, autoSend: { enabled: true, delayDays: 7, maxPerDay: 20 }, now });
const by = Object.fromEntries(s.products.map((p) => [p.asin, p]));
assert.deepEqual([by.A1.alert, by.A1.delta_avg, by.A1.new_ratings], ['rating_drop', -0.2, 8]);
assert.equal(by.A2.alert, 'new_low_stars'); assert.deepEqual(by.A2.low_star_increase, 2);
assert.equal(by.A3.alert, 'no_data');
assert.deepEqual([s.solicitations.sent_30d, s.solicitations.failed_30d], [2, 1]);                       // 40日前は数えない
assert.equal(s.solicitations.errors[0], 'Solicitations role missing');
assert.equal(s.solicitations.auto_send.enabled, true);
assert.equal(s.signals.length, 1);                                                                      // 14日より古いものは含まない
assert.deepEqual([s.signals[0].category, s.signals[0].refund_or_complaint], ['complaint', true]);
assert.deepEqual(s.alerts.map((a) => a.asin).sort(), ['A1', 'A2', 'A3']);
// データが何も無いとき
const e = summarizeReviews({ products: [], snapshots: [], solicitations: [], signals: [], autoSend: null, now });
assert.deepEqual([e.products, e.alerts, e.solicitations.sent_30d, e.solicitations.auto_send], [[], [], 0, { enabled: false }]);
console.log('OK   レビューの状況の要約');

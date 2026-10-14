// 定期購入の Webhook から、ポイントの確定・返品戻しが呼ばれること。node server/__tests__/subscription-loyalty-hooks.test.cjs
const assert = require('node:assert/strict');
process.env.SUPABASE_URL ||= 'http://127.0.0.1:9'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'sb_secret_dummy';
const loyalty = require('../loyalty.cjs');
const calls = [];
loyalty.hooks = () => ({
  onOrderCreated: async (o) => calls.push(['created', o.id]),
  onOrderRefunded: async (id) => calls.push(['refunded', id]),
});
const { handleWebhook, WEBHOOK_TOPICS } = require('../subscription.cjs')._internal;

(async () => {
  assert.ok(WEBHOOK_TOPICS.includes('ORDERS_CANCELLED'));
  assert.ok(WEBHOOK_TOPICS.includes('REFUNDS_CREATE'));
  await handleWebhook('orders/create', { id: 11, discount_codes: [] });
  await handleWebhook('refunds/create', { id: 99, order_id: 12 });
  await handleWebhook('orders/cancelled', { id: 13 });
  assert.deepEqual(calls, [['created', 11], ['refunded', 12], ['refunded', 13]]);
  console.log('subscription-loyalty-hooks: ok');
})().catch((e) => { console.error(e); process.exit(1); });

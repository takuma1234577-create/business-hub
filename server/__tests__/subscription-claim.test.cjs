// 定期契約の引き当て：注文番号だけでは他人の契約を自分のメールに付け替えられないこと。node server/__tests__/subscription-claim.test.cjs
const assert = require('node:assert/strict');
process.env.SUPABASE_URL ||= 'http://127.0.0.1:9'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'sb_secret_dummy';
const { orderEmailMatches } = require('../subscription.cjs')._internal;

const order = { email: 'Taro@Example.com', customer: { email: 'taro.alt@example.com' } };
assert.equal(orderEmailMatches(order, 'taro@example.com'), true);
assert.equal(orderEmailMatches(order, ' TARO.ALT@example.com '), true);
assert.equal(orderEmailMatches(order, 'someone@example.com'), false);
assert.equal(orderEmailMatches(order, ''), false);
assert.equal(orderEmailMatches({ email: null, customer: null }, ''), false);
console.log('subscription-claim: ok');

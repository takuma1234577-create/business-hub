// 仲介窓口: Amazon SP-API（FBA納品 v2024-03-20）の許可ルール。node server/__tests__/broker-amazon-sp.test.cjs
const assert = require('node:assert/strict');
process.env.SUPABASE_URL ||= 'http://localhost:54321'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'sb_secret_dummy';   // 読み込みだけ（通信しない）
const { matchRule, SERVICES } = require('../broker.cjs');

const B = '/inbound/fba/2024-03-20';
const tier = (m, p) => matchRule('amazon_sp', m, p)?.tier ?? null;
assert.equal(SERVICES.amazon_sp.host, 'sellingpartnerapi-fe.amazon.com');

// 読み取りは自由
assert.equal(tier('GET', `${B}/inboundPlans`), 'free');
assert.equal(tier('GET', `${B}/inboundPlans/wf1a2b3c-4d5e`), 'free');
assert.equal(tier('GET', `${B}/inboundPlans/wf1a2b3c-4d5e/boxes`), 'free');
assert.equal(tier('GET', `${B}/inboundPlans/wf1a2b3c-4d5e/shipments/sh123`), 'free');
assert.equal(tier('GET', `${B}/operations/op-123`), 'free');
assert.equal(tier('GET', '/fba/inbound/v0/shipments/FBA15ABC/labels'), 'free');          // 箱ラベル
// 計算だけで確定しない「生成」は、回数制限つき
assert.equal(tier('POST', `${B}/inboundPlans/wf1/placementOptions`), 'metered');
assert.equal(tier('POST', `${B}/inboundPlans/wf1/packingOptions`), 'metered');
assert.equal(tier('POST', `${B}/inboundPlans/wf1/shipments/sh1/transportationOptions`), 'metered');
// 作る・確定・取り消し（費用・在庫の動きに関わる）は、LINE承認
assert.equal(tier('POST', `${B}/inboundPlans`), 'approval');
assert.equal(tier('POST', `${B}/inboundPlans/wf1/packingInformation`), 'approval');
assert.equal(tier('POST', `${B}/inboundPlans/wf1/placementOptions/pl1/confirmation`), 'approval');
assert.equal(tier('POST', `${B}/inboundPlans/wf1/shipments/sh1/transportationConfirmation`), 'approval');
assert.equal(tier('PUT', `${B}/inboundPlans/wf1/cancellation`), 'approval');
// 許可されていないもの
assert.equal(tier('DELETE', `${B}/inboundPlans/wf1`), null);
assert.equal(tier('GET', '/orders/v0/orders'), null);                                     // 他のAPI（注文・レポート等）には触れない
assert.equal(tier('GET', `${B}/inboundPlans/../../orders`), null);
assert.equal(matchRule('nosuch', 'GET', '/x'), null);

// 商品ページ(Listings)・カタログ・A+コンテンツ: 読み取りは自由、書き込み・申請は承認つき
const L = '/listings/2021-08-01/items/AGE6B6YH3KSXW';
assert.equal(tier('GET', `${L}/FP-RW-001`), 'free');
assert.equal(tier('GET', '/catalog/2022-04-01/items/B0DR9QSZFW'), 'free');
assert.equal(tier('PATCH', `${L}/FP-RW-001`), 'approval');          // タイトル・箇条書き・説明・画像の変更
assert.equal(tier('PUT', `${L}/FP-RW-001`), 'approval');
assert.equal(tier('DELETE', `${L}/FP-RW-001`), null);               // 出品の削除はできない
assert.equal(tier('GET', '/aplus/2020-11-01/contentDocuments'), 'free');
assert.equal(tier('GET', '/aplus/2020-11-01/contentDocuments/ABC123'), 'free');
assert.equal(tier('POST', '/aplus/2020-11-01/contentDocuments'), 'approval');
assert.equal(tier('POST', '/aplus/2020-11-01/contentDocuments/ABC123/asins'), 'approval');
assert.equal(tier('POST', '/aplus/2020-11-01/contentDocuments/ABC123/approvalSubmissions'), 'approval');
assert.equal(tier('DELETE', '/aplus/2020-11-01/contentDocuments/ABC123'), null);
// 出品者IDは、SVPコーポレーション(AGE6B6YH3KSXW)だけ。別の事業のストアは触れない
assert.equal(tier('PATCH', '/listings/2021-08-01/items/A6GVDAVC6TMCZ/ANY'), null);
assert.equal(tier('GET', '/listings/2021-08-01/items/A14IWQQOZ4KZFL/ANY'), null);
console.log('OK   仲介窓口 amazon_sp');

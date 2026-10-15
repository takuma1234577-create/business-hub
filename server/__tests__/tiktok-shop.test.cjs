// TikTok Shop 連携（在庫をFBAに合わせる・注文をMCFで出す・追跡番号を戻す）の判断部分。node server/__tests__/tiktok-shop.test.cjs
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  signRequest, toChannelOrder, planInventoryUpdates, pickShippingProvider, needsTokenRefresh, createTikTokClient, pushTracking,
} = require('../tiktok-shop.cjs');

(async () => {
  // ── 署名: sign と access_token は除外、キー昇順で key+value、path を前に、本文を後ろに、secretで挟んでHMAC-SHA256
  const secret = 'sec';
  const sig = signRequest({
    appSecret: secret,
    path: '/order/202309/orders/search',
    query: { timestamp: 1700000000, app_key: 'ak', shop_cipher: 'C1', sign: 'x', access_token: 'y', page_size: 50 },
    body: { order_status: 'AWAITING_SHIPMENT' },
  });
  const base = '/order/202309/orders/search' + 'app_keyak' + 'page_size50' + 'shop_cipherC1' + 'timestamp1700000000' + '{"order_status":"AWAITING_SHIPMENT"}';
  assert.equal(sig, crypto.createHmac('sha256', secret).update(secret + base + secret).digest('hex'));
  // GET（本文なし）は本文を付けない
  const sigGet = signRequest({ appSecret: secret, path: '/authorization/202309/shops', query: { app_key: 'ak', timestamp: 1 } });
  assert.equal(sigGet, crypto.createHmac('sha256', secret).update(secret + '/authorization/202309/shops' + 'app_keyak' + 'timestamp1' + secret).digest('hex'));

  // ── 注文の変換: 明細は1点ずつ来るので SKU ごとに数量をまとめる。住所は都道府県/市区町村を district_info から
  const ttOrder = {
    id: '5770001', status: 'AWAITING_SHIPMENT', create_time: 1760500000,
    payment: { total_amount: '7960', currency: 'JPY' },
    recipient_address: {
      name: '山田 太郎', phone_number: '(+81)9012345678', postal_code: '150-0001', region_code: 'JP',
      address_line1: '神宮前1-2-3', address_line2: 'ABCビル101',
      district_info: [
        { address_level: 'L0', address_name: 'Japan' },
        { address_level: 'L1', address_name: '東京都' },
        { address_level: 'L2', address_name: '渋谷区' },
      ],
    },
    line_items: [
      { id: 'li1', sku_id: '111', seller_sku: 'WW-BK-60', product_name: 'リストラップ', sku_name: 'ブラック/60cm' },
      { id: 'li2', sku_id: '111', seller_sku: 'WW-BK-60', product_name: 'リストラップ', sku_name: 'ブラック/60cm' },
      { id: 'li3', sku_id: '222', seller_sku: '', product_name: 'パワーグリップ', sku_name: 'Black' },
    ],
  };
  const mapped = toChannelOrder(ttOrder);
  assert.equal(mapped.order.id, 'TT-5770001');
  assert.equal(mapped.order.channel, 'TIKTOK');
  assert.equal(mapped.order.channel_order_id, '5770001');
  assert.equal(mapped.order.status, 'PENDING');
  assert.equal(mapped.order.recipient_name, '山田 太郎');
  assert.equal(mapped.order.state_or_region, '東京都');
  assert.equal(mapped.order.city, '渋谷区');
  assert.equal(mapped.order.address_line1, '神宮前1-2-3');
  assert.equal(mapped.order.address_line2, 'ABCビル101');
  assert.equal(mapped.order.postal_code, '150-0001');
  assert.equal(mapped.order.country_code, 'JP');
  assert.equal(mapped.order.total_amount, 7960);
  assert.equal(mapped.order.ordered_at, new Date(1760500000 * 1000).toISOString());
  assert.equal(mapped.items.length, 2);
  assert.deepEqual(mapped.items.map(i => [i.id, i.quantity, i.lookupKeys]), [
    ['TT-5770001-111', 2, ['WW-BK-60', '111']],
    ['TT-5770001-222', 1, ['222']],
  ]);
  // 市区町村が L3 まである場合はつなげる、district_info が無ければ full_address を使う
  const deep = toChannelOrder({ ...ttOrder, recipient_address: { ...ttOrder.recipient_address, district_info: [
    { address_level: 'L1', address_name: '北海道' }, { address_level: 'L2', address_name: '札幌市' }, { address_level: 'L3', address_name: '中央区' },
  ] } });
  assert.equal(deep.order.city, '札幌市中央区');
  const bare = toChannelOrder({ ...ttOrder, recipient_address: { name: 'A', postal_code: '1000001', full_address: '東京都千代田区千代田1-1' } });
  assert.equal(bare.order.address_line1, '東京都千代田区千代田1-1');
  assert.equal(bare.order.city, '-');

  // ── 在庫: FBAの出荷可能数に合わせる。同じ数なら書かない。FBAに無い/対応表に無いものは触らない
  const plan = planInventoryUpdates({
    mappings: [
      { channel: 'TIKTOK', channel_sku: 'WW-BK-60', amazon_sku: 'AMZ-1', is_active: true },
      { channel: 'TIKTOK', channel_sku: '222', amazon_sku: 'AMZ-2', is_active: true },
      { channel: 'TIKTOK', channel_sku: '333', amazon_sku: 'AMZ-GONE', is_active: true },
      { channel: 'TIKTOK', channel_sku: 'NOT-ON-TT', amazon_sku: 'AMZ-1', is_active: true },
      { channel: 'SHOPIFY', channel_sku: '999', amazon_sku: 'AMZ-1', is_active: true },
    ],
    amazonStock: { 'AMZ-1': 40, 'AMZ-2': 7 },
    skus: [
      { productId: 'p1', skuId: '111', sellerSku: 'WW-BK-60', warehouseId: 'w1', quantity: 35 },
      { productId: 'p2', skuId: '222', sellerSku: '', warehouseId: 'w1', quantity: 7 },
      { productId: 'p3', skuId: '333', sellerSku: '', warehouseId: 'w1', quantity: 3 },
    ],
  });
  assert.deepEqual(plan.updates, [{ productId: 'p1', skuId: '111', warehouseId: 'w1', from: 35, to: 40 }]);
  assert.equal(plan.unchanged, 1);
  assert.deepEqual(plan.notFound.sort(), ['333', 'NOT-ON-TT']);

  // ── 配送業者: MCFの carrierCode を TikTok の配送業者IDへ
  const providers = [{ id: 'P_YMT', name: 'ヤマト運輸' }, { id: 'P_SGW', name: '佐川急便' }, { id: 'P_JP', name: '日本郵便' }];
  assert.equal(pickShippingProvider(providers, 'YAMATO'), 'P_YMT');
  assert.equal(pickShippingProvider(providers, 'JP_YAMATO_TRANSPORT'), 'P_YMT');
  assert.equal(pickShippingProvider(providers, 'SAGAWA'), 'P_SGW');
  assert.equal(pickShippingProvider(providers, 'JAPAN_POST'), 'P_JP');
  assert.equal(pickShippingProvider([{ id: 'X', name: 'Yamato Transport' }], 'yamato'), 'X');
  assert.equal(pickShippingProvider(providers, 'UNKNOWN_CARRIER'), null);

  // ── トークン: 期限の1日前を切ったら更新
  const now = new Date('2026-10-15T00:00:00Z');
  assert.equal(needsTokenRefresh({ expiresAt: null, now }), true);
  assert.equal(needsTokenRefresh({ expiresAt: '2026-10-15T20:00:00Z', now }), true);
  assert.equal(needsTokenRefresh({ expiresAt: '2026-10-20T00:00:00Z', now }), false);

  // ── クライアント: shop_cipher と署名を付け、トークンをヘッダーで送る。期限が近ければ先に更新して保存
  const calls = [];
  const saved = [];
  const http = async (req) => {
    calls.push(req);
    if (req.url.includes('/token/refresh')) return { data: { code: 0, data: { access_token: 'NEW', refresh_token: 'R2', access_token_expire_in: 1761000000 } } };
    if (req.url.includes('/authorization/202309/shops')) return { data: { code: 0, data: { shops: [{ cipher: 'CIPH', region: 'JP' }] } } };
    return { data: { code: 0, data: { ok: true } } };
  };
  const client = createTikTokClient({
    store: { id: 'tiktok_1', app_key: 'ak', app_secret: 'sec', tiktok_access_token: 'OLD', tiktok_refresh_token: 'R1', tiktok_token_expires_at: null, tiktok_shop_cipher: null },
    http, saveStore: async (patch) => saved.push(patch), now: () => now,
  });
  const out = await client.request('POST', '/order/202309/orders/search', { query: { page_size: 50 }, body: { order_status: 'AWAITING_SHIPMENT' } });
  assert.deepEqual(out, { ok: true });
  assert.ok(calls[0].url.includes('/api/v2/token/refresh'));
  assert.equal(saved[0].tiktok_access_token, 'NEW');
  assert.equal(saved[0].tiktok_refresh_token, 'R2');
  assert.equal(saved[0].tiktok_token_expires_at, new Date(1761000000 * 1000).toISOString());
  assert.ok(saved.some(p => p.tiktok_shop_cipher === 'CIPH'));
  const last = calls[calls.length - 1];
  assert.equal(last.method, 'POST');
  assert.equal(last.headers['x-tts-access-token'], 'NEW');
  const u = new URL(last.url);
  assert.equal(u.origin + u.pathname, 'https://open-api.tiktokglobalshop.com/order/202309/orders/search');
  assert.equal(u.searchParams.get('shop_cipher'), 'CIPH');
  assert.equal(u.searchParams.get('app_key'), 'ak');
  const q = Object.fromEntries(u.searchParams); delete q.sign;
  assert.equal(u.searchParams.get('sign'), signRequest({ appSecret: 'sec', path: '/order/202309/orders/search', query: q, body: { order_status: 'AWAITING_SHIPMENT' } }));
  // APIのエラーコードは例外にする
  const bad = createTikTokClient({
    store: { app_key: 'ak', app_secret: 'sec', tiktok_access_token: 'T', tiktok_token_expires_at: '2027-01-01T00:00:00Z', tiktok_shop_cipher: 'C' },
    http: async () => ({ data: { code: 36009004, message: 'invalid sku' } }), saveStore: async () => {}, now: () => now,
  });
  await assert.rejects(() => bad.request('GET', '/product/202309/products/1'), /36009004.*invalid sku/);

  // ── 追跡番号の書き戻し: 日本はパッケージ単位の発送API（自社配送）を使う。パッケージが無い時だけ注文単位
  const reqs = [];
  const fake = (order) => ({ request: async (m, path, opts = {}) => {
    reqs.push([m, path, opts.body]);
    if (path === '/order/202309/orders') return { orders: [order] };
    if (path.includes('/shipping_providers')) return { shipping_providers: [{ id: 'P_YMT', name: 'ヤマト運輸' }] };
    return {};
  } });
  const dbOrder = { channel_order_id: '577', tracking_number: '1234-5678', carrier: 'YAMATO' };
  let r = await pushTracking({ client: fake({ id: '577', status: 'AWAITING_SHIPMENT', delivery_option_id: 'D1', packages: [{ id: 'PK1' }], line_items: [{ id: 'li1' }] }), order: dbOrder });
  assert.deepEqual(r, { shipped: true });
  assert.deepEqual(reqs.at(-1), ['POST', '/fulfillment/202309/packages/PK1/ship', { self_shipment: { tracking_number: '1234-5678', shipping_provider_id: 'P_YMT' } }]);
  reqs.length = 0;
  await pushTracking({ client: fake({ id: '577', status: 'AWAITING_SHIPMENT', delivery_option_id: 'D1', packages: [], line_items: [{ id: 'li1' }, { id: 'li2' }] }), order: dbOrder });
  assert.deepEqual(reqs.at(-1), ['POST', '/fulfillment/202309/orders/577/packages', { order_line_item_ids: ['li1', 'li2'], tracking_number: '1234-5678', shipping_provider_id: 'P_YMT' }]);
  // 既に発送待ちでなければ何もしない
  reqs.length = 0;
  r = await pushTracking({ client: fake({ id: '577', status: 'IN_TRANSIT' }), order: dbOrder });
  assert.deepEqual(r, { skipped: 'IN_TRANSIT' });
  assert.equal(reqs.length, 1);
  // 配送業者が対応付けできなければ例外（アラートに乗る）
  await assert.rejects(() => pushTracking({ client: fake({ id: '577', status: 'AWAITING_SHIPMENT', delivery_option_id: 'D1', packages: [{ id: 'PK1' }] }), order: { ...dbOrder, carrier: 'DHL' } }), /DHL/);

  console.log('tiktok-shop: all passed');
})().catch((e) => { console.error(e); process.exit(1); });

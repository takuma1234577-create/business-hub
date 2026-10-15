// TikTok Shop 連携（Partner API 202309）。在庫の正本は Amazon FBA。
//   - 在庫: FBAの出荷可能数を TikTok の在庫へ書く（Shopifyと同じ考え方）
//   - 注文: 発送待ちの注文を orders に取り込み、既存の自動出荷（Amazon MCF）に乗せる
//   - 追跡番号: MCFの追跡番号を TikTok に戻して発送済みにする
// 署名やデータ変換は純粋関数にして server/__tests__/tiktok-shop.test.cjs で確かめる。
const crypto = require('node:crypto');

const API_BASE = 'https://open-api.tiktokglobalshop.com';
const AUTH_BASE = 'https://auth.tiktok-shops.com';
const REFRESH_MARGIN_MS = 24 * 3600 * 1000;

// https://partner.tiktokshop.com/docv2/page/sign-your-api-request
function signRequest({ appSecret, path, query = {}, body }) {
  const keys = Object.keys(query).filter(k => k !== 'sign' && k !== 'access_token').sort();
  let base = path + keys.map(k => `${k}${query[k]}`).join('');
  if (body !== undefined && body !== null) base += typeof body === 'string' ? body : JSON.stringify(body);
  return crypto.createHmac('sha256', appSecret).update(appSecret + base + appSecret).digest('hex');
}

function needsTokenRefresh({ expiresAt, now = new Date() }) {
  if (!expiresAt) return true;
  return new Date(expiresAt).getTime() - now.getTime() < REFRESH_MARGIN_MS;
}

// TikTokの注文 → orders / order_items の行。明細は1点ずつ来るのでSKUごとに数量をまとめる。
function toChannelOrder(tt) {
  const a = tt.recipient_address || {};
  const levels = {};
  for (const d of a.district_info || []) levels[d.address_level] = d.address_name;
  const hasDistrict = !!(levels.L1 || levels.L2);
  const city = [levels.L2, levels.L3].filter(Boolean).join('') || '-';
  const line1 = a.address_line1 || a.address_detail || (!hasDistrict ? a.full_address : '') || a.full_address || '';
  const line2 = [a.address_line2, a.address_line3, a.address_line4].filter(Boolean).join(' ');
  const id = `TT-${tt.id}`;

  const grouped = new Map();
  for (const li of tt.line_items || []) {
    const key = String(li.sku_id || li.seller_sku || li.id);
    const g = grouped.get(key) || {
      id: `${id}-${key}`,
      order_id: id,
      channel_sku: li.seller_sku || String(li.sku_id || ''),
      lookupKeys: [li.seller_sku, li.sku_id && String(li.sku_id)].filter(Boolean),
      quantity: 0,
      title: [li.product_name, li.sku_name].filter(Boolean).join(' / '),
    };
    g.quantity += Number(li.quantity) || 1;
    grouped.set(key, g);
  }

  return {
    order: {
      id,
      channel: 'TIKTOK',
      channel_order_id: String(tt.id),
      status: 'PENDING',
      shipping_speed: 'STANDARD',
      recipient_name: a.name || [a.last_name, a.first_name].filter(Boolean).join(' '),
      address_line1: line1,
      address_line2: line2,
      city,
      state_or_region: levels.L1 || '',
      postal_code: a.postal_code || '',
      country_code: a.region_code || 'JP',
      retry_count: 0,
      ordered_at: new Date((Number(tt.create_time) || Date.now() / 1000) * 1000).toISOString(),
      total_amount: parseFloat(tt.payment?.total_amount || '0'),
      currency: tt.payment?.currency || 'JPY',
    },
    items: [...grouped.values()],
  };
}

// sku_mappings(channel=TIKTOK) の channel_sku は TikTok の seller_sku か sku_id のどちらでもよい
function planInventoryUpdates({ mappings, amazonStock, skus }) {
  const bySku = new Map();
  for (const s of skus) {
    if (s.sellerSku) bySku.set(String(s.sellerSku), s);
    bySku.set(String(s.skuId), s);
  }
  const updates = [];
  const notFound = [];
  let unchanged = 0;
  const done = new Set();
  for (const m of mappings) {
    if (m.channel !== 'TIKTOK' || m.is_active === false) continue;
    const s = bySku.get(String(m.channel_sku));
    const qty = amazonStock[m.amazon_sku];
    if (!s || qty === undefined || !s.warehouseId) { notFound.push(m.channel_sku); continue; }
    if (done.has(s.skuId)) continue;
    done.add(s.skuId);
    if (s.quantity === qty) { unchanged++; continue; }
    updates.push({ productId: s.productId, skuId: s.skuId, warehouseId: s.warehouseId, from: s.quantity, to: qty });
  }
  return { updates, unchanged, notFound };
}

const CARRIER_ALIASES = [
  { keys: ['yamato', 'ヤマト', 'kuroneko'] },
  { keys: ['sagawa', '佐川'] },
  { keys: ['japan post', 'japanpost', 'japan_post', 'jp_post', 'jppost', '日本郵便', 'ゆうパック', 'yu-pack'] },
  { keys: ['seino', '西濃'] },
  { keys: ['fukuyama', '福山'] },
];
function pickShippingProvider(providers, carrierCode) {
  const code = String(carrierCode || '').toLowerCase();
  const group = CARRIER_ALIASES.find(g => g.keys.some(k => code.includes(k)));
  if (!group) return null;
  const hit = (providers || []).find(p => group.keys.some(k => String(p.name || '').toLowerCase().includes(k)));
  return hit ? hit.id : null;
}

// ── API クライアント ──
function createTikTokClient({ store, http, saveStore, now = () => new Date() }) {
  const st = { ...store };

  async function refreshIfNeeded() {
    if (!needsTokenRefresh({ expiresAt: st.tiktok_token_expires_at, now: now() })) return;
    if (!st.tiktok_refresh_token) return; // 手入力のトークンなど、更新手段がなければそのまま使う
    const params = new URLSearchParams({
      app_key: st.app_key, app_secret: st.app_secret, refresh_token: st.tiktok_refresh_token, grant_type: 'refresh_token',
    });
    const r = await http({ method: 'GET', url: `${AUTH_BASE}/api/v2/token/refresh?${params}` });
    const d = r.data?.data;
    if (r.data?.code !== 0 || !d?.access_token) throw new Error(`TikTokトークン更新に失敗: ${r.data?.code} ${r.data?.message || ''}`);
    const patch = {
      tiktok_access_token: d.access_token,
      tiktok_refresh_token: d.refresh_token || st.tiktok_refresh_token,
      tiktok_token_expires_at: new Date(Number(d.access_token_expire_in) * 1000).toISOString(),
    };
    Object.assign(st, patch);
    await saveStore(patch);
  }

  async function raw(method, path, { query = {}, body, withCipher = true } = {}) {
    const q = { ...query, app_key: st.app_key, timestamp: Math.floor(now().getTime() / 1000) };
    if (withCipher && st.tiktok_shop_cipher) q.shop_cipher = st.tiktok_shop_cipher;
    q.sign = signRequest({ appSecret: st.app_secret, path, query: q, body });
    const url = `${API_BASE}${path}?${new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)]))}`;
    const r = await http({
      method, url,
      headers: { 'x-tts-access-token': st.tiktok_access_token, 'Content-Type': 'application/json' },
      ...(body !== undefined ? { data: body } : {}),
    });
    if (r.data?.code !== 0) throw new Error(`TikTok API ${path}: ${r.data?.code} ${r.data?.message || ''}`.trim());
    return r.data.data;
  }

  async function ensureCipher() {
    if (st.tiktok_shop_cipher) return;
    const d = await raw('GET', '/authorization/202309/shops', { withCipher: false });
    const shop = (d?.shops || []).find(s => s.region === 'JP') || d?.shops?.[0];
    if (!shop?.cipher) throw new Error('TikTokのショップ情報(shop_cipher)が取得できません');
    st.tiktok_shop_cipher = shop.cipher;
    await saveStore({ tiktok_shop_cipher: shop.cipher, ...(shop.id ? { shop_id: String(shop.id) } : {}) });
  }

  async function request(method, path, opts = {}) {
    await refreshIfNeeded();
    await ensureCipher();
    return raw(method, path, opts);
  }

  return { request, store: st };
}

// ── 同期の各処理（cron/sync から呼ぶ） ──

async function listSkus(client) {
  const out = [];
  let pageToken = '';
  for (let i = 0; i < 50; i++) {
    const d = await client.request('POST', '/product/202309/products/search', {
      query: { page_size: 100, ...(pageToken ? { page_token: pageToken } : {}) },
      body: { status: 'ACTIVATE' },
    });
    for (const p of d?.products || []) for (const s of p.skus || []) {
      const inv = (s.inventory || [])[0] || {};
      out.push({ productId: String(p.id), skuId: String(s.id), sellerSku: s.seller_sku || '', warehouseId: inv.warehouse_id || '', quantity: Number(inv.quantity) || 0, title: p.title });
    }
    pageToken = d?.next_page_token || '';
    if (!pageToken) break;
  }
  return out;
}

async function syncInventory({ client, mappings, amazonStock }) {
  const skus = await listSkus(client);
  const plan = planInventoryUpdates({ mappings, amazonStock, skus });
  let updated = 0;
  const errors = [];
  for (const u of plan.updates) {
    try {
      await client.request('POST', `/product/202309/products/${u.productId}/inventory/update`, {
        body: { skus: [{ id: u.skuId, inventory: [{ warehouse_id: u.warehouseId, quantity: u.to }] }] },
      });
      updated++;
    } catch (e) { errors.push(`${u.skuId}: ${e.message}`); }
  }
  return { updated, unchanged: plan.unchanged, notFound: plan.notFound.length, errors };
}

async function searchAwaitingOrders(client, sinceSec) {
  const out = [];
  let pageToken = '';
  for (let i = 0; i < 20; i++) {
    const d = await client.request('POST', '/order/202309/orders/search', {
      query: { page_size: 50, sort_field: 'create_time', sort_order: 'ASC', ...(pageToken ? { page_token: pageToken } : {}) },
      body: { order_status: 'AWAITING_SHIPMENT', ...(sinceSec ? { update_time_ge: sinceSec } : {}) },
    });
    out.push(...(d?.orders || []));
    pageToken = d?.next_page_token || '';
    if (!pageToken) break;
  }
  return out;
}

async function getOrder(client, orderId) {
  const d = await client.request('GET', '/order/202309/orders', { query: { ids: String(orderId) } });
  return d?.orders?.[0] || null;
}

// 発送待ちの注文を取り込む。SKUは sku_mappings(TIKTOK) で Amazon SKU に解決（未解決は既存のアラートに乗る）
async function importOrders({ client, supabase, since }) {
  // 取りこぼし防止に前回時刻から1時間さかのぼる（重複は id で弾く）
  const sinceSec = since ? Math.floor(new Date(since).getTime() / 1000) - 3600 : Math.floor(Date.now() / 1000) - 3 * 86400;
  const orders = await searchAwaitingOrders(client, sinceSec);
  let imported = 0;
  for (const tt of orders) {
    const { order, items } = toChannelOrder(tt);
    const { data: existing } = await supabase.from('orders').select('id').eq('id', order.id).maybeSingle();
    if (existing) continue;
    const { error } = await supabase.from('orders').insert(order);
    if (error) throw new Error(`TikTok注文の保存に失敗 ${order.id}: ${error.message}`);
    for (const it of items) {
      let amazonSku = '';
      for (const key of it.lookupKeys) {
        const { data: m } = await supabase.from('sku_mappings').select('amazon_sku').eq('channel', 'TIKTOK').eq('channel_sku', key).eq('is_active', true).maybeSingle();
        if (m?.amazon_sku) { amazonSku = m.amazon_sku; it.channel_sku = key; break; }
      }
      const { lookupKeys, ...row } = it;
      await supabase.from('order_items').insert({ ...row, amazon_sku: amazonSku });
    }
    await supabase.from('fulfillment_logs').insert({ order_id: order.id, event: 'IMPORTED', message: `[自動] TikTok注文 ${tt.id} をインポート` });
    imported++;
  }
  return { imported, seen: orders.length };
}

// MCFを作る直前の確認（キャンセル済みなら出さない）
async function isStillAwaitingShipment(client, orderId) {
  const o = await getOrder(client, orderId);
  return o?.status === 'AWAITING_SHIPMENT';
}

// 追跡番号を TikTok に戻して発送済みにする
async function pushTracking({ client, order }) {
  const tt = await getOrder(client, order.channel_order_id);
  if (!tt) throw new Error('TikTokで注文が見つかりません');
  if (tt.status !== 'AWAITING_SHIPMENT') return { skipped: tt.status };
  const providersRes = await client.request('GET', `/logistics/202309/delivery_options/${tt.delivery_option_id}/shipping_providers`);
  const providerId = pickShippingProvider(providersRes?.shipping_providers, order.carrier);
  if (!providerId) throw new Error(`配送業者「${order.carrier || '-'}」をTikTokの配送業者に対応付けできません`);
  const packages = tt.packages || [];
  if (packages.length > 0) {
    // 日本など: パッケージごとに自社配送として発送（Ship Package）
    for (const pkg of packages) {
      await client.request('POST', `/fulfillment/202309/packages/${pkg.id}/ship`, {
        body: { self_shipment: { tracking_number: order.tracking_number, shipping_provider_id: providerId } },
      });
    }
  } else {
    // 米英など: 注文単位で発送済みにする（Mark Package As Shipped）
    await client.request('POST', `/fulfillment/202309/orders/${tt.id}/packages`, {
      body: {
        order_line_item_ids: (tt.line_items || []).map(li => li.id),
        tracking_number: order.tracking_number,
        shipping_provider_id: providerId,
      },
    });
  }
  return { shipped: true };
}

module.exports = {
  signRequest, needsTokenRefresh, toChannelOrder, planInventoryUpdates, pickShippingProvider,
  createTikTokClient, listSkus, syncInventory, importOrders, isStillAwaitingShipment, pushTracking,
};

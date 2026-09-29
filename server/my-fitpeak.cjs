const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const returns = require('./my-fitpeak-returns.cjs');

// Supabase
function getSupabase() {
  const url = process.env.SUPABASE_URL;
  // データ読み書き用。サービスキー（サーバー専用）を優先する
  const key = require('./shared.cjs').getServerSupabaseKey();
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
  return createClient(url, key);
}

// Shopify store info（毎回DBを引かないよう5分だけメモリに持つ）
let storeCache = { data: null, at: 0 };
async function getShopifyStore() {
  if (storeCache.data && Date.now() - storeCache.at < 5 * 60 * 1000) return storeCache.data;
  const supabase = getSupabase();
  const { data } = await supabase
    .from('channel_stores')
    .select('shop_domain, access_token')
    .eq('channel', 'SHOPIFY')
    .eq('is_active', true)
    .limit(1)
    .single();
  if (data) storeCache = { data, at: Date.now() };
  return data;
}

// LINEログインの人は内部用メール(@line.fitpeak.co)なので、LINEと結びついたShopifyのメールで注文を探す
async function resolveOrderEmail(email) {
  if (!String(email).endsWith('@line.fitpeak.co')) return email;
  try {
    const supabase = getSupabase();
    const { data: member } = await supabase.from('members').select('line_user_id').eq('email', email).maybeSingle();
    if (!member?.line_user_id) return email;
    const { data: link } = await supabase
      .from('line_shopify_links')
      .select('shopify_email')
      .eq('line_user_id', member.line_user_id)
      .maybeSingle();
    return link?.shopify_email || email;
  } catch {
    return email;
  }
}

// 注文一覧の短期キャッシュ（同じ人の再表示・二重リクエストを速くする。60秒）
const ordersCache = new Map(); // key -> { at, promise }
const ORDERS_TTL_MS = 60 * 1000;

const SHOPIFY_API = '2024-01';
const shopifyHeaders = (store) => ({ 'X-Shopify-Access-Token': store.access_token });

function mapShopifyOrder(o) {
  const fulfillment = o.fulfillments?.[0];
  return {
    id: o.id,
    name: o.name,
    date: o.created_at,
    total: o.total_price,
    status: o.financial_status,
    fulfillmentStatus: o.fulfillment_status || 'unfulfilled',
    items: (o.line_items || []).map((i) => ({
      title: i.title,
      quantity: i.quantity,
      price: i.price,
      variant: i.variant_title,
    })),
    trackingNumber: fulfillment?.tracking_number || null,
    trackingUrl: fulfillment?.tracking_url || null,
    trackingCompany: fulfillment?.tracking_company || null,
    source: 'shopify',
  };
}

async function shopifyGraphql(store, query, variables) {
  const r = await axios.post(
    `https://${store.shop_domain}/admin/api/${SHOPIFY_API}/graphql.json`,
    { query, variables },
    { headers: shopifyHeaders(store), timeout: 15000 }
  );
  if (r.data.errors) throw new Error(JSON.stringify(r.data.errors));
  return r.data.data;
}

// 注文メールが一致する注文のID（ゲスト購入・顧客レコードに紐づかない注文も拾う）
async function orderIdsByEmail(store, email, limit) {
  const data = await shopifyGraphql(
    store,
    `query($q:String!,$n:Int!){ orders(first:$n, query:$q, sortKey:CREATED_AT, reverse:true){ nodes{ legacyResourceId } } }`,
    { q: `email:${JSON.stringify(String(email))}`, n: Math.min(Number(limit) || 10, 50) }
  );
  return (data.orders?.nodes || []).map((n) => String(n.legacyResourceId));
}

async function fetchShopifyOrderById(store, id) {
  try {
    const r = await axios.get(
      `https://${store.shop_domain}/admin/api/${SHOPIFY_API}/orders/${id}.json`,
      { headers: shopifyHeaders(store), timeout: 15000 }
    );
    return r.data.order ? mapShopifyOrder(r.data.order) : null;
  } catch { return null; }
}

// 会員に紐づくメール（ログインメール／LINE連携先のメール）
async function memberEmails(email) {
  const set = new Set([String(email).toLowerCase()]);
  const resolved = await resolveOrderEmail(email);
  if (resolved) set.add(String(resolved).toLowerCase());
  return [...set].filter((e) => !e.endsWith('@line.fitpeak.co'));
}

async function getClaims(authUserId) {
  if (!authUserId) return [];
  try {
    const { data } = await getSupabase().from('member_order_claims').select('channel, order_ref, order_label').eq('auth_user_id', authUserId);
    return data || [];
  } catch { return []; }
}

// Amazon注文の最新状況（注文ごとに60秒キャッシュ）
const amazonCache = new Map();
async function fetchAmazonOrder(orderId) {
  const hit = amazonCache.get(orderId);
  if (hit && Date.now() - hit.at < ORDERS_TTL_MS) return hit.value;
  const { token, endpoint } = await getAmazonAccessToken();
  const headers = { 'x-amz-access-token': token };
  const orderRes = await axios.get(`${endpoint}/orders/v0/orders/${orderId}`, { headers, timeout: 15000 });
  const order = orderRes.data.payload;
  if (!order) return null;
  let items = [];
  try {
    const itemsRes = await axios.get(`${endpoint}/orders/v0/orders/${orderId}/orderItems`, { headers, timeout: 15000 });
    items = (itemsRes.data.payload?.OrderItems || []).map((i) => ({
      title: i.Title, sku: i.SellerSKU, quantity: i.QuantityOrdered, price: i.ItemPrice?.Amount || '0', variant: '',
    }));
  } catch { /* 商品明細が取れなくても注文は返す */ }
  const value = {
    source: 'amazon',
    id: order.AmazonOrderId,
    name: order.AmazonOrderId,
    date: order.PurchaseDate,
    total: order.OrderTotal?.Amount || '0',
    status: order.OrderStatus,
    fulfillmentStatus: order.OrderStatus === 'Shipped' ? 'fulfilled' : order.OrderStatus === 'Unshipped' ? 'unfulfilled' : order.OrderStatus,
    items,
    fulfillmentChannel: order.FulfillmentChannel,
  };
  amazonCache.set(orderId, { at: Date.now(), value });
  return value;
}

// GET /orders - ご注文一覧（Shopify: メール一致＋ゲスト購入＋引き当て済み / Amazon: 引き当て済み）
router.get('/orders', async (req, res) => {
  try {
    const { limit = '20' } = req.query;
    const email = req.fitpeakEmail || req.query.email;
    if (!email) return res.status(400).json({ error: 'email required' });
    const authUserId = req.fitpeakUser?.id || null;

    const key = `${authUserId || String(email).toLowerCase()}|${limit}`;
    const hit = ordersCache.get(key);
    if (hit && Date.now() - hit.at < ORDERS_TTL_MS) return res.json(await hit.promise);

    const promise = buildOrders(email, authUserId, limit);
    ordersCache.set(key, { at: Date.now(), promise });
    promise.catch(() => ordersCache.delete(key));
    if (ordersCache.size > 500) {
      for (const [k, v] of ordersCache) if (Date.now() - v.at > ORDERS_TTL_MS) ordersCache.delete(k);
    }
    return res.json(await promise);
  } catch (err) {
    console.error('GET /api/my-fitpeak/orders error:', err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

async function buildOrders(email, authUserId, limit) {
  const store = await getShopifyStore();
  const [emails, claims] = await Promise.all([memberEmails(email), getClaims(authUserId)]);
  const byId = new Map();

  // ① メール一致（顧客レコード経由）＋ ② 注文メール一致（ゲスト購入含む）
  if (store) {
    await Promise.all(emails.map(async (em) => {
      const [viaCustomer, ids] = await Promise.all([
        (async () => {
          try {
            const c = await axios.get(
              `https://${store.shop_domain}/admin/api/${SHOPIFY_API}/customers/search.json?query=email:${encodeURIComponent(em)}`,
              { headers: shopifyHeaders(store), timeout: 15000 }
            );
            const cust = (c.data.customers || [])[0];
            if (!cust) return [];
            const r = await axios.get(
              `https://${store.shop_domain}/admin/api/${SHOPIFY_API}/customers/${cust.id}/orders.json?status=any&limit=${limit}`,
              { headers: shopifyHeaders(store), timeout: 15000 }
            );
            return (r.data.orders || []).map(mapShopifyOrder);
          } catch { return []; }
        })(),
        orderIdsByEmail(store, em, limit).catch(() => []),
      ]);
      viaCustomer.forEach((o) => byId.set(String(o.id), o));
      const missing = ids.filter((id) => !byId.has(id));
      const fetched = await Promise.all(missing.map((id) => fetchShopifyOrderById(store, id)));
      fetched.filter(Boolean).forEach((o) => byId.set(String(o.id), o));
    }));

    // ③ 引き当て済みのShopify注文（別メール・ゲスト購入）
    const shopifyClaims = claims.filter((c) => c.channel === 'shopify' && !byId.has(String(c.order_ref)));
    const claimed = await Promise.all(shopifyClaims.map((c) => fetchShopifyOrderById(store, c.order_ref)));
    claimed.filter(Boolean).forEach((o) => byId.set(String(o.id), { ...o, claimed: true }));
  }

  // ④ 引き当て済みのAmazon注文（表示のたびに最新の状況を取得）
  const amazon = (await Promise.all(
    claims.filter((c) => c.channel === 'amazon').map(async (c) => {
      try { return await fetchAmazonOrder(c.order_ref); } catch { return { source: 'amazon', id: c.order_ref, name: c.order_ref, date: null, total: '0', status: '取得できませんでした', fulfillmentStatus: 'unknown', items: [], stale: true }; }
    })
  )).filter(Boolean);

  const orders = [...byId.values()].sort((a, b) => new Date(b.date) - new Date(a.date));
  try {
    const badges = await returns.getReturnBadges(orders.map((o) => o.id));
    orders.forEach((o) => { o.returnBadge = badges[String(o.id)] || null; });
  } catch { /* 返品の状況が取れなくても注文は出す */ }
  return { orders, amazonOrders: amazon };
}

// ── 注文の引き当て（別メール・ゲスト購入・Amazon）──
const claimAttempts = new Map(); // userId -> [timestamps]（総当たり防止：1時間10回）
function tooManyAttempts(userId) {
  const now = Date.now();
  const list = (claimAttempts.get(userId) || []).filter((t) => now - t < 3600 * 1000);
  list.push(now);
  claimAttempts.set(userId, list);
  return list.length > 10;
}
const digits = (v) => String(v || '').replace(/\D/g, '');

// POST /order-claim  { channel:'shopify', orderNumber:'#1234', verify:'メール / 郵便番号 / 電話番号' }
router.post('/order-claim', async (req, res) => {
  try {
    const user = req.fitpeakUser;
    if (!user) return res.status(401).json({ error: 'ログインが必要です' });
    if (tooManyAttempts(user.id)) return res.status(429).json({ error: '試行回数が多すぎます。1時間ほど空けてお試しください。' });

    const { orderNumber, verify } = req.body || {};
    const num = digits(orderNumber);
    const proof = String(verify || '').trim();
    if (!num || !proof) return res.status(400).json({ error: '注文番号と確認情報を入力してください' });

    const store = await getShopifyStore();
    if (!store) return res.status(500).json({ error: 'Shopify not connected' });

    const data = await shopifyGraphql(
      store,
      `query($q:String!){ orders(first:1, query:$q){ nodes{ legacyResourceId name email phone shippingAddress{ zip phone } billingAddress{ zip phone } } } }`,
      { q: `name:#${num}` }
    );
    const o = data.orders?.nodes?.[0];
    const NOT_FOUND = { error: '注文が見つかりませんでした。注文番号と確認情報をご確認ください。' };
    if (!o) return res.status(404).json(NOT_FOUND);

    // 確認情報：注文時のメール／郵便番号／電話番号のどれかが一致すること
    const p = proof.toLowerCase();
    const pd = digits(proof);
    const emails = [o.email].filter(Boolean).map((e) => e.toLowerCase());
    const zips = [o.shippingAddress?.zip, o.billingAddress?.zip].map(digits).filter(Boolean);
    const phones = [o.phone, o.shippingAddress?.phone, o.billingAddress?.phone].map(digits).filter((x) => x.length >= 8);
    const ok =
      emails.includes(p) ||
      (pd.length === 7 && zips.includes(pd)) ||
      (pd.length >= 10 && phones.some((ph) => ph.slice(-10) === pd.slice(-10)));
    if (!ok) return res.status(404).json(NOT_FOUND);

    const supabase = getSupabase();
    const ref = String(o.legacyResourceId);
    const { data: exist } = await supabase.from('member_order_claims').select('auth_user_id').eq('channel', 'shopify').eq('order_ref', ref).maybeSingle();
    if (exist && exist.auth_user_id !== user.id) {
      return res.status(409).json({ error: 'この注文はすでに別のアカウントに登録されています。心当たりがない場合はLINEでご連絡ください。' });
    }
    if (!exist) {
      await supabase.from('member_order_claims').insert({ auth_user_id: user.id, channel: 'shopify', order_ref: ref, order_label: o.name });
    }
    ordersCache.clear();
    res.json({ success: true, name: o.name });
  } catch (err) {
    console.error('POST /api/my-fitpeak/order-claim error:', err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /order-claims/:channel/:ref - 引き当てを外す（Amazonの「一覧から外す」用）
router.delete('/order-claims/:channel/:ref', async (req, res) => {
  try {
    const user = req.fitpeakUser;
    if (!user) return res.status(401).json({ error: 'ログインが必要です' });
    await getSupabase().from('member_order_claims').delete()
      .eq('auth_user_id', user.id).eq('channel', req.params.channel).eq('order_ref', req.params.ref);
    ordersCache.clear();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 本人の注文か（会員のメール、または引き当て済み）
async function isOwnOrder(req, o, email) {
  const orderEmail = (o.customer?.email || o.email || '').toLowerCase();
  const emails = await memberEmails(email);
  if (emails.includes(orderEmail) || String(email).toLowerCase() === orderEmail) return true;
  if (req.fitpeakUser) {
    const claims = await getClaims(req.fitpeakUser.id);
    return claims.some((c) => c.channel === 'shopify' && String(c.order_ref) === String(o.id));
  }
  return false;
}

// GET /orders/:id - 注文詳細
router.get('/orders/:id', async (req, res) => {
  try {
    const email = req.fitpeakEmail || req.query.email;
    if (!email) return res.status(400).json({ error: 'email required' });

    const store = await getShopifyStore();
    if (!store) return res.status(500).json({ error: 'Shopify not connected' });

    const orderResp = await axios.get(
      `https://${store.shop_domain}/admin/api/2024-01/orders/${req.params.id}.json`,
      { headers: { 'X-Shopify-Access-Token': store.access_token } }
    );
    const o = orderResp.data.order;
    if (!o) return res.status(404).json({ error: 'Order not found' });

    if (!(await isOwnOrder(req, o, email))) return res.status(403).json({ error: 'Unauthorized' });

    // フルフィルメント情報
    let fulfillments = [];
    try {
      const fResp = await axios.get(
        `https://${store.shop_domain}/admin/api/2024-01/orders/${o.id}/fulfillments.json`,
        { headers: { 'X-Shopify-Access-Token': store.access_token } }
      );
      fulfillments = (fResp.data.fulfillments || []).map((f) => ({
        status: f.status,
        shipmentStatus: f.shipment_status,
        trackingCompany: f.tracking_company,
        trackingNumber: f.tracking_number,
        trackingUrl: f.tracking_url,
        createdAt: f.created_at,
      }));
    } catch { /* ignore */ }

    res.json({
      id: o.id,
      name: o.name,
      date: o.created_at,
      total: o.total_price,
      status: o.financial_status,
      fulfillmentStatus: o.fulfillment_status || 'unfulfilled',
      items: (o.line_items || []).map((i) => ({
        title: i.title,
        quantity: i.quantity,
        price: i.price,
        variant: i.variant_title,
        sku: i.sku,
      })),
      shippingAddress: o.shipping_address ? {
        name: o.shipping_address.name,
        address1: o.shipping_address.address1,
        city: o.shipping_address.city,
        province: o.shipping_address.province,
        zip: o.shipping_address.zip,
      } : null,
      fulfillments,
      financialStatus: o.financial_status,
      returnInfo: await buildReturnInfo(o, fulfillments),
    });
  } catch (err) {
    console.error('GET /api/my-fitpeak/orders/:id error:', err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

// 返品・交換の状況と、申請できるか
async function buildReturnInfo(o, fulfillments) {
  try {
    const [status, deadline] = await Promise.all([returns.getReturnStatus(o.id), returns.returnDeadline(o.name, o.created_at)]);
    const shipped = (o.fulfillment_status === 'fulfilled') || fulfillments.length > 0;
    const refunded = ['refunded', 'partially_refunded'].includes(o.financial_status);
    let blocked = null;
    if (status.approved) blocked = '申請は承認済みです';
    else if (refunded) blocked = '返金済みです';
    else if (!shipped) blocked = '発送前のご注文です。キャンセルはLINEからお問い合わせください';
    else if (deadline.remaining < 0) blocked = `返品期限（購入から${deadline.maxDays}日）を過ぎています`;
    else if (status.deniedCount >= 3) blocked = '申請できる回数の上限に達しました。LINEでお問い合わせください';
    return { ...status, deadline: { maxDays: deadline.maxDays, remaining: deadline.remaining }, allowedReasons: deadline.allowedReasons, canRequest: !blocked, blockedReason: blocked };
  } catch (e) {
    console.error('buildReturnInfo error:', e.message);
    return null;
  }
}

// POST /orders/:id/return - 返品・交換の申請（審査は Business-hub の返品・交換審査システムと同じ）
router.post('/orders/:id/return', express.json({ limit: '30mb' }), async (req, res) => {
  try {
    const user = req.fitpeakUser;
    if (!user) return res.status(401).json({ error: 'ログインが必要です' });
    const email = req.fitpeakEmail || user.email;
    const store = await getShopifyStore();
    if (!store) return res.status(500).json({ error: 'Shopify not connected' });

    const r = await axios.get(`https://${store.shop_domain}/admin/api/${SHOPIFY_API}/orders/${req.params.id}.json`, { headers: shopifyHeaders(store), timeout: 15000 });
    const o = r.data.order;
    if (!o) return res.status(404).json({ error: '注文が見つかりません' });
    if (!(await isOwnOrder(req, o, email))) return res.status(403).json({ error: 'この注文は操作できません' });
    if (o.fulfillment_status !== 'fulfilled' && !(o.fulfillments || []).length) {
      return res.status(409).json({ error: '発送前の注文は返品できません' });
    }

    const { requestType, reason, reasonDetail, shippingAddress, images } = req.body || {};
    const result = await returns.submitReturn({ user, order: o, requestType, reason, reasonDetail, shippingAddress, images });
    ordersCache.clear();
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/my-fitpeak/orders/:id/return error:', err.response?.data || err.message);
    res.status(500).json({ error: '申請の処理に失敗しました。時間をおいてお試しください。' });
  }
});

// POST /auth/auto-login - ワンタイムトークンでセッション発行
router.post('/auth/auto-login', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'token required' });

    const supabase = getSupabase();
    const now = new Date().toISOString();

    // トークンを検証
    const { data: tokenData, error: tokenErr } = await supabase
      .from('auto_login_tokens')
      .select('*')
      .eq('token', token)
      .is('used_at', null)
      .gt('expires_at', now)
      .single();

    if (tokenErr || !tokenData) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // トークンを使用済みにする
    await supabase.from('auto_login_tokens')
      .update({ used_at: now })
      .eq('id', tokenData.id);

    return res.json({
      email: tokenData.email,
      verified: true,
    });
  } catch (err) {
    console.error('POST /api/my-fitpeak/auth/auto-login error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /line-link/verify - コードの有効性確認
router.get('/line-link/verify', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).json({ error: 'code required' });

    const supabase = getSupabase();
    const now = new Date().toISOString();

    const { data } = await supabase
      .from('auto_login_tokens')
      .select('id')
      .eq('token', code)
      .is('used_at', null)
      .gt('expires_at', now)
      .maybeSingle();

    if (!data) return res.status(404).json({ error: 'Invalid or expired code' });
    return res.json({ valid: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /auth/reset-password - パスワードリセットメール送信
router.post('/auth/reset-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'メールアドレスを入力してください' });

    const authClient = createClient(
      (process.env.SUPABASE_URL || '').trim(),
      (process.env.SUPABASE_ANON_KEY || '').trim()
    );
    const { error } = await authClient.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: 'https://my.fitpeak.co/login?reset=true',
    });
    if (error) {
      console.error('Reset password error:', error.message);
      return res.status(400).json({ error: `リセットメール送信に失敗しました: ${error.message}` });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('POST /api/my-fitpeak/auth/reset-password error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /auth/signup - 新規アカウント登録
router.post('/auth/signup', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'メールアドレスとパスワードを入力してください' });
    if (password.length < 6) return res.status(400).json({ error: 'パスワードは6文字以上で入力してください' });

    const authClient = createClient(
      (process.env.SUPABASE_URL || '').trim(),
      (process.env.SUPABASE_ANON_KEY || '').trim()
    );
    const { data, error } = await authClient.auth.signUp({ email: email.trim(), password });
    if (error) {
      console.error('Signup error:', error.message);
      const msg = error.message.includes('already registered')
        ? 'このメールアドレスは既に登録されています。ログインして連携してください。'
        : `登録エラー: ${error.message}`;
      return res.status(400).json({ error: msg });
    }
    res.json({ success: true, userId: data?.user?.id });
  } catch (err) {
    console.error('POST /api/my-fitpeak/auth/signup error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /line-link - LIFF経由(lineUserId) or コード + メール/パスワードで連携
router.post('/line-link', async (req, res) => {
  try {
    const { code, lineUserId: liffLineUserId, email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: '必須項目が不足しています' });
    }
    if (!liffLineUserId && !code) {
      return res.status(400).json({ error: 'LINEアカウント情報が不足しています' });
    }

    const supabase = getSupabase();
    const now = new Date().toISOString();

    let lineUserId = liffLineUserId;

    // LIFF経由でlineUserIdが直接来ない場合はコードから取得
    if (!lineUserId && code) {
      const { data: tokenData } = await supabase
        .from('auto_login_tokens')
        .select('*')
        .eq('token', code)
        .is('used_at', null)
        .gt('expires_at', now)
        .single();

      if (!tokenData || !tokenData.line_user_id) {
        return res.status(401).json({ error: 'リンクが無効または期限切れです。LINEから再度お試しください。' });
      }

      lineUserId = tokenData.line_user_id;

      // コードを使用済みにする
      await supabase.from('auto_login_tokens').update({ used_at: now }).eq('id', tokenData.id);
    }

    // My FITPEAKのアカウントを認証
    const authClient = createClient(
      (process.env.SUPABASE_URL || '').trim(),
      (process.env.SUPABASE_ANON_KEY || '').trim()
    );
    const { error: authError } = await authClient.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (authError) {
      console.error('Auth error:', authError.message, authError.status);
      const msg = authError.message === 'Invalid login credentials'
        ? 'メールアドレスまたはパスワードが正しくありません'
        : authError.message.includes('pattern')
        ? 'パスワードの形式が正しくありません。8文字以上で入力してください。'
        : `認証エラー: ${authError.message}`;
      return res.status(401).json({ error: msg });
    }

    // friendsテーブルからLINEユーザーを検索
    const { data: friend } = await supabase
      .from('friends')
      .select('id, display_name, picture_url')
      .eq('line_user_id', lineUserId)
      .maybeSingle();

    if (!friend) {
      return res.status(400).json({ error: 'このLINEアカウントはFITPEAK公式LINEに登録されていません。先に友だち追加してください。' });
    }

    // Shopify顧客を検索
    let shopifyCustomerId = null;
    let shopifyCustomerName = '';
    try {
      const store = await getShopifyStore();
      if (store) {
        const custResp = await axios.get(
          `https://${store.shop_domain}/admin/api/2024-01/customers/search.json?query=email:${encodeURIComponent(email)}`,
          { headers: { 'X-Shopify-Access-Token': store.access_token } }
        );
        const customers = custResp.data.customers || [];
        if (customers.length > 0) {
          shopifyCustomerId = customers[0].id;
          shopifyCustomerName = `${customers[0].first_name || ''} ${customers[0].last_name || ''}`.trim();
        }
      }
    } catch { /* ignore */ }

    // 既存の紐づけチェック
    const { data: existing } = await supabase
      .from('line_shopify_links')
      .select('id')
      .eq('line_user_id', lineUserId)
      .maybeSingle();

    const linkData = {
      friend_id: friend.id,
      line_user_id: lineUserId,
      shopify_customer_id: shopifyCustomerId,
      shopify_email: email,
      shopify_customer_name: shopifyCustomerName || friend.display_name || '',
      is_verified: true,
      linked_at: now,
      updated_at: now,
    };

    if (existing) {
      await supabase.from('line_shopify_links').update(linkData).eq('id', existing.id);
    } else {
      await supabase.from('line_shopify_links').insert(linkData);
    }

    const name = shopifyCustomerName || friend.display_name || '';
    res.json({
      success: true,
      message: `${name}様、LINE連携が完了しました。注文通知や配送情報がLINEに届くようになります。`,
    });
  } catch (err) {
    console.error('POST /api/my-fitpeak/line-link error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// Amazon 注文検索
// ===========================================================================

async function getAmazonAccessToken() {
  const supabase = getSupabase();
  const { data: account } = await supabase
    .from('amazon_sp_accounts')
    .select('*')
    .eq('is_active', true)
    .limit(1)
    .single();
  if (!account) throw new Error('Amazon SP-API未連携');

  const tokenRes = await axios.post(
    'https://api.amazon.com/auth/o2/token',
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: account.refresh_token,
      client_id: account.client_id,
      client_secret: account.client_secret,
    }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  return {
    token: tokenRes.data.access_token,
    endpoint: account.endpoint || 'https://sellingpartnerapi-fe.amazon.com',
  };
}

// POST /amazon-order - Amazon注文番号を自分の注文として登録（注文は保存され、以降は最新の状況が自動で反映される）
router.post('/amazon-order', async (req, res) => {
  try {
    const user = req.fitpeakUser;
    if (!user) return res.status(401).json({ error: 'ログインが必要です' });
    const orderId = String(req.body?.orderId || '').trim();
    if (!/^\d{3}-\d{7}-\d{7}$/.test(orderId)) {
      return res.status(400).json({ error: '注文番号の形式が正しくありません。例: 250-1234567-1234567' });
    }
    if (tooManyAttempts(user.id)) return res.status(429).json({ error: '試行回数が多すぎます。1時間ほど空けてお試しください。' });

    const order = await fetchAmazonOrder(orderId);
    if (!order) return res.status(404).json({ error: '注文が見つかりません。注文番号を再度ご確認ください。' });

    const supabase = getSupabase();
    const { data: exist } = await supabase.from('member_order_claims').select('auth_user_id').eq('channel', 'amazon').eq('order_ref', orderId).maybeSingle();
    if (exist && exist.auth_user_id !== user.id) {
      return res.status(409).json({ error: 'この注文はすでに別のアカウントに登録されています。心当たりがない場合はLINEでご連絡ください。' });
    }
    if (!exist) {
      await supabase.from('member_order_claims').insert({ auth_user_id: user.id, channel: 'amazon', order_ref: orderId, order_label: orderId });
    }
    ordersCache.clear();
    res.json(order);
  } catch (err) {
    console.error('POST /api/my-fitpeak/amazon-order error:', err.response?.data || err.message);
    const status = err.response?.status;
    if (status === 404 || status === 400) return res.status(404).json({ error: '注文が見つかりません。注文番号を再度ご確認ください。' });
    return res.status(500).json({ error: err.message });
  }
});

// ── 通知の設定（2026-09-26）──────────────────────────────
// LINEで受け取るのは「セール・新商品のお知らせ」だけ（campaign）。
// 価格アラート・大会の続報・リマインドはメールで受け取る（初期値OFF・希望者のみ）。
const NOTIFY_FIELDS = ['campaign', 'email_price_alert', 'email_contest', 'email_reminder'];
const INTERNAL_EMAIL = /@line\.fitpeak\.co$/i;

async function resolveMember(supabase, req) {
  const user = req.fitpeakUser;
  if (!user) return null;
  const byAuth = await supabase.from('members').select('id, email, plan').eq('auth_user_id', user.id).maybeSingle();
  if (byAuth.data) return byAuth.data;
  if (user.email) {
    const byEmail = await supabase.from('members').select('id, email, plan').eq('email', user.email).limit(1).maybeSingle();
    if (byEmail.data) return byEmail.data;
  }
  return null;
}

// ── 保証登録（施策⑪ 同梱カードQR→保証登録。claude/hoshou-qr-ugc-kuchikomi-sekkei.md 準拠）───
// 移行期は「注文番号方式」のみ対応（暫定・第3項）。シリアル番号方式は次回ロット以降。
//
// 【要確認・暫定値】Shopify側の商品バリアントにSKUが未設定（`sku`フィールドが空）のため、
// 「sku」はShopifyの商品ハンドル（Admin GraphQL productのhandle）を代用値として使う。
// 下記3件はShopifyで確認できた商品のみ。ニースリーブ／エルボースリーブ／リストストラップは
// 2026-09-27時点でShopifyストアに商品ページが見つからず未確定（Amazon専売の可能性）。
// 対象を追加する場合は、実際の商品ハンドル or 正式なSKU運用（第6項）を確認してから追加すること。
const WARRANTY_MONTHS = { free: 18, pro: 24 }; // 通常1.5年／PRO2年（第5項）
const WARRANTY_SKUS = new Set([
  'fitpeak-リストラップ',
  'fitpeak-本革トレーニングベルト',
  'fitpeak-パワーグリップ',
]);
const AMAZON_ORDER_ID_RE = /^\d{3}-\d{7}-\d{7}$/;

// GET /warranty-register/status?sku=... - 対象商品の登録済み状況（フォーム側の事前チェック用）
router.get('/warranty-register/status', async (req, res) => {
  try {
    if (!req.fitpeakUser) return res.status(401).json({ error: 'ログインが必要です' });
    const supabase = getSupabase();
    const member = await resolveMember(supabase, req);
    if (!member) return res.status(404).json({ error: '会員情報が見つかりません' });

    const { data } = await supabase
      .from('warranty_registrations')
      .select('sku, warranty_months, warranty_expires_at, status, registered_at')
      .eq('member_id', member.id)
      .eq('status', 'active');

    res.json({ registrations: data || [] });
  } catch (err) {
    console.error('GET /api/my-fitpeak/warranty-register/status error:', err.message);
    res.status(500).json({ error: '保証登録状況の取得に失敗しました' });
  }
});

// POST /warranty-register - 保証登録の確定
router.post('/warranty-register', async (req, res) => {
  try {
    if (!req.fitpeakUser) return res.status(401).json({ error: 'ログインが必要です' });
    const supabase = getSupabase();
    const member = await resolveMember(supabase, req);
    if (!member) return res.status(404).json({ error: '会員情報が見つかりません' });

    const body = req.body || {};
    const sku = String(body.sku || '').trim();
    const orderNumber = String(body.orderNumber || '').trim();
    const purchaseDate = String(body.purchaseDate || '').trim();

    if (!WARRANTY_SKUS.has(sku)) {
      return res.status(400).json({ error: '商品を選択してください' });
    }
    if (!AMAZON_ORDER_ID_RE.test(orderNumber)) {
      return res.status(400).json({ error: '注文番号の形式が正しくありません。例: 250-1234567-1234567（Amazonの注文履歴でご確認いただけます）' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate) || Number.isNaN(Date.parse(purchaseDate))) {
      return res.status(400).json({ error: '購入日を選択してください' });
    }

    const plan = member.plan === 'pro' ? 'pro' : 'free';
    const months = WARRANTY_MONTHS[plan];
    const expires = new Date(purchaseDate);
    expires.setMonth(expires.getMonth() + months);
    const warrantyExpiresAt = expires.toISOString().slice(0, 10);

    const { data: inserted, error } = await supabase
      .from('warranty_registrations')
      .insert({
        member_id: member.id,
        sku,
        verification_method: 'order_number',
        verification_key: orderNumber,
        purchase_date: purchaseDate,
        plan_at_registration: plan,
        warranty_months: months,
        warranty_expires_at: warrantyExpiresAt,
      })
      .select('id, sku, warranty_months, warranty_expires_at')
      .single();

    if (error) {
      // (sku, verification_key) の一意制約違反 = 登録済み
      if (error.code === '23505') {
        return res.status(409).json({ error: 'この商品・注文番号はすでに保証登録されています' });
      }
      throw error;
    }

    res.json({
      success: true,
      warrantyMonths: inserted.warranty_months,
      warrantyExpiresAt: inserted.warranty_expires_at,
      plan,
      upsell: plan === 'free', // free会員には「PROなら2年」の案内を1回表示（第5項）
    });
  } catch (err) {
    console.error('POST /api/my-fitpeak/warranty-register error:', err.message);
    res.status(500).json({ error: '保証登録に失敗しました。時間をおいて再度お試しください。' });
  }
});

// GET /notification-prefs - 本人の通知設定
router.get('/notification-prefs', async (req, res) => {
  try {
    if (!req.fitpeakUser) return res.status(401).json({ error: 'ログインが必要です' });
    const supabase = getSupabase();
    const member = await resolveMember(supabase, req);
    if (!member) return res.status(404).json({ error: '会員情報が見つかりません' });

    const { data: row } = await supabase.from('notification_prefs').select('*').eq('member_id', member.id).maybeSingle();
    const loginEmail = req.fitpeakUser.email || '';
    const defaultEmail = INTERNAL_EMAIL.test(loginEmail) ? '' : loginEmail;
    res.json({
      campaign: row ? row.campaign : true,
      email_price_alert: row ? row.email_price_alert : false,
      email_contest: row ? row.email_contest : false,
      email_reminder: row ? row.email_reminder : false,
      notify_email: (row && row.notify_email) || defaultEmail,
    });
  } catch (err) {
    console.error('GET /api/my-fitpeak/notification-prefs error:', err.message);
    res.status(500).json({ error: '通知設定の取得に失敗しました' });
  }
});

// PUT /notification-prefs - 本人の通知設定を保存
router.put('/notification-prefs', async (req, res) => {
  try {
    if (!req.fitpeakUser) return res.status(401).json({ error: 'ログインが必要です' });
    const supabase = getSupabase();
    const member = await resolveMember(supabase, req);
    if (!member) return res.status(404).json({ error: '会員情報が見つかりません' });

    const body = req.body || {};
    const update = { member_id: member.id, updated_at: new Date().toISOString() };
    for (const f of NOTIFY_FIELDS) {
      if (typeof body[f] === 'boolean') update[f] = body[f];
    }
    const email = typeof body.notify_email === 'string' ? body.notify_email.trim() : '';
    const wantsEmail = ['email_price_alert', 'email_contest', 'email_reminder'].some((f) => update[f] === true);
    if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || INTERNAL_EMAIL.test(email))) {
      return res.status(400).json({ error: 'メールアドレスの形式が正しくありません' });
    }
    if (wantsEmail && !email) {
      return res.status(400).json({ error: 'メールで受け取るには、メールアドレスを入力してください' });
    }
    update.notify_email = email || null;

    const { error } = await supabase.from('notification_prefs').upsert(update, { onConflict: 'member_id' });
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/my-fitpeak/notification-prefs error:', err.message);
    res.status(500).json({ error: '通知設定の保存に失敗しました' });
  }
});

module.exports = router;

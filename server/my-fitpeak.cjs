const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

// Supabase
function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY missing');
  return createClient(url, key);
}

// Shopify store info
async function getShopifyStore() {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('channel_stores')
    .select('shop_domain, access_token')
    .eq('channel', 'SHOPIFY')
    .eq('is_active', true)
    .limit(1)
    .single();
  return data;
}

// GET /orders - メールアドレスでShopify注文を取得
router.get('/orders', async (req, res) => {
  try {
    const { email, limit = '10' } = req.query;
    if (!email) return res.status(400).json({ error: 'email required' });

    const store = await getShopifyStore();
    if (!store) return res.status(500).json({ error: 'Shopify not connected' });

    // 顧客を検索
    const custResp = await axios.get(
      `https://${store.shop_domain}/admin/api/2024-01/customers/search.json?query=email:${encodeURIComponent(email)}`,
      { headers: { 'X-Shopify-Access-Token': store.access_token } }
    );
    const customers = custResp.data.customers || [];
    if (customers.length === 0) return res.json({ orders: [] });

    const customerId = customers[0].id;
    const orderResp = await axios.get(
      `https://${store.shop_domain}/admin/api/2024-01/customers/${customerId}/orders.json?status=any&limit=${limit}`,
      { headers: { 'X-Shopify-Access-Token': store.access_token } }
    );

    const orders = (orderResp.data.orders || []).map((o) => {
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
      };
    });

    res.json({ orders });
  } catch (err) {
    console.error('GET /api/my-fitpeak/orders error:', err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /orders/:id - 注文詳細
router.get('/orders/:id', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'email required' });

    const store = await getShopifyStore();
    if (!store) return res.status(500).json({ error: 'Shopify not connected' });

    const orderResp = await axios.get(
      `https://${store.shop_domain}/admin/api/2024-01/orders/${req.params.id}.json`,
      { headers: { 'X-Shopify-Access-Token': store.access_token } }
    );
    const o = orderResp.data.order;
    if (!o) return res.status(404).json({ error: 'Order not found' });

    // 本人確認: メールが一致するか
    const orderEmail = o.customer?.email || o.email;
    if (orderEmail?.toLowerCase() !== String(email).toLowerCase()) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

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
    });
  } catch (err) {
    console.error('GET /api/my-fitpeak/orders/:id error:', err.response?.data || err.message);
    res.status(500).json({ error: err.message });
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

// POST /amazon-order - Amazon注文番号で検索
router.post('/amazon-order', async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ error: 'orderId required' });

    // 注文番号フォーマットチェック
    if (!/^\d{3}-\d{7}-\d{7}$/.test(orderId.trim())) {
      return res.status(400).json({ error: '注文番号の形式が正しくありません。例: 250-1234567-1234567' });
    }

    const { token, endpoint } = await getAmazonAccessToken();

    // 注文取得
    const orderRes = await axios.get(
      `${endpoint}/orders/v0/orders/${orderId.trim()}`,
      { headers: { 'x-amz-access-token': token } }
    );
    const order = orderRes.data.payload;
    if (!order) return res.status(404).json({ error: '注文が見つかりません' });

    // 注文アイテム取得
    let items = [];
    try {
      const itemsRes = await axios.get(
        `${endpoint}/orders/v0/orders/${orderId.trim()}/orderItems`,
        { headers: { 'x-amz-access-token': token } }
      );
      items = (itemsRes.data.payload?.OrderItems || []).map((i) => ({
        title: i.Title,
        sku: i.SellerSKU,
        quantity: i.QuantityOrdered,
        price: i.ItemPrice?.Amount || '0',
        variant: '',
      }));
    } catch { /* ignore */ }

    res.json({
      source: 'amazon',
      id: order.AmazonOrderId,
      name: order.AmazonOrderId,
      date: order.PurchaseDate,
      total: order.OrderTotal?.Amount || '0',
      status: order.OrderStatus,
      fulfillmentStatus: order.OrderStatus === 'Shipped' ? 'fulfilled' : order.OrderStatus === 'Unshipped' ? 'unfulfilled' : order.OrderStatus,
      buyerName: order.BuyerInfo?.BuyerName || '',
      items,
      fulfillmentChannel: order.FulfillmentChannel,
    });
  } catch (err) {
    console.error('POST /api/my-fitpeak/amazon-order error:', err.response?.data || err.message);
    const status = err.response?.status;
    if (status === 404 || status === 400) return res.status(404).json({ error: '注文が見つかりません。注文番号を再度ご確認ください。' });
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;

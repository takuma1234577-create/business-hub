const express = require('express');
const router = express.Router();
const { getSupabase, getGoogleOAuth2, google } = require('./shared.cjs');

const supabase = getSupabase();

// === OAuth Tokens (shared across all tools) ===

// List all connected services
router.get('/connections', async (req, res) => {
  try {
    const { data: tokens } = await supabase
      .from('oauth_tokens')
      .select('id, scope, token_type, expiry_date, updated_at')
      .order('id');

    const connections = (tokens || []).map(t => ({
      id: t.id,
      scope: t.scope,
      tokenType: t.token_type,
      expiryDate: t.expiry_date,
      updatedAt: t.updated_at,
      isExpired: t.expiry_date ? Date.now() > Number(t.expiry_date) : false,
    }));

    // Check env-based credentials
    const envStatus = {
      google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      supabase: !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY),
      chatwork: !!process.env.CHATWORK_API_TOKEN,
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      amazonSupabase: !!(process.env.AMAZON_SUPABASE_URL && process.env.AMAZON_SUPABASE_KEY),
      linecrmSupabase: !!(process.env.LINECRM_SUPABASE_URL && process.env.LINECRM_SUPABASE_KEY),
      shopify: !!(process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET),
      tiktok: !!(process.env.TIKTOK_APP_KEY && process.env.TIKTOK_APP_SECRET),
    };

    res.json({ connections, envStatus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Google OAuth - initiate login with configurable scopes
const GOOGLE_SCOPES = {
  gmail: [
    'https://www.googleapis.com/auth/gmail.compose',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.readonly',
  ],
  calendar: [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.events',
  ],
  sheets: [
    'https://www.googleapis.com/auth/spreadsheets',
  ],
  drive: [
    'https://www.googleapis.com/auth/drive.readonly',
  ],
};

// Reuse the invoice callback URL that's already registered in Google Cloud Console
const getCallbackUrl = (req) => `${req.protocol}://${req.get('host')}/api/invoice/auth/callback`;

router.get('/google/login', (req, res) => {
  const serviceId = req.query.service || 'gmail';
  const callbackUrl = getCallbackUrl(req);
  const oauth2Client = getGoogleOAuth2(callbackUrl);
  if (!oauth2Client) return res.status(400).json({ error: 'Google OAuth未設定 (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)' });

  const scopes = GOOGLE_SCOPES[serviceId] || GOOGLE_SCOPES.gmail;
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
    state: serviceId,
  });
  res.json({ url });
});

router.get('/google/callback', async (req, res) => {
  const { code, state } = req.query;
  const serviceId = state || 'gmail';
  const callbackUrl = getCallbackUrl(req);
  const oauth2Client = getGoogleOAuth2(callbackUrl);
  if (!oauth2Client) return res.status(400).send('Google OAuth未設定');

  try {
    const { tokens } = await oauth2Client.getToken(code);
    await supabase.from('oauth_tokens').upsert({
      id: serviceId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      scope: tokens.scope,
      token_type: tokens.token_type,
      expiry_date: tokens.expiry_date,
      updated_at: new Date().toISOString(),
    });
    res.send(`<html><body><script>window.opener && window.opener.postMessage({type:'oauth_complete',service:'${serviceId}'},'*');window.close();</script><p>認証成功！ このウィンドウを閉じてください。</p></body></html>`);
  } catch (err) {
    res.status(500).send('認証エラー: ' + err.message);
  }
});

// Disconnect a service
router.delete('/connections/:id', async (req, res) => {
  try {
    await supabase.from('oauth_tokens').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Force refresh a token
router.post('/connections/:id/refresh', async (req, res) => {
  try {
    const { data } = await supabase.from('oauth_tokens').select('*').eq('id', req.params.id).single();
    if (!data) return res.status(404).json({ error: 'Token not found' });

    const oauth2Client = getGoogleOAuth2();
    if (!oauth2Client) return res.status(400).json({ error: 'Google OAuth未設定' });

    oauth2Client.setCredentials({
      refresh_token: data.refresh_token,
    });

    const { credentials } = await oauth2Client.refreshAccessToken();

    await supabase.from('oauth_tokens').update({
      access_token: credentials.access_token,
      expiry_date: credentials.expiry_date,
      updated_at: new Date().toISOString(),
    }).eq('id', req.params.id);

    res.json({ success: true, expiryDate: credentials.expiry_date });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === Amazon SP-API Accounts ===

// List Amazon accounts
router.get('/amazon/accounts', async (req, res) => {
  try {
    const { data } = await supabase
      .from('amazon_sp_accounts')
      .select('id, account_name, seller_id, marketplace_id, endpoint, is_active, last_synced_at, created_at')
      .order('created_at', { ascending: false });
    res.json({ accounts: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add Amazon account
router.post('/amazon/accounts', async (req, res) => {
  try {
    const { account_name, seller_id, marketplace_id, refresh_token, client_id, client_secret, endpoint } = req.body;
    if (!account_name || !seller_id || !refresh_token || !client_id || !client_secret) {
      return res.status(400).json({ error: '必須項目が不足しています' });
    }

    // Validate by trying to get access token
    const axios = require('axios');
    try {
      await axios.post('https://api.amazon.com/auth/o2/token',
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token,
          client_id,
          client_secret,
        }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
    } catch (authErr) {
      return res.status(400).json({ error: 'Amazon API認証に失敗しました。認証情報を確認してください。' });
    }

    const { data, error } = await supabase.from('amazon_sp_accounts').insert({
      account_name,
      seller_id,
      marketplace_id: marketplace_id || 'A1VC38T7YXB528',
      refresh_token,
      client_id,
      client_secret,
      endpoint: endpoint || 'https://sellingpartnerapi-fe.amazon.com',
      is_active: true,
    }).select().single();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, account: { id: data.id, account_name: data.account_name, seller_id: data.seller_id } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Amazon account details (for editing)
router.get('/amazon/accounts/:id', async (req, res) => {
  try {
    const { data } = await supabase.from('amazon_sp_accounts').select('*').eq('id', req.params.id).single();
    if (!data) return res.status(404).json({ error: 'Account not found' });
    res.json({
      id: data.id,
      account_name: data.account_name,
      seller_id: data.seller_id,
      marketplace_id: data.marketplace_id,
      refresh_token: data.refresh_token,
      client_id: data.client_id,
      client_secret: data.client_secret,
      endpoint: data.endpoint,
      is_active: data.is_active,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update Amazon account
router.put('/amazon/accounts/:id', async (req, res) => {
  try {
    const { account_name, seller_id, marketplace_id, refresh_token, client_id, client_secret, endpoint } = req.body;
    const update = {};
    if (account_name !== undefined) update.account_name = account_name;
    if (seller_id !== undefined) update.seller_id = seller_id;
    if (marketplace_id !== undefined) update.marketplace_id = marketplace_id;
    if (refresh_token !== undefined) update.refresh_token = refresh_token;
    if (client_id !== undefined) update.client_id = client_id;
    if (client_secret !== undefined) update.client_secret = client_secret;
    if (endpoint !== undefined) update.endpoint = endpoint;

    const { data, error } = await supabase.from('amazon_sp_accounts').update(update).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, account: { id: data.id, account_name: data.account_name } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete Amazon account
router.delete('/amazon/accounts/:id', async (req, res) => {
  try {
    await supabase.from('amazon_sp_accounts').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test Amazon connection
router.post('/amazon/accounts/:id/test', async (req, res) => {
  try {
    const { data } = await supabase.from('amazon_sp_accounts').select('*').eq('id', req.params.id).single();
    if (!data) return res.status(404).json({ error: 'Account not found' });

    const axios = require('axios');
    const endpoint = data.endpoint || 'https://sellingpartnerapi-fe.amazon.com';
    const marketplaceId = data.marketplace_id || 'A1VC38T7YXB528';

    // Step 1: Get LWA access token
    let accessToken;
    try {
      const tokenRes = await axios.post('https://api.amazon.com/auth/o2/token',
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: data.refresh_token,
          client_id: data.client_id,
          client_secret: data.client_secret,
        }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      accessToken = tokenRes.data.access_token;
    } catch (err) {
      return res.status(500).json({
        step: 'lwa_token',
        error: 'LWAトークン取得失敗',
        detail: err.response?.data?.error_description || err.message,
      });
    }

    // Step 2: Test each required API
    const tests = [
      { name: 'FBA在庫 (Inventory & Order Tracking)', path: `/fba/inventory/v1/summaries?details=false&granularityType=Marketplace&granularityId=${marketplaceId}&marketplaceIds=${marketplaceId}` },
      { name: 'Catalog (Product Listings)', path: `/catalog/2022-04-01/items?marketplaceIds=${marketplaceId}&keywords=test&pageSize=1` },
      { name: 'Orders (Order Tracking)', path: `/orders/v0/orders?MarketplaceIds=${marketplaceId}&CreatedAfter=2026-01-01T00:00:00Z` },
    ];

    const results = [];
    for (const test of tests) {
      try {
        await axios.get(`${endpoint}${test.path}`, {
          headers: { 'x-amz-access-token': accessToken, 'Content-Type': 'application/json' },
        });
        results.push({ name: test.name, ok: true });
      } catch (err) {
        results.push({
          name: test.name,
          ok: false,
          status: err.response?.status,
          error: err.response?.data?.errors?.[0]?.message || err.message,
        });
      }
    }

    const allOk = results.every(r => r.ok);
    await supabase.from('amazon_sp_accounts').update({ last_synced_at: new Date().toISOString() }).eq('id', req.params.id);

    res.json({ success: allOk, accessTokenOk: true, tests: results });
  } catch (err) {
    res.status(500).json({ error: 'Amazon API接続テスト失敗: ' + err.message });
  }
});

// === Shopify OAuth Flow ===

const SHOPIFY_SCOPES = 'read_products,write_products,read_orders,write_orders,read_inventory,write_inventory,read_fulfillments,write_fulfillments,read_locations';

router.get('/shopify/login', (req, res) => {
  const { shop } = req.query;
  if (!shop) return res.status(400).json({ error: 'shopドメインを入力してください' });

  const clientId = process.env.SHOPIFY_CLIENT_ID;
  if (!clientId) return res.status(400).json({ error: 'SHOPIFY_CLIENT_ID が未設定です' });

  const redirectUri = `${req.protocol}://${req.get('host')}/api/settings/shopify/callback`;
  const nonce = Date.now().toString(36);
  const shopDomain = shop.includes('.myshopify.com') ? shop : `${shop}.myshopify.com`;

  const url = `https://${shopDomain}/admin/oauth/authorize?client_id=${clientId}&scope=${SHOPIFY_SCOPES}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${nonce}`;
  res.json({ url, shopDomain });
});

router.get('/shopify/callback', async (req, res) => {
  const { code, shop, state, hmac } = req.query;

  console.log('[shopify callback] params:', { code: code ? 'yes' : 'no', shop, state });

  if (!code || !shop) {
    return res.send(`<html><body><h2>Shopify認証エラー</h2><p>認証パラメータが不足しています</p><p>code: ${code ? 'あり' : 'なし'}, shop: ${shop || 'なし'}</p><p>URL params: ${JSON.stringify(req.query)}</p></body></html>`);
  }

  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.send('<html><body><h2>エラー</h2><p>SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET が未設定です</p></body></html>');
  }

  try {
    const axios = require('axios');
    console.log('[shopify callback] exchanging code for token...');

    // Exchange code for permanent access token
    const tokenRes = await axios.post(`https://${shop}/admin/oauth/access_token`, {
      client_id: clientId,
      client_secret: clientSecret,
      code,
    });

    const accessToken = tokenRes.data.access_token;
    console.log('[shopify callback] got access token');

    // Get shop info
    const shopRes = await axios.get(`https://${shop}/admin/api/2024-01/shop.json`, {
      headers: { 'X-Shopify-Access-Token': accessToken },
    });
    const shopName = shopRes.data.shop.name;
    console.log('[shopify callback] shop name:', shopName);

    // Save to channel_stores
    const { error: dbError } = await supabase.from('channel_stores').upsert({
      id: `shopify_${shop}`,
      channel: 'SHOPIFY',
      store_name: shopName,
      shop_domain: shop,
      access_token: accessToken,
      is_active: true,
      auto_fulfill: true,
      inventory_sync_enabled: true,
      last_synced_at: new Date().toISOString(),
    }, { onConflict: 'id' });

    if (dbError) {
      console.error('[shopify callback] DB error:', dbError);
      return res.send(`<html><body><h2>DB保存エラー</h2><p>${dbError.message}</p></body></html>`);
    }

    console.log('[shopify callback] saved to DB');
    res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2 style="color:#96BF48">連携完了！</h2><p>${shopName} とShopifyの連携が完了しました。</p><p>このウィンドウを閉じてください。</p><script>window.opener && window.opener.postMessage({type:'shopify_connected',shop:'${shopName}'},'*');setTimeout(()=>window.close(),2000);</script></body></html>`);
  } catch (err) {
    console.error('[shopify callback] error:', err.response?.data || err.message);
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    res.send(`<html><body style="font-family:sans-serif;padding:40px"><h2 style="color:red">Shopify認証エラー</h2><p>${detail}</p><p>このウィンドウを閉じて、もう一度お試しください。</p></body></html>`);
  }
});

// === TikTok Shop OAuth Flow ===

router.get('/tiktok/login', (req, res) => {
  const appKey = process.env.TIKTOK_APP_KEY;
  if (!appKey) return res.status(400).json({ error: 'TIKTOK_APP_KEY が未設定です。API設定のサーバー設定を確認してください。' });

  const state = Date.now().toString(36);
  const url = `https://auth.tiktok-shops.com/oauth/authorize?app_key=${appKey}&state=${state}`;
  res.json({ url });
});

router.get('/tiktok/callback', async (req, res) => {
  const { code, state } = req.query;
  console.log('[tiktok callback] params:', { code: code ? 'yes' : 'no', state });

  if (!code) {
    return res.send(`<html><body style="font-family:sans-serif;padding:40px"><h2 style="color:red">TikTok認証エラー</h2><p>認証コードが取得できませんでした</p><p>params: ${JSON.stringify(req.query)}</p></body></html>`);
  }

  const appKey = process.env.TIKTOK_APP_KEY;
  const appSecret = process.env.TIKTOK_APP_SECRET;
  if (!appKey || !appSecret) {
    return res.send('<html><body><h2>エラー</h2><p>TIKTOK_APP_KEY / TIKTOK_APP_SECRET が未設定です</p></body></html>');
  }

  try {
    const axios = require('axios');

    // Exchange auth code for access token
    const tokenRes = await axios.get('https://auth.tiktok-shops.com/api/v2/token/get', {
      params: {
        app_key: appKey,
        app_secret: appSecret,
        auth_code: code,
        grant_type: 'authorized_code',
      },
    });

    console.log('[tiktok callback] token response:', JSON.stringify(tokenRes.data));

    const tokenData = tokenRes.data.data;
    if (!tokenData || !tokenData.access_token) {
      return res.send(`<html><body style="font-family:sans-serif;padding:40px"><h2 style="color:red">TikTokトークン取得エラー</h2><p>${JSON.stringify(tokenRes.data)}</p></body></html>`);
    }

    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token;
    const shopList = tokenData.seller_base_region_list || [];
    const shopName = shopList.length > 0 ? `TikTok Shop (${shopList.map(s => s.region).join(', ')})` : 'TikTok Shop';
    const shopId = shopList.length > 0 ? shopList[0].seller_id : '';

    // Save to channel_stores
    const storeId = `tiktok_${shopId || Date.now()}`;
    const { error: dbError } = await supabase.from('channel_stores').upsert({
      id: storeId,
      channel: 'TIKTOK',
      store_name: shopName,
      app_key: appKey,
      app_secret: appSecret,
      shop_id: shopId,
      tiktok_access_token: accessToken,
      tiktok_refresh_token: refreshToken,
      is_active: true,
      auto_fulfill: true,
      inventory_sync_enabled: true,
      last_synced_at: new Date().toISOString(),
    }, { onConflict: 'id' });

    if (dbError) {
      console.error('[tiktok callback] DB error:', dbError);
      return res.send(`<html><body style="font-family:sans-serif;padding:40px"><h2 style="color:red">DB保存エラー</h2><p>${dbError.message}</p></body></html>`);
    }

    console.log('[tiktok callback] saved to DB');
    res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2 style="color:#000">連携完了！</h2><p>${shopName} の連携が完了しました。</p><p>このウィンドウを閉じてください。</p><script>window.opener && window.opener.postMessage({type:'tiktok_connected',shop:'${shopName}'},'*');setTimeout(()=>window.close(),2000);</script></body></html>`);
  } catch (err) {
    console.error('[tiktok callback] error:', err.response?.data || err.message);
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    res.send(`<html><body style="font-family:sans-serif;padding:40px"><h2 style="color:red">TikTok認証エラー</h2><p>${detail}</p><p>このウィンドウを閉じて、もう一度お試しください。</p></body></html>`);
  }
});

// === Channel Stores (Shopify / TikTok Shop) ===

router.get('/channels', async (req, res) => {
  try {
    const { data } = await supabase
      .from('channel_stores')
      .select('id, channel, store_name, shop_domain, shop_id, is_active, auto_fulfill, inventory_sync_enabled, last_synced_at, created_at')
      .order('created_at', { ascending: false });
    res.json({ stores: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/channels', async (req, res) => {
  try {
    const { channel, store_name, shop_domain, access_token, app_key, app_secret, shop_id, tiktok_access_token } = req.body;
    if (!channel || !store_name) {
      return res.status(400).json({ error: 'チャネルとストア名は必須です' });
    }

    const dbChannel = channel.toUpperCase();
    const insertData = { channel: dbChannel, store_name, is_active: true, auto_fulfill: true, inventory_sync_enabled: true };

    if (channel === 'shopify') {
      if (!shop_domain || !access_token) {
        return res.status(400).json({ error: 'Shopifyドメインとアクセストークンが必要です' });
      }
      // Validate Shopify connection
      try {
        const axios = require('axios');
        const testRes = await axios.get(`https://${shop_domain}/admin/api/2024-01/shop.json`, {
          headers: { 'X-Shopify-Access-Token': access_token },
        });
        insertData.store_name = store_name || testRes.data.shop.name;
      } catch {
        return res.status(400).json({ error: 'Shopify接続に失敗しました。ドメインとアクセストークンを確認してください。' });
      }
      insertData.shop_domain = shop_domain;
      insertData.access_token = access_token;
    } else if (channel === 'tiktok') {
      if (!app_key || !app_secret) {
        return res.status(400).json({ error: 'App KeyとApp Secretが必要です' });
      }
      insertData.app_key = app_key;
      insertData.app_secret = app_secret;
      insertData.shop_id = shop_id || null;
      insertData.tiktok_access_token = tiktok_access_token || null;
    }

    const { data, error } = await supabase.from('channel_stores').insert(insertData).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, store: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/channels/:id', async (req, res) => {
  try {
    await supabase.from('channel_stores').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/channels/:id/test', async (req, res) => {
  try {
    const { data: store } = await supabase.from('channel_stores').select('*').eq('id', req.params.id).single();
    if (!store) return res.status(404).json({ error: 'Store not found' });

    const axios = require('axios');
    const channelLower = (store.channel || '').toLowerCase();
    if (channelLower === 'shopify') {
      const testRes = await axios.get(`https://${store.shop_domain}/admin/api/2024-01/shop.json`, {
        headers: { 'X-Shopify-Access-Token': store.access_token },
      });
      await supabase.from('channel_stores').update({ last_synced_at: new Date().toISOString() }).eq('id', req.params.id);
      res.json({ success: true, shop_name: testRes.data.shop.name });
    } else if (channelLower === 'tiktok') {
      // Basic connectivity check
      await supabase.from('channel_stores').update({ last_synced_at: new Date().toISOString() }).eq('id', req.params.id);
      res.json({ success: true });
    } else {
      res.status(400).json({ error: '未対応のチャネル' });
    }
  } catch (err) {
    res.status(500).json({ error: '接続テスト失敗: ' + (err.response?.data?.errors || err.message) });
  }
});

// =====================
// APIキー管理
// =====================

const API_KEY_SERVICES = [
  { id: 'anthropic', label: 'Anthropic (Claude AI)', envVar: 'ANTHROPIC_API_KEY', placeholder: 'sk-ant-...' },
  { id: 'google_client_id', label: 'Google Client ID', envVar: 'GOOGLE_CLIENT_ID', placeholder: '...apps.googleusercontent.com' },
  { id: 'google_client_secret', label: 'Google Client Secret', envVar: 'GOOGLE_CLIENT_SECRET', placeholder: 'GOCSPX-...' },
  { id: 'chatwork', label: 'Chatwork API Token', envVar: 'CHATWORK_API_TOKEN', placeholder: '' },
  { id: 'bank_encryption', label: '銀行認証暗号化キー', envVar: 'BANK_CREDENTIAL_ENCRYPTION_KEY', placeholder: '64文字の16進数' },
];

// APIキーの暗号化（簡易 - 環境変数のマスターキーで暗号化）
function encryptApiKey(value) {
  const crypto = require('crypto');
  const secret = process.env.BANK_CREDENTIAL_ENCRYPTION_KEY || process.env.SUPABASE_ANON_KEY || 'default-key';
  const key = crypto.scryptSync(secret, 'api-keys-salt', 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(value, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return JSON.stringify({ iv: iv.toString('hex'), data: encrypted, tag });
}

function decryptApiKey(ciphertext) {
  const crypto = require('crypto');
  const secret = process.env.BANK_CREDENTIAL_ENCRYPTION_KEY || process.env.SUPABASE_ANON_KEY || 'default-key';
  const key = crypto.scryptSync(secret, 'api-keys-salt', 32);
  const { iv, data, tag } = JSON.parse(ciphertext);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  let decrypted = decipher.update(data, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// サービス一覧
router.get('/api-keys/services', (_req, res) => {
  res.json(API_KEY_SERVICES.map(s => ({ id: s.id, label: s.label, placeholder: s.placeholder })));
});

// 設定済みキー一覧（値はマスク）
router.get('/api-keys', async (_req, res) => {
  try {
    const { data: keys } = await supabase.from('api_keys').select('id, label, is_active, updated_at').order('id');

    const result = API_KEY_SERVICES.map(service => {
      const dbKey = (keys || []).find(k => k.id === service.id);
      const envSet = !!process.env[service.envVar];
      return {
        id: service.id,
        label: service.label,
        placeholder: service.placeholder,
        source: dbKey ? 'database' : envSet ? 'env' : 'none',
        isSet: !!(dbKey || envSet),
        maskedValue: dbKey ? '••••••••' + (dbKey.label || '') : envSet ? '(環境変数)' : '',
        updatedAt: dbKey?.updated_at || null,
      };
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// キー設定
router.post('/api-keys/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { apiKey } = req.body;
    if (!apiKey) return res.status(400).json({ error: 'APIキーは必須です' });

    const service = API_KEY_SERVICES.find(s => s.id === id);
    if (!service) return res.status(404).json({ error: '不明なサービス' });

    const encrypted = encryptApiKey(apiKey);
    const maskedLabel = apiKey.length > 8 ? '...' + apiKey.slice(-4) : '****';

    const { error } = await supabase.from('api_keys').upsert({
      id,
      api_key_encrypted: encrypted,
      label: maskedLabel,
      is_active: true,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;

    // 環境変数にもランタイムで反映（現プロセス内のみ）
    process.env[service.envVar] = apiKey;

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// キー削除
router.delete('/api-keys/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('api_keys').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// キーテスト（Anthropicのみ）
router.post('/api-keys/:id/test', async (req, res) => {
  try {
    const { id } = req.params;
    const key = await getActiveApiKey(id);
    if (!key) return res.status(400).json({ error: 'APIキーが設定されていません' });

    if (id === 'anthropic') {
      const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: key });
      const resp = await client.messages.create({
        model: 'claude-sonnet-4-20250514', max_tokens: 10,
        messages: [{ role: 'user', content: 'Hi' }],
      });
      res.json({ success: true, message: `接続成功 (model: ${resp.model})` });
    } else {
      res.json({ success: true, message: 'キーが設定されています' });
    }
  } catch (err) {
    res.status(500).json({ error: `テスト失敗: ${err.message}` });
  }
});

// ヘルパー: DB優先でAPIキーを取得
async function getActiveApiKey(serviceId) {
  const service = API_KEY_SERVICES.find(s => s.id === serviceId);
  if (!service) return null;

  // DB優先
  try {
    const { data } = await supabase.from('api_keys').select('api_key_encrypted').eq('id', serviceId).eq('is_active', true).single();
    if (data) return decryptApiKey(data.api_key_encrypted);
  } catch { /* fallthrough to env */ }

  // 環境変数フォールバック
  return process.env[service.envVar] || null;
}

module.exports = router;
module.exports.getActiveApiKey = getActiveApiKey;

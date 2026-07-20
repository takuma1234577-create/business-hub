/**
 * Shopify-LINE Integration Module
 *
 * 1. ユーザー登録（LINEリッチメニューからShopifyメールで紐づけ）
 * 2. 注文完了通知
 * 3. 発送完了・配送追跡通知
 * 4. フォローアップ（商品レビュー依頼・リピート提案）
 */

const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const { getSupabase, getAnthropicClient, getLineCredentials, DEFAULT_CHANNEL_ID } = require('./shared.cjs');

const router = express.Router();
const supabase = new Proxy({}, { get: (_, prop) => getSupabase()[prop] });

// ── LINE Push送信ヘルパー ──
// Shopify連携は現状メインストア（既存アカウント）専用のため channelId は省略可
async function pushLineMessage(lineUserId, messages, channelId = DEFAULT_CHANNEL_ID) {
  const { accessToken: token } = await getLineCredentials(channelId);
  if (!token) throw new Error('LINEアカウントの認証情報が未設定です');
  const msgArray = Array.isArray(messages) ? messages : [messages];
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to: lineUserId, messages: msgArray }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`LINE push failed ${res.status}: ${body}`);
  }
}

// ── 自動ログイン用トークン付きURLを生成 ──
const MY_FITPEAK_URL = process.env.MY_FITPEAK_URL || 'https://my.fitpeak.co';

async function generateAutoLoginUrl(lineUserId, path = '/') {
  // LINE紐づけからメールアドレスを取得（あれば）
  const { data: link } = await supabase
    .from('line_shopify_links')
    .select('shopify_email')
    .eq('line_user_id', lineUserId)
    .maybeSingle();

  // ワンタイムトークン生成（30分有効）
  const token = crypto.randomBytes(32).toString('hex');
  await supabase.from('auto_login_tokens').insert({
    token,
    email: link?.shopify_email || '',
    line_user_id: lineUserId,
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  });

  // 連携済みの場合はalt（自動ログイン）、未連携の場合はcode（連携フロー）
  const paramName = link?.shopify_email ? 'alt' : 'code';
  return `${MY_FITPEAK_URL}${path}?${paramName}=${token}`;
}

// ── Shopifyストア情報取得 ──
async function getShopifyStore() {
  const { data } = await supabase
    .from('channel_stores')
    .select('shop_domain, access_token')
    .eq('channel', 'SHOPIFY')
    .eq('is_active', true)
    .limit(1)
    .single();
  return data;
}

// ── Shopify HMAC検証 ──
function verifyShopifyHmac(rawBody, hmacHeader) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret || !hmacHeader || !rawBody) return false;
  const hash = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(hmacHeader));
}

// ===========================================================================
// ユーザー登録（LINE Webhook から呼ばれる）
// ===========================================================================

/**
 * メールアドレスでShopify顧客を検索してLINEと紐づける
 */
async function registerUserByEmail(lineUserId, friendId, email) {
  const store = await getShopifyStore();
  if (!store) return { success: false, message: 'Shopifyストアが連携されていません。' };

  // Shopify顧客検索
  let customer = null;
  try {
    const resp = await axios.get(
      `https://${store.shop_domain}/admin/api/2024-01/customers/search.json?query=email:${encodeURIComponent(email)}`,
      { headers: { 'X-Shopify-Access-Token': store.access_token } }
    );
    const customers = resp.data.customers || [];
    if (customers.length > 0) customer = customers[0];
  } catch (err) {
    console.error('[shopify-line] Customer search error:', err.message);
  }

  // 既存の紐づけチェック
  const { data: existing } = await supabase
    .from('line_shopify_links')
    .select('id')
    .eq('line_user_id', lineUserId)
    .maybeSingle();

  const customerName = customer
    ? `${customer.first_name || ''} ${customer.last_name || ''}`.trim()
    : '';

  const linkData = {
    friend_id: friendId,
    line_user_id: lineUserId,
    shopify_customer_id: customer?.id || null,
    shopify_email: email,
    shopify_customer_name: customerName,
    is_verified: true,
    linked_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    await supabase.from('line_shopify_links').update(linkData).eq('id', existing.id);
  } else {
    await supabase.from('line_shopify_links').insert(linkData);
  }

  const name = customerName || 'お客';
  return {
    success: true,
    message: `${name}様、メールアドレスの認証が完了し、会員登録が完了しました。\n\n今後、公式サイトでご注文いただくと、注文確認・発送通知・配送状況をこちらのLINEでお届けします。`,
  };
}

/**
 * 紐づけ済みユーザーの注文一覧を取得
 */
async function getLinkedOrders(lineUserId) {
  const { data: link } = await supabase
    .from('line_shopify_links')
    .select('shopify_customer_id')
    .eq('line_user_id', lineUserId)
    .maybeSingle();

  if (!link) {
    return {
      linked: false,
      message: 'まだ会員登録がお済みでないようです。「会員登録」から、Shopifyで購入時のメールアドレスを登録してください。',
    };
  }

  const store = await getShopifyStore();
  if (!store) return { linked: true, orders: [], message: 'Shopify接続エラー' };

  try {
    const resp = await axios.get(
      `https://${store.shop_domain}/admin/api/2024-01/customers/${link.shopify_customer_id}/orders.json?status=any&limit=5`,
      { headers: { 'X-Shopify-Access-Token': store.access_token } }
    );
    const orders = (resp.data.orders || []).map((o) => ({
      name: o.name,
      date: o.created_at,
      total: o.total_price,
      status: o.fulfillment_status || '未出荷',
      items: (o.line_items || []).map((i) => `${i.title} x${i.quantity}`).join(', '),
    }));
    return { linked: true, orders };
  } catch (err) {
    console.error('[shopify-line] Orders fetch error:', err.message);
    return { linked: true, orders: [], message: '注文情報の取得に失敗しました。' };
  }
}

// ===========================================================================
// Shopify Webhooks
// ===========================================================================

// POST /webhook/orders-create - 注文完了通知
router.post('/webhook/orders-create', async (req, res) => {
  const hmac = req.headers['x-shopify-hmac-sha256'];
  if (process.env.SHOPIFY_WEBHOOK_SECRET && !verifyShopifyHmac(req.rawBody, hmac)) {
    return res.status(401).json({ error: 'Invalid HMAC' });
  }
  res.status(200).json({ ok: true }); // Shopifyには即レスポンス

  try {
    const order = req.body;
    const email = order.customer?.email || order.email;
    if (!email) return;

    // 紐づけ済みユーザーを検索
    const { data: link } = await supabase
      .from('line_shopify_links')
      .select('id, line_user_id, shopify_customer_name')
      .eq('shopify_email', email)
      .maybeSingle();
    if (!link) return;

    // 重複チェック
    const { data: existing } = await supabase
      .from('shopify_order_notifications')
      .select('id')
      .eq('shopify_order_id', order.id)
      .eq('notification_type', 'order_created')
      .maybeSingle();
    if (existing) return;

    // 注文内容を整形
    const items = (order.line_items || []).map((i) => `${i.title} x${i.quantity}`).join('\n');
    const name = link.shopify_customer_name || 'お客';
    const ordersUrl = await generateAutoLoginUrl(link.line_user_id, '/orders');
    const message = [
      `${name}様、ご注文ありがとうございます!`,
      '',
      `注文番号: ${order.name}`,
      `注文日: ${new Date(order.created_at).toLocaleDateString('ja-JP')}`,
      `合計: ${order.total_price}円`,
      '',
      `【ご注文商品】`,
      items,
      '',
      '発送準備が整い次第、改めてご連絡いたします。',
      '',
      `注文詳細はこちら: ${ordersUrl}`,
    ].join('\n');

    await pushLineMessage(link.line_user_id, { type: 'text', text: message });

    // 通知ログ
    await supabase.from('shopify_order_notifications').insert({
      link_id: link.id,
      shopify_order_id: order.id,
      shopify_order_name: order.name,
      order_created_at: order.created_at,
      notification_type: 'order_created',
      message_summary: `注文完了: ${order.name}`,
    });

    // フォローアップキュー: 配達確認（3日後）
    await supabase.from('shopify_followup_queue').insert({
      link_id: link.id,
      shopify_order_id: order.id,
      shopify_order_name: order.name,
      line_user_id: link.line_user_id,
      followup_type: 'delivery_check',
      scheduled_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      items_json: order.line_items?.map((i) => ({ title: i.title, quantity: i.quantity })) || [],
    });
  } catch (err) {
    console.error('[shopify-line] orders-create webhook error:', err.message);
  }
});

// POST /webhook/fulfillments-create - 発送完了通知
router.post('/webhook/fulfillments-create', async (req, res) => {
  const hmac = req.headers['x-shopify-hmac-sha256'];
  if (process.env.SHOPIFY_WEBHOOK_SECRET && !verifyShopifyHmac(req.rawBody, hmac)) {
    return res.status(401).json({ error: 'Invalid HMAC' });
  }
  res.status(200).json({ ok: true });

  try {
    const fulfillment = req.body;
    const orderId = fulfillment.order_id;
    if (!orderId) return;

    // 注文からメールを取得
    const store = await getShopifyStore();
    if (!store) return;
    const orderResp = await axios.get(
      `https://${store.shop_domain}/admin/api/2024-01/orders/${orderId}.json`,
      { headers: { 'X-Shopify-Access-Token': store.access_token } }
    );
    const order = orderResp.data.order;
    const email = order?.customer?.email || order?.email;
    if (!email) return;

    const { data: link } = await supabase
      .from('line_shopify_links')
      .select('id, line_user_id, shopify_customer_name')
      .eq('shopify_email', email)
      .maybeSingle();
    if (!link) return;

    // 重複チェック
    const { data: existing } = await supabase
      .from('shopify_order_notifications')
      .select('id')
      .eq('shopify_order_id', orderId)
      .eq('notification_type', 'fulfillment')
      .maybeSingle();
    if (existing) return;

    const name = link.shopify_customer_name || 'お客';
    const trackingNumber = fulfillment.tracking_number || '';
    const trackingUrl = fulfillment.tracking_url || '';
    const carrier = fulfillment.tracking_company || '配送業者';

    const lines = [
      `${name}様、ご注文商品の発送が完了しました!`,
      '',
      `注文番号: ${order.name}`,
      `配送業者: ${carrier}`,
    ];
    if (trackingNumber) lines.push(`追跡番号: ${trackingNumber}`);
    if (trackingUrl) lines.push(`追跡はこちら: ${trackingUrl}`);
    lines.push('', '到着まで今しばらくお待ちください。');

    await pushLineMessage(link.line_user_id, { type: 'text', text: lines.join('\n') });

    await supabase.from('shopify_order_notifications').insert({
      link_id: link.id,
      shopify_order_id: orderId,
      shopify_order_name: order.name,
      order_created_at: order.created_at,
      notification_type: 'fulfillment',
      message_summary: `発送完了: ${order.name} / ${carrier} ${trackingNumber}`,
    });

    // フォローアップキュー: レビュー依頼（5日後）
    await supabase.from('shopify_followup_queue').insert({
      link_id: link.id,
      shopify_order_id: orderId,
      shopify_order_name: order.name,
      line_user_id: link.line_user_id,
      followup_type: 'review_request',
      scheduled_at: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
      items_json: order.line_items?.map((i) => ({ title: i.title, quantity: i.quantity })) || [],
    });
  } catch (err) {
    console.error('[shopify-line] fulfillments-create webhook error:', err.message);
  }
});

// POST /webhook/fulfillments-update - 配送状況更新通知
router.post('/webhook/fulfillments-update', async (req, res) => {
  const hmac = req.headers['x-shopify-hmac-sha256'];
  if (process.env.SHOPIFY_WEBHOOK_SECRET && !verifyShopifyHmac(req.rawBody, hmac)) {
    return res.status(401).json({ error: 'Invalid HMAC' });
  }
  res.status(200).json({ ok: true });

  try {
    const fulfillment = req.body;
    const orderId = fulfillment.order_id;
    const shipmentStatus = fulfillment.shipment_status;
    if (!orderId || !shipmentStatus) return;

    // delivered のみ通知（他は fulfillment-create で対応済み）
    if (shipmentStatus !== 'delivered') return;

    const store = await getShopifyStore();
    if (!store) return;
    const orderResp = await axios.get(
      `https://${store.shop_domain}/admin/api/2024-01/orders/${orderId}.json`,
      { headers: { 'X-Shopify-Access-Token': store.access_token } }
    );
    const order = orderResp.data.order;
    const email = order?.customer?.email || order?.email;
    if (!email) return;

    const { data: link } = await supabase
      .from('line_shopify_links')
      .select('id, line_user_id, shopify_customer_name')
      .eq('shopify_email', email)
      .maybeSingle();
    if (!link) return;

    // 重複チェック
    const { data: existing } = await supabase
      .from('shopify_order_notifications')
      .select('id')
      .eq('shopify_order_id', orderId)
      .eq('notification_type', 'delivered')
      .maybeSingle();
    if (existing) return;

    const name = link.shopify_customer_name || 'お客';
    const message = [
      `${name}様、商品が配達完了になりました!`,
      '',
      `注文番号: ${order.name}`,
      '',
      '商品は無事届きましたでしょうか？',
      '何かお気づきの点があれば、いつでもこちらにメッセージしてくださいね。',
    ].join('\n');

    await pushLineMessage(link.line_user_id, { type: 'text', text: message });

    await supabase.from('shopify_order_notifications').insert({
      link_id: link.id,
      shopify_order_id: orderId,
      shopify_order_name: order.name,
      notification_type: 'delivered',
      message_summary: `配達完了: ${order.name}`,
    });

    // フォローアップキュー: リピート提案（7日後）
    await supabase.from('shopify_followup_queue').insert({
      link_id: link.id,
      shopify_order_id: orderId,
      shopify_order_name: order.name,
      line_user_id: link.line_user_id,
      followup_type: 'repeat_suggest',
      scheduled_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      items_json: order.line_items?.map((i) => ({ title: i.title, quantity: i.quantity })) || [],
    });
  } catch (err) {
    console.error('[shopify-line] fulfillments-update webhook error:', err.message);
  }
});

// ===========================================================================
// Cron: フォローアップ処理
// ===========================================================================
router.get('/cron/followups', async (_req, res) => {
  try {
    const now = new Date().toISOString();
    const { data: queue } = await supabase
      .from('shopify_followup_queue')
      .select('*')
      .eq('status', 'pending')
      .lte('scheduled_at', now)
      .order('scheduled_at', { ascending: true })
      .limit(20);

    if (!queue || queue.length === 0) {
      return res.json({ processed: 0 });
    }

    // Anthropic APIキーをDBから最新化
    try {
      const cryptoMod = require('crypto');
      const { data: keyData } = await supabase.from('api_keys').select('api_key_encrypted').eq('id', 'anthropic').eq('is_active', true).maybeSingle();
      if (keyData) {
        const secret = process.env.BANK_CREDENTIAL_ENCRYPTION_KEY || process.env.SUPABASE_ANON_KEY || 'default-key';
        const key = cryptoMod.scryptSync(secret, 'api-keys-salt', 32);
        const { iv, data: enc, tag } = JSON.parse(keyData.api_key_encrypted);
        const decipher = cryptoMod.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
        decipher.setAuthTag(Buffer.from(tag, 'hex'));
        let decrypted = decipher.update(enc, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        process.env.ANTHROPIC_API_KEY = decrypted;
      }
    } catch { /* fallback to existing key */ }

    const results = [];
    for (const item of queue) {
      try {
        const items = item.items_json || [];
        const productNames = items.map((i) => i.title).join('、');
        let message = '';

        if (item.followup_type === 'delivery_check') {
          message = `こんにちは! 先日ご注文いただいた${productNames || '商品'}は無事届きましたか？何か気になることがあれば、いつでもメッセージしてくださいね!`;
        } else if (item.followup_type === 'review_request') {
          // Claude で自然なメッセージを生成
          try {
            const anthropic = await getAnthropicClient();
            const completion = await anthropic.messages.create({
              model: 'claude-sonnet-4-5',
              max_tokens: 200,
              system: 'あなたはFITPEAKのフレンドリーなカスタマーサポート担当です。お客様に商品の使い心地を聞き、レビューをお願いするLINEメッセージを1つ書いてください。硬い敬語ではなく、親しみやすいトーンで。絵文字は使わないでください。200文字以内。',
              messages: [{ role: 'user', content: `商品: ${productNames}` }],
            });
            message = completion.content[0]?.text?.trim() || '';
          } catch { /* fallback */ }
          if (!message) {
            message = `${productNames}の使い心地はいかがですか？もしよかったら、レビューをいただけるとすごく嬉しいです!`;
          }
        } else if (item.followup_type === 'repeat_suggest') {
          try {
            const anthropic = await getAnthropicClient();
            const completion = await anthropic.messages.create({
              model: 'claude-sonnet-4-5',
              max_tokens: 250,
              system: `あなたはFITPEAKのフレンドリーなカスタマーサポート担当です。お客様が購入した商品に基づいて、関連するFITPEAK商品を自然に提案するLINEメッセージを1つ書いてください。
FITPEAK商品: トレーニングベルト、パワーグリップ、リストラップ、ニースリーブ、可変式ダンベル、バーベル
押し付けがましくなく、会話の延長として自然に提案してください。絵文字は使わないでください。250文字以内。`,
              messages: [{ role: 'user', content: `お客様の購入商品: ${productNames}` }],
            });
            message = completion.content[0]?.text?.trim() || '';
          } catch { /* fallback */ }
          if (!message) {
            message = `${productNames}はいかがですか？トレーニング頑張っていますか？FITPEAKでは他にもトレーニングギアを揃えていますので、気になるものがあればいつでも聞いてくださいね!`;
          }
        }

        if (message) {
          await pushLineMessage(item.line_user_id, { type: 'text', text: message });
          await supabase.from('shopify_followup_queue')
            .update({ status: 'sent', sent_at: new Date().toISOString() })
            .eq('id', item.id);
          results.push({ id: item.id, type: item.followup_type, status: 'sent' });
        }
      } catch (err) {
        console.error('[shopify-line] followup error:', item.id, err.message);
        results.push({ id: item.id, type: item.followup_type, status: 'error', error: err.message });
      }
    }

    return res.json({ processed: results.length, results });
  } catch (err) {
    console.error('[shopify-line] cron/followups error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// 管理API
// ===========================================================================

// POST /setup-webhooks - Shopify Webhookを登録
router.post('/setup-webhooks', async (req, res) => {
  try {
    const store = await getShopifyStore();
    if (!store) return res.status(400).json({ error: 'Shopify未連携' });

    const host = req.get('host');
    const protocol = req.protocol;
    const baseUrl = `${protocol}://${host}/api/shopify-line/webhook`;

    const topics = [
      { topic: 'orders/create', address: `${baseUrl}/orders-create` },
      { topic: 'fulfillments/create', address: `${baseUrl}/fulfillments-create` },
      { topic: 'fulfillments/update', address: `${baseUrl}/fulfillments-update` },
    ];

    const results = [];
    for (const { topic, address } of topics) {
      try {
        const resp = await axios.post(
          `https://${store.shop_domain}/admin/api/2024-01/webhooks.json`,
          { webhook: { topic, address, format: 'json' } },
          { headers: { 'X-Shopify-Access-Token': store.access_token } }
        );
        results.push({ topic, status: 'created', id: resp.data.webhook?.id });
      } catch (err) {
        const errMsg = err.response?.data?.errors || err.message;
        results.push({ topic, status: 'error', error: errMsg });
      }
    }

    return res.json({ results });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /links - 紐づけ済みユーザー一覧
router.get('/links', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('line_shopify_links')
      .select('*, friends(display_name, picture_url)')
      .order('linked_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /links/:id - 紐づけ解除
router.delete('/links/:id', async (req, res) => {
  try {
    await supabase.from('line_shopify_links').delete().eq('id', req.params.id);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.registerUserByEmail = registerUserByEmail;
module.exports.getLinkedOrders = getLinkedOrders;
module.exports.generateAutoLoginUrl = generateAutoLoginUrl;

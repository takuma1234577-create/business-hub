/**
 * Order Lookup Module
 *
 * Amazon SP-API / Shopify APIから注文情報を検索する共通モジュール。
 * LINE CRM AIチャット・メール自動返信から利用される。
 */

const { getSupabase } = require('./shared.cjs');
const axios = require('axios');

const supabase = new Proxy({}, { get: (_, prop) => getSupabase()[prop] });

// ── 注文番号のフォーマットを判定 ──
function detectOrderSource(orderIdRaw) {
  const id = (orderIdRaw || '').trim();
  // Amazon: 数字-数字-数字 (例: 250-6665075-8941446)
  if (/^\d{3}-\d{7}-\d{7}$/.test(id)) return 'amazon';
  // Shopify: #数字 or CONSUMER- 等
  if (/^#?\d{4,6}$/.test(id)) return 'shopify';
  if (/^CONSUMER-/i.test(id)) return 'shopify';
  // 注文番号なしまたは不明
  return 'unknown';
}

// ── Amazon SP-API で注文検索 ──
async function lookupAmazonOrder(orderId) {
  try {
    // Amazon SP-APIアカウント取得
    const { data: account } = await supabase
      .from('amazon_sp_accounts')
      .select('*')
      .eq('is_active', true)
      .limit(1)
      .single();

    if (!account) return { found: false, error: 'Amazon SP-API未連携' };

    // アクセストークン取得
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
    const accessToken = tokenRes.data.access_token;
    const endpoint = account.endpoint || 'https://sellingpartnerapi-fe.amazon.com';

    // 注文取得
    const orderRes = await axios.get(
      `${endpoint}/orders/v0/orders/${orderId}`,
      { headers: { 'x-amz-access-token': accessToken } }
    );

    const order = orderRes.data.payload;
    if (!order) return { found: false, error: '注文が見つかりません' };

    // 注文アイテム取得
    let items = [];
    try {
      const itemsRes = await axios.get(
        `${endpoint}/orders/v0/orders/${orderId}/orderItems`,
        { headers: { 'x-amz-access-token': accessToken } }
      );
      items = (itemsRes.data.payload?.OrderItems || []).map((i) => ({
        title: i.Title,
        sku: i.SellerSKU,
        quantity: i.QuantityOrdered,
        price: i.ItemPrice?.Amount,
      }));
    } catch { /* items optional */ }

    return {
      found: true,
      source: 'amazon',
      orderId: order.AmazonOrderId,
      orderDate: order.PurchaseDate,
      status: order.OrderStatus,
      totalPrice: order.OrderTotal?.Amount,
      currency: order.OrderTotal?.CurrencyCode,
      buyerName: order.BuyerInfo?.BuyerName || '',
      buyerEmail: order.BuyerInfo?.BuyerEmail || '',
      shippingAddress: order.ShippingAddress
        ? `${order.ShippingAddress.StateOrRegion || ''} ${order.ShippingAddress.City || ''} ${order.ShippingAddress.AddressLine1 || ''}`
        : '',
      items,
      fulfillmentChannel: order.FulfillmentChannel, // AFN = FBA, MFN = 自社発送
    };
  } catch (err) {
    console.error('[order-lookup] Amazon error:', err.response?.data || err.message);
    const status = err.response?.status;
    if (status === 404 || status === 400) return { found: false, error: '注文が見つかりません' };
    return { found: false, error: `Amazon API エラー: ${err.message}` };
  }
}

// ── Amazon MCF (マルチチャネルフルフィルメント) の配送追跡を取得 ──
async function lookupAmazonFulfillment(trackingNumber) {
  try {
    const { data: account } = await supabase
      .from('amazon_sp_accounts')
      .select('*')
      .eq('is_active', true)
      .limit(1)
      .single();
    if (!account) return null;

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
    const accessToken = tokenRes.data.access_token;
    const endpoint = account.endpoint || 'https://sellingpartnerapi-fe.amazon.com';

    // パッケージ追跡情報を取得
    const res = await axios.get(
      `${endpoint}/fba/outbound/2020-07-01/tracking?packageNumber=${encodeURIComponent(trackingNumber)}`,
      { headers: { 'x-amz-access-token': accessToken } }
    );
    return res.data.payload || null;
  } catch (err) {
    console.error('[order-lookup] Amazon fulfillment tracking error:', err.response?.status, err.message);
    return null;
  }
}

// ── Shopify APIで注文検索（フルフィルメント・配送追跡含む）──
async function lookupShopifyOrder(orderId) {
  try {
    const { data: store } = await supabase
      .from('channel_stores')
      .select('shop_domain, access_token')
      .eq('channel', 'SHOPIFY')
      .eq('is_active', true)
      .limit(1)
      .single();

    if (!store) return { found: false, error: 'Shopify未連携' };

    const cleanId = orderId.replace(/^#/, '');

    const resp = await axios.get(
      `https://${store.shop_domain}/admin/api/2024-01/orders.json?name=${encodeURIComponent(cleanId)}&status=any`,
      { headers: { 'X-Shopify-Access-Token': store.access_token } }
    );

    const orders = resp.data.orders;
    if (!orders || orders.length === 0) {
      return { found: false, error: '注文が見つかりません' };
    }

    const order = orders[0];

    // フルフィルメント（配送）情報を取得
    let fulfillments = [];
    try {
      const fulfillResp = await axios.get(
        `https://${store.shop_domain}/admin/api/2024-01/orders/${order.id}/fulfillments.json`,
        { headers: { 'X-Shopify-Access-Token': store.access_token } }
      );
      fulfillments = (fulfillResp.data.fulfillments || []).map((f) => ({
        id: f.id,
        status: f.status, // success, cancelled, error, failure
        shipmentStatus: f.shipment_status, // confirmed, in_transit, out_for_delivery, delivered, failure
        trackingCompany: f.tracking_company,
        trackingNumber: f.tracking_number,
        trackingUrl: f.tracking_url,
        createdAt: f.created_at,
        updatedAt: f.updated_at,
      }));
    } catch { /* fulfillment fetch optional */ }

    // Amazon MCF経由の場合、追跡番号でAmazon側の詳細を取得
    let amazonTracking = null;
    for (const f of fulfillments) {
      if (f.trackingNumber && (f.trackingCompany || '').toLowerCase().includes('amazon')) {
        amazonTracking = await lookupAmazonFulfillment(f.trackingNumber);
        break;
      }
    }

    return {
      found: true,
      source: 'shopify',
      orderId: order.name || `#${order.order_number}`,
      shopifyId: order.id,
      orderDate: order.created_at,
      status: order.financial_status,
      fulfillmentStatus: order.fulfillment_status,
      totalPrice: order.total_price,
      currency: order.currency,
      buyerName: `${order.customer?.first_name || ''} ${order.customer?.last_name || ''}`.trim(),
      buyerEmail: order.customer?.email || order.email || '',
      shippingAddress: order.shipping_address
        ? {
            full: `${order.shipping_address.province || ''} ${order.shipping_address.city || ''} ${order.shipping_address.address1 || ''} ${order.shipping_address.address2 || ''}`.trim(),
            zip: order.shipping_address.zip,
            name: order.shipping_address.name,
          }
        : null,
      items: (order.line_items || []).map((i) => ({
        title: i.title,
        sku: i.sku,
        quantity: i.quantity,
        price: i.price,
        variant: i.variant_title,
      })),
      fulfillments,
      amazonTracking,
    };
  } catch (err) {
    console.error('[order-lookup] Shopify error:', err.response?.data || err.message);
    return { found: false, error: `Shopify API エラー: ${err.message}` };
  }
}

// ── メイン: 注文番号から自動判定して検索 ──
async function lookupOrder(orderIdRaw) {
  const source = detectOrderSource(orderIdRaw);

  if (source === 'amazon') {
    return await lookupAmazonOrder(orderIdRaw.trim());
  }
  if (source === 'shopify') {
    return await lookupShopifyOrder(orderIdRaw.trim());
  }

  // 不明な場合は両方試す
  const shopifyResult = await lookupShopifyOrder(orderIdRaw.trim());
  if (shopifyResult.found) return shopifyResult;

  const amazonResult = await lookupAmazonOrder(orderIdRaw.trim());
  if (amazonResult.found) return amazonResult;

  return { found: false, error: '注文が見つかりません。注文番号を再度ご確認ください。' };
}

// ── 配送ステータスの日本語マップ ──
const SHIPMENT_STATUS_MAP = {
  confirmed: '配送業者に引き渡し済み',
  in_transit: '配送中',
  out_for_delivery: '配達中（お届け先に向かっています）',
  delivered: '配達完了',
  failure: '配達失敗',
  attempted_delivery: '配達試行（不在等）',
  label_printed: '出荷準備中',
  label_purchased: '出荷ラベル作成済み',
  ready_for_pickup: '受け取り待ち',
};

const FULFILLMENT_STATUS_MAP = {
  fulfilled: '出荷済み',
  partial: '一部出荷済み',
  unfulfilled: '未出荷',
  null: '未出荷',
};

// ── 注文情報をAIプロンプト用テキストに整形 ──
function formatOrderForPrompt(order) {
  if (!order.found) {
    return `【注文検索結果】該当する注文が見つかりませんでした。（${order.error || ''}）`;
  }

  const lines = [
    `【注文検索結果 - ${order.source === 'amazon' ? 'Amazon' : 'Shopify'}】`,
    `注文番号: ${order.orderId}`,
    `注文日: ${new Date(order.orderDate).toLocaleDateString('ja-JP')}`,
    `注文ステータス: ${order.status}`,
    `出荷ステータス: ${FULFILLMENT_STATUS_MAP[order.fulfillmentStatus] || order.fulfillmentStatus || '未出荷'}`,
    `合計金額: ${order.totalPrice} ${order.currency || 'JPY'}`,
    `購入者名: ${order.buyerName || '(不明)'}`,
  ];

  if (order.buyerEmail) lines.push(`メール: ${order.buyerEmail}`);

  // 配送先
  if (order.shippingAddress) {
    if (typeof order.shippingAddress === 'object') {
      lines.push(`配送先: ${order.shippingAddress.name || ''} ${order.shippingAddress.zip || ''} ${order.shippingAddress.full || ''}`);
    } else {
      lines.push(`配送先: ${order.shippingAddress}`);
    }
  }

  if (order.fulfillmentChannel === 'AFN') lines.push(`配送方法: Amazon FBA（Amazon倉庫から発送）`);

  // 購入商品
  if (order.items && order.items.length > 0) {
    lines.push(`\n購入商品:`);
    for (const item of order.items) {
      const variant = item.variant ? ` (${item.variant})` : '';
      lines.push(`  - ${item.title}${variant} x${item.quantity} / ${item.price}円`);
    }
  }

  // 配送・追跡情報（Shopify）
  if (order.fulfillments && order.fulfillments.length > 0) {
    lines.push(`\n配送情報:`);
    for (const f of order.fulfillments) {
      const statusJa = SHIPMENT_STATUS_MAP[f.shipmentStatus] || f.shipmentStatus || '不明';
      lines.push(`  配送業者: ${f.trackingCompany || '不明'}`);
      lines.push(`  追跡番号: ${f.trackingNumber || 'なし'}`);
      lines.push(`  配送状況: ${statusJa}`);
      if (f.trackingUrl) lines.push(`  追跡URL: ${f.trackingUrl}`);
      lines.push(`  出荷日: ${f.createdAt ? new Date(f.createdAt).toLocaleDateString('ja-JP') : '不明'}`);
      lines.push(`  最終更新: ${f.updatedAt ? new Date(f.updatedAt).toLocaleString('ja-JP') : '不明'}`);
    }
  } else if (order.found && !order.fulfillmentStatus) {
    lines.push(`\n配送情報: まだ出荷されていません`);
  }

  // Amazon MCF追跡（Shopify注文がAmazon経由で配送された場合）
  if (order.amazonTracking) {
    const t = order.amazonTracking;
    lines.push(`\nAmazon MCF配送詳細:`);
    if (t.trackingEvents && t.trackingEvents.length > 0) {
      for (const ev of t.trackingEvents.slice(0, 5)) {
        lines.push(`  ${ev.EventDate ? new Date(ev.EventDate).toLocaleString('ja-JP') : ''} - ${ev.EventDescription || ''} (${ev.EventAddress?.City || ''})`);
      }
    }
    if (t.shipmentStatus) lines.push(`  現在のステータス: ${t.shipmentStatus}`);
    if (t.estimatedArrivalDate) lines.push(`  到着予定日: ${new Date(t.estimatedArrivalDate).toLocaleDateString('ja-JP')}`);
  }

  return lines.join('\n');
}

module.exports = {
  detectOrderSource,
  lookupOrder,
  formatOrderForPrompt,
};

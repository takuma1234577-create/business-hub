const express = require('express');
const { getSupabase } = require('./shared.cjs');
const supabase = new Proxy({}, { get: (_, prop) => getSupabase()[prop] });
const axios = require('axios');
const router = express.Router();

// ---------------------------------------------------------------------------
// Amazon SP-API auth helpers
// ---------------------------------------------------------------------------
const TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

let cachedToken = null;
let tokenExpiresAt = 0;
let cachedEndpoint = null;

async function getSpAccount() {
  // Try DB first, then fall back to env vars
  const { data } = await supabase
    .from('amazon_sp_accounts')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  if (data) {
    return {
      refreshToken: data.refresh_token,
      clientId: data.client_id,
      clientSecret: data.client_secret,
      endpoint: data.endpoint || 'https://sellingpartnerapi-fe.amazon.com',
      marketplaceId: data.marketplace_id || 'A1VC38T7YXB528',
    };
  }

  // Fallback to env vars
  if (process.env.AMAZON_SP_REFRESH_TOKEN) {
    return {
      refreshToken: process.env.AMAZON_SP_REFRESH_TOKEN,
      clientId: process.env.AMAZON_SP_CLIENT_ID,
      clientSecret: process.env.AMAZON_SP_CLIENT_SECRET,
      endpoint: process.env.AMAZON_SP_ENDPOINT || 'https://sellingpartnerapi-fe.amazon.com',
      marketplaceId: process.env.AMAZON_SP_MARKETPLACE_ID || 'A1VC38T7YXB528',
    };
  }

  throw new Error('Amazon SP-APIアカウントが設定されていません。API設定から連携してください。');
}

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - REFRESH_MARGIN_MS) {
    return { token: cachedToken, endpoint: cachedEndpoint };
  }

  const account = await getSpAccount();

  const response = await axios.post(
    TOKEN_URL,
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: account.refreshToken,
      client_id: account.clientId,
      client_secret: account.clientSecret,
    }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  cachedToken = response.data.access_token;
  cachedEndpoint = account.endpoint;
  tokenExpiresAt = Date.now() + response.data.expires_in * 1000;
  return { token: cachedToken, endpoint: cachedEndpoint, marketplaceId: account.marketplaceId };
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

// GET /orders - List orders with pagination and filters
router.get('/orders', async (req, res) => {
  try {
    const { channel, status, page = '1', pageSize = '20' } = req.query;
    const currentPage = Math.max(1, parseInt(page, 10) || 1);
    const size = Math.max(1, Math.min(100, parseInt(pageSize, 10) || 20));
    const from = (currentPage - 1) * size;
    const to = from + size - 1;

    let query = supabase
      .from('orders')
      .select('*, order_items(*)', { count: 'exact' })
      .order('ordered_at', { ascending: false, nullsFirst: false })
      .range(from, to);

    if (channel) {
      query = query.eq('channel', channel);
    }
    if (status) {
      query = query.eq('status', status);
    }

    const { data, error, count } = await query;

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Map snake_case keys to camelCase for frontend
    const mapped = (data || []).map(order => ({
      ...order,
      channelOrderId: order.channel_order_id,
      mcfOrderId: order.mcf_order_id,
      shippingSpeed: order.shipping_speed,
      recipientName: order.recipient_name,
      addressLine1: order.address_line1,
      addressLine2: order.address_line2,
      stateOrRegion: order.state_or_region,
      postalCode: order.postal_code,
      countryCode: order.country_code,
      trackingNumber: order.tracking_number,
      shippedAt: order.shipped_at,
      trackingUpdatedAt: order.tracking_updated_at,
      retryCount: order.retry_count,
      errorMessage: order.error_message,
      createdAt: order.created_at,
      updatedAt: order.updated_at,
      orderedAt: order.ordered_at,
      totalAmount: order.total_amount,
      currency: order.currency,
      items: (order.order_items || []).map(item => ({
        ...item,
        orderId: item.order_id,
        channelSku: item.channel_sku,
        amazonSku: item.amazon_sku,
      })),
    }));

    return res.json({
      data: mapped,
      pagination: {
        page: currentPage,
        pageSize: size,
        total: count,
        totalPages: Math.ceil((count || 0) / size),
      },
    });
  } catch (err) {
    console.error('GET /orders error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /orders/:id - Get order with items and logs
router.get('/orders/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('id', id)
      .single();

    if (orderError) {
      if (orderError.code === 'PGRST116') {
        return res.status(404).json({ error: 'Order not found' });
      }
      return res.status(500).json({ error: orderError.message });
    }

    const { data: logs, error: logsError } = await supabase
      .from('fulfillment_logs')
      .select('*')
      .eq('order_id', id)
      .order('created_at', { ascending: false });

    if (logsError) {
      return res.status(500).json({ error: logsError.message });
    }

    return res.json({
      ...order,
      channelOrderId: order.channel_order_id,
      mcfOrderId: order.mcf_order_id,
      shippingSpeed: order.shipping_speed,
      recipientName: order.recipient_name,
      addressLine1: order.address_line1,
      addressLine2: order.address_line2,
      stateOrRegion: order.state_or_region,
      postalCode: order.postal_code,
      countryCode: order.country_code,
      trackingNumber: order.tracking_number,
      shippedAt: order.shipped_at,
      trackingUpdatedAt: order.tracking_updated_at,
      retryCount: order.retry_count,
      errorMessage: order.error_message,
      createdAt: order.created_at,
      updatedAt: order.updated_at,
      orderedAt: order.ordered_at,
      totalAmount: order.total_amount,
      currency: order.currency,
      items: (order.order_items || []).map(item => ({
        ...item,
        orderId: item.order_id,
        channelSku: item.channel_sku,
        amazonSku: item.amazon_sku,
      })),
      logs: (logs || []).map(log => ({
        ...log,
        orderId: log.order_id,
        createdAt: log.created_at,
      })),
    });
  } catch (err) {
    console.error('GET /orders/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /orders/:id/retry - Retry failed order
router.post('/orders/:id/retry', async (req, res) => {
  try {
    const { id } = req.params;

    // Fetch the order
    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return res.status(404).json({ error: 'Order not found' });
      }
      return res.status(500).json({ error: fetchError.message });
    }

    if (order.status !== 'ERROR') {
      return res
        .status(400)
        .json({ error: 'Only ERROR orders can be retried' });
    }

    // Reset order status
    const { error: updateError } = await supabase
      .from('orders')
      .update({
        status: 'PENDING',
        retry_count: 0,
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }

    // Create a fulfillment log entry
    const { error: logError } = await supabase
      .from('fulfillment_logs')
      .insert({
        order_id: id,
        event: 'RETRY',
        message: 'Manual retry triggered',
      });

    if (logError) {
      console.error('Failed to create fulfillment log:', logError);
    }

    return res.json({ ok: true, message: 'Order queued for retry' });
  } catch (err) {
    console.error('POST /orders/:id/retry error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// SKU Mappings
// ---------------------------------------------------------------------------

// GET /sku-mappings - List active SKU mappings
router.get('/sku-mappings', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('sku_mappings')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json(data);
  } catch (err) {
    console.error('GET /sku-mappings error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /sku-mappings - Create or upsert SKU mapping
router.post('/sku-mappings', async (req, res) => {
  try {
    const { channel, channel_sku, amazon_sku } = req.body;

    if (!channel || !channel_sku || !amazon_sku) {
      return res
        .status(400)
        .json({ error: 'channel, channel_sku, and amazon_sku are required' });
    }

    // Check if a mapping already exists for this channel + channel_sku
    const { data: existing, error: fetchError } = await supabase
      .from('sku_mappings')
      .select('id')
      .eq('channel', channel)
      .eq('channel_sku', channel_sku)
      .maybeSingle();

    if (fetchError) {
      return res.status(500).json({ error: fetchError.message });
    }

    let result;
    if (existing) {
      // Update existing mapping
      const { data, error } = await supabase
        .from('sku_mappings')
        .update({
          amazon_sku,
          is_active: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) {
        return res.status(500).json({ error: error.message });
      }
      result = data;
    } else {
      // Insert new mapping
      const { data, error } = await supabase
        .from('sku_mappings')
        .insert({ channel, channel_sku, amazon_sku })
        .select()
        .single();

      if (error) {
        return res.status(500).json({ error: error.message });
      }
      result = data;
    }

    return res.json(result);
  } catch (err) {
    console.error('POST /sku-mappings error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /sku-mappings/:id - Soft delete (set is_active = false)
router.delete('/sku-mappings/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('sku_mappings')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'SKU mapping not found' });
      }
      return res.status(500).json({ error: error.message });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /sku-mappings/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Inventory (Amazon SP-API)
// ---------------------------------------------------------------------------

// GET /inventory?skus=SKU1,SKU2 - Get inventory from Amazon SP-API
router.get('/inventory', async (req, res) => {
  try {
    const { skus } = req.query;

    if (!skus) {
      return res
        .status(400)
        .json({ error: 'skus query parameter is required (comma-separated)' });
    }

    const skuList = skus.split(',').map((s) => s.trim()).filter(Boolean);
    if (skuList.length === 0) {
      return res.status(400).json({ error: 'At least one SKU is required' });
    }

    const { token, endpoint, marketplaceId } = await getAccessToken();
    const url = `${endpoint}/fba/inventory/v1/summaries`;

    const params = new URLSearchParams({
      details: 'true',
      granularityType: 'Marketplace',
      granularityId: marketplaceId,
      marketplaceIds: marketplaceId,
      sellerSkus: skuList.join(','),
    });

    let response;
    try {
      response = await axios.get(`${url}?${params.toString()}`, {
        headers: {
          'x-amz-access-token': token,
          'Content-Type': 'application/json',
        },
      });
    } catch (apiErr) {
      if (apiErr.response && apiErr.response.status === 429) {
        const retryAfter = apiErr.response.headers['retry-after'];
        const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 5000;
        await new Promise((resolve) => setTimeout(resolve, waitMs));

        cachedToken = null; // force re-fetch
        const retry = await getAccessToken();
        response = await axios.get(`${url}?${params.toString()}`, {
          headers: {
            'x-amz-access-token': retry.token,
            'Content-Type': 'application/json',
          },
        });
      } else {
        throw apiErr;
      }
    }

    return res.json({ data: response.data.payload.inventorySummaries });
  } catch (err) {
    console.error('GET /inventory error:', err.message);
    const status = err.response ? err.response.status : 500;
    return res
      .status(status)
      .json({ error: err.message || 'Failed to fetch inventory' });
  }
});

// ---------------------------------------------------------------------------
// Shopify Products - Fetch products from connected Shopify store
// ---------------------------------------------------------------------------

router.get('/shopify-products', async (req, res) => {
  try {
    const { data: stores } = await supabase
      .from('channel_stores')
      .select('*')
      .eq('channel', 'SHOPIFY')
      .eq('is_active', true);

    const store = stores?.[0];
    if (!store) return res.status(400).json({ error: 'Shopifyストアが連携されていません' });

    const allProducts = [];
    let url = `https://${store.shop_domain}/admin/api/2024-01/products.json?limit=250`;

    while (url) {
      const prodRes = await axios.get(url, {
        headers: { 'X-Shopify-Access-Token': store.access_token },
      });

      for (const product of prodRes.data.products || []) {
        for (const variant of product.variants || []) {
          allProducts.push({
            productId: String(product.id),
            variantId: String(variant.id),
            title: product.title,
            variantTitle: variant.title !== 'Default Title' ? variant.title : null,
            sku: variant.sku || '',
            price: variant.price,
            imageUrl: product.image?.src || null,
            inventoryQuantity: variant.inventory_quantity,
          });
        }
      }

      const linkHeader = prodRes.headers['link'] || '';
      const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      url = nextMatch ? nextMatch[1] : null;
    }

    return res.json({ products: allProducts });
  } catch (err) {
    console.error('GET /shopify-products error:', err.response?.data || err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Amazon SKU List - Fetch all FBA inventory SKUs
// ---------------------------------------------------------------------------

router.get('/amazon-skus', async (req, res) => {
  try {
    const { token, endpoint, marketplaceId } = await getAccessToken();

    const allSkus = [];
    let nextToken = null;

    do {
      const params = new URLSearchParams({
        details: 'true',
        granularityType: 'Marketplace',
        granularityId: marketplaceId,
        marketplaceIds: marketplaceId,
      });
      if (nextToken) params.set('nextToken', nextToken);

      const response = await axios.get(`${endpoint}/fba/inventory/v1/summaries?${params}`, {
        headers: { 'x-amz-access-token': token, 'Content-Type': 'application/json' },
      });

      const items = response.data.payload?.inventorySummaries || [];
      for (const item of items) {
        // Extract variation info from SKU or product name
        const skuParts = item.sellerSku.split('-');
        const productName = item.productName || '';

        // Try to detect variation from product name (e.g. "商品名 サイズ:M カラー:黒")
        let variation = '';
        const varMatch = productName.match(/[（(](.+?)[）)]/);
        if (varMatch) {
          variation = varMatch[1];
        } else if (skuParts.length > 2) {
          // If SKU has multiple parts, last parts might be variation
          variation = skuParts.slice(-1).join('-');
        }

        allSkus.push({
          sellerSku: item.sellerSku,
          asin: item.asin,
          fnSku: item.fnSku,
          productName,
          variation,
          condition: item.condition || '',
          fulfillableQuantity: item.inventoryDetails?.fulfillableQuantity ?? 0,
          inboundQuantity: (item.inventoryDetails?.inboundWorkingQuantity ?? 0) + (item.inventoryDetails?.inboundShippedQuantity ?? 0) + (item.inventoryDetails?.inboundReceivingQuantity ?? 0),
          reservedQuantity: item.inventoryDetails?.reservedQuantity?.totalReservedQuantity ?? 0,
          totalQuantity: item.totalQuantity ?? 0,
        });
      }

      nextToken = response.data.pagination?.nextToken || null;
    } while (nextToken);

    // Fetch parent ASIN relationships via Catalog API
    const uniqueAsins = [...new Set(allSkus.map(s => s.asin))];
    const asinToParent = {};
    const parentInfo = {};

    // Batch catalog lookups (max 20 per request to avoid rate limits)
    for (let i = 0; i < uniqueAsins.length; i += 5) {
      const batch = uniqueAsins.slice(i, i + 5);
      await Promise.all(batch.map(async (asin) => {
        try {
          const catRes = await axios.get(
            `${endpoint}/catalog/2022-04-01/items/${asin}?marketplaceIds=${marketplaceId}&includedData=relationships,summaries,images`,
            { headers: { 'x-amz-access-token': token, 'Content-Type': 'application/json' } }
          );
          const relationships = catRes.data?.relationships || [];
          const summaries = catRes.data?.summaries || [];
          const images = catRes.data?.images || [];
          const summary = summaries[0] || {};

          // Find parent ASIN
          for (const rel of relationships) {
            for (const r of rel.relationships || []) {
              if (r.parentAsins && r.parentAsins.length > 0) {
                asinToParent[asin] = r.parentAsins[0];
              }
              // Extract variation info
              if (r.variationTheme) {
                const skuItem = allSkus.find(s => s.asin === asin);
                if (skuItem && !skuItem.variation) {
                  skuItem.variation = r.variationTheme;
                }
              }
            }
          }

          // Store variation attributes from summary
          if (summary.itemName) {
            const skuItems = allSkus.filter(s => s.asin === asin);
            for (const skuItem of skuItems) {
              if (!skuItem.productName) skuItem.productName = summary.itemName;
              // Get color/size from summary
              if (summary.color) skuItem.variation = summary.color;
              if (summary.size) skuItem.variation = (skuItem.variation ? skuItem.variation + ' / ' : '') + summary.size;
            }
          }

          // Store image
          const imgUrl = images?.[0]?.images?.[0]?.link || null;
          if (imgUrl) {
            parentInfo[asin] = { ...(parentInfo[asin] || {}), imageUrl: imgUrl };
          }
        } catch (err) {
          // Catalog lookup is optional, continue
          console.log(`[amazon-skus] catalog lookup failed for ${asin}:`, err.message);
        }
      }));
      // Small delay between batches to avoid rate limits
      if (i + 5 < uniqueAsins.length) await new Promise(r => setTimeout(r, 500));
    }

    // Group by parent ASIN (or self if no parent)
    const grouped = {};
    for (const sku of allSkus) {
      const parentAsin = asinToParent[sku.asin] || sku.asin;
      if (!grouped[parentAsin]) {
        grouped[parentAsin] = {
          parentAsin,
          productName: sku.productName,
          imageUrl: parentInfo[sku.asin]?.imageUrl || parentInfo[parentAsin]?.imageUrl || null,
          children: {},
        };
      }
      // Group children by child ASIN
      if (!grouped[parentAsin].children[sku.asin]) {
        grouped[parentAsin].children[sku.asin] = {
          asin: sku.asin,
          productName: sku.productName,
          variation: sku.variation,
          imageUrl: parentInfo[sku.asin]?.imageUrl || null,
          skus: [],
        };
      }
      grouped[parentAsin].children[sku.asin].skus.push(sku);
      // Use the most descriptive product name for parent
      if (sku.productName && sku.productName.length > (grouped[parentAsin].productName || '').length) {
        grouped[parentAsin].productName = sku.productName;
      }
    }

    // Convert children objects to arrays
    const products = Object.values(grouped).map((p) => ({
      ...p,
      children: Object.values(p.children),
    }));

    return res.json({ skus: allSkus, products });
  } catch (err) {
    console.error('GET /amazon-skus error:', err.response?.data || err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Shopify helpers
// ---------------------------------------------------------------------------

// Fetch all orders from Shopify with cursor-based pagination
async function fetchAllShopifyOrders(shopDomain, accessToken, sinceDate) {
  const allOrders = [];
  let url = `https://${shopDomain}/admin/api/2024-01/orders.json?status=any&limit=250${sinceDate ? '&created_at_min=' + sinceDate : ''}`;

  while (url) {
    const res = await axios.get(url, {
      headers: { 'X-Shopify-Access-Token': accessToken },
    });

    allOrders.push(...(res.data.orders || []));

    // Parse Link header for next page
    const linkHeader = res.headers['link'] || res.headers['Link'] || '';
    const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    url = nextMatch ? nextMatch[1] : null;
  }

  return allOrders;
}

// ---------------------------------------------------------------------------
// Shopify status mapping
// ---------------------------------------------------------------------------
function mapShopifyStatus(order) {
  if (order.cancelled_at) return 'CANCELLED';
  if (order.fulfillment_status === 'fulfilled') return 'SHIPPED';
  if (order.fulfillment_status === 'partial') return 'SUBMITTED';
  if (order.financial_status === 'paid') return 'PENDING';
  return 'PENDING';
}

// ---------------------------------------------------------------------------
// Shopify Order Sync - Fetch orders from Shopify
// ---------------------------------------------------------------------------

router.post('/sync-orders', async (req, res) => {
  try {
    // Get Shopify store from channel_stores
    const { data: stores } = await supabase
      .from('channel_stores')
      .select('*')
      .eq('channel', 'SHOPIFY')
      .eq('is_active', true);

    if (!stores || stores.length === 0) {
      return res.status(400).json({ error: 'Shopifyストアが連携されていません。API設定から連携してください。' });
    }

    let totalSynced = 0;
    let totalSkipped = 0;

    for (const store of stores) {
      // Fetch all orders from Shopify (with pagination)
      const shopifyOrders = await fetchAllShopifyOrders(store.shop_domain, store.access_token, store.last_synced_at);
      console.log(`[sync-orders] Found ${shopifyOrders.length} orders from ${store.store_name}`);

      for (const order of shopifyOrders) {
        // Check if already imported
        const { data: existing } = await supabase
          .from('orders')
          .select('id')
          .eq('channel_order_id', String(order.id))
          .eq('channel', 'SHOPIFY')
          .maybeSingle();

        if (existing) {
          totalSkipped++;
          continue;
        }

        // Get shipping address
        const addr = order.shipping_address || {};
        const orderStatus = mapShopifyStatus(order);

        // Create order
        const orderId = `SHOP-${order.id}`;
        const { error: orderError } = await supabase.from('orders').insert({
          id: orderId,
          channel: 'SHOPIFY',
          channel_order_id: String(order.id),
          status: orderStatus,
          shipping_speed: 'STANDARD',
          recipient_name: addr.name || `${addr.last_name || ''} ${addr.first_name || ''}`.trim() || order.customer?.default_address?.name || '',
          address_line1: addr.address1 || '',
          address_line2: addr.address2 || '',
          city: addr.city || '',
          state_or_region: addr.province || '',
          postal_code: addr.zip || '',
          country_code: addr.country_code || 'JP',
          retry_count: 0,
          ordered_at: order.created_at,
          total_amount: parseFloat(order.total_price || '0'),
          currency: order.currency || 'JPY',
        });

        if (orderError) {
          console.error(`[sync-orders] order insert error:`, orderError.message);
          continue;
        }

        // Create order items with SKU mapping
        for (const item of order.line_items || []) {
          // Look up Amazon SKU from sku_mappings
          const { data: mapping } = await supabase
            .from('sku_mappings')
            .select('amazon_sku')
            .eq('channel', 'SHOPIFY')
            .eq('channel_sku', item.sku || item.variant_id?.toString() || '')
            .eq('is_active', true)
            .maybeSingle();

          await supabase.from('order_items').insert({
            id: `${orderId}-${item.id}`,
            order_id: orderId,
            channel_sku: item.sku || item.variant_id?.toString() || '',
            amazon_sku: mapping?.amazon_sku || '',
            quantity: item.quantity,
            title: item.title,
          });
        }

        // Log
        await supabase.from('fulfillment_logs').insert({
          order_id: orderId,
          event: 'IMPORTED',
          message: `Shopify注文 #${order.order_number} をインポート (${store.store_name})`,
        });

        totalSynced++;
      }

      // Update last_synced_at
      await supabase.from('channel_stores').update({ last_synced_at: new Date().toISOString() }).eq('id', store.id);
    }

    return res.json({ synced: totalSynced, skipped: totalSkipped });
  } catch (err) {
    console.error('[sync-orders] error:', err.response?.data || err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Amazon MCF Fulfillment - Submit order to Amazon Multi-Channel Fulfillment
// ---------------------------------------------------------------------------

router.post('/orders/:id/fulfill', async (req, res) => {
  try {
    const { id } = req.params;

    // Get order with items
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('id', id)
      .single();

    if (orderError) return res.status(404).json({ error: 'Order not found' });
    if (order.status !== 'PENDING') {
      return res.status(400).json({ error: `注文ステータスが${order.status}のため、発送依頼できません` });
    }

    // Check all items have amazon_sku
    const items = order.order_items || [];
    const unmapped = items.filter(i => !i.amazon_sku);
    if (unmapped.length > 0) {
      return res.status(400).json({
        error: `SKUマッピングが未設定の商品があります: ${unmapped.map(i => i.channel_sku).join(', ')}`,
        unmapped: unmapped.map(i => i.channel_sku),
      });
    }

    // Get Amazon access token
    const { token, endpoint } = await getAccessToken();

    // Create MCF fulfillment order
    const mcfOrderId = `MCF-${id}-${Date.now()}`;
    const mcfBody = {
      sellerFulfillmentOrderId: mcfOrderId,
      displayableOrderId: order.channel_order_id,
      displayableOrderDate: order.created_at,
      displayableOrderComment: `Shopify Order ${order.channel_order_id}`,
      shippingSpeedCategory: order.shipping_speed || 'Standard',
      destinationAddress: {
        name: order.recipient_name,
        addressLine1: order.address_line1,
        addressLine2: order.address_line2 || '',
        city: order.city,
        stateOrRegion: order.state_or_region || '',
        postalCode: order.postal_code,
        countryCode: order.country_code || 'JP',
      },
      items: items.map((item, idx) => ({
        sellerSku: item.amazon_sku,
        sellerFulfillmentOrderItemId: `${mcfOrderId}-item-${idx}`,
        quantity: item.quantity,
      })),
    };

    console.log('[fulfill] Creating MCF order:', mcfOrderId);

    await axios.post(
      `${endpoint}/fba/outbound/2020-07-01/fulfillmentOrders`,
      mcfBody,
      {
        headers: {
          'x-amz-access-token': token,
          'Content-Type': 'application/json',
        },
      }
    );

    // Update order status
    await supabase.from('orders').update({
      status: 'SUBMITTED',
      mcf_order_id: mcfOrderId,
      updated_at: new Date().toISOString(),
    }).eq('id', id);

    // Log
    await supabase.from('fulfillment_logs').insert({
      order_id: id,
      event: 'MCF_SUBMITTED',
      message: `Amazon MCF発送依頼を送信: ${mcfOrderId}`,
      payload: JSON.stringify({ mcfOrderId, items: items.length }),
    });

    return res.json({ ok: true, mcfOrderId });
  } catch (err) {
    console.error('[fulfill] error:', err.response?.data || err.message);

    // Log error
    await supabase.from('fulfillment_logs').insert({
      order_id: req.params.id,
      event: 'ERROR',
      message: `MCF発送依頼エラー: ${err.response?.data?.errors?.[0]?.message || err.message}`,
      payload: JSON.stringify(err.response?.data || err.message),
    });

    // Update order status
    await supabase.from('orders').update({
      status: 'ERROR',
      error_message: err.response?.data?.errors?.[0]?.message || err.message,
      updated_at: new Date().toISOString(),
    }).eq('id', req.params.id);

    return res.status(500).json({
      error: err.response?.data?.errors?.[0]?.message || err.message,
    });
  }
});

// POST /orders/fulfill-all - Auto fulfill all PENDING orders with complete SKU mappings
router.post('/fulfill-all', async (req, res) => {
  try {
    const { data: pendingOrders } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('status', 'PENDING')
      .order('created_at', { ascending: true })
      .limit(20);

    let fulfilled = 0;
    let skipped = 0;
    const errors = [];

    for (const order of pendingOrders || []) {
      const items = order.order_items || [];
      const allMapped = items.length > 0 && items.every(i => i.amazon_sku);
      if (!allMapped) {
        skipped++;
        continue;
      }

      try {
        const { token, endpoint } = await getAccessToken();
        const mcfOrderId = `MCF-${order.id}-${Date.now()}`;

        await axios.post(
          `${endpoint}/fba/outbound/2020-07-01/fulfillmentOrders`,
          {
            sellerFulfillmentOrderId: mcfOrderId,
            displayableOrderId: order.channel_order_id,
            displayableOrderDate: order.created_at,
            displayableOrderComment: `Auto-fulfillment: ${order.channel} Order ${order.channel_order_id}`,
            shippingSpeedCategory: order.shipping_speed || 'Standard',
            destinationAddress: {
              name: order.recipient_name,
              addressLine1: order.address_line1,
              addressLine2: order.address_line2 || '',
              city: order.city,
              stateOrRegion: order.state_or_region || '',
              postalCode: order.postal_code,
              countryCode: order.country_code || 'JP',
            },
            items: items.map((item, idx) => ({
              sellerSku: item.amazon_sku,
              sellerFulfillmentOrderItemId: `${mcfOrderId}-item-${idx}`,
              quantity: item.quantity,
            })),
          },
          { headers: { 'x-amz-access-token': token, 'Content-Type': 'application/json' } }
        );

        await supabase.from('orders').update({
          status: 'SUBMITTED',
          mcf_order_id: mcfOrderId,
          updated_at: new Date().toISOString(),
        }).eq('id', order.id);

        await supabase.from('fulfillment_logs').insert({
          order_id: order.id,
          event: 'MCF_SUBMITTED',
          message: `自動発送: ${mcfOrderId}`,
        });

        fulfilled++;
      } catch (err) {
        errors.push({ orderId: order.id, error: err.response?.data?.errors?.[0]?.message || err.message });
        await supabase.from('orders').update({
          status: 'ERROR',
          error_message: err.response?.data?.errors?.[0]?.message || err.message,
          updated_at: new Date().toISOString(),
        }).eq('id', order.id);
      }
    }

    return res.json({ fulfilled, skipped, errors: errors.length > 0 ? errors : undefined });
  } catch (err) {
    console.error('[fulfill-all] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Check Amazon MCF fulfillment status & update tracking
// ---------------------------------------------------------------------------

router.post('/check-tracking', async (req, res) => {
  try {
    // Get orders that have been submitted to MCF but not yet shipped
    const { data: pendingOrders } = await supabase
      .from('orders')
      .select('*')
      .not('mcf_order_id', 'is', null)
      .in('status', ['SUBMITTED', 'PENDING'])
      .limit(50);

    if (!pendingOrders || pendingOrders.length === 0) {
      return res.json({ updated: 0, message: '追跡確認対象の注文がありません' });
    }

    const { token, endpoint } = await getAccessToken();
    let updated = 0;
    const results = [];

    for (const order of pendingOrders) {
      try {
        const mcfRes = await axios.get(
          `${endpoint}/fba/outbound/2020-07-01/fulfillmentOrders/${order.mcf_order_id}`,
          { headers: { 'x-amz-access-token': token, 'Content-Type': 'application/json' } }
        );

        const fulfillment = mcfRes.data.payload?.fulfillmentOrder;
        const shipments = mcfRes.data.payload?.fulfillmentShipments || [];
        const shipment = shipments[0];
        const pkg = shipment?.fulfillmentShipmentPackage?.[0];

        const mcfStatus = fulfillment?.fulfillmentOrderStatus || '';
        const trackingNumber = pkg?.trackingNumber || null;
        const carrier = pkg?.carrierCode || null;

        const updateData = {};
        let newStatus = order.status;

        if (mcfStatus === 'Complete' || mcfStatus === 'COMPLETE' || shipment?.fulfillmentShipmentStatus === 'SHIPPED') {
          newStatus = 'SHIPPED';
          updateData.status = 'SHIPPED';
          updateData.shipped_at = shipment?.shippingDate || new Date().toISOString();
        } else if (mcfStatus === 'Processing' || mcfStatus === 'PROCESSING') {
          newStatus = 'SUBMITTED';
        }

        if (trackingNumber && trackingNumber !== order.tracking_number) {
          updateData.tracking_number = trackingNumber;
          updateData.carrier = carrier;
          updateData.tracking_updated_at = new Date().toISOString();
          if (!updateData.status) updateData.status = 'TRACKING_UPDATED';
          newStatus = updateData.status;
        }

        if (Object.keys(updateData).length > 0) {
          updateData.updated_at = new Date().toISOString();
          await supabase.from('orders').update(updateData).eq('id', order.id);

          await supabase.from('fulfillment_logs').insert({
            order_id: order.id,
            event: trackingNumber ? 'TRACKING_UPDATED' : 'STATUS_CHECK',
            message: trackingNumber
              ? `追跡番号: ${trackingNumber} (${carrier || '-'}) / MCFステータス: ${mcfStatus}`
              : `MCFステータス: ${mcfStatus}`,
            payload: JSON.stringify({ mcfStatus, trackingNumber, carrier, shipments: shipments.length }),
          });

          updated++;
        }

        results.push({
          orderId: order.id,
          mcfOrderId: order.mcf_order_id,
          mcfStatus,
          trackingNumber,
          carrier,
          newStatus,
        });
      } catch (err) {
        console.error(`[check-tracking] error for ${order.mcf_order_id}:`, err.response?.data || err.message);
        results.push({ orderId: order.id, mcfOrderId: order.mcf_order_id, error: err.message });
      }
    }

    return res.json({ updated, total: pendingOrders.length, results });
  } catch (err) {
    console.error('[check-tracking] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Push tracking info back to Shopify
// ---------------------------------------------------------------------------

router.post('/orders/:id/sync-to-shopify', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: order } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .single();

    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (!order.tracking_number) return res.status(400).json({ error: '追跡番号がまだ取得されていません' });
    if (order.channel !== 'SHOPIFY') return res.status(400).json({ error: 'Shopify注文ではありません' });

    // Get Shopify store credentials
    const { data: stores } = await supabase
      .from('channel_stores')
      .select('*')
      .eq('channel', 'SHOPIFY')
      .eq('is_active', true);

    const store = stores?.[0];
    if (!store) return res.status(400).json({ error: 'Shopifyストアが連携されていません' });

    // Create fulfillment in Shopify
    // First, get the order's fulfillment orders
    const foRes = await axios.get(
      `https://${store.shop_domain}/admin/api/2024-01/orders/${order.channel_order_id}/fulfillment_orders.json`,
      { headers: { 'X-Shopify-Access-Token': store.access_token } }
    );

    const fulfillmentOrders = foRes.data.fulfillment_orders || [];
    const openFO = fulfillmentOrders.find(fo => fo.status === 'open' || fo.status === 'in_progress');

    if (!openFO) {
      return res.status(400).json({ error: 'Shopifyで未発送の fulfillment order が見つかりません（既に発送済みの可能性があります）' });
    }

    // Create fulfillment
    const fulfillmentRes = await axios.post(
      `https://${store.shop_domain}/admin/api/2024-01/fulfillments.json`,
      {
        fulfillment: {
          line_items_by_fulfillment_order: [{
            fulfillment_order_id: openFO.id,
          }],
          tracking_info: {
            number: order.tracking_number,
            company: order.carrier || 'Amazon',
          },
          notify_customer: true,
        },
      },
      { headers: { 'X-Shopify-Access-Token': store.access_token, 'Content-Type': 'application/json' } }
    );

    await supabase.from('fulfillment_logs').insert({
      order_id: id,
      event: 'SHOPIFY_SYNCED',
      message: `Shopifyに配送情報を反映: ${order.tracking_number} (${order.carrier || 'Amazon'})`,
      payload: JSON.stringify({ shopifyFulfillmentId: fulfillmentRes.data.fulfillment?.id }),
    });

    await supabase.from('orders').update({
      status: 'TRACKING_UPDATED',
      updated_at: new Date().toISOString(),
    }).eq('id', id);

    return res.json({ ok: true, message: 'Shopifyに配送情報を反映しました' });
  } catch (err) {
    console.error('[sync-to-shopify] error:', err.response?.data || err.message);
    return res.status(500).json({ error: err.response?.data?.errors || err.message });
  }
});

// Push all tracked orders to Shopify
router.post('/sync-all-to-shopify', async (req, res) => {
  try {
    const { data: orders } = await supabase
      .from('orders')
      .select('*')
      .eq('channel', 'SHOPIFY')
      .not('tracking_number', 'is', null)
      .in('status', ['SHIPPED', 'TRACKING_UPDATED'])
      .limit(50);

    // Get Shopify store
    const { data: stores } = await supabase
      .from('channel_stores')
      .select('*')
      .eq('channel', 'SHOPIFY')
      .eq('is_active', true);

    const store = stores?.[0];
    if (!store) return res.status(400).json({ error: 'Shopifyストアが連携されていません' });

    let synced = 0;
    const errors = [];

    for (const order of orders || []) {
      try {
        const foRes = await axios.get(
          `https://${store.shop_domain}/admin/api/2024-01/orders/${order.channel_order_id}/fulfillment_orders.json`,
          { headers: { 'X-Shopify-Access-Token': store.access_token } }
        );

        const openFO = (foRes.data.fulfillment_orders || []).find(fo => fo.status === 'open' || fo.status === 'in_progress');
        if (!openFO) continue; // Already fulfilled in Shopify

        await axios.post(
          `https://${store.shop_domain}/admin/api/2024-01/fulfillments.json`,
          {
            fulfillment: {
              line_items_by_fulfillment_order: [{ fulfillment_order_id: openFO.id }],
              tracking_info: { number: order.tracking_number, company: order.carrier || 'Amazon' },
              notify_customer: true,
            },
          },
          { headers: { 'X-Shopify-Access-Token': store.access_token, 'Content-Type': 'application/json' } }
        );

        await supabase.from('fulfillment_logs').insert({
          order_id: order.id,
          event: 'SHOPIFY_SYNCED',
          message: `Shopifyに配送情報を反映: ${order.tracking_number}`,
        });

        synced++;
      } catch (err) {
        errors.push({ orderId: order.id, error: err.response?.data?.errors || err.message });
      }
    }

    return res.json({ synced, errors: errors.length > 0 ? errors : undefined });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Cron: Auto sync orders every 3 hours
// ---------------------------------------------------------------------------

router.get('/cron/sync', async (req, res) => {
  console.log('[cron/sync] Starting auto sync...');
  const results = { orderSync: null, autoFulfill: null };

  try {
    // 1. Sync orders from Shopify
    const { data: stores } = await supabase
      .from('channel_stores')
      .select('*')
      .eq('is_active', true);

    let totalSynced = 0;
    for (const store of stores || []) {
      if (store.channel === 'SHOPIFY' && store.shop_domain && store.access_token) {
        try {
          const cronOrders = await fetchAllShopifyOrders(store.shop_domain, store.access_token, store.last_synced_at);

          for (const order of cronOrders) {
            const { data: existing } = await supabase
              .from('orders')
              .select('id')
              .eq('channel_order_id', String(order.id))
              .eq('channel', 'SHOPIFY')
              .maybeSingle();

            if (existing) continue;

            const addr = order.shipping_address || {};
            const orderStatus = mapShopifyStatus(order);
            const orderId = `SHOP-${order.id}`;

            await supabase.from('orders').insert({
              id: orderId,
              channel: 'SHOPIFY',
              channel_order_id: String(order.id),
              status: orderStatus,
              shipping_speed: 'STANDARD',
              recipient_name: addr.name || `${addr.last_name || ''} ${addr.first_name || ''}`.trim(),
              address_line1: addr.address1 || '',
              address_line2: addr.address2 || '',
              city: addr.city || '',
              state_or_region: addr.province || '',
              postal_code: addr.zip || '',
              country_code: addr.country_code || 'JP',
              retry_count: 0,
              ordered_at: order.created_at,
              total_amount: parseFloat(order.total_price || '0'),
              currency: order.currency || 'JPY',
            });

            for (const item of order.line_items || []) {
              const { data: mapping } = await supabase
                .from('sku_mappings')
                .select('amazon_sku')
                .eq('channel', 'SHOPIFY')
                .eq('channel_sku', item.sku || '')
                .eq('is_active', true)
                .maybeSingle();

              await supabase.from('order_items').insert({
                id: `${orderId}-${item.id}`,
                order_id: orderId,
                channel_sku: item.sku || '',
                amazon_sku: mapping?.amazon_sku || '',
                quantity: item.quantity,
                title: item.title,
              });
            }

            await supabase.from('fulfillment_logs').insert({
              order_id: orderId,
              event: 'IMPORTED',
              message: `[自動] Shopify注文 #${order.order_number} をインポート`,
            });

            totalSynced++;
          }

          await supabase.from('channel_stores').update({ last_synced_at: new Date().toISOString() }).eq('id', store.id);
        } catch (err) {
          console.error(`[cron/sync] Shopify sync error for ${store.store_name}:`, err.message);
        }
      }
    }
    results.orderSync = { synced: totalSynced };
    console.log(`[cron/sync] Synced ${totalSynced} orders`);

    // 2. Auto-fulfill pending orders with complete SKU mappings
    const { data: pendingOrders } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('status', 'PENDING')
      .limit(20);

    let fulfilled = 0;
    for (const order of pendingOrders || []) {
      const items = order.order_items || [];
      if (items.length === 0 || !items.every(i => i.amazon_sku)) continue;

      try {
        const { token, endpoint } = await getAccessToken();
        const mcfOrderId = `MCF-${order.id}-${Date.now()}`;

        await axios.post(
          `${endpoint}/fba/outbound/2020-07-01/fulfillmentOrders`,
          {
            sellerFulfillmentOrderId: mcfOrderId,
            displayableOrderId: order.channel_order_id,
            displayableOrderDate: order.created_at,
            displayableOrderComment: `Auto: ${order.channel} #${order.channel_order_id}`,
            shippingSpeedCategory: order.shipping_speed || 'Standard',
            destinationAddress: {
              name: order.recipient_name,
              addressLine1: order.address_line1,
              addressLine2: order.address_line2 || '',
              city: order.city,
              stateOrRegion: order.state_or_region || '',
              postalCode: order.postal_code,
              countryCode: order.country_code || 'JP',
            },
            items: items.map((item, idx) => ({
              sellerSku: item.amazon_sku,
              sellerFulfillmentOrderItemId: `${mcfOrderId}-item-${idx}`,
              quantity: item.quantity,
            })),
          },
          { headers: { 'x-amz-access-token': token, 'Content-Type': 'application/json' } }
        );

        await supabase.from('orders').update({ status: 'SUBMITTED', mcf_order_id: mcfOrderId, updated_at: new Date().toISOString() }).eq('id', order.id);
        await supabase.from('fulfillment_logs').insert({ order_id: order.id, event: 'MCF_SUBMITTED', message: `[自動] Amazon MCF発送: ${mcfOrderId}` });
        fulfilled++;
      } catch (err) {
        console.error(`[cron/sync] fulfill error for ${order.id}:`, err.message);
        await supabase.from('orders').update({ status: 'ERROR', error_message: err.response?.data?.errors?.[0]?.message || err.message }).eq('id', order.id);
      }
    }
    results.autoFulfill = { fulfilled };
    console.log(`[cron/sync] Auto-fulfilled ${fulfilled} orders`);

  } catch (err) {
    console.error('[cron/sync] error:', err.message);
    return res.status(500).json({ error: err.message, partial: results });
  }

  return res.json({ ok: true, results });
});

module.exports = router;

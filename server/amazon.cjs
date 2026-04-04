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
      .order('created_at', { ascending: false })
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

    return res.json({
      data,
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

    return res.json({ ...order, logs });
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
      // Fetch unfulfilled orders from Shopify
      const shopifyRes = await axios.get(
        `https://${store.shop_domain}/admin/api/2024-01/orders.json?status=any&limit=50`,
        { headers: { 'X-Shopify-Access-Token': store.access_token } }
      );

      const shopifyOrders = shopifyRes.data.orders || [];
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
          const shopifyRes = await axios.get(
            `https://${store.shop_domain}/admin/api/2024-01/orders.json?status=any&limit=50`,
            { headers: { 'X-Shopify-Access-Token': store.access_token } }
          );

          for (const order of shopifyRes.data.orders || []) {
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

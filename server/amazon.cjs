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
let cachedRefreshToken = null;

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
  const account = await getSpAccount();

  // Use cache only if refresh_token hasn't changed AND token still valid
  if (cachedToken && cachedRefreshToken === account.refreshToken && Date.now() < tokenExpiresAt - REFRESH_MARGIN_MS) {
    return { token: cachedToken, endpoint: cachedEndpoint, marketplaceId: account.marketplaceId };
  }

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
  cachedRefreshToken = account.refreshToken;
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

    // Map to camelCase for frontend
    const mapped = (data || []).map(m => ({
      id: m.id,
      channel: m.channel,
      channelSku: m.channel_sku,
      amazonSku: m.amazon_sku,
      isActive: m.is_active,
      createdAt: m.created_at,
    }));

    return res.json(mapped);
  } catch (err) {
    console.error('GET /sku-mappings error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /sku-mappings - Create or upsert SKU mapping
router.post('/sku-mappings', async (req, res) => {
  try {
    const channel = req.body.channel;
    const channel_sku = req.body.channel_sku || req.body.channelSku;
    const amazon_sku = req.body.amazon_sku || req.body.amazonSku;

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

    return res.json({
      id: result.id,
      channel: result.channel,
      channelSku: result.channel_sku,
      amazonSku: result.amazon_sku,
      isActive: result.is_active,
      createdAt: result.created_at,
    });
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
    let url = `https://${store.shop_domain}/admin/api/2025-01/products.json?limit=250`;

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

      // Retry on 429 rate limit
      let response;
      for (let retry = 0; retry < 3; retry++) {
        try {
          response = await axios.get(`${endpoint}/fba/inventory/v1/summaries?${params}`, {
            headers: { 'x-amz-access-token': token, 'Content-Type': 'application/json' },
          });
          break;
        } catch (e) {
          if (e.response?.status === 429 && retry < 2) {
            await new Promise(r => setTimeout(r, (retry + 1) * 2000));
            continue;
          }
          throw e;
        }
      }

      const items = response.data.payload?.inventorySummaries || [];
      for (const item of items) {
        const productName = item.productName || '';

        // Extract variation from product name (NOT from SKU - SKU suffixes are meaningless)
        let variation = extractVariationFromName(productName);

        // FBA判定: fnSkuが X00 で始まる = FBA、ASINと同じ = 自社出荷
        const isFba = item.fnSku && item.fnSku !== item.asin && item.fnSku.startsWith('X00');

        allSkus.push({
          sellerSku: item.sellerSku,
          asin: item.asin,
          fnSku: item.fnSku,
          productName,
          variation,
          condition: item.condition || '',
          isFba,
          fulfillableQuantity: item.inventoryDetails?.fulfillableQuantity ?? 0,
          inboundQuantity: (item.inventoryDetails?.inboundWorkingQuantity ?? 0) + (item.inventoryDetails?.inboundShippedQuantity ?? 0) + (item.inventoryDetails?.inboundReceivingQuantity ?? 0),
          reservedQuantity: item.inventoryDetails?.reservedQuantity?.totalReservedQuantity ?? 0,
          totalQuantity: item.totalQuantity ?? 0,
        });
      }

      nextToken = response.data.pagination?.nextToken || null;
    } while (nextToken);

    // Helper: extract variation from product name
    function extractVariationFromName(name) {
      if (!name) return '';
      // Pattern: "商品名 カラー サイズ" at end
      const patterns = [
        /(?:ブラック|ホワイト|レッド|ブルー|グリーン|イエロー|ピンク|グレー|ネイビー|ベージュ|オレンジ|パープル|フルブラック|ダークグレー|ライトグレー|ディープレッド)[\s/]*(?:\d+cm|[SMLX234]+L?サイズ|[SMLX234]+L?)?/i,
        /[（(]([^）)]+)[）)]/,  // Content in parentheses
        /((?:S|M|L|XL|2L|3L|4L|2XL|3XL)サイズ?)$/,
        /(\d+(?:cm|mm|kg|g))\s*$/,
      ];
      for (const pattern of patterns) {
        const match = name.match(pattern);
        if (match) return (match[1] || match[0]).trim();
      }
      return '';
    }

    // Fetch catalog info with DB cache
    const uniqueAsins = [...new Set(allSkus.map(s => s.asin))];
    const catalogCache = {};

    // 1. Check DB cache first (only use cache if it has image - otherwise retry)
    const { data: cachedItems } = await supabase
      .from('amazon_catalog_cache')
      .select('*')
      .in('asin', uniqueAsins);

    const cachedSet = new Set();
    for (const item of cachedItems || []) {
      // Skip cache entries without image (likely failed lookups - retry)
      if (!item.image_url) continue;
      catalogCache[item.asin] = {
        parentAsin: item.parent_asin || item.asin,
        variation: item.variation || '',
        imageUrl: item.image_url || null,
        itemName: item.item_name || '',
      };
      cachedSet.add(item.asin);
    }

    // 2. Fetch uncached ASINs from Catalog API
    const uncachedAsins = uniqueAsins.filter(a => !cachedSet.has(a));
    console.log(`[amazon-skus] ${cachedSet.size} cached, ${uncachedAsins.length} to fetch from Catalog API`);

    // Limit to 30 per request to avoid timeouts (process remaining on next load)
    const toFetch = uncachedAsins.slice(0, 30);
    for (let i = 0; i < toFetch.length; i += 2) {
      const batch = toFetch.slice(i, i + 2);
      await Promise.all(batch.map(async (asin) => {
        try {
          const catRes = await axios.get(
            `${endpoint}/catalog/2022-04-01/items/${asin}?marketplaceIds=${marketplaceId}&includedData=relationships,summaries,images,attributes`,
            { headers: { 'x-amz-access-token': token, 'Content-Type': 'application/json' } }
          );

          const item = catRes.data;
          const summary = (item.summaries || [])[0] || {};
          const images = (item.images || [])[0]?.images || [];
          const relationships = (item.relationships || [])[0]?.relationships || [];
          const attributes = item.attributes || {};

          let parentAsin = asin;
          for (const rel of relationships) {
            if (rel.parentAsins && rel.parentAsins.length > 0) {
              parentAsin = rel.parentAsins[0];
              break;
            }
          }

          const attrs = [];
          const color = summary.color || (attributes.color && attributes.color[0]?.value) || '';
          const size = summary.size || (attributes.size && attributes.size[0]?.value) || '';
          const style = summary.style || (attributes.style && attributes.style[0]?.value) || '';
          if (color) attrs.push(color);
          if (size) attrs.push(size);
          if (style) attrs.push(style);

          let variation = attrs.join(' / ');
          if (!variation) {
            variation = extractVariationFromName(summary.itemName || '');
          }

          const mainImage = images.find(img => img.variant === 'MAIN') || images[0];
          const imageUrl = mainImage?.link || null;

          catalogCache[asin] = { parentAsin, variation, imageUrl, itemName: summary.itemName || '' };

          // Save to DB cache
          await supabase.from('amazon_catalog_cache').upsert({
            asin, parent_asin: parentAsin, variation, image_url: imageUrl, item_name: summary.itemName || '', fetched_at: new Date().toISOString(),
          });
        } catch (err) {
          // Don't cache failures - will retry next time
          const skuItem = allSkus.find(s => s.asin === asin);
          const nameVariation = extractVariationFromName(skuItem?.productName || '');
          catalogCache[asin] = { parentAsin: asin, variation: nameVariation, imageUrl: null, itemName: '' };
        }
      }));
      if (i + 2 < toFetch.length) await new Promise(r => setTimeout(r, 1500));
    }

    // Update SKU variation info from catalog
    for (const sku of allSkus) {
      const cat = catalogCache[sku.asin];
      if (cat) {
        if (cat.variation) sku.variation = cat.variation;
        if (cat.itemName && !sku.productName) sku.productName = cat.itemName;
      }
    }

    // Filter: FBA only + exclude hidden + FITPEAK only + exclude zero stock
    const { data: hiddenData } = await supabase.from('amazon_hidden_skus').select('seller_sku');
    const hiddenSet = new Set((hiddenData || []).map(h => h.seller_sku));
    const fbaSkus = allSkus.filter(s =>
      s.isFba &&
      !hiddenSet.has(s.sellerSku) &&
      s.productName.includes('FITPEAK') &&
      s.totalQuantity > 0  // Exclude deleted/zero-stock SKUs
    );
    console.log(`[amazon-skus] total: ${allSkus.length}, FBA: ${fbaSkus.length}, self-fulfilled: ${allSkus.length - fbaSkus.length}`);

    // Apply manual grouping (user-assigned parent ASINs override Catalog API)
    const { data: manualGroups } = await supabase.from('amazon_manual_groups').select('asin, group_asin');
    const manualGroupMap = {};
    for (const g of manualGroups || []) {
      manualGroupMap[g.asin] = g.group_asin;
    }

    // Group by parent ASIN
    const grouped = {};
    for (const sku of fbaSkus) {
      const cat = catalogCache[sku.asin] || {};
      // Manual grouping takes priority
      const parentAsin = manualGroupMap[sku.asin] || cat.parentAsin || sku.asin;

      if (!grouped[parentAsin]) {
        grouped[parentAsin] = {
          parentAsin,
          productName: sku.productName,
          imageUrl: cat.imageUrl || null,
          children: {},
        };
      }

      if (!grouped[parentAsin].children[sku.asin]) {
        grouped[parentAsin].children[sku.asin] = {
          asin: sku.asin,
          productName: sku.productName,
          variation: cat.variation || sku.variation || '',
          imageUrl: cat.imageUrl || null,
          skus: [],
        };
      }
      grouped[parentAsin].children[sku.asin].skus.push(sku);

      // Keep shortest product name as parent name (often base product)
      if (!grouped[parentAsin].productName || (sku.productName && sku.productName.length < grouped[parentAsin].productName.length)) {
        grouped[parentAsin].productName = sku.productName;
      }
    }

    const products = Object.values(grouped).map(p => ({
      ...p,
      children: Object.values(p.children),
    }));

    // Debug: count catalog successes/failures
    const catalogStats = {
      total: uniqueAsins.length,
      success: Object.values(catalogCache).filter(c => !c._failed).length,
      failed: Object.values(catalogCache).filter(c => c._failed).length,
      withVariation: Object.values(catalogCache).filter(c => c.variation).length,
      withImage: Object.values(catalogCache).filter(c => c.imageUrl).length,
    };
    console.log('[amazon-skus] catalog stats:', JSON.stringify(catalogStats));

    return res.json({ skus: fbaSkus, products, catalogStats });
  } catch (err) {
    const status = err.response?.status;
    const detail = JSON.stringify(err.response?.data || err.message);
    console.error(`GET /amazon-skus error (${status}):`, detail);
    const userMsg = status === 403 ? 'SP-APIの権限エラー。アプリ認証を確認してください。' :
                    status === 429 ? 'API呼び出し頻度制限。しばらく待ってから再試行してください。' :
                    err.response?.data?.errors?.[0]?.message || err.message;
    return res.status(500).json({ error: userMsg, status, detail });
  }
});

// ---------------------------------------------------------------------------
// Inventory Sync: Amazon FBA → Shopify
// ---------------------------------------------------------------------------

router.post('/sync-inventory', async (req, res) => {
  try {
    // 1. Get all SKU mappings
    const { data: mappings } = await supabase
      .from('sku_mappings')
      .select('*')
      .eq('is_active', true);

    if (!mappings || mappings.length === 0) {
      return res.json({ synced: 0, message: 'SKUマッピングがありません' });
    }

    // 2. Get Amazon FBA inventory
    const { token, endpoint, marketplaceId } = await getAccessToken();
    const amazonStock = {}; // sellerSku -> fulfillableQuantity

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

      for (const item of response.data.payload?.inventorySummaries || []) {
        amazonStock[item.sellerSku] = item.inventoryDetails?.fulfillableQuantity ?? 0;
      }
      nextToken = response.data.pagination?.nextToken || null;
    } while (nextToken);

    // 3. Get Shopify store
    const { data: stores } = await supabase
      .from('channel_stores')
      .select('*')
      .eq('channel', 'SHOPIFY')
      .eq('is_active', true);

    const store = stores?.[0];
    if (!store) return res.status(400).json({ error: 'Shopifyストアが連携されていません' });

    // 4. Get Shopify primary location (the one that fulfills online orders)
    const shopRes = await axios.get(
      `https://${store.shop_domain}/admin/api/2025-01/shop.json`,
      { headers: { 'X-Shopify-Access-Token': store.access_token } }
    );
    const locationId = shopRes.data.shop?.primary_location_id;
    if (!locationId) return res.status(400).json({ error: 'Shopifyのプライマリロケーションが見つかりません' });

    // 5. Sync each mapping
    let synced = 0;
    let skipped = 0;
    const errors = [];

    for (const mapping of mappings) {
      const amazonQty = amazonStock[mapping.amazon_sku];
      if (amazonQty === undefined) {
        skipped++;
        continue;
      }

      try {
        // Find Shopify variant by SKU or variantId
        let variantId = null;
        let inventoryItemId = null;

        // Try finding by SKU first
        if (mapping.channel_sku && !/^\d{10,}$/.test(mapping.channel_sku)) {
          // If channel_sku looks like a real SKU (not a variantId)
          const variantsRes = await axios.get(
            `https://${store.shop_domain}/admin/api/2025-01/variants.json?query=sku:${encodeURIComponent(mapping.channel_sku)}`,
            { headers: { 'X-Shopify-Access-Token': store.access_token } }
          ).catch(() => null);
          const v = variantsRes?.data?.variants?.[0];
          if (v) { variantId = v.id; inventoryItemId = v.inventory_item_id; }
        }

        // If SKU didn't work, try as variantId
        if (!variantId && /^\d{10,}$/.test(mapping.channel_sku)) {
          const vRes = await axios.get(
            `https://${store.shop_domain}/admin/api/2025-01/variants/${mapping.channel_sku}.json`,
            { headers: { 'X-Shopify-Access-Token': store.access_token } }
          ).catch(() => null);
          const v = vRes?.data?.variant;
          if (v) { variantId = v.id; inventoryItemId = v.inventory_item_id; }
        }

        if (!inventoryItemId) {
          errors.push({ sku: mapping.channel_sku, error: 'Shopifyバリアントが見つかりません' });
          continue;
        }

        // Update Shopify inventory
        await axios.post(
          `https://${store.shop_domain}/admin/api/2025-01/inventory_levels/set.json`,
          {
            location_id: locationId,
            inventory_item_id: inventoryItemId,
            available: amazonQty,
          },
          { headers: { 'X-Shopify-Access-Token': store.access_token, 'Content-Type': 'application/json' } }
        );

        synced++;
      } catch (err) {
        errors.push({ sku: mapping.channel_sku, error: err.response?.data?.errors || err.message });
      }
    }

    return res.json({ synced, skipped, errors: errors.length > 0 ? errors.slice(0, 10) : undefined });
  } catch (err) {
    const status = err.response?.status;
    const detail = JSON.stringify(err.response?.data || err.message);
    console.error(`[sync-inventory] error ${status}:`, detail);
    return res.status(500).json({ error: err.message, status, detail });
  }
});

// Manual product grouping
router.post('/group-products', async (req, res) => {
  try {
    const { groupAsin, childAsins } = req.body;
    if (!groupAsin || !childAsins || !childAsins.length) {
      return res.status(400).json({ error: 'groupAsin and childAsins required' });
    }
    for (const asin of childAsins) {
      await supabase.from('amazon_manual_groups').upsert({ asin, group_asin: groupAsin });
    }
    res.json({ ok: true, grouped: childAsins.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/group-products/:asin', async (req, res) => {
  try {
    await supabase.from('amazon_manual_groups').delete().eq('asin', req.params.asin);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Hide/unhide SKUs
router.post('/hide-sku', async (req, res) => {
  try {
    const { sellerSku } = req.body;
    if (!sellerSku) return res.status(400).json({ error: 'sellerSku is required' });
    await supabase.from('amazon_hidden_skus').upsert({ seller_sku: sellerSku });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/hide-product', async (req, res) => {
  try {
    const { sellerSkus } = req.body;
    if (!sellerSkus || !sellerSkus.length) return res.status(400).json({ error: 'sellerSkus is required' });
    for (const sku of sellerSkus) {
      await supabase.from('amazon_hidden_skus').upsert({ seller_sku: sku });
    }
    res.json({ ok: true, hidden: sellerSkus.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Shopify helpers
// ---------------------------------------------------------------------------

// Fetch all orders from Shopify with cursor-based pagination
async function fetchAllShopifyOrders(shopDomain, accessToken, sinceDate) {
  const allOrders = [];
  let url = `https://${shopDomain}/admin/api/2025-01/orders.json?status=any&limit=250${sinceDate ? '&created_at_min=' + sinceDate : ''}`;

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
        // ★強化された重複チェック: channel_order_idまたはShopify order numberで既存注文を検索
        const { data: existing } = await supabase
          .from('orders')
          .select('id, status')
          .eq('channel_order_id', String(order.id))
          .eq('channel', 'SHOPIFY')
          .maybeSingle();

        if (existing) {
          totalSkipped++;
          continue;
        }

        // ★追加の重複チェック: 同じShopify注文番号の注文が既にないか（IDが変わるケース対策）
        const { data: existingByNumber } = await supabase
          .from('orders')
          .select('id, status')
          .eq('channel', 'SHOPIFY')
          .like('id', `SHOP-${order.id}%`)
          .maybeSingle();

        if (existingByNumber) {
          console.warn(`[sync-orders] DUPLICATE SKIP: Shopify order ${order.id} already exists as ${existingByNumber.id}`);
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

    // ★重複発送防止: 既にMCF注文IDがある場合は拒否
    if (order.mcf_order_id) {
      console.warn(`[fulfill] DUPLICATE BLOCKED: order ${id} already has mcf_order_id=${order.mcf_order_id}`);
      return res.status(400).json({ error: `この注文は既に発送済みです (MCF: ${order.mcf_order_id})` });
    }

    // ★重複発送防止: 同じchannel_order_idで既にSUBMITTED/SHIPPED/DELIVEREDの注文がないかチェック
    if (order.channel_order_id) {
      const { data: duplicates } = await supabase
        .from('orders')
        .select('id, status, mcf_order_id')
        .eq('channel_order_id', order.channel_order_id)
        .in('status', ['SUBMITTED', 'SHIPPED', 'DELIVERED'])
        .neq('id', id);
      if (duplicates && duplicates.length > 0) {
        console.warn(`[fulfill] DUPLICATE BLOCKED: channel_order_id=${order.channel_order_id} already fulfilled by order ${duplicates[0].id}`);
        // この注文をDUPLICATEステータスに変更
        await supabase.from('orders').update({ status: 'DUPLICATE', error_message: `重複注文: ${duplicates[0].id}が既に発送済み`, updated_at: new Date().toISOString() }).eq('id', id);
        return res.status(400).json({ error: `同じ注文(${order.channel_order_id})が既に発送済みです (${duplicates[0].id})` });
      }
    }

    // ★重複発送防止: fulfillment_logsでMCF_SUBMITTEDの履歴がないかチェック
    const { data: existingLogs } = await supabase
      .from('fulfillment_logs')
      .select('id')
      .eq('order_id', id)
      .eq('event', 'MCF_SUBMITTED')
      .limit(1);
    if (existingLogs && existingLogs.length > 0) {
      console.warn(`[fulfill] DUPLICATE BLOCKED: order ${id} already has MCF_SUBMITTED log`);
      return res.status(400).json({ error: 'この注文は既にMCF発送依頼済みです' });
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
      shippingSpeedCategory: 'Standard',
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

      // ★重複発送防止: 既にMCF注文IDがある場合はスキップ
      if (order.mcf_order_id) {
        console.warn(`[fulfill-all] SKIP: order ${order.id} already has mcf_order_id=${order.mcf_order_id}`);
        skipped++;
        continue;
      }

      // ★重複発送防止: 同じchannel_order_idで既に発送済みの注文がないかチェック
      if (order.channel_order_id) {
        const { data: duplicates } = await supabase
          .from('orders')
          .select('id, status')
          .eq('channel_order_id', order.channel_order_id)
          .in('status', ['SUBMITTED', 'SHIPPED', 'DELIVERED'])
          .neq('id', order.id);
        if (duplicates && duplicates.length > 0) {
          console.warn(`[fulfill-all] DUPLICATE SKIP: channel_order_id=${order.channel_order_id} already fulfilled`);
          await supabase.from('orders').update({ status: 'DUPLICATE', error_message: `重複注文: ${duplicates[0].id}が既に発送済み`, updated_at: new Date().toISOString() }).eq('id', order.id);
          skipped++;
          continue;
        }
      }

      // ★重複発送防止: fulfillment_logsの履歴チェック
      const { data: existingLogs } = await supabase
        .from('fulfillment_logs')
        .select('id')
        .eq('order_id', order.id)
        .eq('event', 'MCF_SUBMITTED')
        .limit(1);
      if (existingLogs && existingLogs.length > 0) {
        console.warn(`[fulfill-all] DUPLICATE SKIP: order ${order.id} already has MCF_SUBMITTED log`);
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
            shippingSpeedCategory: 'Standard',
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
      `https://${store.shop_domain}/admin/api/2025-01/orders/${order.channel_order_id}/fulfillment_orders.json`,
      { headers: { 'X-Shopify-Access-Token': store.access_token } }
    );

    const fulfillmentOrders = foRes.data.fulfillment_orders || [];
    const openFO = fulfillmentOrders.find(fo => fo.status === 'open' || fo.status === 'in_progress');

    if (!openFO) {
      return res.status(400).json({ error: 'Shopifyで未発送の fulfillment order が見つかりません（既に発送済みの可能性があります）' });
    }

    // Create fulfillment
    const fulfillmentRes = await axios.post(
      `https://${store.shop_domain}/admin/api/2025-01/fulfillments.json`,
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
          `https://${store.shop_domain}/admin/api/2025-01/orders/${order.channel_order_id}/fulfillment_orders.json`,
          { headers: { 'X-Shopify-Access-Token': store.access_token } }
        );

        const openFO = (foRes.data.fulfillment_orders || []).find(fo => fo.status === 'open' || fo.status === 'in_progress');
        if (!openFO) continue; // Already fulfilled in Shopify

        await axios.post(
          `https://${store.shop_domain}/admin/api/2025-01/fulfillments.json`,
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
              const channelSku = item.sku || item.variant_id?.toString() || '';
              // Try matching by SKU first, then by variant_id
              let mapping = null;
              if (item.sku) {
                const { data } = await supabase.from('sku_mappings').select('amazon_sku').eq('channel', 'SHOPIFY').eq('channel_sku', item.sku).eq('is_active', true).maybeSingle();
                mapping = data;
              }
              if (!mapping && item.variant_id) {
                const { data } = await supabase.from('sku_mappings').select('amazon_sku').eq('channel', 'SHOPIFY').eq('channel_sku', item.variant_id.toString()).eq('is_active', true).maybeSingle();
                mapping = data;
              }

              await supabase.from('order_items').insert({
                id: `${orderId}-${item.id}`,
                order_id: orderId,
                channel_sku: channelSku,
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
            shippingSpeedCategory: 'Standard',
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

    // 3. Sync Amazon FBA inventory to Shopify
    try {
      const { data: activeMappings } = await supabase.from('sku_mappings').select('*').eq('is_active', true);
      const { data: shopStores } = await supabase.from('channel_stores').select('*').eq('channel', 'SHOPIFY').eq('is_active', true);
      const shopStore = shopStores?.[0];

      if (activeMappings && activeMappings.length > 0 && shopStore) {
        const { token: amzToken, endpoint: amzEndpoint, marketplaceId } = await getAccessToken();
        const amazonStock = {};
        let nextTok = null;
        do {
          const params = new URLSearchParams({ details: 'true', granularityType: 'Marketplace', granularityId: marketplaceId, marketplaceIds: marketplaceId });
          if (nextTok) params.set('nextToken', nextTok);
          const r = await axios.get(`${amzEndpoint}/fba/inventory/v1/summaries?${params}`, { headers: { 'x-amz-access-token': amzToken, 'Content-Type': 'application/json' } });
          for (const it of r.data.payload?.inventorySummaries || []) {
            amazonStock[it.sellerSku] = it.inventoryDetails?.fulfillableQuantity ?? 0;
          }
          nextTok = r.data.pagination?.nextToken || null;
        } while (nextTok);

        const shopRes2 = await axios.get(`https://${shopStore.shop_domain}/admin/api/2025-01/shop.json`, { headers: { 'X-Shopify-Access-Token': shopStore.access_token } });
        const locationId = shopRes2.data.shop?.primary_location_id;

        let invSynced = 0;
        for (const m of activeMappings) {
          const amzQty = amazonStock[m.amazon_sku];
          if (amzQty === undefined || !locationId) continue;
          try {
            let inventoryItemId = null;
            if (m.channel_sku && !/^\d{10,}$/.test(m.channel_sku)) {
              const vRes = await axios.get(`https://${shopStore.shop_domain}/admin/api/2025-01/variants.json?query=sku:${encodeURIComponent(m.channel_sku)}`, { headers: { 'X-Shopify-Access-Token': shopStore.access_token } }).catch(() => null);
              inventoryItemId = vRes?.data?.variants?.[0]?.inventory_item_id;
            }
            if (!inventoryItemId && /^\d{10,}$/.test(m.channel_sku)) {
              const vRes = await axios.get(`https://${shopStore.shop_domain}/admin/api/2025-01/variants/${m.channel_sku}.json`, { headers: { 'X-Shopify-Access-Token': shopStore.access_token } }).catch(() => null);
              inventoryItemId = vRes?.data?.variant?.inventory_item_id;
            }
            if (!inventoryItemId) continue;
            await axios.post(`https://${shopStore.shop_domain}/admin/api/2025-01/inventory_levels/set.json`, {
              location_id: locationId, inventory_item_id: inventoryItemId, available: amzQty,
            }, { headers: { 'X-Shopify-Access-Token': shopStore.access_token, 'Content-Type': 'application/json' } });
            invSynced++;
          } catch (e) {}
        }
        results.inventorySync = { synced: invSynced, total: activeMappings.length };
        console.log(`[cron/sync] Synced inventory for ${invSynced}/${activeMappings.length} mappings`);
      }
    } catch (err) {
      console.error('[cron/sync] inventory sync error:', err.message);
    }

    // 4. Check tracking info for SUBMITTED orders (Amazon MCF → DB)
    try {
      const { data: submittedOrders } = await supabase
        .from('orders')
        .select('*')
        .not('mcf_order_id', 'is', null)
        .in('status', ['SUBMITTED', 'PENDING'])
        .limit(50);

      let trackingUpdated = 0;
      if (submittedOrders && submittedOrders.length > 0) {
        const { token: trkToken, endpoint: trkEndpoint } = await getAccessToken();
        for (const order of submittedOrders) {
          try {
            const mcfRes = await axios.get(
              `${trkEndpoint}/fba/outbound/2020-07-01/fulfillmentOrders/${order.mcf_order_id}`,
              { headers: { 'x-amz-access-token': trkToken, 'Content-Type': 'application/json' } }
            );
            const fulfillment = mcfRes.data.payload?.fulfillmentOrder;
            const shipments = mcfRes.data.payload?.fulfillmentShipments || [];
            const shipment = shipments[0];
            const pkg = shipment?.fulfillmentShipmentPackage?.[0];
            const mcfStatus = fulfillment?.fulfillmentOrderStatus || '';
            const trackingNumber = pkg?.trackingNumber || null;
            const carrier = pkg?.carrierCode || null;

            const updateData = {};
            if (mcfStatus === 'Complete' || mcfStatus === 'COMPLETE' || shipment?.fulfillmentShipmentStatus === 'SHIPPED') {
              updateData.status = 'SHIPPED';
              updateData.shipped_at = shipment?.shippingDate || new Date().toISOString();
            }
            if (trackingNumber && trackingNumber !== order.tracking_number) {
              updateData.tracking_number = trackingNumber;
              updateData.carrier = carrier;
              updateData.tracking_updated_at = new Date().toISOString();
              if (!updateData.status) updateData.status = 'TRACKING_UPDATED';
            }
            if (Object.keys(updateData).length > 0) {
              updateData.updated_at = new Date().toISOString();
              await supabase.from('orders').update(updateData).eq('id', order.id);
              await supabase.from('fulfillment_logs').insert({
                order_id: order.id,
                event: trackingNumber ? 'TRACKING_UPDATED' : 'STATUS_CHECK',
                message: `[自動] 追跡番号: ${trackingNumber || '-'} (${carrier || '-'}) / MCF: ${mcfStatus}`,
                payload: JSON.stringify({ mcfStatus, trackingNumber, carrier }),
              });
              trackingUpdated++;
            }
          } catch (err) {
            console.error(`[cron/sync] tracking check error for ${order.mcf_order_id}:`, err.message);
          }
        }
      }
      results.trackingCheck = { checked: submittedOrders?.length || 0, updated: trackingUpdated };
      console.log(`[cron/sync] Tracking check: ${trackingUpdated} updated`);
    } catch (err) {
      console.error('[cron/sync] tracking check error:', err.message);
      results.trackingCheck = { error: err.message };
    }

    // 5. Push tracking info to Shopify for SHIPPED/TRACKING_UPDATED orders
    try {
      const { data: shippedOrders } = await supabase
        .from('orders')
        .select('*')
        .eq('channel', 'SHOPIFY')
        .not('tracking_number', 'is', null)
        .in('status', ['SHIPPED', 'TRACKING_UPDATED'])
        .limit(50);

      const { data: shopStoresForSync } = await supabase
        .from('channel_stores')
        .select('*')
        .eq('channel', 'SHOPIFY')
        .eq('is_active', true);
      const shopStoreForSync = shopStoresForSync?.[0];

      let shopifySynced = 0;
      if (shippedOrders && shippedOrders.length > 0 && shopStoreForSync) {
        for (const order of shippedOrders) {
          try {
            const foRes = await axios.get(
              `https://${shopStoreForSync.shop_domain}/admin/api/2025-01/orders/${order.channel_order_id}/fulfillment_orders.json`,
              { headers: { 'X-Shopify-Access-Token': shopStoreForSync.access_token } }
            );
            const openFO = (foRes.data.fulfillment_orders || []).find(fo => fo.status === 'open' || fo.status === 'in_progress');
            if (!openFO) {
              // Already fulfilled in Shopify, mark as COMPLETED
              await supabase.from('orders').update({ status: 'TRACKING_UPDATED', updated_at: new Date().toISOString() }).eq('id', order.id);
              continue;
            }

            await axios.post(
              `https://${shopStoreForSync.shop_domain}/admin/api/2025-01/fulfillments.json`,
              {
                fulfillment: {
                  line_items_by_fulfillment_order: [{ fulfillment_order_id: openFO.id }],
                  tracking_info: { number: order.tracking_number, company: order.carrier || 'Amazon' },
                  notify_customer: true,
                },
              },
              { headers: { 'X-Shopify-Access-Token': shopStoreForSync.access_token, 'Content-Type': 'application/json' } }
            );

            await supabase.from('orders').update({ status: 'TRACKING_UPDATED', updated_at: new Date().toISOString() }).eq('id', order.id);
            await supabase.from('fulfillment_logs').insert({
              order_id: order.id,
              event: 'SHOPIFY_SYNCED',
              message: `[自動] Shopifyに配送情報反映: ${order.tracking_number} (${order.carrier || 'Amazon'})`,
            });
            shopifySynced++;
          } catch (err) {
            console.error(`[cron/sync] Shopify sync error for ${order.id}:`, err.message);
          }
        }
      }
      results.shopifySync = { synced: shopifySynced, total: shippedOrders?.length || 0 };
      console.log(`[cron/sync] Shopify sync: ${shopifySynced} orders`);
    } catch (err) {
      console.error('[cron/sync] Shopify sync error:', err.message);
      results.shopifySync = { error: err.message };
    }

  } catch (err) {
    console.error('[cron/sync] error:', err.message);
    return res.status(500).json({ error: err.message, partial: results });
  }

  return res.json({ ok: true, results });
});

module.exports = router;
module.exports.getAccessToken = getAccessToken;

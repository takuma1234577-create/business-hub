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

module.exports = router;

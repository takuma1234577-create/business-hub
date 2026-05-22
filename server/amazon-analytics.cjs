const express = require('express');
const { getSupabase } = require('./shared.cjs');
const supabase = new Proxy({}, { get: (_, prop) => getSupabase()[prop] });
const axios = require('axios');
const router = express.Router();

// ---------------------------------------------------------------------------
// Amazon SP-API auth (shared pattern with amazon.cjs)
// ---------------------------------------------------------------------------
const TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

let cachedToken = null;
let tokenExpiresAt = 0;
let cachedEndpoint = null;
let cachedRefreshToken = null;

async function getSpAccount() {
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

  if (process.env.AMAZON_SP_REFRESH_TOKEN) {
    return {
      refreshToken: process.env.AMAZON_SP_REFRESH_TOKEN,
      clientId: process.env.AMAZON_SP_CLIENT_ID,
      clientSecret: process.env.AMAZON_SP_CLIENT_SECRET,
      endpoint: process.env.AMAZON_SP_ENDPOINT || 'https://sellingpartnerapi-fe.amazon.com',
      marketplaceId: process.env.AMAZON_SP_MARKETPLACE_ID || 'A1VC38T7YXB528',
    };
  }

  throw new Error('Amazon SP-APIアカウントが設定されていません。');
}

async function getAccessToken() {
  const account = await getSpAccount();

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
// Helper: SP-API call
// ---------------------------------------------------------------------------
async function spApiCall(method, path, data = null) {
  const { token, endpoint, marketplaceId } = await getAccessToken();
  const url = `${endpoint}${path}`;
  const config = {
    method,
    url,
    headers: {
      'x-amz-access-token': token,
      'Content-Type': 'application/json',
    },
    params: {},
  };
  if (data) config.data = data;
  return axios(config);
}

// ---------------------------------------------------------------------------
// GET /orders - Fetch orders eligible for review requests
// Returns orders delivered 5-30 days ago that haven't been solicited yet
// ---------------------------------------------------------------------------
router.get('/orders', async (req, res) => {
  try {
    const { page = '1', pageSize = '20', filter = 'eligible' } = req.query;
    const currentPage = Math.max(1, parseInt(page, 10) || 1);
    const size = Math.max(1, Math.min(100, parseInt(pageSize, 10) || 20));

    const { token, endpoint, marketplaceId } = await getAccessToken();

    // Calculate date range: orders from 5-30 days ago (eligible window for review requests)
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const fiveDaysAgo = new Date(now);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    // Fetch orders from SP-API
    const ordersResponse = await axios.get(
      `${endpoint}/orders/v0/orders`,
      {
        headers: { 'x-amz-access-token': token },
        params: {
          MarketplaceIds: marketplaceId,
          CreatedAfter: thirtyDaysAgo.toISOString(),
          CreatedBefore: fiveDaysAgo.toISOString(),
          OrderStatuses: 'Shipped',
          MaxResultsPerPage: 100,
        },
      }
    );

    const allOrders = ordersResponse.data?.payload?.Orders || [];

    // Get already-solicited order IDs from DB
    const orderIds = allOrders.map(o => o.AmazonOrderId);
    const { data: solicited } = await supabase
      .from('amazon_review_solicitations')
      .select('amazon_order_id, status, sent_at')
      .in('amazon_order_id', orderIds.length > 0 ? orderIds : ['__none__']);

    const solicitedMap = {};
    for (const s of (solicited || [])) {
      solicitedMap[s.amazon_order_id] = s;
    }

    // Check SP-API solicitation eligibility for orders not yet in our DB
    // GET /solicitations/v1/orders/{orderId} returns available actions
    // If productReviewAndSellerFeedback is missing → already sent externally
    const unknownOrderIds = orderIds.filter(id => !solicitedMap[id]);
    const newlySent = [];

    // Check in batches of 5 with 200ms delay to respect rate limits
    for (let i = 0; i < unknownOrderIds.length; i += 5) {
      const batch = unknownOrderIds.slice(i, i + 5);
      const results = await Promise.allSettled(
        batch.map(orderId =>
          axios.get(
            `${endpoint}/solicitations/v1/orders/${orderId}`,
            {
              headers: { 'x-amz-access-token': token },
              params: { marketplaceIds: marketplaceId },
            }
          ).then(r => ({ orderId, data: r.data }))
           .catch(err => ({ orderId, error: err.response?.status }))
        )
      );

      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        const { orderId, data, error } = result.value;

        // If 404 or no productReviewAndSellerFeedback link → already solicited
        let alreadySent = false;
        if (error === 404) {
          alreadySent = true;
        } else if (data) {
          const links = data?.payload?._links || data?._links || {};
          const actions = Object.keys(links);
          // If the only link is 'self' or there's no productReviewAndSellerFeedback action
          const hasReviewAction = actions.some(a =>
            a.toLowerCase().includes('productreview') || a.toLowerCase().includes('sellerFeedback')
          );
          if (!hasReviewAction) {
            alreadySent = true;
          }
        }

        if (alreadySent) {
          solicitedMap[orderId] = { status: 'sent', sent_at: null };
          newlySent.push(orderId);
        }
      }

      if (i + 5 < unknownOrderIds.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    // Persist newly discovered solicitations to DB
    if (newlySent.length > 0) {
      await supabase
        .from('amazon_review_solicitations')
        .upsert(
          newlySent.map(id => ({
            amazon_order_id: id,
            status: 'sent',
            source: 'detected',
            sent_at: new Date().toISOString(),
          })),
          { onConflict: 'amazon_order_id' }
        );
    }

    // Map and enrich orders
    let orders = allOrders.map(o => ({
      amazonOrderId: o.AmazonOrderId,
      purchaseDate: o.PurchaseDate,
      orderStatus: o.OrderStatus,
      orderTotal: o.OrderTotal ? {
        amount: o.OrderTotal.Amount,
        currency: o.OrderTotal.CurrencyCode,
      } : null,
      buyerEmail: o.BuyerInfo?.BuyerEmail || null,
      shippingAddress: o.ShippingAddress ? {
        name: o.ShippingAddress.Name,
        city: o.ShippingAddress.City,
        stateOrRegion: o.ShippingAddress.StateOrRegion,
        postalCode: o.ShippingAddress.PostalCode,
      } : null,
      numberOfItemsShipped: o.NumberOfItemsShipped || 0,
      solicitationStatus: solicitedMap[o.AmazonOrderId]?.status || null,
      solicitedAt: solicitedMap[o.AmazonOrderId]?.sent_at || null,
    }));

    // Apply filter
    if (filter === 'eligible') {
      orders = orders.filter(o => !o.solicitationStatus);
    } else if (filter === 'sent') {
      orders = orders.filter(o => o.solicitationStatus === 'sent');
    }

    // Paginate
    const total = orders.length;
    const start = (currentPage - 1) * size;
    const paged = orders.slice(start, start + size);

    res.json({
      data: paged,
      pagination: {
        page: currentPage,
        pageSize: size,
        total,
        totalPages: Math.ceil(total / size),
      },
    });
  } catch (err) {
    console.error('[amazon-analytics] orders error:', err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /solicitations/send - Send review request for a single order
// ---------------------------------------------------------------------------
router.post('/solicitations/send', async (req, res) => {
  try {
    const { amazonOrderId } = req.body;
    if (!amazonOrderId) {
      return res.status(400).json({ error: 'amazonOrderId is required' });
    }

    const { token, endpoint, marketplaceId } = await getAccessToken();

    // Check if already solicited
    const { data: existing } = await supabase
      .from('amazon_review_solicitations')
      .select('id')
      .eq('amazon_order_id', amazonOrderId)
      .eq('status', 'sent')
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: 'このオーダーは既にレビューリクエスト送信済みです。' });
    }

    // Send solicitation via SP-API
    await axios.post(
      `${endpoint}/solicitations/v1/orders/${amazonOrderId}/solicitations/productReviewAndSellerFeedback`,
      null,
      {
        headers: { 'x-amz-access-token': token },
        params: { marketplaceIds: marketplaceId },
      }
    );

    // Record in DB
    await supabase
      .from('amazon_review_solicitations')
      .upsert({
        amazon_order_id: amazonOrderId,
        status: 'sent',
        sent_at: new Date().toISOString(),
      }, { onConflict: 'amazon_order_id' });

    res.json({ success: true, amazonOrderId });
  } catch (err) {
    const errorMessage = err.response?.data?.errors?.[0]?.message || err.message;
    const errorCode = err.response?.data?.errors?.[0]?.code || '';
    const httpStatus = err.response?.status;
    console.error('[amazon-analytics] solicitation send error:', errorMessage);

    // 403/409 or "already requested" → treat as already sent
    const alreadySent = httpStatus === 403 || httpStatus === 409
      || errorCode === 'InvalidInput'
      || /already|previously|solicitation.*exist/i.test(errorMessage);

    if (alreadySent) {
      await supabase
        .from('amazon_review_solicitations')
        .upsert({
          amazon_order_id: req.body.amazonOrderId,
          status: 'sent',
          source: 'detected',
          sent_at: new Date().toISOString(),
        }, { onConflict: 'amazon_order_id' });

      return res.json({ success: true, amazonOrderId: req.body.amazonOrderId, alreadySent: true });
    }

    // Record failure
    await supabase
      .from('amazon_review_solicitations')
      .upsert({
        amazon_order_id: req.body.amazonOrderId,
        status: 'failed',
        error_message: errorMessage,
        sent_at: new Date().toISOString(),
      }, { onConflict: 'amazon_order_id' });

    res.status(500).json({ error: errorMessage });
  }
});

// ---------------------------------------------------------------------------
// POST /solicitations/send-bulk - Send review requests for multiple orders
// ---------------------------------------------------------------------------
router.post('/solicitations/send-bulk', async (req, res) => {
  try {
    const { amazonOrderIds } = req.body;
    if (!Array.isArray(amazonOrderIds) || amazonOrderIds.length === 0) {
      return res.status(400).json({ error: 'amazonOrderIds array is required' });
    }

    const { token, endpoint, marketplaceId } = await getAccessToken();

    // Check already solicited
    const { data: existing } = await supabase
      .from('amazon_review_solicitations')
      .select('amazon_order_id')
      .in('amazon_order_id', amazonOrderIds)
      .eq('status', 'sent');

    const alreadySent = new Set((existing || []).map(e => e.amazon_order_id));
    const toSend = amazonOrderIds.filter(id => !alreadySent.has(id));

    const results = { sent: [], failed: [], skipped: [...alreadySent] };

    // Send with rate limiting (1 req/sec to stay within SP-API limits)
    for (const orderId of toSend) {
      try {
        await axios.post(
          `${endpoint}/solicitations/v1/orders/${orderId}/solicitations/productReviewAndSellerFeedback`,
          null,
          {
            headers: { 'x-amz-access-token': token },
            params: { marketplaceIds: marketplaceId },
          }
        );

        await supabase
          .from('amazon_review_solicitations')
          .upsert({
            amazon_order_id: orderId,
            status: 'sent',
            sent_at: new Date().toISOString(),
          }, { onConflict: 'amazon_order_id' });

        results.sent.push(orderId);
      } catch (err) {
        const msg = err.response?.data?.errors?.[0]?.message || err.message;
        const errCode = err.response?.data?.errors?.[0]?.code || '';
        const httpStatus = err.response?.status;

        // Already sent externally → record as sent
        const wasAlreadySent = httpStatus === 403 || httpStatus === 409
          || errCode === 'InvalidInput'
          || /already|previously|solicitation.*exist/i.test(msg);

        if (wasAlreadySent) {
          await supabase
            .from('amazon_review_solicitations')
            .upsert({
              amazon_order_id: orderId,
              status: 'sent',
              source: 'detected',
              sent_at: new Date().toISOString(),
            }, { onConflict: 'amazon_order_id' });

          results.sent.push(orderId);
        } else {
          await supabase
            .from('amazon_review_solicitations')
            .upsert({
              amazon_order_id: orderId,
              status: 'failed',
              error_message: msg,
              sent_at: new Date().toISOString(),
            }, { onConflict: 'amazon_order_id' });

          results.failed.push({ orderId, error: msg });
        }
      }

      // Rate limit: wait 1 second between requests
      if (toSend.indexOf(orderId) < toSend.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    res.json(results);
  } catch (err) {
    console.error('[amazon-analytics] bulk solicitation error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /solicitations/history - Get solicitation history
// ---------------------------------------------------------------------------
router.get('/solicitations/history', async (req, res) => {
  try {
    const { page = '1', pageSize = '50', status } = req.query;
    const currentPage = Math.max(1, parseInt(page, 10) || 1);
    const size = Math.max(1, Math.min(100, parseInt(pageSize, 10) || 50));
    const from = (currentPage - 1) * size;
    const to = from + size - 1;

    let query = supabase
      .from('amazon_review_solicitations')
      .select('*', { count: 'exact' })
      .order('sent_at', { ascending: false })
      .range(from, to);

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error, count } = await query;

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({
      data: (data || []).map(row => ({
        id: row.id,
        amazonOrderId: row.amazon_order_id,
        status: row.status,
        sentAt: row.sent_at,
        errorMessage: row.error_message,
      })),
      pagination: {
        page: currentPage,
        pageSize: size,
        total: count,
        totalPages: Math.ceil((count || 0) / size),
      },
    });
  } catch (err) {
    console.error('[amazon-analytics] history error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /solicitations/stats - Dashboard stats
// ---------------------------------------------------------------------------
router.get('/solicitations/stats', async (req, res) => {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [sentResult, failedResult, todayResult] = await Promise.all([
      supabase
        .from('amazon_review_solicitations')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'sent')
        .gte('sent_at', thirtyDaysAgo.toISOString()),
      supabase
        .from('amazon_review_solicitations')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'failed')
        .gte('sent_at', thirtyDaysAgo.toISOString()),
      supabase
        .from('amazon_review_solicitations')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'sent')
        .gte('sent_at', new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()),
    ]);

    res.json({
      last30Days: {
        sent: sentResult.count || 0,
        failed: failedResult.count || 0,
      },
      today: {
        sent: todayResult.count || 0,
      },
    });
  } catch (err) {
    console.error('[amazon-analytics] stats error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /solicitations/auto-config - Update auto-send settings
// ---------------------------------------------------------------------------
router.get('/solicitations/auto-config', async (req, res) => {
  try {
    const { data } = await supabase
      .from('amazon_analytics_settings')
      .select('*')
      .eq('key', 'review_auto_send')
      .maybeSingle();

    res.json(data?.value || { enabled: false, delayDays: 7, maxPerDay: 50 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/solicitations/auto-config', async (req, res) => {
  try {
    const { enabled, delayDays, maxPerDay } = req.body;
    const value = {
      enabled: !!enabled,
      delayDays: Math.max(5, Math.min(30, parseInt(delayDays, 10) || 7)),
      maxPerDay: Math.max(1, Math.min(200, parseInt(maxPerDay, 10) || 50)),
    };

    await supabase
      .from('amazon_analytics_settings')
      .upsert({ key: 'review_auto_send', value }, { onConflict: 'key' });

    res.json(value);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /cron/review-solicitations - Cron: auto-send review requests
// ---------------------------------------------------------------------------
router.get('/cron/review-solicitations', async (req, res) => {
  try {
    // Check if auto-send is enabled
    const { data: config } = await supabase
      .from('amazon_analytics_settings')
      .select('value')
      .eq('key', 'review_auto_send')
      .maybeSingle();

    const settings = config?.value || { enabled: false };
    if (!settings.enabled) {
      return res.json({ skipped: true, reason: 'Auto-send is disabled' });
    }

    const delayDays = settings.delayDays || 7;
    const maxPerDay = settings.maxPerDay || 50;

    // Check how many already sent today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const { count: sentToday } = await supabase
      .from('amazon_review_solicitations')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'sent')
      .gte('sent_at', todayStart.toISOString());

    const remaining = maxPerDay - (sentToday || 0);
    if (remaining <= 0) {
      return res.json({ skipped: true, reason: 'Daily limit reached', sentToday });
    }

    // Fetch eligible orders
    const { token, endpoint, marketplaceId } = await getAccessToken();
    const now = new Date();
    const targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() - delayDays);
    const rangeEnd = new Date(targetDate);
    rangeEnd.setDate(rangeEnd.getDate() + 1);

    const ordersResponse = await axios.get(
      `${endpoint}/orders/v0/orders`,
      {
        headers: { 'x-amz-access-token': token },
        params: {
          MarketplaceIds: marketplaceId,
          CreatedAfter: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
          CreatedBefore: targetDate.toISOString(),
          OrderStatuses: 'Shipped',
          MaxResultsPerPage: 100,
        },
      }
    );

    const allOrders = ordersResponse.data?.payload?.Orders || [];
    const orderIds = allOrders.map(o => o.AmazonOrderId);

    // Exclude already solicited
    const { data: alreadySolicited } = await supabase
      .from('amazon_review_solicitations')
      .select('amazon_order_id')
      .in('amazon_order_id', orderIds.length > 0 ? orderIds : ['__none__']);

    const solicitedSet = new Set((alreadySolicited || []).map(s => s.amazon_order_id));
    const eligible = orderIds.filter(id => !solicitedSet.has(id)).slice(0, remaining);

    const results = { sent: 0, failed: 0, total: eligible.length };

    for (const orderId of eligible) {
      try {
        await axios.post(
          `${endpoint}/solicitations/v1/orders/${orderId}/solicitations/productReviewAndSellerFeedback`,
          null,
          {
            headers: { 'x-amz-access-token': token },
            params: { marketplaceIds: marketplaceId },
          }
        );

        await supabase
          .from('amazon_review_solicitations')
          .upsert({
            amazon_order_id: orderId,
            status: 'sent',
            sent_at: new Date().toISOString(),
            source: 'auto',
          }, { onConflict: 'amazon_order_id' });

        results.sent++;
      } catch (err) {
        const msg = err.response?.data?.errors?.[0]?.message || err.message;
        await supabase
          .from('amazon_review_solicitations')
          .upsert({
            amazon_order_id: orderId,
            status: 'failed',
            error_message: msg,
            sent_at: new Date().toISOString(),
            source: 'auto',
          }, { onConflict: 'amazon_order_id' });

        results.failed++;
      }

      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    res.json(results);
  } catch (err) {
    console.error('[amazon-analytics] cron error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

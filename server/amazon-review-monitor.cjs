const express = require('express');
const { getSupabase } = require('./shared.cjs');
const supabase = new Proxy({}, { get: (_, prop) => getSupabase()[prop] });
const axios = require('axios');
const router = express.Router();

// ---------------------------------------------------------------------------
// Amazon SP-API auth
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
// SP-API helper
// ---------------------------------------------------------------------------
async function spApi(method, path, params = {}, data = null) {
  const { token, endpoint, marketplaceId } = await getAccessToken();
  const config = {
    method,
    url: `${endpoint}${path}`,
    headers: { 'x-amz-access-token': token, 'Content-Type': 'application/json' },
    params: { ...params, marketplaceIds: params.marketplaceIds || marketplaceId },
  };
  if (data) config.data = data;
  return axios(config);
}

// ===================================================================
// PRODUCTS - 監視対象商品管理
// ===================================================================

// GET /products
router.get('/products', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('amazon_review_products')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });

    // Get outreach counts per ASIN
    const asins = (data || []).map(p => p.asin);
    const { data: outreachData } = await supabase
      .from('amazon_buyer_outreach')
      .select('asin, outreach_status')
      .in('asin', asins.length > 0 ? asins : ['__none__']);

    const outreachMap = {};
    for (const o of (outreachData || [])) {
      if (!outreachMap[o.asin]) outreachMap[o.asin] = { pending: 0, sent: 0, resolved: 0 };
      if (outreachMap[o.asin][o.outreach_status] !== undefined) {
        outreachMap[o.asin][o.outreach_status]++;
      }
    }

    res.json((data || []).map(p => ({
      id: p.id,
      asin: p.asin,
      title: p.title,
      imageUrl: p.image_url,
      isActive: p.is_active,
      averageRating: p.average_rating ? parseFloat(p.average_rating) : null,
      ratingCount: p.rating_count || 0,
      previousRating: p.previous_rating ? parseFloat(p.previous_rating) : null,
      previousCount: p.previous_count || 0,
      lastCheckedAt: p.last_checked_at,
      createdAt: p.created_at,
      outreach: outreachMap[p.asin] || { pending: 0, sent: 0, resolved: 0 },
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /products - ASIN登録（SP-API Catalog Items APIで商品情報取得）
router.post('/products', async (req, res) => {
  try {
    const { asin } = req.body;
    if (!asin || !/^[A-Z0-9]{10}$/.test(asin.toUpperCase())) {
      return res.status(400).json({ error: '有効なASINを入力してください（10文字の英数字）' });
    }
    const upperAsin = asin.toUpperCase();

    let title = null;
    let imageUrl = null;

    // SP-API Catalog Items
    try {
      const catalogRes = await spApi('GET', `/catalog/2022-04-01/items/${upperAsin}`, {
        includedData: 'summaries,images',
      });
      const item = catalogRes.data;
      title = item?.summaries?.[0]?.itemName || null;
      imageUrl = item?.images?.[0]?.images?.[0]?.link || null;
    } catch (e) {
      console.log('[review-monitor] Catalog API fallback for', upperAsin, e.message);
    }

    const { data, error } = await supabase
      .from('amazon_review_products')
      .upsert({
        asin: upperAsin,
        title: title || `ASIN: ${upperAsin}`,
        image_url: imageUrl,
        is_active: true,
      }, { onConflict: 'asin' })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    // 初回登録時に注文スキャンを実行
    try {
      await scanOrdersForAsin(upperAsin);
    } catch (e) {
      console.log('[review-monitor] Initial order scan failed:', e.message);
    }

    res.json({
      id: data.id,
      asin: data.asin,
      title: data.title,
      imageUrl: data.image_url,
      isActive: data.is_active,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /products/:asin
router.delete('/products/:asin', async (req, res) => {
  try {
    await supabase.from('amazon_review_products').delete().eq('asin', req.params.asin);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /products/:asin/scan - 手動で注文スキャン
router.post('/products/:asin/scan', async (req, res) => {
  try {
    const result = await scanOrdersForAsin(req.params.asin);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================================================================
// ORDERS SCAN - SP-APIから注文を取得してoutreachテーブルに登録
// ===================================================================
async function scanOrdersForAsin(asin) {
  const { token, endpoint, marketplaceId } = await getAccessToken();

  // 過去60日の出荷済み注文を取得
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

  const ordersRes = await axios.get(`${endpoint}/orders/v0/orders`, {
    headers: { 'x-amz-access-token': token },
    params: {
      MarketplaceIds: marketplaceId,
      CreatedAfter: sixtyDaysAgo,
      OrderStatuses: 'Shipped',
      MaxResultsPerPage: 100,
    },
  });

  const allOrders = ordersRes.data?.payload?.Orders || [];
  let matchedOrders = [];

  // 各注文のアイテムを確認して該当ASINを含む注文を抽出
  for (const order of allOrders) {
    try {
      const itemsRes = await axios.get(
        `${endpoint}/orders/v0/orders/${order.AmazonOrderId}/orderItems`,
        { headers: { 'x-amz-access-token': token } }
      );
      const items = itemsRes.data?.payload?.OrderItems || [];
      const hasAsin = items.some(item => item.ASIN === asin);
      if (hasAsin) {
        matchedOrders.push({
          amazonOrderId: order.AmazonOrderId,
          buyerName: order.ShippingAddress?.Name || order.BuyerInfo?.BuyerName || null,
          orderDate: order.PurchaseDate,
        });
      }
      // レート制限
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.log(`[review-monitor] Failed to get items for ${order.AmazonOrderId}:`, e.message);
    }
  }

  // 既に登録済みの注文を除外
  const orderIds = matchedOrders.map(o => o.amazonOrderId);
  const { data: existing } = await supabase
    .from('amazon_buyer_outreach')
    .select('amazon_order_id')
    .in('amazon_order_id', orderIds.length > 0 ? orderIds : ['__none__']);
  const existingSet = new Set((existing || []).map(e => e.amazon_order_id));

  const newOrders = matchedOrders.filter(o => !existingSet.has(o.amazonOrderId));

  if (newOrders.length > 0) {
    await supabase.from('amazon_buyer_outreach').insert(
      newOrders.map(o => ({
        amazon_order_id: o.amazonOrderId,
        asin: asin,
        buyer_name: o.buyerName,
        order_date: o.orderDate,
        outreach_status: 'pending',
      }))
    );
  }

  // last_checked_at更新
  await supabase
    .from('amazon_review_products')
    .update({ last_checked_at: new Date().toISOString() })
    .eq('asin', asin);

  return { asin, scanned: allOrders.length, matched: matchedOrders.length, new: newOrders.length };
}

// ===================================================================
// OUTREACH - 購入者へのフォローアップ管理
// ===================================================================

// GET /outreach - フォローアップ対象注文一覧
router.get('/outreach', async (req, res) => {
  try {
    const { asin, status = 'pending', page = '1', pageSize = '30' } = req.query;
    const currentPage = Math.max(1, parseInt(page, 10) || 1);
    const size = Math.max(1, Math.min(100, parseInt(pageSize, 10) || 30));
    const from = (currentPage - 1) * size;
    const to = from + size - 1;

    let query = supabase
      .from('amazon_buyer_outreach')
      .select('*', { count: 'exact' })
      .order('order_date', { ascending: false })
      .range(from, to);

    if (asin) query = query.eq('asin', asin);
    if (status && status !== 'all') query = query.eq('outreach_status', status);

    const { data, error, count } = await query;
    if (error) return res.status(500).json({ error: error.message });

    res.json({
      data: (data || []).map(o => ({
        id: o.id,
        amazonOrderId: o.amazon_order_id,
        asin: o.asin,
        buyerName: o.buyer_name,
        orderDate: o.order_date,
        deliveryDate: o.delivery_date,
        outreachStatus: o.outreach_status,
        messageSent: o.message_sent,
        sentAt: o.sent_at,
        notes: o.notes,
        createdAt: o.created_at,
      })),
      pagination: {
        page: currentPage,
        pageSize: size,
        total: count,
        totalPages: Math.ceil((count || 0) / size),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /outreach/:id/generate-message - AI でフォローアップメッセージ生成
router.post('/outreach/:id/generate-message', async (req, res) => {
  try {
    const { data: outreach } = await supabase
      .from('amazon_buyer_outreach')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (!outreach) return res.status(404).json({ error: '対象が見つかりません' });

    // 商品情報取得
    const { data: product } = await supabase
      .from('amazon_review_products')
      .select('title')
      .eq('asin', outreach.asin)
      .maybeSingle();

    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic();

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `あなたはAmazon出品者のカスタマーサポート担当です。購入者へのフォローアップメッセージを作成してください。

目的: 商品に不満がないか確認し、問題があれば返金・交換で対応する旨を伝える。
ルール:
- Amazonのポリシーに完全準拠すること
- レビューの依頼や言及は一切しない
- 星の評価への言及は一切しない
- あくまで「商品にご満足いただけているか」の確認のみ
- 問題があれば全額返金または交換で対応すると伝える
- 丁寧だが簡潔な日本語（150文字以内）
- 商品名を自然に含める

商品名: ${product?.title || outreach.asin}
購入者名: ${outreach.buyer_name || 'お客様'}

メッセージ本文のみを出力してください。`,
      }],
    });

    const response = message.content[0]?.text || '';
    res.json({ message: response });
  } catch (err) {
    console.error('[review-monitor] AI message error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /outreach/:id/send - SP-API Messaging でバイヤーにメッセージ送信
router.post('/outreach/:id/send', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'メッセージが必要です' });

    const { data: outreach } = await supabase
      .from('amazon_buyer_outreach')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (!outreach) return res.status(404).json({ error: '対象が見つかりません' });

    const { token, endpoint, marketplaceId } = await getAccessToken();

    // SP-API Messaging: 利用可能なアクションを確認
    let messageSent = false;
    let sendMethod = 'manual';

    try {
      const actionsRes = await axios.get(
        `${endpoint}/messaging/v1/orders/${outreach.amazon_order_id}`,
        {
          headers: { 'x-amz-access-token': token },
          params: { marketplaceIds: marketplaceId },
        }
      );

      const actions = actionsRes.data?.payload?._embedded?.actions || actionsRes.data?._embedded?.actions || [];
      const confirmAction = actions.find(a =>
        a.name === 'confirmOrderDetails' || a.name === 'CreateConfirmOrderDetails'
      );

      if (confirmAction) {
        // SP-API で送信可能
        await axios.post(
          `${endpoint}/messaging/v1/orders/${outreach.amazon_order_id}/messages/confirmOrderDetails`,
          { text: message },
          {
            headers: { 'x-amz-access-token': token },
            params: { marketplaceIds: marketplaceId },
          }
        );
        messageSent = true;
        sendMethod = 'sp-api';
      }
    } catch (e) {
      console.log('[review-monitor] Messaging API check/send failed:', e.response?.data || e.message);
    }

    // DB更新（SP-API送信成否にかかわらず記録）
    await supabase
      .from('amazon_buyer_outreach')
      .update({
        outreach_status: 'sent',
        message_sent: message,
        sent_at: new Date().toISOString(),
        notes: messageSent ? `${sendMethod}で送信成功` : 'Seller Centralから手動送信が必要',
      })
      .eq('id', req.params.id);

    res.json({
      success: true,
      messageSent,
      sendMethod,
      note: messageSent
        ? 'SP-API経由で送信しました'
        : 'SP-APIでの送信ができませんでした。メッセージをコピーしてSeller Centralの購入者メッセージから送信してください。',
    });
  } catch (err) {
    console.error('[review-monitor] outreach send error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /outreach/:id/status - ステータス更新
router.post('/outreach/:id/status', async (req, res) => {
  try {
    const { status, notes } = req.body;
    const update = { outreach_status: status };
    if (notes !== undefined) update.notes = notes;
    if (status === 'sent' && !req.body.keepSentAt) update.sent_at = new Date().toISOString();

    const { error } = await supabase
      .from('amazon_buyer_outreach')
      .update(update)
      .eq('id', req.params.id);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================================================================
// REVIEW SNAPSHOTS - ASIN単位のレビュー指標トラッキング
// ===================================================================

// GET /snapshots/:asin - レビュー指標履歴
router.get('/snapshots/:asin', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('amazon_review_snapshots')
      .select('*')
      .eq('asin', req.params.asin)
      .order('checked_at', { ascending: false })
      .limit(30);

    if (error) return res.status(500).json({ error: error.message });

    res.json((data || []).map(s => ({
      id: s.id,
      asin: s.asin,
      ratingCount: s.rating_count,
      averageRating: s.average_rating ? parseFloat(s.average_rating) : null,
      star1: s.star_1,
      star2: s.star_2,
      star3: s.star_3,
      star4: s.star_4,
      star5: s.star_5,
      checkedAt: s.checked_at,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /products/:asin/check-reviews - SP-APIでレビュー指標を取得・記録
router.post('/products/:asin/check-reviews', async (req, res) => {
  try {
    const result = await checkReviewMetrics(req.params.asin);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function checkReviewMetrics(asin) {
  const { token, endpoint, marketplaceId } = await getAccessToken();

  // SP-API Catalog Items で商品情報取得（summaries には販売ランク等含む）
  let ratingCount = null;
  let averageRating = null;

  try {
    const catalogRes = await axios.get(
      `${endpoint}/catalog/2022-04-01/items/${asin}`,
      {
        headers: { 'x-amz-access-token': token },
        params: {
          marketplaceIds: marketplaceId,
          includedData: 'summaries,attributes',
        },
      }
    );

    const attrs = catalogRes.data?.attributes || {};
    // SP-API attribute keys for review data (may vary)
    if (attrs.customer_reviews_count) {
      ratingCount = parseInt(attrs.customer_reviews_count[0]?.value, 10) || null;
    }
    if (attrs.customer_reviews_rating) {
      averageRating = parseFloat(attrs.customer_reviews_rating[0]?.value) || null;
    }
  } catch (e) {
    console.log('[review-monitor] Catalog attributes fetch:', e.message);
  }

  // 前回のスナップショットと比較
  const { data: prev } = await supabase
    .from('amazon_review_products')
    .select('rating_count, average_rating')
    .eq('asin', asin)
    .maybeSingle();

  const previousCount = prev?.rating_count || 0;
  const previousRating = prev?.average_rating ? parseFloat(prev.average_rating) : null;

  let ratingDropped = false;
  let newReviewsDetected = false;

  if (ratingCount !== null && ratingCount > previousCount) {
    newReviewsDetected = true;
    if (averageRating !== null && previousRating !== null && averageRating < previousRating) {
      ratingDropped = true;
    }
  }

  // スナップショット保存
  if (ratingCount !== null) {
    await supabase.from('amazon_review_snapshots').insert({
      asin,
      rating_count: ratingCount,
      average_rating: averageRating,
    });

    // 商品テーブル更新
    await supabase
      .from('amazon_review_products')
      .update({
        previous_rating: previousRating,
        previous_count: previousCount,
        average_rating: averageRating,
        rating_count: ratingCount,
        last_checked_at: new Date().toISOString(),
      })
      .eq('asin', asin);
  }

  return {
    asin,
    ratingCount,
    averageRating,
    previousCount,
    previousRating,
    newReviewsDetected,
    ratingDropped,
  };
}

// ===================================================================
// STATS
// ===================================================================
router.get('/stats', async (req, res) => {
  try {
    const [products, pendingOutreach, sentOutreach, resolvedOutreach] = await Promise.all([
      supabase.from('amazon_review_products').select('id', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('amazon_buyer_outreach').select('id', { count: 'exact', head: true }).eq('outreach_status', 'pending'),
      supabase.from('amazon_buyer_outreach').select('id', { count: 'exact', head: true }).eq('outreach_status', 'sent'),
      supabase.from('amazon_buyer_outreach').select('id', { count: 'exact', head: true }).eq('outreach_status', 'resolved'),
    ]);

    // 評価が下がった商品数
    const { data: dropped } = await supabase
      .from('amazon_review_products')
      .select('asin')
      .eq('is_active', true)
      .not('previous_rating', 'is', null)
      .not('average_rating', 'is', null);

    const droppedCount = (dropped || []).filter(p =>
      parseFloat(p.average_rating) < parseFloat(p.previous_rating)
    ).length;

    res.json({
      monitoredProducts: products.count || 0,
      pendingOutreach: pendingOutreach.count || 0,
      sentOutreach: sentOutreach.count || 0,
      resolvedOutreach: resolvedOutreach.count || 0,
      ratingDroppedProducts: droppedCount,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================================================================
// CRON - 定期チェック
// ===================================================================
router.get('/cron/check', async (req, res) => {
  try {
    const { data: products } = await supabase
      .from('amazon_review_products')
      .select('asin, title')
      .eq('is_active', true);

    if (!products || products.length === 0) {
      return res.json({ checked: 0 });
    }

    const alerts = [];

    for (const product of products) {
      try {
        // 注文スキャン
        await scanOrdersForAsin(product.asin);

        // レビュー指標チェック
        const metrics = await checkReviewMetrics(product.asin);
        if (metrics.ratingDropped) {
          alerts.push({
            asin: product.asin,
            title: product.title,
            from: metrics.previousRating,
            to: metrics.averageRating,
            countChange: (metrics.ratingCount || 0) - (metrics.previousCount || 0),
          });
        }
      } catch (err) {
        console.error(`[review-monitor] cron error for ${product.asin}:`, err.message);
      }

      // レート制限
      await new Promise(r => setTimeout(r, 2000));
    }

    // LINE通知
    if (alerts.length > 0) {
      try {
        await sendRatingDropAlert(alerts);
      } catch (err) {
        console.error('[review-monitor] alert error:', err.message);
      }
    }

    res.json({ checked: products.length, alerts: alerts.length });
  } catch (err) {
    console.error('[review-monitor] cron error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// LINE通知
async function sendRatingDropAlert(alerts) {
  const { data: tokenRow } = await supabase
    .from('api_keys').select('value').eq('key', 'line_channel_access_token').maybeSingle();
  const { data: adminRow } = await supabase
    .from('api_keys').select('value').eq('key', 'line_admin_user_id').maybeSingle();

  if (!tokenRow?.value || !adminRow?.value) return;

  let msg = '[ Amazon レビュー評価低下アラート ]\n\n';
  for (const a of alerts) {
    msg += `■ ${a.title || a.asin}\n`;
    msg += `  評価: ${a.from} → ${a.to} (${a.countChange > 0 ? '+' : ''}${a.countChange}件)\n\n`;
  }
  msg += 'Business Hubで購入者フォローアップを確認してください。';

  await axios.post('https://api.line.me/v2/bot/message/push', {
    to: adminRow.value,
    messages: [{ type: 'text', text: msg }],
  }, { headers: { Authorization: `Bearer ${tokenRow.value}` } });
}

module.exports = router;

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const router = express.Router();

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_ANON_KEY || ''
  );
}

async function getShopifyStore() {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('channel_stores')
    .select('shop_domain, access_token')
    .eq('channel', 'SHOPIFY')
    .eq('is_active', true)
    .maybeSingle();
  return data;
}

// 集計を更新
async function updateStats(supabase, shopifyProductId) {
  const { data: reviews } = await supabase
    .from('shopify_reviews')
    .select('rating')
    .eq('shopify_product_id', shopifyProductId)
    .eq('status', 'approved');

  if (!reviews || reviews.length === 0) {
    await supabase.from('shopify_review_stats').upsert({
      shopify_product_id: shopifyProductId,
      average_rating: 0, total_count: 0,
      rating_1: 0, rating_2: 0, rating_3: 0, rating_4: 0, rating_5: 0,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'shopify_product_id' });
    return;
  }

  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  for (const r of reviews) {
    counts[r.rating] = (counts[r.rating] || 0) + 1;
    sum += r.rating;
  }

  // 商品名を取得
  const { data: product } = await supabase
    .from('shopify_products')
    .select('title')
    .eq('shopify_product_id', shopifyProductId)
    .maybeSingle();

  await supabase.from('shopify_review_stats').upsert({
    shopify_product_id: shopifyProductId,
    product_title: product?.title || null,
    average_rating: Math.round((sum / reviews.length) * 10) / 10,
    total_count: reviews.length,
    rating_1: counts[1], rating_2: counts[2], rating_3: counts[3],
    rating_4: counts[4], rating_5: counts[5],
    updated_at: new Date().toISOString(),
  }, { onConflict: 'shopify_product_id' });
}

// Shopify metafieldsにレビュー集計を同期
async function syncMetafieldsToShopify(supabase, shopifyProductId) {
  try {
    const store = await getShopifyStore();
    if (!store) return;

    const { data: stats } = await supabase
      .from('shopify_review_stats')
      .select('*')
      .eq('shopify_product_id', shopifyProductId)
      .maybeSingle();

    if (!stats) return;

    await axios.post(
      `https://${store.shop_domain}/admin/api/2024-01/graphql.json`,
      {
        query: `mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message } }
        }`,
        variables: {
          metafields: [
            {
              ownerId: `gid://shopify/Product/${shopifyProductId}`,
              namespace: 'reviews',
              key: 'rating',
              type: 'number_decimal',
              value: String(stats.average_rating),
            },
            {
              ownerId: `gid://shopify/Product/${shopifyProductId}`,
              namespace: 'reviews',
              key: 'count',
              type: 'number_integer',
              value: String(stats.total_count),
            },
          ],
        },
      },
      { headers: { 'X-Shopify-Access-Token': store.access_token, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('syncMetafieldsToShopify error:', err.message);
  }
}

// GET /products - Shopify商品一覧
router.get('/products', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('shopify_products')
      .select('id, shopify_product_id, title, image_url, price, status')
      .eq('status', 'active')
      .order('title');
    if (error) throw error;
    res.json({ products: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== API Routes =====

// GET /reviews - レビュー一覧
router.get('/reviews', async (req, res) => {
  try {
    const { product_id, status, source, page = 1, page_size = 20 } = req.query;
    const supabase = getSupabase();
    let query = supabase
      .from('shopify_reviews')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (product_id) query = query.eq('shopify_product_id', product_id);
    if (status) query = query.eq('status', status);
    if (source) query = query.eq('source', source);

    const offset = (Number(page) - 1) * Number(page_size);
    query = query.range(offset, offset + Number(page_size) - 1);

    const { data, count, error } = await query;
    if (error) throw error;

    res.json({ reviews: data || [], total: count || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /stats - 商品別レビュー集計
router.get('/stats', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('shopify_review_stats')
      .select('*')
      .order('total_count', { ascending: false });

    if (error) throw error;
    res.json({ stats: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /reviews - レビュー追加（手動 or API）
router.post('/reviews', async (req, res) => {
  try {
    const { shopify_product_id, author_name, author_email, rating, title, body, source, source_id, verified_purchase, status } = req.body;
    if (!shopify_product_id || !rating || !body) {
      return res.status(400).json({ error: 'shopify_product_id, rating, body are required' });
    }

    const supabase = getSupabase();

    // 商品情報を取得
    const { data: product } = await supabase
      .from('shopify_products')
      .select('title, handle')
      .eq('shopify_product_id', shopify_product_id)
      .maybeSingle();

    const { data: review, error } = await supabase
      .from('shopify_reviews')
      .insert({
        shopify_product_id,
        product_title: product?.title || null,
        product_handle: product?.handle || null,
        author_name: author_name || '匿名',
        author_email: author_email || null,
        rating,
        title: title || null,
        body,
        source: source || 'manual',
        source_id: source_id || null,
        verified_purchase: verified_purchase || false,
        status: status || 'pending',
      })
      .select()
      .single();

    if (error) throw error;

    // approved なら即集計更新
    if (review.status === 'approved') {
      await updateStats(supabase, shopify_product_id);
      syncMetafieldsToShopify(supabase, shopify_product_id);
    }

    res.json({ review });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /reviews/:id - レビュー更新（承認/却下など）
router.patch('/reviews/:id', async (req, res) => {
  try {
    const supabase = getSupabase();
    const updates = { ...req.body, updated_at: new Date().toISOString() };

    const { data: review, error } = await supabase
      .from('shopify_reviews')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;

    // 集計更新
    await updateStats(supabase, review.shopify_product_id);
    syncMetafieldsToShopify(supabase, review.shopify_product_id);

    res.json({ review });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /reviews/:id
router.delete('/reviews/:id', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data: review } = await supabase
      .from('shopify_reviews')
      .select('shopify_product_id')
      .eq('id', req.params.id)
      .single();

    const { error } = await supabase
      .from('shopify_reviews')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;

    if (review) {
      await updateStats(supabase, review.shopify_product_id);
      syncMetafieldsToShopify(supabase, review.shopify_product_id);
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /reviews/bulk-approve - 一括承認
router.post('/reviews/bulk-approve', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: 'ids required' });

    const supabase = getSupabase();
    const { data: reviews, error } = await supabase
      .from('shopify_reviews')
      .update({ status: 'approved', updated_at: new Date().toISOString() })
      .in('id', ids)
      .select('shopify_product_id');

    if (error) throw error;

    // 関連する全商品の集計を更新
    const productIds = [...new Set((reviews || []).map(r => r.shopify_product_id))];
    for (const pid of productIds) {
      await updateStats(supabase, pid);
      syncMetafieldsToShopify(supabase, pid);
    }

    res.json({ ok: true, count: ids.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /reviews/from-survey - アンケート回答からレビュー自動作成
router.post('/reviews/from-survey', async (req, res) => {
  try {
    const { survey_id, shopify_product_id, author_name, author_email, rating, body, product_title } = req.body;
    if (!shopify_product_id || !rating || !body) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const supabase = getSupabase();

    // 重複チェック
    const { data: existing } = await supabase
      .from('shopify_reviews')
      .select('id')
      .eq('source', 'survey')
      .eq('source_id', survey_id)
      .maybeSingle();

    if (existing) return res.json({ review: existing, alreadyExists: true });

    const { data: product } = await supabase
      .from('shopify_products')
      .select('title, handle')
      .eq('shopify_product_id', shopify_product_id)
      .maybeSingle();

    const { data: review, error } = await supabase
      .from('shopify_reviews')
      .insert({
        shopify_product_id,
        product_title: product?.title || product_title || null,
        product_handle: product?.handle || null,
        author_name: author_name || '購入者',
        author_email: author_email || null,
        rating,
        body,
        source: 'survey',
        source_id: survey_id,
        verified_purchase: true,
        status: 'approved', // アンケート経由は自動承認
      })
      .select()
      .single();

    if (error) throw error;

    await updateStats(supabase, shopify_product_id);
    syncMetafieldsToShopify(supabase, shopify_product_id);

    res.json({ review });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /reviews/from-amazon - Amazonレビューを取り込み
router.post('/reviews/from-amazon', async (req, res) => {
  try {
    const { reviews: amazonReviews, shopify_product_id } = req.body;
    if (!amazonReviews || !Array.isArray(amazonReviews)) {
      return res.status(400).json({ error: 'reviews array required' });
    }

    const supabase = getSupabase();
    let imported = 0;
    let skipped = 0;

    for (const ar of amazonReviews) {
      // 重複チェック
      if (ar.amazon_review_id) {
        const { data: existing } = await supabase
          .from('shopify_reviews')
          .select('id')
          .eq('amazon_review_id', ar.amazon_review_id)
          .maybeSingle();
        if (existing) { skipped++; continue; }
      }

      const { error } = await supabase
        .from('shopify_reviews')
        .insert({
          shopify_product_id: shopify_product_id || ar.shopify_product_id,
          product_title: ar.product_title || null,
          author_name: ar.author_name || 'Amazonカスタマー',
          rating: ar.rating,
          title: ar.title || null,
          body: ar.body,
          source: 'amazon',
          source_id: ar.amazon_review_id || null,
          amazon_review_id: ar.amazon_review_id || null,
          verified_purchase: ar.verified_purchase || false,
          status: 'approved',
          created_at: ar.review_date || new Date().toISOString(),
        });

      if (!error) imported++;
    }

    // 集計更新
    const productIds = [...new Set(amazonReviews.map(r => shopify_product_id || r.shopify_product_id).filter(Boolean))];
    for (const pid of productIds) {
      await updateStats(supabase, pid);
      syncMetafieldsToShopify(supabase, pid);
    }

    res.json({ imported, skipped, total: amazonReviews.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /widget/:product_id - ストアフロント用（認証不要にする場合は別途設定）
router.get('/widget/:product_id', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data: reviews } = await supabase
      .from('shopify_reviews')
      .select('author_name, rating, title, body, verified_purchase, created_at, images')
      .eq('shopify_product_id', req.params.product_id)
      .eq('status', 'approved')
      .order('featured', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(50);

    const { data: stats } = await supabase
      .from('shopify_review_stats')
      .select('*')
      .eq('shopify_product_id', req.params.product_id)
      .maybeSingle();

    res.json({ reviews: reviews || [], stats: stats || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /install-widget - ShopifyストアにScriptTagを自動登録
router.post('/install-widget', async (req, res) => {
  try {
    const store = await getShopifyStore();
    if (!store) return res.status(400).json({ error: 'Shopifyストア未接続' });

    const scriptUrl = 'https://business-hub-beige.vercel.app/api/public/review-widget.js';

    // 既存のScriptTagを確認
    const { data: existing } = await axios.get(
      `https://${store.shop_domain}/admin/api/2024-01/script_tags.json`,
      { headers: { 'X-Shopify-Access-Token': store.access_token } }
    );

    const alreadyInstalled = (existing.script_tags || []).find(s => s.src === scriptUrl);
    if (alreadyInstalled) {
      return res.json({ ok: true, message: '既にインストール済み', script_tag: alreadyInstalled });
    }

    // ScriptTagを作成
    const { data: result } = await axios.post(
      `https://${store.shop_domain}/admin/api/2024-01/script_tags.json`,
      {
        script_tag: {
          event: 'onload',
          src: scriptUrl,
          display_scope: 'online_store',
        },
      },
      { headers: { 'X-Shopify-Access-Token': store.access_token, 'Content-Type': 'application/json' } }
    );

    res.json({ ok: true, message: 'ウィジェットをインストールしました', script_tag: result.script_tag });
  } catch (err) {
    console.error('install-widget error:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.errors || err.message });
  }
});

// DELETE /uninstall-widget - ScriptTagを削除
router.delete('/uninstall-widget', async (req, res) => {
  try {
    const store = await getShopifyStore();
    if (!store) return res.status(400).json({ error: 'Shopifyストア未接続' });

    const scriptUrl = 'https://business-hub-beige.vercel.app/api/public/review-widget.js';

    const { data: existing } = await axios.get(
      `https://${store.shop_domain}/admin/api/2024-01/script_tags.json`,
      { headers: { 'X-Shopify-Access-Token': store.access_token } }
    );

    const tag = (existing.script_tags || []).find(s => s.src === scriptUrl);
    if (!tag) return res.json({ ok: true, message: 'ScriptTagが見つかりません' });

    await axios.delete(
      `https://${store.shop_domain}/admin/api/2024-01/script_tags/${tag.id}.json`,
      { headers: { 'X-Shopify-Access-Token': store.access_token } }
    );

    res.json({ ok: true, message: 'ウィジェットをアンインストールしました' });
  } catch (err) {
    console.error('uninstall-widget error:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.errors || err.message });
  }
});

// GET /widget-status - ScriptTag登録状況を確認
router.get('/widget-status', async (req, res) => {
  try {
    const store = await getShopifyStore();
    if (!store) return res.json({ installed: false, reason: 'Shopifyストア未接続' });

    const scriptUrl = 'https://business-hub-beige.vercel.app/api/public/review-widget.js';

    const { data: existing } = await axios.get(
      `https://${store.shop_domain}/admin/api/2024-01/script_tags.json`,
      { headers: { 'X-Shopify-Access-Token': store.access_token } }
    );

    const tag = (existing.script_tags || []).find(s => s.src === scriptUrl);
    res.json({ installed: !!tag, script_tag: tag || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

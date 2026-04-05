/**
 * Shopify商品ナレッジ同期スクリプト
 *
 * Shopifyストアの全商品を取得し、Voyage AIで埋め込みを生成して
 * knowledge_chunks テーブルに upsert する。
 *
 * 使い方:
 *   node scripts/sync-shopify-knowledge.cjs
 *
 * 必要な環境変数:
 *   SUPABASE_URL, SUPABASE_ANON_KEY
 *   VOYAGE_API_KEY
 *
 * 前提: channel_stores テーブルにShopify連携レコードが存在すること
 */

require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const axios = require('axios');
const path = require('path');
const { getSupabase } = require(path.join(__dirname, '..', 'server', 'shared.cjs'));
const { embedText } = require(path.join(__dirname, '..', 'server', 'fitpeak-rag.cjs'));

// Voyage 無料枠は 3 RPM なので 22秒間隔で1件ずつ処理
const EMBED_INTERVAL_MS = 22_000;
const MAX_RETRIES = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function embedWithRetry(text) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await embedText(text, 'document');
    } catch (err) {
      lastErr = err;
      const is429 = /\b429\b/.test(err.message || '');
      if (!is429 || attempt === MAX_RETRIES) throw err;
      const waitMs = 25_000 * attempt;
      console.log(`    [retry] 429: ${waitMs / 1000}s待機してリトライ (${attempt}/${MAX_RETRIES})`);
      await sleep(waitMs);
    }
  }
  throw lastErr;
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildContent(product, variant) {
  const parts = [];
  parts.push(`商品名: ${product.title}`);
  if (variant.title && variant.title !== 'Default Title') {
    parts.push(`バリエーション: ${variant.title}`);
  }
  if (variant.sku) parts.push(`SKU: ${variant.sku}`);
  if (variant.price) parts.push(`価格: ¥${variant.price}`);
  if (product.vendor) parts.push(`ブランド: ${product.vendor}`);
  if (product.product_type) parts.push(`カテゴリ: ${product.product_type}`);
  if (product.tags) parts.push(`タグ: ${product.tags}`);
  const desc = stripHtml(product.body_html);
  if (desc) parts.push(`説明: ${desc}`);
  return parts.join('\n');
}

async function fetchAllShopifyProducts(store) {
  const products = [];
  let url = `https://${store.shop_domain}/admin/api/2024-01/products.json?limit=250`;
  while (url) {
    const res = await axios.get(url, {
      headers: { 'X-Shopify-Access-Token': store.access_token },
    });
    products.push(...(res.data.products || []));
    const linkHeader = res.headers['link'] || '';
    const next = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
  }
  return products;
}

async function main() {
  const supabase = getSupabase();

  console.log('[sync] Shopifyストアを取得中...');
  const { data: stores, error: storeErr } = await supabase
    .from('channel_stores')
    .select('*')
    .eq('channel', 'SHOPIFY')
    .eq('is_active', true);
  if (storeErr) throw new Error(`channel_stores取得失敗: ${storeErr.message}`);
  if (!stores || stores.length === 0) {
    throw new Error('有効なShopifyストアが見つかりません');
  }

  for (const store of stores) {
    console.log(`[sync] ${store.shop_domain} の商品を取得中...`);
    const products = await fetchAllShopifyProducts(store);
    console.log(`[sync] 商品数: ${products.length}`);

    // variantごとに1チャンク
    const rows = [];
    for (const product of products) {
      const variants = product.variants && product.variants.length > 0
        ? product.variants
        : [{ id: product.id, title: 'Default Title', sku: '', price: null }];
      for (const variant of variants) {
        const sourceId = `shopify:${store.shop_domain}:${product.id}:${variant.id}`;
        const title = variant.title && variant.title !== 'Default Title'
          ? `${product.title} - ${variant.title}`
          : product.title;
        const content = buildContent(product, variant);
        rows.push({
          source: 'shopify',
          source_id: sourceId,
          category: 'product',
          title,
          content,
          metadata: {
            shop_domain: store.shop_domain,
            product_id: String(product.id),
            variant_id: String(variant.id),
            handle: product.handle,
            sku: variant.sku || null,
            price: variant.price || null,
            image_url: product.image?.src || null,
            url: `https://${store.shop_domain}/products/${product.handle}`,
          },
        });
      }
    }

    const estMin = Math.ceil((rows.length * EMBED_INTERVAL_MS) / 60000);
    console.log(`[sync] 埋め込み生成: ${rows.length} 件（逐次・約${estMin}分）`);
    let ok = 0;
    let ng = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const start = Date.now();
      try {
        row.embedding = await embedWithRetry(row.content);
        ok++;
        console.log(`  [${i + 1}/${rows.length}] ok: ${row.title.slice(0, 40)}`);
      } catch (err) {
        console.error(`  [${i + 1}/${rows.length}] fail: ${row.source_id}: ${err.message.slice(0, 120)}`);
        ng++;
      }
      // 最後以外はレート制限のため待機
      if (i < rows.length - 1) {
        const elapsed = Date.now() - start;
        const wait = Math.max(0, EMBED_INTERVAL_MS - elapsed);
        if (wait > 0) await sleep(wait);
      }
    }
    console.log(`[sync] 埋め込み完了 ok=${ok} ng=${ng}`);

    // upsert
    const embeddedRows = rows.filter((r) => Array.isArray(r.embedding));
    console.log(`[sync] upsert: ${embeddedRows.length} 件`);
    // Supabaseのペイロード上限を避けるため分割
    const UPSERT_CHUNK = 50;
    for (let i = 0; i < embeddedRows.length; i += UPSERT_CHUNK) {
      const chunk = embeddedRows.slice(i, i + UPSERT_CHUNK).map((r) => ({
        ...r,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await supabase
        .from('knowledge_chunks')
        .upsert(chunk, { onConflict: 'source,source_id' });
      if (error) {
        console.error(`  [upsert-fail] ${i}-${i + chunk.length}:`, error.message);
      }
    }
    console.log(`[sync] ${store.shop_domain} 完了`);
  }

  console.log('[sync] 全ストア同期完了 ✅');
}

main().catch((err) => {
  console.error('[sync] エラー:', err);
  process.exit(1);
});

/**
 * Amazon商品ナレッジ同期スクリプト（詳細版）
 *
 * SP-API Catalog Items API を使って商品の詳細情報を取得し、
 * タイトル・ブランド・箇条書き特徴・説明文・全画像まで含めて
 * 埋め込みを生成し knowledge_chunks に保存する。
 *
 * 使い方: node scripts/sync-amazon-knowledge.cjs
 *
 * 必要な環境変数:
 *   AMAZON_SP_REFRESH_TOKEN, AMAZON_SP_CLIENT_ID, AMAZON_SP_CLIENT_SECRET
 *   AMAZON_SP_ENDPOINT (optional, default https://sellingpartnerapi-fe.amazon.com)
 *   AMAZON_SP_MARKETPLACE_ID (optional, default A1VC38T7YXB528 = 日本)
 *   SUPABASE_URL, SUPABASE_ANON_KEY
 *   VOYAGE_API_KEY
 */

require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const axios = require('axios');
const path = require('path');
const { getSupabase } = require(path.join(__dirname, '..', 'server', 'shared.cjs'));
const { embedText } = require(path.join(__dirname, '..', 'server', 'fitpeak-rag.cjs'));

const TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const EMBED_INTERVAL_MS = 22_000; // Voyage 無料枠 3RPM
const MAX_RETRIES = 3;
const SP_API_DELAY_MS = 1500; // SP-API のレート制限対策

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Amazon SP-API 認証 ──
async function getSpAccount() {
  const supabase = getSupabase();
  const { data: account } = await supabase
    .from('amazon_sp_accounts')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (account) {
    return {
      refreshToken: account.refresh_token,
      clientId: account.client_id,
      clientSecret: account.client_secret,
      endpoint: account.endpoint || 'https://sellingpartnerapi-fe.amazon.com',
      marketplaceId: account.marketplace_id || 'A1VC38T7YXB528',
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
  throw new Error('Amazon SP-API 認証情報が見つかりません');
}

async function getAccessToken(account) {
  const res = await axios.post(
    TOKEN_URL,
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: account.refreshToken,
      client_id: account.clientId,
      client_secret: account.clientSecret,
    }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );
  return res.data.access_token;
}

// ── Catalog Items API ──
async function fetchCatalogItem(asin, token, account) {
  const url = `${account.endpoint}/catalog/2022-04-01/items/${asin}?marketplaceIds=${account.marketplaceId}&includedData=summaries,attributes,images,productTypes,salesRanks,relationships`;
  const res = await axios.get(url, {
    headers: { 'x-amz-access-token': token, 'Content-Type': 'application/json' },
  });
  return res.data;
}

// ── ナレッジ本文構築 ──
function joinAttr(attr) {
  if (!attr) return '';
  if (Array.isArray(attr)) {
    return attr
      .map((a) => (typeof a === 'object' && a.value !== undefined ? a.value : a))
      .filter(Boolean)
      .join(' / ');
  }
  return String(attr);
}

function isFITPEAKBrand(item) {
  const summary = (item.summaries || [])[0] || {};
  const attrs = item.attributes || {};
  const brand = (summary.brand || joinAttr(attrs.brand) || '').toString();
  const manufacturer = (joinAttr(attrs.manufacturer) || '').toString();
  const title = (summary.itemName || joinAttr(attrs.item_name) || '').toString();
  const haystack = `${brand} ${manufacturer} ${title}`.toLowerCase();
  return haystack.includes('fitpeak');
}

function buildRichContent(asin, item) {
  const summary = (item.summaries || [])[0] || {};
  const attrs = item.attributes || {};
  const images = (item.images || [])[0]?.images || [];
  const salesRanks = (item.salesRanks || [])[0]?.classificationRanks || [];
  const productTypes = (item.productTypes || [])[0]?.productType || '';

  const lines = [];
  const title = summary.itemName || joinAttr(attrs.item_name) || '';
  if (title) lines.push(`商品名: ${title}`);

  const brand = summary.brand || joinAttr(attrs.brand) || '';
  if (brand) lines.push(`ブランド: ${brand}`);

  const manufacturer = joinAttr(attrs.manufacturer);
  if (manufacturer && manufacturer !== brand) lines.push(`メーカー: ${manufacturer}`);

  if (productTypes) lines.push(`商品タイプ: ${productTypes}`);

  const color = summary.color || joinAttr(attrs.color);
  if (color) lines.push(`カラー: ${color}`);
  const size = summary.size || joinAttr(attrs.size);
  if (size) lines.push(`サイズ: ${size}`);
  const style = summary.style || joinAttr(attrs.style);
  if (style) lines.push(`スタイル: ${style}`);
  const material = joinAttr(attrs.material);
  if (material) lines.push(`素材: ${material}`);

  // 箇条書き特徴（bullet points）
  const bullets = Array.isArray(attrs.bullet_point)
    ? attrs.bullet_point
        .map((b) => (typeof b === 'object' ? b.value : b))
        .filter(Boolean)
    : [];
  if (bullets.length > 0) {
    lines.push('\n【商品の特徴】');
    bullets.forEach((b, i) => lines.push(`${i + 1}. ${b}`));
  }

  // 商品説明
  const description = joinAttr(attrs.product_description);
  if (description) {
    lines.push(`\n【商品説明】\n${description}`);
  }

  // 用途・使用シーン
  const targetAudience = joinAttr(attrs.target_audience);
  if (targetAudience) lines.push(`対象: ${targetAudience}`);
  const specialFeature = joinAttr(attrs.special_feature);
  if (specialFeature) lines.push(`特徴: ${specialFeature}`);

  // 寸法・重量
  const itemDimensions = attrs.item_dimensions?.[0];
  if (itemDimensions) {
    const dims = [];
    if (itemDimensions.length) dims.push(`長さ${itemDimensions.length.value}${itemDimensions.length.unit}`);
    if (itemDimensions.width) dims.push(`幅${itemDimensions.width.value}${itemDimensions.width.unit}`);
    if (itemDimensions.height) dims.push(`高さ${itemDimensions.height.value}${itemDimensions.height.unit}`);
    if (dims.length) lines.push(`寸法: ${dims.join(' × ')}`);
  }
  const weight = attrs.item_weight?.[0];
  if (weight?.value) lines.push(`重量: ${weight.value}${weight.unit || ''}`);

  // カテゴリ・ランキング
  if (salesRanks.length > 0) {
    const topRank = salesRanks[0];
    lines.push(`カテゴリ: ${topRank.title} (ランキング ${topRank.rank}位)`);
  }

  lines.push(`ASIN: ${asin}`);
  lines.push(`URL: https://www.amazon.co.jp/dp/${asin}`);
  lines.push(`販売チャネル: Amazon`);

  return {
    title,
    content: lines.join('\n'),
    metadata: {
      asin,
      brand,
      title,
      images: images.slice(0, 5).map((img) => img.link).filter(Boolean),
      main_image: images.find((img) => img.variant === 'MAIN')?.link || images[0]?.link || null,
      product_type: productTypes,
      sales_rank: salesRanks[0] || null,
      url: `https://www.amazon.co.jp/dp/${asin}`,
    },
  };
}

// ── Voyage 埋め込み（リトライ付き） ──
async function embedWithRetry(text) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await embedText(text, 'document');
    } catch (err) {
      lastErr = err;
      if (!/\b429\b/.test(err.message || '') || attempt === MAX_RETRIES) throw err;
      const waitMs = 25_000 * attempt;
      console.log(`    [retry] Voyage 429: ${waitMs / 1000}s待機 (${attempt}/${MAX_RETRIES})`);
      await sleep(waitMs);
    }
  }
  throw lastErr;
}

// ── メイン ──
async function main() {
  const supabase = getSupabase();
  const account = await getSpAccount();
  console.log(`[amazon-sync] SP-API endpoint: ${account.endpoint}`);

  // 対象ASINを取得
  console.log('[amazon-sync] amazon_catalog_cache から対象ASINを取得中...');
  const { data: cacheRows, error } = await supabase
    .from('amazon_catalog_cache')
    .select('asin, item_name')
    .not('item_name', 'is', null);
  if (error) throw new Error(error.message);
  const asins = [...new Set(cacheRows.map((r) => r.asin).filter(Boolean))];
  console.log(`[amazon-sync] 対象ASIN: ${asins.length} 件`);

  // Step 1: SP-APIで詳細情報を取得
  console.log('[amazon-sync] SP-API Catalog Items を取得中...');
  let token = await getAccessToken(account);
  let tokenFetchedAt = Date.now();

  const rows = [];
  let ok = 0;
  let ng = 0;
  for (let i = 0; i < asins.length; i++) {
    const asin = asins[i];
    // トークンは55分ごとに再取得
    if (Date.now() - tokenFetchedAt > 55 * 60 * 1000) {
      token = await getAccessToken(account);
      tokenFetchedAt = Date.now();
    }
    try {
      const item = await fetchCatalogItem(asin, token, account);
      // FITPEAKブランド以外は除外
      if (!isFITPEAKBrand(item)) {
        console.log(`  [sp-api ${i + 1}/${asins.length}] skip (non-FITPEAK): ${asin}`);
        if (i < asins.length - 1) await sleep(SP_API_DELAY_MS);
        continue;
      }
      const rich = buildRichContent(asin, item);
      if (!rich.title) throw new Error('title取得失敗');
      rows.push({
        source: 'amazon',
        source_id: asin,
        category: 'product',
        title: rich.title,
        content: rich.content,
        metadata: rich.metadata,
      });
      ok++;
      console.log(`  [sp-api ${i + 1}/${asins.length}] ok: ${rich.title.slice(0, 50)}`);
    } catch (err) {
      ng++;
      const msg = err.response?.data?.errors?.[0]?.message || err.message;
      console.error(`  [sp-api ${i + 1}/${asins.length}] fail ${asin}: ${msg}`);
    }
    if (i < asins.length - 1) await sleep(SP_API_DELAY_MS);
  }
  console.log(`[amazon-sync] SP-API 完了 ok=${ok} ng=${ng}`);

  // Step 2: Voyageで埋め込み生成
  const estMin = Math.ceil((rows.length * EMBED_INTERVAL_MS) / 60000);
  console.log(`[amazon-sync] 埋め込み生成: ${rows.length} 件（逐次・約${estMin}分）`);
  let embedOk = 0;
  let embedNg = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const start = Date.now();
    try {
      row.embedding = await embedWithRetry(row.content);
      embedOk++;
      console.log(`  [embed ${i + 1}/${rows.length}] ok: ${row.title.slice(0, 50)}`);
    } catch (err) {
      embedNg++;
      console.error(`  [embed ${i + 1}/${rows.length}] fail ${row.source_id}: ${err.message.slice(0, 120)}`);
    }
    if (i < rows.length - 1) {
      const elapsed = Date.now() - start;
      const wait = Math.max(0, EMBED_INTERVAL_MS - elapsed);
      if (wait > 0) await sleep(wait);
    }
  }
  console.log(`[amazon-sync] 埋め込み完了 ok=${embedOk} ng=${embedNg}`);

  // Step 3: upsert
  const embeddedRows = rows.filter((r) => Array.isArray(r.embedding));
  console.log(`[amazon-sync] upsert: ${embeddedRows.length} 件`);
  const CHUNK = 50;
  for (let i = 0; i < embeddedRows.length; i += CHUNK) {
    const chunk = embeddedRows.slice(i, i + CHUNK).map((r) => ({
      ...r,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase
      .from('knowledge_chunks')
      .upsert(chunk, { onConflict: 'source,source_id' });
    if (error) console.error(`  [upsert-fail] ${i}:`, error.message);
  }
  console.log('[amazon-sync] Amazon商品詳細同期完了 ✅');
}

main().catch((err) => {
  console.error('[amazon-sync] エラー:', err);
  process.exit(1);
});

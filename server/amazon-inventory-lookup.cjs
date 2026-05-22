/**
 * Amazon在庫検索モジュール
 *
 * お客様の問い合わせから商品キーワード（色・サイズ・商品名）を抽出し、
 * amazon_catalog_cacheから該当バリエーションを検索、SP-APIで在庫確認。
 * 在庫切れの場合は同じparent_asinの他バリエーションから在庫あり商品を提案。
 */

const axios = require('axios');
const { getSupabase } = require('./shared.cjs');
const { getAccessToken } = require('./amazon.cjs');

const CARD_COLORS = ['ブラック', '黒', 'ピンク', 'イエロー', '黄色', '黄', 'グリーン', '緑', 'ブルー', '青', 'レッド', '赤', 'ホワイト', '白', 'パープル', '紫', 'グレー'];
const NORMALIZE_COLOR = {
  '黒': 'ブラック', '黄色': 'イエロー', '黄': 'イエロー',
  '緑': 'グリーン', '青': 'ブルー', '赤': 'レッド',
  '白': 'ホワイト', '紫': 'パープル',
};

/**
 * メッセージから商品キーワードを抽出
 */
function extractProductKeywords(message) {
  const text = message || '';
  const keywords = { product: null, color: null, size: null };

  // 商品名
  const products = ['リストラップ', 'パワーグリップ', 'トレーニングベルト', 'ベルト', 'ニースリーブ', '可変式ダンベル', 'ダンベル'];
  for (const p of products) {
    if (text.includes(p)) { keywords.product = p; break; }
  }

  // 色
  for (const c of CARD_COLORS) {
    if (text.includes(c)) {
      keywords.color = NORMALIZE_COLOR[c] || c;
      break;
    }
  }

  // サイズ (cm/mm/kg/数字)
  const sizeMatch = text.match(/(\d{1,3})\s*(cm|mm|m|kg)/i);
  if (sizeMatch) keywords.size = sizeMatch[1] + sizeMatch[2].toLowerCase();

  return keywords;
}

/**
 * カタログから商品バリエーションを検索
 */
async function searchCatalog({ product, color, size }) {
  const supabase = getSupabase();
  if (!product) return [];

  let query = supabase.from('amazon_catalog_cache').select('*').ilike('item_name', `%${product}%`);
  const { data } = await query;
  if (!data || data.length === 0) return [];

  // スコアリング
  const scored = data.map(row => {
    let score = 0;
    const name = row.item_name || '';
    const variation = row.variation || '';
    if (color && (name.includes(color) || variation.includes(color))) score += 10;
    if (size && (name.includes(size) || variation.toLowerCase().includes(size))) score += 10;
    return { ...row, score };
  }).sort((a, b) => b.score - a.score);

  return scored;
}

/**
 * SP-APIでASINごとの在庫確認（FBA inventory summaries）
 * 注: カタログキャッシュにはseller_skuがないため、amazon_inventory_cacheがあればそちらから、
 * なければ該当ASINの全バリエーション情報だけ返す（在庫は「不明」扱い）
 */
async function getInventoryByAsins(asins) {
  const supabase = getSupabase();
  if (!asins || asins.length === 0) return {};

  // ローカルキャッシュから
  const { data } = await supabase
    .from('amazon_inventory_cache')
    .select('asin, seller_sku, fulfillable_quantity, total_quantity')
    .in('asin', asins);

  const result = {};
  for (const r of (data || [])) {
    if (!result[r.asin]) result[r.asin] = { fulfillable: 0, total: 0 };
    result[r.asin].fulfillable += r.fulfillable_quantity || 0;
    result[r.asin].total += r.total_quantity || 0;
    result[r.asin].seller_sku = r.seller_sku;
  }

  // SP-APIから直接フェッチ（ローカルキャッシュがない場合のフォールバック）
  const missing = asins.filter(a => !result[a]);
  if (missing.length > 0) {
    try {
      const { token, endpoint, marketplaceId } = await getAccessToken();

      // SP-API FBA inventoryはseller_skuベース。ここではASIN→SKU変換が必要だが
      // カタログにseller_skuがない場合はスキップし、他情報をSP-API catalogsで取得
      const catalogUrl = `${endpoint}/catalog/2022-04-01/items`;
      for (const asin of missing) {
        try {
          const res = await axios.get(`${catalogUrl}/${asin}?marketplaceIds=${marketplaceId}&includedData=summaries,attributes,offers`, {
            headers: { 'x-amz-access-token': token },
          });
          const offers = res.data?.offers || [];
          const hasOffer = offers.length > 0;
          result[asin] = {
            fulfillable: hasOffer ? -1 : 0, // -1 = "has offer" 不明だが購入可能
            total: hasOffer ? -1 : 0,
            has_offer: hasOffer,
          };
        } catch {
          result[asin] = { fulfillable: 0, total: 0, unknown: true };
        }
      }
    } catch {
      for (const asin of missing) result[asin] = { fulfillable: 0, total: 0, unknown: true };
    }
  }

  return result;
}

/**
 * お客様の質問から商品を特定し、在庫状況とおすすめ代替品を返す
 */
async function lookupInventoryFromMessage(message) {
  const keywords = extractProductKeywords(message);
  if (!keywords.product) return null;

  const variants = await searchCatalog(keywords);
  if (variants.length === 0) return null;

  // 最もスコアが高いものがユーザーの指定商品
  const target = variants[0];
  const parentAsin = target.parent_asin;

  // 同じparent_asinの全バリエーション
  const supabase = getSupabase();
  const { data: siblings } = await supabase
    .from('amazon_catalog_cache')
    .select('*')
    .eq('parent_asin', parentAsin);

  const asins = (siblings || []).map(s => s.asin);
  const inventory = await getInventoryByAsins(asins);

  // 各バリエーションに在庫状況を付与
  const variantsWithStock = (siblings || []).map(s => ({
    asin: s.asin,
    variation: s.variation,
    item_name: s.item_name,
    image_url: s.image_url,
    stock: inventory[s.asin] || { fulfillable: 0, unknown: true },
  }));

  // お客様が指定した商品
  const targetVariant = variantsWithStock.find(v => v.asin === target.asin);
  const isTargetInStock = targetVariant && (targetVariant.stock.fulfillable > 0 || targetVariant.stock.fulfillable === -1 || targetVariant.stock.has_offer);

  // 在庫ありの他バリエーション
  const alternatives = variantsWithStock.filter(v =>
    v.asin !== target.asin && (v.stock.fulfillable > 0 || v.stock.has_offer)
  );

  return {
    keywords,
    target: targetVariant,
    isTargetInStock,
    alternatives: alternatives.slice(0, 8),
    allVariants: variantsWithStock,
  };
}

/**
 * プロンプト用の在庫情報を整形
 */
function formatInventoryForPrompt(result) {
  if (!result) return '';

  const lines = [];
  lines.push('## Amazon在庫検索結果');
  lines.push(`お客様がお問い合わせの商品: ${result.target?.variation || result.target?.item_name || '不明'}`);

  if (result.target) {
    const s = result.target.stock;
    if (s.unknown) {
      lines.push(`在庫状態: 確認中（SP-API応答なし）`);
    } else if (s.fulfillable === -1 || s.has_offer) {
      lines.push(`在庫状態: ✅ 購入可能（オファーあり）`);
    } else if (s.fulfillable > 0) {
      lines.push(`在庫状態: ✅ 在庫あり（${s.fulfillable}点）`);
    } else {
      lines.push(`在庫状態: ❌ 在庫切れ`);
    }
  }

  if (!result.isTargetInStock && result.alternatives.length > 0) {
    lines.push('');
    lines.push('### 在庫のある他バリエーション（代替提案）');
    for (const alt of result.alternatives) {
      const q = alt.stock.fulfillable === -1 ? '購入可能' : `${alt.stock.fulfillable}点`;
      lines.push(`- ${alt.variation || '-'}: ${q}`);
    }
  }

  return lines.join('\n');
}

module.exports = {
  extractProductKeywords,
  searchCatalog,
  lookupInventoryFromMessage,
  formatInventoryForPrompt,
};

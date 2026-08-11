/**
 * eBay 無在庫輸出 管理ツール Module（アカウント japan_hikari_store）
 *
 * 無在庫販売の最大リスクは「売れたのに仕入先の在庫が消えていた／値上がりしていた」こと。
 * これが起きるとキャンセル率・未発送率に直撃し、アカウント指標が壊れて事業ごと止まる。
 * このモジュールは10分ごとに仕入先を巡回し、在庫が消えた出品を即座に落とす。
 *
 * 3つの機能:
 *   1. 在庫追従     出品中アイテムの仕入先在庫・価格を巡回 → 消失/利益割れなら取り下げ
 *   2. 受注管理     売れた商品の仕入〜発送の進捗を管理（発送期限アラート付き）
 *   3. 利益ウォッチ 候補商品の国内最安値を監視し、利益が出る状態かを常時再計算
 *
 * 仕入先: ヤフオク / メルカリ / 駿河屋（いずれもログイン不要の公開検索ページ）
 *   - 購入は絶対に自動化しない。人が実行する。
 *   - メルカリは規約上の検知リスクがあるため、巡回間隔を空け同時実行数を絞る。
 *
 * eBay出品の取り下げ:
 *   EBAY_OAUTH_TOKEN が設定されていれば Sell API / Trading API で実際に終了させる。
 *   未設定なら status='end_recommended' に落としてSlack通知（＝人が手で落とす）。
 *   「勝手に終了して困る」ことより「終了せず売れてしまう」ほうが致命的なので既定は自動ON。
 *
 * エンドポイント (/api/ebay):
 *   GET    /settings                  設定取得
 *   PUT    /settings                  設定更新
 *   GET    /listings                  出品一覧（?status=active）
 *   POST   /listings                  出品登録
 *   PUT    /listings/:id              出品更新
 *   DELETE /listings/:id              出品削除
 *   POST   /listings/import           CSV下書き（~/ebay/drafts形式）から一括登録
 *   GET    /listings/:id/sources      仕入先一覧
 *   POST   /listings/:id/sources      仕入先追加
 *   DELETE /sources/:id               仕入先削除
 *   POST   /listings/:id/check        単体で即時巡回
 *   POST   /listings/:id/end          手動で取り下げ
 *   POST   /listings/:id/resume       取り下げ推奨を解除して監視に戻す
 *   GET    /listings/:id/checks       巡回ログ
 *   GET    /orders                    受注一覧
 *   POST   /orders                    受注登録（手動 or webhook）
 *   PUT    /orders/:id                受注更新（仕入進捗）
 *   GET    /watch                     利益ウォッチ一覧
 *   POST   /watch                     候補追加
 *   PUT    /watch/:id                 候補更新
 *   DELETE /watch/:id                 候補削除
 *   POST   /watch/:id/refresh         単体で即時再計算
 *   GET    /stats                     ダッシュボード用サマリ
 *   GET    /cron/stock-check          10分ごと: 在庫追従
 *   GET    /cron/profit-watch         10分ごと: 利益ウォッチ更新
 */

const express = require('express');
const router = express.Router();

const { getSupabase } = require('./shared.cjs');
const { sendSlackAlert } = require('./slack-notify.cjs');

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// eBayカテゴリ別 落札手数料率（references/profit-rules.md と一致させる）
const FVF = {
  'カメラ': 0.0935,
  '家電': 0.0935,
  'ビデオゲーム機': 0.0735,
  '車・バイク': 0.115,
  '楽器': 0.1235,
  'ホビー・ゲーム': 0.1235,
  'トレーディングカード': 0.1235,
  '服・シューズ': 0.1235,
  '釣り具': 0.1325,
  'その他': 0.1325,
};

const DEFAULT_SETTINGS = {
  id: 'default',
  enabled: true,
  auto_end_listing: true,
  margin_floor_pct: 5.0,
  price_jump_pct: 25.0,
  check_interval_min: 10,
  max_checks_per_run: 120,
  usd_jpy: 157.9,
  fx_safety: 0.97,
  variable_fee_pct: 6.35,
  fixed_fee_usd: 0.4,
  duty_us_pct: 15.0,
  ship_dom_jpy: 800,
  pack_jpy: 500,
  ship_tier1_jpy: 2800,
  ship_tier2_jpy: 4500,
  ship_tier3_jpy: 6000,
  ship_tier4_jpy: 7500,
  notify_slack: true,
  use_amazon: false,
};

async function getSettings() {
  const sb = getSupabase();
  const { data } = await sb.from('ebay_settings').select('*').eq('id', 'default').maybeSingle();
  return { ...DEFAULT_SETTINGS, ...(data || {}) };
}

// ── 利益計算 ────────────────────────────────────────────
function shipJpy(s, kg) {
  const w = Number(kg) || 0.5;
  if (w <= 1) return s.ship_tier1_jpy;
  if (w <= 2) return s.ship_tier2_jpy;
  if (w <= 3) return s.ship_tier3_jpy;
  return s.ship_tier4_jpy;
}

/**
 * 1商品の粗利と利益率を返す。
 * priceUsd: eBay売価 / costJpy: 国内仕入値 / category: FVF区分 / kg: 重量
 */
function calcProfit(s, priceUsd, costJpy, category, kg) {
  const rate = Number(s.usd_jpy) * Number(s.fx_safety);
  const fvf = FVF[category] ?? FVF['その他'];
  const P = Number(priceUsd) || 0;

  const revenue = P * rate;
  const fees =
    (P * fvf + Number(s.fixed_fee_usd) + P * (Number(s.variable_fee_pct) / 100) + P * (Number(s.duty_us_pct) / 100)) *
    rate;
  const cost = Number(costJpy || 0) + Number(s.ship_dom_jpy) + Number(s.pack_jpy) + shipJpy(s, kg);

  const profit = revenue - fees - cost;
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
  return { profit_jpy: Math.round(profit), margin_pct: Math.round(margin * 10) / 10, revenue_jpy: Math.round(revenue) };
}

/**
 * 判定。ロングテール戦略（ニッチを数千点出して、たまに大きく取る）に合わせている。
 *
 * 合格ライン(○)は「利益率20% **または** 粗利5,000円」。ANDにすると、
 * 単価が低いが利益率の高い商品と、利益率は並だが1件で大きい商品の
 * どちらも落ちてしまい、ロングテールの母数が作れない。
 *
 * Sold件数の下限は10件ではなく1件。ニッチは90日で1〜4件しか売れないのが
 * 普通で、10件を要求すると競合過密な人気型番しか残らない。そこは日本人
 * セラーの裁定で価格差が既に潰れている（実測で確認済み）。
 * ただし0件＝海外需要が確認できていないので候補にしない。
 */
function verdictOf(margin, profit, soldCount) {
  if (soldCount != null && soldCount < 1) return '✕';
  if (profit <= 0) return '✕';
  if (margin >= 20 && profit >= 5000) return '◎';   // 両方満たす
  if (margin >= 20 || profit >= 5000) return '○';   // 合格ライン
  return '△';
}

// ── 仕入先スクレイパー ──────────────────────────────────
// いずれもログイン不要の公開検索ページのみを読む。購入操作は一切しない。

/**
 * @param {number[]} okStatus 正常扱いにするHTTPステータス。
 *   ヤフオクは検索0件のときに404を返すため、404も本文を読む必要がある。
 *   ここで404を弾くと「在庫が消えた」ことを永久に検知できなくなる。
 */
async function fetchText(url, extraHeaders = {}, okStatus = [200]) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept-Language': 'ja-JP,ja;q=0.9',
      Accept: 'text/html,application/xhtml+xml',
      ...extraHeaders,
    },
    redirect: 'follow',
  });
  if (!res.ok && !okStatus.includes(res.status)) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function excludeMatcher(excludeWords) {
  const base = ['ジャンク', '部品取', '故障', '不動', '通電のみ', '箱のみ', '空箱', '説明書のみ', 'カタログ', 'パンフレット'];
  const extra = (excludeWords || '')
    .split(',')
    .map((w) => w.trim())
    .filter(Boolean);
  const all = [...base, ...extra].map((w) => w.toLowerCase());
  // 「SMC TAKUMAR」「smc Takumar」のような表記揺れを拾えるよう大文字小文字を無視する
  return (text) => { const t = (text || '').toLowerCase(); return all.some((w) => t.includes(w)); };
}

/**
 * 必須キーワード。同一型番かどうかを判定する。
 *
 * 書式: カンマ区切りの各条件を「すべて満たす」(AND)。
 *       1つの条件内で `|` を使うと「どれか1つ」(OR)。
 *   例: "スーパーファミコン|SFC, 本体"
 *       → (スーパーファミコン または SFC) かつ 本体
 *
 * ANDにしている理由: 楽天のあいまい検索は関連商品まで返すため、OR判定だと
 * 「セガサターン 本体」の検索でPlayStation本体(¥1,980)が最安として通り、
 * その値段で利益を再計算して誤った判定を出す。実際に発生した。
 */
function includeMatcher(includeWords) {
  const groups = (includeWords || '')
    .split(',')
    .map((g) => g.split('|').map((w) => w.trim().toLowerCase()).filter(Boolean))
    .filter((g) => g.length);
  if (!groups.length) return () => true;
  return (text) => {
    const t = (text || '').toLowerCase();
    return groups.every((alts) => alts.some((w) => t.includes(w)));
  };
}

/**
 * スクレイパーの返り値の約束事（ここが安全性の要）
 *   ok=true  … ページを正しく読めた。count/min は信頼してよい。
 *              count=0 は「本当に在庫が無い」を意味する。
 *   ok=false … 読めなかった（ブロック・通信断・クライアント描画）。
 *              count=0 でも「在庫なし」と解釈してはいけない。
 *
 * この区別を潰すと、読めなかっただけの出品を「在庫消失」と誤判定して
 * 正常な出品を自動で落としてしまう。
 */

/** ヤフオク: 即決価格のある出品のみを対象にする（無在庫は即決でしか回らない） */
async function scrapeYahoo(keyword, excludeWords, includeWords) {
  const url = `https://auctions.yahoo.co.jp/search/search?p=${encodeURIComponent(keyword)}&n=50`;
  // 0件ヒット時はHTTP 404が返る。在庫消失の検知にはこの本文が必要
  const html = await fetchText(url, {}, [200, 404]);
  const isExcluded = excludeMatcher(excludeWords);
  const isIncluded = includeMatcher(includeWords);

  const blocks = html.split('<li class="Product">').slice(1);
  const isEmptyResult = html.includes('条件に一致する商品は見つかりませんでした');

  // 商品ブロックも「0件」表示も無い＝検索結果ページを取得できていない
  if (!blocks.length && !isEmptyResult) {
    return { source: 'yahoo', ok: false, count: null, min: null, items: [], url, error: 'アクセス制限またはレイアウト変更' };
  }

  const items = [];
  for (const block of blocks) {
    const text = block
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&[a-z]+;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;

    // 「ウォッチ <タイトル> 現在 N円 即決 N円 …」の形
    const m = text.match(/即決\s*([\d,]+)\s*円/);
    if (!m) continue; // 即決なしはオークション。無在庫では使えない
    const titleM = text.match(/ウォッチ\s+(.+?)\s+(?:現在|即決)\s/);
    const title = titleM ? titleM[1] : text.slice(0, 120);
    if (isExcluded(title) || !isIncluded(title)) continue;

    const price = parseInt(m[1].replace(/,/g, ''), 10);
    if (!price || price < 500) continue;
    items.push({ price, title: title.slice(0, 120) });
  }
  items.sort((a, b) => a.price - b.price);
  return {
    source: 'yahoo',
    ok: true,
    count: items.length,
    min: items[0]?.price ?? null,
    median: items.length ? items[Math.floor(items.length / 2)].price : null,
    items: items.slice(0, 5),
    url,
  };
}

/**
 * メルカリ: 検索結果がクライアント描画のため、サーバーからのfetchでは価格を取得できない。
 * 誤って「在庫なし」と判定しないよう、常に ok=false（判定に使わない）を返す。
 * 価格は管理画面の「メルカリを確認」リンクから人が見るか、後日ヘッドレスブラウザを足して対応する。
 */
async function scrapeMercari(keyword) {
  const url = `https://jp.mercari.com/search?keyword=${encodeURIComponent(keyword)}&status=on_sale`;
  return {
    source: 'mercari',
    ok: false,
    count: null,
    min: null,
    items: [],
    url,
    error: 'クライアント描画のためサーバーからは取得不可（手動確認用リンクのみ）',
  };
}

/** 駿河屋: 中古在庫の価格。データセンターからのアクセスは403で弾かれることがある */
async function scrapeSuruga(keyword, excludeWords, includeWords) {
  const url = `https://www.suruga-ya.jp/search?search_word=${encodeURIComponent(keyword)}`;
  const isExcluded = excludeMatcher(excludeWords);
  let html;
  try {
    html = await fetchText(url, { Referer: 'https://www.suruga-ya.jp/' });
  } catch (e) {
    return { source: 'suruga', ok: false, count: null, min: null, items: [], url, error: e.message };
  }
  if (!html.includes('該当件数')) {
    return { source: 'suruga', ok: false, count: null, min: null, items: [], url, error: 'アクセス制限またはレイアウト変更' };
  }
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const items = [];
  for (const m of text.matchAll(/中古[：:]\s*￥([\d,]+)/g)) {
    const p = parseInt(m[1].replace(/,/g, ''), 10);
    if (p >= 500) items.push({ price: p, title: '' });
  }
  const filtered = items.filter((i) => !isExcluded(i.title));
  filtered.sort((a, b) => a.price - b.price);
  return {
    source: 'suruga',
    ok: true,
    count: filtered.length,
    min: filtered[0]?.price ?? null,
    median: filtered.length ? filtered[Math.floor(filtered.length / 2)].price : null,
    items: filtered.slice(0, 5),
    url,
  };
}

/**
 * 楽天市場: 検索結果カードの data-track-price 属性から価格を取る。
 * RAKUTEN_APP_ID があれば公式の楽天市場APIを使う（スクレイピングより安定するため優先）。
 */
async function scrapeRakuten(keyword, excludeWords, includeWords) {
  const isExcluded = excludeMatcher(excludeWords);
  const isIncluded = includeMatcher(includeWords);
  const webUrl = `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(keyword)}/`;

  const appId = process.env.RAKUTEN_APP_ID;
  if (appId) {
    try {
      const api =
        'https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601' +
        `?applicationId=${encodeURIComponent(appId)}&keyword=${encodeURIComponent(keyword)}&hits=30&sort=%2BitemPrice`;
      const res = await fetch(api, { headers: { 'User-Agent': UA } });
      if (res.ok) {
        const json = await res.json();
        const items = (json.Items || [])
          .map((w) => w.Item || w)
          .filter((i) => i.itemName && !isExcluded(i.itemName) && isIncluded(i.itemName))
          .map((i) => ({ price: Number(i.itemPrice), title: String(i.itemName).slice(0, 120) }))
          .filter((i) => i.price >= 500)
          .sort((a, b) => a.price - b.price);
        return {
          source: 'rakuten',
          ok: true,
          count: items.length,
          min: items[0]?.price ?? null,
          median: items.length ? items[Math.floor(items.length / 2)].price : null,
          items: items.slice(0, 5),
          url: webUrl,
        };
      }
    } catch {
      // APIが落ちていたらスクレイピングにフォールバックする
    }
  }

  let html;
  try {
    html = await fetchText(webUrl, { Referer: 'https://www.rakuten.co.jp/' });
  } catch (e) {
    return { source: 'rakuten', ok: false, count: null, min: null, items: [], url: webUrl, error: e.message };
  }

  const cards = html.split('searchresultitem').slice(1);
  const isEmptyResult = /一致する商品は見つかりませんでした|該当する商品がありませんでした/.test(html);
  if (!cards.length && !isEmptyResult) {
    return { source: 'rakuten', ok: false, count: null, min: null, items: [], url: webUrl, error: 'アクセス制限またはレイアウト変更' };
  }

  const items = [];
  for (const card of cards) {
    const pm = card.match(/data-track-price="(\d+)"/);
    if (!pm) continue;
    const price = parseInt(pm[1], 10);
    if (!price || price < 500) continue;

    // 商品名は商品画像の alt 属性に入っている。
    // カード全体をタグ除去するとCSSクラス名を拾ってしまい、絞り込みが効かなくなる。
    const am = card.match(/<img[^>]*\salt="([^"]{4,300})"/);
    if (!am) continue;
    const title = am[1]
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();
    if (isExcluded(title) || !isIncluded(title)) continue;
    items.push({ price, title: title.slice(0, 120) });
  }
  items.sort((a, b) => a.price - b.price);
  return {
    source: 'rakuten',
    ok: true,
    count: items.length,
    min: items[0]?.price ?? null,
    median: items.length ? items[Math.floor(items.length / 2)].price : null,
    items: items.slice(0, 5),
    url: webUrl,
  };
}

/**
 * Amazon.co.jp: 検索ページのスクレイピングは価格を削られた簡易版しか返らず、
 * 規約上も問題があるため行わない。SP-APIのカタログ検索＋オファー取得を使う。
 *
 * 中古の無在庫仕入れが目的なので、既定では中古(Used)のオファーを見る。
 * AMAZON_SP_REFRESH_TOKEN 等が未設定なら ok=false を返して判定から除外する。
 */
async function scrapeAmazon(keyword, excludeWords, includeWords) {
  const webUrl = `https://www.amazon.co.jp/s?k=${encodeURIComponent(keyword)}`;
  if (!process.env.AMAZON_SP_REFRESH_TOKEN) {
    return { source: 'amazon', ok: false, count: null, min: null, items: [], url: webUrl, error: 'SP-API未設定（AMAZON_SP_REFRESH_TOKEN）' };
  }

  const isExcluded = excludeMatcher(excludeWords);
  const isIncluded = includeMatcher(includeWords);

  try {
    const { getAccessToken } = require('./amazon.cjs');
    const { token, endpoint, marketplaceId } = await getAccessToken();
    const h = { 'x-amz-access-token': token, Accept: 'application/json' };

    // 1. キーワードでカタログ検索してASINを得る
    const catUrl =
      `${endpoint}/catalog/2022-04-01/items?marketplaceIds=${marketplaceId}` +
      `&keywords=${encodeURIComponent(keyword)}&includedData=summaries&pageSize=10`;
    const catRes = await fetch(catUrl, { headers: h });
    if (!catRes.ok) {
      return { source: 'amazon', ok: false, count: null, min: null, items: [], url: webUrl, error: `catalog HTTP ${catRes.status}` };
    }
    const cat = await catRes.json();
    const asins = (cat.items || [])
      .map((i) => ({ asin: i.asin, title: i.summaries?.[0]?.itemName || '' }))
      .filter((i) => i.asin && (!i.title || (!isExcluded(i.title) && isIncluded(i.title))))
      .slice(0, 3);

    if (!asins.length) {
      return { source: 'amazon', ok: true, count: 0, min: null, median: null, items: [], url: webUrl };
    }

    // 2. 各ASINの中古オファーの最安値を取る（SP-APIのレート制限が厳しいので直列＋間隔）
    const items = [];
    for (const a of asins) {
      try {
        const offUrl =
          `${endpoint}/products/pricing/v0/items/${a.asin}/offers` +
          `?MarketplaceId=${marketplaceId}&ItemCondition=Used`;
        const offRes = await fetch(offUrl, { headers: h });
        if (!offRes.ok) continue;
        const off = await offRes.json();
        const offers = off.payload?.Offers || [];
        for (const o of offers) {
          const amount = o.ListingPrice?.Amount;
          const ship = o.Shipping?.Amount || 0;
          if (amount) items.push({ price: Math.round(Number(amount) + Number(ship)), title: a.title.slice(0, 120) });
        }
      } catch {
        // 個別ASINの失敗は無視して次へ
      }
      await new Promise((r) => setTimeout(r, 400));
    }

    items.sort((a, b) => a.price - b.price);
    return {
      source: 'amazon',
      ok: true,
      count: items.length,
      min: items[0]?.price ?? null,
      median: items.length ? items[Math.floor(items.length / 2)].price : null,
      items: items.slice(0, 5),
      url: webUrl,
    };
  } catch (e) {
    return { source: 'amazon', ok: false, count: null, min: null, items: [], url: webUrl, error: e.message };
  }
}

const SCRAPERS = {
  yahoo: scrapeYahoo,
  mercari: scrapeMercari,
  suruga: scrapeSuruga,
  rakuten: scrapeRakuten,
  amazon: scrapeAmazon,
};

async function scrapeSource(source, keyword, excludeWords, includeWords) {
  const fn = SCRAPERS[source];
  if (!fn) return { source, ok: false, count: null, min: null, items: [], error: 'unknown source' };
  try {
    return await fn(keyword, excludeWords, includeWords);
  } catch (e) {
    return { source, ok: false, count: null, min: null, items: [], error: e.message };
  }
}

// ── eBay出品の取り下げ ──────────────────────────────────
/**
 * EBAY_OAUTH_TOKEN があれば実際にeBayの出品を終了する。
 * 無ければ false を返し、呼び出し側が end_recommended として人に回す。
 */
async function endEbayListing(itemId) {
  const token = process.env.EBAY_OAUTH_TOKEN;
  if (!token || !itemId) return { ended: false, reason: 'no_credentials' };

  // Trading API: EndFixedPriceItem（無在庫の固定価格出品はこれで終了できる）
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<EndFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${token}</eBayAuthToken></RequesterCredentials>
  <ItemID>${itemId}</ItemID>
  <EndingReason>NotAvailable</EndingReason>
</EndFixedPriceItemRequest>`;

  try {
    const res = await fetch('https://api.ebay.com/ws/api.dll', {
      method: 'POST',
      headers: {
        'X-EBAY-API-SITEID': '0',
        'X-EBAY-API-COMPATIBILITY-LEVEL': '1193',
        'X-EBAY-API-CALL-NAME': 'EndFixedPriceItem',
        'Content-Type': 'text/xml',
      },
      body: xml,
    });
    const body = await res.text();
    const ok = /<Ack>(Success|Warning)<\/Ack>/.test(body);
    const err = (body.match(/<LongMessage>([\s\S]*?)<\/LongMessage>/) || [])[1];
    return { ended: ok, reason: ok ? 'ended' : err || 'ebay_error' };
  } catch (e) {
    return { ended: false, reason: e.message };
  }
}

async function notify(settings, text) {
  if (!settings.notify_slack) return;
  try {
    await sendSlackAlert(text);
  } catch (e) {
    console.error('[ebay] slack notify failed:', e.message);
  }
}

// ── 1出品を巡回して判定する中核 ─────────────────────────
async function checkListing(listing, settings) {
  const sb = getSupabase();
  const { data: sources } = await sb
    .from('ebay_listing_sources')
    .select('*')
    .eq('listing_id', listing.id)
    .eq('enabled', true);

  if (!sources || !sources.length) {
    return { action: 'error', reason: '仕入先が未登録' };
  }

  // 全仕入先を並列で巡回し、最安値を採用する
  const results = await Promise.all(
    sources.map(async (src) => {
      const r = await scrapeSource(src.source, src.search_keyword, src.exclude_words, src.include_words);
      // 読めなかった仕入先は last_available を書き換えない（前回値を保持する）
      const patch = { last_checked_at: new Date().toISOString(), last_error: r.ok ? null : r.error || '取得不可' };
      if (r.ok) {
        patch.last_price_jpy = r.min;
        patch.last_count = r.count;
        patch.last_available = r.min != null;
        // 採用した最安値がどの商品だったかを残す。別商品の混入は画面で気づくしかない
        patch.last_title = r.items?.[0]?.title || null;
      }
      await sb.from('ebay_listing_sources').update(patch).eq('id', src.id);
      return { ...r, src };
    }),
  );

  // 正しく読めた仕入先だけを判定に使う。
  // 読めなかったものを「在庫なし」と数えると、ブロックされただけの出品を落としてしまう。
  const readable = results.filter((r) => r.ok);
  const alive = readable.filter((r) => r.min != null && r.min > 0);
  const totalCount = readable.reduce((a, r) => a + (r.count || 0), 0);

  // ── 判定0: どの仕入先も読めなかった → 判断を保留し、出品はそのまま ──
  if (!readable.length) {
    return {
      action: 'error',
      reason: `全仕入先で取得失敗のため判定できず: ${results.map((r) => `${r.source}=${r.error}`).join(' / ')}`,
    };
  }

  // ── 判定1: 読めた仕入先すべてで在庫が消えた → 即取り下げ ──
  if (!alive.length) {
    return {
      action: 'end',
      available: false,
      min_price_jpy: null,
      total_count: totalCount,
      reason: `在庫なし（確認できた仕入先: ${readable.map((r) => r.source).join(',')}）`,
    };
  }

  const best = alive.reduce((a, b) => (a.min <= b.min ? a : b));
  const { profit_jpy, margin_pct } = calcProfit(
    settings,
    listing.price_usd,
    best.min,
    listing.category,
    listing.weight_kg,
  );

  // ── 判定2: 利益率が下限割れ → 取り下げ ──
  if (margin_pct < Number(settings.margin_floor_pct)) {
    return {
      action: 'end',
      available: true,
      min_price_jpy: best.min,
      source_used: best.source,
      total_count: totalCount,
      margin_pct,
      profit_jpy,
      reason: `仕入値が¥${best.min.toLocaleString()}に上昇し利益率${margin_pct}%（下限${settings.margin_floor_pct}%）を下回った`,
    };
  }

  // ── 判定3: 仕入値が想定から大きく上昇 → 警告のみ ──
  const basis = listing.cost_basis_jpy;
  if (basis && best.min > basis * (1 + Number(settings.price_jump_pct) / 100)) {
    return {
      action: 'warn_price',
      available: true,
      min_price_jpy: best.min,
      source_used: best.source,
      total_count: totalCount,
      margin_pct,
      profit_jpy,
      reason: `仕入値が想定¥${basis.toLocaleString()}→¥${best.min.toLocaleString()}に上昇（+${Math.round(((best.min - basis) / basis) * 100)}%）`,
    };
  }

  return {
    action: 'ok',
    available: true,
    min_price_jpy: best.min,
    source_used: best.source,
    total_count: totalCount,
    margin_pct,
    profit_jpy,
    reason: null,
  };
}

/** 判定結果をDBに反映し、必要ならeBay出品を終了する */
async function applyCheckResult(listing, result, settings) {
  const sb = getSupabase();
  const now = new Date().toISOString();
  let finalAction = result.action;
  let alert = result.reason;

  if (result.action === 'end') {
    if (settings.auto_end_listing && listing.ebay_item_id) {
      const r = await endEbayListing(listing.ebay_item_id);
      if (r.ended) {
        finalAction = 'ended';
        alert = `【自動取り下げ済】${result.reason}`;
      } else {
        finalAction = 'end_recommended';
        alert = `【要手動取り下げ】${result.reason}（eBay API: ${r.reason}）`;
      }
    } else {
      finalAction = 'end_recommended';
      alert = `【要手動取り下げ】${result.reason}`;
    }
  }

  const statusMap = {
    ended: 'ended',
    end_recommended: 'end_recommended',
    warn_price: listing.status,
    ok: listing.status,
    error: listing.status,
  };

  await sb
    .from('ebay_listings')
    .update({
      status: statusMap[finalAction] || listing.status,
      last_margin_pct: result.margin_pct ?? null,
      last_min_price_jpy: result.min_price_jpy ?? null,
      last_checked_at: now,
      alert: finalAction === 'ok' ? null : alert,
      updated_at: now,
    })
    .eq('id', listing.id);

  await sb.from('ebay_stock_checks').insert({
    listing_id: listing.id,
    available: !!result.available,
    min_price_jpy: result.min_price_jpy ?? null,
    source_used: result.source_used ?? null,
    total_count: result.total_count ?? null,
    margin_pct: result.margin_pct ?? null,
    profit_jpy: result.profit_jpy ?? null,
    action: finalAction,
    reason: alert,
  });

  if (finalAction === 'ended' || finalAction === 'end_recommended') {
    const head = finalAction === 'ended' ? ':octagonal_sign: eBay出品を自動取り下げ' : ':warning: eBay出品の取り下げが必要';
    await notify(
      settings,
      `${head}\n${listing.kataban} / ${listing.title_en}\nItemID: ${listing.ebay_item_id || '(未出品)'}\n理由: ${alert}`,
    );
  }

  return finalAction;
}

// ══════════════════════════════════════════════════════
// 設定
// ══════════════════════════════════════════════════════
router.get('/settings', async (_req, res) => {
  try {
    res.json(await getSettings());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/settings', async (req, res) => {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from('ebay_settings')
      .upsert({ ...req.body, id: 'default', updated_at: new Date().toISOString() })
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════
// 出品台帳
// ══════════════════════════════════════════════════════
router.get('/listings', async (req, res) => {
  try {
    const sb = getSupabase();
    let q = sb.from('ebay_listings').select('*').order('updated_at', { ascending: false });
    if (req.query.status) q = q.eq('status', req.query.status);
    const { data, error } = await q;
    if (error) throw error;

    // 仕入先をまとめて添える
    const ids = (data || []).map((d) => d.id);
    let sources = [];
    if (ids.length) {
      const { data: s } = await sb.from('ebay_listing_sources').select('*').in('listing_id', ids);
      sources = s || [];
    }
    res.json(
      (data || []).map((l) => ({ ...l, sources: sources.filter((s) => s.listing_id === l.id) })),
    );
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/listings', async (req, res) => {
  try {
    const sb = getSupabase();
    const { sources, ...listing } = req.body;
    const { data, error } = await sb.from('ebay_listings').insert(listing).select().single();
    if (error) throw error;

    if (Array.isArray(sources) && sources.length) {
      await sb.from('ebay_listing_sources').insert(sources.map((s) => ({ ...s, listing_id: data.id })));
    }
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/listings/:id', async (req, res) => {
  try {
    const sb = getSupabase();
    const { sources, ...patch } = req.body;
    const { data, error } = await sb
      .from('ebay_listings')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/listings/:id', async (req, res) => {
  try {
    const sb = getSupabase();
    const { error } = await sb.from('ebay_listings').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * リサーチCSV（~/ebay/drafts/YYYY-MM-DD_sources.csv）の行を貼り付けて一括登録する。
 * body: { rows: [{ sku, kataban, category, price_usd, weight_kg, cost_basis_jpy, keyword_ja, sources:['yahoo','mercari'] }] }
 */
router.post('/listings/import', async (req, res) => {
  try {
    const sb = getSupabase();
    const rows = req.body.rows || [];
    const created = [];
    for (const r of rows) {
      const { data, error } = await sb
        .from('ebay_listings')
        .insert({
          sku: r.sku,
          kataban: r.kataban,
          title_en: r.title_en || r.kataban,
          category: r.category || 'その他',
          price_usd: r.price_usd,
          weight_kg: r.weight_kg || 0.5,
          cost_basis_jpy: r.cost_basis_jpy || null,
          status: r.status || 'draft',
        })
        .select()
        .single();
      if (error) continue;
      const srcList = r.sources && r.sources.length ? r.sources : ['yahoo', 'mercari'];
      await sb.from('ebay_listing_sources').insert(
        srcList.map((s) => ({
          listing_id: data.id,
          source: s,
          search_keyword: r.keyword_ja || r.kataban,
          exclude_words: r.exclude_words || null,
        })),
      );
      created.push(data);
    }
    res.json({ created: created.length, listings: created });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 仕入先 ──────────────────────────────────────────────
router.get('/listings/:id/sources', async (req, res) => {
  try {
    const sb = getSupabase();
    const { data, error } = await sb.from('ebay_listing_sources').select('*').eq('listing_id', req.params.id);
    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/listings/:id/sources', async (req, res) => {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from('ebay_listing_sources')
      .insert({ ...req.body, listing_id: req.params.id })
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/sources/:id', async (req, res) => {
  try {
    const sb = getSupabase();
    const { error } = await sb.from('ebay_listing_sources').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 即時巡回 / 手動操作 ─────────────────────────────────
router.post('/listings/:id/check', async (req, res) => {
  try {
    const sb = getSupabase();
    const settings = await getSettings();
    const { data: listing } = await sb.from('ebay_listings').select('*').eq('id', req.params.id).single();
    if (!listing) return res.status(404).json({ error: 'not found' });

    const result = await checkListing(listing, settings);
    const action = await applyCheckResult(listing, result, settings);
    res.json({ ...result, action });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/listings/:id/end', async (req, res) => {
  try {
    const sb = getSupabase();
    const { data: listing } = await sb.from('ebay_listings').select('*').eq('id', req.params.id).single();
    if (!listing) return res.status(404).json({ error: 'not found' });

    const r = await endEbayListing(listing.ebay_item_id);
    await sb
      .from('ebay_listings')
      .update({
        status: r.ended ? 'ended' : 'end_recommended',
        alert: r.ended ? '手動で取り下げ済' : `eBay API未接続のため手動で終了してください（${r.reason}）`,
        updated_at: new Date().toISOString(),
      })
      .eq('id', listing.id);
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/listings/:id/resume', async (req, res) => {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from('ebay_listings')
      .update({ status: 'active', alert: null, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/listings/:id/checks', async (req, res) => {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from('ebay_stock_checks')
      .select('*')
      .eq('listing_id', req.params.id)
      .order('checked_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════
// 受注管理
// ══════════════════════════════════════════════════════
router.get('/orders', async (req, res) => {
  try {
    const sb = getSupabase();
    let q = sb.from('ebay_orders').select('*').order('sold_at', { ascending: false });
    if (req.query.status) q = q.eq('procurement_status', req.query.status);
    const { data, error } = await q;
    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/orders', async (req, res) => {
  try {
    const sb = getSupabase();
    const body = { ...req.body };
    // 発送準備期間5営業日から発送期限を出す
    if (!body.ship_by && body.sold_at) {
      const d = new Date(body.sold_at);
      let added = 0;
      while (added < 5) {
        d.setDate(d.getDate() + 1);
        const dow = d.getDay();
        if (dow !== 0 && dow !== 6) added++;
      }
      body.ship_by = d.toISOString().slice(0, 10);
    }
    const { data, error } = await sb.from('ebay_orders').insert(body).select().single();
    if (error) throw error;

    // 売れたら同型番の在庫を即確認する（次の1個が確保できるか）
    if (data.listing_id) {
      const settings = await getSettings();
      const { data: listing } = await sb.from('ebay_listings').select('*').eq('id', data.listing_id).single();
      if (listing) {
        const result = await checkListing(listing, settings);
        await applyCheckResult(listing, result, settings);
        if (!result.available) {
          await notify(
            settings,
            `:rotating_light: 受注したが仕入先に在庫がありません\n${data.kataban} / OrderID: ${data.ebay_order_id}\n発送期限: ${data.ship_by}\n至急、代替の仕入先を探すかバイヤーにキャンセル依頼を出してください（セラー都合キャンセルは指標に直撃します）`,
          );
        }
      }
    }
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/orders/:id', async (req, res) => {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from('ebay_orders')
      .update({ ...req.body, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════
// 利益ウォッチ
// ══════════════════════════════════════════════════════
router.get('/watch', async (_req, res) => {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from('ebay_profit_watch')
      .select('*')
      .order('profit_jpy', { ascending: false, nullsFirst: false });
    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/watch', async (req, res) => {
  try {
    const sb = getSupabase();
    const { data, error } = await sb.from('ebay_profit_watch').insert(req.body).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/watch/:id', async (req, res) => {
  try {
    const sb = getSupabase();
    const { data, error } = await sb.from('ebay_profit_watch').update(req.body).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/watch/:id', async (req, res) => {
  try {
    const sb = getSupabase();
    const { error } = await sb.from('ebay_profit_watch').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** 1候補の国内最安値を取り直し、利益を再計算する */
async function refreshWatchItem(item, settings) {
  const sb = getSupabase();
  // AmazonはSP-APIの往復が長く、巡回スループットを半減させるため既定では呼ばない
  const [y, m, s, rk, az] = await Promise.all([
    scrapeSource('yahoo', item.keyword_ja, item.exclude_words, item.include_words),
    scrapeSource('mercari', item.keyword_ja, item.exclude_words, item.include_words),
    scrapeSource('suruga', item.keyword_ja, item.exclude_words, item.include_words),
    scrapeSource('rakuten', item.keyword_ja, item.exclude_words, item.include_words),
    settings.use_amazon
      ? scrapeSource('amazon', item.keyword_ja, item.exclude_words, item.include_words)
      : Promise.resolve({ source: 'amazon', ok: false, count: null, min: null, median: null, items: [], error: '設定で無効' }),
  ]);
  const all = [y, m, s, rk, az];

  const cands = all.filter((r) => r.ok && r.min != null);
  const best = cands.length ? cands.reduce((a, b) => (a.min <= b.min ? a : b)) : null;
  const supply = all.filter((r) => r.ok).reduce((a, r) => a + (r.count || 0), 0);

  const patch = {
    yahoo_price_jpy: y.ok ? y.min : null,
    mercari_price_jpy: m.ok ? m.min : null,
    suruga_price_jpy: s.ok ? s.min : null,
    rakuten_price_jpy: rk.ok ? rk.min : null,
    amazon_price_jpy: az.ok ? az.min : null,
    best_source: best?.source ?? null,
    best_price_jpy: best?.min ?? null,
    best_title: best?.items?.[0]?.title ?? null,
    supply_count: supply,
    last_checked_at: new Date().toISOString(),
  };

  if (best && item.ebay_sold_median_jpy) {
    const priceUsd = Number(item.ebay_sold_median_jpy) / Number(settings.usd_jpy);

    // 最安値: いま実際に買える1点で計算した「今すぐ受注をさばけるか」の数字
    const atMin = calcProfit(settings, priceUsd, best.min, item.category, item.weight_kg);
    patch.profit_jpy = atMin.profit_jpy;
    patch.margin_pct = atMin.margin_pct;

    // 中央値: 「その型番を継続的に仕入れ続けられるか」の数字。判定はこちらを使う。
    // 最安値だけで判定すると、たまたま出ている1点の安値で◎が付き、
    // 2個目以降が仕入れられない型番を大量に出品してしまう。
    const medCands = all.filter((r) => r.ok && r.median != null);
    const medBest = medCands.length ? medCands.reduce((a, b) => (a.median <= b.median ? a : b)) : null;
    if (medBest) {
      const atMed = calcProfit(settings, priceUsd, medBest.median, item.category, item.weight_kg);
      patch.median_price_jpy = medBest.median;
      patch.median_title = medBest.items?.[Math.min(1, medBest.items.length - 1)]?.title ?? null;
      patch.profit_median_jpy = atMed.profit_jpy;
      patch.margin_median_pct = atMed.margin_pct;
      patch.verdict = verdictOf(atMed.margin_pct, atMed.profit_jpy, item.ebay_sold_count);
    } else {
      patch.median_price_jpy = null;
      patch.profit_median_jpy = null;
      patch.margin_median_pct = null;
      patch.verdict = verdictOf(atMin.margin_pct, atMin.profit_jpy, item.ebay_sold_count);
    }
  } else {
    // eBay相場が未取得なら判定を作らない（推測値で埋めない）
    patch.profit_jpy = null;
    patch.margin_pct = null;
    patch.median_price_jpy = null;
    patch.profit_median_jpy = null;
    patch.margin_median_pct = null;
    patch.verdict = '未取得';
  }

  await sb.from('ebay_profit_watch').update(patch).eq('id', item.id);
  return patch;
}

router.post('/watch/:id/refresh', async (req, res) => {
  try {
    const sb = getSupabase();
    const settings = await getSettings();
    const { data: item } = await sb.from('ebay_profit_watch').select('*').eq('id', req.params.id).single();
    if (!item) return res.status(404).json({ error: 'not found' });
    res.json(await refreshWatchItem(item, settings));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════
// ダッシュボード
// ══════════════════════════════════════════════════════
router.get('/stats', async (_req, res) => {
  try {
    const sb = getSupabase();
    const settings = await getSettings();
    const [listings, orders, watch] = await Promise.all([
      sb.from('ebay_listings').select('status, last_margin_pct'),
      sb.from('ebay_orders').select('procurement_status, ship_by, sold_price_usd'),
      sb.from('ebay_profit_watch').select('verdict'),
    ]);

    // DBに繋がらないまま0件を返すと「問題なし」に見えてしまう。監視ツールとしては最悪なので必ず失敗させる
    const dbError = listings.error || orders.error || watch.error;
    if (dbError) throw new Error(`DB read failed: ${dbError.message}`);

    const L = listings.data || [];
    const O = orders.data || [];
    const W = watch.data || [];
    const today = new Date().toISOString().slice(0, 10);

    res.json({
      listings: {
        total: L.length,
        active: L.filter((x) => x.status === 'active').length,
        end_recommended: L.filter((x) => x.status === 'end_recommended').length,
        ended: L.filter((x) => x.status === 'ended').length,
        draft: L.filter((x) => x.status === 'draft').length,
      },
      orders: {
        total: O.length,
        pending: O.filter((x) => x.procurement_status === 'pending').length,
        overdue: O.filter((x) => x.ship_by && x.ship_by < today && x.procurement_status !== 'shipped').length,
      },
      watch: {
        total: W.length,
        good: W.filter((x) => x.verdict === '◎' || x.verdict === '○').length,
      },
      settings: { enabled: settings.enabled, auto_end_listing: settings.auto_end_listing, last_run_at: settings.last_run_at },
      ebay_api_connected: !!process.env.EBAY_OAUTH_TOKEN,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════
// Cron: 10分ごと
// ══════════════════════════════════════════════════════

/**
 * Vercelの関数上限は vercel.json の maxDuration で120秒。
 * 仕入先を増やすと1件あたりの所要が伸び、件数だけで制御していると
 * 上限を超えて FUNCTION_INVOCATION_TIMEOUT になり、その回の結果が
 * まるごと失われる（実際に発生した）。件数ではなく残り時間で打ち切る。
 *
 * 未処理分は last_checked_at 昇順で次回の先頭に来るので取りこぼさない。
 */
const CRON_BUDGET_MS = 260_000; // vercel.json の maxDuration 300秒に対する余裕
const CRON_CONCURRENCY = 4;     // 同時に処理する件数

/**
 * 件数を同時実行しつつ、時間予算で打ち切る。
 *
 * 処理時間のほとんどは仕入先サイトの応答待ちなので、直列だとCPUが遊ぶ。
 * 実測で1件10.6秒かかっていたのは待ち時間が支配的だったため。
 * ただし同時実行を上げすぎると仕入先サイトへの負荷と検知リスクが上がるので4に抑える。
 */
async function runWithBudget(items, worker, budgetMs = CRON_BUDGET_MS, concurrency = CRON_CONCURRENCY) {
  const startedAt = Date.now();
  let index = 0;
  let processed = 0;
  const overBudget = () => Date.now() - startedAt > budgetMs;

  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      if (overBudget()) return;
      const i = index++;
      if (i >= items.length) return;
      try {
        await worker(items[i]);
      } catch (e) {
        console.error('[ebay] worker error:', e.message);
      }
      processed++;
      // 仕入先サイトへの負荷を避けるため、レーンごとに間隔を空ける
      await new Promise((r) => setTimeout(r, 1200));
    }
  });
  await Promise.all(lanes);
  return { processed, remaining: items.length - processed, elapsedMs: Date.now() - startedAt };
}

/** 在庫追従。最も長く未チェックの出品から順に巡回する */
router.get('/cron/stock-check', async (_req, res) => {
  try {
    const sb = getSupabase();
    const settings = await getSettings();
    if (!settings.enabled) return res.json({ skipped: 'disabled' });

    const { data: listings } = await sb
      .from('ebay_listings')
      .select('*')
      .in('status', ['active', 'end_recommended'])
      .order('last_checked_at', { ascending: true, nullsFirst: true })
      .limit(settings.max_checks_per_run);

    const summary = { checked: 0, ok: 0, warn: 0, ended: 0, end_recommended: 0, error: 0 };

    const run = await runWithBudget(listings || [], async (listing) => {
      try {
        const result = await checkListing(listing, settings);
        const action = await applyCheckResult(listing, result, settings);
        summary.checked++;
        if (action === 'ok') summary.ok++;
        else if (action === 'warn_price') summary.warn++;
        else if (action === 'ended') summary.ended++;
        else if (action === 'end_recommended') summary.end_recommended++;
        else summary.error++;
      } catch (e) {
        summary.error++;
        console.error(`[ebay] check failed ${listing.kataban}:`, e.message);
      }
    });

    await sb.from('ebay_settings').update({ last_run_at: new Date().toISOString() }).eq('id', 'default');
    res.json({ ...summary, remaining: run.remaining, elapsed_sec: Math.round(run.elapsedMs / 1000) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** 利益ウォッチ。国内最安値を取り直して利益を再計算 */
router.get('/cron/profit-watch', async (_req, res) => {
  try {
    const sb = getSupabase();
    const settings = await getSettings();
    if (!settings.enabled) return res.json({ skipped: 'disabled' });

    const { data: items } = await sb
      .from('ebay_profit_watch')
      .select('*')
      .eq('enabled', true)
      .order('last_checked_at', { ascending: true, nullsFirst: true })
      .limit(60);

    let updated = 0;
    const newlyGood = [];
    const run = await runWithBudget(items || [], async (item) => {
      try {
        const before = item.verdict;
        const patch = await refreshWatchItem(item, settings);
        updated++;
        if ((patch.verdict === '◎' || patch.verdict === '○') && before !== patch.verdict) {
          newlyGood.push(`${item.kataban}: ${patch.verdict} 中央値仕入¥${(patch.median_price_jpy || 0).toLocaleString()}で粗利¥${(patch.profit_median_jpy || 0).toLocaleString()} (${patch.margin_median_pct}%) / 最安¥${(patch.best_price_jpy || 0).toLocaleString()}@${patch.best_source}`);
        }
      } catch (e) {
        console.error(`[ebay] watch failed ${item.kataban}:`, e.message);
      }
    });
    const remaining = run.remaining;

    if (newlyGood.length) {
      await notify(settings, `:moneybag: 利益条件を満たした商品があります\n${newlyGood.join('\n')}`);
    }
    res.json({ updated, remaining, elapsed_sec: Math.round(run.elapsedMs / 1000), newlyGood: newlyGood.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
module.exports.calcProfit = calcProfit;
module.exports.scrapeSource = scrapeSource;

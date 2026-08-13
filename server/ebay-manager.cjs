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
  max_cost_ratio_pct: 44,
  // 利益ウォッチが◎/○になったら、選定した個体のページを自動で取り込む
  auto_import_on_good: true,
  // 仕入れる1点の選び方。最安ではなく信頼性と価格のバランスで選ぶ
  source_min_rating: 95,        // これ未満の評価の出品者からは買わない
  source_rating_weight: 3.0,    // 評価1%の不足を価格3%相当として扱う
  source_store_bonus_pct: 5,    // ストア出品は実効5%安として扱う
  source_min_hours_left: 6,     // 残りがこれ未満は仕入れが間に合わないので除外
  source_price_band_low_pct: 40,   // 相場中央値のこれ%未満は買わない（別商品・破損の混入）
  source_price_band_high_pct: 160, // これ%超も買わない
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
/**
 * 1商品の粗利と利益率を返す。
 *
 * 仕向地で条件が大きく変わる（references/profit-rules.md）。
 *   米国   … DDPで関税15%を自社負担。送料無料なので送料収入は0
 *   米国以外 … 関税なし。地域別定額の送料収入が売上に乗る
 *              （アジア$15 / カナダ$20 / 欧州・豪州$24 / 中東$35 / 南米・アフリカ$40）
 *
 * 米国だけで計算すると、関税15%と送料収入0のぶん実態より2万円近く辛い数字になる。
 * 実測では同じ商品・同じ仕入値で米国2件/8件 → 非米国8件/8件と結果が反転した。
 *
 * @param {number} shippingIncomeUsd 送料収入。米国向けは0
 * @param {boolean} usBound 米国向けならtrue（関税を乗せる）
 */
function calcProfit(s, priceUsd, costJpy, category, kg, shippingIncomeUsd = 0, usBound = true) {
  const rate = Number(s.usd_jpy) * Number(s.fx_safety);
  const fvf = FVF[category] ?? FVF['その他'];
  const P = Number(priceUsd) || 0;
  const revenueUsd = P + Number(shippingIncomeUsd || 0);
  const duty = usBound ? Number(s.duty_us_pct) / 100 : 0;

  const revenue = revenueUsd * rate;
  const fees =
    (revenueUsd * fvf + Number(s.fixed_fee_usd) + revenueUsd * (Number(s.variable_fee_pct) / 100) + P * duty) * rate;
  const cost = Number(costJpy || 0) + Number(s.ship_dom_jpy) + Number(s.pack_jpy) + shipJpy(s, kg);

  const profit = revenue - fees - cost;
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
  return { profit_jpy: Math.round(profit), margin_pct: Math.round(margin * 10) / 10, revenue_jpy: Math.round(revenue) };
}

/** 仕向地の代表値。非米国は欧州・豪州($24)を基準にする */
const INTL_SHIP_INCOME_USD = 24;

/**
 * 仕向地ごとの条件。
 *   dutyPct  … 関税率。米国はDDPで自社負担、それ以外は0（バイヤー負担）
 *   shipMul  … 国際送料の実コスト倍率（〜1kgの米国向けを1.0とした相対値）
 *   freeShip … 送料無料で出すか（送料を売価に織り込む）
 *
 * eBayは1出品につき商品価格は1つしか持てないが、送料は地域別に設定できる。
 * そのため「商品価格は最も条件の厳しい米国基準で決め、地域別送料で差を吸収する」のが
 * 実装可能な唯一の形になる。
 */
const REGIONS = [
  // 米国の関税率は ebay_settings.duty_us_pct を使う（DDU化するときに0にする）。
  // ここに定数で持つと設定を変えても価格が変わらない。
  { code: 'US', name: '米国',            dutyPct: null, shipMul: 1.0,  freeShip: true  },
  { code: 'AS', name: 'アジア',          dutyPct: 0,  shipMul: 0.7,  freeShip: false },
  { code: 'CA', name: 'カナダ',          dutyPct: 0,  shipMul: 1.0,  freeShip: false },
  { code: 'EU', name: '欧州・豪州',      dutyPct: 0,  shipMul: 1.15, freeShip: false },
  { code: 'ME', name: '中東',            dutyPct: 0,  shipMul: 1.35, freeShip: false },
  { code: 'SA', name: '南米・アフリカ',  dutyPct: 0,  shipMul: 1.5,  freeShip: false },
];

/** 米国向けと非米国向けの両方を出す。無在庫では仕向地を選べないので両方見る必要がある */
function calcBoth(s, priceUsd, costJpy, category, kg) {
  return {
    us: calcProfit(s, priceUsd, costJpy, category, kg, 0, true),
    intl: calcProfit(s, priceUsd, costJpy, category, kg, INTL_SHIP_INCOME_USD, false),
  };
}

/**
 * 目標利益率を満たす「商品価格」と「地域別送料」を逆算する。
 *
 * eBayは1出品につき商品価格を1つしか持てないが、送料は地域別に設定できる。
 * そこで価格は最も条件の緩い地域に合わせ、残りの差は地域別送料で回収する。
 *
 * さらに重要な点として、**米国のDDP関税は商品価格にのみ掛かる**（送料には掛からない）。
 * つまり売上を商品価格から送料側に寄せるほど、関税の課税ベースが下がって有利になる。
 * 「米国は送料無料」という現行ポリシーは、この構造上いちばん損な形になっている。
 *
 * mode:
 *   'per_region' … 価格を最安地域に合わせ、各地域に必要な送料を課金（既定・推奨）
 *   'us_free'    … 米国送料無料を維持し、価格を米国基準に上げる（現行ポリシー）
 */
function priceForRegions(s, costJpy, category, kg, targetMargin = 0.20, mode = 'per_region') {
  const rate = Number(s.usd_jpy) * Number(s.fx_safety);
  const fvf = FVF[category] ?? FVF['その他'];
  const fixedCostJpy = Number(costJpy || 0) + Number(s.ship_dom_jpy) + Number(s.pack_jpy);
  const baseShip = shipJpy(s, kg);
  const varFee = Number(s.variable_fee_pct) / 100;
  const fixUsd = Number(s.fixed_fee_usd);

  // ある地域で目標利益率を満たすのに必要な「バイヤー総額(商品価格+送料)」
  // 関税は商品価格Pにのみ掛かるので、Pを引数に取る
  const needTotal = (shipCostJpy, dutyPct, P) => {
    const denom = 1 - targetMargin - fvf - varFee;
    if (denom <= 0) return null;
    return ((fixedCostJpy + shipCostJpy) / rate + fixUsd + P * (dutyPct / 100)) / denom;
  };

  // 米国の関税率は設定から取る。それ以外は0（バイヤー負担）
  const dutyOf = (r) => (r.dutyPct === null ? Number(s.duty_us_pct) : r.dutyPct);
  const regionShip = (r) => Math.round(baseShip * r.shipMul);
  const withShip = (shipCostJpy) => ({
    ...s, ship_tier1_jpy: shipCostJpy, ship_tier2_jpy: shipCostJpy,
    ship_tier3_jpy: shipCostJpy, ship_tier4_jpy: shipCostJpy,
  });

  let priceUsd;
  if (mode === 'us_free') {
    // 米国を送料無料のまま満たす価格（関税15%を価格に織り込む）
    const denomUs = 1 - targetMargin - fvf - varFee - dutyOf(REGIONS[0]) / 100;
    if (denomUs <= 0) return null;
    priceUsd = ((fixedCostJpy + baseShip) / rate + fixUsd) / denomUs;
  } else {
    // 最も条件の緩い地域（実送料が最安・関税なし）に価格を合わせる
    const cheapest = REGIONS.filter((r) => !r.freeShip)
      .reduce((a, b) => (a.shipMul <= b.shipMul ? a : b));
    priceUsd = needTotal(regionShip(cheapest), 0, 0);
  }
  priceUsd = Math.ceil(priceUsd * 100) / 100;

  const regions = REGIONS.map((r) => {
    const shipCostJpy = regionShip(r);
    let charge = 0;
    if (!(mode === 'us_free' && r.freeShip)) {
      const need = needTotal(shipCostJpy, dutyOf(r), priceUsd);
      charge = Math.max(0, need - priceUsd);
    }
    charge = Math.ceil(charge * 100) / 100;
    const res = calcProfit(withShip(shipCostJpy), priceUsd, costJpy, category, 0.5, charge, r.dutyPct === null);
    return {
      code: r.code, name: r.name, duty_pct: dutyOf(r),
      ship_cost_jpy: shipCostJpy, charge_usd: charge,
      buyer_total_usd: Math.round((priceUsd + charge) * 100) / 100,
      profit_jpy: res.profit_jpy, margin_pct: res.margin_pct,
    };
  });

  return { mode, price_usd: priceUsd, target_margin: targetMargin, regions };
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
/**
 * 判定のしきい値は設定から読む。
 * 基準を変えるたびにコードを触るのは事故のもとで、実際に20%→15%への
 * 変更が発生した。marginTarget / profitFloor を渡せるようにしてある。
 */
function verdictOf(margin, profit, soldCount, costRatioPct, maxRatioPct, marginTarget = 20, profitFloor = 5000) {
  if (soldCount != null && soldCount < 1) return '✕';
  // 米国基準・全世界送料無料で出す前提だと、価格は米国（関税15%・送料自社負担）で
  // 決まる。国内仕入値がeBay相場の44%を超えると、その価格が相場を超えて売れなくなる。
  // 実測では牛刀26%だけが成立し、50%超の9件は全滅した。
  if (costRatioPct != null && maxRatioPct != null && costRatioPct > maxRatioPct) return '✕';
  if (profit <= 0) return '✕';
  if (margin >= marginTarget && profit >= profitFloor) return '◎';   // 両方満たす
  if (margin >= marginTarget || profit >= profitFloor) return '○';   // 合格ライン
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
    // タグを落とす前に個別商品のIDを拾う。利益が出た型番を自動で取り込むとき、
    // 検索URLではなく「最安だったその個体のページ」を指す必要があるため
    const idM = block.match(/auctions\.yahoo\.co\.jp\/jp\/auction\/([a-zA-Z0-9]+)/);
    const itemUrl = idM ? `https://page.auctions.yahoo.co.jp/jp/auction/${idM[1]}` : null;

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

    // data-cl-params に出品者の信頼性シグナルが入っている。
    // grat=良い評価率(%) / seltyp=0:個人 1:ストア / bnpsf=即決時の送料 / end=終了時刻(epoch秒)
    const clp = (k) => {
      const mm = block.match(new RegExp('[;"]' + k + ':([^;"]*)'));
      return mm ? mm[1] : null;
    };
    const grat = clp('grat') != null && clp('grat') !== '' ? Number(clp('grat')) : null;
    const shipJpyItem = Number(clp('bnpsf') || clp('cpsf') || 0) || 0;
    const endsAt = Number(clp('end') || 0) || null;

    items.push({
      price,
      ship_jpy: shipJpyItem,
      total_jpy: price + shipJpyItem,   // 実際に払う額。送料込みで比べないと選定を誤る
      seller_rating: grat,              // 良い評価率(%)
      is_store: clp('seltyp') === '1',
      ends_at: endsAt,
      hours_left: endsAt ? Math.round((endsAt * 1000 - Date.now()) / 3600000) : null,
      title: title.slice(0, 120),
      url: itemUrl,
    });
  }
  items.sort((a, b) => a.price - b.price);
  return {
    source: 'yahoo',
    ok: true,
    count: items.length,
    min: items[0]?.price ?? null,
    median: items.length ? items[Math.floor(items.length / 2)].price : null,
    // 表示用は先頭5件のまま。候補選定は全件から行うので別に持たせる
    items: items.slice(0, 5),
    candidates: items,
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

/**
 * 実際に買う1点を選ぶ。最安ではなく「信頼性と価格のバランス」で選ぶ。
 *
 * 最安を機械的に取ると、実測では本体＋レンズのセット出品を個人から買うことになった
 * （SMC PENTAX-M 50mm F1.7 の最安 ¥1,000 は PENTAX MX ボディ同梱・評価98.1%の個人）。
 * 無在庫では「買えなかった」「届いた物が違う」が即クレームになるので、
 * 送料込みの総額に、出品者の評価とストアかどうかを加味した実効コストで比較する。
 *
 *   実効コスト = 総額 × (1 + 評価の不足分 × 重み) × (ストアなら割引)
 *
 * 評価3%差が価格9%差に相当する重み(既定3.0)。評価99.9%のストアに、
 * 評価96%の個人が勝つには12%以上安い必要がある、という設計。
 */
function pickBestItem(candidates, settings = {}, opts = {}) {
  const minRating = Number(settings.source_min_rating ?? 95);
  const weight = Number(settings.source_rating_weight ?? 3.0);
  const storeBonus = Number(settings.source_store_bonus_pct ?? 5) / 100;
  const minHours = Number(settings.source_min_hours_left ?? 6);

  const bandLow = Number(settings.source_price_band_low_pct ?? 40) / 100;
  const bandHigh = Number(settings.source_price_band_high_pct ?? 160) / 100;

  const list = (candidates || []).filter((i) => i.url && i.total_jpy);
  if (!list.length) return null;

  // 相場の基準は候補の中央値。平均だと極端な1点に引っ張られる。
  // 安すぎる側のほうが危険で、実測では別商品・破損品・本体セットが混ざっていた。
  const totals = list.map((i) => i.total_jpy).sort((a, b) => a - b);
  const marketJpy = totals[Math.floor(totals.length / 2)];
  const floorJpy = Math.round(marketJpy * bandLow);
  const ceilJpy = Math.round(marketJpy * bandHigh);

  const { detectBundle } = require('./ebay-import.cjs');
  const rejected = [];
  const ok = list.filter((i) => {
    // 相場から大きく外れる出品は、安い側も高い側も買わない
    if (list.length >= 4 && (i.total_jpy < floorJpy || i.total_jpy > ceilJpy)) {
      rejected.push({
        url: i.url,
        why: `相場¥${marketJpy.toLocaleString()}から乖離（許容 ¥${floorJpy.toLocaleString()}〜¥${ceilJpy.toLocaleString()}、この出品 ¥${i.total_jpy.toLocaleString()}）`,
      });
      return false;
    }
    // セット出品は買ってはいけない。取り込み側と同じ判定器を使う
    const bundle = detectBundle(i.title || '');
    if (bundle) { rejected.push({ url: i.url, why: `セット疑い(${bundle})` }); return false; }
    if (i.seller_rating != null && i.seller_rating < minRating) {
      rejected.push({ url: i.url, why: `評価${i.seller_rating}% < ${minRating}%` }); return false;
    }
    // 終了間際は仕入れが間に合わないので候補から外す
    if (i.hours_left != null && i.hours_left < minHours) {
      rejected.push({ url: i.url, why: `残り${i.hours_left}h < ${minHours}h` }); return false;
    }
    if (opts.maxTotalJpy && i.total_jpy > opts.maxTotalJpy) {
      rejected.push({ url: i.url, why: `総額¥${i.total_jpy} が上限超過` }); return false;
    }
    return true;
  });
  if (!ok.length) return { picked: null, rejected, reason: '条件を満たす出品がありません' };

  const scored = ok.map((i) => {
    // 評価が取れない出品は「最低ラインぎりぎり」とみなす。楽観的に扱わない
    const rating = i.seller_rating ?? minRating;
    const penalty = 1 + (weight * (100 - rating)) / 100;
    const discount = i.is_store ? 1 - storeBonus : 1;
    return { ...i, effective_jpy: Math.round(i.total_jpy * penalty * discount) };
  }).sort((a, b) => a.effective_jpy - b.effective_jpy);

  const picked = scored[0];
  const cheapest = ok.reduce((a, b) => (a.total_jpy <= b.total_jpy ? a : b));
  const reason = [
    `総額¥${picked.total_jpy.toLocaleString()}(本体¥${picked.price.toLocaleString()}+送料¥${picked.ship_jpy.toLocaleString()})`,
    picked.seller_rating != null ? `評価${picked.seller_rating}%` : '評価不明',
    picked.is_store ? 'ストア' : '個人',
    picked.hours_left != null ? `残り${picked.hours_left}h` : '',
    `相場¥${marketJpy.toLocaleString()}`,
    // 「最安」は除外後の候補内での話。除外前の全体最安とは別物なので混同しないよう明記する
    picked.url !== cheapest.url
      ? `候補内の最安(¥${cheapest.total_jpy.toLocaleString()})より信頼性を優先`
      : '候補内で最安',
    rejected.length ? `${rejected.length}件を除外` : '',
  ].filter(Boolean).join(' / ');

  return { picked, reason, rejected, market_jpy: marketJpy, candidates: scored.slice(0, 5) };
}

// ── eBay相場の入力検証 ──────────────────────────────────
/**
 * eBay側の検索語にセット出品の除外が入っているかを検証する。
 *
 * 2026-08-12、この検証が無かったために11型番すべての相場を2〜3倍に見誤った。
 * Terapeakで「Olympus OM Zuiko 50mm f1.8」を測ると、落札8件すべてが
 * 「OM-1 / OM-2 などのフィルムカメラ本体 + レンズ」のセットで、
 * レンズ単体の落札は1件も無かった。$189.97 はカメラ本体の値段だった。
 *
 * 国内側の仕入先には detectBundle を入れていたのに、判定のもう一方である
 * eBay側には何も入れていなかった。同じ罠を反対側で踏んでいる。
 */
const EBAY_BUNDLE_EXCLUDES = {
  common: ['body', 'camera', 'SLR', 'set', 'kit'],
  Canon: ['AE-1', 'A-1', 'F-1', 'T70', 'T50', 'AV-1'],
  Nikon: ['FM', 'FE', 'F2', 'F3', 'EM', 'Nikkormat'],
  Pentax: ['MX', 'ME', 'K1000', 'KX', 'LX', 'Spotmatic'],
  Olympus: ['OM-1', 'OM-2', 'OM-3', 'OM-4', 'OM-10'],
  Minolta: ['XD', 'X-700', 'SRT', 'XG', 'XE'],
  Konica: ['Autoreflex', 'FS-1'],
  Fujifilm: ['ST701', 'ST801', 'AZ-1'],
};

/** その型番のeBay検索語に足すべき除外語を返す */
function recommendedEbayExcludes(kataban = '') {
  const brand = Object.keys(EBAY_BUNDLE_EXCLUDES).find(
    (b) => b !== 'common' && new RegExp(b, 'i').test(kataban),
  );
  return [...EBAY_BUNDLE_EXCLUDES.common, ...(brand ? EBAY_BUNDLE_EXCLUDES[brand] : [])];
}

/**
 * eBay検索語を検証する。除外が不足していれば理由付きで返す。
 * 相場を登録・更新する経路では必ずこれを通す。
 */
function validateEbayKeyword(keywordEn, kataban = '') {
  const kw = String(keywordEn || '');
  if (!kw.trim()) return { ok: false, reason: 'eBayの検索語が未設定です' };

  const need = recommendedEbayExcludes(kataban);
  // 「-語」の形で入っているものを拾う
  const present = (kw.match(/-\S+/g) || []).map((s) => s.slice(1).toLowerCase());
  const missing = need.filter((w) => !present.includes(w.toLowerCase()));

  if (!present.length) {
    return {
      ok: false,
      reason: 'セット出品の除外が入っていません。ボディ＋レンズのセットが混ざると相場が2〜3倍に膨らみます',
      suggestion: `${kw} ${need.map((w) => `-${w}`).join(' ')}`,
      missing,
    };
  }
  if (missing.length > need.length / 2) {
    return {
      ok: false,
      reason: `除外が不足しています（${missing.slice(0, 6).join(' / ')} など）`,
      suggestion: `${kw} ${missing.map((w) => `-${w}`).join(' ')}`,
      missing,
    };
  }
  return { ok: true, missing };
}

async function scrapeSource(source, keyword, excludeWords, includeWords) {
  const fn = SCRAPERS[source];
  if (!fn) return { source, ok: false, count: null, min: null, items: [], error: 'unknown source' };
  try {
    return await fn(keyword, excludeWords, includeWords);
  } catch (e) {
    return { source, ok: false, count: null, min: null, items: [], error: e.message };
  }
}

// ── eBay API 認証 ───────────────────────────────────────
/**
 * eBayのアクセストークンを取得する。
 *
 * EBAY_CLIENT_ID / EBAY_CLIENT_SECRET / EBAY_REFRESH_TOKEN があれば
 * リフレッシュトークンから発行する（推奨。ユーザートークンは2時間で切れるため）。
 * 暫定で EBAY_OAUTH_TOKEN を直接置いてもよい。
 */
let ebayTokenCache = { token: null, expiresAt: 0 };

async function getEbayToken() {
  if (ebayTokenCache.token && Date.now() < ebayTokenCache.expiresAt - 60_000) {
    return ebayTokenCache.token;
  }
  const { EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_REFRESH_TOKEN, EBAY_OAUTH_TOKEN } = process.env;

  if (EBAY_CLIENT_ID && EBAY_CLIENT_SECRET && EBAY_REFRESH_TOKEN) {
    const basic = Buffer.from(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`).toString('base64');
    const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: EBAY_REFRESH_TOKEN,
        scope: [
          'https://api.ebay.com/oauth/api_scope/sell.inventory',
          'https://api.ebay.com/oauth/api_scope/sell.account',
        ].join(' '),
      }).toString(),
    });
    if (!res.ok) throw new Error(`eBayトークン取得失敗 HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    ebayTokenCache = { token: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 };
    return j.access_token;
  }
  if (EBAY_OAUTH_TOKEN) return EBAY_OAUTH_TOKEN;
  return null;
}

/** Sell API を叩く共通処理 */
async function ebayApi(method, path, body, extraHeaders = {}) {
  const token = await getEbayToken();
  if (!token) throw new Error('eBayの認証情報が未設定です（EBAY_CLIENT_ID / EBAY_CLIENT_SECRET / EBAY_REFRESH_TOKEN）');
  const res = await fetch(`https://api.ebay.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Language': 'en-US',
      Accept: 'application/json',
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* 204などは本文なし */ }
  if (!res.ok) {
    const msg = json?.errors?.map((e) => `${e.errorId}: ${e.message}${e.parameters ? ' (' + e.parameters.map(p => p.value).join(',') + ')' : ''}`).join(' / ')
      || text.slice(0, 300) || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return json;
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
      // 実際に叩いたURLは ok/ng を問わず残す。取得できなかった仕入先ほど
      // 管理画面から人が手で開いて確認する必要があるため
      if (r.url) patch.last_url = r.url;
      if (r.ok) {
        patch.last_price_jpy = r.min;
        patch.last_count = r.count;
        patch.last_available = r.min != null;
        // 採用した最安値がどの商品だったかを残す。別商品の混入は画面で気づくしかない
        patch.last_title = r.items?.[0]?.title || null;

        // 売れたときに実際に買う個体。最安ではなく信頼性と価格のバランスで選ぶ。
        // 検索結果(last_url)とは用途が違うので別の列に持つ
        const best = pickBestItem(r.candidates, settings);
        patch.last_item_url = best?.picked?.url ?? null;
        patch.last_item_title = best?.picked?.title ?? null;
        patch.last_item_total_jpy = best?.picked?.total_jpy ?? null;
        patch.last_item_reason = best?.reason ?? null;
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
    settings, listing.price_usd, best.min, listing.category, listing.weight_kg,
  );
  // 非米国向け（関税なし・送料収入あり）。米国だけで判断すると、
  // 実際には欧州・アジア向けで十分利益が出る出品まで落としてしまう。
  const intl = calcProfit(
    settings, listing.price_usd, best.min, listing.category, listing.weight_kg, INTL_SHIP_INCOME_USD, false,
  );

  // ── 判定2: 米国・非米国のどちらでも下限割れ → 取り下げ ──
  if (margin_pct < Number(settings.margin_floor_pct) && intl.margin_pct < Number(settings.margin_floor_pct)) {
    return {
      action: 'end',
      available: true,
      min_price_jpy: best.min,
      source_used: best.source,
      total_count: totalCount,
      margin_pct,
      margin_intl_pct: intl.margin_pct,
      profit_jpy,
      reason: `仕入値が¥${best.min.toLocaleString()}に上昇し、米国向け${margin_pct}%・非米国向け${intl.margin_pct}%とも下限${settings.margin_floor_pct}%を下回った`,
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
      margin_intl_pct: intl.margin_pct,
      profit_jpy,
      reason: `仕入値が想定¥${basis.toLocaleString()}→¥${best.min.toLocaleString()}に上昇（+${Math.round(((best.min - basis) / basis) * 100)}%）。米国${margin_pct}% / 非米国${intl.margin_pct}%`,
    };
  }

  return {
    action: 'ok',
    available: true,
    min_price_jpy: best.min,
    source_used: best.source,
    total_count: totalCount,
    margin_pct,
    margin_intl_pct: intl.margin_pct,
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
      last_margin_intl_pct: result.margin_intl_pct ?? null,
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
// ── 仕入先URLからの取り込み ─────────────────────────────
const { importFromUrl } = require('./ebay-import.cjs');

/**
 * 仕入先の商品ページURLを渡すと、英語タイトル・説明文・Item Specifics と
 * 推奨売価・利益を組み立てて返す。取り込んだ内容は ebay_imports に残す。
 *
 * 画像は仕入先から持ってこない。URLだけを控えて後から人が見に行けるようにする。
 */
router.post('/imports', async (req, res) => {
  try {
    const url = String(req.body.url || '').trim();
    if (!url) return res.status(400).json({ error: 'URLを入力してください' });

    const r = await importFromUrl(url);

    // 仕入値が取れていれば、利益が出る売価を逆算して添える
    const sb = getSupabase();
    const { data: st } = await sb.from('ebay_settings').select('*').eq('id', 'default').maybeSingle();
    const s = { ...DEFAULT_SETTINGS, ...(st || {}) };
    const targetMargin = Number(req.body.margin ?? 20);
    const weightKg = Number(req.body.weight_kg ?? 0.4);
    const category = req.body.category || 'カメラ';

    let pricing = null;
    if (r.supplier.price_jpy != null) {
      // targetMargin は小数で渡す（0.20 = 20%）。価格は米国基準・全世界送料無料で決める
      pricing = priceForRegions(s, r.supplier.price_jpy, category, weightKg, targetMargin / 100, 'us_free');
    }

    const row = {
      source: r.supplier.source,
      source_url: r.supplier.url,
      source_item_id: r.supplier.item_id,
      title_ja: r.supplier.title_ja,
      description_ja: r.supplier.description_ja || null,
      genre: r.supplier.genre,
      breadcrumb: r.supplier.breadcrumb,
      price_jpy: r.supplier.price_jpy,
      condition_ja: r.supplier.condition_ja,
      available: r.supplier.available,
      image_urls: r.supplier.image_urls,
      title_en: r.listing.title_en,
      description_html: r.listing.description_html,
      item_specifics: r.listing.item_specifics,
      condition_id: r.listing.condition_id,
      specs: r.specs,
      bundle_suspect: r.bundle_suspect,
      warnings: r.warnings,
      fetched_at: r.supplier.fetched_at,
    };
    // 同じURLを2回取り込んだら上書きする（価格や状態は動くので最新に保つ）
    const { data, error } = await sb
      .from('ebay_imports')
      .upsert(row, { onConflict: 'source_url' })
      .select()
      .single();
    if (error) throw new Error(error.message);

    res.json({ ...r, pricing, import_id: data.id });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/**
 * 取り込み1件から出品レコードを作る（ワンクリック下書き）。
 *
 *   1. ebay_listings に行を作る（売価は米国基準・送料無料で逆算）
 *   2. 取り込み元の商品URLを仕入先として登録し、10分ごとの在庫追従に載せる
 *   3. EBAY_OAUTH_TOKEN があれば、続けてeBayの未公開オファー（下書き）も作る
 *
 * 3は公開（publishOffer）を絶対に呼ばない。トークンが無い環境では1と2まで進めて、
 * eBay側は手で作る前提の情報を返す。
 *
 * セット出品の疑いがある取り込みは既定で拒否する。レンズ単体として出品して
 * 「届かない物がある」事故になるため、force:true を明示したときだけ通す。
 */
router.post('/imports/:id/listing', async (req, res) => {
  try {
    const sb = getSupabase();
    const { data: imp } = await sb.from('ebay_imports').select('*').eq('id', req.params.id).single();
    if (!imp) return res.status(404).json({ error: '取り込みが見つかりません' });
    if (imp.listing_id) return res.status(409).json({ error: 'この取り込みからは既に出品を作成済みです', listing_id: imp.listing_id });
    if (imp.bundle_suspect && !req.body.force) {
      return res.status(409).json({ error: 'セット出品の疑いがあります。内容を確認のうえ、意図して作る場合のみ再実行してください', needs_force: true });
    }
    if (imp.price_jpy == null) return res.status(400).json({ error: '仕入値を取得できていないため売価を決められません' });

    const settings = await getSettings();
    const category = req.body.category || 'カメラ';
    const weightKg = Number(req.body.weight_kg ?? 0.4);
    const margin = Number(req.body.margin ?? 20) / 100;
    const pricing = priceForRegions(settings, imp.price_jpy, category, weightKg, margin, 'us_free');
    if (!pricing) return res.status(400).json({ error: 'その利益率は手数料構成上、達成できません' });

    const sp = imp.specs || {};
    const sku = req.body.sku || [
      'LENS',
      (sp.brand_en || 'NA').slice(0, 3).toUpperCase(),
      sp.focal_mm ? `${sp.focal_mm}` : 'XX',
      sp.aperture ? String(sp.aperture).replace('.', '') : 'XX',
    ].join('-');

    const { data: listing, error: e1 } = await sb.from('ebay_listings').insert({
      sku,
      kataban: imp.title_en || imp.title_ja.slice(0, 80),
      title_en: imp.title_en,
      category,
      price_usd: Number(pricing.price_usd.toFixed(2)),
      weight_kg: weightKg,
      cost_basis_jpy: imp.price_jpy,
      status: 'draft',
    }).select().single();
    if (e1) throw new Error(e1.message);

    // 取り込み元のその個体を仕入先として登録する。売れたら即座に検知できる
    const { error: e2 } = await sb.from('ebay_listing_sources').insert({
      listing_id: listing.id,
      source: imp.source,
      search_keyword: imp.title_ja.slice(0, 120),
      url: imp.source_url,
      last_url: imp.source_url,
      last_price_jpy: imp.price_jpy,
      last_available: imp.available !== false,
    });
    if (e2) throw new Error(e2.message);

    await sb.from('ebay_imports').update({ listing_id: listing.id }).eq('id', imp.id);

    // eBay側の下書きはトークンがあるときだけ。無ければここまでで返す
    let ebay = { created: false, reason: 'EBAY_OAUTH_TOKEN / EBAY_REFRESH_TOKEN が未設定のため、eBay側の下書きは作成していません' };
    if (process.env.EBAY_OAUTH_TOKEN || process.env.EBAY_REFRESH_TOKEN) {
      const missing = draftPreflight(listing, settings);
      ebay = missing.length
        ? { created: false, reason: `出品に必要な項目が足りません: ${missing.join(' / ')}` }
        : { created: false, reason: '作成は /listings/:id/draft から実行してください', listing_id: listing.id };
    }

    res.json({ listing, pricing, ebay, photos_required: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** 取り込み履歴。後から「どの出品から取ったのか」を確認するための一覧 */
router.get('/imports', async (req, res) => {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from('ebay_imports')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(Number(req.query.limit) || 100);
    if (error) throw new Error(error.message);
    res.json(data || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/imports/:id', async (req, res) => {
  try {
    const sb = getSupabase();
    const { error } = await sb.from('ebay_imports').delete().eq('id', req.params.id);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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

/**
 * eBay相場を伴う登録・更新では、検索語にセット出品の除外が入っているかを検証する。
 * 不足していれば422で止め、修正案を返す。force:true で明示的に上書きできる。
 *
 * 相場が2〜3倍に膨らんだまま通ると、赤字の型番に◎が付き、自動取り込みまで走る。
 * 入口で止めるのが最も安い。
 */
function guardEbayKeyword(body) {
  if (body.ebay_sold_median_jpy == null || body.force) return null;
  const v = validateEbayKeyword(body.keyword_en, body.kataban || '');
  if (v.ok) return null;
  return {
    error: `eBay相場を登録できません: ${v.reason}`,
    suggestion: v.suggestion,
    missing: v.missing,
    hint: '落札一覧のタイトルを目視し、ボディ＋レンズのセットが混ざっていないか必ず確認してください',
  };
}

router.post('/watch', async (req, res) => {
  try {
    const bad = guardEbayKeyword(req.body);
    if (bad) return res.status(422).json(bad);
    const sb = getSupabase();
    const { force, ...row } = req.body;
    const { data, error } = await sb.from('ebay_profit_watch').insert(row).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/watch/:id', async (req, res) => {
  try {
    const sb = getSupabase();
    // 更新時は既存の型番・検索語も合わせて見る（部分更新でも検証が効くように）
    const { data: cur } = await sb.from('ebay_profit_watch').select('kataban,keyword_en').eq('id', req.params.id).maybeSingle();
    const bad = guardEbayKeyword({ ...(cur || {}), ...req.body });
    if (bad) return res.status(422).json(bad);
    const { force, ...row } = req.body;
    const { data, error } = await sb.from('ebay_profit_watch').update(row).eq('id', req.params.id).select().single();
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

  // 判定基準は設定から。既定は20%/5000円だが、運用で15%へ下げた
  const mTarget = Number(settings.margin_target_pct ?? 20);
  const pFloor = Number(settings.profit_floor_jpy ?? 5000);

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
      // 米国向け(DDP関税15%・送料無料)と非米国向け(関税なし・送料収入あり)を両方出す。
      // 米国だけで見ると実態より2万円近く辛くなり、実測で判定が反転した。
      const atMed = calcProfit(settings, priceUsd, medBest.median, item.category, item.weight_kg);
      const atMedIntl = calcProfit(
        settings, priceUsd, medBest.median, item.category, item.weight_kg, INTL_SHIP_INCOME_USD, false,
      );
      patch.median_price_jpy = medBest.median;
      patch.median_title = medBest.items?.[Math.min(1, medBest.items.length - 1)]?.title ?? null;
      patch.profit_median_jpy = atMed.profit_jpy;
      patch.margin_median_pct = atMed.margin_pct;
      const ratio = (medBest.median / Number(item.ebay_sold_median_jpy)) * 100;
      const maxRatio = Number(settings.max_cost_ratio_pct);
      patch.verdict = verdictOf(atMed.margin_pct, atMed.profit_jpy, item.ebay_sold_count, ratio, maxRatio, mTarget, pFloor);
      patch.profit_intl_jpy = atMedIntl.profit_jpy;
      patch.margin_intl_pct = atMedIntl.margin_pct;
      // 非米国は関税が無いので比率の足切りは掛けない
      patch.verdict_intl = verdictOf(atMedIntl.margin_pct, atMedIntl.profit_jpy, item.ebay_sold_count, null, null, mTarget, pFloor);
    } else {
      patch.median_price_jpy = null;
      patch.profit_median_jpy = null;
      patch.margin_median_pct = null;
      patch.profit_intl_jpy = null;
      patch.margin_intl_pct = null;
      patch.verdict_intl = null;
      patch.verdict = verdictOf(atMin.margin_pct, atMin.profit_jpy, item.ebay_sold_count, null, null, mTarget, pFloor);
    }
  } else {
    // eBay相場が未取得なら判定を作らない（推測値で埋めない）
    patch.profit_jpy = null;
    patch.margin_pct = null;
    patch.median_price_jpy = null;
    patch.profit_median_jpy = null;
    patch.margin_median_pct = null;
    patch.profit_intl_jpy = null;
    patch.margin_intl_pct = null;
    patch.verdict_intl = null;
    patch.verdict = '未取得';
  }

  // ── 機会検知 ──────────────────────────────────────────
  // verdict は中央値で判定する（＝継続的に仕入れ続けられるか＝無在庫の条件）。
  // それとは別に「いま買える最良の1点」が基準を満たすかを見る。
  // 中央値では✕でも、たまたま安い個体が出れば買う価値がある。
  // 実測でも Canon FD 35mm F2 は中央値¥29,400で✕だが、¥17,800の個体は成立していた。
  const opp = pickBestItem(best?.candidates, settings);
  const oppItem = opp?.picked;
  if (oppItem && item.ebay_sold_median_jpy) {
    const priceUsd = Number(item.ebay_sold_median_jpy) / Number(settings.usd_jpy);
    // 送料込みの総額で見る。本体価格だけで判断すると送料の高い出品に引っかかる
    const op = calcProfit(settings, priceUsd, oppItem.total_jpy, item.category, item.weight_kg);
    const hit = op.profit_jpy > 0 && (op.margin_pct >= mTarget || op.profit_jpy >= pFloor);
    patch.opportunity = hit;
    patch.opp_price_jpy = oppItem.total_jpy;
    patch.opp_profit_jpy = op.profit_jpy;
    patch.opp_margin_pct = op.margin_pct;
    patch.opp_url = oppItem.url;
    patch.opp_title = oppItem.title;
    patch.opp_reason = opp.reason;
    if (hit) patch.opp_found_at = new Date().toISOString();

    // 同じ個体で二重に通知しない。売れて次の個体に変われば改めて通知する
    if (hit && settings.notify_slack && item.opp_notified_url !== oppItem.url) {
      patch.opp_notified_url = oppItem.url;
      sendSlackAlert(
        `*仕入れ機会* ${item.kataban}\n`
        + `総額 ¥${oppItem.total_jpy.toLocaleString()} → 想定粗利 ¥${op.profit_jpy.toLocaleString()}（${op.margin_pct}%）\n`
        + `${opp.reason}\n${oppItem.url}`,
      ).catch(() => {});
    }
  } else {
    patch.opportunity = false;
  }

  await sb.from('ebay_profit_watch').update(patch).eq('id', item.id);

  // 利益が出る判定になったら、その最安個体のページを自動で取り込んでおく。
  // 巡回中に落ちても在庫追従を止めないよう、失敗は握りつぶして patch に記録するだけにする。
  patch.auto_import = await autoImportBest(item, best, patch, settings).catch((e) => ({ error: e.message }));
  return patch;
}

/**
 * 利益ウォッチが◎/○になった型番について、いま最安で買える個体の商品ページを
 * ebay_imports に取り込む。出品名・説明・ジャンル・画像URLが残るので、
 * あとから「なぜこの型番を仕入れると判断したのか」を個体レベルで辿れる。
 *
 * 同じURLは取り込み直さない。10分ごとの巡回で毎回フェッチすると仕入先に無駄な
 * 負荷をかけるうえ、内容もほとんど変わらないため。最安個体が売れて別の個体が
 * 最安になれば、そのURLは新規なので自動的に取り込まれる。
 */
async function autoImportBest(item, best, patch, settings) {
  if (!settings.auto_import_on_good) return { skipped: '設定で無効' };
  if (!['◎', '○'].includes(patch.verdict)) return { skipped: `判定が ${patch.verdict || '—'}` };

  // 個別商品のURLを持っているのは現状ヤフオクのスクレイパーだけ
  const target = best?.items?.find((i) => i.url);
  if (!target) return { skipped: '個別商品のURLを取得できていない' };

  const sb = getSupabase();
  const { data: exists } = await sb
    .from('ebay_imports').select('id').eq('source_url', target.url).maybeSingle();
  if (exists) return { skipped: '取り込み済み', import_id: exists.id };

  const { importFromUrl } = require('./ebay-import.cjs');
  const r = await importFromUrl(target.url);

  const { data, error } = await sb.from('ebay_imports').upsert({
    watch_id: item.id,
    auto: true,
    source: r.supplier.source,
    source_url: r.supplier.url,
    source_item_id: r.supplier.item_id,
    title_ja: r.supplier.title_ja,
    description_ja: r.supplier.description_ja || null,
    genre: r.supplier.genre,
    breadcrumb: r.supplier.breadcrumb,
    price_jpy: r.supplier.price_jpy,
    condition_ja: r.supplier.condition_ja,
    available: r.supplier.available,
    image_urls: r.supplier.image_urls,
    title_en: r.listing.title_en,
    description_html: r.listing.description_html,
    item_specifics: r.listing.item_specifics,
    condition_id: r.listing.condition_id,
    specs: r.specs,
    bundle_suspect: r.bundle_suspect,
    warnings: r.warnings,
    fetched_at: r.supplier.fetched_at,
  }, { onConflict: 'source_url' }).select('id').single();
  if (error) throw new Error(error.message);

  return { imported: true, import_id: data.id, url: target.url, bundle_suspect: r.bundle_suspect };
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
// eBay 下書き作成（未公開オファーまで）
// ══════════════════════════════════════════════════════

/**
 * Sell Inventory API の流れ:
 *   1. createOrReplaceInventoryItem … SKUと商品情報を登録（この時点では出品ではない）
 *   2. createOffer                  … 価格・カテゴリ・ポリシーを付けたオファーを作る（未公開＝下書き）
 *   3. publishOffer                 … 公開して実際の出品になる
 *
 * このモジュールは 1 と 2 までしか行わない。**publishOffer は絶対に呼ばない。**
 * 未公開オファーはバイヤーからは見えず、Seller Hubの下書きとして残る。
 * 公開は人がSeller Hubの「出品する」を押して行う。
 */

/** アカウントの取引ポリシーと在庫ロケーションを取得（設定画面で選ぶため） */
router.get('/account/policies', async (_req, res) => {
  try {
    const settings = await getSettings();
    const mkt = settings.ebay_marketplace_id || 'EBAY_US';
    const [pay, ful, ret, loc] = await Promise.all([
      ebayApi('GET', `/sell/account/v1/payment_policy?marketplace_id=${mkt}`).catch((e) => ({ error: e.message })),
      ebayApi('GET', `/sell/account/v1/fulfillment_policy?marketplace_id=${mkt}`).catch((e) => ({ error: e.message })),
      ebayApi('GET', `/sell/account/v1/return_policy?marketplace_id=${mkt}`).catch((e) => ({ error: e.message })),
      ebayApi('GET', '/sell/inventory/v1/location?limit=50').catch((e) => ({ error: e.message })),
    ]);
    res.json({
      marketplace_id: mkt,
      payment: pay.paymentPolicies?.map((p) => ({ id: p.paymentPolicyId, name: p.name })) ?? pay,
      fulfillment: ful.fulfillmentPolicies?.map((p) => ({ id: p.fulfillmentPolicyId, name: p.name })) ?? ful,
      return: ret.returnPolicies?.map((p) => ({ id: p.returnPolicyId, name: p.name })) ?? ret,
      locations: loc.locations?.map((l) => ({ key: l.merchantLocationKey, name: l.name })) ?? loc,
      current: {
        payment: settings.ebay_payment_policy_id,
        fulfillment: settings.ebay_fulfillment_policy_id,
        return: settings.ebay_return_policy_id,
        location: settings.ebay_location_key,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** 下書き作成の事前チェック。足りないものを全部返す */
function draftPreflight(listing, settings) {
  const missing = [];
  if (!listing.sku) missing.push('SKU');
  if (!listing.title_en) missing.push('英語タイトル');
  if (!listing.ebay_category_id) missing.push('eBayカテゴリID');
  if (!listing.price_usd) missing.push('売価');
  if (!listing.image_urls) missing.push('画像URL（自社撮影分。仕入先写真の転載は不可）');
  if (!settings.ebay_payment_policy_id) missing.push('支払いポリシーID（設定）');
  if (!settings.ebay_fulfillment_policy_id) missing.push('配送ポリシーID（設定）');
  if (!settings.ebay_return_policy_id) missing.push('返品ポリシーID（設定）');
  if (!settings.ebay_location_key) missing.push('在庫ロケーション（設定）');
  return missing;
}

/**
 * POST /listings/:id/draft
 * eBayに未公開オファー（下書き）を作る。公開はしない。
 */
router.post('/listings/:id/draft', async (req, res) => {
  const sb = getSupabase();
  try {
    const settings = await getSettings();
    const { data: listing } = await sb.from('ebay_listings').select('*').eq('id', req.params.id).single();
    if (!listing) return res.status(404).json({ error: 'not found' });

    const missing = draftPreflight(listing, settings);
    if (missing.length) {
      return res.status(400).json({ error: '下書きを作る前に足りない項目があります', missing });
    }

    const mkt = settings.ebay_marketplace_id || 'EBAY_US';
    const images = String(listing.image_urls).split(',').map((u) => u.trim()).filter(Boolean);

    // 1) インベントリアイテム（この時点では出品ではない）
    await ebayApi('PUT', `/sell/inventory/v1/inventory_item/${encodeURIComponent(listing.sku)}`, {
      availability: { shipToLocationAvailability: { quantity: 1 } },
      condition: 'USED_EXCELLENT',
      product: {
        title: String(listing.title_en).slice(0, 80),
        description: listing.description_en || listing.title_en,
        imageUrls: images,
        aspects: { 'Country/Region of Manufacture': ['Japan'] },
      },
      packageWeightAndSize: {
        weight: { value: Number(listing.weight_kg) || 0.5, unit: 'KILOGRAM' },
      },
    });

    // 2) オファー（未公開＝下書き）
    const offerBody = {
      sku: listing.sku,
      marketplaceId: mkt,
      format: 'FIXED_PRICE',
      availableQuantity: 1,
      categoryId: String(listing.ebay_category_id),
      listingDescription: listing.description_en || listing.title_en,
      listingPolicies: {
        paymentPolicyId: settings.ebay_payment_policy_id,
        fulfillmentPolicyId: settings.ebay_fulfillment_policy_id,
        returnPolicyId: settings.ebay_return_policy_id,
      },
      pricingSummary: { price: { value: String(Number(listing.price_usd).toFixed(2)), currency: 'USD' } },
      merchantLocationKey: settings.ebay_location_key,
    };

    let offerId = listing.ebay_offer_id;
    if (offerId) {
      await ebayApi('PUT', `/sell/inventory/v1/offer/${offerId}`, offerBody);
    } else {
      const created = await ebayApi('POST', '/sell/inventory/v1/offer', offerBody);
      offerId = created?.offerId;
    }

    await sb.from('ebay_listings').update({
      ebay_offer_id: offerId,
      draft_created_at: new Date().toISOString(),
      draft_error: null,
      updated_at: new Date().toISOString(),
    }).eq('id', listing.id);

    res.json({
      ok: true,
      offer_id: offerId,
      published: false,
      note: '未公開の下書きを作成しました。公開はSeller Hubから人が行ってください（このツールはpublishOfferを呼びません）',
      seller_hub_url: 'https://www.ebay.com/sh/lst/drafts',
    });
  } catch (e) {
    await sb.from('ebay_listings').update({ draft_error: e.message }).eq('id', req.params.id);
    res.status(500).json({ error: e.message });
  }
});

/** 下書き作成前の事前チェックだけ行う */
router.get('/listings/:id/draft/preflight', async (req, res) => {
  try {
    const sb = getSupabase();
    const settings = await getSettings();
    const { data: listing } = await sb.from('ebay_listings').select('*').eq('id', req.params.id).single();
    if (!listing) return res.status(404).json({ error: 'not found' });
    const missing = draftPreflight(listing, settings);
    res.json({ ready: missing.length === 0, missing });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════
// 価格設計（仕向地別）
// ══════════════════════════════════════════════════════

/**
 * GET /pricing?cost=6500&kg=0.4&category=その他&margin=20&mode=per_region
 * 目標利益率を満たす商品価格と地域別送料を返す。
 */
router.get('/pricing', async (req, res) => {
  try {
    const settings = await getSettings();
    const cost = Number(req.query.cost);
    if (!cost) return res.status(400).json({ error: 'cost は必須です' });
    const r = priceForRegions(
      settings,
      cost,
      req.query.category || 'その他',
      Number(req.query.kg) || 0.5,
      (Number(req.query.margin) || 20) / 100,
      req.query.mode === 'us_free' ? 'us_free' : 'per_region',
    );
    if (!r) return res.status(400).json({ error: 'その利益率は手数料構成上、達成できません' });
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** POST /pricing/bulk  body:{items:[{sku,cost_jpy,category,weight_kg}],margin,mode} */
router.post('/pricing/bulk', async (req, res) => {
  try {
    const settings = await getSettings();
    const margin = (Number(req.body.margin) || 20) / 100;
    const mode = req.body.mode === 'us_free' ? 'us_free' : 'per_region';
    const out = (req.body.items || []).map((it) => {
      const r = priceForRegions(settings, Number(it.cost_jpy), it.category || 'その他', Number(it.weight_kg) || 0.5, margin, mode);
      return { sku: it.sku, ...(r || { error: '達成不可' }) };
    });
    res.json({ mode, margin: margin * 100, items: out });
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
module.exports.calcBoth = calcBoth;
module.exports.INTL_SHIP_INCOME_USD = INTL_SHIP_INCOME_USD;
module.exports.priceForRegions = priceForRegions;
module.exports.REGIONS = REGIONS;
module.exports.scrapeSource = scrapeSource;
module.exports.pickBestItem = pickBestItem;
module.exports.checkListing = checkListing;
module.exports.refreshWatchItem = refreshWatchItem;
module.exports.autoImportBest = autoImportBest;

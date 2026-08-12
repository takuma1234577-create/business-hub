/**
 * 仕入先の商品ページURLから、eBay出品に必要な情報を組み立てる。
 *
 *   入力: https://page.auctions.yahoo.co.jp/jp/auction/xxxxx
 *   出力: 英語タイトル / 英語説明文 / Item Specifics / 推奨売価 / 利益
 *
 * ── 方針 ────────────────────────────────────────────────
 * 出品者が書いた説明文を機械翻訳して貼るのではなく、ページから
 * 「事実」だけを抽出して英文を組み立てる。理由は2つ。
 *   1. 他人の文章の翻訳は二次的著作物になる
 *   2. eBayでは同一文面が重複コンテンツ扱いになり検索順位が落ちる
 * 型番・マウント・焦点距離・状態区分は事実なので、これを構造化して使う。
 *
 * 画像は扱わない。仕入先の写真を転載できないため、写真は別途用意する。
 */

const SUPPORTED = ['yahoo'];

const UA = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
  'Accept-Language': 'ja,en;q=0.8',
};

// ── 仕入先の判定 ────────────────────────────────────────
function detectSource(url) {
  if (/auctions\.yahoo\.co\.jp/.test(url)) return 'yahoo';
  if (/jp\.mercari\.com/.test(url)) return 'mercari';
  if (/suruga-ya\.jp/.test(url)) return 'suruga';
  if (/rakuten\.co\.jp/.test(url)) return 'rakuten';
  if (/amazon\.co\.jp/.test(url)) return 'amazon';
  return null;
}

// ── ヤフオクの商品ページ ────────────────────────────────
/**
 * ld+json の Product から事実を取る。HTMLの見た目が変わっても
 * 構造化データは壊れにくいので、正規表現でDOMを掘るより安定する。
 */
async function fetchYahoo(url) {
  const m = url.match(/auction\/([a-zA-Z0-9]+)/);
  if (!m) throw new Error('ヤフオクの商品URLとして解釈できません');
  const itemId = m[1];
  const canonical = `https://page.auctions.yahoo.co.jp/jp/auction/${itemId}`;

  const res = await fetch(canonical, { headers: UA });
  if (!res.ok) throw new Error(`ページを取得できません (HTTP ${res.status})`);
  const html = await res.text();

  const blocks = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)];
  let product = null, breadcrumb = [];
  for (const b of blocks) {
    let o;
    try { o = JSON.parse(b[1]); } catch { continue; }
    if (o['@type'] === 'Product') product = o;
    if (o['@type'] === 'BreadcrumbList') {
      breadcrumb = (o.itemListElement || []).map((e) => e.item?.name).filter(Boolean);
    }
  }
  if (!product) throw new Error('商品情報を取得できませんでした（ページ構造の変更か、終了した出品）');

  // 「商品の状態」はヤフオクの定型区分。自由記述より信頼できる。
  // 値の直前にヘルプへのリンクが挟まるため、窓を広く取って既知の区分と照合する
  let conditionJa = null;
  const at = html.indexOf('商品の状態');
  if (at !== -1) {
    const win = html.slice(at, at + 600).replace(/<[^>]+>/g, ' ');
    // 長い区分から先に照合する（「傷や汚れあり」が「やや傷や汚れあり」に先に当たるのを防ぐ）
    for (const k of Object.keys(CONDITION_MAP).sort((a, b) => b.length - a.length)) {
      if (win.includes(k)) { conditionJa = k; break; }
    }
  }

  const price = Number(product.offers?.price);
  return {
    source: 'yahoo',
    item_id: itemId,
    url: canonical,
    title_ja: product.name || '',
    price_jpy: Number.isFinite(price) ? price : null,
    available: product.offers?.availability !== 'https://schema.org/OutOfStock',
    condition_ja: conditionJa,
    breadcrumb,
    description_ja: extractDescription(html) || (product.description || '').trim(),
    // 画像はURLだけを控える。ダウンロードして持つことはしない。
    // 参照用途にはリンクで十分で、出品が終われば消えるので在庫の状態も分かる
    image_urls: (product.image || []).slice(0, 24),
  };
}

// ── 説明文の全文抽出 ────────────────────────────────────
/**
 * ld+json の description は149文字程度で切れているため、本文から取り直す。
 * 説明は id="description" の直下にインラインで入っている。
 * クラス名はビルドごとにハッシュが変わるので、id を起点にする。
 *
 * ここで取るのは後述の事実抽出の材料。出品文にそのまま載せることはしない。
 */
function extractDescription(html) {
  // 本文は __NEXT_DATA__ の descriptionHtml に入っている。
  // ページ側のHTMLには冒頭だけを描画して末尾を「...」で切っているため、
  // id="description" から読むと100〜250字程度しか取れない（実測）。
  const nd = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nd) {
    try {
      const j = JSON.parse(nd[1]);
      const raw = j?.props?.pageProps?.initialState?.item?.detail?.item?.descriptionHtml
        || j?.props?.initialState?.item?.detail?.item?.descriptionHtml;
      if (raw) return htmlToText(raw).slice(0, 8000) || null;
    } catch { /* 構造が変わったら下のフォールバックに落ちる */ }
  }

  const i = html.indexOf('id="description"');
  if (i === -1) return null;
  const seg = html.slice(i, i + 60000);
  const end = seg.indexOf('</section>');
  const body = end > 0 ? seg.slice(0, end) : seg;
  return htmlToText(body).replace(/^商品説明\s*/, '').slice(0, 8000) || null;
}

function htmlToText(body) {
  return body
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s*商品説明\s*/, '')
    .trim();
}

// ── 説明文からの事実抽出 ────────────────────────────────
/**
 * 出品者の文章をそのまま訳すのではなく、買い手が判断に使う事実だけを取り出す。
 *
 * レンズで実際に問い合わせが来るのは「光学系にカビ・クモリがあるか」
 * 「絞りとヘリコイドが動くか」「何が付属するか」の3点。
 * 状態区分（目立った傷や汚れなし 等）だけでは、この3点が分からない。
 *
 * 否定形を先に見る。「カビあり」と「カビなし」を取り違えると
 * Not as described に直結するため、曖昧なら何も言わない方針にしてある。
 */
const NEG = '(?:は)?(?:あり|有り|見られ|見受け|confirmed)?\\s*(?:ませ|ま?せ)?ん|なし|無し|ありません|見当たりません|見られません|確認できません';

function scan(text, subject, patterns) {
  for (const [re, en] of patterns) if (re.test(text)) return en;
  return null;
}

function extractConditionFacts(descJa) {
  if (!descJa) return null;
  const t = descJa.replace(/\s+/g, ' ');
  const optics = [];

  // 光学系。否定表現を先に評価する
  const fungus = scan(t, 'カビ', [
    [/カビ(?:は)?(?:なし|無し|ありません|見当たりません|見られません|確認できません|ございません)/, 'no fungus'],
    [/(?:カビ|かび)(?:が|も)?(?:あり|有り|発生|見られ|散見|うっすら)/, 'fungus present'],
  ]);
  const haze = scan(t, 'クモリ', [
    [/(?:クモリ|曇り|くもり)(?:は)?(?:なし|無し|ありません|見当たりません|見られません|ございません)/, 'no haze'],
    [/(?:クモリ|曇り|くもり)(?:が|も)?(?:あり|有り|見られ|散見|うっすら)/, 'haze present'],
  ]);
  const scratch = scan(t, 'キズ', [
    [/(?:傷|キズ|きず)(?:は)?(?:なし|無し|ありません|見当たりません|見られません)/, 'no scratches on the glass'],
    [/(?:拭き傷|拭きキズ|擦り傷)/, 'cleaning marks present'],
  ]);
  const balsam = /バルサム(?:切れ|ぎれ)/.test(t) ? 'balsam separation present' : null;
  const dust = /(?:チリ|ちり|ホコリ|ほこり|埃)/.test(t)
    ? (/(?:チリ|ホコリ|埃)(?:は)?(?:なし|無し|ありません|見当たりません)/.test(t) ? 'no dust' : 'some dust present')
    : null;
  [fungus, haze, scratch, balsam, dust].forEach((x) => x && optics.push(x));

  // 動作
  const operation = [];
  if (/(?:動作|作動)(?:確認|チェック)?(?:済|済み|OK|良好|問題(?:あり)?ません)/.test(t)) operation.push('Operation confirmed');
  if (/絞り(?:羽根)?(?:は)?(?:スムーズ|快調|正常|問題(?:あり)?ません|動作)/.test(t)) operation.push('aperture blades operate smoothly');
  if (/絞り羽根(?:に)?(?:油|オイル)/.test(t)) operation.push('oil on the aperture blades');
  if (/(?:ヘリコイド|ピントリング|フォーカスリング)(?:は)?(?:スムーズ|軽い|快調|正常)/.test(t)) operation.push('focus ring turns smoothly');
  if (/(?:ヘリコイド|ピントリング|フォーカスリング)(?:は)?(?:重い|固い|硬い|ゴリ)/.test(t)) operation.push('focus ring feels stiff');

  // 付属品
  const acc = [];
  const has = (re) => re.test(t) && !/(?:付属しません|ありません|なし|無し|付属品はありません)/.test(
    t.slice(Math.max(0, t.search(re) - 12), t.search(re) + 24));
  if (has(/(?:前後)?キャップ/)) acc.push('caps');
  if (has(/フード/)) acc.push('lens hood');
  if (has(/(?:フィルター|フィルタ)/)) acc.push('filter');
  if (has(/(?:元箱|化粧箱|純正箱)/)) acc.push('original box');
  if (has(/(?:ケース|revolver|ソフトケース)/)) acc.push('case');

  // 外観
  const cosmetic = [];
  if (/(?:スレ|擦れ|小スレ)/.test(t)) cosmetic.push('light scuffs on the barrel');
  if (/(?:打痕|凹み|へこみ)/.test(t)) cosmetic.push('a dent');
  if (/(?:塗装(?:の)?(?:剥が|はが|剥げ))/.test(t)) cosmetic.push('paint loss');

  const any = optics.length || operation.length || acc.length || cosmetic.length;
  return any ? { optics, operation, accessories: acc, cosmetic } : null;
}

// ── セット出品の検出 ────────────────────────────────────
/**
 * 「ボディ＋レンズ」のセット出品からレンズ単体の出品文を作ってしまう事故を防ぐ。
 * この案件では過去に、セガサターン本体の検索でソフトを、盆栽工具でノーブランド品を
 * 拾って偽の利益を出している。同じ罠なので、疑わしい時点で警告を出す。
 */
const BUNDLE_HINTS = [
  /ボディ/i, /\bbody\b/i, /セット/, /\bset\b/i, /本体/,
  /[＋+]\s*\S/,           // 「XD + MD ROKKOR」のような連結表記
  /まとめ/, /ジャンク品?\s*\d+\s*(点|個)/,
];
// 末尾の (?![.,]?\d) が無いと、絞り値「f1.4」を本体型番 F-1 と、「F2.8」を F2 と誤認する。
// 実測で SMC PENTAX-M 50mm f1.4 が「本体型番あり」と判定された。
const BODY_MODELS = /\b(F-?1|AE-?1|A-?1|OM-?[0-9]N?|XD|X-?700|SR-?T|FM-?[0-9]?|FE-?[0-9]?|F[23]|MX|ME|KX|K[12]|SP|ST[0-9]{3}|Nikomat|Nikkormat)\b(?![.,]?\d)/i;

function detectBundle(titleJa) {
  const hints = BUNDLE_HINTS.filter((re) => re.test(titleJa));
  const body = BODY_MODELS.test(titleJa);
  if (!hints.length && !body) return null;
  const why = [];
  if (body) why.push('カメラ本体の型番が含まれています');
  if (hints.length) why.push('セット出品を示す語が含まれています');
  return why.join(' / ');
}

async function fetchProduct(url) {
  const source = detectSource(url);
  if (!source) throw new Error('対応していないURLです');
  if (source !== 'yahoo') {
    throw new Error(`${source} の商品ページ取り込みは未対応です（現在はヤフオクのみ）`);
  }
  return fetchYahoo(url);
}

// ── 状態の対応表 ────────────────────────────────────────
// ヤフオクの定型区分 → eBayのコンディションと英文
const CONDITION_MAP = {
  '新品、未使用': { id: 1000, en: 'New',       note: 'Brand new, unused.' },
  '未使用に近い': { id: 3000, en: 'Near Mint', note: 'Barely used. No noticeable wear.' },
  '目立った傷や汚れなし': { id: 3000, en: 'Excellent', note: 'Light signs of use. No noticeable scratches or stains.' },
  'やや傷や汚れあり': { id: 3000, en: 'Good',   note: 'Visible signs of use, scratches or marks.' },
  '傷や汚れあり':     { id: 3000, en: 'Fair',   note: 'Clear scratches and marks from use.' },
  '全体的に状態が悪い': { id: 7000, en: 'For parts', note: 'Poor overall condition. Sold as-is for parts or repair.' },
};

// ── 型番からのスペック抽出（カメラレンズ）────────────────
const BRANDS = [
  { re: /canon|キヤノン|キャノン/i,        en: 'Canon',   ja: 'キヤノン' },
  { re: /nikon|ニコン|nikkor|ニッコール/i, en: 'Nikon',   ja: 'ニコン' },
  { re: /olympus|オリンパス|zuiko|ズイコー/i, en: 'Olympus', ja: 'オリンパス' },
  { re: /minolta|ミノルタ|rokkor|ロッコール/i, en: 'Minolta', ja: 'ミノルタ' },
  { re: /pentax|ペンタックス|takumar|タクマー/i, en: 'Pentax', ja: 'ペンタックス' },
  { re: /konica|コニカ|hexanon|ヘキサノン/i, en: 'Konica',  ja: 'コニカ' },
  { re: /fuji|フジ|fujinon|フジノン/i,     en: 'Fujifilm', ja: '富士フイルム' },
  { re: /yashica|ヤシカ/i,                 en: 'Yashica', ja: 'ヤシカ' },
  { re: /mamiya|マミヤ/i,                  en: 'Mamiya',  ja: 'マミヤ' },
  { re: /ricoh|リコー|rikenon|リケノン/i,  en: 'Ricoh',   ja: 'リコー' },
];

// マウントは「ブランド + シリーズ表記」で決まる。誤判定すると返品直行なので慎重に
const MOUNTS = [
  { re: /\bm42\b|m42マウント|スクリュー/i,       ebay: 'M42',        label: 'M42 screw mount' },
  { re: /new\s*fd|\bnfd\b|\bfd\b|fdマウント/i,   ebay: 'Canon FD',   label: 'Canon FD',    brand: 'Canon' },
  { re: /\bfl\b/i,                                ebay: 'Canon FL',   label: 'Canon FL',    brand: 'Canon' },
  { re: /ai-?s|\bais\b/i,                         ebay: 'Nikon F',    label: 'Nikon F (Ai-S)', brand: 'Nikon' },
  { re: /\bai\b|ai改/i,                           ebay: 'Nikon F',    label: 'Nikon F (Ai)',   brand: 'Nikon' },
  { re: /om-?system|\bom\b|omマウント/i,          ebay: 'OM Mount',   label: 'Olympus OM',  brand: 'Olympus' },
  { re: /\bmd\b|mdマウント|new\s*md/i,            ebay: 'Minolta MD', label: 'Minolta MD (SR)', brand: 'Minolta' },
  { re: /\bmc\b/i,                                ebay: 'Minolta MD', label: 'Minolta MC (SR)', brand: 'Minolta' },
  { re: /pentax-?a\b|smc\s*a\b/i,                 ebay: 'K Mount',    label: 'Pentax K (KA)', brand: 'Pentax' },
  { re: /pentax-?m\b|smc\s*m\b/i,                 ebay: 'K Mount',    label: 'Pentax K (PK)', brand: 'Pentax' },
  { re: /kマウント|\bk\s*mount\b/i,               ebay: 'K Mount',    label: 'Pentax K',    brand: 'Pentax' },
  { re: /\bar\b|arマウント/i,                     ebay: 'Konica AR',  label: 'Konica AR',   brand: 'Konica' },
];

/** 焦点距離からeBayの Type を決める。マクロ表記があればそちらを優先 */
function lensType(focal, text) {
  if (/macro|マクロ|micro|マイクロ/i.test(text)) return { ebay: 'Macro/Close Up', label: 'Macro' };
  if (focal == null) return { ebay: 'Standard', label: 'Standard / Normal prime' };
  if (focal <= 24) return { ebay: 'Ultra Wide Angle', label: 'Ultra wide angle prime' };
  if (focal <= 35) return { ebay: 'Wide Angle', label: 'Wide angle prime' };
  if (focal <= 60) return { ebay: 'Standard', label: 'Standard / Normal prime' };
  if (focal <= 105) return { ebay: 'Portrait', label: 'Short telephoto / Portrait prime' };
  return { ebay: 'Telephoto', label: 'Telephoto prime' };
}

/**
 * 日本語タイトルとパンくずから、eBayのItem Specificsに入れる値を取り出す。
 * 取れなかった項目は null にして、推測で埋めない（誤ったSpecificsは返品理由になる）。
 */
function extractSpecs(titleJa, breadcrumb = []) {
  const text = `${titleJa} ${breadcrumb.join(' ')}`;

  const brand = BRANDS.find((b) => b.re.test(text)) || null;

  // 焦点距離: 「50mm」「50ｍｍ」。ズームの「28-70mm」は先頭を取らず未対応にする
  const zoom = /(\d{2,3})\s*[-−~〜]\s*(\d{2,3})\s*(?:mm|ｍｍ)/i.test(text);
  const fm = text.match(/(\d{1,3})\s*(?:mm|ｍｍ)/i);
  const focal = !zoom && fm ? Number(fm[1]) : null;

  // 開放F値: 「F1.4」「f/1.4」「1:1.4」。カンマ表記「1,4」も拾う
  const am = text.match(/(?:f\s*\/?\s*|１:|1:)(\d(?:[.,]\d)?)/i);
  const aperture = am ? Number(am[1].replace(',', '.')) : null;

  // マウントはブランドと矛盾しないものだけ採用する
  let mount = null;
  for (const m of MOUNTS) {
    if (!m.re.test(text)) continue;
    if (m.brand && brand && m.brand !== brand.en) continue;
    mount = m;
    break;
  }

  const type = lensType(focal, text);

  return {
    brand_en: brand?.en || null,
    focal_mm: focal,
    aperture,
    mount_ebay: mount?.ebay || null,
    mount_label: mount?.label || null,
    type_ebay: type.ebay,
    type_label: type.label,
    is_zoom: zoom,
  };
}

// ── 英語の出品文を組み立てる ────────────────────────────
/** eBayのタイトルは80文字。検索語を前寄せにして切り詰める */
function buildTitle(s) {
  const parts = [
    s.brand_en,
    s.mount_label && s.brand_en && s.mount_label.startsWith(s.brand_en)
      ? s.mount_label.slice(s.brand_en.length).trim()
      : null,
    s.focal_mm ? `${s.focal_mm}mm` : null,
    s.aperture ? `f/${s.aperture}` : null,
    'Manual Focus',
    s.type_ebay === 'Macro/Close Up' ? 'Macro' : s.type_ebay === 'Standard' ? 'Prime' : s.type_ebay,
    'Lens',
    'from Japan',
  ].filter(Boolean);

  let t = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (t.length > 80) t = t.slice(0, 80).replace(/\s+\S*$/, '');
  return t;
}

function buildDescription(s, cond, extra = {}) {
  const spec = [
    s.mount_label ? `Mount: ${s.mount_label}` : null,
    s.focal_mm ? `Focal length: ${s.focal_mm}mm` : null,
    s.aperture ? `Maximum aperture: f/${s.aperture}` : null,
    'Focus type: Manual focus',
    `Lens type: ${s.type_label}`,
  ].filter(Boolean).join('<br>\n');

  const condLine = cond
    ? `${cond.en}. ${cond.note}`
    : 'Used. Please refer to the photos for the exact condition of this item.';

  // 出品者の説明から拾えた事実を足す。買い手が実際に気にするのは
  // 光学系・動作・付属品の3点で、状態区分だけでは伝わらない
  const f = extra.facts;
  const cap = (a) => a[0].toUpperCase() + a.slice(1);
  const opticsLine = f?.optics?.length ? `<br>Optics: ${cap(f.optics.join(', '))}.` : '';
  const cosmeticLine = f?.cosmetic?.length ? `<br>Barrel: ${cap(f.cosmetic.join(', '))}.` : '';
  const operationLine = f?.operation?.length ? `<br>Operation: ${cap(f.operation.join(', '))}.` : '';
  const included = f?.accessories?.length
    ? `Lens with ${f.accessories.join(', ')}. Please refer to the photos for what is included.`
    : 'Lens only, unless additional items are visible in the photos.';

  return `<p>${buildTitle(s).replace(' from Japan', '')}.</p>
<p><b>Specifications</b><br>
${spec}</p>
<p><b>Condition</b><br>
${condLine}${opticsLine}${cosmeticLine}${operationLine}<br>
Please refer to the photos for the exact item. Any notable points are described in the condition note above.</p>
<p><b>Included</b><br>
${included}</p>
<p><b>Shipping</b><br>
Ships from Japan with tracking. Carefully packed with cushioning material and double-boxed.<br>
Handling time: ${extra.dispatchDays || 5} business days.</p>
<p><b>Returns</b><br>
30-day returns accepted. Buyer pays return shipping.</p>
<p>Please feel free to send us a message if you have any questions.</p>`;
}

/**
 * 仕入先URLひとつから、出品に必要な一式を組み立てる。
 * 価格は呼び出し側（利益計算を持つ ebay-manager）で決めるため、ここでは扱わない。
 */
async function importFromUrl(url) {
  const p = await fetchProduct(url);
  const specs = extractSpecs(p.title_ja, p.breadcrumb);
  const cond = p.condition_ja ? CONDITION_MAP[p.condition_ja] || null : null;
  // 出品者の文章そのものは使わず、そこから読み取れる事実だけを取り出す
  const facts = extractConditionFacts(p.description_ja);

  // Item Specifics は取れた値だけを入れる。埋まらなかったものは呼び出し側で人が補う
  const itemSpecifics = {};
  if (specs.brand_en) itemSpecifics.Brand = specs.brand_en;
  if (specs.focal_mm) itemSpecifics['Focal Length'] = `${specs.focal_mm}mm`;
  if (specs.type_ebay) itemSpecifics.Type = specs.type_ebay;
  itemSpecifics['Focus Type'] = 'Manual';
  if (specs.aperture) itemSpecifics['Maximum Aperture'] = `f/${specs.aperture}`;
  if (specs.mount_ebay) itemSpecifics.Mount = specs.mount_ebay;
  if (specs.brand_en) itemSpecifics['Compatible Brand'] = `For ${specs.brand_en}`;

  const missing = ['Brand', 'Focal Length', 'Maximum Aperture', 'Mount']
    .filter((k) => !itemSpecifics[k]);

  const bundle = detectBundle(p.title_ja);

  const warnings = [];
  // セット出品の警告は最優先。レンズ単体として出品すると「届かない物がある」事故になる
  if (bundle) warnings.push(`セット出品の可能性があります（${bundle}）。レンズ単体として出品しないでください。`);
  if (specs.is_zoom) warnings.push('ズームレンズのようです。スペック抽出はズームに未対応なので手で確認してください。');
  if (!p.condition_ja) warnings.push('「商品の状態」欄を取得できませんでした。状態は手で確認してください。');
  if (missing.length) warnings.push(`Item Specifics が埋まりませんでした: ${missing.join(' / ')}`);
  if (!p.available) warnings.push('この出品は既に終了しています。');

  return {
    supplier: {
      source: p.source,
      url: p.url,
      item_id: p.item_id,
      title_ja: p.title_ja,
      price_jpy: p.price_jpy,
      condition_ja: p.condition_ja,
      available: p.available,
      breadcrumb: p.breadcrumb,
      genre: p.breadcrumb.slice(1).join(' > ') || null,
      description_ja: p.description_ja,
      image_urls: p.image_urls,
      image_count: p.image_urls.length,
      fetched_at: new Date().toISOString(),
    },
    bundle_suspect: !!bundle,
    specs,
    condition_facts: facts,
    listing: {
      title_en: buildTitle(specs),
      description_html: buildDescription(specs, cond, { facts }),
      condition_id: cond?.id ?? 3000,
      condition_en: cond?.en ?? 'Used',
      item_specifics: itemSpecifics,
    },
    // 写真は仕入先から持ってこない。出品前に自分で用意する必要がある
    photos: { included: false, note: '仕入先の写真は転載できません。自社撮影の画像を用意してください。' },
    warnings,
  };
}

module.exports = {
  SUPPORTED, detectSource, fetchProduct, extractSpecs,
  buildTitle, buildDescription, importFromUrl, CONDITION_MAP,
  detectBundle, extractConditionFacts, extractDescription,
};

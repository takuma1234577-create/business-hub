/**
 * 商品画像 一括ダウンローダー
 *
 * ヤフオク / Amazon / 楽天 などの商品ページURLを受け取り、
 * 掲載されている商品画像を抽出して一覧で返す。選んだ画像は
 * サーバー側でまとめて取得し、ZIPにして返す。
 *
 * ── なぜサーバーで画像を取りに行くのか ──────────────────
 * 画像ホストの多くは Referer を見てホットリンクを弾く。ブラウザから
 * 直接 fetch すると CORS でも失敗する。そこでサーバーが正しい
 * Referer / UA を付けて代理取得し、ZIP に固めてから返す。
 *
 * Mounted at '/api/image-downloader'
 *
 * Routes:
 *   POST /extract  { url }                       -> { source, title, images: [{ url, thumb }] }
 *   POST /zip      { url, images: [url], name? }  -> application/zip (バイナリ)
 */

const { Router } = require('express');
const axios = require('axios');
const JSZip = require('jszip');

const router = Router();

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// ── 仕入先の判定 ────────────────────────────────────────
function detectSource(url) {
  if (/auctions\.yahoo\.co\.jp/.test(url)) return 'yahoo';
  if (/shopping\.yahoo\.co\.jp|store\.shopping\.yahoo/.test(url)) return 'yahoo-shopping';
  if (/(^|\.)amazon\.(co\.jp|com|)/.test(url)) return 'amazon';
  if (/rakuten\.co\.jp/.test(url)) return 'rakuten';
  if (/mercari\.com|jp\.mercari/.test(url)) return 'mercari';
  if (/suruga-ya\.jp/.test(url)) return 'suruga';
  return 'generic';
}

// 楽天の店舗ページなどは EUC-JP / Shift_JIS で配信される。文字コードを判定してデコードする。
function decodeHtml(buf, contentType) {
  let charset = '';
  const ctm = /charset=["']?([\w-]+)/i.exec(contentType || '');
  if (ctm) charset = ctm[1].toLowerCase();
  if (!charset) {
    // まず先頭をASCIIとして読み、metaタグから charset を拾う
    const head = buf.slice(0, 4096).toString('latin1');
    const m =
      /<meta[^>]+charset=["']?([\w-]+)/i.exec(head) ||
      /<meta[^>]+content=["'][^"']*charset=([\w-]+)/i.exec(head);
    if (m) charset = m[1].toLowerCase();
  }
  const map = { 'utf8': 'utf-8', 'sjis': 'shift_jis', 'x-sjis': 'shift_jis', 'euc_jp': 'euc-jp', 'eucjp': 'euc-jp' };
  charset = map[charset] || charset || 'utf-8';
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return buf.toString('utf-8');
  }
}

async function fetchHtml(url) {
  let origin = '';
  try {
    origin = new URL(url).origin + '/';
  } catch {
    /* noop */
  }
  const res = await axios.get(url, {
    headers: {
      'User-Agent': UA,
      'Accept-Language': 'ja,en;q=0.8',
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      // 楽天(Akamai)などは素朴なリクエストをボットとして弾く。ブラウザ相当のヘッダーを付ける。
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      ...(origin ? { Referer: origin } : {}),
    },
    timeout: 20000,
    maxRedirects: 5,
    responseType: 'arraybuffer',
    validateStatus: (s) => s >= 200 && s < 400,
  });
  return decodeHtml(Buffer.from(res.data), res.headers['content-type']);
}

// ── 汎用抽出: ld+json / og:image ────────────────────────
function pushImage(set, u) {
  if (!u || typeof u !== 'string') return;
  u = u.trim().replace(/&amp;/g, '&');
  if (!/^https?:\/\//.test(u)) return;
  // データURI・SVGアイコン・明らかなスプライトは除外
  if (/\.svg(\?|$)/i.test(u)) return;
  set.add(u);
}

function extractLdJson(html, set, titleRef) {
  const blocks = [
    ...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi),
  ];
  for (const b of blocks) {
    let obj;
    try {
      obj = JSON.parse(b[1].trim());
    } catch {
      continue;
    }
    const arr = Array.isArray(obj) ? obj : [obj];
    for (const o of arr) {
      const nodes = o && o['@graph'] ? o['@graph'] : [o];
      for (const n of nodes) {
        if (!n || typeof n !== 'object') continue;
        if (n['@type'] === 'Product' || n.image) {
          if (!titleRef.value && n.name) titleRef.value = String(n.name);
          const img = n.image;
          if (typeof img === 'string') pushImage(set, img);
          else if (Array.isArray(img))
            img.forEach((i) => pushImage(set, typeof i === 'string' ? i : i && i.url));
          else if (img && img.url) pushImage(set, img.url);
        }
      }
    }
  }
}

function extractMeta(html, set, titleRef) {
  for (const m of html.matchAll(
    /<meta[^>]+property=["'](?:og:image(?::secure_url)?|twitter:image)["'][^>]+content=["']([^"']+)["']/gi,
  ))
    pushImage(set, m[1]);
  if (!titleRef.value) {
    const t = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
    if (t) titleRef.value = t[1];
    else {
      const tt = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (tt) titleRef.value = tt[1].trim();
    }
  }
}

// 指定ホストにマッチする画像URLを本文から総なめで拾う
function extractByHost(html, set, hostRegex) {
  const re = new RegExp(
    `https?:\\\\?/\\\\?/[^"'\\\\\\s)]*?(?:${hostRegex})[^"'\\\\\\s)]*?\\.(?:jpe?g|png|webp|gif)`,
    'gi',
  );
  for (const m of html.matchAll(re)) {
    pushImage(set, m[0].replace(/\\\//g, '/'));
  }
}

// Amazon専用: メインギャラリーだけを狙う。
// サイト共通UI(/images/G/) や関連商品まで拾わないよう、商品画像 /images/I/ に限定し、
// まずは colorImages.initial（メインギャラリーの正データ）を最優先で読む。
function extractAmazon(html, set) {
  const at = html.indexOf('colorImages');
  if (at !== -1) {
    const win = html.slice(at, at + 200000);
    for (const m of win.matchAll(
      /"(?:hiRes|large)"\s*:\s*"(https:\\?\/\\?\/[^"]*?media-amazon\.com\/images\/I\/[^"]+?)"/gi,
    ))
      pushImage(set, m[1].replace(/\\\//g, '/'));
  }
  // メイン画像のズーム候補 data-a-dynamic-image={"url":[w,h],...}
  for (const m of html.matchAll(/data-a-dynamic-image\s*=\s*(?:"|&quot;)(\{[\s\S]*?\})(?:"|&quot;)/gi)) {
    const json = m[1].replace(/&quot;/g, '"');
    for (const um of json.matchAll(/(https:\/\/[^"'\\]*?media-amazon\.com\/images\/I\/[^"'\\]+)/gi))
      pushImage(set, um[1]);
  }
}

// ── サイト別の正規化（サムネ→フルサイズ、重複除去キー） ──
function normalize(source, url) {
  let u = url;
  if (source === 'amazon') {
    // .../I/XXXX._AC_SX679_.jpg → .../I/XXXX.jpg （サイズ修飾子を除去してフル解像度に）
    u = u.replace(/(\/images\/I\/[^._/]+)\.[^/]*?(\.(?:jpg|jpeg|png|webp))$/i, '$1$2');
  } else if (source === 'rakuten') {
    // ?_ex=128x128 などのリサイズ指定を落とす
    u = u.replace(/\?_ex=\d+x\d+.*$/i, '');
  } else if (source === 'yahoo' || source === 'yahoo-shopping') {
    // ヤフオクのサムネは末尾クエリでサイズ指定される場合がある
    u = u.replace(/\?.*$/i, '');
  } else if (source === 'mercari') {
    u = u.replace(/\/(thumb|small)\//i, '/orig/');
  }
  return u;
}

// 同一画像を1つにまとめるためのキー（拡張子・サイズ差を吸収）
function dedupeKey(source, url) {
  if (source === 'amazon') {
    const m = url.match(/\/images\/I\/([^._/]+)/);
    if (m) return 'amz:' + m[1];
  }
  if (source === 'rakuten') return url.replace(/\?.*$/, '');
  return url.replace(/\?.*$/, '');
}

async function extractImages(url) {
  const source = detectSource(url);
  const html = await fetchHtml(url);
  const raw = new Set();
  const titleRef = { value: '' };

  extractLdJson(html, raw, titleRef);
  extractMeta(html, raw, titleRef);

  if (source === 'amazon') {
    extractAmazon(html, raw);
  } else if (source === 'rakuten') {
    extractByHost(html, raw, 'image\\.rakuten\\.co\\.jp|tshop\\.r10s\\.jp|r\\.r10s\\.jp|shop\\.r10s\\.jp');
  } else if (source === 'yahoo') {
    extractByHost(html, raw, 'yimg\\.jp');
  } else if (source === 'yahoo-shopping') {
    extractByHost(html, raw, 'yimg\\.jp|shopping\\.c\\.yimg\\.jp');
  } else if (source === 'mercari') {
    extractByHost(html, raw, 'mercdn\\.net');
  } else if (source === 'suruga') {
    extractByHost(html, raw, 'suruga-ya\\.jp');
  }

  // 正規化 + 重複除去
  const seen = new Map();
  for (const u of raw) {
    const full = normalize(source, u);
    // ノイズ除去: アイコン・ロゴ・スプライト・バナー・ボタン類
    if (
      /sprite|icon|logo|blank|pixel|1x1|spacer|button|badge|banner|\bbnr\b|\bbtn\b|arrow|footer|header|coupon|campaign|mailmag|point|ranking|_spu|shopping-cart|fav_btn|kanban/i.test(
        full,
      )
    )
      continue;
    // Amazonは商品画像(/images/I/)以外（サイト共通UI /images/G/ や og:image のロゴ）を除外
    if (source === 'amazon' && !/\/images\/I\//.test(full)) continue;
    // 楽天共通の販促バナー配信(r.r10s.jp/com/)は商品画像ではない
    if (source === 'rakuten' && /r\.r10s\.jp\/com\//i.test(full)) continue;
    const key = dedupeKey(source, full);
    if (!seen.has(key)) seen.set(key, full);
  }

  const images = [...seen.values()].map((u) => ({ url: u, thumb: u }));
  return { source, title: titleRef.value || '', images };
}

// ── POST /extract ───────────────────────────────────────
router.post('/extract', async (req, res) => {
  try {
    const url = (req.body && req.body.url ? String(req.body.url) : '').trim();
    if (!/^https?:\/\//.test(url)) {
      return res.status(400).json({ error: '有効なURLを入力してください（http/httpsで始まる商品ページURL）' });
    }
    const result = await extractImages(url);
    if (!result.images.length) {
      return res.status(200).json({
        ...result,
        warning:
          '画像を検出できませんでした。JavaScriptで後から画像を読み込むページ（ログイン必須・ボット判定あり）の可能性があります。',
      });
    }
    res.json(result);
  } catch (err) {
    const status = err.response && err.response.status;
    res.status(500).json({
      error:
        status === 403 || status === 503
          ? 'ページ取得をブロックされました（サイト側のボット対策）。時間をおくか別URLでお試しください。'
          : err.message || '抽出に失敗しました',
    });
  }
});

// ── 画像を代理取得（Referer付き） ───────────────────────
function refererFor(source) {
  switch (source) {
    case 'yahoo':
      return 'https://auctions.yahoo.co.jp/';
    case 'yahoo-shopping':
      return 'https://shopping.yahoo.co.jp/';
    case 'amazon':
      return 'https://www.amazon.co.jp/';
    case 'rakuten':
      return 'https://item.rakuten.co.jp/';
    case 'mercari':
      return 'https://jp.mercari.com/';
    case 'suruga':
      return 'https://www.suruga-ya.jp/';
    default:
      return undefined;
  }
}

function extFromType(ct, url) {
  if (ct) {
    if (/jpe?g/i.test(ct)) return 'jpg';
    if (/png/i.test(ct)) return 'png';
    if (/webp/i.test(ct)) return 'webp';
    if (/gif/i.test(ct)) return 'gif';
  }
  const m = url.match(/\.(jpe?g|png|webp|gif)(?:\?|$)/i);
  return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
}

async function fetchImage(imgUrl, referer) {
  const res = await axios.get(imgUrl, {
    headers: {
      'User-Agent': UA,
      Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
      ...(referer ? { Referer: referer } : {}),
    },
    responseType: 'arraybuffer',
    timeout: 25000,
    maxRedirects: 5,
    validateStatus: (s) => s >= 200 && s < 300,
  });
  return {
    buf: Buffer.from(res.data),
    ext: extFromType(res.headers['content-type'], imgUrl),
  };
}

// ── POST /zip ───────────────────────────────────────────
router.post('/zip', async (req, res) => {
  try {
    const body = req.body || {};
    const url = body.url ? String(body.url) : '';
    const images = Array.isArray(body.images) ? body.images.filter((u) => /^https?:\/\//.test(u)) : [];
    if (!images.length) return res.status(400).json({ error: 'ダウンロードする画像が指定されていません' });
    if (images.length > 100) return res.status(400).json({ error: '一度に取得できるのは100枚までです' });

    const source = detectSource(url);
    const referer = refererFor(source);
    const zip = new JSZip();
    const pad = String(images.length).length;

    // 画像ホストに優しく、少しずつ並列で取得する
    const CONCURRENCY = 6;
    let ok = 0;
    let idx = 0;
    async function worker() {
      while (idx < images.length) {
        const i = idx++;
        try {
          const { buf, ext } = await fetchImage(images[i], referer);
          const name = String(i + 1).padStart(pad, '0');
          zip.file(`${name}.${ext}`, buf);
          ok++;
        } catch {
          // 取得できなかった画像はスキップ（ホットリンク禁止・期限切れなど）
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, images.length) }, worker));

    if (ok === 0) {
      return res.status(502).json({ error: '画像を取得できませんでした（サイト側のアクセス制限の可能性）' });
    }

    const content = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
    const fname = (body.name ? String(body.name) : 'product-images').replace(/[^\w\-]+/g, '_').slice(0, 40) || 'images';
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}.zip"`);
    res.setHeader('X-Image-Count', String(ok));
    res.send(content);
  } catch (err) {
    res.status(500).json({ error: err.message || 'ZIP生成に失敗しました' });
  }
});

router.get('/health', (_req, res) => res.json({ status: 'ok' }));

module.exports = router;
// テスト・再利用向けに内部関数も公開
module.exports.extractImages = extractImages;
module.exports.detectSource = detectSource;

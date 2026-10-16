/**
 * My FITPEAK を Shopify のアプリプロキシで fitpeak.co に出す入口。
 *
 *   https://fitpeak.co/a/my-fitpeak/<path>
 *     → Shopify が署名を付けて GET https://my.fitpeak.co/api/my-fitpeak/proxy/<path>?shop=..&path_prefix=..&timestamp=..&signature=..
 *     → ここで署名を確かめ、空の器（#myfp-root と JS/CSS のタグ）だけを application/liquid で返す
 *     → Shopify がテーマのヘッダー・フッターで包んで表示する
 *
 * 守ること（ユーザー情報を流出させない）:
 *   - DBには触らない。個人情報を一切埋めない。logged_in_customer_id は読まない・出さない
 *   - 署名は timingSafeEqual で比較。timestamp が5分以上ずれたものは拒否
 *   - MYFP_PROXY_SECRET（Shopifyアプリの client secret）が未設定なら必ず拒否
 *   - MYFP_PROXY_SHOP（例 cuiitv-kv.myshopify.com）を設定すると、それ以外のショップを拒否
 *   - 会員データは画面のJSが本人のログイン（Bearer）で /api/my-fitpeak/* から取りに行く
 */

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ENTRY_KEY = 'src/my-fitpeak-embed.tsx';
const MANIFEST_NAME = 'myfp-embed-manifest.json';
const MAX_SKEW_SEC = 300;
const ASSET_RE = /^assets\/[A-Za-z0-9._/-]+\.(?:js|css)$/;

// Shopify の手順: signature 以外を key=value（配列はカンマ連結）にしてソートし、区切り無しで連結 → HMAC-SHA256(hex)
function parseQuery(rawQuery) {
  const out = {};
  for (const [k, v] of new URLSearchParams(rawQuery || '')) {
    if (Object.prototype.hasOwnProperty.call(out, k)) out[k].push(v); else out[k] = [v];
  }
  return out;
}

function verifyProxySignature(rawQuery, secret, nowMs) {
  if (!secret) return { ok: false, reason: 'no-secret' };
  const params = parseQuery(rawQuery);
  const sigs = params.signature;
  if (!sigs || sigs.length !== 1 || !/^[0-9a-f]{64}$/i.test(sigs[0])) return { ok: false, reason: 'no-signature' };
  delete params.signature;

  const message = Object.keys(params)
    .map((k) => `${k}=${params[k].join(',')}`)
    .sort()
    .join('');
  const expected = crypto.createHmac('sha256', secret).update(message).digest();
  const given = Buffer.from(sigs[0], 'hex');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return { ok: false, reason: 'bad-signature' };

  const tsRaw = params.timestamp && params.timestamp.length === 1 ? params.timestamp[0] : '';
  if (!/^\d{1,12}$/.test(tsRaw)) return { ok: false, reason: 'no-timestamp' };
  if (Math.abs(Math.floor(nowMs / 1000) - Number(tsRaw)) > MAX_SKEW_SEC) return { ok: false, reason: 'stale-timestamp' };

  return {
    ok: true,
    shop: params.shop && params.shop.length === 1 ? params.shop[0] : '',
    pathPrefix: params.path_prefix && params.path_prefix.length === 1 ? params.path_prefix[0] : '',
  };
}

// path_prefix（例 /a/my-fitpeak）から Router の basename（例 /a）を作る。形が違えば /a
function basenameFromPrefix(prefix) {
  const m = /^\/(a|apps|community|tools)\/my-fitpeak$/.exec(String(prefix || ''));
  return m ? `/${m[1]}` : '/a';
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildShell({ js, css, basename }) {
  // JSON の < は < にして </script> で抜けられないようにする
  const cfg = JSON.stringify({ basename, embedded: true }).replace(/</g, '\\u003c');
  return [
    '<div id="myfp-root"></div>',
    ...css.map((href) => `<link rel="stylesheet" href="${escapeAttr(href)}">`),
    `<script>window.__MYFP__=${cfg};</script>`,
    `<script type="module" crossorigin src="${escapeAttr(js)}"></script>`,
    '',
  ].join('\n');
}

function entryAssets(manifest, origin) {
  const entry = manifest && manifest[ENTRY_KEY];
  if (!entry || !ASSET_RE.test(entry.file || '') || !/\.js$/.test(entry.file)) throw new Error('bad manifest');
  const css = Array.isArray(entry.css) ? entry.css : [];
  if (!css.every((c) => ASSET_RE.test(c) && /\.css$/.test(c))) throw new Error('bad manifest');
  return { js: `${origin}/${entry.file}`, css: css.map((c) => `${origin}/${c}`) };
}

function createProxyRouter(deps = {}) {
  const getSecret = deps.getSecret || (() => (process.env.MYFP_PROXY_SECRET || '').trim());
  const getShop = deps.getShop || (() => (process.env.MYFP_PROXY_SHOP || '').trim());
  const now = deps.now || (() => Date.now());
  const assetOrigin = deps.assetOrigin || (() => require('./my-fitpeak-urls.cjs').myFitpeakApiBase());
  const loadManifest = deps.loadManifest || productionManifestLoader(assetOrigin);

  const router = express.Router();
  router.get('/{*rest}', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Robots-Tag', 'noindex, nofollow');
    const rawQuery = (req.originalUrl.split('?')[1] || '').split('#')[0];
    const v = verifyProxySignature(rawQuery, getSecret(), now());
    const shop = getShop();
    if (!v.ok || (shop && v.shop !== shop)) {
      // 理由だけ残す（秘密・署名・クエリの値は出さない）
      console.warn(`[my-fitpeak/proxy] rejected: ${v.ok ? 'shop-mismatch' : v.reason}`);
      return res.status(401).type('text/plain').send('Unauthorized');
    }
    let assets;
    try {
      assets = entryAssets(await loadManifest(), String(assetOrigin()).replace(/\/+$/, ''));
    } catch (err) {
      console.error('[my-fitpeak/proxy] manifest unavailable:', err.message);
      return res.status(503).type('text/plain').send('Temporarily unavailable');
    }
    res.status(200).set('Content-Type', 'application/liquid; charset=utf-8')
      .send(buildShell({ ...assets, basename: basenameFromPrefix(v.pathPrefix) }));
  });
  router.all('/{*rest}', (_req, res) => res.status(405).type('text/plain').send('Method Not Allowed'));
  return router;
}

// 本番: ビルドで dist/ に出した JSON を読む。関数から見えなければ自分の公開URLから取得（5分覚える）
function productionManifestLoader(assetOrigin) {
  let cache = null;
  return async () => {
    if (cache && Date.now() - cache.at < 5 * 60 * 1000) return cache.data;
    let data = null;
    try {
      data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'dist', MANIFEST_NAME), 'utf8'));
    } catch { /* 関数に同梱されていない場合は下で取得 */ }
    if (!data) {
      const r = await fetch(`${String(assetOrigin()).replace(/\/+$/, '')}/${MANIFEST_NAME}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`manifest fetch ${r.status}`);
      data = await r.json();
    }
    cache = { at: Date.now(), data };
    return data;
  };
}

module.exports = { createProxyRouter, verifyProxySignature, basenameFromPrefix, MANIFEST_NAME, ENTRY_KEY };

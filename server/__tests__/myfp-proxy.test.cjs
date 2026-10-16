// My FITPEAK を Shopify アプリプロキシ（https://fitpeak.co/a/my-fitpeak/...）で出すための入口
// 実行: node --test server/__tests__/myfp-proxy.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { createProxyRouter } = require('../my-fitpeak-proxy.cjs');

const SECRET = 'test-proxy-secret';
const NOW = Date.parse('2026-10-16T05:00:00Z');
const NOW_S = Math.floor(NOW / 1000);
const MANIFEST = {
  'src/my-fitpeak-embed.tsx': {
    file: 'assets/myfp/my-fitpeak-embed-AbC123.js',
    css: ['assets/myfp/my-fitpeak-embed-XyZ789.css'],
    isEntry: true,
  },
};

// Shopify の署名（テスト側で独立に計算する）
function sign(params, secret = SECRET) {
  const msg = Object.keys(params).sort()
    .map((k) => `${k}=${Array.isArray(params[k]) ? params[k].join(',') : params[k]}`)
    .join('');
  return crypto.createHmac('sha256', secret).update(msg).digest('hex');
}
function qs(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((x) => sp.append(k, x)); else sp.append(k, v);
  }
  return sp.toString();
}
function baseParams(extra = {}) {
  return { shop: 'cuiitv-kv.myshopify.com', logged_in_customer_id: '', path_prefix: '/a/my-fitpeak', timestamp: String(NOW_S), ...extra };
}

let server, base, opts;
async function start(o = {}) {
  opts = {
    getSecret: () => SECRET,
    getShop: () => '',
    now: () => NOW,
    loadManifest: async () => MANIFEST,
    assetOrigin: () => 'https://my.fitpeak.co',
    ...o,
  };
  const app = express();
  app.use('/api/my-fitpeak/proxy', createProxyRouter(opts));
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/my-fitpeak/proxy`;
}
test.afterEach(() => new Promise((r) => server.close(r)));

async function get(path, params) {
  const p = { ...params };
  const res = await fetch(`${base}${path}?${qs(p)}`);
  return { res, body: await res.text() };
}

test('正しい署名なら liquid のシェルを返す（DBに触らない・個人情報なし）', async () => {
  await start();
  const p = baseParams();
  const { res, body } = await get('/orders/123', { ...p, signature: sign(p) });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^application\/liquid/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.match(res.headers.get('x-robots-tag'), /noindex/);
  assert.match(body, /<div id="myfp-root"><\/div>/);
  assert.match(body, /<script type="module" crossorigin src="https:\/\/my\.fitpeak\.co\/assets\/myfp\/my-fitpeak-embed-AbC123\.js"><\/script>/);
  assert.match(body, /<link rel="stylesheet" href="https:\/\/my\.fitpeak\.co\/assets\/myfp\/my-fitpeak-embed-XyZ789\.css">/);
  assert.match(body, /window\.__MYFP__=\{"basename":"\/a","embedded":true\}/);
  // Liquid として解釈される記号を出さない
  assert.doesNotMatch(body, /\{\{|\{%/);
});

test('ログイン中の Shopify 顧客IDを渡されても使わない・出さない（誰が見ても同じ応答）', async () => {
  await start();
  const anon = baseParams();
  const other = baseParams({ logged_in_customer_id: '987654321' });
  const a = await get('/', { ...anon, signature: sign(anon) });
  const b = await get('/', { ...other, signature: sign(other) });
  assert.equal(b.res.status, 200);
  assert.doesNotMatch(b.body, /987654321/);
  assert.equal(a.body, b.body);
});

test('署名なしは 401', async () => {
  await start();
  const { res, body } = await get('/', baseParams());
  assert.equal(res.status, 401);
  assert.doesNotMatch(body, /myfp-root/);
});

test('改ざん（署名後にパラメータを変更）は 401', async () => {
  await start();
  const p = baseParams();
  const sig = sign(p);
  const { res } = await get('/', { ...p, logged_in_customer_id: '1', signature: sig });
  assert.equal(res.status, 401);
  const r2 = await get('/', { ...p, signature: sig.replace(/^./, (c) => (c === 'a' ? 'b' : 'a')) });
  assert.equal(r2.res.status, 401);
  const r3 = await get('/', { ...p, signature: 'zz' });
  assert.equal(r3.res.status, 401);
});

test('別の秘密鍵で作った署名は 401', async () => {
  await start();
  const p = baseParams();
  const { res } = await get('/', { ...p, signature: sign(p, 'other-secret') });
  assert.equal(res.status, 401);
});

test('古い（5分より前）・未来すぎる・数値でない timestamp は 401', async () => {
  await start();
  for (const ts of [String(NOW_S - 301), String(NOW_S + 301), 'abc', '']) {
    const p = baseParams({ timestamp: ts });
    const { res } = await get('/', { ...p, signature: sign(p) });
    assert.equal(res.status, 401, `timestamp=${ts}`);
  }
  const ok = baseParams({ timestamp: String(NOW_S - 120) });
  assert.equal((await get('/', { ...ok, signature: sign(ok) })).res.status, 200);
});

test('MYFP_PROXY_SECRET 未設定なら必ず拒否（空の鍵で作った署名も通さない）', async () => {
  await start({ getSecret: () => '' });
  const p = baseParams();
  assert.equal((await get('/', { ...p, signature: sign(p, '') })).res.status, 401);
  assert.equal((await get('/', { ...p, signature: sign(p) })).res.status, 401);
});

test('配列のパラメータはカンマで連結して検証する', async () => {
  await start();
  const p = baseParams({ ids: ['1', '2'] });
  assert.equal((await get('/', { ...p, signature: sign(p) })).res.status, 200);
});

test('ショップを指定している場合、別のショップからの呼び出しは 401', async () => {
  await start({ getShop: () => 'cuiitv-kv.myshopify.com' });
  const other = baseParams({ shop: 'evil.myshopify.com' });
  assert.equal((await get('/', { ...other, signature: sign(other) })).res.status, 401);
  const mine = baseParams();
  assert.equal((await get('/', { ...mine, signature: sign(mine) })).res.status, 200);
});

test('path_prefix に変な値が来ても basename は安全な値（スクリプトに入り込まない）', async () => {
  await start();
  const p = baseParams({ path_prefix: '/a/my-fitpeak"</script><script>alert(1)</script>' });
  const { res, body } = await get('/', { ...p, signature: sign(p) });
  assert.equal(res.status, 200);
  assert.doesNotMatch(body, /alert\(1\)/);
  assert.match(body, /"basename":"\/a"/);
  const q = baseParams({ path_prefix: '/apps/my-fitpeak' });
  assert.match((await get('/', { ...q, signature: sign(q) })).body, /"basename":"\/apps"/);
});

test('ビルド情報が読めないときは 503（壊れたページを出さない）', async () => {
  await start({ loadManifest: async () => { throw new Error('no manifest'); } });
  const p = baseParams();
  assert.equal((await get('/', { ...p, signature: sign(p) })).res.status, 503);
});

test('ビルド情報のファイル名が想定外の形なら使わない', async () => {
  await start({ loadManifest: async () => ({ 'src/my-fitpeak-embed.tsx': { file: '"><script>x</script>.js', css: [] } }) });
  const p = baseParams();
  const { res, body } = await get('/', { ...p, signature: sign(p) });
  assert.equal(res.status, 503);
  assert.doesNotMatch(body, /<script>x/);
});

test('GET 以外は受け付けない', async () => {
  await start();
  const p = baseParams();
  const res = await fetch(`${base}/?${qs({ ...p, signature: sign(p) })}`, { method: 'POST' });
  assert.notEqual(res.status, 200);
});

// 拒否の理由（秘密は含めない）をログ用に返す
test('verifyProxySignature: 拒否の理由を返す', () => {
  const { verifyProxySignature } = require('../my-fitpeak-proxy.cjs')._internal || require('../my-fitpeak-proxy.cjs');
  assert.equal(verifyProxySignature('shop=a&timestamp=1', '', Date.now()).reason, 'no-secret');
  assert.equal(verifyProxySignature('shop=a&timestamp=1', 'k', Date.now()).reason, 'no-signature');
  assert.equal(verifyProxySignature('shop=a&timestamp=1&signature=' + '0'.repeat(64), 'k', Date.now()).reason, 'bad-signature');
});

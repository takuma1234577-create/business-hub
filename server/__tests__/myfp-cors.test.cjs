// My FITPEAK 会員API（/api/my-fitpeak/*）の CORS は fitpeak.co と my.fitpeak.co だけ
// 実行: node --test server/__tests__/myfp-cors.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { myFitpeakCors, isMyFitpeakApiPath } = require('../my-fitpeak-cors.cjs');

let server, base;
test.beforeEach(async () => {
  const app = express();
  app.use('/api/my-fitpeak', myFitpeakCors(), (_req, res) => res.json({ ok: true }));
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/my-fitpeak`;
});
test.afterEach(() => new Promise((r) => server.close(r)));

test('fitpeak.co と my.fitpeak.co からは読める（* ではなくその Origin を返す）', async () => {
  for (const origin of ['https://fitpeak.co', 'https://my.fitpeak.co']) {
    const res = await fetch(`${base}/orders`, { headers: { Origin: origin } });
    assert.equal(res.headers.get('access-control-allow-origin'), origin);
    assert.match(res.headers.get('vary') || '', /Origin/);
    assert.equal(res.headers.get('access-control-allow-credentials'), null);
  }
});

test('他のサイトからは CORS ヘッダーを付けない（ブラウザが読めない）', async () => {
  for (const origin of ['https://evil.example', 'https://fitpeak.co.evil.example', 'null', 'http://fitpeak.co']) {
    const res = await fetch(`${base}/orders`, { headers: { Origin: origin } });
    assert.equal(res.headers.get('access-control-allow-origin'), null, origin);
  }
});

test('プリフライト: 許可した Origin だけ Authorization ヘッダーを通す', async () => {
  const ok = await fetch(`${base}/orders`, { method: 'OPTIONS', headers: { Origin: 'https://fitpeak.co', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://fitpeak.co');
  assert.match((ok.headers.get('access-control-allow-headers') || '').toLowerCase(), /authorization/);
  const ng = await fetch(`${base}/orders`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(ng.headers.get('access-control-allow-origin'), null);
});

test('MYFP_CORS_ORIGINS で追加できる', async () => {
  process.env.MYFP_CORS_ORIGINS = 'https://cuiitv-kv.myshopify.com';
  try {
    const res = await fetch(`${base}/orders`, { headers: { Origin: 'https://cuiitv-kv.myshopify.com' } });
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://cuiitv-kv.myshopify.com');
  } finally { delete process.env.MYFP_CORS_ORIGINS; }
});

test('全体の cors() を外す対象の判定', () => {
  assert.equal(isMyFitpeakApiPath('/api/my-fitpeak'), true);
  assert.equal(isMyFitpeakApiPath('/api/my-fitpeak/orders'), true);
  assert.equal(isMyFitpeakApiPath('/api/my-fitpeakx'), false);
  assert.equal(isMyFitpeakApiPath('/api/public/reviews/1'), false);
});

// cronの認証: x-vercel-cron ヘッダーは誰でも付けられるので通さない。Authorization: Bearer ${CRON_SECRET} だけを通す。node server/__tests__/cron-auth.test.cjs
const assert = require('node:assert/strict');
process.env.SUPABASE_URL ||= 'http://127.0.0.1:9'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'sb_secret_dummy';   // 読み込みだけ（通信しない）
process.env.CRON_SECRET = 'test-cron-secret-0123456789';
const { authMiddleware } = require('../auth.cjs');

// 認証付きの管理APIに対して1回だけ通す。next が呼ばれたら 'next'、拒否なら status を返す
function run(headers, path = '/api/accounting/summary') {
  return new Promise((resolve) => {
    const req = { path, headers };
    const res = {
      status(code) { this.code = code; return this; },
      json() { resolve(this.code); return this; },
    };
    authMiddleware(req, res, () => resolve('next'));
  });
}

(async () => {
  // 偽造した x-vercel-cron ヘッダーだけでは通らない
  assert.equal(await run({ 'x-vercel-cron': '1' }), 401);
  // Vercel Cron が送る Authorization: Bearer ${CRON_SECRET} は通る
  assert.equal(await run({ authorization: 'Bearer test-cron-secret-0123456789' }), 'next');
  // 違う秘密は通らない（セッション照合に回って拒否）
  assert.equal(await run({ authorization: 'Bearer wrong-secret', 'x-vercel-cron': '1' }), 401);

  // CRON_SECRET が未設定なら、空の Bearer で通ってしまわない
  delete process.env.CRON_SECRET;
  assert.equal(await run({ authorization: 'Bearer ' }), 401);
  assert.equal(await run({ authorization: 'Bearer undefined' }), 401);

  console.log('cron-auth: ok');
})().catch((e) => { console.error(e); process.exit(1); });

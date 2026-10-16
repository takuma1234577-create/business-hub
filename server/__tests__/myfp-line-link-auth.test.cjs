// POST /api/my-fitpeak/line-link: 画面から送られた lineUserId をそのまま信用しない。
// LIFF のトークンをサーバーで検証できたときだけ、そのLINEユーザーとして扱う。
// node server/__tests__/myfp-line-link-auth.test.cjs
const assert = require('node:assert/strict');
process.env.SUPABASE_URL ||= 'http://127.0.0.1:9'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'sb_secret_dummy';
const { resolveLinkLineUser } = require('../my-fitpeak.cjs')._internal;

const verifier = {
  async verifyIdToken(t) { if (t === 'good-id') return { lineUserId: 'Uvictim-from-id' }; throw new Error('bad'); },
  async verifyAccessToken(t) { if (t === 'good-at') return { lineUserId: 'Ufrom-at' }; throw new Error('bad'); },
};

(async () => {
  // 生の lineUserId だけでは受け付けない
  assert.deepEqual(await resolveLinkLineUser({ lineUserId: 'Uvictim' }, verifier), { error: 'invalid' });
  // 検証できないトークンは拒否
  assert.deepEqual(await resolveLinkLineUser({ liffAccessToken: 'forged' }, verifier), { error: 'invalid' });
  // 検証できたトークンのユーザーになる（一緒に送られた lineUserId は無視）
  assert.deepEqual(await resolveLinkLineUser({ liffAccessToken: 'good-at', lineUserId: 'Uvictim' }, verifier), { lineUserId: 'Ufrom-at' });
  assert.deepEqual(await resolveLinkLineUser({ liffIdToken: 'good-id' }, verifier), { lineUserId: 'Uvictim-from-id' });
  // LIFF のトークンが無ければ「コード方式」に回す
  assert.deepEqual(await resolveLinkLineUser({ code: 'abc' }, verifier), { viaCode: true });
  assert.deepEqual(await resolveLinkLineUser({}, verifier), { error: 'missing' });
  console.log('myfp-line-link-auth: ok');
})().catch(e => { console.error(e); process.exit(1); });

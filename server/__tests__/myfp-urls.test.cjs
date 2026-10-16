// My FITPEAK: 「APIの場所(my.fitpeak.co)」と「画面の場所(MY_FITPEAK_APP_URL)」の切り分け
// 実行: node --test server/__tests__/myfp-urls.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');

const KEYS = ['MY_FITPEAK_APP_URL', 'MY_FITPEAK_BASE_URL', 'MY_FITPEAK_URL'];
function withEnv(env, fn) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  try { return fn(require('../my-fitpeak-urls.cjs')); } finally {
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

test('既定は従来どおり my.fitpeak.co', () => withEnv({}, (u) => {
  assert.equal(u.myFitpeakApiBase(), 'https://my.fitpeak.co');
  assert.equal(u.myFitpeakAppBase(), 'https://my.fitpeak.co');
  assert.equal(u.isAppMoved(), false);
  assert.equal(u.myFitpeakPageUrl('/my-fitpeak/pro'), 'https://my.fitpeak.co/my-fitpeak/pro');
  assert.equal(u.myFitpeakPageUrl('/creashot'), 'https://my.fitpeak.co/creashot');
  assert.equal(u.lineLoginSuccessUrl('H', '/my-fitpeak'), 'https://my.fitpeak.co/my-fitpeak/login#lt=H&next=%2Fmy-fitpeak');
}));

test('MY_FITPEAK_APP_URL で画面のリンクだけが一斉に切り替わる', () => withEnv({ MY_FITPEAK_APP_URL: 'https://fitpeak.co/a/' }, (u) => {
  assert.equal(u.myFitpeakAppBase(), 'https://fitpeak.co/a');
  assert.equal(u.isAppMoved(), true);
  assert.equal(u.myFitpeakPageUrl('/my-fitpeak'), 'https://fitpeak.co/a/my-fitpeak');
  assert.equal(u.myFitpeakPageUrl('/my-fitpeak/gotore/x'), 'https://fitpeak.co/a/my-fitpeak/gotore/x');
  // /my-fitpeak 以外（旧アプリ側の画面）は my.fitpeak.co のまま
  assert.equal(u.myFitpeakPageUrl('/creashot'), 'https://my.fitpeak.co/creashot');
  // APIとLINEのコールバックは my.fitpeak.co のまま
  assert.equal(u.myFitpeakApiBase(), 'https://my.fitpeak.co');
  assert.equal(u.lineCallbackUrl(), 'https://my.fitpeak.co/api/my-fitpeak/auth/line/callback');
}));

test('画面の場所に https 以外や認証情報付きURLは使わない（設定ミスでも既定に戻す）', () => {
  withEnv({ MY_FITPEAK_APP_URL: 'javascript:alert(1)' }, (u) => assert.equal(u.myFitpeakAppBase(), 'https://my.fitpeak.co'));
  withEnv({ MY_FITPEAK_APP_URL: 'https://user:pw@fitpeak.co/a' }, (u) => assert.equal(u.myFitpeakAppBase(), 'https://my.fitpeak.co'));
  withEnv({ MY_FITPEAK_APP_URL: 'http://localhost:5173' }, (u) => assert.equal(u.myFitpeakAppBase(), 'http://localhost:5173'));
});

test('LINEログインの戻り先: 成功は画面の場所へ #lt=（クエリに出さない）、失敗も画面の場所へ', () => withEnv({ MY_FITPEAK_APP_URL: 'https://fitpeak.co/a' }, (u) => {
  const ok = u.lineLoginSuccessUrl('HASH123', '/my-fitpeak/pro');
  assert.equal(ok, 'https://fitpeak.co/a/my-fitpeak/login#lt=HASH123&next=%2Fmy-fitpeak%2Fpro');
  assert.equal(new URL(ok).search, '');
  // 戻り先が外部なら既定へ
  assert.ok(u.lineLoginSuccessUrl('H', '//evil.example').endsWith('next=%2Fmy-fitpeak'));
  const ng = u.lineLoginFailUrl('キャンセル');
  assert.ok(ng.startsWith('https://fitpeak.co/a/my-fitpeak/login?line_error='));
}));

test('戻り先(next)は My FITPEAK の中だけ。外部や // は既定に戻す', () => withEnv({}, (u) => {
  assert.equal(u.safeNext('/my-fitpeak/orders/1'), '/my-fitpeak/orders/1');
  assert.equal(u.safeNext('/my-fitpeak?x=1'), '/my-fitpeak?x=1');
  assert.equal(u.safeNext('//evil.example/my-fitpeak'), '/my-fitpeak');
  assert.equal(u.safeNext('https://evil.example'), '/my-fitpeak');
  assert.equal(u.safeNext('/my-fitpeak//evil.example'), '/my-fitpeak');
  assert.equal(u.safeNext('/my-fitpeakevil'), '/my-fitpeak');
  assert.equal(u.safeNext('/my-fitpeak/\\evil'), '/my-fitpeak');
  assert.equal(u.safeNext(undefined), '/my-fitpeak');
}));

test('ワンタイムトークン付きのリンクは画面を移しても my.fitpeak.co のまま（fitpeak.co のURLにトークンを出さない）', () => withEnv({ MY_FITPEAK_APP_URL: 'https://fitpeak.co/a' }, (u) => {
  assert.equal(u.myFitpeakTokenLinkUrl('/my-fitpeak/pro', 'alt', 'tok'), 'https://my.fitpeak.co/my-fitpeak/pro?alt=tok');
  assert.equal(u.myFitpeakTokenLinkUrl('/', 'code', 't 2'), 'https://my.fitpeak.co/?code=t%202');
}));

test('MY_FITPEAK_URL（旧名）が設定されていれば旧アプリ側の画面とトークンリンクはそれを使う', () => withEnv({ MY_FITPEAK_URL: 'https://old.example' }, (u) => {
  assert.equal(u.myFitpeakPageUrl('/creashot'), 'https://old.example/creashot');
  assert.equal(u.myFitpeakTokenLinkUrl('/creashot', 'alt', 'x'), 'https://old.example/creashot?alt=x');
}));

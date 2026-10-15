// 計測タグ fa.js を疑似ブラウザで動かす。NAVI(Next.js)のような読み込みなしの画面遷移でも、ページごとに数えること
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { TRACKER_JS } = require('../server/site-analytics.cjs');

function browser(url) {
  const sent = [];
  const store = {};
  const listeners = {};
  const loc = new URL(url);
  const location = { get pathname() { return loc.pathname; }, get href() { return loc.href; }, get search() { return loc.search; }, get hostname() { return loc.hostname; } };
  const setUrl = (u) => { const n = new URL(u, loc.href); loc.href = n.href; };
  const history = { pushState(_s, _t, u) { if (u != null) setUrl(u); }, replaceState(_s, _t, u) { if (u != null) setUrl(u); } };
  const el = { scrollHeight: 2000, offsetHeight: 2000, scrollWidth: 400 };
  const document = {
    currentScript: { getAttribute: (k) => (k === 'data-site' ? 'navi.fitpeak.co' : null), src: 'https://my.fitpeak.co/api/public/site-analytics/fa.js' },
    referrer: 'https://www.google.com/', title: 'NAVI', visibilityState: 'visible', body: el, documentElement: el,
    addEventListener: () => {},
  };
  const win = {
    location, history, document, innerWidth: 390, innerHeight: 800, scrollY: 0,
    navigator: { userAgent: 'Mozilla/5.0 iPhone' },
    localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    fetch: async (_u, o) => { JSON.parse(o.body).events.forEach((e) => sent.push(e)); return {}; },
    XMLHttpRequest: function () {}, Blob: function (p) { this.p = p; },
    setInterval: () => 0, setTimeout: (f) => { f(); return 0; }, Date, Math, JSON, URL, Promise,
    addEventListener: (t, f) => { (listeners[t] ||= []).push(f); },
  };
  win.XMLHttpRequest.prototype = { open() {} };
  win.window = win;
  vm.runInNewContext(TRACKER_JS, win);
  return { win, sent, fire: (t) => (listeners[t] || []).forEach((f) => f({})) };
}

test('最初の読み込みで1回 pageview を送り、サイト名は data-site', () => {
  const b = browser('https://navi.fitpeak.co/');
  const pv = b.sent.filter((e) => e.t === 'pageview');
  assert.equal(pv.length, 1);
  assert.equal(pv[0].site, 'navi.fitpeak.co');
  assert.equal(pv[0].path, '/');
});

test('pushState でパスが変わったら、前のページの leave と新しいページの pageview を送る', () => {
  const b = browser('https://navi.fitpeak.co/');
  b.win.history.pushState({}, '', '/articles/a');
  const pv = b.sent.filter((e) => e.t === 'pageview');
  assert.equal(pv.length, 2);
  assert.equal(pv[1].path, '/articles/a');
  assert.notEqual(pv[1].pv, pv[0].pv, '新しいページは別の閲覧ID');
  assert.equal(pv[1].sid, pv[0].sid, '同じ訪問のまま');
  assert.equal(pv[1].ref, 'https://navi.fitpeak.co/', '参照元は前のページ');
  const leave = b.sent.find((e) => e.t === 'leave');
  assert.ok(leave, '前のページの離脱を送る');
  assert.equal(leave.path, '/', '離脱は前のページのパスで');
  assert.equal(leave.pv, pv[0].pv);
});

test('クエリだけの変化や replaceState で同じパスなら数えない', () => {
  const b = browser('https://navi.fitpeak.co/p/x');
  b.win.history.replaceState({}, '', '/p/x?variant=2');
  b.win.history.pushState({}, '', '/p/x?tab=1');
  assert.equal(b.sent.filter((e) => e.t === 'pageview').length, 1);
});

test('戻る(popstate)でも数える', () => {
  const b = browser('https://navi.fitpeak.co/');
  b.win.history.pushState({}, '', '/home-gym');
  b.win.history.replaceState({}, '', '/');
  b.fire('popstate');
  const pv = b.sent.filter((e) => e.t === 'pageview').map((e) => e.path);
  assert.deepEqual(pv, ['/', '/home-gym', '/']);
});

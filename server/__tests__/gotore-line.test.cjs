// 合トレナビ：ボタンから公式LINEに友だち追加した人へ、掲示板とプロフィール設定の案内を送る
// 実行: node --test server/__tests__/gotore-line.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGotoreLine } = require('../gotore-line.cjs');

const SRC = 'src-gotore';
function setup({ clicks = {}, latest = null, gyms = { 'gym-a': { id: 'g-uuid-1', name: 'ONE STEP' } } } = {}) {
  const pushed = [], calls = [], claimed = new Set();
  const deps = {
    baseUrl: 'https://my.fitpeak.co',
    gotoreSourceId: async () => SRC,
    loadClick: async (id) => clicks[id] || null,
    latestClick: async () => latest,
    pushLine: async (to, text) => { pushed.push({ to, text }); },
    rpc: async (fn, args) => {
      calls.push([fn, args]);
      if (fn === 'gt_claim_invite') { if (claimed.has(args.p_click)) return false; claimed.add(args.p_click); return true; }
      if (fn === 'gt_gym_public') return { gym: gyms[args.p_handle] || null };
      if (fn === 'gt_member_for_line') return 'member-1';
      if (fn === 'gt_watch') return { watching: true };
      throw new Error('unexpected ' + fn);
    },
  };
  return { gl: createGotoreLine(deps), pushed, calls };
}
const click = (over = {}) => ({ click_id: 'c1', source_id: SRC, utm_content: 'gotore_main', utm_term: 'gym-a', ...over });

test('友だち追加されたら、そのジムの掲示板とプロフィール設定のURLをLINEで送り、通常のあいさつは止める', async () => {
  const { gl, pushed } = setup({ latest: click() });
  assert.equal(await gl.onFollow({ lineUserId: 'U1', trafficSourceId: SRC }), true);
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].to, 'U1');
  assert.match(pushed[0].text, /ONE STEP/);
  // 記事名（日本語）を含む長いURLにせず、掲示板のIDで短くする（LINEで読みやすく）
  assert.match(pushed[0].text, /^https:\/\/my\.fitpeak\.co\/my-fitpeak\/gotore\/b\/g-uuid-1$/m);
  assert.match(pushed[0].text, /^https:\/\/my\.fitpeak\.co\/my-fitpeak\/gotore\/profile\?b=g-uuid-1$/m);
});

test('「募集が出たらLINEで知らせる」から来た人は、通知待ちにも自動で登録する', async () => {
  const { gl, pushed, calls } = setup({ latest: click({ utm_content: 'gotore_watch' }) });
  await gl.onFollow({ lineUserId: 'U1', trafficSourceId: SRC });
  assert.deepEqual(calls.find((c) => c[0] === 'gt_watch')[1], { p_member: 'member-1', p_handle: 'gym-a', p_on: true });
  assert.match(pushed[0].text, /ONE STEP で合トレ募集が出たら、このLINEでお知らせします/);
});

test('合トレナビ以外の経路の友だち追加には何もしない（通常のあいさつのまま）', async () => {
  const { gl, pushed } = setup({ latest: click() });
  assert.equal(await gl.onFollow({ lineUserId: 'U1', trafficSourceId: 'other' }), false);
  assert.equal(pushed.length, 0);
});

test('webhookとLIFFの両方から来ても、案内は1回だけ', async () => {
  const { gl, pushed } = setup({ latest: click(), clicks: { c1: click() } });
  await gl.onFollow({ lineUserId: 'U1', trafficSourceId: SRC });
  assert.equal(await gl.onLiffFriend({ lineUserId: 'U1', clickId: 'c1' }), true);
  assert.equal(pushed.length, 1);
});

test('もともと友だちの人がボタンを押したとき（LIFFで友だち判定済み）も案内を送る', async () => {
  const { gl, pushed } = setup({ clicks: { c9: click({ click_id: 'c9' }) } });
  assert.equal(await gl.onLiffFriend({ lineUserId: 'U2', clickId: 'c9' }), true);
  assert.equal(pushed[0].to, 'U2');
});

test('掲示板が分からないとき（キー無し・存在しないジム）は合トレナビのトップへ案内する', async () => {
  for (const term of [null, 'nope', 'a/b']) {
    const { gl, pushed, calls } = setup({ latest: click({ utm_term: term, utm_content: 'gotore_watch' }) });
    await gl.onFollow({ lineUserId: 'U1', trafficSourceId: SRC });
    assert.match(pushed[0].text, /https:\/\/my\.fitpeak\.co\/my-fitpeak\/gotore\n/);
    assert.ok(!calls.some((c) => c[0] === 'gt_watch'), '存在しない掲示板を通知待ちにしない');
  }
});

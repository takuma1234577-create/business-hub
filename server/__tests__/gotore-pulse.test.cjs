// 合トレナビの「近未来UI」用の公開集計（シンクロ率診断・トレーニング時計・ジム・ギャラクシー）
// 実行: node --test server/__tests__/gotore-pulse.test.cjs
// 返すのは件数（3未満は "few" にぼかす）と、誰でも可の募集の大まかな条件だけ。
// ニックネーム・自己紹介・募集文・会員ID・LINE ID・性別・同性のみの募集の中身は返さない。
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createDb, pgRpc } = require('./helpers/gotore-pg.cjs');
const { createPublicRouter } = require('../gotore.cjs');

let h;
test.beforeEach(async () => { h = await createDb(); });

const POST = { p_slots: ['wd_night'], p_parts: ['chest'], p_goals: ['spot'], p_gender_pref: 'any', p_note: '胸の日に補助をお願いしたいです' };
const post = (member, handle = 'gym-a', over = {}) =>
  h.call('gt_post_create', { p_member: member, p_handle: handle, ...POST, ...over });
const pulse = (pref = null) => h.call('gt_public_pulse', { p_pref: pref });

async function people(n, over = {}) {
  const out = [];
  for (let i = 0; i < n; i++) { const m = await h.member(); await h.profile(m, { nickname: `ひみつ${i}`, bio: '自己紹介ひみつ', ...over }); out.push(m); }
  return out;
}

async function seed() {
  await h.gym('gym-a', 'ONE STEP', '東京都', '渋谷区');
  await h.gym('gym-k', 'B-fit24 長嶺', '熊本県', '熊本市');
  const ms = await people(5);
  // 東京：平日夜×4（うち1件は同性のみ）、熊本：土日昼×1
  await post(ms[0], 'gym-a');
  await post(ms[1], 'gym-a', { p_goals: ['form'] });
  await post(ms[2], 'gym-a', { p_parts: ['legs'] });
  await post(ms[3], 'gym-a', { p_gender_pref: 'same' });
  await post(ms[4], 'gym-k', { p_slots: ['we_pm'], p_parts: ['legs'] });
  return ms;
}

test('時間帯・部位・レベルの件数：3件以上は数字、1〜2件は few、0件は0（少数の人を特定させない）', async () => {
  await seed();
  const r = await pulse();
  assert.equal(r.slots.wd_night, 4);
  assert.equal(r.slots.we_pm, 'few');
  assert.equal(r.slots.wd_am, 0);
  assert.equal(r.parts.chest, 3);
  assert.equal(r.parts.legs, 'few');
  assert.equal(r.levels.intermediate, 5);
  assert.equal(r.levels.beginner, 0);
  assert.deepEqual(Object.keys(r.slots).sort(), ['wd_am', 'wd_night', 'wd_pm', 'we_am', 'we_night', 'we_pm']);
});

test('県を指定するとその県だけを数える', async () => {
  await seed();
  const r = await pulse('熊本県');
  assert.equal(r.slots.we_pm, 'few');
  assert.equal(r.slots.wd_night, 0);
  assert.equal(r.board.length, 1);
});

test('同性のみの募集は件数だけ（ぼかし）で、相性診断用の一覧には出さない', async () => {
  await seed();
  const r = await pulse();
  assert.equal(r.same_only, 'few');
  assert.equal(r.board.length, 4, '誰でも可の4件だけ');
  assert.ok(r.board.every((b) => b.gym && Array.isArray(b.slots) && Array.isArray(b.parts) && Array.isArray(b.goals)));
});

test('一覧と集計に名前・本文・ID・性別を含めない', async () => {
  await seed();
  const json = JSON.stringify(await pulse());
  for (const secret of ['ひみつ', '自己紹介ひみつ', '胸の日に補助', 'Uline', 'member', 'line_user', '"id"', 'gender', 'male', 'note', 'bio', 'nickname']) {
    assert.ok(!json.includes(secret), `公開集計に ${secret} が含まれている`);
  }
});

test('新着（48時間以内）の募集がある県を返す。古い募集・締め切りは数えない', async () => {
  const ms = await seed();
  assert.deepEqual((await pulse()).fresh.sort(), ['東京都', '熊本県'].sort());
  await h.addDays(3);
  const late = await h.member(); await h.profile(late);
  await post(late, 'gym-k');
  const r = await pulse();
  assert.deepEqual(r.fresh, ['熊本県']);
  await h.addDays(40);
  const z = await pulse();
  assert.equal(z.slots.wd_night, 0, '期限切れは数えない');
  assert.deepEqual(z.board, []);
  void ms;
});

test('一覧は最大60件', async () => {
  await h.gym('gym-a', 'ONE STEP', '東京都', '渋谷区');
  const ms = await people(65);
  for (const m of ms) await post(m, 'gym-a');
  assert.equal((await pulse()).board.length, 60);
});

test('サーバー権限以外は実行できない', async () => {
  const r = await h.db.query(`select has_function_privilege('anon', 'gt_public_pulse(text)', 'execute') a,
                                     has_function_privilege('authenticated', 'gt_public_pulse(text)', 'execute') u,
                                     has_function_privilege('service_role', 'gt_public_pulse(text)', 'execute') s`);
  assert.deepEqual(r.rows[0], { a: false, u: false, s: true });
});

async function withApp(fn, depsOver = {}) {
  const app = express();
  const deps = { rpc: pgRpc(h.db), lookupArticle: async () => null, ...depsOver };
  app.use('/public', createPublicRouter(deps));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  try { await fn(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise((r) => server.close(r)); }
}

test('API：/overview に pulse を同梱して1回の通信で済ませる', async () => {
  await seed();
  await withApp(async (base) => {
    const b = await (await fetch(`${base}/public/overview`)).json();
    assert.equal(b.totals.open_posts, 5);
    assert.equal(b.pulse.slots.wd_night, 4);
    const k = await (await fetch(`${base}/public/overview?pref=${encodeURIComponent('熊本県')}`)).json();
    assert.equal(k.pulse.board.length, 1);
  });
});

test('API：pulse が失敗しても（DB未適用など）overview はそのまま返す', async () => {
  await seed();
  const rpc = pgRpc(h.db);
  await withApp(async (base) => {
    const r = await fetch(`${base}/public/overview`);
    assert.equal(r.status, 200);
    const b = await r.json();
    assert.equal(b.totals.open_posts, 5);
    assert.equal(b.pulse, null);
  }, { rpc: async (fn, args) => { if (fn === 'gt_public_pulse') throw new Error('function does not exist'); return rpc(fn, args); } });
});

// 合トレナビのトップ・エリアページ用の公開集計（ログイン不要）
// 実行: node --test server/__tests__/gotore-public.test.cjs
// 返すのは「件数」と「ジム名・エリア名」と「募集の大まかな条件（時間帯・部位・レベル・日付）」だけ。
// ニックネーム・自己紹介・募集文・会員ID・LINE ID・掲示板の内部ID・同性のみの募集の中身は絶対に返さない。
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
const overview = (pref = null) => h.call('gt_public_overview', { p_pref: pref });

async function seed() {
  await h.gym('gym-a', 'ONE STEP', '東京都', '渋谷区');
  await h.gym('gym-b', 'BLUE FITNESS 勝どき', '東京都', '中央区');
  await h.gym('gym-k', 'B-fit24 長嶺', '熊本県', '熊本市');
  const a = await h.member(); await h.profile(a, { nickname: 'ひみつのたろう', bio: '自己紹介ひみつ' });
  const b = await h.member(); await h.profile(b, { nickname: 'はなこ', gender: 'female' });
  const c = await h.member(); await h.profile(c);
  const w = await h.member();
  await post(a, 'gym-a');
  await post(b, 'gym-b', { p_gender_pref: 'same', p_slots: ['we_am'] });
  await post(c, 'gym-k', { p_slots: ['we_pm'], p_parts: ['legs'] });
  await h.call('gt_watch', { p_member: w, p_handle: 'gym-a', p_on: true });
  await h.call('gt_watch', { p_member: w, p_handle: 'gym-k', p_on: true });
  return { a, b, c, w };
}

test('全国の集計：募集中の件数・通知待ちの人数・募集のあるジム数', async () => {
  await seed();
  const r = await overview();
  assert.equal(r.totals.open_posts, 3, '同性のみの募集も件数には入る');
  assert.equal(r.totals.watchers, 1, '2つのジムを見ていても1人');
  assert.equal(r.totals.gyms, 3);
});

test('都道府県・市区町村ごとの件数を返す（0件のエリアは出さない）', async () => {
  await seed();
  const r = await overview();
  const tokyo = r.prefs.find((p) => p.pref === '東京都');
  assert.equal(tokyo.open_posts, 2);
  assert.equal(tokyo.watchers, 1);
  const shibuya = r.areas.find((x) => x.pref === '東京都' && x.city === '渋谷区');
  assert.deepEqual({ open: shibuya.open_posts, watch: shibuya.watchers }, { open: 1, watch: 1 });
  assert.ok(!r.prefs.find((p) => p.pref === '大阪府'), '何も無い県は出さない');
});

test('新着は「誰でも可」の募集だけ。条件はラベル用の値と日付だけで、名前や本文は出さない', async () => {
  await seed();
  const r = await overview();
  assert.equal(r.recent.length, 2, '同性のみの募集は新着に出さない');
  const json = JSON.stringify(r);
  for (const secret of ['ひみつのたろう', 'はなこ', '自己紹介ひみつ', '胸の日に補助', 'Uline', 'member', 'line_user', '"id"', 'gender']) {
    assert.ok(!json.includes(secret), `公開集計に ${secret} が含まれている`);
  }
  const it = r.recent.find((x) => x.gym.handle === 'gym-a');
  assert.deepEqual(it.gym, { handle: 'gym-a', name: 'ONE STEP', pref: '東京都', city: '渋谷区' });
  assert.deepEqual(it.slots, ['wd_night']);
  assert.deepEqual(it.parts, ['chest']);
  assert.equal(it.level, 'intermediate');
  assert.match(it.date, /^\d{4}-\d{2}-\d{2}$/, '時刻までは出さない（日付だけ）');
});

test('都道府県を指定すると、その県のジム別の件数と新着だけを返す', async () => {
  await seed();
  const r = await overview('熊本県');
  assert.equal(r.totals.open_posts, 1);
  assert.deepEqual(r.gyms, [{ handle: 'gym-k', name: 'B-fit24 長嶺', city: '熊本市', open_posts: 1, watchers: 1 }]);
  assert.equal(r.recent.length, 1);
  assert.equal(r.recent[0].gym.pref, '熊本県');
});

test('締め切り・期限切れ・非表示・利用停止の人の募集は数えない', async () => {
  const { a, c } = await seed();
  await h.db.query(`update gotore_profiles set suspended = true where member_id = $1`, [c]);
  const mine = (await h.call('gt_me', { p_member: a })).posts[0];
  await h.call('gt_post_close', { p_member: a, p_post: mine.id });
  const r = await overview();
  assert.equal(r.totals.open_posts, 1, '残りは同性のみの1件だけ');
  assert.equal(r.recent.length, 0);
  await h.addDays(31);
  assert.equal((await overview()).totals.open_posts, 0);
});

test('サーバー権限以外は実行できない', async () => {
  const r = await h.db.query(`select has_function_privilege('anon', 'gt_public_overview(text)', 'execute') a,
                                     has_function_privilege('service_role', 'gt_public_overview(text)', 'execute') s`);
  assert.equal(r.rows[0].a, false);
  assert.equal(r.rows[0].s, true);
});

// ── API ───────────────────────────────────────────────────────────────
async function withApp(fn, depsOver = {}) {
  const app = express();
  app.set('trust proxy', true);
  const deps = { rpc: pgRpc(h.db), lookupArticle: async () => null, ...depsOver };
  app.use('/public', createPublicRouter(deps));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('API：/overview は集計を返し、CDNにキャッシュさせる', async () => {
  await seed();
  await withApp(async (base) => {
    const r = await fetch(`${base}/public/overview`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('cache-control'), /s-maxage=\d+/);
    const b = await r.json();
    assert.equal(b.totals.open_posts, 3);
    const p = await (await fetch(`${base}/public/overview?pref=${encodeURIComponent('熊本県')}`)).json();
    assert.equal(p.gyms.length, 1);
  });
});

test('API：存在しない都道府県名は 400（DBまで行かない）', async () => {
  await withApp(async (base) => {
    assert.equal((await fetch(`${base}/public/overview?pref=${encodeURIComponent('火星県')}`)).status, 400);
  });
});

test('API：同じ集計はしばらくメモリから返す（DBを叩き続けない）', async () => {
  await seed();
  let calls = 0;
  const rpc = pgRpc(h.db);
  await withApp(async (base) => {
    for (let i = 0; i < 5; i++) assert.equal((await fetch(`${base}/public/overview`)).status, 200);
    assert.equal(calls, 1);
  }, { rpc: async (fn, args) => { if (fn === 'gt_public_overview') calls += 1; return rpc(fn, args); } });
});

test('API：同じIPからの連続アクセスは制限する（429）', async () => {
  await seed();
  await withApp(async (base) => {
    let last = 200;
    for (let i = 0; i < 80; i++) {
      last = (await fetch(`${base}/public/overview?pref=${encodeURIComponent('東京都')}`, { headers: { 'x-forwarded-for': '203.0.113.9' } })).status;
      if (last === 429) break;
    }
    assert.equal(last, 429);
    const other = await fetch(`${base}/public/overview`, { headers: { 'x-forwarded-for': '203.0.113.10' } });
    assert.equal(other.status, 200, '別のIPは影響を受けない');
  });
});

// 合トレナビ：公式LINEのトークだけで募集を作る・見る・管理する
// 実行: node --test server/__tests__/gotore-line-chat.test.cjs
// DB は本番と同じマイグレーションを流した PGlite（helpers/gotore-pg.cjs）。gt_* 関数をそのまま呼ぶ。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDb, pgRpc } = require('./helpers/gotore-pg.cjs');
const { createGotoreChat } = require('../gotore-line-chat.cjs');

let h, chat, pushed, line;
test.beforeEach(async () => {
  h = await createDb();
  await h.gym('gym-a', 'ONE STEP', '東京都', '渋谷区');
  pushed = [];
  chat = createGotoreChat({
    rpc: pgRpc(h.db),
    baseUrl: 'https://my.fitpeak.co',
    liffId: 'LIFFID',
    lookupArticle: async (handle) => (handle === 'gym-b' ? { name: 'TWO STEP', pref: '東京都', city: '渋谷区' } : null),
    pushLine: async (to, text) => { pushed.push({ to, text }); },
  });
  line = async (m) => (await h.one('select line_user_id from members where id = $1', [m])).line_user_id;
});

// 返信の中のボタン（クイックリプライ・Flex のボタン）を集める
function actions(messages) {
  const out = [];
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) return o.forEach(walk);
    if ((o.type === 'postback' || o.type === 'uri') && o.label) out.push(o);
    Object.values(o).forEach(walk);
  };
  walk(messages);
  return out;
}
const textOf = (r) => JSON.stringify(r && r.messages);
const btn = (r, label) => {
  const a = actions(r.messages).find((x) => x.label === label || x.label.endsWith(label));
  if (!a) throw new Error(`ボタン「${label}」が無い: ${actions(r.messages).map((x) => x.label).join(' / ')}`);
  return a;
};
const say = (u, text) => chat.onText({ lineUserId: u, text });
const tap = (u, r, label) => chat.onPostback({ lineUserId: u, data: btn(r, label).data });

async function ready(over = {}) {
  const m = await h.member();
  await h.profile(m, over);
  return { m, u: await line(m) };
}

// 「合トレ募集」→ ジム → 時間帯 → 部位 → 目的 → 同性のみか → ひとこと → 確認 まで進める
async function toConfirm(u, { note = 'スキップ', same = false } = {}) {
  let r = await say(u, '合トレ募集');
  r = await tap(u, r, 'ONE STEP');
  r = await tap(u, r, '平日夜');
  r = await tap(u, r, '決定');
  r = await tap(u, r, '胸');
  r = await tap(u, r, '決定');
  r = await tap(u, r, '補助してほしい');
  r = await tap(u, r, '決定');
  r = await tap(u, r, same ? '同性のみ' : '誰でも');
  r = note === 'スキップ' ? await tap(u, r, 'スキップ') : await say(u, note);
  return r;
}

test('会話外の普通のメッセージには反応しない（既存の自動返信・AIへそのまま流れる）', async () => {
  const { u } = await ready();
  assert.equal(await say(u, 'こんにちは'), null);
  assert.equal(await say(u, '最安'), null);
  assert.equal(await say(u, 'やめる'), null, '会話していないときの「やめる」も通常の処理へ');
  assert.equal(await chat.onPostback({ lineUserId: u, data: 'action=menu&k=coupon' }), null, '合トレ以外のボタンは触らない');
});

test('表記ゆれ（合トレ 募集・募集する・ＬＩＮＥで募集する）で会話が始まる', async () => {
  const { u } = await ready();
  for (const t of ['合トレ募集', '合トレ 募集', '募集する', '合トレを募集したい', 'LINEで募集する', '合トレ募集！']) {
    const r = await say(u, t);
    assert.ok(r, t);
    assert.match(textOf(r), /どのジム/, t);
  }
});

test('一通りボタンで答えると確認カードが出て、「投稿する」で Web と同じ募集ができる', async () => {
  const { m, u } = await ready();
  let r = await say(u, '合トレ募集');
  // ジムはアカウントの通っているジム＋エリア掲示板
  assert.ok(btn(r, 'ONE STEP'));
  assert.ok(btn(r, '渋谷区のエリア掲示板'));
  r = await toConfirm(u, { note: 'ベンチの補助をお願いしたいです' });
  const card = textOf(r);
  assert.match(card, /ONE STEP/);
  assert.match(card, /平日夜/);
  assert.match(card, /胸/);
  assert.match(card, /補助してほしい/);
  assert.match(card, /ベンチの補助をお願いしたいです/);
  assert.ok(btn(r, 'やり直す')); assert.ok(btn(r, 'やめる'));
  const cardR = r;
  r = await tap(u, r, '投稿する');
  assert.match(textOf(r), /募集を出しました/);
  const me = await h.call('gt_line_my_posts', { p_member: m });
  assert.equal(me.length, 1);
  assert.deepEqual(me[0].slots, ['wd_night']);
  const post = await h.one('select * from gotore_posts where member_id = $1', [m]);
  assert.deepEqual(post.parts, ['chest']);
  assert.deepEqual(post.goals, ['spot']);
  assert.equal(post.gender_pref, 'any');
  assert.equal(post.note, 'ベンチの補助をお願いしたいです');
  // 掲示板を開くボタンは LIFF 経由（自動ログイン）
  assert.match(btn(r, '掲示板で見る').uri, /^https:\/\/liff\.line\.me\/LIFFID\?mode=myfp&redirect=%2Fmy-fitpeak%2Fgotore%2Fb%2F[0-9a-f-]{36}$/);
  // 下書きは消える。もう一度「投稿する」を押しても二重に出ない
  assert.equal(await h.call('gt_line_draft_get', { p_line: u }), null);
  const again = await tap(u, cardR, '投稿する');
  assert.doesNotMatch(textOf(again), /募集を出しました/);
  assert.equal((await h.call('gt_line_my_posts', { p_member: m })).length, 1);
});

test('エリア掲示板にも出せる（初めてのエリアは掲示板を作る）', async () => {
  const { m, u } = await ready();
  let r = await say(u, '合トレ募集');
  r = await tap(u, r, '渋谷区のエリア掲示板');
  assert.match(textOf(r), /時間帯/);
  r = await tap(u, r, '土日朝'); r = await tap(u, r, '決定');
  r = await tap(u, r, '指定なしで次へ');
  r = await tap(u, r, '指定なしで次へ');
  r = await tap(u, r, '誰でも');
  r = await tap(u, r, 'スキップ');
  r = await tap(u, r, '投稿する');
  assert.match(textOf(r), /募集を出しました/);
  const g = await h.one('select g.handle from gotore_posts p join gotore_gyms g on g.id = p.gym_id where p.member_id = $1', [m]);
  assert.equal(g.handle, 'area:東京都:渋谷区');
});

test('記事の掲示板がまだ無いジムは、記事の実在を確かめてから用意する（無ければ選べない旨を返す）', async () => {
  const m = await h.member();
  await h.profile(m);
  await h.account(m, { gyms: [{ kind: 'review', key: 'gym-b', name: 'TWO STEP' }, { kind: 'review', key: 'gym-x', name: 'GHOST' }] });
  const u = await line(m);
  let r = await say(u, '合トレ募集');
  const r2 = await tap(u, r, 'GHOST');
  assert.match(textOf(r2), /掲示板を用意できませんでした/);
  r = await say(u, '合トレ募集');
  r = await tap(u, r, 'TWO STEP');
  assert.match(textOf(r), /時間帯/);
  assert.equal((await h.call('gt_gym_public', { p_handle: 'gym-b' })).gym.name, 'TWO STEP');
});

test('時間帯は1つ以上選ばないと次へ進めない。選んだものは印が付き、もう一度押すと外れる', async () => {
  const { u } = await ready();
  let r = await say(u, '合トレ募集');
  r = await tap(u, r, 'ONE STEP');
  assert.throws(() => btn(r, '決定'), /無い/);
  r = await tap(u, r, '平日夜');
  assert.ok(btn(r, '●平日夜'));
  r = await tap(u, r, '●平日夜');
  assert.throws(() => btn(r, '●平日夜'), /無い/);
});

test('途中で文字を送ると、同じ質問をもう一度出す（ほかの自動返信は割り込まない）', async () => {
  const { u } = await ready();
  let r = await say(u, '合トレ募集');
  r = await tap(u, r, 'ONE STEP');
  const r2 = await say(u, '最安');
  assert.ok(r2, '会話中は合トレ側が受ける');
  assert.match(textOf(r2), /ボタンから選んでください/);
  assert.match(textOf(r2), /時間帯/);
});

test('「やめる」「キャンセル」でいつでも抜けられる。抜けた後は通常の処理に戻る', async () => {
  const { u } = await ready();
  for (const word of ['やめる', 'キャンセル']) {
    let r = await say(u, '合トレ募集');
    r = await tap(u, r, 'ONE STEP');
    r = await say(u, word);
    assert.match(textOf(r), /やめました/);
    assert.equal(await h.call('gt_line_draft_get', { p_line: u }), null);
    assert.equal(await say(u, 'こんにちは'), null);
  }
  // 確認カードの「やめる」ボタンでも
  let r = await toConfirm(u);
  r = await tap(u, r, 'やめる');
  assert.match(textOf(r), /やめました/);
  assert.equal(await h.call('gt_line_draft_get', { p_line: u }), null);
});

test('「やり直す」で最初の質問に戻る', async () => {
  const { u } = await ready();
  let r = await toConfirm(u);
  r = await tap(u, r, 'やり直す');
  assert.match(textOf(r), /どのジム/);
});

test('30分たった下書きは無効。古いボタンを押すと、やり直しの案内だけ返す', async () => {
  const { m, u } = await ready();
  const r = await toConfirm(u);
  await h.addMinutes(31);
  const r2 = await tap(u, r, '投稿する');
  assert.match(textOf(r2), /時間が経った/);
  assert.equal((await h.call('gt_line_my_posts', { p_member: m })).length, 0);
  assert.equal(await say(u, 'こんにちは'), null, '期限切れ後の普通の文は通常の処理へ');
});

test('前の質問のボタン（古い合言葉）を押しても、今の下書きは変わらない', async () => {
  const { u } = await ready();
  let r = await say(u, '合トレ募集');
  const first = r;
  r = await tap(u, r, 'ONE STEP');
  r = await tap(u, r, '平日夜');
  const r2 = await tap(u, first, '渋谷区のエリア掲示板');
  assert.match(textOf(r2), /前のボタン/);
  const d = await h.call('gt_line_draft_get', { p_line: u });
  assert.equal(d.step, 'slots');
  assert.deepEqual(d.data.slots, ['wd_night']);
});

test('改ざんされた postback（不正な値・他人の募集ID・他人の下書きのつもりのID）では、他人のものに触れない', async () => {
  const a = await ready();
  const b = await ready({ nickname: 'はなこ', gender: 'female' });
  // b の下書きと募集
  await say(b.u, '合トレ募集');
  const bDraft = await h.call('gt_line_draft_get', { p_line: b.u });
  const bPost = await h.call('gt_post_create', { p_member: b.m, p_handle: 'gym-a', p_slots: ['we_am'], p_parts: [], p_goals: [], p_gender_pref: 'any', p_note: '' });
  // a が b の合言葉・b のLINE ID・b の募集IDを差し込んでも
  for (const data of [
    `action=gotore&s=gym&v=0&k=${bDraft.token}`,
    `action=gotore&s=gym&v=0&k=${bDraft.token}&line=${b.u}`,
    `action=gotore&s=post&k=${bDraft.token}`,
    `action=gotore&s=close&p=${bPost.post_id}`,
    `action=gotore&s=del2&p=${bPost.post_id}`,
    'action=gotore&s=slots&v=midnight&k=zzz',
    'action=gotore&s=close&p=not-a-uuid',
    'action=gotore&s=%00%01',
    'action=gotore',
  ]) {
    const r = await chat.onPostback({ lineUserId: a.u, data });
    assert.ok(r, data);
    assert.doesNotMatch(textOf(r), /締め切りました|削除しました|募集を出しました/, data);
  }
  assert.equal((await h.call('gt_line_draft_get', { p_line: b.u })).token, bDraft.token, 'b の下書きはそのまま');
  const p = await h.one('select status from gotore_posts where id = $1', [bPost.post_id]);
  assert.equal(p.status, 'open', 'b の募集はそのまま');
  assert.equal(await h.call('gt_line_draft_get', { p_line: a.u }), null, 'a に下書きも作られない');
});

test('会員でない友だち・アカウントのプロフィール不足・合トレのプロフィール未登録は、足りない項目名とLIFFの登録ボタンだけ返す', async () => {
  // 会員でない（My FITPEAK にログインしたことがない）
  let r = await say('Unobody', '合トレ募集');
  assert.match(textOf(r), /My FITPEAK/);
  assert.match(btn(r, '登録').uri, /^https:\/\/liff\.line\.me\/LIFFID\?mode=myfp&redirect=%2Fmy-fitpeak%2Faccount$/);
  assert.equal(await h.call('gt_line_draft_get', { p_line: 'Unobody' }), null);
  assert.equal((await h.one(`select count(*)::int n from members where line_user_id = 'Unobody'`)).n, 0, '会員を勝手に作らない');

  // アカウントの公開項目はあるが、お名前・メール（非公開）が無い
  const m = await h.member();
  await h.account(m, { private: false });
  const u = await line(m);
  r = await say(u, '合トレ募集');
  assert.match(textOf(r), /お名前/);
  assert.match(textOf(r), /メールアドレス/);
  assert.doesNotMatch(textOf(r), /渋谷区|たろう|ONE STEP/, '登録済みの値は返さない');
  assert.match(btn(r, '登録').uri, /redirect=%2Fmy-fitpeak%2Faccount$/);

  // アカウントは揃っているが、合トレのプロフィール（レベル・18歳以上の同意）が無い
  const m2 = await h.member();
  await h.account(m2);
  r = await say(await line(m2), '合トレ募集');
  assert.match(textOf(r), /18歳以上/);
  assert.match(btn(r, '登録').uri, /redirect=%2Fmy-fitpeak%2Fgotore%2Fprofile$/);
});

test('利用停止中の人は募集を作れない', async () => {
  const { m, u } = await ready();
  await h.db.query('update gotore_profiles set suspended = true where member_id = $1', [m]);
  const r = await say(u, '合トレ募集');
  assert.match(textOf(r), /利用停止/);
});

test('ひとことは Web と同じ文言チェック（連絡先・出会い目的・200文字）で弾き、もう一度入力を求める', async () => {
  const { m, u } = await ready();
  for (const [note, re] of [['LINE ID: abc123 で連絡ください', /連絡先/], ['090-1234-5678', /連絡先/], ['彼女募集中です', /出会い/], ['あ'.repeat(201), /200文字/]]) {
    let r = await say(u, '合トレ募集');
    r = await tap(u, r, 'ONE STEP');
    r = await tap(u, r, '平日夜'); r = await tap(u, r, '決定');
    r = await tap(u, r, '指定なしで次へ'); r = await tap(u, r, '指定なしで次へ');
    r = await tap(u, r, '誰でも');
    r = await say(u, note);
    assert.match(textOf(r), re, note);
    assert.equal((await h.call('gt_line_draft_get', { p_line: u })).step, 'note', 'ひとことの入力待ちのまま');
  }
  assert.equal((await h.call('gt_line_my_posts', { p_member: m })).length, 0);
});

test('同じジムに出せる募集は1件（Web と同じ上限）。2件目は理由を返して下書きを消す', async () => {
  const { u } = await ready();
  let r = await toConfirm(u);
  r = await tap(u, r, '投稿する');
  r = await toConfirm(u);
  r = await tap(u, r, '投稿する');
  assert.match(textOf(r), /すでに募集を出しています/);
  assert.ok(btn(r, '自分の募集'));
});

test('「同性のみ」は性別を答えた人だけに聞く。選んだ募集は異性には見えない', async () => {
  const none = await ready({ gender: 'none' });
  let r = await say(none.u, '合トレ募集');
  r = await tap(none.u, r, 'ONE STEP');
  r = await tap(none.u, r, '平日夜'); r = await tap(none.u, r, '決定');
  r = await tap(none.u, r, '指定なしで次へ'); r = await tap(none.u, r, '指定なしで次へ');
  assert.match(textOf(r), /ひとこと/, '性別を答えていない人には「同性のみ」を聞かない');
  assert.throws(() => btn(r, '同性のみ'), /無い/);

  const f = await ready({ nickname: 'はなこ', gender: 'female' });
  r = await toConfirm(f.u, { same: true });
  assert.match(textOf(r), /同性のみ/);
  r = await tap(f.u, r, '投稿する');
  assert.match(textOf(r), /募集を出しました/);
  const male = await ready();
  const f2 = await ready({ nickname: 'さくら', gender: 'female' });
  assert.equal((await h.call('gt_line_nearby', { p_member: male.m, p_handles: ['gym-a'], p_pref: '東京都', p_city: '渋谷区' })).length, 0);
  assert.equal((await h.call('gt_line_nearby', { p_member: f2.m, p_handles: ['gym-a'], p_pref: '東京都', p_city: '渋谷区' })).length, 1);
});

test('募集を出すと、そのジムの通知待ちの人に既存と同じ文でLINEが届く', async () => {
  const w = await ready();
  await h.call('gt_watch', { p_member: w.m, p_handle: 'gym-a', p_on: true });
  const { u } = await ready({ nickname: 'じろう' });
  let r = await toConfirm(u);
  await tap(u, r, '投稿する');
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].to, w.u);
  assert.match(pushed[0].text, /ONE STEPで新しい合トレ募集が出ました（平日夜）/);
});

test('LINEで作った募集にも、Webから応募すると募集者のLINEに通知先が返る（既存の notify 経路）', async () => {
  const owner = await ready();
  let r = await toConfirm(owner.u);
  await tap(owner.u, r, '投稿する');
  const post = await h.one('select id from gotore_posts where member_id = $1', [owner.m]);
  const other = await ready({ nickname: 'さぶろう' });
  const req = await h.call('gt_request', { p_member: other.m, p_post: post.id, p_message: 'よろしくお願いします' });
  assert.deepEqual(req.notify, [owner.u]);
});

test('「募集を見る」「近くの合トレ」：近くの公開中の募集をカードで最大10件。名前・性別・年代・個人情報は出さない', async () => {
  const viewer = await ready();
  const ids = [];
  for (let i = 0; i < 12; i++) {
    await h.gym(`gym-${i}`, `ジム${i}`, '東京都', i < 6 ? '渋谷区' : '新宿区');
    const o = await ready({ nickname: `ひみつ${i}`, gender: 'female', age_band: '35-44' });
    await h.db.query(`update member_private_profiles set last_name = '秘密姓', email = 'secret${i}@example.com' where member_id = $1`, [o.m]);
    await h.call('gt_post_create', { p_member: o.m, p_handle: `gym-${i}`, p_slots: ['wd_night'], p_parts: ['legs'], p_goals: [], p_gender_pref: 'any', p_note: `脚の日${i}` });
    ids.push(o);
  }
  // 自分の募集は出さない
  await h.call('gt_post_create', { p_member: viewer.m, p_handle: 'gym-a', p_slots: ['wd_am'], p_parts: [], p_goals: [], p_gender_pref: 'any', p_note: 'わたしのノート' });
  for (const word of ['募集を見る', '近くの合トレ']) {
    const r = await say(viewer.u, word);
    const flex = r.messages.find((x) => x.type === 'flex');
    assert.ok(flex, word);
    assert.equal(flex.contents.type, 'carousel');
    assert.equal(flex.contents.contents.length, 10);
    const s = textOf(r);
    assert.match(s, /脚の日/);
    assert.doesNotMatch(s, /わたしのノート/);
    assert.doesNotMatch(s, /ひみつ|女性|35〜44|秘密姓|secret\d@|Uline|member/);
    for (const o of ids) assert.ok(!s.includes(o.m) && !s.includes(o.u), '会員ID・LINE IDを出さない');
    assert.match(btn(r, '詳しく見る・応募する').uri, /^https:\/\/liff\.line\.me\/LIFFID\?mode=myfp&redirect=%2Fmy-fitpeak%2Fgotore%2Fb%2F[0-9a-f-]{36}$/);
  }
  // 渋谷区（同じ市区町村）が先
  const r = await chat.onPostback({ lineUserId: viewer.u, data: 'action=gotore&s=list' });
  const first = JSON.stringify(r.messages.find((x) => x.type === 'flex').contents.contents[0]);
  assert.match(first, /渋谷区/);
});

test('近くに募集が無いときは、LINEで募集するボタンを返す', async () => {
  const { u } = await ready();
  const r = await say(u, '募集を見る');
  assert.match(textOf(r), /まだありません/);
  assert.ok(btn(r, 'LINEで募集する'));
});

test('「自分の募集」：自分の募集だけを一覧し、締め切る・削除する（削除は確認してから）', async () => {
  const { m, u } = await ready();
  let r = await toConfirm(u);
  await tap(u, r, '投稿する');
  const other = await ready({ nickname: 'たにん' });
  await h.call('gt_post_create', { p_member: other.m, p_handle: 'gym-a', p_slots: ['we_pm'], p_parts: [], p_goals: [], p_gender_pref: 'any', p_note: '他人の募集' });
  const post = await h.one('select id from gotore_posts where member_id = $1', [m]);
  await h.call('gt_request', { p_member: other.m, p_post: post.id, p_message: '' });

  r = await say(u, '自分の募集');
  assert.match(textOf(r), /ONE STEP/);
  assert.match(textOf(r), /申請 1件/);
  assert.doesNotMatch(textOf(r), /他人の募集|たにん/, '他人の募集・申請者の名前は出さない');
  const closed = await tap(u, r, '締め切る');
  assert.match(textOf(closed), /締め切りました/);
  assert.equal((await h.one('select status from gotore_posts where id = $1', [post.id])).status, 'closed');

  r = await say(u, '自分の募集');
  const ask = await tap(u, r, '削除する');
  assert.match(textOf(ask), /削除しますか/);
  assert.equal((await h.one('select count(*)::int n from gotore_posts where id = $1', [post.id])).n, 1, '確認前は消さない');
  const done = await tap(u, ask, '削除する（確定）');
  assert.match(textOf(done), /削除しました/);
  assert.equal((await h.one('select count(*)::int n from gotore_posts where id = $1', [post.id])).n, 0);
});

test('マッチ済みの募集は削除できず、締め切りを案内する', async () => {
  const owner = await ready();
  const p = await h.call('gt_post_create', { p_member: owner.m, p_handle: 'gym-a', p_slots: ['we_am'], p_parts: [], p_goals: [], p_gender_pref: 'any', p_note: '' });
  const other = await ready({ nickname: 'たにん' });
  const rq = await h.call('gt_request', { p_member: other.m, p_post: p.post_id, p_message: '' });
  await h.call('gt_request_answer', { p_member: owner.m, p_request: rq.request_id, p_accept: true });
  const r = await chat.onPostback({ lineUserId: owner.u, data: `action=gotore&s=del2&p=${p.post_id}` });
  assert.match(textOf(r), /締め切る/);
  assert.equal((await h.one('select count(*)::int n from gotore_posts where id = $1', [p.post_id])).n, 1);
});

test('確認カード・返信・ログの要約に、他人の個人情報も本人の非公開項目も載らない', async () => {
  const { m, u } = await ready();
  let r = await toConfirm(u);
  const s = textOf(r) + JSON.stringify(r.log || '');
  assert.doesNotMatch(s, /山田|太郎|ヤマダ|example\.com|Uline/);
  assert.ok(!s.includes(m));
  r = await tap(u, r, '投稿する');
  assert.ok(!(textOf(r) + JSON.stringify(r.log || '')).includes(m));
});

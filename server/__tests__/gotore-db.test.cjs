// 合トレ仲間さがし：DB層（gt_* 関数）のテスト
// 実行: node --test server/__tests__/gotore-db.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDb, rejects } = require('./helpers/gotore-pg.cjs');

let h;
test.beforeEach(async () => { h = await createDb(); });

const POST = { p_slots: ['wd_night'], p_parts: ['chest'], p_goals: ['spot'], p_gender_pref: 'any', p_note: '' };
const post = (member, handle = 'gym-a', over = {}) =>
  h.call('gt_post_create', { p_member: member, p_handle: handle, ...POST, ...over });
const board = (member, handle = 'gym-a') => h.call('gt_gym_board', { p_member: member, p_handle: handle });

test('ジム記事の枠：募集数と通知待ちの人数を返す。知らないジムは gym=null', async () => {
  await h.gym();
  const a = await h.member(); await h.profile(a);
  const b = await h.member();
  await post(a);
  await h.call('gt_watch', { p_member: b, p_handle: 'gym-a', p_on: true });
  const r = await h.call('gt_gym_public', { p_handle: 'gym-a' });
  assert.equal(r.gym.name, 'ONE STEP');
  assert.equal(r.open_posts, 1);
  assert.equal(r.watchers, 1);
  assert.equal(r.area_open_posts, 1);
  assert.equal(r.preview.length, 1);
  assert.equal(r.preview[0].nickname, undefined, '記事側には名前を出さない');
  assert.equal((await h.call('gt_gym_public', { p_handle: 'nope' })).gym, null);
});

test('プロフィールは規約への同意が必須。名前や自己紹介に連絡先は書けない', async () => {
  const a = await h.member();
  await rejects(h.profile(a, { agree: false }), /同意/);
  await rejects(h.profile(a, { bio: 'LINE ID: abc123 で連絡ください' }), /連絡先/);
  await rejects(h.profile(a, { nickname: 'x'.repeat(21) }), /ニックネーム/);
  await h.profile(a);
  const me = await h.call('gt_me', { p_member: a });
  assert.equal(me.profile.nickname, 'たろう');
});

test('募集はプロフィールが無いと出せない。連絡先や出会い目的の文は弾く', async () => {
  await h.gym();
  const a = await h.member();
  await rejects(post(a), /プロフィール/);
  await h.profile(a);
  await rejects(post(a, 'gym-a', { p_note: '090-1234-5678 まで' }), /連絡先/);
  await rejects(post(a, 'gym-a', { p_note: 'https://example.com' }), /連絡先/);
  await rejects(post(a, 'gym-a', { p_note: '彼女募集中です' }), /出会い/);
  await rejects(post(a, 'gym-a', { p_slots: [] }), /時間帯/);
  await rejects(post(a, 'gym-a', { p_slots: ['midnight'] }), /時間帯/);
  await rejects(post(a, 'unknown'), /ジム/);
});

test('同じジムに出せる募集は1人1件（締め切れば出し直せる）', async () => {
  await h.gym();
  const a = await h.member(); await h.profile(a);
  const r = await post(a);
  await rejects(post(a), /すでに/);
  await h.call('gt_post_close', { p_member: a, p_post: r.post_id });
  await post(a);
});

test('募集を出すと、そのジムの通知待ちの人（本人以外）にLINEで知らせる', async () => {
  await h.gym();
  const a = await h.member(); await h.profile(a);
  const b = await h.member();
  await h.call('gt_watch', { p_member: a, p_handle: 'gym-a', p_on: true });
  await h.call('gt_watch', { p_member: b, p_handle: 'gym-a', p_on: true });
  const r = await post(a);
  assert.deepEqual(r.notify, ['Uline2']);
  assert.equal(r.gym_name, 'ONE STEP');
});

test('「同性のみ」の募集は、異性・性別未回答・プロフィール無しの人には見えず、通知もしない', async () => {
  await h.gym();
  const f = await h.member(); await h.profile(f, { gender: 'female', nickname: 'はなこ' });
  const f2 = await h.member(); await h.profile(f2, { gender: 'female', nickname: 'さくら' });
  const m = await h.member(); await h.profile(m);
  const n = await h.member(); await h.profile(n, { gender: 'none' });
  const x = await h.member();
  for (const id of [f2, m, n, x]) await h.call('gt_watch', { p_member: id, p_handle: 'gym-a', p_on: true });
  const r = await post(f, 'gym-a', { p_gender_pref: 'same' });
  assert.deepEqual(r.notify, ['Uline2']);
  assert.equal((await board(f2)).posts.length, 1);
  assert.equal((await board(m)).posts.length, 0);
  assert.equal((await board(n)).posts.length, 0);
  assert.equal((await board(x)).posts.length, 0);
  await rejects(h.call('gt_request', { p_member: m, p_post: r.post_id, p_message: '' }), /見つかりません/);
});

test('性別を答えていない人は「同性のみ」を選べない', async () => {
  await h.gym();
  const n = await h.member(); await h.profile(n, { gender: 'none' });
  await rejects(post(n, 'gym-a', { p_gender_pref: 'same' }), /性別/);
});

test('掲示板には会員IDやLINEのIDを出さない', async () => {
  await h.gym();
  const a = await h.member(); await h.profile(a);
  const b = await h.member(); await h.profile(b, { nickname: 'じろう' });
  await post(a);
  const json = JSON.stringify(await board(b));
  assert.ok(!json.includes(a), '会員IDが出ている');
  assert.ok(!json.includes('Uline'), 'LINEのIDが出ている');
  assert.match(json, /たろう/);
});

test('募集は30日で自動的に締め切られる', async () => {
  await h.gym();
  const a = await h.member(); await h.profile(a);
  const b = await h.member(); await h.profile(b);
  await post(a);
  await h.addDays(31);
  assert.equal((await board(b)).posts.length, 0);
  assert.equal((await h.call('gt_gym_public', { p_handle: 'gym-a' })).open_posts, 0);
  await post(a); // 期限切れは出し直せる
});

test('「合トレしたい」→ 募集者が承認するとマッチし、2人だけがチャットできる', async () => {
  await h.gym();
  const a = await h.member(); await h.profile(a);
  const b = await h.member(); await h.profile(b, { nickname: 'じろう' });
  const c = await h.member(); await h.profile(c, { nickname: 'さぶろう' });
  const p = await post(a);

  await rejects(h.call('gt_request', { p_member: a, p_post: p.post_id, p_message: '' }), /自分/);
  const rq = await h.call('gt_request', { p_member: b, p_post: p.post_id, p_message: 'よろしくお願いします' });
  assert.deepEqual(rq.notify, ['Uline1']);
  await rejects(h.call('gt_request', { p_member: b, p_post: p.post_id, p_message: '' }), /すでに/);

  await rejects(h.call('gt_request_answer', { p_member: b, p_request: rq.request_id, p_accept: true }), /見つかりません/);
  const ans = await h.call('gt_request_answer', { p_member: a, p_request: rq.request_id, p_accept: true });
  assert.ok(ans.match_id);
  assert.deepEqual(ans.notify, ['Uline2']);

  const s = await h.call('gt_message_send', { p_member: b, p_match: ans.match_id, p_body: '火曜20時はどうですか' });
  assert.deepEqual(s.notify, ['Uline1']);
  const m = await h.call('gt_match_messages', { p_member: a, p_match: ans.match_id });
  assert.equal(m.partner.nickname, 'じろう');
  assert.equal(m.messages.length, 1);
  assert.equal(m.messages[0].mine, false);
  await rejects(h.call('gt_match_messages', { p_member: c, p_match: ans.match_id }), /見つかりません/);
  await rejects(h.call('gt_message_send', { p_member: c, p_match: ans.match_id, p_body: 'x' }), /見つかりません/);

  const me = await h.call('gt_me', { p_member: a });
  assert.equal(me.matches.length, 1);
  assert.equal(me.matches[0].partner_nickname, 'じろう');
});

test('チャットの通知は30分に1回まで（連投でLINEが鳴り続けないように）', async () => {
  await h.gym();
  const a = await h.member(); await h.profile(a);
  const b = await h.member(); await h.profile(b);
  const p = await post(a);
  const rq = await h.call('gt_request', { p_member: b, p_post: p.post_id, p_message: '' });
  const { match_id } = await h.call('gt_request_answer', { p_member: a, p_request: rq.request_id, p_accept: true });
  assert.equal((await h.call('gt_message_send', { p_member: b, p_match: match_id, p_body: '1' })).notify.length, 1);
  assert.equal((await h.call('gt_message_send', { p_member: b, p_match: match_id, p_body: '2' })).notify.length, 0);
  await h.addMinutes(31);
  assert.equal((await h.call('gt_message_send', { p_member: b, p_match: match_id, p_body: '3' })).notify.length, 1);
});

test('断った申請は相手に通知しない', async () => {
  await h.gym();
  const a = await h.member(); await h.profile(a);
  const b = await h.member(); await h.profile(b);
  const p = await post(a);
  const rq = await h.call('gt_request', { p_member: b, p_post: p.post_id, p_message: '' });
  const ans = await h.call('gt_request_answer', { p_member: a, p_request: rq.request_id, p_accept: false });
  assert.equal(ans.match_id, null);
  assert.deepEqual(ans.notify, []);
});

test('ブロックすると、お互いの募集が見えず、チャットも閉じる', async () => {
  await h.gym();
  const a = await h.member(); await h.profile(a);
  const b = await h.member(); await h.profile(b);
  const p = await post(a);
  const rq = await h.call('gt_request', { p_member: b, p_post: p.post_id, p_message: '' });
  const { match_id } = await h.call('gt_request_answer', { p_member: a, p_request: rq.request_id, p_accept: true });
  await h.call('gt_block', { p_member: a, p_match: match_id, p_post: null });
  assert.equal((await board(b)).posts.length, 0);
  await rejects(h.call('gt_message_send', { p_member: b, p_match: match_id, p_body: 'x' }), /終了/);
});

test('2人以上から通報された募集は自動で非表示になる', async () => {
  await h.gym();
  const a = await h.member(); await h.profile(a);
  const b = await h.member(); await h.profile(b);
  const c = await h.member(); await h.profile(c);
  const d = await h.member(); await h.profile(d);
  const p = await post(a);
  await h.call('gt_report', { p_member: b, p_post: p.post_id, p_match: null, p_reason: '出会い目的' });
  await h.call('gt_report', { p_member: b, p_post: p.post_id, p_match: null, p_reason: '同じ人の2回目' });
  assert.equal((await board(d)).posts.length, 1, '同じ人の通報は1回と数える');
  await h.call('gt_report', { p_member: c, p_post: p.post_id, p_match: null, p_reason: '出会い目的' });
  assert.equal((await board(d)).posts.length, 0);
});

test('利用停止の人の募集は見えず、新しく募集もできない', async () => {
  await h.gym();
  const a = await h.member(); await h.profile(a);
  const b = await h.member(); await h.profile(b);
  await post(a);
  await h.db.query(`update gotore_profiles set suspended = true where member_id = $1`, [a]);
  assert.equal((await board(b)).posts.length, 0);
  await rejects(post(a, 'gym-a', {}), /停止/);
});

test('申請は1日10件まで（片っ端から送る迷惑行為の防止）', async () => {
  const b = await h.member(); await h.profile(b);
  for (let i = 0; i < 11; i++) {
    await h.gym(`g${i}`, `G${i}`);
    const a = await h.member(); await h.profile(a);
    const p = await post(a, `g${i}`);
    const r = h.call('gt_request', { p_member: b, p_post: p.post_id, p_message: '' });
    if (i < 10) await r; else await rejects(r, /1日/);
  }
});

test('同じエリア（市区町村）のジムと募集数を返す', async () => {
  await h.gym('gym-a', 'A', '東京都', '渋谷区');
  await h.gym('gym-b', 'B', '東京都', '渋谷区');
  await h.gym('gym-c', 'C', '東京都', '新宿区');
  const a = await h.member(); await h.profile(a);
  await post(a, 'gym-b');
  const r = await h.call('gt_gym_public', { p_handle: 'gym-a' });
  assert.equal(r.area_open_posts, 1);
  const area = await h.call('gt_area', { p_member: a, p_pref: '東京都', p_city: '渋谷区' });
  assert.deepEqual(area.gyms.map((g) => [g.handle, g.open_posts]), [['gym-b', 1], ['gym-a', 0]]);
});

test('アプリのサーバー権限（service_role）以外は関数も表も触れない', async () => {
  for (const role of ['anon', 'authenticated']) {
    await h.db.exec(`set role ${role}`);
    try {
      await rejects(h.db.query(`select * from gotore_posts`), /permission/);
      await rejects(h.db.query(`select gt_gym_public('gym-a')`), /permission/);
    } finally {
      await h.db.exec('reset role');
    }
  }
  await h.db.exec('set role service_role');
  try { await h.db.query(`select gt_gym_public('gym-a')`); } finally { await h.db.exec('reset role'); }
});

test('LINEの案内は1クリックにつき1回だけ（webhookとLIFFの両方から来ても二重送信しない）', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  assert.equal(await h.call('gt_claim_invite', { p_click: id, p_line: 'Uabc' }), true);
  assert.equal(await h.call('gt_claim_invite', { p_click: id, p_line: 'Uabc' }), false);
});

test('友だち追加しただけの人（まだMy FITPEAKに入っていない）も会員として用意し、同じ人なら同じ会員', async () => {
  const a = await h.call('gt_member_for_line', { p_line: 'Unew1' });
  const b = await h.call('gt_member_for_line', { p_line: 'Unew1' });
  assert.equal(a, b);
  const existing = await h.member(); // Uline1
  assert.equal(await h.call('gt_member_for_line', { p_line: 'Uline1' }), existing);
});

test('短いリンク用：掲示板のIDから記事のキーを引ける（知らないIDは null）', async () => {
  await h.gym('gym-a');
  const pub = await h.call('gt_gym_public', { p_handle: 'gym-a' });
  assert.ok(pub.gym.id);
  assert.equal(await h.call('gt_gym_handle', { p_id: pub.gym.id }), 'gym-a');
  assert.equal(await h.call('gt_gym_handle', { p_id: '00000000-0000-4000-8000-000000000000' }), null);
});

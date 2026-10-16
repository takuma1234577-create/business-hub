// My FITPEAK アカウントのプロフィール（公開項目＋非公開項目）と、合トレナビとの関係
// 実行: node --test server/__tests__/member-profile.test.cjs
// 最優先: 本名・カナ・メール・郵便番号・住所・電話は、本人と運営（DBのオーナー）以外には絶対に出さない。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDb, rejects } = require('./helpers/gotore-pg.cjs');

let h;
test.beforeEach(async () => { h = await createDb(); });

const PRIVATE = {
  last_name: '山田', first_name: '花子', last_name_kana: 'ヤマダ', first_name_kana: 'ハナコ',
  email: 'hanako.secret@example.com', zip: '150-0002', province: '東京都', city: '渋谷区',
  address1: '渋谷2丁目21-1', address2: 'ヒミツビル101', phone: '090-1234-5678',
};
const SECRETS = ['山田', '花子', 'ヤマダ', 'ハナコ', 'hanako.secret', '150-0002', '渋谷2丁目', 'ヒミツビル', '090-1234'];

async function loginMember() {
  const authId = (await h.one(`select gen_random_uuid() id`)).id;
  const id = await h.member();
  await h.db.query(`update members set auth_user_id = $1 where id = $2`, [authId, id]);
  return { id, authId };
}
const savePrivate = (u, p = PRIVATE, agree = true) => h.asUser(u.authId, 'mf_private_save', { p: JSON.stringify(p), p_agree: agree });

test('本人は公開・非公開のプロフィールを保存して読める。足りない項目も分かる', async () => {
  const u = await loginMember();
  let me = await h.asUser(u.authId, 'mf_account_get');
  assert.deepEqual(me.missing.sort(), ['age_band', 'city', 'display_name', 'email', 'gender', 'gyms', 'kana', 'name', 'pref'].sort());
  await h.account(u.id, { display_name: 'はな', gender: 'female', private: false });
  await savePrivate(u);
  me = await h.asUser(u.authId, 'mf_account_get');
  assert.equal(me.public.display_name, 'はな');
  assert.equal(me.private.first_name, '花子');
  assert.equal(me.private.zip, '150-0002');
  assert.deepEqual(me.missing, []);
});

test('ほかの人のログインでは、その人自身の分しか返らない（他人の非公開項目は取れない）', async () => {
  const a = await loginMember(); const b = await loginMember();
  await h.account(a.id, { private: false }); await savePrivate(a);
  const asB = await h.asUser(b.authId, 'mf_account_get');
  assert.equal(asB.private, null);
  for (const s of SECRETS) assert.ok(!JSON.stringify(asB).includes(s), `他人から ${s} が見えた`);
});

test('ログインしていなければ（サーバー権限で呼んでも）本人用の関数は使えない', async () => {
  await rejects(h.asUser(null, 'mf_account_get'), /ログイン/);
  await rejects(h.asUser(null, 'mf_private_save', { p: JSON.stringify(PRIVATE), p_agree: true }), /ログイン/);
});

test('権限：非公開の表は anon・authenticated・service_role のどれからも直接読めない。本人用の関数は authenticated だけ', async () => {
  const r = (await h.db.query(`select
      has_table_privilege('anon', 'member_private_profiles', 'select') a,
      has_table_privilege('authenticated', 'member_private_profiles', 'select') u,
      has_table_privilege('service_role', 'member_private_profiles', 'select') s,
      has_table_privilege('service_role', 'member_profiles', 'select') sp,
      has_function_privilege('authenticated', 'mf_account_get()', 'execute') ga,
      has_function_privilege('service_role', 'mf_account_get()', 'execute') gs,
      has_function_privilege('anon', 'mf_account_get()', 'execute') gn,
      has_function_privilege('service_role', 'mf_private_save(jsonb, boolean)', 'execute') ps,
      has_function_privilege('authenticated', 'mf_public_save(uuid, text, text, text, text, text, jsonb)', 'execute') pa`)).rows[0];
  assert.deepEqual(r, { a: false, u: false, s: false, sp: false, ga: true, gs: false, gn: false, ps: false, pa: false });
});

test('非公開項目の入力チェック：同意必須・LINEの内部メール不可・カナ・郵便番号・住所はまとめて', async () => {
  const u = await loginMember();
  await rejects(savePrivate(u, PRIVATE, false), /同意/);
  await rejects(savePrivate(u, { ...PRIVATE, email: 'line_abc@line.fitpeak.co' }), /メールアドレス/);
  await rejects(savePrivate(u, { ...PRIVATE, email: 'not-an-email' }), /メールアドレス/);
  await rejects(savePrivate(u, { ...PRIVATE, first_name_kana: 'はなこ' }), /カタカナ/);
  await rejects(savePrivate(u, { ...PRIVATE, zip: '12345' }), /郵便番号/);
  await rejects(savePrivate(u, { ...PRIVATE, address1: '' }), /住所/);
  await rejects(savePrivate(u, { ...PRIVATE, phone: '12' }), /電話番号/);
  // 住所・電話は任意（入れるなら揃える）
  await savePrivate(u, { last_name: '山田', first_name: '花子', last_name_kana: 'ヤマダ', first_name_kana: 'ハナコ', email: 'h@example.com' });
  const r = await savePrivate(u, { ...PRIVATE, zip: '1500002' });
  assert.equal(r.ok, true);
  assert.equal((await h.asUser(u.authId, 'mf_account_get')).private.zip, '150-0002', '郵便番号はハイフン付きにそろえる');
});

test('公開項目の入力チェック：表示名に連絡先不可・都道府県・市区町村・ジムは1〜5件・その他のジムは確認待ち', async () => {
  const u = await loginMember();
  await rejects(h.account(u.id, { display_name: 'LINE ID: abc' }), /連絡先/);
  await rejects(h.account(u.id, { display_name: 'x'.repeat(21) }), /表示名/);
  await rejects(h.account(u.id, { pref: '火星県' }), /都道府県/);
  await rejects(h.account(u.id, { city: '<b>' }), /市区町村/);
  await rejects(h.account(u.id, { gyms: [] }), /ジム/);
  await rejects(h.account(u.id, { gyms: Array.from({ length: 6 }, (_, i) => ({ kind: 'review', key: `g${i}`, name: `G${i}` })) }), /ジム/);
  await rejects(h.account(u.id, { gyms: [{ kind: 'other', name: 'instagram @gym' }] }), /連絡先/);
  const r = await h.call('mf_public_save', { p_member: u.id, p_display_name: 'はな', p_pref: '東京都', p_city: '渋谷区',
    p_age_band: '25-34', p_gender: 'female', p_gyms: JSON.stringify([{ kind: 'other', name: '駅前マッスルジム' }]) });
  assert.deepEqual(r.pending_other, ['駅前マッスルジム']);
  const me = await h.asUser(u.authId, 'mf_account_get');
  assert.equal(me.public.gyms[0].status, 'pending');
});

test('合トレ：新しく使う人はアカウントのプロフィールが揃うまで合トレのプロフィールを作れない', async () => {
  const a = await h.member();
  await rejects(h.call('gt_profile_save', { p_member: a, p_level: 'beginner', p_bio: '', p_agree: true }), /アカウント/);
  await h.account(a, { private: false });
  await rejects(h.call('gt_profile_save', { p_member: a, p_level: 'beginner', p_bio: '', p_agree: true }), /アカウント/);
});

test('合トレ：既に合トレを使っている人は、足りない項目があっても使えなくはしない（gt_me で入力を促す）', async () => {
  const a = await h.member();
  // アカウント一本化の前に作られた合トレのプロフィール
  await h.db.query(`insert into gotore_profiles (member_id, nickname, gender, age_band, level, bio, agreed_at) values ($1, '旧たろう', 'male', '25-34', 'beginner', '', now())`, [a]);
  await h.gym();
  const r = await h.call('gt_post_create', { p_member: a, p_handle: 'gym-a', p_slots: ['wd_night'], p_parts: [], p_goals: [], p_gender_pref: 'any', p_note: '' });
  assert.ok(r.post_id);
  await h.call('gt_profile_save', { p_member: a, p_level: 'advanced', p_bio: 'よろしく', p_agree: true, p_history: '1-3y' });
  const me = await h.call('gt_me', { p_member: a });
  assert.equal(me.profile.nickname, '旧たろう', 'アカウントが無くても合トレのプロフィールは直せる');
  assert.equal(me.profile.level, 'advanced');
  assert.equal(me.profile.history, '1-3y');
  assert.ok(me.account_missing.includes('email'));
  assert.ok(me.account_missing.includes('gyms'));
  assert.equal(JSON.stringify(me.account_missing).includes('@'), false, '項目名だけで、値は返さない');
});

test('合トレ：表示名・性別・年代はアカウントから来る（合トレ側で別の値にできない）', async () => {
  const a = await h.member();
  await h.account(a, { display_name: 'はな', gender: 'female', age_band: '35-44' });
  await h.call('gt_profile_save', { p_member: a, p_nickname: 'べつの名前', p_gender: 'male', p_age_band: '18-24', p_level: 'advanced', p_bio: '', p_agree: true });
  let me = await h.call('gt_me', { p_member: a });
  assert.deepEqual([me.profile.nickname, me.profile.gender, me.profile.age_band], ['はな', 'female', '35-44']);
  await h.account(a, { display_name: 'はなこ', gender: 'female', age_band: '35-44' });
  me = await h.call('gt_me', { p_member: a });
  assert.equal(me.profile.nickname, 'はなこ', 'アカウントを直すと合トレ側も変わる');
});

test('合トレ固有の項目（トレーニング歴・得意種目・通う時間帯・目的）を保存でき、掲示板では公開項目と一緒に見える', async () => {
  await h.gym();
  const a = await h.member();
  await h.profile(a, { history: '3-5y', fav_lifts: 'ベンチプレス', usual_slots: ['wd_night'], purposes: ['spot', 'form'] });
  await h.call('gt_post_create', { p_member: a, p_handle: 'gym-a', p_slots: ['wd_night'], p_parts: [], p_goals: [], p_gender_pref: 'any', p_note: '' });
  const b = await h.member(); await h.profile(b);
  const board = await h.call('gt_gym_board', { p_member: b, p_handle: 'gym-a' });
  const p = board.posts[0];
  assert.equal(p.history, '3-5y');
  assert.equal(p.fav_lifts, 'ベンチプレス');
  assert.deepEqual(p.usual_slots, ['wd_night']);
  assert.deepEqual(p.purposes, ['spot', 'form']);
  assert.equal(p.city, '渋谷区');
  assert.deepEqual(p.gyms, ['ONE STEP']);
  await rejects(h.profile(a, { history: 'forever' }), /トレーニング歴/);
  await rejects(h.profile(a, { fav_lifts: 'LINE ID: abc' }), /連絡先/);
});

test('合トレのどの画面・通知・公開集計にも、他人の非公開項目は出ない', async () => {
  await h.gym();
  const a = await loginMember(); const b = await loginMember();
  for (const u of [a, b]) {
    await h.account(u.id, { private: false });
    await savePrivate(u);
    await h.call('gt_profile_save', { p_member: u.id, p_level: 'beginner', p_bio: '', p_agree: true });
  }
  await h.call('gt_watch', { p_member: b.id, p_handle: 'gym-a', p_on: true });
  const post = await h.call('gt_post_create', { p_member: a.id, p_handle: 'gym-a', p_slots: ['wd_night'], p_parts: [], p_goals: [], p_gender_pref: 'any', p_note: '' });
  const rq = await h.call('gt_request', { p_member: b.id, p_post: post.post_id, p_message: 'よろしく' });
  const ans = await h.call('gt_request_answer', { p_member: a.id, p_request: rq.request_id, p_accept: true });
  const out = [
    post, rq, ans,
    await h.call('gt_gym_board', { p_member: b.id, p_handle: 'gym-a' }),
    await h.call('gt_me', { p_member: a.id }), await h.call('gt_me', { p_member: b.id }),
    await h.call('gt_match_messages', { p_member: b.id, p_match: ans.match_id }),
    await h.call('gt_message_send', { p_member: b.id, p_match: ans.match_id, p_body: 'こんにちは' }),
    await h.call('gt_gym_public', { p_handle: 'gym-a' }),
    await h.call('gt_public_overview', { p_pref: null }),
    await h.call('gt_area', { p_member: b.id, p_pref: '東京都', p_city: null }),
  ];
  const json = JSON.stringify(out);
  for (const s of SECRETS) assert.ok(!json.includes(s), `合トレの戻り値に ${s} が含まれている`);
});

test('確認待ちの「その他」のジムは、ほかの会員には出さない（運営が確認したら出す）', async () => {
  await h.gym();
  const a = await h.member();
  await h.account(a, { gyms: [{ kind: 'review', key: 'gym-a', name: 'ONE STEP' }, { kind: 'other', name: '駅前マッスルジム' }] });
  await h.call('gt_profile_save', { p_member: a, p_level: 'beginner', p_bio: '', p_agree: true });
  await h.call('gt_post_create', { p_member: a, p_handle: 'gym-a', p_slots: ['wd_night'], p_parts: [], p_goals: [], p_gender_pref: 'any', p_note: '' });
  const b = await h.member(); await h.profile(b);
  let p = (await h.call('gt_gym_board', { p_member: b, p_handle: 'gym-a' })).posts[0];
  assert.deepEqual(p.gyms, ['ONE STEP']);
  await h.db.query(`update member_profiles set gyms = jsonb_set(gyms, '{1,status}', '"ok"') where member_id = $1`, [a]);
  p = (await h.call('gt_gym_board', { p_member: b, p_handle: 'gym-a' })).posts[0];
  assert.deepEqual(p.gyms, ['ONE STEP', '駅前マッスルジム']);
});

test('本人は非公開項目を削除できる。退会（会員の削除）で公開・非公開とも消える', async () => {
  const u = await loginMember();
  await h.account(u.id, { private: false }); await savePrivate(u);
  await h.asUser(u.authId, 'mf_private_delete');
  assert.equal((await h.asUser(u.authId, 'mf_account_get')).private, null);
  await savePrivate(u);
  await h.db.query(`delete from members where id = $1`, [u.id]);
  const n = (await h.db.query(`select (select count(*) from member_private_profiles)::int p, (select count(*) from member_profiles)::int q`)).rows[0];
  assert.deepEqual(n, { p: 0, q: 0 });
});

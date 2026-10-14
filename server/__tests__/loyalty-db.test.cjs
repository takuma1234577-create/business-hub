// 毎日のログインポイント＋クレアショットチャレンジ：DB層のテスト（仕様書 v1 第13項）
// 実行: node --test server/__tests__/loyalty-db.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDb, rejects } = require('./helpers/loyalty-pg.cjs');

let h;
test.beforeEach(async () => {
  h = await createDb();
});

// ── 毎日のログインポイント ──────────────────────────────

test('初回ログインで1pt・連続1日目。同じ日の2回目は何も起きない', async () => {
  const m = await h.member();
  const r1 = await h.login(m.id);
  assert.equal(r1.status, 'granted');
  assert.equal(r1.points, 1);
  assert.equal(r1.streak, 1);
  assert.equal(r1.days_to_challenge, 27);
  const r2 = await h.login(m.id);
  assert.equal(r2.status, 'already');
  assert.equal(await h.balance(m.id), 1);
  const n = await h.one(`select count(*)::int c from point_transactions where member_id = $1`, [m.id]);
  assert.equal(n.c, 1);
});

test('日本時間 23:59 と 0:00 は別の日として数える（サーバー時刻がUTCでも）', async () => {
  const m = await h.member();
  await h.setJst('2026-10-14 23:59:59');
  assert.equal((await h.login(m.id)).streak, 1);
  await h.setJst('2026-10-15 00:00:00');
  const r = await h.login(m.id);
  assert.equal(r.status, 'granted');
  assert.equal(r.streak, 2);
  await h.setJst('2026-10-15 23:59:59');
  assert.equal((await h.login(m.id)).status, 'already');
});

test('1日空くと連続は1からやり直し', async () => {
  const m = await h.member();
  await h.loginDays(m.id, 3);
  await h.addDays(2);
  const r = await h.login(m.id);
  assert.equal(r.streak, 1);
  assert.equal(r.streak_reset, true);
  const s = await h.one(`select best_streak from login_streaks where member_id = $1`, [m.id]);
  assert.equal(s.best_streak, 3);
});

test('28日目にチャレンジ権（初回）、29日目から2pt、途切れたら1ptに戻る', async () => {
  const m = await h.member();
  const d27 = await h.loginDays(m.id, 27);
  assert.equal(d27.challenge_id, null);
  await h.addDays(1);
  const d28 = await h.login(m.id);
  assert.equal(d28.streak, 28);
  assert.equal(d28.points, 1);
  assert.equal(d28.next_points, 2);
  assert.ok(d28.challenge_id);
  const c = await h.one(`select streak_milestone, tier, expires_at - granted_at as ttl from challenge_draws where id = $1`, [d28.challenge_id]);
  assert.equal(c.streak_milestone, 28);
  assert.equal(c.tier, 'first');
  await h.addDays(1);
  const d29 = await h.login(m.id);
  assert.equal(d29.points, 2);
  assert.equal(await h.balance(m.id), 28 + 2);
  await h.addDays(2);
  const after = await h.login(m.id);
  assert.equal(after.points, 1);
  assert.equal(after.streak, 1);
});

test('56日目のチャレンジは継続者（2%）。途切れてやり直した28日目は初回（1%）に戻り、権利も新たに付く', async () => {
  const m = await h.member();
  const d56 = await h.loginDays(m.id, 56);
  const c56 = await h.one(`select tier from challenge_draws where id = $1`, [d56.challenge_id]);
  assert.equal(c56.tier, 'continuing');
  await h.addDays(2);
  const again = await h.loginDays(m.id, 28);
  assert.ok(again.challenge_id, '新しい連続の28日目にも権利が付く');
  const c = await h.one(`select tier from challenge_draws where id = $1`, [again.challenge_id]);
  assert.equal(c.tier, 'first');
  const n = await h.one(`select count(*)::int c from challenge_draws where member_id = $1`, [m.id]);
  assert.equal(n.c, 3);
});

test('定期購入者でない人・初回発送前・解約後は付与されない', async () => {
  const none = await h.member(null);
  assert.equal((await h.login(none.id)).status, 'not_eligible');
  const pre = await h.member('pending_first_shipment');
  assert.equal((await h.login(pre.id)).status, 'not_eligible');
  const m = await h.member();
  await h.login(m.id);
  await h.setStatus(m.subId, 'cancelled', 'cancelled');
  await h.addDays(1);
  assert.equal((await h.login(m.id)).status, 'not_eligible');
  assert.equal(await h.balance(m.id), 1, '獲得済みポイントは残る');
});

test('休会中は付与しない。休会をまたいでも連続は保持され、再開後に続きから数える', async () => {
  const m = await h.member();
  await h.loginDays(m.id, 5);
  await h.addDays(1);
  await h.setStatus(m.subId, 'paused', 'paused');
  assert.equal((await h.login(m.id)).status, 'paused');
  await h.addDays(10);
  await h.setStatus(m.subId, 'active', 'resumed');
  const r = await h.login(m.id);
  assert.equal(r.status, 'granted');
  assert.equal(r.streak, 6);
});

test('休会が30日を超えた分は保持しない', async () => {
  const m = await h.member();
  await h.loginDays(m.id, 5);
  await h.addDays(1);
  await h.setStatus(m.subId, 'paused', 'paused');
  await h.addDays(40);
  await h.setStatus(m.subId, 'active', 'resumed');
  const r = await h.login(m.id);
  assert.equal(r.streak, 1);
});

test('休会のまま解約したら、のちに再契約しても連続はリセット', async () => {
  const m = await h.member();
  await h.loginDays(m.id, 5);
  await h.addDays(1);
  await h.setStatus(m.subId, 'paused', 'paused');
  await h.addDays(3);
  await h.setStatus(m.subId, 'cancelled', 'cancelled');
  await h.addDays(3);
  await h.one(`insert into subscriptions (shopify_contract_id, status, member_id) values ('gid://test/new', 'active', $1) returning id`, [m.id]);
  const r = await h.login(m.id);
  assert.equal(r.streak, 1);
});

// ── クレアショットチャレンジ ─────────────────────────────

async function memberWithChallenge() {
  const m = await h.member();
  const r = await h.loginDays(m.id, 28);
  return { ...m, drawId: r.challenge_id };
}

test('抽選は1回だけ。再実行しても結果は変わらず、当選率は設定表から読む', async () => {
  await h.exec(`update loyalty_settings set value = '1' where key = 'win_rate_first'`);
  const m = await memberWithChallenge();
  const r1 = (await h.one(`select lp_draw_challenge($1, $2) r`, [m.id, m.drawId])).r;
  assert.equal(r1.result, 'win');
  assert.equal(Number(r1.win_rate), 1);
  await h.exec(`update loyalty_settings set value = '0' where key = 'win_rate_first'`);
  const r2 = (await h.one(`select lp_draw_challenge($1, $2) r`, [m.id, m.drawId])).r;
  assert.equal(r2.result, 'win');
  assert.equal(r2.already, true);
  const d = await h.one(`select prize_status from challenge_draws where id = $1`, [m.drawId]);
  assert.equal(d.prize_status, 'pending');
});

test('当選率0ならハズレ。他人のチャレンジ権は引けない', async () => {
  await h.exec(`update loyalty_settings set value = '0' where key = 'win_rate_first'`);
  const m = await memberWithChallenge();
  const other = await h.member();
  await rejects(h.one(`select lp_draw_challenge($1, $2)`, [other.id, m.drawId]), /not_found/);
  const r = (await h.one(`select lp_draw_challenge($1, $2) r`, [m.id, m.drawId])).r;
  assert.equal(r.result, 'lose');
});

test('チャレンジ権は30日で失効', async () => {
  const m = await memberWithChallenge();
  await h.addDays(31);
  await rejects(h.one(`select lp_draw_challenge($1, $2)`, [m.id, m.drawId]), /expired/);
  assert.equal((await h.one(`select lp_expire_challenges() n`)).n, 1);
  const d = await h.one(`select result from challenge_draws where id = $1`, [m.drawId]);
  assert.equal(d.result, 'expired');
});

test('解約した人は抽選できない', async () => {
  const m = await memberWithChallenge();
  await h.setStatus(m.subId, 'cancelled', 'cancelled');
  await rejects(h.one(`select lp_draw_challenge($1, $2)`, [m.id, m.drawId]), /not_eligible/);
});

test('当選率の変更は監査ログに残り、上限10%を超える値は受け付けない', async () => {
  await h.one(`select lp_set_setting('win_rate_continuing', '0.015', 'owner:test', 'test-pin-1234')`);
  const log = await h.one(`select actor, before, after from loyalty_audit_log where action = 'set_setting' order by id desc limit 1`);
  assert.equal(log.actor, 'owner:test');
  assert.equal(Number(log.before), 0.02);
  assert.equal(Number(log.after), 0.015);
  await rejects(h.one(`select lp_set_setting('win_rate_first', '0.5', 'owner:test', 'test-pin-1234')`), /invalid/);
});

// ── ポイントの仮押さえ・確定・解除 ───────────────────────

async function memberWithPoints(n) {
  const m = await h.member();
  const req = (await h.one(`select lp_request_adjust($1, $2, 'テスト', 'staff') id`, [m.id, n])).id;
  await h.one(`select lp_approve_adjust($1, 'owner', 'test-pin-1234')`, [req]);
  return m;
}

test('仮押さえで残高が減り、残高を超える仮押さえはできない', async () => {
  const m = await memberWithPoints(100);
  await rejects(h.one(`select lp_hold_points($1, 101, 'checkout', 'CODE0000000000001', null, null)`, [m.id]), /insufficient/);
  await h.one(`select lp_hold_points($1, 60, 'checkout', 'CODE0000000000001', null, null)`, [m.id]);
  assert.equal(await h.balance(m.id), 40);
  await rejects(h.one(`select lp_hold_points($1, 41, 'checkout', 'CODE0000000000002', null, null)`, [m.id]), /insufficient/);
});

test('確定は金額が完全一致したときだけ。2回目は何もしない。確定後は解除できない', async () => {
  const m = await memberWithPoints(100);
  const id = (await h.one(`select lp_hold_points($1, 60, 'checkout', 'CODE0000000000001', null, null) id`, [m.id])).id;
  await rejects(h.one(`select lp_confirm_hold($1, 'order-1', 59)`, [id]), /amount_mismatch/);
  const c1 = (await h.one(`select lp_confirm_hold($1, 'order-1', 60) r`, [id])).r;
  assert.equal(c1.status, 'used');
  const c2 = (await h.one(`select lp_confirm_hold($1, 'order-1', 60) r`, [id])).r;
  assert.equal(c2.already, true);
  await rejects(h.one(`select lp_release_hold($1, 'test')`, [id]), /not_held/);
  assert.equal(await h.balance(m.id), 40);
});

test('24時間使われない仮押さえは解除され、ポイントが戻る', async () => {
  const m = await memberWithPoints(100);
  await h.one(`select lp_hold_points($1, 60, 'checkout', 'CODE0000000000001', null, null)`, [m.id]);
  await h.addDays(0.5);
  assert.equal((await h.one(`select lp_release_expired_holds() n`)).n, 0);
  await h.addDays(0.6);
  assert.equal((await h.one(`select lp_release_expired_holds() n`)).n, 1);
  assert.equal(await h.balance(m.id), 100);
  assert.equal((await h.one(`select lp_release_expired_holds() n`)).n, 0);
});

test('定期請求のポイント使用は（契約, 課金サイクル）につき1回だけ', async () => {
  const m = await memberWithPoints(100);
  await h.one(`select lp_hold_points($1, 10, 'billing', null, $2, 3)`, [m.id, m.subId]);
  await rejects(h.one(`select lp_hold_points($1, 10, 'billing', null, $2, 3)`, [m.id, m.subId]), /duplicate|unique/);
  assert.equal(await h.balance(m.id), 90);
});

test('割引コードは16文字以上・同じコードは二度と使えない', async () => {
  const m = await memberWithPoints(100);
  await rejects(h.one(`select lp_hold_points($1, 10, 'checkout', 'SHORT', null, null)`, [m.id]), /invalid/);
  await h.one(`select lp_hold_points($1, 10, 'checkout', 'CODE0000000000001', null, null)`, [m.id]);
  await rejects(h.one(`select lp_hold_points($1, 10, 'checkout', 'CODE0000000000001', null, null)`, [m.id]), /duplicate|unique/);
});

test('返品時の戻しは使った分まで。同じ返品の重複処理は1回分だけ', async () => {
  const m = await memberWithPoints(100);
  const id = (await h.one(`select lp_hold_points($1, 60, 'checkout', 'CODE0000000000001', null, null) id`, [m.id])).id;
  await h.one(`select lp_confirm_hold($1, 'order-1', 60)`, [id]);
  await h.one(`select lp_refund_points($1, 50, 'refund:wh-1')`, [id]);
  await h.one(`select lp_refund_points($1, 50, 'refund:wh-1')`, [id]);
  assert.equal(await h.balance(m.id), 90);
  await rejects(h.one(`select lp_refund_points($1, 11, 'refund:wh-2')`, [id]), /exceeds/);
  await h.one(`select lp_refund_points($1, 10, 'refund:wh-3')`, [id]);
  assert.equal(await h.balance(m.id), 100);
});

// ── 手動付与（2段階）・失効 ──────────────────────────────

test('手動付与は承認まで反映されず、承認は1回だけ効く。残高を0未満にする訂正はできない', async () => {
  const m = await h.member();
  const req = (await h.one(`select lp_request_adjust($1, 30, 'お詫び', 'staff') id`, [m.id])).id;
  assert.equal(await h.balance(m.id), 0);
  await h.one(`select lp_approve_adjust($1, 'owner', 'test-pin-1234')`, [req]);
  await h.one(`select lp_approve_adjust($1, 'owner', 'test-pin-1234')`, [req]);
  assert.equal(await h.balance(m.id), 30);
  await rejects(h.one(`select lp_request_adjust($1, 5, '', 'staff')`, [m.id]), /reason/);
  const neg = (await h.one(`select lp_request_adjust($1, -31, '訂正', 'staff') id`, [m.id])).id;
  await rejects(h.one(`select lp_approve_adjust($1, 'owner', 'test-pin-1234')`, [neg]), /insufficient|available_points/);
  assert.equal(await h.balance(m.id), 30);
});

test('最後の獲得から1年で失効（逆仕訳で記録）。1年以内に獲得があれば失効しない', async () => {
  const a = await h.member();
  const b = await h.member();
  await h.login(a.id);
  await h.login(b.id);
  await h.addDays(200);
  await h.login(b.id);
  await h.addDays(166);
  assert.equal((await h.one(`select lp_expire_points() n`)).n, 1);
  assert.equal(await h.balance(a.id), 0);
  assert.equal(await h.balance(b.id), 2);
  const t = await h.one(`select type, amount from point_transactions where member_id = $1 order by created_at desc limit 1`, [a.id]);
  assert.deepEqual([t.type, t.amount], ['expire', -1]);
  assert.equal((await h.one(`select lp_expire_points() n`)).n, 0);
});

// ── 権限（サービスキーが漏れてもルール外の付与はできない） ──────

test('帳簿の更新・削除は誰であっても拒否される', async () => {
  const m = await h.member();
  await h.login(m.id);
  await rejects(h.exec(`update point_transactions set amount = 1000`), /append-only/);
  await rejects(h.exec(`delete from point_transactions`), /append-only/);
  await rejects(h.exec(`update loyalty_audit_log set actor = 'x'`), /append-only/);
});

test('service_role でも表へ直接は書けず、関数経由だけ通る', async () => {
  const m = await h.member();
  await rejects(h.asRole('service_role', `insert into point_transactions (user_points_id, type, amount, source) values (gen_random_uuid(), 'earn', 1000, 'x')`), /permission denied/);
  await rejects(h.asRole('service_role', `update user_points set available_points = 99999`), /permission denied/);
  await rejects(h.asRole('service_role', `insert into challenge_draws (member_id, run_started_on, streak_milestone, tier) values ($1, current_date, 28, 'first')`, [m.id]), /permission denied/);
  await rejects(h.asRole('service_role', `update loyalty_settings set value = '1'`), /permission denied/);
  await rejects(h.asRole('service_role', `update login_streaks set current_streak = 27`), /permission denied/);
  const r = await h.asRole('service_role', `select lp_daily_login($1) r`, [m.id]);
  assert.equal(r.rows[0].r.status, 'granted');
  const s = await h.asRole('service_role', `select available_points from user_points where member_id = $1`, [m.id]);
  assert.equal(s.rows[0].available_points, 1);
});

test('承認・設定変更はオーナー暗証番号が違えば拒否。内部関数（帳簿への直接書き込み）は service_role から呼べない', async () => {
  const m = await h.member();
  const req = (await h.one(`select lp_request_adjust($1, 30, 'お詫び', 'staff') id`, [m.id])).id;
  await rejects(h.one(`select lp_approve_adjust($1, 'owner', 'wrong-pin-0000')`, [req]), /owner_pin_invalid/);
  await rejects(h.one(`select lp_set_setting('win_rate_first', '0.02', 'x', null)`), /owner_pin_invalid/);
  assert.equal(await h.balance(m.id), 0);
  await rejects(h.asRole('service_role', `select lp_ledger($1, 'earn', 1000, 'x', 'x')`, [m.id]), /permission denied/);
  await rejects(h.asRole('service_role', `select lp_set_owner_pin('attacker-pin-1')`), /permission denied/);
  await rejects(h.asRole('service_role', `select * from loyalty_secrets`), /permission denied/);
});

test('anon・authenticated は関数も表も使えない', async () => {
  const m = await h.member();
  await rejects(h.asRole('anon', `select lp_daily_login($1)`, [m.id]), /permission denied/);
  await rejects(h.asRole('authenticated', `select lp_daily_login($1)`, [m.id]), /permission denied/);
  await rejects(h.asRole('anon', `select * from point_transactions`), /permission denied/);
});

// ── 状態の取得・定期契約との紐づけ ─────────────────────────

test('lp_status：残高・連続・未抽選のチャレンジ・履歴・有効期限を1回で返す（付与はしない）', async () => {
  const m = await h.member();
  const before = (await h.one(`select lp_status($1) r`, [m.id])).r;
  assert.equal(before.balance, 0);
  assert.equal(before.logged_in_today, false);
  assert.equal(before.eligibility, 'active');
  await h.loginDays(m.id, 28);
  const s = (await h.one(`select lp_status($1) r`, [m.id])).r;
  assert.equal(s.balance, 28);
  assert.equal(s.streak, 28);
  assert.equal(s.logged_in_today, true);
  assert.equal(s.streak_alive, true);
  assert.equal(s.open_challenges.length, 1);
  assert.equal(s.open_challenges[0].tier, 'first');
  assert.equal(s.transactions.length, 20);
  assert.ok(s.points_expire_on);
  await h.addDays(3);
  const later = (await h.one(`select lp_status($1) r`, [m.id])).r;
  assert.equal(later.streak_alive, false, '2日以上空いたら連続は切れている表示');
  assert.equal(later.balance, 28);
});

test('lp_link_subscription：注文の契約を会員に紐づける。別の会員の契約は奪えない', async () => {
  const a = await h.member(null);
  const b = await h.member(null);
  const sub = await h.one(`insert into subscriptions (shopify_contract_id, status, first_order_id, shopify_customer_id) values ('gid://c/1', 'active', '5001', '777') returning id`);
  const r = (await h.one(`select lp_link_subscription($1, '5001', '777') r`, [a.id])).r;
  assert.equal(r.linked, 1);
  assert.equal((await h.login(a.id)).status, 'granted');
  const again = (await h.one(`select lp_link_subscription($1, '5001', '777') r`, [a.id])).r;
  assert.equal(again.linked, 1);
  await rejects(h.one(`select lp_link_subscription($1, '5001', '777')`, [b.id]), /subscription_taken/);
  const owner = await h.one(`select member_id from subscriptions where id = $1`, [sub.id]);
  assert.equal(owner.member_id, a.id);
});

test('lp_link_by_email：同じメールの未紐づけ契約だけを紐づける', async () => {
  const a = await h.member(null);
  await h.one(`insert into subscriptions (shopify_contract_id, status, email) values ('gid://c/2', 'active', 'Taro@Example.com') returning id`);
  await h.one(`insert into subscriptions (shopify_contract_id, status, email) values ('gid://c/3', 'active', 'other@example.com') returning id`);
  const r = (await h.one(`select lp_link_by_email($1, 'taro@example.com') r`, [a.id])).r;
  assert.equal(r, 1);
  assert.equal((await h.one(`select lp_link_by_email($1, '') r`, [a.id])).r, 0);
});

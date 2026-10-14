-- 毎日のログインポイント＋クレアショットチャレンジ（仕様書 v1・2026-10-13 宇良確定）
-- 正本: Notion「【仕様書】毎日のログインポイント＋クレアショットチャレンジ 実装仕様書 v1」
--
-- 不正防止の骨格（仕様書 第12項）
--   1. 付与数・当選結果・日付・残高はすべてこのDB関数が決める。アプリは「ログインした」「引く」「◯pt使う」を依頼するだけ
--   2. point_transactions が正本。追記のみ（更新・削除はトリガーで誰であっても拒否）。user_points はトリガーで更新する写し
--   3. 表への直接書き込みは anon / authenticated / service_role から権限ごと外す。書けるのは SECURITY DEFINER の lp_* 関数だけ
--      → サービスキーが漏れても、ルール外の付与・当選は作れない
--   4. 一意制約で二重付与・二重使用を物理的に不可能にする
--
-- 仕様書からの意図的な差分
--   - 会員の識別は members.id（uuid）。仕様書の user_id text は既存の会員表に合わせて member_id にした
--   - チャレンジ権の一意キーは（会員, 連続の開始日, 節目）。仕様書の（会員, 節目）だと、連続が途切れたあとの
--     2回目の「28日目」に権利が付かなくなるため
--   - 乱数は Node の crypto.randomInt ではなく DB 内の pgcrypto gen_random_bytes（暗号論的乱数）。
--     アプリから乱数を渡す形だと、サービスキーを持つ者が当たりの乱数を渡せてしまうため
--
-- 再実行可能。

-- ── 時刻（テストでは差し替える） ─────────────────────────
create or replace function lp_now() returns timestamptz language sql stable as $$ select now() $$;

create or replace function lp_today() returns date
language sql stable set search_path = public, pg_temp
as $$ select (lp_now() at time zone 'Asia/Tokyo')::date $$;

-- ── 既存表の拡張 ─────────────────────────────────────
alter table point_transactions add column if not exists member_id uuid references members(id) on delete set null;
alter table point_transactions add column if not exists idempotency_key text;
alter table point_transactions add column if not exists hold_id uuid;
create unique index if not exists point_transactions_idempotency_key on point_transactions (idempotency_key);
create index if not exists point_transactions_member_idx on point_transactions (member_id, created_at desc);

alter table point_transactions drop constraint if exists point_transactions_type_check;
alter table point_transactions add constraint point_transactions_type_check
  check (type in ('earn', 'spend', 'expire', 'adjust', 'hold', 'release', 'refund'));

create unique index if not exists user_points_member_id_key on user_points (member_id);
alter table user_points drop constraint if exists user_points_available_nonneg;
alter table user_points add constraint user_points_available_nonneg check (available_points >= 0);

-- ── 新しい表 ─────────────────────────────────────────
create table if not exists loyalty_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);
insert into loyalty_settings (key, value) values
  ('win_rate_first', '0.01'),
  ('win_rate_continuing', '0.02'),
  ('eligible_statuses', '["active", "awaiting_delivery", "past_due"]'),
  ('challenge_ttl_days', '30'),
  ('hold_ttl_checkout_hours', '24'),
  ('hold_ttl_billing_hours', '72'),
  ('max_pause_days', '30')
on conflict (key) do nothing;

-- 暗証番号のハッシュ。どのロールにも閲覧権限を与えない（関数の中からだけ読む）
create table if not exists loyalty_secrets (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

create table if not exists loyalty_audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor text not null,
  action text not null,
  target text,
  before jsonb,
  after jsonb
);

create table if not exists login_streaks (
  member_id uuid primary key references members(id) on delete cascade,
  current_streak int not null default 0,
  best_streak int not null default 0,
  last_login_date date,
  run_started_on date,
  updated_at timestamptz not null default now()
);

create table if not exists challenge_draws (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  run_started_on date not null,
  streak_milestone int not null check (streak_milestone > 0 and streak_milestone % 28 = 0),
  tier text not null check (tier in ('first', 'continuing')),
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  drawn_at timestamptz,
  win_rate numeric,
  result text check (result in ('win', 'lose', 'expired')),
  prize_status text check (prize_status in ('pending', 'approved', 'shipped')),
  subscription_id uuid references subscriptions(id) on delete set null,
  unique (member_id, run_started_on, streak_milestone)
);
create index if not exists challenge_draws_open_idx on challenge_draws (expires_at) where drawn_at is null and result is null;

create table if not exists point_holds (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id),
  amount int not null check (amount > 0),
  purpose text not null check (purpose in ('checkout', 'billing')),
  discount_code text unique,
  subscription_id uuid references subscriptions(id),
  cycle_no int,
  status text not null default 'held' check (status in ('held', 'used', 'released')),
  expires_at timestamptz not null,
  shopify_order_id text,
  refunded int not null default 0 check (refunded >= 0 and refunded <= amount),
  release_reason text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (subscription_id, cycle_no),
  check (
    (purpose = 'checkout' and discount_code is not null)
    or (purpose = 'billing' and subscription_id is not null and cycle_no is not null)
  )
);
create index if not exists point_holds_open_idx on point_holds (expires_at) where status = 'held';

create table if not exists loyalty_adjust_requests (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id),
  amount int not null check (amount <> 0),
  reason text not null check (length(btrim(reason)) > 0),
  requested_by text not null,
  requested_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by text,
  decided_at timestamptz
);

alter table loyalty_settings enable row level security;
alter table loyalty_secrets enable row level security;
alter table loyalty_audit_log enable row level security;
alter table login_streaks enable row level security;
alter table challenge_draws enable row level security;
alter table point_holds enable row level security;
alter table loyalty_adjust_requests enable row level security;

-- ── 追記のみ（更新・削除・TRUNCATE を誰であっても拒否） ──────────
create or replace function lp_reject_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'append-only: % は追記のみ（訂正は逆仕訳で）', tg_table_name;
end $$;

drop trigger if exists point_transactions_append_only on point_transactions;
create trigger point_transactions_append_only before update or delete on point_transactions
  for each row execute function lp_reject_mutation();
drop trigger if exists point_transactions_no_truncate on point_transactions;
create trigger point_transactions_no_truncate before truncate on point_transactions
  for each statement execute function lp_reject_mutation();
drop trigger if exists loyalty_audit_log_append_only on loyalty_audit_log;
create trigger loyalty_audit_log_append_only before update or delete on loyalty_audit_log
  for each row execute function lp_reject_mutation();
drop trigger if exists loyalty_audit_log_no_truncate on loyalty_audit_log;
create trigger loyalty_audit_log_no_truncate before truncate on loyalty_audit_log
  for each statement execute function lp_reject_mutation();

-- 残高（user_points）は帳簿の写し。帳簿に1行入るたびに足し込む。0未満は CHECK 制約で拒否
create or replace function lp_apply_to_balance() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update user_points set
    available_points = coalesce(available_points, 0) + new.amount,
    total_points = coalesce(total_points, 0) + new.amount,
    lifetime_points = coalesce(lifetime_points, 0) + case when new.type = 'earn' then new.amount else 0 end,
    updated_at = now()
  where id = new.user_points_id;
  return new;
end $$;

drop trigger if exists point_transactions_apply on point_transactions;
create trigger point_transactions_apply after insert on point_transactions
  for each row execute function lp_apply_to_balance();

-- ── 内部ヘルパー ──────────────────────────────────────
create or replace function lp_setting(p_key text) returns jsonb
language sql stable set search_path = public, pg_temp
as $$ select value from loyalty_settings where key = p_key $$;

create or replace function lp_audit(p_actor text, p_action text, p_target text, p_before jsonb, p_after jsonb) returns void
language sql security definer set search_path = public, pg_temp
as $$ insert into loyalty_audit_log (actor, action, target, before, after) values (p_actor, p_action, p_target, p_before, p_after) $$;

-- 会員のポイント口座（user_points）。無ければ作る。行ロックして返す
create or replace function lp_wallet(p_member uuid) returns user_points
language plpgsql security definer set search_path = public, pg_temp
as $$
declare w user_points;
begin
  insert into user_points (member_id) values (p_member) on conflict (member_id) do nothing;
  select * into w from user_points where member_id = p_member for update;
  return w;
end $$;

create or replace function lp_ledger(
  p_member uuid, p_type text, p_amount int, p_source text, p_key text,
  p_description text default null, p_hold_id uuid default null, p_order_id text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare w user_points; v_id uuid;
begin
  w := lp_wallet(p_member);
  if p_amount < 0 and coalesce(w.available_points, 0) + p_amount < 0 then
    raise exception 'insufficient_points';
  end if;
  insert into point_transactions (user_points_id, member_id, type, amount, source, description, idempotency_key, hold_id, shopify_order_id, reference_id, created_at)
  values (w.id, p_member, p_type, p_amount, p_source, p_description, p_key, p_hold_id, p_order_id, p_key, lp_now())
  returning id into v_id;
  return v_id;
end $$;

-- 定期の状態：'active'（特典対象）／'paused'（休会中）／'none'（対象外）
create or replace function lp_member_state(p_member uuid) returns text
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_eligible text[];
begin
  select array(select jsonb_array_elements_text(lp_setting('eligible_statuses'))) into v_eligible;
  if exists (select 1 from subscriptions where member_id = p_member and status = any (v_eligible)) then
    return 'active';
  end if;
  if exists (select 1 from subscriptions where member_id = p_member and status = 'paused') then
    return 'paused';
  end if;
  return 'none';
end $$;

-- [p_from, p_to] のうち休会していた日（日本時間）の数。1回の休会は最長 max_pause_days 日まで数える
create or replace function lp_paused_days(p_member uuid, p_from date, p_to date) returns int
language sql stable security definer set search_path = public, pg_temp
as $$
  with pauses as (
    select
      (e.created_at at time zone 'Asia/Tokyo')::date as start_day,
      least(
        coalesce((
          select min(x.created_at) from subscription_events x
          where x.subscription_id = e.subscription_id
            and x.event_type in ('resumed', 'cancelled')
            and x.created_at > e.created_at
        ), lp_now()),
        e.created_at + make_interval(days => (lp_setting('max_pause_days'))::int)
      ) as end_at
    from subscription_events e
    join subscriptions s on s.id = e.subscription_id
    where s.member_id = p_member and e.event_type = 'paused'
  )
  select count(distinct d)::int
  from generate_series(p_from, p_to, interval '1 day') as g(d)
  join pauses p on g.d::date between p.start_day and (p.end_at at time zone 'Asia/Tokyo')::date
  where p_from <= p_to
$$;

create or replace function lp_random_ppm() returns int
language plpgsql volatile security definer set search_path = public, extensions, pg_temp
as $$
declare v bigint;
begin
  -- 4バイトの暗号論的乱数を 0〜999,999 に一様に落とす（端数は捨てて引き直す）
  loop
    v := ('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint;
    if v < 4294000000 then
      return (v % 1000000)::int;
    end if;
  end loop;
end $$;

create or replace function lp_login_state(p_member uuid, p_status text, p_points int, p_reset boolean, p_challenge uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare s login_streaks; v_streak int; v_balance int;
begin
  select * into s from login_streaks where member_id = p_member;
  v_streak := coalesce(s.current_streak, 0);
  select coalesce(available_points, 0) into v_balance from user_points where member_id = p_member;
  return jsonb_build_object(
    'status', p_status,
    'points', p_points,
    'streak', v_streak,
    'best_streak', coalesce(s.best_streak, 0),
    'last_login_date', s.last_login_date,
    'next_points', case when v_streak + 1 >= 29 then 2 else 1 end,
    'days_to_challenge', 28 - (v_streak % 28),
    'boosted', v_streak >= 29,
    'streak_reset', p_reset,
    'challenge_id', p_challenge,
    'balance', coalesce(v_balance, 0)
  );
end $$;

-- ── 毎日のログインポイント ──────────────────────────────
create or replace function lp_daily_login(p_member uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_today date := lp_today();
  v_state text;
  s login_streaks;
  v_streak int;
  v_run date;
  v_reset boolean := false;
  v_points int;
  v_challenge uuid;
  v_sub uuid;
begin
  if p_member is null or not exists (select 1 from members where id = p_member) then
    raise exception 'member_not_found';
  end if;

  insert into login_streaks (member_id) values (p_member) on conflict (member_id) do nothing;
  select * into s from login_streaks where member_id = p_member for update;

  if s.last_login_date = v_today then
    return lp_login_state(p_member, 'already', 0, false, null);
  end if;

  v_state := lp_member_state(p_member);
  if v_state = 'paused' then
    return lp_login_state(p_member, 'paused', 0, false, null);
  elsif v_state <> 'active' then
    return lp_login_state(p_member, 'not_eligible', 0, false, null);
  end if;

  if s.last_login_date is null or s.last_login_date > v_today then
    v_streak := 1;
  elsif s.last_login_date = v_today - 1 then
    v_streak := s.current_streak + 1;
  elsif lp_paused_days(p_member, s.last_login_date + 1, v_today - 1) >= (v_today - s.last_login_date - 1) then
    v_streak := s.current_streak + 1;
  else
    v_streak := 1;
    v_reset := true;
  end if;

  v_run := case when v_streak = 1 then v_today else coalesce(s.run_started_on, v_today) end;
  v_points := case when v_streak >= 29 then 2 else 1 end;

  perform lp_ledger(p_member, 'earn', v_points, 'daily_login',
    'daily_login:' || p_member || ':' || v_today, '毎日のログインポイント（連続' || v_streak || '日目）');

  update login_streaks set
    current_streak = v_streak,
    best_streak = greatest(best_streak, v_streak),
    last_login_date = v_today,
    run_started_on = v_run,
    updated_at = now()
  where member_id = p_member;

  if v_streak % 28 = 0 then
    select id into v_sub from subscriptions where member_id = p_member order by created_at desc limit 1;
    insert into challenge_draws (member_id, run_started_on, streak_milestone, tier, granted_at, expires_at, subscription_id)
    values (p_member, v_run, v_streak, case when v_streak = 28 then 'first' else 'continuing' end,
      lp_now(), lp_now() + make_interval(days => (lp_setting('challenge_ttl_days'))::int), v_sub)
    on conflict (member_id, run_started_on, streak_milestone) do nothing
    returning id into v_challenge;
  end if;

  return lp_login_state(p_member, 'granted', v_points, v_reset, v_challenge);
end $$;

-- ── クレアショットチャレンジ ────────────────────────────
create or replace function lp_draw_challenge(p_member uuid, p_draw_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare d challenge_draws; v_rate numeric; v_win boolean;
begin
  select * into d from challenge_draws where id = p_draw_id and member_id = p_member for update;
  if not found then
    raise exception 'challenge_not_found';
  end if;
  if d.drawn_at is not null then
    return jsonb_build_object('result', d.result, 'win_rate', d.win_rate, 'already', true, 'id', d.id);
  end if;
  if d.result = 'expired' or d.expires_at <= lp_now() then
    raise exception 'challenge_expired';
  end if;
  if lp_member_state(p_member) = 'none' then
    raise exception 'not_eligible';
  end if;

  v_rate := (lp_setting(case when d.tier = 'first' then 'win_rate_first' else 'win_rate_continuing' end))::numeric;
  v_win := lp_random_ppm() < round(v_rate * 1000000);

  update challenge_draws set
    drawn_at = lp_now(),
    win_rate = v_rate,
    result = case when v_win then 'win' else 'lose' end,
    prize_status = case when v_win then 'pending' end
  where id = d.id;

  perform lp_audit('member:' || p_member, 'draw_challenge', d.id::text, null,
    jsonb_build_object('result', case when v_win then 'win' else 'lose' end, 'win_rate', v_rate, 'tier', d.tier));

  return jsonb_build_object('result', case when v_win then 'win' else 'lose' end, 'win_rate', v_rate, 'already', false, 'id', d.id);
end $$;

create or replace function lp_expire_challenges() returns int
language plpgsql security definer set search_path = public, pg_temp
as $$
declare n int;
begin
  update challenge_draws set result = 'expired'
  where drawn_at is null and result is null and expires_at <= lp_now();
  get diagnostics n = row_count;
  return n;
end $$;

-- 当選分の発送状態：pending → approved（運営承認）→ shipped
create or replace function lp_mark_prize(p_draw_id uuid, p_status text, p_actor text) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare d challenge_draws;
begin
  select * into d from challenge_draws where id = p_draw_id for update;
  if not found or d.result is distinct from 'win' then
    raise exception 'prize_not_found';
  end if;
  if not ((d.prize_status = 'pending' and p_status = 'approved') or (d.prize_status = 'approved' and p_status = 'shipped')) then
    raise exception 'invalid_prize_transition: % -> %', d.prize_status, p_status;
  end if;
  update challenge_draws set prize_status = p_status where id = p_draw_id;
  perform lp_audit(p_actor, 'mark_prize', p_draw_id::text, to_jsonb(d.prize_status), to_jsonb(p_status));
end $$;

-- ── ポイントの仮押さえ・確定・解除・返品戻し ────────────────
create or replace function lp_hold_points(
  p_member uuid, p_amount int, p_purpose text, p_discount_code text, p_subscription_id uuid, p_cycle_no int
) returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare w user_points; v_id uuid; v_ttl int;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;
  if p_purpose = 'checkout' and (p_discount_code is null or p_discount_code !~ '^[A-Z0-9]{16,}$') then
    raise exception 'invalid_discount_code';
  end if;
  w := lp_wallet(p_member);
  if coalesce(w.available_points, 0) < p_amount then
    raise exception 'insufficient_points';
  end if;
  v_ttl := (lp_setting(case when p_purpose = 'checkout' then 'hold_ttl_checkout_hours' else 'hold_ttl_billing_hours' end))::int;
  insert into point_holds (member_id, amount, purpose, discount_code, subscription_id, cycle_no, expires_at, created_at)
  values (p_member, p_amount, p_purpose, p_discount_code, p_subscription_id, p_cycle_no,
    lp_now() + make_interval(hours => v_ttl), lp_now())
  returning id into v_id;
  perform lp_ledger(p_member, 'hold', -p_amount, 'point_hold_' || p_purpose, 'hold:' || v_id, 'ポイント仮押さえ', v_id);
  return v_id;
end $$;

-- 確定は署名検証済みの Webhook からのみ呼ぶ。割引額と仮押さえ額が1円でも違えば拒否
create or replace function lp_confirm_hold(p_hold_id uuid, p_shopify_order_id text, p_discount_amount int) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare hd point_holds;
begin
  select * into hd from point_holds where id = p_hold_id for update;
  if not found then
    raise exception 'hold_not_found';
  end if;
  if hd.status = 'used' and hd.shopify_order_id = p_shopify_order_id then
    return jsonb_build_object('status', 'used', 'already', true);
  end if;
  if hd.status <> 'held' then
    raise exception 'not_held: %', hd.status;
  end if;
  if p_discount_amount is distinct from hd.amount then
    raise exception 'amount_mismatch: hold % / discount %', hd.amount, p_discount_amount;
  end if;
  update point_holds set status = 'used', shopify_order_id = p_shopify_order_id, resolved_at = lp_now() where id = hd.id;
  perform lp_audit('webhook', 'confirm_hold', hd.id::text, null,
    jsonb_build_object('order', p_shopify_order_id, 'amount', hd.amount));
  return jsonb_build_object('status', 'used', 'already', false);
end $$;

create or replace function lp_release_hold(p_hold_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare hd point_holds;
begin
  select * into hd from point_holds where id = p_hold_id for update;
  if not found then
    raise exception 'hold_not_found';
  end if;
  if hd.status <> 'held' then
    raise exception 'not_held: %', hd.status;
  end if;
  update point_holds set status = 'released', release_reason = p_reason, resolved_at = lp_now() where id = hd.id;
  perform lp_ledger(hd.member_id, 'release', hd.amount, 'point_hold_release', 'release:' || hd.id, 'ポイント仮押さえの解除', hd.id);
  return jsonb_build_object('status', 'released');
end $$;

create or replace function lp_release_expired_holds() returns int
language plpgsql security definer set search_path = public, pg_temp
as $$
declare r record; n int := 0;
begin
  for r in select id from point_holds where status = 'held' and expires_at <= lp_now() for update skip locked loop
    perform lp_release_hold(r.id, 'expired');
    n := n + 1;
  end loop;
  return n;
end $$;

-- 返品・キャンセル時の戻し。使った分まで。同じキー（Webhook ID 等）は1回だけ
create or replace function lp_refund_points(p_hold_id uuid, p_amount int, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare hd point_holds;
begin
  if p_idempotency_key is null or length(p_idempotency_key) = 0 then
    raise exception 'idempotency_key_required';
  end if;
  if exists (select 1 from point_transactions where idempotency_key = p_idempotency_key) then
    return jsonb_build_object('already', true);
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;
  select * into hd from point_holds where id = p_hold_id for update;
  if not found then
    raise exception 'hold_not_found';
  end if;
  if hd.status <> 'used' then
    raise exception 'not_used: %', hd.status;
  end if;
  if hd.refunded + p_amount > hd.amount then
    raise exception 'refund_exceeds_used: used % / refunded % / requested %', hd.amount, hd.refunded, p_amount;
  end if;
  update point_holds set refunded = refunded + p_amount where id = hd.id;
  perform lp_ledger(hd.member_id, 'refund', p_amount, 'order_refund', p_idempotency_key, '返品・キャンセルによるポイント戻し', hd.id, hd.shopify_order_id);
  return jsonb_build_object('already', false, 'refunded', hd.refunded + p_amount);
end $$;

-- ── 失効：最後の獲得から1年 ─────────────────────────────
create or replace function lp_expire_points() returns int
language plpgsql security definer set search_path = public, pg_temp
as $$
declare r record; w user_points; v_last timestamptz; n int := 0;
begin
  for r in select member_id from user_points where member_id is not null and available_points > 0 loop
    w := lp_wallet(r.member_id);
    select max(created_at) into v_last from point_transactions
      where member_id = r.member_id and (type = 'earn' or (type = 'adjust' and amount > 0));
    if w.available_points > 0 and (v_last is null or v_last <= lp_now() - interval '1 year') then
      perform lp_ledger(r.member_id, 'expire', -w.available_points, 'expiry', null, '有効期限（最後の獲得から1年）による失効');
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- ── オーナー暗証番号 ─────────────────────────────────
-- 手動付与の承認と設定変更は、オーナーだけが知る暗証番号を毎回要求する。
-- 暗証番号はハッシュ（bcrypt）でDBにだけ置き、環境変数には置かない → サービスキーが漏れても承認はできない。
-- 設定・変更は Supabase の SQL エディタ（postgres 権限）から: select lp_set_owner_pin('…');
create or replace function lp_set_owner_pin(p_pin text) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
begin
  if p_pin is null or length(p_pin) < 8 then
    raise exception 'owner_pin_too_short';
  end if;
  insert into loyalty_secrets (key, value)
  values ('owner_pin_hash', extensions.crypt(p_pin, extensions.gen_salt('bf', 10)))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform lp_audit('sql', 'set_owner_pin', null, null, null);
end $$;

create or replace function lp_verify_owner_pin(p_pin text) returns void
language plpgsql stable security definer set search_path = public, extensions, pg_temp
as $$
declare v_hash text := (select value from loyalty_secrets where key = 'owner_pin_hash');
begin
  if v_hash is null or p_pin is null or extensions.crypt(p_pin, v_hash) <> v_hash then
    raise exception 'owner_pin_invalid';
  end if;
end $$;

-- ── 設定（当選率など）。変更は監査ログに残す ───────────────
create or replace function lp_set_setting(p_key text, p_value jsonb, p_actor text, p_owner_pin text) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_before jsonb;
begin
  perform lp_verify_owner_pin(p_owner_pin);
  select value into v_before from loyalty_settings where key = p_key for update;
  if not found then
    raise exception 'invalid_setting_key: %', p_key;
  end if;
  if p_key in ('win_rate_first', 'win_rate_continuing') then
    if jsonb_typeof(p_value) <> 'number' or p_value::numeric < 0 or p_value::numeric > 0.1 then
      raise exception 'invalid_setting_value: 当選率は 0〜0.1 で指定';
    end if;
  elsif p_key = 'eligible_statuses' then
    if jsonb_typeof(p_value) <> 'array' then
      raise exception 'invalid_setting_value';
    end if;
  elsif jsonb_typeof(p_value) <> 'number' or p_value::numeric <= 0 then
    raise exception 'invalid_setting_value';
  end if;
  update loyalty_settings set value = p_value, updated_at = now(), updated_by = p_actor where key = p_key;
  perform lp_audit(p_actor, 'set_setting', p_key, v_before, p_value);
end $$;

-- ── 手動付与・訂正（申請 → オーナー承認の2段階） ─────────────
create or replace function lp_request_adjust(p_member uuid, p_amount int, p_reason text, p_requested_by text) returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'reason_required';
  end if;
  insert into loyalty_adjust_requests (member_id, amount, reason, requested_by)
  values (p_member, p_amount, p_reason, p_requested_by) returning id into v_id;
  perform lp_audit(p_requested_by, 'request_adjust', v_id::text, null,
    jsonb_build_object('member', p_member, 'amount', p_amount, 'reason', p_reason));
  return v_id;
end $$;

create or replace function lp_approve_adjust(p_request_id uuid, p_approved_by text, p_owner_pin text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare q loyalty_adjust_requests;
begin
  perform lp_verify_owner_pin(p_owner_pin);
  select * into q from loyalty_adjust_requests where id = p_request_id for update;
  if not found then
    raise exception 'request_not_found';
  end if;
  if q.status = 'approved' then
    return jsonb_build_object('status', 'approved', 'already', true);
  end if;
  if q.status <> 'pending' then
    raise exception 'not_pending: %', q.status;
  end if;
  perform lp_wallet(q.member_id);
  perform lp_ledger(q.member_id, 'adjust', q.amount, 'manual_adjust', 'adjust:' || q.id, q.reason);
  update loyalty_adjust_requests set status = 'approved', decided_by = p_approved_by, decided_at = now() where id = q.id;
  perform lp_audit(p_approved_by, 'approve_adjust', q.id::text, null, jsonb_build_object('amount', q.amount));
  return jsonb_build_object('status', 'approved', 'already', false);
end $$;

create or replace function lp_reject_adjust(p_request_id uuid, p_rejected_by text) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update loyalty_adjust_requests set status = 'rejected', decided_by = p_rejected_by, decided_at = now()
  where id = p_request_id and status = 'pending';
  if not found then
    raise exception 'not_pending';
  end if;
  perform lp_audit(p_rejected_by, 'reject_adjust', p_request_id::text, null, null);
end $$;

-- ── 権限：表は閲覧のみ、書き込みは関数経由のみ ───────────────
revoke all on point_transactions, user_points, login_streaks, challenge_draws, point_holds,
  loyalty_settings, loyalty_audit_log, loyalty_adjust_requests
  from public, anon, authenticated, service_role;
grant select on point_transactions, user_points, login_streaks, challenge_draws, point_holds,
  loyalty_settings, loyalty_audit_log, loyalty_adjust_requests
  to service_role;
revoke all on loyalty_secrets from public, anon, authenticated, service_role;
revoke all on sequence loyalty_audit_log_id_seq from public, anon, authenticated, service_role;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'lp\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

-- 内部ヘルパーはアプリから呼べないようにする（lp_ledger を直接呼べると任意の付与ができてしまう）
revoke all on function lp_ledger(uuid, text, int, text, text, text, uuid, text) from service_role;
revoke all on function lp_wallet(uuid) from service_role;
revoke all on function lp_audit(text, text, text, jsonb, jsonb) from service_role;
revoke all on function lp_random_ppm() from service_role;
revoke all on function lp_verify_owner_pin(text) from service_role;
revoke all on function lp_set_owner_pin(text) from service_role;
revoke all on function lp_apply_to_balance() from service_role;
revoke all on function lp_reject_mutation() from service_role;

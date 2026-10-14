-- ログインポイント：ポイントを使う流れ（仕様書 v1 第11項）
--   A. 購入時：1回限りの割引コード（lp_hold_points で仮押さえ → 注文作成 Webhook で確定）
--   B. 定期の請求：請求直前に契約へ1回限りの割引を付ける（lp_hold_for_billing → 課金成功で確定／失敗・解約で解除）
-- 再実行可能。2026-10-14-login-points-challenge.sql と 2026-10-14b-loyalty-status-link.sql の後に流す。
--
-- 仕様書からの意図的な差分
--   - 確定時の「金額の完全一致」は「割引額が仮押さえ以下」に緩めた。カートの金額が使うポイントより少ないと
--     Shopify が割引を商品代金で止めるため。使われた分だけ確定し、残りは同じ取引の中でポイントに戻す。
--     仮押さえより多い割引額（ありえない額）は従来どおり拒否する。
--   - 定期の仮押さえは時間切れで自動解除しない。契約側に割引が残ったままポイントだけ戻ると、
--     次の請求で割引だけが効いてしまうため。解除は課金失敗（リトライ上限）・解約のときに、割引の取り外しと一緒に行う。

alter table point_holds add column if not exists used_amount int;
alter table point_holds add column if not exists shopify_discount_id text;
alter table point_holds drop constraint if exists point_holds_used_amount_check;
alter table point_holds add constraint point_holds_used_amount_check
  check (used_amount is null or (used_amount > 0 and used_amount <= amount));

create table if not exists loyalty_billing_prefs (
  subscription_id uuid primary key references subscriptions(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  mode text not null default 'none' check (mode in ('none', 'all', 'fixed')),
  points int check (points is null or points > 0),
  updated_at timestamptz not null default now()
);
alter table loyalty_billing_prefs enable row level security;
revoke all on loyalty_billing_prefs from public, anon, authenticated, service_role;
grant select on loyalty_billing_prefs to service_role;

-- 確定：割引額が仮押さえ以下なら、使った分だけ確定して残りを戻す
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
    return jsonb_build_object('status', 'used', 'already', true, 'used', coalesce(hd.used_amount, hd.amount));
  end if;
  if hd.status <> 'held' then
    raise exception 'not_held: %', hd.status;
  end if;
  if p_discount_amount is null or p_discount_amount <= 0 or p_discount_amount > hd.amount then
    raise exception 'amount_mismatch: hold % / discount %', hd.amount, p_discount_amount;
  end if;
  update point_holds set status = 'used', used_amount = p_discount_amount, shopify_order_id = p_shopify_order_id,
    resolved_at = lp_now() where id = hd.id;
  if p_discount_amount < hd.amount then
    perform lp_ledger(hd.member_id, 'release', hd.amount - p_discount_amount, 'point_hold_release',
      'release:' || hd.id, 'ポイント仮押さえの残り（割引に使われなかった分）', hd.id, p_shopify_order_id);
  end if;
  perform lp_audit('webhook', 'confirm_hold', hd.id::text, null,
    jsonb_build_object('order', p_shopify_order_id, 'held', hd.amount, 'used', p_discount_amount));
  return jsonb_build_object('status', 'used', 'already', false, 'used', p_discount_amount);
end $$;

-- 返品の戻しは「実際に使った分」まで
create or replace function lp_refund_points(p_hold_id uuid, p_amount int, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare hd point_holds; v_used int;
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
  v_used := coalesce(hd.used_amount, hd.amount);
  if hd.refunded + p_amount > v_used then
    raise exception 'refund_exceeds_used: used % / refunded % / requested %', v_used, hd.refunded, p_amount;
  end if;
  update point_holds set refunded = refunded + p_amount where id = hd.id;
  perform lp_ledger(hd.member_id, 'refund', p_amount, 'order_refund', p_idempotency_key, '返品・キャンセルによるポイント戻し', hd.id, hd.shopify_order_id);
  return jsonb_build_object('already', false, 'refunded', hd.refunded + p_amount);
end $$;

-- 時間切れの自動解除は購入時の割引コード分だけ（定期の分は上の差分の理由で対象外）
create or replace function lp_release_expired_holds() returns int
language plpgsql security definer set search_path = public, pg_temp
as $$
declare r record; n int := 0;
begin
  for r in select id from point_holds
    where status = 'held' and purpose = 'checkout' and expires_at <= lp_now()
    for update skip locked
  loop
    perform lp_release_hold(r.id, 'expired');
    n := n + 1;
  end loop;
  return n;
end $$;

-- Shopify 側の割引（割引コード or 契約の割引）の ID を仮押さえに記録する。解除時に取り外すため
create or replace function lp_set_hold_discount(p_hold_id uuid, p_discount_id text) returns void
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
  if hd.shopify_discount_id is not null and hd.shopify_discount_id <> p_discount_id then
    raise exception 'discount_already_set';
  end if;
  update point_holds set shopify_discount_id = p_discount_id where id = hd.id;
end $$;

-- ── 定期の請求でのポイント利用 ─────────────────────────────
create or replace function lp_set_billing_pref(p_member uuid, p_subscription_id uuid, p_mode text, p_points int) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from subscriptions where id = p_subscription_id and member_id = p_member) then
    raise exception 'subscription_not_found';
  end if;
  if p_mode is null or p_mode not in ('none', 'all', 'fixed') then
    raise exception 'invalid_mode';
  end if;
  if p_mode = 'fixed' and (p_points is null or p_points <= 0) then
    raise exception 'invalid_points';
  end if;
  insert into loyalty_billing_prefs (subscription_id, member_id, mode, points, updated_at)
  values (p_subscription_id, p_member, p_mode, case when p_mode = 'fixed' then p_points end, now())
  on conflict (subscription_id) do update set
    member_id = excluded.member_id, mode = excluded.mode, points = excluded.points, updated_at = now();
  perform lp_audit('member:' || p_member, 'set_billing_pref', p_subscription_id::text, null,
    jsonb_build_object('mode', p_mode, 'points', p_points));
end $$;

create or replace function lp_billing_prefs(p_member uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'subscription_id', s.id,
    'status', s.status,
    'amount', s.amount,
    'next_billing_at', s.next_billing_at,
    'mode', coalesce(p.mode, 'none'),
    'points', p.points
  ) order by s.created_at), '[]'::jsonb)
  from subscriptions s
  left join loyalty_billing_prefs p on p.subscription_id = s.id
  where s.member_id = p_member and s.status <> 'cancelled'
$$;

-- 請求直前に呼ぶ。設定どおりのポイントを仮押さえして返す（残高と請求額が上限）。使わないなら null。
-- 同じ（契約, サイクル）の2回目は、作成済みの仮押さえを返す（課金処理のやり直しで二重に押さえない）
create or replace function lp_hold_for_billing(p_subscription_id uuid, p_cycle_no int, p_price int) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_member uuid;
  hd point_holds;
  p loyalty_billing_prefs;
  w user_points;
  v_amount int;
  v_id uuid;
begin
  select member_id into v_member from subscriptions where id = p_subscription_id;
  if v_member is null then
    return null;
  end if;

  select * into hd from point_holds where subscription_id = p_subscription_id and cycle_no = p_cycle_no;
  if found then
    if hd.status = 'released' then
      return null;
    end if;
    return jsonb_build_object('hold_id', hd.id, 'amount', hd.amount, 'discount_id', hd.shopify_discount_id,
      'status', hd.status, 'existing', true);
  end if;

  select * into p from loyalty_billing_prefs where subscription_id = p_subscription_id;
  if not found or p.mode = 'none' or coalesce(p_price, 0) <= 0 then
    return null;
  end if;

  w := lp_wallet(v_member);
  v_amount := least(coalesce(w.available_points, 0), p_price, case when p.mode = 'fixed' then p.points else p_price end);
  if v_amount <= 0 then
    return null;
  end if;

  v_id := lp_hold_points(v_member, v_amount, 'billing', null, p_subscription_id, p_cycle_no);
  return jsonb_build_object('hold_id', v_id, 'amount', v_amount, 'discount_id', null, 'status', 'held', 'existing', false);
end $$;

create or replace function lp_confirm_billing_hold(p_subscription_id uuid, p_cycle_no int, p_order_id text, p_applied int) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  select id into v_id from point_holds
    where subscription_id = p_subscription_id and cycle_no = p_cycle_no and status in ('held', 'used');
  if v_id is null then
    return null;
  end if;
  return lp_confirm_hold(v_id, p_order_id, p_applied);
end $$;

create or replace function lp_release_billing_hold(p_subscription_id uuid, p_cycle_no int, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare hd point_holds;
begin
  select * into hd from point_holds
    where subscription_id = p_subscription_id and cycle_no = p_cycle_no and status = 'held';
  if not found then
    return null;
  end if;
  perform lp_release_hold(hd.id, p_reason);
  return jsonb_build_object('hold_id', hd.id, 'discount_id', hd.shopify_discount_id);
end $$;

-- 解約時：まだ使われていない定期の仮押さえをすべて解除し、取り外すべき契約の割引IDを返す
create or replace function lp_release_subscription_holds(p_subscription_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare r record; v_ids jsonb := '[]'::jsonb;
begin
  for r in select id, shopify_discount_id from point_holds
    where subscription_id = p_subscription_id and status = 'held' order by cycle_no for update
  loop
    perform lp_release_hold(r.id, p_reason);
    if r.shopify_discount_id is not null then
      v_ids := v_ids || to_jsonb(r.shopify_discount_id);
    end if;
  end loop;
  return v_ids;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'lp_confirm_hold(uuid, text, int)', 'lp_refund_points(uuid, int, text)', 'lp_release_expired_holds()',
    'lp_set_hold_discount(uuid, text)', 'lp_set_billing_pref(uuid, uuid, text, int)', 'lp_billing_prefs(uuid)',
    'lp_hold_for_billing(uuid, int, int)', 'lp_confirm_billing_hold(uuid, int, text, int)',
    'lp_release_billing_hold(uuid, int, text)', 'lp_release_subscription_holds(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

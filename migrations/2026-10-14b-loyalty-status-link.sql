-- ログインポイント：画面用の状態取得と、定期契約↔会員の紐づけ（2026-10-14-login-points-challenge.sql の続き）
-- 再実行可能。

-- 画面に出す状態を1回で返す（読み取りのみ。付与はしない）
create or replace function lp_status(p_member uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_today date := lp_today();
  s login_streaks;
  v_alive boolean;
  v_last_earn timestamptz;
begin
  select * into s from login_streaks where member_id = p_member;
  v_alive := s.last_login_date is not null and (
    s.last_login_date >= v_today - 1
    or lp_paused_days(p_member, s.last_login_date + 1, v_today - 1) >= (v_today - s.last_login_date - 1)
  );
  select max(created_at) into v_last_earn from point_transactions
    where member_id = p_member and (type = 'earn' or (type = 'adjust' and amount > 0));

  return lp_login_state(p_member, 'status', 0, false, null) || jsonb_build_object(
    'today', v_today,
    'eligibility', lp_member_state(p_member),
    'logged_in_today', coalesce(s.last_login_date = v_today, false),
    'streak_alive', coalesce(v_alive, false),
    'points_expire_on', case when v_last_earn is null then null
      else ((v_last_earn at time zone 'Asia/Tokyo')::date + interval '1 year')::date end,
    'open_challenges', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'milestone', streak_milestone, 'tier', tier, 'expires_at', expires_at) order by granted_at)
      from challenge_draws
      where member_id = p_member and drawn_at is null and result is null and expires_at > lp_now()
    ), '[]'::jsonb),
    'recent_draws', coalesce((
      select jsonb_agg(x order by x->>'drawn_at' desc) from (
        select jsonb_build_object('id', id, 'milestone', streak_milestone, 'result', result,
          'prize_status', prize_status, 'drawn_at', drawn_at) as x
        from challenge_draws where member_id = p_member and drawn_at is not null
        order by drawn_at desc limit 5
      ) t
    ), '[]'::jsonb),
    'transactions', coalesce((
      select jsonb_agg(x order by x->>'created_at' desc) from (
        select jsonb_build_object('type', type, 'amount', amount, 'description', description, 'created_at', created_at) as x
        from point_transactions where member_id = p_member
        order by created_at desc, id limit 20
      ) t
    ), '[]'::jsonb)
  );
end $$;

-- 注文（Shopify の注文ID・顧客ID）に対応する定期契約を会員に紐づける。
-- 呼ぶ前にアプリ側で「注文番号＋注文時のメールアドレスの一致」を確認すること（仕様書 第12項）。
-- 1つの契約に紐づく会員は1人だけ。別の会員に紐づいている契約は奪えない。
create or replace function lp_link_subscription(p_member uuid, p_order_id text, p_customer_id text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_taken int; v_linked int;
begin
  if p_member is null or not exists (select 1 from members where id = p_member) then
    raise exception 'member_not_found';
  end if;
  select count(*) into v_taken from subscriptions
    where (first_order_id = p_order_id or (p_customer_id is not null and shopify_customer_id = p_customer_id))
      and member_id is not null and member_id <> p_member;
  if v_taken > 0 then
    raise exception 'subscription_taken';
  end if;
  update subscriptions set member_id = p_member, updated_at = now()
    where (first_order_id = p_order_id or (p_customer_id is not null and shopify_customer_id = p_customer_id))
      and (member_id is null or member_id = p_member);
  get diagnostics v_linked = row_count;
  if v_linked > 0 then
    perform lp_audit('member:' || p_member, 'link_subscription', p_order_id, null, jsonb_build_object('linked', v_linked));
  end if;
  return jsonb_build_object('linked', v_linked);
end $$;

-- 確認済みのログインメールと同じメールの、まだ誰にも紐づいていない契約を紐づける
create or replace function lp_link_by_email(p_member uuid, p_email text) returns int
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_linked int;
begin
  if p_email is null or btrim(p_email) = '' or p_email ilike '%@line.fitpeak.co' then
    return 0;
  end if;
  update subscriptions set member_id = p_member, updated_at = now()
    where lower(email) = lower(btrim(p_email)) and member_id is null;
  get diagnostics v_linked = row_count;
  if v_linked > 0 then
    perform lp_audit('member:' || p_member, 'link_by_email', null, null, jsonb_build_object('linked', v_linked));
  end if;
  return v_linked;
end $$;

do $$
declare f text;
begin
  foreach f in array array['lp_status(uuid)', 'lp_link_subscription(uuid, text, text)', 'lp_link_by_email(uuid, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

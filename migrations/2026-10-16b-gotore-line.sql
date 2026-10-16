-- 合トレナビ：ジム記事のボタン → 公式LINE友だち追加 → 掲示板とプロフィール設定の案内（2026-10-16）
--   gotore_line_invites … 案内を送ったクリック（webhook と LIFF の両方から来ても1回だけ送る）
--   gt_claim_invite      … 送る権利を取る（初回だけ true）
--   gt_member_for_line   … 友だち追加しただけの人も会員（members）として用意する（通知待ちの登録に使う）
create table if not exists gotore_line_invites (
  click_id uuid primary key,
  line_user_id text not null,
  created_at timestamptz not null default now()
);

create or replace function gt_claim_invite(p_click uuid, p_line text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  insert into gotore_line_invites (click_id, line_user_id, created_at) values (p_click, p_line, gt_now())
  on conflict (click_id) do nothing;
  return found;
end $$;

create or replace function gt_member_for_line(p_line text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if coalesce(p_line, '') = '' then raise exception 'LINEのIDがありません'; end if;
  select id into v from members where line_user_id = p_line;
  if v is null then
    insert into members (line_user_id, source) values (p_line, 'gotore')
    on conflict (line_user_id) do nothing returning id into v;
    if v is null then select id into v from members where line_user_id = p_line; end if;
  end if;
  return v;
end $$;

alter table gotore_line_invites enable row level security;
revoke all on gotore_line_invites from public, anon, authenticated;
grant select on gotore_line_invites to service_role;
revoke all on function gt_claim_invite(uuid, text) from public, anon, authenticated;
grant execute on function gt_claim_invite(uuid, text) to service_role;
revoke all on function gt_member_for_line(text) from public, anon, authenticated;
grant execute on function gt_member_for_line(text) to service_role;

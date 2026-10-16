-- 合トレナビ：LINEの案内に載せる短いリンク（/my-fitpeak/gotore/b/<掲示板ID>）。2026-10-16
-- 記事名（日本語）を含むキーだとURLが数百文字になり、LINEで読みにくいため。
create or replace function gt_gym_json(g gotore_gyms) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', g.id, 'handle', g.handle, 'name', g.name, 'pref', g.pref, 'city', g.city)
$$;

create or replace function gt_gym_handle(p_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select handle from gotore_gyms where id = p_id
$$;

revoke all on function gt_gym_json(gotore_gyms) from public, anon, authenticated;
revoke all on function gt_gym_handle(uuid) from public, anon, authenticated;
grant execute on function gt_gym_handle(uuid) to service_role;

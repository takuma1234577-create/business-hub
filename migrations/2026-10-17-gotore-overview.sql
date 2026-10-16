-- 合トレナビ：fitpeak.co のトップ（/pages/gotore-navi）とエリアページ（/pages/gotore-<県>）に出す公開集計。2026-10-17
-- 返すのは件数・ジム名/エリア名・募集の大まかな条件（時間帯・部位・レベル・日付）だけ。
-- ニックネーム・自己紹介・募集文・会員ID・LINE ID・掲示板の内部ID・性別は返さない。
-- 「同性のみ」の募集は件数には入れるが、新着（中身）には出さない。
create or replace function gt_post_open(p gotore_posts) returns boolean
language sql stable as $$
  select p.status = 'open' and p.expires_at > gt_now()
     and not exists (select 1 from gotore_profiles pp where pp.member_id = p.member_id and pp.suspended)
$$;

create or replace function gt_public_overview(p_pref text) returns jsonb
language sql stable security definer set search_path = public as $$
  with g as (
    select x.* from gotore_gyms x where p_pref is null or x.pref = p_pref
  ), op as (
    select p.* from gotore_posts p join g on g.id = p.gym_id where gt_post_open(p)
  ), wt as (
    select w.member_id, w.gym_id from gotore_watches w join g on g.id = w.gym_id
  ), per_gym as (
    select g.id, g.handle, g.name, g.pref, g.city,
           (select count(*) from op where op.gym_id = g.id)::int open_posts,
           (select count(*) from wt where wt.gym_id = g.id)::int watchers
      from g
  )
  select jsonb_build_object(
    'pref', p_pref,
    'totals', jsonb_build_object(
      'open_posts', (select count(*) from op)::int,
      'watchers', (select count(distinct member_id) from wt)::int,
      'gyms', (select count(distinct gym_id) from op)::int),
    'prefs', coalesce((
      select jsonb_agg(jsonb_build_object('pref', s.pref, 'open_posts', s.o, 'watchers', s.w) order by s.o desc, s.w desc, s.pref)
        from (select g.pref,
                     (select count(*) from op join gotore_gyms y on y.id = op.gym_id where y.pref = g.pref)::int o,
                     (select count(distinct wt.member_id) from wt join gotore_gyms y on y.id = wt.gym_id where y.pref = g.pref)::int w
                from g where g.pref is not null group by g.pref) s
       where s.o > 0 or s.w > 0), '[]'::jsonb),
    'areas', coalesce((
      select jsonb_agg(jsonb_build_object('pref', s.pref, 'city', s.city, 'open_posts', s.o, 'watchers', s.w) order by s.o desc, s.w desc, s.pref, s.city)
        from (select g.pref, g.city,
                     (select count(*) from op join gotore_gyms y on y.id = op.gym_id
                       where y.pref is not distinct from g.pref and y.city is not distinct from g.city)::int o,
                     (select count(distinct wt.member_id) from wt join gotore_gyms y on y.id = wt.gym_id
                       where y.pref is not distinct from g.pref and y.city is not distinct from g.city)::int w
                from g where g.pref is not null group by g.pref, g.city) s
       where s.o > 0 or s.w > 0), '[]'::jsonb),
    'gyms', case when p_pref is null then null else coalesce((
      select jsonb_agg(jsonb_build_object('handle', s.handle, 'name', s.name, 'city', s.city, 'open_posts', s.open_posts, 'watchers', s.watchers)
                       order by s.open_posts desc, s.watchers desc, s.name)
        from per_gym s where s.handle not like 'area:%' and (s.open_posts > 0 or s.watchers > 0)), '[]'::jsonb) end,
    'recent', coalesce((
      select jsonb_agg(r.j order by r.at desc)
        from (select jsonb_build_object(
                       'gym', jsonb_build_object('handle', y.handle, 'name', y.name, 'pref', y.pref, 'city', y.city),
                       'slots', op.slots, 'parts', op.parts, 'level', pr.level,
                       'date', to_char((op.created_at at time zone 'Asia/Tokyo')::date, 'YYYY-MM-DD')) j,
                     op.created_at at
                from op join gotore_gyms y on y.id = op.gym_id join gotore_profiles pr on pr.member_id = op.member_id
               where op.gender_pref = 'any'
               order by op.created_at desc limit 8) r), '[]'::jsonb)
  )
$$;

revoke all on function gt_post_open(gotore_posts) from public, anon, authenticated;
revoke all on function gt_public_overview(text) from public, anon, authenticated;
grant execute on function gt_public_overview(text) to service_role;

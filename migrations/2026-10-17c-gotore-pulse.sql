-- 合トレナビ：fitpeak.co の近未来UI（シンクロ率診断・トレーニング時計・ジム・ギャラクシー）用の公開集計。2026-10-17
-- 返すのは「件数」と「誰でも可の募集の大まかな条件（ジム名・時間帯・部位・目的・レベル・日付）」だけ。
-- 件数は 3 未満を "few" にぼかす（少数の人を特定させない）。0 は 0。
-- ニックネーム・自己紹介・募集文・会員ID・LINE ID・性別・同性のみの募集の中身は返さない。
create or replace function gt_blur(n bigint) returns jsonb
language sql immutable as $$
  select case when coalesce(n, 0) = 0 then to_jsonb(0) when n < 3 then to_jsonb('few'::text) else to_jsonb(n) end
$$;

create or replace function gt_public_pulse(p_pref text) returns jsonb
language sql stable security definer set search_path = public as $$
  with op as (
    select p.*, y.handle, y.name, y.pref, y.city, pr.level
      from gotore_posts p
      join gotore_gyms y on y.id = p.gym_id
      join gotore_profiles pr on pr.member_id = p.member_id
     where gt_post_open(p) and (p_pref is null or y.pref = p_pref)
  )
  select jsonb_build_object(
    'pref', p_pref,
    'slots', (select jsonb_object_agg(k, gt_blur((select count(*) from op where k = any(op.slots))))
                from unnest(array['wd_am', 'wd_pm', 'wd_night', 'we_am', 'we_pm', 'we_night']) k),
    'parts', (select jsonb_object_agg(k, gt_blur((select count(*) from op where k = any(op.parts))))
                from unnest(array['chest', 'back', 'legs', 'shoulders', 'arms', 'full', 'cardio']) k),
    'levels', (select jsonb_object_agg(k, gt_blur((select count(*) from op where op.level = k)))
                from unnest(array['beginner', 'intermediate', 'advanced', 'competitor']) k),
    'same_only', gt_blur((select count(*) from op where op.gender_pref = 'same')),
    'fresh', coalesce((select jsonb_agg(distinct op.pref) from op
                        where op.pref is not null and op.created_at > gt_now() - interval '48 hours'), '[]'::jsonb),
    'board', coalesce((
      select jsonb_agg(b.j order by b.at desc) from (
        select jsonb_build_object(
                 'gym', jsonb_build_object('handle', op.handle, 'name', op.name, 'pref', op.pref, 'city', op.city),
                 'slots', op.slots, 'parts', op.parts, 'goals', op.goals, 'level', op.level,
                 'date', to_char((op.created_at at time zone 'Asia/Tokyo')::date, 'YYYY-MM-DD')) j,
               op.created_at at
          from op where op.gender_pref = 'any'
         order by op.created_at desc limit 60) b), '[]'::jsonb)
  )
$$;

revoke all on function gt_blur(bigint) from public, anon, authenticated;
revoke all on function gt_public_pulse(text) from public, anon, authenticated;
grant execute on function gt_public_pulse(text) to service_role;

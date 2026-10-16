-- 合トレナビ：公式LINEのトークだけで募集を作る（2026-10-17）
--
--   gotore_line_drafts    会話の途中状態。LINEのユーザーID（Webhook の source から取ったもの）がキー。期限30分。
--   gt_line_draft_get/put/clear  下書きの読み書き（期限切れは読むときに消す）。token は古いボタンの押し直しを弾く合言葉
--   gt_line_member        LINEのユーザーIDから会員IDを引く（会員を新しく作らない）
--   gt_line_nearby        本人の近く（通っているジム・市区町村・都道府県）の公開中の募集。返すのは公開項目だけ（名前・性別・年代は返さない）
--   gt_line_my_posts      本人の募集（件数だけ。申請した人の名前は返さない）
--   gt_post_delete        本人の募集を削除（マッチ済みのチャットがある募集は消さず、締め切りを案内）
--
-- 募集の作成・締め切り・文のチェックは既存の gt_post_create / gt_post_close / gt_check_text をそのまま使う（ここで検証を重複させない）。
-- 表は RLS 有効・誰にも権限なし。関数は service_role だけが実行できる。既存の表・関数は変更しない。

create table if not exists gotore_line_drafts (
  line_user_id text primary key,
  step text not null,
  data jsonb not null default '{}'::jsonb,
  token text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);
alter table gotore_line_drafts enable row level security;
revoke all on gotore_line_drafts from public, anon, authenticated, service_role;

create or replace function gt_line_draft_get(p_line text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d gotore_line_drafts;
begin
  if coalesce(p_line, '') = '' then return null; end if;
  delete from gotore_line_drafts where line_user_id = p_line and expires_at <= gt_now();
  select * into d from gotore_line_drafts where line_user_id = p_line;
  if d.line_user_id is null then return null; end if;
  return jsonb_build_object('step', d.step, 'data', d.data, 'token', d.token);
end $$;

create or replace function gt_line_draft_put(p_line text, p_step text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t text := encode(extensions.gen_random_bytes(4), 'hex');
begin
  if coalesce(p_line, '') = '' or char_length(p_line) > 64 then raise exception 'LINEのIDがありません'; end if;
  if p_step is null or p_step not in ('gym', 'slots', 'parts', 'goals', 'gender', 'note', 'confirm') then
    raise exception '下書きの段階が正しくありません';
  end if;
  if jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text) > 8000 then
    raise exception '下書きの内容が正しくありません';
  end if;
  insert into gotore_line_drafts (line_user_id, step, data, token, expires_at, updated_at)
  values (p_line, p_step, p_data, t, gt_now() + interval '30 minutes', gt_now())
  on conflict (line_user_id) do update set step = excluded.step, data = excluded.data, token = excluded.token,
    expires_at = excluded.expires_at, updated_at = excluded.updated_at;
  return jsonb_build_object('step', p_step, 'data', p_data, 'token', t);
end $$;

create or replace function gt_line_draft_clear(p_line text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  delete from gotore_line_drafts where line_user_id = p_line;
  return found;
end $$;

create or replace function gt_line_member(p_line text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from members where coalesce(p_line, '') <> '' and line_user_id = p_line
$$;

create or replace function gt_line_nearby(p_member uuid, p_handles text[], p_pref text, p_city text, p_limit int default 10)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x.j order by x.rank, x.created_at desc), '[]'::jsonb)
    from (
      select jsonb_build_object('id', p.id, 'gym_id', g.id, 'gym_name', g.name, 'pref', g.pref, 'city', g.city,
                                'slots', p.slots, 'parts', p.parts, 'goals', p.goals, 'level', pr.level,
                                'note', p.note, 'created_at', p.created_at) j,
             case when g.handle = any (coalesce(p_handles, '{}')) then 0
                  when g.pref = p_pref and g.city = p_city then 1 else 2 end rank,
             p.created_at
        from gotore_posts p
        join gotore_gyms g on g.id = p.gym_id
        join gotore_profiles pr on pr.member_id = p.member_id
       where p.member_id <> p_member
         and (g.handle = any (coalesce(p_handles, '{}')) or g.pref = p_pref)
         and gt_can_see(p_member, p)
       order by 2, p.created_at desc
       limit least(greatest(coalesce(p_limit, 10), 1), 10)
    ) x
$$;

create or replace function gt_line_my_posts(p_member uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'gym_id', g.id, 'gym_name', g.name, 'slots', p.slots, 'parts', p.parts,
           'status', case when p.status = 'open' and p.expires_at <= gt_now() then 'expired' else p.status end,
           'requests', (select count(*) from gotore_requests r where r.post_id = p.id),
           'pending', (select count(*) from gotore_requests r where r.post_id = p.id and r.status = 'pending'),
           'created_at', p.created_at, 'expires_at', p.expires_at)
         order by (p.status = 'open' and p.expires_at > gt_now()) desc, p.created_at desc), '[]'::jsonb)
    from (select * from gotore_posts where member_id = p_member and status in ('open', 'closed')
            and created_at > gt_now() - interval '60 days' order by created_at desc limit 10) p
    join gotore_gyms g on g.id = p.gym_id
$$;

create or replace function gt_post_delete(p_member uuid, p_post uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from gotore_posts where id = p_post and member_id = p_member and status in ('open', 'closed')) then
    raise exception '募集が見つかりません';
  end if;
  if exists (select 1 from gotore_matches where post_id = p_post) then
    raise exception 'この募集はマッチした相手とのチャットがあるため削除できません。「締め切る」を使ってください';
  end if;
  delete from gotore_posts where id = p_post and member_id = p_member;
  return jsonb_build_object('ok', true);
end $$;

do $$
declare f text;
begin
  foreach f in array array['gt_line_draft_get(text)', 'gt_line_draft_put(text, text, jsonb)', 'gt_line_draft_clear(text)',
                           'gt_line_member(text)', 'gt_line_nearby(uuid, text[], text, text, int)', 'gt_line_my_posts(uuid)',
                           'gt_post_delete(uuid, uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

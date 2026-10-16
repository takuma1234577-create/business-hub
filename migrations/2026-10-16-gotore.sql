-- 合トレ仲間さがし（gotore）2026-10-16
-- fitpeak.co のジム店舗レビュー記事（blogs/gym-review）を読みに来た近所の人どうしを、ジム単位でつなぐ。
--
-- 方針
--   - 書き込み・読み出しは gt_* の SECURITY DEFINER 関数だけ。実行できるのは service_role（business-hub のサーバー）のみ。
--     表は anon / authenticated から一切見えない。会員IDやLINEのIDは関数の戻り値に出さない（通知先は notify 配列で
--     サーバーにだけ返し、サーバーがLINEに送る）。
--   - 連絡先（電話・メール・URL・LINE ID 等）と出会い目的の語は、募集文・申請文・プロフィールで弾く。
--     マッチした2人のチャットでは連絡先の交換を許す（両者が合意した後なので）。
--   - 「同性のみ」の募集は、同じ性別を答えた人にしか見えず、通知もしない。
--   - 募集は30日で自動的に締め切り。2人以上から通報された募集は自動で非表示。
create or replace function gt_now() returns timestamptz language sql stable as $$ select now() $$;

create table if not exists gotore_gyms (
  id uuid primary key default gen_random_uuid(),
  handle text not null unique,           -- fitpeak.co/blogs/gym-review/<handle>
  name text not null,
  pref text,
  city text,
  created_at timestamptz not null default now()
);
create index if not exists gotore_gyms_area on gotore_gyms (pref, city);

create table if not exists gotore_profiles (
  member_id uuid primary key references members(id) on delete cascade,
  nickname text not null,
  gender text not null check (gender in ('male', 'female', 'none')),
  age_band text not null check (age_band in ('18-24', '25-34', '35-44', '45+', 'none')),
  level text not null check (level in ('beginner', 'intermediate', 'advanced', 'competitor')),
  bio text not null default '',
  agreed_at timestamptz not null,
  suspended boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists gotore_posts (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  gym_id uuid not null references gotore_gyms(id) on delete cascade,
  slots text[] not null,
  parts text[] not null default '{}',
  goals text[] not null default '{}',
  gender_pref text not null check (gender_pref in ('same', 'any')),
  note text not null default '',
  status text not null default 'open' check (status in ('open', 'closed', 'hidden')),
  created_at timestamptz not null,
  expires_at timestamptz not null
);
create index if not exists gotore_posts_gym on gotore_posts (gym_id, status, expires_at);
create index if not exists gotore_posts_member on gotore_posts (member_id);

create table if not exists gotore_watches (
  member_id uuid not null references members(id) on delete cascade,
  gym_id uuid not null references gotore_gyms(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (member_id, gym_id)
);
create index if not exists gotore_watches_gym on gotore_watches (gym_id);

create table if not exists gotore_requests (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references gotore_posts(id) on delete cascade,
  from_member uuid not null references members(id) on delete cascade,
  message text not null default '',
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null,
  unique (post_id, from_member)
);
create index if not exists gotore_requests_from on gotore_requests (from_member, created_at);

create table if not exists gotore_matches (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references gotore_requests(id) on delete cascade,
  post_id uuid not null references gotore_posts(id) on delete cascade,
  owner_member uuid not null references members(id) on delete cascade,
  partner_member uuid not null references members(id) on delete cascade,
  owner_notified_at timestamptz,
  partner_notified_at timestamptz,
  created_at timestamptz not null,
  closed_at timestamptz
);
create index if not exists gotore_matches_owner on gotore_matches (owner_member);
create index if not exists gotore_matches_partner on gotore_matches (partner_member);

create table if not exists gotore_messages (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references gotore_matches(id) on delete cascade,
  sender uuid not null references members(id) on delete cascade,
  body text not null,
  created_at timestamptz not null
);
create index if not exists gotore_messages_match on gotore_messages (match_id, created_at);

create table if not exists gotore_reports (
  id uuid primary key default gen_random_uuid(),
  reporter uuid not null references members(id) on delete cascade,
  target_member uuid not null references members(id) on delete cascade,
  post_id uuid references gotore_posts(id) on delete set null,
  match_id uuid references gotore_matches(id) on delete set null,
  reason text not null default '',
  created_at timestamptz not null
);

create table if not exists gotore_blocks (
  blocker uuid not null references members(id) on delete cascade,
  blocked uuid not null references members(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked)
);

-- ── 文のチェック ──────────────────────────────────────────────────────────
create or replace function gt_check_text(p_text text, p_label text, p_max int) returns text
language plpgsql immutable as $$
declare t text := btrim(coalesce(p_text, ''));
        n text := lower(normalize(btrim(coalesce(p_text, '')), NFKC));
begin
  if char_length(t) > p_max then raise exception '%は%文字以内で入力してください', p_label, p_max; end if;
  if n ~ 'https?://|www\.|\.(com|jp|net|me|io|ly)(/|\s|$)'
     or n ~ '[a-z0-9._%+-]+@[a-z0-9-]+\.[a-z]'
     or n ~ '\d[\d\s\-ー−]{8,}\d'
     or n ~ '(line|ライン|ﾗｲﾝ)\s*(id|ｉｄ)'
     or n ~ '(^|[^a-z])id\s*[:：@]'
     or n ~ '(^|\s)@[a-z0-9_.]{3,}'
     or n ~ 'インスタ|instagram|kakao|カカオ|tiktok|twitter'
  then
    raise exception '%に連絡先（電話・メール・URL・LINE ID・SNS）は書けません。連絡はマッチ後のチャットで行ってください', p_label;
  end if;
  if n ~ '出会い|であい|彼女募集|彼氏募集|彼女ほしい|彼氏ほしい|恋人|デート|ホテル|セフレ|パパ活|ママ活|援助|割り切り|大人の関係|ワンナイト|飲み友|ナンパ'
  then
    raise exception '合トレ以外の出会いを目的とした内容は書けません';
  end if;
  return t;
end $$;

-- ── 見えるかどうか ────────────────────────────────────────────────────────
create or replace function gt_can_see(p_viewer uuid, p_post gotore_posts) returns boolean
language sql stable as $$
  select p_post.status = 'open'
     and p_post.expires_at > gt_now()
     and not exists (select 1 from gotore_profiles pp where pp.member_id = p_post.member_id and pp.suspended)
     and (p_viewer is null or not exists (
           select 1 from gotore_blocks b
            where (b.blocker = p_viewer and b.blocked = p_post.member_id)
               or (b.blocker = p_post.member_id and b.blocked = p_viewer)))
     and (p_post.gender_pref = 'any' or exists (
           select 1 from gotore_profiles v, gotore_profiles o
            where v.member_id = p_viewer and o.member_id = p_post.member_id
              and v.gender <> 'none' and v.gender = o.gender))
$$;

create or replace function gt_open_count(p_gym uuid) returns int
language sql stable as $$
  select count(*)::int from gotore_posts p
   where p.gym_id = p_gym and p.status = 'open' and p.expires_at > gt_now()
     and not exists (select 1 from gotore_profiles pp where pp.member_id = p.member_id and pp.suspended)
$$;

create or replace function gt_require_profile(p_member uuid) returns gotore_profiles
language plpgsql stable as $$
declare pr gotore_profiles;
begin
  select * into pr from gotore_profiles where member_id = p_member;
  if pr.member_id is null then raise exception '先にプロフィールを登録してください'; end if;
  if pr.suspended then raise exception 'このアカウントは利用停止中です'; end if;
  return pr;
end $$;

create or replace function gt_gym_json(g gotore_gyms) returns jsonb
language sql stable as $$
  select jsonb_build_object('handle', g.handle, 'name', g.name, 'pref', g.pref, 'city', g.city)
$$;

-- ── ジム ─────────────────────────────────────────────────────────────────
create or replace function gt_gym_upsert(p_handle text, p_name text, p_pref text, p_city text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  insert into gotore_gyms (handle, name, pref, city) values (p_handle, p_name, p_pref, p_city)
  on conflict (handle) do update set name = excluded.name, pref = excluded.pref, city = excluded.city
  returning id into v;
  return v;
end $$;

-- ジム記事に出す枠（ログイン不要）。名前は出さない
create or replace function gt_gym_public(p_handle text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare g gotore_gyms;
begin
  select * into g from gotore_gyms where handle = p_handle;
  if g.id is null then return jsonb_build_object('gym', null); end if;
  return jsonb_build_object(
    'gym', gt_gym_json(g),
    'open_posts', gt_open_count(g.id),
    'watchers', (select count(*) from gotore_watches where gym_id = g.id),
    'area_open_posts', (select coalesce(sum(gt_open_count(x.id)), 0) from gotore_gyms x
                         where x.pref is not distinct from g.pref and x.city is not distinct from g.city)
  ) || jsonb_build_object('preview', coalesce((
      select jsonb_agg(x.j) from (
        select jsonb_build_object('slots', p.slots, 'parts', p.parts, 'level', pr.level, 'created_at', p.created_at) j
          from gotore_posts p join gotore_profiles pr on pr.member_id = p.member_id
         where p.gym_id = g.id and p.gender_pref = 'any' and gt_can_see(null, p)
         order by p.created_at desc limit 3) x), '[]'::jsonb));
end $$;

create or replace function gt_area(p_member uuid, p_pref text, p_city text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('pref', p_pref, 'city', p_city, 'gyms', coalesce(jsonb_agg(x.j order by x.n desc, x.name), '[]'::jsonb))
    from (select gt_gym_json(g) || jsonb_build_object('open_posts', gt_open_count(g.id)) j, gt_open_count(g.id) n, g.name
            from gotore_gyms g
           where g.pref = p_pref and (p_city is null or g.city = p_city)) x
$$;

-- ── プロフィール ──────────────────────────────────────────────────────────
create or replace function gt_profile_save(p_member uuid, p_nickname text, p_gender text, p_age_band text,
                                           p_level text, p_bio text, p_agree boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare nick text; bio text;
begin
  if not coalesce(p_agree, false) then raise exception '利用規約（18歳以上・合トレ目的のみ）への同意が必要です'; end if;
  nick := gt_check_text(p_nickname, 'ニックネーム', 20);
  if nick = '' then raise exception 'ニックネームを入力してください'; end if;
  bio := gt_check_text(p_bio, '自己紹介', 200);
  insert into gotore_profiles (member_id, nickname, gender, age_band, level, bio, agreed_at)
  values (p_member, nick, p_gender, p_age_band, p_level, bio, gt_now())
  on conflict (member_id) do update set nickname = excluded.nickname, gender = excluded.gender,
    age_band = excluded.age_band, level = excluded.level, bio = excluded.bio, updated_at = gt_now();
  return jsonb_build_object('ok', true);
end $$;

-- ── 掲示板 ───────────────────────────────────────────────────────────────
create or replace function gt_gym_board(p_member uuid, p_handle text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare g gotore_gyms; pr gotore_profiles;
begin
  select * into g from gotore_gyms where handle = p_handle;
  if g.id is null then raise exception 'ジムが見つかりません'; end if;
  select * into pr from gotore_profiles where member_id = p_member;
  return jsonb_build_object(
    'gym', gt_gym_json(g),
    'has_profile', pr.member_id is not null,
    'my_gender', pr.gender,
    'watching', exists (select 1 from gotore_watches where member_id = p_member and gym_id = g.id),
    'watchers', (select count(*) from gotore_watches where gym_id = g.id),
    'posts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'nickname', o.nickname, 'gender', o.gender, 'age_band', o.age_band, 'level', o.level,
               'bio', o.bio, 'slots', p.slots, 'parts', p.parts, 'goals', p.goals, 'gender_pref', p.gender_pref,
               'note', p.note, 'created_at', p.created_at, 'expires_at', p.expires_at,
               'mine', p.member_id = p_member,
               'requested', exists (select 1 from gotore_requests r where r.post_id = p.id and r.from_member = p_member))
             order by (p.member_id = p_member) desc, p.created_at desc)
        from gotore_posts p join gotore_profiles o on o.member_id = p.member_id
       where p.gym_id = g.id and gt_can_see(p_member, p)), '[]'::jsonb));
end $$;

create or replace function gt_post_create(p_member uuid, p_handle text, p_slots text[], p_parts text[], p_goals text[],
                                          p_gender_pref text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g gotore_gyms; pr gotore_profiles; note text; v uuid; notify text[];
begin
  pr := gt_require_profile(p_member);
  select * into g from gotore_gyms where handle = p_handle;
  if g.id is null then raise exception 'ジムが見つかりません'; end if;
  if coalesce(cardinality(p_slots), 0) = 0
     or not p_slots <@ array['wd_am', 'wd_pm', 'wd_night', 'we_am', 'we_pm', 'we_night'] then
    raise exception '時間帯を1つ以上選んでください';
  end if;
  if not coalesce(p_parts, '{}') <@ array['chest', 'back', 'legs', 'shoulders', 'arms', 'full', 'cardio'] then
    raise exception '部位の指定が正しくありません';
  end if;
  if not coalesce(p_goals, '{}') <@ array['spot', 'form', 'motivation', 'learn', 'teach'] then
    raise exception '目的の指定が正しくありません';
  end if;
  if p_gender_pref = 'same' and pr.gender = 'none' then
    raise exception '「同性のみ」を選ぶには、プロフィールで性別を選んでください';
  end if;
  note := gt_check_text(p_note, '募集文', 200);
  if exists (select 1 from gotore_posts where member_id = p_member and gym_id = g.id
               and status = 'open' and expires_at > gt_now()) then
    raise exception 'このジムにはすでに募集を出しています（締め切ると出し直せます）';
  end if;
  insert into gotore_posts (member_id, gym_id, slots, parts, goals, gender_pref, note, created_at, expires_at)
  values (p_member, g.id, p_slots, coalesce(p_parts, '{}'), coalesce(p_goals, '{}'), p_gender_pref, note,
          gt_now(), gt_now() + interval '30 days')
  returning id into v;

  select coalesce(array_agg(m.line_user_id order by w.created_at), '{}') into notify
    from gotore_watches w join members m on m.id = w.member_id
   where w.gym_id = g.id and w.member_id <> p_member and m.line_user_id is not null
     and gt_can_see(w.member_id, (select p from gotore_posts p where p.id = v));
  return jsonb_build_object('post_id', v, 'gym_name', g.name, 'handle', g.handle, 'notify', to_jsonb(notify));
end $$;

create or replace function gt_post_close(p_member uuid, p_post uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update gotore_posts set status = 'closed' where id = p_post and member_id = p_member and status = 'open';
  if not found then raise exception '募集が見つかりません'; end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function gt_watch(p_member uuid, p_handle text, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g gotore_gyms;
begin
  select * into g from gotore_gyms where handle = p_handle;
  if g.id is null then raise exception 'ジムが見つかりません'; end if;
  if p_on then
    insert into gotore_watches (member_id, gym_id, created_at) values (p_member, g.id, gt_now()) on conflict do nothing;
  else
    delete from gotore_watches where member_id = p_member and gym_id = g.id;
  end if;
  return jsonb_build_object('watching', p_on);
end $$;

-- ── 申請とマッチ ──────────────────────────────────────────────────────────
create or replace function gt_request(p_member uuid, p_post uuid, p_message text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p gotore_posts; pr gotore_profiles; msg text; v uuid; owner_line text; g gotore_gyms;
begin
  pr := gt_require_profile(p_member);
  select * into p from gotore_posts where id = p_post;
  if p.id is null or not gt_can_see(p_member, p) then raise exception '募集が見つかりません'; end if;
  if p.member_id = p_member then raise exception '自分の募集には申請できません'; end if;
  if exists (select 1 from gotore_requests where post_id = p_post and from_member = p_member) then
    raise exception 'この募集にはすでに申請しています';
  end if;
  if (select count(*) from gotore_requests where from_member = p_member and created_at > gt_now() - interval '1 day') >= 10 then
    raise exception '申請は1日10件までです。明日また送ってください';
  end if;
  msg := gt_check_text(p_message, 'メッセージ', 200);
  insert into gotore_requests (post_id, from_member, message, created_at) values (p_post, p_member, msg, gt_now())
  returning id into v;
  select line_user_id into owner_line from members where id = p.member_id;
  select * into g from gotore_gyms where id = p.gym_id;
  return jsonb_build_object('request_id', v, 'gym_name', g.name, 'nickname', pr.nickname,
    'notify', case when owner_line is null then '[]'::jsonb else jsonb_build_array(owner_line) end);
end $$;

create or replace function gt_request_answer(p_member uuid, p_request uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r gotore_requests; p gotore_posts; v uuid; line text; g gotore_gyms;
begin
  select r2.* into r from gotore_requests r2 join gotore_posts p2 on p2.id = r2.post_id
   where r2.id = p_request and p2.member_id = p_member and r2.status = 'pending';
  if r.id is null then raise exception '申請が見つかりません'; end if;
  select * into p from gotore_posts where id = r.post_id;
  select * into g from gotore_gyms where id = p.gym_id;
  if not p_accept then
    update gotore_requests set status = 'declined' where id = r.id;
    return jsonb_build_object('match_id', null, 'notify', '[]'::jsonb);
  end if;
  if exists (select 1 from gotore_blocks where (blocker = p_member and blocked = r.from_member)
                                            or (blocker = r.from_member and blocked = p_member)) then
    raise exception '申請が見つかりません';
  end if;
  update gotore_requests set status = 'accepted' where id = r.id;
  insert into gotore_matches (request_id, post_id, owner_member, partner_member, created_at)
  values (r.id, p.id, p_member, r.from_member, gt_now()) returning id into v;
  select line_user_id into line from members where id = r.from_member;
  return jsonb_build_object('match_id', v, 'gym_name', g.name,
    'nickname', (select nickname from gotore_profiles where member_id = p_member),
    'notify', case when line is null then '[]'::jsonb else jsonb_build_array(line) end);
end $$;

create or replace function gt_find_match(p_member uuid, p_match uuid) returns gotore_matches
language plpgsql stable as $$
declare m gotore_matches;
begin
  select * into m from gotore_matches where id = p_match and p_member in (owner_member, partner_member);
  if m.id is null then raise exception 'チャットが見つかりません'; end if;
  return m;
end $$;

create or replace function gt_match_messages(p_member uuid, p_match uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m gotore_matches; other uuid; o gotore_profiles; g gotore_gyms;
begin
  m := gt_find_match(p_member, p_match);
  other := case when m.owner_member = p_member then m.partner_member else m.owner_member end;
  select * into o from gotore_profiles where member_id = other;
  select g2.* into g from gotore_gyms g2 join gotore_posts p on p.gym_id = g2.id where p.id = m.post_id;
  return jsonb_build_object(
    'id', m.id, 'closed', m.closed_at is not null, 'gym', gt_gym_json(g), 'created_at', m.created_at,
    'partner', jsonb_build_object('nickname', o.nickname, 'gender', o.gender, 'age_band', o.age_band,
                                  'level', o.level, 'bio', o.bio),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('body', x.body, 'mine', x.sender = p_member, 'at', x.created_at)
                                           order by x.created_at)
                            from (select * from gotore_messages where match_id = m.id order by created_at desc limit 300) x),
                         '[]'::jsonb));
end $$;

create or replace function gt_message_send(p_member uuid, p_match uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m gotore_matches; body text := btrim(coalesce(p_body, '')); to_owner boolean; last timestamptz; line text;
begin
  m := gt_find_match(p_member, p_match);
  if m.closed_at is not null then raise exception 'このチャットは終了しています'; end if;
  if body = '' then raise exception 'メッセージを入力してください'; end if;
  if char_length(body) > 500 then raise exception 'メッセージは500文字以内で入力してください'; end if;
  insert into gotore_messages (match_id, sender, body, created_at) values (m.id, p_member, body, gt_now());
  to_owner := m.partner_member = p_member;
  last := case when to_owner then m.owner_notified_at else m.partner_notified_at end;
  if last is not null and last > gt_now() - interval '30 minutes' then
    return jsonb_build_object('ok', true, 'notify', '[]'::jsonb);
  end if;
  if to_owner then update gotore_matches set owner_notified_at = gt_now() where id = m.id;
  else update gotore_matches set partner_notified_at = gt_now() where id = m.id; end if;
  select line_user_id into line from members
   where id = case when to_owner then m.owner_member else m.partner_member end;
  return jsonb_build_object('ok', true, 'nickname', (select nickname from gotore_profiles where member_id = p_member),
    'notify', case when line is null then '[]'::jsonb else jsonb_build_array(line) end);
end $$;

-- ── 安全（ブロック・通報）──────────────────────────────────────────────────
create or replace function gt_other_member(p_member uuid, p_post uuid, p_match uuid) returns uuid
language plpgsql stable as $$
declare m gotore_matches; v uuid;
begin
  if p_match is not null then
    m := gt_find_match(p_member, p_match);
    return case when m.owner_member = p_member then m.partner_member else m.owner_member end;
  end if;
  select member_id into v from gotore_posts where id = p_post;
  if v is null or v = p_member then raise exception '相手が見つかりません'; end if;
  return v;
end $$;

create or replace function gt_block(p_member uuid, p_match uuid, p_post uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare other uuid := gt_other_member(p_member, p_post, p_match);
begin
  insert into gotore_blocks (blocker, blocked, created_at) values (p_member, other, gt_now()) on conflict do nothing;
  update gotore_matches set closed_at = coalesce(closed_at, gt_now())
   where (owner_member = p_member and partner_member = other) or (owner_member = other and partner_member = p_member);
  update gotore_requests r set status = 'declined' from gotore_posts p
   where p.id = r.post_id and r.status = 'pending'
     and ((p.member_id = p_member and r.from_member = other) or (p.member_id = other and r.from_member = p_member));
  return jsonb_build_object('ok', true);
end $$;

create or replace function gt_report(p_member uuid, p_post uuid, p_match uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare other uuid := gt_other_member(p_member, p_post, p_match); hidden boolean := false;
begin
  insert into gotore_reports (reporter, target_member, post_id, match_id, reason, created_at)
  values (p_member, other, p_post, p_match, left(coalesce(p_reason, ''), 500), gt_now());
  if p_post is not null and (select count(distinct reporter) from gotore_reports where post_id = p_post) >= 2 then
    update gotore_posts set status = 'hidden' where id = p_post and status = 'open';
    hidden := true;
  end if;
  return jsonb_build_object('ok', true, 'hidden', hidden);
end $$;

-- ── マイページ ────────────────────────────────────────────────────────────
create or replace function gt_me(p_member uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'profile', (select jsonb_build_object('nickname', nickname, 'gender', gender, 'age_band', age_band,
                                          'level', level, 'bio', bio, 'suspended', suspended)
                  from gotore_profiles where member_id = p_member),
    'watches', coalesce((select jsonb_agg(gt_gym_json(g) || jsonb_build_object('open_posts', gt_open_count(g.id))
                                          order by w.created_at desc)
                           from gotore_watches w join gotore_gyms g on g.id = w.gym_id
                          where w.member_id = p_member), '[]'::jsonb),
    'posts', coalesce((select jsonb_agg(jsonb_build_object(
                         'id', p.id, 'gym', gt_gym_json(g), 'note', p.note, 'slots', p.slots,
                         'status', case when p.status = 'open' and p.expires_at <= gt_now() then 'expired' else p.status end,
                         'created_at', p.created_at, 'expires_at', p.expires_at,
                         'requests', coalesce((select jsonb_agg(jsonb_build_object(
                             'id', r.id, 'message', r.message, 'status', r.status, 'created_at', r.created_at,
                             'nickname', o.nickname, 'gender', o.gender, 'age_band', o.age_band, 'level', o.level, 'bio', o.bio,
                             'match_id', (select id from gotore_matches where request_id = r.id))
                             order by r.created_at desc)
                           from gotore_requests r join gotore_profiles o on o.member_id = r.from_member
                          where r.post_id = p.id
                            and not exists (select 1 from gotore_blocks b where b.blocker = p_member and b.blocked = r.from_member)),
                           '[]'::jsonb))
                       order by p.created_at desc)
                        from gotore_posts p join gotore_gyms g on g.id = p.gym_id
                       where p.member_id = p_member and p.created_at > gt_now() - interval '60 days'), '[]'::jsonb),
    'sent', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'gym', gt_gym_json(g), 'status', r.status,
                                                          'created_at', r.created_at, 'nickname', o.nickname,
                                                          'match_id', (select id from gotore_matches where request_id = r.id))
                                       order by r.created_at desc)
                       from gotore_requests r join gotore_posts p on p.id = r.post_id
                       join gotore_gyms g on g.id = p.gym_id join gotore_profiles o on o.member_id = p.member_id
                      where r.from_member = p_member and r.created_at > gt_now() - interval '60 days'), '[]'::jsonb),
    'matches', coalesce((select jsonb_agg(jsonb_build_object(
                           'id', m.id, 'gym', gt_gym_json(g), 'closed', m.closed_at is not null, 'created_at', m.created_at,
                           'partner_nickname', o.nickname,
                           'last_message', (select body from gotore_messages where match_id = m.id order by created_at desc limit 1),
                           'last_at', (select max(created_at) from gotore_messages where match_id = m.id))
                         order by coalesce((select max(created_at) from gotore_messages where match_id = m.id), m.created_at) desc)
                         from gotore_matches m join gotore_posts p on p.id = m.post_id join gotore_gyms g on g.id = p.gym_id
                         join gotore_profiles o on o.member_id = case when m.owner_member = p_member then m.partner_member else m.owner_member end
                        where p_member in (m.owner_member, m.partner_member)), '[]'::jsonb))
$$;

-- ── 権限：service_role だけ ──────────────────────────────────────────────
do $$
declare r record;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'gotore\_%' loop
    execute format('alter table public.%I enable row level security', r.relname);
    execute format('revoke all on public.%I from public, anon, authenticated', r.relname);
    execute format('grant select on public.%I to service_role', r.relname);
  end loop;
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'gt\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

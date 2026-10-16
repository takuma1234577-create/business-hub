-- My FITPEAK アカウントのプロフィール（2026-10-17 オーナー決定：合トレナビは My FITPEAK の1機能。プロフィールはアカウントに一本化）
--
--   member_profiles          公開してよい項目（表示名・都道府県・市区町村・通っているジム・年代・性別）
--   member_private_profiles  非公開項目（本名・カナ・メール・郵便番号・住所・電話）。本人と運営（DBのオーナー）だけ
--
-- 非公開の表は anon / authenticated / service_role のどれにも権限を与えない（RLS有効・ポリシー無し）。
-- 読み書きは本人用の SECURITY DEFINER 関数（mf_account_get / mf_private_save / mf_private_delete）だけで、
-- 本人は auth.uid() → members.auth_user_id で決める。実行できるのは authenticated だけ（サーバーの service_role も不可）。
-- 合トレ（gt_*）が知れるのは「足りない項目名」だけ（gt_account_missing）。値は返さない。
-- 列名は後で Shopify の購入画面へ住所を渡すため、Shopify の MailingAddress（firstName,lastName,zip,province,city,address1,address2,phone）に合わせる。

create or replace function mf_prefs() returns text[] language sql immutable as $$
  select array['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県',
               '新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県',
               '奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県',
               '熊本県','大分県','宮崎県','鹿児島県','沖縄県']
$$;

create table if not exists member_profiles (
  member_id uuid primary key references members(id) on delete cascade,
  display_name text not null,
  pref text not null,
  city text not null,
  gyms jsonb not null default '[]'::jsonb,
  age_band text not null check (age_band in ('18-24', '25-34', '35-44', '45+', 'none')),
  gender text not null check (gender in ('male', 'female', 'none')),
  updated_at timestamptz not null default now()
);

create table if not exists member_private_profiles (
  member_id uuid primary key references members(id) on delete cascade,
  last_name text not null,
  first_name text not null,
  last_name_kana text not null,
  first_name_kana text not null,
  email text not null,
  zip text,
  province text,
  city text,
  address1 text,
  address2 text,
  phone text,
  purpose_agreed_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table member_profiles enable row level security;
alter table member_private_profiles enable row level security;
revoke all on member_profiles from public, anon, authenticated, service_role;
revoke all on member_private_profiles from public, anon, authenticated, service_role;

-- 合トレ固有の項目（任意・ほかの会員に見える）
alter table gotore_profiles add column if not exists history text check (history in ('<1y', '1-3y', '3-5y', '5y+'));
alter table gotore_profiles add column if not exists fav_lifts text not null default '';
alter table gotore_profiles add column if not exists usual_slots text[] not null default '{}';
alter table gotore_profiles add column if not exists purposes text[] not null default '{}';

-- ── 足りない項目（名前だけ。値は返さない） ───────────────────────────────
create or replace function gt_account_missing(p_member uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select array_remove(array[
    case when mp.display_name is null then 'display_name' end,
    case when mp.pref is null then 'pref' end,
    case when mp.city is null then 'city' end,
    case when coalesce(jsonb_array_length(mp.gyms), 0) = 0 then 'gyms' end,
    case when mp.age_band is null then 'age_band' end,
    case when mp.gender is null then 'gender' end,
    case when pp.last_name is null then 'name' end,
    case when pp.last_name_kana is null then 'kana' end,
    case when pp.email is null then 'email' end
  ], null)
    from (select p_member id) m
    left join member_profiles mp on mp.member_id = m.id
    left join member_private_profiles pp on pp.member_id = m.id
$$;

-- ── 公開項目の保存（サーバー＝service_role 経由。ジムはサーバーがジムナビの収録データと照合してから渡す） ──
create or replace function mf_public_save(p_member uuid, p_display_name text, p_pref text, p_city text,
                                          p_age_band text, p_gender text, p_gyms jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare dn text; c text; g jsonb; out jsonb := '[]'::jsonb; pending text[] := '{}'; old jsonb; nm text; st text;
begin
  dn := gt_check_text(p_display_name, '表示名（ニックネーム）', 20);
  if dn = '' then raise exception '表示名（ニックネーム）を入力してください'; end if;
  if p_pref is null or not (p_pref = any (mf_prefs())) then raise exception '都道府県を選んでください'; end if;
  c := btrim(coalesce(p_city, ''));
  if not (c ~ '^[ぁ-んァ-ヶ一-龠々ヶー]{1,15}[市区町村郡]$' or c ~ '^[ぁ-んァ-ヶ一-龠々ヶー]{1,10}市[ぁ-んァ-ヶ一-龠々ヶー]{1,6}区$'
          or c ~ '^[ぁ-んァ-ヶ一-龠々ヶー]{1,8}郡[ぁ-んァ-ヶ一-龠々ヶー]{1,8}[町村]$') then
    raise exception '市区町村を正しく入力してください（例：渋谷区・熊本市）';
  end if;
  if p_age_band is null or p_age_band not in ('18-24', '25-34', '35-44', '45+', 'none') then raise exception '年代を選んでください'; end if;
  if p_gender is null or p_gender not in ('male', 'female', 'none') then raise exception '性別を選んでください'; end if;
  if jsonb_typeof(p_gyms) is distinct from 'array' or jsonb_array_length(p_gyms) < 1 or jsonb_array_length(p_gyms) > 5 then
    raise exception '通っているジムを1〜5件選んでください';
  end if;
  select gyms into old from member_profiles where member_id = p_member;
  for g in select * from jsonb_array_elements(p_gyms) loop
    nm := gt_check_text(g->>'name', 'ジム名', 60);
    if nm = '' then raise exception 'ジム名を入力してください'; end if;
    if g->>'kind' in ('review', 'store') then
      if coalesce(g->>'key', '') = '' or char_length(g->>'key') > 400 then raise exception 'ジムの指定が正しくありません'; end if;
      out := out || jsonb_build_array(jsonb_build_object('kind', g->>'kind', 'key', g->>'key', 'name', nm));
    elsif g->>'kind' = 'other' then
      -- 収録外のジム：運営が確認するまで（status=ok にするまで）ほかの会員には出さない
      select x->>'status' into st from jsonb_array_elements(coalesce(old, '[]'::jsonb)) x
       where x->>'kind' = 'other' and x->>'name' = nm limit 1;
      if st is null then pending := pending || nm; end if;
      out := out || jsonb_build_array(jsonb_build_object('kind', 'other', 'name', nm, 'status', coalesce(st, 'pending')));
    else
      raise exception 'ジムの指定が正しくありません';
    end if;
  end loop;
  insert into member_profiles (member_id, display_name, pref, city, gyms, age_band, gender, updated_at)
  values (p_member, dn, p_pref, c, out, p_age_band, p_gender, now())
  on conflict (member_id) do update set display_name = excluded.display_name, pref = excluded.pref, city = excluded.city,
    gyms = excluded.gyms, age_band = excluded.age_band, gender = excluded.gender, updated_at = now();
  -- 合トレの表示名・性別・年代はアカウントの写し
  update gotore_profiles set nickname = dn, gender = p_gender, age_band = p_age_band, updated_at = now() where member_id = p_member;
  return jsonb_build_object('ok', true, 'pending_other', to_jsonb(pending));
end $$;

-- 公開項目を読む（service_role 用：本人のアカウント画面の初期値・ジムの照合に使う。非公開は含まない）
create or replace function mf_public_get(p_member uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'public', (select jsonb_build_object('display_name', display_name, 'pref', pref, 'city', city, 'gyms', gyms,
                                         'age_band', age_band, 'gender', gender)
                 from member_profiles where member_id = p_member),
    'missing', to_jsonb(gt_account_missing(p_member)))
$$;

-- ── 本人用（ブラウザが本人のログインで直接呼ぶ。サーバーは経由しない） ──────────
create or replace function mf_self() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  if auth.uid() is null then raise exception 'ログインが必要です'; end if;
  select id into v from members where auth_user_id = auth.uid();
  if v is null then raise exception '会員情報が見つかりません'; end if;
  return v;
end $$;

create or replace function mf_account_get() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := mf_self();
begin
  return jsonb_build_object(
    'public', (select jsonb_build_object('display_name', display_name, 'pref', pref, 'city', city, 'gyms', gyms,
                                         'age_band', age_band, 'gender', gender)
                 from member_profiles where member_id = me),
    'private', (select jsonb_build_object('last_name', last_name, 'first_name', first_name,
                                          'last_name_kana', last_name_kana, 'first_name_kana', first_name_kana,
                                          'email', email, 'zip', zip, 'province', province, 'city', city,
                                          'address1', address1, 'address2', address2, 'phone', phone,
                                          'purpose_agreed_at', purpose_agreed_at)
                  from member_private_profiles where member_id = me),
    'missing', to_jsonb(gt_account_missing(me)));
end $$;

create or replace function mf_private_save(p jsonb, p_agree boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := mf_self();
        ln text := btrim(coalesce(p->>'last_name', ''));  fn text := btrim(coalesce(p->>'first_name', ''));
        lk text := btrim(coalesce(p->>'last_name_kana', '')); fk text := btrim(coalesce(p->>'first_name_kana', ''));
        em text := lower(btrim(coalesce(p->>'email', '')));
        zp text := normalize(btrim(coalesce(p->>'zip', '')), NFKC);
        pv text := btrim(coalesce(p->>'province', '')); ct text := btrim(coalesce(p->>'city', ''));
        a1 text := btrim(coalesce(p->>'address1', '')); a2 text := btrim(coalesce(p->>'address2', ''));
        ph text := normalize(btrim(coalesce(p->>'phone', '')), NFKC);
begin
  if not coalesce(p_agree, false) then
    raise exception '利用目的（本人確認・安全対応・運営からの連絡・お届け先）と公開範囲への同意が必要です';
  end if;
  if ln = '' or fn = '' or char_length(ln) > 30 or char_length(fn) > 30 then raise exception '姓・名を入力してください（各30文字以内）'; end if;
  if lk !~ '^[ァ-ヶー　 ]{1,30}$' or fk !~ '^[ァ-ヶー　 ]{1,30}$' then raise exception 'セイ・メイはカタカナで入力してください'; end if;
  if char_length(em) > 254 or em !~ '^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$' or em ~ '@line\.fitpeak\.co$' then
    raise exception 'メールアドレスを正しく入力してください（LINEログイン用の内部アドレスは使えません）';
  end if;
  if zp <> '' or pv <> '' or ct <> '' or a1 <> '' or a2 <> '' then
    if zp !~ '^\d{3}-?\d{4}$' then raise exception '郵便番号は7桁で入力してください'; end if;
    zp := substr(replace(zp, '-', ''), 1, 3) || '-' || substr(replace(zp, '-', ''), 4, 4);
    if not (pv = any (mf_prefs())) or ct = '' or a1 = '' or char_length(ct) > 60 or char_length(a1) > 100 or char_length(a2) > 100 then
      raise exception '住所は都道府県・市区町村・町名番地をそろえて入力してください';
    end if;
  end if;
  if ph <> '' and (ph !~ '^[0-9+\-() ]+$' or char_length(regexp_replace(ph, '\D', '', 'g')) not between 10 and 13) then
    raise exception '電話番号を正しく入力してください';
  end if;
  insert into member_private_profiles (member_id, last_name, first_name, last_name_kana, first_name_kana, email,
                                       zip, province, city, address1, address2, phone, purpose_agreed_at, updated_at)
  values (me, ln, fn, lk, fk, em, nullif(zp, ''), nullif(pv, ''), nullif(ct, ''), nullif(a1, ''), nullif(a2, ''), nullif(ph, ''), now(), now())
  on conflict (member_id) do update set last_name = excluded.last_name, first_name = excluded.first_name,
    last_name_kana = excluded.last_name_kana, first_name_kana = excluded.first_name_kana, email = excluded.email,
    zip = excluded.zip, province = excluded.province, city = excluded.city, address1 = excluded.address1,
    address2 = excluded.address2, phone = excluded.phone, purpose_agreed_at = now(), updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function mf_private_delete() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := mf_self();
begin
  delete from member_private_profiles where member_id = me;
  return jsonb_build_object('ok', true);
end $$;

-- ── 合トレ：プロフィールはアカウントから。合トレ固有の項目だけをここで持つ ──────────
drop function if exists gt_profile_save(uuid, text, text, text, text, text, boolean);
create or replace function gt_profile_save(p_member uuid, p_level text, p_bio text, p_agree boolean,
                                           p_nickname text default null, p_gender text default null, p_age_band text default null,
                                           p_history text default null, p_fav_lifts text default null,
                                           p_usual_slots text[] default null, p_purposes text[] default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare mp member_profiles; ex gotore_profiles; bio text; fav text; miss text[];
begin
  if not coalesce(p_agree, false) then raise exception '利用規約（18歳以上・合トレ目的のみ）への同意が必要です'; end if;
  select * into mp from member_profiles where member_id = p_member;
  select * into ex from gotore_profiles where member_id = p_member;
  miss := gt_account_missing(p_member);
  -- 新しく使う人はアカウントのプロフィールが揃ってから。既存の人は使えなくしない（gt_me で入力を促す）
  if ex.member_id is null and cardinality(miss) > 0 then
    raise exception '先にMy FITPEAKのアカウントのプロフィール（表示名・市区町村・通っているジム・年代・性別・お名前・メールアドレス）を登録してください';
  end if;
  if p_level is null or p_level not in ('beginner', 'intermediate', 'advanced', 'competitor') then raise exception 'レベルを選んでください'; end if;
  if p_history is not null and p_history <> '' and p_history not in ('<1y', '1-3y', '3-5y', '5y+') then
    raise exception 'トレーニング歴の指定が正しくありません';
  end if;
  if not coalesce(p_usual_slots, '{}') <@ array['wd_am', 'wd_pm', 'wd_night', 'we_am', 'we_pm', 'we_night'] then
    raise exception '通う時間帯の指定が正しくありません';
  end if;
  if not coalesce(p_purposes, '{}') <@ array['spot', 'form', 'motivation', 'learn', 'teach'] then
    raise exception '目的の指定が正しくありません';
  end if;
  bio := gt_check_text(p_bio, '自己紹介', 200);
  fav := gt_check_text(p_fav_lifts, '得意種目', 40);
  if ex.member_id is null then
    insert into gotore_profiles (member_id, nickname, gender, age_band, level, bio, agreed_at, history, fav_lifts, usual_slots, purposes)
    values (p_member, mp.display_name, mp.gender, mp.age_band, p_level, bio, gt_now(),
            nullif(p_history, ''), fav, coalesce(p_usual_slots, '{}'), coalesce(p_purposes, '{}'));
  else
    update gotore_profiles set
      nickname = coalesce(mp.display_name, nickname), gender = coalesce(mp.gender, gender), age_band = coalesce(mp.age_band, age_band),
      level = p_level, bio = bio_v.b, history = nullif(p_history, ''), fav_lifts = fav,
      usual_slots = coalesce(p_usual_slots, '{}'), purposes = coalesce(p_purposes, '{}'), updated_at = gt_now()
      from (select bio as b) bio_v
     where member_id = p_member;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- 掲示板で見せるアカウントの公開項目（市区町村・確認済みのジム名）
create or replace function gt_public_account(p_member uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'city', mp.city,
    'gyms', coalesce((select jsonb_agg(x->>'name') from jsonb_array_elements(mp.gyms) x
                       where x->>'kind' <> 'other' or x->>'status' = 'ok'), '[]'::jsonb))
    from (select p_member id) m left join member_profiles mp on mp.member_id = m.id
$$;

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
               'bio', o.bio, 'history', o.history, 'fav_lifts', o.fav_lifts, 'usual_slots', o.usual_slots, 'purposes', o.purposes,
               'slots', p.slots, 'parts', p.parts, 'goals', p.goals, 'gender_pref', p.gender_pref,
               'note', p.note, 'created_at', p.created_at, 'expires_at', p.expires_at,
               'mine', p.member_id = p_member,
               'requested', exists (select 1 from gotore_requests r where r.post_id = p.id and r.from_member = p_member))
             || gt_public_account(p.member_id)
             order by (p.member_id = p_member) desc, p.created_at desc)
        from gotore_posts p join gotore_profiles o on o.member_id = p.member_id
       where p.gym_id = g.id and gt_can_see(p_member, p)), '[]'::jsonb));
end $$;

-- gt_me に合トレ固有の項目と「アカウントの足りない項目名」を足す
do $$
begin
  -- 既存の gt_me を gt_me_base に改名して、その上に項目を足す（中身の複製を避ける）
  if exists (select 1 from pg_proc where proname = 'gt_me' and pronamespace = 'public'::regnamespace)
     and not exists (select 1 from pg_proc where proname = 'gt_me_base' and pronamespace = 'public'::regnamespace) then
    alter function gt_me(uuid) rename to gt_me_base;
  end if;
end $$;

create or replace function gt_me(p_member uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select b
         || jsonb_build_object('profile', case when b->'profile' = 'null'::jsonb or b->'profile' is null then null else
              (b->'profile') || (select jsonb_build_object('history', history, 'fav_lifts', fav_lifts,
                                                           'usual_slots', usual_slots, 'purposes', purposes)
                                   from gotore_profiles where member_id = p_member) end)
         || jsonb_build_object('account_missing', to_jsonb(gt_account_missing(p_member)))
    from (select gt_me_base(p_member) b) x
$$;

-- ── 権限 ──────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array['gt_account_missing(uuid)', 'mf_public_save(uuid, text, text, text, text, text, jsonb)', 'mf_public_get(uuid)',
                           'gt_profile_save(uuid, text, text, boolean, text, text, text, text, text, text[], text[])',
                           'gt_public_account(uuid)', 'gt_gym_board(uuid, text)', 'gt_me(uuid)', 'gt_me_base(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array['mf_self()', 'mf_account_get()', 'mf_private_save(jsonb, boolean)', 'mf_private_delete()'] loop
    execute format('revoke all on function %s from public, anon, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  revoke all on function mf_prefs() from public, anon, authenticated;
end $$;

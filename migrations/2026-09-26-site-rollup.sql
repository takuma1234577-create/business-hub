-- ============================================================================
-- FITPEAK サイト分析：集計の事前計算（ロールアップ）
--
-- アクセスが増えて site_events（生のイベント。1日十数万件）を毎回全部読むと、
-- 「サイト全体」「ページ別」の集計が statement timeout になるため、次の2つを事前に作っておく。
--
--   site_pageviews    … 1ページビュー = 1行。閲覧時間・スクロール・カート追加・
--                        セッション内の順番/前後ページ/入口・流入元まで計算済み（site_pv_base と同じ列）
--   site_click_hourly … クリックを 1時間 × ページ × デバイス × 要素 で数えたもの
--
-- pg_cron で15分ごとに site_rollup() を実行し、「3時間より前」まで確定させる
-- （閲覧時間・スクロールは離脱時に届くため、少し待ってから確定する）。
-- 集計関数は「確定済みの行」＋「まだ確定していない直近の分だけ生データから計算」を合わせて使う。
-- ============================================================================

create table if not exists public.site_pageviews (
  pageview_id    text primary key,
  session_id     text,
  visitor_id     text,
  path           text,
  title          text,
  created_at     timestamptz not null,
  device         text,
  browser        text,
  os             text,
  country        text,
  city           text,
  channel        text,
  ref_host       text,
  utm_source     text,
  utm_campaign   text,
  is_new_visitor boolean,
  eng            int,
  scroll         real,
  cart           boolean,
  checkout       boolean,
  seq            bigint,
  session_pvs    bigint,
  prev_path      text,
  next_path      text,
  s_channel      text,
  s_ref          text,
  s_utm_source   text,
  s_utm_campaign text,
  s_entry        text,
  site           text not null default 'fitpeak.co'
);
alter table public.site_pageviews enable row level security;
create index if not exists site_pageviews_time_idx on public.site_pageviews (site, created_at);
create index if not exists site_pageviews_path_idx on public.site_pageviews (site, path, created_at);
create index if not exists site_pageviews_session_idx on public.site_pageviews (session_id);
comment on table public.site_pageviews is 'site_events から作る1ページビュー1行の集計用テーブル（site_rollup が15分ごとに更新）';

create table if not exists public.site_click_hourly (
  site    text not null,
  hour    timestamptz not null,
  path    text not null,
  device  text not null,
  label   text not null,
  n       int not null,
  rage    int not null,
  primary key (site, hour, path, device, label)
);
alter table public.site_click_hourly enable row level security;
create index if not exists site_click_hourly_path_idx on public.site_click_hourly (site, path, hour);

create table if not exists public.site_rollup_state (
  site          text primary key,
  rolled_until  timestamptz not null,
  updated_at    timestamptz not null default now()
);
alter table public.site_rollup_state enable row level security;

-- ----------------------------------------------------------------------------
-- 指定範囲を作り直す（前後6時間を含めて計算し、セッション内の順番・前後ページを正しくする）
-- ----------------------------------------------------------------------------
create or replace function public.site_rollup_range(p_site text, p_from timestamptz, p_to timestamptz)
returns int language plpgsql volatile security definer set search_path = public as $$
declare n int;
begin
  delete from site_pageviews where site = p_site and created_at >= p_from and created_at < p_to;
  insert into site_pageviews (
    pageview_id, session_id, visitor_id, path, title, created_at, device, browser, os, country, city,
    channel, ref_host, utm_source, utm_campaign, is_new_visitor, eng, scroll, cart, checkout,
    seq, session_pvs, prev_path, next_path, s_channel, s_ref, s_utm_source, s_utm_campaign, s_entry, site)
  select b.pageview_id, b.session_id, b.visitor_id, b.path, b.title, b.created_at, b.device, b.browser, b.os, b.country, b.city,
         b.channel, b.ref_host, b.utm_source, b.utm_campaign, b.is_new_visitor, b.eng, b.scroll, b.cart, b.checkout,
         b.seq, b.session_pvs, b.prev_path, b.next_path, b.s_channel, b.s_ref, b.s_utm_source, b.s_utm_campaign, b.s_entry, p_site
  from site_pv_base(p_site, p_from - interval '6 hours', p_to + interval '6 hours') b
  where b.created_at >= p_from and b.created_at < p_to
  on conflict (pageview_id) do nothing;
  get diagnostics n = row_count;

  delete from site_click_hourly where site = p_site and hour >= date_trunc('hour', p_from) and hour < p_to;
  insert into site_click_hourly (site, hour, path, device, label, n, rage)
  select p_site, date_trunc('hour', created_at), coalesce(path, ''), coalesce(device, '不明'),
         left(coalesce(nullif(trim(el_text), ''), el_selector, '(不明)'), 200),
         count(*), count(*) filter (where event_type = 'rageclick')
  from site_events
  where site = p_site and event_type in ('click', 'rageclick')
    and created_at >= date_trunc('hour', p_from) and created_at < p_to
  group by 2, 3, 4, 5
  on conflict (site, hour, path, device, label) do update set n = excluded.n, rage = excluded.rage;
  return n;
end $$;

-- 確定できるところまで進める（6時間ずつ。1回で最大 p_max_hours 時間ぶん）
create or replace function public.site_rollup(p_site text default 'fitpeak.co', p_max_hours int default 48)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_until timestamptz := date_trunc('hour', now() - interval '3 hours');
  v_from  timestamptz;
  v_to    timestamptz;
  v_stop  timestamptz;
  v_rows  int := 0;
begin
  select rolled_until into v_from from site_rollup_state where site = p_site;
  if v_from is null then
    select date_trunc('hour', min(created_at)) into v_from from site_events where site = p_site;
    if v_from is null then return jsonb_build_object('rolled', 0); end if;
  end if;
  v_stop := least(v_until, v_from + make_interval(hours => p_max_hours));
  while v_from < v_stop loop
    v_to := least(v_from + interval '6 hours', v_stop);
    v_rows := v_rows + site_rollup_range(p_site, v_from, v_to);
    v_from := v_to;
    insert into site_rollup_state (site, rolled_until, updated_at) values (p_site, v_from, now())
      on conflict (site) do update set rolled_until = excluded.rolled_until, updated_at = now();
  end loop;
  return jsonb_build_object('rolled_until', v_from, 'pageviews', v_rows);
end $$;

-- ----------------------------------------------------------------------------
-- 集計用のページビュー行：確定済み（site_pageviews）＋ 未確定の直近分（生データから計算）
-- ----------------------------------------------------------------------------
create or replace function public.site_pv_rows(p_site text, p_from timestamptz, p_to timestamptz)
returns table (
  pageview_id text, session_id text, visitor_id text, path text, title text, created_at timestamptz,
  device text, browser text, os text, country text, city text,
  channel text, ref_host text, utm_source text, utm_campaign text, is_new_visitor boolean,
  eng int, scroll real, cart boolean, checkout boolean,
  seq bigint, session_pvs bigint, prev_path text, next_path text,
  s_channel text, s_ref text, s_utm_source text, s_utm_campaign text, s_entry text
)
language plpgsql stable set search_path = public as $$
declare
  wm timestamptz := coalesce((select rolled_until from site_rollup_state s where s.site = p_site), '-infinity'::timestamptz);
  live_from timestamptz := greatest(p_from, wm);
begin
  return query
    select v.pageview_id, v.session_id, v.visitor_id, v.path, v.title, v.created_at, v.device, v.browser, v.os, v.country, v.city,
           v.channel, v.ref_host, v.utm_source, v.utm_campaign, v.is_new_visitor, v.eng, v.scroll, v.cart, v.checkout,
           v.seq, v.session_pvs, v.prev_path, v.next_path, v.s_channel, v.s_ref, v.s_utm_source, v.s_utm_campaign, v.s_entry
    from site_pageviews v
    where v.site = p_site and v.created_at >= p_from and v.created_at < least(p_to, wm);
  if p_to > live_from then
    return query
      select b.* from site_pv_base(p_site, live_from - interval '6 hours', p_to) b
      where b.created_at >= live_from and b.created_at < p_to;
  end if;
end $$;

-- クリック数（要素別）：確定済みの時間集計＋未確定分
create or replace function public.site_top_clicks(p_site text, p_from timestamptz, p_to timestamptz, p_device text, p_path text, p_limit int default 15)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  wm timestamptz := coalesce((select rolled_until from site_rollup_state s where s.site = p_site), '-infinity'::timestamptz);
  -- 時間集計は1時間単位なので、範囲の端は生データで数える
  h_from timestamptz := date_trunc('hour', p_from) + case when date_trunc('hour', p_from) < p_from then interval '1 hour' else interval '0' end;
  h_to timestamptz := least(date_trunc('hour', p_to), wm);
  r jsonb;
begin
  with raw as (
    select left(coalesce(nullif(trim(el_text), ''), el_selector, '(不明)'), 200) as label, event_type
    from site_events
    where site = p_site and event_type in ('click', 'rageclick')
      and ((created_at >= p_from and created_at < least(h_from, p_to)) or (created_at >= greatest(h_to, h_from, p_from) and created_at < p_to))
      and (p_path is null or path = p_path)
      and (p_device is null or p_device = 'all' or device = p_device)
  ),
  u as (
    select label, count(*)::bigint n, count(*) filter (where event_type = 'rageclick')::bigint rg from raw group by 1
    union all
    select label, sum(c.n)::bigint, sum(c.rage)::bigint from site_click_hourly c
    where c.site = p_site and h_to > h_from and c.hour >= h_from and c.hour < h_to
      and (p_path is null or c.path = p_path)
      and (p_device is null or p_device = 'all' or c.device = p_device)
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('label', label, 'count', n, 'rage', rg) order by n desc), '[]'::jsonb) into r
  from (select label, sum(n) n, sum(rg) rg from u group by 1 order by 2 desc limit p_limit) z;
  return r;
end $$;

revoke execute on function public.site_rollup_range(text, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.site_rollup(text, int) from public, anon, authenticated;
revoke execute on function public.site_pv_rows(text, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.site_top_clicks(text, timestamptz, timestamptz, text, text, int) from public, anon, authenticated;
grant execute on function public.site_rollup(text, int) to service_role;

-- ----------------------------------------------------------------------------
-- サイト全体・ページ別：生データの代わりに site_pv_rows / site_top_clicks を使う
-- ----------------------------------------------------------------------------
create or replace function public.site_overview(
  p_site text, p_from timestamptz, p_to timestamptz, p_device text default 'all', p_path text default null
) returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  span interval := p_to - p_from;
  gran text := case when p_to - p_from <= interval '2 days' then 'hour' else 'day' end;
  res jsonb;
  cur jsonb; prev jsonb;
begin
  drop table if exists _pv; drop table if exists _pvp;
  create temp table _pv on commit drop as
    select * from site_pv_rows(p_site, p_from, p_to) b
    where p_device is null or p_device = 'all' or b.device = p_device;
  create temp table _pvp on commit drop as
    select * from site_pv_rows(p_site, p_from - span, p_from) b
    where p_device is null or p_device = 'all' or b.device = p_device;

  cur := _site_kpis('_pv', p_path);
  prev := _site_kpis('_pvp', p_path);

  with t as (select * from _pv where p_path is null or path = p_path),
  sess as (select * from _pv where session_id in (select session_id from t) and seq = 1)
  select jsonb_build_object(
    'granularity', gran,
    'kpis', cur,
    'prev_kpis', prev,
    'timeseries', (
      select coalesce(jsonb_agg(jsonb_build_object('t', to_char(g, 'YYYY-MM-DD"T"HH24:MI'), 'users', coalesce(x.users, 0), 'sessions', coalesce(x.sessions, 0), 'pageviews', coalesce(x.pv, 0)) order by g), '[]'::jsonb)
      from generate_series(
        date_trunc(gran, p_from at time zone 'Asia/Tokyo'),
        date_trunc(gran, (p_to - interval '1 second') at time zone 'Asia/Tokyo'),
        ('1 ' || gran)::interval) g
      left join (
        select date_trunc(gran, created_at at time zone 'Asia/Tokyo') b,
               count(distinct visitor_id) users, count(distinct session_id) sessions, count(*) pv
        from t group by 1
      ) x on x.b = g
    ),
    'pages', (
      select coalesce(jsonb_agg(p order by (p->>'pageviews')::int desc), '[]'::jsonb) from (
        select jsonb_build_object('path', path, 'title', max(title), 'pageviews', count(*),
          'users', count(distinct visitor_id), 'avg_time_sec', round((avg(eng) / 1000.0)::numeric, 1),
          'avg_scroll', round(avg(scroll)::numeric, 3), 'entries', count(*) filter (where seq = 1),
          'exit_rate', round(((count(*) filter (where next_path is null))::float / count(*))::numeric, 3),
          'cart_adds', count(*) filter (where cart)) p
        from _pv group by path order by count(*) desc limit 100
      ) z
    ),
    'channels', (
      select coalesce(jsonb_agg(jsonb_build_object('name', k, 'sessions', n, 'users', u) order by n desc), '[]'::jsonb)
      from (select coalesce(s_channel, '直接') k, count(distinct session_id) n, count(distinct visitor_id) u from sess group by 1) z
    ),
    'referrers', (
      select coalesce(jsonb_agg(jsonb_build_object('name', k, 'sessions', n) order by n desc), '[]'::jsonb)
      from (select s_ref k, count(distinct session_id) n from sess where s_ref is not null group by 1 order by 2 desc limit 20) z
    ),
    'campaigns', (
      select coalesce(jsonb_agg(jsonb_build_object('name', k, 'sessions', n) order by n desc), '[]'::jsonb)
      from (select coalesce(s_utm_source, '-') || ' / ' || coalesce(s_utm_campaign, '-') k, count(distinct session_id) n
            from sess where s_utm_source is not null or s_utm_campaign is not null group by 1 order by 2 desc limit 20) z
    ),
    'devices',   (select coalesce(jsonb_agg(jsonb_build_object('name', k, 'users', n) order by n desc), '[]'::jsonb) from (select coalesce(device, '不明') k, count(distinct visitor_id) n from t group by 1) z),
    'browsers',  (select coalesce(jsonb_agg(jsonb_build_object('name', k, 'users', n) order by n desc), '[]'::jsonb) from (select coalesce(browser, '不明') k, count(distinct visitor_id) n from t group by 1 order by 2 desc limit 10) z),
    'os',        (select coalesce(jsonb_agg(jsonb_build_object('name', k, 'users', n) order by n desc), '[]'::jsonb) from (select coalesce(os, '不明') k, count(distinct visitor_id) n from t group by 1 order by 2 desc limit 10) z),
    'countries', (select coalesce(jsonb_agg(jsonb_build_object('name', k, 'users', n) order by n desc), '[]'::jsonb) from (select coalesce(country, '不明') k, count(distinct visitor_id) n from t group by 1 order by 2 desc limit 15) z),
    'cities',    (select coalesce(jsonb_agg(jsonb_build_object('name', k, 'users', n) order by n desc), '[]'::jsonb) from (select city k, count(distinct visitor_id) n from t where city is not null group by 1 order by 2 desc limit 15) z),
    'user_type', jsonb_build_object(
      'new', (select count(distinct visitor_id) from t where is_new_visitor),
      'returning', (select count(distinct visitor_id) from t where not is_new_visitor)
    ),
    'entry_pages', (select coalesce(jsonb_agg(jsonb_build_object('name', k, 'count', n) order by n desc), '[]'::jsonb) from (select path k, count(*) n from _pv where seq = 1 group by 1 order by 2 desc limit 15) z),
    'exit_pages',  (select coalesce(jsonb_agg(jsonb_build_object('name', k, 'count', n) order by n desc), '[]'::jsonb) from (select path k, count(*) n from _pv where next_path is null group by 1 order by 2 desc limit 15) z),
    'prev_pages',  (select coalesce(jsonb_agg(jsonb_build_object('name', k, 'count', n) order by n desc), '[]'::jsonb) from (select coalesce(prev_path, '（入口：' || coalesce(s_channel, '直接') || '）') k, count(*) n from t group by 1 order by 2 desc limit 12) z),
    'next_pages',  (select coalesce(jsonb_agg(jsonb_build_object('name', k, 'count', n) order by n desc), '[]'::jsonb) from (select coalesce(next_path, '（離脱）') k, count(*) n from t group by 1 order by 2 desc limit 12) z),
    'scroll_reach', (
      select coalesce(jsonb_agg(jsonb_build_object('depth', d, 'pct', case when tot = 0 then 0 else cnt::float / tot end) order by d), '[]'::jsonb)
      from (select d, (select count(*) from t where scroll * 100 >= d - 0.001) cnt, (select count(*) from t) tot
            from generate_series(10, 100, 10) d) z
    ),
    'week_hour', (
      select coalesce(jsonb_agg(jsonb_build_object('dow', dw, 'hour', hr, 'pageviews', n)), '[]'::jsonb)
      from (select extract(dow from created_at at time zone 'Asia/Tokyo')::int dw,
                   extract(hour from created_at at time zone 'Asia/Tokyo')::int hr, count(*) n
            from t group by 1, 2) z
    ),
    'funnel', jsonb_build_array(
      jsonb_build_object('step', '訪問', 'sessions', (select count(distinct session_id) from _pv)),
      jsonb_build_object('step', '商品ページ閲覧', 'sessions', (select count(distinct session_id) from _pv where path like '/products/%')),
      jsonb_build_object('step', 'カート追加', 'sessions', (select count(distinct session_id) from _pv where cart)),
      jsonb_build_object('step', 'カート表示', 'sessions', (select count(distinct session_id) from _pv where path = '/cart')),
      jsonb_build_object('step', '購入手続きへ', 'sessions', (select count(distinct session_id) from _pv where checkout))
    ),
    'top_clicks', site_top_clicks(p_site, p_from, p_to, p_device, p_path, 15)
  ) into res;
  return res;
end $$;


-- ----------------------------------------------------------------------------
-- 15分ごとに確定（pg_cron）
-- ----------------------------------------------------------------------------
select cron.schedule('site-rollup', '*/15 * * * *', $$select public.site_rollup('fitpeak.co', 48)$$);

-- ----------------------------------------------------------------------------
-- 未確定分の計算で前にさかのぼる幅を6時間→1時間に（セッションが1時間以上続くことはまれ）
-- ----------------------------------------------------------------------------
create or replace function public.site_pv_rows(p_site text, p_from timestamptz, p_to timestamptz)
returns table (
  pageview_id text, session_id text, visitor_id text, path text, title text, created_at timestamptz,
  device text, browser text, os text, country text, city text,
  channel text, ref_host text, utm_source text, utm_campaign text, is_new_visitor boolean,
  eng int, scroll real, cart boolean, checkout boolean,
  seq bigint, session_pvs bigint, prev_path text, next_path text,
  s_channel text, s_ref text, s_utm_source text, s_utm_campaign text, s_entry text
)
language plpgsql stable set search_path = public as $$
declare
  wm timestamptz := coalesce((select rolled_until from site_rollup_state s where s.site = p_site), '-infinity'::timestamptz);
  live_from timestamptz := greatest(p_from, wm);
begin
  return query
    select v.pageview_id, v.session_id, v.visitor_id, v.path, v.title, v.created_at, v.device, v.browser, v.os, v.country, v.city,
           v.channel, v.ref_host, v.utm_source, v.utm_campaign, v.is_new_visitor, v.eng, v.scroll, v.cart, v.checkout,
           v.seq, v.session_pvs, v.prev_path, v.next_path, v.s_channel, v.s_ref, v.s_utm_source, v.s_utm_campaign, v.s_entry
    from site_pageviews v
    where v.site = p_site and v.created_at >= p_from and v.created_at < least(p_to, wm);
  if p_to > live_from then
    return query
      select b.* from site_pv_base(p_site, live_from - interval '1 hour', p_to) b
      where b.created_at >= live_from and b.created_at < p_to;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 集計結果の保存（キャッシュ）
--   7日間・30日間・90日間のサイト全体は、15分ごとに計算して保存しておき、画面は保存済みの結果を即表示する。
--   それ以外（デバイス別・ページ別など）は、最初に開いたときに計算して15分間保存する。
-- ----------------------------------------------------------------------------
create table if not exists public.site_report_cache (
  key         text primary key,
  data        jsonb not null,
  created_at  timestamptz not null default now()
);
alter table public.site_report_cache enable row level security;

-- 画面の期間プリセット（日本時間の0時区切り）→ 期間。server/site-analytics.cjs の range() と同じ計算
create or replace function public.site_preset_range(p_preset text, out p_from timestamptz, out p_to timestamptz)
language plpgsql stable as $$
declare
  jst_midnight timestamptz := (date_trunc('day', now() at time zone 'Asia/Tokyo')) at time zone 'Asia/Tokyo';
  days int;
begin
  p_to := now();
  if p_preset = 'today' then p_from := jst_midnight;
  elsif p_preset = 'yesterday' then p_from := jst_midnight - interval '1 day'; p_to := jst_midnight;
  else
    days := coalesce(nullif(regexp_replace(p_preset, '\D', '', 'g'), '')::int, 7);
    p_from := jst_midnight - make_interval(days => days - 1);
  end if;
end $$;

create or replace function public.site_warm_cache(p_site text default 'fitpeak.co')
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  pr text; r record; n int := 0; d jsonb;
begin
  foreach pr in array array['7d', '30d', '90d'] loop
    select * into r from site_preset_range(pr);
    d := site_overview(p_site, r.p_from, r.p_to, 'all', null)
         || jsonb_build_object('from', r.p_from, 'to', r.p_to, 'cached_at', now());
    insert into site_report_cache (key, data, created_at)
    values ('overview|' || p_site || '|' || pr || '|all|', d, now())
    on conflict (key) do update set data = excluded.data, created_at = excluded.created_at;
    n := n + 1;
  end loop;
  delete from site_report_cache where created_at < now() - interval '1 day';
  return n;
end $$;

revoke execute on function public.site_warm_cache(text) from public, anon, authenticated;

-- 15分ごと：確定 → 保存済み集計の更新
select cron.unschedule('site-rollup');
select cron.schedule('site-rollup', '*/15 * * * *', $$select public.site_rollup('fitpeak.co', 48); select public.site_warm_cache('fitpeak.co');$$);

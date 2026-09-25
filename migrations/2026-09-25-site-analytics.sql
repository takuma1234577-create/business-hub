-- ============================================================================
-- FITPEAK サイト分析（fitpeak.co 全体のアクセス解析・リアルタイム・ヒートマップ）
--
-- 計測タグ fa.js（/api/site-analytics/fa.js）が送るイベントを site_events に保存し、
-- 集計はすべてDB関数で行う（PostgRESTの1000行制限を避けるため）。
-- 個人を特定する情報（IP・氏名・メール）は保存しない。visitor_id はブラウザごとのランダムID。
-- 時間の区切りは日本時間（Asia/Tokyo）。
-- ============================================================================

create table if not exists public.site_events (
  id            bigserial primary key,
  site          text not null default 'fitpeak.co',
  created_at    timestamptz not null default now(),
  event_type    text not null,             -- pageview / ping / leave / click / rageclick / cart_add / checkout
  visitor_id    text,
  session_id    text,
  pageview_id   text,
  is_new_visitor boolean default false,
  is_new_session boolean default false,
  path          text,
  url           text,
  title         text,
  referrer      text,
  ref_host      text,
  channel       text,                      -- 自然検索 / 広告 / SNS / AI / 参照サイト / 直接 / 内部
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  device        text,                      -- mobile / tablet / desktop
  browser       text,
  os            text,
  country       text,
  city          text,
  vw int, vh int, doc_w int, doc_h int,
  x_ratio       real,
  y_ratio       real,
  scroll_pct    real,                      -- 0〜1。ping/leave は最大到達、click はクリック時点
  engaged_ms    int,                       -- そのページで画面を見ていた累計時間
  el_text       text,
  el_selector   text,
  href          text,
  meta          jsonb
);

-- RLS有効・ポリシーなし＝テーブルへの直接アクセスは不可。
-- 書き込み／集計は下の SECURITY DEFINER 関数経由のみ（サーバーはanonキーで動くため）。
alter table public.site_events enable row level security;

create index if not exists site_events_site_time_idx on public.site_events (site, created_at desc);
create index if not exists site_events_type_time_idx on public.site_events (site, event_type, created_at desc);
create index if not exists site_events_path_idx     on public.site_events (site, path, created_at desc);
create index if not exists site_events_pv_idx       on public.site_events (pageview_id);
create index if not exists site_events_session_idx  on public.site_events (session_id);

comment on table public.site_events is 'FITPEAK公式サイト（fitpeak.co）のアクセス解析イベント。fa.js から収集。個人情報は保存しない。';

-- ----------------------------------------------------------------------------
-- ページビュー単位の基礎データ（滞在時間・スクロール・セッション内の前後ページ）
-- ----------------------------------------------------------------------------
create or replace function public.site_pv_base(p_site text, p_from timestamptz, p_to timestamptz)
returns table (
  pageview_id text, session_id text, visitor_id text, path text, title text, created_at timestamptz,
  device text, browser text, os text, country text, city text,
  channel text, ref_host text, utm_source text, utm_campaign text, is_new_visitor boolean,
  eng int, scroll real, cart boolean, checkout boolean,
  seq bigint, session_pvs bigint, prev_path text, next_path text,
  s_channel text, s_ref text, s_utm_source text, s_utm_campaign text, s_entry text
)
language sql stable set search_path = public as $$
  with pv as (
    select * from site_events e
    where e.site = p_site and e.event_type = 'pageview'
      and e.created_at >= p_from and e.created_at < p_to
      and e.pageview_id is not null and e.session_id is not null
  ),
  agg as (
    select e.pageview_id,
           max(e.engaged_ms) as eng,
           max(e.scroll_pct) filter (where e.event_type in ('ping', 'leave', 'pageview')) as sc,
           bool_or(e.event_type = 'cart_add') as cart,
           bool_or(e.event_type = 'checkout') as co
    from site_events e
    where e.site = p_site and e.created_at >= p_from and e.created_at < p_to + interval '6 hours'
      and e.pageview_id in (select pv.pageview_id from pv)
    group by e.pageview_id
  )
  select pv.pageview_id, pv.session_id, pv.visitor_id, pv.path, pv.title, pv.created_at,
         pv.device, pv.browser, pv.os, pv.country, pv.city,
         pv.channel, pv.ref_host, pv.utm_source, pv.utm_campaign, coalesce(pv.is_new_visitor, false),
         least(coalesce(a.eng, 0), 1800000)::int, coalesce(a.sc, 0)::real,
         coalesce(a.cart, false), coalesce(a.co, false),
         row_number() over w,
         count(*) over (partition by pv.session_id),
         lag(pv.path) over w,
         lead(pv.path) over w,
         first_value(pv.channel) over w,
         first_value(pv.ref_host) over w,
         first_value(pv.utm_source) over w,
         first_value(pv.utm_campaign) over w,
         first_value(pv.path) over w
  from pv left join agg a on a.pageview_id = pv.pageview_id
  window w as (partition by pv.session_id order by pv.created_at, pv.id)
$$;

-- ----------------------------------------------------------------------------
-- KPI（_pv 一時テーブル名を受け取り集計）
-- ----------------------------------------------------------------------------
create or replace function public._site_kpis(p_tbl text, p_path text)
returns jsonb language plpgsql volatile set search_path = public as $$
declare r jsonb;
begin
  execute format($q$
    with t as (select * from %1$I where (%2$L::text is null or path = %2$L)),
    s as (
      select b.session_id, sum(b.eng) as eng, max(b.session_pvs) as pvs, bool_or(b.cart) as cart
      from %1$I b where b.session_id in (select session_id from t) group by b.session_id
    )
    select jsonb_build_object(
      'users',        (select count(distinct visitor_id) from t),
      'new_users',    (select count(distinct visitor_id) from t where is_new_visitor),
      'sessions',     (select count(distinct session_id) from t),
      'pageviews',    (select count(*) from t),
      'entries',      (select count(*) from t where seq = 1),
      'bounce_rate',  (select case when count(*) = 0 then 0 else (count(*) filter (where session_pvs = 1))::float / count(*) end from t where seq = 1),
      'exit_rate',    (select case when count(*) = 0 then 0 else (count(*) filter (where next_path is null))::float / count(*) end from t),
      'avg_time_on_page_sec', (select coalesce(avg(eng) / 1000.0, 0) from t),
      'avg_session_sec', (select coalesce(avg(eng) / 1000.0, 0) from s),
      'engaged_rate', (select case when count(*) = 0 then 0 else (count(*) filter (where pvs >= 2 or eng >= 10000 or cart))::float / count(*) end from s),
      'pages_per_session', (select case when count(*) = 0 then 0 else avg(pvs) end from s),
      'avg_scroll',   (select coalesce(avg(scroll), 0) from t),
      'cart_adds',    (select count(*) from t where cart),
      'checkouts',    (select count(*) from t where checkout)
    )
  $q$, p_tbl, p_path) into r;
  return r;
end $$;

-- ----------------------------------------------------------------------------
-- サイト全体 / ページ別の分析
--   p_path が null ならサイト全体、指定すればそのページだけ
--   p_device: all / mobile / desktop / tablet
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
    select * from site_pv_base(p_site, p_from, p_to) b
    where p_device is null or p_device = 'all' or b.device = p_device;
  create temp table _pvp on commit drop as
    select * from site_pv_base(p_site, p_from - span, p_from) b
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
    'top_clicks', (
      select coalesce(jsonb_agg(jsonb_build_object('label', label, 'count', n, 'rage', rg) order by n desc), '[]'::jsonb)
      from (select coalesce(nullif(trim(el_text), ''), el_selector, '(不明)') label, count(*) n,
                   count(*) filter (where event_type = 'rageclick') rg
            from site_events
            where site = p_site and event_type in ('click', 'rageclick')
              and created_at >= p_from and created_at < p_to
              and (p_path is null or path = p_path)
              and (p_device is null or p_device = 'all' or device = p_device)
            group by 1 order by 2 desc limit 15) z
    )
  ) into res;
  return res;
end $$;

-- ----------------------------------------------------------------------------
-- リアルタイム（直近のアクティブユーザー・閲覧中ページ・直近30分の推移）
-- ----------------------------------------------------------------------------
create or replace function public.site_realtime(p_site text, p_active_seconds int default 90)
returns jsonb language sql stable security definer set search_path = public as $$
  with recent as (
    select * from site_events where site = p_site and created_at >= now() - interval '30 minutes'
  ),
  last_ev as (
    select distinct on (session_id) session_id, visitor_id, path, title, device, country, city, created_at
    from recent where session_id is not null and event_type <> 'leave'
    order by session_id, created_at desc
  ),
  active as (select * from last_ev where created_at >= now() - make_interval(secs => p_active_seconds)),
  sess_info as (
    select session_id,
           min(created_at) filter (where event_type = 'pageview') started,
           count(*) filter (where event_type = 'pageview') pvs,
           (array_agg(channel order by created_at) filter (where event_type = 'pageview'))[1] channel,
           (array_agg(ref_host order by created_at) filter (where event_type = 'pageview'))[1] ref_host,
           bool_or(event_type = 'cart_add') cart
    from recent where session_id in (select session_id from active) group by session_id
  )
  select jsonb_build_object(
    'now', now(),
    'active_users', (select count(distinct coalesce(visitor_id, session_id)) from active),
    'users_30m', (select count(distinct visitor_id) from recent where event_type = 'pageview'),
    'pageviews_30m', (select count(*) from recent where event_type = 'pageview'),
    'cart_adds_30m', (select count(*) from recent where event_type = 'cart_add'),
    'per_minute', (
      select coalesce(jsonb_agg(jsonb_build_object('t', to_char(m at time zone 'Asia/Tokyo', 'HH24:MI'), 'pageviews', coalesce(x.pv, 0), 'users', coalesce(x.u, 0)) order by m), '[]'::jsonb)
      from generate_series(date_trunc('minute', now()) - interval '29 minutes', date_trunc('minute', now()), interval '1 minute') m
      left join (select date_trunc('minute', created_at) b, count(*) filter (where event_type = 'pageview') pv,
                        count(distinct visitor_id) u
                 from recent group by 1) x on x.b = m
    ),
    'active_pages', (
      select coalesce(jsonb_agg(jsonb_build_object('path', path, 'title', title, 'users', n) order by n desc), '[]'::jsonb)
      from (select path, max(title) title, count(*) n from active group by path order by 3 desc limit 20) z
    ),
    'active_sessions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'session_id', a.session_id, 'path', a.path, 'title', a.title, 'device', a.device,
        'country', a.country, 'city', a.city, 'last_seen', a.created_at,
        'started', s.started, 'pageviews', s.pvs, 'channel', s.channel, 'ref_host', s.ref_host, 'cart', s.cart
      ) order by a.created_at desc), '[]'::jsonb)
      from active a left join sess_info s on s.session_id = a.session_id
    ),
    'active_channels', (
      select coalesce(jsonb_agg(jsonb_build_object('name', k, 'users', n) order by n desc), '[]'::jsonb)
      from (select coalesce(channel, '直接') k, count(*) n from sess_info group by 1) z
    ),
    'active_devices', (
      select coalesce(jsonb_agg(jsonb_build_object('name', k, 'users', n) order by n desc), '[]'::jsonb)
      from (select coalesce(device, '不明') k, count(*) n from active group by 1) z
    ),
    'feed', (
      select coalesce(jsonb_agg(f order by (f->>'at') desc), '[]'::jsonb) from (
        select jsonb_build_object('at', created_at, 'type', event_type, 'path', path, 'title', title,
                                  'label', el_text, 'device', device, 'city', city, 'country', country,
                                  'channel', channel, 'session_id', session_id) f
        from recent where event_type in ('pageview', 'cart_add', 'checkout', 'click', 'rageclick')
        order by created_at desc limit 40
      ) z
    )
  )
$$;

-- ----------------------------------------------------------------------------
-- ヒートマップ（クリック分布・スクロール到達・熟読エリア）
-- ----------------------------------------------------------------------------
create or replace function public.site_heatmap(
  p_site text, p_path text, p_device text, p_from timestamptz, p_to timestamptz
) returns jsonb language sql stable security definer set search_path = public as $$
  with ev as (
    select * from site_events
    where site = p_site and path = p_path and created_at >= p_from and created_at < p_to
      and (p_device is null or p_device = 'all' or device = p_device)
  ),
  pv as (
    select pageview_id, max(scroll_pct) sc from ev
    where pageview_id is not null and event_type in ('pageview', 'ping', 'leave')
    group by pageview_id
  ),
  att as (
    select (b.ord - 1) idx, sum(b.v::numeric) ms
    from ev, jsonb_array_elements_text(ev.meta->'att') with ordinality b(v, ord)
    where ev.event_type = 'leave' and jsonb_typeof(ev.meta->'att') = 'array'
    group by 1
  )
  select jsonb_build_object(
    'pageviews', (select count(*) from ev where event_type = 'pageview'),
    'sessions', (select count(distinct session_id) from ev where event_type = 'pageview'),
    'doc_h', (select percentile_cont(0.5) within group (order by doc_h) from ev where doc_h > 0),
    'doc_w', (select percentile_cont(0.5) within group (order by doc_w) from ev where doc_w > 0),
    'clicks', coalesce((
      select jsonb_agg(jsonb_build_array(bx, by_, n, rg))
      from (select round(x_ratio * 200)::int bx, round(y_ratio * 2000)::int by_, count(*) n,
                   count(*) filter (where event_type = 'rageclick') rg
            from ev where event_type in ('click', 'rageclick') and x_ratio is not null and y_ratio is not null
            group by 1, 2 order by 3 desc limit 6000) z
    ), '[]'::jsonb),
    'click_total', (select count(*) from ev where event_type in ('click', 'rageclick')),
    'rage_total', (select count(*) from ev where event_type = 'rageclick'),
    'scroll_reach', (
      select coalesce(jsonb_agg(jsonb_build_object('depth', d, 'pct', case when tot = 0 then 0 else cnt::float / tot end) order by d), '[]'::jsonb)
      from (select d, (select count(*) from pv where coalesce(sc, 0) * 100 >= d - 0.001) cnt, (select count(*) from pv) tot
            from generate_series(0, 100, 5) d) z
    ),
    'attention', coalesce((select jsonb_agg(jsonb_build_object('band', idx, 'ms', ms) order by idx) from att), '[]'::jsonb),
    'top_elements', coalesce((
      select jsonb_agg(jsonb_build_object('label', label, 'selector', sel, 'count', n, 'rage', rg, 'href', href) order by n desc)
      from (select coalesce(nullif(trim(el_text), ''), el_selector, '(不明)') label, max(el_selector) sel, max(href) href,
                   count(*) n, count(*) filter (where event_type = 'rageclick') rg
            from ev where event_type in ('click', 'rageclick') group by 1 order by 4 desc limit 20) z
    ), '[]'::jsonb)
  )
$$;

-- ----------------------------------------------------------------------------
-- 収集（サーバーの /collect から呼ぶ。1回最大100件）
-- ----------------------------------------------------------------------------
create or replace function public.site_collect(p_rows jsonb)
returns int language plpgsql volatile security definer set search_path = public as $$
declare n int;
begin
  if jsonb_typeof(p_rows) <> 'array' then return 0; end if;
  insert into site_events (
    site, event_type, visitor_id, session_id, pageview_id, is_new_visitor, is_new_session,
    path, url, title, referrer, ref_host, channel, utm_source, utm_medium, utm_campaign,
    device, browser, os, country, city, vw, vh, doc_w, doc_h, x_ratio, y_ratio, scroll_pct,
    engaged_ms, el_text, el_selector, href, meta)
  select coalesce(r.site, 'fitpeak.co'), r.event_type, r.visitor_id, r.session_id, r.pageview_id,
         coalesce(r.is_new_visitor, false), coalesce(r.is_new_session, false),
         r.path, r.url, r.title, r.referrer, r.ref_host, r.channel, r.utm_source, r.utm_medium, r.utm_campaign,
         r.device, r.browser, r.os, r.country, r.city, r.vw, r.vh, r.doc_w, r.doc_h, r.x_ratio, r.y_ratio, r.scroll_pct,
         r.engaged_ms, r.el_text, r.el_selector, r.href, r.meta
  from jsonb_populate_recordset(null::site_events, (select jsonb_agg(z.value) from (select value from jsonb_array_elements(p_rows) limit 100) z)) r
  where r.event_type is not null;
  get diagnostics n = row_count;
  return n;
end $$;

-- 内部用の関数は外から呼べないようにし、入口の関数だけ公開する
revoke execute on function public.site_pv_base(text, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public._site_kpis(text, text) from public, anon, authenticated;
grant execute on function public.site_collect(jsonb) to anon, authenticated;
grant execute on function public.site_overview(text, timestamptz, timestamptz, text, text) to anon, authenticated;
grant execute on function public.site_realtime(text, int) to anon, authenticated;
grant execute on function public.site_heatmap(text, text, text, timestamptz, timestamptz) to anon, authenticated;

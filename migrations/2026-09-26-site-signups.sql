-- ============================================================================
-- FITPEAK サイト分析：公式サイト経由の「公式LINE登録」「My FITPEAK登録」の分析
--
-- ・公式LINE：サイトのLINEボタンのクリック記録（traffic_clicks）を元にする。
--   fa.js が /go/<経路コード>?mode=log の記録URLに fa_vid / fa_sid を付けるので、
--   どの訪問（セッション）で・どのページで・どの設置場所から登録したかが分かる。
--   それ以前の記録は、クリックURLの cid か「同じページ・直近のLINEボタンのクリック」で訪問に結び付ける。
-- ・My FITPEAK：fa.js が my.fitpeak.co へのリンクに fa_vid / fa_sid / fa_from / fa_place を付け、
--   my.fitpeak.co 側がログイン後に /api/public/site-analytics/signup-attr へ送る。
--   ログインユーザーが「サイトから来た後に作られた」場合だけ site_signups に登録として残す。
-- ============================================================================

alter table public.traffic_clicks add column if not exists fa_visitor_id text;
alter table public.traffic_clicks add column if not exists fa_session_id text;
create index if not exists traffic_clicks_fa_session_idx on public.traffic_clicks (fa_session_id) where fa_session_id is not null;
create index if not exists traffic_clicks_created_idx on public.traffic_clicks (created_at desc);

create table if not exists public.site_signups (
  id           bigserial primary key,
  site         text not null default 'fitpeak.co',
  kind         text not null default 'myfitpeak',   -- myfitpeak
  created_at   timestamptz not null default now(),   -- 登録（ログインユーザー作成）日時
  auth_user_id uuid unique,
  member_id    uuid,
  method       text,                                 -- email / line
  visitor_id   text,
  session_id   text,
  from_path    text,                                 -- 登録ボタンを押したページ（fitpeak.co のパス）
  from_url     text,
  place        text,                                 -- 押したリンクの文言
  clicked_at   timestamptz                           -- サイトでリンクを押した日時
);
alter table public.site_signups enable row level security;
create index if not exists site_signups_time_idx on public.site_signups (site, created_at desc);
comment on table public.site_signups is 'fitpeak.co から My FITPEAK に来て新規登録した人の記録（サイト分析の登録タブ用）';

-- ----------------------------------------------------------------------------
-- 登録の集計
-- ----------------------------------------------------------------------------
drop function if exists public.site_signups_report(text, timestamptz, timestamptz, text, text);
create or replace function public.site_signups_report(
  p_site text, p_from timestamptz, p_to timestamptz, p_device text default 'all', p_path text default null,
  p_include_ads boolean default false
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_gran text := case when p_to - p_from <= interval '2 days' then 'hour' else 'day' end;
  v_res jsonb;
begin
  with
  -- 公式LINE：fitpeak.co 上のボタンからのクリック
  lc as (
    select c.click_id, c.created_at, c.converted_at, c.entry, c.line_user_id, c.friend_id, c.user_agent,
           coalesce(nullif(c.utm_content, ''), '(不明)') as place,
           s.name as source_name,
           regexp_replace(regexp_replace(coalesce(c.landing_url, ''), '^https?://[^/]+', ''), '[?#].*$', '') as path,
           c.fa_session_id,
           -- 広告LP（Meta広告 → /products/…-line のLINE登録LP）からの登録。サイト回遊とは別物なので既定では除く
           (c.fbclid is not null or c.fbc is not null
             or coalesce(c.utm_content, '') ~ '^[0-9]{12,}$'
             or lower(coalesce(c.utm_source, '')) in ('meta', 'facebook', 'fb', 'ig', 'instagram_ads')
             or c.landing_url ~* '/products/[^/?#]*-line([/?#]|$)') as is_ad
    from traffic_clicks c
    join traffic_sources s on s.id = c.source_id
    where c.created_at >= p_from and c.created_at < p_to
      and c.landing_url ~* ('^https?://(www\.)?' || replace(p_site, '.', '\.') || '(/|$|\?)')
      and coalesce(c.entry, '') <> 'bot'
  ),
  lc_all as (select * from lc),
  lc2 as (
    select lc.*,
      coalesce(
        lc.fa_session_id,
        (select e.session_id from site_events e
          where e.site = p_site and e.event_type = 'click'
            and e.created_at between lc.created_at - interval '1 minute' and lc.created_at + interval '3 minutes'
            and e.href like '%cid=' || lc.click_id::text || '%'
          limit 1),
        (select e.session_id from site_events e
          where e.site = p_site and e.event_type = 'click' and e.path = lc.path
            and e.created_at between lc.created_at - interval '10 seconds' and lc.created_at + interval '90 seconds'
            and (e.href ilike '%line.me%' or e.href ilike '%liff%')
          order by abs(extract(epoch from e.created_at - lc.created_at)) limit 1)
      ) as session_id
    from lc
    where p_include_ads or not lc.is_ad
  ),
  line_rows as (
    select 'line'::text as kind, lc2.created_at as clicked_at, lc2.converted_at as done_at,
           lc2.path, lc2.place, lc2.source_name, lc2.session_id,
           (lc2.converted_at is not null) as converted,
           (lc2.converted_at is not null and (f.followed_at is null or f.followed_at >= lc2.created_at - interval '10 minutes')) as is_new,
           f.display_name as name,
           case when lc2.user_agent ~* '(iphone|ipod|android.*mobile)' then 'mobile'
                when lc2.user_agent ~* '(ipad|android)' then 'tablet' else 'desktop' end as ua_device
    from lc2 left join friends f on f.id = lc2.friend_id
  ),
  -- My FITPEAK：リンクのクリック（サイト分析のクリック記録）と登録
  mc as (
    select e.created_at as clicked_at, e.path, coalesce(nullif(e.el_text, ''), '(不明)') as place, e.session_id, e.device
    from site_events e
    where e.site = p_site and e.event_type = 'click'
      and e.created_at >= p_from and e.created_at < p_to
      and e.href ~* '^https?://my\.fitpeak\.co'
  ),
  ms as (
    select g.created_at, g.from_path as path, coalesce(nullif(g.place, ''), '(不明)') as place, g.session_id, g.method,
           m.nickname as name
    from site_signups g left join members m on m.id = g.member_id
    where g.site = p_site and g.created_at >= p_from and g.created_at < p_to
  ),
  -- 訪問（セッション）の情報：入口ページ・流入元・端末
  sess_ids as (
    select session_id from line_rows where session_id is not null
    union select session_id from ms where session_id is not null
    union select session_id from mc where session_id is not null
  ),
  sess as (
    select distinct on (e.session_id) e.session_id, e.path as entry_path, e.channel, e.ref_host, e.device, e.created_at as started
    from site_events e join sess_ids i on i.session_id = e.session_id
    where e.event_type = 'pageview'
    order by e.session_id, e.created_at
  ),
  -- 統合した行（device・path で絞り込み）
  allrows as (
    select l.kind, l.clicked_at, l.done_at, l.path, l.place, l.source_name, l.session_id, l.converted, l.is_new, l.name,
           coalesce(s.device, l.ua_device) as device, s.entry_path, s.channel, s.started, null::text as method
    from line_rows l left join sess s on s.session_id = l.session_id
    union all
    select 'myfitpeak', null, g.created_at, g.path, g.place, null, g.session_id, true, true, g.name,
           s.device, s.entry_path, s.channel, s.started, g.method
    from ms g left join sess s on s.session_id = g.session_id
  ),
  f as (
    select * from allrows
    where (p_device = 'all' or device = p_device or (p_device = 'mobile' and device = 'tablet'))
      and (p_path is null or path = p_path)
  ),
  mcf as (
    select * from mc
    where (p_device = 'all' or device = p_device or (p_device = 'mobile' and device = 'tablet'))
      and (p_path is null or path = p_path)
  ),
  regs as (select * from f where converted and is_new),
  pv as (
    select e.path, count(*) as pageviews, count(distinct e.session_id) as sessions, max(e.title) as title
    from site_events e
    where e.site = p_site and e.event_type = 'pageview' and e.created_at >= p_from and e.created_at < p_to
      and (p_device = 'all' or e.device = p_device or (p_device = 'mobile' and e.device = 'tablet'))
      and (p_path is null or e.path = p_path)
    group by e.path
  ),
  titles as (
    select distinct on (e.path) e.path, e.title from site_events e
    where e.site = p_site and e.event_type = 'pageview' and e.created_at >= p_from - interval '30 days' and e.created_at < p_to
      and e.path in (select path from f union select path from mcf)
    order by e.path, e.created_at desc
  ),
  pages as (
    select p.path,
      coalesce(t.title, pv.title) as title,
      coalesce(pv.pageviews, 0) as pageviews,
      coalesce(pv.sessions, 0) as sessions,
      count(*) filter (where f.kind = 'line') as line_clicks,
      count(*) filter (where f.kind = 'line' and f.converted and f.is_new) as line_signups,
      count(*) filter (where f.kind = 'line' and f.converted and not f.is_new) as line_existing,
      (select count(*) from mcf where mcf.path = p.path) as myfp_clicks,
      count(*) filter (where f.kind = 'myfitpeak') as myfp_signups
    from (select path from f union select path from mcf) p
    left join f on f.path = p.path
    left join pv on pv.path = p.path
    left join titles t on t.path = p.path
    group by p.path, t.title, pv.title, pv.pageviews, pv.sessions
  )
  select jsonb_build_object(
    'granularity', v_gran,
    'kpis', jsonb_build_object(
      'sessions', (select count(distinct e.session_id) from site_events e
                    where e.site = p_site and e.event_type = 'pageview' and e.created_at >= p_from and e.created_at < p_to
                      and (p_device = 'all' or e.device = p_device or (p_device = 'mobile' and e.device = 'tablet'))
                      and (p_path is null or e.path = p_path)),
      'line_clicks', (select count(*) from f where kind = 'line'),
      'line_signups', (select count(*) from f where kind = 'line' and converted and is_new),
      'line_existing', (select count(*) from f where kind = 'line' and converted and not is_new),
      'myfp_clicks', (select count(*) from mcf),
      'myfp_signups', (select count(*) from f where kind = 'myfitpeak'),
      'ad_line_clicks', (select count(*) from lc_all where is_ad),
      'ad_line_signups', (select count(*) from lc_all a left join friends fr on fr.id = a.friend_id
                           where a.is_ad and a.converted_at is not null
                             and (fr.followed_at is null or fr.followed_at >= a.created_at - interval '10 minutes')),
      'include_ads', p_include_ads
    ),
    'timeseries', coalesce((
      select jsonb_agg(jsonb_build_object('t', t, 'line', line, 'myfp', myfp) order by t) from (
        select gs as t,
          (select count(*) from regs r where r.kind = 'line' and date_trunc(v_gran, r.done_at at time zone 'Asia/Tokyo') = gs) as line,
          (select count(*) from regs r where r.kind = 'myfitpeak' and date_trunc(v_gran, r.done_at at time zone 'Asia/Tokyo') = gs) as myfp
        from generate_series(date_trunc(v_gran, p_from at time zone 'Asia/Tokyo'),
                             date_trunc(v_gran, (p_to - interval '1 second') at time zone 'Asia/Tokyo'),
                             ('1 ' || v_gran)::interval) gs
      ) x), '[]'::jsonb),
    'pages', coalesce((select jsonb_agg(to_jsonb(p) order by (p.line_signups + p.myfp_signups) desc, (p.line_clicks + p.myfp_clicks) desc, p.pageviews desc) from pages p), '[]'::jsonb),
    'places', coalesce((
      select jsonb_agg(jsonb_build_object('kind', kind, 'name', place, 'clicks', clicks, 'signups', signups) order by signups desc, clicks desc) from (
        select 'line' as kind, place, count(*) as clicks, count(*) filter (where converted and is_new) as signups from f where kind = 'line' group by place
        union all
        select 'myfitpeak', m.place, count(*), (select count(*) from f where f.kind = 'myfitpeak' and f.place = m.place)
        from mcf m group by m.place
        union all
        select 'myfitpeak', g.place, 0, count(*) from f g
        where g.kind = 'myfitpeak' and not exists (select 1 from mcf m where m.place = g.place) group by g.place
      ) y), '[]'::jsonb),
    'channels', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'line', line, 'myfp', myfp, 'count', line + myfp) order by line + myfp desc) from (
        select coalesce(channel, '不明（訪問と未連携）') as name,
               count(*) filter (where kind = 'line') as line, count(*) filter (where kind = 'myfitpeak') as myfp
        from regs group by 1) z), '[]'::jsonb),
    'entry_pages', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'count', n) order by n desc) from (
        select coalesce(entry_path, '不明（訪問と未連携）') as name, count(*) as n from regs group by 1) z), '[]'::jsonb),
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'count', n) order by n desc) from (
        select coalesce(device, '不明') as name, count(*) as n from regs group by 1) z), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'clicks', clicks, 'signups', signups) order by signups desc, clicks desc) from (
        select source_name as name, count(*) as clicks, count(*) filter (where converted and is_new) as signups
        from f where kind = 'line' group by source_name) z), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(r order by (r->>'at') desc) from (
        select jsonb_build_object(
          'at', f.done_at, 'kind', f.kind, 'is_new', f.is_new, 'name', f.name, 'method', f.method,
          'path', f.path, 'title', t.title, 'place', f.place, 'source', f.source_name,
          'entry_path', f.entry_path, 'channel', f.channel, 'device', f.device, 'session_id', f.session_id,
          'pages_before', (select count(*) from site_events e where e.session_id = f.session_id and e.event_type = 'pageview'
                            and e.created_at <= coalesce(f.clicked_at, f.done_at) + interval '5 seconds'),
          'sec_to_signup', case when f.started is not null
                             then greatest(0, extract(epoch from coalesce(f.clicked_at, f.done_at) - f.started))::int end
        ) as r
        from f left join titles t on t.path = f.path
        where f.converted
        order by f.done_at desc limit 100
      ) q), '[]'::jsonb)
  ) into v_res;
  return v_res;
end $$;

-- 登録した人のセッションの足どり（閲覧したページの順番）
create or replace function public.site_session_journey(p_session text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'at', e.created_at, 'type', e.event_type, 'path', e.path, 'title', e.title,
    'label', case when e.event_type in ('click', 'rageclick') then e.el_text end,
    'href', case when e.event_type in ('click', 'rageclick') then e.href end,
    'channel', e.channel, 'ref_host', e.ref_host
  ) order by e.created_at, e.id), '[]'::jsonb)
  from (
    select * from site_events
    where session_id = p_session and event_type in ('pageview', 'click', 'cart_add', 'checkout')
    order by created_at, id limit 300
  ) e;
$$;

revoke execute on function public.site_signups_report(text, timestamptz, timestamptz, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.site_session_journey(text) from public, anon, authenticated;
grant execute on function public.site_signups_report(text, timestamptz, timestamptz, text, text, boolean) to service_role;
grant execute on function public.site_session_journey(text) to service_role;

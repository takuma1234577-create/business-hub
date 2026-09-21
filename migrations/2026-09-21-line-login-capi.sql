-- LINE Login化 ＋ Meta Conversions API 連携
-- 2026-09-21
-- 目的: LPのCTA→LINE Login(bot_prompt=aggressive)→友だち追加をクリック単位で確定し、
--       実追加を Meta CAPI (CompleteRegistration) に送り返す。
-- 方針: 既存テーブルへの列追加のみ。既存の /track/:code・follow webhook はそのまま動く。

-- ── traffic_clicks: クリック1件に「誰が・どの広告から・追加したか」を持たせる ──
alter table traffic_clicks add column if not exists click_id uuid not null default gen_random_uuid();
alter table traffic_clicks add column if not exists fbclid text;
alter table traffic_clicks add column if not exists fbc text;
alter table traffic_clicks add column if not exists fbp text;
alter table traffic_clicks add column if not exists utm_source text;
alter table traffic_clicks add column if not exists utm_campaign text;
alter table traffic_clicks add column if not exists utm_content text;   -- 広告ID {{ad.id}}
alter table traffic_clicks add column if not exists utm_term text;      -- 広告セットID {{adset.id}} / 紹介者ID
alter table traffic_clicks add column if not exists landing_url text;
alter table traffic_clicks add column if not exists entry text not null default 'track'; -- 'track' | 'login'
alter table traffic_clicks add column if not exists line_user_id text;
alter table traffic_clicks add column if not exists friend_id uuid;
alter table traffic_clicks add column if not exists converted_at timestamptz;
alter table traffic_clicks add column if not exists capi_event_name text;
alter table traffic_clicks add column if not exists capi_sent_at timestamptz;
alter table traffic_clicks add column if not exists capi_status text;   -- 'ok' | エラー本文
alter table traffic_clicks add column if not exists capi_attempts int not null default 0;

create unique index if not exists traffic_clicks_click_id_uniq on traffic_clicks (click_id);
create index if not exists traffic_clicks_utm_content_idx on traffic_clicks (utm_content, created_at);
create index if not exists traffic_clicks_converted_idx on traffic_clicks (converted_at) where converted_at is not null;
create index if not exists traffic_clicks_capi_retry_idx on traffic_clicks (converted_at)
  where converted_at is not null and capi_sent_at is null;

-- ── friends: 最初に確定したクリック（経路・広告の根拠） ──
alter table friends add column if not exists first_click_id uuid;
create index if not exists friends_first_click_idx on friends (first_click_id) where first_click_id is not null;

-- ── 広告費の手入力（v1）。v2でMeta Marketing APIから日次同期する予定 ──
create table if not exists ad_spend (
  id uuid primary key default gen_random_uuid(),
  ad_id text not null,
  ad_name text,
  spend_date date not null,
  spend numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ad_id, spend_date)
);
alter table ad_spend enable row level security;

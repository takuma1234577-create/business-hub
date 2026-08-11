-- ============================================================
-- eBay 無在庫輸出 管理ツール（アカウント japan_hikari_store）
--
-- 目的: 無在庫販売の最大リスク「売れたのに仕入先の在庫が無い／値上がりしていた」を
--       10分ごとの巡回で潰す。仕入先在庫が消えたら即座に出品を取り下げる。
--
-- 構成:
--   ebay_settings          設定（利益下限・自動取り下げ・為替/送料定数）
--   ebay_listings          出品中アイテム台帳
--   ebay_listing_sources   1出品に紐づく仕入先（ヤフオク/メルカリ/駿河屋/キタムラ）
--   ebay_stock_checks      巡回ログ（在庫・最安値・利益率・取った行動）
--   ebay_orders            売れた商品と仕入・発送の進捗
--   ebay_profit_watch      利益が出る商品リスト（候補の相場をリアルタイム監視）
-- ============================================================

-- ── 設定（シングルトン: id = 'default'）────────────────────
create table if not exists ebay_settings (
  id                    text primary key default 'default',
  enabled               boolean not null default true,   -- cron巡回のON/OFF
  auto_end_listing      boolean not null default true,   -- 在庫消失時にeBay出品を自動取り下げるか
  -- ↑ 無在庫では「取り下げない」ほうが危険（売れたのに送れない＝指標崩壊）のため既定ON
  margin_floor_pct      numeric not null default 5.0,    -- この利益率を下回ったら取り下げ推奨
  price_jump_pct        numeric not null default 25.0,   -- 仕入値がこの%上昇したら警告
  check_interval_min    int not null default 10,         -- 巡回間隔（分）
  max_checks_per_run    int not null default 40,         -- 1回のcronで巡回する出品数の上限

  -- 利益計算の定数（references/profit-rules.md と一致させる）
  usd_jpy               numeric not null default 157.9,
  fx_safety             numeric not null default 0.97,
  variable_fee_pct      numeric not null default 6.35,   -- 海外決済1.35+通貨換算3.0+Payoneer2.0
  fixed_fee_usd         numeric not null default 0.40,
  duty_us_pct           numeric not null default 15.0,   -- 米国向けDDP関税（DDUに変える場合は0）
  ship_dom_jpy          int not null default 800,
  pack_jpy              int not null default 500,
  ship_tier1_jpy        int not null default 2800,       -- 〜1kg
  ship_tier2_jpy        int not null default 4500,       -- 1〜2kg
  ship_tier3_jpy        int not null default 6000,       -- 2〜3kg
  ship_tier4_jpy        int not null default 7500,       -- 3kg超

  notify_slack          boolean not null default true,
  last_run_at           timestamptz,
  updated_at            timestamptz default now()
);
alter table ebay_settings enable row level security;
create policy "service_role_all" on ebay_settings using (true);
insert into ebay_settings (id) values ('default') on conflict (id) do nothing;

-- ── 出品中アイテム台帳 ──────────────────────────────────
create table if not exists ebay_listings (
  id               uuid primary key default gen_random_uuid(),
  ebay_item_id     text unique,                 -- eBayのItemID（未出品の下書きはnull）
  sku              text,                        -- CustomLabel と一致させる
  kataban          text not null,               -- 型番（日本語）
  title_en         text not null,
  category         text not null default 'その他',  -- 利益計算のFVF区分
  ebay_category_id text,
  price_usd        numeric not null,
  weight_kg        numeric not null default 0.5,
  cost_basis_jpy   int,                         -- 出品時に想定した仕入値
  status           text not null default 'draft',
  -- 'draft' | 'active' | 'paused' | 'end_recommended' | 'ended'
  last_margin_pct  numeric,
  last_min_price_jpy int,
  last_checked_at  timestamptz,
  alert            text,                        -- 直近のアラート内容
  note             text,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);
alter table ebay_listings enable row level security;
create policy "service_role_all" on ebay_listings using (true);
create index if not exists idx_ebay_listings_status on ebay_listings(status);
create index if not exists idx_ebay_listings_checked on ebay_listings(last_checked_at);

-- ── 仕入先（1出品に複数）────────────────────────────────
create table if not exists ebay_listing_sources (
  id             uuid primary key default gen_random_uuid(),
  listing_id     uuid not null references ebay_listings(id) on delete cascade,
  source         text not null,                 -- 'yahoo' | 'mercari' | 'suruga' | 'kitamura'
  search_keyword text not null,                 -- 巡回に使う検索語（型番で厳密に）
  exclude_words  text,                          -- 除外語（カンマ区切り: ジャンク,部品取,箱のみ 等）
  url            text,                          -- 特定商品を指定する場合の直リンク
  last_price_jpy int,
  last_count     int,                           -- ヒット件数（供給の厚さの実測値）
  last_available boolean not null default true,
  last_checked_at timestamptz,
  enabled        boolean not null default true,
  created_at     timestamptz default now()
);
alter table ebay_listing_sources enable row level security;
create policy "service_role_all" on ebay_listing_sources using (true);
create index if not exists idx_ebay_sources_listing on ebay_listing_sources(listing_id);

-- ── 巡回ログ ────────────────────────────────────────────
create table if not exists ebay_stock_checks (
  id            uuid primary key default gen_random_uuid(),
  listing_id    uuid not null references ebay_listings(id) on delete cascade,
  checked_at    timestamptz default now(),
  available     boolean not null,
  min_price_jpy int,
  source_used   text,
  total_count   int,
  margin_pct    numeric,
  profit_jpy    int,
  action        text not null,   -- 'ok' | 'warn_price' | 'end_recommended' | 'ended' | 'error'
  reason        text
);
alter table ebay_stock_checks enable row level security;
create policy "service_role_all" on ebay_stock_checks using (true);
create index if not exists idx_ebay_checks_listing on ebay_stock_checks(listing_id, checked_at desc);

-- ── 売れた商品 ──────────────────────────────────────────
create table if not exists ebay_orders (
  id                 uuid primary key default gen_random_uuid(),
  ebay_order_id      text unique,
  listing_id         uuid references ebay_listings(id) on delete set null,
  sku                text,
  kataban            text,
  title_en           text,
  sold_price_usd     numeric,
  sold_at            timestamptz,
  buyer_country      text,
  ship_by            date,                       -- 発送期限（受注+5営業日）
  procurement_status text not null default 'pending',
  -- 'pending'（未仕入） | 'ordered'（仕入先に発注済） | 'received'（倉庫着） | 'shipped'（発送済） | 'cancelled'
  procurement_cost_jpy int,
  procurement_url    text,
  tracking_no        text,
  actual_profit_jpy  int,
  note               text,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);
alter table ebay_orders enable row level security;
create policy "service_role_all" on ebay_orders using (true);
create index if not exists idx_ebay_orders_status on ebay_orders(procurement_status);

-- ── 利益が出る商品リスト（候補の相場をリアルタイム監視）──
create table if not exists ebay_profit_watch (
  id                uuid primary key default gen_random_uuid(),
  kataban           text not null,
  keyword_ja        text not null,              -- 国内仕入先の検索語
  keyword_en        text not null,              -- eBay Sold相場の検索語
  exclude_words     text,
  category          text not null default 'その他',
  weight_kg         numeric not null default 0.5,

  -- eBay側（日本発送のSold相場。手動更新 or 週次）
  ebay_sold_median_jpy int,
  ebay_sold_count      int,
  ebay_updated_at      timestamptz,

  -- 国内側（10分ごとに更新）
  best_source       text,
  best_price_jpy    int,
  yahoo_price_jpy   int,
  mercari_price_jpy int,
  suruga_price_jpy  int,
  supply_count      int,

  -- 判定
  profit_jpy        int,
  margin_pct        numeric,
  verdict           text,                        -- '◎' | '○' | '△' | '✕' | '未取得'
  enabled           boolean not null default true,
  last_checked_at   timestamptz,
  note              text,
  created_at        timestamptz default now()
);
alter table ebay_profit_watch enable row level security;
create policy "service_role_all" on ebay_profit_watch using (true);
create index if not exists idx_ebay_watch_verdict on ebay_profit_watch(verdict);

-- ── 追加（同日、動作検証を経て判明した必須項目）──────────

-- 必須キーワード。これが無いと「スーパーファミコン本体」の検索で
-- コントローラー単体(¥550)を最安値として拾い、誤った利益判定を出す。
alter table ebay_listing_sources add column if not exists include_words text;
alter table ebay_profit_watch  add column if not exists include_words text;

-- 最安値（今すぐ受注をさばけるか）と中央値（継続的に仕入れ続けられるか）を分けて持つ。
-- 最安値だけで判定すると、たまたま出ている1点の安値で◎が付き、
-- 2個目以降を仕入れられない型番を大量に出品してしまう。
alter table ebay_profit_watch add column if not exists median_price_jpy   int;
alter table ebay_profit_watch add column if not exists profit_median_jpy  int;
alter table ebay_profit_watch add column if not exists margin_median_pct  numeric;

-- 「読めなかった」と「在庫が無い」を画面上でも区別する。
-- 両者を同じ表示にすると、取得失敗を在庫切れと誤読して不要な取り下げ判断をしてしまう。
alter table ebay_listing_sources add column if not exists last_error text;

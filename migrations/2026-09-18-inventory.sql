-- FITPEAK 商品在庫管理（Amazon在庫 × たお太郎パイプライン × 資材）
-- 2026-09-18
-- 方針は 2026-09-02-subscription.sql と同じ（RLS有効・ポリシー無し = service role 専用）

-- ── 管理対象バリエーション（商品×色×サイズ＝子ASIN） ──
create table if not exists inventory_products (
  id            uuid primary key default gen_random_uuid(),
  product       text not null,            -- リストラップ / パワーグリップ / ナイロンベルト / ニースリーブ / エルボースリーブ
  color         text not null default '',
  size          text not null default '',
  asin          text,                     -- 子ASIN
  seller_sku    text,
  sort_order    int  not null default 0,
  discontinued  boolean not null default false,  -- 廃止（売り切りのみ・再発注しない）
  active        boolean not null default true,   -- 管理対象（falseは自動登録された未整理SKU等）
  note          text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  unique (product, color, size)
);
create unique index if not exists inventory_products_asin_uniq on inventory_products (asin) where asin is not null;
alter table inventory_products enable row level security;

-- ── Amazon FBA 在庫スナップショット（SP-API fba/inventory から取得） ──
create table if not exists inventory_amazon_snapshots (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references inventory_products(id) on delete cascade,
  fulfillable   int not null default 0,   -- 販売可能
  inbound       int not null default 0,   -- 入庫予定（作業中＋輸送中＋受領中）
  reserved      int not null default 0,
  fetched_at    timestamptz not null default now()
);
create index if not exists idx_inv_snap_product_fetched on inventory_amazon_snapshots (product_id, fetched_at desc);
alter table inventory_amazon_snapshots enable row level security;

-- ── 販売数（SP-API 売上・トラフィックレポート：子ASIN別・期間合計） ──
create table if not exists inventory_sales_windows (
  id            uuid primary key default gen_random_uuid(),
  asin          text not null,
  window_days   int  not null,            -- 30 / 90
  period_start  date not null,
  period_end    date not null,
  units         int  not null default 0,
  sales_amount  numeric,
  fetched_at    timestamptz not null default now(),
  unique (asin, window_days)
);
alter table inventory_sales_windows enable row level security;

-- ── レポート取得ジョブ（createReport → 完了待ち → 取り込み） ──
create table if not exists inventory_report_jobs (
  id            uuid primary key default gen_random_uuid(),
  report_id     text,
  window_days   int  not null,
  period_start  date not null,
  period_end    date not null,
  status        text not null default 'requested',  -- requested / done / failed
  error         text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
alter table inventory_report_jobs enable row level security;

-- ── 在庫フロー（ロット台帳・たお太郎が更新） ──
--   status: ordered(発注中・生産中) / inspecting(検品・梱包中) / ready(準備完了在庫) / shipping(輸送中) / received(Amazon納品済み) / cancelled
create table if not exists inventory_lots (
  id                uuid primary key default gen_random_uuid(),
  lot_code          text,
  product_id        uuid not null references inventory_products(id) on delete restrict,
  qty               int  not null,
  status            text not null default 'ordered',
  ordered_at        date,
  status_updated_at timestamptz default now(),
  updated_by        text,
  tracking          text,
  note              text,
  created_at        timestamptz default now()
);
create index if not exists idx_inv_lots_product_status on inventory_lots (product_id, status);
alter table inventory_lots enable row level security;

-- ── 資材在庫（たお太郎が数量を更新） ──
create table if not exists inventory_materials (
  id            uuid primary key default gen_random_uuid(),
  product       text not null,            -- 商品名 or '共通'
  name          text not null,
  unit          text not null default '枚',
  per_unit      numeric not null default 1,
  quantity      int,                      -- null = 未入力
  updated_at    timestamptz,
  updated_by    text,
  note          text,
  sort_order    int not null default 0,
  created_at    timestamptz default now()
);
alter table inventory_materials enable row level security;

create table if not exists inventory_material_logs (
  id            uuid primary key default gen_random_uuid(),
  material_id   uuid not null references inventory_materials(id) on delete cascade,
  delta         int  not null,
  reason        text,
  created_by    text,
  created_at    timestamptz default now()
);
alter table inventory_material_logs enable row level security;

-- ── 設定（1行） ──
create table if not exists inventory_settings (
  id                    int primary key default 1,
  lead_time_days        int not null default 60,
  safety_days           int not null default 30,
  coverage_days         int not null default 90,
  prepare_days          int not null default 30,
  lot_size              int not null default 50,
  min_qty               int not null default 100,
  material_buffer_units int not null default 200,
  color_standard_lots   jsonb not null default '{"リストラップ|ブラック": 1000}'::jsonb,
  partner_key           text,             -- たお太郎用 専用リンクのキー
  partner_name          text default 'たお太郎',
  chatwork_room_id      text,
  chatwork_template     text,
  last_inventory_sync   timestamptz,
  last_sales_sync_date  date,
  updated_at            timestamptz default now()
);
alter table inventory_settings enable row level security;
insert into inventory_settings (id, partner_key, chatwork_template) values (
  1,
  encode(gen_random_bytes(16), 'hex'),
  E'お世話になっております。FITPEAKの資材在庫の確認をお願いします。現在の残数を教えてください。\n・リストラップ 化粧箱／説明書\n・パワーグリップ 化粧箱／説明書\n・ナイロンベルト 化粧箱／説明書\n・ニースリーブ／エルボースリーブ 化粧箱／説明書\n・メッセージカード／スクラッチカード\n\n専用ページからも更新できます。'
) on conflict (id) do nothing;

-- ── 初期データ：バリエーション（2026-09-18 時点） ──
insert into inventory_products (product, color, size, asin, sort_order, discontinued) values
  ('リストラップ','ブラック','60cm','B0DR9QSZFW',10,false),
  ('リストラップ','ブラック','90cm','B0DR9SS57D',11,false),
  ('リストラップ','グリーン','60cm','B0DR9SF1FP',12,false),
  ('リストラップ','グリーン','90cm','B0DR9R87W9',13,false),
  ('リストラップ','イエロー','60cm','B0DR9SJM7J',14,false),
  ('リストラップ','イエロー','90cm','B0DR9QL3CS',15,false),
  ('リストラップ','ピンク','60cm','B0DR9SP1KZ',16,true),
  ('パワーグリップ','ブラック','','B0FSK4CPJP',20,false),
  ('パワーグリップ','レッド','','B0FSK5L31Q',21,false),
  ('パワーグリップ','イエロー','','B0FSK5SLN4',22,false),
  ('パワーグリップ','ピンク','','B0FSK2KMRJ',23,false),
  ('パワーグリップ','グレー','','B0FSK6ZYW4',24,false),
  ('パワーグリップ','ブルー','','B0FSJY8Y6D',25,false),
  ('パワーグリップ','レッド','L','B0FSK479BZ',30,true),
  ('パワーグリップ','レッド','S','B0FSJY3RS7',31,true),
  ('パワーグリップ','イエロー','S','B0FSK8GMQ8',32,true),
  ('パワーグリップ','イエロー','L','B0FSK273CL',33,true),
  ('パワーグリップ','ピンク','L','B0FSK6QYRB',34,true),
  ('パワーグリップ','ピンク','S','B0FSK21QHJ',35,true),
  ('パワーグリップ','ブルー','S','B0FSK5B1VN',36,true),
  ('パワーグリップ','ブルー','L','B0FSK28R9W',37,true),
  ('パワーグリップ','ブラック','S','B0FSK6DQ9T',38,true),
  ('パワーグリップ','ブラック','L','B0FSK4ZRKX',39,true),
  ('パワーグリップ','グレー','L','B0FSK6NHVH',40,true),
  ('ナイロンベルト','ブラック','XS',null,50,false),
  ('ナイロンベルト','ブラック','S','B0GWYVZ6QG',51,true),
  ('ナイロンベルト','ブラック','M','B0GWYDKGDY',52,false),
  ('ナイロンベルト','ブラック','L','B0GWXZYPMK',53,false),
  ('ニースリーブ','ブラック','S','B0HCT6T64G',60,true),
  ('ニースリーブ','ブラック','M','B0HCSYM6Z5',61,false),
  ('ニースリーブ','ブラック','L','B0DM6Z58HF',62,false),
  ('ニースリーブ','ブラック','2L','B0DM6W25LK',63,false),
  ('ニースリーブ','ブラック','3L','B0HCHJBYNS',64,false),
  ('ニースリーブ','ブラック','4L','B0HCSVFP8Z',65,false),
  ('エルボースリーブ','ブラック','S','B0DT4SRH79',70,true),
  ('エルボースリーブ','ブラック','M','B0HCFY19GY',71,false),
  ('エルボースリーブ','ブラック','L','B0HCT3BY1Y',72,false),
  ('エルボースリーブ','ブラック','2L','B0HCTJKWYB',73,false),
  ('エルボースリーブ','ブラック','不明（要確認）','B0HCFTGJMB',74,false)
on conflict (product, color, size) do nothing;

-- ── 初期データ：資材 ──
insert into inventory_materials (product, name, unit, per_unit, sort_order) values
  ('リストラップ','パッケージ（化粧箱）','枚',1,1),
  ('リストラップ','説明書・取扱説明カード','枚',1,2),
  ('パワーグリップ','パッケージ（化粧箱）','枚',1,3),
  ('パワーグリップ','説明書・取扱説明カード','枚',1,4),
  ('ナイロンベルト','パッケージ（化粧箱）','枚',1,5),
  ('ナイロンベルト','説明書・取扱説明カード','枚',1,6),
  ('ニースリーブ','パッケージ（化粧箱／OPP袋）','枚',1,7),
  ('ニースリーブ','説明書・取扱説明カード','枚',1,8),
  ('エルボースリーブ','パッケージ（化粧箱／OPP袋）','枚',1,9),
  ('エルボースリーブ','説明書・取扱説明カード','枚',1,10),
  ('共通','メッセージカード','枚',1,11),
  ('共通','スクラッチカード','枚',1,12);

-- ── ポリシー（既存テーブルと同じ方針：許可ポリシー） ──
create policy "service_role_all" on inventory_products using (true) with check (true);
create policy "service_role_all" on inventory_amazon_snapshots using (true) with check (true);
create policy "service_role_all" on inventory_sales_windows using (true) with check (true);
create policy "service_role_all" on inventory_report_jobs using (true) with check (true);
create policy "service_role_all" on inventory_lots using (true) with check (true);
create policy "service_role_all" on inventory_materials using (true) with check (true);
create policy "service_role_all" on inventory_material_logs using (true) with check (true);
create policy "service_role_all" on inventory_settings using (true) with check (true);

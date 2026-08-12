-- 仕入先の商品ページから取り込んだ情報を残す。
--
-- 目的は「後から確認できること」。出品したあとに
--   ・どの出品から取り込んだのか
--   ・そのとき何円で、どういう状態区分だったのか
--   ・どのジャンルに置かれていたのか
-- を辿れないと、価格が動いたときの判断ができない。
--
-- 画像は URL だけを持つ。ダウンロードして保存はしない。
-- 参照用途にはリンクで足りるうえ、出品が終わればリンクが切れるので
-- 「その個体はもう無い」ことがそのまま分かる。
create table if not exists ebay_imports (
  id             uuid primary key default gen_random_uuid(),
  listing_id     uuid references ebay_listings(id) on delete set null,  -- 出品化したら紐付ける
  source         text not null,                 -- 'yahoo' 等
  source_url     text not null,
  source_item_id text,

  -- 仕入先ページから取った事実
  title_ja       text not null,
  description_ja text,
  genre          text,                          -- パンくず（例: 家電、AV、カメラ > レンズ > ...）
  breadcrumb     jsonb,
  price_jpy      int,
  condition_ja   text,                          -- ヤフオクの定型区分
  available      boolean,
  image_urls     jsonb,                         -- URLのみ。画像本体は保存しない

  -- 生成した出品案
  title_en       text,
  description_html text,
  item_specifics jsonb,
  condition_id   int,
  specs          jsonb,                         -- brand / focal / aperture / mount など抽出結果

  bundle_suspect boolean not null default false, -- ボディ＋レンズのセット疑い
  warnings       jsonb,

  fetched_at     timestamptz default now(),
  created_at     timestamptz default now()
);
alter table ebay_imports enable row level security;
create policy "service_role_all" on ebay_imports using (true);
create index if not exists idx_ebay_imports_created on ebay_imports(created_at desc);
create unique index if not exists idx_ebay_imports_url on ebay_imports(source_url);

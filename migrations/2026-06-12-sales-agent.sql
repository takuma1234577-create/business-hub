-- ============================================================
-- 営業（セールス）エージェント
-- 既存のLINE友だち一人ひとりを分析し、「次の一手」提案を生成。
-- 人がワンタップ承認→送信する安全設計（自動送信は既定オフ）。
-- ============================================================

-- 設定（シングルトン: id = 'default'）
create table if not exists sales_agent_settings (
  id                text primary key default 'default',
  enabled           boolean not null default false,        -- cronでの提案生成ON/OFF
  mode              text not null default 'proposal',       -- 'proposal'（承認制） | 'auto'（自動送信）
  cooldown_days     int not null default 7,                 -- 同一友だちへの再アプローチ間隔
  daily_limit       int not null default 20,                -- 1回の生成で作る提案の上限
  max_coupon_amount int not null default 1000,              -- クーポン発行額の上限（円）
  amazon_url        text default 'https://www.amazon.co.jp/stores/page/FITPEAK',
  shopify_url       text default 'https://fitpeak.co',
  extra_instructions text,                                  -- 営業方針の追加指示（AIプロンプトに注入）
  updated_at        timestamptz default now()
);
alter table sales_agent_settings enable row level security;
create policy "service_role_all" on sales_agent_settings using (true);

insert into sales_agent_settings (id) values ('default') on conflict (id) do nothing;

-- 提案キュー
create table if not exists sales_agent_proposals (
  id                  uuid primary key default gen_random_uuid(),
  friend_id           uuid not null references friends(id) on delete cascade,
  line_user_id        text not null,
  display_name        text,
  segment             text,                 -- 例: '新規未購入' / 'リピーター' / '離脱気味'
  objective           text,                 -- 例: '初回購入促進' / 'リピート促進' / '再活性化'
  recommended_product text,
  message             text not null,        -- お客様に送る本文（リンク・クーポンは送信時に付加）
  link_type           text default 'none',  -- 'amazon' | 'shopify' | 'my_fitpeak' | 'none'
  link_url            text,                 -- 静的リンクは生成時に解決。my_fitpeakは送信時に発行
  coupon_amount       int not null default 0,
  coupon_code         text,                 -- 送信時に発行したクーポンコード
  confidence          numeric,              -- 0.0〜1.0
  reasoning           text,                 -- AIの判断根拠（社内用）
  status              text not null default 'pending', -- 'pending' | 'sent' | 'skipped' | 'rejected' | 'failed'
  error               text,
  created_at          timestamptz default now(),
  sent_at             timestamptz
);
alter table sales_agent_proposals enable row level security;
create policy "service_role_all" on sales_agent_proposals using (true);
create index if not exists idx_sap_status on sales_agent_proposals(status);
create index if not exists idx_sap_friend on sales_agent_proposals(friend_id);
create index if not exists idx_sap_sent_at on sales_agent_proposals(sent_at);

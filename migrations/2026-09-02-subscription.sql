-- 定期購入（サブスクリプション）基盤
-- 設計書 v1 / 2026-09-02
-- 方針: 新規テーブルはすべて RLS 有効・ポリシー無し = service role からのみ操作する。
--       business-hub は既定で anon キー接続のため、server/subscription.cjs だけ
--       SUPABASE_SERVICE_ROLE_KEY のクライアントを使うこと。

-- ── 更新日時トリガ ──
create or replace function set_subscription_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ── 解約理由マスタ ──
create table if not exists cancel_reasons (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ── 定期プラン（Shopify Selling Plan との対応表） ──
create table if not exists subscription_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  shopify_selling_plan_group_id text,
  shopify_selling_plan_id text,
  shopify_product_id text,
  shopify_variant_id text,
  interval_days int not null default 28,
  lead_days int not null default 3,
  delivery_fallback_days int not null default 2,
  discount_percent numeric not null default 10,
  max_consecutive_skips int not null default 4,
  is_preorder boolean not null default false,
  preorder_first_ship_date date,
  preorder_note text,
  preorder_close_date date,
  display_name text,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists subscription_plans_selling_plan_uniq
  on subscription_plans (shopify_selling_plan_id) where shopify_selling_plan_id is not null;
drop trigger if exists subscription_plans_set_updated_at on subscription_plans;
create trigger subscription_plans_set_updated_at
  before update on subscription_plans
  for each row execute function set_subscription_updated_at();

-- ── 契約（Shopify Subscription Contract と 1:1） ──
create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  shopify_contract_id text not null unique,
  plan_id uuid references subscription_plans(id) on delete set null,
  shopify_customer_id text,
  email text not null,
  line_user_id text,
  status text not null default 'pending_first_shipment',
  cycle_count int not null default 0,
  first_order_id text,
  first_delivered_at timestamptz,
  last_delivered_at timestamptz,
  last_shipped_at timestamptz,
  next_billing_at timestamptz,
  next_delivery_at timestamptz,
  consecutive_skips int not null default 0,
  total_skips int not null default 0,
  paused_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason_id uuid references cancel_reasons(id) on delete set null,
  cancel_note text,
  origin text not null default 'regular',
  amount numeric,
  currency text not null default 'JPY',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_status_check check (status in (
    'pending_first_shipment','awaiting_delivery','active','past_due','paused','cancelled'
  )),
  constraint subscriptions_origin_check check (origin in ('preorder','regular'))
);
create index if not exists subscriptions_status_idx on subscriptions (status);
create index if not exists subscriptions_email_idx on subscriptions (lower(email));
create index if not exists subscriptions_line_user_idx on subscriptions (line_user_id);
-- 課金cronの主クエリ: 課金予定を拾う
create index if not exists subscriptions_due_idx
  on subscriptions (next_billing_at) where status in ('active','past_due');
drop trigger if exists subscriptions_set_updated_at on subscriptions;
create trigger subscriptions_set_updated_at
  before update on subscriptions
  for each row execute function set_subscription_updated_at();

-- ── 課金サイクル（1回の課金 = 1行） ──
create table if not exists subscription_cycles (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references subscriptions(id) on delete cascade,
  cycle_no int not null,
  scheduled_at timestamptz not null,
  billing_attempt_id text,
  shopify_order_id text,
  amount numeric,
  status text not null default 'scheduled',
  billed_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  delivered_source text,
  failure_reason text,
  retry_count int not null default 0,
  next_retry_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscription_cycles_status_check check (status in (
    'scheduled','billed','failed','retrying','shipped','delivered','skipped','cancelled'
  )),
  constraint subscription_cycles_no_uniq unique (subscription_id, cycle_no)
);
create index if not exists subscription_cycles_sub_idx on subscription_cycles (subscription_id, cycle_no);
create index if not exists subscription_cycles_order_idx on subscription_cycles (shopify_order_id);
create index if not exists subscription_cycles_attempt_idx on subscription_cycles (billing_attempt_id);
drop trigger if exists subscription_cycles_set_updated_at on subscription_cycles;
create trigger subscription_cycles_set_updated_at
  before update on subscription_cycles
  for each row execute function set_subscription_updated_at();

-- ── 監査ログ（顧客操作・webhook・cron の全記録） ──
-- idempotency_key に X-Shopify-Webhook-Id を入れて重複配信を弾く
create table if not exists subscription_events (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid references subscriptions(id) on delete cascade,
  event_type text not null,
  actor text not null default 'system',
  payload jsonb,
  idempotency_key text unique,
  created_at timestamptz not null default now(),
  constraint subscription_events_actor_check check (actor in ('customer','admin','system','shopify'))
);
create index if not exists subscription_events_sub_idx on subscription_events (subscription_id, created_at desc);
create index if not exists subscription_events_type_idx on subscription_events (event_type, created_at desc);

-- ── 全体設定（key/value。項目追加でマイグレーション不要） ──
create table if not exists subscription_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now(),
  updated_by text
);
drop trigger if exists subscription_settings_set_updated_at on subscription_settings;
create trigger subscription_settings_set_updated_at
  before update on subscription_settings
  for each row execute function set_subscription_updated_at();

-- ── RLS: ポリシー無し = service role のみ ──
alter table cancel_reasons        enable row level security;
alter table subscription_plans    enable row level security;
alter table subscriptions         enable row level security;
alter table subscription_cycles   enable row level security;
alter table subscription_events   enable row level security;
alter table subscription_settings enable row level security;

-- ── 初期データ: 解約理由（設計書 12-2 の6項目） ──
insert into cancel_reasons (label, sort_order) values
  ('まだ余っている', 1),
  ('価格が高い', 2),
  ('味が合わなかった', 3),
  ('運動・外出の頻度が減った', 4),
  ('他の商品に変えた', 5),
  ('その他', 6)
on conflict do nothing;

-- ── 初期データ: 全体設定 ──
insert into subscription_settings (key, value, description) values
  ('billing',      '{"cron_enabled": false, "billing_hour_jst": 9, "retry_offsets_days": [3, 7], "max_retries": 2, "after_max_retries": "paused"}'::jsonb, '課金エンジン。cron_enabled=false の間は課金を実行しない'),
  ('delivery',     '{"delivery_fallback_days": 2, "delivered_wait_days": 5}'::jsonb, '配達完了イベントが来ない場合のフォールバック'),
  ('skip',         '{"enabled": true, "skip_days": 7, "cutoff_hours_before": 24}'::jsonb, 'スキップ設定'),
  ('notification', '{"pre_billing_reminder_days": 3, "email_enabled": true, "line_enabled": false}'::jsonb, '通知設定（第2フェーズで使用）'),
  ('cancel_flow',  '{"offer_skip_first": true, "retention_message": "1週間スキップして様子を見ることもできます。"}'::jsonb, '解約フローの引き止め')
on conflict (key) do nothing;

-- クレアショット定期購入（6プラン・休会・解約フロー・LINEリマインダー）
-- 2026-09-16
-- 方針は 2026-09-02-subscription.sql と同じ（RLS有効・ポリシー無し = service role 専用）

-- ── プランに「1日の本数」「1回のお届け袋数」「プランコード」を持たせる ──
alter table subscription_plans add column if not exists plan_code text;
alter table subscription_plans add column if not exists sticks_per_day int not null default 1;
alter table subscription_plans add column if not exists bags_per_cycle int not null default 1;
alter table subscription_plans add column if not exists sort_order int not null default 0;
alter table subscription_plans add column if not exists price numeric;
alter table subscription_plans add column if not exists shopify_variant_sku text;
create unique index if not exists subscription_plans_plan_code_uniq
  on subscription_plans (plan_code) where plan_code is not null;

-- ── 契約に休会情報を持たせる ──
alter table subscriptions add column if not exists paused_until timestamptz;
alter table subscriptions add column if not exists pause_reason text;
alter table subscriptions add column if not exists plan_changed_at timestamptz;

-- ── 解約理由ごとの引き止めアクション（ダッシュボードから変更可） ──
--   pause      : 休会（残量から次回お届け日を設定）を提案
--   cheaper    : 1袋あたりが安いプラン（3ヶ月/12ヶ月）を提案
--   downgrade  : 1日2本→1日1本 への変更を提案
--   none       : 提案しない
alter table cancel_reasons add column if not exists retention_action text not null default 'pause';
alter table cancel_reasons add column if not exists retention_message text;

update cancel_reasons set retention_action = 'pause',
  retention_message = '余っている分を飲み切るまで、次回のお届けを後ろにずらせます。残りの本数を入れるだけで、その日に合わせて次回お届け日が決まります。'
  where label = 'まだ余っている';
update cancel_reasons set retention_action = 'cheaper',
  retention_message = 'お届け周期を長くすると1袋あたりの価格が下がります。3ヶ月ごとなら1袋無料、12ヶ月ごとなら6袋無料になります。'
  where label = '価格が高い';
update cancel_reasons set retention_action = 'none',
  retention_message = null
  where label = '味が合わなかった';
update cancel_reasons set retention_action = 'pause',
  retention_message = '再開できる時期まで休会にしておくこともできます。休会中は課金されません。'
  where label = '運動・外出の頻度が減った';
update cancel_reasons set retention_action = 'none',
  retention_message = null
  where label = '他の商品に変えた';
update cancel_reasons set retention_action = 'pause',
  retention_message = 'すぐに解約せず、いったん休会にしておくこともできます。'
  where label = 'その他';

-- ── 毎日の「飲むタイミング」LINEリマインダー（顧客1人につき1件） ──
create table if not exists creashot_reminders (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  line_user_id text,
  enabled boolean not null default false,
  time_jst text not null default '19:00',      -- 'HH:MM'
  days_of_week int[] not null default '{1,2,3,4,5,6,7}',  -- ISO: 1=月 … 7=日
  message text,                                 -- 空なら既定文
  last_sent_date date,                          -- JST基準の最終送信日（同日重複防止）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists creashot_reminders_email_uniq on creashot_reminders (lower(email));
create index if not exists creashot_reminders_enabled_idx on creashot_reminders (enabled) where enabled;
alter table creashot_reminders enable row level security;
drop trigger if exists creashot_reminders_set_updated_at on creashot_reminders;
create trigger creashot_reminders_set_updated_at
  before update on creashot_reminders
  for each row execute function set_subscription_updated_at();

-- ── 「今日飲んだ」記録（残量の見積もり精度を上げる。任意） ──
create table if not exists creashot_intake_logs (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  taken_on date not null,
  sticks int not null default 1,
  source text not null default 'portal',        -- portal / line
  created_at timestamptz not null default now(),
  constraint creashot_intake_logs_uniq unique (email, taken_on)
);
alter table creashot_intake_logs enable row level security;

-- ── 購入後オンボーディングの進捗（LINE登録→My FITPEAK登録 をセットで追う） ──
create table if not exists creashot_onboarding (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid references subscriptions(id) on delete cascade,
  email text not null,
  shopify_order_id text,
  shopify_order_name text,
  line_linked_at timestamptz,
  myfitpeak_logged_in_at timestamptz,
  line_notified_at timestamptz,
  email_notified_at timestamptz,
  reminder_nudged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists creashot_onboarding_sub_uniq on creashot_onboarding (subscription_id);
alter table creashot_onboarding enable row level security;
drop trigger if exists creashot_onboarding_set_updated_at on creashot_onboarding;
create trigger creashot_onboarding_set_updated_at
  before update on creashot_onboarding
  for each row execute function set_subscription_updated_at();

-- ── 設定（key/value）にクレアショット用の既定値を追加 ──
insert into subscription_settings (key, value, description) values
  ('creashot', '{
    "product_id": "8556618743943",
    "lp_url": "https://fitpeak.co/products/持ち運びクレアチン-creashot",
    "line_add_url": "https://line.me/R/ti/p/@956iyppc",
    "preorder_note": "初回お届け：2026年12月上旬予定",
    "preorder_first_ship_date": "2026-12-05",
    "reminder_default_time": "19:00",
    "reminder_default_message": "今日のクレアショット、飲みましたか？ポケットの1本を、トレ前に。",
    "onboarding_email_enabled": true,
    "onboarding_line_enabled": true
  }'::jsonb, 'クレアショット定期購入の表示・導線設定')
on conflict (key) do nothing;

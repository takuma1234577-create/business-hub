-- ============================================================
-- Business Hub - Complete Supabase PostgreSQL Schema
-- Generated from reverse-engineering all server .cjs files
-- ============================================================

-- Enable required extensions
create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- ============================================================
-- AUTH MODULE
-- ============================================================

create table if not exists app_users (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  password_hash text not null,
  created_at  timestamptz default now()
);
alter table app_users enable row level security;
create policy "service_role_all" on app_users using (true);

create table if not exists app_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references app_users(id) on delete cascade,
  token        text not null unique,
  mfa_verified boolean not null default false,
  expires_at   timestamptz not null,
  created_at   timestamptz default now()
);
alter table app_sessions enable row level security;
create policy "service_role_all" on app_sessions using (true);
create index if not exists idx_app_sessions_user_id on app_sessions(user_id);
create index if not exists idx_app_sessions_token on app_sessions(token);

create table if not exists auth_2fa_codes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references app_users(id) on delete cascade,
  code       text not null,
  purpose    text not null,
  used       boolean not null default false,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);
alter table auth_2fa_codes enable row level security;
create policy "service_role_all" on auth_2fa_codes using (true);
create index if not exists idx_auth_2fa_codes_user_id on auth_2fa_codes(user_id);

-- ============================================================
-- SHARED / SETTINGS MODULE
-- ============================================================

-- OAuth tokens (id is text: 'gmail', 'drive', 'sheets', 'calendar', etc.)
create table if not exists oauth_tokens (
  id           text primary key,
  access_token  text,
  refresh_token text,
  scope        text,
  token_type   text,
  expiry_date  bigint,
  updated_at   timestamptz default now()
);
alter table oauth_tokens enable row level security;
create policy "service_role_all" on oauth_tokens using (true);

-- API keys (id is text: 'anthropic', 'google_maps', etc.)
-- api_key_encrypted stores AES-256-GCM JSON: { iv, data, tag }
create table if not exists api_keys (
  id                text primary key,
  api_key_encrypted text,
  label             text,
  is_active         boolean not null default true,
  updated_at        timestamptz default now(),
  created_at        timestamptz default now()
);
alter table api_keys enable row level security;
create policy "service_role_all" on api_keys using (true);

-- Channel stores (id is text, user-set; e.g. shopify store id)
create table if not exists channel_stores (
  id                      text primary key,
  channel                 text not null,   -- 'SHOPIFY', 'TIKTOK', etc.
  store_name              text,
  shop_domain             text,
  shop_id                 text,
  access_token            text,
  app_key                 text,
  app_secret              text,
  tiktok_access_token     text,
  tiktok_refresh_token    text,
  is_active               boolean not null default true,
  auto_fulfill            boolean not null default false,
  inventory_sync_enabled  boolean not null default false,
  last_synced_at          timestamptz,
  gmail_token_id          text,
  created_at              timestamptz default now()
);
alter table channel_stores enable row level security;
create policy "service_role_all" on channel_stores using (true);

-- Amazon SP-API accounts (for settings module)
create table if not exists amazon_sp_accounts (
  id            uuid primary key default gen_random_uuid(),
  account_name  text not null,
  seller_id     text,
  marketplace_id text,
  refresh_token text,
  client_id     text,
  client_secret text,
  endpoint      text,
  is_active     boolean not null default true,
  last_synced_at timestamptz,
  created_at    timestamptz default now()
);
alter table amazon_sp_accounts enable row level security;
create policy "service_role_all" on amazon_sp_accounts using (true);

-- ============================================================
-- INVOICE MODULE
-- ============================================================

create table if not exists clients (
  id            uuid primary key default gen_random_uuid(),
  company_name  text not null,
  contact_name  text,
  email         text,
  address       text,
  postal_code   text,
  phone         text,
  created_at    timestamptz default now()
);
alter table clients enable row level security;
create policy "service_role_all" on clients using (true);

create table if not exists email_templates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  subject    text,
  body       text,
  created_at timestamptz default now()
);
alter table email_templates enable row level security;
create policy "service_role_all" on email_templates using (true);

create table if not exists invoice_settings (
  id                  text primary key default 'default',
  sender_name         text,
  sender_company      text,
  sender_postal_code  text,
  sender_address      text,
  sender_phone        text,
  sender_email        text,
  bank_name           text,
  bank_branch         text,
  bank_account        text,
  bank_account_name   text,
  bank_swift          text,
  currency            text default 'JPY',
  updated_at          timestamptz default now(),
  created_at          timestamptz default now()
);
alter table invoice_settings enable row level security;
create policy "service_role_all" on invoice_settings using (true);

create table if not exists schedules (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid references clients(id) on delete cascade,
  template_id         uuid references email_templates(id) on delete set null,
  day_of_month        int,
  active              boolean not null default true,
  notes               text,
  send_mode           text,
  auto_fetch_amazon   boolean not null default false,
  fixed_items         jsonb,
  fee_rules_config    jsonb,
  created_at          timestamptz default now()
);
alter table schedules enable row level security;
create policy "service_role_all" on schedules using (true);
create index if not exists idx_schedules_client_id on schedules(client_id);

create table if not exists invoice_history (
  id             uuid primary key default gen_random_uuid(),
  type           text,
  "to"           text,
  subject        text,
  invoice_number text,
  draft_id       text,
  from_schedule  boolean not null default false,
  sent_at        timestamptz,
  created_at     timestamptz default now()
);
alter table invoice_history enable row level security;
create policy "service_role_all" on invoice_history using (true);

-- Amazon accounts linked to clients (for invoice module)
create table if not exists amazon_accounts (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid references clients(id) on delete cascade,
  account_name        text not null,
  seller_id           text,
  marketplace_id      text,
  refresh_token       text,
  sp_api_client_id    text,
  sp_api_client_secret text,
  created_at          timestamptz default now()
);
alter table amazon_accounts enable row level security;
create policy "service_role_all" on amazon_accounts using (true);
create index if not exists idx_amazon_accounts_client_id on amazon_accounts(client_id);

create table if not exists amazon_monthly_data (
  id                uuid primary key default gen_random_uuid(),
  amazon_account_id uuid references amazon_accounts(id) on delete cascade,
  year_month        text not null,
  total_sales       numeric,
  total_ad_spend    numeric,
  fetched_at        timestamptz,
  created_at        timestamptz default now(),
  unique (amazon_account_id, year_month)
);
alter table amazon_monthly_data enable row level security;
create policy "service_role_all" on amazon_monthly_data using (true);
create index if not exists idx_amazon_monthly_data_account on amazon_monthly_data(amazon_account_id);

create table if not exists fee_rules (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid references clients(id) on delete cascade,
  description text,
  rule_type   text,
  tiers       jsonb,
  active      boolean not null default true,
  created_at  timestamptz default now()
);
alter table fee_rules enable row level security;
create policy "service_role_all" on fee_rules using (true);
create index if not exists idx_fee_rules_client_id on fee_rules(client_id);

-- ============================================================
-- LINE CRM MODULE
-- ============================================================

create table if not exists line_channels (
  id                   uuid primary key default gen_random_uuid(),
  display_name         text,
  greeting_template_id uuid,
  greeting_enabled     boolean not null default false,
  created_at           timestamptz default now()
);
alter table line_channels enable row level security;
create policy "service_role_all" on line_channels using (true);

create table if not exists friends (
  id              uuid primary key default gen_random_uuid(),
  line_user_id    text not null,
  display_name    text,
  picture_url     text,
  status_message  text,
  status          text not null default 'active',
  unread_count    int not null default 0,
  channel_id      uuid references line_channels(id) on delete set null,
  followed_at     timestamptz,
  unfollowed_at      timestamptz,
  traffic_source_id  uuid,
  updated_at         timestamptz default now(),
  created_at         timestamptz default now()
);
alter table friends enable row level security;
create policy "service_role_all" on friends using (true);
create index if not exists idx_friends_line_user_id on friends(line_user_id);
create index if not exists idx_friends_channel_id on friends(channel_id);
create index if not exists idx_friends_status on friends(status);

create table if not exists tags (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  color      text,
  created_at timestamptz default now()
);
alter table tags enable row level security;
create policy "service_role_all" on tags using (true);

create table if not exists friend_tags (
  id         uuid primary key default gen_random_uuid(),
  friend_id  uuid not null references friends(id) on delete cascade,
  tag_id     uuid not null references tags(id) on delete cascade,
  created_at timestamptz default now()
);
alter table friend_tags enable row level security;
create policy "service_role_all" on friend_tags using (true);
create index if not exists idx_friend_tags_friend_id on friend_tags(friend_id);
create index if not exists idx_friend_tags_tag_id on friend_tags(tag_id);

create table if not exists chat_messages (
  id              uuid primary key default gen_random_uuid(),
  friend_id       uuid references friends(id) on delete cascade,
  channel_id      uuid,
  direction       text not null,    -- 'incoming' | 'outgoing'
  message_type    text not null,    -- 'text' | 'image' | 'sticker' | etc.
  content         jsonb not null,
  line_message_id text,
  created_at      timestamptz default now()
);
alter table chat_messages enable row level security;
create policy "service_role_all" on chat_messages using (true);
create index if not exists idx_chat_messages_friend_id on chat_messages(friend_id);
create index if not exists idx_chat_messages_channel_id on chat_messages(channel_id);
create index if not exists idx_chat_messages_created_at on chat_messages(created_at);

create table if not exists tag_scheduled_replies (
  id                uuid primary key default gen_random_uuid(),
  tag_id            uuid references tags(id) on delete cascade,
  name              text,
  delay_hours       numeric not null default 0,
  response_messages jsonb,
  is_active         boolean not null default true,
  created_at        timestamptz default now()
);
alter table tag_scheduled_replies enable row level security;
create policy "service_role_all" on tag_scheduled_replies using (true);
create index if not exists idx_tag_scheduled_replies_tag_id on tag_scheduled_replies(tag_id);

create table if not exists tag_delivery_queue (
  id             uuid primary key default gen_random_uuid(),
  rule_id        uuid not null references tag_scheduled_replies(id) on delete cascade,
  friend_id      uuid not null references friends(id) on delete cascade,
  tag_id         uuid references tags(id) on delete set null,
  scheduled_for  timestamptz not null,
  status         text not null default 'pending',
  sent_at        timestamptz,
  error_message  text,
  created_at     timestamptz default now(),
  unique (rule_id, friend_id)
);
alter table tag_delivery_queue enable row level security;
create policy "service_role_all" on tag_delivery_queue using (true);
create index if not exists idx_tag_delivery_queue_status on tag_delivery_queue(status);
create index if not exists idx_tag_delivery_queue_scheduled_for on tag_delivery_queue(scheduled_for);
create index if not exists idx_tag_delivery_queue_friend_id on tag_delivery_queue(friend_id);

create table if not exists auto_responses (
  id                uuid primary key default gen_random_uuid(),
  channel_id        uuid,
  name              text,
  keywords          jsonb,
  response_messages jsonb,
  match_type        text,
  is_active         boolean not null default true,
  priority          int not null default 0,
  folder            text,
  tag_actions       jsonb,
  created_at        timestamptz default now()
);
alter table auto_responses enable row level security;
create policy "service_role_all" on auto_responses using (true);
create index if not exists idx_auto_responses_channel_id on auto_responses(channel_id);

create table if not exists broadcasts (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  channel_id        uuid,
  message_content   text,
  messages          jsonb,
  scheduled_at      timestamptz,
  target_tags       jsonb,
  target_filters    jsonb,
  status            text not null default 'draft',
  sent_at           timestamptz,
  sent_count        int not null default 0,
  total_recipients  int not null default 0,
  success_count     int not null default 0,
  failure_count     int not null default 0,
  updated_at        timestamptz default now(),
  created_at        timestamptz default now()
);
alter table broadcasts enable row level security;
create policy "service_role_all" on broadcasts using (true);

create table if not exists step_sequences (
  id         uuid primary key default gen_random_uuid(),
  name       text,
  steps      jsonb,
  is_active  boolean not null default true,
  created_at timestamptz default now()
);
alter table step_sequences enable row level security;
create policy "service_role_all" on step_sequences using (true);

create table if not exists ai_settings (
  id                   uuid primary key default gen_random_uuid(),
  enabled              boolean not null default false,
  auto_reply_enabled   boolean not null default false,
  model                text,
  system_prompt        text,
  system_instructions  text,
  persona              text,
  temperature          numeric,
  max_tokens           int,
  updated_at           timestamptz default now(),
  created_at           timestamptz default now()
);
alter table ai_settings enable row level security;
create policy "service_role_all" on ai_settings using (true);

create table if not exists knowledge_base (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  content    text,
  category   text,
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);
alter table knowledge_base enable row level security;
create policy "service_role_all" on knowledge_base using (true);

-- RAG knowledge chunks with vector embeddings (Voyage AI, 512-dim)
create table if not exists knowledge_chunks (
  id         uuid primary key default gen_random_uuid(),
  source     text not null,
  source_id  text not null,
  category   text,
  title      text,
  content    text not null,
  metadata   jsonb,
  embedding  vector(512),
  updated_at timestamptz default now(),
  created_at timestamptz default now(),
  unique (source, source_id)
);
alter table knowledge_chunks enable row level security;
create policy "service_role_all" on knowledge_chunks using (true);
create index if not exists idx_knowledge_chunks_source on knowledge_chunks(source);
create index if not exists idx_knowledge_chunks_category on knowledge_chunks(category);

-- Friend chat summaries (one per friend, updated by fitpeak-rag)
create table if not exists friend_chat_summaries (
  id                  uuid primary key default gen_random_uuid(),
  friend_id           uuid not null unique references friends(id) on delete cascade,
  summary             text,
  key_facts           jsonb,
  campaigns_mentioned jsonb,
  updated_at          timestamptz default now(),
  created_at          timestamptz default now()
);
alter table friend_chat_summaries enable row level security;
create policy "service_role_all" on friend_chat_summaries using (true);
create index if not exists idx_friend_chat_summaries_friend_id on friend_chat_summaries(friend_id);

-- LINE rich menus
create table if not exists rich_menus (
  id               uuid primary key default gen_random_uuid(),
  channel_id       uuid references line_channels(id) on delete cascade,
  name             text,
  rich_menu_id     text,   -- LINE API rich menu ID
  is_default       boolean not null default false,
  config           jsonb,
  created_at       timestamptz default now()
);
alter table rich_menus enable row level security;
create policy "service_role_all" on rich_menus using (true);

-- Message templates (for line-crm UI)
create table if not exists message_templates (
  id         uuid primary key default gen_random_uuid(),
  channel_id uuid,
  name       text not null,
  type       text default 'multi',
  content    jsonb,
  folder     text,
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);
alter table message_templates enable row level security;
create policy "service_role_all" on message_templates using (true);

-- Scratch card codes / coupons
create table if not exists scratch_codes (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  prize_label text,
  prize_rank  text,
  is_used     boolean not null default false,
  used_by     uuid references friends(id) on delete set null,
  used_at     timestamptz,
  created_at  timestamptz default now()
);
alter table scratch_codes enable row level security;
create policy "service_role_all" on scratch_codes using (true);

create table if not exists coupons (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  discount_type text,    -- 'percent' | 'fixed'
  discount_value numeric,
  expires_at   timestamptz,
  is_active    boolean not null default true,
  issued_to    uuid references friends(id) on delete set null,
  used_at      timestamptz,
  created_at   timestamptz default now()
);
alter table coupons enable row level security;
create policy "service_role_all" on coupons using (true);

-- Surveys
create table if not exists surveys (
  id                       uuid primary key default gen_random_uuid(),
  line_user_id             text,
  user_id                  text,
  rating                   int,
  comment                  text,
  answers                  jsonb,
  amazon_button_clicked_at timestamptz,
  created_at               timestamptz default now()
);
alter table surveys enable row level security;
create policy "service_role_all" on surveys using (true);
create index if not exists idx_surveys_line_user_id on surveys(line_user_id);

create table if not exists survey_followup_rules (
  id                uuid primary key default gen_random_uuid(),
  name              text,
  type              text not null default 'no_survey',
  delay_days        int not null default 3,
  min_rating        int not null default 4,
  response_messages jsonb,
  is_active         boolean not null default true,
  created_at        timestamptz default now()
);
alter table survey_followup_rules enable row level security;
create policy "service_role_all" on survey_followup_rules using (true);

create table if not exists survey_followup_log (
  id         uuid primary key default gen_random_uuid(),
  rule_id    uuid references survey_followup_rules(id) on delete cascade,
  friend_id  uuid references friends(id) on delete cascade,
  sent_at    timestamptz default now()
);
alter table survey_followup_log enable row level security;
create policy "service_role_all" on survey_followup_log using (true);
create index if not exists idx_survey_followup_log_friend_id on survey_followup_log(friend_id);
create index if not exists idx_survey_followup_log_rule_id on survey_followup_log(rule_id);

-- ============================================================
-- EMAIL AUTO-RESPONDER MODULE
-- ============================================================

create table if not exists email_auto_reply_settings (
  id                  uuid primary key default gen_random_uuid(),
  enabled             boolean not null default false,
  mode                text,
  gmail_query         text,
  max_emails_per_run  int not null default 10,
  reply_prefix        text,
  reply_suffix        text,
  updated_at          timestamptz default now(),
  created_at          timestamptz default now()
);
alter table email_auto_reply_settings enable row level security;
create policy "service_role_all" on email_auto_reply_settings using (true);

create table if not exists email_auto_reply_logs (
  id               uuid primary key default gen_random_uuid(),
  gmail_message_id text,
  customer_email   text,
  subject          text,
  customer_message text,
  ai_reply         text,
  status           text,
  error            text,
  created_at       timestamptz default now()
);
alter table email_auto_reply_logs enable row level security;
create policy "service_role_all" on email_auto_reply_logs using (true);
create index if not exists idx_email_auto_reply_logs_gmail_id on email_auto_reply_logs(gmail_message_id);

-- ============================================================
-- SLACK ESCALATION MODULE
-- ============================================================

create table if not exists slack_escalations (
  id               uuid primary key default gen_random_uuid(),
  channel_type     text not null default 'LINE',
  line_user_id     text,
  email_address    text,
  customer_name    text,
  original_message text,
  ai_draft         text,
  reason           text,
  status           text not null default 'pending',
  slack_ts         text,
  slack_channel    text,
  created_at       timestamptz default now()
);
alter table slack_escalations enable row level security;
create policy "service_role_all" on slack_escalations using (true);
create index if not exists idx_slack_escalations_status on slack_escalations(status);

-- ============================================================
-- RETURN / REVIEW MODULE
-- ============================================================

-- return_settings uses text id 'default'
create table if not exists return_settings (
  id                    text primary key default 'default',
  return_period_days    int not null default 30,
  extension_rule        text,
  extension_custom_days int,
  allowed_reasons       jsonb,
  ai_strictness         int not null default 3,
  shopify_store_url     text,
  shopify_admin_token   text,
  line_channel_token    text,
  line_crm_api_url      text,
  approve_template      text,
  deny_template         text,
  updated_at            timestamptz default now(),
  created_at            timestamptz default now()
);
alter table return_settings enable row level security;
create policy "service_role_all" on return_settings using (true);

create table if not exists return_reviews (
  id              uuid primary key default gen_random_uuid(),
  friend_id       uuid references friends(id) on delete set null,
  line_user_id    text,
  order_id        text,
  reason          text,
  photos          jsonb,
  status          text not null default 'pending',
  ai_decision     text,
  ai_confidence   numeric,
  ai_reason       text,
  reviewed_at     timestamptz,
  created_at      timestamptz default now()
);
alter table return_reviews enable row level security;
create policy "service_role_all" on return_reviews using (true);
create index if not exists idx_return_reviews_friend_id on return_reviews(friend_id);
create index if not exists idx_return_reviews_status on return_reviews(status);

-- ============================================================
-- SHOPIFY-LINE INTEGRATION MODULE
-- ============================================================

create table if not exists line_shopify_links (
  id                    uuid primary key default gen_random_uuid(),
  friend_id             uuid references friends(id) on delete cascade,
  line_user_id          text not null,
  shopify_customer_id   text,
  shopify_email         text,
  shopify_customer_name text,
  is_verified           boolean not null default false,
  linked_at             timestamptz,
  updated_at            timestamptz default now(),
  created_at            timestamptz default now()
);
alter table line_shopify_links enable row level security;
create policy "service_role_all" on line_shopify_links using (true);
create index if not exists idx_line_shopify_links_friend_id on line_shopify_links(friend_id);
create index if not exists idx_line_shopify_links_line_user_id on line_shopify_links(line_user_id);

create table if not exists auto_login_tokens (
  id          uuid primary key default gen_random_uuid(),
  token       text not null unique,
  email       text,
  line_user_id text,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz default now()
);
alter table auto_login_tokens enable row level security;
create policy "service_role_all" on auto_login_tokens using (true);
create index if not exists idx_auto_login_tokens_token on auto_login_tokens(token);

create table if not exists shopify_order_notifications (
  id                uuid primary key default gen_random_uuid(),
  link_id           uuid references line_shopify_links(id) on delete cascade,
  shopify_order_id  text,
  shopify_order_name text,
  order_created_at  timestamptz,
  notification_type text,
  message_summary   text,
  created_at        timestamptz default now()
);
alter table shopify_order_notifications enable row level security;
create policy "service_role_all" on shopify_order_notifications using (true);
create index if not exists idx_shopify_order_notifications_link_id on shopify_order_notifications(link_id);

create table if not exists shopify_followup_queue (
  id                uuid primary key default gen_random_uuid(),
  link_id           uuid references line_shopify_links(id) on delete cascade,
  shopify_order_id  text,
  shopify_order_name text,
  line_user_id      text,
  followup_type     text,
  scheduled_at      timestamptz not null,
  status            text not null default 'pending',
  sent_at           timestamptz,
  items_json        jsonb,
  created_at        timestamptz default now()
);
alter table shopify_followup_queue enable row level security;
create policy "service_role_all" on shopify_followup_queue using (true);
create index if not exists idx_shopify_followup_queue_status on shopify_followup_queue(status);
create index if not exists idx_shopify_followup_queue_link_id on shopify_followup_queue(link_id);

-- ============================================================
-- AMAZON MCF / ORDER MANAGEMENT MODULE
-- ============================================================

-- Orders (id is text: 'SHOP-{shopifyId}', etc.)
create table if not exists orders (
  id                text primary key,
  channel           text not null,          -- 'SHOPIFY', 'AMAZON', etc.
  channel_order_id  text,
  mcf_order_id      text,
  status            text not null default 'PENDING',
  shipping_speed    text,
  recipient_name    text,
  address_line1     text,
  address_line2     text,
  city              text,
  state_or_region   text,
  postal_code       text,
  country_code      text default 'JP',
  tracking_number   text,
  shipped_at        timestamptz,
  tracking_updated_at timestamptz,
  retry_count       int not null default 0,
  error_message     text,
  ordered_at        timestamptz,
  total_amount      numeric,
  currency          text default 'JPY',
  updated_at        timestamptz default now(),
  created_at        timestamptz default now()
);
alter table orders enable row level security;
create policy "service_role_all" on orders using (true);
create index if not exists idx_orders_channel on orders(channel);
create index if not exists idx_orders_status on orders(status);
create index if not exists idx_orders_channel_order_id on orders(channel_order_id);

-- Order items (id is text: '{orderId}-{itemId}')
create table if not exists order_items (
  id          text primary key,
  order_id    text not null references orders(id) on delete cascade,
  channel_sku text,
  amazon_sku  text,
  quantity    int not null default 1,
  title       text,
  created_at  timestamptz default now()
);
alter table order_items enable row level security;
create policy "service_role_all" on order_items using (true);
create index if not exists idx_order_items_order_id on order_items(order_id);

create table if not exists fulfillment_logs (
  id         uuid primary key default gen_random_uuid(),
  order_id   text references orders(id) on delete cascade,
  event      text not null,
  message    text,
  created_at timestamptz default now()
);
alter table fulfillment_logs enable row level security;
create policy "service_role_all" on fulfillment_logs using (true);
create index if not exists idx_fulfillment_logs_order_id on fulfillment_logs(order_id);

-- SKU mappings (channel SKU <-> Amazon SKU)
create table if not exists sku_mappings (
  id          uuid primary key default gen_random_uuid(),
  channel     text not null,
  channel_sku text not null,
  amazon_sku  text not null,
  is_active   boolean not null default true,
  updated_at  timestamptz default now(),
  created_at  timestamptz default now()
);
alter table sku_mappings enable row level security;
create policy "service_role_all" on sku_mappings using (true);
create index if not exists idx_sku_mappings_channel on sku_mappings(channel, channel_sku);

-- Amazon catalog cache (ASIN -> product info + parent ASIN)
create table if not exists amazon_catalog_cache (
  id          uuid primary key default gen_random_uuid(),
  asin        text not null unique,
  parent_asin text,
  variation   text,
  image_url   text,
  item_name   text,
  fetched_at  timestamptz,
  created_at  timestamptz default now()
);
alter table amazon_catalog_cache enable row level security;
create policy "service_role_all" on amazon_catalog_cache using (true);
create index if not exists idx_amazon_catalog_cache_parent_asin on amazon_catalog_cache(parent_asin);

-- Amazon inventory cache (FBA inventory per SKU)
create table if not exists amazon_inventory_cache (
  id                   uuid primary key default gen_random_uuid(),
  asin                 text not null,
  seller_sku           text,
  fulfillable_quantity int not null default 0,
  total_quantity       int not null default 0,
  fetched_at           timestamptz,
  created_at           timestamptz default now()
);
alter table amazon_inventory_cache enable row level security;
create policy "service_role_all" on amazon_inventory_cache using (true);
create index if not exists idx_amazon_inventory_cache_asin on amazon_inventory_cache(asin);

-- Manual product groupings (override Catalog API parent ASIN)
create table if not exists amazon_manual_groups (
  id         uuid primary key default gen_random_uuid(),
  asin       text not null unique,
  group_asin text not null,
  created_at timestamptz default now()
);
alter table amazon_manual_groups enable row level security;
create policy "service_role_all" on amazon_manual_groups using (true);

-- Hidden SKUs (exclude from inventory display)
create table if not exists amazon_hidden_skus (
  id         uuid primary key default gen_random_uuid(),
  seller_sku text not null unique,
  created_at timestamptz default now()
);
alter table amazon_hidden_skus enable row level security;
create policy "service_role_all" on amazon_hidden_skus using (true);

-- ============================================================
-- AMAZON ANALYTICS MODULE
-- ============================================================

create table if not exists amazon_review_solicitations (
  id               uuid primary key default gen_random_uuid(),
  amazon_order_id  text not null unique,
  status           text not null default 'pending',
  source           text,
  error_message    text,
  sent_at          timestamptz,
  created_at       timestamptz default now()
);
alter table amazon_review_solicitations enable row level security;
create policy "service_role_all" on amazon_review_solicitations using (true);
create index if not exists idx_amazon_review_solicitations_status on amazon_review_solicitations(status);

create table if not exists amazon_analytics_settings (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique,
  value      jsonb,
  created_at timestamptz default now()
);
alter table amazon_analytics_settings enable row level security;
create policy "service_role_all" on amazon_analytics_settings using (true);

-- ============================================================
-- AMAZON REVIEW MONITOR MODULE
-- ============================================================

create table if not exists amazon_review_products (
  id               uuid primary key default gen_random_uuid(),
  asin             text not null unique,
  title            text,
  image_url        text,
  is_active        boolean not null default true,
  average_rating   numeric,
  rating_count     int,
  previous_rating  numeric,
  previous_count   int,
  last_checked_at  timestamptz,
  created_at       timestamptz default now()
);
alter table amazon_review_products enable row level security;
create policy "service_role_all" on amazon_review_products using (true);

create table if not exists amazon_review_snapshots (
  id              uuid primary key default gen_random_uuid(),
  asin            text not null,
  rating_count    int,
  average_rating  numeric,
  star_1          int not null default 0,
  star_2          int not null default 0,
  star_3          int not null default 0,
  star_4          int not null default 0,
  star_5          int not null default 0,
  checked_at      timestamptz not null,
  created_at      timestamptz default now()
);
alter table amazon_review_snapshots enable row level security;
create policy "service_role_all" on amazon_review_snapshots using (true);
create index if not exists idx_amazon_review_snapshots_asin on amazon_review_snapshots(asin);

create table if not exists amazon_buyer_outreach (
  id               uuid primary key default gen_random_uuid(),
  amazon_order_id  text,
  asin             text,
  buyer_name       text,
  order_date       timestamptz,
  delivery_date    timestamptz,
  outreach_status  text not null default 'pending',
  message_sent     text,
  sent_at          timestamptz,
  notes            text,
  created_at       timestamptz default now()
);
alter table amazon_buyer_outreach enable row level security;
create policy "service_role_all" on amazon_buyer_outreach using (true);

-- ============================================================
-- ACCOUNTING MODULE
-- ============================================================

create table if not exists accounting_documents (
  id                      uuid primary key default gen_random_uuid(),
  document_type           text,
  document_date           date,
  due_date                date,
  vendor_name             text,
  vendor_address          text,
  amount_excluding_tax    numeric,
  tax_amount              numeric,
  amount_including_tax    numeric,
  document_number         text,
  account_title           text,
  ai_confidence           numeric,
  ai_raw_response         text,
  original_filename       text,
  file_hash               text,
  google_drive_file_id    text,
  google_drive_url        text,
  supabase_storage_path   text,
  source_email_id         text,
  source_url              text,
  source_type             text,
  status                  text not null default 'pending',
  updated_at              timestamptz default now(),
  created_at              timestamptz default now()
);
alter table accounting_documents enable row level security;
create policy "service_role_all" on accounting_documents using (true);
create index if not exists idx_accounting_documents_status on accounting_documents(status);
create index if not exists idx_accounting_documents_document_date on accounting_documents(document_date);

create table if not exists accounting_sources (
  id              uuid primary key default gen_random_uuid(),
  source_type     text not null,
  source_id       text,
  search_keywords text,
  is_active       boolean not null default true,
  last_fetched_at timestamptz,
  created_at      timestamptz default now()
);
alter table accounting_sources enable row level security;
create policy "service_role_all" on accounting_sources using (true);

create table if not exists accounting_fetch_logs (
  id                 uuid primary key default gen_random_uuid(),
  started_at         timestamptz,
  completed_at       timestamptz,
  documents_found    int not null default 0,
  documents_saved    int not null default 0,
  documents_skipped  int not null default 0,
  created_at         timestamptz default now()
);
alter table accounting_fetch_logs enable row level security;
create policy "service_role_all" on accounting_fetch_logs using (true);

create table if not exists financial_accounts (
  id                     uuid primary key default gen_random_uuid(),
  account_type           text,
  account_name           text,
  institution_name       text,
  account_number_masked  text,
  branch_name            text,
  created_at             timestamptz default now()
);
alter table financial_accounts enable row level security;
create policy "service_role_all" on financial_accounts using (true);

create table if not exists financial_transactions (
  id                   uuid primary key default gen_random_uuid(),
  account_id           uuid references financial_accounts(id) on delete cascade,
  transaction_date     date,
  amount               numeric,
  balance_after        numeric,
  counterparty         text,
  description          text,
  is_matched           boolean not null default false,
  matched_document_id  uuid references accounting_documents(id) on delete set null,
  raw_data             jsonb,
  created_at           timestamptz default now()
);
alter table financial_transactions enable row level security;
create policy "service_role_all" on financial_transactions using (true);
create index if not exists idx_financial_transactions_account_id on financial_transactions(account_id);
create index if not exists idx_financial_transactions_transaction_date on financial_transactions(transaction_date);

create table if not exists financial_institutions (
  id               uuid primary key default gen_random_uuid(),
  institution_type text,
  name             text not null,
  name_kana        text,
  created_at       timestamptz default now()
);
alter table financial_institutions enable row level security;
create policy "service_role_all" on financial_institutions using (true);

create table if not exists financial_branches (
  id              uuid primary key default gen_random_uuid(),
  institution_id  uuid references financial_institutions(id) on delete cascade,
  branch_name     text,
  branch_code     text,
  created_at      timestamptz default now()
);
alter table financial_branches enable row level security;
create policy "service_role_all" on financial_branches using (true);
create index if not exists idx_financial_branches_institution_id on financial_branches(institution_id);

-- ============================================================
-- ACCOUNTING CORE MODULE (Double-entry bookkeeping)
-- ============================================================

create table if not exists account_titles (
  id            uuid primary key default gen_random_uuid(),
  code          text,
  name          text not null,
  category      text,
  subcategory   text,
  is_active     boolean not null default true,
  display_order int not null default 0,
  created_at    timestamptz default now()
);
alter table account_titles enable row level security;
create policy "service_role_all" on account_titles using (true);

create table if not exists fiscal_periods (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  start_date date not null,
  end_date   date not null,
  created_at timestamptz default now()
);
alter table fiscal_periods enable row level security;
create policy "service_role_all" on fiscal_periods using (true);

create table if not exists journal_entries (
  id                 uuid primary key default gen_random_uuid(),
  entry_date         date not null,
  description        text,
  reference_number   text,
  source             text,
  fiscal_period_id   uuid references fiscal_periods(id) on delete set null,
  fiscal_document_id uuid,
  updated_at         timestamptz default now(),
  created_at         timestamptz default now()
);
alter table journal_entries enable row level security;
create policy "service_role_all" on journal_entries using (true);
create index if not exists idx_journal_entries_entry_date on journal_entries(entry_date);
create index if not exists idx_journal_entries_fiscal_period on journal_entries(fiscal_period_id);

create table if not exists journal_entry_lines (
  id                uuid primary key default gen_random_uuid(),
  journal_entry_id  uuid not null references journal_entries(id) on delete cascade,
  account_title_id  uuid not null references account_titles(id) on delete restrict,
  debit_amount      numeric not null default 0,
  credit_amount     numeric not null default 0,
  description       text,
  sort_order        int not null default 0,
  created_at        timestamptz default now()
);
alter table journal_entry_lines enable row level security;
create policy "service_role_all" on journal_entry_lines using (true);
create index if not exists idx_journal_entry_lines_journal_entry_id on journal_entry_lines(journal_entry_id);
create index if not exists idx_journal_entry_lines_account_title_id on journal_entry_lines(account_title_id);

-- ============================================================
-- FISCAL ANALYSIS MODULE
-- ============================================================

create table if not exists company_profile (
  id                  uuid primary key default gen_random_uuid(),
  fiscal_end_month    int,
  first_period_start  date,
  period_count        int not null default 0,
  updated_at          timestamptz default now(),
  created_at          timestamptz default now()
);
alter table company_profile enable row level security;
create policy "service_role_all" on company_profile using (true);

create table if not exists fiscal_years (
  id          uuid primary key default gen_random_uuid(),
  year_label  text not null,
  start_date  date not null,
  end_date    date not null,
  is_current  boolean not null default false,
  notes       text,
  created_at  timestamptz default now()
);
alter table fiscal_years enable row level security;
create policy "service_role_all" on fiscal_years using (true);

create table if not exists fiscal_documents (
  id                      uuid primary key default gen_random_uuid(),
  fiscal_year_id          uuid references fiscal_years(id) on delete cascade,
  document_type           text,
  document_subtype        text,
  original_filename       text,
  supabase_storage_path   text,
  file_hash               text,
  ai_status               text,
  target_month            text,
  ai_summary              text,
  created_at              timestamptz default now()
);
alter table fiscal_documents enable row level security;
create policy "service_role_all" on fiscal_documents using (true);
create index if not exists idx_fiscal_documents_fiscal_year_id on fiscal_documents(fiscal_year_id);

create table if not exists fiscal_year_metrics (
  id                  uuid primary key default gen_random_uuid(),
  fiscal_year_id      uuid references fiscal_years(id) on delete cascade,
  source_document_id  uuid references fiscal_documents(id) on delete set null,
  category            text,
  metric_key          text,
  metric_label        text,
  metric_value        numeric,
  metric_text         text,
  display_order       int not null default 0,
  target_month        text,
  created_at          timestamptz default now()
);
alter table fiscal_year_metrics enable row level security;
create policy "service_role_all" on fiscal_year_metrics using (true);
create index if not exists idx_fiscal_year_metrics_fiscal_year_id on fiscal_year_metrics(fiscal_year_id);

-- ============================================================
-- TASK MANAGER MODULE
-- ============================================================

create table if not exists customers (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  chatwork_room_id text,
  email           text,
  notes           text,
  updated_at      timestamptz default now(),
  created_at      timestamptz default now()
);
alter table customers enable row level security;
create policy "service_role_all" on customers using (true);

create table if not exists tasks (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid references customers(id) on delete set null,
  title        text not null,
  description  text,
  source       text not null default 'manual',
  source_ref   text,
  priority     text not null default 'medium',
  status       text not null default 'pending',
  due_date     date,
  completed_at timestamptz,
  updated_at   timestamptz default now(),
  created_at   timestamptz default now()
);
alter table tasks enable row level security;
create policy "service_role_all" on tasks using (true);
create index if not exists idx_tasks_customer_id on tasks(customer_id);
create index if not exists idx_tasks_status on tasks(status);
create index if not exists idx_tasks_priority on tasks(priority);

create table if not exists meeting_notes (
  id             uuid primary key default gen_random_uuid(),
  customer_id    uuid references customers(id) on delete set null,
  title          text not null,
  content        text,
  meeting_date   date,
  file_path      text,
  file_type      text,
  action_items   jsonb,
  summary        text,
  created_at     timestamptz default now()
);
alter table meeting_notes enable row level security;
create policy "service_role_all" on meeting_notes using (true);
create index if not exists idx_meeting_notes_customer_id on meeting_notes(customer_id);

create table if not exists attachments (
  id              uuid primary key default gen_random_uuid(),
  meeting_note_id uuid references meeting_notes(id) on delete cascade,
  task_id         uuid references tasks(id) on delete cascade,
  file_name       text not null,
  file_path       text not null,
  file_type       text,
  file_size       bigint,
  ocr_text        text,
  ai_summary      text,
  created_at      timestamptz default now()
);
alter table attachments enable row level security;
create policy "service_role_all" on attachments using (true);
create index if not exists idx_attachments_meeting_note_id on attachments(meeting_note_id);
create index if not exists idx_attachments_task_id on attachments(task_id);

create table if not exists chatwork_messages (
  id           uuid primary key default gen_random_uuid(),
  room_id      text not null,
  message_id   text not null unique,
  account_id   text,
  account_name text,
  body         text,
  send_time    bigint,
  is_self      int not null default 0,
  created_at   timestamptz default now()
);
alter table chatwork_messages enable row level security;
create policy "service_role_all" on chatwork_messages using (true);
create index if not exists idx_chatwork_messages_room_id on chatwork_messages(room_id);
create index if not exists idx_chatwork_messages_send_time on chatwork_messages(send_time);

create table if not exists gmail_messages (
  id                  uuid primary key default gen_random_uuid(),
  gmail_id            text not null unique,
  thread_id           text,
  from_address        text,
  from_name           text,
  subject             text,
  body_snippet        text,
  body_full           text,
  received_at         text,
  importance          text,
  category            text,
  summary             text,
  recommended_action  text,
  created_at          timestamptz default now()
);
alter table gmail_messages enable row level security;
create policy "service_role_all" on gmail_messages using (true);
create index if not exists idx_gmail_messages_thread_id on gmail_messages(thread_id);

create table if not exists daily_reports (
  id              uuid primary key default gen_random_uuid(),
  report_date     date not null unique,
  generated_tasks text,
  summary         text,
  created_at      timestamptz default now()
);
alter table daily_reports enable row level security;
create policy "service_role_all" on daily_reports using (true);

create table if not exists task_settings (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique,
  value      text,
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);
alter table task_settings enable row level security;
create policy "service_role_all" on task_settings using (true);

-- ============================================================
-- STREAMER CLIP MODULE
-- ============================================================

-- streamer_profiles uses text id (user-set)
create table if not exists streamer_profiles (
  id           text primary key,
  display_name text,
  config       jsonb,
  updated_at   timestamptz default now(),
  created_at   timestamptz default now()
);
alter table streamer_profiles enable row level security;
create policy "service_role_all" on streamer_profiles using (true);

create table if not exists streamer_profile_stats (
  id          uuid primary key default gen_random_uuid(),
  profile_id  text not null unique references streamer_profiles(id) on delete cascade,
  total_jobs  int not null default 0,
  created_at  timestamptz default now()
);
alter table streamer_profile_stats enable row level security;
create policy "service_role_all" on streamer_profile_stats using (true);

create table if not exists streamer_jobs (
  id             uuid primary key default gen_random_uuid(),
  profile_id     text references streamer_profiles(id) on delete set null,
  video_filename text,
  video_url      text,
  status         text not null default 'pending',
  total_cost_usd numeric,
  error_message  text,
  created_at     timestamptz default now()
);
alter table streamer_jobs enable row level security;
create policy "service_role_all" on streamer_jobs using (true);
create index if not exists idx_streamer_jobs_profile_id on streamer_jobs(profile_id);
create index if not exists idx_streamer_jobs_status on streamer_jobs(status);

create table if not exists streamer_candidates (
  id         uuid primary key default gen_random_uuid(),
  job_id     uuid not null references streamer_jobs(id) on delete cascade,
  score      numeric,
  data       jsonb,
  created_at timestamptz default now()
);
alter table streamer_candidates enable row level security;
create policy "service_role_all" on streamer_candidates using (true);
create index if not exists idx_streamer_candidates_job_id on streamer_candidates(job_id);

create table if not exists streamer_cost_logs (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid references streamer_jobs(id) on delete cascade,
  profile_id  text,
  service     text,
  units       numeric,
  cost_usd    numeric,
  created_at  timestamptz default now()
);
alter table streamer_cost_logs enable row level security;
create policy "service_role_all" on streamer_cost_logs using (true);
create index if not exists idx_streamer_cost_logs_job_id on streamer_cost_logs(job_id);

-- ============================================================
-- AMAZON CONSULTING MODULE
-- ============================================================

create table if not exists consulting_submissions (
  id           uuid primary key default gen_random_uuid(),
  company      text,
  name         text,
  email        text,
  revenue      text,
  product_url  text,
  category     text,
  challenges   jsonb,
  message      text,
  status       text not null default 'new',
  submitted_at timestamptz,
  created_at   timestamptz default now()
);
alter table consulting_submissions enable row level security;
create policy "service_role_all" on consulting_submissions using (true);
create index if not exists idx_consulting_submissions_email on consulting_submissions(email);
create index if not exists idx_consulting_submissions_status on consulting_submissions(status);

-- ============================================================
-- OUTREACH / CRM MODULE
-- ============================================================

create table if not exists consulting_leads (
  id                uuid primary key default gen_random_uuid(),
  company_name      text,
  seller_name       text,
  amazon_url        text,
  website_url       text,
  email             text,
  category          text,
  estimated_revenue text,
  notes             text,
  source            text,
  status            text not null default 'new',
  last_emailed_at   timestamptz,
  email_count       int not null default 0,
  updated_at        timestamptz default now(),
  created_at        timestamptz default now()
);
alter table consulting_leads enable row level security;
create policy "service_role_all" on consulting_leads using (true);
create index if not exists idx_consulting_leads_status on consulting_leads(status);

create table if not exists outreach_templates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  subject    text,
  body       text,
  created_at timestamptz default now()
);
alter table outreach_templates enable row level security;
create policy "service_role_all" on outreach_templates using (true);

create table if not exists outreach_logs (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid references consulting_leads(id) on delete cascade,
  template_id  uuid,
  subject      text,
  body         text,
  created_at   timestamptz default now()
);
alter table outreach_logs enable row level security;
create policy "service_role_all" on outreach_logs using (true);
create index if not exists idx_outreach_logs_lead_id on outreach_logs(lead_id);

-- ============================================================
-- SALES EMAIL MODULE
-- ============================================================

create table if not exists sales_email_leads (
  id                uuid primary key default gen_random_uuid(),
  company_name      text,
  contact_name      text,
  email             text,
  challenges        text,
  category          text,
  status            text not null default 'unsent',
  generated_subject text,
  generated_body    text,
  sent_at           timestamptz,
  row_index         int,
  created_at        timestamptz default now()
);
alter table sales_email_leads enable row level security;
create policy "service_role_all" on sales_email_leads using (true);
create index if not exists idx_sales_email_leads_status on sales_email_leads(status);
create index if not exists idx_sales_email_leads_email on sales_email_leads(email);

-- ============================================================
-- HP OUTREACH MODULE
-- ============================================================

create table if not exists hp_outreach_leads (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  business_type         text,
  business_description  text,
  email                 text,
  instagram             text,
  phone                 text,
  address               text,
  google_maps_url       text,
  website               text,
  lp_html               text,
  lp_url                text,
  proposal_subject      text,
  status                text not null default 'new',
  sent_at               timestamptz,
  updated_at            timestamptz default now(),
  created_at            timestamptz default now()
);
alter table hp_outreach_leads enable row level security;
create policy "service_role_all" on hp_outreach_leads using (true);
create index if not exists idx_hp_outreach_leads_status on hp_outreach_leads(status);

-- hp_outreach_cursor: tracks auto-research position (area/category index)
create table if not exists hp_outreach_cursor (
  id              text primary key,
  area_index      int not null default 0,
  category_index  int not null default 0,
  last_run_at     timestamptz,
  created_at      timestamptz default now()
);
alter table hp_outreach_cursor enable row level security;
create policy "service_role_all" on hp_outreach_cursor using (true);

-- hp_outreach_replies: track email replies from leads
create table if not exists hp_outreach_replies (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid references hp_outreach_leads(id) on delete set null,
  gmail_id    text,
  from_email  text,
  subject     text,
  body        text,
  received_at timestamptz,
  created_at  timestamptz default now()
);
alter table hp_outreach_replies enable row level security;
create policy "service_role_all" on hp_outreach_replies using (true);
create index if not exists idx_hp_outreach_replies_lead_id on hp_outreach_replies(lead_id);

-- ============================================================
-- TRAFFIC SOURCES MODULE
-- ============================================================

create table if not exists traffic_sources (
  id            uuid primary key default gen_random_uuid(),
  channel_id    uuid,
  name          text not null,
  description   text,
  code          text not null unique,
  click_count   int not null default 0,
  friend_count  int not null default 0,
  updated_at    timestamptz default now(),
  created_at    timestamptz default now()
);
alter table traffic_sources enable row level security;
create policy "service_role_all" on traffic_sources using (true);
create index if not exists idx_traffic_sources_code on traffic_sources(code);

create table if not exists traffic_clicks (
  id          uuid primary key default gen_random_uuid(),
  source_id   uuid references traffic_sources(id) on delete cascade,
  ip_address  text,
  user_agent  text,
  created_at  timestamptz default now()
);
alter table traffic_clicks enable row level security;
create policy "service_role_all" on traffic_clicks using (true);
create index if not exists idx_traffic_clicks_source_id on traffic_clicks(source_id);

-- ============================================================
-- UPLOADS / STORAGE MODULE
-- ============================================================

create table if not exists uploads (
  id          uuid primary key default gen_random_uuid(),
  file_name   text,
  file_path   text,
  file_type   text,
  file_size   bigint,
  public_url  text,
  created_at  timestamptz default now()
);
alter table uploads enable row level security;
create policy "service_role_all" on uploads using (true);

-- ============================================================
-- SHOPIFY PRODUCTS MODULE
-- ============================================================

create table if not exists shopify_products (
  id              uuid primary key default gen_random_uuid(),
  shopify_id      text unique,
  title           text,
  handle          text,
  status          text,
  product_type    text,
  vendor          text,
  variants        jsonb,
  images          jsonb,
  updated_at      timestamptz default now(),
  created_at      timestamptz default now()
);
alter table shopify_products enable row level security;
create policy "service_role_all" on shopify_products using (true);

-- ============================================================
-- VECTOR SEARCH FUNCTION (for knowledge_chunks)
-- ============================================================

create or replace function search_knowledge_chunks(
  query_embedding vector(512),
  match_category  text default null,
  match_count     int  default 5
)
returns table (
  id          uuid,
  category    text,
  title       text,
  content     text,
  source      text,
  source_id   text,
  metadata    jsonb,
  similarity  float
)
language plpgsql
as $$
begin
  return query
  select
    kc.id,
    kc.category,
    kc.title,
    kc.content,
    kc.source,
    kc.source_id,
    kc.metadata,
    1 - (kc.embedding <=> query_embedding) as similarity
  from knowledge_chunks kc
  where (match_category is null or kc.category = match_category)
    and kc.embedding is not null
  order by kc.embedding <=> query_embedding
  limit match_count;
end;
$$;

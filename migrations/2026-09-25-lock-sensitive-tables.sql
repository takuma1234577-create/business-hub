-- ============================================================================
-- セキュリティ強化 第2段階（2026-09-25）
-- 「誰でも読み書きできる」ポリシー（roles=public, using true）が付いていた表のうち、
-- APIキー・トークン・ログイン情報・お客様情報を持つ42テーブルから、そのポリシーを外す。
-- 公開キー（anon）はページのJavaScriptに含まれるため、誰でもこれらを読み書きできる状態だった。
-- サーバーはサービスキーで接続する（server/shared.cjs）ので影響しない。RLSは有効のまま。
--
-- 元に戻す場合（1テーブルごと）:
--   create policy service_role_all on public.<table> for all to public using (true) with check (true);
-- ============================================================================

drop policy if exists service_role_all on public.accounting_documents;
drop policy if exists service_role_all on public.amazon_accounts;
drop policy if exists service_role_all on public.amazon_sp_accounts;
drop policy if exists service_role_all on public.api_keys;
drop policy if exists service_role_all on public.app_sessions;
drop policy if exists service_role_all on public.app_users;
drop policy if exists service_role_all on public.auth_2fa_codes;
drop policy if exists service_role_all on public.auto_login_tokens;
drop policy if exists allow_all_auto_login_tokens on public.auto_login_tokens;
drop policy if exists service_role_all on public.channel_stores;
drop policy if exists allow_all_channel_stores on public.channel_stores;
drop policy if exists service_role_all on public.chat_messages;
drop policy if exists service_role_all on public.chatwork_messages;
drop policy if exists service_role_all on public.clients;
drop policy if exists service_role_all on public.consulting_leads;
drop policy if exists service_role_all on public.consulting_submissions;
drop policy if exists service_role_all on public.creashot_bot_settings;
drop policy if exists service_role_all on public.creashot_profiles;
drop policy if exists service_role_all on public.creashot_queue;
drop policy if exists service_role_all on public.customers;
drop policy if exists service_role_all on public.ebay_orders;
drop policy if exists service_role_all on public.ebay_settings;
drop policy if exists service_role_all on public.email_auto_reply_logs;
drop policy if exists service_role_all on public.email_auto_reply_settings;
drop policy if exists service_role_all on public.financial_accounts;
drop policy if exists service_role_all on public.financial_transactions;
drop policy if exists service_role_all on public.friend_chat_summaries;
drop policy if exists service_role_all on public.friend_tags;
drop policy if exists service_role_all on public.friends;
drop policy if exists service_role_all on public.fulfillment_logs;
drop policy if exists service_role_all on public.gmail_messages;
drop policy if exists service_role_all on public.hp_outreach_leads;
drop policy if exists service_role_all on public.hp_outreach_replies;
drop policy if exists service_role_all on public.invoice_history;
drop policy if exists service_role_all on public.invoice_settings;
drop policy if exists service_role_all on public.line_channels;
drop policy if exists service_role_all on public.oauth_tokens;
drop policy if exists service_role_all on public.order_items;
drop policy if exists service_role_all on public.orders;
drop policy if exists service_role_all on public.outreach_logs;
drop policy if exists service_role_all on public.sales_agent_settings;
drop policy if exists service_role_all on public.sales_email_leads;
drop policy if exists service_role_all on public.shopify_order_notifications;
drop policy if exists service_role_all on public.traffic_clicks;

-- 念のためRLSが有効であることを保証
alter table public.accounting_documents enable row level security;
alter table public.amazon_accounts enable row level security;
alter table public.amazon_sp_accounts enable row level security;
alter table public.api_keys enable row level security;
alter table public.app_sessions enable row level security;
alter table public.app_users enable row level security;
alter table public.auth_2fa_codes enable row level security;
alter table public.auto_login_tokens enable row level security;
alter table public.channel_stores enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chatwork_messages enable row level security;
alter table public.clients enable row level security;
alter table public.consulting_leads enable row level security;
alter table public.consulting_submissions enable row level security;
alter table public.creashot_bot_settings enable row level security;
alter table public.creashot_profiles enable row level security;
alter table public.creashot_queue enable row level security;
alter table public.customers enable row level security;
alter table public.ebay_orders enable row level security;
alter table public.ebay_settings enable row level security;
alter table public.email_auto_reply_logs enable row level security;
alter table public.email_auto_reply_settings enable row level security;
alter table public.financial_accounts enable row level security;
alter table public.financial_transactions enable row level security;
alter table public.friend_chat_summaries enable row level security;
alter table public.friend_tags enable row level security;
alter table public.friends enable row level security;
alter table public.fulfillment_logs enable row level security;
alter table public.gmail_messages enable row level security;
alter table public.hp_outreach_leads enable row level security;
alter table public.hp_outreach_replies enable row level security;
alter table public.invoice_history enable row level security;
alter table public.invoice_settings enable row level security;
alter table public.line_channels enable row level security;
alter table public.oauth_tokens enable row level security;
alter table public.order_items enable row level security;
alter table public.orders enable row level security;
alter table public.outreach_logs enable row level security;
alter table public.sales_agent_settings enable row level security;
alter table public.sales_email_leads enable row level security;
alter table public.shopify_order_notifications enable row level security;
alter table public.traffic_clicks enable row level security;

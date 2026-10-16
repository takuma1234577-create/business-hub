-- 会員がブラウザ(anonキー+自分のJWT)から members の全列（plan, plan_expires_at, line_user_id, shopify_customer_id, email 等）を
-- 書き換えられた（members_update_own ポリシー + authenticated への全列UPDATE権限）。フロントからの直接更新は無く、更新は全てサーバー(service_role)経由。
-- 本番 fajq… に 2026-10-16 適用済み。
revoke update, insert, delete on public.members from anon, authenticated;
drop policy if exists members_update_own on public.members;

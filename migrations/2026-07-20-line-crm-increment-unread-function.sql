-- friends.unread_count を増やすPostgres関数（server/line-crm.cjs の logWebhookMessage が
-- supabase.rpc('increment_unread', ...) で呼んでいたが、この関数自体が存在せず
-- 全アカウントで新着メッセージの未読バッジが常に0のままになっていた既存バグを修正）
-- 適用済み（Supabase MCP apply_migration, name=add_increment_unread_function）。このファイルは記録用。

create or replace function increment_unread(friend_id_input uuid)
returns void
language sql
as $$
  update friends set unread_count = coalesce(unread_count, 0) + 1 where id = friend_id_input;
$$;

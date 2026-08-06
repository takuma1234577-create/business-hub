-- タグ遅延配信メッセージへの返信を「自分で返信する」か「AIに返信させる」かをルールごとに選べるようにする。
-- AIモードは reply_mode='ai' の ai_knowledge（ルール専用ナレッジ/配信意図）のみを根拠に回答する。
-- 適用済み（Supabase MCP apply_migration, name=tag_scheduled_replies_ai_mode）。このファイルは記録用。

alter table tag_scheduled_replies
  add column if not exists reply_mode text not null default 'manual' check (reply_mode in ('manual','ai')),
  add column if not exists ai_knowledge text;

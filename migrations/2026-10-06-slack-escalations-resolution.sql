-- slack_escalations: 処理済みの記録と再通知の列（本番には 2026-10-06 に適用済み）
alter table slack_escalations add column if not exists resolution_text text, add column if not exists resolved_by text, add column if not exists resolved_at timestamptz, add column if not exists last_reminded_at timestamptz, add column if not exists remind_count int not null default 0;

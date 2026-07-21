-- タグ・タグ遅延配信もアカウントごとに完全分離する
-- 適用済み（Supabase MCP apply_migration, name=line_crm_scope_tags_per_account）。このファイルは記録用。

alter table tags add column if not exists channel_id uuid references line_channels(id) on delete cascade;
update tags set channel_id = '00000000-0000-0000-0000-000000000010' where channel_id is null;
create index if not exists idx_tags_channel_id on tags(channel_id);

alter table tag_scheduled_replies add column if not exists channel_id uuid references line_channels(id) on delete cascade;
update tag_scheduled_replies set channel_id = '00000000-0000-0000-0000-000000000010' where channel_id is null;
create index if not exists idx_tag_scheduled_replies_channel_id on tag_scheduled_replies(channel_id);

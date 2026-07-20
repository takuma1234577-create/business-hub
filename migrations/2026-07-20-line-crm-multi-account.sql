-- LINE CRM: 複数公式LINEアカウント対応の基盤スキーマ
-- 適用済み（Supabase MCP apply_migration, name=line_crm_multi_account）。このファイルは記録用。

-- 1a. line_channels に認証情報・bot情報キャッシュ列を追加
alter table line_channels
  add column if not exists channel_access_token text,
  add column if not exists channel_secret       text,
  add column if not exists is_active            boolean not null default true,
  add column if not exists bot_display_name     text,
  add column if not exists bot_picture_url      text,
  add column if not exists bot_basic_id         text,
  add column if not exists bot_user_id          text,
  add column if not exists updated_at           timestamptz not null default now();

insert into line_channels (id, display_name, is_active)
values ('00000000-0000-0000-0000-000000000010', '既存アカウント（本番）', true)
on conflict (id) do nothing;

-- 1b. friends の (line_user_id, channel_id) 重複を解消（Webhookの競合で発生した重複を統合）
create temporary table _friend_dup_map as
select id as loser_id,
       first_value(id) over (partition by line_user_id, channel_id order by created_at, id) as keeper_id
from friends
where (line_user_id, channel_id) in (
  select line_user_id, channel_id from friends group by line_user_id, channel_id having count(*) > 1
);

delete from _friend_dup_map where loser_id = keeper_id;

update friend_tags set friend_id = m.keeper_id from _friend_dup_map m where friend_tags.friend_id = m.loser_id;
update chat_messages set friend_id = m.keeper_id from _friend_dup_map m where chat_messages.friend_id = m.loser_id;
update tag_delivery_queue set friend_id = m.keeper_id from _friend_dup_map m where tag_delivery_queue.friend_id = m.loser_id;
update scratch_codes set used_by = m.keeper_id from _friend_dup_map m where scratch_codes.used_by = m.loser_id;
update coupons set issued_to = m.keeper_id from _friend_dup_map m where coupons.issued_to = m.loser_id;
update survey_followup_log set friend_id = m.keeper_id from _friend_dup_map m where survey_followup_log.friend_id = m.loser_id;
update return_reviews set friend_id = m.keeper_id from _friend_dup_map m where return_reviews.friend_id = m.loser_id;
update line_shopify_links set friend_id = m.keeper_id from _friend_dup_map m where line_shopify_links.friend_id = m.loser_id;
update sales_agent_proposals set friend_id = m.keeper_id from _friend_dup_map m where sales_agent_proposals.friend_id = m.loser_id;

delete from friend_chat_summaries fcs using _friend_dup_map m where fcs.friend_id = m.loser_id;

delete from friends f using _friend_dup_map m where f.id = m.loser_id;

drop table _friend_dup_map;

-- 1c. (line_user_id, channel_id) にユニークインデックス
create unique index if not exists idx_friends_line_user_channel
  on friends(line_user_id, channel_id);

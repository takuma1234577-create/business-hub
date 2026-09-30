-- ============================================================
-- SNS自動投稿（Upload-Post経由でTikTok/Instagram/YouTube Shortsへ）
--   投稿キューにUpload-Postの追跡IDと結果を持たせ、cronが
--   「予定時刻を過ぎたキューの投稿」と「処理中の投稿の確定」を行えるようにする。
-- ============================================================

-- Upload-Postの追跡ID（非同期投稿=request_id / 予約投稿=job_id）と生レスポンス
alter table sns_post_queue add column if not exists upload_post_request_id text;
alter table sns_post_queue add column if not exists upload_post_job_id     text;
alter table sns_post_queue add column if not exists platform_result        jsonb;

-- status に 'publishing'（Upload-Post側で処理中）が加わる
-- 'queued' | 'publishing' | 'posted' | 'skipped' | 'failed'

-- cronが「予定時刻を過ぎた投稿待ち」を引くための索引
create index if not exists idx_spq_due on sns_post_queue(scheduled_for) where status = 'queued';
create index if not exists idx_spq_request on sns_post_queue(upload_post_request_id);

-- 自動投稿のON/OFF（既定OFF。公開アカウントへの投稿は取り消せないため明示的に有効化する）
create table if not exists sns_post_settings (
  id           text primary key default 'default',
  auto_publish boolean not null default false,
  updated_at   timestamptz default now()
);
alter table sns_post_settings enable row level security;
create policy "service_role_all" on sns_post_settings using (true);
insert into sns_post_settings (id) values ('default') on conflict (id) do nothing;

-- ============================================================
-- SNS投稿キュー（キュー + ワンタップ投稿）
-- 完成動画をAIで投稿文最適化 → キュー化 → ワンタップ投稿。
-- TikTok/IG公式API接続前は投稿アシスト（コピー+DL+「投稿済み」）にフォールバック。
-- ============================================================
create table if not exists sns_post_queue (
  id            uuid primary key default gen_random_uuid(),
  video_id      uuid not null references sns_videos(id) on delete cascade,
  platform      text not null,                 -- 'tiktok' | 'instagram'
  caption       text not null default '',
  hashtags      jsonb not null default '[]'::jsonb,
  scheduled_for timestamptz,
  status        text not null default 'queued', -- 'queued' | 'posted' | 'skipped' | 'failed'
  post_url      text,
  error         text,
  created_at    timestamptz default now(),
  posted_at     timestamptz
);
alter table sns_post_queue enable row level security;
create policy "service_role_all" on sns_post_queue using (true);
create index if not exists idx_spq_status on sns_post_queue(status);
create index if not exists idx_spq_video on sns_post_queue(video_id);

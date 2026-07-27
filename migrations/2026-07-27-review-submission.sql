-- レビュー管理システム（在宅ワーク案件ナビ / Amazonレビュー案件・工程2以降）
-- 注文確認OK後、友だちごとにトークン付きフォームURLを発行。
-- 顧客はフォームでレビュー下書き(タイトル/本文/画像)を提出→投稿後の反映確認スクショをアップロード
-- →AIが投稿内容と一致するか照合。管理画面で一括管理する。
-- 適用: Supabase MCP apply_migration, name=review_submission。このファイルは記録用。

create table if not exists review_submissions (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid references line_channels(id) on delete cascade,
  friend_id uuid references friends(id) on delete set null,
  line_user_id text,
  token text unique not null,                 -- フォームURLの本人紐付けトークン
  order_number text,                          -- 紐づく注文（注文確認の結果）
  product_name text,                          -- 表示用の商品名
  -- 下書き（顧客提出）
  draft_title text,
  draft_body text,
  draft_image_url text,
  draft_submitted_at timestamptz,
  -- 投稿後の反映確認スクショ
  proof_image_url text,
  proof_submitted_at timestamptz,
  verify_status text,                         -- pending / verified / mismatch / unreadable / error
  verify_reason text,
  verify_result jsonb,
  -- 全体ステータス
  status text not null default 'awaiting_draft', -- awaiting_draft / draft_received / verified / rejected
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_review_submissions_channel on review_submissions(channel_id, created_at desc);
create index if not exists idx_review_submissions_friend on review_submissions(friend_id);
create index if not exists idx_review_submissions_status on review_submissions(status);

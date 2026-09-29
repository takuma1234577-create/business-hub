-- My FITPEAK 注文の引き当て（2026-09-29）
-- 別メールアドレス・ゲスト購入・Amazon注文を、ログイン中の会員の「ご注文」に紐づけて保存する。
-- 同じ注文は1人にだけ紐づく（channel + order_ref で一意）。
create table if not exists public.member_order_claims (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  channel text not null check (channel in ('shopify', 'amazon')),
  order_ref text not null,          -- Shopify: 注文ID / Amazon: 注文番号
  order_label text,                 -- 表示用（#1234 など）
  claimed_at timestamptz not null default now(),
  unique (channel, order_ref)
);
create index if not exists member_order_claims_user_idx on public.member_order_claims (auth_user_id);
alter table public.member_order_claims enable row level security;
-- 読み書きはサーバー（サービスキー）からのみ。ポリシーは作らない。

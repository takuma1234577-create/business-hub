-- FITPEAK PRO（有料会員）: 定期購入エンジンで会員プランを扱うための列
-- 設計: プロジェクト文書 claude/my-fitpeak-pro-sekkei.md

-- 会員の状態（LINEの返信の出し分け・特典の判定に使う）
alter table public.members
  add column if not exists plan text not null default 'free',
  add column if not exists plan_expires_at timestamptz,
  add column if not exists plan_subscription_id uuid;

create index if not exists members_plan_idx on public.members (plan) where plan <> 'free';

-- プランの種類: product（商品のお届け） / membership（会員。配送なし）
alter table public.subscription_plans
  add column if not exists plan_kind text not null default 'product',
  add column if not exists trial_days integer not null default 0;

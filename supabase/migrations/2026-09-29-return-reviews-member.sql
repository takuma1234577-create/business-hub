-- My FITPEAKからの返品・交換申請を、会員と注文に紐づけて記録する（2026-09-29）
alter table public.return_reviews
  add column if not exists auth_user_id uuid,
  add column if not exists shopify_order_id text,
  add column if not exists source text;
create index if not exists return_reviews_shopify_order_idx on public.return_reviews (shopify_order_id);
create index if not exists return_reviews_user_idx on public.return_reviews (auth_user_id);

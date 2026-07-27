-- 在宅ワーク案件ナビ: Amazonレビュー案件の「注文確認」システム
-- 友だちが送った注文完了スクショをAIで解析→SP-APIで実注文を照合→
-- 合致すれば「注文完了」タグを付与し次工程へ、不一致/読取不可なら再送依頼を自動返信。
-- 適用: Supabase MCP apply_migration, name=review_order_verify。このファイルは記録用。

-- 照合結果ログ
create table if not exists review_order_verifications (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid references line_channels(id) on delete cascade,
  friend_id uuid references friends(id) on delete set null,
  line_user_id text,
  image_url text,
  status text not null,                -- verified / mismatch / not_found / cancelled / unreadable / not_order / error
  reason text,
  order_number text,
  extracted jsonb,                     -- AIがスクショから抽出した内容
  order_data jsonb,                    -- SP-APIから取得した実注文スナップショット
  message_id uuid,                     -- 元のchat_messages.id（任意）
  created_at timestamptz not null default now()
);
create index if not exists idx_review_order_verifications_channel on review_order_verifications(channel_id, created_at desc);
create index if not exists idx_review_order_verifications_friend on review_order_verifications(friend_id);
create index if not exists idx_review_order_verifications_order on review_order_verifications(order_number);

-- チャンネル別の設定
create table if not exists review_order_verify_config (
  channel_id uuid primary key references line_channels(id) on delete cascade,
  enabled boolean not null default true,
  auto_reply boolean not null default true,
  tag_id uuid references tags(id) on delete set null,      -- 照合OKで付与するタグ
  allowed_asins text[] not null default '{}',              -- 空なら自社の全注文を許可
  amount_tolerance integer not null default 0,             -- 合計金額の許容差（円）
  max_order_age_days integer not null default 30,          -- これより古い購入日は要確認
  success_message text,                                    -- 照合OK時の返信（nullでデフォルト）
  resend_message text,                                     -- 読取不可時の返信（nullでデフォルト）
  mismatch_message text,                                   -- 不一致時の返信（nullでデフォルト）
  updated_at timestamptz not null default now()
);

-- 「注文完了」タグを在宅ワーク案件ナビ用に用意（無ければ作成）
insert into tags (name, color, channel_id)
select '注文完了', '#16a34a', 'b5f8c901-70d1-4fb7-88bd-02ed32bbe29f'::uuid
where not exists (
  select 1 from tags
  where name = '注文完了' and channel_id = 'b5f8c901-70d1-4fb7-88bd-02ed32bbe29f'::uuid
);

-- 在宅ワーク案件ナビの設定を投入（有効・自動返信ON・上の注文完了タグを紐付け）
insert into review_order_verify_config (channel_id, enabled, auto_reply, tag_id)
select
  'b5f8c901-70d1-4fb7-88bd-02ed32bbe29f'::uuid, true, true,
  (select id from tags where name = '注文完了' and channel_id = 'b5f8c901-70d1-4fb7-88bd-02ed32bbe29f'::uuid limit 1)
on conflict (channel_id) do nothing;

-- TikTok Shop 連携: アクセストークンの期限と shop_cipher（ショップ指定のAPIに必須）を保存する
alter table channel_stores add column if not exists tiktok_token_expires_at timestamptz;
alter table channel_stores add column if not exists tiktok_shop_cipher text;

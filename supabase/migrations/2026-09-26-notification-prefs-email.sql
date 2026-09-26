-- My FITPEAK「通知の設定」（2026-09-26）
-- 方針（集客強化設計書 第6項）：LINEで受け取るのは「セール・新商品のお知らせ」だけ（= campaign）。
-- 価格アラート・大会の続報・記録のリマインドはメールで受け取る（希望者のみ、初期値はOFF）。
-- LINEログインの会員は内部用メール（@line.fitpeak.co）しか持たないため、通知先メールを別に持つ。
alter table public.notification_prefs
  add column if not exists notify_email text,
  add column if not exists email_price_alert boolean not null default false,
  add column if not exists email_contest boolean not null default false,
  add column if not exists email_reminder boolean not null default false;

comment on column public.notification_prefs.campaign is 'LINEで受け取る：セール・新商品のお知らせ（LINEで届くのはこれだけ）';
comment on column public.notification_prefs.notify_email is 'メール通知の送り先（LINEログイン会員は内部メールのため別に入力してもらう）';
comment on column public.notification_prefs.email_price_alert is 'メールで受け取る：価格アラート';
comment on column public.notification_prefs.email_contest is 'メールで受け取る：大会の続報（KINNIKU TIMES）';
comment on column public.notification_prefs.email_reminder is 'メールで受け取る：記録・再測定のリマインド（FITPEAK LAB）';

-- My FITPEAK アンケート：1人1回・クーポン二重発行防止（旧 my-fitpeak から business-hub へ移植したときの補強）
-- アプリ側でも事前チェック＋条件付き更新をしているが、同時送信の競合をDBの一意制約で確実に止める。
-- 既存データ：line_user_id は全件 null、coupon_id の重複なし想定、auth_user_id は新設（2026-10-16 確認）。
-- テスト用アカウント（SURVEY_TEST_EMAILS）は auth_user_id / line_user_id を入れないので何度でも回答できる。
-- 未適用でもアプリは動く（auth_user_id 列が無ければ自動で使わない）。

alter table public.surveys add column if not exists auth_user_id uuid;

create unique index if not exists uq_surveys_auth_user
  on public.surveys (auth_user_id) where auth_user_id is not null;

create unique index if not exists uq_surveys_line_user
  on public.surveys (line_user_id) where line_user_id is not null;

-- 1つのクーポンを2つの回答に結びつけない
create unique index if not exists uq_surveys_coupon
  on public.surveys (coupon_id) where coupon_id is not null;

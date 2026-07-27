-- レビュー管理: 下書きの手動承認フローを追加
-- 承認時に「レビュー実行日 = 購入日 + 10〜15日（ユーザーごとにランダム）」を確定し、
-- ユーザーへLINEで通知する。購入日は注文確認スクショの照合結果(SP-API PurchaseDate)から取得。
-- 適用: Supabase MCP apply_migration, name=review_submission_approval。このファイルは記録用。

alter table review_submissions add column if not exists purchase_date timestamptz; -- 注文の購入日(SP-API)
alter table review_submissions add column if not exists review_date date;          -- 確定したレビュー実行日
alter table review_submissions add column if not exists approved_at timestamptz;    -- 下書き承認日時

-- status に 'approved'（下書き承認済み・投稿待ち）が加わる:
--   awaiting_draft → draft_received → approved → verified / rejected

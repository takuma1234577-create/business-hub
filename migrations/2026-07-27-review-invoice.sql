-- レビュー管理 工程3: レビュー反映確認(星5+下書き一致) → 請求書提出・検証 → 手動承認
-- クラウドワークス経由タグの友だちは請求書をスキップして完了。
-- 請求金額 = 商品代金(注文合計) + 1000円(税込)。
-- 適用: Supabase MCP apply_migration, name=review_invoice。このファイルは記録用。

alter table review_submissions add column if not exists order_total integer;         -- 商品代金(注文合計・円)
alter table review_submissions add column if not exists invoice_url text;             -- 提出された請求書(PDF/画像)
alter table review_submissions add column if not exists invoice_verify_status text;    -- pending/verified/mismatch/unreadable/error
alter table review_submissions add column if not exists invoice_verify_reason text;
alter table review_submissions add column if not exists invoice_result jsonb;          -- AIが読み取った請求書内容
alter table review_submissions add column if not exists invoice_submitted_at timestamptz;

-- status の遷移:
--   awaiting_draft → draft_received → approved → (レビュー反映確認OK)
--     ├ クラウドワークス経由 → completed
--     └ それ以外 → awaiting_invoice → invoice_submitted → (手動承認) → completed
--   （不一致・却下は rejected / 各前段に留まる）

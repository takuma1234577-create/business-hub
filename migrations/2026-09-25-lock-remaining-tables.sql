-- ============================================================================
-- セキュリティ強化 第3段階（2026-09-25）
-- 残っていた「誰でも読み書きできる」ポリシー（roles=public/anon/authenticated, using true）86件を外す。
-- API ゲートウェイのログ（直近24時間＋9/17・20・21・23 の抽出）と Business-hub・Shopify テーマの
-- コードを確認し、ブラウザや他アプリから直接触られていないことを確認済み。
--
-- 残すもの:
--   pc_offers / pc_manual_prices / pc_price_history … 読み取りのみ（fitpeak-price-api が公開キーで読む）
--   amazon_leads … 登録のみ（読み取り不可）
--   members / notification_prefs / notifications / price_alerts … もともと本人の行だけ
-- 置き換えるもの:
--   line_shopify_links … ログイン中のお客様が「自分のメールの行」だけ読める
--   friends … 上の行に紐づく自分のLINE友だち情報だけ読める（My FITPEAK のアカウント画面用）
--
-- 元に戻す場合（1テーブルごと）:
--   create policy service_role_all on public.<table> for all to public using (true) with check (true);
-- ============================================================================
do $$
declare r record;
begin
  for r in
    select tablename, policyname from pg_policies
    where schemaname = 'public' and qual = 'true'
      and roles && array['public','anon','authenticated']::name[]
      and tablename not in ('pc_offers','pc_manual_prices','pc_price_history','amazon_leads')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy lsl_select_own on public.line_shopify_links
  for select to authenticated
  using (lower(shopify_email) = lower(auth.jwt() ->> 'email'));

create policy friends_select_own_link on public.friends
  for select to authenticated
  using (id in (select l.friend_id from public.line_shopify_links l
                where lower(l.shopify_email) = lower(auth.jwt() ->> 'email')));

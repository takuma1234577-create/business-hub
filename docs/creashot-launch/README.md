# クレアショット 定期購入 — 公開手順（2026-09-16）

## 何が変わったか

| 場所 | 内容 |
|---|---|
| Shopify 商品 `8556618743943` | 6バリエーション（1日1本／1日2本 × 1・3・12ヶ月ごと）に再構築。定期購入必須（requiresSellingPlan）。配送プロファイル「クレアチン（送料無料）」に紐づけ済み。状態は **UNLISTED**（直リンクのみ）。 |
| Shopify テーマ | 現行テーマを複製した **「クレアショット販売LP v1 20260916」（未公開）** に `sections/lp-creashot-plans.liquid`（プラン選択フォーム）＋ `assets/creashot-plans.css` / `assets/creashot-plans.js` と `templates/product.creashot.json`（販売LP用テンプレート）を追加。LP本文のLINE登録ボタンはすべて「定期プランを見る」に置き換わる。プラン選択→お届け先・連絡先（EFO：郵便番号で住所自動入力、リアルタイムエラー表示、進捗表示、入力内容の一時保存）を1画面で完結し、チェックアウトには住所・メール・電話を引き継ぐ（残るのはカード番号のみ）。 |
| Supabase | `subscription_plans` に6プラン登録済み。`creashot_reminders` / `creashot_intake_logs` / `creashot_onboarding` テーブル追加。`cancel_reasons` に引き止めアクション追加。 |
| business-hub | `server/creashot-subscription.cjs`（新規）＋ `server/subscription.cjs`（差分）。管理画面「定期購入 → クレアショット」タブ追加。 |
| My FITPEAK | `/creashot` 画面（残量→次回お届け日、休会、プラン変更、解約フロー、LINEリマインダー、今日飲んだ）。ワンタップ自動ログイン（サービスロールキーがある場合）。 |

## 公開までの手順（この順で）

1. **business-hub をデプロイ**
   ```bash
   cd ~/business-hub && vercel --prod
   ```
2. **My FITPEAK をデプロイ**
   ```bash
   cd "~/Desktop/【重要】アプリファイル/01_稼働中/my-fitpeak" && vercel --prod
   ```
   ※ Vercel の環境変数に `SUPABASE_SERVICE_ROLE_KEY` があるとワンタップログインになる（無ければ従来どおりOTPメール）。
3. **Shopify に定期プランを作成**
   business-hub 管理画面 → 定期購入 → 「クレアショット」タブ → 「Shopifyに定期プランを作成／同期」。
   6行すべてに Selling Plan ID が入れば完了（LPの「この内容で予約する」が押せるようになる）。
4. **テーマを公開**
   Shopify 管理画面 → オンラインストア → テーマ → 「クレアショット販売LP v1 20260916」→ 公開。
   （複製元は 9/16 時点の本番テーマ。それ以降にテーマエディタで変更した箇所があれば、公開前に同じ変更を入れる）
5. **商品を公開状態にする**
   商品 → 「FITPEAK クレアショット｜持ち運びクレアチン（定期購入）」→ ステータスを「アクティブ」（今は UNLISTED＝直リンクのみ）。
   販売URL: `https://fitpeak.co/products/持ち運びクレアチン-creashot`
6. **課金cronを有効化**（初回発送が近づいたら）
   定期購入 → 設定 → `billing.cron_enabled = true`。false の間は一切課金しない（予約中は false のままでよい）。
7. **注文確認メールにLINE・My FITPEAKの案内を追加**
   Shopify 管理画面 → 設定 → 通知 → 注文確認 → `order-confirmation-snippet.liquid` の内容を本文の適当な位置に貼る。

## カード情報について

カード番号はLP上では入力できない（PCI DSS／Shopifyの決済画面でのみ入力可能。Basicプランではチェックアウトのカスタマイズ不可）。
そのためLP側で住所・氏名・メール・電話を先に入力させ、`/checkout?checkout[email]=…&checkout[shipping_address][zip]=…` の形で引き継ぎ、チェックアウトで残るのはカード入力だけにしている。カードの入力ミスはShopifyの決済画面がその場で表示する。

## テーマファイルの置き場

`docs/creashot-launch/shopify-theme/` に4ファイル（section / css / js / template）。テーマ側を直したときはここにも同じものを置く。

## テスト手順

1. テーマプレビュー: `https://fitpeak.co/products/持ち運びクレアチン-creashot?preview_theme_id=154853671047`
2. プランを選んで「この内容で予約する」→ チェックアウトに「定期購入（3ヶ月ごと）」と表示されること。
3. Shopify のテスト決済（Bogus Gateway または Shopify Payments テストモード）で注文。
4. business-hub → 定期購入 → 契約 に `pending_first_shipment` で現れること。
5. LINE連携済みのメールなら LINE に、未連携ならメールに「My FITPEAKの案内」が届くこと。
6. My FITPEAK → クレアショット で契約が見えること（メールが違う場合は注文番号で紐づけ）。
7. 通知設定を ON にして時刻を数分後に設定 → 10分以内に LINE が届くこと。

## 予約情報の変更

- 初回お届け予定の表示は 2箇所: テーマ（テーマエディタ → クレアショット 定期プラン → 予約表示）と business-hub（クレアショットタブ → 予約表示）。
- 発売後に予約表示を消す場合はテーマ側を空欄に、`subscription_plans.is_preorder` を false に。

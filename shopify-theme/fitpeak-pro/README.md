# FITPEAK PRO 登録LP（Shopifyテーマのファイル）

fitpeak.co の編集用テーマ（ID 155261403271）に入れているファイルの原本。
テーマ側を直したら、ここも同じ内容にしておく（テーマ編集ルール：プロジェクト文書 claude/shopify-theme-rule.md）。

| ファイル | 役割 |
|---|---|
| templates/product.fitpeak-pro.json | 商品「FITPEAK PRO」（handle fitpeak-pro）のテンプレート。layout は lp-landing。特典はブロックで管理 |
| sections/lp-fitpeak-pro.liquid | 説明＋プラン選択＋登録フォームの一体型LP |
| snippets/fpp-icon.liquid | 線画アイコン |
| assets/fitpeak-pro.css / .js | 見た目と登録フォーム（/cart/add.js → /checkout） |

特典ブロックの「今日から使える」をオフにすると「順次追加」として表示される。まだ使えない特典をオンにしない（景品表示法）。

# 筋トレ最安ナビ 日次ショート自動投稿

毎日19:30(JST)にGitHub Actionsが実行：価格DB取得 → ランキング/値下がり算出 → 動画生成 → Upload-Postで TikTok / Instagram Reels / YouTube Shorts へ投稿。AIの実行時利用はなし。

## 初期設定（ご自身で実施）
1. このフォルダを新規の非公開GitHubリポジトリにアップロード。
2. Settings → Secrets and variables → Actions → Secrets に `UPLOAD_POST_API_KEY` と `UPLOAD_POST_USER`（Upload-Postのプロフィール名）を登録。
3. Actions タブ → daily-short → Run workflow でドライラン（既定は投稿しない。artifactで動画を確認）。
4. 問題なければ Variables に `PUBLISH` = `true` を追加すると実投稿が始まる。止めるときは `false` か削除。

## 仕組み
- `master.json`：価格DBのitem_idと表示名・容量・タンパク質含有率・画像。商品の追加・修正はここ。
- カテゴリは ソイ→クレアチン→EAA・BCAA を日替わりで回し、値下がり（同一販売先で直前価格より2%以上安い）が無いカテゴリは飛ばす。どれも無い日は投稿しない。
- 価格が36時間以上古い商品は除外。動画の安全領域チェックに失敗したら投稿しない（ジョブ失敗）。
- 二重投稿防止：`state/posted.json` に日付を記録。
- 未対応：ホエイ（サイトのランキング取得が別実装のため）。

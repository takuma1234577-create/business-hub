# SNS自動投稿（TikTok / Instagram / YouTube Shorts）

FITPEAKのショート動画を、**1本のAPIリクエストで TikTok・Instagram リール・YouTube Shorts
へ投稿**する仕組み。中継には [Upload-Post](https://www.upload-post.com/) を使う。

各SNSの公式APIは、それぞれ審査（TikTok Content Posting API / Instagram Graph API /
YouTube Data API）と個別実装が必要になる。Upload-Post はその接続を代行してくれるため、
審査を待たずに投稿を自動化できる。

## 全体の流れ

```
台本（sns_scripts）
  → 動画レンダリング（JSON2Video / sns_videos）
  → 投稿キューに追加（POST /api/fitpeak-sns/videos/:id/queue）
      … プラットフォームごとにAIが投稿文・ハッシュタグ・推奨投稿時刻を最適化
  → 投稿（Upload-Post）
      … 自動: cron が予定時刻を過ぎたキューを投稿
      … 手動: POST /api/fitpeak-sns/post-queue/:id/publish（ワンタップ）
  → 投稿完了（post_url を記録）
```

キューの状態（`sns_post_queue.status`）:

| status | 意味 |
|---|---|
| `queued` | 投稿待ち（`scheduled_for` が投稿予定時刻） |
| `publishing` | Upload-Post側で処理中（cronが状況を見て確定させる） |
| `posted` | 投稿完了（`post_url` に投稿URL） |
| `failed` | 失敗（`error` に理由。自動では再試行しない） |
| `skipped` | 見送り |

## セットアップ

1. **Upload-Postでプロフィールを作る**
   Upload-Postの管理画面で「プロフィール」を1つ作り、そこに TikTok・Instagram・YouTube の
   アカウントを接続する。プロフィール名（例: `fitpeak`）が投稿時の宛先になる。

2. **Business-hubの「API設定」に2つ入力する**
   - `Upload-Post APIキー` … Upload-Postの管理画面で発行したAPIキー
   - `Upload-Post プロフィール名` … 手順1で作ったプロフィール名

   入力後、APIキーの「テスト」を押すと、プロフィールと接続済みSNSの一覧が確認できる。
   `GET /api/fitpeak-sns/upload-post/status` でも同じ内容を確認できる。

3. **DBマイグレーションを適用する**
   `migrations/2026-09-30-sns-upload-post.sql` をSupabaseのSQLエディタで実行する。

4. **自動投稿をONにする**（任意）
   ```
   PUT /api/fitpeak-sns/post-settings  { "auto_publish": true }
   ```
   既定はOFF。**公開アカウントへの投稿は取り消せない**ため、明示的にONにするまで
   cronは投稿しない（処理中の投稿の状況確定だけ行う）。OFFの間も、ワンタップ投稿
   （`/post-queue/:id/publish`）は使える。

## 自動投稿の動き（cron）

`/api/daily-cron`（10分間隔）から `/api/fitpeak-sns/cron/publish` が呼ばれ、

1. `publishing` のキューをUpload-Postのステータスで確定させる（最大20件）
2. `auto_publish` がONなら、`scheduled_for` を過ぎた `queued` を投稿する（1回あたり最大5件）

を行う。`scheduled_for` が空のキューは自動投稿の対象外（手動投稿用）。

## 二重投稿の防止

投稿リクエストにはキュー項目のIDを `Idempotency-Key` として付けている。Upload-Post側で
24時間以内の同じキーは1つの投稿にまとめられるため、cronの再実行やワンタップの連打で
同じ動画が2回投稿されることはない。

## プラットフォーム別の扱い

| | 投稿本文 | 公開設定 | 備考 |
|---|---|---|---|
| TikTok | キャプション＋ハッシュタグ | `PUBLIC_TO_EVERYONE` | |
| Instagram | キャプション＋ハッシュタグ | — | `media_type=REELS`（縦動画をリールとして投稿） |
| YouTube Shorts | 1行目が動画タイトル（95文字まで）、全文は説明欄 | `public` | ハッシュタグに `#Shorts` を含める |

## Upload-Postが未設定のとき

投稿アシスト（手動）モードにフォールバックする。`/post-queue/:id/publish` が投稿文と
動画URLを返すので、コピーして各アプリから投稿し、`/post-queue/:id/mark-posted` で
投稿済みにする。

## 関連ファイル

- `server/upload-post.cjs` … Upload-Post APIクライアント
- `server/fitpeak-sns.cjs` … 台本・動画・投稿キュー・自動投稿cron
- `migrations/2026-09-30-sns-upload-post.sql` … 追跡カラムと自動投稿設定

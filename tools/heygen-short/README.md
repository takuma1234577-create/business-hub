# HeyGen ショート動画の自動編集

HeyGen API でアバターの実写トーク素材だけを作り、字幕・フック・ティア表はこちらで合成する。

## 準備
- 環境変数 `HEYGEN_API_KEY`（環境設定で登録。チャットに貼らない）
- `pip install -r requirements.txt`、ffmpeg、日本語フォント（`fonts-noto-cjk`）

## 手順
1. `python3 heygen_generate.py --list` でアバター「SNS TAKUMA」とボイス「Ta U」があるか確認
2. `python3 heygen_generate.py episodes/breakfast-tier.json --out work/breakfast-tier`
   - センテンスごとに1本ずつ生成（字幕なし、1080x1920、話速1.2）
   - 1本だけ作り直すときは `--only 4`
3. `python3 edit.py episodes/breakfast-tier.json --work work/breakfast-tier`
   - 無音を詰めてつなぐ／センテンスごとに寄り・引き／上部にフック→ティア表／下に字幕
   - 出力: `work/breakfast-tier/final.mp4`

## 台本ファイル（episodes/*.json）
- `voice`: 読ませる文（漢字はカタカナ、ひらがなはそのまま、数字もカタカナ）
- `subs`: 字幕（漢字かなまじり、1行ずつ、単語の途中で切らない）
- `show`: `hook`（フック表示）か `board`（ティア表）
- `reveal`: そのセンテンスで埋めるランク（S/A/B/C/D）

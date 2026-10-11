#!/bin/bash
# バズリサーチ用の yt-dlp を business-hub 直下の .venv-ytdlp に入れる(1回だけ)。
# curl_cffi は入れない(入っていると TikTok のアカウント取得が失敗する)。
set -euo pipefail
cd "$(dirname "$0")/.."
PY=$(command -v python3.14 || command -v python3.13 || command -v python3.12 || command -v python3.11 || command -v python3.10 || true)
if [ -z "$PY" ]; then echo "Python 3.10 以上が必要です(brew install python)"; exit 1; fi
"$PY" -m venv .venv-ytdlp
.venv-ytdlp/bin/pip install -q -U yt-dlp
.venv-ytdlp/bin/pip uninstall -y -q curl_cffi 2>/dev/null || true
echo "yt-dlp $(.venv-ytdlp/bin/yt-dlp --version) を入れました"

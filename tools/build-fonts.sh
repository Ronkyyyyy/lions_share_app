#!/bin/bash
# 問題データを差し替えたら実行：使う文字に合わせてフォントを作り直す
#   ./tools/build-fonts.sh <ZenAntique-Regular.ttf> <BodoniModa-VariableFont_opsz,wght.ttf>
# 必要なもの: python3 -m pip install fonttools brotli
set -euo pipefail
cd "$(dirname "$0")/.."
ZEN="$1"; BODONI="$2"
TMP="$(mktemp)"
python3 tools/font_chars.py data/questions.json index.html js/app.js > "$TMP"
python3 -m fontTools.subset "$ZEN" --text-file="$TMP" --flavor=woff2 --layout-features='*' \
  --output-file=fonts/ZenAntique-subset.woff2
python3 -m fontTools.subset "$BODONI" \
  --unicodes="U+0020-007E,U+00A0-00FF,U+2013-2014,U+2018-201D,U+2026,U+2212,U+00B2,U+00B0" \
  --flavor=woff2 --layout-features='*' --output-file=fonts/BodoniModa-subset.woff2
rm -f "$TMP"
ls -la fonts/*.woff2

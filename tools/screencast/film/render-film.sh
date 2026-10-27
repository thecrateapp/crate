#!/usr/bin/env bash
# Renders the films from the captured takes. Run film/render-animatic.sh once first: it cuts the
# soundtracks and stages the fonts in out/film.
#   film/render-film.sh [listen|admin ...] [--formats "16x9 4x5"]
set -euo pipefail
cd "$(dirname "$0")/.."

FILMS=()
FORMATS="16x9 4x5"
while [ $# -gt 0 ]; do
  case "$1" in
    --formats) FORMATS="$2"; shift 2 ;;
    *) FILMS+=("$1"); shift ;;
  esac
done
[ ${#FILMS[@]} -eq 0 ] && FILMS=(listen admin)
STAGE=out/film

if [ -z "${REMOTION_BROWSER:-}" ]; then
  REMOTION_BROWSER=$( (ls -d "$HOME"/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell \
    "$HOME"/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell 2>/dev/null || true) | tail -1)
fi
cp ../../app/web/public/icons/logo.svg "$STAGE/logo.svg"

for film in "${FILMS[@]}"; do
  [ -f "$STAGE/$film.wav" ] || { echo "Missing $STAGE/$film.wav; run film/render-animatic.sh $film first" >&2; exit 1; }
  for format in $FORMATS; do
    npx remotion render remotion/index.ts "$film-film-$format" "$STAGE/$film-film-$format.mp4" \
      --public-dir "$STAGE" ${REMOTION_BROWSER:+--browser-executable "$REMOTION_BROWSER"} \
      --codec h264 --crf 16 --audio-codec aac --log error
    echo "$STAGE/$film-film-$format.mp4"
  done
done

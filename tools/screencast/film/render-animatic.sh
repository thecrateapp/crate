#!/usr/bin/env bash
# Renders the film animatics over their soundtracks.
#   LISTEN_TRACK=/path/primative-people.flac ADMIN_TRACK=/path/lift-me-up.flac film/render-animatic.sh [listen|admin ...]
# The FLACs stay outside the repository; only the beat grids are committed.
set -euo pipefail
cd "$(dirname "$0")/.."

FILMS=("$@")
[ ${#FILMS[@]} -eq 0 ] && FILMS=(listen admin)
STAGE=out/film
WEB=../../app/web

if [ -z "${REMOTION_BROWSER:-}" ]; then
  REMOTION_BROWSER=$( (ls -d "$HOME"/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell \
    "$HOME"/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell 2>/dev/null || true) | tail -1)
fi

mkdir -p "$STAGE/fonts"
cp "$WEB/node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2" "$STAGE/fonts/"
cp "$WEB/public/fonts/bricolage-grotesque-latin-opsz-normal.woff2" "$STAGE/fonts/"

for film in "${FILMS[@]}"; do
  case "$film" in
    listen) track=${LISTEN_TRACK:?Set LISTEN_TRACK to the Primative People (Tale of Us remix) FLAC} ;;
    admin) track=${ADMIN_TRACK:?Set ADMIN_TRACK to the LIFT ME UP FLAC} ;;
    *) echo "Unknown film $film" >&2; exit 1 ;;
  esac
  read -r start duration < <(node -e "const g=require('./film/data/$film.beats.json'); console.log(g.sourceStart, g.duration)")
  fade=$(node -e "console.log(Math.max(0, $duration - 1.5))")
  ffmpeg -hide_banner -loglevel error -y -ss "$start" -t "$duration" -i "$track" \
    -af "afade=t=in:d=0.05,afade=t=out:st=$fade:d=1.5" -ar 48000 "$STAGE/$film.wav"

  for format in 16x9 4x5; do
    npx remotion render remotion/index.ts "$film-animatic-$format" "$STAGE/$film-animatic-$format.mp4" \
      --public-dir "$STAGE" ${REMOTION_BROWSER:+--browser-executable "$REMOTION_BROWSER"} \
      --codec h264 --crf 20 --audio-codec aac --log error
    echo "$STAGE/$film-animatic-$format.mp4"
  done
done

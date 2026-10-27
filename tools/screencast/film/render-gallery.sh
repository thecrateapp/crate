#!/usr/bin/env bash
# Renders the gallery from the captured takes into WebP pairs for app/web and writes its manifest.
#   film/render-gallery.sh
set -euo pipefail
cd "$(dirname "$0")/.."

STAGE=out/film
FRAMES=out/gallery/frames
PORTRAIT=out/gallery/frames-4x5
if [ -z "${REMOTION_BROWSER:-}" ]; then
  REMOTION_BROWSER=$( (ls -d "$HOME"/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell \
    "$HOME"/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell 2>/dev/null || true) | tail -1)
fi

rm -rf "$FRAMES" "$PORTRAIT" ../../app/web/public/gallery
mkdir -p "$FRAMES" "$PORTRAIT"
npx remotion render remotion/index.ts gallery "$FRAMES" --sequence --image-format png --scale 1.3333334 \
  --public-dir "$STAGE" ${REMOTION_BROWSER:+--browser-executable "$REMOTION_BROWSER"} --log error
npx remotion render remotion/index.ts gallery-4x5 "$PORTRAIT" --sequence --image-format png --scale 1.5 \
  --public-dir "$STAGE" ${REMOTION_BROWSER:+--browser-executable "$REMOTION_BROWSER"} --log error
npx tsx film/write-gallery.ts "$FRAMES" "$PORTRAIT"

#!/usr/bin/env bash
# Captures the Admin Stack map with sample data and writes the website's images and loop.
#   make site-stack-map-assets
# Needs ffmpeg (libvpx-vp9, libx264) and cwebp. SITE_CAPTURE_GL passes Chromium GL flags;
# the default uses the GPU, "--use-angle=swiftshader --enable-unsafe-swiftshader" renders in software.
set -euo pipefail
cd "$(dirname "$0")/../.."

RAW=test-results/site-capture
OUT=app/web/public/stack-map
export SITE_CAPTURE_OUT="$RAW"

npx playwright test -c playwright.site-capture.config.ts

mkdir -p "$OUT"
for width in 390 768 1440; do
  cwebp -quiet -q 80 -m 6 -resize "$width" 0 "$RAW/stack-map-3d.png" -o "$OUT/stack-map-3d-$width.webp"
done

crop=$(cat "$RAW/loop-crop.txt")
filters="crop=$crop,fps=30,scale=1280:-2:flags=lanczos"
ffmpeg -loglevel error -y -f concat -safe 0 -i "$RAW/frames.txt" -t 8 -vf "$filters" -an \
  -c:v libvpx-vp9 -b:v 0 -crf 38 -row-mt 1 -deadline good -pix_fmt yuv420p "$OUT/stack-map-3d.webm"
ffmpeg -loglevel error -y -f concat -safe 0 -i "$RAW/frames.txt" -t 8 -vf "$filters" -an \
  -c:v libx264 -crf 27 -preset slow -pix_fmt yuv420p -movflags +faststart "$OUT/stack-map-3d.mp4"

ls -l "$OUT"

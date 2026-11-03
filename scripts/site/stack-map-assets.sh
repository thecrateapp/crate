#!/usr/bin/env bash
# Captures the Admin Stack map and Product with sample data and writes the website's images and loop.
#   make site-stack-map-assets
# Needs ffmpeg (libvpx-vp9, libx264) and cwebp. SITE_CAPTURE_GL passes Chromium GL flags;
# the default uses the GPU, "--use-angle=swiftshader --enable-unsafe-swiftshader" renders in software.
set -euo pipefail
cd "$(dirname "$0")/../.."

RAW=test-results/site-capture
OUT=app/web/public/stack-map
OBS=app/web/public/observability
MAX_FRAME_LUMA=${MAX_FRAME_LUMA:-80}
export SITE_CAPTURE_OUT="$RAW"

npx playwright test -c playwright.site-capture.config.ts

brightest() {
  ffmpeg -loglevel error -i "$1" -vf "scale=128:-2,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-" -f null - |
    awk -F= '/YAVG/ { if ($2 + 0 > max + 0) max = $2 + 0 } END { printf "%d\n", max }'
}

mkdir -p "$OUT" "$OBS"
for width in 390 768 1440; do
  cwebp -quiet -q 80 -m 6 -resize "$width" 0 "$RAW/stack-map-3d.png" -o "$OUT/stack-map-3d-$width.webp"
done

IFS=x read -r still_width still_height < <(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=x "$RAW/stack-map-3d.png")
portrait_x=$((still_width * 12 / 100))
portrait_width=$((still_width * 39 / 100))
cwebp -quiet -q 80 -m 6 -crop "$portrait_x" 0 "$portrait_width" "$still_height" -resize 780 0 \
  "$RAW/stack-map-3d.png" -o "$OUT/stack-map-3d-portrait-780.webp"

cwebp -quiet -q 82 -m 6 "$RAW/product-plays-by-platform.png" -o "$OBS/product-plays-by-platform.webp"

crop=$(cat "$RAW/loop-crop.txt")
filters="crop=$crop,fps=30,scale=1280:-2:flags=lanczos"
ffmpeg -loglevel error -y -f concat -safe 0 -i "$RAW/frames.txt" -t 8 -vf "$filters" -an \
  -c:v libvpx-vp9 -b:v 0 -crf 38 -row-mt 1 -deadline good -pix_fmt yuv420p "$RAW/stack-map-3d.webm"
ffmpeg -loglevel error -y -f concat -safe 0 -i "$RAW/frames.txt" -t 8 -vf "$filters" -an \
  -c:v libx264 -crf 27 -preset slow -pix_fmt yuv420p -movflags +faststart "$RAW/stack-map-3d.mp4"

for format in webm mp4; do
  luma=$(brightest "$RAW/stack-map-3d.$format")
  if ((luma > MAX_FRAME_LUMA)); then
    echo "stack-map-3d.$format has a frame with mean luma $luma (limit $MAX_FRAME_LUMA); recapture" >&2
    exit 1
  fi
  echo "stack-map-3d.$format: brightest frame luma $luma"
done
cp "$RAW/stack-map-3d.webm" "$RAW/stack-map-3d.mp4" "$OUT/"

ls -l "$OUT" "$OBS"

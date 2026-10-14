#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

DEST=../../app/web/public/screencast
FONT=../../app/web/node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2
CHAPTERS=("$@")
[ ${#CHAPTERS[@]} -eq 0 ] && CHAPTERS=(library player radio paths offline)

if [ -z "${REMOTION_BROWSER:-}" ]; then
  REMOTION_BROWSER=$( (ls -d "$HOME"/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell \
    "$HOME"/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell 2>/dev/null || true) | tail -1)
fi
if command -v ffmpeg >/dev/null; then
  FFMPEG=(ffmpeg)
else
  compositor=$(node -p "require('path').dirname(require.resolve('@remotion/compositor-' + process.platform + '-' + process.arch + '/package.json'))")
  FFMPEG=(env "DYLD_LIBRARY_PATH=$compositor" "LD_LIBRARY_PATH=$compositor" "$compositor/ffmpeg")
fi
FFMPEG+=(-hide_banner -loglevel error -y)
TO_TV="scale=in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p"
COLOR=(-colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv)

mkdir -p out/fonts out/render "$DEST"
cp "$FONT" out/fonts/

poster_at() {
  case "$1" in
    library) echo 1 ;;
    player) echo -1.2 ;;
    radio) echo -2 ;;
    paths) echo -2 ;;
    offline) echo -0.4 ;;
  esac
}

for chapter in "${CHAPTERS[@]}"; do
  master="out/render/$chapter.master.mp4"
  rm -rf out/stage
  mkdir -p out/stage
  ln -s ../fonts out/stage/fonts
  ln -s "../$chapter" "out/stage/$chapter"
  for attempt in 1 2 3; do
    [ "${RENDER:-1}" = 0 ] && [ -f "$master" ] && break
    concurrency=()
    [ "$attempt" -gt 1 ] && concurrency=(--concurrency 1)
    npx remotion render remotion/index.ts "$chapter" "$master" \
      --public-dir out/stage --browser-executable "$REMOTION_BROWSER" \
      --codec h264 --crf 12 --log error ${concurrency[@]+"${concurrency[@]}"} && break
    [ "$attempt" -eq 3 ] && exit 1
    echo "Render of $chapter failed, retrying with one tab ($attempt/3)" >&2
    sleep 10
  done

  "${FFMPEG[@]}" -i "$master" -an -vf "$TO_TV" "${COLOR[@]}" -c:v libx264 -preset slow -crf 25 \
    -profile:v high -movflags +faststart "$DEST/$chapter.mp4"
  "${FFMPEG[@]}" -i "$master" -an -vf "$TO_TV" "${COLOR[@]}" -c:v libvpx-vp9 -crf 40 -b:v 0 \
    -deadline good -cpu-used 2 -row-mt 1 "$DEST/$chapter.webm"

  at=$(poster_at "$chapter")
  if [[ "$at" == -* ]]; then seek=(-sseof "$at"); else seek=(-ss "$at"); fi
  "${FFMPEG[@]}" "${seek[@]}" -i "$master" -frames:v 1 -q:v 4 "$DEST/$chapter.jpg"

  ls -l "$DEST/$chapter".{mp4,webm,jpg} | awk '{print $5, $NF}'
done

#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

START="${START:-1.5}"
END="${END:-27.5}"
MASK_UNTIL="${MASK_UNTIL:-12.3}"
POSTER_AT="${POSTER_AT:-11}"
DEST="${DEST:-../../app/web/public/install}"

filter="drawbox=x=118:y=70:w=160:h=30:color=0x0a0a0f:t=fill:enable='between(t,1.9,${MASK_UNTIL})',trim=start=${START}:end=${END},setpts=PTS-STARTPTS,crop=1120:1180:0:0,scale=960:-2:flags=lanczos,fps=25"

mkdir -p "$DEST"
ffmpeg -v error -y -i out/install.mp4 -vf "$filter" -an \
  -c:v libx264 -preset veryslow -tune animation -crf 26 -pix_fmt yuv420p -movflags +faststart \
  "$DEST/install.mp4"
ffmpeg -v error -y -i out/install.mp4 -vf "$filter" -an \
  -c:v libvpx-vp9 -b:v 0 -crf 42 -row-mt 1 -deadline good -cpu-used 1 \
  "$DEST/install.webm"
ffmpeg -v error -y -ss "$POSTER_AT" -i "$DEST/install.mp4" -frames:v 1 out/poster.png
python3 -c "from PIL import Image; Image.open('out/poster.png').convert('RGB').save('$DEST/install.webp', 'WEBP', quality=80, method=6)"
ls -l "$DEST"

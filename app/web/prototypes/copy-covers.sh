#!/usr/bin/env bash
set -euo pipefail

library="${1:?usage: copy-covers.sh <music-library-dir> [limit]}"
limit="${2:-60}"
here="$(cd "$(dirname "$0")" && pwd)"
out="$here/covers"

rm -rf "$out"
mkdir -p "$out"

index=0
while IFS= read -r -d "" cover; do
  index=$((index + 1))
  if command -v sips >/dev/null 2>&1; then
    sips -Z 400 -s format jpeg -s formatOptions 72 "$cover" --out "$out/$index.jpg" >/dev/null
  elif command -v ffmpeg >/dev/null 2>&1; then
    ffmpeg -loglevel error -y -i "$cover" -vf "scale='min(400,iw)':-2" -q:v 4 "$out/$index.jpg"
  else
    cp "$cover" "$out/$index.jpg"
  fi
  [[ "$index" -ge "$limit" ]] && break
done < <(find "$library" -path '*/.crate-trash' -prune -o -iname 'cover.jpg' -print0)

printf '{"count":%d}\n' "$index" > "$out/manifest.json"
echo "copied $index covers to $out"

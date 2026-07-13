#!/usr/bin/env bash
# Federation fixture seed — deterministic split of test-music artists.
#
# Node A gets: Birds In Row
# Node B gets: High Vis, Rival Schools
#
# Usage: scripts/federation-fixture-seed.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

FED_DIR="$REPO_ROOT/test-music-federation"
SRC_DIR="$REPO_ROOT/test-music"

# Source -> target mappings
# Each line: source_subdir|target_node
MAPPINGS=(
  "695179a0-3863-50c2-9302-61f5cf144daa|node-a"     # Birds In Row
  "4d915592-b2a6-5d41-bc2c-9eb3999887a1|node-b"      # High Vis
  "8d3c526e-5058-5a45-b162-de860b237e03|node-b"      # Rival Schools
)

echo "=== Federation fixture seed ==="
echo "Source: $SRC_DIR"
echo "Target: $FED_DIR"
echo ""

missing=0
for mapping in "${MAPPINGS[@]}"; do
  src="${mapping%%|*}"
  if [ ! -d "$SRC_DIR/$src" ]; then
    echo "ERROR: source directory missing: $SRC_DIR/$src"
    missing=1
  fi
done
if [ "$missing" -ne 0 ]; then
  echo ""
  echo "Run this after setting up test-music/ with the expected artists."
  exit 1
fi

for mapping in "${MAPPINGS[@]}"; do
  src="${mapping%%|*}"
  node="${mapping##*|}"
  dst="$FED_DIR/$node/$src"

  if [ -d "$dst" ]; then
    echo "SKIP $src → $node (already exists)"
    continue
  fi

  echo "COPY $src → $node"
  mkdir -p "$FED_DIR/$node"
  cp -R "$SRC_DIR/$src" "$dst"
done

echo ""
echo "Done. Fixture layout:"
echo "  $FED_DIR/node-a/ → Birds In Row"
echo "  $FED_DIR/node-b/ → High Vis, Rival Schools"

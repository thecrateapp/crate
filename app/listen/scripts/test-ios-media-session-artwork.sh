#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SOURCE_DIR="$ROOT_DIR/app/listen/ios/App/App"
TEST_DIR="$ROOT_DIR/app/listen/ios/App/AppTests"
OUTPUT="${TMPDIR:-/tmp}/crate-media-session-artwork-contract"

swiftc \
  "$SOURCE_DIR/MediaSessionArtworkState.swift" \
  "$TEST_DIR/MediaSessionArtworkStateContract.swift" \
  -o "$OUTPUT"
"$OUTPUT"

#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

xcrun swiftc \
  "$ROOT/ios/App/App/ArtworkDownsampler.swift" \
  "$ROOT/ios/App/AppTests/ArtworkDownsamplerContract.swift" \
  -o "$TMP_DIR/artwork-downsampler-contract"

"$TMP_DIR/artwork-downsampler-contract"

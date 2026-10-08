#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

xcrun swiftc \
  "$ROOT/ios/App/App/OfflineAssetIntegrity.swift" \
  "$ROOT/ios/App/AppTests/OfflineAssetIntegrityContract.swift" \
  -o "$TMP_DIR/offline-integrity-contract"

"$TMP_DIR/offline-integrity-contract"

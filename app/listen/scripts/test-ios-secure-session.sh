#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SOURCE_DIR="$ROOT_DIR/app/listen/ios/App/App"
TEST_DIR="$ROOT_DIR/app/listen/ios/App/AppTests"
OUTPUT="${TMPDIR:-/tmp}/crate-secure-session-contract"

swiftc \
  -framework Security \
  "$SOURCE_DIR/CrateSecureSessionStore.swift" \
  "$TEST_DIR/SecureSessionStoreContract.swift" \
  -o "$OUTPUT"
"$OUTPUT"

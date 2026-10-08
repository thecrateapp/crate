#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SOURCE_DIR="$ROOT_DIR/app/listen/ios/App/App"
TEST_DIR="$ROOT_DIR/app/listen/ios/App/AppTests"
OUTPUT="${TMPDIR:-/tmp}/crate-media-session-interruption-contract"

grep -q 'sendControl("pause", source: "audio-interruption")' \
  "$SOURCE_DIR/CrateMediaSessionPlugin.swift"
grep -q 'sendControl("play", source: "audio-interruption-resume")' \
  "$SOURCE_DIR/CrateMediaSessionPlugin.swift"
grep -q 'commandCenter.skipForwardCommand.isEnabled = false' \
  "$SOURCE_DIR/CrateMediaSessionPlugin.swift"
grep -q 'commandCenter.skipBackwardCommand.isEnabled = false' \
  "$SOURCE_DIR/CrateMediaSessionPlugin.swift"
grep -q 'commandCenter.nextTrackCommand.isEnabled = true' \
  "$SOURCE_DIR/CrateMediaSessionPlugin.swift"
grep -q 'commandCenter.previousTrackCommand.isEnabled = true' \
  "$SOURCE_DIR/CrateMediaSessionPlugin.swift"

swiftc \
  "$SOURCE_DIR/MediaSessionInterruptionState.swift" \
  "$TEST_DIR/MediaSessionInterruptionStateContract.swift" \
  -o "$OUTPUT"
"$OUTPUT"

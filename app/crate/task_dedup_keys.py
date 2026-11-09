"""Stable deduplication identities shared across task entrypoints."""

GLOBAL_CATALOG_FULL_DEDUP_KEY = "global-catalog:full"

# analyze_playlist_stems runs one at a time: a wake-up (a Smart Mix playlist turned on,
# tracks added, the backfill yielding) shares the scheduler's key.
SMART_MIX_STEMS_DEDUP_KEY = "schedule:analyze_playlist_stems"

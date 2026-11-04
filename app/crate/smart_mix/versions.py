from __future__ import annotations

from crate.smart_mix.beat_grid import FORMAT_NAME as BEAT_GRID_FORMAT
from crate.smart_mix.policy import PLANNER_POLICY

API_CONTRACT_VERSION = "2026-08"
PROFILE_SCHEMA_VERSION = 1
ANALYZER_VERSION = "smart-mix-audio-v7"
# Readers count profiles of these analyzer versions as current, so moving to a new
# analyzer does not empty playlists, flags or reports before the backfill campaign
# recomputes the library. Profiles are written, and backfill claims target, only
# ANALYZER_VERSION; Admin coverage and track status measure progress against it.
# A track has one profile row, so the version writers produce must be readable from
# the moment it ships or every recomputed track would drop out of those readers.
READABLE_ANALYZER_VERSIONS = (
    ANALYZER_VERSION,
    "smart-mix-audio-v6",
    "smart-mix-audio-v5",
)
PYTHON_ANALYZER = "crate-python"
MEASUREMENT_VERSION = "bs1770-v1"
PLANNER_IDENTIFIER = PLANNER_POLICY.identifier
PLANNER_POLICY_VERSION = PLANNER_POLICY.version


__all__ = [
    "ANALYZER_VERSION",
    "API_CONTRACT_VERSION",
    "BEAT_GRID_FORMAT",
    "MEASUREMENT_VERSION",
    "PLANNER_IDENTIFIER",
    "PLANNER_POLICY_VERSION",
    "PROFILE_SCHEMA_VERSION",
    "PYTHON_ANALYZER",
    "READABLE_ANALYZER_VERSIONS",
]

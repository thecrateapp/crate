from __future__ import annotations

from crate.smart_mix.beat_grid import FORMAT_NAME as BEAT_GRID_FORMAT
from crate.smart_mix.policy import PLANNER_POLICY, PLANNER_POLICY_V3

API_CONTRACT_VERSION = "2026-08"
PROFILE_SCHEMA_VERSION = 1
ANALYZER_VERSION = "smart-mix-audio-v10"
# Readers count profiles of these analyzer versions as current, so moving to a new
# analyzer does not empty playlists, flags or reports before the backfill campaign
# recomputes the library. Profiles are written, and backfill claims target, only
# ANALYZER_VERSION; Admin coverage and track status measure progress against it.
# A track has one profile row, so the version writers produce must be readable from
# the moment it ships or every recomputed track would drop out of those readers.
READABLE_ANALYZER_VERSIONS = (
    ANALYZER_VERSION,
    "smart-mix-audio-v9",
    "smart-mix-audio-v8",
    "smart-mix-audio-v7",
    "smart-mix-audio-v6",
    "smart-mix-audio-v5",
)
# Readers accept every profile schema up to the current one. Schema 2 only adds the
# nullable structure columns, so a schema-1 row still describes the track; Admin
# coverage, the backfill and track status measure progress against the current one.
READABLE_PROFILE_VERSIONS = tuple(range(PROFILE_SCHEMA_VERSION, 0, -1))
PYTHON_ANALYZER = "crate-python"
MEASUREMENT_VERSION = "bs1770-v1"
# The default planner: plans requested without a version, capabilities and the
# VirtualDJ contract.
PLANNER_IDENTIFIER = PLANNER_POLICY.identifier
PLANNER_POLICY_VERSION = PLANNER_POLICY.version
# Every planner the plan API serves (SM3-D3), default first.
PLANNER_IDENTIFIERS = (PLANNER_IDENTIFIER, PLANNER_POLICY_V3.identifier)
# Planners whose plans read phrases and the energy curve (SM3-D3). Profile reads for
# any other planner leave the structure columns out, so v2 planning reads what it did
# before the structure was persisted.
STRUCTURE_PLANNER_IDENTIFIERS = frozenset({PLANNER_POLICY_V3.identifier})


def planner_reads_structure(planner_identifier: str) -> bool:
    return planner_identifier in STRUCTURE_PLANNER_IDENTIFIERS


__all__ = [
    "ANALYZER_VERSION",
    "API_CONTRACT_VERSION",
    "BEAT_GRID_FORMAT",
    "MEASUREMENT_VERSION",
    "PLANNER_IDENTIFIER",
    "PLANNER_IDENTIFIERS",
    "PLANNER_POLICY_VERSION",
    "PROFILE_SCHEMA_VERSION",
    "PYTHON_ANALYZER",
    "READABLE_ANALYZER_VERSIONS",
    "READABLE_PROFILE_VERSIONS",
    "STRUCTURE_PLANNER_IDENTIFIERS",
    "planner_reads_structure",
]

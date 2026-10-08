"""Read-only Smart Mix coverage and checkpoint status."""

from __future__ import annotations

from crate.db.ops_runtime import get_ops_runtime_state
from crate.smart_mix.versions import ANALYZER_VERSION, PROFILE_SCHEMA_VERSION


SMART_MIX_PROFILE_VERSION = PROFILE_SCHEMA_VERSION
SMART_MIX_ANALYZER_VERSION = ANALYZER_VERSION
COVERAGE_STATE_KEY = "smart_mix:coverage"
CAMPAIGN_STATE_KEY = "smart_mix:backfill_campaign"


def get_smart_mix_admin_status() -> dict:
    snapshot = get_ops_runtime_state(COVERAGE_STATE_KEY)
    if not snapshot or snapshot.get("analyzer_version") != SMART_MIX_ANALYZER_VERSION:
        return _empty_status()
    refreshed_at = snapshot.pop("updated_at", None)
    return {**snapshot, "refreshed_at": refreshed_at}


def get_smart_mix_campaign_status() -> dict | None:
    return get_ops_runtime_state(CAMPAIGN_STATE_KEY)


def _empty_status() -> dict:
    return {
        "profile_version": SMART_MIX_PROFILE_VERSION,
        "analyzer_version": SMART_MIX_ANALYZER_VERSION,
        "total_tracks": 0,
        "current_profiles": 0,
        "stale_profiles": 0,
        "missing_profiles": 0,
        "coverage_percent": 0.0,
        "quality": {"full": 0, "partial": 0, "legacy": 0, "unavailable": 0},
        "processing": {
            "pending": 0,
            "active": 0,
            "failed": 0,
            "exhausted": 0,
            "completed": 0,
        },
        "refreshed_at": None,
    }


__all__ = [
    "SMART_MIX_ANALYZER_VERSION",
    "SMART_MIX_PROFILE_VERSION",
    "get_smart_mix_admin_status",
    "get_smart_mix_campaign_status",
]

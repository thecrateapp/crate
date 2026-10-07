"""Pin the keys Listen reads from the persisted stats dashboard.

The dashboard contract is additive: new fields may appear, but every key
listed in the fixture must stay present in both the built and cold payloads.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from tests.conftest import PG_AVAILABLE
from tests.stats_history import seed_listening_history

_CONTRACT = json.loads(
    (Path(__file__).parent / "fixtures" / "stats_dashboard_contract.json").read_text()
)


def _missing_keys(payload: dict) -> list[str]:
    missing = [
        f"top_level.{key}" for key in _CONTRACT["top_level"] if key not in payload
    ]
    for section, keys in _CONTRACT.items():
        if section == "top_level":
            continue
        value = payload.get(section) or {}
        missing.extend(f"{section}.{key}" for key in keys if key not in value)
    return missing


def test_cold_dashboard_satisfies_the_contract():
    from crate.db.user_stats_dashboard_surface import _cold_dashboard

    assert _missing_keys(_cold_dashboard("30d", None, "user:1:30d")) == []


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
@pytest.mark.parametrize("window", ["30d", "365d", "all_time"])
def test_built_dashboard_satisfies_the_contract(pg_db, window):
    from crate.db.repositories.user_library_aggregate_runner import (
        recompute_user_listening_aggregates,
    )
    from crate.db.user_stats_dashboard_surface import build_user_stats_dashboard

    seed_listening_history(events=300, days=60)
    recompute_user_listening_aggregates(1)

    payload = build_user_stats_dashboard(
        user_id=1,
        window=window,
        month=None,
        tracks_limit=12,
        artists_limit=10,
        albums_limit=12,
        genres_limit=10,
        replay_limit=36,
    )

    assert _missing_keys(payload) == []
    assert payload["overview"]["play_count"] > 0

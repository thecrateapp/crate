from __future__ import annotations

from crate.db.home_debug import collect_home_debug
from crate.db.home_personalized_sections import build_home_discovery_payload
from crate.db.ui_snapshot_store import get_or_build_ui_snapshot


def get_cached_home_discovery(user_id: int, *, fresh: bool = False) -> dict:
    return get_or_build_ui_snapshot(
        scope="home:discovery",
        subject_key=str(user_id),
        max_age_seconds=600,
        fresh=fresh,
        allow_stale_on_error=True,
        stale_max_age_seconds=3600,
        build=lambda: get_home_discovery(user_id),
    )


def get_home_discovery(user_id: int) -> dict:
    return build_home_discovery_payload(user_id)


def get_home_discovery_debug(user_id: int) -> dict:
    with collect_home_debug() as diagnostics:
        build_home_discovery_payload(user_id)
    return diagnostics


__all__ = [
    "get_cached_home_discovery",
    "get_home_discovery",
    "get_home_discovery_debug",
]

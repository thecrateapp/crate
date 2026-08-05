from __future__ import annotations

from crate.db.home_hero_scoring import rotate_home_hero_rows
from crate.db.home_debug import collect_home_debug
from crate.db.home_personalized_collections import get_home_recently_played
from crate.db.home_personalized_sections import build_home_discovery_payload
from crate.db.repositories.tasks import create_task_dedup
from crate.db.ui_snapshot_store import get_or_build_ui_snapshot
from crate.db.ui_snapshot_reads import get_ui_snapshot
from crate.db.ui_snapshot_shared import decorate_snapshot
from crate.db.ui_snapshot_writes import upsert_ui_snapshot

_HOME_MAX_AGE_SECONDS = 600
_HOME_STALE_MAX_AGE_SECONDS = 3600


def _schedule_home_refresh(user_id: int) -> None:
    create_task_dedup(
        "refresh_home_discovery_snapshot",
        {"user_id": user_id},
        dedup_key=f"home-discovery:{user_id}",
    )


def _merge_recently_played(user_id: int, payload: dict) -> dict:
    recent = get_ui_snapshot(
        "home:recently-played",
        str(user_id),
        max_age_seconds=_HOME_STALE_MAX_AGE_SECONDS,
    )
    if not recent:
        return payload
    merged = dict(payload)
    recent_payload = decorate_snapshot(recent, stale=False)
    merged["recently_played"] = recent_payload.get("recently_played", [])
    return merged


def _rotate_home_hero_payload(user_id: int, payload: dict) -> dict:
    hero = payload.get("hero")
    if not isinstance(hero, list) or len(hero) <= 1:
        return payload
    rotated = rotate_home_hero_rows(hero, user_id=user_id)
    if rotated == hero:
        return payload
    result = dict(payload)
    result["hero"] = rotated
    return result


def _cold_home_payload(user_id: int) -> dict:
    return {
        "hero": None,
        "recently_played": [],
        "custom_mixes": [],
        "suggested_albums": [],
        "recommended_tracks": [],
        "radio_stations": [],
        "favorite_artists": [],
        "essentials": [],
        "recent_global_artists": [],
        "replay": {"items": []},
        "upcoming": [],
        "snapshot": {
            "scope": "home:discovery",
            "subject_key": str(user_id),
            "version": 0,
            "stale": True,
            "pending": True,
        },
    }


def get_cached_home_discovery(user_id: int, *, fresh: bool = False) -> dict:
    if fresh:
        payload = get_or_build_ui_snapshot(
            scope="home:discovery",
            subject_key=str(user_id),
            max_age_seconds=_HOME_MAX_AGE_SECONDS,
            fresh=True,
            allow_stale_on_error=True,
            stale_max_age_seconds=_HOME_STALE_MAX_AGE_SECONDS,
            build=lambda: get_home_discovery(user_id),
        )
        return _rotate_home_hero_payload(user_id, payload)

    cached = get_ui_snapshot(
        "home:discovery",
        str(user_id),
        max_age_seconds=_HOME_MAX_AGE_SECONDS,
    )
    if cached:
        payload = _merge_recently_played(user_id, decorate_snapshot(cached))
        return _rotate_home_hero_payload(user_id, payload)

    stale = get_ui_snapshot(
        "home:discovery",
        str(user_id),
        max_age_seconds=_HOME_STALE_MAX_AGE_SECONDS,
    )
    _schedule_home_refresh(user_id)
    if stale:
        payload = _merge_recently_played(user_id, decorate_snapshot(stale, stale=True))
        return _rotate_home_hero_payload(user_id, payload)
    return _cold_home_payload(user_id)


def refresh_home_recently_played_snapshot(user_id: int) -> dict:
    saved = upsert_ui_snapshot(
        "home:recently-played",
        str(user_id),
        {"recently_played": get_home_recently_played(user_id)},
        stale_after_seconds=_HOME_MAX_AGE_SECONDS,
    )
    return decorate_snapshot(saved)


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
    "refresh_home_recently_played_snapshot",
]

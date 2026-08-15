from __future__ import annotations

import logging

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
log = logging.getLogger(__name__)


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
    result = dict(payload)
    changed = False

    hero = payload.get("hero")
    if isinstance(hero, list) and len(hero) > 1:
        rotated = rotate_home_hero_rows(hero, user_id=user_id)
        if rotated != hero:
            result["hero"] = rotated
            changed = True

    surfaces = payload.get("hero_surfaces")
    if isinstance(surfaces, dict):
        rotated_surfaces = dict(surfaces)
        for composition in ("desktop", "mobile"):
            surface = surfaces.get(composition)
            if not isinstance(surface, dict):
                continue
            artists = surface.get("artists")
            if not isinstance(artists, list) or len(artists) <= 1:
                continue
            rotated_artists = rotate_home_hero_rows(artists, user_id=user_id)
            if rotated_artists != artists:
                rotated_surfaces[composition] = {**surface, "artists": rotated_artists}
                changed = True
        if changed:
            result["hero_surfaces"] = rotated_surfaces

    return result if changed else payload


def _cold_home_payload(user_id: int) -> dict:
    return {
        "hero": None,
        "hero_surfaces": None,
        "recently_played": [],
        "custom_mixes": [],
        "suggested_albums": [],
        "upcoming_albums": [],
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
    if stale:
        _schedule_home_refresh(user_id)
        payload = _merge_recently_played(user_id, decorate_snapshot(stale, stale=True))
        return _rotate_home_hero_payload(user_id, payload)

    # A cold request is common immediately after a cache invalidation (for
    # example, when release metadata changes). Returning an empty home here
    # makes the client keep rendering a blank/stale rail until a worker happens
    # to finish. Build the canonical payload once so the first request gets
    # the same data as the warmed path.
    try:
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
    except Exception:
        log.warning(
            "Cold home discovery build failed for user %s", user_id, exc_info=True
        )
        _schedule_home_refresh(user_id)
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

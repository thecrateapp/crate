from __future__ import annotations

import logging
import time
from typing import Any

from crate.db.cache_store import get_cache, set_cache
from crate.db.home_discovery_surface import get_cached_home_discovery
from crate.db.home_personalized_discovery import get_home_section
from crate.db.repositories.tasks import create_task_dedup

_FRESH_MAX_AGE_SECONDS = 300
_STALE_MAX_AGE_SECONDS = 3600
_CACHE_TTL_SECONDS = 3600
_DEFAULT_SECTION_LIMIT = 42
log = logging.getLogger(__name__)

_SECTION_METADATA = {
    "recently-played": (
        "Recently played",
        "Albums, artists and playlists you touched most recently.",
        "recently_played",
    ),
    "custom-mixes": (
        "Custom mixes",
        "Dynamic playlists shaped around your own listening profile.",
        "custom_mixes",
    ),
    "suggested-albums": (
        "Suggested new albums for you",
        "Recent releases from the artists you already care about.",
        "suggested_albums",
    ),
    "upcoming-albums": (
        "What's coming up",
        "Upcoming releases, starting with the nearest date.",
        "upcoming_albums",
    ),
    "recommended-tracks": (
        "Recommended new tracks",
        "Fresh cuts from artists and albums that line up with your taste.",
        "recommended_tracks",
    ),
    "radio-stations": (
        "Radio stations",
        "Artist and album radios seeded from the things you replay the most.",
        "radio_stations",
    ),
    "favorite-artists": (
        "Favorite artists",
        "Your most played names over the last few months.",
        "favorite_artists",
    ),
    "core-tracks": (
        "Artist Sets",
        "Discovery-forward artist sets, ending with familiar anchors.",
        "essentials",
    ),
}


def _cache_key(user_id: int, section_id: str, limit: int) -> str:
    return f"home_section:v5:global:{user_id}:{section_id}:{limit}"


def _schedule_home_refresh(user_id: int) -> None:
    create_task_dedup(
        "refresh_home_discovery_snapshot",
        {"user_id": user_id, "include_sections": True},
        dedup_key=f"home-discovery:{user_id}",
    )


def _pack(payload: dict) -> dict[str, Any]:
    return {
        "_home_section_cached_at": time.time(),
        "_home_section_payload": payload,
    }


def _unpack(value: Any, *, max_age_seconds: int) -> dict | None:
    if not isinstance(value, dict):
        return None
    payload = value.get("_home_section_payload")
    cached_at = value.get("_home_section_cached_at")
    if isinstance(payload, dict) and isinstance(cached_at, int | float):
        if time.time() - float(cached_at) <= max_age_seconds:
            return payload
        return None
    return value


def _discovery_fallback(
    user_id: int,
    section_id: str,
    *,
    limit: int,
) -> dict | None:
    metadata = _SECTION_METADATA.get(section_id)
    if metadata is None:
        return None
    title, subtitle, discovery_key = metadata
    discovery = get_cached_home_discovery(user_id)
    items = discovery.get(discovery_key) if isinstance(discovery, dict) else None
    return {
        "id": section_id,
        "title": title,
        "subtitle": subtitle,
        "items": list(items or [])[:limit],
    }


def get_cached_home_section(
    user_id: int,
    section_id: str,
    *,
    limit: int = _DEFAULT_SECTION_LIMIT,
    fresh: bool = False,
) -> dict | None:
    if section_id not in _SECTION_METADATA:
        return None

    key = _cache_key(user_id, section_id, limit)
    if fresh:
        section = get_home_section(user_id, section_id, limit)
        if section is not None:
            set_cache(key, _pack(section), ttl=_CACHE_TTL_SECONDS)
        return section

    cached_value = get_cache(key, max_age_seconds=_FRESH_MAX_AGE_SECONDS)
    cached = _unpack(cached_value, max_age_seconds=_FRESH_MAX_AGE_SECONDS)
    if cached is not None:
        return cached

    stale_value = get_cache(key, max_age_seconds=_STALE_MAX_AGE_SECONDS)
    stale = _unpack(stale_value, max_age_seconds=_STALE_MAX_AGE_SECONDS)
    if stale is not None:
        _schedule_home_refresh(user_id)
        return stale

    # Expanded sections must not depend on a previously warmed home snapshot.
    # Otherwise the first View all request after invalidation renders an empty
    # page while the worker rebuilds the cache in the background.
    try:
        section = get_home_section(user_id, section_id, limit)
        if section is not None:
            set_cache(key, _pack(section), ttl=_CACHE_TTL_SECONDS)
            return section
    except Exception:
        log.warning(
            "Cold home section build failed for user %s (%s)",
            user_id,
            section_id,
            exc_info=True,
        )

    _schedule_home_refresh(user_id)
    return _discovery_fallback(user_id, section_id, limit=limit)


def warm_home_sections(
    user_id: int,
    *,
    limit: int = _DEFAULT_SECTION_LIMIT,
) -> dict[str, dict]:
    warmed: dict[str, dict] = {}
    for section_id in _SECTION_METADATA:
        section = get_cached_home_section(
            user_id,
            section_id,
            limit=limit,
            fresh=True,
        )
        if section is not None:
            warmed[section_id] = section
    return warmed


__all__ = ["get_cached_home_section", "warm_home_sections"]

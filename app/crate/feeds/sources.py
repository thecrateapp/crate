"""Selection rules for Bandcamp RSS discovery candidates."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any
from urllib.parse import urlsplit

from crate.bandcamp.client import is_bandcamp_host


_ASSOCIATION_PRIORITY = {
    "followed_artist": 0,
    "bandcamp_wishlist": 1,
    "bandcamp_following": 2,
    "explicit_artist_url": 3,
}
_MAX_CANDIDATES = 1000


def _normalize_artist_url(value: Any) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    parsed = urlsplit(raw)
    host = (parsed.hostname or "").lower().rstrip(".")
    if parsed.scheme.casefold() != "https" or not is_bandcamp_host(host):
        return None
    if host in {"bandcamp.com", "www.bandcamp.com"}:
        return None
    try:
        port = parsed.port
    except ValueError:
        return None
    if parsed.username or parsed.password or port is not None:
        return None
    return f"https://{host}"


def _candidate(row: Mapping[str, Any]) -> dict[str, Any] | None:
    method = str(row.get("association_method") or "").strip()
    if method not in _ASSOCIATION_PRIORITY:
        return None
    artist_url = _normalize_artist_url(row.get("artist_url"))
    if not artist_url:
        return None
    artist_id = row.get("artist_id")
    try:
        artist_id = int(artist_id) if artist_id is not None else None
    except (TypeError, ValueError):
        artist_id = None
    artist_name = str(row.get("artist_name") or "").strip() or None
    return {
        "artist_id": artist_id,
        "artist_name": artist_name,
        "artist_url": artist_url,
        "association_method": method,
    }


def select_bandcamp_feed_candidates(
    rows: Sequence[Mapping[str, Any]], *, limit: int = 25
) -> tuple[dict[str, Any], ...]:
    """Normalize and deduplicate candidates, keeping the strongest association."""
    bounded_limit = max(1, min(int(limit), _MAX_CANDIDATES))
    selected: dict[str, tuple[int, dict[str, Any]]] = {}
    for row in rows:
        candidate = _candidate(row)
        if candidate is None:
            continue
        key = candidate["artist_url"]
        priority = _ASSOCIATION_PRIORITY[candidate["association_method"]]
        current = selected.get(key)
        if current is None:
            selected[key] = (priority, candidate)
            continue
        current_priority, current_candidate = current
        if priority < current_priority or (
            priority == current_priority
            and current_candidate["artist_id"] is None
            and candidate["artist_id"] is not None
        ):
            selected[key] = (priority, candidate)
        elif current_candidate["artist_name"] is None and candidate["artist_name"]:
            selected[key] = (
                current_priority,
                {**current_candidate, "artist_name": candidate["artist_name"]},
            )

    return tuple(candidate for _, candidate in list(selected.values())[:bounded_limit])


__all__ = ["select_bandcamp_feed_candidates"]

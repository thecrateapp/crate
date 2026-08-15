from __future__ import annotations

from datetime import date, datetime

from crate.db.queries.global_catalog import get_global_radio_seed_tracks
from crate.db.repositories.global_user_library import list_global_collection_albums


def global_artist_uids_from_context(context: dict, limit: int = 12) -> list[str]:
    seen: set[str] = set()
    uids: list[str] = []
    for section in ("top_artists", "followed"):
        for row in context.get(section) or []:
            uid = str(row.get("global_artist_uid") or "").strip()
            if not uid or uid in seen:
                continue
            seen.add(uid)
            uids.append(uid)
            if len(uids) >= limit:
                return uids
    return uids


def global_recommended_track_rows(
    global_artist_uids: list[str], *, limit: int
) -> list[dict]:
    rows: list[dict] = []
    seen: set[str] = set()
    for global_artist_uid in global_artist_uids[:12]:
        seed = get_global_radio_seed_tracks(
            "artist", global_artist_uid, limit=max(limit, 12)
        )
        for row in (seed or {}).get("tracks") or []:
            key = _track_key(row)
            if not key or key in seen:
                continue
            seen.add(key)
            rows.append(row)
            if len(rows) >= limit:
                return rows
    return rows


def merge_global_track_rows(
    local_rows: list[dict], global_rows: list[dict], *, limit: int
) -> list[dict]:
    merged: list[dict] = []
    seen: set[str] = set()
    for row in [*local_rows, *global_rows]:
        key = _track_key(row)
        if not key or key in seen:
            continue
        seen.add(key)
        merged.append(row)
        if len(merged) >= limit:
            return merged
    return merged


def global_suggested_albums(limit: int) -> list[dict]:
    requested_limit = max(1, int(limit or 1))
    candidate_limit = min(requested_limit * 4, 2000)
    return [
        {
            "album_id": row.get("id"),
            "global_album_uid": row.get("global_album_uid"),
            "global_artist_uid": row.get("global_artist_uid"),
            "album_entity_uid": row.get("album_entity_uid"),
            "album_slug": row.get("slug"),
            "artist_name": row.get("artist"),
            "artist_id": row.get("artist_id"),
            "artist_entity_uid": row.get("artist_entity_uid"),
            "artist_slug": row.get("artist_slug"),
            "album_name": row.get("name"),
            "year": row.get("year"),
            "release_date": row.get("release_date"),
            "cover_url": row.get("cover_url"),
        }
        for row in list_global_collection_albums(limit=candidate_limit)
        if row.get("artist") and row.get("name")
    ]


def merge_suggested_albums(
    local_albums: list[dict], global_albums: list[dict], *, limit: int
) -> list[dict]:
    candidates: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for album in [*global_albums, *local_albums]:
        key = (
            (album.get("artist_name") or "").strip().casefold(),
            (album.get("album_name") or "").strip().casefold(),
        )
        if not key[0] or not key[1] or key in seen:
            continue
        seen.add(key)
        candidates.append(album)

    candidates.sort(key=_suggested_album_sort_key, reverse=True)
    return candidates[: max(0, int(limit or 0))]


def _suggested_album_sort_key(album: dict) -> tuple[bool, str, bool, str, bool]:
    release_date = _release_date_value(album.get("release_date"))
    year = str(album.get("year") or "").strip()
    return (
        bool(release_date),
        release_date,
        bool(year),
        year,
        bool(album.get("global_album_uid")),
    )


def _release_date_value(value: object) -> str:
    if isinstance(value, (date, datetime)):
        return value.isoformat()[:10]
    return str(value or "").strip()[:10]


def _track_key(row: dict) -> str | None:
    for key in ("global_track_uid", "track_entity_uid", "track_id", "track_path"):
        value = row.get(key)
        if value is not None:
            return f"{key}:{value}"
    return None


__all__ = [
    "global_artist_uids_from_context",
    "global_recommended_track_rows",
    "global_suggested_albums",
    "merge_global_track_rows",
    "merge_suggested_albums",
]

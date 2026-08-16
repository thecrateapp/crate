from __future__ import annotations

from datetime import date, datetime, timezone


_PRE_RELEASE_STATUSES = {
    "pre_release",
    "pre-release",
    "prerelease",
    "upcoming",
}


def release_date_value(value: object) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def is_pre_release_album(album: dict) -> bool:
    if album.get("is_pre_release") is True:
        return True
    status = str(album.get("status") or "").strip().lower().replace(" ", "_")
    return status in _PRE_RELEASE_STATUSES


def is_upcoming_album(album: dict, *, today: date | None = None) -> bool:
    release_date = release_date_value(album.get("release_date"))
    return release_date is not None and release_date > (
        today or datetime.now(timezone.utc).date()
    )


def filter_published_albums(
    albums: list[dict], *, today: date | None = None
) -> list[dict]:
    return [
        dict(album)
        for album in albums
        if not is_pre_release_album(album) and not is_upcoming_album(album, today=today)
    ]


def filter_upcoming_albums(
    albums: list[dict], *, today: date | None = None
) -> list[dict]:
    upcoming = [
        dict(album) for album in albums if is_upcoming_album(album, today=today)
    ]
    upcoming.sort(
        key=lambda album: release_date_value(album.get("release_date")) or date.max
    )
    return upcoming


def album_identity(album: dict) -> tuple[str, str]:
    return (
        str(album.get("artist_name") or "").strip().casefold(),
        str(album.get("album_name") or "").strip().casefold(),
    )


def merge_upcoming_albums(
    local_albums: list[dict],
    global_albums: list[dict],
    *,
    limit: int,
    today: date | None = None,
) -> list[dict]:
    merged: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for album in [*local_albums, *global_albums]:
        key = album_identity(album)
        if not key[0] or not key[1] or key in seen:
            continue
        seen.add(key)
        merged.append(dict(album))

    return filter_upcoming_albums(merged, today=today)[: max(0, int(limit or 0))]


__all__ = [
    "album_identity",
    "filter_published_albums",
    "filter_upcoming_albums",
    "is_pre_release_album",
    "is_upcoming_album",
    "merge_upcoming_albums",
    "release_date_value",
]

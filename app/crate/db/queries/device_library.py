"""Device browse and queue reads (AA3): compact, keyset-paged library pages.

These back ``/api/me/device/*``, the API Android Auto browses through the
native media service. Every public function runs exactly one statement and
only reads the caller's own library (saved albums, followed artists, visible
playlists) or the shared local catalogue (album and artist pages, tracks by
entity). Long lists page with keysets over a stable order, so a client paging
through a list never repeats or skips rows when an item is added. Nothing here
aggregates over ``library_tracks``: lookups are primary-key or indexed probes,
and track lists are batched with ``ANY(:uids)``.

Only local items with an ``entity_uid`` are listed: the native player streams
``/api/tracks/by-entity/{uid}/stream`` and the device token's artwork routes
are the local ones.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.tx import read_scope

DEVICE_PAGE_LIMIT = 500
DEVICE_ARTIST_ALBUM_LIMIT = 200


def _fetch(limit: int) -> int:
    return max(1, min(int(limit), DEVICE_PAGE_LIMIT)) + 1


def _run(session: Session | None, impl):
    if session is not None:
        return impl(session)
    with read_scope() as current:
        return impl(current)


def _page(rows: list[dict], limit: int, keys) -> tuple[list[dict], list[Any] | None]:
    page_size = max(1, min(int(limit), DEVICE_PAGE_LIMIT))
    page = rows[:page_size]
    next_after = keys(page[-1]) if len(rows) > page_size and page else None
    return page, next_after


def coerce_keyset(after: Sequence[Any], types: Sequence[type]) -> list[Any]:
    """Validate keyset values decoded from a cursor; raise ValueError."""
    invalid = ValueError("cursor does not match the node")
    if len(after) != len(types):
        raise invalid
    values: list[Any] = []
    for value, expected in zip(after, types):
        if isinstance(value, bool):
            raise invalid
        if expected is int:
            if not isinstance(value, int) or not -(2**63) <= value < 2**63:
                raise invalid
            values.append(value)
        elif expected is float:
            if not isinstance(value, int | float) or not math.isfinite(value):
                raise invalid
            values.append(float(value))
        elif expected is str:
            if not isinstance(value, str) or len(value) > 512:
                raise invalid
            values.append(value)
        else:
            if isinstance(value, datetime):
                parsed = value
            elif isinstance(value, str):
                parsed = datetime.fromisoformat(value)
            else:
                raise invalid
            if parsed.tzinfo is None:
                raise invalid
            values.append(parsed)
    return values


# ── Saved albums ─────────────────────────────────────────────────

SAVED_ALBUM_KEYS: tuple[type, ...] = (datetime, int)  # saved at, album id (desc)

_SAVED_ALBUMS_SQL = """
WITH saved AS (
    -- Canonical saves are global; only the ones with a local album are listed.
    SELECT s.created_at AS saved_at, ga.local_album_id AS album_id
    FROM user_global_album_saves s
    JOIN global_catalog_albums ga ON ga.global_album_uid = s.global_album_uid
    WHERE s.user_id = :user_id AND ga.local_album_id IS NOT NULL
    UNION ALL
    SELECT legacy.created_at, legacy.album_id
    FROM user_saved_albums legacy
    WHERE legacy.user_id = :user_id
), latest AS (
    SELECT DISTINCT ON (album_id) album_id, saved_at
    FROM saved
    ORDER BY album_id, saved_at DESC
)
SELECT
    latest.saved_at AS k1,
    a.id AS k2,
    a.entity_uid::text AS entity_uid,
    a.name,
    a.artist,
    a.year,
    COALESCE(a.has_cover, 0) > 0 AS has_cover
FROM latest
JOIN library_albums a
  ON a.id = latest.album_id
 AND a.entity_uid IS NOT NULL
 AND a.quarantined_at IS NULL
{keyset}
ORDER BY latest.saved_at DESC, a.id DESC
LIMIT :fetch
"""


def get_device_saved_albums_page(
    user_id: int,
    *,
    after: Sequence[Any] | None,
    limit: int,
    session: Session | None = None,
) -> dict[str, Any]:
    """The user's saved local albums, newest save first.

    Returns ``{"items": [...], "next_after": [saved_at, album_id] | None}``.
    """
    keys = coerce_keyset(after, SAVED_ALBUM_KEYS) if after else []
    keyset = (
        "WHERE (latest.saved_at, a.id) < (CAST(:k1 AS timestamptz), CAST(:k2 AS bigint))"
        if keys
        else ""
    )
    statement = text(_SAVED_ALBUMS_SQL.format(keyset=keyset))
    params: dict[str, Any] = {"user_id": int(user_id), "fetch": _fetch(limit)}
    params.update({f"k{index}": value for index, value in enumerate(keys, 1)})

    def _impl(current: Session) -> dict[str, Any]:
        rows = [dict(row) for row in current.execute(statement, params).mappings()]
        page, next_after = _page(
            rows, limit, lambda row: [row["k1"].isoformat(), int(row["k2"])]
        )
        return {
            "items": [
                {
                    "album_id": int(row["k2"]),
                    "entity_uid": row["entity_uid"],
                    "name": row["name"],
                    "artist": row["artist"],
                    "year": row["year"],
                    "has_cover": bool(row["has_cover"]),
                }
                for row in page
            ],
            "next_after": next_after,
        }

    return _run(session, _impl)


# ── Followed artists ─────────────────────────────────────────────

FOLLOWED_ARTIST_KEYS: tuple[type, ...] = (datetime, int)  # followed at, artist id

_FOLLOWED_ARTISTS_SQL = """
WITH followed AS (
    SELECT f.created_at AS followed_at, ga.local_artist_id AS artist_id
    FROM user_global_artist_follows f
    JOIN global_catalog_artists ga ON ga.global_artist_uid = f.global_artist_uid
    WHERE f.user_id = :user_id AND ga.local_artist_id IS NOT NULL
    UNION ALL
    -- Legacy follows are by name; library_artists.name is its primary key.
    SELECT legacy.created_at, la.id
    FROM user_follows legacy
    JOIN library_artists la ON la.name = legacy.artist_name
    WHERE legacy.user_id = :user_id AND la.id IS NOT NULL
), latest AS (
    SELECT DISTINCT ON (artist_id) artist_id, followed_at
    FROM followed
    ORDER BY artist_id, followed_at DESC
)
SELECT
    latest.followed_at AS k1,
    la.id AS k2,
    la.entity_uid::text AS entity_uid,
    la.name,
    COALESCE(la.has_photo, 0) != 0 AS has_photo
FROM latest
JOIN library_artists la ON la.id = latest.artist_id AND la.entity_uid IS NOT NULL
{keyset}
ORDER BY latest.followed_at DESC, la.id DESC
LIMIT :fetch
"""


def get_device_followed_artists_page(
    user_id: int,
    *,
    after: Sequence[Any] | None,
    limit: int,
    session: Session | None = None,
) -> dict[str, Any]:
    """The user's followed local artists, newest follow first."""
    keys = coerce_keyset(after, FOLLOWED_ARTIST_KEYS) if after else []
    keyset = (
        "WHERE (latest.followed_at, la.id) < (CAST(:k1 AS timestamptz), CAST(:k2 AS bigint))"
        if keys
        else ""
    )
    statement = text(_FOLLOWED_ARTISTS_SQL.format(keyset=keyset))
    params: dict[str, Any] = {"user_id": int(user_id), "fetch": _fetch(limit)}
    params.update({f"k{index}": value for index, value in enumerate(keys, 1)})

    def _impl(current: Session) -> dict[str, Any]:
        rows = [dict(row) for row in current.execute(statement, params).mappings()]
        page, next_after = _page(
            rows, limit, lambda row: [row["k1"].isoformat(), int(row["k2"])]
        )
        return {
            "items": [
                {
                    "artist_id": int(row["k2"]),
                    "entity_uid": row["entity_uid"],
                    "name": row["name"],
                    "has_photo": bool(row["has_photo"]),
                }
                for row in page
            ],
            "next_after": next_after,
        }

    return _run(session, _impl)


# ── Playlists ────────────────────────────────────────────────────

PLAYLIST_KEYS: tuple[type, ...] = (str, int)  # lower(name), playlist id

# Same visibility as can_view_playlist: system playlists, public ones, the
# owner's and the ones the user is a member of. Admins get no bypass here.
_PLAYLIST_ALLOWED = """(
    p.scope = 'system'
    OR p.visibility = 'public'
    OR p.user_id = :user_id
    OR EXISTS (
        SELECT 1 FROM playlist_members member
        WHERE member.playlist_id = p.id AND member.user_id = :user_id
    )
)"""

# The first track's album with a cover gives a playlist its artwork. The
# fenced lateral stops at the first matching entry in position order.
_PLAYLIST_ARTWORK = """
LEFT JOIN LATERAL (
    SELECT alb.entity_uid::text AS album_entity_uid
    FROM playlist_tracks pt
    JOIN library_tracks lt ON lt.id = pt.track_id
    JOIN library_albums alb ON alb.id = lt.album_id
    WHERE pt.playlist_id = page.id
      AND alb.entity_uid IS NOT NULL
      AND COALESCE(alb.has_cover, 0) > 0
    ORDER BY pt.position, pt.id
    LIMIT 1
) art ON TRUE
"""

_PLAYLISTS_SQL = f"""
WITH visible AS (
    SELECT p.id FROM playlists p WHERE p.user_id = :user_id AND p.scope = 'user'
    UNION
    SELECT member.playlist_id FROM playlist_members member
    WHERE member.user_id = :user_id
    UNION
    SELECT followed.playlist_id FROM user_followed_playlists followed
    WHERE followed.user_id = :user_id
), page AS MATERIALIZED (
    SELECT
        p.id,
        p.name,
        p.scope,
        p.track_count,
        lower(p.name) AS k1
    FROM visible
    JOIN playlists p ON p.id = visible.id
    WHERE p.is_active
      AND {_PLAYLIST_ALLOWED}
      {{keyset}}
    ORDER BY lower(p.name), p.id
    LIMIT :fetch
)
SELECT page.*, art.album_entity_uid
FROM page
{_PLAYLIST_ARTWORK}
ORDER BY page.k1, page.id
"""


def get_device_playlists_page(
    user_id: int,
    *,
    after: Sequence[Any] | None,
    limit: int,
    session: Session | None = None,
) -> dict[str, Any]:
    """Owned, shared and followed playlists the user can play, by name."""
    keys = coerce_keyset(after, PLAYLIST_KEYS) if after else []
    keyset = (
        "AND (lower(p.name), p.id) > (CAST(:k1 AS text), CAST(:k2 AS integer))"
        if keys
        else ""
    )
    statement = text(_PLAYLISTS_SQL.format(keyset=keyset))
    params: dict[str, Any] = {"user_id": int(user_id), "fetch": _fetch(limit)}
    params.update({f"k{index}": value for index, value in enumerate(keys, 1)})

    def _impl(current: Session) -> dict[str, Any]:
        rows = [dict(row) for row in current.execute(statement, params).mappings()]
        page, next_after = _page(rows, limit, lambda row: [row["k1"], int(row["id"])])
        return {
            "items": [
                {
                    "id": int(row["id"]),
                    "name": row["name"],
                    "scope": row["scope"],
                    "track_count": row["track_count"],
                    "album_entity_uid": row["album_entity_uid"],
                }
                for row in page
            ],
            "next_after": next_after,
        }

    return _run(session, _impl)


_PLAYLIST_HEADER_SQL = text(
    f"""
    SELECT p.id, p.name, {_PLAYLIST_ALLOWED} AS allowed
    FROM playlists p
    WHERE p.id = :playlist_id AND p.is_active
    """
)


def get_device_playlist_header(
    playlist_id: int, *, user_id: int, session: Session | None = None
) -> dict[str, Any] | None:
    """The playlist's name and whether the user may play it, or None."""

    def _impl(current: Session) -> dict[str, Any] | None:
        row = (
            current.execute(
                _PLAYLIST_HEADER_SQL,
                {"playlist_id": int(playlist_id), "user_id": int(user_id)},
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None

    return _run(session, _impl)


# ── Album page ───────────────────────────────────────────────────

ALBUM_TRACK_KEYS: tuple[type, ...] = (int, int, int)  # disc, track number, id

_ALBUM_PAGE_SQL = """
WITH album AS (
    SELECT
        a.id,
        a.entity_uid::text AS entity_uid,
        a.name,
        a.artist,
        COALESCE(a.has_cover, 0) > 0 AS has_cover
    FROM library_albums a
    WHERE a.entity_uid = CAST(:album_uid AS uuid)
      AND a.quarantined_at IS NULL
    ORDER BY a.id
    LIMIT 1
), page AS MATERIALIZED (
    SELECT
        COALESCE(t.disc_number, 1) AS k1,
        COALESCE(t.track_number, 0) AS k2,
        t.id AS k3,
        t.entity_uid::text AS entity_uid,
        COALESCE(NULLIF(t.title, ''), t.filename) AS title,
        t.artist,
        t.duration
    FROM album
    JOIN library_tracks t ON t.album_id = album.id AND t.entity_uid IS NOT NULL
    {keyset}
    ORDER BY 1, 2, 3
    LIMIT :fetch
)
SELECT
    album.id AS album_id,
    album.entity_uid AS album_entity_uid,
    album.name AS album_name,
    album.artist AS album_artist,
    album.has_cover,
    page.*
FROM album
LEFT JOIN page ON TRUE
ORDER BY page.k1, page.k2, page.k3
"""


def get_device_album_page(
    album_entity_uid: str,
    *,
    after: Sequence[Any] | None,
    limit: int,
    session: Session | None = None,
) -> dict[str, Any] | None:
    """An album and one page of its tracks in disc and track order, or None."""
    keys = coerce_keyset(after, ALBUM_TRACK_KEYS) if after else []
    keyset = (
        "WHERE (COALESCE(t.disc_number, 1), COALESCE(t.track_number, 0), t.id)"
        " > (CAST(:k1 AS integer), CAST(:k2 AS integer), CAST(:k3 AS integer))"
        if keys
        else ""
    )
    statement = text(_ALBUM_PAGE_SQL.format(keyset=keyset))
    params: dict[str, Any] = {
        "album_uid": str(UUID(str(album_entity_uid))),
        "fetch": _fetch(limit),
    }
    params.update({f"k{index}": value for index, value in enumerate(keys, 1)})

    def _impl(current: Session) -> dict[str, Any] | None:
        rows = [dict(row) for row in current.execute(statement, params).mappings()]
        if not rows:
            return None
        head = rows[0]
        tracks = [row for row in rows if row["entity_uid"] is not None]
        page, next_after = _page(
            tracks, limit, lambda row: [int(row["k1"]), int(row["k2"]), int(row["k3"])]
        )
        return {
            "album": {
                "id": int(head["album_id"]),
                "entity_uid": head["album_entity_uid"],
                "name": head["album_name"],
                "artist": head["album_artist"],
                "has_cover": bool(head["has_cover"]),
            },
            "tracks": [
                {
                    "track_id": int(row["k3"]),
                    "entity_uid": row["entity_uid"],
                    "title": row["title"],
                    "artist": row["artist"],
                    "album": head["album_name"],
                    "album_entity_uid": head["album_entity_uid"],
                    "has_cover": bool(head["has_cover"]),
                    "duration": row["duration"],
                }
                for row in page
            ],
            "next_after": next_after,
        }

    return _run(session, _impl)


# ── Artist page ──────────────────────────────────────────────────

_ARTIST_PAGE_SQL = text(
    """
    WITH artist AS (
        SELECT
            la.id,
            la.entity_uid::text AS entity_uid,
            la.name,
            COALESCE(la.has_photo, 0) != 0 AS has_photo
        FROM library_artists la
        WHERE la.entity_uid = CAST(:artist_uid AS uuid)
        ORDER BY la.id
        LIMIT 1
    ), albums AS MATERIALIZED (
        SELECT
            a.id,
            a.entity_uid::text AS entity_uid,
            a.name,
            a.year,
            COALESCE(a.has_cover, 0) > 0 AS has_cover
        FROM artist
        JOIN library_albums a ON a.artist = artist.name
        WHERE a.entity_uid IS NOT NULL AND a.quarantined_at IS NULL
        ORDER BY NULLIF(a.year, '') DESC NULLS LAST, lower(a.name), a.id
        LIMIT :album_limit
    )
    SELECT
        artist.id AS artist_id,
        artist.entity_uid AS artist_entity_uid,
        artist.name AS artist_name,
        artist.has_photo,
        albums.id AS album_id,
        albums.entity_uid AS album_entity_uid,
        albums.name AS album_name,
        albums.year AS album_year,
        albums.has_cover AS album_has_cover
    FROM artist
    LEFT JOIN albums ON TRUE
    ORDER BY NULLIF(albums.year, '') DESC NULLS LAST, lower(albums.name), albums.id
    """
)


def get_device_artist(
    artist_entity_uid: str, *, session: Session | None = None
) -> dict[str, Any] | None:
    """A local artist and their albums, newest first (at most 200), or None."""
    params = {
        "artist_uid": str(UUID(str(artist_entity_uid))),
        "album_limit": DEVICE_ARTIST_ALBUM_LIMIT,
    }

    def _impl(current: Session) -> dict[str, Any] | None:
        rows = [
            dict(row) for row in current.execute(_ARTIST_PAGE_SQL, params).mappings()
        ]
        if not rows:
            return None
        head = rows[0]
        return {
            "artist": {
                "id": head["artist_id"],
                "entity_uid": head["artist_entity_uid"],
                "name": head["artist_name"],
                "has_photo": bool(head["has_photo"]),
            },
            "albums": [
                {
                    "album_id": int(row["album_id"]),
                    "entity_uid": row["album_entity_uid"],
                    "name": row["album_name"],
                    "artist": head["artist_name"],
                    "year": row["album_year"],
                    "has_cover": bool(row["album_has_cover"]),
                }
                for row in rows
                if row["album_id"] is not None
            ],
        }

    return _run(session, _impl)


# ── Tracks by entity ─────────────────────────────────────────────

_TRACKS_BY_ENTITY_SQL = text(
    """
    SELECT
        t.id AS track_id,
        t.entity_uid::text AS entity_uid,
        catalog.global_track_uid,
        COALESCE(NULLIF(t.title, ''), t.filename) AS title,
        t.artist,
        COALESCE(a.name, t.album) AS album,
        t.duration,
        a.entity_uid::text AS album_entity_uid,
        COALESCE(a.has_cover, 0) > 0 AS has_cover
    FROM library_tracks t
    LEFT JOIN library_albums a ON a.id = t.album_id
    LEFT JOIN LATERAL (
        SELECT gt.global_track_uid::text AS global_track_uid
        FROM global_catalog_tracks gt
        WHERE gt.local_track_id = t.id
        ORDER BY gt.global_track_uid
        LIMIT 1
    ) catalog ON TRUE
    WHERE t.entity_uid = ANY(CAST(:uids AS uuid[]))
    """
)


def get_device_tracks_by_entity_uids(
    entity_uids: Sequence[str], *, session: Session | None = None
) -> dict[str, dict[str, Any]]:
    """Local tracks by entity uid in one batched query; unknown uids are absent."""
    uids = list(dict.fromkeys(str(uid) for uid in entity_uids))
    if not uids:
        return {}

    def _impl(current: Session) -> dict[str, dict[str, Any]]:
        rows = current.execute(_TRACKS_BY_ENTITY_SQL, {"uids": uids}).mappings()
        return {str(row["entity_uid"]): dict(row) for row in rows}

    return _run(session, _impl)


__all__ = [
    "ALBUM_TRACK_KEYS",
    "DEVICE_ARTIST_ALBUM_LIMIT",
    "DEVICE_PAGE_LIMIT",
    "FOLLOWED_ARTIST_KEYS",
    "PLAYLIST_KEYS",
    "SAVED_ALBUM_KEYS",
    "coerce_keyset",
    "get_device_album_page",
    "get_device_artist",
    "get_device_followed_artists_page",
    "get_device_playlist_header",
    "get_device_playlists_page",
    "get_device_saved_albums_page",
    "get_device_tracks_by_entity_uids",
]

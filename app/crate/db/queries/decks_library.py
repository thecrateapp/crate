"""Crate Decks library navigation (S3): container tree and keyset track pages.

Every public function runs exactly one statement. Pages use keyset pagination
over each container's natural order, so appending to a container never repeats
or skips rows for a client that is paging through it. Nothing here aggregates
over ``library_tracks``: genre counts come from the precomputed
``library_albums.track_count``, and every track row is a fenced primary-key or
index lookup.

The genre, mood and recent containers are the ones VirtualDJ already browses
(``vdj_catalog``): the top genres by album count, the mood scores at or above
the same threshold, and the latest play events.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any, Literal, get_args
from uuid import UUID

from sqlalchemy import TextClause, text
from sqlalchemy.orm import Session

from crate.db.queries.vdj_catalog import (
    VDJ_GENRE_FOLDER_LIMIT,
    VDJ_MOOD_THRESHOLD,
    VDJ_MOODS,
    VDJ_RECENT_EVENT_WINDOW,
    mood_score_expression,
)
from crate.db.tx import read_scope

DecksContainerKind = Literal["playlist", "crate", "genre", "mood", "recent", "likes"]
DECKS_CONTAINER_KINDS: tuple[str, ...] = get_args(DecksContainerKind)
DECKS_PAGE_LIMIT = 500
DECKS_GENRE_LIMIT = VDJ_GENRE_FOLDER_LIMIT
DECKS_MOODS: tuple[str, ...] = tuple(VDJ_MOODS)
DECKS_MOOD_THRESHOLD = VDJ_MOOD_THRESHOLD
DECKS_RECENT_EVENT_WINDOW = VDJ_RECENT_EVENT_WINDOW
# The per-user containers (recent, likes) have this single id.
ME_CONTAINER_ID = "me"

# Type of each keyset column per kind, in sort order.
_KEY_TYPES: dict[str, tuple[type, ...]] = {
    "playlist": (int, int),  # playlist position, playlist entry id
    "crate": (int, int, int, int),  # album position, disc, track number, track id
    "genre": (int, int, int, int),  # album id, disc, track number, track id
    "mood": (float, int),  # mood score (descending), track id
    "recent": (datetime, int),  # last played at, track id (both descending)
    "likes": (datetime, int),  # liked at, track id (both descending)
}
_PAGE_ORDER = {
    "playlist": "page.k1, page.k2",
    "crate": "page.k1, page.k2, page.k3, page.k4",
    "genre": "page.k1, page.k2, page.k3, page.k4",
    "mood": "page.k1 DESC NULLS LAST, page.k2",
    "recent": "page.k1 DESC, page.k2 DESC",
    "likes": "page.k1 DESC, page.k2 DESC",
}


_TREE_SQL = """
WITH playlist_nodes AS (
    -- The playlists of the user's library: owned, shared with them, and the
    -- public or system ones they follow (VirtualDJ lists the same set).
    SELECT
        1 AS section,
        0::bigint AS rank,
        'playlist' AS kind,
        p.id::text AS id,
        p.name,
        COALESCE(p.track_count, 0) AS track_count,
        md5(concat_ws(
            ':', 'playlist', p.id, p.updated_at, p.editorial_revision,
            p.generation_epoch, p.track_count
        )) AS etag
    FROM playlists p
    WHERE p.is_active
      AND (
          p.user_id = :user_id
          OR EXISTS (
              SELECT 1 FROM playlist_members member
              WHERE member.playlist_id = p.id AND member.user_id = :user_id
          )
          OR (
              (p.scope = 'system' OR p.visibility = 'public')
              AND EXISTS (
                  SELECT 1 FROM user_followed_playlists follow
                  WHERE follow.playlist_id = p.id AND follow.user_id = :user_id
              )
          )
      )
), crate_nodes AS (
    SELECT
        2 AS section,
        0::bigint AS rank,
        'crate' AS kind,
        c.id::text AS id,
        c.name,
        NULL::integer AS track_count,
        md5(concat_ws(
            ':', 'crate', c.id, c.updated_at, c.is_ordered, c.sort_direction
        )) AS etag
    FROM crates c
    WHERE c.owner_id = :user_id
       OR (
           c.is_collaborative IS TRUE
           AND EXISTS (
               SELECT 1 FROM crate_members member
               WHERE member.crate_id = c.id AND member.user_id = :user_id
           )
       )
       OR (
           c.visibility = 'public'
           AND EXISTS (
               SELECT 1 FROM crate_followers follower
               WHERE follower.crate_id = c.id AND follower.user_id = :user_id
           )
       )
), genre_counts AS (
    -- Ranked by album count, as VirtualDJ's genre folders; the track count
    -- adds the albums' precomputed counts.
    SELECT
        ag.genre_id,
        COUNT(*) AS album_count,
        SUM(ag.album_id) AS album_sum,
        SUM(COALESCE(album.track_count, 0)) AS track_count
    FROM album_genres ag
    JOIN library_albums album ON album.id = ag.album_id
    GROUP BY ag.genre_id
), genre_nodes AS (
    SELECT
        3 AS section,
        row_number() OVER (
            ORDER BY counts.album_count DESC, LOWER(g.name), g.id
        ) AS rank,
        'genre' AS kind,
        g.id::text AS id,
        g.name,
        counts.track_count::integer AS track_count,
        md5(concat_ws(
            ':', 'genre', g.id, counts.album_count, counts.album_sum,
            counts.track_count
        )) AS etag
    FROM genre_counts counts
    JOIN genres g ON g.id = counts.genre_id
    ORDER BY counts.album_count DESC, LOWER(g.name), g.id
    LIMIT :genre_limit
), mood_nodes AS (
    SELECT
        4 AS section,
        mood.rank,
        'mood' AS kind,
        mood.key AS id,
        initcap(mood.key) AS name,
        NULL::integer AS track_count,
        md5(concat_ws(':', 'mood', mood.key, :mood_threshold)) AS etag
    FROM unnest(CAST(:moods AS text[])) WITH ORDINALITY AS mood(key, rank)
), recent_node AS (
    SELECT
        5 AS section,
        0::bigint AS rank,
        'recent' AS kind,
        CAST(:me AS text) AS id,
        'Recently Played' AS name,
        NULL::integer AS track_count,
        md5(concat_ws(':', 'recent', last_play.id, last_play.ended_at)) AS etag
    FROM (SELECT 1) AS one
    LEFT JOIN LATERAL (
        SELECT upe.id, upe.ended_at
        FROM user_play_events upe
        WHERE upe.user_id = :user_id
        ORDER BY upe.ended_at DESC, upe.id DESC
        LIMIT 1
    ) last_play ON TRUE
), like_rows AS (
    SELECT 'g:' || liked.global_track_uid::text || '@' || liked.created_at::text AS ref
    FROM user_global_track_likes liked
    WHERE liked.user_id = :user_id
    UNION ALL
    SELECT 'l:' || legacy.track_id::text || '@' || legacy.created_at::text
    FROM user_liked_tracks legacy
    WHERE legacy.user_id = :user_id
), likes_node AS (
    SELECT
        6 AS section,
        0::bigint AS rank,
        'likes' AS kind,
        CAST(:me AS text) AS id,
        'Likes' AS name,
        NULL::integer AS track_count,
        -- Order-independent, so no sort over the user's likes.
        md5(concat_ws(
            ':', 'likes', COUNT(*), SUM(hashtextextended(ref, 0))
        )) AS etag
    FROM like_rows
)
SELECT kind, id, name, track_count, etag
FROM (
    SELECT * FROM playlist_nodes
    UNION ALL
    SELECT * FROM crate_nodes
    UNION ALL
    SELECT * FROM genre_nodes
    UNION ALL
    SELECT * FROM mood_nodes
    UNION ALL
    SELECT * FROM recent_node
    UNION ALL
    SELECT * FROM likes_node
) node
ORDER BY section, rank, LOWER(name), name, id
"""


# Each kind yields `target` (one row when the container exists, with
# `allowed`) and `page` (track_id plus keyset columns k1..k4, already ordered
# and limited). The shared projection below turns `page` into DJ rows. The
# keyset predicate is only part of the statement for a next page, so a first
# page never carries a disabled condition the planner has to see through.
# Pages filter on the container id itself rather than joining `target`, so the
# planner reads the container in order and stops after :fetch rows; access is
# a one-time filter on `target`.


def _playlist_page(*, after: bool) -> str:
    keyset = (
        """
      AND pt.position >= CAST(:k1 AS integer)
      AND (pt.position, pt.id) > (CAST(:k1 AS integer), CAST(:k2 AS integer))"""
        if after
        else ""
    )
    return f"""
target AS (
    SELECT
        p.id,
        (
            p.scope = 'system'
            OR p.visibility = 'public'
            OR p.user_id = :user_id
            OR EXISTS (
                SELECT 1 FROM playlist_members member
                WHERE member.playlist_id = p.id AND member.user_id = :user_id
            )
        ) AS allowed
    FROM playlists p
    WHERE p.id = CAST(:container_id AS integer)
      AND p.is_active
), page AS MATERIALIZED (
    SELECT
        pt.position AS k1,
        pt.id AS k2,
        NULL::integer AS k3,
        NULL::integer AS k4,
        resolved.track_id
    FROM playlist_tracks pt
    CROSS JOIN LATERAL (
        -- Same resolution order as the Listen playlist detail, keeping only
        -- library tracks Decks can key (entity_uid). OFFSET 0 keeps it a
        -- per-entry index lookup instead of a join on the COALESCE result.
        SELECT COALESCE(
            (
                SELECT lt.id FROM library_tracks lt
                WHERE lt.id = pt.track_id AND lt.entity_uid IS NOT NULL
            ),
            (
                SELECT lt.id FROM library_tracks lt
                WHERE pt.track_entity_uid IS NOT NULL
                  AND lt.entity_uid = pt.track_entity_uid
            ),
            (
                SELECT lt.id FROM library_tracks lt
                WHERE pt.track_storage_id IS NOT NULL
                  AND lt.storage_id = pt.track_storage_id
                  AND lt.entity_uid IS NOT NULL
            ),
            (
                SELECT lt.id FROM library_tracks lt
                WHERE pt.track_path IS NOT NULL AND lt.path = pt.track_path
                  AND lt.entity_uid IS NOT NULL
            ),
            (
                SELECT lt.id
                FROM global_catalog_tracks gt
                JOIN library_tracks lt ON lt.id = gt.local_track_id
                WHERE pt.global_track_uid IS NOT NULL
                  AND gt.global_track_uid = pt.global_track_uid
                  AND lt.entity_uid IS NOT NULL
            )
        ) AS track_id
        OFFSET 0
    ) resolved
    WHERE pt.playlist_id = CAST(:container_id AS integer)
      AND (SELECT target.allowed FROM target)
      AND resolved.track_id IS NOT NULL{keyset}
    ORDER BY pt.position, pt.id
    LIMIT :fetch
)
"""


def _crate_page(*, after: bool) -> str:
    keyset = (
        """
    WHERE (k1, k2, k3, k4) > (
        CAST(:k1 AS integer), CAST(:k2 AS integer),
        CAST(:k3 AS integer), CAST(:k4 AS integer)
    )"""
        if after
        else ""
    )
    return f"""
target AS (
    SELECT
        c.id,
        (
            c.owner_id = :user_id
            OR (
                c.is_collaborative IS TRUE
                AND EXISTS (
                    SELECT 1 FROM crate_members member
                    WHERE member.crate_id = c.id AND member.user_id = :user_id
                )
            )
            OR c.visibility = 'public'
        ) AS allowed,
        (c.is_ordered IS TRUE AND c.sort_direction = 'desc') AS descending
    FROM crates c
    WHERE c.id = CAST(:container_id AS uuid)
), expanded AS (
    -- Crates hold albums; Decks plays the local tracks of each album in
    -- crate, disc and track order (as Listen's crate playback does). A track
    -- that appears twice keeps its first place.
    SELECT DISTINCT ON (local_track.id)
        CASE WHEN target.descending THEN -crate_album.position
             ELSE crate_album.position END AS k1,
        COALESCE(catalog_track.disc_number, 1) AS k2,
        COALESCE(catalog_track.track_number, 0) AS k3,
        local_track.id AS k4,
        local_track.id AS track_id
    FROM target
    JOIN crate_albums crate_album ON crate_album.crate_id = target.id
    JOIN global_catalog_tracks catalog_track
      ON catalog_track.global_album_uid = crate_album.global_album_uid
    CROSS JOIN LATERAL (
        -- The catalog's local track, else the library track with its entity
        -- (as the crate download does): one index probe each.
        SELECT COALESCE(
            (
                SELECT candidate.id FROM library_tracks candidate
                WHERE candidate.id = catalog_track.local_track_id
                  AND candidate.entity_uid IS NOT NULL
            ),
            (
                SELECT candidate.id FROM library_tracks candidate
                WHERE catalog_track.local_track_entity_uid IS NOT NULL
                  AND candidate.entity_uid = catalog_track.local_track_entity_uid
            )
        ) AS id
        OFFSET 0
    ) local_track
    WHERE target.allowed
      AND local_track.id IS NOT NULL
    ORDER BY local_track.id, 1, 2, 3
), page AS MATERIALIZED (
    SELECT k1, k2, k3, k4, track_id
    FROM expanded{keyset}
    ORDER BY k1, k2, k3, k4
    LIMIT :fetch
)
"""


def _genre_page(*, after: bool) -> str:
    keyset = (
        """
    WHERE (albums.album_id, track.k2, track.k3, track.track_id) > (
        CAST(:k1 AS integer), CAST(:k2 AS integer),
        CAST(:k3 AS integer), CAST(:k4 AS integer)
    )"""
        if after
        else ""
    )
    # The album range start is redundant with the row comparison; it lets the
    # album_genres read skip the albums already served.
    album_start = (
        """
          AND ag.album_id >= CAST(:k1 AS integer)"""
        if after
        else ""
    )
    return f"""
target AS (
    SELECT g.id, TRUE AS allowed
    FROM genres g
    WHERE g.id = CAST(:container_id AS integer)
), page AS MATERIALIZED (
    -- The tracks of the genre's albums, album by album. Albums come in id
    -- order, so the page stops after the albums it needs; the fenced lateral
    -- reads each album's tracks through its index, never the whole library.
    SELECT
        albums.album_id AS k1,
        track.k2,
        track.k3,
        track.track_id AS k4,
        track.track_id
    FROM (
        SELECT ag.album_id
        FROM album_genres ag
        WHERE ag.genre_id = CAST(:container_id AS integer){album_start}
        ORDER BY ag.album_id
    ) albums
    CROSS JOIN LATERAL (
        SELECT
            COALESCE(lt.disc_number, 1) AS k2,
            COALESCE(lt.track_number, 0) AS k3,
            lt.id AS track_id
        FROM library_tracks lt
        WHERE lt.album_id = albums.album_id
          AND lt.entity_uid IS NOT NULL
        OFFSET 0
    ) track{keyset}
    ORDER BY albums.album_id, track.k2, track.k3, track.track_id
    LIMIT :fetch
)
"""


def _mood_page(mood: str, *, after: bool) -> str:
    # The score expression and the ORDER BY must match the partial
    # idx_library_tracks_mood_* indexes exactly, so the page is an ordered
    # index scan that stops after :fetch rows. PostgreSQL has no statistics for
    # expressions of partial indexes, so a range bounded on both sides (the
    # cursor and the threshold) is estimated at 0.5% of the table and planned
    # as a bitmap scan of the whole range plus a sort. A next page therefore
    # scans from the cursor down, bounded on one side only, and the threshold
    # applies to the at most :fetch rows that scan returns.
    score = mood_score_expression(mood, "t.mood_json")
    bound = (
        f"""
          AND {score} <= CAST(:k1 AS double precision)
          AND ({score} < CAST(:k1 AS double precision) OR t.id > CAST(:k2 AS integer))"""
        if after
        else f"""
          AND {score} >= CAST(:mood_threshold AS double precision)"""
    )
    return f"""
target AS (
    SELECT TRUE AS allowed
), page AS MATERIALIZED (
    SELECT ranked.k1, ranked.k2, NULL::integer AS k3, NULL::integer AS k4,
           ranked.track_id
    FROM (
        SELECT {score} AS k1, t.id AS k2, t.id AS track_id
        FROM library_tracks t
        WHERE t.mood_json IS NOT NULL
          AND t.entity_uid IS NOT NULL{bound}
        ORDER BY {score} DESC NULLS LAST, t.id
        LIMIT :fetch
    ) ranked
    WHERE ranked.k1 >= CAST(:mood_threshold AS double precision)
    ORDER BY ranked.k1 DESC NULLS LAST, ranked.k2
)
"""


def _recent_page(*, after: bool) -> str:
    keyset = (
        """
    WHERE (latest.last_played_at, latest.track_id)
          < (CAST(:k1 AS timestamptz), CAST(:k2 AS integer))"""
        if after
        else ""
    )
    return f"""
target AS (
    SELECT TRUE AS allowed
), recent_events AS (
    -- The same window as VirtualDJ's recently played folder.
    SELECT upe.track_id, upe.track_entity_uid, upe.ended_at
    FROM user_play_events upe
    WHERE upe.user_id = :user_id
    ORDER BY upe.ended_at DESC
    LIMIT :event_window
), played AS (
    SELECT track_id, track_entity_uid, MAX(ended_at) AS last_played_at
    FROM recent_events
    GROUP BY track_id, track_entity_uid
), resolved AS (
    -- A play keeps its track row, or only its entity once that row is gone.
    SELECT played.last_played_at, keyed.id AS track_id
    FROM played
    CROSS JOIN LATERAL (
        SELECT COALESCE(
            (
                SELECT lt.id FROM library_tracks lt
                WHERE lt.id = played.track_id AND lt.entity_uid IS NOT NULL
            ),
            (
                SELECT lt.id FROM library_tracks lt
                WHERE played.track_id IS NULL
                  AND lt.entity_uid = played.track_entity_uid
            )
        ) AS id
        OFFSET 0
    ) keyed
    WHERE keyed.id IS NOT NULL
), latest AS (
    SELECT DISTINCT ON (track_id) track_id, last_played_at
    FROM resolved
    ORDER BY track_id, last_played_at DESC
), page AS MATERIALIZED (
    SELECT
        latest.last_played_at AS k1,
        latest.track_id AS k2,
        NULL::integer AS k3,
        NULL::integer AS k4,
        latest.track_id
    FROM latest{keyset}
    ORDER BY latest.last_played_at DESC, latest.track_id DESC
    LIMIT :fetch
)
"""


def _likes_page(*, after: bool) -> str:
    keyset = (
        """
        WHERE (latest.created_at, latest.track_id)
              < (CAST(:k1 AS timestamptz), CAST(:k2 AS integer))"""
        if after
        else ""
    )
    return f"""
target AS (
    SELECT TRUE AS allowed
), liked AS (
    -- Canonical likes are global; Decks only lists the ones with a local track.
    -- One primary-key probe per like, never a scan of the global catalog.
    SELECT catalog_track.local_track_id AS track_id, liked.created_at
    FROM user_global_track_likes liked
    CROSS JOIN LATERAL (
        SELECT gt.local_track_id
        FROM global_catalog_tracks gt
        WHERE gt.global_track_uid = liked.global_track_uid
        OFFSET 0
    ) catalog_track
    WHERE liked.user_id = :user_id
      AND catalog_track.local_track_id IS NOT NULL
    UNION ALL
    SELECT legacy.track_id, legacy.created_at
    FROM user_liked_tracks legacy
    WHERE legacy.user_id = :user_id
), latest AS (
    SELECT DISTINCT ON (track_id) track_id, created_at
    FROM liked
    ORDER BY track_id, created_at DESC
), page AS MATERIALIZED (
    -- Newest first, then the library check, so the page stops after :fetch
    -- library tracks instead of checking every like.
    SELECT
        ordered.created_at AS k1,
        ordered.track_id AS k2,
        NULL::integer AS k3,
        NULL::integer AS k4,
        ordered.track_id
    FROM (
        SELECT latest.track_id, latest.created_at
        FROM latest{keyset}
        ORDER BY latest.created_at DESC, latest.track_id DESC
    ) ordered
    CROSS JOIN LATERAL (
        SELECT lt.id FROM library_tracks lt
        WHERE lt.id = ordered.track_id AND lt.entity_uid IS NOT NULL
        OFFSET 0
    ) keyed
    ORDER BY ordered.created_at DESC, ordered.track_id DESC
    LIMIT :fetch
)
"""


# The page holds at most 501 rows: fenced laterals (OFFSET 0) keep each
# lookup a primary-key probe whatever the table statistics say. The profile is
# the one GET /api/tracks/by-entity/{uid}/mix-profile serves: any analyzer and
# schema version, as long as its source is not stale.
_PROJECTION_SQL = """
SELECT
    target.allowed,
    page.k1, page.k2, page.k3, page.k4,
    t.entity_uid::text AS entity_uid,
    catalog.global_track_uid::text AS global_track_uid,
    COALESCE(NULLIF(t.title, ''), t.filename) AS title,
    t.artist,
    COALESCE(a.name, t.album) AS album,
    ROUND(t.duration * 1000)::bigint AS duration_ms,
    COALESCE(p.bpm, t.bpm) AS bpm,
    p.key_camelot AS camelot,
    p.global_energy AS energy,
    COALESCE(
        NULLIF(t.genre, ''),
        NULLIF(a.genre, ''),
        (
            -- The album's strongest genre. The fenced lateral keeps the genre
            -- name a primary-key probe: a join would hash the whole genres
            -- table once per track.
            SELECT genre.name
            FROM album_genres ag
            CROSS JOIN LATERAL (
                SELECT g.name FROM genres g WHERE g.id = ag.genre_id OFFSET 0
            ) genre
            WHERE ag.album_id = a.id
            ORDER BY ag.weight DESC NULLS LAST, genre.name ASC
            LIMIT 1
        )
    ) AS genre,
    t.format,
    t.bitrate,
    t.sample_rate,
    t.bit_depth,
    t.size AS byte_length,
    p.profile_revision,
    p.quality AS profile_quality,
    a.id AS album_id,
    COALESCE(a.has_cover, 0) > 0 AS has_cover,
    t.path
FROM target
LEFT JOIN page ON TRUE
LEFT JOIN LATERAL (
    SELECT
        lt.id, lt.entity_uid, lt.title, lt.filename, lt.artist, lt.album,
        lt.album_id, lt.duration, lt.bpm, lt.genre, lt.format, lt.bitrate,
        lt.sample_rate, lt.bit_depth, lt.size, lt.path
    FROM library_tracks lt
    WHERE lt.id = page.track_id
    OFFSET 0
) t ON TRUE
LEFT JOIN LATERAL (
    SELECT la.id, la.name, la.genre, la.has_cover
    FROM library_albums la
    WHERE la.id = t.album_id
    OFFSET 0
) a ON TRUE
LEFT JOIN LATERAL (
    SELECT gt.global_track_uid
    FROM global_catalog_tracks gt
    WHERE gt.local_track_id = t.id
    ORDER BY gt.global_track_uid
    LIMIT 1
) catalog ON TRUE
LEFT JOIN LATERAL (
    SELECT
        mp.bpm, mp.key_camelot, mp.global_energy, mp.profile_revision,
        mp.quality
    FROM track_mix_profiles mp
    WHERE mp.track_id = t.id
      AND mp.source_stale_at IS NULL
    OFFSET 0
) p ON TRUE
"""


def decks_containers_statement(user_id: int) -> tuple[TextClause, dict[str, Any]]:
    return text(_TREE_SQL), {
        "user_id": int(user_id),
        "me": ME_CONTAINER_ID,
        "genre_limit": DECKS_GENRE_LIMIT,
        "moods": list(DECKS_MOODS),
        "mood_threshold": DECKS_MOOD_THRESHOLD,
    }


def get_decks_containers(
    user_id: int, *, session: Session | None = None
) -> list[dict[str, Any]]:
    """The user's playlists, crates, top genres, moods, recent and likes."""
    statement, params = decks_containers_statement(user_id)

    def _impl(current: Session) -> list[dict[str, Any]]:
        rows = current.execute(statement, params).mappings().all()
        return [
            {
                "id": row["id"],
                "kind": row["kind"],
                "name": row["name"],
                "parent_id": None,
                "track_count": row["track_count"],
                "etag": row["etag"],
            }
            for row in rows
        ]

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def normalize_container_id(kind: str, container_id: str) -> str | None:
    """The canonical id of a container, or None when it cannot exist."""
    if kind in {"playlist", "genre"}:
        if container_id.isascii() and container_id.isdigit() and len(container_id) < 10:
            return str(int(container_id))
        return None
    if kind == "crate":
        try:
            return str(UUID(container_id))
        except ValueError:
            return None
    if kind == "mood":
        return container_id if container_id in DECKS_MOODS else None
    if kind in {"recent", "likes"}:
        return container_id if container_id == ME_CONTAINER_ID else None
    return None


def coerce_after(kind: str, after: Sequence[Any]) -> list[Any]:
    """Validate keyset values (e.g. from a decoded cursor); raise ValueError."""
    types = _KEY_TYPES[kind]
    if len(after) != len(types):
        raise ValueError("cursor does not match the container")
    return [_coerce_key(value, expected) for value, expected in zip(after, types)]


def _coerce_key(value: Any, expected: type) -> Any:
    invalid = ValueError("cursor does not match the container")
    if isinstance(value, bool):
        raise invalid
    if expected is int:
        if not isinstance(value, int) or not -(2**31) <= value < 2**31:
            raise invalid
        return value
    if expected is float:
        if not isinstance(value, int | float) or not math.isfinite(value):
            raise invalid
        return float(value)
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str):
        parsed = datetime.fromisoformat(value)
    else:
        raise invalid
    if parsed.tzinfo is None:
        raise invalid
    return parsed


def _page_ctes(kind: str, container_id: str, *, after: bool) -> str:
    if kind == "playlist":
        return _playlist_page(after=after)
    if kind == "crate":
        return _crate_page(after=after)
    if kind == "genre":
        return _genre_page(after=after)
    if kind == "mood":
        if container_id not in DECKS_MOODS:
            raise ValueError(f"Unknown mood: {container_id}")
        return _mood_page(container_id, after=after)
    if kind == "recent":
        return _recent_page(after=after)
    if kind == "likes":
        return _likes_page(after=after)
    raise ValueError(f"Unknown container kind: {kind}")


def decks_container_tracks_statement(
    kind: str,
    container_id: str,
    *,
    user_id: int,
    after: Sequence[Any] | None,
    limit: int,
) -> tuple[TextClause, dict[str, Any]]:
    if kind not in _KEY_TYPES:
        raise ValueError(f"Unknown container kind: {kind}")
    keys = coerce_after(kind, after) if after else []
    ctes = _page_ctes(kind, str(container_id), after=bool(keys))
    params: dict[str, Any] = {
        "user_id": int(user_id),
        "container_id": str(container_id),
        "fetch": max(1, min(int(limit), DECKS_PAGE_LIMIT)) + 1,
        "mood_threshold": DECKS_MOOD_THRESHOLD,
        "event_window": DECKS_RECENT_EVENT_WINDOW,
    }
    params.update({f"k{index}": value for index, value in enumerate(keys, 1)})
    sql = f"WITH {ctes}{_PROJECTION_SQL}ORDER BY {_PAGE_ORDER[kind]}\n"
    return text(sql), params


def get_decks_container_tracks(
    kind: str,
    container_id: str,
    *,
    user_id: int,
    after: Sequence[Any] | None,
    limit: int,
    session: Session | None = None,
) -> dict[str, Any] | None:
    """One page of a container's tracks, with its access check, in one query.

    Returns ``None`` when the container does not exist, or
    ``{"allowed", "tracks", "next_after"}``. Tracks carry the server ``path``
    so the caller can check the audio file; callers must drop it.
    ``next_after`` holds the last row's keyset values (JSON-safe).
    """
    statement, params = decks_container_tracks_statement(
        kind, container_id, user_id=user_id, after=after, limit=limit
    )
    page_size = params["fetch"] - 1

    def _impl(current: Session) -> dict[str, Any] | None:
        rows = current.execute(statement, params).mappings().all()
        if not rows:
            return None
        if not rows[0]["allowed"]:
            return {"allowed": False, "tracks": [], "next_after": None}
        found = [row for row in rows if row["entity_uid"] is not None]
        page = found[:page_size]
        next_after = _keys(kind, page[-1]) if len(found) > page_size and page else None
        return {
            "allowed": True,
            "tracks": [_track_payload(row) for row in page],
            "next_after": next_after,
        }

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def _keys(kind: str, row: Mapping[Any, Any]) -> list[Any]:
    keys: list[Any] = []
    for index, expected in enumerate(_KEY_TYPES[kind], 1):
        value = row[f"k{index}"]
        if expected is datetime:
            keys.append(value.isoformat())
        elif expected is float:
            keys.append(float(value))
        else:
            keys.append(int(value))
    return keys


def _track_payload(row: Mapping[Any, Any]) -> dict[str, Any]:
    album_id = row["album_id"]
    return {
        "entity_uid": row["entity_uid"],
        "global_track_uid": row["global_track_uid"],
        "title": row["title"],
        "artist": row["artist"],
        "album": row["album"],
        "duration_ms": row["duration_ms"],
        "bpm": row["bpm"],
        "camelot": row["camelot"],
        "energy": row["energy"],
        "genre": row["genre"],
        "format": row["format"],
        "bitrate": row["bitrate"],
        "sample_rate": row["sample_rate"],
        "bit_depth": row["bit_depth"],
        "byte_length": row["byte_length"],
        "profile_revision": row["profile_revision"],
        "profile_quality": row["profile_quality"],
        "cover_url": (
            f"/api/vdj/albums/{album_id}/cover?size=512"
            if album_id is not None and row["has_cover"]
            else None
        ),
        "path": row["path"],
    }


__all__ = [
    "DECKS_CONTAINER_KINDS",
    "DECKS_GENRE_LIMIT",
    "DECKS_MOODS",
    "DECKS_MOOD_THRESHOLD",
    "DECKS_PAGE_LIMIT",
    "DECKS_RECENT_EVENT_WINDOW",
    "DecksContainerKind",
    "ME_CONTAINER_ID",
    "coerce_after",
    "decks_container_tracks_statement",
    "decks_containers_statement",
    "get_decks_container_tracks",
    "get_decks_containers",
    "normalize_container_id",
]

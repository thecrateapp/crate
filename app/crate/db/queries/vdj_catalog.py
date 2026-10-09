from __future__ import annotations

import math
import re
from collections.abc import Mapping
from typing import Any

from sqlalchemy import TextClause, text

from crate.db.schema_sections.vdj_catalog_v108 import VDJ_MOOD_INDEX_MOODS
from crate.db.tx import read_scope

VDJ_FOLDER_TRACK_LIMIT = 500
VDJ_GENRE_FOLDER_LIMIT = 40
VDJ_PLAYLIST_FOLDER_LIMIT = 200
VDJ_RECENT_EVENT_WINDOW = 2_000
VDJ_MOOD_THRESHOLD = 0.5
VDJ_MOODS = VDJ_MOOD_INDEX_MOODS

_RECENT_FOLDER_ID = "crate:recently-played"
_PLAYLIST_FOLDER = re.compile(r"^crate:playlist:(\d+)(?::part:(\d+))?$")
_GENRE_FOLDER = re.compile(r"^crate:genre:(\d+)$")
_MOOD_FOLDER = re.compile(r"^crate:mood:([a-z]+)$")

_TRACK_COLUMNS = """
    t.entity_uid::text AS entity_uid,
    COALESCE(NULLIF(t.title, ''), t.filename) AS title,
    t.artist,
    t.album,
    t.duration,
    COALESCE(NULLIF(t.year, ''), NULLIF(a.year, '')) AS year,
    COALESCE(
        NULLIF(t.genre, ''),
        NULLIF(a.genre, ''),
        (
            SELECT g.name
            FROM album_genres ag
            JOIN genres g ON g.id = ag.genre_id
            WHERE ag.album_id = a.id
            ORDER BY ag.weight DESC NULLS LAST, g.name ASC
            LIMIT 1
        )
    ) AS genre,
    t.bpm,
    t.audio_key,
    t.audio_scale,
    a.id AS album_id,
    COALESCE(a.has_cover, 0) AS has_cover
"""

_VISIBLE_PLAYLIST = """
    p.is_active
    AND (
        p.scope = 'system'
        OR p.visibility = 'public'
        OR p.user_id = :user_id
        OR EXISTS (
            SELECT 1 FROM playlist_members pm
            WHERE pm.playlist_id = p.id AND pm.user_id = :user_id
        )
    )
"""

_LISTED_PLAYLISTS_SQL = text(
    """
    SELECT p.id, p.name, COALESCE(p.track_count, 0) AS track_count
    FROM playlists p
    WHERE p.is_active
      AND (
          p.user_id = :user_id
          OR EXISTS (
              SELECT 1 FROM playlist_members pm
              WHERE pm.playlist_id = p.id AND pm.user_id = :user_id
          )
          OR (
              (p.scope = 'system' OR p.visibility = 'public')
              AND EXISTS (
                  SELECT 1 FROM user_followed_playlists ufp
                  WHERE ufp.playlist_id = p.id AND ufp.user_id = :user_id
              )
          )
      )
    ORDER BY LOWER(p.name), p.id
    LIMIT :playlist_limit
    """
)

_TOP_GENRES_SQL = text(
    """
    SELECT g.id, g.name
    FROM album_genres ag
    JOIN genres g ON g.id = ag.genre_id
    GROUP BY g.id, g.name
    ORDER BY COUNT(*) DESC, LOWER(g.name), g.id
    LIMIT :genre_limit
    """
)

_PLAYLIST_ACCESS_SQL = text(
    f"""
    SELECT p.id FROM playlists p
    WHERE p.id = :playlist_id AND {_VISIBLE_PLAYLIST}
    """
)

_GENRE_EXISTS_SQL = text("SELECT 1 FROM genres WHERE id = :genre_id")

_PLAYLIST_TRACKS_SQL = text(
    f"""
    WITH page AS (
        SELECT pt.track_id, pt.track_entity_uid, pt.position, pt.id
        FROM playlist_tracks pt
        WHERE pt.playlist_id = :playlist_id
        ORDER BY pt.position, pt.id
        OFFSET :part_offset
        LIMIT :row_limit
    ), resolved AS MATERIALIZED (
        SELECT
            COALESCE(
                page.track_id,
                (
                    SELECT lt.id FROM library_tracks lt
                    WHERE lt.entity_uid = page.track_entity_uid
                )
            ) AS track_id,
            page.position,
            page.id
        FROM page
    )
    SELECT {_TRACK_COLUMNS}
    FROM resolved
    JOIN library_tracks t ON t.id = resolved.track_id
    LEFT JOIN library_albums a ON a.id = t.album_id
    WHERE t.entity_uid IS NOT NULL
    ORDER BY resolved.position, resolved.id
    """
)

_GENRE_TRACKS_SQL = text(
    f"""
    SELECT {_TRACK_COLUMNS}
    FROM album_genres ag
    JOIN library_tracks t ON t.album_id = ag.album_id
    LEFT JOIN library_albums a ON a.id = t.album_id
    WHERE ag.genre_id = :genre_id
      AND t.entity_uid IS NOT NULL
    ORDER BY LOWER(t.artist), LOWER(t.album), t.disc_number, t.track_number, t.id
    LIMIT :row_limit
    """
)

_RECENT_TRACKS_SQL = text(
    f"""
    WITH recent_events AS (
        SELECT upe.track_id, upe.track_entity_uid, upe.ended_at
        FROM user_play_events upe
        WHERE upe.user_id = :user_id
        ORDER BY upe.ended_at DESC
        LIMIT :event_window
    ), recent AS MATERIALIZED (
        SELECT
            COALESCE(
                re.track_id,
                (
                    SELECT lt.id FROM library_tracks lt
                    WHERE lt.entity_uid = re.track_entity_uid
                )
            ) AS track_id,
            MAX(re.ended_at) AS last_played_at
        FROM recent_events re
        GROUP BY 1
    )
    SELECT {_TRACK_COLUMNS}
    FROM recent
    JOIN library_tracks t ON t.id = recent.track_id
    LEFT JOIN library_albums a ON a.id = t.album_id
    WHERE t.entity_uid IS NOT NULL
    ORDER BY recent.last_played_at DESC, t.id
    LIMIT :row_limit
    """
)


def mood_score_expression(mood: str, column: str = "mood_json") -> str:
    if mood not in VDJ_MOODS:
        raise KeyError(mood)
    return (
        f"(CASE WHEN jsonb_typeof({column} -> '{mood}') = 'number' "
        f"THEN ({column} ->> '{mood}')::double precision END)"
    )


def _mood_tracks_sql(mood: str) -> TextClause:
    score = mood_score_expression(mood, "t.mood_json")
    return text(
        f"""
        SELECT {_TRACK_COLUMNS}
        FROM library_tracks t
        LEFT JOIN library_albums a ON a.id = t.album_id
        WHERE t.mood_json IS NOT NULL
          AND {score} >= :threshold
          AND t.entity_uid IS NOT NULL
        ORDER BY {score} DESC NULLS LAST, t.id
        LIMIT :row_limit
        """
    )


def list_vdj_folders(user_id: int | None) -> list[dict[str, str]]:
    folders = [{"id": _RECENT_FOLDER_ID, "name": "Recently Played"}]
    with read_scope() as session:
        playlists = (
            session.execute(
                _LISTED_PLAYLISTS_SQL,
                {"user_id": user_id, "playlist_limit": VDJ_PLAYLIST_FOLDER_LIMIT},
            )
            .mappings()
            .all()
        )
        genres = (
            session.execute(_TOP_GENRES_SQL, {"genre_limit": VDJ_GENRE_FOLDER_LIMIT})
            .mappings()
            .all()
        )
    for playlist in playlists:
        folders.extend(_playlist_folders(playlist))
    folders.extend(
        {"id": f"crate:genre:{genre['id']}", "name": str(genre["name"])}
        for genre in genres
    )
    folders.extend(
        {"id": f"crate:mood:{mood}", "name": mood.capitalize()} for mood in VDJ_MOODS
    )
    return folders


def _playlist_folders(playlist: Mapping[str, Any]) -> list[dict[str, str]]:
    parts = max(1, math.ceil(int(playlist["track_count"]) / VDJ_FOLDER_TRACK_LIMIT))
    if parts == 1:
        return [{"id": f"crate:playlist:{playlist['id']}", "name": playlist["name"]}]
    return [
        {
            "id": f"crate:playlist:{playlist['id']}:part:{part}",
            "name": f"{playlist['name']} ({part}/{parts})",
        }
        for part in range(1, parts + 1)
    ]


def vdj_folder_statement(
    folder_id: str,
    *,
    user_id: int | None,
    limit: int = VDJ_FOLDER_TRACK_LIMIT,
) -> tuple[TextClause, dict[str, Any]]:
    row_limit = max(1, min(int(limit), VDJ_FOLDER_TRACK_LIMIT))
    if folder_id == _RECENT_FOLDER_ID:
        return _RECENT_TRACKS_SQL, {
            "user_id": user_id,
            "event_window": VDJ_RECENT_EVENT_WINDOW,
            "row_limit": row_limit,
        }
    if match := _PLAYLIST_FOLDER.match(folder_id):
        part = int(match.group(2) or 1)
        if part < 1:
            raise KeyError(folder_id)
        return _PLAYLIST_TRACKS_SQL, {
            "playlist_id": int(match.group(1)),
            "part_offset": (part - 1) * VDJ_FOLDER_TRACK_LIMIT,
            "row_limit": row_limit,
        }
    if match := _GENRE_FOLDER.match(folder_id):
        return _GENRE_TRACKS_SQL, {
            "genre_id": int(match.group(1)),
            "row_limit": row_limit,
        }
    if (match := _MOOD_FOLDER.match(folder_id)) and match.group(1) in VDJ_MOODS:
        return _mood_tracks_sql(match.group(1)), {
            "threshold": VDJ_MOOD_THRESHOLD,
            "row_limit": row_limit,
        }
    raise KeyError(folder_id)


def get_vdj_folder_page(
    folder_id: str,
    *,
    user_id: int | None,
    limit: int = VDJ_FOLDER_TRACK_LIMIT,
) -> dict[str, Any]:
    statement, params = vdj_folder_statement(folder_id, user_id=user_id, limit=limit)
    with read_scope() as session:
        if "playlist_id" in params and (
            session.execute(
                _PLAYLIST_ACCESS_SQL,
                {"playlist_id": params["playlist_id"], "user_id": user_id},
            ).first()
            is None
        ):
            raise KeyError(folder_id)
        if "genre_id" in params and (
            session.execute(_GENRE_EXISTS_SQL, {"genre_id": params["genre_id"]}).first()
            is None
        ):
            raise KeyError(folder_id)
        rows = session.execute(statement, params).mappings().all()
    return {
        "folders": [],
        "tracks": [_serialize_track(row) for row in rows],
        "next_cursor": None,
    }


def _serialize_track(row: Mapping[Any, Any]) -> dict[str, Any]:
    item = dict(row)
    album_id = item.pop("album_id", None)
    item["entity_uid"] = str(item["entity_uid"])
    item["has_cover"] = bool(item.pop("has_cover", False))
    item["cover_url"] = (
        f"/api/vdj/albums/{album_id}/cover?size=512"
        if album_id is not None and item["has_cover"]
        else None
    )
    return item


__all__ = [
    "VDJ_FOLDER_TRACK_LIMIT",
    "VDJ_MOODS",
    "get_vdj_folder_page",
    "list_vdj_folders",
    "mood_score_expression",
    "vdj_folder_statement",
]

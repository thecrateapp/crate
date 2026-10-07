from __future__ import annotations

import base64
import binascii
from collections.abc import Mapping
from typing import Any

from sqlalchemy import text

from crate.db.tx import read_scope

VDJ_FOLDER_IDS = (
    "crate:playlists",
    "crate:genres",
    "crate:moods",
    "crate:recently-played",
)

_VDJ_FOLDERS = (
    {"id": "crate:playlists", "name": "Playlists"},
    {"id": "crate:genres", "name": "Genres"},
    {"id": "crate:moods", "name": "Moods"},
    {"id": "crate:recently-played", "name": "Recently Played"},
)

_ORDER_BY_FOLDER = {
    "crate:playlists": "LOWER(t.artist), LOWER(t.album), t.disc_number, t.track_number, t.id",
    "crate:genres": "LOWER(COALESCE(NULLIF(t.genre, ''), NULLIF(a.genre, ''), '')), LOWER(t.artist), LOWER(t.album), t.track_number, t.id",
    "crate:moods": "LOWER(COALESCE(t.mood_json->>'mood', '')), LOWER(t.artist), LOWER(t.album), t.track_number, t.id",
    "crate:recently-played": "recent.last_played_at DESC, t.id",
}


def list_vdj_folders() -> list[dict[str, str]]:
    return [dict(folder) for folder in _VDJ_FOLDERS]


def encode_vdj_cursor(offset: int) -> str:
    raw = f"v1:{max(offset, 0)}".encode("ascii")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def decode_vdj_cursor(cursor: str | None) -> int:
    if not cursor:
        return 0
    padded = cursor + "=" * (-len(cursor) % 4)
    try:
        decoded = base64.urlsafe_b64decode(padded.encode("ascii")).decode("ascii")
        version, raw_offset = decoded.split(":", 1)
        offset = int(raw_offset)
    except (ValueError, UnicodeDecodeError, binascii.Error) as exc:
        raise ValueError("Invalid catalog cursor") from exc
    if version != "v1" or offset < 0:
        raise ValueError("Invalid catalog cursor")
    return offset


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


def get_vdj_folder_page(
    folder_id: str,
    *,
    user_id: int | None,
    cursor: str | None = None,
    limit: int = 100,
) -> dict[str, Any]:
    if folder_id not in VDJ_FOLDER_IDS:
        raise KeyError(folder_id)

    offset = decode_vdj_cursor(cursor)
    bounded_limit = max(1, min(limit, 100))
    order_by = _ORDER_BY_FOLDER[folder_id]
    query = text(
        f"""
        WITH recent AS (
            SELECT
                COALESCE(upe.track_id, lt_by_uid.id) AS track_id,
                MAX(upe.ended_at) AS last_played_at
            FROM user_play_events upe
            LEFT JOIN library_tracks lt_by_uid
              ON upe.track_id IS NULL
             AND upe.track_entity_uid IS NOT NULL
             AND lt_by_uid.entity_uid = upe.track_entity_uid
            WHERE upe.user_id = :user_id
            GROUP BY COALESCE(upe.track_id, lt_by_uid.id)
        )
        SELECT
            t.entity_uid::text AS entity_uid,
            COALESCE(NULLIF(t.title, ''), t.filename) AS title,
            t.artist,
            t.album,
            t.path,
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
            t.mood_json,
            a.id AS album_id,
            COALESCE(a.has_cover, 0) AS has_cover,
            recent.last_played_at
        FROM library_tracks t
        LEFT JOIN library_albums a ON a.id = t.album_id
        LEFT JOIN recent ON recent.track_id = t.id
        WHERE t.entity_uid IS NOT NULL
          AND (:folder_id <> 'crate:genres' OR COALESCE(NULLIF(t.genre, ''), NULLIF(a.genre, '')) IS NOT NULL)
          AND (:folder_id <> 'crate:moods' OR (t.mood_json IS NOT NULL AND t.mood_json <> '{{}}'::jsonb))
          AND (:folder_id <> 'crate:recently-played' OR recent.track_id IS NOT NULL)
          AND (
              :folder_id <> 'crate:playlists'
              OR EXISTS (
                  SELECT 1
                  FROM playlist_tracks pt
                  JOIN playlists p ON p.id = pt.playlist_id
                  WHERE (pt.track_id = t.id OR pt.track_entity_uid = t.entity_uid)
                    AND (
                        p.user_id = :user_id
                        OR EXISTS (
                            SELECT 1
                            FROM playlist_members pm
                            WHERE pm.playlist_id = p.id AND pm.user_id = :user_id
                        )
                    )
              )
          )
        ORDER BY {order_by}
        OFFSET :offset
        LIMIT :row_limit
        """
    )
    with read_scope() as session:
        rows = (
            session.execute(
                query,
                {
                    "folder_id": folder_id,
                    "user_id": user_id,
                    "offset": offset,
                    "row_limit": bounded_limit + 1,
                },
            )
            .mappings()
            .all()
        )

    has_more = len(rows) > bounded_limit
    page_rows = rows[:bounded_limit]
    return {
        "folders": [],
        "tracks": [_serialize_track(row) for row in page_rows],
        "next_cursor": encode_vdj_cursor(offset + bounded_limit) if has_more else None,
    }


__all__ = [
    "VDJ_FOLDER_IDS",
    "decode_vdj_cursor",
    "encode_vdj_cursor",
    "get_vdj_folder_page",
    "list_vdj_folders",
]

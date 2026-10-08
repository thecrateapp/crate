"""Read-only queries for OpenSubsonic popularity and Bliss discovery."""

from __future__ import annotations

from sqlalchemy import text

from crate.db.queries.playable_media_filters import (
    playable_media_params,
    playable_track_clause,
)
from crate.db.tx import read_scope

_TRACK_PROJECTION = """
    entity.global_track_uid::text AS global_track_uid,
    entity.global_album_uid::text AS global_album_uid,
    entity.global_artist_uid::text AS global_artist_uid,
    entity.canonical_title AS title,
    entity.artist_name AS artist,
    COALESCE(entity.album_name, '') AS album,
    COALESCE(entity.track_number, 0)::INTEGER AS track_number,
    COALESCE(entity.disc_number, 1)::INTEGER AS disc_number,
    COALESCE(entity.duration_seconds, 0)::INTEGER AS duration,
    COALESCE(local_track.format, NULLIF(entity.display_source_json->>'format', ''), 'mp3') AS format,
    local_track.bitrate,
    local_track.path,
    album.year,
    COALESCE(album.has_cover, 0) <> 0 AS has_cover,
    local_track.size,
    entity.created_at AS created
"""

_AVAILABLE_TRACK = """(
    entity.has_local OR EXISTS (
        SELECT 1
        FROM global_catalog_sources source
        WHERE source.global_entity_uid = entity.global_track_uid
          AND source.entity_type = 'track'
          AND NOT source.source_stale
          AND source.source_deleted_at IS NULL
    )
)"""


def get_top_songs_for_artist(global_artist_uid: str, *, limit: int) -> list[dict]:
    """Return local songs with stored popularity signals in deterministic rank order."""
    if not global_artist_uid or limit <= 0:
        return []

    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    f"""
                    SELECT {_TRACK_PROJECTION}
                    FROM global_catalog_tracks entity
                    JOIN library_tracks local_track
                      ON local_track.id = entity.local_track_id
                    JOIN library_albums album
                      ON album.id = local_track.album_id
                    WHERE entity.global_artist_uid = CAST(:artist_uid AS UUID)
                      AND {_AVAILABLE_TRACK}
                      AND (
                          local_track.lastfm_top_rank IS NOT NULL
                          OR local_track.spotify_top_rank IS NOT NULL
                          OR local_track.lastfm_playcount IS NOT NULL
                          OR local_track.spotify_track_popularity IS NOT NULL
                          OR local_track.popularity_score IS NOT NULL
                      )
                      AND {playable_track_clause("local_track", "album")}
                    ORDER BY local_track.lastfm_top_rank ASC NULLS LAST,
                             local_track.spotify_top_rank ASC NULLS LAST,
                             local_track.lastfm_playcount DESC NULLS LAST,
                             local_track.spotify_track_popularity DESC NULLS LAST,
                             local_track.popularity_score DESC NULLS LAST,
                             entity.canonical_title,
                             entity.global_track_uid
                    LIMIT :limit
                    """
                ),
                {
                    "artist_uid": global_artist_uid,
                    "limit": min(max(int(limit), 0), 500),
                    "entity_type": "track",
                    **playable_media_params(),
                },
            )
            .mappings()
            .all()
        )
        return [dict(row) for row in rows]


def get_discovery_seed_tracks(
    entity_kind: str, global_entity_uid: str, *, limit: int = 500
) -> list[dict]:
    """Load playable local Bliss vectors for an artist, album, or track ID."""
    uid_columns = {
        "artist": "entity.global_artist_uid",
        "album": "entity.global_album_uid",
        "track": "entity.global_track_uid",
    }
    uid_column = uid_columns.get(entity_kind)
    if uid_column is None or not global_entity_uid or limit <= 0:
        return []

    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    f"""
                    SELECT local_track.id AS track_id,
                           local_track.path,
                           local_track.bliss_vector
                    FROM global_catalog_tracks entity
                    JOIN library_tracks local_track
                      ON local_track.id = entity.local_track_id
                    JOIN library_albums album
                      ON album.id = local_track.album_id
                    WHERE {uid_column} = CAST(:entity_uid AS UUID)
                      AND {_AVAILABLE_TRACK}
                      AND local_track.bliss_vector IS NOT NULL
                      AND {playable_track_clause("local_track", "album")}
                    ORDER BY entity.disc_number NULLS FIRST,
                             entity.track_number NULLS FIRST,
                             entity.global_track_uid
                    LIMIT :limit
                    """
                ),
                {
                    "entity_uid": global_entity_uid,
                    "limit": min(max(int(limit), 0), 500),
                    "entity_type": "track",
                    **playable_media_params(),
                },
            )
            .mappings()
            .all()
        )
        result = []
        for row in rows:
            item = dict(row)
            if item.get("bliss_vector") is not None:
                item["bliss_vector"] = list(item["bliss_vector"])
            result.append(item)
        return result


def get_global_tracks_by_local_ids(track_ids: list[int]) -> dict[int, dict]:
    """Return stable global media projections for local Bliss candidate IDs."""
    normalized_ids = list(dict.fromkeys(int(track_id) for track_id in track_ids))
    if not normalized_ids:
        return {}

    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    f"""
                    SELECT entity.local_track_id,
                           {_TRACK_PROJECTION}
                    FROM global_catalog_tracks entity
                    JOIN library_tracks local_track
                      ON local_track.id = entity.local_track_id
                    JOIN library_albums album
                      ON album.id = local_track.album_id
                    WHERE entity.local_track_id = ANY(:track_ids)
                      AND {_AVAILABLE_TRACK}
                      AND {playable_track_clause("local_track", "album")}
                    """
                ),
                {
                    "track_ids": normalized_ids,
                    "entity_type": "track",
                    **playable_media_params(),
                },
            )
            .mappings()
            .all()
        )
        return {int(row["local_track_id"]): dict(row) for row in rows}


__all__ = [
    "get_discovery_seed_tracks",
    "get_global_tracks_by_local_ids",
    "get_top_songs_for_artist",
]

from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope

_AVAILABLE_SOURCE = """
    entity.has_local OR EXISTS (
        SELECT 1
        FROM global_catalog_sources source
        WHERE source.global_entity_uid = entity.{uid_column}
          AND source.entity_type = :entity_type
          AND NOT source.source_stale
          AND source.source_deleted_at IS NULL
    )
"""


def list_global_artists() -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                f"""
                SELECT entity.global_artist_uid::text AS global_artist_uid,
                       entity.canonical_name AS name,
                       COUNT(album.global_album_uid)::INTEGER AS album_count,
                       entity.has_photo,
                       entity.has_local,
                       entity.has_remote
                FROM global_catalog_artists entity
                LEFT JOIN global_catalog_albums album
                  ON album.global_artist_uid = entity.global_artist_uid
                 AND (
                    album.has_local OR EXISTS (
                        SELECT 1 FROM global_catalog_sources album_source
                        WHERE album_source.global_entity_uid = album.global_album_uid
                          AND album_source.entity_type = 'album'
                          AND NOT album_source.source_stale
                          AND album_source.source_deleted_at IS NULL
                    )
                 )
                WHERE {_AVAILABLE_SOURCE.format(uid_column="global_artist_uid")}
                GROUP BY entity.global_artist_uid
                ORDER BY entity.sort_name, entity.canonical_name
                """
            ),
            {"entity_type": "artist"},
        ).mappings()
        return [dict(row) for row in rows]


def get_global_artist(global_artist_uid: str) -> dict | None:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    f"""
                    SELECT entity.global_artist_uid::text AS global_artist_uid,
                           entity.canonical_name AS name,
                           entity.has_photo,
                           entity.has_local,
                           entity.has_remote
                    FROM global_catalog_artists entity
                    WHERE entity.global_artist_uid = CAST(:uid AS uuid)
                      AND {_AVAILABLE_SOURCE.format(uid_column="global_artist_uid")}
                    """
                ),
                {"uid": global_artist_uid, "entity_type": "artist"},
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None


def _album_select() -> str:
    return """
        entity.global_album_uid::text AS global_album_uid,
        entity.global_artist_uid::text AS global_artist_uid,
        entity.canonical_name AS name,
        entity.artist_name AS artist,
        entity.year,
        COALESCE(entity.track_count, 0)::INTEGER AS track_count,
        COALESCE(entity.total_duration_seconds, 0)::INTEGER AS duration,
        entity.has_cover,
        entity.has_local,
        entity.has_remote
    """


def list_global_artist_albums(global_artist_uid: str) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                f"""
                SELECT {_album_select()}
                FROM global_catalog_albums entity
                WHERE entity.global_artist_uid = CAST(:artist_uid AS uuid)
                  AND {_AVAILABLE_SOURCE.format(uid_column="global_album_uid")}
                ORDER BY entity.year DESC NULLS LAST, entity.canonical_name
                """
            ),
            {"artist_uid": global_artist_uid, "entity_type": "album"},
        ).mappings()
        return [dict(row) for row in rows]


def get_global_album(global_album_uid: str) -> dict | None:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    f"""
                    SELECT {_album_select()}
                    FROM global_catalog_albums entity
                    WHERE entity.global_album_uid = CAST(:uid AS uuid)
                      AND {_AVAILABLE_SOURCE.format(uid_column="global_album_uid")}
                    """
                ),
                {"uid": global_album_uid, "entity_type": "album"},
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None


def _track_select() -> str:
    return """
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
        COALESCE(local_track.path, entity.global_track_uid::text) AS path,
        album.year,
        COALESCE(album.has_cover, false) AS has_cover,
        entity.has_local,
        entity.has_remote
    """


def list_global_album_tracks(global_album_uid: str) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                f"""
                SELECT {_track_select()}
                FROM global_catalog_tracks entity
                LEFT JOIN library_tracks local_track
                  ON local_track.id = entity.local_track_id
                LEFT JOIN global_catalog_albums album
                  ON album.global_album_uid = entity.global_album_uid
                WHERE entity.global_album_uid = CAST(:album_uid AS uuid)
                  AND {_AVAILABLE_SOURCE.format(uid_column="global_track_uid")}
                ORDER BY entity.disc_number NULLS FIRST,
                         entity.track_number NULLS FIRST,
                         entity.canonical_title
                """
            ),
            {"album_uid": global_album_uid, "entity_type": "track"},
        ).mappings()
        return [dict(row) for row in rows]


def get_global_track(global_track_uid: str) -> dict | None:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    f"""
                    SELECT {_track_select()}
                    FROM global_catalog_tracks entity
                    LEFT JOIN library_tracks local_track
                      ON local_track.id = entity.local_track_id
                    LEFT JOIN global_catalog_albums album
                      ON album.global_album_uid = entity.global_album_uid
                    WHERE entity.global_track_uid = CAST(:uid AS uuid)
                      AND {_AVAILABLE_SOURCE.format(uid_column="global_track_uid")}
                    """
                ),
                {"uid": global_track_uid, "entity_type": "track"},
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None


_ALBUM_ORDERS = {
    "alphabeticalByName": "entity.canonical_name ASC, entity.global_album_uid",
    "alphabeticalByArtist": "entity.artist_name ASC, entity.canonical_name ASC",
    "newest": "COALESCE(entity.year, '0') DESC, entity.canonical_name ASC",
    "recent": "entity.updated_at DESC, entity.global_album_uid",
    "frequent": "entity.source_count DESC, entity.canonical_name ASC",
    "random": "RANDOM()",
}


def list_global_albums(list_type: str, *, size: int, offset: int) -> list[dict]:
    order = _ALBUM_ORDERS.get(list_type, _ALBUM_ORDERS["alphabeticalByName"])
    with read_scope() as session:
        rows = session.execute(
            text(
                f"""
                SELECT {_album_select()}
                FROM global_catalog_albums entity
                WHERE {_AVAILABLE_SOURCE.format(uid_column="global_album_uid")}
                ORDER BY {order}
                LIMIT :size OFFSET :offset
                """
            ),
            {
                "entity_type": "album",
                "size": min(max(int(size), 1), 500),
                "offset": max(int(offset), 0),
            },
        ).mappings()
        return [dict(row) for row in rows]


def search_global_catalog(
    query: str, *, artist_limit: int, album_limit: int, track_limit: int
) -> dict[str, list[dict]]:
    pattern = f"%{str(query).strip()[:200]}%"
    with read_scope() as session:
        artists = (
            session.execute(
                text(
                    f"""
                SELECT entity.global_artist_uid::text AS global_artist_uid,
                       entity.canonical_name AS name,
                       entity.has_photo
                FROM global_catalog_artists entity
                WHERE entity.canonical_name ILIKE :pattern ESCAPE '\\'
                  AND {_AVAILABLE_SOURCE.format(uid_column="global_artist_uid")}
                ORDER BY entity.has_local DESC, entity.canonical_name
                LIMIT :limit
                """
                ),
                {
                    "pattern": pattern,
                    "entity_type": "artist",
                    "limit": min(max(artist_limit, 0), 100),
                },
            )
            .mappings()
            .all()
        )
        albums = (
            session.execute(
                text(
                    f"""
                SELECT {_album_select()}
                FROM global_catalog_albums entity
                WHERE (entity.canonical_name ILIKE :pattern ESCAPE '\\'
                       OR entity.artist_name ILIKE :pattern ESCAPE '\\')
                  AND {_AVAILABLE_SOURCE.format(uid_column="global_album_uid")}
                ORDER BY entity.has_local DESC, entity.artist_name, entity.canonical_name
                LIMIT :limit
                """
                ),
                {
                    "pattern": pattern,
                    "entity_type": "album",
                    "limit": min(max(album_limit, 0), 100),
                },
            )
            .mappings()
            .all()
        )
        tracks = (
            session.execute(
                text(
                    f"""
                SELECT {_track_select()}
                FROM global_catalog_tracks entity
                LEFT JOIN library_tracks local_track
                  ON local_track.id = entity.local_track_id
                LEFT JOIN global_catalog_albums album
                  ON album.global_album_uid = entity.global_album_uid
                WHERE (entity.canonical_title ILIKE :pattern ESCAPE '\\'
                       OR entity.artist_name ILIKE :pattern ESCAPE '\\'
                       OR entity.album_name ILIKE :pattern ESCAPE '\\')
                  AND {_AVAILABLE_SOURCE.format(uid_column="global_track_uid")}
                ORDER BY entity.has_local DESC, entity.artist_name, entity.canonical_title
                LIMIT :limit
                """
                ),
                {
                    "pattern": pattern,
                    "entity_type": "track",
                    "limit": min(max(track_limit, 0), 200),
                },
            )
            .mappings()
            .all()
        )
    return {
        "artists": [dict(row) for row in artists],
        "albums": [dict(row) for row in albums],
        "tracks": [dict(row) for row in tracks],
    }


def get_random_global_tracks(size: int) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                f"""
                SELECT {_track_select()}
                FROM global_catalog_tracks entity
                LEFT JOIN library_tracks local_track
                  ON local_track.id = entity.local_track_id
                LEFT JOIN global_catalog_albums album
                  ON album.global_album_uid = entity.global_album_uid
                WHERE {_AVAILABLE_SOURCE.format(uid_column="global_track_uid")}
                ORDER BY RANDOM()
                LIMIT :limit
                """
            ),
            {"entity_type": "track", "limit": min(max(size, 1), 500)},
        ).mappings()
        return [dict(row) for row in rows]


def get_starred_global_tracks(user_id: int, limit: int = 500) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                f"""
                SELECT {_track_select()}, liked.created_at AS starred
                FROM user_global_track_likes liked
                JOIN global_catalog_tracks entity
                  ON entity.global_track_uid = liked.global_track_uid
                LEFT JOIN library_tracks local_track
                  ON local_track.id = entity.local_track_id
                LEFT JOIN global_catalog_albums album
                  ON album.global_album_uid = entity.global_album_uid
                WHERE liked.user_id = :user_id
                  AND {_AVAILABLE_SOURCE.format(uid_column="global_track_uid")}
                ORDER BY liked.created_at DESC
                LIMIT :limit
                """
            ),
            {
                "user_id": user_id,
                "entity_type": "track",
                "limit": min(max(limit, 1), 1000),
            },
        ).mappings()
        return [dict(row) for row in rows]


__all__ = [
    "get_global_album",
    "get_global_artist",
    "get_global_track",
    "get_random_global_tracks",
    "get_starred_global_tracks",
    "list_global_album_tracks",
    "list_global_albums",
    "list_global_artist_albums",
    "list_global_artists",
    "search_global_catalog",
]

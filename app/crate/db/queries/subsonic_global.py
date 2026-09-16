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
        entity.created_at AS created,
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
        local_track.size,
        entity.created_at AS created,
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


def get_global_artist_by_local_id(local_artist_id: int) -> dict | None:
    return _get_global_entity_by_local_id("artist", local_artist_id)


def get_global_album_by_local_id(local_album_id: int) -> dict | None:
    return _get_global_entity_by_local_id("album", local_album_id)


def get_global_track_by_local_id(local_track_id: int) -> dict | None:
    return _get_global_entity_by_local_id("track", local_track_id)


def _get_global_entity_by_local_id(entity_type: str, local_id: int) -> dict | None:
    entity_configs = {
        "artist": (
            "global_catalog_artists",
            "global_artist_uid",
            "local_artist_id",
            "entity.global_artist_uid::text AS global_artist_uid, "
            "entity.canonical_name AS name, entity.has_photo",
            "",
        ),
        "album": (
            "global_catalog_albums",
            "global_album_uid",
            "local_album_id",
            _album_select(),
            "",
        ),
        "track": (
            "global_catalog_tracks",
            "global_track_uid",
            "local_track_id",
            _track_select(),
            """
            LEFT JOIN library_tracks local_track
              ON local_track.id = entity.local_track_id
            LEFT JOIN global_catalog_albums album
              ON album.global_album_uid = entity.global_album_uid
            """,
        ),
    }
    if entity_type not in entity_configs:
        raise ValueError(f"Unsupported OpenSubsonic entity type: {entity_type}")
    table, uid_column, local_column, projection, joins = entity_configs[entity_type]
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    f"""
                    SELECT {projection}
                    FROM {table} entity
                    {joins}
                    WHERE {_AVAILABLE_SOURCE.format(uid_column=uid_column)}
                      AND (
                          entity.{local_column} = :local_id
                          OR EXISTS (
                              SELECT 1
                              FROM global_catalog_sources source
                              WHERE source.global_entity_uid = entity.{uid_column}
                                AND source.entity_type = :entity_type
                                AND source.source_kind = 'local'
                                AND source.local_id = :local_id
                                AND NOT source.source_stale
                                AND source.source_deleted_at IS NULL
                          )
                      )
                    ORDER BY entity.{uid_column}
                    LIMIT 1
                    """
                ),
                {"entity_type": entity_type, "local_id": local_id},
            )
            .mappings()
            .first()
        )
    return dict(row) if row else None


_ALBUM_ORDERS = {
    "alphabeticalByName": "entity.canonical_name ASC, entity.global_album_uid",
    "alphabeticalByArtist": "entity.artist_name ASC, entity.canonical_name ASC, entity.global_album_uid",
    "newest": "COALESCE(entity.year, '0') DESC, entity.canonical_name ASC, entity.global_album_uid",
    "recent": """(
        SELECT MAX(play.ended_at)
        FROM global_catalog_tracks played_track
        JOIN user_play_events play
          ON play.global_track_uid = played_track.global_track_uid
          OR (play.global_track_uid IS NULL
              AND play.track_id = played_track.local_track_id)
        WHERE played_track.global_album_uid = entity.global_album_uid
          AND play.user_id = :user_id
    ) DESC NULLS LAST, entity.artist_name, entity.canonical_name ASC, entity.global_album_uid""",
    "frequent": """(
        SELECT COUNT(*)
        FROM global_catalog_tracks played_track
        JOIN user_play_events play
          ON play.global_track_uid = played_track.global_track_uid
          OR (play.global_track_uid IS NULL
              AND play.track_id = played_track.local_track_id)
        WHERE played_track.global_album_uid = entity.global_album_uid
          AND play.user_id = :user_id
    ) DESC, entity.artist_name, entity.canonical_name ASC, entity.global_album_uid""",
    "highest": """(
        SELECT AVG(NULLIF(rated_track.rating, 0))
        FROM global_catalog_tracks rated_entity
        JOIN library_tracks rated_track ON rated_track.id = rated_entity.local_track_id
        WHERE rated_entity.global_album_uid = entity.global_album_uid
    ) DESC NULLS LAST, entity.artist_name, entity.canonical_name ASC, entity.global_album_uid""",
    "starred": "entity.canonical_name ASC, entity.global_album_uid",
    "random": "RANDOM()",
    "byYear": "entity.year DESC, entity.canonical_name ASC, entity.global_album_uid",
    "byGenre": "entity.canonical_name ASC, entity.global_album_uid",
}

_GENRE_TREE_CTE = """
WITH RECURSIVE genre_tree AS (
    SELECT node.id, node.global_genre_uid
    FROM genre_taxonomy_nodes node
    WHERE node.taxonomy_id = 'crate-core'
      AND LOWER(node.name) = LOWER(:genre)
    UNION
    SELECT child.id, child.global_genre_uid
    FROM genre_tree parent
    JOIN genre_taxonomy_edges edge
      ON edge.target_genre_id = parent.id
     AND edge.relation_type = 'parent'
     AND edge.locked
    JOIN genre_taxonomy_nodes child
      ON child.id = edge.source_genre_id
)
"""


def list_global_albums(
    list_type: str,
    *,
    size: int,
    offset: int,
    from_year: int | None = None,
    to_year: int | None = None,
    genre: str | None = None,
    user_id: int | None = None,
    music_folder_id: str | None = None,
) -> list[dict]:
    if list_type not in _ALBUM_ORDERS:
        raise ValueError(f"Unsupported OpenSubsonic album list type: {list_type}")
    if list_type == "byYear" and (from_year is None or to_year is None):
        raise ValueError("byYear requires from_year and to_year")
    if list_type == "byGenre" and not (genre or "").strip():
        raise ValueError("byGenre requires a genre")

    filters = [f"({_AVAILABLE_SOURCE.format(uid_column='global_album_uid')})"]
    params: dict[str, object] = {
        "entity_type": "album",
        "size": min(max(int(size), 1), 500),
        "offset": max(int(offset), 0),
        "user_id": user_id,
    }
    if music_folder_id is not None:
        filters.append(":music_folder_id = '1'")
        params["music_folder_id"] = music_folder_id
    if list_type == "byYear":
        filters.append(
            "entity.year ~ '^[0-9]{4}$' AND entity.year::integer BETWEEN "
            "LEAST(CAST(:from_year AS INTEGER), CAST(:to_year AS INTEGER)) AND "
            "GREATEST(CAST(:from_year AS INTEGER), CAST(:to_year AS INTEGER))"
        )
        params.update(from_year=from_year, to_year=to_year)
    if list_type == "byGenre":
        filters.append(
            "EXISTS (SELECT 1 FROM global_catalog_entity_genres membership "
            "WHERE membership.entity_type = 'album' "
            "AND membership.global_entity_uid = entity.global_album_uid "
            "AND membership.aggregate_score >= 0.700 "
            "AND membership.global_genre_uid IN "
            "(SELECT global_genre_uid FROM genre_tree))"
        )
        params["genre"] = genre.strip()
    if list_type == "starred":
        filters.append(
            "EXISTS (SELECT 1 FROM global_catalog_tracks liked_track "
            "JOIN user_global_track_likes liked "
            "ON liked.global_track_uid = liked_track.global_track_uid "
            "WHERE liked_track.global_album_uid = entity.global_album_uid "
            "AND liked.user_id = :user_id)"
        )
    order = _ALBUM_ORDERS[list_type]
    if list_type == "byYear":
        direction = "DESC" if from_year > to_year else "ASC"
        order = f"entity.year {direction}, entity.canonical_name ASC, entity.global_album_uid"
    with read_scope() as session:
        rows = session.execute(
            text(
                f"""
                {_GENRE_TREE_CTE if list_type == "byGenre" else ""}
                SELECT {_album_select()}
                FROM global_catalog_albums entity
                WHERE {" AND ".join(filters)}
                ORDER BY {order}
                LIMIT :size OFFSET :offset
                """
            ),
            params,
        ).mappings()
        return [dict(row) for row in rows]


def get_global_catalog_last_modified() -> int:
    with read_scope() as session:
        value = session.execute(
            text(
                """
                SELECT FLOOR(EXTRACT(EPOCH FROM GREATEST(
                    COALESCE((SELECT MAX(updated_at) FROM global_catalog_artists), TIMESTAMPTZ 'epoch'),
                    COALESCE((SELECT MAX(updated_at) FROM global_catalog_albums), TIMESTAMPTZ 'epoch'),
                    COALESCE((SELECT MAX(updated_at) FROM global_catalog_tracks), TIMESTAMPTZ 'epoch')
                )) * 1000)::BIGINT AS last_modified
                """
            )
        ).scalar_one()
    return int(value or 0)


def get_global_tracks_by_genre(
    genre: str, *, size: int, offset: int, music_folder_id: str | None = None
) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                f"""
                WITH RECURSIVE genre_tree AS (
                    SELECT node.id, node.global_genre_uid
                    FROM genre_taxonomy_nodes node
                    WHERE node.taxonomy_id = 'crate-core'
                      AND LOWER(node.name) = LOWER(:genre)
                    UNION
                    SELECT child.id, child.global_genre_uid
                    FROM genre_tree parent
                    JOIN genre_taxonomy_edges edge
                      ON edge.target_genre_id = parent.id
                     AND edge.relation_type = 'parent'
                     AND edge.locked
                    JOIN genre_taxonomy_nodes child
                      ON child.id = edge.source_genre_id
                )
                SELECT {_track_select()}
                FROM global_catalog_tracks entity
                LEFT JOIN library_tracks local_track
                  ON local_track.id = entity.local_track_id
                LEFT JOIN global_catalog_albums album
                  ON album.global_album_uid = entity.global_album_uid
                WHERE ({_AVAILABLE_SOURCE.format(uid_column="global_track_uid")})
                  AND EXISTS (
                      SELECT 1 FROM global_catalog_entity_genres membership
                      WHERE membership.entity_type = 'track'
                        AND membership.global_entity_uid = entity.global_track_uid
                        AND membership.aggregate_score >= 0.700
                        AND membership.global_genre_uid IN (
                            SELECT global_genre_uid FROM genre_tree
                        )
                  )
                  AND (:music_folder_id IS NULL OR :music_folder_id = '1')
                ORDER BY entity.artist_name, entity.album_name,
                         entity.disc_number NULLS FIRST,
                         entity.track_number NULLS FIRST,
                         entity.canonical_title
                LIMIT :size OFFSET :offset
                """
            ),
            {
                "genre": genre,
                "entity_type": "track",
                "size": min(max(int(size), 0), 500),
                "offset": max(int(offset), 0),
                "music_folder_id": music_folder_id,
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


def get_random_global_tracks(
    size: int,
    *,
    genre: str | None = None,
    from_year: int | None = None,
    to_year: int | None = None,
    music_folder_id: str | None = None,
) -> list[dict]:
    filters = [f"({_AVAILABLE_SOURCE.format(uid_column='global_track_uid')})"]
    params: dict[str, object] = {
        "entity_type": "track",
        "limit": min(max(size, 0), 500),
    }
    use_genre_tree = bool(genre and genre.strip())
    if use_genre_tree:
        filters.append(
            "EXISTS (SELECT 1 FROM global_catalog_entity_genres membership "
            "WHERE membership.entity_type = 'track' "
            "AND membership.global_entity_uid = entity.global_track_uid "
            "AND membership.aggregate_score >= 0.700 "
            "AND membership.global_genre_uid IN "
            "(SELECT global_genre_uid FROM genre_tree))"
        )
        params["genre"] = genre.strip()
    if from_year is not None:
        filters.append(
            "album.year ~ '^[0-9]{4}$' "
            "AND album.year::integer >= CAST(:from_year AS INTEGER)"
        )
        params["from_year"] = from_year
    if to_year is not None:
        filters.append(
            "album.year ~ '^[0-9]{4}$' "
            "AND album.year::integer <= CAST(:to_year AS INTEGER)"
        )
        params["to_year"] = to_year
    if music_folder_id is not None:
        filters.append(":music_folder_id = '1'")
        params["music_folder_id"] = music_folder_id

    with read_scope() as session:
        rows = session.execute(
            text(
                f"""
                {_GENRE_TREE_CTE if use_genre_tree else ""}
                SELECT {_track_select()}
                FROM global_catalog_tracks entity
                LEFT JOIN library_tracks local_track
                  ON local_track.id = entity.local_track_id
                LEFT JOIN global_catalog_albums album
                  ON album.global_album_uid = entity.global_album_uid
                WHERE {" AND ".join(filters)}
                ORDER BY RANDOM()
                LIMIT :limit
                """
            ),
            params,
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
    "get_global_album_by_local_id",
    "get_global_artist",
    "get_global_artist_by_local_id",
    "get_global_track",
    "get_global_track_by_local_id",
    "get_global_catalog_last_modified",
    "get_random_global_tracks",
    "get_global_tracks_by_genre",
    "get_starred_global_tracks",
    "list_global_album_tracks",
    "list_global_albums",
    "list_global_artist_albums",
    "list_global_artists",
    "search_global_catalog",
]

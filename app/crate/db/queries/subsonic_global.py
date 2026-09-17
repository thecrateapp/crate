from __future__ import annotations

from typing import Any

from sqlalchemy import text

from crate.db.tx import read_scope

_AVAILABLE_SOURCE = """
    (
        entity.has_local OR EXISTS (
            SELECT 1
            FROM global_catalog_sources source
            WHERE source.global_entity_uid = entity.{uid_column}
              AND source.entity_type = :entity_type
              AND NOT source.source_stale
              AND source.source_deleted_at IS NULL
        )
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


def _search_pattern(value: str | None) -> str | None:
    term = str(value or "").strip()[:200]
    if not term:
        return None
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _search_predicates(
    columns: tuple[str, ...], patterns: tuple[tuple[str, str | None], ...]
) -> str:
    clauses = [
        "("
        + " OR ".join(f"{column} ILIKE :{name} ESCAPE '\\'" for column in columns)
        + ")"
        for name, pattern in patterns
        if pattern is not None
    ]
    return "(" + " OR ".join(clauses) + ")" if clauses else "TRUE"


def search_global_catalog(
    query: str | None = "",
    *,
    artist_limit: int = 20,
    artist_offset: int = 0,
    album_limit: int = 20,
    album_offset: int = 0,
    track_limit: int = 20,
    track_offset: int = 0,
    music_folder_id: str | None = None,
    artist_query: str | None = None,
    album_query: str | None = None,
    song_query: str | None = None,
    any_query: str | None = None,
    newer_than_ms: int | None = None,
    include_track_total: bool = False,
) -> dict[str, Any]:
    if music_folder_id not in {None, "1"}:
        raise ValueError("Unsupported OpenSubsonic music folder")

    query_pattern = _search_pattern(query)
    any_pattern = _search_pattern(any_query)
    artist_pattern = _search_pattern(artist_query)
    album_pattern = _search_pattern(album_query)
    song_pattern = _search_pattern(song_query)
    artist_where = _search_predicates(
        ("entity.canonical_name",),
        (
            ("pattern", query_pattern),
            ("any_pattern", any_pattern),
            ("artist_pattern", artist_pattern),
        ),
    )
    album_where = _search_predicates(
        ("entity.canonical_name", "entity.artist_name"),
        (
            ("pattern", query_pattern),
            ("any_pattern", any_pattern),
            ("album_pattern", album_pattern),
        ),
    )
    track_conditions = [
        "(entity.canonical_title ILIKE :{name} ESCAPE '\\' OR "
        "entity.artist_name ILIKE :{name} ESCAPE '\\' OR "
        "entity.album_name ILIKE :{name} ESCAPE '\\')".format(name=name)
        for name, pattern in (("pattern", query_pattern), ("any_pattern", any_pattern))
        if pattern is not None
    ]
    if artist_pattern is not None:
        track_conditions.append("entity.artist_name ILIKE :artist_pattern ESCAPE '\\'")
    if album_pattern is not None:
        track_conditions.append("entity.album_name ILIKE :album_pattern ESCAPE '\\'")
    if song_pattern is not None:
        track_conditions.append(
            "entity.canonical_title ILIKE :song_pattern ESCAPE '\\'"
        )
    track_where = (
        "(" + " AND ".join(track_conditions) + ")" if track_conditions else "TRUE"
    )

    patterns = {
        name: value
        for name, value in (
            ("pattern", query_pattern),
            ("any_pattern", any_pattern),
            ("artist_pattern", artist_pattern),
            ("album_pattern", album_pattern),
            ("song_pattern", song_pattern),
        )
        if value is not None
    }

    common_params: dict[str, object] = {
        **patterns,
        "music_folder_id": music_folder_id,
        "newer_than_ms": newer_than_ms,
    }
    folder_filter = "(CAST(:music_folder_id AS TEXT) IS NULL OR entity.has_local)"
    newer_filter = "(:newer_than_ms IS NULL OR entity.created_at >= to_timestamp(:newer_than_ms / 1000.0))"

    with read_scope() as session:
        artists = (
            session.execute(
                text(
                    f"""
                SELECT entity.global_artist_uid::text AS global_artist_uid,
                       entity.canonical_name AS name,
                       entity.has_photo,
                       (
                           SELECT COUNT(*)::INTEGER
                           FROM global_catalog_albums album
                           WHERE album.global_artist_uid = entity.global_artist_uid
                             AND (album.has_local OR EXISTS (
                                 SELECT 1 FROM global_catalog_sources source
                                 WHERE source.global_entity_uid = album.global_album_uid
                                   AND source.entity_type = 'album'
                                   AND NOT source.source_stale
                                   AND source.source_deleted_at IS NULL
                             ))
                             AND (CAST(:music_folder_id AS TEXT) IS NULL OR album.has_local)
                       ) AS album_count
                FROM global_catalog_artists entity
                WHERE {artist_where}
                  AND {folder_filter}
                  AND {newer_filter}
                  AND {_AVAILABLE_SOURCE.format(uid_column="global_artist_uid")}
                ORDER BY entity.has_local DESC, entity.sort_name, entity.canonical_name
                LIMIT :limit OFFSET :offset
                """
                ),
                {
                    **common_params,
                    "entity_type": "artist",
                    "limit": min(max(int(artist_limit), 0), 100),
                    "offset": min(max(int(artist_offset), 0), 1_000_000),
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
                WHERE {album_where}
                  AND {folder_filter}
                  AND {newer_filter}
                  AND {_AVAILABLE_SOURCE.format(uid_column="global_album_uid")}
                ORDER BY entity.has_local DESC, entity.artist_name, entity.canonical_name
                LIMIT :limit OFFSET :offset
                """
                ),
                {
                    **common_params,
                    "entity_type": "album",
                    "limit": min(max(int(album_limit), 0), 100),
                    "offset": min(max(int(album_offset), 0), 1_000_000),
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
                WHERE {track_where}
                  AND {folder_filter}
                  AND {newer_filter}
                  AND {_AVAILABLE_SOURCE.format(uid_column="global_track_uid")}
                ORDER BY entity.has_local DESC, entity.artist_name, entity.canonical_title
                LIMIT :limit OFFSET :offset
                """
                ),
                {
                    **common_params,
                    "entity_type": "track",
                    "limit": min(max(int(track_limit), 0), 200),
                    "offset": min(max(int(track_offset), 0), 1_000_000),
                },
            )
            .mappings()
            .all()
        )
        result: dict[str, Any] = {
            "artists": [dict(row) for row in artists],
            "albums": [dict(row) for row in albums],
            "tracks": [dict(row) for row in tracks],
        }
        if include_track_total:
            total = session.execute(
                text(
                    f"""
                SELECT COUNT(*)::INTEGER
                FROM global_catalog_tracks entity
                WHERE {track_where}
                  AND {folder_filter}
                  AND {newer_filter}
                  AND {_AVAILABLE_SOURCE.format(uid_column="global_track_uid")}
                """
                ),
                {**common_params, "entity_type": "track"},
            ).scalar_one()
            result["track_total"] = int(total)
    return result


def get_global_artist_metadata(global_artist_uid: str) -> dict | None:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    f"""
                SELECT entity.global_artist_uid::text AS global_artist_uid,
                       entity.canonical_name AS name,
                       COALESCE(NULLIF(local_artist.mbid, ''), entity.musicbrainz_artist_mbid) AS musicbrainz_id,
                       local_artist.bio AS biography,
                       local_artist.urls_json,
                       local_artist.similar_json,
                       entity.has_photo
                FROM global_catalog_artists entity
                LEFT JOIN library_artists local_artist
                  ON local_artist.id = entity.local_artist_id
                WHERE entity.global_artist_uid = CAST(:uid AS UUID)
                  AND {_AVAILABLE_SOURCE.format(uid_column="global_artist_uid")}
                """
                ),
                {"uid": global_artist_uid, "entity_type": "artist"},
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None


def get_global_album_metadata(global_album_uid: str) -> dict | None:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    f"""
                SELECT entity.global_album_uid::text AS global_album_uid,
                       entity.global_artist_uid::text AS global_artist_uid,
                       entity.canonical_name AS name,
                       COALESCE(NULLIF(local_album.musicbrainz_albumid, ''),
                                entity.musicbrainz_release_mbid,
                                entity.musicbrainz_release_group_mbid) AS musicbrainz_id,
                       (entity.has_cover OR COALESCE(local_album.has_cover, 0) > 0) AS has_cover
                FROM global_catalog_albums entity
                LEFT JOIN library_albums local_album
                  ON local_album.id = entity.local_album_id
                WHERE entity.global_album_uid = CAST(:uid AS UUID)
                  AND {_AVAILABLE_SOURCE.format(uid_column="global_album_uid")}
                """
                ),
                {"uid": global_album_uid, "entity_type": "album"},
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None


def get_global_artists_by_names(
    names: list[str], *, include_not_present: bool, limit: int
) -> list[dict]:
    normalized_names = [name.strip().casefold() for name in names if name.strip()]
    if not normalized_names or limit <= 0:
        return []
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    f"""
                SELECT entity.global_artist_uid::text AS global_artist_uid,
                       entity.canonical_name AS name,
                       entity.has_photo,
                       entity.sort_name
                FROM global_catalog_artists entity
                WHERE LOWER(entity.canonical_name) = ANY(CAST(:names AS TEXT[]))
                  AND (:include_not_present OR entity.has_local)
                  AND {_AVAILABLE_SOURCE.format(uid_column="global_artist_uid")}
                ORDER BY entity.has_local DESC, entity.sort_name, entity.canonical_name
                LIMIT :limit
                """
                ),
                {
                    "names": normalized_names,
                    "include_not_present": include_not_present,
                    "entity_type": "artist",
                    "limit": min(max(int(limit), 0), 100),
                },
            )
            .mappings()
            .all()
        )
        return [dict(row) for row in rows]


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
    "get_global_album_metadata",
    "get_global_artist",
    "get_global_artist_by_local_id",
    "get_global_artist_metadata",
    "get_global_artists_by_names",
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

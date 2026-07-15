"""Database reads for the signed local federation manifest."""

from __future__ import annotations

from typing import Any

from sqlalchemy import text

from crate.db.tx import read_scope


_ENTITY_ORDER = ("album", "artist", "track")

_ENTITY_SELECTS = {
    "album": """
        SELECT
            'album' AS entity_type,
            entity_uid::text AS remote_entity_uid,
            name AS title,
            artist,
            name AS album,
            year::text AS year,
            total_duration::double precision AS duration_seconds,
            NULL::integer AS track_number,
            NULL::integer AS disc_number,
            NULL::boolean AS has_photo,
            (COALESCE(has_cover, 0) <> 0) AS has_cover,
            (
                SELECT COALESCE(
                    jsonb_agg(
                        jsonb_build_object('raw_label', g.name, 'weight', ag.weight)
                        ORDER BY ag.weight DESC, g.name ASC
                    ),
                    '[]'::jsonb
                )
                FROM album_genres ag
                JOIN genres g ON g.id = ag.genre_id
                WHERE ag.album_id = library_albums.id
            ) AS genres_json,
            NULL::text AS genre,
            NULL::double precision AS bpm,
            NULL::double precision AS energy,
            NULL::double precision AS danceability,
            NULL::double precision AS valence,
            NULL::double precision AS acousticness,
            NULL::double precision AS instrumentalness,
            NULL::text AS format,
            NULL::integer AS bitrate,
            NULL::integer AS sample_rate,
            NULL::integer AS bit_depth,
            NULL::bigint AS size_bytes,
            updated_at,
            'library' AS _share_scope
        FROM library_albums
        WHERE entity_uid IS NOT NULL
          AND quarantined_at IS NULL
    """,
    "artist": """
        SELECT
            'artist' AS entity_type,
            entity_uid::text AS remote_entity_uid,
            name AS title,
            name AS artist,
            NULL::text AS album,
            NULL::text AS year,
            NULL::double precision AS duration_seconds,
            NULL::integer AS track_number,
            NULL::integer AS disc_number,
            (COALESCE(has_photo, 0) <> 0) AS has_photo,
            NULL::boolean AS has_cover,
            (
                SELECT COALESCE(
                    jsonb_agg(
                        jsonb_build_object('raw_label', g.name, 'weight', ag.weight)
                        ORDER BY ag.weight DESC, g.name ASC
                    ),
                    '[]'::jsonb
                )
                FROM artist_genres ag
                JOIN genres g ON g.id = ag.genre_id
                WHERE ag.artist_name = library_artists.name
            ) AS genres_json,
            NULL::text AS genre,
            NULL::double precision AS bpm,
            NULL::double precision AS energy,
            NULL::double precision AS danceability,
            NULL::double precision AS valence,
            NULL::double precision AS acousticness,
            NULL::double precision AS instrumentalness,
            NULL::text AS format,
            NULL::integer AS bitrate,
            NULL::integer AS sample_rate,
            NULL::integer AS bit_depth,
            NULL::bigint AS size_bytes,
            updated_at,
            'library' AS _share_scope
        FROM library_artists
        WHERE entity_uid IS NOT NULL
          AND name NOT LIKE '.%'
          AND (folder_name IS NULL OR folder_name NOT LIKE '.%')
    """,
    "track": """
        SELECT
            'track' AS entity_type,
            lt.entity_uid::text AS remote_entity_uid,
            COALESCE(NULLIF(lt.title, ''), lt.filename) AS title,
            lt.artist,
            lt.album,
            lt.year::text AS year,
            lt.duration::double precision AS duration_seconds,
            lt.track_number,
            lt.disc_number,
            NULL::boolean AS has_photo,
            NULL::boolean AS has_cover,
            '[]'::jsonb AS genres_json,
            lt.genre::text AS genre,
            COALESCE(taf.bpm, lt.bpm)::double precision AS bpm,
            COALESCE(taf.energy, lt.energy)::double precision AS energy,
            COALESCE(taf.danceability, lt.danceability)::double precision
                AS danceability,
            COALESCE(taf.valence, lt.valence)::double precision AS valence,
            COALESCE(taf.acousticness, lt.acousticness)::double precision
                AS acousticness,
            COALESCE(taf.instrumentalness, lt.instrumentalness)::double precision
                AS instrumentalness,
            LOWER(NULLIF(lt.format, ''))::text AS format,
            CASE WHEN lt.bitrate IS NULL THEN NULL
                ELSE FLOOR(lt.bitrate / 1000.0)::integer END AS bitrate,
            lt.sample_rate::integer AS sample_rate,
            lt.bit_depth::integer AS bit_depth,
            lt.size::bigint AS size_bytes,
            lt.updated_at,
            'library' AS _share_scope
        FROM library_tracks lt
        LEFT JOIN track_analysis_features taf ON taf.track_id = lt.id
        WHERE lt.entity_uid IS NOT NULL
    """,
}


def _entity_page_sql(entity_type: str) -> str:
    uid_column = "lt.entity_uid" if entity_type == "track" else "entity_uid"
    allowed_key = f"allowed_{entity_type}_uids"
    return (
        _ENTITY_SELECTS[entity_type]
        + f"""
          AND (CAST(NULLIF(:after_entity_uid, '') AS uuid) IS NULL OR
               {uid_column} > CAST(NULLIF(:after_entity_uid, '') AS uuid))
          AND :share_allowed
          AND (
            (
              cardinality(CAST(:allowed_entity_uids AS text[])) = 0
              AND cardinality(CAST(:{allowed_key} AS text[])) = 0
            )
            OR {uid_column}::text = ANY(CAST(:allowed_entity_uids AS text[]))
            OR {uid_column}::text = ANY(CAST(:{allowed_key} AS text[]))
          )
          AND NOT ({uid_column}::text = ANY(CAST(:denied_entity_uids AS text[])))
        ORDER BY {uid_column}
        LIMIT :limit
        """
    )


def list_federation_manifest_rows(
    *,
    after_entity_type: str,
    after_entity_uid: str,
    limit: int,
    policy_params: dict[str, Any],
) -> list[dict[str, Any]]:
    """Read one bounded page using the per-entity UUID indexes."""
    if after_entity_type and after_entity_type not in _ENTITY_ORDER:
        raise ValueError("Unsupported manifest cursor entity type")
    page_limit = max(1, int(limit))
    start_index = _ENTITY_ORDER.index(after_entity_type) if after_entity_type else 0
    result: list[dict[str, Any]] = []
    with read_scope() as session:
        for index in range(start_index, len(_ENTITY_ORDER)):
            entity_type = _ENTITY_ORDER[index]
            remaining = page_limit - len(result)
            if remaining <= 0:
                break
            rows = (
                session.execute(
                    text(_entity_page_sql(entity_type)),
                    {
                        "after_entity_uid": (
                            after_entity_uid if entity_type == after_entity_type else ""
                        ),
                        "limit": remaining,
                        **policy_params,
                    },
                )
                .mappings()
                .all()
            )
            result.extend(dict(row) for row in rows)
    return result


def get_federation_manifest_revision_row(
    policy_params: dict[str, Any],
) -> dict[str, Any]:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    SELECT COUNT(*)::bigint AS total_items,
                           MAX(updated_at) AS latest_update
                    FROM (
                        SELECT
                            'artist'::text AS entity_type,
                            entity_uid::text AS remote_entity_uid,
                            updated_at
                        FROM library_artists
                        WHERE entity_uid IS NOT NULL
                          AND name NOT LIKE '.%'
                          AND (folder_name IS NULL OR folder_name NOT LIKE '.%')
                        UNION ALL
                        SELECT
                            'album'::text AS entity_type,
                            entity_uid::text AS remote_entity_uid,
                            updated_at
                        FROM library_albums
                        WHERE entity_uid IS NOT NULL
                          AND quarantined_at IS NULL
                        UNION ALL
                        SELECT
                            'track'::text AS entity_type,
                            entity_uid::text AS remote_entity_uid,
                            updated_at
                        FROM library_tracks
                        WHERE entity_uid IS NOT NULL
                    ) AS catalog
                    WHERE :share_allowed
                      AND (
                        (
                          cardinality(CAST(:allowed_entity_uids AS text[])) = 0
                          AND CASE catalog.entity_type
                            WHEN 'artist' THEN cardinality(
                                CAST(:allowed_artist_uids AS text[])
                            ) = 0
                            WHEN 'album' THEN cardinality(
                                CAST(:allowed_album_uids AS text[])
                            ) = 0
                            WHEN 'track' THEN cardinality(
                                CAST(:allowed_track_uids AS text[])
                            ) = 0
                            ELSE TRUE
                          END
                        )
                        OR catalog.remote_entity_uid = ANY(
                            CAST(:allowed_entity_uids AS text[])
                        )
                        OR CASE catalog.entity_type
                          WHEN 'artist' THEN catalog.remote_entity_uid = ANY(
                              CAST(:allowed_artist_uids AS text[])
                          )
                          WHEN 'album' THEN catalog.remote_entity_uid = ANY(
                              CAST(:allowed_album_uids AS text[])
                          )
                          WHEN 'track' THEN catalog.remote_entity_uid = ANY(
                              CAST(:allowed_track_uids AS text[])
                          )
                          ELSE FALSE
                        END
                      )
                      AND NOT (
                        catalog.remote_entity_uid = ANY(
                            CAST(:denied_entity_uids AS text[])
                        )
                      )
                    """
                ),
                policy_params,
            )
            .mappings()
            .one()
        )
    return dict(row)


__all__ = [
    "get_federation_manifest_revision_row",
    "list_federation_manifest_rows",
]

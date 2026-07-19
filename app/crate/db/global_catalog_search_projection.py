"""Materialized search documents for the canonical global catalog."""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import text

from crate.db.tx import read_scope, transaction_scope

_ENTITY_TYPES = ("artist", "album", "track")


def get_global_catalog_search_projection_status() -> str:
    """Return the persisted projection state used by startup recovery."""
    with read_scope() as session:
        status = session.execute(
            text(
                """
                SELECT status
                FROM global_catalog_search_projection_state
                WHERE singleton = true
                """
            )
        ).scalar_one_or_none()
    return str(status or "warming")


def _document_sql(entity_type: str):
    if entity_type == "artist":
        return _UPSERT_ARTIST_DOCUMENT_SQL
    if entity_type == "album":
        return _UPSERT_ALBUM_DOCUMENT_SQL
    if entity_type == "track":
        return _UPSERT_TRACK_DOCUMENT_SQL
    raise ValueError(f"Unsupported global catalog entity type: {entity_type}")


def upsert_global_catalog_search_document(
    entity_type: str,
    global_entity_uid: str,
    *,
    session=None,
) -> None:
    """Refresh or delete one document in the caller's catalog transaction."""
    upsert_global_catalog_search_documents(
        entity_type,
        [global_entity_uid],
        session=session,
    )


def upsert_global_catalog_search_documents(
    entity_type: str,
    global_entity_uids: list[str] | tuple[str, ...],
    *,
    session=None,
) -> None:
    """Refresh a bounded entity batch in one database round-trip."""
    cleaned_uids = list(dict.fromkeys(str(uid) for uid in global_entity_uids if uid))
    if not cleaned_uids:
        return
    statement = _document_sql(entity_type)
    params = {"global_entity_uids": cleaned_uids}
    if session is not None:
        session.execute(statement, params)
        return
    with transaction_scope() as owned_session:
        owned_session.execute(statement, params)


def next_search_projection_cursor(
    entity_type: str,
    after_uid: str | None,
    *,
    completed_kind: bool,
) -> dict[str, str | None]:
    if entity_type not in _ENTITY_TYPES:
        raise ValueError(f"Unsupported global catalog entity type: {entity_type}")
    if not completed_kind:
        return {"entity_type": entity_type, "after_uid": after_uid}
    index = _ENTITY_TYPES.index(entity_type)
    if index == len(_ENTITY_TYPES) - 1:
        return {"entity_type": "completed", "after_uid": None}
    return {"entity_type": _ENTITY_TYPES[index + 1], "after_uid": None}


def begin_global_catalog_search_rebuild() -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE global_catalog_search_projection_state
                SET status = CASE
                        WHEN status IN ('ready', 'refreshing', 'degraded')
                            THEN 'refreshing'
                        ELSE 'backfilling'
                    END,
                    started_at = COALESCE(started_at, NOW()),
                    last_error = NULL, updated_at = NOW()
                WHERE singleton = true
                """
            )
        )


def rebuild_global_catalog_search_documents_batch(
    *,
    batch_size: int = 500,
    cursor: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Upsert one resumable UUID-ordered batch without blanking the live index."""
    capped_batch = max(1, min(int(batch_size or 500), 5000))
    current = dict(cursor or {})
    entity_type = str(current.get("entity_type") or "artist")
    after_uid = current.get("after_uid")
    if entity_type == "completed":
        _complete_global_catalog_search_rebuild()
        return {"completed": True, "processed": 0, "next_cursor": None}
    table, uid_column = _canonical_table(entity_type)
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    f"""
                    SELECT {uid_column}::text AS global_entity_uid
                    FROM {table}
                    WHERE (:after_uid IS NULL OR {uid_column} > CAST(:after_uid AS uuid))
                    ORDER BY {uid_column}
                    LIMIT :limit
                    """
                ),
                {"after_uid": after_uid, "limit": capped_batch},
            )
            .mappings()
            .all()
        )
    with transaction_scope() as session:
        upsert_global_catalog_search_documents(
            entity_type,
            [str(row["global_entity_uid"]) for row in rows],
            session=session,
        )

    completed_kind = len(rows) < capped_batch
    last_uid = str(rows[-1]["global_entity_uid"]) if rows else after_uid
    next_cursor = next_search_projection_cursor(
        entity_type, last_uid, completed_kind=completed_kind
    )
    completed = next_cursor["entity_type"] == "completed"
    if completed:
        _complete_global_catalog_search_rebuild()
        next_cursor_result = None
    else:
        _persist_search_cursor(next_cursor)
        next_cursor_result = next_cursor
    return {
        "completed": completed,
        "processed": len(rows),
        "entity_type": entity_type,
        "next_cursor": next_cursor_result,
    }


def fail_global_catalog_search_rebuild(error: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE global_catalog_search_projection_state
                SET status = CASE
                        WHEN status = 'refreshing' THEN 'degraded'
                        ELSE 'failed'
                    END,
                    last_error = :error, updated_at = NOW()
                WHERE singleton = true
                """
            ),
            {"error": str(error)[:4000]},
        )


def _persist_search_cursor(cursor: dict[str, Any]) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE global_catalog_search_projection_state
                SET status = CASE
                        WHEN status IN ('ready', 'refreshing', 'degraded')
                            THEN 'refreshing'
                        ELSE 'backfilling'
                    END,
                    cursor_json = CAST(:cursor AS jsonb),
                    updated_at = NOW()
                WHERE singleton = true
                """
            ),
            {"cursor": json.dumps(cursor)},
        )


def _complete_global_catalog_search_rebuild() -> None:
    with transaction_scope() as session:
        for entity_type, table, uid_column in (
            ("artist", "global_catalog_artists", "global_artist_uid"),
            ("album", "global_catalog_albums", "global_album_uid"),
            ("track", "global_catalog_tracks", "global_track_uid"),
        ):
            session.execute(
                text(
                    f"""
                    DELETE FROM global_catalog_search_documents document
                    WHERE document.entity_type = :entity_type
                      AND NOT EXISTS (
                          SELECT 1 FROM {table} canonical
                          WHERE canonical.{uid_column} = document.global_entity_uid
                      )
                    """
                ),
                {"entity_type": entity_type},
            )
        session.execute(
            text(
                """
                UPDATE global_catalog_search_projection_state
                SET status = 'ready', cursor_json = '{}'::jsonb,
                    total_documents = (
                        SELECT COUNT(*) FROM global_catalog_search_documents
                    ), last_error = NULL, completed_at = NOW(), updated_at = NOW()
                WHERE singleton = true
                """
            )
        )


def _canonical_table(entity_type: str) -> tuple[str, str]:
    mapping = {
        "artist": ("global_catalog_artists", "global_artist_uid"),
        "album": ("global_catalog_albums", "global_album_uid"),
        "track": ("global_catalog_tracks", "global_track_uid"),
    }
    try:
        return mapping[entity_type]
    except KeyError as exc:
        raise ValueError(
            f"Unsupported global catalog entity type: {entity_type}"
        ) from exc


_UPSERT_ARTIST_DOCUMENT_SQL = text(
    """
    WITH deleted AS (
        DELETE FROM global_catalog_search_documents document
        WHERE document.entity_type = 'artist'
          AND document.global_entity_uid = ANY(CAST(:global_entity_uids AS uuid[]))
          AND NOT EXISTS (
              SELECT 1 FROM global_catalog_artists
              WHERE global_artist_uid = document.global_entity_uid
          )
    ), canonical AS (
        SELECT artist.*,
               EXISTS (
                   SELECT 1 FROM global_catalog_sources source
                   WHERE source.entity_type = 'artist'
                     AND source.global_entity_uid = artist.global_artist_uid
                     AND NOT source.source_stale AND source.source_deleted_at IS NULL
               ) AS has_healthy_source
        FROM global_catalog_artists artist
        WHERE artist.global_artist_uid = ANY(CAST(:global_entity_uids AS uuid[]))
    )
    INSERT INTO global_catalog_search_documents (
        entity_type, global_entity_uid, search_text, normalized_text,
        payload_json, source_count, has_local, has_remote, has_healthy_source
    )
    SELECT 'artist', global_artist_uid, canonical_name, normalized_name,
           jsonb_build_object(
               'id', local_artist_id,
               'entity_uid', local_artist_entity_uid::text,
               'local_artist_entity_uid', local_artist_entity_uid::text,
               'global_uid', global_artist_uid::text,
               'global_artist_uid', global_artist_uid::text,
               'slug', COALESCE(NULLIF(public_slug, ''), 'artist'),
               'name', canonical_name,
               'has_photo', has_photo,
               'availability', COALESCE(availability_json, '{}'::jsonb) ||
                   jsonb_build_object('local', has_local, 'remote', has_remote,
                                      'healthy', has_healthy_source)
           ), source_count, has_local, has_remote, has_healthy_source
    FROM canonical
    ON CONFLICT (entity_type, global_entity_uid) DO UPDATE SET
        search_text = EXCLUDED.search_text,
        normalized_text = EXCLUDED.normalized_text,
        payload_json = EXCLUDED.payload_json,
        source_count = EXCLUDED.source_count,
        has_local = EXCLUDED.has_local,
        has_remote = EXCLUDED.has_remote,
        has_healthy_source = EXCLUDED.has_healthy_source,
        updated_at = NOW()
    """
)

_UPSERT_ALBUM_DOCUMENT_SQL = text(
    """
    WITH deleted AS (
        DELETE FROM global_catalog_search_documents document
        WHERE document.entity_type = 'album'
          AND document.global_entity_uid = ANY(CAST(:global_entity_uids AS uuid[]))
          AND NOT EXISTS (
              SELECT 1 FROM global_catalog_albums
              WHERE global_album_uid = document.global_entity_uid
          )
    ), canonical AS (
        SELECT album.*,
               EXISTS (
                   SELECT 1 FROM global_catalog_sources source
                   WHERE source.entity_type = 'album'
                     AND source.global_entity_uid = album.global_album_uid
                     AND NOT source.source_stale AND source.source_deleted_at IS NULL
               ) AS has_healthy_source
        FROM global_catalog_albums album
        WHERE album.global_album_uid = ANY(CAST(:global_entity_uids AS uuid[]))
    )
    INSERT INTO global_catalog_search_documents (
        entity_type, global_entity_uid, search_text, normalized_text,
        payload_json, source_count, has_local, has_remote, has_healthy_source
    )
    SELECT 'album', global_album_uid, artist_name || ' ' || canonical_name,
           normalized_name,
           jsonb_build_object(
               'id', local_album_id,
               'entity_uid', local_album_entity_uid::text,
               'local_album_entity_uid', local_album_entity_uid::text,
               'global_uid', global_album_uid::text,
               'global_album_uid', global_album_uid::text,
               'global_artist_uid', global_artist_uid::text,
               'artist_entity_uid', NULL,
               'slug', COALESCE(NULLIF(public_slug, ''), 'album'),
               'artist_slug', COALESCE(NULLIF(artist_slug, ''), 'artist'),
               'artist', artist_name,
               'name', canonical_name,
               'display_name', canonical_name,
               'year', year,
               'tracks', COALESCE(track_count, 0),
               'formats', '[]'::jsonb,
               'size_mb', 0,
               'has_cover', has_cover,
               'availability', COALESCE(availability_json, '{}'::jsonb) ||
                   jsonb_build_object('local', has_local, 'remote', has_remote,
                                      'healthy', has_healthy_source)
           ), source_count, has_local, has_remote, has_healthy_source
    FROM canonical
    ON CONFLICT (entity_type, global_entity_uid) DO UPDATE SET
        search_text = EXCLUDED.search_text,
        normalized_text = EXCLUDED.normalized_text,
        payload_json = EXCLUDED.payload_json,
        source_count = EXCLUDED.source_count,
        has_local = EXCLUDED.has_local,
        has_remote = EXCLUDED.has_remote,
        has_healthy_source = EXCLUDED.has_healthy_source,
        updated_at = NOW()
    """
)

_UPSERT_TRACK_DOCUMENT_SQL = text(
    """
    WITH deleted AS (
        DELETE FROM global_catalog_search_documents document
        WHERE document.entity_type = 'track'
          AND document.global_entity_uid = ANY(CAST(:global_entity_uids AS uuid[]))
          AND NOT EXISTS (
              SELECT 1 FROM global_catalog_tracks
              WHERE global_track_uid = document.global_entity_uid
          )
    ), canonical AS (
        SELECT track.*,
               EXISTS (
                   SELECT 1 FROM global_catalog_sources source
                   WHERE source.entity_type = 'track'
                     AND source.global_entity_uid = track.global_track_uid
                     AND NOT source.source_stale AND source.source_deleted_at IS NULL
               ) AS has_healthy_source
        FROM global_catalog_tracks track
        WHERE track.global_track_uid = ANY(CAST(:global_entity_uids AS uuid[]))
    )
    INSERT INTO global_catalog_search_documents (
        entity_type, global_entity_uid, search_text, normalized_text,
        payload_json, source_count, has_local, has_remote, has_healthy_source
    )
    SELECT 'track', global_track_uid,
           artist_name || ' ' || COALESCE(album_name || ' ', '') || canonical_title,
           normalized_title,
           jsonb_build_object(
               'id', local_track_id,
               'entity_uid', local_track_entity_uid::text,
               'global_uid', global_track_uid::text,
               'global_track_uid', global_track_uid::text,
               'globalTrackUid', global_track_uid::text,
               'global_artist_uid', global_artist_uid::text,
               'global_album_uid', global_album_uid::text,
               'artist_entity_uid', NULL,
               'album_entity_uid', NULL,
               'title', canonical_title,
               'artist', artist_name,
               'album', album_name,
               'duration', duration_seconds,
               'path', NULL,
               'availability', COALESCE(availability_json, '{}'::jsonb) ||
                   jsonb_build_object('local', has_local, 'remote', has_remote,
                                      'healthy', has_healthy_source)
           ), source_count, has_local, has_remote, has_healthy_source
    FROM canonical
    ON CONFLICT (entity_type, global_entity_uid) DO UPDATE SET
        search_text = EXCLUDED.search_text,
        normalized_text = EXCLUDED.normalized_text,
        payload_json = EXCLUDED.payload_json,
        source_count = EXCLUDED.source_count,
        has_local = EXCLUDED.has_local,
        has_remote = EXCLUDED.has_remote,
        has_healthy_source = EXCLUDED.has_healthy_source,
        updated_at = NOW()
    """
)


__all__ = [
    "get_global_catalog_search_projection_status",
    "begin_global_catalog_search_rebuild",
    "fail_global_catalog_search_rebuild",
    "next_search_projection_cursor",
    "rebuild_global_catalog_search_documents_batch",
    "upsert_global_catalog_search_document",
    "upsert_global_catalog_search_documents",
]

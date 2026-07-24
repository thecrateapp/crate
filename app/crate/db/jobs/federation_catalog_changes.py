"""Transactional producer and reads for the local federation change log."""

from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import text

from crate.db.tx import read_scope, transaction_scope


def _retention_days() -> int:
    try:
        configured = int(os.environ.get("CRATE_FEDERATION_DELTA_RETENTION_DAYS", "90"))
    except ValueError:
        configured = 90
    return max(7, configured)


def _payload_revision(payload: dict[str, Any]) -> str:
    encoded = json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
        default=str,
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def _catalog_payload_facets(
    entity_type: str, payload: dict[str, Any]
) -> dict[str, dict[str, bool]]:
    if entity_type == "artist":
        has_photo = bool(payload.get("has_photo"))
        return {
            "metadata": {"available": True},
            "artist_info": {"available": True},
            "artist_background": {"available": has_photo},
            "artist_photo": {"available": has_photo},
            "artist_shows": {"available": False},
        }
    if entity_type == "album":
        has_cover = bool(payload.get("has_cover"))
        return {
            "metadata": {"available": True},
            "album_detail": {"available": True},
            "album_artwork": {"available": has_cover},
        }
    return {
        "metadata": {"available": True},
        "track_info": {"available": True},
        "track_analysis": {"available": False},
        "playback": {"available": True},
    }


def load_local_catalog_payload(
    session, entity_type: str, entity_uid: str
) -> dict[str, Any] | None:
    if entity_type == "artist":
        sql = """
            SELECT jsonb_build_object(
                'entity_type', 'artist',
                'remote_entity_uid', entity_uid::text,
                'title', name,
                'artist', name,
                'has_photo', (COALESCE(has_photo, 0) <> 0),
                'genres', COALESCE((
                    SELECT jsonb_agg(g.name ORDER BY ag.weight DESC, g.name)
                    FROM artist_genres ag
                    JOIN genres g ON g.id = ag.genre_id
                    WHERE ag.artist_name = library_artists.name
                ), '[]'::jsonb)
            ) AS payload
            FROM library_artists
            WHERE entity_uid::text = :entity_uid
              AND name NOT LIKE '.%'
              AND (folder_name IS NULL OR folder_name NOT LIKE '.%')
        """
    elif entity_type == "album":
        sql = """
            SELECT jsonb_build_object(
                'entity_type', 'album',
                'remote_entity_uid', entity_uid::text,
                'title', name,
                'artist', artist,
                'album', name,
                'year', year,
                'duration_seconds', total_duration,
                'has_cover', (COALESCE(has_cover, 0) <> 0),
                'genres', COALESCE((
                    SELECT jsonb_agg(g.name ORDER BY ag.weight DESC, g.name)
                    FROM album_genres ag
                    JOIN genres g ON g.id = ag.genre_id
                    WHERE ag.album_id = library_albums.id
                ), '[]'::jsonb)
            ) AS payload
            FROM library_albums
            WHERE entity_uid::text = :entity_uid
              AND quarantined_at IS NULL
        """
    elif entity_type == "track":
        sql = """
            SELECT jsonb_strip_nulls(jsonb_build_object(
                'entity_type', 'track',
                'remote_entity_uid', track.entity_uid::text,
                'title', COALESCE(NULLIF(track.title, ''), track.filename),
                'artist', track.artist,
                'album', track.album,
                'year', track.year,
                'duration_seconds', track.duration,
                'track_number', track.track_number,
                'disc_number', track.disc_number,
                'genre', track.genre,
                'bpm', COALESCE(features.bpm, track.bpm),
                'energy', COALESCE(features.energy, track.energy),
                'danceability', COALESCE(features.danceability, track.danceability),
                'valence', COALESCE(features.valence, track.valence),
                'acousticness', COALESCE(features.acousticness, track.acousticness),
                'instrumentalness', COALESCE(
                    features.instrumentalness,
                    track.instrumentalness
                ),
                'format', LOWER(NULLIF(track.format, '')),
                'bitrate', CASE WHEN track.bitrate IS NULL THEN NULL
                    ELSE FLOOR(track.bitrate / 1000.0)::integer END,
                'sample_rate', track.sample_rate,
                'bit_depth', track.bit_depth,
                'size_bytes', track.size
            )) AS payload
            FROM library_tracks track
            LEFT JOIN track_analysis_features features ON features.track_id = track.id
            WHERE track.entity_uid::text = :entity_uid
        """
    else:
        raise ValueError(f"Unsupported federation entity type: {entity_type}")

    row = session.execute(text(sql), {"entity_uid": entity_uid}).mappings().first()
    if not row or not row.get("payload"):
        return None
    payload = dict(row["payload"])
    payload["facets"] = _catalog_payload_facets(entity_type, payload)
    return payload


def append_catalog_change(
    *,
    entity_type: str,
    entity_uid: str,
    operation: str,
    payload: dict[str, Any] | None,
    session,
    payload_revision: str | None = None,
) -> str:
    if operation not in {"upsert", "delete", "hide", "restore"}:
        raise ValueError(f"Unsupported federation catalog operation: {operation}")
    effective_payload = payload or {
        "entity_type": entity_type,
        "remote_entity_uid": entity_uid,
        "deleted": operation in {"delete", "hide"},
    }
    revision = payload_revision or _payload_revision(effective_payload)
    retention_until = datetime.now(timezone.utc) + timedelta(days=_retention_days())
    session.execute(
        text(
            """
            INSERT INTO federation_catalog_changes (
                entity_type, entity_uid, operation, payload_revision,
                payload_json, retention_until
            )
            VALUES (
                :entity_type, :entity_uid, :operation, :payload_revision,
                CAST(:payload_json AS jsonb), :retention_until
            )
            ON CONFLICT (entity_type, entity_uid, payload_revision, operation)
            DO NOTHING
            """
        ),
        {
            "entity_type": entity_type,
            "entity_uid": entity_uid,
            "operation": operation,
            "payload_revision": revision,
            "payload_json": json.dumps(effective_payload, default=str),
            "retention_until": retention_until,
        },
    )
    return revision


def append_local_catalog_change(
    *,
    entity_type: str,
    entity_uid: str,
    operation: str,
    session,
    source_revision: str | None = None,
) -> str | None:
    payload = None
    if operation in {"upsert", "restore"}:
        payload = load_local_catalog_payload(session, entity_type, entity_uid)
        if payload is None:
            operation = "delete"
    return append_catalog_change(
        entity_type=entity_type,
        entity_uid=entity_uid,
        operation=operation,
        payload=payload,
        session=session,
        payload_revision=source_revision,
    )


def catalog_high_water_mark() -> int:
    with read_scope() as session:
        value = session.execute(
            text("SELECT COALESCE(MAX(sequence), 0) FROM federation_catalog_changes")
        ).scalar_one()
    return int(value or 0)


def catalog_retention_floor() -> int:
    with read_scope() as session:
        value = session.execute(
            text(
                "SELECT COALESCE(MIN(sequence), 0) "
                "FROM federation_catalog_changes WHERE retention_until > NOW()"
            )
        ).scalar_one()
    return int(value or 0)


def list_catalog_changes(*, after_sequence: int, limit: int) -> list[dict[str, Any]]:
    capped = max(1, min(int(limit), 500))
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT sequence, entity_type, entity_uid, operation,
                           payload_revision, payload_json, occurred_at
                    FROM federation_catalog_changes
                    WHERE sequence > :after_sequence
                      AND retention_until > NOW()
                    ORDER BY sequence
                    LIMIT :limit
                    """
                ),
                {"after_sequence": max(0, after_sequence), "limit": capped},
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


def cleanup_expired_catalog_changes() -> int:
    with transaction_scope() as session:
        result = session.execute(
            text(
                "DELETE FROM federation_catalog_changes WHERE retention_until <= NOW()"
            )
        )
        return int(getattr(result, "rowcount", 0) or 0)


__all__ = [
    "append_catalog_change",
    "append_local_catalog_change",
    "catalog_high_water_mark",
    "catalog_retention_floor",
    "cleanup_expired_catalog_changes",
    "list_catalog_changes",
    "load_local_catalog_payload",
]

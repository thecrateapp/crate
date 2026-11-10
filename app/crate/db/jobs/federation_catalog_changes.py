"""Commit-ordered publication of the local federation catalog state feed.

Library transactions only stage durable intents. A separate bounded publisher
assigns public sequence numbers after those transactions commit. Repeated states
move their existing feed row forward: this is a convergent state feed, not an
audit history. Numeric cursors and the legacy producer's unique key stay valid.
"""

from __future__ import annotations

import hashlib
import json
import os
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import text

from crate.db.tx import read_scope, transaction_scope


class CatalogHistoryExpired(ValueError):
    """The requested cursor precedes changes actually pruned from the feed."""


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
                'release_group_primary_type', release_group_primary_type,
                'release_group_secondary_types', release_group_secondary_types,
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
    retention_until = datetime.now(UTC) + timedelta(days=_retention_days())
    session.execute(
        text(
            """
            INSERT INTO federation_catalog_change_outbox (
                entity_type, entity_uid, operation, payload_revision,
                payload_json, retention_until
            )
            VALUES (
                :entity_type, :entity_uid, :operation, :payload_revision,
                CAST(:payload_json AS jsonb), :retention_until
            )
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


def publish_pending_catalog_changes(*, limit: int = 1000) -> int:
    """Publish one committed intent page atomically, without library row locks.

    The singleton row serializes only these short publisher/pruner transactions.
    Outbox IDs are scan positions, never public cursors: an earlier uncommitted
    intent remains eligible on the next pass and receives a later public sequence.
    """
    capped = max(1, min(int(limit), 10_000))
    # Release the outbox read lock before waiting for the publisher state lock.
    # Schema downgrade takes state -> feed -> outbox in that order.
    with read_scope() as session:
        if not session.execute(
            text("""
            SELECT EXISTS (SELECT 1 FROM federation_catalog_change_outbox)
        """)
        ).scalar_one():
            return 0
    with transaction_scope() as session:
        session.execute(
            text("""
            SELECT last_published_sequence,
                   set_config('crate.federation_catalog_publisher', 'on', true)
            FROM federation_catalog_feed_state WHERE singleton
            FOR UPDATE
        """)
        )
        retention_until = datetime.now(UTC) + timedelta(days=_retention_days())
        published_count = session.execute(
            text("""
            WITH intents AS MATERIALIZED (
                SELECT * FROM federation_catalog_change_outbox ORDER BY id LIMIT :limit
            ), sequenced AS MATERIALIZED (
                SELECT intents.*, nextval('federation_catalog_changes_sequence_seq')
                           AS published_sequence
                FROM intents ORDER BY id
            ), latest_occurrences AS (
                SELECT DISTINCT ON (entity_type, entity_uid, payload_revision, operation)
                       * FROM sequenced
                ORDER BY entity_type, entity_uid, payload_revision, operation, id DESC
            ), published AS (
                INSERT INTO federation_catalog_changes (
                    sequence, entity_type, entity_uid, operation, payload_revision,
                    payload_json, occurred_at, retention_until
                )
                SELECT published_sequence, entity_type, entity_uid, operation,
                       payload_revision, payload_json, occurred_at, :retention_until
                FROM latest_occurrences ORDER BY published_sequence
                ON CONFLICT (entity_type, entity_uid, payload_revision, operation)
                DO UPDATE SET sequence = EXCLUDED.sequence,
                              payload_json = EXCLUDED.payload_json,
                              occurred_at = EXCLUDED.occurred_at,
                              retention_until = EXCLUDED.retention_until
                RETURNING sequence
            ), removed AS (
                DELETE FROM federation_catalog_change_outbox
                WHERE id IN (SELECT id FROM intents)
                  AND (SELECT COUNT(*) FROM published) >= 0
                RETURNING id
            )
            UPDATE federation_catalog_feed_state
            SET last_published_sequence = GREATEST(
                last_published_sequence,
                COALESCE((SELECT MAX(sequence) FROM published), 0)
            )
            WHERE singleton AND EXISTS (SELECT 1 FROM intents)
            RETURNING (SELECT COUNT(*) FROM removed) AS published_count
        """),
            {"limit": capped, "retention_until": retention_until},
        ).scalar_one_or_none()
    return int(published_count or 0)


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
            text("""
                SELECT GREATEST(
                    last_published_sequence,
                    COALESCE((SELECT MAX(sequence) FROM federation_catalog_changes), 0)
                )
                FROM federation_catalog_feed_state WHERE singleton
            """)
        ).scalar_one()
    return int(value or 0)


def catalog_retention_floor() -> int:
    with read_scope() as session:
        value = session.execute(
            text(
                "SELECT last_pruned_sequence + 1 "
                "FROM federation_catalog_feed_state WHERE singleton"
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
                    SELECT state.last_pruned_sequence, changes.*
                    FROM federation_catalog_feed_state state
                    LEFT JOIN LATERAL (
                        SELECT sequence, entity_type, entity_uid, operation,
                               payload_revision, payload_json, occurred_at
                        FROM federation_catalog_changes
                        WHERE sequence > :after_sequence
                        ORDER BY sequence
                        LIMIT :limit
                    ) changes ON TRUE
                    WHERE state.singleton
                    ORDER BY changes.sequence
                    """
                ),
                {"after_sequence": max(0, after_sequence), "limit": capped},
            )
            .mappings()
            .all()
        )
    if rows and int(rows[0]["last_pruned_sequence"]) > max(0, after_sequence):
        raise CatalogHistoryExpired("Catalog cursor predates pruned changes")
    return [
        {key: value for key, value in row.items() if key != "last_pruned_sequence"}
        for row in rows
        if row["sequence"] is not None
    ]


def cleanup_expired_catalog_changes(*, limit: int = 10_000) -> int:
    """Prune a bounded expired prefix and persist its exact cursor boundary."""
    with transaction_scope() as session:
        session.execute(
            text("""
            SELECT last_pruned_sequence
            FROM federation_catalog_feed_state WHERE singleton FOR UPDATE
        """)
        )
        row = (
            session.execute(
                text("""
            WITH expired_prefix AS (
                SELECT sequence FROM federation_catalog_changes
                WHERE retention_until <= NOW()
                  AND sequence < COALESCE((
                      SELECT MIN(sequence) FROM federation_catalog_changes
                      WHERE retention_until > NOW()
                  ), 9223372036854775807)
                ORDER BY sequence LIMIT :limit
            ), removed AS (
                DELETE FROM federation_catalog_changes
                WHERE sequence IN (SELECT sequence FROM expired_prefix)
                RETURNING sequence
            )
            SELECT COUNT(*) AS removed, MAX(sequence) AS last_pruned FROM removed
        """),
                {"limit": max(1, min(int(limit), 100_000))},
            )
            .mappings()
            .one()
        )
        if row["last_pruned"] is not None:
            session.execute(
                text("""
                UPDATE federation_catalog_feed_state
                SET last_pruned_sequence = GREATEST(last_pruned_sequence, :sequence)
                WHERE singleton
            """),
                {"sequence": row["last_pruned"]},
            )
        return int(row["removed"])


__all__ = [
    "CatalogHistoryExpired",
    "append_catalog_change",
    "append_local_catalog_change",
    "catalog_high_water_mark",
    "catalog_retention_floor",
    "cleanup_expired_catalog_changes",
    "list_catalog_changes",
    "load_local_catalog_payload",
    "publish_pending_catalog_changes",
]

"""Federated catalog sync — local index of remote catalog rows.

Phase 4: upsert, delete, tombstone, manifest, delta, stale markers.
Integrates with the existing hybrid search for local + federated results.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from crate.db.tx import read_scope, transaction_scope
from crate.federation.events import emit_global_catalog_source_changed
from crate.db.repositories.global_content_cache import invalidate_source_cache

log = logging.getLogger(__name__)

STALE_THRESHOLD_HOURS = 24


# ── Catalog item CRUD ─────────────────────────────────────────────────────


def upsert_catalog_item(
    node_uid: str,
    remote_entity_uid: str,
    entity_type: str,
    title: str,
    artist: str | None = None,
    album: str | None = None,
    year: str | None = None,
    duration_seconds: int | None = None,
    track_number: int | None = None,
    disc_number: int | None = None,
    remote_revision: str | None = None,
    raw_json: dict | None = None,
    sync_session_uid: str | None = None,
) -> dict:
    now = datetime.now(timezone.utc)
    search_text = " ".join(filter(None, [title, artist or "", album or ""]))

    with transaction_scope() as s:
        s.execute(
            text(
                """
                INSERT INTO federation_catalog_items
                    (node_uid, remote_entity_uid, entity_type, title, artist,
                     album, year, duration_seconds, track_number, disc_number,
                     remote_revision, raw_json, search_vector,
                     last_seen_sync_session_uid)
                VALUES
                    (:node_uid, :reuid, :etype, :title, :artist,
                     :album, :year, :dur, :tn, :dn,
                     :rev, :raw, to_tsvector('simple', :search_text),
                     CAST(:sync_session_uid AS uuid))
                ON CONFLICT (node_uid, entity_type, remote_entity_uid) DO UPDATE SET
                    title = :title2, artist = :artist2, album = :album2,
                    year = :year2, duration_seconds = :dur2,
                    track_number = :tn2, disc_number = :dn2,
                    remote_revision = :rev2, raw_json = :raw2,
                    search_vector = to_tsvector('simple', :search_text2),
                    deleted_at = NULL, tombstone_json = '{}'::jsonb,
                    indexed_at = :now2,
                    last_seen_sync_session_uid = CAST(:sync_session_uid2 AS uuid)
                """
            ),
            {
                "node_uid": node_uid,
                "reuid": remote_entity_uid,
                "etype": entity_type,
                "title": title,
                "artist": artist,
                "album": album,
                "year": year,
                "dur": duration_seconds,
                "tn": track_number,
                "dn": disc_number,
                "rev": remote_revision,
                "raw": json.dumps(raw_json or {}),
                "search_text": search_text,
                "title2": title,
                "artist2": artist,
                "album2": album,
                "year2": year,
                "dur2": duration_seconds,
                "tn2": track_number,
                "dn2": disc_number,
                "rev2": remote_revision,
                "raw2": json.dumps(raw_json or {}),
                "search_text2": search_text,
                "now2": now,
                "sync_session_uid": sync_session_uid,
                "sync_session_uid2": sync_session_uid,
            },
        )
        from crate.db.repositories.global_catalog_dirty_sources import (
            enqueue_federated_dirty_source,
        )

        enqueue_federated_dirty_source(
            entity_type,  # type: ignore[arg-type]
            node_uid,
            remote_entity_uid,
            "upsert",
            source_revision=remote_revision,
            session=s,
        )

        row = (
            s.execute(
                text(
                    "SELECT * FROM federation_catalog_items "
                    "WHERE node_uid = :uid AND entity_type = :etype AND remote_entity_uid = :reuid"
                ),
                {"uid": node_uid, "etype": entity_type, "reuid": remote_entity_uid},
            )
            .mappings()
            .one()
        )
        return dict(row)


def tombstone_catalog_item(
    node_uid: str,
    remote_entity_uid: str,
    entity_type: str,
    reason: str = "deleted",
) -> None:
    now = datetime.now(timezone.utc)
    with transaction_scope() as s:
        s.execute(
            text(
                "UPDATE federation_catalog_items SET "
                "deleted_at = :now, "
                "tombstone_json = :tombstone "
                "WHERE node_uid = :uid AND entity_type = :etype AND remote_entity_uid = :reuid"
            ),
            {
                "uid": node_uid,
                "etype": entity_type,
                "reuid": remote_entity_uid,
                "now": now,
                "tombstone": json.dumps(
                    {"deleted_at": now.isoformat(), "reason": reason}
                ),
            },
        )
        from crate.db.repositories.global_catalog_dirty_sources import (
            enqueue_federated_dirty_source,
        )

        enqueue_federated_dirty_source(
            entity_type,  # type: ignore[arg-type]
            node_uid,
            remote_entity_uid,
            "delete",
            session=s,
        )
    invalidate_source_cache(node_uid, remote_entity_uid)
    emit_global_catalog_source_changed(
        node_uid=node_uid,
        reason="manifest_tombstone",
        entity_type=entity_type,
        remote_entity_uid=remote_entity_uid,
    )


def tombstone_catalog_items_missing_from_revision(
    node_uid: str, remote_revision: str
) -> int:
    """Tombstone peer rows absent from a successfully completed full manifest."""
    if not remote_revision:
        raise ValueError("A completed manifest requires a non-empty revision")

    now = datetime.now(timezone.utc)
    with transaction_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    UPDATE federation_catalog_items
                    SET
                        deleted_at = :deleted_at,
                        tombstone_json = CAST(:tombstone AS jsonb)
                    WHERE node_uid = CAST(:node_uid AS uuid)
                      AND deleted_at IS NULL
                      AND remote_revision IS DISTINCT FROM :remote_revision
                    RETURNING entity_type, remote_entity_uid
                    """
                ),
                {
                    "node_uid": node_uid,
                    "remote_revision": remote_revision,
                    "deleted_at": now,
                    "tombstone": json.dumps(
                        {
                            "deleted_at": now.isoformat(),
                            "reason": "missing_from_manifest",
                        }
                    ),
                },
            )
            .mappings()
            .all()
        )

        from crate.db.repositories.global_catalog_dirty_sources import (
            enqueue_federated_dirty_source,
        )

        for row in rows:
            enqueue_federated_dirty_source(
                row["entity_type"],
                node_uid,
                str(row["remote_entity_uid"]),
                "delete",
                source_revision=remote_revision,
                session=session,
            )

    for row in rows:
        remote_entity_uid = str(row["remote_entity_uid"])
        invalidate_source_cache(node_uid, remote_entity_uid)
        emit_global_catalog_source_changed(
            node_uid=node_uid,
            reason="manifest_tombstone",
            entity_type=str(row["entity_type"]),
            remote_entity_uid=remote_entity_uid,
        )
    return len(rows)


def tombstone_catalog_items_missing_from_session(
    node_uid: str, sync_session_uid: str
) -> int:
    """Tombstone unseen rows only after a full snapshot session completes."""
    now = datetime.now(timezone.utc)
    with transaction_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    UPDATE federation_catalog_items
                    SET deleted_at = :deleted_at,
                        tombstone_json = CAST(:tombstone AS jsonb)
                    WHERE node_uid = CAST(:node_uid AS uuid)
                      AND deleted_at IS NULL
                      AND last_seen_sync_session_uid IS DISTINCT FROM
                          CAST(:sync_session_uid AS uuid)
                    RETURNING entity_type, remote_entity_uid
                    """
                ),
                {
                    "node_uid": node_uid,
                    "sync_session_uid": sync_session_uid,
                    "deleted_at": now,
                    "tombstone": json.dumps(
                        {
                            "deleted_at": now.isoformat(),
                            "reason": "missing_from_snapshot",
                        }
                    ),
                },
            )
            .mappings()
            .all()
        )
        from crate.db.repositories.global_catalog_dirty_sources import (
            enqueue_federated_dirty_source,
        )

        for row in rows:
            enqueue_federated_dirty_source(
                row["entity_type"],
                node_uid,
                str(row["remote_entity_uid"]),
                "delete",
                session=session,
            )
    return len(rows)


def count_catalog_items(node_uid: str) -> dict[str, int]:
    with read_scope() as s:
        rows = (
            s.execute(
                text(
                    "SELECT entity_type, COUNT(*) as cnt "
                    "FROM federation_catalog_items "
                    "WHERE node_uid = :uid AND deleted_at IS NULL "
                    "GROUP BY entity_type"
                ),
                {"uid": node_uid},
            )
            .mappings()
            .all()
        )
        return {r["entity_type"]: r["cnt"] for r in rows}


def cleanup_peer_catalog(node_uid: str) -> int:
    with transaction_scope() as s:
        result = s.execute(
            text("DELETE FROM federation_catalog_items WHERE node_uid = :uid"),
            {"uid": node_uid},
        )
        deleted = int(getattr(result, "rowcount", 0) or 0)
    if deleted:
        invalidate_source_cache(node_uid)
        emit_global_catalog_source_changed(
            node_uid=node_uid,
            reason="peer_catalog_cleared",
        )
    return deleted


def cleanup_old_tombstones(retention_days: int = 90) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    with transaction_scope() as s:
        result = s.execute(
            text(
                "DELETE FROM federation_catalog_items "
                "WHERE deleted_at IS NOT NULL AND deleted_at < :cutoff"
            ),
            {"cutoff": cutoff},
        )
        return int(getattr(result, "rowcount", 0) or 0)


# ── Cursors ───────────────────────────────────────────────────────────────


def upsert_cursor(
    node_uid: str,
    cursor: str | None = None,
    *,
    last_applied_cursor: int | None = None,
    snapshot_cursor: int | None = None,
    sync_session_uid: str | None = None,
    full_verified: bool = False,
) -> dict:
    now = datetime.now(timezone.utc)
    with transaction_scope() as s:
        s.execute(
            text(
                "INSERT INTO federation_catalog_cursors "
                "(node_uid, cursor, full_sync_completed_at, last_delta_at, "
                "last_applied_cursor, snapshot_cursor, sync_session_uid, "
                "last_full_verified_at, consecutive_failures, retry_after, "
                "last_error, updated_at) "
                "VALUES (:uid, :cursor, :now, :now, :last_applied_cursor, "
                ":snapshot_cursor, CAST(:sync_session_uid AS uuid), "
                "CASE WHEN :full_verified THEN :now ELSE NULL END, "
                "0, NULL, NULL, :now) "
                "ON CONFLICT (node_uid) DO UPDATE SET "
                "cursor = :cursor2, full_sync_completed_at = :now2, "
                "last_delta_at = :now2, "
                "last_applied_cursor = COALESCE(:last_applied_cursor2, "
                "federation_catalog_cursors.last_applied_cursor), "
                "snapshot_cursor = COALESCE(:snapshot_cursor2, "
                "federation_catalog_cursors.snapshot_cursor), "
                "sync_session_uid = CAST(:sync_session_uid2 AS uuid), "
                "last_full_verified_at = CASE WHEN :full_verified2 THEN :now2 "
                "ELSE federation_catalog_cursors.last_full_verified_at END, "
                "consecutive_failures = 0, retry_after = NULL, "
                "last_error = NULL, updated_at = :now2"
            ),
            {
                "uid": node_uid,
                "cursor": cursor,
                "now": now,
                "cursor2": cursor,
                "now2": now,
                "last_applied_cursor": last_applied_cursor,
                "snapshot_cursor": snapshot_cursor,
                "sync_session_uid": sync_session_uid,
                "full_verified": full_verified,
                "last_applied_cursor2": last_applied_cursor,
                "snapshot_cursor2": snapshot_cursor,
                "sync_session_uid2": sync_session_uid,
                "full_verified2": full_verified,
            },
        )
        row = (
            s.execute(
                text("SELECT * FROM federation_catalog_cursors WHERE node_uid = :uid"),
                {"uid": node_uid},
            )
            .mappings()
            .one()
        )
        return dict(row)


def save_catalog_sync_checkpoint(
    node_uid: str,
    *,
    revision: str,
    next_page: int,
    page_size: int,
    synced: int,
    next_cursor: str | None = None,
    snapshot_cursor: str | None = None,
    sync_session_uid: str | None = None,
) -> dict:
    """Persist a resumable full-manifest cursor without marking it complete."""
    now = datetime.now(timezone.utc)
    cursor = json.dumps(
        {
            "status": "partial",
            "revision": revision,
            "next_page": max(0, int(next_page)),
            "page_size": max(1, int(page_size)),
            "synced": max(0, int(synced)),
            "next_cursor": next_cursor,
            "snapshot_cursor": snapshot_cursor,
            "sync_session_uid": sync_session_uid,
        },
        sort_keys=True,
    )
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO federation_catalog_cursors
                    (node_uid, cursor, last_error, updated_at)
                VALUES
                    (CAST(:node_uid AS uuid), :cursor, NULL, :updated_at)
                ON CONFLICT (node_uid) DO UPDATE SET
                    cursor = EXCLUDED.cursor,
                    last_error = NULL,
                    updated_at = EXCLUDED.updated_at
                """
            ),
            {"node_uid": node_uid, "cursor": cursor, "updated_at": now},
        )
        row = (
            session.execute(
                text(
                    "SELECT * FROM federation_catalog_cursors "
                    "WHERE node_uid = CAST(:node_uid AS uuid)"
                ),
                {"node_uid": node_uid},
            )
            .mappings()
            .one()
        )
    return dict(row)


def record_catalog_sync_error(node_uid: str, error: str) -> None:
    now = datetime.now(timezone.utc)
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO federation_catalog_cursors
                    (node_uid, last_error, consecutive_failures, retry_after,
                     failure_metadata, updated_at)
                VALUES
                    (CAST(:node_uid AS uuid), :last_error, 1,
                     :updated_at + make_interval(secs => 30),
                     jsonb_build_object('last_error_at', :updated_at), :updated_at)
                ON CONFLICT (node_uid) DO UPDATE SET
                    last_error = EXCLUDED.last_error,
                    consecutive_failures =
                        federation_catalog_cursors.consecutive_failures + 1,
                    retry_after = :updated_at + make_interval(secs => LEAST(
                        3600,
                        (30 * power(
                            2,
                            LEAST(
                                federation_catalog_cursors.consecutive_failures,
                                7
                            )
                        ))::integer
                    )),
                    failure_metadata = jsonb_build_object(
                        'last_error_at', :updated_at,
                        'error', :last_error
                    ),
                    updated_at = EXCLUDED.updated_at
                """
            ),
            {
                "node_uid": node_uid,
                "last_error": error[:4000],
                "updated_at": now,
            },
        )


def get_cursor(node_uid: str) -> dict | None:
    with read_scope() as s:
        row = (
            s.execute(
                text("SELECT * FROM federation_catalog_cursors WHERE node_uid = :uid"),
                {"uid": node_uid},
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None


def is_catalog_stale(node_uid: str) -> bool:
    cursor = get_cursor(node_uid)
    if not cursor:
        return True
    last = cursor.get("full_sync_completed_at")
    if not last:
        return True
    return datetime.now(timezone.utc) - last > timedelta(hours=STALE_THRESHOLD_HOURS)


# ── Search ────────────────────────────────────────────────────────────────


_FED_SEARCH_SQL = """
SELECT
    node_uid, remote_entity_uid, entity_type, title, artist, album,
    year, duration_seconds, track_number, disc_number,
    ts_rank(search_vector, to_tsquery('simple', :fts_query)) AS score
FROM federation_catalog_items
WHERE deleted_at IS NULL
  AND search_vector @@ to_tsquery('simple', :fts_query)
  AND entity_type = :entity_type
  AND (:node_uid IS NULL OR node_uid = :node_uid)
ORDER BY score DESC
LIMIT :limit
"""


def search_federated_catalog(
    query: str,
    entity_type: str,
    limit: int = 20,
    node_uid: str | None = None,
) -> list[dict]:
    from crate.db.queries.browse_media_search import build_fts_query

    fts_query = build_fts_query(query)
    if not fts_query:
        return []

    with read_scope() as s:
        rows = (
            s.execute(
                text(_FED_SEARCH_SQL),
                {
                    "fts_query": fts_query,
                    "entity_type": entity_type,
                    "limit": limit,
                    "node_uid": node_uid,
                },
            )
            .mappings()
            .all()
        )

        results = []
        for row in rows:
            item = dict(row)
            item["origin"] = "remote"
            item["availability"] = {"catalog": True, "stream": False, "import": False}
            if is_catalog_stale(row["node_uid"]):
                item["stale"] = True
            results.append(item)

        return results

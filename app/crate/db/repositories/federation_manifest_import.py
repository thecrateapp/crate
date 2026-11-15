"""Bounded, atomic page imports for remote federation manifests."""

from __future__ import annotations

import json
from datetime import UTC, datetime

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.domain_events import append_domain_event
from crate.db.repositories.federation_catalog_fence import (
    checkpoint_moves_forward,
    fence_catalog_sync_write,
)
from crate.db.repositories.tasks import create_task_dedup
from crate.db.tx import optional_scope


def _normalized_items(items: list[dict]) -> tuple[list[dict], int]:
    # A page can repeat a remote identity; retain the final payload as the old
    # serial importer did, without PostgreSQL updating one conflict twice.
    unique = {}
    applied = 0
    for item in items:
        entity_type = str(item.get("entity_type") or "")
        remote_uid = str(item.get("remote_entity_uid") or item.get("entity_uid") or "")
        if entity_type not in {"artist", "album", "track"} or not remote_uid:
            continue
        duration = item.get("duration_seconds", item.get("duration"))
        try:
            duration = int(float(duration)) if duration is not None else None
        except (TypeError, ValueError, OverflowError):
            duration = None
        unique[(entity_type, remote_uid)] = {
            "entity_type": entity_type,
            "remote_entity_uid": remote_uid,
            "title": str(item.get("title") or item.get("name") or ""),
            "artist": item.get("artist"),
            "album": item.get("album"),
            "year": str(item["year"]) if item.get("year") is not None else None,
            "duration_seconds": duration,
            "track_number": item.get("track_number"),
            "disc_number": item.get("disc_number"),
            "raw_json": item,
        }
        applied += 1
    return list(unique.values()), applied


def apply_federation_manifest_page(
    *,
    node_uid: str,
    items: list[dict],
    revision: str,
    sync_session_uid: str,
    sync_generation: int,
    checkpoint: dict | None = None,
    session: Session | None = None,
) -> dict:
    """Persist a page, its projection work and its resume point together.

    Projection remains asynchronous. This import never scans or reconciles the
    cached catalogue, and its SQL/transaction count is independent of page size.
    Callers validate protocol and owner policy before handing us the page.

    The page is fenced (FED-D11): it raises ``CatalogSyncFenced`` without
    writing when ``sync_generation`` is no longer the peer's current one, and
    within one session the checkpoint never moves back.
    """
    if len(items) > 500:
        raise ValueError("Federation manifest pages cannot exceed 500 items")
    rows, applied = _normalized_items(items)
    parameters = {
        "node_uid": node_uid,
        "items": json.dumps(rows),
        "revision": revision,
        "sync_uid": sync_session_uid,
    }
    invalidated = 0
    with optional_scope(session) as current:
        locked_cursor = fence_catalog_sync_write(current, node_uid, sync_generation)
        if rows:
            current.execute(
                text(
                    """
                    INSERT INTO federation_catalog_items (
                        node_uid, remote_entity_uid, entity_type, title, artist,
                        album, year, duration_seconds, track_number, disc_number,
                        remote_revision, raw_json, search_vector,
                        last_seen_sync_session_uid
                    )
                    SELECT
                        CAST(:node_uid AS uuid), item.remote_entity_uid,
                        item.entity_type, item.title, item.artist, item.album,
                        item.year, item.duration_seconds, item.track_number,
                        item.disc_number, :revision, item.raw_json,
                        to_tsvector('simple', concat_ws(' ', item.title, item.artist, item.album)),
                        CAST(:sync_uid AS uuid)
                    FROM jsonb_to_recordset(CAST(:items AS jsonb)) AS item(
                        remote_entity_uid text, entity_type text, title text,
                        artist text, album text, year text, duration_seconds integer,
                        track_number integer, disc_number integer, raw_json jsonb
                    )
                    ON CONFLICT (node_uid, entity_type, remote_entity_uid) DO UPDATE SET
                        title = EXCLUDED.title, artist = EXCLUDED.artist,
                        album = EXCLUDED.album, year = EXCLUDED.year,
                        duration_seconds = EXCLUDED.duration_seconds,
                        track_number = EXCLUDED.track_number, disc_number = EXCLUDED.disc_number,
                        remote_revision = EXCLUDED.remote_revision, raw_json = EXCLUDED.raw_json,
                        search_vector = EXCLUDED.search_vector,
                        deleted_at = NULL, tombstone_json = '{}'::jsonb,
                        indexed_at = NOW(),
                        last_seen_sync_session_uid = EXCLUDED.last_seen_sync_session_uid
                    """
                ),
                parameters,
            )
            current.execute(
                text(
                    """
                    INSERT INTO global_catalog_dirty_sources (
                        dedupe_key, entity_type, source_kind, node_uid,
                        remote_entity_uid, operation, source_revision
                    )
                    SELECT
                        'federated:' || :node_uid || ':' || item.entity_type || ':' || item.remote_entity_uid,
                        item.entity_type, 'federated', CAST(:node_uid AS uuid),
                        item.remote_entity_uid, 'upsert', :revision
                    FROM jsonb_to_recordset(CAST(:items AS jsonb)) AS item(
                        remote_entity_uid text, entity_type text
                    )
                    ON CONFLICT (dedupe_key) DO UPDATE SET
                        operation = EXCLUDED.operation,
                        source_revision = EXCLUDED.source_revision,
                        requested_at = NOW(),
                        claimed_at = CASE
                            WHEN global_catalog_dirty_sources.completed_at IS NOT NULL THEN NULL
                            ELSE global_catalog_dirty_sources.claimed_at
                        END,
                        completed_at = CASE
                            WHEN global_catalog_dirty_sources.completed_at IS NOT NULL THEN NULL
                            ELSE global_catalog_dirty_sources.completed_at
                        END,
                        last_error = NULL, next_attempt_at = NULL
                    """
                ),
                parameters,
            )
            create_task_dedup(
                "global_catalog_reconcile_incremental",
                {"triggered_by": "dirty_source"},
                dedup_key="dirty:global-catalog",
                session=current,
            )
            deleted = current.execute(
                text(
                    "DELETE FROM global_content_cache "
                    "WHERE source_node_uid = CAST(:node_uid AS uuid) "
                    "AND remote_entity_uid = ANY(:remote_uids)"
                ),
                {
                    "node_uid": node_uid,
                    "remote_uids": list({row["remote_entity_uid"] for row in rows}),
                },
            )
            invalidated = int(getattr(deleted, "rowcount", 0) or 0)
            if invalidated:
                append_domain_event(
                    "global_catalog.source.changed",
                    {
                        "node_uid": node_uid,
                        "reason": "manifest_revision_changed",
                        "changed_at": datetime.now(UTC).isoformat(),
                    },
                    scope="global_catalog",
                    subject_key=node_uid,
                    session=current,
                )
        if checkpoint is not None and checkpoint_moves_forward(
            locked_cursor, sync_session_uid, int(checkpoint["next_page"])
        ):
            cursor = {
                "status": "partial",
                "revision": revision,
                "next_page": max(0, int(checkpoint["next_page"])),
                "page_size": max(1, int(checkpoint["page_size"])),
                "synced": max(0, int(checkpoint["synced"])),
                "next_cursor": checkpoint.get("next_cursor"),
                "snapshot_cursor": checkpoint.get("snapshot_cursor"),
                "sync_session_uid": sync_session_uid,
            }
            current.execute(
                text(
                    """
                    UPDATE federation_catalog_cursors
                    SET cursor = :cursor, last_error = NULL, updated_at = NOW()
                    WHERE node_uid = CAST(:node_uid AS uuid)
                    """
                ),
                {"node_uid": node_uid, "cursor": json.dumps(cursor, sort_keys=True)},
            )
    return {"applied": applied, "invalidated": invalidated}


__all__ = ["apply_federation_manifest_page"]

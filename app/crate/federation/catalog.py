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
from crate.federation.global_content_cache import invalidate_source_cache

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
                     remote_revision, raw_json, search_vector)
                VALUES
                    (:node_uid, :reuid, :etype, :title, :artist,
                     :album, :year, :dur, :tn, :dn,
                     :rev, :raw, to_tsvector('simple', :search_text))
                ON CONFLICT (node_uid, entity_type, remote_entity_uid) DO UPDATE SET
                    title = :title2, artist = :artist2, album = :album2,
                    year = :year2, duration_seconds = :dur2,
                    track_number = :tn2, disc_number = :dn2,
                    remote_revision = :rev2, raw_json = :raw2,
                    search_vector = to_tsvector('simple', :search_text2),
                    deleted_at = NULL, tombstone_json = '{}'::jsonb,
                    indexed_at = :now2
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


def upsert_cursor(node_uid: str, cursor: str | None = None) -> dict:
    now = datetime.now(timezone.utc)
    with transaction_scope() as s:
        s.execute(
            text(
                "INSERT INTO federation_catalog_cursors (node_uid, cursor, updated_at) "
                "VALUES (:uid, :cursor, :now) "
                "ON CONFLICT (node_uid) DO UPDATE SET cursor = :cursor2, updated_at = :now2"
            ),
            {
                "uid": node_uid,
                "cursor": cursor,
                "now": now,
                "cursor2": cursor,
                "now2": now,
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
    last = cursor.get("updated_at")
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

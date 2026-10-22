"""Query helpers for persistent import queue read models."""

from __future__ import annotations

from typing import Any

from sqlalchemy import text

from crate.db.import_queue_shared import row_to_import_item
from crate.db.ops_runtime import get_ops_runtime_state
from crate.db.tx import read_scope


def list_import_queue_items(
    *, status: str | None = "pending", limit: int = 500
) -> list[dict[str, Any]]:
    query = """
        SELECT queue.source, queue.path, queue.artist, queue.album, queue.status,
               queue.payload_json, queue.discovered_at, queue.updated_at,
               album.id AS dest_album_id
        FROM import_queue_items AS queue
        LEFT JOIN LATERAL (
            SELECT id
            FROM library_albums
            WHERE path = COALESCE(
                NULLIF(queue.payload_json->>'dest', ''),
                NULLIF(queue.payload_json->>'dest_path', '')
            )
            ORDER BY id
            LIMIT 1
        ) AS album ON TRUE
    """
    params: dict[str, Any] = {"limit": max(1, limit)}
    if status == "completed":
        query += "WHERE queue.status IN ('imported', 'merged') "
    elif status is not None:
        query += "WHERE queue.status = :status "
        params["status"] = status
    query += "ORDER BY updated_at DESC, discovered_at DESC LIMIT :limit"

    with read_scope() as session:
        rows = session.execute(text(query), params).mappings().all()

    return [row_to_import_item(dict(row)) for row in rows]


def count_import_queue_items(*, status: str = "pending") -> int:
    cached = get_ops_runtime_state("imports_pending", max_age_seconds=180)
    if status == "pending" and cached:
        try:
            return int(cached.get("count") or 0)
        except (TypeError, ValueError, AttributeError):
            pass

    with read_scope() as session:
        row = (
            session.execute(
                text(
                    "SELECT COUNT(*) AS cnt FROM import_queue_items WHERE status = :status"
                ),
                {"status": status},
            )
            .mappings()
            .first()
        )
    return int((row or {}).get("cnt") or 0)


__all__ = ["count_import_queue_items", "list_import_queue_items"]

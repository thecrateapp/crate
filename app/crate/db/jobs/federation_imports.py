"""Storage reservation and lifecycle operations for federated imports."""

from __future__ import annotations

import os
import shutil
from pathlib import Path

from sqlalchemy import text

from crate.db.tx import transaction_scope


def reserve_import_storage(
    request_id: str,
    *,
    expected_bytes: int,
    library_path: str | Path,
) -> dict:
    requested = int(expected_bytes)
    max_request = int(
        os.environ.get("CRATE_FEDERATION_IMPORT_MAX_BYTES", "100000000000")
    )
    if requested <= 0 or requested > max_request:
        raise ValueError("Import request exceeds the configured byte limit")
    free = shutil.disk_usage(Path(library_path)).free
    headroom = max(
        int(
            os.environ.get("CRATE_FEDERATION_IMPORT_FREE_HEADROOM_BYTES", "10737418240")
        ),
        int(free * 0.05),
    )
    if requested > max(0, free - headroom):
        raise ValueError("Insufficient free storage for federated import")

    with transaction_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    SELECT request_id, node_uid, status, reserved_bytes,
                           manifest_digest
                    FROM federation_import_requests
                    WHERE request_id = CAST(:request_id AS uuid)
                    FOR UPDATE
                    """
                ),
                {"request_id": request_id},
            )
            .mappings()
            .first()
        )
        if not row:
            raise ValueError("Import request not found")
        if row["status"] not in {"approved", "reserving", "downloading"}:
            raise ValueError("Import request is not approved")
        already_reserved = int(row.get("reserved_bytes") or 0)
        if already_reserved:
            if already_reserved != requested:
                raise ValueError("Import reservation changed during retry")
            return dict(row)
        session.execute(
            text(
                "SELECT pg_advisory_xact_lock(hashtext('federation-import-reservations'))"
            )
        )
        global_reserved = int(
            session.execute(
                text(
                    """
                    SELECT COALESCE(SUM(reserved_bytes), 0)
                    FROM federation_import_requests
                    WHERE status IN ('reserving', 'downloading', 'verifying', 'importing')
                    """
                )
            ).scalar_one()
            or 0
        )
        global_limit = int(
            os.environ.get(
                "CRATE_FEDERATION_IMPORT_GLOBAL_RESERVED_BYTES", "250000000000"
            )
        )
        if global_reserved + requested > global_limit:
            raise ValueError("Global federated import reservation limit exceeded")
        peer_reserved = int(
            session.execute(
                text(
                    """
                    SELECT COALESCE(SUM(reserved_bytes), 0)
                    FROM federation_import_requests
                    WHERE node_uid = :node_uid
                      AND status IN ('reserving', 'downloading', 'verifying', 'importing')
                    """
                ),
                {"node_uid": row["node_uid"]},
            ).scalar_one()
            or 0
        )
        peer_limit = int(
            os.environ.get(
                "CRATE_FEDERATION_IMPORT_PEER_RESERVED_BYTES", "100000000000"
            )
        )
        if peer_reserved + requested > peer_limit:
            raise ValueError("Peer federated import reservation limit exceeded")
        updated = (
            session.execute(
                text(
                    """
                    UPDATE federation_import_requests
                    SET expected_bytes = :expected_bytes,
                        reserved_bytes = :expected_bytes,
                        status = 'reserving',
                        cleanup_deadline = NOW() + (
                            :lease_seconds * INTERVAL '1 second'
                        ),
                        updated_at = NOW()
                    WHERE request_id = CAST(:request_id AS uuid)
                    RETURNING *
                    """
                ),
                {
                    "request_id": request_id,
                    "expected_bytes": requested,
                    "lease_seconds": max(
                        300,
                        int(
                            os.environ.get(
                                "CRATE_FEDERATION_IMPORT_LEASE_SECONDS",
                                "18000",
                            )
                        ),
                    ),
                },
            )
            .mappings()
            .one()
        )
    return dict(updated)


def release_import_storage(request_id: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE federation_import_requests
                SET reserved_bytes = 0, updated_at = NOW()
                WHERE request_id = CAST(:request_id AS uuid)
                """
            ),
            {"request_id": request_id},
        )


def expire_stale_imports(*, limit: int = 100) -> list[dict]:
    """Fail expired active leases and clean expired terminal requests."""
    with transaction_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                WITH expired AS (
                    SELECT request_id
                    FROM federation_import_requests
                    WHERE cleanup_deadline <= NOW()
                      AND status IN (
                          'reserving', 'downloading', 'verifying', 'importing',
                          'cancelled', 'failed'
                      )
                    ORDER BY cleanup_deadline, request_id
                    LIMIT :limit
                    FOR UPDATE SKIP LOCKED
                )
                UPDATE federation_import_requests
                SET status = CASE
                        WHEN status IN (
                            'reserving', 'downloading', 'verifying', 'importing'
                        ) THEN 'failed'
                        ELSE 'cleaned'
                    END,
                    reserved_bytes = 0,
                    failure_reason = CASE
                        WHEN status IN (
                            'reserving', 'downloading', 'verifying', 'importing'
                        ) THEN COALESCE(failure_reason, 'Import lease expired')
                        ELSE failure_reason
                    END,
                    updated_at = NOW()
                WHERE request_id IN (SELECT request_id FROM expired)
                RETURNING request_id, status, staging_relative_path,
                          failure_reason
                """
                ),
                {"limit": max(1, min(int(limit), 1000))},
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


def cleanup_expired_imports() -> int:
    return len(expire_stale_imports())


__all__ = [
    "cleanup_expired_imports",
    "expire_stale_imports",
    "release_import_storage",
    "reserve_import_storage",
]

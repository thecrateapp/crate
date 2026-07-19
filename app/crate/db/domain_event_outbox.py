"""PostgreSQL transactional outbox primitives for domain events."""

from __future__ import annotations

import json
import uuid
from typing import Any

from sqlalchemy import text

from crate.db.tx import optional_scope, read_scope, transaction_scope

_MAX_ATTEMPTS = 10
_MAX_RETRY_SECONDS = 300


def enqueue_outbox_event(
    event_type: str,
    payload: dict[str, Any] | None = None,
    *,
    scope: str | None = None,
    subject_key: str | None = None,
    event_uid: str | None = None,
    session,
) -> str:
    stable_uid = event_uid or str(uuid.uuid4())
    session.execute(
        text(
            """
            INSERT INTO domain_event_outbox (
                event_uid, event_type, scope, subject_key, payload_json
            ) VALUES (
                CAST(:event_uid AS UUID), :event_type, :scope, :subject_key,
                CAST(:payload_json AS JSONB)
            )
            ON CONFLICT (event_uid) DO NOTHING
            """
        ),
        {
            "event_uid": stable_uid,
            "event_type": event_type,
            "scope": scope,
            "subject_key": subject_key,
            "payload_json": json.dumps(payload or {}, default=str),
        },
    )
    return stable_uid


def claim_outbox_events(
    worker_id: str,
    *,
    limit: int = 100,
    lease_seconds: int = 30,
    session=None,
) -> list[dict[str, Any]]:
    safe_limit = max(1, min(int(limit), 1000))
    safe_lease = max(5, min(int(lease_seconds), 300))
    with optional_scope(session) as current:
        rows = (
            current.execute(
                text(
                    """
                    WITH candidates AS (
                        SELECT event_uid
                        FROM domain_event_outbox
                        WHERE next_attempt_at <= NOW()
                          AND (
                            status = 'pending'
                            OR (status = 'leased' AND lease_expires_at <= NOW())
                          )
                        ORDER BY created_at, event_uid
                        FOR UPDATE SKIP LOCKED
                        LIMIT :limit
                    )
                    UPDATE domain_event_outbox AS outbox
                    SET status = 'leased',
                        leased_by = :worker_id,
                        lease_expires_at = NOW() + (:lease_seconds * INTERVAL '1 second'),
                        updated_at = NOW()
                    FROM candidates
                    WHERE outbox.event_uid = candidates.event_uid
                    RETURNING outbox.event_uid::text, outbox.event_type,
                              outbox.scope, outbox.subject_key,
                              outbox.payload_json, outbox.attempts,
                              outbox.created_at
                    """
                ),
                {
                    "worker_id": worker_id,
                    "limit": safe_limit,
                    "lease_seconds": safe_lease,
                },
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


def retry_delay_seconds(attempts: int) -> int:
    safe_attempts = max(1, int(attempts))
    return min(_MAX_RETRY_SECONDS, 2 ** (safe_attempts - 1))


def mark_outbox_delivered(
    event_uid: str,
    stream_id: str,
    sequence: int,
    *,
    worker_id: str,
    session=None,
) -> None:
    with optional_scope(session) as current:
        current.execute(
            text(
                """
                UPDATE domain_event_outbox
                SET status = 'delivered', redis_stream_id = :stream_id,
                    sequence = :sequence, delivered_at = NOW(), updated_at = NOW(),
                    leased_by = NULL, lease_expires_at = NULL, last_error = NULL
                WHERE event_uid = CAST(:event_uid AS UUID)
                  AND status = 'leased'
                  AND leased_by = :worker_id
                """
            ),
            {
                "event_uid": event_uid,
                "stream_id": stream_id,
                "sequence": int(sequence),
                "worker_id": worker_id,
            },
        )


def mark_outbox_failed(
    event_uid: str,
    error: str,
    attempts: int,
    *,
    worker_id: str,
    session=None,
) -> None:
    safe_attempts = max(1, int(attempts))
    dead_letter = safe_attempts >= _MAX_ATTEMPTS
    with optional_scope(session) as current:
        current.execute(
            text(
                """
                UPDATE domain_event_outbox
                SET status = :status, attempts = :attempts,
                    next_attempt_at = NOW() + (:delay_seconds * INTERVAL '1 second'),
                    last_error = :last_error, leased_by = NULL,
                    lease_expires_at = NULL, updated_at = NOW()
                WHERE event_uid = CAST(:event_uid AS UUID)
                  AND status = 'leased'
                  AND leased_by = :worker_id
                """
            ),
            {
                "event_uid": event_uid,
                "status": "dead_letter" if dead_letter else "pending",
                "attempts": safe_attempts,
                "delay_seconds": 0
                if dead_letter
                else retry_delay_seconds(safe_attempts),
                "last_error": str(error)[:2000],
                "worker_id": worker_id,
            },
        )


def get_outbox_runtime() -> dict[str, Any]:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    SELECT
                        COUNT(*) FILTER (WHERE status = 'pending') AS pending,
                        COUNT(*) FILTER (WHERE status = 'leased') AS leased,
                        COUNT(*) FILTER (WHERE status = 'dead_letter') AS dead_letter,
                        COALESCE(EXTRACT(EPOCH FROM (
                            NOW() - MIN(created_at) FILTER (
                                WHERE status IN ('pending', 'leased')
                            )
                        )), 0) AS oldest_pending_seconds
                    FROM domain_event_outbox
                    """
                )
            )
            .mappings()
            .one()
        )
    return dict(row)


def cleanup_delivered_outbox(
    *,
    retention_days: int = 7,
    limit: int = 1000,
    session=None,
) -> int:
    """Prune a bounded batch of delivered events while retaining failures."""
    safe_retention = max(1, min(int(retention_days), 365))
    safe_limit = max(1, min(int(limit), 10_000))
    with optional_scope(session) as current:
        result = current.execute(
            text(
                """
                WITH candidates AS (
                    SELECT event_uid
                    FROM domain_event_outbox
                    WHERE status = 'delivered'
                      AND delivered_at < NOW() - (:retention_days * INTERVAL '1 day')
                    ORDER BY delivered_at, event_uid
                    FOR UPDATE SKIP LOCKED
                    LIMIT :limit
                )
                DELETE FROM domain_event_outbox AS outbox
                USING candidates
                WHERE outbox.event_uid = candidates.event_uid
                """
            ),
            {"retention_days": safe_retention, "limit": safe_limit},
        )
    return int(getattr(result, "rowcount", 0) or 0)


def persist_standalone_event(
    event_type: str,
    payload: dict[str, Any] | None,
    *,
    scope: str | None,
    subject_key: str | None,
) -> str:
    with transaction_scope() as session:
        return enqueue_outbox_event(
            event_type,
            payload,
            scope=scope,
            subject_key=subject_key,
            session=session,
        )


__all__ = [
    "claim_outbox_events",
    "cleanup_delivered_outbox",
    "enqueue_outbox_event",
    "get_outbox_runtime",
    "mark_outbox_delivered",
    "mark_outbox_failed",
    "persist_standalone_event",
    "retry_delay_seconds",
]

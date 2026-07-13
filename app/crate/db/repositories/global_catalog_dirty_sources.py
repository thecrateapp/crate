"""Transactional dirty-source queue for canonical catalog projection."""

from __future__ import annotations

from typing import Any, Literal

from sqlalchemy import text


EntityType = Literal["artist", "album", "track"]
Operation = Literal["upsert", "delete"]


def enqueue_local_dirty_source(
    entity_type: EntityType,
    entity_uid: str,
    operation: Operation,
    *,
    session,
    source_revision: str | None = None,
) -> None:
    _enqueue_dirty_source(
        entity_type=entity_type,
        source_kind="local",
        local_entity_uid=entity_uid,
        node_uid=None,
        remote_entity_uid=None,
        operation=operation,
        source_revision=source_revision,
        session=session,
    )


def enqueue_federated_dirty_source(
    entity_type: EntityType,
    node_uid: str,
    remote_entity_uid: str,
    operation: Operation,
    *,
    session,
    source_revision: str | None = None,
) -> None:
    _enqueue_dirty_source(
        entity_type=entity_type,
        source_kind="federated",
        local_entity_uid=None,
        node_uid=node_uid,
        remote_entity_uid=remote_entity_uid,
        operation=operation,
        source_revision=source_revision,
        session=session,
    )


def _enqueue_dirty_source(
    *,
    entity_type: EntityType,
    source_kind: str,
    local_entity_uid: str | None,
    node_uid: str | None,
    remote_entity_uid: str | None,
    operation: Operation,
    source_revision: str | None,
    session,
) -> None:
    dedupe_key = (
        f"local:{entity_type}:{local_entity_uid}"
        if source_kind == "local"
        else f"federated:{node_uid}:{entity_type}:{remote_entity_uid}"
    )
    session.execute(
        text(
            """
            INSERT INTO global_catalog_dirty_sources (
                dedupe_key,
                entity_type,
                source_kind,
                local_entity_uid,
                node_uid,
                remote_entity_uid,
                operation,
                source_revision
            )
            VALUES (
                :dedupe_key,
                :entity_type,
                :source_kind,
                :local_entity_uid,
                :node_uid,
                :remote_entity_uid,
                :operation,
                :source_revision
            )
            ON CONFLICT (dedupe_key) DO UPDATE
            SET
                operation = EXCLUDED.operation,
                source_revision = EXCLUDED.source_revision,
                requested_at = NOW(),
                claimed_at = CASE
                    WHEN global_catalog_dirty_sources.completed_at IS NOT NULL
                    THEN NULL
                    ELSE global_catalog_dirty_sources.claimed_at
                END,
                completed_at = CASE
                    WHEN global_catalog_dirty_sources.completed_at IS NOT NULL
                    THEN NULL
                    ELSE global_catalog_dirty_sources.completed_at
                END,
                last_error = CASE
                    WHEN global_catalog_dirty_sources.completed_at IS NOT NULL
                    THEN NULL
                    ELSE global_catalog_dirty_sources.last_error
                END
            """
        ),
        {
            "dedupe_key": dedupe_key,
            "entity_type": entity_type,
            "source_kind": source_kind,
            "local_entity_uid": local_entity_uid,
            "node_uid": node_uid,
            "remote_entity_uid": remote_entity_uid,
            "operation": operation,
            "source_revision": source_revision,
        },
    )


def claim_dirty_sources(limit: int, *, session) -> list[dict[str, Any]]:
    capped = max(1, min(int(limit or 1), 1000))
    rows = (
        session.execute(
            text(
                """
                WITH claimable AS (
                    SELECT id
                    FROM global_catalog_dirty_sources
                    WHERE completed_at IS NULL
                      AND claimed_at IS NULL
                    ORDER BY requested_at, id
                    LIMIT :limit
                    FOR UPDATE SKIP LOCKED
                )
                UPDATE global_catalog_dirty_sources dirty
                SET
                    claimed_at = NOW(),
                    attempts = dirty.attempts + 1
                FROM claimable
                WHERE dirty.id = claimable.id
                RETURNING
                    dirty.id,
                    dirty.dedupe_key,
                    dirty.entity_type,
                    dirty.source_kind,
                    dirty.local_entity_uid::text AS local_entity_uid,
                    dirty.node_uid::text AS node_uid,
                    dirty.remote_entity_uid,
                    dirty.operation,
                    dirty.source_revision,
                    dirty.requested_at,
                    dirty.claimed_at,
                    dirty.completed_at,
                    dirty.attempts,
                    dirty.last_error
                """
            ),
            {"limit": capped},
        )
        .mappings()
        .all()
    )
    return [dict(row) for row in rows]


def complete_dirty_source(source_id: int, *, session) -> None:
    session.execute(
        text(
            """
            UPDATE global_catalog_dirty_sources
            SET completed_at = NOW(), claimed_at = NULL, last_error = NULL
            WHERE id = :source_id
            """
        ),
        {"source_id": source_id},
    )


def fail_dirty_source(source_id: int, error: str, *, session) -> None:
    session.execute(
        text(
            """
            UPDATE global_catalog_dirty_sources
            SET claimed_at = NULL, last_error = :error
            WHERE id = :source_id
            """
        ),
        {"source_id": source_id, "error": error[:4000]},
    )


__all__ = [
    "claim_dirty_sources",
    "complete_dirty_source",
    "enqueue_federated_dirty_source",
    "enqueue_local_dirty_source",
    "fail_dirty_source",
]

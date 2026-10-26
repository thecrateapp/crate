from __future__ import annotations

import json
from contextlib import nullcontext
from typing import Any

from sqlalchemy import text

from crate.db.analytics_surface_shared import QUALITY_SNAPSHOT_SCOPE, _decorate_snapshot
from crate.db.snapshot_events import publish_snapshot_update
from crate.db.tx import optional_scope, read_scope, register_after_commit
from crate.db.ui_snapshot_store import (
    get_ui_snapshot,
    upsert_ui_snapshot,
)
from crate.quality_task_policy import QUALITY_MUTATING_TASK_TYPES

QUALITY_CATEGORIES = frozenset(
    {"corrupt", "low_bitrate", "lossy_with_lossless", "mixed_format_albums"}
)


class QualityMutationInProgress(RuntimeError):
    pass


def empty_quality_report(
    *, computing: bool = False, task_id: str | None = None
) -> dict[str, Any]:
    return {
        "ready": False,
        "computing": computing,
        "task_id": task_id,
        "corrupt_count": 0,
        "low_bitrate_count": 0,
        "lossy_with_lossless_count": 0,
        "mixed_format_count": 0,
        "corrupt": [],
        "low_bitrate": [],
        "lossy_with_lossless": [],
        "mixed_format_albums": [],
    }


def get_cached_quality_report(
    *, max_age_seconds: int | None = None
) -> dict[str, Any] | None:
    row = get_ui_snapshot(
        QUALITY_SNAPSHOT_SCOPE,
        "global",
        max_age_seconds=max_age_seconds,
    )
    return _decorate_snapshot(row) if row else None


def save_quality_report_snapshot(
    payload: dict[str, Any],
    *,
    generation_ms: int = 0,
    session=None,
) -> dict[str, Any]:
    saved = upsert_ui_snapshot(
        QUALITY_SNAPSHOT_SCOPE,
        "global",
        dict(payload),
        generation_ms=generation_ms,
        stale_after_seconds=86400,
        session=session,
    )
    return _decorate_snapshot(saved)


def mark_quality_report_stale(*, session=None) -> int:
    with optional_scope(session) as current:
        result = current.execute(
            text("""
                UPDATE ui_snapshots
                SET version = version + 1,
                    stale_after = clock_timestamp() - INTERVAL '1 second',
                    invalidated_at = clock_timestamp()
                WHERE scope = :scope AND subject_key = 'global'
            """),
            {"scope": QUALITY_SNAPSHOT_SCOPE},
        )
        return int(getattr(result, "rowcount", 0) or 0)


def begin_quality_report_scan(*, session=None) -> dict[str, Any]:
    """Create an invalidatable row before scanning, including on the first build."""
    with optional_scope(session) as current:
        current.execute(
            text("""
                INSERT INTO ui_snapshots
                    (scope, subject_key, version, payload_json, built_at, stale_after, invalidated_at)
                VALUES (:scope, 'global', 1, CAST(:payload AS jsonb), NOW(), NOW(), NOW())
                ON CONFLICT (scope, subject_key) DO NOTHING
            """),
            {
                "scope": QUALITY_SNAPSHOT_SCOPE,
                "payload": json.dumps(empty_quality_report()),
            },
        )
        row = (
            current.execute(
                text("""
                SELECT version, invalidated_at, EXISTS(
                    SELECT 1 FROM tasks t LEFT JOIN agent_jobs j ON j.task_id=t.id
                    WHERE (t.type = ANY(:mutation_types) OR (t.type='agent_maintenance'
                        AND j.operation='apply_operation' AND j.payload->>'domain_operation' IN
                        ('repairs','metadata_update','enrichment','library_sync','metadata_rehydrate')))
                      AND t.status IN ('running', 'delegated', 'completing')
                ) AS active_mutation FROM ui_snapshots
                WHERE scope = :scope AND subject_key = 'global'
            """),
                {
                    "scope": QUALITY_SNAPSHOT_SCOPE,
                    "mutation_types": sorted(QUALITY_MUTATING_TASK_TYPES),
                },
            )
            .mappings()
            .one()
        )
        if row["active_mutation"]:
            raise QualityMutationInProgress("A library mutation is in progress")
        return dict(row)


def complete_quality_report_scan(
    payload: dict[str, Any],
    *,
    observation: dict[str, Any],
    generation_ms: int = 0,
    session=None,
) -> bool:
    """Publish only if no library invalidation or other scan superseded this build."""
    with optional_scope(session) as current:
        row = (
            current.execute(
                text("""
                UPDATE ui_snapshots SET
                    payload_json = CAST(:payload AS jsonb),
                    version = version + 1,
                    built_at = clock_timestamp(),
                    stale_after = clock_timestamp() + INTERVAL '24 hours',
                    invalidated_at = NULL,
                    generation_ms = :generation_ms
                WHERE scope = :scope AND subject_key = 'global'
                  AND version = :version
                  AND invalidated_at IS NOT DISTINCT FROM CAST(:invalidated_at AS timestamptz)
                  AND NOT EXISTS (
                    SELECT 1 FROM tasks t LEFT JOIN agent_jobs j ON j.task_id=t.id
                    WHERE (t.type = ANY(:mutation_types) OR (t.type='agent_maintenance'
                        AND j.operation='apply_operation' AND j.payload->>'domain_operation' IN
                        ('repairs','metadata_update','enrichment','library_sync','metadata_rehydrate')))
                      AND t.status IN ('running', 'delegated', 'completing')
                  )
                RETURNING version
            """),
                {
                    "scope": QUALITY_SNAPSHOT_SCOPE,
                    "payload": json.dumps(payload),
                    "version": observation["version"],
                    "invalidated_at": observation.get("invalidated_at"),
                    "generation_ms": max(int(generation_ms), 0),
                    "mutation_types": sorted(QUALITY_MUTATING_TASK_TYPES),
                },
            )
            .mappings()
            .first()
        )
        if row is None:
            return False
        version = int(row["version"])
        register_after_commit(
            current,
            lambda: publish_snapshot_update(QUALITY_SNAPSHOT_SCOPE, "global", version),
        )
        return True


def read_quality_report_snapshot(
    *, category: str | None = None, offset: int = 0, limit: int = 50, session=None
) -> dict[str, Any] | None:
    """Read bounded evidence without dropping stale/invalidated snapshot metadata."""
    if category is not None and (
        not isinstance(category, str) or category not in QUALITY_CATEGORIES
    ):
        raise ValueError("Unknown quality category")
    if (
        type(offset) is not int
        or type(limit) is not int
        or not 0 <= offset <= 100000
        or not 1 <= limit <= 100
    ):
        raise ValueError("Invalid quality pagination")
    with nullcontext(session) if session is not None else read_scope() as current:
        current.execute(text("SET LOCAL statement_timeout = '5s'"))
        row = (
            current.execute(
                text("""
                SELECT version, built_at, stale_after, invalidated_at, source_seq, generation_ms,
                    EXISTS(SELECT 1 FROM tasks t LEFT JOIN agent_jobs j ON j.task_id=t.id
                        WHERE (t.type = ANY(:mutation_types) OR (t.type='agent_maintenance'
                            AND j.operation='apply_operation' AND j.payload->>'domain_operation' IN
                            ('repairs','metadata_update','enrichment','library_sync','metadata_rehydrate')))
                        AND t.status IN ('running', 'delegated', 'completing')) AS active_mutation,
                    payload_json - CAST(:categories AS text[]) AS summary,
                    CASE WHEN :category IS NULL THEN '[]'::jsonb ELSE
                        jsonb_path_query_array(payload_json, CAST(:path AS jsonpath))
                    END AS items,
                    CASE WHEN :category IS NULL THEN 0 ELSE
                        jsonb_array_length(COALESCE(payload_json -> :category, '[]'::jsonb))
                    END AS total
                FROM ui_snapshots WHERE scope = :scope AND subject_key = 'global'
            """),
                {
                    "scope": QUALITY_SNAPSHOT_SCOPE,
                    "mutation_types": sorted(QUALITY_MUTATING_TASK_TYPES),
                    "categories": sorted(QUALITY_CATEGORIES),
                    "category": category,
                    "path": f'$."{category}"[{offset} to {offset + limit - 1}]'
                    if category
                    else "$",
                },
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None


__all__ = [
    "empty_quality_report",
    "get_cached_quality_report",
    "mark_quality_report_stale",
    "save_quality_report_snapshot",
    "begin_quality_report_scan",
    "complete_quality_report_scan",
    "read_quality_report_snapshot",
]

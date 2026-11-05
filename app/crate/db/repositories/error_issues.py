"""Writes for the error inbox (`error_issues`). Only worker tasks call these."""

from __future__ import annotations

import json
import uuid
from collections.abc import Mapping, Sequence
from datetime import datetime, timedelta, timezone
from typing import Any, cast

from sqlalchemy import text
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session

from crate.db.tx import optional_scope

ISSUE_STATUSES = frozenset({"unresolved", "resolved", "ignored"})

_UPSERT_SQL = """
    INSERT INTO error_issues (
        provider, external_id, short_id, project_slug, service, title, culprit, level,
        status, substatus, sentry_priority, issue_category, events_total, users_total,
        events_24h, users_24h, first_seen, last_seen, first_release, last_release,
        permalink, crate_score, closed_at, synced_at
    ) VALUES (
        :provider, :external_id, :short_id, :project_slug, :service, :title, :culprit,
        :level, :status, :substatus, :sentry_priority, :issue_category, :events_total,
        :users_total, :events_24h, :users_24h, :first_seen, :last_seen, :first_release,
        :last_release, :permalink, :crate_score,
        CASE WHEN CAST(:status AS text) = 'unresolved' THEN NULL
             ELSE CAST(:synced_at AS timestamptz) END,
        :synced_at
    )
    ON CONFLICT (provider, external_id) DO UPDATE SET
        short_id = EXCLUDED.short_id,
        project_slug = EXCLUDED.project_slug,
        title = EXCLUDED.title,
        culprit = EXCLUDED.culprit,
        level = EXCLUDED.level,
        status = EXCLUDED.status,
        substatus = EXCLUDED.substatus,
        sentry_priority = EXCLUDED.sentry_priority,
        issue_category = EXCLUDED.issue_category,
        events_total = EXCLUDED.events_total,
        users_total = EXCLUDED.users_total,
        events_24h = EXCLUDED.events_24h,
        users_24h = EXCLUDED.users_24h,
        first_seen = EXCLUDED.first_seen,
        last_seen = EXCLUDED.last_seen,
        first_release = EXCLUDED.first_release,
        last_release = EXCLUDED.last_release,
        permalink = EXCLUDED.permalink,
        crate_score = EXCLUDED.crate_score,
        closed_at = CASE
            WHEN EXCLUDED.status = 'unresolved' THEN NULL
            WHEN error_issues.status = 'unresolved' OR error_issues.closed_at IS NULL
                THEN EXCLUDED.synced_at
            ELSE error_issues.closed_at
        END,
        synced_at = EXCLUDED.synced_at
"""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uuid(value: str) -> str:
    return str(uuid.UUID(str(value)))


def _count(value: Any) -> int:
    return max(int(value or 0), 0)


def _upsert_params(row: Mapping[str, Any], synced_at: datetime) -> dict[str, Any]:
    status = row["status"]
    if status not in ISSUE_STATUSES:
        raise ValueError(f"Unsupported error issue status: {status!r}")
    return {
        "provider": row.get("provider") or "sentry",
        "external_id": str(row["external_id"]),
        "short_id": row["short_id"],
        "project_slug": row["project_slug"],
        "service": row.get("service") or row["project_slug"],
        "title": row["title"],
        "culprit": row.get("culprit"),
        "level": row["level"],
        "status": status,
        "substatus": row.get("substatus"),
        "sentry_priority": row.get("sentry_priority"),
        "issue_category": row.get("issue_category"),
        "events_total": _count(row.get("events_total")),
        "users_total": _count(row.get("users_total")),
        "events_24h": _count(row.get("events_24h")),
        "users_24h": _count(row.get("users_24h")),
        "first_seen": row.get("first_seen"),
        "last_seen": row.get("last_seen"),
        "first_release": row.get("first_release"),
        "last_release": row.get("last_release"),
        "permalink": row.get("permalink"),
        "crate_score": int(row.get("crate_score") or 0),
        "synced_at": synced_at,
    }


def upsert_issues(
    rows: Sequence[Mapping[str, Any]],
    *,
    synced_at: datetime | None = None,
    session: Session | None = None,
) -> int:
    """Insert or refresh issues from a sync pass.

    `service`, the digest and fix requests survive a refresh: the service comes from
    the latest event's tag, which only `set_digest` knows.
    """
    if not rows:
        return 0
    stamp = synced_at or _now()
    params = [_upsert_params(row, stamp) for row in rows]
    with optional_scope(session) as current:
        current.execute(text(_UPSERT_SQL), params)
    return len(params)


def mark_status(
    issue_ids: Sequence[str],
    status: str,
    *,
    substatus: str | None = None,
    at: datetime | None = None,
    session: Session | None = None,
) -> int:
    if status not in ISSUE_STATUSES:
        raise ValueError(f"Unsupported error issue status: {status!r}")
    ids = [_uuid(issue_id) for issue_id in issue_ids]
    if not ids:
        return 0
    with optional_scope(session) as current:
        result = current.execute(
            text(
                """
                UPDATE error_issues
                SET status = :status,
                    substatus = :substatus,
                    closed_at = CASE
                        WHEN CAST(:status AS text) = 'unresolved' THEN NULL
                        ELSE COALESCE(closed_at, CAST(:at AS timestamptz))
                    END
                WHERE id = ANY(CAST(:ids AS uuid[]))
                """
            ),
            {"status": status, "substatus": substatus, "at": at or _now(), "ids": ids},
        )
        return int(cast(CursorResult, result).rowcount or 0)


def set_digest(
    issue_id: str,
    *,
    digest: Mapping[str, Any],
    digest_event_id: str | None,
    digest_hash: str,
    group_key: str,
    service: str | None = None,
    crate_score: int | None = None,
    session: Session | None = None,
) -> bool:
    with optional_scope(session) as current:
        result = current.execute(
            text(
                """
                UPDATE error_issues
                SET digest = CAST(:digest AS jsonb),
                    digest_event_id = :digest_event_id,
                    digest_hash = :digest_hash,
                    group_key = :group_key,
                    service = COALESCE(CAST(:service AS text), service),
                    crate_score = COALESCE(CAST(:crate_score AS integer), crate_score)
                WHERE id = CAST(:id AS uuid)
                """
            ),
            {
                "id": _uuid(issue_id),
                "digest": json.dumps(digest, ensure_ascii=False, separators=(",", ":")),
                "digest_event_id": digest_event_id,
                "digest_hash": digest_hash,
                "group_key": group_key,
                "service": service,
                "crate_score": crate_score,
            },
        )
        return cast(CursorResult, result).rowcount == 1


def purge_closed(
    *,
    older_than_days: int = 30,
    now: datetime | None = None,
    session: Session | None = None,
) -> int:
    """Delete issues resolved or ignored for longer than the window; triage cascades."""
    cutoff = (now or _now()) - timedelta(days=older_than_days)
    with optional_scope(session) as current:
        result = current.execute(
            text(
                """
                DELETE FROM error_issues
                WHERE status IN ('resolved', 'ignored') AND closed_at < :cutoff
                """
            ),
            {"cutoff": cutoff},
        )
        return int(cast(CursorResult, result).rowcount or 0)


def record_fix_request(
    issue_id: str,
    *,
    user_id: int | None,
    at: datetime | None = None,
    session: Session | None = None,
) -> bool:
    with optional_scope(session) as current:
        result = current.execute(
            text(
                """
                UPDATE error_issues
                SET fix_requested_at = :at, fix_requested_by = :user_id
                WHERE id = CAST(:id AS uuid)
                """
            ),
            {"id": _uuid(issue_id), "at": at or _now(), "user_id": user_id},
        )
        return cast(CursorResult, result).rowcount == 1


__all__ = [
    "ISSUE_STATUSES",
    "mark_status",
    "purge_closed",
    "record_fix_request",
    "set_digest",
    "upsert_issues",
]

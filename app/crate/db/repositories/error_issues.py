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


STATUS_AUDIT_ACTION = "error_issue.status.update"


def record_status_change(
    issue_id: str,
    *,
    status: str,
    substatus: str | None = None,
    actor_id: int | None,
    task_id: str | None = None,
    at: datetime | None = None,
    session: Session | None = None,
) -> bool:
    """Apply a status a person set in Sentry and audit it in the same transaction.

    The audit row only carries ids and statuses, never the issue title or event text.
    Returns False when the issue no longer exists locally (nothing is audited).
    """
    valid_id = _uuid(issue_id)
    stamp = at or _now()
    with optional_scope(session) as current:
        previous = (
            current.execute(
                text(
                    """
                    SELECT short_id, external_id, provider, status, substatus
                    FROM error_issues
                    WHERE id = CAST(:id AS uuid)
                    FOR UPDATE
                    """
                ),
                {"id": valid_id},
            )
            .mappings()
            .first()
        )
        if previous is None:
            return False
        mark_status([valid_id], status, substatus=substatus, at=stamp, session=current)
        details = {
            "issue_id": valid_id,
            "provider": previous["provider"],
            "external_id": previous["external_id"],
            "from": {"status": previous["status"], "substatus": previous["substatus"]},
            "to": {"status": status, "substatus": substatus},
        }
        current.execute(
            text(
                """
                INSERT INTO audit_log
                    (timestamp, action, target_type, target_name, details_json,
                     user_id, task_id)
                VALUES (:ts, :action, 'error_issue', :target, CAST(:details AS jsonb),
                        :user_id, :task_id)
                """
            ),
            {
                "ts": stamp,
                "action": STATUS_AUDIT_ACTION,
                "target": previous["short_id"],
                "details": json.dumps(details, separators=(",", ":")),
                "user_id": actor_id,
                "task_id": task_id,
            },
        )
        return True


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
    cooldown: timedelta | None = None,
    session: Session | None = None,
) -> bool:
    """Record who launched a fix and when.

    With `cooldown`, the row is only claimed when no fix was requested within it, in
    one statement, so two dispatches of the same issue cannot both pass. Returns
    False when the issue is gone or, with `cooldown`, was requested too recently.
    """
    stamp = at or _now()
    with optional_scope(session) as current:
        result = current.execute(
            text(
                """
                UPDATE error_issues
                SET fix_requested_at = :at, fix_requested_by = :user_id
                WHERE id = CAST(:id AS uuid)
                  AND (
                      CAST(:not_since AS timestamptz) IS NULL
                      OR fix_requested_at IS NULL
                      OR fix_requested_at <= CAST(:not_since AS timestamptz)
                  )
                """
            ),
            {
                "id": _uuid(issue_id),
                "at": stamp,
                "user_id": user_id,
                "not_since": stamp - cooldown if cooldown is not None else None,
            },
        )
        return cast(CursorResult, result).rowcount == 1


def release_fix_request(
    issue_id: str,
    *,
    requested_at: datetime,
    previous_at: datetime | None,
    previous_by: int | None,
    session: Session | None = None,
) -> bool:
    """Undo a claim whose dispatch failed, unless another request replaced it."""
    with optional_scope(session) as current:
        result = current.execute(
            text(
                """
                UPDATE error_issues
                SET fix_requested_at = :previous_at, fix_requested_by = :previous_by
                WHERE id = CAST(:id AS uuid) AND fix_requested_at = :requested_at
                """
            ),
            {
                "id": _uuid(issue_id),
                "requested_at": requested_at,
                "previous_at": previous_at,
                "previous_by": previous_by,
            },
        )
        return cast(CursorResult, result).rowcount == 1


FIX_AUDIT_ACTION = "error_issue.fix.dispatch"


def audit_fix_request(
    issue_id: str,
    *,
    actor_id: int | None,
    details: Mapping[str, Any],
    task_id: str | None = None,
    at: datetime | None = None,
    session: Session | None = None,
) -> bool:
    """Audit a dispatched fix. `details` carries ids and settings, never event text
    or the note. Returns False when the issue no longer exists (nothing is audited).
    """
    with optional_scope(session) as current:
        result = current.execute(
            text(
                """
                INSERT INTO audit_log
                    (timestamp, action, target_type, target_name, details_json,
                     user_id, task_id)
                SELECT :ts, :action, 'error_issue', i.short_id,
                       CAST(:details AS jsonb), :user_id, :task_id
                FROM error_issues i
                WHERE i.id = CAST(:id AS uuid)
                """
            ),
            {
                "id": _uuid(issue_id),
                "ts": at or _now(),
                "action": FIX_AUDIT_ACTION,
                "details": json.dumps(dict(details), separators=(",", ":")),
                "user_id": actor_id,
                "task_id": task_id,
            },
        )
        return cast(CursorResult, result).rowcount == 1


TRIAGE_KINDS = frozenset({"triage", "investigation"})


def _uuid_or_none(value: Any) -> str | None:
    if value is None:
        return None
    try:
        return str(uuid.UUID(str(value)))
    except ValueError:
        return None


def save_triage(
    issue_id: str,
    *,
    kind: str,
    digest_hash: str,
    classification: str,
    severity: str,
    summary: str,
    confidence: float,
    hypothesis: str | None = None,
    next_step: str | None = None,
    duplicate_of: str | None = None,
    suspected_frames: Sequence[int] = (),
    invocation_id: str | None = None,
    session: Session | None = None,
) -> str | None:
    """Store a validated triage or investigation once per issue, kind and digest.

    Only validated output reaches this, never the prompt or the raw response.
    Returns the new row id, or None when the issue is gone or that digest already
    has a result of this kind. A duplicate purged in the meantime is stored as NULL.
    """
    if kind not in TRIAGE_KINDS:
        raise ValueError(f"Unsupported triage kind: {kind!r}")
    params = {
        "issue_id": _uuid(issue_id),
        "kind": kind,
        "digest_hash": digest_hash,
        "invocation_id": _uuid_or_none(invocation_id),
        "classification": classification,
        "severity": severity,
        "duplicate_of": _uuid_or_none(duplicate_of),
        "summary": summary,
        "hypothesis": hypothesis,
        "suspected_frames": json.dumps([int(index) for index in suspected_frames]),
        "next_step": next_step,
        "confidence": float(confidence),
    }
    with optional_scope(session) as current:
        return current.execute(
            text(
                """
                INSERT INTO error_issue_triage (
                    issue_id, kind, digest_hash, invocation_id, classification,
                    severity, duplicate_of, summary, hypothesis, suspected_frames,
                    next_step, confidence
                )
                SELECT i.id, :kind, :digest_hash, CAST(:invocation_id AS uuid),
                       :classification, :severity,
                       (
                           SELECT d.id FROM error_issues d
                           WHERE d.id = CAST(:duplicate_of AS uuid) AND d.id <> i.id
                       ),
                       :summary, :hypothesis, CAST(:suspected_frames AS jsonb),
                       :next_step, :confidence
                FROM error_issues i
                WHERE i.id = CAST(:issue_id AS uuid)
                ON CONFLICT (issue_id, kind, digest_hash) DO NOTHING
                RETURNING id::text
                """
            ),
            params,
        ).scalar_one_or_none()


__all__ = [
    "FIX_AUDIT_ACTION",
    "ISSUE_STATUSES",
    "STATUS_AUDIT_ACTION",
    "TRIAGE_KINDS",
    "audit_fix_request",
    "mark_status",
    "purge_closed",
    "record_fix_request",
    "record_status_change",
    "release_fix_request",
    "save_triage",
    "set_digest",
    "upsert_issues",
]

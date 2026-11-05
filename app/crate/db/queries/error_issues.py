"""Read models for the error inbox: list, detail, summary and sync helpers.

The critical lane matches `crate.error_inbox.priority.is_critical`: a score at or
above the threshold, or a confident critical triage of the current digest.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.read_model_shared import coerce_json
from crate.db.repositories.error_tracking_settings import ERROR_TRACKING_SETTINGS_KEY
from crate.db.tx import read_scope
from crate.error_inbox.priority import CRITICAL_SCORE, CRITICAL_TRIAGE_CONFIDENCE
from crate.error_inbox.state import ACCESS_STATE_KEY, SYNC_STATE_KEY

MAX_LIST_LIMIT = 200
MAX_CURSOR_OFFSET = 100_000
LIST_STATUSES = frozenset({"unresolved", "resolved", "ignored", "all"})
_STORED_SETTINGS = "(SELECT value FROM settings WHERE key = :settings_key)"
_STORED_SYNC = "(SELECT payload_json FROM ops_runtime_state WHERE key = :sync_key)"
_STORED_ACCESS = "(SELECT payload_json FROM ops_runtime_state WHERE key = :access_key)"

_CURRENT_TRIAGE = """
    LEFT JOIN LATERAL (
        SELECT t.classification, t.severity, t.confidence
        FROM error_issue_triage t
        WHERE t.issue_id = i.id AND t.kind = 'triage' AND t.digest_hash = i.digest_hash
        ORDER BY t.created_at DESC
        LIMIT 1
    ) triage ON TRUE
"""
_CRITICAL = """
    COALESCE(
        i.crate_score >= :critical_score
        OR (triage.severity = 'critical' AND triage.confidence >= :critical_confidence),
        FALSE
    )
"""
_LIST_COLUMNS = """
    i.id::text AS id, i.short_id, i.title, i.culprit, i.service, i.project_slug,
    i.level, i.status, i.substatus, i.issue_category, i.sentry_priority,
    i.events_24h, i.users_24h, i.events_total, i.users_total, i.first_seen,
    i.last_seen, i.first_release, i.last_release, i.crate_score, i.group_key,
    i.permalink, i.fix_requested_at, i.synced_at,
    triage.classification, triage.severity
"""


def _thresholds() -> dict[str, Any]:
    return {
        "critical_score": CRITICAL_SCORE,
        "critical_confidence": CRITICAL_TRIAGE_CONFIDENCE,
    }


def _offset(cursor: str | None) -> int:
    if cursor is None:
        return 0
    if not cursor.isdigit() or int(cursor) > MAX_CURSOR_OFFSET:
        raise ValueError("Invalid cursor")
    return int(cursor)


def _valid_uuid(value: str) -> str | None:
    try:
        return str(uuid.UUID(str(value)))
    except ValueError:
        return None


def list_issues(
    *,
    status: str = "unresolved",
    service: str | None = None,
    critical_only: bool = False,
    classification: str | None = None,
    release: str | None = None,
    limit: int = 50,
    cursor: str | None = None,
    session: Session | None = None,
) -> dict[str, Any]:
    if status not in LIST_STATUSES:
        raise ValueError("Invalid status filter")
    limit = max(1, min(int(limit), MAX_LIST_LIMIT))
    offset = _offset(cursor)
    where = ["TRUE"]
    params: dict[str, Any] = {
        **_thresholds(),
        "limit": limit + 1,
        "offset": offset,
        "status": status,
        "service": service,
        "classification": classification,
        "release": release,
    }
    if status != "all":
        where.append("i.status = :status")
    if service:
        where.append("i.service = :service")
    if classification:
        where.append("triage.classification = :classification")
    if release:
        where.append("(i.last_release = :release OR i.first_release = :release)")
    if critical_only:
        where.append(_CRITICAL)
    sql = f"""
        SELECT {_LIST_COLUMNS}, {_CRITICAL} AS critical
        FROM error_issues i
        {_CURRENT_TRIAGE}
        WHERE {" AND ".join(where)}
        ORDER BY critical DESC, i.crate_score DESC, i.last_seen DESC NULLS LAST, i.id
        LIMIT :limit OFFSET :offset
    """

    def _impl(current: Session) -> dict[str, Any]:
        rows = [
            dict(row) for row in current.execute(text(sql), params).mappings().all()
        ]
        has_more = len(rows) > limit
        return {
            "items": rows[:limit],
            "next_cursor": str(offset + limit) if has_more else None,
        }

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


_DETAIL_SQL = f"""
    SELECT {_LIST_COLUMNS}, {_CRITICAL} AS critical,
           i.provider, i.external_id, i.digest, i.digest_event_id, i.digest_hash,
           i.fix_requested_by,
           COALESCE(NULLIF(requester.name, ''), requester.username)
               AS fix_requested_by_name,
           i.closed_at, i.created_at,
           COALESCE(
               (
                   SELECT json_agg(
                       json_build_object(
                           'id', t.id::text,
                           'kind', t.kind,
                           'digest_hash', t.digest_hash,
                           'invocation_id', t.invocation_id::text,
                           'classification', t.classification,
                           'severity', t.severity,
                           'duplicate_of', t.duplicate_of::text,
                           'summary', t.summary,
                           'hypothesis', t.hypothesis,
                           'suspected_frames', t.suspected_frames,
                           'next_step', t.next_step,
                           'confidence', t.confidence,
                           'created_at', t.created_at
                       )
                       ORDER BY t.created_at DESC
                   )
                   FROM error_issue_triage t
                   WHERE t.issue_id = i.id
               ),
               '[]'::json
           ) AS triages
    FROM error_issues i
    LEFT JOIN users requester ON requester.id = i.fix_requested_by
    {_CURRENT_TRIAGE}
"""


def _detail(
    where: str, params: dict[str, Any], session: Session | None
) -> dict[str, Any] | None:
    sql = f"{_DETAIL_SQL} WHERE {where} ORDER BY i.last_seen DESC NULLS LAST LIMIT 1"

    def _impl(current: Session) -> dict[str, Any] | None:
        row = current.execute(text(sql), {**_thresholds(), **params}).mappings().first()
        return dict(row) if row else None

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def get_issue(
    issue_id: str, *, session: Session | None = None
) -> dict[str, Any] | None:
    valid_id = _valid_uuid(issue_id)
    if valid_id is None:
        return None
    return _detail("i.id = CAST(:id AS uuid)", {"id": valid_id}, session)


def get_issue_by_short_id(
    short_id: str, *, provider: str = "sentry", session: Session | None = None
) -> dict[str, Any] | None:
    """Detail by Sentry short id (`CRATE-API-1F`), the id the summaries name."""
    if not isinstance(short_id, str) or not 0 < len(short_id) <= 128:
        return None
    return _detail(
        "i.provider = :provider AND upper(i.short_id) = upper(:short_id)",
        {"provider": provider, "short_id": short_id},
        session,
    )


def _summary_sql(extra_columns: str = "") -> str:
    return f"""
        WITH open_issues AS (
            SELECT i.id, i.short_id, i.title, i.service, i.crate_score, i.first_seen,
                   i.last_seen, i.substatus, {_CRITICAL} AS critical
            FROM error_issues i
            {_CURRENT_TRIAGE}
            WHERE i.status = 'unresolved'
        ),
        by_service AS (
            SELECT service,
                   count(*) AS open,
                   count(*) FILTER (WHERE critical) AS critical,
                   count(*) FILTER (WHERE first_seen >= :since) AS new_24h,
                   count(*) FILTER (
                       WHERE substatus = 'regressed' AND last_seen >= :since
                   ) AS regressed_24h
            FROM open_issues
            GROUP BY service
        ),
        top_critical AS (
            SELECT id, short_id, title, service, crate_score, last_seen
            FROM open_issues
            WHERE critical
            ORDER BY crate_score DESC, last_seen DESC NULLS LAST, id
            LIMIT :top
        )
        SELECT
            (SELECT count(*) FROM open_issues) AS open,
            (SELECT count(*) FILTER (WHERE critical) FROM open_issues) AS critical_open,
            (SELECT count(*) FILTER (WHERE first_seen >= :since) FROM open_issues) AS new_24h,
            (
                SELECT count(*) FILTER (
                    WHERE substatus = 'regressed' AND last_seen >= :since
                )
                FROM open_issues
            ) AS regressed_24h,
            (SELECT max(synced_at) FROM error_issues) AS last_synced_at,
            COALESCE(
                (
                    SELECT json_agg(
                        json_build_object(
                            'service', service,
                            'open', open,
                            'critical', critical,
                            'new_24h', new_24h,
                            'regressed_24h', regressed_24h
                        )
                        ORDER BY critical DESC, open DESC, service
                    )
                    FROM by_service
                ),
                '[]'::json
            ) AS services,
            COALESCE(
                (
                    SELECT json_agg(
                        json_build_object(
                            'id', id::text,
                            'short_id', short_id,
                            'title', title,
                            'service', service,
                            'crate_score', crate_score
                        )
                        ORDER BY crate_score DESC, last_seen DESC NULLS LAST, id
                    )
                    FROM top_critical
                ),
                '[]'::json
            ) AS top_critical
            {extra_columns}
    """


def _summary_params(now: datetime | None, top: int) -> dict[str, Any]:
    since = (now or datetime.now(timezone.utc)) - timedelta(hours=24)
    return {**_thresholds(), "since": since, "top": max(0, int(top))}


def _summary_counts(row: Any) -> dict[str, Any]:
    return {
        "open": int(row["open"]),
        "critical_open": int(row["critical_open"]),
        "new_24h": int(row["new_24h"]),
        "regressed_24h": int(row["regressed_24h"]),
        "last_synced_at": row["last_synced_at"],
        "services": list(row["services"]),
        "top_critical": list(row["top_critical"]),
    }


def summary(
    *, now: datetime | None = None, top: int = 3, session: Session | None = None
) -> dict[str, Any]:
    """Counts for the System Health tile and the MCP summary, in one query."""
    sql = _summary_sql()
    params = _summary_params(now, top)

    def _impl(current: Session) -> dict[str, Any]:
        return _summary_counts(current.execute(text(sql), params).mappings().one())

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def _state_params() -> dict[str, str]:
    return {
        "settings_key": ERROR_TRACKING_SETTINGS_KEY,
        "sync_key": SYNC_STATE_KEY,
        "access_key": ACCESS_STATE_KEY,
    }


def inbox_overview(
    *, now: datetime | None = None, top: int = 3, session: Session | None = None
) -> dict[str, Any]:
    """`summary()` plus the stored settings value and the last sync state, in one query.

    `settings` is the raw stored value (JSON text, parsed by the caller) and
    `sync_state` the `error_inbox` runtime payload.
    """
    sql = _summary_sql(
        f", {_STORED_SETTINGS} AS settings, {_STORED_SYNC} AS sync_state"
    )
    params = {**_summary_params(now, top), **_state_params()}

    def _impl(current: Session) -> dict[str, Any]:
        row = current.execute(text(sql), params).mappings().one()
        return {
            **_summary_counts(row),
            "settings": row["settings"],
            "sync_state": coerce_json(row["sync_state"]),
        }

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def inbox_state(*, session: Session | None = None) -> dict[str, Any]:
    """Stored settings value and both runtime states of the inbox, in one query."""
    sql = f"""
        SELECT {_STORED_SETTINGS} AS settings,
               {_STORED_SYNC} AS sync_state,
               {_STORED_ACCESS} AS access_state
    """

    def _impl(current: Session) -> dict[str, Any]:
        row = current.execute(text(sql), _state_params()).mappings().one()
        return {
            "settings": row["settings"],
            "sync_state": coerce_json(row["sync_state"]),
            "access_state": coerce_json(row["access_state"]),
        }

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def open_ids_not_in(
    external_ids: Sequence[str],
    *,
    provider: str = "sentry",
    limit: int = 50,
    session: Session | None = None,
) -> list[dict[str, str]]:
    """Open local issues missing from the latest listing, least recently synced first."""
    params = {
        "ids": [str(value) for value in external_ids],
        "provider": provider,
        "limit": max(0, int(limit)),
    }

    def _impl(current: Session) -> list[dict[str, str]]:
        rows = current.execute(
            text(
                """
                SELECT id::text AS id, external_id
                FROM error_issues
                WHERE provider = :provider
                  AND status = 'unresolved'
                  AND NOT (external_id = ANY(CAST(:ids AS text[])))
                ORDER BY synced_at ASC, external_id ASC
                LIMIT :limit
                """
            ),
            params,
        ).mappings()
        return [dict(row) for row in rows]

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def sync_state(
    external_ids: Sequence[str],
    *,
    provider: str = "sentry",
    session: Session | None = None,
) -> dict[str, dict[str, Any]]:
    """Stored state of the given issues, by external id, for a sync pass to compare.

    The sync keeps the service learned from the latest event when it scores a
    refreshed row, and fetches events for issues that are new, changed or have no
    digest yet.
    """
    ids = list(dict.fromkeys(str(value) for value in external_ids))
    if not ids:
        return {}
    params = {"ids": ids, "provider": provider}

    def _impl(current: Session) -> dict[str, dict[str, Any]]:
        rows = current.execute(
            text(
                """
                SELECT id::text AS id, external_id, service, status, last_seen,
                       digest_hash
                FROM error_issues
                WHERE provider = :provider
                  AND external_id = ANY(CAST(:ids AS text[]))
                """
            ),
            params,
        ).mappings()
        return {row["external_id"]: dict(row) for row in rows}

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def untriaged_open(
    *, limit: int, session: Session | None = None
) -> list[dict[str, Any]]:
    """Open issues whose current digest has no triage yet, highest score first."""

    def _impl(current: Session) -> list[dict[str, Any]]:
        rows = current.execute(
            text(
                """
                SELECT i.id::text AS id, i.external_id, i.digest_hash, i.crate_score
                FROM error_issues i
                WHERE i.status = 'unresolved'
                  AND i.digest_hash IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1
                      FROM error_issue_triage t
                      WHERE t.issue_id = i.id
                        AND t.kind = 'triage'
                        AND t.digest_hash = i.digest_hash
                  )
                ORDER BY i.crate_score DESC, i.last_seen DESC NULLS LAST, i.id
                LIMIT :limit
                """
            ),
            {"limit": max(0, int(limit))},
        ).mappings()
        return [dict(row) for row in rows]

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


__all__ = [
    "LIST_STATUSES",
    "MAX_LIST_LIMIT",
    "get_issue",
    "get_issue_by_short_id",
    "inbox_overview",
    "inbox_state",
    "list_issues",
    "open_ids_not_in",
    "summary",
    "sync_state",
    "untriaged_open",
]

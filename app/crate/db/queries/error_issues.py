"""Read models for the error inbox: list, detail, summary and sync helpers.

The critical lane matches `crate.error_inbox.priority.is_critical`: a score at or
above the threshold, or a confident critical triage of the current digest.
"""

from __future__ import annotations

import uuid
from collections.abc import Mapping, Sequence
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
                           'model', COALESCE(inv.reported_model, inv.model_id),
                           'created_at', t.created_at
                       )
                       ORDER BY t.created_at DESC
                   )
                   FROM error_issue_triage t
                   -- The model is known while the invocation record is kept (90 days).
                   LEFT JOIN ai_invocations inv ON inv.id = t.invocation_id
                   WHERE t.issue_id = i.id
               ),
               '[]'::json
           ) AS triages,
           CASE WHEN i.auto_triage_hash = i.digest_hash THEN i.auto_triage_at END
               AS auto_triage_queued_at
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


def issue_ids_by_short_id(
    short_ids: Sequence[str],
    *,
    provider: str = "sentry",
    session: Session | None = None,
) -> dict[str, str]:
    """Issue ids keyed by upper-case short id, for the given short ids, in one query.

    Short ids that match no issue are absent. Every status counts: a resolved issue
    keeps its row (and digest) until it is purged 30 days after it closed.
    """
    wanted = sorted(
        {value.upper() for value in short_ids if isinstance(value, str) and value}
    )
    if not wanted:
        return {}
    sql = """
        SELECT DISTINCT ON (upper(i.short_id)) upper(i.short_id) AS short_id,
               i.id::text AS id
        FROM error_issues i
        WHERE i.provider = :provider AND upper(i.short_id) = ANY(:short_ids)
        ORDER BY upper(i.short_id), i.last_seen DESC NULLS LAST, i.id
    """
    params = {"provider": provider, "short_ids": wanted}

    def _impl(current: Session) -> dict[str, str]:
        rows = current.execute(text(sql), params).mappings().all()
        return {str(row["short_id"]): str(row["id"]) for row in rows}

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def _summary_sql(extra_columns: str = "") -> str:
    return f"""
        WITH open_issues AS (
            SELECT i.id, i.short_id, i.title, i.service, i.crate_score, i.first_seen,
                   i.last_seen, i.substatus, {_CRITICAL} AS critical,
                   (i.digest_hash IS NOT NULL AND triage.classification IS NULL)
                       AS untriaged
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
            (SELECT count(*) FILTER (WHERE untriaged) FROM open_issues) AS untriaged,
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
        "untriaged": int(row["untriaged"]),
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


def release_candidates(
    external_ids: Sequence[str],
    *,
    exclude: Sequence[str] = (),
    limit: int,
    provider: str = "sentry",
    session: Session | None = None,
) -> list[dict[str, str]]:
    """Listed open issues whose first release is unknown, highest score first.

    Only issues whose latest event carries a release qualify: Sentry knows a first
    release for those, so one issue detail fills it. `exclude` holds the issues
    already asked without an answer.
    """
    ids = list(dict.fromkeys(str(value) for value in external_ids))
    if not ids or limit <= 0:
        return []
    params = {
        "ids": ids,
        "exclude": [str(value) for value in exclude],
        "provider": provider,
        "limit": int(limit),
    }

    def _impl(current: Session) -> list[dict[str, str]]:
        rows = current.execute(
            text(
                """
                SELECT id::text AS id, external_id
                FROM error_issues
                WHERE provider = :provider
                  AND status = 'unresolved'
                  AND first_release IS NULL
                  AND COALESCE(digest ->> 'release', '') <> ''
                  AND external_id = ANY(CAST(:ids AS text[]))
                  AND NOT (external_id = ANY(CAST(:exclude AS text[])))
                ORDER BY crate_score DESC, last_seen DESC NULLS LAST, external_id ASC
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


AUTO_TRIAGE_SUBSTATUSES = ("new", "regressed", "escalating")
AUTO_TRIAGE_WINDOW = timedelta(hours=24)

_AUTO_TRIAGE_QUEUED_SQL = """
    SELECT count(*) FROM error_issues WHERE auto_triage_at >= :since
"""
# Open issues whose current digest has no triage, that are new, regressed or
# escalating or whose digest changed since an earlier triage or automatic attempt.
# A digest automatic triage already queued is never queued again, and an issue is
# queued at most once per window, so a failure or a flapping digest cannot loop.
_AUTO_TRIAGE_CANDIDATES_SQL = """
    SELECT i.id::text AS id, i.digest_hash, i.crate_score
    FROM error_issues i
    WHERE i.status = 'unresolved'
      AND i.digest_hash IS NOT NULL
      AND i.auto_triage_hash IS DISTINCT FROM i.digest_hash
      AND (i.auto_triage_at IS NULL OR i.auto_triage_at < :since)
      AND NOT EXISTS (
          SELECT 1
          FROM error_issue_triage t
          WHERE t.issue_id = i.id AND t.kind = 'triage' AND t.digest_hash = i.digest_hash
      )
      AND (
          i.substatus = ANY(CAST(:substatuses AS text[]))
          OR i.auto_triage_hash IS NOT NULL
          OR EXISTS (SELECT 1 FROM error_issue_triage t WHERE t.issue_id = i.id)
      )
    ORDER BY i.crate_score DESC, i.last_seen DESC NULLS LAST, i.id
    LIMIT :limit
"""


def auto_triage_plan(
    *,
    daily_max: int,
    now: datetime | None = None,
    session: Session | None = None,
) -> dict[str, Any]:
    """What automatic triage may queue now: the issues queued in the last 24 hours
    and, highest score first, the candidates that still fit under `daily_max`."""
    since = (now or datetime.now(timezone.utc)) - AUTO_TRIAGE_WINDOW

    def _impl(current: Session) -> dict[str, Any]:
        queued = int(
            current.execute(
                text(_AUTO_TRIAGE_QUEUED_SQL), {"since": since}
            ).scalar_one()
        )
        room = max(0, int(daily_max) - queued)
        candidates: list[dict[str, Any]] = []
        if room:
            rows = current.execute(
                text(_AUTO_TRIAGE_CANDIDATES_SQL),
                {
                    "since": since,
                    "substatuses": list(AUTO_TRIAGE_SUBSTATUSES),
                    "limit": room,
                },
            ).mappings()
            candidates = [dict(row) for row in rows]
        return {"queued_24h": queued, "room": room, "candidates": candidates}

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


MAX_DUPLICATE_CANDIDATES = 10

# One duplicate candidate, reduced to what the prompt may show plus what ranks it.
_CANDIDATE_OBJECT = """
    json_build_object(
        'id', c.id::text,
        'short_id', c.short_id,
        'service', c.service,
        'level', c.level,
        'status', c.status,
        'substatus', c.substatus,
        'last_seen', c.last_seen,
        'events_24h', c.events_24h,
        'same_group', c.same_group,
        'exception', c.exception,
        'top_frame', c.top_frame,
        'message', c.message,
        'crate_score', c.crate_score
    )
"""
# Same group first, then open issues, by score, most recently seen, id.
_CANDIDATE_ORDER = """
    COALESCE(c.group_key = t.group_key, FALSE) DESC,
    (c.status = 'unresolved') DESC,
    c.crate_score DESC,
    c.last_seen DESC NULLS LAST,
    c.id
"""
_CANDIDATE_MATCH = """
    c.digest IS NOT NULL
    AND (
        (t.group_key IS NOT NULL AND c.group_key = t.group_key)
        OR (
            t.exception_type IS NOT NULL
            AND c.digest -> 'exceptions' -> -1 ->> 'type' = t.exception_type
        )
    )
"""
_CANDIDATE_COLUMNS = """
    c.id, c.short_id, c.service, c.level, c.status, c.substatus,
    c.last_seen, c.events_24h, c.crate_score,
    COALESCE(c.group_key = t.group_key, FALSE) AS same_group,
    c.digest -> 'exceptions' -> -1 AS exception,
    c.digest -> 'frames' -> -1 AS top_frame,
    c.digest ->> 'message' AS message
"""

_TRIAGE_INPUT_SQL = f"""
    WITH target AS (
        SELECT i.id, i.external_id, i.short_id, i.service, i.level, i.status,
               i.substatus,
               i.issue_category, i.events_24h, i.users_24h, i.events_total,
               i.users_total, i.first_seen, i.last_seen, i.first_release,
               i.last_release, i.crate_score, i.group_key, i.digest, i.digest_hash,
               i.digest -> 'exceptions' -> -1 ->> 'type' AS exception_type
        FROM error_issues i
        WHERE i.id = CAST(:id AS uuid)
    ),
    candidates AS (
        SELECT {_CANDIDATE_COLUMNS},
               row_number() OVER (ORDER BY {_CANDIDATE_ORDER}) AS rank
        FROM error_issues c
        CROSS JOIN target t
        WHERE c.id <> t.id AND {_CANDIDATE_MATCH}
    )
    SELECT t.id::text AS id, t.external_id, t.short_id, t.service, t.level, t.status,
           t.substatus,
           t.issue_category, t.events_24h, t.users_24h, t.events_total,
           t.users_total, t.first_seen, t.last_seen, t.first_release,
           t.last_release, t.crate_score, t.group_key, t.digest, t.digest_hash,
           COALESCE(
               (
                   SELECT json_agg({_CANDIDATE_OBJECT} ORDER BY c.rank)
                   FROM candidates c
                   WHERE c.rank <= :candidate_limit
               ),
               '[]'::json
           ) AS candidates,
           (
               SELECT json_build_object(
                   'classification', tr.classification,
                   'severity', tr.severity,
                   'summary', tr.summary,
                   'hypothesis', tr.hypothesis,
                   'confidence', tr.confidence
               )
               FROM error_issue_triage tr
               WHERE tr.issue_id = t.id
                 AND tr.kind = 'triage'
                 AND tr.digest_hash = t.digest_hash
               ORDER BY tr.created_at DESC
               LIMIT 1
           ) AS current_triage,
           COALESCE(
               (
                   SELECT array_agg(DISTINCT tr.kind ORDER BY tr.kind)
                   FROM error_issue_triage tr
                   WHERE tr.issue_id = t.id AND tr.digest_hash = t.digest_hash
               ),
               ARRAY[]::text[]
           ) AS done_kinds
    FROM target t
"""


def get_triage_input(
    issue_id: str,
    *,
    candidate_limit: int = MAX_DUPLICATE_CANDIDATES,
    session: Session | None = None,
) -> dict[str, Any] | None:
    """What a triage or investigation of an issue reads, in one query.

    The issue's stats and digest; at most `candidate_limit` duplicate candidates
    (same `group_key` or same main exception type, same group first, then open
    issues by score), each reduced to its main exception and innermost app frame;
    the current digest's latest triage; and the kinds already stored for it.
    """
    valid_id = _valid_uuid(issue_id)
    if valid_id is None:
        return None
    limit = max(0, min(int(candidate_limit), MAX_DUPLICATE_CANDIDATES))
    params = {"id": valid_id, "candidate_limit": limit}

    def _impl(current: Session) -> dict[str, Any] | None:
        row = current.execute(text(_TRIAGE_INPUT_SQL), params).mappings().first()
        if row is None:
            return None
        data = dict(row)
        data["digest"] = coerce_json(data["digest"])
        data["candidates"] = list(coerce_json(data["candidates"]) or [])
        data["current_triage"] = coerce_json(data["current_triage"])
        data["done_kinds"] = list(data["done_kinds"] or [])
        return data

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


_DUPLICATE_CANDIDATES_SQL = f"""
    WITH target AS (
        SELECT t.position, t.external_id, t.group_key, t.exception_type
        FROM unnest(
            CAST(:positions AS integer[]),
            CAST(:external_ids AS text[]),
            CAST(:group_keys AS text[]),
            CAST(:exception_types AS text[])
        ) AS t(position, external_id, group_key, exception_type)
    ),
    candidates AS (
        SELECT t.position, {_CANDIDATE_COLUMNS},
               row_number() OVER (
                   PARTITION BY t.position ORDER BY {_CANDIDATE_ORDER}
               ) AS rank
        FROM target t
        JOIN error_issues c
          ON c.external_id IS DISTINCT FROM t.external_id AND {_CANDIDATE_MATCH}
    )
    SELECT c.position, json_agg({_CANDIDATE_OBJECT} ORDER BY c.rank) AS candidates
    FROM candidates c
    WHERE c.rank <= :candidate_limit
    GROUP BY c.position
"""


def duplicate_candidates(
    targets: Sequence[Mapping[str, Any]],
    *,
    candidate_limit: int = MAX_DUPLICATE_CANDIDATES,
    session: Session | None = None,
) -> list[list[dict[str, Any]]]:
    """The inbox's duplicate candidates of issues that are not rows, in one query.

    Each target is `{"external_id", "group_key", "exception_type"}` of a digest
    built elsewhere (the triage evaluation builds some from Sentry in memory). The
    candidates are the ones `get_triage_input` would list for an issue with that
    digest: same `group_key` or same main exception type, ranked the same way and
    in the same shape, never the target's own row. One list per target, in order.
    """
    if not targets:
        return []
    limit = max(0, min(int(candidate_limit), MAX_DUPLICATE_CANDIDATES))
    params = {
        "positions": list(range(len(targets))),
        "external_ids": [_text_or_none(t.get("external_id")) for t in targets],
        "group_keys": [_text_or_none(t.get("group_key")) for t in targets],
        "exception_types": [_text_or_none(t.get("exception_type")) for t in targets],
        "candidate_limit": limit,
    }

    def _impl(current: Session) -> list[list[dict[str, Any]]]:
        found: list[list[dict[str, Any]]] = [[] for _ in targets]
        rows = current.execute(text(_DUPLICATE_CANDIDATES_SQL), params).mappings()
        for row in rows:
            found[int(row["position"])] = list(coerce_json(row["candidates"]) or [])
        return found

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def _text_or_none(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None


__all__ = [
    "AUTO_TRIAGE_SUBSTATUSES",
    "AUTO_TRIAGE_WINDOW",
    "LIST_STATUSES",
    "MAX_DUPLICATE_CANDIDATES",
    "MAX_LIST_LIMIT",
    "auto_triage_plan",
    "duplicate_candidates",
    "get_issue",
    "get_issue_by_short_id",
    "get_triage_input",
    "inbox_overview",
    "inbox_state",
    "issue_ids_by_short_id",
    "list_issues",
    "open_ids_not_in",
    "release_candidates",
    "summary",
    "sync_state",
    "untriaged_open",
]

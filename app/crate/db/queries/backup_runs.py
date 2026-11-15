"""Reads of backup runs (admin backups, BK1)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.tx import read_scope

_COLUMNS = """
    id::text AS id, kind, status, task_id, policy_id::text AS policy_id,
    destination_id::text AS destination_id, started_at, finished_at, path,
    bytes, checksum, snapshot_id, error, details
"""
MAX_LIST_LIMIT = 200


def get_backup_run(
    run_id: str, *, session: Session | None = None
) -> dict[str, Any] | None:
    try:
        valid = str(uuid.UUID(str(run_id)))
    except ValueError:
        return None

    def _impl(current: Session) -> dict[str, Any] | None:
        row = (
            current.execute(
                text(
                    f"SELECT {_COLUMNS} FROM backup_runs WHERE id = CAST(:id AS uuid)"
                ),
                {"id": valid},
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def list_backup_runs(
    *,
    kind: str | None = None,
    status: str | None = None,
    destination_id: str | None = None,
    policy_id: str | None = None,
    since: datetime | None = None,
    before: datetime | None = None,
    limit: int = 50,
    offset: int = 0,
    session: Session | None = None,
) -> list[dict[str, Any]]:
    """Newest first, optionally of one kind, status, destination, policy or period."""
    bounded = max(1, min(int(limit), MAX_LIST_LIMIT))

    def _impl(current: Session) -> list[dict[str, Any]]:
        rows = current.execute(
            text(
                f"""
                SELECT {_COLUMNS} FROM backup_runs
                WHERE (CAST(:kind AS text) IS NULL OR kind = :kind)
                  AND (CAST(:status AS text) IS NULL OR status = :status)
                  AND (CAST(:destination_id AS uuid) IS NULL
                       OR destination_id = CAST(:destination_id AS uuid))
                  AND (CAST(:policy_id AS uuid) IS NULL
                       OR policy_id = CAST(:policy_id AS uuid))
                  AND (CAST(:since AS timestamptz) IS NULL
                       OR started_at >= CAST(:since AS timestamptz))
                  AND (CAST(:before AS timestamptz) IS NULL
                       OR started_at < CAST(:before AS timestamptz))
                ORDER BY started_at DESC, id DESC
                LIMIT :limit OFFSET :offset
                """
            ),
            {
                "kind": kind,
                "status": status,
                "destination_id": destination_id,
                "policy_id": policy_id,
                "since": since,
                "before": before,
                "limit": bounded,
                "offset": max(0, int(offset)),
            },
        ).mappings()
        return [dict(row) for row in rows]

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def latest_successful_dump(*, session: Session | None = None) -> dict[str, Any] | None:
    runs = list_backup_runs(kind="dump", status="succeeded", limit=1, session=session)
    return runs[0] if runs else None


LOCAL_RUN_KINDS = ("dump", "local_retention")


def latest_local_runs(*, session: Session | None = None) -> dict[str, dict[str, Any]]:
    """The latest run of each local kind (``dump``, ``local_retention``), and the
    latest successful one: ``{"dump": run, "dump_succeeded": run, ...}``."""

    def _impl(current: Session) -> dict[str, dict[str, Any]]:
        rows = current.execute(
            text(
                f"""
                SELECT * FROM (
                    SELECT DISTINCT ON (kind) 'latest' AS slot, {_COLUMNS}
                    FROM backup_runs
                    WHERE kind = ANY(:kinds) AND destination_id IS NULL
                    ORDER BY kind, started_at DESC, id DESC
                ) latest
                UNION ALL
                SELECT * FROM (
                    SELECT DISTINCT ON (kind) 'succeeded' AS slot, {_COLUMNS}
                    FROM backup_runs
                    WHERE kind = ANY(:kinds) AND destination_id IS NULL
                      AND status = 'succeeded'
                    ORDER BY kind, started_at DESC, id DESC
                ) succeeded
                """
            ),
            {"kinds": list(LOCAL_RUN_KINDS)},
        ).mappings()
        out: dict[str, dict[str, Any]] = {}
        for row in rows:
            run = dict(row)
            slot = run.pop("slot")
            out[run["kind"] if slot == "latest" else f"{run['kind']}_succeeded"] = run
        return out

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def latest_destination_runs(
    *, session: Session | None = None
) -> dict[str, dict[str, dict[str, Any]]]:
    """Per destination: the latest run of each kind, and the latest successful one.

    ``{destination_id: {"offsite": run, "offsite_succeeded": run, "verify": ...}}``.
    One query over the runs index, for the overview and the scheduler.
    """

    def _impl(current: Session) -> dict[str, dict[str, dict[str, Any]]]:
        rows = current.execute(
            text(
                f"""
                SELECT * FROM (
                    SELECT DISTINCT ON (destination_id, kind)
                        'latest' AS slot, {_COLUMNS}
                    FROM backup_runs
                    WHERE destination_id IS NOT NULL
                    ORDER BY destination_id, kind, started_at DESC, id DESC
                ) latest
                UNION ALL
                SELECT * FROM (
                    SELECT DISTINCT ON (destination_id, kind)
                        'succeeded' AS slot, {_COLUMNS}
                    FROM backup_runs
                    WHERE destination_id IS NOT NULL AND status = 'succeeded'
                    ORDER BY destination_id, kind, started_at DESC, id DESC
                ) succeeded
                """
            )
        ).mappings()
        out: dict[str, dict[str, dict[str, Any]]] = {}
        for row in rows:
            run = dict(row)
            slot = run.pop("slot")
            key = run["kind"] if slot == "latest" else f"{run['kind']}_succeeded"
            out.setdefault(run["destination_id"], {})[key] = run
        return out

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def latest_tier_copies(
    *, session: Session | None = None
) -> dict[str, dict[str, datetime]]:
    """Per destination, when the last good off-site copy of each tier started.

    The tiers are the copy's tags (``details.tags``), so a copy that stood for the
    daily and the weekly tier counts for both.
    """

    def _impl(current: Session) -> dict[str, dict[str, datetime]]:
        rows = current.execute(
            text(
                """
                SELECT destination_id::text AS destination_id, tier,
                       max(started_at) AS started_at
                FROM backup_runs,
                     jsonb_array_elements_text(
                         CASE WHEN jsonb_typeof(details -> 'tags') = 'array'
                              THEN details -> 'tags' ELSE '[]'::jsonb END
                     ) AS tier
                WHERE kind = 'offsite' AND status = 'succeeded'
                  AND destination_id IS NOT NULL
                  AND tier IN ('daily', 'weekly', 'monthly')
                GROUP BY destination_id, tier
                """
            )
        ).mappings()
        out: dict[str, dict[str, datetime]] = {}
        for row in rows:
            out.setdefault(row["destination_id"], {})[row["tier"]] = row["started_at"]
        return out

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def repository_size_series(
    *, days: int = 90, session: Session | None = None
) -> dict[str, list[dict[str, Any]]]:
    """Per destination, the repository size after the last good copy of each day."""

    def _impl(current: Session) -> dict[str, list[dict[str, Any]]]:
        rows = current.execute(
            text(
                """
                SELECT DISTINCT ON (destination_id, day)
                    destination_id::text AS destination_id, day,
                    (details ->> 'repository_bytes')::bigint AS bytes
                FROM (
                    SELECT destination_id, details, started_at,
                           (started_at AT TIME ZONE 'UTC')::date AS day
                    FROM backup_runs
                    WHERE kind = 'offsite' AND status = 'succeeded'
                      AND destination_id IS NOT NULL
                      AND started_at >= now() - make_interval(days => :days)
                      AND jsonb_typeof(details -> 'repository_bytes') = 'number'
                ) copies
                ORDER BY destination_id, day, started_at DESC
                """
            ),
            {"days": max(1, min(int(days), 366))},
        ).mappings()
        out: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            out.setdefault(row["destination_id"], []).append(
                {"day": row["day"].isoformat(), "bytes": int(row["bytes"])}
            )
        return out

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def count_backup_runs(
    *,
    kind: str | None = None,
    status: str | None = None,
    destination_id: str | None = None,
    policy_id: str | None = None,
    since: datetime | None = None,
    before: datetime | None = None,
    session: Session | None = None,
) -> int:
    def _impl(current: Session) -> int:
        return int(
            current.execute(
                text(
                    """
                    SELECT count(*) FROM backup_runs
                    WHERE (CAST(:kind AS text) IS NULL OR kind = :kind)
                      AND (CAST(:status AS text) IS NULL OR status = :status)
                      AND (CAST(:destination_id AS uuid) IS NULL
                           OR destination_id = CAST(:destination_id AS uuid))
                      AND (CAST(:policy_id AS uuid) IS NULL
                           OR policy_id = CAST(:policy_id AS uuid))
                      AND (CAST(:since AS timestamptz) IS NULL
                           OR started_at >= CAST(:since AS timestamptz))
                      AND (CAST(:before AS timestamptz) IS NULL
                           OR started_at < CAST(:before AS timestamptz))
                    """
                ),
                {
                    "kind": kind,
                    "status": status,
                    "destination_id": destination_id,
                    "policy_id": policy_id,
                    "since": since,
                    "before": before,
                },
            ).scalar_one()
        )

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


__all__ = [
    "LOCAL_RUN_KINDS",
    "count_backup_runs",
    "repository_size_series",
    "get_backup_run",
    "latest_tier_copies",
    "latest_destination_runs",
    "latest_local_runs",
    "latest_successful_dump",
    "list_backup_runs",
]

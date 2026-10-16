"""Bounded, read-only operational evidence for service principals."""

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.tx import read_scope

JOB_FIELDS = """id, type, status, pool, priority, created_at, updated_at,
    started_at, heartbeat_at, retry_count, max_retries, parent_task_id"""


def read_status_evidence(*, session: Session | None = None) -> dict:
    def _impl(current):
        current.execute(text("SET LOCAL statement_timeout = '5s'"))
        return dict(
            current.execute(
                text("""
            WITH snapshots AS (
                SELECT scope, subject_key, version, built_at, source_seq,
                       invalidated_at, jsonb_build_object('stats', (
                           SELECT jsonb_object_agg(k, v) FROM jsonb_each(payload_json->'stats') AS s(k,v)
                           WHERE k IN ('artists','albums','tracks','total_size_gb','last_scan','analyzed_tracks')
                       )) AS payload_json
                FROM ui_snapshots WHERE scope = 'ops' AND subject_key = 'dashboard'
            ), runtime AS (
                SELECT key, updated_at, (
                    SELECT jsonb_object_agg(k, v) FROM jsonb_each(payload_json) AS r(k,v)
                    WHERE k IN ('engine','running_count','pending_count','total',
                                'analysis_done','analysis_pending','analysis_active','analysis_failed',
                                'bliss_done','bliss_pending','bliss_active','bliss_failed',
                                'fingerprint_done','fingerprint_pending','chromaprint_available','fingerprint_strategy')
                ) AS payload_json FROM ops_runtime_state
                WHERE key IN ('worker_live', 'analysis_status')
            )
            SELECT (SELECT jsonb_agg(to_jsonb(snapshots)) FROM snapshots) AS snapshots,
                   (SELECT jsonb_agg(to_jsonb(runtime)) FROM runtime) AS runtime
        """)
            )
            .mappings()
            .one()
        )

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def read_jobs(
    *, states=None, types=None, before=None, limit=20, session: Session | None = None
) -> list[dict]:
    clauses = []
    params = {"limit": min(max(limit, 1), 101)}
    if states:
        clauses.append("status = ANY(:states)")
        params["states"] = states
    if types:
        clauses.append("type = ANY(:types)")
        params["types"] = types
    if before:
        clauses.append("(created_at, id) < (CAST(:created AS timestamptz), :id)")
        params.update(created=before[0], id=before[1])
    where = "WHERE " + " AND ".join(clauses) if clauses else ""

    def _impl(current):
        current.execute(text("SET LOCAL statement_timeout = '5s'"))
        return [
            dict(row)
            for row in current.execute(
                text(
                    f"SELECT {JOB_FIELDS} FROM tasks {where} ORDER BY created_at DESC, id DESC LIMIT :limit"
                ),
                params,
            ).mappings()
        ]

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def read_job(job_id: str, *, session: Session | None = None) -> dict | None:
    def _impl(current):
        current.execute(text("SET LOCAL statement_timeout = '5s'"))
        row = (
            current.execute(
                text(f"""
            SELECT {JOB_FIELDS}, worker_id, max_duration_sec,
                   LEFT(error, 2048) AS error, LEFT(progress, 2048) AS progress,
                   LEFT(result_json ->> 'status', 80) AS result_status
            FROM tasks WHERE id = :id
        """),
                {"id": job_id},
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def read_worker_logs(
    *, since, until, task_id=None, limit=20, session: Session | None = None
) -> list[dict]:
    task_clause = "AND task_id = :task_id" if task_id else ""

    def _impl(current):
        current.execute(text("SET LOCAL statement_timeout = '5s'"))
        return [
            dict(row)
            for row in current.execute(
                text(f"""
            SELECT id, worker_id, task_id, level, category,
                   LEFT(message, 2048) AS message, created_at
            FROM worker_logs WHERE created_at >= :since AND created_at <= :until
            {task_clause} ORDER BY created_at DESC, id DESC LIMIT :limit
        """),
                {
                    "since": since,
                    "until": until,
                    "task_id": task_id,
                    "limit": min(max(limit, 1), 101),
                },
            ).mappings()
        ]

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


__all__ = ["read_job", "read_jobs", "read_status_evidence", "read_worker_logs"]

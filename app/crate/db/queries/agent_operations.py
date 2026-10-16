"""Bounded, read-only operational evidence for service principals."""

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.agent_operation_catalog import interrupted_operation_result
from crate.db.tx import read_scope

JOB_FIELDS = """id, type, status, pool, priority, created_at, updated_at,
    started_at, heartbeat_at, retry_count, max_retries, parent_task_id,
    origin, actor_user_id, origin_principal_id, retry_of, retry_root, retry_depth,
    schedule_name, cancellation_requested_at, cancellation_acknowledged_at"""


def _effects_sql(alias):
    fields = (
        "effects",
        "applied",
        "remaining",
        "processed",
        "analytics_cache_updated",
        "artists_scanned",
        "scanned_tracks",
        "updated",
        "failed",
    )
    entries = []
    for field in fields:
        value = f"COALESCE({alias}.result_json->'execution'->'{field}',{alias}.result_json->'{field}')"
        entries.append(
            f"'{field}',CASE WHEN jsonb_typeof({value}) IN ('number','boolean') THEN {value} WHEN jsonb_typeof({value})='string' THEN to_jsonb(LEFT({value}#>>'{{}}',256)) END"
        )
    return "jsonb_strip_nulls(jsonb_build_object(" + ",".join(entries) + "))"


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
                   {_effects_sql("tasks")} AS partial_effects,
                   LEFT(error, 2048) AS error, LEFT(progress, 2048) AS progress,
                   LEFT(result_json ->> 'status', 80) AS result_status,
                   LEFT(result_json -> 'execution' ->> 'status', 80) AS execution_status,
                   LEFT(result_json -> 'verification' ->> 'status', 80) AS verification_status,
                   LEFT(result_json -> 'projection' ->> 'status', 80) AS projection_status,
                   LEFT(result_json -> 'execution' ->> 'issue_id', 32) AS issue_id,
                   LEFT(result_json -> 'execution' ->> 'observation_id', 128) AS observation_id,
                   LEFT(result_json -> 'execution' ->> 'plan_id', 128) AS plan_id,
                   LEFT(result_json -> 'execution' ->> 'artist_uid', 128) AS artist_uid,
                   LEFT(COALESCE(result_json -> 'execution' ->> 'error_code',
                                 result_json ->> 'error_code'), 80) AS error_code,
                   (SELECT jsonb_build_object('operation', operation,
                              'effect_started', effect_started_at IS NOT NULL,
                              'unrecorded', result IS NULL)
                    FROM agent_jobs WHERE task_id=tasks.id) AS agent_execution,
                   (SELECT jsonb_agg(to_jsonb(c)) FROM (
                      SELECT id,type,status,cancellation_requested_at,cancellation_acknowledged_at,
                        {_effects_sql("child")} AS partial_effects,
                        LEFT(result_json->'execution'->>'status',80) AS execution_status,
                        LEFT(result_json->'verification'->>'status',80) AS verification_status
                      FROM tasks child WHERE parent_task_id=tasks.id ORDER BY created_at,id LIMIT 101) c) AS children
            FROM tasks WHERE id = :id
        """),
                {"id": job_id},
            )
            .mappings()
            .first()
        )
        if row is None:
            return None
        job = dict(row)
        children = job.get("children") or []
        job["children_truncated"] = len(children) > 100
        job["children"] = children[:100]
        job["cancellation_requested"] = job["cancellation_requested_at"] is not None
        evidence = job.pop("agent_execution")
        if evidence and evidence["unrecorded"]:
            result = interrupted_operation_result(
                evidence["operation"],
                job["status"],
                True if evidence["effect_started"] else None,
                None,
            )
            if result is not None:
                job["execution_status"] = result["execution"]["status"]
                job["verification_status"] = result["verification"]["status"]
                job["error_code"] = result["execution"]["error_code"]
        return job

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


__all__ = [
    "read_job",
    "read_jobs",
    "read_status_evidence",
    "read_worker_logs",
    "read_audit_rows",
]


def read_audit_rows(*, since, until, task_id=None, before=None, limit=20, session=None):
    def _read(current):
        current.execute(text("SET LOCAL statement_timeout='5s'"))
        clauses = ["timestamp>=:since", "timestamp<=:until"]
        params = {"since": since, "until": until, "limit": min(max(limit, 1), 101)}
        if task_id:
            clauses.append("(task_id=:task OR details_json->>'job_id'=:task)")
            params["task"] = task_id
        if before:
            if not isinstance(before, list) or len(before) != 2:
                raise ValueError("Invalid audit cursor")
            clauses.append(
                "(timestamp,id)<(CAST(:before_time AS timestamptz),CAST(:before_id AS integer))"
            )
            params.update(before_time=before[0], before_id=before[1])
        return [
            dict(row)
            for row in current.execute(
                text(
                    """SELECT id,timestamp,LEFT(action,128) AS action,
            LEFT(target_type,128) AS target_type,LEFT(target_name,256) AS target_name,
            user_id,task_id,
            jsonb_build_object('principal_id',details_json->>'principal_id','actor_user_id',details_json->>'actor_user_id',
              'job_id',details_json->>'job_id','plan_id',details_json->>'plan_id',
              'tool',LEFT(details_json->>'tool',128),'event',LEFT(details_json->>'event',128)) AS details
            FROM audit_log WHERE """
                    + " AND ".join(clauses)
                    + " ORDER BY timestamp DESC,id DESC LIMIT :limit"
                ),
                params,
            ).mappings()
        ]

    if session is not None:
        return _read(session)
    with read_scope() as current:
        return _read(current)

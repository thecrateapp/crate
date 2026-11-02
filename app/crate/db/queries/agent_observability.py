"""Bounded persisted MCP evidence; never builds a snapshot or initiates work."""

from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.tx import read_scope
from crate.task_registry import TASK_TYPES

PIPELINES = (
    "import",
    "enrichment",
    "analysis",
    "bliss",
    "playback",
    "projector",
    "federation",
    "acquisition",
)
PIPELINE_TASK_TYPES = {
    name: tuple(
        sorted(
            task
            for task, info in TASK_TYPES.items()
            if (
                name in {"enrichment", "playback", "federation", "acquisition"}
                and info.category == name
            )
            or (
                name == "import"
                and task
                in {
                    "import_queue_item",
                    "import_queue_all",
                    "process_new_content",
                    "library_sync",
                }
            )
            or (
                name == "analysis"
                and info.category == "analysis"
                and "bliss" not in task
            )
            or (name == "bliss" and "bliss" in task)
        )
    )
    for name in PIPELINES
}


def read_observation_evidence(
    *,
    track_uids=None,
    pipeline: str | None = None,
    alerts: bool = False,
    session: Session | None = None,
) -> dict:
    """One read transaction, fixed keys, at most 50 exact tracks and 21 rows per sample."""
    if pipeline is not None and pipeline not in PIPELINES:
        raise ValueError("Unknown pipeline")
    if track_uids is not None and (
        not isinstance(track_uids, list) or len(track_uids) > 50
    ):
        raise ValueError("At most 50 exact track UUIDs")
    uids = list(dict.fromkeys(str(UUID(value)) for value in (track_uids or [])))
    task_types = (
        sorted({task for tasks in PIPELINE_TASK_TYPES.values() for task in tasks})
        if pipeline is None
        else list(PIPELINE_TASK_TYPES[pipeline])
    )

    def _impl(current):
        current.execute(text("SET LOCAL statement_timeout = '5s'"))
        return dict(
            current.execute(
                text("""
            WITH runtime AS (
                SELECT key AS source, updated_at AS observed_at,
                    octet_length(payload_json::text) > 32768 AS oversized,
                    CASE WHEN octet_length(payload_json::text) <= 32768 THEN payload_json END AS payload
                FROM (SELECT key,updated_at,(SELECT jsonb_object_agg(k,v) FROM jsonb_each(payload_json) AS fields(k,v) WHERE k=ANY(:fields)) AS payload_json FROM ops_runtime_state) projected WHERE key IN (
                    'worker_live','analysis_status','imports_pending','health',
                    'smart_mix:coverage','smart_mix:backfill_campaign')
            ), snapshots AS (
                SELECT scope AS source, built_at AS observed_at, invalidated_at,
                    version, source_seq,
                    octet_length(selected::text) > 32768 AS oversized,
                    CASE WHEN octet_length(selected::text) <= 32768 THEN selected END AS payload
                FROM (
                    SELECT scope, built_at, invalidated_at, version, source_seq,
                        CASE WHEN scope='ops:stack' THEN payload_json->'stack'
                        ELSE jsonb_build_object('stats',payload_json->'stats','eventing',payload_json->'eventing') END AS selected
                    FROM ui_snapshots WHERE (scope='ops' AND subject_key='dashboard')
                        OR (scope='ops:stack' AND subject_key='global')
                ) s
            ), profiles AS (
                SELECT t.entity_uid::text AS track_uid, p.profile_version,
                    LEFT(p.analyzer_version,128) AS analyzer_version,
                    LEFT(p.profile_revision,128) AS profile_revision,
                    LEFT(p.source_revision,128) AS source_revision,
                    LEFT(p.quality,32) AS quality, p.analyzed_at, p.source_stale_at,
                    LEFT(s.state,32) AS processing_state, s.attempts,
                    LEFT(s.target_generation,128) AS target_generation,
                    s.completed_at,
                    s.updated_at AS processing_updated_at
                FROM library_tracks t LEFT JOIN track_mix_profiles p ON p.track_id=t.id
                LEFT JOIN track_processing_state s ON s.track_id=t.id AND s.pipeline='smart_mix'
                WHERE t.entity_uid = ANY(CAST(:uids AS uuid[])) LIMIT 50
            ), jobs AS (
                SELECT id, LEFT(type,128) AS type, LEFT(status,32) AS status,
                    created_at, updated_at, started_at, heartbeat_at
                FROM tasks WHERE type=ANY(:types) AND created_at >= NOW()-INTERVAL '24 hours'
                ORDER BY created_at DESC,id DESC LIMIT 21
            ), failed AS (
                SELECT id, LEFT(type,128) AS type, updated_at,
                    LEFT(COALESCE(result_json->'execution'->>'error_code',
                                  result_json->>'error_code'),80) AS error_code
                FROM tasks WHERE :alerts AND status='failed'
                    AND cancellation_requested_at IS NULL
                    AND updated_at >= NOW()-INTERVAL '24 hours'
                ORDER BY updated_at DESC,id DESC LIMIT 21
            ), releases AS (
                SELECT id::text AS id, LEFT(artist_name,128) AS artist,
                    LEFT(album_title,128) AS album, LEFT(year,8) AS year,
                    release_date, LEFT(release_type,32) AS release_type,
                    LEFT(status,32) AS status, detected_at
                FROM new_releases WHERE :alerts
                    AND detected_at >= NOW()-INTERVAL '7 days'
                ORDER BY detected_at DESC,id DESC LIMIT 21
            )
            SELECT (SELECT jsonb_agg(to_jsonb(r)) FROM runtime r) AS runtime,
                (SELECT jsonb_agg(to_jsonb(s)) FROM snapshots s) AS snapshots,
                (SELECT jsonb_agg(to_jsonb(p)) FROM profiles p) AS profiles,
                (SELECT jsonb_agg(to_jsonb(j)) FROM jobs j) AS jobs,
                (SELECT jsonb_agg(to_jsonb(f)) FROM failed f) AS failed_tasks,
                (SELECT jsonb_agg(to_jsonb(n)) FROM releases n) AS new_releases,
                (SELECT LEFT(version_num,128) FROM alembic_version LIMIT 1) AS database_schema_version,
                NOW() AS queried_at
        """),
                {
                    "uids": uids,
                    "types": task_types,
                    "alerts": bool(alerts),
                    "fields": [
                        "engine",
                        "running_count",
                        "pending_count",
                        "analysis_done",
                        "analysis_pending",
                        "analysis_active",
                        "analysis_failed",
                        "bliss_done",
                        "bliss_pending",
                        "bliss_active",
                        "bliss_failed",
                        "total",
                        "count",
                        "profile_version",
                        "analyzer_version",
                        "total_tracks",
                        "current_profiles",
                        "stale_profiles",
                        "outdated_profiles",
                        "source_changed_profiles",
                        "missing_profiles",
                        "coverage_percent",
                        "quality",
                        "current_quality",
                        "processing",
                        "versions",
                        "target",
                        "status",
                        "batch_size",
                        "max_attempts",
                        "batches",
                        "claimed",
                        "sequence",
                        "score",
                        "breaches",
                        "schema_version",
                        "availability",
                        "source",
                        "coverage",
                        "observed_at",
                        "inputs",
                        "collector_local",
                    ],
                },
            )
            .mappings()
            .one()
        )

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


__all__ = ["PIPELINES", "PIPELINE_TASK_TYPES", "read_observation_evidence"]

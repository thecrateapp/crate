"""Local library evidence; never reads track rows or starts health checks."""

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.tx import read_scope


def read_health_snapshot(*, session: Session | None = None) -> dict | None:
    def _impl(current):
        current.execute(text("SET LOCAL statement_timeout = '5s'"))
        row = (
            current.execute(
                text("""
            SELECT scope, subject_key, version, built_at, source_seq,
                   invalidated_at, payload_json
            FROM ui_snapshots WHERE scope = 'ops:health' AND subject_key = 'agent:diagnostics:v1'
        """)
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def read_artist_evidence(
    *, artist_uid=None, name=None, limit=20, session: Session | None = None
) -> dict:
    if artist_uid:
        condition = "entity_uid = CAST(:uid AS uuid)"
    else:
        condition = (
            "LOWER(name) = LOWER(:name)"
            if len(name or "") < 3
            else "name ILIKE :pattern ESCAPE '\\'"
        )
    escaped = (name or "").replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")

    def _impl(current):
        current.execute(text("SET LOCAL statement_timeout = '5s'"))
        row = (
            current.execute(
                text(f"""
            WITH candidates AS MATERIALIZED (
                SELECT id, entity_uid, name, album_count, track_count, total_size,
                       updated_at, enriched_at
                FROM library_artists WHERE {condition} ORDER BY name, id LIMIT 21
            ), issues AS (
                SELECT id, check_type, severity, LEFT(description, 2048) AS description,
                       auto_fixable, status, created_at, last_seen_at, artist_id, album_id
                FROM health_issues WHERE status = 'open'
                  AND artist_id = (SELECT id FROM candidates WHERE (SELECT COUNT(*) FROM candidates) = 1)
                ORDER BY id DESC LIMIT :limit
            ), runs AS (
                SELECT check_type, last_run_at FROM health_check_runs
            )
            SELECT (SELECT jsonb_agg(to_jsonb(candidates)) FROM candidates) AS artists,
                   (SELECT jsonb_agg(to_jsonb(issues)) FROM issues) AS issues,
                   (SELECT jsonb_object_agg(check_type, last_run_at) FROM runs) AS runs
        """),
                {
                    "uid": artist_uid,
                    "name": name,
                    "pattern": f"%{escaped}%",
                    "limit": min(max(limit, 1), 101),
                },
            )
            .mappings()
            .one()
        )
        return dict(row)

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


__all__ = ["read_artist_evidence", "read_health_snapshot"]

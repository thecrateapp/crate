"""Persisted agent diagnostics stay bounded and never change functional state."""

import json
from datetime import UTC, datetime, timedelta

import pytest
from crate.db.queries import agent_library, agent_operations
from sqlalchemy import event, text

NOW = datetime(2026, 10, 16, 12, tzinfo=UTC)
ARTIST_UID = "10000000-0000-0000-0000-000000000001"


@pytest.fixture
def evidence(pg_db):
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        artist_id = session.execute(
            text("""
                INSERT INTO library_artists (name, entity_uid, album_count, track_count, updated_at)
                VALUES ('Echo', CAST(:uid AS uuid), 5, 42, :now) RETURNING id
            """),
            {"uid": ARTIST_UID, "now": NOW},
        ).scalar_one()
        session.execute(text("INSERT INTO library_artists (name) VALUES ('Echoes')"))
        session.execute(
            text("""
                INSERT INTO health_issues
                    (check_type, severity, description, status, created_at, last_seen_at,
                     artist_id, identity_key, details_json)
                SELECT 'duplicate_tracks', 'high', 'duplicate ' || n, 'open', :now, :now,
                       :artist_id, 'agent-test-' || n, '{"path": "/private/music"}'
                FROM generate_series(1, 105) n
            """),
            {"now": NOW, "artist_id": artist_id},
        )
        session.execute(
            text("""
                INSERT INTO health_check_runs (check_type, last_run_at, issue_count)
                VALUES ('duplicate_tracks', :observed, 105)
            """),
            {"observed": NOW - timedelta(days=2)},
        )
        session.execute(
            text("""
                INSERT INTO tasks (id, type, status, created_at, updated_at, error,
                                   params_json, result_json)
                SELECT 'agent-job-' || lpad(n::text, 3, '0'), 'scan',
                       CASE WHEN n % 2 = 0 THEN 'failed' ELSE 'completed' END,
                       :now, :now, 'failure', '{"secret": "must-not-leak"}',
                       '{"status": "skipped", "token": "must-not-leak"}'
                FROM generate_series(1, 105) n
            """),
            {"now": NOW},
        )
        session.execute(
            text("""
                INSERT INTO worker_logs (worker_id, task_id, level, category, message,
                                         metadata_json, created_at)
                SELECT 'agent-worker', 'agent-job-002', 'error', 'test', 'line ' || n,
                       '{"secret": "must-not-leak"}', :now
                FROM generate_series(1, 105) n
            """),
            {"now": NOW},
        )
        session.execute(
            text("""
                INSERT INTO ui_snapshots (scope, subject_key, version, source_seq,
                                          built_at, invalidated_at, payload_json)
                VALUES ('ops:health', 'agent:diagnostics:v1', 4, 99, :old, :now,
                        '{"issues": [], "counts": {}, "runs": {}}'),
                       ('ops', 'dashboard', 3, 98, :old, NULL,
                        '{"stats": {"tracks": 42, "internal_path": "/private"}, "live": {"token": "must-not-leak"}}')
            """),
            {"now": NOW, "old": NOW - timedelta(days=8)},
        )
        session.execute(
            text("""
                INSERT INTO ops_runtime_state (key, payload_json, updated_at)
                VALUES ('worker_live', '{"pending_count": 0, "systems": {"postgres": true}, "token": "must-not-leak"}', :old)
            """),
            {"old": NOW - timedelta(hours=2)},
        )
    return artist_id


def test_raw_snapshot_and_runtime_reads_preserve_stale_evidence(evidence):
    snapshot = agent_library.read_health_snapshot()
    assert snapshot["version"] == 4
    assert snapshot["source_seq"] == 99
    assert snapshot["invalidated_at"] == NOW
    assert snapshot["built_at"] == NOW - timedelta(days=8)

    status = agent_operations.read_status_evidence()
    assert status["snapshots"][0]["version"] == 3
    assert status["snapshots"][0]["payload_json"] == {"stats": {"tracks": 42}}
    runtime = status["runtime"][0]
    assert datetime.fromisoformat(runtime["updated_at"]) == NOW - timedelta(hours=2)
    assert runtime["payload_json"] == {"pending_count": 0}


def test_artist_read_uses_local_identity_and_caps_issues(evidence):
    result = agent_library.read_artist_evidence(artist_uid=ARTIST_UID, limit=9999)
    assert len(result["artists"]) == 1
    artist = result["artists"][0]
    assert artist["id"] == evidence
    assert artist["track_count"] == 42
    assert len(result["issues"]) == 101
    assert "details_json" not in result["issues"][0]
    assert result["runs"]["duplicate_tracks"]


def test_ambiguous_artist_search_never_attaches_first_candidates_issues(evidence):
    result = agent_library.read_artist_evidence(name="Echo")
    assert {row["name"] for row in result["artists"]} == {"Echo", "Echoes"}
    assert result["issues"] is None
    assert agent_library.read_artist_evidence(name="E%o")["artists"] is None


def test_job_keyset_is_stable_for_equal_timestamps_and_honors_filters(evidence):
    first = agent_operations.read_jobs(states=["failed"], types=["scan"], limit=2)
    second = agent_operations.read_jobs(
        states=["failed"],
        types=["scan"],
        limit=2,
        before=(first[-1]["created_at"], first[-1]["id"]),
    )
    assert [row["id"] for row in first + second] == [
        "agent-job-104",
        "agent-job-102",
        "agent-job-100",
        "agent-job-098",
    ]
    assert "params_json" not in first[0]
    assert len(agent_operations.read_jobs(limit=10000)) == 101
    assert agent_operations.read_jobs(types=["nonexistent"]) == []


def test_job_detail_omits_secret_payloads_and_handles_missing(evidence):
    result = agent_operations.read_job("agent-job-002")
    assert result["error"] == "failure"
    assert result["result_status"] == "skipped"
    assert not {"params_json", "result_json", "params", "result"} & result.keys()
    assert agent_operations.read_job("missing") is None


def test_agent_job_detail_exposes_bounded_execution_and_verification_without_raw_plan(
    evidence,
):
    from crate.db.tx import transaction_scope

    payload = {
        "status": "completed",
        "execution": {
            "status": "applied",
            "path": "/private/music",
            "issue_id": 12,
            "observation_id": "o" * 256,
            "plan_id": "p" * 256,
            "artist_uid": ARTIST_UID,
        },
        "verification": {"status": "conflict", "secret": "verification-secret"},
        "projection": {"status": "pending", "token": "projection-secret"},
        "error_code": "e" * 256,
        "plan": {"filesystem_path": "/private/music", "token": "plan-secret"},
        "idempotency_key": "private-request-key",
    }
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE tasks SET result_json = CAST(:result AS jsonb) WHERE id = :id"
            ),
            {"result": json.dumps(payload), "id": "agent-job-002"},
        )
    result = agent_operations.read_job("agent-job-002")
    assert result["execution_status"] == "applied"
    assert result["verification_status"] == "conflict"
    assert result["projection_status"] == "pending"
    assert result["issue_id"] == "12"
    assert result["observation_id"] == "o" * 128
    assert result["plan_id"] == "p" * 128
    assert result["artist_uid"] == ARTIST_UID
    assert result["error_code"] == "e" * 80
    serialized = json.dumps(result, default=str)
    for private in (
        "/private/music",
        "verification-secret",
        "projection-secret",
        "plan-secret",
        "private-request-key",
    ):
        assert private not in serialized
    assert (
        not {"result_json", "params_json", "plan", "execution", "verification"}
        & result.keys()
    )


def test_log_reads_are_time_scoped_bounded_and_omit_metadata(evidence):
    rows = agent_operations.read_worker_logs(
        since=NOW - timedelta(minutes=1),
        until=NOW + timedelta(minutes=1),
        task_id="agent-job-002",
        limit=10000,
    )
    assert len(rows) == 101
    assert rows[0]["message"] == "line 105"
    assert "metadata_json" not in rows[0]
    assert (
        agent_operations.read_worker_logs(
            since=NOW + timedelta(minutes=1),
            until=NOW + timedelta(minutes=2),
        )
        == []
    )


def test_all_diagnostic_reads_issue_only_bounded_selects_and_preserve_state(
    evidence, monkeypatch
):
    from crate.db import admin_health_surface, ops_snapshot, ui_snapshot_writes
    from crate.db.engine import get_engine
    from crate.db.repositories import tasks
    from crate.db.tx import read_scope

    def forbidden(*_args, **_kwargs):
        pytest.fail("diagnostic read attempted a builder or write")

    monkeypatch.setattr(admin_health_surface, "build_health_surface_payload", forbidden)
    monkeypatch.setattr(ops_snapshot, "get_cached_ops_snapshot", forbidden)
    monkeypatch.setattr(ui_snapshot_writes, "upsert_ui_snapshot", forbidden)
    monkeypatch.setattr(tasks, "create_task", forbidden)
    tables = (
        "library_artists",
        "health_issues",
        "health_check_runs",
        "tasks",
        "worker_logs",
        "ui_snapshots",
        "ops_runtime_state",
    )

    def persisted_state():
        with read_scope() as session:
            # SQL_SAFE: table names are the fixed internal tuple above.
            return {
                table: session.execute(
                    text(
                        f"SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM {table} t"
                    )
                ).scalar_one()
                for table in tables
            }

    before = persisted_state()
    queries = []

    def record(_conn, _cursor, statement, _params, _context, _many):
        queries.append(statement.strip())
        assert statement.strip().upper().startswith(("SELECT", "WITH", "SET LOCAL"))
        assert "library_tracks" not in statement.lower()

    engine = get_engine()
    event.listen(engine, "before_cursor_execute", record)
    try:
        with read_scope() as session:
            agent_library.read_health_snapshot(session=session)
            agent_library.read_artist_evidence(artist_uid=ARTIST_UID, session=session)
            agent_operations.read_status_evidence(session=session)
            agent_operations.read_jobs(limit=2, session=session)
            agent_operations.read_job("agent-job-002", session=session)
            agent_operations.read_worker_logs(
                since=NOW - timedelta(hours=1),
                until=NOW,
                limit=2,
                session=session,
            )
    finally:
        event.remove(engine, "before_cursor_execute", record)
    assert (
        len([query for query in queries if not query.upper().startswith("SET LOCAL")])
        == 6
    )
    assert persisted_state() == before

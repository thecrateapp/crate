"""Real PostgreSQL enforces read-only observation and bounded persisted sources."""

import json

from crate.db.queries.agent_observability import read_observation_evidence
from crate.db.tx import read_scope, transaction_scope
from sqlalchemy import text

from tests.test_smart_mix_admin import _create_tracks


def test_persisted_observation_query_is_read_only_batched_and_bounded(pg_db):
    del pg_db
    ids = _create_tracks(2)
    with transaction_scope() as session:
        uids = [
            str(uid)
            for uid in session.execute(
                text(
                    "SELECT entity_uid FROM library_tracks WHERE id=ANY(:ids) ORDER BY id"
                ),
                {"ids": ids},
            ).scalars()
        ]
        session.execute(
            text("""INSERT INTO track_mix_profiles
            (track_id,profile_version,profile_revision,analyzer,analyzer_version,source_revision,quality,analyzed_at)
            VALUES (:id,1,'profile-r','crate-rust','old-analyzer','source-r','full',NOW())"""),
            {"id": ids[0]},
        )
        session.execute(
            text("""INSERT INTO track_processing_state (track_id,pipeline,state,target_generation)
            VALUES (:id,'smart_mix','pending','current-target')"""),
            {"id": ids[1]},
        )
        session.execute(
            text("""INSERT INTO ops_runtime_state (key,payload_json,updated_at)
            VALUES ('worker_live',CAST(:worker AS jsonb),NOW()),
                   ('smart_mix:coverage',CAST(:coverage AS jsonb),NOW()),
                   ('smart_mix:backfill_campaign',CAST(:huge AS jsonb),NOW())
            ON CONFLICT(key) DO UPDATE SET payload_json=EXCLUDED.payload_json,updated_at=EXCLUDED.updated_at"""),
            {
                "coverage": json.dumps(
                    {"analyzer_version": "old", "current_profiles": 8}
                ),
                "worker": json.dumps(
                    {
                        "engine": "dramatiq",
                        "pending_count": 2,
                        "password": "omit",
                        "running_tasks": ["x" * 1000] * 100,
                    }
                ),
                "huge": json.dumps({"status": "x" * 33000}),
            },
        )
        session.execute(
            text("""INSERT INTO ui_snapshots (scope,subject_key,payload_json,built_at,version,source_seq)
            VALUES ('ops','dashboard',CAST(:snapshot AS jsonb),NOW(),9,77)
            ON CONFLICT(scope,subject_key) DO UPDATE SET payload_json=EXCLUDED.payload_json,version=9,source_seq=77"""),
            {
                "snapshot": json.dumps(
                    {
                        "stats": {"tracks": 2},
                        "eventing": {"outbox": {"pending": 3}},
                        "secret": "omit",
                    }
                )
            },
        )
        session.execute(
            text("""INSERT INTO tasks(id,type,status,created_at,updated_at)
            SELECT 'observation-'||i, 'import_queue_item','completed',NOW()-make_interval(secs=>i),NOW()
            FROM generate_series(1,22) i""")
        )
        session.execute(
            text("""INSERT INTO tasks(id,type,status,created_at,updated_at)
            VALUES ('observation-old','import_queue_item','pending',NOW()-INTERVAL '25 hours',NOW())""")
        )
    with read_scope() as session:
        session.execute(text("SET TRANSACTION READ ONLY"))
        result = read_observation_evidence(
            track_uids=uids, pipeline="import", session=session
        )
        assert session.execute(text("SHOW transaction_read_only")).scalar_one() == "on"
    runtime = {r["source"]: r for r in result["runtime"]}
    assert runtime["worker_live"]["payload"] == {
        "engine": "dramatiq",
        "pending_count": 2,
    }
    assert runtime["smart_mix:coverage"]["payload"]["current_profiles"] == 8
    assert runtime["smart_mix:backfill_campaign"]["oversized"]
    assert runtime["smart_mix:backfill_campaign"]["payload"] is None
    assert len(result["profiles"]) == 2
    profiles = {r["track_uid"]: r for r in result["profiles"]}
    assert profiles[uids[0]]["analyzer_version"] == "old-analyzer"
    assert profiles[uids[1]]["profile_revision"] is None
    assert profiles[uids[1]]["target_generation"] == "current-target"
    assert len(result["jobs"]) == 21
    assert all(r["id"] != "observation-old" for r in result["jobs"])
    snapshot = next(r for r in result["snapshots"] if r["source"] == "ops")
    assert snapshot["version"] == 9 and snapshot["source_seq"] == 77
    assert "secret" not in snapshot["payload"]
    assert result["database_schema_version"] and result["queried_at"]
    # The no-session branch also owns a rollback-only scope.
    assert read_observation_evidence()["profiles"] is None

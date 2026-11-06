"""Leaked or saturated AI capacity must not become a silent outage (review I1).

A reservation whose task is terminal (killed mid-call, zombie cleaned up) or
that has no live owner for too long gets its concurrency slot back, without
refunding the daily budget it was charged.
"""

import pytest
from sqlalchemy import text

from crate.ai import requeue
from crate.ai.contracts import AIConfigurationError


@pytest.fixture
def connection(pg_db, monkeypatch):
    from crate.ai import configuration

    monkeypatch.setenv("GEMINI_API_KEY", "synthetic-key")
    return configuration.ensure_environment_connection("gemini")


def _reserve(connection, *, job_id, key):
    from crate.db.repositories import ai_usage

    return ai_usage.reserve_invocation(
        {
            "connection_id": connection["id"],
            "model_id": "gemini-2.5-flash",
            "action_id": "genres.eq.propose",
            "invocation_kind": "action",
            "mode": "configured",
        },
        idempotency_key=key,
        input_tokens=100,
        output_tokens=50,
        job_id=job_id,
    )


def _active(connection):
    from crate.db.tx import read_scope

    with read_scope() as session:
        return session.execute(
            text("SELECT active_invocations FROM ai_provider_connections WHERE id=:id"),
            {"id": connection["id"]},
        ).scalar_one()


def _daily_tokens(connection):
    from crate.db.tx import read_scope

    with read_scope() as session:
        return session.execute(
            text(
                "SELECT COALESCE(SUM(tokens),0) FROM ai_usage_daily WHERE connection_id=:id"
            ),
            {"id": connection["id"]},
        ).scalar_one()


def test_killed_task_slot_comes_back(connection):
    from crate.db.repositories import ai_usage
    from crate.db.repositories.tasks import create_task, update_task

    task_id = create_task("propose_genre_eq", dispatch=False)
    invocation = _reserve(connection, job_id=task_id, key="killed")
    assert _active(connection) == 1
    charged = _daily_tokens(connection)
    # The worker thread died mid-call; zombie cleanup failed the task.
    update_task(task_id, status="failed", error="Worker died (no heartbeat)")

    assert ai_usage.reclaim_abandoned_invocations() == 1

    assert _active(connection) == 0
    row = ai_usage.list_invocations({})["items"][0]
    assert row["id"] == invocation["id"]
    assert row["status"] == "failed"
    assert row["error_code"] == "AI_INVOCATION_ABANDONED"
    assert _daily_tokens(connection) == charged
    assert ai_usage.reclaim_abandoned_invocations() == 0


def test_running_task_keeps_its_slot(connection):
    from crate.db.repositories import ai_usage
    from crate.db.repositories.tasks import create_task, start_task

    task_id = create_task("propose_genre_eq", dispatch=False)
    start_task(task_id, worker_id="host:1:1")
    _reserve(connection, job_id=task_id, key="in-flight")

    assert ai_usage.reclaim_abandoned_invocations() == 0
    assert _active(connection) == 1


def test_ownerless_reservation_is_reclaimed_after_the_stale_window(connection):
    from crate.db.repositories import ai_usage
    from crate.db.tx import transaction_scope

    _reserve(connection, job_id=None, key="http-call")
    assert ai_usage.reclaim_abandoned_invocations() == 0
    with transaction_scope() as session:
        session.execute(
            text("UPDATE ai_invocations SET created_at = NOW() - INTERVAL '20 minutes'")
        )

    assert ai_usage.reclaim_abandoned_invocations() == 1
    assert _active(connection) == 0


def test_stale_work_recovery_reclaims_after_zombie_cleanup(monkeypatch):
    from crate import worker

    steps = []
    monkeypatch.setattr(
        worker, "cleanup_zombie_tasks", lambda **k: steps.append("zombies") or 0
    )
    monkeypatch.setattr(
        "crate.db.repositories.ai_usage.reclaim_abandoned_invocations",
        lambda **k: steps.append("reclaim") or 0,
    )
    monkeypatch.setattr(
        "crate.db.jobs.smart_mix_backfill.release_dead_smart_mix_claims",
        lambda **k: steps.append("smart_mix") or 0,
    )

    worker._recover_stale_work()

    assert steps == ["zombies", "reclaim", "smart_mix"]


def test_bulk_batch_stops_waiting_after_one_item_exhausts(monkeypatch):
    slept = []
    monkeypatch.setattr(requeue.time, "sleep", slept.append)
    monkeypatch.setattr(requeue, "_interactive_demand", lambda: 0)

    def refused():
        raise AIConfigurationError("AI_CONCURRENCY_LIMIT", "busy")

    with requeue.concurrency_window("ai_bulk", 0):
        with pytest.raises(AIConfigurationError):
            requeue.reserve_with_capacity_wait(refused)
        assert len(slept) == 10
        # Later items fail at once: the batch ends with what it already paid for.
        with pytest.raises(AIConfigurationError) as error:
            requeue.reserve_with_capacity_wait(refused)
    assert error.value.code == "AI_CONCURRENCY_LIMIT"
    assert len(slept) == 10


def test_rebuild_proposals_keep_the_items_already_paid_for(monkeypatch):
    from crate import genre_taxonomy_proposals as proposals

    monkeypatch.setattr(proposals, "list_unmapped_genres_for_inference", lambda **k: [])
    monkeypatch.setattr(
        proposals, "_node_rebuild_candidates", lambda limit: ["punk", "hardcore"]
    )
    monkeypatch.setattr(proposals, "get_sound_intelligence_health", lambda: {})

    def node(slug, ai_call=None):
        if slug == "hardcore":
            raise AIConfigurationError("AI_CONCURRENCY_LIMIT", "busy")
        return {"ok": True, "slug": slug}

    monkeypatch.setattr(proposals, "build_genre_taxonomy_node_proposal", node)

    result = proposals.build_genre_taxonomy_rebuild_proposal(
        alias_limit=1, node_limit=2
    )

    assert [item["slug"] for item in result["node_proposals"]] == ["punk"]
    assert [item["slug"] for item in result["node_errors"]] == ["hardcore"]


def test_capacity_waits_and_requeues_are_measured(monkeypatch):
    recorded = []
    monkeypatch.setattr(
        "crate.metrics.record",
        lambda name, value, tags=None: recorded.append((name, tags)),
    )
    monkeypatch.setattr(requeue.time, "sleep", lambda _seconds: None)
    monkeypatch.setattr(requeue, "_interactive_demand", lambda: 0)
    attempts = []

    def busy_once():
        attempts.append(1)
        if len(attempts) == 1:
            raise AIConfigurationError("AI_CONCURRENCY_LIMIT", "busy")
        return {"claimed": True}

    with requeue.concurrency_window("ai_bulk", 0):
        requeue.reserve_with_capacity_wait(busy_once)
    with requeue.concurrency_window("ai", 0):
        with pytest.raises(requeue.AIConcurrencyDeferred):
            requeue.reserve_with_capacity_wait(
                lambda: (_ for _ in ()).throw(
                    AIConfigurationError("AI_CONCURRENCY_LIMIT", "busy")
                )
            )

    assert ("ai.capacity.wait", {"queue": "ai_bulk"}) in recorded
    assert ("ai.capacity.requeue", {"queue": "ai"}) in recorded


def test_snapshot_counts_tasks_waiting_for_capacity(pg_db):
    from crate.db.queries.tasks import get_task_activity_snapshot
    from crate.db.repositories.tasks import create_task, update_task

    waiting = create_task("show_extract", pool="ai", dispatch=False)
    update_task(waiting, progress="Waiting for AI provider capacity; retry 2/10 in 9s")
    create_task("research_artist_bio", pool="ai", dispatch=False)

    snapshot = get_task_activity_snapshot(
        running_limit=10, pending_limit=10, recent_limit=10
    )

    assert snapshot["queue_breakdown"]["capacity_waiting"] == {"ai": 1, "ai_bulk": 0}

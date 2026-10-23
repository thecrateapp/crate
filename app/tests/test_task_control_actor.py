"""Workers acknowledge stopped execution and finish cancelled fan-out trees."""

from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlalchemy import text

from crate.agent_diagnostics import DiagnosticError
from crate.db.queries.tasks import get_task
from crate.db.repositories.task_control import (
    acknowledge_cancellation,
    request_cancellation,
)
from crate.db.repositories.tasks import create_task, start_task, update_task
from crate.db.tx import transaction_scope


def _row(task_id):
    row = get_task(task_id)
    assert row is not None
    return row


@pytest.fixture
def actor_world(pg_db, monkeypatch):
    from crate import actors
    from crate.worker import TASK_HANDLERS

    events = []
    monkeypatch.setattr(actors, "_heartbeat_loop", lambda *_: None)
    monkeypatch.setattr(actors, "_check_memory", lambda: None)
    monkeypatch.setattr("crate.config.load_config", lambda: {"library_path": "/tmp"})
    monkeypatch.setattr(
        "crate.resource_governor.should_defer_task",
        lambda *_: SimpleNamespace(allowed=True),
    )
    monkeypatch.setattr("crate.metrics.record", lambda *_args, **_kwargs: None)
    monkeypatch.setattr("crate.telegram.notify_task_completed", lambda *_: None)
    monkeypatch.setattr("crate.telegram.notify_task_failed", lambda *_: None)
    monkeypatch.setattr(
        "crate.observability.sentry.capture_task_exception",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        "crate.db.events._publish_to_redis", lambda *args: events.append(args)
    )
    return actors, TASK_HANDLERS, events


def test_actor_persists_checkpoint_effects_and_emits_cancelled_terminal(
    actor_world, monkeypatch
):
    actors, handlers, events = actor_world
    task_id = create_task("compute_analytics", dispatch=False)

    def checkpoint(task_id, _params, _config):
        request_cancellation(task_id)
        return {"status": "cancelled", "processed": 2, "remaining": 4}

    monkeypatch.setitem(handlers, "compute_analytics", checkpoint)

    actors._execute_task("compute_analytics", task_id)

    row = _row(task_id)
    assert row["status"] == "cancelled"
    assert row["cancellation_acknowledged_at"] is not None
    assert row["result"]["processed"] == 2
    assert row["result"]["remaining"] == 4
    done = [event[2] for event in events if event[1] == "task_done"]
    assert len(done) == 1
    assert done[0]["status"] == "cancelled"


def test_analytics_callback_stops_work_and_actor_acknowledges_partial_effects(
    actor_world, monkeypatch, tmp_path
):
    from crate.worker_handlers import analysis

    actors, handlers, events = actor_world
    task_id = create_task("compute_analytics", dispatch=False)
    continued = Mock()
    cache = Mock()
    monkeypatch.setattr(
        "crate.config.load_config", lambda: {"library_path": str(tmp_path)}
    )
    monkeypatch.setattr(analysis, "emit_progress", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(analysis, "set_cache", cache)
    monkeypatch.setitem(
        handlers, "compute_analytics", analysis._handle_compute_analytics
    )

    def compute(_library, _extensions, *, progress_callback, incremental):
        assert incremental is True
        request_cancellation(task_id)
        progress_callback({"artists_done": 5, "artists_total": 10, "artist": "Fifth"})
        continued()
        return {"false_success": True}

    monkeypatch.setattr("crate.analytics.compute_analytics", compute)

    actors._execute_task("compute_analytics", task_id)

    row = _row(task_id)
    assert row["status"] == "cancelled"
    assert row["cancellation_acknowledged_at"] is not None
    assert row["result"]["execution"]["status"] == "partial"
    assert row["result"]["execution"]["phase"] == "analytics"
    assert row["result"]["execution"]["effects"] == "may_be_partial_or_complete"
    continued.assert_not_called()
    cache.assert_not_called()
    assert [event[2]["status"] for event in events if event[1] == "task_done"] == [
        "cancelled"
    ]


@pytest.mark.parametrize("failure", ["exception", "timeout"])
def test_actor_interruption_after_request_does_not_claim_acknowledged_stop(
    actor_world, monkeypatch, failure
):
    from dramatiq.middleware.time_limit import TimeLimitExceeded

    actors, handlers, _events = actor_world
    task_id = create_task("compute_analytics", dispatch=False)
    with transaction_scope() as session:
        session.execute(
            text("UPDATE tasks SET max_retries=2 WHERE id=:id"), {"id": task_id}
        )
    exception = (
        RuntimeError("Worker failed") if failure == "exception" else TimeLimitExceeded()
    )

    def interrupted(task_id, _params, _config):
        request_cancellation(task_id)
        raise exception

    monkeypatch.setitem(handlers, "compute_analytics", interrupted)

    with pytest.raises(type(exception)):
        actors._execute_task("compute_analytics", task_id)

    row = _row(task_id)
    assert row["status"] == "failed"
    assert row["retry_count"] == 0
    assert row["cancellation_acknowledged_at"] is None
    assert row["result"]["verification"]["status"] == "manual_reconciliation_required"


def test_cancelled_delegation_waits_for_children_and_skips_domain_finalizer(
    pg_db, monkeypatch
):
    from crate.worker_handlers import analysis

    parent = create_task("compute_popularity", dispatch=False)
    start_task(parent)
    child = create_task("compute_popularity", parent_task_id=parent, dispatch=False)
    start_task(child)
    update_task(parent, status="delegated", result={"chunks": 1})
    request_cancellation(parent)
    finalizer = Mock(return_value={"tracks_scored": 999})
    monkeypatch.setitem(analysis._PARENT_FINALIZERS, "compute_popularity", finalizer)
    monkeypatch.setattr(analysis, "emit_progress", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(analysis, "emit_task_event", lambda *_args, **_kwargs: None)

    analysis._try_complete_parent(parent, "compute_popularity")
    assert _row(parent)["status"] == "delegated"

    acknowledge_cancellation(child, {"albums_fetched": 2})
    analysis._try_complete_parent(parent, "compute_popularity")

    row = _row(parent)
    assert row["status"] == "cancelled"
    assert row["cancellation_acknowledged_at"] is not None
    assert _row(child)["result"]["albums_fetched"] == 2
    finalizer.assert_not_called()


def test_successful_delegation_still_runs_its_finalizer_once(pg_db, monkeypatch):
    from crate.worker_handlers import analysis

    parent = create_task("compute_popularity", dispatch=False)
    start_task(parent)
    child = create_task("compute_popularity", parent_task_id=parent, dispatch=False)
    start_task(child)
    update_task(child, status="completed", result={"albums_fetched": 2})
    update_task(parent, status="delegated", result={"chunks": 1})
    finalizer = Mock(return_value={"tracks_scored": 7})
    monkeypatch.setitem(analysis._PARENT_FINALIZERS, "compute_popularity", finalizer)
    monkeypatch.setattr(analysis, "emit_progress", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(analysis, "emit_task_event", lambda *_args, **_kwargs: None)

    analysis._try_complete_parent(parent, "compute_popularity")
    analysis._try_complete_parent(parent, "compute_popularity")

    assert _row(parent)["status"] == "completed"
    assert _row(parent)["result"]["tracks_scored"] == 7
    finalizer.assert_called_once_with(parent)


def test_actor_handles_children_finishing_before_coordinator_returns(
    actor_world, monkeypatch
):
    from crate.worker_handlers import analysis

    actors, handlers, _events = actor_world
    parent = create_task("compute_popularity", dispatch=False)
    finalizer = Mock(return_value={"tracks_scored": 3})
    monkeypatch.setitem(analysis._PARENT_FINALIZERS, "compute_popularity", finalizer)
    monkeypatch.setattr(analysis, "emit_progress", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(analysis, "emit_task_event", lambda *_args, **_kwargs: None)

    def coordinate(task_id, _params, _config):
        child = create_task(
            "compute_popularity", parent_task_id=task_id, dispatch=False
        )
        start_task(child)
        update_task(child, status="completed", result={"albums_fetched": 1})
        analysis._try_complete_parent(task_id, "compute_popularity")
        return {"_delegated": True, "chunks": 1, "artists": 1}

    monkeypatch.setitem(handlers, "compute_popularity", coordinate)

    actors._execute_task("compute_popularity", parent)

    assert _row(parent)["status"] == "completed"
    assert _row(parent)["result"]["tracks_scored"] == 3
    finalizer.assert_called_once_with(parent)


def test_actor_requeues_without_execution_when_policy_changes_before_claim(
    actor_world, monkeypatch
):
    from crate.db.repositories import runtime_policy
    from crate.resource_governor import ResourceDecision

    actors, handlers, _events = actor_world
    task_id = create_task("compute_analytics", dispatch=False)
    before = runtime_policy.read_runtime_policy_state()
    runtime_policy.update_runtime_policy({"pools": {"heavy": 2}}, expected_revision=0)
    handler = Mock()
    actor = Mock()
    monkeypatch.setitem(handlers, "compute_analytics", handler)
    monkeypatch.setitem(actors._actors, "compute_analytics", actor)
    monkeypatch.setattr(
        "crate.resource_governor.should_defer_task",
        lambda *_: ResourceDecision(
            allowed=True,
            policy_revision=before["configured_revision"],
            policy_hash=before["policy_hash"],
        ),
    )

    actors._execute_task("compute_analytics", task_id)

    assert _row(task_id)["status"] == "pending"
    handler.assert_not_called()
    actor.send_with_options.assert_called_once_with(
        args=(task_id,), delay=actors.TASK_REQUEUE_DELAY_MS
    )


@pytest.mark.parametrize(
    "operation", ["job_retry", "runtime_update", "metadata_update"]
)
def test_control_handler_rejects_every_non_cancellation_operation(
    monkeypatch, operation
):
    from crate.worker_handlers import agent_library

    execute = Mock()
    monkeypatch.setattr(
        "crate.db.repositories.agent_operation_jobs.load_operation_job",
        lambda _task_id: {"payload": {"domain_operation": operation}},
    )
    monkeypatch.setattr(agent_library, "execute_operation_job", execute)

    with pytest.raises(DiagnosticError) as error:
        agent_library._handle_agent_control("control-job", {}, {})

    assert error.value.code == "FORBIDDEN"
    execute.assert_not_called()


@pytest.mark.parametrize(
    "domain_operation, allowed",
    [
        ("tidal_acquisition", True),
        ("tidal_artist_acquisition", True),
        ("acquisition", False),
    ],
)
def test_agent_tidal_download_cancellation_is_limited_to_owned_tidal_plans(
    monkeypatch, domain_operation, allowed
):
    from crate.agent_access import AgentPrincipal
    from crate.db.repositories import agent_task_control

    principal = AgentPrincipal(
        id="principal-1",
        credential_id="credential-1",
        name="Hermes",
        grants=frozenset({"library.acquisition.write", "ops.jobs.cancel"}),
    )
    task_id = "tidal-task-1"
    row = {
        "id": task_id,
        "type": "agent_tidal_download",
        "origin": "agent",
        "origin_principal_id": principal.id,
        "origin_context": {"authorization_context": {}},
        "required_grants": ["library.acquisition.write"],
        "params_json": {"agent_command": True},
    }
    job = {
        "principal_id": principal.id,
        "operation": "apply_operation",
        "payload": {"domain_operation": domain_operation},
    }
    monkeypatch.setattr(
        agent_task_control.requests, "_job", lambda _current, _task_id: job
    )

    if allowed:
        grants = agent_task_control._grants(
            row, principal, "job_cancel", "own", object()
        )
        assert "ops.jobs.cancel" in grants
    else:
        with pytest.raises(DiagnosticError) as error:
            agent_task_control._grants(row, principal, "job_cancel", "own", object())
        assert error.value.code == "NOT_EXECUTABLE"

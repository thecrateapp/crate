"""A cancellation request is not evidence that a worker has stopped."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Barrier
from unittest.mock import Mock

import pytest
from sqlalchemy import text

from crate.agent_diagnostics import DiagnosticError
from crate.db.queries.tasks import get_task
from crate.db.repositories.tasks import create_task, start_task, update_task
from crate.db.repositories.tasks_updates import fail_or_retry_task
from crate.db.repositories.agent_task_control import check_task_authority
from crate.db.tx import transaction_scope


@pytest.fixture
def controls(pg_db):
    from crate.db.repositories import task_control

    return task_control


def _task(**kwargs):
    return create_task("compute_analytics", dispatch=False, **kwargs)


def _row(task_id):
    row = get_task(task_id)
    assert row is not None
    return row


def test_missing_task_does_not_signal_cancellation(controls):
    assert check_task_authority("missing-task") is False


def test_pending_cancel_is_terminal_and_prevents_actor_claim(controls):
    task_id = _task()

    result = controls.request_cancellation(task_id)

    assert result["status"] == "cancelled"
    assert result["request_state"] == "cancelled"
    assert controls.cancellation_requested(task_id) is True
    assert start_task(task_id, worker_id="worker-1") is None
    assert _row(task_id)["cancellation_acknowledged_at"] is not None


def test_running_request_preserves_runtime_until_acknowledgement(controls):
    task_id = _task()
    assert start_task(task_id, worker_id="worker-1") is not None

    result = controls.request_cancellation(task_id)

    assert result["status"] == "running"
    assert result["request_state"] == "cancellation_requested"
    assert result["cancellation_requested"] is True
    row = _row(task_id)
    assert row["status"] == "running"
    assert row["worker_id"] == "worker-1"
    assert row["cancellation_acknowledged_at"] is None

    effects = {"execution": {"status": "partial", "applied": 2, "remaining": 3}}
    acknowledged = controls.acknowledge_cancellation(task_id, effects)

    assert acknowledged is not None
    row = _row(task_id)
    assert row["status"] == "cancelled"
    assert row["result"]["execution"]["status"] == "partial"
    assert row["result"]["execution"]["applied"] == 2
    assert row["result"]["execution"]["remaining"] == 3
    assert row["cancellation_acknowledged_at"] is not None
    assert row["worker_id"] is None


def test_repeated_running_request_preserves_original_request_time(controls):
    task_id = _task()
    start_task(task_id)
    controls.request_cancellation(task_id)
    first = _row(task_id)["cancellation_requested_at"]

    repeated = controls.request_cancellation(task_id)

    assert repeated["status"] == "running"
    assert repeated["request_state"] == "cancellation_requested"
    assert _row(task_id)["cancellation_requested_at"] == first
    assert _row(task_id)["cancellation_acknowledged_at"] is None


def test_acknowledgement_without_request_does_not_cancel_running_work(controls):
    task_id = _task()
    start_task(task_id)

    assert controls.acknowledge_cancellation(task_id) is None

    assert _row(task_id)["status"] == "running"
    assert _row(task_id)["cancellation_requested_at"] is None
    assert _row(task_id)["cancellation_acknowledged_at"] is None


def test_cancellation_composes_with_a_caller_transaction_and_rolls_back(controls):
    task_id = _task()
    start_task(task_id)

    with pytest.raises(RuntimeError, match="Caller transaction aborted"):
        with transaction_scope() as session:
            controls.request_cancellation(task_id, session=session)
            assert controls.cancellation_requested(task_id, session=session) is True
            assert _row(task_id)["cancellation_requested_at"] is None
            raise RuntimeError("Caller transaction aborted")

    assert controls.cancellation_requested(task_id) is False
    assert _row(task_id)["status"] == "running"


@pytest.mark.parametrize("finalizing_child", [False, True])
def test_finalization_cannot_be_cancelled_or_partially_propagated(
    controls, finalizing_child
):
    parent = _task()
    start_task(parent)
    pending_child = _task(parent_task_id=parent)
    finalizing = _task(parent_task_id=parent) if finalizing_child else parent
    if finalizing_child:
        start_task(finalizing)
        update_task(parent, status="delegated")
    update_task(finalizing, status="completing")

    with pytest.raises(DiagnosticError) as error:
        controls.request_cancellation(parent)

    assert error.value.code == "STATE_CONFLICT"
    assert _row(finalizing)["status"] == "completing"
    assert _row(parent)["cancellation_requested_at"] is None
    assert _row(pending_child)["status"] == "pending"
    assert _row(pending_child)["cancellation_requested_at"] is None


@pytest.mark.parametrize("status", ["completed", "failed", "cancelled"])
def test_terminal_winner_is_preserved_by_request_and_acknowledgement(controls, status):
    task_id = _task()
    saved = {"execution": {"status": status, "applied": 1}}
    update_task(task_id, status=status, result=saved)

    result = controls.request_cancellation(task_id)
    controls.acknowledge_cancellation(task_id, {"overwritten": True})

    assert result["status"] == status
    assert result["request_state"] == "already_terminal"
    assert _row(task_id)["status"] == status
    assert _row(task_id)["result"] == saved


def test_request_and_claim_race_never_leaves_a_claimable_cancelled_task(controls):
    task_id = _task()
    barrier = Barrier(2)

    def claim():
        barrier.wait()
        return start_task(task_id, worker_id="racing-worker")

    def cancel():
        barrier.wait()
        return controls.request_cancellation(task_id)

    with ThreadPoolExecutor(max_workers=2) as pool:
        claimant, canceller = pool.submit(claim), pool.submit(cancel)
        claimed, requested = claimant.result(timeout=10), canceller.result(timeout=10)

    row = _row(task_id)
    assert row["cancellation_requested_at"] is not None
    assert start_task(task_id, worker_id="late-worker") is None
    if claimed is None:
        assert row["status"] == requested["status"] == "cancelled"
    else:
        assert row["status"] == requested["status"] == "running"
        assert row["cancellation_acknowledged_at"] is None


def test_cancel_request_and_completion_race_preserves_successful_completion(controls):
    task_id = _task()
    start_task(task_id)
    barrier = Barrier(2)
    completed_result = {"execution": {"status": "completed", "applied": 3}}

    def complete():
        barrier.wait()
        update_task(task_id, status="completed", result=completed_result)

    def cancel():
        barrier.wait()
        return controls.request_cancellation(task_id)

    with ThreadPoolExecutor(max_workers=2) as pool:
        completed, requested = pool.submit(complete), pool.submit(cancel)
        completed.result(timeout=10)
        requested.result(timeout=10)

    controls.acknowledge_cancellation(task_id, {"execution": {"status": "cancelled"}})
    assert _row(task_id)["status"] == "completed"
    assert _row(task_id)["result"] == completed_result


def test_acknowledged_cancel_cannot_be_overwritten_by_late_worker_success(controls):
    task_id = _task()
    start_task(task_id)
    controls.request_cancellation(task_id)
    partial = {"execution": {"status": "partial", "applied": 2}}
    controls.acknowledge_cancellation(task_id, partial)
    acknowledged_result = _row(task_id)["result"]

    update_task(task_id, status="completed", result={"false_success": True})

    assert _row(task_id)["status"] == "cancelled"
    assert _row(task_id)["result"] == acknowledged_result


def test_delegated_parent_waits_for_active_children_before_acknowledging(controls):
    parent = _task()
    start_task(parent)
    pending_child = _task(parent_task_id=parent)
    running_child = _task(parent_task_id=parent)
    start_task(running_child)
    update_task(parent, status="delegated", result={"chunks": 2})

    requested = controls.request_cancellation(parent)

    assert requested["status"] == "delegated"
    assert requested["affected_children"] == 2
    assert _row(pending_child)["status"] == "cancelled"
    assert _row(running_child)["status"] == "running"
    assert controls.cancellation_requested(running_child) is True
    assert controls.acknowledge_cancellation(parent) is None
    assert _row(parent)["status"] == "delegated"

    child_result = {"execution": {"status": "partial", "applied": 1}}
    controls.acknowledge_cancellation(running_child, child_result)
    parent_result = {"execution": {"status": "partial"}, "chunks": 2}
    assert controls.acknowledge_cancellation(parent, parent_result) is not None
    assert _row(parent)["status"] == "cancelled"
    assert _row(running_child)["result"]["execution"]["status"] == "partial"
    assert _row(running_child)["result"]["execution"]["applied"] == 1


def test_delegated_tree_with_only_pending_leaves_cancels_without_an_active_worker(
    controls,
):
    parent = _task()
    start_task(parent)
    child = _task(parent_task_id=parent)
    start_task(child)
    leaf = _task(parent_task_id=child)
    sibling = _task(parent_task_id=parent)
    update_task(child, status="delegated", result={"chunks": 1})
    update_task(parent, status="delegated", result={"chunks": 2})

    requested = controls.request_cancellation(parent)

    assert requested["status"] == "cancelled"
    for task_id in (parent, child, leaf, sibling):
        row = _row(task_id)
        assert row["status"] == "cancelled"
        assert row["cancellation_acknowledged_at"] is not None


def test_child_created_after_parent_request_never_dispatches(controls, monkeypatch):
    parent = _task()
    start_task(parent)
    controls.request_cancellation(parent)
    dispatch = Mock()
    monkeypatch.setattr("crate.db.repositories.tasks_mutations.dispatch_task", dispatch)

    child = create_task("compute_analytics", parent_task_id=parent)

    assert _row(child)["status"] == "cancelled"
    assert controls.cancellation_requested(child) is True
    assert start_task(child) is None
    dispatch.assert_not_called()


def test_requested_cancellation_prevents_automatic_retry_after_exception(controls):
    task_id = _task()
    start_task(task_id)
    with transaction_scope() as session:
        session.execute(
            text("UPDATE tasks SET max_retries=2 WHERE id=:id"), {"id": task_id}
        )
    controls.request_cancellation(task_id)
    update_task(
        task_id,
        result={
            "processed": 2,
            "execution": {"status": "partial", "applied": 2, "remaining": 4},
            "verification": {"evidence": "previous-checkpoint"},
        },
    )

    assert fail_or_retry_task(task_id, "Worker interrupted") == "failed"

    row = _row(task_id)
    assert row["status"] == "failed"
    assert row["retry_count"] == 0
    assert row["cancellation_acknowledged_at"] is None
    assert row["result"]["verification"]["status"] == "manual_reconciliation_required"
    assert row["result"]["processed"] == 2
    assert row["result"]["execution"]["applied"] == 2
    assert row["result"]["execution"]["remaining"] == 4
    assert row["result"]["verification"]["evidence"] == "previous-checkpoint"


def test_lost_worker_with_request_requires_reconciliation_and_is_not_requeued(
    controls, monkeypatch
):
    from crate.db.repositories.tasks_maintenance import cleanup_zombie_tasks

    task_id = _task()
    start_task(task_id)
    controls.request_cancellation(task_id)
    update_task(
        task_id,
        result={
            "processed": 2,
            "execution": {"status": "partial", "applied": 2, "remaining": 4},
            "verification": {"evidence": "previous-checkpoint"},
        },
    )
    old = datetime.now(timezone.utc) - timedelta(minutes=12)
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE tasks SET max_retries=2,heartbeat_at=:old,updated_at=:old WHERE id=:id"
            ),
            {"id": task_id, "old": old},
        )
    dispatch = Mock()
    monkeypatch.setattr(
        "crate.db.repositories.tasks_maintenance.dispatch_task", dispatch
    )

    assert cleanup_zombie_tasks(heartbeat_timeout_min=5) == 1

    row = _row(task_id)
    assert row["status"] == "failed"
    assert row["retry_count"] == 0
    assert row["cancellation_acknowledged_at"] is None
    assert row["result"]["verification"]["status"] == "manual_reconciliation_required"
    assert row["result"]["processed"] == 2
    assert row["result"]["execution"]["applied"] == 2
    assert row["result"]["execution"]["remaining"] == 4
    assert row["result"]["verification"]["evidence"] == "previous-checkpoint"
    dispatch.assert_not_called()


def test_request_and_new_child_race_cancels_every_pending_child(controls, monkeypatch):
    parent = _task()
    start_task(parent)
    barrier = Barrier(2)
    dispatch = Mock()
    monkeypatch.setattr("crate.db.repositories.tasks_mutations.dispatch_task", dispatch)

    def spawn():
        barrier.wait()
        return create_task("compute_analytics", parent_task_id=parent, dispatch=False)

    def cancel():
        barrier.wait()
        return controls.request_cancellation(parent)

    with ThreadPoolExecutor(max_workers=2) as pool:
        child_future, cancelled = pool.submit(spawn), pool.submit(cancel)
        child = child_future.result(timeout=10)
        cancelled.result(timeout=10)

    assert _row(child)["status"] == "cancelled"
    assert controls.cancellation_requested(child) is True
    assert _row(parent)["status"] == "running"


def test_provenance_and_retry_ancestry_are_persisted_separately_from_params(controls):
    original = _task()
    controls.record_task_provenance(
        original,
        origin="scheduler",
        required_grants=["library.health.run"],
        schedule_name="compute_analytics",
    )
    retry = _task()
    controls.record_task_provenance(
        retry,
        origin="worker",
        required_grants=["ops.jobs.retry", "library.health.run"],
        retry_of=original,
    )

    row = _row(original)
    assert row["origin"] == "scheduler"
    assert row["schedule_name"] == "compute_analytics"
    assert row["retry_root"] == original
    assert row["retry_depth"] == 0
    retried = _row(retry)
    assert retried["origin"] == "worker"
    assert retried["retry_of"] == retried["retry_root"] == original
    assert retried["retry_depth"] == 1
    assert set(retried["required_grants"]) == {"ops.jobs.retry", "library.health.run"}
    assert retried["params"] == {}


def test_unsupported_origin_cannot_be_stored(controls):
    task_id = _task()

    with pytest.raises(ValueError, match="origin"):
        controls.record_task_provenance(task_id, origin="untrusted-client-claim")

    assert _row(task_id)["origin"] == "unknown"

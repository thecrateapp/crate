"""Deterministic incident rules and separately authenticated human decisions."""

import hashlib
import hmac
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from deploy.operator.state import CapacityError, State
from deploy.operator.supervisor import Rule, Supervisor, path_value, timestamp

BASE = 1800000000


def iso(now):
    return datetime.fromtimestamp(now, UTC).isoformat()


def rule(**kwargs):
    return Rule(
        id="queue",
        subsystem="analysis",
        tool="get_observability_summary",
        source_path=("data", "sources", "worker"),
        **kwargs,
    )


def source(now, value=10, **kwargs):
    return {
        "source": "persisted_worker",
        "availability": "available",
        "observed_at": iso(now),
        "coverage": "partial",
        "data": {"pending": value, "backlog": 10},
        **kwargs,
    }


def observe(supervisor, now, sample):
    supervisor.observe(
        {supervisor.rules[0].request_key: {"data": {"sources": {"worker": sample}}}},
        now,
    )


@pytest.fixture
def state(tmp_path):
    value = State(tmp_path)
    yield value
    value.close()


def test_threshold_hysteresis_escalation_recovery_and_source_replay(state):
    supervisor = Supervisor(
        state,
        "lab",
        [
            rule(
                kind="high",
                field=("pending",),
                threshold=10,
                clear_threshold=4,
                critical=20,
            )
        ],
    )
    observe(supervisor, BASE, source(BASE))
    observe(supervisor, BASE + 30, source(BASE))
    assert not state.snapshot()[
        "incidents"
    ]  # Repeated polling is not a second producer sample.
    observe(supervisor, BASE + 60, source(BASE + 60))
    incident = state.snapshot()["incidents"]["lab/analysis/queue"]
    assert incident["state"] == "open"
    observe(supervisor, BASE + 90, source(BASE + 90, 30))
    assert state.snapshot()["incidents"][incident["key"]]["severity"] == "critical"
    observe(supervisor, BASE + 120, source(BASE + 120, 0))
    observe(supervisor, BASE + 150, source(BASE + 150, 6))  # Deadband resets recovery.
    observe(supervisor, BASE + 180, source(BASE + 180, 0))
    assert state.snapshot()["incidents"][incident["key"]]["state"] == "open"
    observe(supervisor, BASE + 210, source(BASE + 210, 0))
    assert state.snapshot()["incidents"][incident["key"]]["state"] == "resolved"
    assert [event["kind"] for event in state.events()["events"]] == [
        "incident_opened",
        "incident_escalated",
        "incident_resolved",
    ]
    observe(supervisor, BASE + 240, source(BASE + 240, 30))
    observe(supervisor, BASE + 270, source(BASE + 270, 30))
    assert state.snapshot()["incidents"][incident["key"]]["revision"] == 4


@pytest.mark.parametrize(
    "bad",
    [
        source(BASE - 1000, 0),
        source(BASE + 999, 0),
        source(BASE, 0, availability="unavailable"),
        source(BASE, 0, observed_at=None),
        {},
    ],
)
def test_missing_stale_future_never_prove_recovery(state, bad):
    supervisor = Supervisor(
        state,
        "lab",
        [rule(kind="high", field=("pending",), trigger_samples=1, recovery_samples=1)],
    )
    observe(supervisor, BASE, source(BASE))
    observe(supervisor, BASE + 30, bad)
    assert state.snapshot()["incidents"]["lab/analysis/queue"]["state"] == "open"
    assert not supervisor.status(BASE + 30)["coverage"]["lab/analysis/queue"]["valid"]


def test_unavailable_opens_escalates_and_requires_fresh_samples_to_clear(state):
    supervisor = Supervisor(state, "lab", [rule()])
    for step in range(6):
        observe(supervisor, BASE + step * 30, {})
    incident = state.snapshot()["incidents"]["lab/analysis/queue"]
    assert incident["severity"] == "critical"
    observe(supervisor, BASE + 180, source(BASE + 180))
    observe(supervisor, BASE + 210, source(BASE + 180))
    assert state.snapshot()["incidents"][incident["key"]]["state"] == "open"
    observe(supervisor, BASE + 240, source(BASE + 240))
    assert state.snapshot()["incidents"][incident["key"]]["state"] == "resolved"
    assert (
        supervisor.status(BASE + 240)["state"] == "degraded"
    )  # Old undelivered queue.
    with state.transaction() as data:
        for item in data["outbox"].values():
            item["state"] = "delivered"
    assert supervisor.status(BASE + 240)["state"] == "ok"
    assert supervisor.status(BASE + 400)["state"] == "degraded"


@pytest.mark.parametrize(
    "kind,extra,values",
    [
        ("low", {"threshold": 5, "clear_threshold": 10, "critical": 1}, [4, 1, 12]),
        ("drift", {"expected": "v2"}, ["v1", "v1", "v2"]),
        (
            "stuck",
            {"threshold": 100, "clear_threshold": 20},
            [iso(BASE - 200), iso(BASE - 200), iso(BASE + 60)],
        ),
    ],
)
def test_storage_version_and_stuck_rules(state, kind, extra, values):
    supervisor = Supervisor(
        state,
        "lab",
        [
            rule(
                kind=kind,
                field=("pending",),
                trigger_samples=1,
                recovery_samples=1,
                **extra,
            )
        ],
    )
    for step, value in enumerate(values):
        observe(supervisor, BASE + 30 * step, source(BASE + 30 * step, value))
    assert state.snapshot()["incidents"]["lab/analysis/queue"]["state"] == "resolved"


def test_progress_uses_producer_time_and_counter_reset_is_unknown(state):
    supervisor = Supervisor(
        state,
        "lab",
        [
            rule(
                kind="progress",
                field=("pending",),
                active_field=("backlog",),
                threshold=60,
                trigger_samples=1,
                recovery_samples=1,
            )
        ],
    )
    observe(supervisor, BASE, source(BASE, 10))
    observe(supervisor, BASE + 60, source(BASE, 10))
    assert not state.snapshot()["incidents"]
    observe(supervisor, BASE + 90, source(BASE + 90, 10))
    assert state.snapshot()["incidents"]["lab/analysis/queue"]["state"] == "open"
    observe(supervisor, BASE + 120, source(BASE + 120, 0))
    assert state.snapshot()["incidents"]["lab/analysis/queue"]["state"] == "open"
    observe(supervisor, BASE + 150, source(BASE + 150, 1))
    assert state.snapshot()["incidents"]["lab/analysis/queue"]["state"] == "resolved"


def test_old_measurement_cannot_replace_new_progress_or_resolve(state):
    supervisor = Supervisor(
        state,
        "lab",
        [rule(kind="high", field=("pending",), trigger_samples=1, recovery_samples=1)],
    )
    observe(supervisor, BASE, source(BASE))
    observe(supervisor, BASE + 30, source(BASE - 1, 0))
    assert state.snapshot()["incidents"]["lab/analysis/queue"]["state"] == "open"
    assert state.snapshot()["rules"]["lab/analysis/queue"]["last_source"] == BASE


def test_evidence_bound_incident_paging_and_instance_binding(state):
    supervisor = Supervisor(state, "lab", [rule()])
    for step in range(30):
        observe(supervisor, BASE + 30 * step, {})
    incident = supervisor.incidents()["incidents"][0]
    assert len(incident["evidence"]) == 20
    assert supervisor.incidents(1)["incidents"] == []
    with pytest.raises(ValueError):
        supervisor.incidents(limit=101)
    with pytest.raises(ValueError, match="different instance"):
        Supervisor(state, "other", [rule()])


def signed(private, receipt):
    return hmac.new(
        private,
        json.dumps(receipt, sort_keys=True, separators=(",", ":")).encode(),
        hashlib.sha256,
    ).hexdigest()


def human_setup(state):
    private = b"native-only-callback-secret-32-bytes"
    supervisor = Supervisor(
        state,
        "lab",
        [rule(trigger_samples=1)],
        human_callback_secret=private,
        allowed_operators=["telegram:123"],
    )
    observe(supervisor, BASE, {})
    receipt = {
        "audience": "lab",
        "operator": "telegram:123",
        "incident": "lab/analysis/queue",
        "revision": 1,
        "action": "silence",
        "reason": "Planned service work",
        "ttl": 60,
        "issued_at": BASE,
        "nonce": "nonce_01234567890",
    }
    return supervisor, private, receipt


def test_signed_human_ack_silence_expiry_and_replay(state):
    supervisor, private, receipt = human_setup(state)
    supervisor.apply_signed_human_decision(receipt, signed(private, receipt), BASE)
    with pytest.raises(ValueError, match="Replayed"):
        supervisor.apply_signed_human_decision(receipt, signed(private, receipt), BASE)
    ack = {**receipt, "action": "ack", "revision": 2, "nonce": "nonce_11234567890"}
    supervisor.apply_signed_human_decision(ack, signed(private, ack), BASE)
    assert supervisor.incidents()["incidents"][0]["state"] == "acknowledged"
    count = len(state.snapshot()["outbox"])
    observe(supervisor, BASE + 30, {})
    assert (
        len(state.snapshot()["outbox"]) == count
    )  # Silenced escalation is retained in journal.
    observe(supervisor, BASE + 61, {})
    incident = supervisor.incidents()["incidents"][0]
    assert incident["ack"] is None and incident["silence"] is None
    assert incident["state"] == "open"
    assert len(state.snapshot()["outbox"]) > count
    assert any(row["kind"] == "silence_expired" for row in state.events()["events"])


@pytest.mark.parametrize(
    "change",
    [
        {"ttl": 86401},
        {"ttl": True},
        {"reason": " "},
        {"operator": "model"},
        {"audience": "other"},
        {"issued_at": BASE - 121},
        {"issued_at": BASE + 1},
        {"revision": 5},
        {"action": "delete"},
        {"human": True},
    ],
)
def test_invalid_or_untrusted_human_decisions_fail_closed(state, change):
    supervisor, private, receipt = human_setup(state)
    receipt.update(change)
    before = state.snapshot()
    with pytest.raises(ValueError):
        supervisor.apply_signed_human_decision(receipt, signed(private, receipt), BASE)
    assert state.snapshot() == before


def test_foreign_signer_read_bearer_and_unsigned_decision_rejected(state):
    supervisor, private, receipt = human_setup(state)
    for signature in (
        signed(b"foreign-read-only-api-token", receipt),
        "read-api-token",
        "",
    ):
        with pytest.raises(ValueError, match="signature"):
            supervisor.apply_signed_human_decision(receipt, signature, BASE)
    closed = Supervisor(state, "lab", [rule()])
    with pytest.raises(ValueError, match="signature"):
        closed.apply_signed_human_decision(receipt, signed(private, receipt), BASE)


def test_job_watches_preserve_uncertainty_cancel_and_later_projection(state):
    supervisor = Supervisor(state, "lab", [rule()])
    supervisor.watch_job("task-1", BASE)
    row = {
        "id": "task-1",
        "status": "completed",
        "updated_at": iso(BASE),
        "execution_status": "partial",
        "verification_status": "unknown",
        "projection_status": "pending",
        "error": "do not retain",
        "cancellation_requested": True,
        "partial_effects": True,
        "children": [{"id": "child", "status": "running"}],
    }
    response = {"availability": "available", "observed_at": iso(BASE), "data": row}
    supervisor.observe_job("task-1", response, BASE)
    supervisor.observe_job("task-1", response, BASE + 30)
    assert len(state.snapshot()["outbox"]) == 1
    latest = state.snapshot()["watches"]["task-1"]["latest"]
    assert (
        latest["verification_status"] == "unknown"
        and latest["projection_status"] == "pending"
    )
    assert latest["children"][0]["status"] == "running" and "error" not in latest
    supervisor.observe_job("task-1", {}, BASE + 60)
    assert state.snapshot()["watches"]["task-1"]["availability"] == "unavailable"
    response["data"] = {
        **row,
        "projection_status": "completed",
        "updated_at": iso(BASE + 90),
    }
    response["observed_at"] = iso(BASE + 90)
    supervisor.observe_job("task-1", response, BASE + 90)
    assert len(state.snapshot()["outbox"]) == 2
    assert state.snapshot()["watches"]["task-1"]["last_source"] == BASE + 90


def test_job_watch_bounds_expiry_and_no_false_completion(state):
    supervisor = Supervisor(state, "lab", [rule()])
    for number in range(30):
        supervisor.watch_job(f"task-{number}", BASE, ttl=60)
    with pytest.raises(CapacityError):
        supervisor.watch_job("overflow", BASE)
    for ttl in (0, 72 * 3600 + 1, True):
        with pytest.raises(ValueError):
            supervisor.watch_job("task-1", BASE, ttl)
    supervisor.observe_job(
        "task-1",
        {
            "availability": "available",
            "observed_at": iso(BASE),
            "data": {"id": "task-1", "status": "pending"},
        },
        BASE,
    )
    assert not state.snapshot()["outbox"]
    supervisor.watch_job("new", BASE + 61)
    assert list(state.snapshot()["watches"]) == ["new"]


@pytest.mark.parametrize(
    "kwargs",
    [
        {"tool": "apply_plan"},
        {"kind": "guess"},
        {"fresh_seconds": 0},
        {"trigger_samples": 0},
        {"kind": "high"},
        {"arguments": {"refresh": True}},
        {"kind": "drift", "field": ["version"]},
        {"source_path": ["a"] * 11},
    ],
)
def test_rule_configuration_closed_and_bounded(kwargs):
    values = {
        "id": "sample",
        "subsystem": "worker",
        "tool": "get_instance_inventory",
        "source_path": ["data"],
    }
    values.update(kwargs)
    with pytest.raises(ValueError):
        Rule(**values)


def test_timestamp_and_source_path_fail_closed():
    assert timestamp("2026-01-01") is None
    assert timestamp("not a date") is None
    assert timestamp(3) is None
    assert timestamp(iso(BASE)) == BASE
    assert path_value({"a": None}, ["a", "b"]) is None


def test_sampled_stuck_task_disappearance_never_proves_recovery(state):
    supervisor = Supervisor(
        state,
        "lab",
        [
            rule(
                kind="stuck",
                field=("heartbeat_at",),
                threshold=100,
                clear_threshold=30,
                trigger_samples=1,
                recovery_samples=1,
            )
        ],
    )
    sample = source(BASE)
    sample["data"] = {
        "rows": [
            {"id": "old-task", "status": "running", "heartbeat_at": iso(BASE - 300)}
        ]
    }
    observe(supervisor, BASE, sample)
    assert supervisor.incidents()["incidents"][0]["state"] == "open"
    sample.update(observed_at=iso(BASE + 30), data={"rows": []})
    observe(supervisor, BASE + 30, sample)
    assert supervisor.incidents()["incidents"][0]["state"] == "open"
    sample.update(
        observed_at=iso(BASE + 60),
        data={
            "rows": [
                {
                    "id": "other-task",
                    "status": "running",
                    "heartbeat_at": iso(BASE + 60),
                }
            ]
        },
    )
    observe(supervisor, BASE + 60, sample)
    assert supervisor.incidents()["incidents"][0]["state"] == "open"
    sample.update(
        observed_at=iso(BASE + 90),
        data={"rows": [{"id": "old-task", "status": "completed"}]},
    )
    observe(supervisor, BASE + 90, sample)
    assert supervisor.incidents()["incidents"][0]["state"] == "resolved"


def test_progress_idle_is_healthy_and_replayed_counter_cannot_rebaseline(state):
    supervisor = Supervisor(
        state,
        "lab",
        [
            rule(
                kind="progress",
                field=("pending",),
                active_field=("backlog",),
                threshold=30,
                trigger_samples=1,
                recovery_samples=1,
            )
        ],
    )
    observe(supervisor, BASE, source(BASE, 10))
    observe(supervisor, BASE + 30, source(BASE, 99))
    assert state.snapshot()["rules"]["lab/analysis/queue"]["value"] == 10
    observe(supervisor, BASE + 60, source(BASE + 60, 10))
    assert supervisor.incidents()["incidents"][0]["state"] == "open"
    idle = source(BASE + 90, 10)
    idle["data"]["backlog"] = 0
    observe(supervisor, BASE + 90, idle)
    assert supervisor.incidents()["incidents"][0]["state"] == "resolved"


def test_coverage_gaps_preserve_per_subsystem_and_missing_metric(state):
    supervisor = Supervisor(state, "lab", [rule(kind="high", field=("absent",))])
    response = {
        "data": {
            "sources": {"worker": source(BASE)},
            "subsystems": {
                "analysis": {"unavailable_signals": ["functional_live_probe"]}
            },
            "unavailable_subsystems": ["storage_integrity"],
        }
    }
    supervisor.observe({supervisor.rules[0].request_key: response}, BASE)
    status = supervisor.status(BASE)
    assert status["coverage_gaps"]["analysis"] == ["functional_live_probe"]
    assert status["coverage_gaps"]["functional_subsystems"] == ["storage_integrity"]
    assert not status["coverage"]["lab/analysis/queue"]["valid"]
    assert status["monitoring_state"] == "degraded"


def test_rule_identity_is_scoped_by_subsystem_and_versions_survive(state):
    first = rule(trigger_samples=1)
    second = Rule(
        "queue",
        "import",
        "get_observability_summary",
        ("data", "sources", "worker"),
        trigger_samples=1,
    )
    supervisor = Supervisor(state, "lab", [first, second])
    sample = source(
        BASE, availability="stale", version={"source_seq": 17, "version": "v1"}
    )
    observe(supervisor, BASE + 200, sample)
    assert {row["key"] for row in supervisor.incidents()["incidents"]} == {
        "lab/analysis/queue",
        "lab/import/queue",
    }
    evidence = supervisor.incidents()["incidents"][0]["evidence"][-1]
    assert evidence["version"]["source_seq"] == 17 and evidence["observed_at"] == iso(
        BASE
    )
    assert evidence["age_seconds"] == 200
    with pytest.raises(ValueError):
        Supervisor(state, "lab", [first, first])
    with pytest.raises(ValueError):
        Supervisor(state, "lab", [first], human_callback_secret=b"short")


def test_progress_reset_does_not_recover_during_new_baseline_window(state):
    supervisor = Supervisor(
        state,
        "lab",
        [
            rule(
                kind="progress",
                field=("pending",),
                active_field=("backlog",),
                threshold=90,
                trigger_samples=1,
                recovery_samples=1,
            )
        ],
    )
    observe(supervisor, BASE, source(BASE, 10))
    observe(supervisor, BASE + 90, source(BASE + 90, 10))
    observe(supervisor, BASE + 120, source(BASE + 120, 0))
    observe(supervisor, BASE + 150, source(BASE + 150, 0))
    assert supervisor.incidents()["incidents"][0]["state"] == "open"


def test_silenced_incident_does_not_fabricate_observer_delivery_failure(state):
    supervisor, secret, receipt = human_setup(state)
    receipt["ttl"] = 3600
    supervisor.apply_signed_human_decision(receipt, signed(secret, receipt), BASE)
    observe(supervisor, BASE + 300, {})
    status = supervisor.status(BASE + 300)
    assert status["state"] == "ok"
    assert status["monitoring_state"] == "degraded"
    assert status["delivery"]["silenced"] == 1
    assert status["delivery"]["oldest_pending_seconds"] == 0
    observe(supervisor, BASE + 3601, {})
    assert supervisor.status(BASE + 3601)["delivery"]["silenced"] == 0


def test_silence_and_bounded_history_survive_same_rule_reopening(state):
    secret = b"native-only-callback-secret-32-bytes"
    supervisor = Supervisor(
        state,
        "lab",
        [rule(kind="high", field=("pending",), trigger_samples=1, recovery_samples=1)],
        human_callback_secret=secret,
        allowed_operators=["telegram:123"],
    )
    observe(supervisor, BASE, source(BASE, 10))
    receipt = {
        "audience": "lab",
        "operator": "telegram:123",
        "incident": "lab/analysis/queue",
        "revision": 1,
        "action": "silence",
        "reason": "Planned service work",
        "ttl": 3600,
        "issued_at": BASE,
        "nonce": "nonce_01234567890",
    }
    supervisor.apply_signed_human_decision(receipt, signed(secret, receipt), BASE)
    observe(supervisor, BASE + 30, source(BASE + 30, 0))
    assert supervisor.incidents()["incidents"][0]["state"] == "resolved"
    observe(supervisor, BASE + 60, source(BASE + 60, 10))
    incident = supervisor.incidents()["incidents"][0]
    assert (
        incident["state"] == "open" and incident["silence"]["expires_at"] == BASE + 3600
    )
    assert len(incident["evidence"]) == 3
    assert len(state.snapshot()["outbox"]) == 1


@pytest.mark.parametrize("terminal", [True, False])
def test_sampled_stuck_default_recovery_keeps_ids_through_hysteresis(state, terminal):
    supervisor = Supervisor(
        state,
        "lab",
        [
            rule(
                kind="stuck", field=("heartbeat_at",), threshold=100, clear_threshold=30
            )
        ],
    )
    for step in range(2):
        sample = source(BASE + step * 30)
        sample["data"] = {
            "rows": [
                {"id": "tracked", "status": "running", "heartbeat_at": iso(BASE - 300)}
            ]
        }
        observe(supervisor, BASE + step * 30, sample)
    assert supervisor.incidents()["incidents"][0]["state"] == "open"
    for step in (2, 3):
        now = BASE + step * 30
        row = (
            {"id": "tracked", "status": "completed"}
            if terminal
            else {"id": "tracked", "status": "running", "heartbeat_at": iso(now)}
        )
        sample = source(now)
        sample["data"] = {"rows": [row]}
        observe(supervisor, now, sample)
        if step == 2:
            assert supervisor.incidents()["incidents"][0]["state"] == "open"
            assert state.snapshot()["rules"]["lab/analysis/queue"]["stuck_ids"] == [
                "tracked"
            ]
    assert supervisor.incidents()["incidents"][0]["state"] == "resolved"
    assert state.snapshot()["rules"]["lab/analysis/queue"]["stuck_ids"] == []


def test_accumulated_stuck_identity_overflow_cannot_resolve_from_partial_sample(state):
    configured = rule(
        kind="stuck",
        field=("heartbeat_at",),
        threshold=100,
        clear_threshold=30,
        trigger_samples=1,
        recovery_samples=1,
    )
    supervisor = Supervisor(state, "lab", [configured])
    sample = source(BASE)
    sample["data"] = {
        "rows": [
            {
                "id": f"tracked-{number}",
                "status": "running",
                "heartbeat_at": iso(BASE - 300),
            }
            for number in range(20)
        ]
    }
    observe(supervisor, BASE, sample)
    sample.update(
        observed_at=iso(BASE + 30),
        data={
            "rows": [
                {
                    "id": "overflow-task",
                    "status": "running",
                    "heartbeat_at": iso(BASE - 300),
                }
            ]
        },
    )
    observe(supervisor, BASE + 30, sample)
    sample.update(
        observed_at=iso(BASE + 60),
        data={
            "rows": [
                {"id": f"tracked-{number}", "status": "completed"}
                for number in range(20)
            ]
        },
    )
    observe(supervisor, BASE + 60, sample)
    assert supervisor.incidents()["incidents"][0]["state"] == "open"
    memory = state.snapshot()["rules"]["lab/analysis/queue"]
    assert len(memory["stuck_ids"]) <= 20 and memory["stuck_tracking_overflow"]
    evidence = supervisor.incidents()["incidents"][0]["evidence"][-1]
    assert evidence["stuck_tracking_overflow"] and not evidence["valid"]
    state.close()
    reopened = State(state.directory)
    try:
        supervisor = Supervisor(reopened, "lab", [configured])
        sample["observed_at"] = iso(BASE + 90)
        observe(supervisor, BASE + 90, sample)
        assert supervisor.incidents()["incidents"][0]["state"] == "open"
    finally:
        reopened.close()


@pytest.mark.parametrize("previously_resolved", [False, True])
def test_transient_pre_trigger_recovery_does_not_block_later_incident(
    state, previously_resolved
):
    supervisor = Supervisor(
        state,
        "lab",
        [
            rule(
                kind="stuck", field=("heartbeat_at",), threshold=100, clear_threshold=30
            )
        ],
    )
    step = 0

    def sample_task(job_id, status):
        nonlocal step
        now = BASE + 30 * step
        step += 1
        sample = source(now)
        sample["data"] = {
            "rows": [{"id": job_id, "status": status, "heartbeat_at": iso(now - 300)}]
        }
        observe(supervisor, now, sample)

    if previously_resolved:
        for status in ("running", "running", "completed", "completed"):
            sample_task("previous", status)
        assert supervisor.incidents()["incidents"][0]["state"] == "resolved"

    sample_task("transient", "running")
    sample_task("transient", "completed")
    assert state.snapshot()["rules"]["lab/analysis/queue"]["stuck_ids"] == ["transient"]
    sample_task("transient", "completed")
    assert all(
        item["state"] == "resolved" for item in supervisor.incidents()["incidents"]
    )
    assert state.snapshot()["rules"]["lab/analysis/queue"]["stuck_ids"] == []

    # The old task is now outside the bounded source sample. Its already proven
    # recovery must not prevent a new task's independent incident from clearing.
    sample_task("later", "running")
    sample_task("later", "running")
    assert supervisor.incidents()["incidents"][0]["state"] == "open"
    sample_task("later", "completed")
    assert supervisor.incidents()["incidents"][0]["state"] == "open"
    sample_task("later", "completed")
    assert supervisor.incidents()["incidents"][0]["state"] == "resolved"
    assert state.snapshot()["rules"]["lab/analysis/queue"]["stuck_ids"] == []

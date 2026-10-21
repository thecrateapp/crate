"""Bounded runtime configuration, persisted CAS and observed consumer adoption."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from threading import Barrier
from unittest.mock import Mock

import pytest
from sqlalchemy import text

from crate import agent_runtime, resource_governor, scheduler
from crate.agent_diagnostics import DiagnosticError
from crate.db.queries.agent_runtime_policy import decode_schedules
from crate.db.repositories import runtime_policy
from crate.db.repositories.tasks import create_task, start_task, update_task
from crate.db.tx import read_scope, transaction_scope
from crate.runtime_policy_contract import (
    ADOPTION_COMPONENTS,
    POOLS,
    SCHEDULE_MAX_INTERVAL,
    default_runtime_policy,
    merge_runtime_policy,
    policy_hash,
    validate_runtime_policy,
    window_status,
)


@pytest.fixture
def isolated_policy_env(monkeypatch):
    for name in (
        "CRATE_RESOURCE_GOVERNOR_ENABLED",
        "CRATE_RESOURCE_MAX_LOAD_RATIO",
        "CRATE_RESOURCE_MAX_IOWAIT_PERCENT",
        "CRATE_RESOURCE_MAX_SWAP_PERCENT",
        "CRATE_RESOURCE_MIN_SWAP_USED_MB",
        "CRATE_RESOURCE_MIN_MEMORY_AVAILABLE_PERCENT",
        "CRATE_RESOURCE_MAX_ACTIVE_USERS",
        "CRATE_RESOURCE_MAX_ACTIVE_STREAMS",
        "CRATE_RESOURCE_DEFER_SECONDS",
        "CRATE_MAINTENANCE_WINDOW_ENABLED",
        "CRATE_MAINTENANCE_WINDOW_START",
        "CRATE_MAINTENANCE_WINDOW_END",
        "CRATE_MAINTENANCE_WINDOW_FINGERPRINT_LIMIT",
        "TZ",
    ):
        monkeypatch.delenv(name, raising=False)


def _task_state(task_id):
    with read_scope() as session:
        return dict(
            session.execute(text("SELECT * FROM tasks WHERE id=:id"), {"id": task_id})
            .mappings()
            .one()
        )


def test_default_policy_is_bounded_and_does_not_mutate_legacy_settings(
    isolated_policy_env,
):
    settings = {"download_max_active_users": "3", "download_window_enabled": "true"}
    before = dict(settings)
    policy = default_runtime_policy(settings)
    assert set(policy["pools"]) == set(POOLS)
    assert policy["downloads"]["max_active_users"] == 3
    assert policy["download_window"]["enabled"] is True
    assert validate_runtime_policy(policy) == policy
    assert settings == before


@pytest.mark.parametrize(
    "patch",
    [
        {},
        {"unknown": 1},
        {"pools": {}},
        {"pools": {"other": 1}},
        {"pools": {"heavy": True}},
        {"pools": {"heavy": "2"}},
        {"pools": {"heavy": 0}},
        {"pools": {"heavy": 65}},
        {"max_running": 0},
        {"max_running": True},
        {"max_running": 1},
        {"governor": {"enabled": "true"}},
        {"governor": {"max_load_ratio": 0}},
        {"governor": {"max_iowait_percent": 101}},
        {"governor": {"defer_seconds": 0}},
        {"downloads": {"max_active_users": -1}},
        {"maintenance_window": {"start": "24:00"}},
        {"maintenance_window": {"end": "02:60"}},
        {"download_window": {"start": "2:00"}},
        {"download_window": {"timezone": "Europe/Unknown"}},
        {"download_window": {"timezone": "../../etc/passwd"}},
    ],
)
def test_runtime_patch_rejects_unknown_or_invalid_configuration(
    isolated_policy_env, patch
):
    with pytest.raises(ValueError):
        merge_runtime_policy(default_runtime_policy(), patch)


def test_runtime_patch_is_pure_and_hash_order_is_stable(isolated_policy_env):
    policy = default_runtime_policy()
    changed = merge_runtime_policy(policy, {"pools": {"heavy": 2}})
    assert policy["pools"]["heavy"] == 64
    assert changed["pools"]["heavy"] == 2
    assert policy_hash({"b": 2, "a": 1}) == policy_hash({"a": 1, "b": 2})
    assert policy_hash(policy) != policy_hash(changed)


@pytest.mark.parametrize(
    ("instant", "expected", "delay"),
    [
        ("2026-10-16T20:00:00+00:00", True, 0),
        ("2026-10-16T00:00:00+00:00", False, 20 * 3600),
        ("2026-10-16T19:59:30+00:00", False, 30),
    ],
)
def test_overnight_window_uses_configured_iana_timezone(instant, expected, delay):
    window = {
        "enabled": True,
        "start": "22:00",
        "end": "02:00",
        "timezone": "Europe/Madrid",
    }
    status = window_status(window, now=datetime.fromisoformat(instant))
    assert status["in_window"] is expected
    assert status["seconds_until_start"] == delay


@pytest.mark.parametrize(
    ("instant", "start", "end", "expected", "delay"),
    [
        ("2026-03-29T00:30:00+00:00", "02:30", "04:00", False, 1800),
        ("2026-03-29T01:15:00+00:00", "02:30", "04:00", True, 0),
        ("2026-10-25T00:45:00+00:00", "02:30", "03:00", True, 0),
        ("2026-10-25T01:45:00+00:00", "02:30", "03:00", True, 0),
    ],
)
def test_window_handles_daylight_saving_gap_and_both_repeated_instants(
    instant, start, end, expected, delay
):
    status = window_status(
        {"enabled": True, "start": start, "end": end, "timezone": "Europe/Madrid"},
        now=datetime.fromisoformat(instant),
    )
    assert status["in_window"] is expected
    assert status["seconds_until_start"] == delay


def test_window_rejects_naive_instant_and_disabled_window_is_open():
    window = {"enabled": False, "start": "02:00", "end": "07:00", "timezone": "UTC"}
    with pytest.raises(ValueError, match="aware"):
        window_status(window, now=datetime(2026, 10, 16, 12))
    assert (
        window_status(window, now=datetime(2026, 10, 16, 12, tzinfo=timezone.utc))[
            "in_window"
        ]
        is True
    )


@pytest.mark.parametrize(
    "raw",
    [
        None,
        "null",
        "[]",
        "not-json",
        '{"unknown": 1, "compute_analytics": true}',
        '{"compute_analytics": -1}',
    ],
)
def test_decode_schedules_preserves_closed_defaults_for_invalid_storage(raw):
    assert decode_schedules(raw) == scheduler.DEFAULT_SCHEDULES


def test_decode_schedules_migrates_legacy_alias_in_memory():
    assert decode_schedules('{"library_sync": 600}')["library_pipeline"] == 600
    assert "library_sync" not in decode_schedules('{"library_sync": 600}')


def test_runtime_and_schedule_default_reads_do_not_write(pg_db, isolated_policy_env):
    with read_scope() as session:
        before = list(
            session.execute(text("SELECT key,value FROM settings ORDER BY key"))
        )
    runtime = runtime_policy.read_runtime_policy_state()
    schedules = runtime_policy.read_schedules_state()
    assert runtime["configured_revision"] == 0
    assert runtime["effective_revision"] is None
    assert schedules["schedules"] == scheduler.DEFAULT_SCHEDULES
    with read_scope() as session:
        assert (
            list(session.execute(text("SELECT key,value FROM settings ORDER BY key")))
            == before
        )
        assert (
            session.execute(
                text("SELECT COUNT(*) FROM agent_runtime_policy")
            ).scalar_one()
            == 0
        )


def test_runtime_compare_and_swap_updates_legacy_download_fields_atomically(
    pg_db, isolated_policy_env
):
    initial = runtime_policy.read_runtime_policy_state()
    patch = {
        "pools": {"heavy": 1},
        "download_window": {"enabled": True, "timezone": "Europe/Madrid"},
        "downloads": {"max_active_users": 2},
    }
    updated = runtime_policy.update_runtime_policy(
        patch, expected_revision=0, expected_policy_hash=initial["policy_hash"]
    )
    assert updated["configured_revision"] == 1
    assert updated["effective_revision"] is None
    assert updated["policy"]["pools"]["heavy"] == 1
    with pytest.raises(ValueError, match="revision changed"):
        runtime_policy.update_runtime_policy(
            {"pools": {"heavy": 2}}, expected_revision=0
        )
    with read_scope() as session:
        settings = dict(
            session.execute(
                text("SELECT key,value FROM settings WHERE key LIKE 'download_%'")
            ).all()
        )
    assert settings["download_window_timezone"] == "Europe/Madrid"
    assert settings["download_window_enabled"] == "true"
    assert settings["download_max_active_users"] == "2"
    assert runtime_policy.read_runtime_policy_state()["policy"] == updated["policy"]


def test_runtime_hash_detects_environment_change_before_first_persisted_revision(
    pg_db, isolated_policy_env, monkeypatch
):
    initial = runtime_policy.read_runtime_policy_state()
    monkeypatch.setenv("CRATE_RESOURCE_MAX_LOAD_RATIO", "0.4")
    with pytest.raises(ValueError, match="revision changed"):
        runtime_policy.update_runtime_policy(
            {"pools": {"heavy": 2}},
            expected_revision=0,
            expected_policy_hash=initial["policy_hash"],
        )
    assert runtime_policy.read_runtime_policy_state()["configured_revision"] == 0


def test_concurrent_runtime_updates_cannot_overwrite_the_same_revision(
    pg_db, isolated_policy_env
):
    barrier = Barrier(2)

    def change(slots):
        barrier.wait(timeout=10)
        try:
            runtime_policy.update_runtime_policy(
                {"pools": {"heavy": slots}}, expected_revision=0
            )
            return "updated"
        except ValueError as error:
            assert "revision changed" in str(error)
            return "conflict"

    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sorted(executor.map(change, [1, 2])) == ["conflict", "updated"]
    assert runtime_policy.read_runtime_policy_state()["configured_revision"] == 1


def test_schedule_compare_and_swap_preserves_other_defaults(pg_db):
    initial = runtime_policy.read_schedules_state()
    updated = runtime_policy.update_schedules(
        {"compute_analytics": 0}, expected_revision=initial["revision"]
    )
    assert updated["revision"] != initial["revision"]
    assert updated["schedules"]["compute_analytics"] == 0
    assert (
        updated["schedules"]["library_pipeline"]
        == scheduler.DEFAULT_SCHEDULES["library_pipeline"]
    )
    with pytest.raises(ValueError, match="revision changed"):
        runtime_policy.update_schedules(
            {"sync_shows": 1}, expected_revision=initial["revision"]
        )


@pytest.mark.parametrize(
    "patch",
    [
        {"unknown": 1},
        {"compute_analytics": True},
        {"compute_analytics": -1},
        {"compute_analytics": SCHEDULE_MAX_INTERVAL + 1},
    ],
)
def test_schedule_updates_reject_unbounded_or_noninteger_values(pg_db, patch):
    before = runtime_policy.read_schedules_state()
    with pytest.raises(ValueError):
        runtime_policy.update_schedules(patch, expected_revision=before["revision"])
    assert runtime_policy.read_schedules_state()["revision"] == before["revision"]


def test_runtime_plan_records_exact_before_after_and_adoption_is_separate(
    pg_db, isolated_policy_env
):
    before = runtime_policy.read_runtime_policy_state()
    compiled = agent_runtime.compile_operation(
        "runtime_update", {"expected_revision": 0, "patch": {"pools": {"heavy": 2}}}, {}
    )
    change = compiled["document"]["changes"][0]
    assert change["before"] == before["policy"]
    assert change["after"]["pools"]["heavy"] == 2
    assert compiled["document"]["risk"] == "high"
    assert compiled["document"]["impact"]["process_resize"] is False
    calls = []
    result = agent_runtime.apply_operation(
        "runtime_update",
        compiled["execution"],
        {},
        task_id="plan-runtime",
        authorize=lambda fn: (calls.append("authorized"), fn())[1],
    )
    assert calls == ["authorized"]
    assert result["execution"]["configured_revision"] == 1
    assert result["execution"]["effective_revision"] is None
    assert result["verification"]["status"] == "configuration_persisted"


def test_schedule_plan_conflicts_after_admin_configuration_change(pg_db):
    before = runtime_policy.read_schedules_state()
    compiled = agent_runtime.compile_operation(
        "schedule_update",
        {
            "schedule": "compute_analytics",
            "interval_seconds": 600,
            "expected_revision": before["revision"],
        },
        {},
    )
    assert (
        compiled["document"]["changes"][0]["before"]
        == scheduler.DEFAULT_SCHEDULES["compute_analytics"]
    )
    assert compiled["document"]["changes"][0]["after"] == 600
    runtime_policy.update_schedules(
        {"sync_shows": 900}, expected_revision=before["revision"]
    )
    with pytest.raises(DiagnosticError, match="revision changed"):
        agent_runtime.apply_operation(
            "schedule_update",
            compiled["execution"],
            {},
            task_id="plan-schedule",
            authorize=lambda fn: fn(),
        )
    assert (
        runtime_policy.read_schedules_state()["schedules"]["compute_analytics"]
        == scheduler.DEFAULT_SCHEDULES["compute_analytics"]
    )


@pytest.mark.parametrize(
    ("operation", "parameters"),
    [
        (
            "runtime_update",
            {"expected_revision": True, "patch": {"pools": {"heavy": 2}}},
        ),
        (
            "runtime_update",
            {"expected_revision": 0, "patch": {"pools": {"heavy": 2}}, "force": True},
        ),
        (
            "schedule_update",
            {
                "schedule": "unknown",
                "interval_seconds": 1,
                "expected_revision": "revision",
            },
        ),
        (
            "schedule_update",
            {
                "schedule": "compute_analytics",
                "interval_seconds": True,
                "expected_revision": "revision",
            },
        ),
        ("unsupported", {}),
    ],
)
def test_runtime_adapter_rejects_unknown_parameters_and_operations(
    pg_db, operation, parameters
):
    with pytest.raises(ValueError):
        agent_runtime.compile_operation(operation, parameters, {})


def test_adoption_requires_fresh_evidence_for_every_exact_revision_component(
    pg_db, isolated_policy_env
):
    state = runtime_policy.update_runtime_policy(
        {"pools": {"heavy": 2}}, expected_revision=0
    )
    assert state["pending_components"] == sorted(ADOPTION_COMPONENTS)
    for component in ADOPTION_COMPONENTS:
        runtime_policy.record_runtime_adoption(
            component,
            state["configured_revision"],
            state["policy_hash"],
            consumer_id="worker-current",
        )
    assert runtime_policy.read_runtime_policy_state()["effective_revision"] == 1
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE agent_runtime_adoptions SET observed_at=NOW()-INTERVAL '91 seconds' WHERE component='pool:heavy'"
            )
        )
    stale = runtime_policy.read_runtime_policy_state()
    assert stale["effective_revision"] is None
    assert stale["pending_components"] == ["pool:heavy"]
    runtime_policy.record_runtime_adoption(
        "pool:heavy", 0, state["policy_hash"], consumer_id="worker-current"
    )
    assert runtime_policy.read_runtime_policy_state()["pending_components"] == [
        "pool:heavy"
    ]
    runtime_policy.record_runtime_adoption(
        "pool:heavy", 1, "0" * 64, consumer_id="worker-current"
    )
    assert runtime_policy.read_runtime_policy_state()["effective_revision"] is None
    runtime_policy.record_runtime_adoption(
        "pool:heavy", 1, state["policy_hash"], consumer_id="worker-current"
    )
    assert runtime_policy.read_runtime_policy_state()["effective_revision"] == 1


def test_a_heartbeat_does_not_prove_runtime_adoption(pg_db, isolated_policy_env):
    from crate.db.cache_settings import set_setting

    set_setting("worker_status", '{"running":true,"revision":0}')
    task_id = create_task("compute_analytics", dispatch=False)
    update_task(task_id, status="running")
    assert runtime_policy.read_runtime_policy_state()["effective_revision"] is None
    assert runtime_policy.read_runtime_policy_state()["adoptions"] == []


def test_a_live_consumer_using_the_old_revision_prevents_effective_status(
    pg_db, isolated_policy_env
):
    state = runtime_policy.update_runtime_policy(
        {"pools": {"heavy": 2}}, expected_revision=0
    )
    for component in ADOPTION_COMPONENTS:
        runtime_policy.record_runtime_adoption(
            component, 1, state["policy_hash"], consumer_id="current"
        )
    runtime_policy.record_runtime_adoption(
        "governor", 0, "0" * 64, consumer_id="not-yet-refreshed"
    )
    pending = runtime_policy.read_runtime_policy_state()
    assert pending["effective_revision"] is None
    assert pending["pending_components"] == ["governor"]


def test_adoption_aggregate_includes_live_old_consumer_outside_detail_limit(
    pg_db, isolated_policy_env
):
    state = runtime_policy.update_runtime_policy(
        {"pools": {"heavy": 2}}, expected_revision=0
    )
    for component in ADOPTION_COMPONENTS:
        runtime_policy.record_runtime_adoption(
            component, 1, state["policy_hash"], consumer_id="current"
        )
    with transaction_scope() as session:
        session.execute(
            text("""INSERT INTO agent_runtime_adoptions
                (consumer_id,component,revision,policy_hash,observed_at)
                SELECT 'current:'||n,'governor',1,:hash,NOW()
                FROM generate_series(1,260) n"""),
            {"hash": state["policy_hash"]},
        )
        session.execute(
            text("""INSERT INTO agent_runtime_adoptions
                (consumer_id,component,revision,policy_hash,observed_at)
                VALUES('hidden-old-consumer','governor',0,:hash,
                    NOW()-INTERVAL '30 seconds')"""),
            {"hash": "0" * 64},
        )
    observed = runtime_policy.read_runtime_policy_state()
    assert len(observed["adoptions"]) == 256
    assert all(
        row["consumer_id"] != "hidden-old-consumer" for row in observed["adoptions"]
    )
    assert observed["effective_revision"] is None
    assert observed["pending_components"] == ["governor"]


@pytest.mark.parametrize(
    ("component", "revision", "fingerprint"),
    [
        ("heartbeat", 1, "a" * 64),
        ("governor", -1, "a" * 64),
        ("governor", True, "a" * 64),
        ("governor", 1, "invalid"),
    ],
)
def test_runtime_adoption_rejects_invalid_evidence(component, revision, fingerprint):
    with pytest.raises(ValueError):
        runtime_policy.record_runtime_adoption(component, revision, fingerprint)


def test_configured_governor_uses_exact_revision_before_recording_adoption(
    pg_db, isolated_policy_env, monkeypatch
):
    state = runtime_policy.update_runtime_policy(
        {"governor": {"max_load_ratio": 0.2, "defer_seconds": 123}}, expected_revision=0
    )
    monkeypatch.setenv("CRATE_RESOURCE_MAX_LOAD_RATIO", "8")
    sequence = []
    original = runtime_policy.record_runtime_adoption

    def sample(include_playback=True):
        sequence.append("sample")
        return resource_governor.ResourceSnapshot(
            cpu_count=4, load_ratio=0.5, active_users=0, active_streams=0
        )

    def ack(component, revision, fingerprint):
        sequence.append(component)
        assert sequence[0] == "sample"
        original(component, revision, fingerprint, consumer_id="governor-test")

    monkeypatch.setattr(resource_governor, "build_snapshot", sample)
    monkeypatch.setattr(runtime_policy, "record_runtime_adoption", ack)
    decision = resource_governor.evaluate_resources(label="analysis-daemon")
    assert decision.allowed is False
    assert decision.reason == "load 0.50>0.20"
    assert decision.defer_seconds == 123
    assert decision.policy_revision == state["configured_revision"]
    assert decision.policy_hash == state["policy_hash"]
    assert sequence == ["sample", "governor"]
    assert (
        runtime_policy.read_runtime_policy_state()["adoptions"][0]["component"]
        == "governor"
    )


def test_governor_does_not_ack_a_revision_when_evaluation_fails(
    pg_db, isolated_policy_env, monkeypatch
):
    runtime_policy.update_runtime_policy({"pools": {"heavy": 2}}, expected_revision=0)
    monkeypatch.setattr(
        resource_governor,
        "build_snapshot",
        Mock(side_effect=RuntimeError("sampler failed")),
    )
    with pytest.raises(RuntimeError, match="sampler failed"):
        resource_governor.evaluate_resources()
    assert runtime_policy.read_runtime_policy_state()["adoptions"] == []


def test_bypassed_task_does_not_acknowledge_consumers_that_never_evaluated_policy(
    pg_db, isolated_policy_env, monkeypatch
):
    runtime_policy.update_runtime_policy({"pools": {"heavy": 2}}, expected_revision=0)
    sample = Mock()
    monkeypatch.setattr(resource_governor, "build_snapshot", sample)

    assert resource_governor.should_defer_task("agent_control").allowed is True
    assert runtime_policy.read_runtime_policy_state()["adoptions"] == []
    sample.assert_not_called()

    resource_governor.evaluate_maintenance_window(task_type="compute_analytics")
    assert {
        row["component"]
        for row in runtime_policy.read_runtime_policy_state()["adoptions"]
    } == {"maintenance_window"}


def test_governor_defers_when_persisted_policy_cannot_be_read(monkeypatch):
    monkeypatch.setattr(
        runtime_policy,
        "read_runtime_policy_state",
        Mock(side_effect=ValueError("no runtime store")),
    )
    sample = Mock()
    ack = Mock()
    monkeypatch.setattr(resource_governor, "build_snapshot", sample)
    monkeypatch.setattr(runtime_policy, "record_runtime_adoption", ack)
    assert resource_governor.should_defer_task("compute_analytics").allowed is False
    sample.assert_not_called()
    ack.assert_not_called()


def test_admission_serializes_concurrent_claims_for_a_single_slot(
    pg_db, isolated_policy_env
):
    runtime_policy.update_runtime_policy({"pools": {"heavy": 1}}, expected_revision=0)
    ids = [
        create_task("compute_analytics", pool="heavy", dispatch=False) for _ in range(2)
    ]
    barrier = Barrier(2)

    def claim(task_id):
        barrier.wait(timeout=10)
        return start_task(task_id, worker_id=f"worker:{task_id}")

    with ThreadPoolExecutor(max_workers=2) as executor:
        claims = list(executor.map(claim, ids))
    assert sum(claim is not None for claim in claims) == 1
    assert sorted(_task_state(task_id)["status"] for task_id in ids) == [
        "pending",
        "running",
    ]
    state = runtime_policy.read_runtime_policy_state()
    assert any(
        row["component"] == "pool:heavy" and row["revision"] == 1
        for row in state["adoptions"]
    )


def test_lowering_slots_keeps_running_tasks_and_defers_new_claim_until_capacity_returns(
    pg_db, isolated_policy_env
):
    runtime_policy.update_runtime_policy({"pools": {"heavy": 2}}, expected_revision=0)
    ids = [
        create_task("compute_analytics", pool="heavy", dispatch=False) for _ in range(3)
    ]
    assert start_task(ids[0]) is not None
    assert start_task(ids[1]) is not None
    runtime_policy.update_runtime_policy({"pools": {"heavy": 1}}, expected_revision=1)
    assert start_task(ids[2]) is None
    assert [_task_state(task_id)["status"] for task_id in ids] == [
        "running",
        "running",
        "pending",
    ]
    update_task(ids[0], status="completed")
    assert start_task(ids[2]) is None
    update_task(ids[1], status="completed")
    assert start_task(ids[2]) is not None


def test_global_admission_limit_applies_across_pools(pg_db, isolated_policy_env):
    runtime_policy.update_runtime_policy(
        {"max_running": 1, "pools": dict.fromkeys(POOLS, 1)}, expected_revision=0
    )
    first = create_task("compute_analytics", pool="heavy", dispatch=False)
    second = create_task("compute_analytics", pool="maintenance", dispatch=False)
    assert start_task(first) is not None
    assert start_task(second) is None
    assert _task_state(second)["status"] == "pending"


def test_control_reservation_is_independent_and_limited_to_one_running_command(
    pg_db, isolated_policy_env
):
    runtime_policy.update_runtime_policy(
        {"max_running": 1, "pools": dict.fromkeys(POOLS, 1)}, expected_revision=0
    )
    work = create_task("compute_analytics", pool="maintenance", dispatch=False)
    controls = [create_task("agent_control", dispatch=False) for _ in range(2)]
    assert start_task(work) is not None
    assert start_task(controls[0]) is not None
    assert start_task(controls[1]) is None
    row = _task_state(controls[0])
    assert row["pool"] == "fast"
    assert row["max_duration_sec"] == 60
    assert row["max_retries"] == 0
    assert _task_state(work)["status"] == "running"

    update_task(controls[0], status="completed")
    assert start_task(controls[1]) is not None
    update_task(work, status="completed")
    next_work = create_task("compute_analytics", pool="maintenance", dispatch=False)
    assert start_task(next_work) is not None


@pytest.mark.parametrize("change", ["revision", "environment_hash"])
def test_claim_rejects_a_resource_decision_from_an_older_policy(
    pg_db, isolated_policy_env, monkeypatch, change
):
    before = runtime_policy.read_runtime_policy_state()
    task_id = create_task("compute_analytics", dispatch=False)
    if change == "revision":
        runtime_policy.update_runtime_policy(
            {"pools": {"heavy": 2}}, expected_revision=0
        )
    else:
        monkeypatch.setenv("CRATE_RESOURCE_MAX_LOAD_RATIO", "0.25")
    after = runtime_policy.read_runtime_policy_state()
    assert after["policy_hash"] != before["policy_hash"]

    assert (
        start_task(
            task_id,
            worker_id="stale-worker",
            expected_policy_revision=before["configured_revision"],
            expected_policy_hash=before["policy_hash"],
        )
        is None
    )
    row = _task_state(task_id)
    assert row["status"] == "pending"
    assert row["worker_id"] is None
    assert (
        start_task(
            task_id,
            worker_id="current-worker",
            expected_policy_revision=after["configured_revision"],
            expected_policy_hash=after["policy_hash"],
        )
        is not None
    )


def test_empty_legacy_pool_occupies_a_default_pool_slot(pg_db, isolated_policy_env):
    runtime_policy.update_runtime_policy({"pools": {"default": 1}}, expected_revision=0)
    running = create_task("compute_analytics", pool="default", dispatch=False)
    assert start_task(running) is not None
    with transaction_scope() as session:
        session.execute(text("UPDATE tasks SET pool='' WHERE id=:id"), {"id": running})
    pending = create_task("compute_analytics", pool="default", dispatch=False)
    assert start_task(pending) is None
    assert _task_state(running)["status"] == "running"
    assert _task_state(pending)["status"] == "pending"


def test_guarded_schedule_cannot_bypass_pressure_or_dependencies(monkeypatch):
    enqueue = Mock()
    monkeypatch.setattr(runtime_policy, "enqueue_schedule", enqueue)
    monkeypatch.setattr(resource_governor, "record_decision", Mock())
    monkeypatch.setattr(
        resource_governor,
        "should_defer_task",
        lambda *_: resource_governor.ResourceDecision(
            allowed=False, reason="busy", defer_seconds=45
        ),
    )
    deferred = scheduler.guarded_run_schedule(
        "compute_analytics", origin="admin", actor_user_id=1
    )
    assert deferred["status"] == "deferred"
    assert deferred["retry_after"] == 45
    enqueue.assert_not_called()
    monkeypatch.setattr(
        resource_governor,
        "should_defer_task",
        lambda *_: resource_governor.ResourceDecision(allowed=True),
    )
    monkeypatch.setattr(scheduler, "_scheduled_task_enabled", lambda *_: False)
    assert (
        scheduler.guarded_run_schedule("federation_health_poll")["status"]
        == "unavailable"
    )
    enqueue.assert_not_called()


def test_agent_schedule_catalog_does_not_expose_unbounded_operations(monkeypatch):
    enqueue = Mock()
    monkeypatch.setattr(runtime_policy, "enqueue_schedule", enqueue)
    for schedule in scheduler.DEFAULT_SCHEDULES.keys() - {"compute_analytics"}:
        assert (
            scheduler.guarded_run_schedule(schedule, origin="agent")["status"]
            == "unavailable"
        )
    with pytest.raises(ValueError, match="Unknown schedule"):
        scheduler.guarded_run_schedule("arbitrary_actor")
    enqueue.assert_not_called()


def test_guarded_schedule_rejects_unknown_origin_before_checking_resources(monkeypatch):
    sample = Mock()
    enqueue = Mock()
    monkeypatch.setattr(resource_governor, "should_defer_task", sample)
    monkeypatch.setattr(runtime_policy, "enqueue_schedule", enqueue)
    with pytest.raises(ValueError, match="Unsupported schedule origin"):
        scheduler.guarded_run_schedule("compute_analytics", origin="unknown")
    sample.assert_not_called()
    enqueue.assert_not_called()


@pytest.mark.parametrize("name", ["compute_analytics", "global_catalog_reconcile_full"])
def test_guarded_enqueue_preserves_schedule_identity_and_deduplicates(
    pg_db, isolated_policy_env, monkeypatch, name
):
    from crate.db.repositories import tasks_mutations
    from crate.task_dedup_keys import GLOBAL_CATALOG_FULL_DEDUP_KEY

    monkeypatch.setattr(tasks_mutations, "dispatch_task", Mock())
    monkeypatch.setattr(scheduler, "_has_conflicting_full_sync", lambda: False)
    state = runtime_policy.read_runtime_policy_state()
    monkeypatch.setattr(
        resource_governor,
        "should_defer_task",
        lambda *_: resource_governor.ResourceDecision(
            allowed=True,
            policy_revision=state["configured_revision"],
            policy_hash=state["policy_hash"],
        ),
    )
    first = scheduler.guarded_run_schedule(name)
    assert first["status"] == "queued"
    task = _task_state(first["task_id"])
    assert task["dedup_key"] == (
        GLOBAL_CATALOG_FULL_DEDUP_KEY
        if name == "global_catalog_reconcile_full"
        else f"schedule:{name}"
    )
    assert task["schedule_name"] == name
    assert scheduler.guarded_run_schedule(name)["status"] == "already_queued"
    assert runtime_policy.read_schedules_state()["last_enqueued_at"][name] is not None
    assert name not in runtime_policy.read_schedules_state()["last_succeeded_at"]
    update_task(first["task_id"], status="completed")
    assert name in runtime_policy.read_schedules_state()["last_succeeded_at"]


def test_disabled_schedule_never_enqueues_or_advances_timestamp(
    pg_db, isolated_policy_env, monkeypatch
):
    current = runtime_policy.read_schedules_state()
    runtime_policy.update_schedules(
        {"compute_analytics": 0}, expected_revision=current["revision"]
    )
    policy = runtime_policy.read_runtime_policy_state()
    monkeypatch.setattr(
        resource_governor,
        "should_defer_task",
        lambda *_: resource_governor.ResourceDecision(
            allowed=True,
            policy_revision=policy["configured_revision"],
            policy_hash=policy["policy_hash"],
        ),
    )
    assert scheduler.guarded_run_schedule("compute_analytics")["status"] == "disabled"
    state = runtime_policy.read_schedules_state()
    assert state["last_enqueued_at"]["compute_analytics"] is None
    assert "compute_analytics" not in state["last_succeeded_at"]


def test_schedule_rejects_policy_change_after_resource_decision(
    pg_db, isolated_policy_env
):
    policy = runtime_policy.read_runtime_policy_state()
    decision = resource_governor.ResourceDecision(
        allowed=True,
        policy_revision=policy["configured_revision"],
        policy_hash=policy["policy_hash"],
    )
    runtime_policy.update_runtime_policy({"pools": {"heavy": 2}}, expected_revision=0)
    with pytest.raises(ValueError, match="policy changed"):
        runtime_policy.enqueue_schedule(
            "compute_analytics",
            origin="scheduler",
            actor_user_id=None,
            agent_context=None,
            required_grants=None,
            decision=decision,
        )
    assert (
        runtime_policy.read_schedules_state()["last_enqueued_at"]["compute_analytics"]
        is None
    )


def test_unrelated_completed_task_does_not_prove_schedule_success(pg_db):
    task_id = create_task("compute_analytics", dispatch=False)
    update_task(task_id, status="completed")
    assert (
        "compute_analytics"
        not in runtime_policy.read_schedules_state()["last_succeeded_at"]
    )


def test_rolled_back_schedule_neither_dispatches_nor_records_enqueue(
    pg_db, isolated_policy_env, monkeypatch
):
    from crate.db.repositories import tasks_mutations

    dispatch = Mock()
    monkeypatch.setattr(tasks_mutations, "dispatch_task", dispatch)
    state = runtime_policy.read_runtime_policy_state()
    decision = resource_governor.ResourceDecision(
        allowed=True,
        policy_revision=state["configured_revision"],
        policy_hash=state["policy_hash"],
    )
    with pytest.raises(RuntimeError, match="rollback"):
        with transaction_scope() as session:
            result = runtime_policy.enqueue_schedule(
                "compute_analytics",
                origin="scheduler",
                actor_user_id=None,
                agent_context=None,
                required_grants=None,
                decision=decision,
                session=session,
            )
            assert result["status"] == "queued"
            dispatch.assert_not_called()
            raise RuntimeError("rollback")
    dispatch.assert_not_called()
    assert (
        runtime_policy.read_schedules_state()["last_enqueued_at"]["compute_analytics"]
        is None
    )
    with read_scope() as session:
        assert session.execute(text("SELECT COUNT(*) FROM tasks")).scalar_one() == 0

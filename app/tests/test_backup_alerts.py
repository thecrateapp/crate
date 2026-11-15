"""Backup alerts: one open alert per condition until it clears, pushed by a task (BK6)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from crate.backups import alerts, health

NOW = datetime(2026, 11, 13, 4, 0, tzinfo=timezone.utc)


def _alert(kind="destination_failing", destination_id="d-1", **extra):
    return {
        "level": "danger",
        "kind": kind,
        "destination_id": destination_id,
        "title": f"{kind} on {destination_id}",
        "text": "restic exited with 1",
        "at": NOW,
        **extra,
    }


# ── reconcile ─────────────────────────────────────────────────────


def test_a_condition_stays_one_open_alert_until_it_clears():
    first = alerts.reconcile(None, [_alert()], names={"d-1": "R2"}, now=NOW)
    assert len(first.opened) == 1 and not first.resolved
    opened = first.opened[0]
    assert opened["destination"] == "R2" and opened["key"] == "destination_failing:d-1"

    later = NOW + timedelta(minutes=5)
    second = alerts.reconcile(
        first.state, [_alert(text="still failing", level="warning")], now=later
    )
    assert not second.opened and not second.resolved and second.still_open == 1
    entry = second.state["open"][0]
    assert entry["id"] == opened["id"] and entry["opened_at"] == opened["opened_at"]
    assert entry["text"] == "still failing" and entry["level"] == "warning"
    assert entry["last_seen_at"] == later.isoformat()

    cleared = alerts.reconcile(second.state, [], now=later + timedelta(minutes=5))
    assert [a["id"] for a in cleared.resolved] == [opened["id"]]
    assert cleared.state["open"] == [] and cleared.state["open_count"] == 0
    assert cleared.state["resolved"][0]["resolved_at"]

    back = alerts.reconcile(cleared.state, [_alert()], now=later + timedelta(hours=1))
    assert len(back.opened) == 1 and back.opened[0]["id"] != opened["id"]


def test_conditions_are_keyed_by_kind_and_destination():
    sync = alerts.reconcile(
        None,
        [
            _alert(),
            _alert(),  # the same condition twice in one reading counts once
            _alert(kind="copy_late", level="warning"),
            _alert(destination_id="d-2"),
            _alert(kind="dump_failed", destination_id=None),
        ],
        now=NOW,
    )
    assert sorted(a["key"] for a in sync.opened) == [
        "copy_late:d-1",
        "destination_failing:d-1",
        "destination_failing:d-2",
        "dump_failed:local",
    ]


def test_the_stored_state_is_bounded_and_secret_free():
    many = [_alert(destination_id=f"d-{i}", text="x" * 1000) for i in range(30)]
    sync = alerts.reconcile(None, many, now=NOW)
    assert len(sync.state["open"]) == alerts.MAX_OPEN
    assert sync.state["open_count"] == 30
    assert all(len(entry["text"]) <= 300 for entry in sync.state["open"])
    resolved = alerts.reconcile(sync.state, [], now=NOW + timedelta(minutes=5))
    assert len(resolved.state["resolved"]) == 20


# ── the overview's local runs ─────────────────────────────────────


def _overview(local_runs):
    return health.build_overview(
        destinations=[],
        policy_rows=[],
        latest={},
        latest_dump=None,
        size_series={},
        local_runs=local_runs,
        now=NOW,
    )


def test_a_failed_dump_or_retention_raises_an_alert_until_a_later_run_passes():
    failed = {
        "status": "failed",
        "error": "pg_dump: connection refused",
        "started_at": NOW,
    }
    overview = _overview({"dump": failed, "local_retention": {**failed, "error": None}})
    assert [(a["kind"], a["destination_id"]) for a in overview["alerts"]] == [
        ("dump_failed", None),
        ("local_retention_failed", None),
    ]
    assert overview["alerts"][0]["text"] == "pg_dump: connection refused"
    passed = {"status": "succeeded", "started_at": NOW}
    assert _overview({"dump": passed})["alerts"] == []
    assert _overview({"dump": {"status": "running", "started_at": NOW}})["alerts"] == []


# ── the task, end to end ──────────────────────────────────────────


def test_the_task_stores_and_resolves_alerts(pg_db):
    del pg_db
    from crate.backups.destinations import create_destination
    from crate.db.ops_runtime import get_ops_runtime_state
    from crate.db.repositories.backup_destinations import record_destination_check
    from crate.worker_handlers.backups import BACKUP_TASK_HANDLERS

    destination = create_destination(kind="local", name="Volume", config={"path": "v"})
    record_destination_check(destination["id"], status="ok", initialized=True)
    record_destination_check(destination["id"], status="failing", error="disk full")

    handle = BACKUP_TASK_HANDLERS["backup_alerts"]
    first = handle("task-1", {}, {})
    assert first["open"] == 1 and len(first["opened"]) == 1
    second = handle("task-2", {}, {})
    assert {k: second[k] for k in ("open", "opened", "resolved")} == {
        "open": 1,
        "opened": [],
        "resolved": [],
    }
    stored = get_ops_runtime_state(alerts.STATE_KEY) or {}
    assert stored["open"][0]["id"] == first["opened"][0]
    assert stored["open"][0]["destination"] == "Volume"
    assert stored["open"][0]["text"] == "disk full"

    record_destination_check(destination["id"], status="ok")
    third = handle("task-3", {}, {})
    assert third["resolved"] == first["opened"] and third["open"] == 0


def test_the_task_is_wired_and_scheduled_only_while_backups_are_in_use(
    pg_db, monkeypatch
):
    del pg_db
    from crate import scheduler
    from crate.actors import TASK_POOL_CONFIG
    from crate.backups.destinations import create_destination
    from crate.db.ops_runtime import set_ops_runtime_state
    from crate.task_registry import TASK_TYPES
    from crate.worker import TASK_HANDLERS

    config = TASK_POOL_CONFIG["backup_alerts"]
    assert config.queue == "maintenance" and config.max_retries == 0
    assert "backup_alerts" in TASK_TYPES and "backup_alerts" in TASK_HANDLERS
    assert scheduler.DEFAULT_SCHEDULES["backup_alerts"] == 300

    monkeypatch.setenv("CRATE_LOCAL_BACKUPS_ENABLED", "false")
    assert not scheduler._scheduled_task_enabled("backup_alerts")
    set_ops_runtime_state(alerts.STATE_KEY, {"open": [{"id": "a", "key": "k"}]})
    assert scheduler._scheduled_task_enabled("backup_alerts")
    set_ops_runtime_state(alerts.STATE_KEY, {"open": []})
    assert not scheduler._scheduled_task_enabled("backup_alerts")
    create_destination(kind="local", name="Volume", config={"path": "v"})
    assert scheduler._scheduled_task_enabled("backup_alerts")
    monkeypatch.setenv("CRATE_LOCAL_BACKUPS_ENABLED", "true")
    assert scheduler._scheduled_task_enabled("backup_alerts")


# ── the push channel: Crate MCP for Crate Operator ────────────────


def test_open_alerts_reach_the_observability_summary(pg_db):
    del pg_db
    from crate import agent_observability
    from crate.db.ops_runtime import set_ops_runtime_state

    # Backups not in use: no source, and the summary's availability is unchanged.
    absent = agent_observability.get_observability_summary()["data"]["sources"]
    assert "backup_alerts" not in absent

    sync = alerts.reconcile(
        None,
        [_alert(text="secret-free error text")],
        names={"d-1": "R2"},
        now=datetime.now(timezone.utc),
    )
    set_ops_runtime_state(alerts.STATE_KEY, sync.state)
    source = agent_observability.get_observability_summary()["data"]["sources"][
        "backup_alerts"
    ]
    assert source["availability"] == "available"
    assert source["data"]["open_count"] == 1
    assert source["data"]["rows"] == [
        {
            "id": sync.opened[0]["id"],
            "kind": "destination_failing",
            "level": "danger",
            "destination": "R2",
            "opened_at": sync.opened[0]["opened_at"],
        }
    ]


def test_a_day_old_state_without_open_alerts_is_dropped():
    from crate import agent_observability

    def record(age_hours, rows):
        observed = datetime.now(timezone.utc) - timedelta(hours=age_hours)
        return {
            "backup_alerts": {
                "source": "backup_alerts",
                "observed_at": observed.isoformat(),
                "payload": {"open": rows},
            }
        }

    assert agent_observability._backup_alerts(record(25, []), None) is None
    assert agent_observability._backup_alerts(record(1, []), None) is not None
    old_open = agent_observability._backup_alerts(
        record(25, [{"id": "a1b2", "kind": "copy_late"}]), None
    )
    assert old_open is not None and old_open["availability"] != "available"
    assert agent_observability._backup_alerts({}, None) is None


@pytest.mark.parametrize(
    "payload",
    [{"open": "not a list"}, {"open": [{"id": 3, "kind": "x"}]}],
)
def test_malformed_alert_state_is_never_served(payload):
    from crate import agent_observability

    record = {
        "source": "backup_alerts",
        "observed_at": datetime.now(timezone.utc).isoformat(),
        "payload": payload,
    }
    source = agent_observability._backup_alerts({"backup_alerts": record}, None)
    assert source["availability"] == "unavailable"
    assert source["data"] is None
    assert "invalid" in source["reason"]

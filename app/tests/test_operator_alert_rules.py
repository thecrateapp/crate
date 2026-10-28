"""Supervisor push alerts that replace the legacy built-in Telegram notifications."""

import hashlib
import hmac
import json
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from deploy.operator import delivery as delivery_module
from deploy.operator.delivery import Delivery, HermesTransport
from deploy.operator.state import State
from deploy.operator.supervisor import Rule, Supervisor

ROOT = Path(__file__).resolve().parents[2]

BASE = 1800000000


def example_rules(name="config.operator.example.json"):
    config = json.loads((ROOT / "deploy/operator" / name).read_text())
    return {rule["id"]: Rule(**rule) for rule in config["rules"]}


def iso(now):
    return datetime.fromtimestamp(now, UTC).isoformat()


def summary(now, *, health=None, failed=None, releases=None, truncated=False):
    def source(data):
        return {
            "source": "synthetic",
            "availability": "available",
            "observed_at": iso(now),
            "coverage": "partial",
            "data": data,
            "truncated": truncated,
        }

    return {
        "data": {
            "sources": {
                "health": source(health) if health is not None else {},
                "failed_tasks": source({"rows": failed}) if failed is not None else {},
                "new_releases": source({"rows": releases})
                if releases is not None
                else {},
            }
        }
    }


def observe(supervisor, now, **kwargs):
    supervisor.observe(
        {supervisor.rules[0].request_key: summary(now, **kwargs)},
        now,
    )


def messages(state):
    return [
        item["message"].rsplit("\nref ", 1)[0]
        for item in sorted(
            state.snapshot()["outbox"].values(), key=lambda item: item["created_at"]
        )
    ]


def failure(task_id, task_type="enrich_artist", **extra):
    return {
        "id": task_id,
        "type": task_type,
        "error_code": "UPSTREAM",
        "updated_at": "2027-01-15T08:00:00+00:00",
        **extra,
    }


@pytest.fixture
def state(tmp_path):
    value = State(tmp_path)
    yield value
    value.close()


@pytest.mark.parametrize(
    "name", ["config.operator.example.json", "config.example.json"]
)
def test_example_configs_ship_the_three_alert_rules(name):
    rules = example_rules(name)
    health = rules["health-score"]
    assert (health.kind, health.threshold, health.clear_threshold) == ("low", 70, 80)
    assert (health.critical, health.cooldown_seconds) == (40, 1800)
    failed = rules["failed-tasks"]
    assert failed.kind == "digest" and list(failed.group_field) == ["type"]
    assert failed.cooldown_seconds == 1800 and "error" not in failed.row_fields
    releases = rules["new-releases"]
    assert releases.kind == "digest" and releases.cooldown_seconds == 3600
    assert {rule.request_key for rule in rules.values()} == {
        "get_observability_summary:{}",
        "get_instance_inventory:{}",
    }


def test_health_rule_opens_escalates_and_resolves_with_breach_detail(state):
    supervisor = Supervisor(state, "lab", [example_rules()["health-score"]])
    breaches = [{"name": "RAM usage", "severity": "warning", "value": 97.0}]
    observe(supervisor, BASE, health={"score": 70, "breaches": breaches})
    assert not messages(state)
    observe(supervisor, BASE + 120, health={"score": 70, "breaches": breaches})
    observe(supervisor, BASE + 240, health={"score": 40, "breaches": breaches})
    observe(supervisor, BASE + 360, health={"score": 90, "breaches": []})
    observe(supervisor, BASE + 480, health={"score": 100, "breaches": []})
    sent = messages(state)
    assert [message.split("\n")[0] for message in sent] == [
        "Crate WARNING · Instance: health score 70 (limit 70)",
        "Crate CRITICAL · Instance: health score 40 (limit 40)",
        "Crate RESOLVED · Instance: health score back to 100",
    ]
    assert sent[0].split("\n")[1:] == [
        "Since 08:02 UTC",
        "RAM usage 97",
        "lab/instance/health-score · rev 1",
    ]
    assert sent[2].split("\n")[1] == "Lasted 6 min"
    assert "{" not in "".join(sent)
    assert state.snapshot()["incidents"]["lab/instance/health-score"]["state"] == (
        "resolved"
    )


def test_health_deadband_between_thresholds_never_alerts(state):
    supervisor = Supervisor(state, "lab", [example_rules()["health-score"]])
    for step in range(5):
        observe(supervisor, BASE + step * 120, health={"score": 80, "breaches": []})
    assert not messages(state)


def test_health_reopen_within_cooldown_is_deferred_until_cooldown(state):
    supervisor = Supervisor(state, "lab", [example_rules()["health-score"]])
    now = BASE
    for score in (60, 60, 90, 90):
        observe(supervisor, now, health={"score": score, "breaches": []})
        now += 120
    assert len(messages(state)) == 2
    observe(supervisor, now, health={"score": 60, "breaches": []})
    observe(supervisor, now + 120, health={"score": 60, "breaches": []})
    incident = state.snapshot()["incidents"]["lab/instance/health-score"]
    assert incident["state"] == "open" and incident["deferred"] == "opened"
    assert len(messages(state)) == 2
    resolved_at = BASE + 360
    observe(supervisor, resolved_at + 1799, health={"score": 60, "breaches": []})
    assert len(messages(state)) == 2
    observe(supervisor, resolved_at + 1800, health={"score": 60, "breaches": []})
    sent = messages(state)
    assert len(sent) == 3
    assert sent[-1].startswith("Crate WARNING · Instance: health score 60")
    assert "deferred" not in state.snapshot()["incidents"][incident["key"]]


def test_health_flap_inside_cooldown_stays_silent(state):
    supervisor = Supervisor(state, "lab", [example_rules()["health-score"]])
    now = BASE
    for score in (60, 60, 90, 90, 60, 60, 90, 90):
        observe(supervisor, now, health={"score": score, "breaches": []})
        now += 120
    assert len(messages(state)) == 2
    kinds = [event["kind"] for event in state.events()["events"]]
    assert kinds.count("incident_opened") == 2
    assert kinds.count("incident_resolved") == 2
    observe(supervisor, BASE + 7200, health={"score": 90, "breaches": []})
    assert len(messages(state)) == 2


def test_failed_tasks_baseline_then_immediate_alert_then_rate_limited_digest(state):
    supervisor = Supervisor(state, "lab", [example_rules()["failed-tasks"]])
    observe(supervisor, BASE, failed=[failure("old-1"), failure("old-2")])
    assert not messages(state)

    observe(
        supervisor,
        BASE + 45,
        failed=[failure("new-1", error="raw text"), failure("old-1")],
    )
    sent = messages(state)
    assert len(sent) == 1
    assert sent[0].startswith("lab/tasks/failed-tasks new;")
    payload = json.loads(sent[0].split("new; ", 1)[1])
    assert payload["group"] == "enrich_artist" and payload["count"] == 1
    assert payload["latest"][0]["id"] == "new-1"
    assert "raw text" not in sent[0] and "old-1" not in sent[0]

    rows = [failure("new-1")]
    for index in range(2, 6):
        rows.insert(0, failure(f"new-{index}"))
        observe(supervisor, BASE + 45 * index, failed=list(rows))
    assert len(messages(state)) == 1

    observe(supervisor, BASE + 45 + 1800, failed=list(rows))
    sent = messages(state)
    assert len(sent) == 2
    digest = json.loads(sent[1].split("new; ", 1)[1])
    assert digest["count"] == 4 and not digest["count_is_lower_bound"]
    assert [row["id"] for row in digest["latest"]] == [
        "new-2",
        "new-3",
        "new-4",
        "new-5",
    ]
    observe(supervisor, BASE + 45 + 3700, failed=list(rows))
    assert len(messages(state)) == 2


def test_failed_tasks_group_by_type_and_flag_truncated_samples(state):
    supervisor = Supervisor(state, "lab", [example_rules()["failed-tasks"]])
    observe(supervisor, BASE, failed=[])
    observe(
        supervisor,
        BASE + 45,
        failed=[failure("a-1", "analyze_track"), failure("b-1", "enrich_artist")],
        truncated=True,
    )
    sent = [json.loads(message.split("new; ", 1)[1]) for message in messages(state)]
    assert [(item["group"], item["count"]) for item in sent] == [
        ("analyze_track", 1),
        ("enrich_artist", 1),
    ]
    assert all(item["count_is_lower_bound"] for item in sent)


def test_failed_tasks_invalid_source_never_announces_or_forgets(state):
    supervisor = Supervisor(state, "lab", [example_rules()["failed-tasks"]])
    observe(supervisor, BASE, failed=[failure("seen")])
    supervisor.observe({supervisor.rules[0].request_key: {}}, BASE + 45)
    status = supervisor.status(BASE + 45)
    assert not status["coverage"]["lab/tasks/failed-tasks"]["valid"]
    observe(supervisor, BASE + 90, failed=[failure("seen")])
    assert not messages(state)


def test_new_releases_announced_once(state):
    supervisor = Supervisor(state, "lab", [example_rules()["new-releases"]])
    release = {
        "id": "17",
        "artist": "Artist",
        "album": "Fresh",
        "year": "2027",
        "status": "detected",
        "cover_url": "https://example.test/x.jpg",
    }
    observe(supervisor, BASE, releases=[])
    observe(supervisor, BASE + 45, releases=[release])
    observe(supervisor, BASE + 90, releases=[release])
    observe(supervisor, BASE + 3700, releases=[release])
    sent = messages(state)
    assert len(sent) == 1
    payload = json.loads(sent[0].split("new; ", 1)[1])
    assert payload["group"] == "all"
    assert payload["latest"] == [
        {
            "id": "17",
            "artist": "Artist",
            "album": "Fresh",
            "year": "2027",
            "status": "detected",
        }
    ]


def test_digest_delivery_payload_is_signed_for_the_fixed_hermes_route(
    state, monkeypatch
):
    supervisor = Supervisor(state, "lab", [example_rules()["new-releases"]])
    observe(supervisor, BASE, releases=[])
    observe(supervisor, BASE + 45, releases=[{"id": "1", "album": "Fresh"}])
    captured = {}

    def request_json(url, *, payload, headers, **_):
        captured.update(url=url, payload=payload, headers=headers)
        return 200, {
            "delivery_id": headers["X-Request-ID"],
            "status": "delivered",
            "route": "crate-operator",
        }

    monkeypatch.setattr(delivery_module, "request_json", request_json)
    transport = HermesTransport(
        "http://hermes:8644/webhooks/crate-operator",
        "synthetic-secret",
        "crate-operator",
    )
    assert Delivery(state, transport).tick(BASE + 50)
    body = json.loads(captured["payload"])
    item = next(iter(state.snapshot()["outbox"].values()))
    assert item["state"] == "delivered"
    assert set(body) == {"logical_id", "message"} and body["logical_id"] == item["id"]
    assert "lab/library/new-releases new;" in body["message"]
    expected = hmac.new(
        b"synthetic-secret",
        captured["headers"]["X-Webhook-Timestamp"].encode()
        + b"."
        + captured["payload"],
        hashlib.sha256,
    ).hexdigest()
    assert captured["headers"]["X-Webhook-Signature-V2"] == expected


def test_alert_rules_consume_the_real_observability_summary(state, monkeypatch):
    from crate import agent_observability as observations

    now = datetime(2027, 1, 15, 8, tzinfo=UTC)
    monkeypatch.setattr("crate.agent_diagnostics._now", lambda: now)
    monkeypatch.setattr(observations, "_now", lambda: now)
    evidence = {
        "runtime": [
            {
                "source": "health",
                "observed_at": now.isoformat(),
                "payload": {
                    "score": 40,
                    "breaches": [
                        {"name": "API error rate", "severity": "critical", "value": 9}
                    ],
                },
            }
        ],
        "snapshots": [],
        "jobs": [],
        "failed_tasks": [],
        "new_releases": [],
        "queried_at": now,
    }
    monkeypatch.setattr(
        observations.evidence_store,
        "read_observation_evidence",
        lambda **kwargs: evidence if kwargs == {"alerts": True} else {},
    )
    rules = example_rules()
    supervisor = Supervisor(
        state,
        "lab",
        [rules["health-score"], rules["failed-tasks"], rules["new-releases"]],
    )
    key = rules["health-score"].request_key
    start = now.timestamp()
    supervisor.observe({key: observations.get_observability_summary()}, start)
    evidence["failed_tasks"] = [failure("f-1")]
    evidence["new_releases"] = [{"id": "9", "artist": "A", "album": "B"}]
    later = now + timedelta(seconds=120)
    evidence["queried_at"] = later
    evidence["runtime"][0]["observed_at"] = later.isoformat()
    monkeypatch.setattr(observations, "_now", lambda: later)
    monkeypatch.setattr("crate.agent_diagnostics._now", lambda: later)
    supervisor.observe(
        {key: observations.get_observability_summary()}, later.timestamp()
    )
    coverage = supervisor.status(later.timestamp())["coverage"]
    assert all(coverage[name]["valid"] for name in coverage)
    sent = " ".join(messages(state))
    assert "Crate CRITICAL · Instance: health score 40 (limit 40)" in sent
    assert "lab/tasks/failed-tasks new;" in sent and '"f-1"' in sent
    assert "lab/library/new-releases new;" in sent and '"album": "B"' in sent


@pytest.mark.parametrize(
    "overrides",
    [
        {"kind": "digest", "field": ("rows",)},
        {"kind": "digest", "field": ("rows",), "row_fields": ("type",)},
        {"kind": "digest", "field": ("rows",), "row_fields": ("id", "bad key")},
        {"kind": "high", "field": ("x",), "row_fields": ("id",)},
        {"kind": "high", "field": ("x",), "group_field": ("type",)},
        {"kind": "high", "field": ("x",), "cooldown_seconds": 86401},
        {"kind": "high", "field": ("x",), "cooldown_seconds": 1.5},
        {"kind": "high", "field": ("x",), "notify_after_seconds": -1},
        {"kind": "high", "field": ("x",), "notify_after_seconds": 86401},
        {"kind": "high", "field": ("x",), "notify_after_seconds": 1.5},
        {"kind": "high", "field": ("x",), "notify_after_seconds": True},
    ],
)
def test_alert_rule_shapes_are_closed(overrides):
    with pytest.raises(ValueError):
        Rule(
            id="x",
            subsystem="tasks",
            tool="get_observability_summary",
            source_path=("data", "sources", "failed_tasks"),
            **overrides,
        )


def observe_release(supervisor, now, available):
    source = (
        {
            "source": "host_verified_release",
            "availability": "available",
            "observed_at": iso(now),
            "coverage": "partial",
            "data": {"release_sha": "a" * 40},
        }
        if available
        else {"source": "host_verified_release", "availability": "unavailable"}
    )
    supervisor.observe(
        {
            supervisor.rules[0].request_key: {
                "data": {"sources": {"release_manifest": source}}
            }
        },
        now,
    )


def test_notification_delay_defaults_by_rule_kind():
    rules = example_rules()
    assert rules["release-evidence"].notify_delay == 300
    assert rules["health-score"].notify_delay == 0
    assert rules["pending"].notify_delay == 0
    custom = Rule(
        id="x",
        subsystem="version",
        tool="get_instance_inventory",
        source_path=("data",),
        notify_after_seconds=0,
    )
    assert custom.notify_delay == 0


def test_brief_availability_gap_after_restart_stays_silent(state):
    supervisor = Supervisor(state, "lab", [example_rules()["release-evidence"]])
    for step in range(5):
        observe_release(supervisor, BASE + step * 30, available=False)
    incident = state.snapshot()["incidents"]["lab/version/release-evidence"]
    assert incident["severity"] == "critical" and incident["deferred"] == "opened"
    observe_release(supervisor, BASE + 150, available=True)
    observe_release(supervisor, BASE + 180, available=True)
    incident = state.snapshot()["incidents"]["lab/version/release-evidence"]
    assert incident["state"] == "resolved" and "deferred" not in incident
    assert not messages(state)
    kinds = [event["kind"] for event in state.events()["events"]]
    assert kinds.count("incident_opened") == 1
    assert kinds.count("incident_escalated") == 1
    assert kinds.count("incident_resolved") == 1


def test_sustained_availability_gap_notifies_once_with_readable_text(state):
    supervisor = Supervisor(state, "lab", [example_rules()["release-evidence"]])
    for step in range(11):
        observe_release(supervisor, BASE + step * 30, available=False)
    assert not messages(state)
    observe_release(supervisor, BASE + 330, available=False)
    sent = messages(state)
    assert sent == [
        "Crate CRITICAL · Version: release evidence unavailable\n"
        "Since 08:00 UTC (5 min)\n"
        "lab/version/release-evidence · rev 2"
    ]
    observe_release(supervisor, BASE + 420, available=True)
    observe_release(supervisor, BASE + 450, available=True)
    sent = messages(state)
    assert sent[1:] == [
        "Crate RESOLVED · Version: release evidence available again\n"
        "Lasted 7 min\n"
        "lab/version/release-evidence · rev 3"
    ]
    raw = [item["message"] for item in state.snapshot()["outbox"].values()]
    assert all(
        message.endswith("\nref " + item_id)
        for message, item_id in zip(raw, state.snapshot()["outbox"])
    )

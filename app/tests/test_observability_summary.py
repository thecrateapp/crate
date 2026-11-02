from datetime import UTC, date, datetime

import pytest
from crate.observability import summary as summary_module
from crate.observability.summary import (
    SUMMARY_KEY,
    build_observability_summary,
    compute_observability_summary,
)

NOW = datetime(2026, 11, 2, 12, 0, tzinfo=UTC)


def metric(count=0, total=0.0, availability="available", **extra):
    return {
        "count": count,
        "sum": total,
        "avg": round(total / count, 2) if count else 0,
        "max": extra.pop("max", 0),
        "availability": availability,
        "reason": extra.pop("reason", None),
        "observed_at": NOW.isoformat(),
        **extra,
    }


def playback(startups=40, stalls=4, recoveries=1, availability="available"):
    return {
        "startups": metric(startups, startups * 300.0, availability, max=900),
        "stalls": metric(stalls, float(stalls)),
        "stall_ms": metric(stalls, stalls * 50.0),
        "recoveries": metric(recoveries, float(recoveries)),
    }


def row(kpi, day, value, dims=None, sample=None):
    return {
        "kpi": kpi,
        "day": day,
        "value": value,
        "dims": dims or {},
        "sample": sample,
    }


INVENTORY = {
    "availability": "available",
    "host": {"id": "crate", "name": "crate"},
    "stacks": [
        {"id": "application", "project": "crate"},
        {"id": "observability", "project": "crate-observability"},
    ],
    "services": [
        {
            "service": "crate-api",
            "stack_id": "application",
            "project": "crate",
            "runtime_state": "running",
            "health": "healthy",
        },
        {
            "service": "crate-worker",
            "stack_id": "application",
            "project": "crate",
            "runtime_state": "exited",
            "health": None,
        },
        *[
            {
                "service": name,
                "stack_id": "observability",
                "project": "crate-observability",
                "runtime_state": "running",
                "health": "healthy",
            }
            for name in sorted(summary_module.OBSERVABILITY_SERVICES)
        ],
    ],
}


def stored(rows=(), inventory=INVENTORY):
    return lambda start, end: {
        "kpi_rows": list(rows),
        "kpi_computed_at": NOW,
        "inventory": inventory,
        "inventory_built_at": NOW,
    }


def build(metrics=None, **kwargs):
    return build_observability_summary(
        now=NOW,
        metrics=metrics or (lambda specs: playback()),
        inputs=stored(**kwargs),
    )


def test_playback_ratios_need_the_minimum_sample():
    assert build()["playback"] == {
        "window_minutes": 15,
        "minimum_startups": 20,
        "availability": "available",
        "reason": None,
        "observed_at": NOW.isoformat(),
        "startups": 40,
        "stalls": 4.0,
        "recoveries": 1.0,
        "startup_avg_ms": 300.0,
        "startup_max_ms": 900,
        "stall_avg_ms": 50.0,
        "stalls_per_startup": 0.1,
        "intents_and_results": "not_reported",
    }
    few = build(metrics=lambda specs: playback(startups=5))["playback"]
    assert few["availability"] == "insufficient_sample"
    assert few["stalls_per_startup"] is None


@pytest.mark.parametrize(
    "metrics",
    [
        lambda specs: {},
        lambda specs: playback(availability="unavailable"),
        lambda specs: (_ for _ in ()).throw(ConnectionError("redis down")),
    ],
)
def test_missing_playback_metrics_are_unavailable_not_zero(metrics):
    result = build(metrics=metrics)["playback"]

    assert result["availability"] == "unavailable"
    assert "startups" not in result


def test_kpi_windows_keep_daily_and_snapshot_semantics_separate():
    rows = [
        row("listening.plays", date(2026, 10, 1), 999.0),
        row("listening.plays", date(2026, 10, 30), 10.0),
        row("listening.plays", date(2026, 11, 1), 20.0),
        row("listening.plays", date(2026, 11, 2), 30.0),
        row("users.active", date(2026, 11, 2), 7.0),
    ]

    kpis = build(rows=rows)["product_kpis"]

    assert kpis["windows"]["7"]["listening"]["listening.plays"] == {
        "kind": "daily",
        "days": 3,
        "latest_day": "2026-11-02",
        "latest": 30.0,
        "sum": 60.0,
        "mean": 20.0,
    }
    assert kpis["windows"]["30"]["listening"]["listening.plays"]["days"] == 3
    assert kpis["windows"]["7"]["users"]["users.active"]["kind"] == "snapshot"


def test_kpi_segments_below_three_listeners_are_suppressed():
    day = date(2026, 11, 2)
    rows = [
        row("listening.plays_by_platform", day, 300.0, {"platform": "android"}, 9),
        row("listening.plays_by_platform", day, 2.0, {"platform": "ios"}, 1),
        row(
            "listening.plays_by_platform",
            date(2026, 11, 1),
            5.0,
            {"platform": "web"},
            6,
        ),
    ]

    breakdown = build(rows=rows)["product_kpis"]["breakdowns"]["listening"][
        "listening.plays_by_platform"
    ]

    assert breakdown["day"] == "2026-11-02"
    assert breakdown["segments"] == [
        {
            "dims": {"platform": "android"},
            "value": 300.0,
            "sample": 9,
            "suppressed": False,
        },
        {"dims": {"platform": "ios"}, "value": None, "sample": 1, "suppressed": True},
    ]


def test_no_kpis_is_empty_not_zero():
    kpis = build(rows=[])["product_kpis"]

    assert kpis["availability"] == "empty"
    assert "windows" not in kpis


def test_stack_reports_both_deployments_and_degraded_monitoring():
    stack = build()["stack"]

    assert stack["application"]["not_running"] == ["crate-worker"]
    assert stack["monitoring"]["deployment"] == "independent"
    assert stack["monitoring"]["status"] == "running"
    assert stack["monitoring"]["release"] is None
    assert stack["resources"] == "live_only"

    services = [
        service
        for service in INVENTORY["services"]
        if service["service"] != "crate-grafana"
    ]
    degraded = build(inventory={**INVENTORY, "services": services})["stack"][
        "monitoring"
    ]
    assert degraded["status"] == "degraded"
    assert degraded["missing"] == ["crate-grafana"]


def test_legacy_overlay_and_missing_snapshot_are_explicit():
    legacy = {
        **INVENTORY,
        "services": [
            {**service, "project": "crate"} for service in INVENTORY["services"]
        ],
    }
    assert (
        build(inventory=legacy)["stack"]["monitoring"]["deployment"] == "legacy_overlay"
    )
    assert build(inventory=None)["stack"] == {
        "availability": "unavailable",
        "reason": "no_stack_snapshot",
    }
    unavailable = build(
        inventory={"availability": "unavailable", "reason": "docker_unavailable"}
    )
    assert unavailable["stack"]["reason"] == "docker_unavailable"


def test_compute_persists_the_summary_under_one_key(monkeypatch):
    saved = {}
    monkeypatch.setattr(
        summary_module,
        "build_observability_summary",
        lambda: {"schema_version": 1, "playback": {"availability": "empty"}},
    )
    monkeypatch.setattr(
        summary_module,
        "set_ops_runtime_state",
        lambda key, payload: saved.update({key: payload}),
    )

    compute_observability_summary()

    assert saved == {
        SUMMARY_KEY: {"schema_version": 1, "playback": {"availability": "empty"}}
    }


def test_summary_inputs_read_kpis_and_stack_snapshot(pg_db):
    from crate.db.queries.observability_summary import read_summary_inputs
    from crate.db.tx import transaction_scope
    from sqlalchemy import text

    with transaction_scope() as session:
        session.execute(
            text(
                "INSERT INTO product_kpi_daily (day, kpi, dims, value, sample, computed_at) "
                "VALUES (:day, 'listening.plays', '{}'::jsonb, 12, NULL, NOW())"
            ),
            {"day": date(2026, 11, 2)},
        )
        session.execute(
            text(
                "INSERT INTO ui_snapshots (scope, subject_key, version, payload_json, built_at) "
                "VALUES ('ops:stack', 'global', 1, CAST(:payload AS jsonb), NOW()) "
                "ON CONFLICT (scope, subject_key) DO UPDATE SET payload_json = EXCLUDED.payload_json"
            ),
            {"payload": '{"inventory": {"availability": "available", "services": []}}'},
        )

    inputs = read_summary_inputs(date(2026, 10, 4), date(2026, 11, 2))

    assert [row["kpi"] for row in inputs["kpi_rows"]] == ["listening.plays"]
    assert inputs["inventory"] == {"availability": "available", "services": []}
    assert inputs["inventory_built_at"] is not None

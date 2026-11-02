from __future__ import annotations

import json

import pytest

from tests.test_metric_availability import available_runtime as available_runtime
from tests.test_metric_minute_integrity import (
    isolated_metric_redis_server as isolated_metric_redis_server,
    metric_runtime as metric_runtime,
)


@pytest.fixture
def sampler_runtime(available_runtime):
    from crate.observability import live_activity

    metrics, redis, clock = available_runtime
    listening = {"value": 2}

    def count_listening():
        if isinstance(listening["value"], Exception):
            raise listening["value"]
        return listening["value"]

    sampler = live_activity.ActivitySampler(
        redis=lambda: redis,
        minute=lambda: clock["minute"],
        now=lambda: clock["now"],
        count_listening=count_listening,
    )
    return sampler, metrics, redis, clock, listening


def _request(metrics, client, status="200"):
    metrics.record_counter("api.request.client", {"client": client, "status": status})


def test_the_first_frame_is_warming_and_never_reports_zero_counts(sampler_runtime):
    sampler, metrics, _redis, _clock, _listening = sampler_runtime
    _request(metrics, "admin-web")

    frame = sampler.sample(events=None)

    assert frame["availability"] == "warming"
    assert frame["requests"] is None
    assert frame["queues"] is None
    assert frame["listening"] == 2


def test_frames_report_new_requests_per_client_with_errors(sampler_runtime):
    sampler, metrics, _redis, clock, _listening = sampler_runtime
    _request(metrics, "admin-web")
    sampler.sample(events=None)
    clock["now"] += 5
    for status in ("200", "200", "503"):
        _request(metrics, "admin-web", status)
    _request(metrics, "readplane")

    frame = sampler.sample(events=4)

    assert frame["availability"] == "available"
    assert frame["window_seconds"] == pytest.approx(5)
    assert frame["requests"]["admin-web"] == {"count": 3, "errors": 1}
    assert frame["requests"]["readplane"] == {"count": 1, "errors": 0}
    assert frame["projector"] == {"events": 4}


def test_minute_rollover_keeps_counts_from_both_minutes(sampler_runtime):
    sampler, metrics, _redis, clock, _listening = sampler_runtime
    sampler.sample(events=None)
    _request(metrics, "listen-web")
    _request(metrics, "listen-web")
    clock["minute"] += 60
    clock["now"] += 60
    _request(metrics, "listen-web")

    frame = sampler.sample(events=None)

    assert frame["requests"]["listen-web"]["count"] == 3


def test_queue_completions_come_from_task_outcomes(sampler_runtime):
    sampler, metrics, _redis, clock, _listening = sampler_runtime
    sampler.sample(events=None)
    clock["now"] += 5
    metrics.record(
        "worker.task.duration",
        1.5,
        {"queue": "heavy", "status": "completed", "type": "scan"},
    )
    metrics.record(
        "worker.task.duration",
        0.5,
        {"queue": "heavy", "status": "failed", "type": "scan"},
    )

    frame = sampler.sample(events=None)

    assert frame["queues"]["heavy"] == {"completed": 1, "failed": 1}


def test_failing_sources_are_reported_unknown_instead_of_zero(
    sampler_runtime, monkeypatch
):
    from crate.observability import live_activity

    sampler, _metrics, _redis, clock, listening = sampler_runtime
    sampler.sample(events=None)
    clock["now"] += 5
    listening["value"] = RuntimeError("database unavailable")

    def broken(*_args, **_kwargs):
        raise ConnectionError("redis unavailable")

    monkeypatch.setattr(live_activity.metric_buckets, "read_buckets", broken)

    frame = sampler.sample(events=None)

    assert frame["availability"] == "partial"
    assert frame["requests"] is None
    assert frame["listening"] is None
    assert frame["sources"]["metrics"] == "unavailable"
    assert frame["sources"]["playback"] == "unavailable"


def test_publish_only_runs_while_someone_watches(sampler_runtime):
    from crate.observability import live_activity

    sampler, _metrics, redis, clock, _listening = sampler_runtime

    assert live_activity.publish_if_watched(sampler, events=None) is None
    assert redis.get(live_activity.FRAME_KEY) is None

    live_activity.mark_watched(redis)
    first = live_activity.publish_if_watched(sampler, events=None)
    clock["now"] += 5
    second = live_activity.publish_if_watched(sampler, events=None)

    stored = json.loads(redis.get(live_activity.FRAME_KEY))
    assert first["availability"] == "warming"
    assert second["sequence"] == first["sequence"] + 1
    assert stored["sequence"] == second["sequence"]
    assert 0 < redis.ttl(live_activity.FRAME_KEY) <= live_activity.FRAME_TTL_SECONDS


def test_frames_carry_counts_only(sampler_runtime):
    sampler, metrics, _redis, clock, _listening = sampler_runtime
    sampler.sample(events=None)
    clock["now"] += 5
    _request(metrics, "admin-web")

    frame = sampler.sample(events=None)

    assert set(frame) == {
        "schema",
        "sequence",
        "observed_at",
        "window_seconds",
        "availability",
        "requests",
        "queues",
        "projector",
        "listening",
        "resources",
        "sources",
    }


def test_resources_refresh_at_most_every_thirty_seconds_and_survive_failures(
    available_runtime,
):
    from crate.observability import live_activity

    _metrics, redis, clock = available_runtime
    calls = []
    outcome = {"fail": False}

    def fetch():
        calls.append(clock["now"])
        if outcome["fail"]:
            raise RuntimeError("prometheus unreachable")
        return {"observed_at": "t", "host": {}, "services": {"crate-api": {}}}

    sampler = live_activity.ActivitySampler(
        redis=lambda: redis,
        minute=lambda: clock["minute"],
        now=lambda: clock["now"],
        count_listening=lambda: 0,
        fetch_resources=fetch,
    )

    first = sampler.sample(events=0)
    clock["now"] += 5
    second = sampler.sample(events=0)
    clock["now"] += 30
    outcome["fail"] = True
    third = sampler.sample(events=0)

    assert len(calls) == 2
    assert first["resources"]["services"] == {"crate-api": {}}
    assert second["sources"]["resources"] == "available"
    assert third["resources"] == first["resources"]
    assert third["sources"]["resources"] == "unavailable"


def test_resources_are_unconfigured_without_a_prometheus_source(sampler_runtime):
    sampler, _metrics, _redis, _clock, _listening = sampler_runtime

    frame = sampler.sample(events=0)

    assert frame["resources"] is None
    assert frame["sources"]["resources"] == "unconfigured"

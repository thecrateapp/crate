from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from crate.api.schemas.playback_telemetry import PlaybackQoeBatchRequest


class FakeRedis:
    def __init__(self, fail: bool = False):
        self.values: dict[str, int | str] = {}
        self.ttls: dict[str, int] = {}
        self.fail = fail

    def pipeline(self):
        return FakePipeline(self)


class FakePipeline:
    def __init__(self, redis: FakeRedis):
        self.redis = redis
        self.calls: list = []

    def incrby(self, key, amount):
        self.calls.append(("incrby", key, amount))

    def expire(self, key, seconds, nx=False):
        self.calls.append(("expire", key, seconds, nx))

    def set(self, key, value, nx=False, ex=None):
        self.calls.append(("set", key, value, nx, ex))

    def execute(self):
        if self.redis.fail:
            raise ConnectionError("redis down")
        results = []
        for call in self.calls:
            if call[0] == "incrby":
                _, key, amount = call
                self.redis.values[key] = int(self.redis.values.get(key, 0)) + amount
                results.append(self.redis.values[key])
            elif call[0] == "expire":
                _, key, seconds, nx = call
                if not (nx and key in self.redis.ttls):
                    self.redis.ttls[key] = seconds
                results.append(True)
            else:
                _, key, value, nx, ex = call
                if nx and key in self.redis.values:
                    results.append(None)
                else:
                    self.redis.values[key] = value
                    self.redis.ttls[key] = ex
                    results.append(True)
        return results


def _request_for(user_id: int = 7, session_id: str | None = "session-a"):
    return SimpleNamespace(
        state=SimpleNamespace(user={"id": user_id, "session_id": session_id})
    )


def _event(name: str = "stall_end", **extra) -> dict:
    return {
        "event": name,
        "origin": "local",
        "requested_policy": "balanced",
        "effective_policy": "balanced",
        "duration_ms": 30,
        **extra,
    }


@pytest.fixture
def recorded(monkeypatch):
    calls: list[tuple[str, float, dict]] = []
    monkeypatch.setattr(
        "crate.api.playback_telemetry.record_later",
        lambda name, value, tags: calls.append((name, value, tags)),
    )
    return calls


@pytest.fixture
def redis(monkeypatch):
    fake = FakeRedis()
    monkeypatch.setattr("crate.api.playback_telemetry.get_redis", lambda: fake)
    return fake


def _qoe(calls, prefix="playback.telemetry"):
    return [call for call in calls if not call[0].startswith(prefix)]


def test_qoe_schema_is_strict_and_excludes_catalog_identifiers():
    with pytest.raises(ValidationError):
        PlaybackQoeBatchRequest.model_validate(
            {"events": [_event("startup", track_id="must-not-pass")]}
        )


@pytest.mark.parametrize(
    "event",
    [
        _event("result"),
        _event("intent", outcome="started"),
        _event("result", outcome="started", cause="network"),
        {**_event("active"), "duration_ms": None},
    ],
)
def test_result_and_active_events_carry_exactly_their_fields(event):
    with pytest.raises(ValidationError):
        PlaybackQoeBatchRequest.model_validate({"events": [event]})


def test_qoe_ingestion_records_only_low_cardinality_metrics(recorded, redis):
    from crate.api.playback_telemetry import post_playback_qoe

    payload = PlaybackQoeBatchRequest.model_validate(
        {
            "events": [
                _event(
                    "startup",
                    origin="local",
                    requested_policy="original",
                    effective_policy="original",
                    duration_ms=215,
                    runtime="android_native",
                    engine="media3",
                ),
                {
                    "event": "stall_start",
                    "origin": "remote",
                    "requested_policy": "balanced",
                    "effective_policy": "data_saver",
                    "buffered_ahead_seconds": 0,
                },
                {
                    "event": "recovery",
                    "origin": "remote",
                    "requested_policy": "balanced",
                    "effective_policy": "data_saver",
                    "attempt": 2,
                },
            ]
        }
    )

    response = post_playback_qoe(_request_for(), payload)

    assert response.status_code == 204
    assert _qoe(recorded) == [
        (
            "playback.startup.ms",
            215.0,
            {
                "origin": "local",
                "requested_policy": "original",
                "effective_policy": "original",
                "runtime": "android_native",
                "engine": "media3",
            },
        ),
        (
            "playback.stall.count",
            1.0,
            {
                "origin": "remote",
                "requested_policy": "balanced",
                "effective_policy": "data_saver",
            },
        ),
        (
            "playback.recovery.count",
            1.0,
            {
                "origin": "remote",
                "requested_policy": "balanced",
                "effective_policy": "data_saver",
            },
        ),
    ]
    assert ("playback.telemetry.payload", 1.0, {"version": "v1"}) in recorded
    assert ("playback.telemetry.events", 3.0, {"outcome": "accepted"}) in recorded


def test_v2_records_intents_results_active_time_and_client_losses(recorded, redis):
    from crate.api.playback_telemetry import post_playback_qoe

    payload = PlaybackQoeBatchRequest.model_validate(
        {
            "schema_version": 2,
            "batch_id": "batch-0001",
            "delivery": {"dropped": 2, "expired": 0, "send_failed": 1},
            "events": [
                _event("intent", event_id="event-0001", runtime="desktop_web"),
                _event(
                    "result",
                    event_id="event-0002",
                    outcome="failed",
                    cause="network",
                    runtime="desktop_web",
                ),
                _event("active", event_id="event-0003", duration_ms=60_000),
            ],
        }
    )

    post_playback_qoe(_request_for(), payload)

    assert _qoe(recorded) == [
        (
            "playback.intent.count",
            1.0,
            {"origin": "local", "runtime": "desktop_web"},
        ),
        (
            "playback.result.count",
            1.0,
            {
                "origin": "local",
                "runtime": "desktop_web",
                "outcome": "failed",
                "cause": "network",
            },
        ),
        ("playback.active.ms", 60_000.0, {"origin": "local"}),
    ]
    assert ("playback.telemetry.payload", 1.0, {"version": "v2"}) in recorded
    assert ("playback.telemetry.client_loss", 2.0, {"reason": "dropped"}) in recorded
    assert (
        "playback.telemetry.client_loss",
        1.0,
        {"reason": "send_failed"},
    ) in recorded
    assert not any(tags.get("reason") == "expired" for _, _, tags in recorded)


def test_retried_events_are_counted_once(recorded, redis):
    from crate.api.playback_telemetry import post_playback_qoe

    batch = {
        "schema_version": 2,
        "events": [_event(event_id="event-0001"), _event(event_id="event-0002")],
    }
    post_playback_qoe(_request_for(), PlaybackQoeBatchRequest.model_validate(batch))
    recorded.clear()
    batch["events"].append(_event(event_id="event-0003"))

    post_playback_qoe(_request_for(), PlaybackQoeBatchRequest.model_validate(batch))

    assert [call[0] for call in _qoe(recorded)] == ["playback.stall.ms"]
    assert ("playback.telemetry.events", 2.0, {"outcome": "duplicate"}) in recorded
    assert ("playback.telemetry.events", 1.0, {"outcome": "accepted"}) in recorded
    assert redis.ttls["crate:playback-qoe:event:event-0001"] == 24 * 60 * 60


def test_two_devices_of_one_user_each_get_their_own_session_budget(recorded, redis):
    from crate.api.playback_telemetry import post_playback_qoe

    batch = PlaybackQoeBatchRequest.model_validate(
        {"events": [_event() for _ in range(12)]}
    )
    for _ in range(10):
        post_playback_qoe(_request_for(session_id="phone"), batch)
        post_playback_qoe(_request_for(session_id="laptop"), batch)

    with pytest.raises(HTTPException) as exc:
        post_playback_qoe(_request_for(session_id="phone"), batch)

    assert exc.value.status_code == 429
    assert exc.value.headers == {"Retry-After": "60"}
    assert ("playback.telemetry.events", 12.0, {"outcome": "rate_limited"}) in recorded
    assert redis.ttls["crate:playback-qoe:session:phone"] == 60
    assert redis.values["crate:playback-qoe:user:7"] == 252


def test_the_per_user_ceiling_bounds_many_sessions(recorded, redis):
    from crate.api.playback_telemetry import post_playback_qoe

    batch = PlaybackQoeBatchRequest.model_validate(
        {"events": [_event() for _ in range(12)]}
    )
    for index in range(50):
        post_playback_qoe(_request_for(session_id=f"device-{index}"), batch)

    with pytest.raises(HTTPException) as exc:
        post_playback_qoe(_request_for(session_id="device-51"), batch)

    assert exc.value.status_code == 429


def test_unavailable_redis_accepts_but_marks_events_unverified(recorded, monkeypatch):
    from crate.api.playback_telemetry import post_playback_qoe

    monkeypatch.setattr(
        "crate.api.playback_telemetry.get_redis", lambda: FakeRedis(fail=True)
    )
    payload = PlaybackQoeBatchRequest.model_validate(
        {"schema_version": 2, "events": [_event(event_id="event-0001")]}
    )

    response = post_playback_qoe(_request_for(), payload)

    assert response.status_code == 204
    assert ("playback.telemetry.events", 1.0, {"outcome": "unverified"}) in recorded
    assert [call[0] for call in _qoe(recorded)] == ["playback.stall.ms"]


def _continuation(outcome: str = "recovered", **extra) -> dict:
    return {
        "event": "continuation",
        "continuation": outcome,
        "surface": "radio",
        "duration_ms": 4_000,
        **extra,
    }


@pytest.mark.parametrize(
    "event",
    [
        {**_continuation(), "surface": None},
        {**_continuation(), "continuation": None},
        _event("startup", continuation="recovered", surface="radio"),
        {"event": "startup", "duration_ms": 10},
        _continuation(outcome="skipped"),
    ],
)
def test_continuation_fields_belong_only_to_continuation_events(event):
    with pytest.raises(ValidationError):
        PlaybackQoeBatchRequest.model_validate({"events": [event]})


def test_continuation_events_record_queue_waits_without_track_context(recorded, redis):
    from crate.api.playback_telemetry import post_playback_qoe

    payload = PlaybackQoeBatchRequest.model_validate(
        {
            "schema_version": 2,
            "events": [
                _continuation(event_id="event-0001", runtime="desktop_web"),
                {
                    **_continuation("cancelled", event_id="event-0002"),
                    "surface": "infinite",
                    "duration_ms": None,
                },
            ],
        }
    )

    post_playback_qoe(_request_for(), payload)

    assert _qoe(recorded) == [
        (
            "playback.continuation.count",
            1.0,
            {"surface": "radio", "outcome": "recovered", "runtime": "desktop_web"},
        ),
        (
            "playback.continuation.wait_ms",
            4_000.0,
            {"surface": "radio", "outcome": "recovered"},
        ),
        (
            "playback.continuation.count",
            1.0,
            {"surface": "infinite", "outcome": "cancelled"},
        ),
    ]

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from crate.api.schemas.playback_telemetry import PlaybackQoeBatchRequest


def _request_for(user_id: int = 7):
    return SimpleNamespace(state=SimpleNamespace(user={"id": user_id}))


def test_qoe_schema_is_strict_and_excludes_catalog_identifiers():
    with pytest.raises(ValidationError):
        PlaybackQoeBatchRequest.model_validate(
            {
                "events": [
                    {
                        "event": "startup",
                        "origin": "remote",
                        "requested_policy": "balanced",
                        "effective_policy": "balanced",
                        "track_id": "must-not-pass",
                    }
                ]
            }
        )


def test_qoe_ingestion_records_only_low_cardinality_metrics(monkeypatch):
    from crate.api.playback_telemetry import post_playback_qoe

    recorded: list[tuple[str, float, dict]] = []
    monkeypatch.setattr(
        "crate.api.playback_telemetry._allow_qoe_events", lambda _user_id, _count: True
    )
    monkeypatch.setattr(
        "crate.api.playback_telemetry.record_later",
        lambda name, value, tags: recorded.append((name, value, tags)),
    )
    payload = PlaybackQoeBatchRequest.model_validate(
        {
            "events": [
                {
                    "event": "startup",
                    "origin": "local",
                    "requested_policy": "original",
                    "effective_policy": "original",
                    "duration_ms": 215,
                },
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
    assert recorded == [
        (
            "playback.startup.ms",
            215.0,
            {
                "origin": "local",
                "requested_policy": "original",
                "effective_policy": "original",
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


def test_qoe_ingestion_rate_limits_per_authenticated_user(monkeypatch):
    from crate.api.playback_telemetry import post_playback_qoe

    monkeypatch.setattr(
        "crate.api.playback_telemetry._allow_qoe_events", lambda _user_id, _count: False
    )
    payload = PlaybackQoeBatchRequest.model_validate(
        {
            "events": [
                {
                    "event": "stall_end",
                    "origin": "local",
                    "requested_policy": "balanced",
                    "effective_policy": "balanced",
                    "duration_ms": 30,
                }
            ]
        }
    )

    with pytest.raises(HTTPException) as exc:
        post_playback_qoe(_request_for(99), payload)

    assert exc.value.status_code == 429

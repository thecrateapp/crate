"""Compatibility and filtering contracts for indexed radio responses."""

import json
from copy import deepcopy
from unittest.mock import patch
from uuid import UUID, uuid4

import pytest
from crate import radio_continuation, radio_engine
from crate.api import radio, smart_mix
from crate.api.schemas.radio import RadioNextRequest
from pydantic import ValidationError

from tests.test_playback_continuation_api import (
    _CONTEXT,
    _continuation_user,
    _no_planner_io,
    _radio_row,
)
from tests.test_radio_continuation_contract import MemoryRedis


@pytest.mark.parametrize("rotation_enabled", [True, False], ids=["rotation", "legacy"])
def test_legacy_global_radio_reports_exhaustion_consistently_on_start_and_next(
    test_app, monkeypatch, rotation_enabled
):
    monkeypatch.setenv("CRATE_RADIO_ROTATION_ENABLED", str(rotation_enabled).lower())
    monkeypatch.setattr(radio_engine, "history_for_candidates", lambda *_a, **_k: {})
    redis = MemoryRedis()
    monkeypatch.setattr(radio_engine, "_redis", lambda: redis)
    monkeypatch.setattr(radio_engine, "_resolve_seed", lambda *_args: None)
    monkeypatch.setattr(
        radio_engine,
        "_resolve_global_seed_tracks",
        lambda *_args, **_kwargs: {"seed_label": "Empty radio", "tracks": []},
    )
    monkeypatch.setattr(radio, "_continuation_user_id", lambda _user: 42)
    monkeypatch.setattr(radio, "_validate_continuation_seed", lambda *_args: None)

    start = test_app.post(
        "/api/radio/start", json={"seed_type": "artist", "seed_value": "remote"}
    )
    assert start.status_code == 200
    first = start.json()
    following = test_app.post(
        "/api/radio/next", json={"session_id": first["session_id"]}
    )
    assert following.status_code == 200
    assert first["tracks"] == following.json()["tracks"] == []
    assert first["exhausted"] is following.json()["exhausted"] is True
    assert first["status"] == following.json()["status"] == "exhausted"


def test_next_request_normalizes_an_uppercase_uuid():
    session_id = str(uuid4())

    request = RadioNextRequest(session_id=session_id.upper())

    assert isinstance(request.session_id, UUID)
    assert str(request.session_id) == session_id


def test_next_request_rejects_a_redis_internal_key_suffix():
    with pytest.raises(ValidationError):
        RadioNextRequest(session_id=f"{uuid4()}:batch:1")


@pytest.mark.parametrize("indexed", [False, True], ids=["legacy", "indexed"])
def test_next_endpoint_forwards_a_normalized_uuid(test_app, monkeypatch, indexed):
    session_id = str(uuid4())
    received = []
    payload = {"session_id": session_id.upper(), "count": 1}
    if indexed:
        payload["batch_index"] = 1

    def next_tracks(value, *_args, **_kwargs):
        received.append(value)
        return {"session_id": session_id, "tracks": [], "status": "retryable_empty"}

    monkeypatch.setattr(radio_engine, "get_session_user_id", lambda _session_id: 1)
    monkeypatch.setattr(radio_engine, "next_tracks", next_tracks)
    monkeypatch.setattr(radio_continuation, "next_batch", next_tracks)

    response = test_app.post("/api/radio/next", json=payload)

    assert response.status_code == 200
    assert received == [session_id]
    assert isinstance(received[0], str)


def test_next_endpoint_rejects_internal_keys_before_advancing(test_app, monkeypatch):
    received = []

    def next_batch(session_id, **_kwargs):
        received.append(session_id)
        return {"session_id": session_id, "tracks": []}

    monkeypatch.setattr(radio_continuation, "next_batch", next_batch)

    response = test_app.post(
        "/api/radio/next",
        json={"session_id": f"{uuid4()}:batch:1", "batch_index": 1},
    )

    assert response.status_code == 422
    assert received == []


def test_next_batch_normalizes_the_session_uuid_before_loading(monkeypatch):
    session_id = str(uuid4())
    redis = MemoryRedis()
    monkeypatch.setattr(radio_engine, "_redis", lambda: redis)
    monkeypatch.setattr(radio_engine, "_apply_buffer_context", lambda *_args: None)
    monkeypatch.setattr(
        radio_engine, "_generate_batch", lambda *_args: [{"track_id": 21}]
    )
    redis.setex(
        f"radio:session:{session_id}",
        60,
        json.dumps({"id": session_id, "user_id": 42, "track_count": 20}),
    )

    result = radio_continuation.next_batch(
        session_id.upper(), user_id=42, batch_index=1
    )

    assert result["status"] == "ok"
    assert result["session_id"] == session_id
    assert result["tracks"] == [{"track_id": 21}]
    assert redis.get(f"radio:session:{session_id.upper()}") is None


@pytest.mark.parametrize("operation", ["start", "next"])
@pytest.mark.parametrize("indexed", [False, True], ids=["legacy", "indexed"])
def test_radio_track_responses_preserve_null_fields(
    test_app, monkeypatch, operation, indexed
):
    session_id = str(uuid4())
    result = {
        "session_id": session_id,
        "tracks": [{"track_id": 7, "title": "Nullable track", "artist": None}],
    }
    monkeypatch.setattr(radio_engine, "start_radio", lambda **_kwargs: result)
    monkeypatch.setattr(radio_engine, "get_session_user_id", lambda _session_id: 1)
    monkeypatch.setattr(radio_engine, "next_tracks", lambda *_args: result)
    monkeypatch.setattr(radio_continuation, "start_batch", lambda **_kwargs: result)
    monkeypatch.setattr(
        radio_continuation, "next_batch", lambda *_args, **_kwargs: result
    )
    payload = {}
    if operation == "next" or indexed:
        payload["session_id"] = session_id
    if operation == "next" and indexed:
        payload["batch_index"] = 1

    response = test_app.post(f"/api/radio/{operation}", json=payload)

    assert response.status_code == 200
    track = response.json()["tracks"][0]
    for field in ("artist", "album", "duration", "bpm", "audio_key", "score"):
        assert field in track, f"legacy track parsers require the {field} field"
        assert track[field] is None


def test_station_responses_still_omit_optional_null_fields(test_app, monkeypatch):
    monkeypatch.setattr(
        radio,
        "get_user_radio_stations",
        lambda _user_id: {
            "artist_stations": [
                {
                    "type": "artist",
                    "seed_type": "artist",
                    "seed_value": "7",
                    "seed_label": "Band",
                    "title": "Band Radio",
                    "cover_url": None,
                }
            ],
            "genre_stations": [],
        },
    )

    response = test_app.get("/api/radio/stations")

    assert response.status_code == 200
    assert "cover_url" not in response.json()["artist_stations"][0]


def _indexed_batch(monkeypatch, rows, *, exhausted=False, status="ok"):
    session_id = str(uuid4())
    batch = {
        "session_id": session_id,
        "tracks": rows,
        "status": status,
        "exhausted": exhausted,
        "batch_index": 1,
    }
    calls = []
    monkeypatch.setattr(
        smart_mix,
        "get_continuation_descriptor",
        lambda _token_id: {"kind": "shaped_radio", "sessionId": session_id},
    )

    def indexed(_descriptor, **kwargs):
        calls.append(deepcopy(kwargs))
        return batch

    monkeypatch.setattr(radio, "indexed_continuation_batch", indexed)
    _no_planner_io(monkeypatch)
    return batch, calls


def _native_request(test_app, **extra):
    with patch("crate.api.auth.AuthMiddleware.resolve_user", _continuation_user()):
        return test_app.post(
            "/api/playback/continuation",
            json={
                "plannerVersion": "smart-mix-v2",
                "context": _CONTEXT,
                "batchIndex": 1,
                **extra,
            },
        )


@pytest.mark.parametrize("exhausted", [False, True], ids=["retryable", "exhausted"])
@pytest.mark.parametrize("row_kind", ["no-entity", "unplayable"])
def test_indexed_native_status_reflects_tracks_left_after_filtering(
    test_app, monkeypatch, exhausted, row_kind
):
    row = (
        {"track_id": 7, "title": "Missing canonical entity"}
        if row_kind == "no-entity"
        else _radio_row(str(uuid4()), playable=False)
    )
    _indexed_batch(monkeypatch, [row], exhausted=exhausted)

    response = _native_request(test_app)

    assert response.status_code == 200
    assert response.json()["tracks"] == []
    assert response.json()["plans"] == []
    assert response.json()["status"] == (
        "exhausted" if exhausted else "retryable_empty"
    )
    assert response.json()["exhausted"] is exhausted


def test_indexed_native_excludes_known_and_duplicate_tracks_without_mutating_replay(
    test_app, monkeypatch
):
    playing, recent, first, second = (str(uuid4()) for _ in range(4))
    batch, calls = _indexed_batch(
        monkeypatch,
        [
            _radio_row(playing),
            _radio_row(recent),
            _radio_row(first),
            _radio_row(first, title="Duplicate cached row"),
            _radio_row(second),
        ],
    )
    original = deepcopy(batch)

    response = _native_request(
        test_app, afterTrackEntityUid=playing, recentEntityUids=[recent]
    )
    replay = _native_request(
        test_app, afterTrackEntityUid=playing, recentEntityUids=[recent, first]
    )

    assert response.status_code == replay.status_code == 200
    assert [track["id"] for track in response.json()["tracks"]] == [first, second]
    assert [track["id"] for track in replay.json()["tracks"]] == [second]
    assert response.json()["status"] == replay.json()["status"] == "ok"
    assert calls[0]["buffer_refs"] == [recent, playing]
    assert calls[1]["buffer_refs"] == [first, recent, playing]
    assert batch == original


def test_indexed_native_all_known_tracks_are_retryable(test_app, monkeypatch):
    known = str(uuid4())
    _indexed_batch(monkeypatch, [_radio_row(known)])

    response = _native_request(test_app, recentEntityUids=[known])

    assert response.status_code == 200
    assert response.json()["tracks"] == []
    assert response.json()["status"] == "retryable_empty"
    assert response.json()["exhausted"] is False


@pytest.mark.parametrize("status", ["auth_required", "retryable_empty", "exhausted"])
def test_indexed_native_preserves_non_ok_empty_statuses(test_app, monkeypatch, status):
    _indexed_batch(monkeypatch, [], exhausted=status == "exhausted", status=status)

    response = _native_request(test_app)

    assert response.status_code == 200
    assert response.json()["tracks"] == []
    assert response.json()["status"] == status

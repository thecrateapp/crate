"""Session ownership and batch cursors are the continuation's public contract."""

import json
from copy import deepcopy
from types import SimpleNamespace
from uuid import uuid4

import pytest
from crate import radio_continuation, radio_engine
from crate.api import smart_mix
from crate.api.schemas.radio import (
    RadioBatchResponse,
    RadioNextRequest,
    RadioStartRequest,
)
from crate.api.schemas.smart_mix import (
    ContinuationDescriptor,
    PlaybackContinuationRequest,
    PlaybackContinuationResponse,
)

from tests.test_playback_continuation_api import _CONTEXT, _no_planner_io
from tests.test_radio_continuation_contract import MemoryRedis


@pytest.mark.parametrize(
    "model",
    [
        RadioStartRequest,
        RadioNextRequest,
        RadioBatchResponse,
        PlaybackContinuationRequest,
        PlaybackContinuationResponse,
        ContinuationDescriptor,
    ],
    ids=lambda model: model.__name__,
)
def test_continuation_models_do_not_advertise_a_numeric_revision(model):
    assert "revision" not in model.model_json_schema()["properties"]


@pytest.fixture
def sessions(monkeypatch):
    redis = MemoryRedis()
    session_id = str(uuid4())
    generated = []
    monkeypatch.setattr(radio_engine, "_redis", lambda: redis)
    monkeypatch.setattr(radio_engine, "_apply_buffer_context", lambda *_args: None)

    def create(user_id, *_args, **kwargs):
        session = {
            "id": kwargs["session_id"],
            "user_id": user_id,
            "track_count": 1,
            "initial_target": [0.2, 0.8],
            "current_target": [0.2, 0.8],
            "liked_vectors": [],
            "disliked_vectors": [],
        }
        return session, {
            "session_id": session["id"],
            "tracks": [{"track_id": 1, "entity_uid": str(uuid4())}],
        }

    def generate(session, count):
        generated.append(deepcopy(session))
        return [{"track_id": session["track_count"] + 1, "entity_uid": str(uuid4())}]

    monkeypatch.setattr(radio_engine, "_create_radio", create)
    monkeypatch.setattr(radio_engine, "_generate_batch", generate)
    monkeypatch.setattr(
        radio_engine, "get_track_bliss_vector", lambda _track_id: [0.9, 0.1]
    )
    monkeypatch.setattr(radio_engine, "persist_radio_feedback", lambda **_kwargs: None)
    return SimpleNamespace(redis=redis, session_id=session_id, generated=generated)


def test_radio_ignores_obsolete_revision_and_native_rejects_it_without_returning_it(
    test_app, monkeypatch, sessions
):
    _no_planner_io(monkeypatch)
    monkeypatch.setattr(
        smart_mix,
        "_require_continuation_token",
        lambda _request: {"id": 1, "access_token_id": 21},
    )
    monkeypatch.setattr(
        smart_mix,
        "get_continuation_descriptor",
        lambda _token_id: {
            "kind": "shaped_radio",
            "sessionId": sessions.session_id,
        },
    )

    responses = {
        "start": test_app.post(
            "/api/radio/start",
            json={"session_id": sessions.session_id, "count": 1, "revision": 99},
        ),
        "next": test_app.post(
            "/api/radio/next",
            json={
                "session_id": sessions.session_id,
                "batch_index": 1,
                "count": 1,
                "revision": 99,
            },
        ),
    }
    native_payload = {
        "plannerVersion": "smart-mix-v2",
        "context": _CONTEXT,
        "batchIndex": 1,
    }
    rejected = test_app.post(
        "/api/playback/continuation", json={**native_payload, "revision": 99}
    )
    assert rejected.status_code == 422
    assert any(
        error["loc"] == ["body", "revision"] and error["type"] == "extra_forbidden"
        for error in rejected.json()["detail"]
    )
    assert len(sessions.generated) == 1
    responses["native"] = test_app.post(
        "/api/playback/continuation", json=native_payload
    )

    assert all(response.status_code == 200 for response in responses.values())
    bodies = {endpoint: response.json() for endpoint, response in responses.items()}
    assert {endpoint: body["status"] for endpoint, body in bodies.items()} == {
        "start": "ok",
        "next": "ok",
        "native": "ok",
    }
    for endpoint, body in bodies.items():
        assert body["tracks"], endpoint
        assert body["exhausted"] is False, endpoint
        assert "revision" not in body, endpoint
    assert (
        responses["next"].json()["tracks"][0]["entity_uid"]
        == (responses["native"].json()["tracks"][0]["entityUid"])
    )
    assert len(sessions.generated) == 1


def test_feedback_preserves_committed_replay_and_cursor_and_owner_guards(sessions):
    session_id = sessions.session_id
    radio_continuation.start_batch(session_id=session_id, user_id=42, count=1)
    committed = radio_continuation.next_batch(
        session_id, user_id=42, batch_index=1, count=1
    )

    feedback = radio_engine.radio_feedback(session_id, 7, "like")
    replay = radio_continuation.next_batch(
        session_id, user_id=42, batch_index=1, count=1
    )
    wrong_cursor = radio_continuation.next_batch(
        session_id, user_id=42, batch_index=3, count=1
    )
    foreign = radio_continuation.next_batch(
        session_id, user_id=99, batch_index=1, count=1
    )

    assert feedback["effect"] == "target_shifted"
    assert replay == committed
    assert len(sessions.generated) == 1
    assert wrong_cursor["status"] == "retryable_empty"
    assert wrong_cursor["batch_index"] == 1
    assert wrong_cursor["exhausted"] is False
    assert foreign["tracks"] == []
    assert foreign["status"] == "exhausted"

    following = radio_continuation.next_batch(
        session_id, user_id=42, batch_index=2, count=1
    )

    assert following["tracks"][0]["track_id"] == 3
    assert [session["track_count"] for session in sessions.generated] == [1, 2]
    assert sessions.generated[1]["current_target"] == pytest.approx([0.256, 0.744])
    saved = json.loads(sessions.redis.get(f"radio:session:{session_id}"))
    assert saved["batch_index"] == 2
    assert saved["track_count"] == 3
    assert saved["liked_vectors"] == [[0.9, 0.1]]

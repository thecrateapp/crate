"""Pending queue context must preserve the listener's shaped radio target."""

from copy import deepcopy
import json

import pytest

from crate import radio_engine
from crate.db.queries import radio_continuation as context_queries


def _session(**overrides):
    return {
        "id": "33333333-3333-4333-8333-333333333333",
        "user_id": 42,
        "seed_type": "track",
        "seed_vector": [0.5, 0.5],
        "initial_target": [0.2, 0.8],
        "current_target": [0.6, 0.4],
        "liked_vectors": [[0.9, 0.1]],
        "disliked_vectors": [],
        "used_track_ids": [5],
        "used_titles": ["previous artist::previous song"],
        "recent_artists": ["Stale Artist"],
        "recent_tracks": [{"track_id": 5, "bpm": 90}],
        "track_count": 20,
        **overrides,
    }


def _buffer_row(track_id, *, vector=None):
    return {
        "track_id": track_id,
        "title": f"Song {track_id}",
        "artist": f"Artist {track_id}",
        "bliss_vector": vector,
        "bpm": 100 + track_id,
        "audio_key": "D",
        "audio_scale": "minor",
        "energy": 0.7,
        "year": 2026,
    }


@pytest.mark.parametrize(
    ("seed_type", "expected_target"),
    [
        pytest.param("track", [0.54, 0.46], id="track-10-percent"),
        pytest.param("artist", [0.552, 0.448], id="contextual-8-percent"),
        pytest.param(None, [0.51, 0.49], id="discovery-15-percent"),
    ],
)
def test_buffer_blends_last_track_with_existing_target_by_radio_profile(
    monkeypatch, seed_type, expected_target
):
    rows = [
        _buffer_row(7, vector=[1.0, 0.0]),
        _buffer_row(8, vector=[0.0, 1.0]),
    ]
    monkeypatch.setattr(context_queries, "get_buffer_context", lambda _refs: rows)
    session = _session(seed_type=seed_type)

    radio_engine._apply_buffer_context(session, ["7", "8"])

    assert session["current_target"] == pytest.approx(expected_target)
    assert session["seed_vector"] == [0.5, 0.5]
    assert session["initial_target"] == [0.2, 0.8]
    assert session["liked_vectors"] == [[0.9, 0.1]]


def test_buffer_replaces_stale_tail_context_and_adds_all_titles_for_repetition(
    monkeypatch,
):
    rows = [_buffer_row(index, vector=[0.0, 1.0]) for index in range(1, 8)]
    monkeypatch.setattr(context_queries, "get_buffer_context", lambda _refs: rows)
    session = _session(used_track_ids=[5, 1])

    radio_engine._apply_buffer_context(session, [str(index) for index in range(1, 8)])

    assert session["recent_tracks"] == [
        {key: value for key, value in row.items() if key != "bliss_vector"}
        for row in rows[-5:]
    ]
    assert session["recent_artists"] == ["Artist 5", "Artist 6", "Artist 7"]
    assert set(session["used_titles"]) == {
        "previous artist::previous song",
        *(f"artist {index}::song {index}" for index in range(1, 8)),
    }
    assert session["used_track_ids"] == [5, 1, 2, 3, 4, 6, 7]


def test_like_target_survives_next_batch_with_pending_buffer(monkeypatch):
    from crate.radio_continuation import next_batch
    from tests.test_radio_continuation_contract import MemoryRedis

    redis = MemoryRedis()
    monkeypatch.setattr(radio_engine, "_redis", lambda: redis)
    session = _session(current_target=[0.2, 0.8], liked_vectors=[])
    redis.setex(
        "radio:session:33333333-3333-4333-8333-333333333333", 86400, json.dumps(session)
    )
    monkeypatch.setattr(
        radio_engine, "get_track_bliss_vector", lambda _track_id: [0.9, 0.1]
    )
    monkeypatch.setattr(radio_engine, "persist_radio_feedback", lambda **_kwargs: None)
    monkeypatch.setattr(
        context_queries,
        "get_buffer_context",
        lambda _refs: [_buffer_row(8, vector=[0.0, 1.0])],
    )
    received_sessions = []

    def generate(current, count):
        received_sessions.append(deepcopy(current))
        return [{"track_id": 99, "title": "Next"}]

    monkeypatch.setattr(radio_engine, "_generate_batch", generate)

    feedback = radio_engine.radio_feedback(
        "33333333-3333-4333-8333-333333333333", 7, "like"
    )
    shaped = json.loads(redis.get("radio:session:33333333-3333-4333-8333-333333333333"))
    assert feedback["effect"] == "target_shifted"
    assert shaped["current_target"] == pytest.approx([0.256, 0.744])

    result = next_batch(
        "33333333-3333-4333-8333-333333333333",
        user_id=42,
        batch_index=1,
        count=1,
        buffer_refs=["8"],
    )

    assert result["status"] == "ok"
    assert received_sessions[0]["current_target"] == pytest.approx([0.2304, 0.7696])
    saved = json.loads(redis.get("radio:session:33333333-3333-4333-8333-333333333333"))
    assert saved["current_target"] == pytest.approx([0.2304, 0.7696])
    assert saved["liked_vectors"] == [[0.9, 0.1]]
    assert saved["seed_vector"] == [0.5, 0.5]
    assert saved["initial_target"] == [0.2, 0.8]


@pytest.mark.parametrize("missing_vector", [None, []], ids=["null", "empty"])
def test_buffer_without_a_vector_keeps_the_existing_target(monkeypatch, missing_vector):
    monkeypatch.setattr(
        context_queries,
        "get_buffer_context",
        lambda _refs: [_buffer_row(8, vector=missing_vector)],
    )
    session = _session()

    radio_engine._apply_buffer_context(session, ["8"])

    assert session["current_target"] == [0.6, 0.4]
    assert session["seed_vector"] == [0.5, 0.5]
    assert session["initial_target"] == [0.2, 0.8]
    assert session["liked_vectors"] == [[0.9, 0.1]]


@pytest.mark.parametrize("refs", [[], ["unresolved"]], ids=["empty", "unresolved"])
def test_buffer_without_resolved_tracks_does_not_reset_session(monkeypatch, refs):
    monkeypatch.setattr(context_queries, "get_buffer_context", lambda _refs: [])
    session = _session()
    original = deepcopy(session)

    radio_engine._apply_buffer_context(session, refs)

    assert session == original

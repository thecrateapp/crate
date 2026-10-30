"""Final session rotation contracts at selection and delivery boundaries."""

import json
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from crate import radio_engine
from crate.api import radio, smart_mix
from crate.recommendation_policy import canonical_key
from tests.test_playback_continuation_api import _CONTEXT, _no_planner_io
from tests.test_radio_continuation_contract import MemoryRedis
from tests.test_radio_delivery_memory import _row, _state, _wire

NOW = datetime(2026, 10, 30, 12, tzinfo=UTC)


@pytest.fixture(autouse=True)
def rotation(monkeypatch):
    monkeypatch.setenv("CRATE_RADIO_ROTATION_ENABLED", "true")
    monkeypatch.setattr(radio_engine, "history_for_candidates", lambda *_a, **_k: {})


def _ranked_catalog(monkeypatch):
    rows = [
        _row(1, artist="A", title="Delivered X"),
        _row(2, artist="B", title="Fresh"),
        _row(3, artist="C", title="Far"),
    ]
    for row in rows:
        row["bliss_vector"] = None
        row["entity_uid"] = str(uuid4())
    _wire(monkeypatch, rows)
    distances = {1: 0.1, 2: 0.4, 3: 1.0}
    monkeypatch.setattr(
        radio_engine, "_vector_distance", lambda row, *_a, **_k: distances[row["id"]]
    )
    monkeypatch.setattr(
        radio_engine, "_seeded_radio_weights", lambda _profile: (1.0, 0.0, 0.0)
    )
    monkeypatch.setattr(radio_engine, "_curation_penalty", lambda _row: 0.0)
    monkeypatch.setattr(radio_engine, "_seeded_radio_source_penalty", lambda *_a: 0.0)
    return rows


def test_delivered_song_cannot_beat_a_fresh_song_by_escaping_the_history_quality_band(
    monkeypatch,
):
    rows = _ranked_catalog(monkeypatch)
    state = _state()

    first = radio_engine._advance_radio(state, 1)
    assert first["tracks"][0]["track_id"] == rows[0]["id"]
    assert state["delivered_song_keys"] == [list(canonical_key(rows[0]))]

    # A five-second skip does not enter the significant seven-day history.
    radio_engine._apply_buffer_context(state, [])
    following = radio_engine._advance_radio(state, 1)

    assert following["tracks"][0]["track_id"] == rows[1]["id"]


def test_delivered_song_is_recoverable_when_no_fresh_candidate_remains(monkeypatch):
    rows = _ranked_catalog(monkeypatch)
    state = _state()
    radio_engine._advance_radio(state, 1)
    rows[:] = rows[:1]
    radio_engine._apply_buffer_context(state, [])

    following = radio_engine._advance_radio(state, 1)

    assert [track["track_id"] for track in following["tracks"]] == [1]
    assert following.get("exhausted", False) is False


@pytest.mark.parametrize(
    "significant_history", [False, True], ids=["ledger-only", "seven-days"]
)
def test_only_significant_history_expands_the_next_batch_pool(
    monkeypatch, significant_history
):
    rows = [_row(2, artist="B")]
    _wire(monkeypatch, rows)
    fetch = radio_engine.find_seeded_radio_candidate_rows
    retrievals, histories = [], []

    def retrieve(*args, **kwargs):
        retrievals.append(deepcopy(kwargs))
        return fetch(*args, **kwargs)

    def history(user_id, refs, since, **kwargs):
        histories.append((user_id, refs, since, kwargs["now"]))
        return (
            {("heard artist", "heard song"): {"frequency": 1}}
            if significant_history
            else {}
        )

    monkeypatch.setattr(radio_engine, "find_seeded_radio_candidate_rows", retrieve)
    monkeypatch.setattr(radio_engine, "history_for_candidates", history)
    state = _state(
        track_count=1,
        buffer_refs=[],
        delivered_song_keys=[["a", "previous delivery"]],
    )

    tracks = radio_engine._generate_batch(state, 1, now=NOW)

    assert [track["track_id"] for track in tracks] == [2]
    assert histories == [(42, None, NOW - timedelta(days=7), NOW)]
    assert len(retrievals) == 1
    assert retrievals[0]["limit"] == (420 if significant_history else 60)
    assert retrievals[0].get("artist_pick_multiplier", 1) == (
        2 if significant_history else 1
    )


def test_a_known_buffer_followed_by_null_keeps_title_and_song_memory_bounded(
    monkeypatch,
):
    buffer_track = _row(900, artist="Buffer")
    seed = _row(999, artist="Seed", title="Seed")
    fresh = _row(501, artist="Fresh")
    _wire(monkeypatch, [buffer_track, seed, fresh])
    state = _state(
        seed_track_ids=[seed["id"]],
        seed_song_keys=[radio_engine._song_key(seed)],
    )
    radio_engine._apply_buffer_context(state, ["900"])
    prior = [_row(index, artist=f"Prior {index}") for index in range(1, 500)]
    state.update(
        track_count=499,
        used_track_ids=[row["id"] for row in [*prior, buffer_track]],
        used_titles=[radio_engine._title_key(row) for row in [*prior, buffer_track]],
        used_song_keys=[radio_engine._song_key(row) for row in [*prior, buffer_track]],
        delivered_song_keys=[list(canonical_key(row)) for row in prior],
    )

    radio_engine._apply_buffer_context(state, None)
    result = radio_engine._advance_radio(state, 1)

    assert [track["track_id"] for track in result["tracks"]] == [fresh["id"]]
    sizes = {name: len(state[name]) for name in ("used_titles", "used_song_keys")}
    assert all(size <= 500 for size in sizes.values()), sizes


def test_bounded_title_and_song_memory_evicts_the_oldest_entries(monkeypatch):
    buffer_track = _row(900, artist="Buffer")
    fresh = _row(501, artist="Fresh")
    _wire(monkeypatch, [buffer_track, fresh])
    prior = [_row(index, artist=f"Prior {index}") for index in range(1, 500)]
    state = _state(seed_song_keys=["seed::song"])
    radio_engine._apply_buffer_context(state, ["900"])
    state.update(
        track_count=499,
        used_titles=[radio_engine._title_key(row) for row in [*prior, buffer_track]],
        used_song_keys=[radio_engine._song_key(row) for row in [*prior, buffer_track]],
    )

    result = radio_engine._advance_radio(state, 1)

    assert [track["track_id"] for track in result["tracks"]] == [fresh["id"]]
    for name, key in (
        ("used_titles", radio_engine._title_key),
        ("used_song_keys", radio_engine._song_key),
    ):
        memory = state[name]
        assert len(memory) == 500
        assert memory[-2:] == [key(buffer_track), key(fresh)]
        assert key(prior[0]) not in memory
        assert key(prior[-1]) in memory


def test_legacy_native_delivery_records_only_rows_returned_after_known_and_limit_filtering(
    test_app,
    monkeypatch,
):
    rows = _ranked_catalog(monkeypatch)
    redis = MemoryRedis()
    monkeypatch.setattr(radio_engine, "_redis", lambda: redis)
    state = _state(
        used_track_ids=[77],
        delivered_song_keys=[["earlier", "song"]],
        used_artist_counts={"earlier": 2},
    )
    key = f"radio:session:{state['id']}"
    redis.setex(key, 60, json.dumps(state))
    _no_planner_io(monkeypatch)
    monkeypatch.setattr(
        smart_mix,
        "_require_continuation_token",
        lambda _request: {"id": 42, "access_token_id": 21},
    )
    monkeypatch.setattr(
        smart_mix,
        "get_continuation_descriptor",
        lambda _token: {"kind": "shaped_radio", "sessionId": state["id"]},
    )

    response = test_app.post(
        "/api/playback/continuation",
        json={
            "plannerVersion": "smart-mix-v2",
            "context": _CONTEXT,
            "limit": 1,
            "recentEntityUids": [rows[0]["entity_uid"], str(uuid4())],
        },
    )

    assert response.status_code == 200
    assert [track["entityUid"] for track in response.json()["tracks"]] == [
        rows[1]["entity_uid"]
    ]
    assert response.json()["exhausted"] is False
    saved = json.loads(redis.get(key))
    assert {
        "ledger": saved["delivered_song_keys"],
        "artists": saved["used_artist_counts"],
        "ids": set(saved["used_track_ids"]),
        "track_count": saved["track_count"],
    } == {
        "ledger": [["earlier", "song"], list(canonical_key(rows[1]))],
        "artists": {"earlier": 2, "b": 1},
        "ids": {77, rows[1]["id"]},
        "track_count": 1,
    }


@pytest.mark.parametrize("rotation_enabled", [True, False], ids=["rotation", "legacy"])
def test_global_native_reloads_when_the_remaining_prefix_is_already_known(
    monkeypatch, rotation_enabled
):
    monkeypatch.setenv("CRATE_RADIO_ROTATION_ENABLED", str(rotation_enabled).lower())
    catalog = [
        {
            "global_track_uid": str(uuid4()),
            "entity_uid": str(uuid4()),
            "artist": "Global Artist",
            "title": f"Global Song {index}",
        }
        for index in range(121)
    ]
    state = _state(
        radio_profile="global_catalog",
        seed_type="artist",
        seed_value=str(uuid4()),
        global_tracks=deepcopy(catalog[:120]),
        global_cursor=119,
        global_source_exhausted=False,
        track_count=119,
        delivered_song_keys=[list(canonical_key(row)) for row in catalog[:119]],
    )
    redis = MemoryRedis()
    monkeypatch.setattr(radio_engine, "_redis", lambda: redis)
    key = f"radio:session:{state['id']}"
    redis.setex(key, 60, json.dumps(state))
    reloads = []

    def reload(seed_type, seed_value, *, limit):
        reloads.append((seed_type, seed_value, limit))
        return {"seed_label": "Global Artist", "tracks": deepcopy(catalog)}

    monkeypatch.setattr(radio_engine, "_resolve_global_seed_tracks", reload)

    rows, exhausted = radio.continuation_radio_tracks(
        {"kind": "shaped_radio", "sessionId": state["id"]},
        user={"id": 42},
        limit=1,
        exclude_entity_uids={catalog[119]["entity_uid"]},
    )

    assert [row["entity_uid"] for row in rows] == [catalog[120]["entity_uid"]]
    assert exhausted is False
    assert len(reloads) == 1
    saved = json.loads(redis.get(key))
    assert saved["global_cursor"] == 121
    assert saved["track_count"] == 120
    if rotation_enabled:
        assert saved["delivered_song_keys"] == [
            *state["delivered_song_keys"],
            list(canonical_key(catalog[120])),
        ]

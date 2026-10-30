"""Delivered songs cool across refills without becoming permanent exclusions."""

import json
from copy import deepcopy
from uuid import uuid4

import pytest
from crate import radio_continuation, radio_engine
from crate.db.queries import radio_continuation as context_queries

from tests.test_radio_continuation_contract import MemoryRedis


def _row(index, artist="A", title=None):
    return {
        "id": index,
        "track_id": index,
        "artist": artist,
        "title": title or f"Song {index}",
        "album": "Album",
        "bliss_vector": [0.2] * 20,
        "radio_source": "similar",
    }


def _state(**overrides):
    return {
        "id": str(uuid4()),
        "user_id": 42,
        "mode": "seeded",
        "seed_type": "track",
        "seed_artists": ["Seed"],
        "seed_genres": [],
        "seed_track_ids": [],
        "seed_song_keys": [],
        "seed_vector": [0.2] * 20,
        "initial_target": [0.2] * 20,
        "current_target": [0.2] * 20,
        "generation_seed": "delivery-test",
        "track_count": 0,
        "used_track_ids": [],
        "used_titles": [],
        "used_song_keys": [],
        "used_artist_counts": {},
        "delivered_song_keys": [],
        "recent_tracks": [],
        "recent_artists": [],
        "liked_vectors": [],
        "disliked_vectors": [],
        **overrides,
    }


@pytest.fixture(autouse=True)
def rotation(monkeypatch):
    monkeypatch.setenv("CRATE_RADIO_ROTATION_ENABLED", "true")
    monkeypatch.setattr(radio_engine, "history_for_candidates", lambda *_a, **_k: {})


def _wire(monkeypatch, rows):
    calls = []
    genres = {artist: {"post-hardcore": 1.0} for artist in ("seed", "a", "b")}
    monkeypatch.setattr(
        radio_engine,
        "_load_radio_graphs",
        lambda **_kwargs: ({"seed": {"a": 1.0, "b": 0.7}}, genres, {}),
    )

    def fetch(_target, exclude_ids, *, limit, **_kwargs):
        calls.append(set(exclude_ids))
        return deepcopy([row for row in rows if row["id"] not in exclude_ids][:limit])

    monkeypatch.setattr(radio_engine, "find_seeded_radio_candidate_rows", fetch)
    monkeypatch.setattr(radio_engine, "find_candidate_rows", lambda *_a, **_k: [])
    monkeypatch.setattr(
        context_queries,
        "get_buffer_context",
        lambda refs: [row for row in rows if str(row["id"]) in refs],
    )
    return calls


def test_a_five_second_skip_does_not_repeat_on_the_next_refill(monkeypatch):
    rows = [_row(1), _row(2)]
    _wire(monkeypatch, rows)
    state = _state()
    first = radio_engine._advance_radio(state, 1)["tracks"]
    assert [row["track_id"] for row in first] == [1]

    # A five-second skip is absent from significant listening history.
    radio_engine._apply_buffer_context(state, [])
    second = radio_engine._advance_radio(state, 1)["tracks"]

    assert [row["track_id"] for row in second] == [2]


def test_a_live_variant_of_a_delivered_song_is_cooled_when_a_fresh_song_exists(
    monkeypatch,
):
    # Isolate family cooling from the independent preference for studio versions.
    monkeypatch.setattr(radio_engine, "_RADIO_VARIANT_SCORE_PENALTY", 0)
    monkeypatch.setattr(radio_engine, "_curation_penalty", lambda _row: 0)
    _wire(monkeypatch, [_row(1, title="Song (Live)"), _row(2)])
    state = _state(delivered_song_keys=[["a", "song"]])

    result = radio_engine._advance_radio(state, 1)["tracks"]

    assert [row["track_id"] for row in result] == [2]


def test_cooled_song_can_return_when_the_coherent_catalog_has_no_fresh_song(
    monkeypatch,
):
    _wire(monkeypatch, [_row(1)])
    state = _state(delivered_song_keys=[["a", "song 1"]])
    radio_engine._apply_buffer_context(state, [])

    result = radio_engine._advance_radio(state, 1)["tracks"]

    assert [row["track_id"] for row in result] == [1]


def test_artist_session_limit_survives_two_refills(monkeypatch):
    rows = [_row(index) for index in range(1, 4)]
    _wire(monkeypatch, rows)
    state = _state()
    first = radio_engine._advance_radio(state, 3)["tracks"]
    assert len(first) == 3
    assert state["used_artist_counts"]["a"] == 3
    rows[:] = [_row(4), _row(5, artist="B")]
    state["recent_artists"] = []
    state["recent_tracks"] = []

    radio_engine._apply_buffer_context(state, [])
    second = radio_engine._advance_radio(state, 1)["tracks"]

    assert [row["track_id"] for row in second] == [5]
    assert state["used_artist_counts"]["a"] == 3
    assert state["used_artist_counts"]["b"] == 1


def test_explicit_empty_buffer_cannot_release_the_seed_or_its_song_family(monkeypatch):
    _wire(monkeypatch, [_row(1, title="Seed"), _row(2, title="Seed (Live)"), _row(3)])
    state = _state(
        seed_track_ids=[1],
        seed_song_keys=["a::seed"],
        used_song_keys=["a::seed"],
    )

    radio_engine._apply_buffer_context(state, [])
    result = radio_engine._advance_radio(state, 1)["tracks"]

    assert [row["track_id"] for row in result] == [3]


@pytest.mark.parametrize(
    "promote", [False, True], ids=["evict-oldest", "promote-existing"]
)
def test_delivery_ledger_keeps_the_latest_five_hundred_canonical_songs(
    monkeypatch, promote
):
    ledger = [["a", f"song {index}"] for index in range(500)]
    chosen = 250 if promote else 501
    _wire(monkeypatch, [_row(chosen)])
    state = _state(delivered_song_keys=deepcopy(ledger))

    result = radio_engine._advance_radio(state, 1)["tracks"]

    assert len(result) == 1
    key = ["a", f"song {chosen}"]
    expected = [entry for entry in ledger if entry != key] + [key]
    assert state["delivered_song_keys"] == expected[-500:]


def test_replaying_an_indexed_batch_does_not_promote_the_ledger_twice(monkeypatch):
    _wire(monkeypatch, [_row(1), _row(2)])
    redis = MemoryRedis()
    monkeypatch.setattr(radio_engine, "_redis", lambda: redis)
    state = _state()
    redis.setex(f"radio:session:{state['id']}", 60, json.dumps(state))

    first = radio_continuation.next_batch(
        state["id"], user_id=42, batch_index=1, count=1
    )
    committed = json.loads(redis.get(f"radio:session:{state['id']}"))
    replay = radio_continuation.next_batch(
        state["id"], user_id=42, batch_index=1, count=1
    )
    repeated = json.loads(redis.get(f"radio:session:{state['id']}"))

    assert first == replay
    assert committed["delivered_song_keys"] == [["a", "song 1"]]
    assert repeated == committed


def test_historical_id_parameters_are_bounded_without_stalling_the_python_pool(
    monkeypatch,
):
    rows = [_row(index) for index in range(1, 701)] + [_row(900)]
    calls = _wire(monkeypatch, rows)
    state = _state(
        used_track_ids=list(range(1, 701)),
        seed_track_ids=[1],
        seed_song_keys=["a::song 1"],
        used_song_keys=["a::song 1"],
        delivered_song_keys=[["a", f"song {index}"] for index in range(201, 701)],
    )

    result = radio_engine._advance_radio(state, 1)["tracks"]

    assert len(result) == 1
    assert result[0]["track_id"] != 1
    assert all(len(excluded) <= 50 for excluded in calls)


def test_global_cursor_advances_across_successive_known_buffers(monkeypatch):
    tracks = [
        {"global_track_uid": f"g{index}", "artist": "A", "title": f"Song {index}"}
        for index in range(1, 4)
    ]
    state = _state(
        radio_profile="global_catalog",
        global_tracks=tracks,
        global_cursor=0,
        global_source_exhausted=True,
    )

    radio_engine._apply_buffer_context(state, [])
    first = radio_engine._generate_global_batch(state, 1)
    radio_engine._apply_buffer_context(state, [])
    second = radio_engine._generate_global_batch(state, 1)

    assert [row["global_track_uid"] for row in first + second] == ["g1", "g2"]
    assert state["global_cursor"] == 2
    assert state["delivered_song_keys"] == [["a", "song 1"], ["a", "song 2"]]


def test_global_cooled_fallback_can_recover_after_the_catalog_cursor_is_consumed():
    state = _state(
        radio_profile="global_catalog",
        global_tracks=[{"global_track_uid": "g1", "artist": "A", "title": "Song"}],
        global_cursor=1,
        global_source_exhausted=True,
        delivered_song_keys=[["a", "song"]],
    )

    radio_engine._apply_buffer_context(state, [])
    result = radio_engine._generate_global_batch(state, 1)

    assert [row["global_track_uid"] for row in result] == ["g1"]
    assert state["global_exhausted"] is False


class _PickLast:
    def __init__(self):
        self.calls = 0

    def choice(self, values):
        self.calls += 1
        return values[-1]


def _rank(monkeypatch, history, *, near_score=0.14):
    rows = [_row(1, title="Best"), _row(2, title="Near"), _row(3, title="Far")]
    scores = {1: 0.1, 2: near_score, 3: 1.0}
    rng = _PickLast()
    monkeypatch.setattr(
        radio_engine, "_vector_distance", lambda row, *_a, **_k: scores[row["id"]]
    )
    monkeypatch.setattr(
        radio_engine, "_seeded_radio_weights", lambda _profile: (1.0, 0.0, 0.0)
    )
    monkeypatch.setattr(radio_engine, "_seeded_radio_source_penalty", lambda *_a: 0.0)
    monkeypatch.setattr(radio_engine, "_curation_penalty", lambda _row: 0.0)
    selected = radio_engine._select_radio_candidate_from_rows(
        rows,
        [0.2] * 20,
        set(),
        set(),
        set(),
        {},
        {},
        [],
        {},
        {},
        {},
        [],
        artist_affinity_cache={},
        genre_overlap_cache={},
        genre_overlap=lambda *_a: 0.0,
        radio_profile="track",
        rotation_history=history,
        rng=rng,
    )
    return selected, rng


def test_unrelated_history_preserves_argmin_without_consuming_randomness(monkeypatch):
    chosen, rng = _rank(monkeypatch, {("unrelated", "song"): {}})

    assert chosen["id"] == 1
    assert rng.calls == 0


def test_quality_band_can_rotate_a_cooled_best_to_a_coherent_fresh_song(monkeypatch):
    chosen, rng = _rank(monkeypatch, {("a", "best"): {}})

    assert chosen["id"] == 2
    assert rng.calls == 1


def test_quality_band_does_not_trade_a_cooled_best_for_an_incoherent_fresh_song(
    monkeypatch,
):
    chosen, _rng = _rank(monkeypatch, {("a", "best"): {}}, near_score=0.16)

    assert chosen["id"] == 1

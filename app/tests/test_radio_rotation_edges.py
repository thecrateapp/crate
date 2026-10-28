import json
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path

import pytest
from crate import radio_engine
from crate.recommendation_policy import canonical_key


def _state():
    state = json.loads(
        (Path(__file__).parent / "fixtures/recommendations/citizen.json").read_text()
    )["initial_session"]
    state.update(
        seed_artists=["Seed"],
        seed_track_ids=[],
        seed_vector=[0.2] * 20,
        current_target=[0.2] * 20,
        generation_seed=42,
    )
    return state


def _row(index, artist):
    return {
        "id": index,
        "artist": artist,
        "title": f"Song {index}",
        "album": "Album",
        "bliss_vector": [0.2] * 20,
        "radio_source": "similar",
    }


def _history(tracks):
    return {
        canonical_key(track): {
            "last_significant_play_at": datetime(2026, 10, 27, tzinfo=UTC),
            "frequency": 1,
            "completed": 1,
        }
        for track in tracks
    }


def test_cooled_shortlist_keeps_artist_diversity_to_fill_the_batch(monkeypatch):
    monkeypatch.setenv("CRATE_RADIO_ROTATION_ENABLED", "true")
    rows = [_row(index, "Closest") for index in range(1, 25)] + [
        _row(index, f"Neighbor {index}") for index in range(25, 185)
    ]
    genre_map = {row["artist"].lower(): {"post-hardcore": 1.0} for row in rows}
    genre_map["seed"] = {"post-hardcore": 1.0}
    similar = {
        "seed": {
            row["artist"].lower(): 1.0 if row["artist"] == "Closest" else 0.9
            for row in rows
        }
    }
    monkeypatch.setattr(
        radio_engine, "_load_radio_graphs", lambda **k: (similar, genre_map, {})
    )
    monkeypatch.setattr(
        radio_engine,
        "_seeded_radio_candidate_rows",
        lambda *a, **k: deepcopy(rows),
    )
    monkeypatch.setattr(
        radio_engine, "history_for_candidates", lambda *a, **k: _history(rows)
    )

    tracks = radio_engine._generate_batch(_state(), 20)

    assert len(tracks) == 20
    assert len({track["artist"] for track in tracks}) >= 10


@pytest.mark.parametrize("rotation", [True, False])
def test_known_empty_buffer_can_recover_single_artist_catalog(monkeypatch, rotation):
    monkeypatch.setenv("CRATE_RADIO_ROTATION_ENABLED", str(rotation).lower())
    row = _row(1, "Seed")
    monkeypatch.setattr(radio_engine, "_load_radio_graphs", lambda **k: ({}, {}, {}))
    monkeypatch.setattr(
        radio_engine, "_seeded_radio_candidate_rows", lambda *a, **k: [deepcopy(row)]
    )
    monkeypatch.setattr(
        radio_engine, "history_for_candidates", lambda *a, **k: _history([row])
    )
    state = _state()
    state.update(recent_artists=["Seed", "Seed"], used_track_ids=[1])
    radio_engine._apply_buffer_context(state, [])

    tracks = radio_engine._generate_batch(state, 1)

    assert [track["track_id"] for track in tracks] == ([1] if rotation else [])


def _global_row(index):
    return {
        "global_track_uid": f"global-{index}",
        "artist": "Seed",
        "title": f"Song {index}",
    }


def _global_state(tracks, *, monkeypatch=None, **kwargs):
    state = {
        "user_id": 0,
        "radio_profile": "global_catalog",
        "seed_type": "artist",
        "seed_value": "seed-global-artist",
        "global_tracks": deepcopy(tracks),
        "global_cursor": 0,
        "global_source_exhausted": False,
        **kwargs,
    }
    if "buffer_refs" in kwargs:
        if kwargs["buffer_refs"]:
            assert monkeypatch is not None
            monkeypatch.setattr(
                "crate.db.queries.radio_continuation.get_buffer_context",
                lambda refs: [row for row in tracks if row["global_track_uid"] in refs],
            )
        radio_engine._apply_buffer_context(state, kwargs["buffer_refs"])
    return state


def test_global_radio_expands_before_recovering_cooled_songs(monkeypatch):
    monkeypatch.setenv("CRATE_RADIO_ROTATION_ENABLED", "true")
    tracks = [_global_row(index) for index in range(1, 122)]
    calls = []

    def resolve(seed_type, seed_value, *, limit):
        calls.append(limit)
        return {"tracks": deepcopy(tracks[:limit]), "seed_label": "Seed"}

    monkeypatch.setattr(radio_engine, "_resolve_global_seed_tracks", resolve)
    monkeypatch.setattr(
        radio_engine, "history_for_candidates", lambda *a, **k: _history(tracks[:120])
    )
    state = _global_state(tracks[:120])

    result = radio_engine._generate_global_batch(state, 20)

    assert result[0]["global_track_uid"] == "global-121"
    assert len(result) == 20
    assert len(calls) == 1
    assert 120 < calls[0] <= 5_000


def test_global_expansion_preserves_consumed_prefix_after_rotation(monkeypatch):
    monkeypatch.setenv("CRATE_RADIO_ROTATION_ENABLED", "true")
    first, second, third, fourth = [_global_row(index) for index in range(1, 5)]
    calls = []

    def resolve(seed_type, seed_value, *, limit):
        calls.append(limit)
        return {"tracks": [first, second, third, fourth], "seed_label": "Seed"}

    monkeypatch.setattr(radio_engine, "_resolve_global_seed_tracks", resolve)
    monkeypatch.setattr(
        radio_engine,
        "history_for_candidates",
        lambda *a, **k: _history([first, third]),
    )
    state = _global_state([second, third, first], global_cursor=1)

    result = radio_engine._generate_global_batch(state, 3)

    assert [row["global_track_uid"] for row in result] == [
        "global-4",
        "global-3",
        "global-1",
    ]
    assert len(calls) == 1


@pytest.mark.parametrize("buffer_refs", [[], ["global-1"]])
def test_global_single_track_remains_retryable_with_known_buffer(
    monkeypatch, buffer_refs
):
    monkeypatch.setenv("CRATE_RADIO_ROTATION_ENABLED", "true")
    row = _global_row(1)
    monkeypatch.setattr(
        radio_engine, "history_for_candidates", lambda *a, **k: _history([row])
    )
    state = _global_state(
        [row],
        monkeypatch=monkeypatch,
        global_cursor=1,
        global_source_exhausted=True,
        buffer_refs=buffer_refs,
    )

    result = radio_engine._generate_global_batch(state, 1)

    assert [track["global_track_uid"] for track in result] == (
        [] if buffer_refs else ["global-1"]
    )
    assert state["global_exhausted"] is False


@pytest.mark.parametrize("rotation", [True, False])
def test_global_consumed_catalog_remains_exhausted_when_buffer_is_unknown(
    monkeypatch, rotation
):
    monkeypatch.setenv("CRATE_RADIO_ROTATION_ENABLED", str(rotation).lower())
    row = _global_row(1)
    monkeypatch.setattr(
        radio_engine, "history_for_candidates", lambda *a, **k: _history([row])
    )
    state = _global_state([row], global_cursor=1, global_source_exhausted=True)

    assert radio_engine._generate_global_batch(state, 1) == []
    assert state["global_exhausted"] is True


def test_global_manually_excluded_catalog_is_genuinely_exhausted(monkeypatch):
    monkeypatch.setenv("CRATE_RADIO_ROTATION_ENABLED", "true")
    row = _global_row(1)
    monkeypatch.setattr(radio_engine, "history_for_candidates", lambda *a, **k: {})
    state = _global_state(
        [row],
        global_source_exhausted=True,
        buffer_refs=[],
        excluded_global_track_uids=["global-1"],
    )

    assert radio_engine._generate_global_batch(state, 1) == []
    assert state["global_exhausted"] is True


@pytest.mark.parametrize("blocked_by", ["buffer_refs", "song_families", "dislikes"])
def test_global_radio_expands_past_ineligible_prefix_without_listening_history(
    monkeypatch, blocked_by
):
    monkeypatch.setenv("CRATE_RADIO_ROTATION_ENABLED", "true")
    tracks = [_global_row(index) for index in range(1, 122)]
    state = _global_state(tracks[:120], buffer_refs=[])
    if blocked_by == "buffer_refs":
        state["buffer_refs"] = [row["global_track_uid"] for row in tracks[:120]]
    elif blocked_by == "song_families":
        state["buffer_song_keys"] = [list(canonical_key(row)) for row in tracks[:120]]
        tracks = [
            dict(row, title=row["title"] + " (Live)") if index < 120 else row
            for index, row in enumerate(tracks)
        ]
        state["global_tracks"] = deepcopy(tracks[:120])
    else:
        state["excluded_global_track_uids"] = [
            row["global_track_uid"] for row in tracks[:120]
        ]
    calls = []

    def resolve(seed_type, seed_value, *, limit):
        calls.append(limit)
        return {"tracks": deepcopy(tracks[:limit]), "seed_label": "Seed"}

    monkeypatch.setattr(radio_engine, "_resolve_global_seed_tracks", resolve)
    monkeypatch.setattr(radio_engine, "history_for_candidates", lambda *a, **k: {})

    result = radio_engine._generate_global_batch(state, 20)

    assert [row["global_track_uid"] for row in result] == ["global-121"]
    assert len(calls) == 1
    assert 120 < calls[0] <= 5_000


@pytest.mark.parametrize("apply_unknown_buffer", [True, False])
def test_global_known_buffer_is_consumed_by_its_own_request(
    monkeypatch, apply_unknown_buffer
):
    monkeypatch.setenv("CRATE_RADIO_ROTATION_ENABLED", "true")
    tracks = [_global_row(index) for index in range(1, 4)]
    monkeypatch.setattr(radio_engine, "history_for_candidates", lambda *a, **k: {})
    state = _global_state(tracks, global_source_exhausted=True)

    radio_engine._apply_buffer_context(state, [])
    first = radio_engine._generate_global_batch(state, 1)
    if apply_unknown_buffer:
        radio_engine._apply_buffer_context(state, None)
    second = radio_engine._generate_global_batch(state, 1)
    third = radio_engine._generate_global_batch(state, 1)

    assert [row["global_track_uid"] for row in first + second + third] == [
        "global-1",
        "global-2",
        "global-3",
    ]

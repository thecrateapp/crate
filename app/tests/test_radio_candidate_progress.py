import json
from copy import deepcopy
from pathlib import Path

from crate import radio_engine


def _row(track_id, title=None):
    return {
        "id": track_id,
        "title": title or f"Song {track_id}",
        "artist": f"Artist {track_id}",
        "album": "Album",
        "bliss_vector": [0.2] * 20,
        "radio_source": "similar",
    }


def _retrieve(monkeypatch, rows, used_ids, **kwargs):
    calls = []

    def fetch(_target, exclude, *, limit, **_kwargs):
        calls.append((set(exclude), limit))
        return deepcopy([row for row in rows if row["id"] not in exclude][:limit])

    monkeypatch.setattr(radio_engine, "find_seeded_radio_candidate_rows", fetch)
    monkeypatch.setattr(radio_engine, "find_candidate_rows", lambda *a, **k: [])
    result = radio_engine._seeded_radio_candidate_rows(
        [0.2] * 20, used_ids, [], ["Seed"], [], {}, {}, count=20, **kwargs
    )
    return result, calls


def test_retrieval_bounds_historical_id_parameters_without_emptying_the_pool(
    monkeypatch,
):
    monkeypatch.setenv("CRATE_RADIO_ROTATION_ENABLED", "true")
    rows, calls = _retrieve(
        monkeypatch, [_row(i) for i in range(1, 221)], list(range(1, 141))
    )
    assert len(rows) >= 20
    assert all(len(excluded) <= 50 for excluded, _limit in calls)


def test_candidate_pool_expands_when_rows_are_ineligible_song_families(monkeypatch):
    monkeypatch.setenv("CRATE_RADIO_ROTATION_ENABLED", "true")
    rows = [_row(i, "Used (Live)") for i in range(1, 141)]
    used_keys = {radio_engine._song_key(row) for row in rows}
    rows += [_row(i) for i in range(141, 221)]
    result, calls = _retrieve(monkeypatch, rows, [], used_song_keys=used_keys)
    assert len(result) >= 20
    assert all(row["id"] > 140 for row in result)
    assert 1 < len(calls) <= 3


def test_enough_eligible_songs_do_not_trigger_an_extra_query_for_variants(monkeypatch):
    monkeypatch.setenv("CRATE_RADIO_ROTATION_ENABLED", "true")
    rows = [_row(i) for i in range(1, 120)]
    rows.insert(0, dict(rows[0], id=300, title=rows[0]["title"] + " (Live)"))
    result, calls = _retrieve(monkeypatch, rows, [])
    assert len(result) >= 20
    assert len(calls) == 1


def test_disliked_prefix_does_not_hide_tracks_beyond_the_first_pool(monkeypatch):
    monkeypatch.setenv("CRATE_RADIO_ROTATION_ENABLED", "true")
    rejected = [1.0] + [0.0] * 19
    fresh = [0.0, 1.0] + [0.0] * 18
    rows = [
        dict(_row(i), bliss_vector=rejected if i <= 120 else fresh)
        for i in range(1, 141)
    ]
    monkeypatch.setattr(
        radio_engine,
        "find_seeded_radio_candidate_rows",
        lambda target, exclude, limit, **k: deepcopy(
            [r for r in rows if r["id"] not in exclude][:limit]
        ),
    )
    monkeypatch.setattr(radio_engine, "_load_radio_graphs", lambda **k: ({}, {}, {}))
    monkeypatch.setattr(radio_engine, "history_for_candidates", lambda *a, **k: {})
    state = json.loads(
        (Path(__file__).parent / "fixtures/recommendations/citizen.json").read_text()
    )["initial_session"]
    state.update(
        disliked_vectors=[rejected],
        seed_artists=["Seed"],
        current_target=rejected,
        seed_vector=rejected,
        generation_seed=42,
    )
    tracks = radio_engine._generate_batch(state, count=20)
    assert len(tracks) == 20
    assert all(track["track_id"] > 120 for track in tracks)


def test_disabled_rotation_preserves_legacy_retrieval(monkeypatch):
    monkeypatch.setenv("CRATE_RADIO_ROTATION_ENABLED", "false")
    result, calls = _retrieve(
        monkeypatch, [_row(i) for i in range(1, 221)], list(range(1, 141))
    )
    assert any(row["id"] <= 140 for row in result)
    assert calls[0][0] == set(range(91, 141))
    assert len(calls) == 1


def test_recent_history_widens_the_candidate_pool_in_one_query(
    monkeypatch,
):
    monkeypatch.setenv("CRATE_RADIO_ROTATION_ENABLED", "true")
    from crate.recommendation_policy import canonical_key

    rows = [_row(i) for i in range(1, 221)]
    recent = {canonical_key(row) for row in rows[:120]}
    result, calls = _retrieve(monkeypatch, rows, [], recent_song_keys=recent)
    assert any(row["id"] > 120 for row in result)
    assert len(calls) == 1
    assert calls[0][1] > 120


def test_active_buffer_keeps_cooled_memory_artist_counts_and_seed_exclusions(
    monkeypatch,
):
    monkeypatch.setenv("CRATE_RADIO_ROTATION_ENABLED", "true")
    from crate.db.queries import radio_continuation

    row = {**_row(201), "track_id": 201}
    monkeypatch.setattr(radio_continuation, "get_buffer_context", lambda refs: [row])
    session = {
        "used_track_ids": list(range(1, 201)),
        "used_titles": ["old::song"],
        "used_song_keys": ["old::song"],
        "seed_song_keys": ["seed::song"],
        "delivered_song_keys": [["old", "song"]],
        "used_artist_counts": {"old": 4},
    }
    radio_engine._apply_buffer_context(session, ["201"])
    assert 201 in session["used_track_ids"]
    assert radio_engine._song_key(row) in session["used_song_keys"]
    assert session["delivered_song_keys"] == [["old", "song"]]
    assert session["used_artist_counts"].get("old") == 4
    assert session["seed_song_keys"] == ["seed::song"]
    assert session["used_titles"] == [radio_engine._title_key(row)]


def test_explicit_empty_buffer_keeps_delivered_memory_counts_and_seed(monkeypatch):
    monkeypatch.setenv("CRATE_RADIO_ROTATION_ENABLED", "true")
    session = {
        "used_track_ids": [7],
        "used_titles": ["a::song"],
        "used_song_keys": ["a::song"],
        "seed_track_ids": [1],
        "seed_song_keys": ["seed::song"],
        "delivered_song_keys": [["a", "song"]],
        "used_artist_counts": {"a": 3},
    }
    radio_engine._apply_buffer_context(session, [])
    assert session["delivered_song_keys"] == [["a", "song"]]
    assert session["used_artist_counts"] == {"a": 3}
    assert session["seed_track_ids"] == [1]
    assert session["seed_song_keys"] == ["seed::song"]
    assert session["buffer_refs"] == []


def test_missing_buffer_keeps_conservative_legacy_exclusions(monkeypatch):
    monkeypatch.setenv("CRATE_RADIO_ROTATION_ENABLED", "true")
    session = {"used_track_ids": [7], "used_song_keys": ["a::song"]}
    radio_engine._apply_buffer_context(session, None)
    assert session["used_track_ids"] == [7]
    assert session["used_song_keys"] == ["a::song"]


def test_disabled_rotation_preserves_legacy_global_ref_context(monkeypatch):
    monkeypatch.setenv("CRATE_RADIO_ROTATION_ENABLED", "false")
    uid = "123e4567-e89b-12d3-a456-426614174042"
    monkeypatch.setattr(
        "crate.db.queries.radio_continuation.get_buffer_context",
        lambda refs, include_global=True: (
            [
                {
                    "track_id": 99,
                    "entity_uid": None,
                    "global_track_uid": uid,
                    "artist": "A",
                    "title": "Song",
                    "bliss_vector": [0.9] * 20,
                }
            ]
            if include_global
            else []
        ),
    )
    state = {"used_track_ids": [7], "current_target": [0.5] * 20}
    radio_engine._apply_buffer_context(state, [uid])
    assert state["used_track_ids"] == [7]
    assert state["current_target"] == [0.5] * 20


def test_unanalysed_buffer_tracks_still_exclude_their_song_family(monkeypatch):
    monkeypatch.setenv("CRATE_RADIO_ROTATION_ENABLED", "true")
    from crate.db.queries import radio_continuation

    row = {**_row(201), "track_id": 201, "bliss_vector": None}
    monkeypatch.setattr(radio_continuation, "get_buffer_context", lambda refs: [row])
    session = {"used_track_ids": [], "current_target": [0.5] * 20}
    radio_engine._apply_buffer_context(session, ["201"])
    assert session["used_track_ids"] == [201]
    assert radio_engine._song_key(row) in session["used_song_keys"]
    assert session["current_target"] == [0.5] * 20

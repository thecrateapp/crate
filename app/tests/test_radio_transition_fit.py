import json
from copy import deepcopy
from uuid import uuid4

import pytest
from sqlalchemy import event, text

from crate import radio_engine
from crate.db import paths_candidates
from crate.db.queries.paths_bliss_candidate_queries import (
    find_candidate_rows,
    find_seeded_radio_candidate_rows,
)
from crate.db.queries.smart_mix_transition_edges import attach_transition_edges
from crate.db.tx import transaction_scope
from crate.smart_mix.transition_fit import (
    TRANSITION_EDGE_COLUMNS,
    RowTransitionScorer,
)
from tests.recommendation_evaluation import (
    _FIXTURE_DIR,
    evaluate_snapshot,
    load_mix_edges,
)

_GENRES = {name: {"post-hardcore": 1.0} for name in ("seed", "a", "b", "c", "context")}


def _edges(**overrides):
    edges = {
        "mix_quality": "full",
        "mix_bpm": 140.0,
        "mix_bpm_confidence": 0.95,
        "mix_tempo_stability": 0.95,
        "mix_intro_tempo_stability": 0.95,
        "mix_outro_tempo_stability": 0.95,
        "mix_time_signature": 4,
        "mix_beat_anchor_ms": 300,
        "mix_key_camelot": "8A",
        "mix_intro_lufs": -12.0,
        "mix_outro_lufs": -12.0,
        "mix_measurement_version": "bs1770-v1",
        "mix_intro_energy": 0.7,
        "mix_outro_energy": 0.7,
        "mix_intro_spectral_density": 0.72,
        "mix_outro_spectral_density": 0.72,
        "mix_duration_ms": 200_000,
        "mix_active_start_ms": 100,
        "mix_active_end_ms": 199_600,
        "mix_danceability": None,
        "mix_valence": None,
    }
    edges.update(overrides)
    return edges


def _track(track_id, artist, *, bpm, audio_key, **edges):
    return {
        "id": track_id,
        "track_id": track_id,
        "artist": artist,
        "title": f"Song {track_id}",
        "album": f"Album {track_id}",
        "bliss_vector": [0.2] * 20,
        "radio_source": "similar",
        "bpm": bpm,
        "audio_key": audio_key,
        "audio_scale": "minor",
        "energy": 0.7,
        **_edges(mix_bpm=bpm, **edges),
    }


def _fade_out_context():
    return _track(
        90,
        "context",
        bpm=140.0,
        audio_key="A",
        mix_outro_lufs=-20.0,
        mix_outro_spectral_density=0.68,
    )


def _candidates():
    cold_open = _track(
        1,
        "a",
        bpm=140.0,
        audio_key="A",
        mix_intro_lufs=-7.0,
        mix_intro_spectral_density=0.86,
    )
    smooth_entry = _track(
        2,
        "b",
        bpm=118.0,
        audio_key="F",
        mix_key_camelot="3B",
        mix_intro_lufs=-19.0,
        mix_intro_spectral_density=0.69,
    )
    return [cold_open, smooth_entry]


def _select_radio(rows, recent_tracks, scorer):
    return radio_engine._select_radio_candidate_from_rows(
        deepcopy(rows),
        [0.2] * 20,
        set(),
        set(),
        set(),
        {},
        {},
        [],
        {},
        _GENRES,
        {},
        ["seed"],
        artist_affinity_cache={},
        genre_overlap_cache={},
        genre_overlap=lambda *_args: 0.0,
        recent_tracks=recent_tracks,
        transition_scorer=scorer,
    )


def test_radio_prefers_a_smooth_entry_when_transition_fit_is_available():
    context = radio_engine._recent_track_context(_fade_out_context())

    legacy = _select_radio(_candidates(), [context], None)
    fitted = _select_radio(_candidates(), [context], RowTransitionScorer(_GENRES))

    assert legacy["id"] == 1
    assert fitted["id"] == 2


def test_radio_falls_back_to_coarse_penalties_when_the_playing_track_has_no_profile():
    context = {
        key: value
        for key, value in radio_engine._recent_track_context(
            _fade_out_context()
        ).items()
        if not key.startswith("mix_")
    }

    fitted = _select_radio(_candidates(), [context], RowTransitionScorer(_GENRES))

    assert fitted["id"] == 1


def test_unprofiled_candidates_get_a_neutral_seam_instead_of_coarse_penalties():
    context = radio_engine._recent_track_context(_fade_out_context())
    cold_open, smooth_entry = _candidates()
    unprofiled = {
        key: value
        for key, value in {**cold_open, "id": 3, "track_id": 3, "artist": "c"}.items()
        if not key.startswith("mix_")
    }
    scorer = RowTransitionScorer(_GENRES)

    assert scorer.fit(context, unprofiled) == 0.5
    assert _select_radio([unprofiled, smooth_entry], [context], scorer)["id"] == 2


def test_paths_prefers_a_smooth_entry_when_transition_fit_is_available():
    def select(scorer):
        return paths_candidates._select_best_candidate_from_rows(
            deepcopy(_candidates()),
            [0.2] * 20,
            set(),
            set(),
            [],
            {},
            _GENRES,
            {},
            ["seed"],
            recent_tracks=[_fade_out_context()],
            transition_scorer=scorer,
        )

    assert select(None)["id"] == 1
    assert select(RowTransitionScorer(_GENRES))["id"] == 2


def test_recent_track_context_keeps_edges_for_the_next_refill():
    context = radio_engine._recent_track_context(
        {**_fade_out_context(), "danceability": 0.4}
    )

    assert context["mix_outro_lufs"] == -20.0
    assert context["danceability"] == 0.4
    assert "bliss_vector" not in context
    assert "valence" not in context


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
        "generation_seed": "transition-fit",
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


@pytest.mark.parametrize(("enabled", "expected"), [("true", 2), ("false", 1)])
def test_radio_batches_follow_the_transition_fit_flag(monkeypatch, enabled, expected):
    monkeypatch.setenv("CRATE_TRANSITION_FIT_ENABLED", enabled)
    monkeypatch.setenv("CRATE_RADIO_ROTATION_ENABLED", "true")
    monkeypatch.setattr(radio_engine, "history_for_candidates", lambda *_a, **_k: {})
    monkeypatch.setattr(radio_engine, "_curation_penalty", lambda _row: 0)
    monkeypatch.setattr(
        radio_engine,
        "_load_radio_graphs",
        lambda **_kwargs: ({"seed": {"a": 1.0, "b": 1.0}}, _GENRES, {}),
    )
    monkeypatch.setattr(
        radio_engine,
        "find_seeded_radio_candidate_rows",
        lambda *_args, **_kwargs: deepcopy(_candidates()),
    )
    monkeypatch.setattr(radio_engine, "find_candidate_rows", lambda *_a, **_k: [])
    attached = []
    monkeypatch.setattr(
        radio_engine,
        "attach_transition_edges",
        lambda rows, **_kwargs: attached.append([row["track_id"] for row in rows]),
    )
    state = _state(
        recent_tracks=[radio_engine._recent_track_context(_fade_out_context())],
        recent_artists=["context"],
    )

    tracks = radio_engine._advance_radio(state, 1)["tracks"]

    assert [track["track_id"] for track in tracks] == [expected]
    assert attached == ([[90]] if enabled == "true" else [])


def _insert_catalog(session, *, stale_track_index=None):
    artist = f"Edge Artist {uuid4().hex[:8]}"
    session.execute(
        text(
            "INSERT INTO library_artists (name, entity_uid) "
            "VALUES (:name, gen_random_uuid())"
        ),
        {"name": artist},
    )
    album_id = session.execute(
        text(
            """
            INSERT INTO library_albums (artist, name, path, entity_uid)
            VALUES (:artist, 'Edges', :path, gen_random_uuid())
            RETURNING id
            """
        ),
        {"artist": artist, "path": f"/music/edges/{artist}"},
    ).scalar_one()
    track_ids = []
    for index in range(3):
        track_ids.append(
            session.execute(
                text(
                    """
                    INSERT INTO library_tracks (
                        album_id, artist, album, filename, title, path, entity_uid,
                        duration, format, bitrate, sample_rate, bit_depth, year,
                        bliss_vector, bliss_embedding, lastfm_playcount
                    ) VALUES (
                        :album_id, :artist, 'Edges', :filename, :title, :path,
                        gen_random_uuid(), 180, 'flac', 900, 44100, 16, '2001',
                        :vector, CAST(:embedding AS vector(20)), :plays
                    ) RETURNING id
                    """
                ),
                {
                    "album_id": album_id,
                    "artist": artist,
                    "filename": f"{index}.flac",
                    "title": f"Edge Song {index}",
                    "path": f"/music/edges/{artist}/{index}.flac",
                    "vector": [0.1] * 20,
                    "embedding": str([0.1] * 19 + [(index + 1) / 10]),
                    "plays": 10 - index,
                },
            ).scalar_one()
        )
    for index, track_id in enumerate(track_ids[:2]):
        session.execute(
            text(
                """
                INSERT INTO track_mix_profiles (
                    track_id, profile_version, profile_revision, analyzer,
                    analyzer_version, source_revision, quality, bpm,
                    bpm_confidence, intro_lufs, outro_lufs, measurement_version,
                    duration_ms, active_start_ms, active_end_ms, analyzed_at,
                    source_stale_at
                ) VALUES (
                    :track_id, 1, 'edge-' || :track_id, 'crate-rust',
                    'smart-mix-audio-v5', 'source-' || :track_id, 'full', 128.0,
                    0.9, -11.0, -14.5, 'bs1770-v1', 180000, 120, 178000, NOW(),
                    CASE WHEN :stale THEN NOW() ELSE NULL END
                )
                """
            ),
            {"track_id": track_id, "stale": index == stale_track_index},
        )
    return artist, track_ids


def _count_selects(session):
    selects = []

    def record(_connection, _cursor, statement, *_args):
        if statement.lstrip().upper().startswith(("SELECT", "WITH")):
            selects.append(statement)

    connection = session.connection()
    event.listen(connection, "before_cursor_execute", record)
    return selects, lambda: event.remove(connection, "before_cursor_execute", record)


@pytest.mark.parametrize("optimized", [False, True])
def test_candidate_queries_return_current_profile_edges_in_the_same_query(
    pg_db, optimized
):
    del pg_db
    with transaction_scope() as session:
        artist, track_ids = _insert_catalog(session, stale_track_index=1)
        selects, stop = _count_selects(session)
        try:
            seeded = find_seeded_radio_candidate_rows(
                [0.1] * 20,
                set(),
                seed_artists=[artist],
                limit=10,
                optimized=optimized,
                session=session,
            )
            seeded_selects = len(selects)
        finally:
            stop()
        nearest = find_candidate_rows(
            [0.1] * 20, set(), limit=50, use_track_artist=True, session=session
        )

    assert seeded_selects == 1
    by_id = {row["id"]: row for row in seeded}
    assert set(by_id) == set(track_ids)
    for rows in (by_id, {row["id"]: row for row in nearest}):
        assert rows[track_ids[0]]["mix_quality"] == "full"
        assert rows[track_ids[0]]["mix_outro_lufs"] == -14.5
        assert rows[track_ids[1]]["mix_quality"] is None
        assert rows[track_ids[2]]["mix_quality"] is None
        assert all(
            f"mix_{column}" in rows[track_ids[2]] for column in TRANSITION_EDGE_COLUMNS
        )


def test_attach_loads_missing_edges_in_one_query_and_skips_loaded_rows(pg_db):
    del pg_db
    with transaction_scope() as session:
        _artist, track_ids = _insert_catalog(session)
        loaded = {"id": 999_999, "mix_quality": "partial"}
        rows = [
            {"track_id": track_ids[0]},
            {"id": track_ids[2]},
            loaded,
            {"track_id": None},
        ]
        selects, stop = _count_selects(session)
        try:
            attach_transition_edges(rows, session=session)
            attach_transition_edges(rows, session=session)
        finally:
            stop()

    assert len(selects) == 1
    assert rows[0]["mix_quality"] == "full"
    assert rows[0]["mix_intro_lufs"] == -11.0
    assert rows[1]["mix_quality"] is None
    assert loaded == {"id": 999_999, "mix_quality": "partial"}
    assert "mix_quality" not in rows[3]


@pytest.mark.parametrize("name", ["citizen", "concubine"])
def test_captured_pools_enter_smoother_without_losing_coherence(monkeypatch, name):
    monkeypatch.setenv("CRATE_RADIO_ROTATION_ENABLED", "true")
    snapshot = json.loads((_FIXTURE_DIR / f"{name}.json").read_text())
    edges = load_mix_edges(name)

    def run(enabled):
        monkeypatch.setenv("CRATE_TRANSITION_FIT_ENABLED", enabled)
        return evaluate_snapshot(snapshot, mix_edges=edges)["sessions"]

    legacy, fitted = run("false"), run("true")

    for before, after in zip(legacy, fitted):
        assert after["seams"]["level_rises_over_6_db"] == 0
        assert (
            after["seams"]["mean_abs_level_jump_db"]
            < before["seams"]["mean_abs_level_jump_db"]
        )
        assert (
            after["coherence"]["mean_seed_genre_overlap"]
            >= before["coherence"]["mean_seed_genre_overlap"] - 0.02
        )
        assert (
            after["coherence"]["unique_artist_count"]
            >= before["coherence"]["unique_artist_count"]
        )
        assert len(after["tracks"]) == snapshot["batch_size"]

from copy import deepcopy

import pytest

from crate.db import paths_scene as scene
from crate.track_versions import track_song_identity
from tests.test_paths_scene_engine import _track


class UncachedSceneScorer:
    track_score = staticmethod(scene._track_score)
    artist_score = staticmethod(scene._artist_score)
    user_affinity = staticmethod(scene._user_affinity)
    track_popularity = staticmethod(scene._track_popularity)
    audio_transition_score = staticmethod(scene._audio_transition_score)
    artist_connection_score = staticmethod(scene._artist_connection_score)
    destination_gravity_score = staticmethod(scene._destination_gravity_score)
    should_skip_lateral_destination_candidate = staticmethod(
        scene._should_skip_lateral_destination_candidate
    )
    song_key = staticmethod(track_song_identity)


def _row(index, **metadata):
    row = _track(
        index,
        artist=f"Artist {index}",
        title=f"Song {index}",
        genre_slug="punk",
        bliss_vector=[0.1 + index * 0.001] * 20,
    )
    row.update(metadata)
    return row


@pytest.mark.parametrize(
    "metadata",
    [
        {},
        {"energy": None, "bpm": "", "bliss_vector": None},
        {"energy": "invalid", "bpm": "125.5", "bliss_vector": [0.1, "bad"]},
        {"audio_key": "", "audio_scale": None, "bliss_vector": [0.0] * 20},
        {"audio_key": "C", "audio_scale": "major", "bliss_vector": [0.2] * 10},
        {"audio_key": "D", "audio_scale": "minor"},
        {"audio_key": "D", "audio_scale": "major"},
        {"is_liked": True, "user_play_count": 20, "track_popularity_score": None},
        {"duration": "61", "title": "Acoustic Song", "artist_listeners": None},
    ],
)
def test_cached_scores_exactly_match_uncached_scores_for_incomplete_metadata(metadata):
    scorer = scene._SceneScorer()
    row, previous = _row(1, **metadata), _row(2, energy="0.2", bpm="110")
    before = deepcopy((row, previous))
    for context in (None, previous, previous):
        assert scorer.track_score(row, context) == scene._track_score(row, context)
        assert scorer.audio_transition_score(
            row, context
        ) == scene._audio_transition_score(row, context)
    assert scorer.artist_score(row) == scene._artist_score(row)
    assert scorer.user_affinity(row) == scene._user_affinity(row)
    assert scorer.track_popularity(row) == scene._track_popularity(row)
    assert (row, previous) == before


def test_scoring_normalizes_vectors_once_per_candidate_and_context(monkeypatch):
    rows = [_row(index) for index in range(1, 9)]
    contexts = [_row(20), _row(21)]
    raw_vector = scene._coerce_vector
    vector_calls = []

    def count_vector(value):
        vector_calls.append(value)
        return raw_vector(value)

    monkeypatch.setattr(scene, "_coerce_vector", count_vector)
    scorer = scene._SceneScorer()
    for _ in range(4):
        for row in rows:
            for context in contexts:
                scorer.track_score(row, context)
                scorer.audio_transition_score(row, context)
    assert len(vector_calls) <= len(rows) + len(contexts)


def test_scoring_does_not_reuse_metadata_from_another_row_with_the_same_track_id():
    scorer = scene._SceneScorer()
    original = _row(1)
    updated = _row(1, title="Renamed Song", user_play_count=20, energy=0.1, bpm=160)
    context = _row(2)
    assert scorer.track_score(original, context) == scene._track_score(
        original, context
    )
    assert scorer.track_score(updated, context) == scene._track_score(updated, context)
    assert scorer.track_score(original, context) != scorer.track_score(updated, context)
    assert scorer.song_key(original) == track_song_identity(original)
    assert scorer.song_key(updated) == track_song_identity(updated)
    assert scorer.song_key(original) != scorer.song_key(updated)


def test_scene_path_reuses_normalized_signals_across_steps(monkeypatch):
    rows = [_row(index) for index in range(1, 61)]
    raw_vector = scene._coerce_vector
    vector_calls = []

    def count_vector(value):
        vector_calls.append(value)
        return raw_vector(value)

    monkeypatch.setattr(scene, "_coerce_vector", count_vector)
    path = scene.build_scene_path_from_candidates(
        ["punk"], {"punk": rows}, step_count=20, selection_seed="fixed"
    )
    assert len(path) == 20
    assert len(vector_calls) <= len(rows) + len(path)


@pytest.mark.parametrize("artist_endpoints", [False, True])
@pytest.mark.parametrize("fatigued", [False, True])
def test_planning_cache_preserves_seeded_paths_and_recency_without_payload_signals(
    monkeypatch, artist_endpoints, fatigued
):
    rows = [_row(index) for index in range(1, 21)]
    rows[2].update({"bpm": "invalid", "energy": None, "bliss_vector": []})
    rows[3].update({"user_play_count": 20, "is_liked": True})
    before = deepcopy(rows)
    options = {
        "step_count": 8,
        "selection_seed": "same-generation",
        "recent_song_keys": {track_song_identity(rows[3])} if fatigued else set(),
        "previous_track_ids": {rows[4]["id"]} if fatigued else set(),
    }
    route = ["punk", "post-hardcore"]
    pools = {genre: rows[2:-1] for genre in route}

    def plan():
        if artist_endpoints:
            return scene.build_artist_scene_path_from_candidates(
                route,
                {"origin": rows[:2], "destination": rows[-2:]},
                pools,
                **options,
            )
        return scene.build_scene_path_from_candidates(route, pools, **options)

    cached = plan()
    monkeypatch.setattr(scene, "_SceneScorer", UncachedSceneScorer)
    uncached = plan()
    assert cached == uncached
    assert len(cached) == 8
    assert rows == before
    assert all(set(row) <= set(before[0]) for row in cached)


@pytest.mark.parametrize(
    "metadata",
    [
        {},
        {
            "artist_genre_slugs": [],
            "genre_slug": None,
            "artist_country": None,
            "year": None,
        },
        {
            "artist_genre_slugs": ["argentine-punk"],
            "genre_slug": "argentine-punk",
            "artist_country": "AR",
        },
        {
            "artist_genre_slugs": ["hardcore-punk"],
            "genre_slug": "hardcore-punk",
            "artist_country": "GB",
        },
    ],
)
def test_cached_destination_rules_preserve_exact_progress_and_lateral_threshold(
    metadata,
):
    scorer = scene._SceneScorer()
    row = _row(1, **metadata)
    destination = _row(
        99,
        genre_slug="hardcore-punk",
        artist_genre_slugs=["hardcore-punk"],
        artist_country="GB",
    )
    profile = {
        "country": "GB",
        "formed": "1999",
        "genres": [{"slug": "hardcore-punk", "name": "Hardcore Punk"}],
    }
    cached_gravity = scorer.destination_gravity_score
    cached_skip = scorer.should_skip_lateral_destination_candidate
    outputs = []
    for progress in (0.0, 0.29999, 0.3, 0.6, 1.0):
        options = {
            "destination_track": destination,
            "destination_profile": profile,
            "path_progress": progress,
            "artist_similarity_graph": {},
            "shared_members_graph": {},
        }
        gravity, skip = cached_gravity(row, **options), cached_skip(row, **options)
        assert gravity == scene._destination_gravity_score(row, **options)
        assert skip == scene._should_skip_lateral_destination_candidate(row, **options)
        outputs.append((gravity, skip))
    if row.get("artist_country") == "AR":
        assert [skip for _, skip in outputs] == [False, False, True, True, True]
        assert outputs[0][0] != outputs[-1][0]


def test_destination_normalizes_candidate_genres_and_fixed_profile_once(monkeypatch):
    scorer = scene._SceneScorer()
    rows, destination = [_row(index) for index in range(1, 6)], _row(99)
    profile = {"genres": [{"slug": "punk", "name": "Punk"}]}
    calls = {"row": 0, "profile": 0}
    raw_row, raw_profile = scene._row_genre_slugs, scene._profile_genre_slugs

    def row_slugs(row):
        calls["row"] += 1
        return raw_row(row)

    def profile_slugs(value):
        calls["profile"] += 1
        return raw_profile(value)

    monkeypatch.setattr(scene, "_row_genre_slugs", row_slugs)
    monkeypatch.setattr(scene, "_profile_genre_slugs", profile_slugs)
    gravity = scorer.destination_gravity_score
    skip = scorer.should_skip_lateral_destination_candidate
    graph, members = {}, {}
    for progress in (0.0, 0.4, 0.6, 0.8, 1.0):
        for row in rows:
            options = {
                "destination_track": destination,
                "destination_profile": profile,
                "path_progress": progress,
                "artist_similarity_graph": graph,
                "shared_members_graph": members,
            }
            gravity(row, **options)
            skip(row, **options)
    assert calls["profile"] <= 1
    assert calls["row"] <= len(rows) + 1


def test_cached_relationships_and_destination_do_not_cross_contexts():
    scorer = scene._SceneScorer()
    row, previous, destination = _row(1), _row(2), _row(3)
    members = {}
    for graph in ({}, {"artist 2": {"artist 1": 0.9}, "artist 3": {"artist 1": 0.7}}):
        for profile in (None, {"genres": [{"slug": "punk"}], "country": "AR"}):
            assert scorer.artist_connection_score(
                row, previous, graph, members
            ) == scene._artist_connection_score(row, previous, graph, members)
            options = {
                "destination_track": destination,
                "destination_profile": profile,
                "path_progress": 0.75,
                "artist_similarity_graph": graph,
                "shared_members_graph": members,
            }
            assert scorer.destination_gravity_score(
                row, **options
            ) == scene._destination_gravity_score(row, **options)
            assert scorer.should_skip_lateral_destination_candidate(
                row, **options
            ) == scene._should_skip_lateral_destination_candidate(row, **options)

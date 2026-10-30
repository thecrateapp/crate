import random

import pytest

from crate import radio_engine


@pytest.mark.parametrize("profile", ["contextual", "track", "discovery"])
def test_cached_candidate_signals_preserve_the_existing_score(profile):
    rng = random.Random(42)
    rows = [
        {
            "id": i,
            "title": f"Song {i}" + (" (Live)" if i % 4 == 0 else ""),
            "artist": f"Artist {i % 6}",
            "album": "Album",
            "duration": 160,
            "bpm": 100 + i,
            "energy": 0.4,
            "year": 2000 + i,
            "radio_source": "similar",
            "bliss_vector": [rng.random() for _ in range(20)],
        }
        for i in range(1, 41)
    ]
    artists = ["seed", *[f"artist {i}" for i in range(6)]]
    graph = {a: {b: rng.random() for b in artists} for a in artists}
    kwargs = dict(
        rows=rows,
        target=[0.2] * 20,
        used_ids={1, 2},
        used_titles=set(),
        used_song_keys=set(),
        batch_artist_counts={},
        session_artist_counts={},
        recent_artists=["Artist 1", "Artist 2"],
        sim_graph=graph,
        genre_map={},
        member_graph={"artist 1": {"artist 4"}},
        target_artists=["Seed"],
        genre_overlap_cache={},
        genre_overlap=lambda *a: 0.7,
        radio_profile=profile,
    )
    original = radio_engine._select_radio_candidate_from_rows(
        **kwargs, artist_affinity_cache={}
    )
    cached = radio_engine._select_radio_candidate_from_rows(
        **kwargs,
        artist_affinity_cache={},
        candidate_signals=radio_engine._prepare_candidate_signals(rows, profile),
    )
    assert cached == original


def test_pair_affinity_cache_preserves_member_precedence_and_graph_affinity():
    rng = random.Random(42)
    artists = [f"artist {i}" for i in range(12)]
    graph = {a: {b: rng.random() for b in rng.sample(artists, 7)} for a in artists}
    members = {a: set(rng.sample(artists, 2)) for a in artists}
    cache = {}
    for _ in range(100):
        candidate = rng.choice(artists)
        context = rng.sample(artists, 4)
        assert radio_engine._cached_artist_affinity(
            candidate, context, graph, members, cache
        ) == radio_engine._artist_affinity(candidate, context, graph, members)

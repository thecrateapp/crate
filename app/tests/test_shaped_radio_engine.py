def _vector(value: float) -> list[float]:
    return [value] * 20


def _candidate(
    track_id: int, *, title: str, artist: str, vector: list[float], bpm: float = 120.0
) -> dict:
    return {
        "id": track_id,
        "entity_uid": None,
        "title": title,
        "artist": artist,
        "album": "Album",
        "album_id": 1,
        "bpm": bpm,
        "audio_key": "C",
        "audio_scale": "minor",
        "energy": 0.7,
        "danceability": 0.5,
        "valence": 0.4,
        "duration": 180.0,
        "year": 2020,
        "bliss_vector": vector,
        "distance": 0.1,
    }


def test_discovery_seed_keeps_structured_context(monkeypatch):
    from crate import radio_engine

    rows = [
        {
            "track_id": index,
            "artist": f"Artist {index % 2}",
            "bliss_vector": _vector(float(index)),
        }
        for index in range(5)
    ]

    monkeypatch.setattr(
        radio_engine, "get_discovery_seed_sources", lambda *_args, **_kwargs: {1: rows}
    )
    monkeypatch.setattr(
        radio_engine,
        "get_discovery_excluded_artist_keys",
        lambda *_args, **_kwargs: ["artist 0"],
    )

    resolved = radio_engine.resolve_discovery_seed(9)

    assert resolved is not None
    _seed_vec, label, context = resolved
    assert label == "Your recent likes"
    assert context["seed_artists"] == ["Artist 0", "Artist 1"]
    assert context["seed_track_ids"] == [0, 1, 2, 3, 4]
    assert context["discovery_excluded_artist_keys"] == ["artist 0"]


def test_start_radio_reuses_single_read_session(monkeypatch):
    from contextlib import contextmanager

    from crate import radio_engine

    sentinel_session = object()
    seen_sessions = []

    @contextmanager
    def fake_read_scope():
        yield sentinel_session

    def fake_resolve_seed(_user_id, _seed_type, _seed_value, *, session=None):
        seen_sessions.append(session)
        return (
            _vector(0.2),
            "Seed",
            {"seed_artists": ["Seed Artist"], "seed_track_ids": [1]},
        )

    def fake_load_feedback_history(_user_id, *, session=None):
        seen_sessions.append(session)
        return [], []

    def fake_generate_batch(
        _session, count=radio_engine._BATCH_SIZE, *, db_session=None
    ):
        seen_sessions.append(db_session)
        return []

    monkeypatch.setattr(radio_engine, "read_scope", fake_read_scope)
    monkeypatch.setattr(radio_engine, "_resolve_seed", fake_resolve_seed)
    monkeypatch.setattr(
        radio_engine, "load_feedback_history", fake_load_feedback_history
    )
    monkeypatch.setattr(radio_engine, "_generate_batch", fake_generate_batch)
    monkeypatch.setattr(radio_engine, "_save_session", lambda _session: None)

    result = radio_engine.start_radio(7, seed_type="track", seed_value="1")

    assert result is not None
    assert seen_sessions == [sentinel_session, sentinel_session, sentinel_session]


def test_generate_batch_wires_hybrid_scoring_and_retries_disliked_candidates(
    monkeypatch,
):
    from crate import radio_engine

    candidates = [
        _candidate(1, title="Too Close", artist="Candidate", vector=_vector(0.0)),
        _candidate(2, title="Good", artist="Candidate", vector=_vector(0.4)),
    ]
    captured_queries = []

    def fake_discovery_rows(*args, **kwargs):
        captured_queries.append({"args": args, "kwargs": kwargs})
        return candidates

    monkeypatch.setattr(
        radio_engine, "_load_radio_graphs", lambda **_kwargs: ({}, {}, {})
    )
    monkeypatch.setattr(
        radio_engine, "_discovery_radio_candidate_rows", fake_discovery_rows
    )

    session = {
        "id": "session",
        "current_target": _vector(0.0),
        "seed_vector": _vector(0.5),
        "seed_type": "discovery",
        "seed_label": "Your recent likes",
        "seed_artists": ["Seed Artist"],
        "seed_genres": ["hardcore punk"],
        "seed_track_ids": [],
        "discovery_excluded_artist_keys": [],
        "used_track_ids": [],
        "used_titles": [],
        "recent_artists": [],
        "recent_tracks": [],
        "disliked_vectors": [_vector(0.0)],
    }

    tracks = radio_engine._generate_batch(session, count=1)

    assert [track["track_id"] for track in tracks] == [2]
    assert len(captured_queries) == 1
    assert captured_queries[0]["kwargs"]["count"] == 1
    assert set(session["used_track_ids"]) == {1, 2}
    assert session["current_target"][0] > 0.06


def test_discovery_radio_targets_related_unfollowed_artists_with_small_familiar_slice(
    monkeypatch,
):
    from crate import radio_engine

    captured: dict = {}
    fresh_candidates = [
        _candidate(1, title="Nation", artist="Home Front", vector=_vector(0.9))
        | {"radio_source": "similar"},
        _candidate(2, title="Ded Wurst", artist="Ditz", vector=_vector(0.8))
        | {"radio_source": "similar"},
        _candidate(3, title="Dogma", artist="Sprints", vector=_vector(0.7))
        | {"radio_source": "similar"},
        _candidate(4, title="Cool World", artist="Chat Pile", vector=_vector(0.6))
        | {"radio_source": "genre"},
    ]

    def fake_seeded_rows(
        _target,
        _exclude_ids,
        *,
        seed_artists,
        similar_artist_keys,
        seed_genres,
        excluded_artist_keys,
        limit,
        session=None,
    ):
        captured["seed_artists"] = seed_artists
        captured["similar_artist_keys"] = similar_artist_keys
        captured["excluded_artist_keys"] = excluded_artist_keys
        return fresh_candidates

    monkeypatch.setattr(
        radio_engine,
        "_load_radio_graphs",
        lambda **_kwargs: (
            {
                "high vis": {
                    "home front": 1.0,
                    "pearl jam": 0.9,
                    "ditz": 0.8,
                    "sprints": 0.7,
                }
            },
            {
                "high vis": {"post-punk": 1.0},
                "home front": {"post-punk": 1.0},
                "ditz": {"post-punk": 1.0},
                "sprints": {"post-punk": 1.0},
                "chat pile": {"post-punk": 0.8},
            },
            {},
        ),
    )
    monkeypatch.setattr(
        radio_engine, "find_seeded_radio_candidate_rows", fake_seeded_rows
    )
    monkeypatch.setattr(
        radio_engine,
        "find_candidate_rows",
        lambda *_args, **_kwargs: [
            _candidate(
                5, title="Guided Tour", artist="High Vis", vector=_vector(0.5)
            )
        ],
    )

    session = {
        "id": "session",
        "current_target": _vector(0.1),
        "seed_vector": _vector(0.1),
        "seed_type": "discovery",
        "seed_label": "Your recent likes",
        "seed_artists": ["High Vis"],
        "seed_genres": [],
        "seed_track_ids": [],
        "discovery_excluded_artist_keys": ["high vis", "pearl jam"],
        "used_track_ids": [],
        "used_titles": [],
        "recent_artists": [],
        "recent_tracks": [],
        "disliked_vectors": [],
    }

    tracks = radio_engine._generate_batch(session, count=5)

    assert [track["artist"] for track in tracks].count("High Vis") == 1
    assert [track["artist"] for track in tracks[:4]] == [
        "Home Front",
        "Ditz",
        "Sprints",
        "Chat Pile",
    ]
    assert captured["seed_artists"] == []
    assert captured["similar_artist_keys"] == ["home front", "ditz", "sprints"]
    assert "high vis" in captured["excluded_artist_keys"]
    assert "pearl jam" in captured["excluded_artist_keys"]


def test_discovery_radio_skips_global_bliss_fallback_when_fresh_pool_is_enough(
    monkeypatch,
):
    from crate import radio_engine

    monkeypatch.setattr(
        radio_engine,
        "find_seeded_radio_candidate_rows",
        lambda *_args, **_kwargs: [
            _candidate(1, title="Nation", artist="Home Front", vector=_vector(0.9))
            | {"radio_source": "similar"},
            _candidate(2, title="Ded Wurst", artist="Ditz", vector=_vector(0.8))
            | {"radio_source": "similar"},
            _candidate(3, title="Dogma", artist="Sprints", vector=_vector(0.7))
            | {"radio_source": "similar"},
        ],
    )
    monkeypatch.setattr(
        radio_engine,
        "find_candidate_rows",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("global bliss fallback should be lazy for discovery")
        ),
    )

    rows = radio_engine._discovery_radio_candidate_rows(
        _vector(0.1),
        used_track_ids=[],
        seed_artists=["High Vis"],
        seed_genres=[],
        excluded_artist_keys=["high vis"],
        sim_graph={"high vis": {"home front": 1.0, "ditz": 0.8}},
        genre_map={},
        count=3,
    )

    assert [row["artist"] for row in rows] == ["Home Front", "Ditz", "Sprints"]


def test_artist_radio_uses_graph_pool_instead_of_global_bliss(monkeypatch):
    from crate import radio_engine

    candidates = [
        _candidate(1, title="Games of Power", artist="Home Front", vector=_vector(0.8))
        | {"radio_source": "similar"},
        _candidate(2, title="Ded Wurst", artist="Ditz", vector=_vector(0.7))
        | {"radio_source": "similar"},
        _candidate(3, title="Guided Tour", artist="High Vis", vector=_vector(0.2))
        | {"radio_source": "seed"},
    ]
    captured: dict = {}

    def fake_artist_rows(
        _target,
        _exclude_ids,
        *,
        seed_artists,
        similar_artist_keys,
        seed_genres,
        limit,
        session=None,
    ):
        captured["seed_artists"] = seed_artists
        captured["similar_artist_keys"] = similar_artist_keys
        captured["seed_genres"] = seed_genres
        captured["limit"] = limit
        return candidates

    monkeypatch.setattr(
        radio_engine,
        "_load_radio_graphs",
        lambda **_kwargs: (
            {"high vis": {"home front": 1.0, "ditz": 0.52}},
            {
                "high vis": {"post-punk": 1.0, "post-hardcore": 0.5},
                "home front": {"post-punk": 0.9},
                "ditz": {"post-punk": 0.8},
            },
            {},
        ),
    )
    monkeypatch.setattr(
        radio_engine, "find_seeded_radio_candidate_rows", fake_artist_rows
    )
    monkeypatch.setattr(
        radio_engine,
        "find_candidate_rows",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("artist radio should not start from global bliss")
        ),
    )

    session = {
        "id": "session",
        "current_target": _vector(0.1),
        "seed_vector": _vector(0.1),
        "seed_type": "artist",
        "seed_label": "High Vis",
        "seed_artists": ["High Vis"],
        "seed_genres": [],
        "seed_track_ids": [],
        "used_track_ids": [],
        "used_titles": [],
        "recent_artists": [],
        "recent_tracks": [],
        "disliked_vectors": [],
    }

    tracks = radio_engine._generate_batch(session, count=2)

    assert [track["artist"] for track in tracks] == ["Home Front", "Ditz"]
    assert captured["seed_artists"] == ["High Vis"]
    assert captured["similar_artist_keys"] == ["home front", "ditz"]
    assert "post-punk" in captured["seed_genres"]


def test_artist_radio_treats_bliss_as_last_resort_when_candidates_leak_in():
    from crate import radio_engine

    rows = [
        _candidate(1, title="Live Rarity", artist="Pearl Jam", vector=_vector(1.0))
        | {"radio_source": "bliss"},
        _candidate(2, title="Games of Power", artist="Home Front", vector=_vector(0.0))
        | {"radio_source": "similar"},
    ]

    candidate = radio_engine._select_radio_candidate_from_rows(
        rows,
        _vector(1.0),
        used_ids=set(),
        used_titles=set(),
        recent_artists=[],
        sim_graph={"high vis": {"home front": 1.0}},
        genre_map={
            "high vis": {"post-punk": 1.0},
            "home front": {"post-punk": 1.0},
            "pearl jam": {"grunge": 1.0},
        },
        member_graph={},
        target_artists=["High Vis"],
        artist_affinity_cache={},
        genre_overlap_cache={},
        genre_overlap=radio_engine.make_radio_genre_overlap_scorer(
            {
                "high vis": {"post-punk": 1.0},
                "home front": {"post-punk": 1.0},
                "pearl jam": {"grunge": 1.0},
            },
            ["High Vis"],
        ),
        radio_profile="contextual",
    )

    assert candidate is not None
    assert candidate["artist"] == "Home Front"


def test_album_radio_uses_contextual_pool_and_excludes_seed_tracks(monkeypatch):
    from crate import radio_engine

    captured: dict = {}

    def fake_seeded_rows(
        _target,
        exclude_ids,
        *,
        seed_artists,
        similar_artist_keys,
        seed_genres,
        limit,
        session=None,
    ):
        captured["exclude_ids"] = set(exclude_ids)
        captured["seed_artists"] = seed_artists
        return [
            _candidate(
                20, title="Nation", artist="Home Front", vector=_vector(0.8)
            )
            | {"radio_source": "similar"}
        ]

    monkeypatch.setattr(
        radio_engine,
        "_load_radio_graphs",
        lambda **_kwargs: (
            {"high vis": {"home front": 1.0}},
            {
                "high vis": {"post-punk": 1.0},
                "home front": {"post-punk": 0.9},
            },
            {},
        ),
    )
    monkeypatch.setattr(
        radio_engine, "find_seeded_radio_candidate_rows", fake_seeded_rows
    )
    monkeypatch.setattr(
        radio_engine,
        "find_candidate_rows",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("album radio should not start from global bliss")
        ),
    )

    session = {
        "id": "session",
        "current_target": _vector(0.1),
        "seed_vector": _vector(0.1),
        "seed_type": "album",
        "seed_label": "Guided Tour — High Vis",
        "seed_artists": ["High Vis"],
        "seed_genres": [],
        "seed_track_ids": [10, 11],
        "used_track_ids": [],
        "used_titles": [],
        "recent_artists": [],
        "recent_tracks": [],
        "disliked_vectors": [],
    }

    tracks = radio_engine._generate_batch(session, count=1)

    assert tracks[0]["artist"] == "Home Front"
    assert captured["seed_artists"] == ["High Vis"]
    assert {10, 11}.issubset(captured["exclude_ids"])


def test_track_radio_keeps_bliss_meaningful_inside_contextual_pool():
    from crate import radio_engine

    rows = [
        _candidate(
            1, title="Far Graph Match", artist="Home Front", vector=_vector(-1.0)
        )
        | {"radio_source": "similar"},
        _candidate(2, title="Close Graph Match", artist="Ditz", vector=_vector(1.0))
        | {"radio_source": "similar"},
    ]

    candidate = radio_engine._select_radio_candidate_from_rows(
        rows,
        _vector(1.0),
        used_ids=set(),
        used_titles=set(),
        recent_artists=[],
        sim_graph={"high vis": {"home front": 1.0, "ditz": 0.52}},
        genre_map={
            "high vis": {"post-punk": 1.0},
            "home front": {"post-punk": 1.0},
            "ditz": {"post-punk": 1.0},
        },
        member_graph={},
        target_artists=["High Vis"],
        artist_affinity_cache={},
        genre_overlap_cache={},
        genre_overlap=radio_engine.make_radio_genre_overlap_scorer(
            {
                "high vis": {"post-punk": 1.0},
                "home front": {"post-punk": 1.0},
                "ditz": {"post-punk": 1.0},
            },
            ["High Vis"],
        ),
        radio_profile="track",
    )

    assert candidate is not None
    assert candidate["artist"] == "Ditz"


def test_next_tracks_resaves_session_to_refresh_ttl(monkeypatch):
    from crate import radio_engine

    session = {"id": "session", "track_count": 2}
    saved = []

    monkeypatch.setattr(radio_engine, "_load_session", lambda _session_id: session)
    monkeypatch.setattr(
        radio_engine, "_generate_batch", lambda _session, _count: [{"track_id": 3}]
    )
    monkeypatch.setattr(
        radio_engine, "_save_session", lambda value: saved.append(dict(value))
    )

    result = radio_engine.next_tracks("session", count=1)

    assert result == {"session_id": "session", "tracks": [{"track_id": 3}]}
    assert saved
    assert saved[0]["track_count"] == 3


def test_best_candidate_prefers_compatible_audio_context(monkeypatch):
    from crate.db import paths_candidates

    rows = [
        _candidate(1, title="Far", artist="Artist", vector=_vector(0.1), bpm=180.0)
        | {
            "distance": 0.1,
            "energy": 0.1,
            "audio_key": "F#",
            "year": 1980,
        },
        _candidate(2, title="Close", artist="Artist", vector=_vector(0.1), bpm=122.0)
        | {
            "distance": 0.1,
            "energy": 0.72,
            "audio_key": "C",
            "year": 2021,
        },
    ]

    monkeypatch.setattr(
        paths_candidates, "find_candidate_rows", lambda *_args, **_kwargs: rows
    )

    candidate = paths_candidates._find_best_candidate(
        _vector(0.0),
        exclude_ids=set(),
        exclude_titles=set(),
        recent_artists=[],
        sim_graph={},
        genre_map={},
        member_graph={},
        target_artists=[],
        recent_tracks=[
            {
                "bpm": 120.0,
                "energy": 0.7,
                "audio_key": "C",
                "audio_scale": "minor",
                "year": 2020,
            }
        ],
    )

    assert candidate is not None
    assert candidate["title"] == "Close"


def test_genre_overlap_uses_taxonomy_ancestors():
    from crate.db.paths_similarity import _genre_overlap

    overlap = _genre_overlap(
        "Candidate",
        ["Target"],
        {
            "candidate": {"beatdown hardcore": 1.0},
            "target": {"hardcore punk": 1.0},
        },
    )

    assert overlap > 0.0


def test_genre_overlap_reuses_expanded_taxonomy(monkeypatch):
    from crate.db import paths_similarity

    calls: list[str] = []
    paths_similarity._expand_genre_weight_items.cache_clear()

    def fake_related_terms(slug: str, *, limit: int, max_depth: int) -> list[str]:
        calls.append(slug)
        return [f"{slug}-related"]

    monkeypatch.setattr(paths_similarity, "get_related_genre_terms", fake_related_terms)

    genre_map = {
        "candidate": {"post-hardcore": 1.0},
        "target": {"hardcore punk": 1.0},
    }

    first = paths_similarity._genre_overlap("Candidate", ["Target"], genre_map)
    second = paths_similarity._genre_overlap("Candidate", ["Target"], genre_map)

    assert first == second
    assert calls == ["post-hardcore", "hardcore-punk"]


def test_radio_genre_overlap_scorer_uses_ancestor_only_expansion(monkeypatch):
    from crate.db import paths_similarity
    import crate.genre_taxonomy as taxonomy

    monkeypatch.setattr(
        taxonomy,
        "_get_runtime_taxonomy_graph",
        lambda: (_ for _ in ()).throw(
            AssertionError("runtime taxonomy is too slow for radio")
        ),
    )
    monkeypatch.setattr(
        paths_similarity,
        "get_related_genre_terms",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("related expansion is too slow for radio")
        ),
    )

    scorer = paths_similarity.make_radio_genre_overlap_scorer(
        {
            "candidate": {"beatdown hardcore": 1.0},
            "target": {"hardcore punk": 1.0},
        },
        ["Target"],
    )

    assert scorer("Candidate", ["Target"], {}) > 0.0


def test_runtime_taxonomy_graph_throttles_shared_revision_checks(monkeypatch):
    import crate.genre_taxonomy as taxonomy

    graph = taxonomy._clone_runtime_graph(taxonomy._STATIC_RUNTIME_GRAPH)
    calls: list[float] = []
    now = [100.0]

    monkeypatch.setattr(taxonomy.time, "monotonic", lambda: now[0])
    monkeypatch.setattr(taxonomy, "_RUNTIME_GRAPH_CACHE", graph)
    monkeypatch.setattr(taxonomy, "_RUNTIME_GRAPH_CACHE_REVISION", "rev-1")
    monkeypatch.setattr(taxonomy, "_RUNTIME_GRAPH_REVISION_CHECKED_AT", 95.0)
    monkeypatch.setattr(
        taxonomy,
        "_load_shared_taxonomy_revision",
        lambda: calls.append(now[0]) or "rev-1",
    )

    assert taxonomy._get_runtime_taxonomy_graph() is graph
    assert calls == []

    now[0] = 140.0

    assert taxonomy._get_runtime_taxonomy_graph() is graph
    assert calls == [140.0]


def test_home_mix_preparation_deprioritizes_liked_and_overplayed_tracks():
    from crate.db.home_builder_mix_generation import _prepare_mix_candidate_rows

    rows = [
        {"track_id": 1, "title": "Liked", "is_liked": True, "user_play_count": 0},
        {"track_id": 2, "title": "Overplayed", "is_liked": False, "user_play_count": 8},
        {"track_id": 3, "title": "Fresh", "is_liked": False, "user_play_count": 0},
    ]

    prepared = _prepare_mix_candidate_rows(rows)

    assert prepared[0]["title"] == "Fresh"


def test_daily_discovery_uses_cold_start_genres_when_profile_is_empty(monkeypatch):
    from crate.db import home_builder_mix_generation

    captured = {}

    def fake_query(_user_id, *, genres, excluded_artist_names, limit):
        captured["genres"] = genres
        return []

    monkeypatch.setattr(
        home_builder_mix_generation, "_query_discovery_tracks", fake_query
    )

    home_builder_mix_generation._build_mix_rows(
        1,
        interest_artists_lower=[],
        top_genres_lower=[],
        mix_id="daily-discovery",
        limit=3,
    )

    assert captured["genres"] == ["rock", "punk", "metal"]


def test_artist_bliss_centroid_refresh_and_resolution(pg_db):
    from sqlalchemy import text

    from crate.db.jobs.artist_bliss_centroids import (
        refresh_artist_bliss_centroids_for_track_ids,
    )
    from crate.db.paths_vectors import resolve_bliss_centroid
    from crate.db.queries.artist_bliss_centroids import get_artist_bliss_centroid
    from crate.db.tx import transaction_scope

    pg_db.upsert_artist({"name": "Centroid Artist"})
    artist = pg_db.get_library_artist("Centroid Artist")
    album_id = pg_db.upsert_album(
        {
            "artist": "Centroid Artist",
            "name": "Centroid Album",
            "path": "/music/Centroid Artist/Centroid Album",
        }
    )
    pg_db.upsert_track(
        {
            "album_id": album_id,
            "artist": "Centroid Artist",
            "album": "Centroid Album",
            "filename": "01 - Low.flac",
            "title": "Low",
            "track_number": 1,
            "format": "flac",
            "path": "/music/Centroid Artist/Centroid Album/01 - Low.flac",
        }
    )
    pg_db.upsert_track(
        {
            "album_id": album_id,
            "artist": "Centroid Artist",
            "album": "Centroid Album",
            "filename": "02 - High.flac",
            "title": "High",
            "track_number": 2,
            "format": "flac",
            "path": "/music/Centroid Artist/Centroid Album/02 - High.flac",
        }
    )
    tracks = pg_db.get_library_tracks(album_id)
    vectors = {
        "Low": [0.0] * 20,
        "High": [2.0] * 20,
    }

    with transaction_scope() as session:
        for track in tracks:
            session.execute(
                text(
                    """
                    UPDATE library_tracks
                    SET bliss_vector = CAST(:vector AS DOUBLE PRECISION[])
                    WHERE id = :track_id
                    """
                ),
                {"track_id": track["id"], "vector": vectors[track["title"]]},
            )
        refreshed = refresh_artist_bliss_centroids_for_track_ids(
            session, [track["id"] for track in tracks]
        )

    assert refreshed == 1
    centroid = get_artist_bliss_centroid(str(artist["id"]))
    assert centroid is not None
    assert centroid["track_count"] == 2
    assert centroid["bliss_vector"] == [1.0] * 20
    assert resolve_bliss_centroid("artist", str(artist["id"])) == [1.0] * 20

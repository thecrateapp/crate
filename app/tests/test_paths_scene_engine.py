from __future__ import annotations

from collections import Counter


def _track(
    track_id: int,
    *,
    title: str,
    artist: str,
    genre_slug: str,
    membership_score: float = 1.0,
    artist_popularity_score: float = 0.5,
    artist_listeners: int = 1000,
    track_popularity_score: float = 0.5,
    lastfm_playcount: int = 1000,
    user_play_count: int = 0,
    album: str = "Album",
    year: int = 2000,
    energy: float = 0.75,
    bpm: float = 120.0,
    bliss_vector: list[float] | None = None,
    artist_country: str | None = None,
    artist_area: str | None = None,
    artist_formed: str | None = None,
    artist_genre_slugs: list[str] | None = None,
) -> dict:
    return {
        "id": track_id,
        "entity_uid": None,
        "title": title,
        "artist": artist,
        "album": album,
        "album_id": track_id + 1000,
        "album_entity_uid": None,
        "artist_entity_uid": None,
        "duration": 180,
        "year": year,
        "bpm": bpm,
        "audio_key": "C",
        "audio_scale": "minor",
        "energy": energy,
        "danceability": 0.4,
        "valence": 0.35,
        "bliss_vector": bliss_vector or [0.1] * 20,
        "distance": 0.1,
        "genre_slug": genre_slug,
        "membership_score": membership_score,
        "artist_popularity_score": artist_popularity_score,
        "artist_listeners": artist_listeners,
        "track_popularity_score": track_popularity_score,
        "lastfm_playcount": lastfm_playcount,
        "user_play_count": user_play_count,
        "is_liked": False,
        "artist_relation_score": 0.0,
        "artist_country": artist_country,
        "artist_area": artist_area,
        "artist_formed": artist_formed,
        "artist_genre_slugs": artist_genre_slugs or [genre_slug],
    }


def test_scene_route_is_directed_and_can_be_reversed(monkeypatch):
    from crate.db import paths_scene

    monkeypatch.setattr(
        paths_scene,
        "get_genre_catalog",
        lambda: {
            "punk": {
                "parents": [],
                "related": [],
                "influenced_by": [],
                "fusion_of": [],
            },
            "hardcore-punk": {
                "parents": ["punk"],
                "related": [],
                "influenced_by": ["punk"],
                "fusion_of": [],
            },
            "post-hardcore": {
                "parents": ["hardcore-punk"],
                "related": [],
                "influenced_by": ["hardcore-punk"],
                "fusion_of": [],
            },
        },
    )

    assert paths_scene.build_scene_genre_route("punk", "post-hardcore") == [
        "punk",
        "hardcore-punk",
        "post-hardcore",
    ]
    assert paths_scene.build_scene_genre_route("post-hardcore", "punk") == [
        "post-hardcore",
        "hardcore-punk",
        "punk",
    ]


def test_scene_route_inserts_bridge_for_direct_parent_child_relationship(monkeypatch):
    from crate.db import paths_scene

    monkeypatch.setattr(
        paths_scene,
        "get_genre_catalog",
        lambda: {
            "punk": {
                "parents": [],
                "related": [],
                "influenced_by": [],
                "fusion_of": [],
            },
            "hardcore-punk": {
                "parents": ["punk"],
                "related": ["post-hardcore"],
                "influenced_by": [],
                "fusion_of": [],
            },
            "post-hardcore": {
                "parents": ["punk"],
                "related": ["hardcore-punk"],
                "influenced_by": [],
                "fusion_of": [],
            },
        },
    )

    assert paths_scene.build_scene_genre_route("punk", "post-hardcore") == [
        "punk",
        "hardcore-punk",
        "post-hardcore",
    ]
    assert paths_scene.build_scene_genre_route("post-hardcore", "punk") == [
        "post-hardcore",
        "hardcore-punk",
        "punk",
    ]


def test_scene_route_prefers_historical_bridge_over_lateral_descendant(monkeypatch):
    from crate.db import paths_scene

    monkeypatch.setattr(
        paths_scene,
        "get_genre_catalog",
        lambda: {
            "punk": {
                "parents": [],
                "related": [],
                "influenced_by": [],
                "fusion_of": [],
            },
            "hardcore-punk": {
                "parents": ["punk"],
                "related": ["post-hardcore", "screamo"],
                "influenced_by": [],
                "fusion_of": [],
            },
            "post-hardcore": {
                "parents": ["punk"],
                "related": ["hardcore-punk", "screamo"],
                "influenced_by": ["hardcore-punk"],
                "fusion_of": [],
            },
            "screamo": {
                "parents": ["punk", "post-hardcore"],
                "related": ["hardcore-punk", "post-hardcore"],
                "influenced_by": ["hardcore-punk"],
                "fusion_of": [],
            },
        },
    )

    assert paths_scene.build_scene_genre_route("punk", "post-hardcore") == [
        "punk",
        "hardcore-punk",
        "post-hardcore",
    ]
    assert paths_scene.build_scene_genre_route("post-hardcore", "punk") == [
        "post-hardcore",
        "hardcore-punk",
        "punk",
    ]


def test_scene_path_uses_canonical_genre_anchors_and_rejects_variants():
    from crate.db.paths_scene import build_scene_path_from_candidates

    candidates = {
        "punk": [
            _track(
                1,
                title="Public Image",
                artist="Public Image Ltd",
                genre_slug="punk",
                membership_score=0.48,
                artist_popularity_score=0.95,
                artist_listeners=10_000_000,
                track_popularity_score=0.9,
            ),
            _track(
                2,
                title="London Calling",
                artist="The Clash",
                genre_slug="punk",
                membership_score=0.98,
                artist_popularity_score=0.75,
                artist_listeners=5_000_000,
                track_popularity_score=0.85,
            ),
        ],
        "hardcore-punk": [
            _track(
                3,
                title="Rise Above",
                artist="Black Flag",
                genre_slug="hardcore-punk",
                membership_score=0.95,
                artist_popularity_score=0.55,
                track_popularity_score=0.75,
            ),
            _track(
                4,
                title="Killing in the Name",
                artist="Rage Against the Machine",
                genre_slug="hardcore-punk",
                membership_score=0.25,
                artist_popularity_score=0.95,
                track_popularity_score=0.98,
            ),
        ],
        "post-hardcore": [
            _track(
                5,
                title="Sorry You're Not a Winner - Remix",
                artist="Enter Shikari",
                genre_slug="post-hardcore",
                membership_score=0.72,
                artist_popularity_score=0.8,
                track_popularity_score=0.9,
            ),
            _track(
                6,
                title="Waiting Room",
                artist="Fugazi",
                genre_slug="post-hardcore",
                membership_score=0.96,
                artist_popularity_score=0.7,
                track_popularity_score=0.82,
            ),
        ],
    }

    path = build_scene_path_from_candidates(
        ["punk", "hardcore-punk", "post-hardcore"],
        candidates,
        step_count=5,
    )

    titles = [track["title"] for track in path]
    artists = [track["artist"] for track in path]
    assert artists[0] == "The Clash"
    assert artists[-1] == "Fugazi"
    assert "Public Image Ltd" not in artists
    assert "Rage Against the Machine" not in artists
    assert "Sorry You're Not a Winner - Remix" not in titles


def test_user_affinity_can_pick_personal_track_inside_canonical_artist():
    from crate.db.paths_scene import build_scene_path_from_candidates

    candidates = {
        "punk": [
            _track(
                1,
                title="London Calling",
                artist="The Clash",
                genre_slug="punk",
                membership_score=0.98,
                track_popularity_score=0.95,
                lastfm_playcount=5_000_000,
                user_play_count=0,
            ),
            _track(
                2,
                title="Stay Free",
                artist="The Clash",
                genre_slug="punk",
                membership_score=0.98,
                track_popularity_score=0.55,
                lastfm_playcount=250_000,
                user_play_count=20,
            ),
        ],
        "post-hardcore": [
            _track(
                3,
                title="Waiting Room",
                artist="Fugazi",
                genre_slug="post-hardcore",
                membership_score=0.96,
                track_popularity_score=0.82,
            ),
        ],
    }

    path = build_scene_path_from_candidates(
        ["punk", "post-hardcore"],
        candidates,
        step_count=3,
    )

    assert path[0]["artist"] == "The Clash"
    assert path[0]["title"] == "Stay Free"


def test_seeded_selection_varies_tracks_inside_canonical_artist_pool():
    from crate.db.paths_scene import build_scene_path_from_candidates

    clash_tracks = [
        _track(
            track_id,
            title=f"Canonical Clash Song {track_id}",
            artist="The Clash",
            genre_slug="punk",
            membership_score=0.98,
            artist_popularity_score=0.95,
            track_popularity_score=0.92 - (track_id * 0.01),
            lastfm_playcount=5_000_000 - (track_id * 100_000),
        )
        for track_id in range(1, 11)
    ]
    candidates = {
        "punk": clash_tracks,
        "post-hardcore": [
            _track(
                20,
                title="Waiting Room",
                artist="Fugazi",
                genre_slug="post-hardcore",
                membership_score=0.96,
            )
        ],
    }

    first_path = build_scene_path_from_candidates(
        ["punk", "post-hardcore"],
        candidates,
        step_count=2,
        selection_seed="first-generation",
    )
    second_path = build_scene_path_from_candidates(
        ["punk", "post-hardcore"],
        candidates,
        step_count=2,
        selection_seed="second-generation",
    )

    assert first_path[0]["artist"] == "The Clash"
    assert second_path[0]["artist"] == "The Clash"
    assert first_path[0]["title"] != second_path[0]["title"]


def test_seeded_selection_keeps_strong_user_affinity_track():
    from crate.db.paths_scene import build_scene_path_from_candidates

    candidates = {
        "punk": [
            _track(
                1,
                title="London Calling",
                artist="The Clash",
                genre_slug="punk",
                membership_score=0.98,
                track_popularity_score=0.95,
                lastfm_playcount=5_000_000,
                user_play_count=0,
            ),
            _track(
                2,
                title="Stay Free",
                artist="The Clash",
                genre_slug="punk",
                membership_score=0.98,
                track_popularity_score=0.55,
                lastfm_playcount=250_000,
                user_play_count=20,
            ),
        ],
        "post-hardcore": [
            _track(
                3,
                title="Waiting Room",
                artist="Fugazi",
                genre_slug="post-hardcore",
                membership_score=0.96,
                track_popularity_score=0.82,
            ),
        ],
    }

    path = build_scene_path_from_candidates(
        ["punk", "post-hardcore"],
        candidates,
        step_count=2,
        selection_seed="randomized-generation",
    )

    assert path[0]["artist"] == "The Clash"
    assert path[0]["title"] == "Stay Free"


def test_scene_candidate_query_keeps_wide_track_pool_per_artist():
    from crate.db.queries.paths_scene_queries import _tracks_per_artist_limit

    assert _tracks_per_artist_limit(4) == 1
    assert _tracks_per_artist_limit(80) == 7
    assert _tracks_per_artist_limit(400) == 10
    assert _tracks_per_artist_limit(1000) == 10


def test_scene_path_uses_audio_continuity_inside_valid_scene_candidates():
    from crate.db.paths_scene import build_scene_path_from_candidates

    candidates = {
        "punk": [
            _track(
                1,
                title="Rise Above",
                artist="Black Flag",
                genre_slug="punk",
                membership_score=0.95,
                energy=0.82,
                bpm=122,
                bliss_vector=[0.2] * 20,
            )
        ],
        "post-hardcore": [
            _track(
                2,
                title="Jagged",
                artist="Bridge A",
                genre_slug="post-hardcore",
                membership_score=0.95,
                artist_popularity_score=0.7,
                track_popularity_score=0.7,
                energy=0.15,
                bpm=190,
                bliss_vector=[1.5] * 20,
            ),
            _track(
                3,
                title="Smooth Link",
                artist="Bridge B",
                genre_slug="post-hardcore",
                membership_score=0.95,
                artist_popularity_score=0.7,
                track_popularity_score=0.7,
                energy=0.8,
                bpm=124,
                bliss_vector=[0.22] * 20,
            ),
        ],
    }

    path = build_scene_path_from_candidates(
        ["punk", "post-hardcore"],
        candidates,
        step_count=2,
    )

    assert path[-1]["title"] == "Smooth Link"


def test_scene_path_prefers_artists_connected_to_previous_scene_artist():
    from crate.db.paths_scene import build_scene_path_from_candidates

    candidates = {
        "hardcore-punk": [
            _track(
                1,
                title="Orchestra of Wolves",
                artist="Gallows",
                genre_slug="hardcore-punk",
                membership_score=0.95,
            )
        ],
        "post-hardcore": [
            _track(
                2,
                title="Unrelated Step",
                artist="Unrelated Band",
                genre_slug="post-hardcore",
                membership_score=0.95,
                artist_popularity_score=0.7,
                track_popularity_score=0.7,
            ),
            _track(
                3,
                title="Primary Explosive",
                artist="Frank Carter",
                genre_slug="post-hardcore",
                membership_score=0.95,
                artist_popularity_score=0.7,
                track_popularity_score=0.7,
            ),
        ],
    }

    path = build_scene_path_from_candidates(
        ["hardcore-punk", "post-hardcore"],
        candidates,
        step_count=2,
        artist_similarity_graph={"gallows": {"frank carter": 0.9}},
    )

    assert path[-1]["artist"] == "Frank Carter"


def test_scene_path_uses_unseen_artists_before_repeating_and_never_consecutively():
    from crate.db.paths_scene import build_scene_path_from_candidates

    candidates = {
        "punk": [
            _track(
                1,
                title="First Clash Song",
                artist="The Clash",
                genre_slug="punk",
                membership_score=0.98,
                artist_popularity_score=0.95,
                track_popularity_score=0.95,
            ),
            _track(
                2,
                title="Second Clash Song",
                artist="The Clash",
                genre_slug="punk",
                membership_score=0.98,
                artist_popularity_score=0.95,
                track_popularity_score=0.92,
            ),
            _track(
                3,
                title="Alternative Ulster",
                artist="Stiff Little Fingers",
                genre_slug="punk",
                membership_score=0.92,
                artist_popularity_score=0.15,
                track_popularity_score=0.2,
            ),
        ],
        "hardcore-punk": [
            _track(
                4,
                title="Rise Above",
                artist="Black Flag",
                genre_slug="hardcore-punk",
                membership_score=0.95,
            ),
            _track(
                5,
                title="Pay To Cum",
                artist="Bad Brains",
                genre_slug="hardcore-punk",
                membership_score=0.94,
            ),
        ],
        "post-hardcore": [
            _track(
                6,
                title="Waiting Room",
                artist="Fugazi",
                genre_slug="post-hardcore",
                membership_score=0.96,
            )
        ],
    }

    path = build_scene_path_from_candidates(
        ["punk", "hardcore-punk", "post-hardcore"],
        candidates,
        step_count=5,
    )

    artists = [track["artist"] for track in path]
    assert artists[:2] == ["The Clash", "Stiff Little Fingers"]
    assert all(left != right for left, right in zip(artists, artists[1:]))


def test_music_path_planning_uses_scene_engine_before_acoustic_fallback(monkeypatch):
    from crate.db import paths_service_planning

    scene_tracks = [
        {
            "step": 0,
            "progress": 0.0,
            "track_id": 1,
            "title": "London Calling",
            "artist": "The Clash",
            "distance": 0.0,
        }
    ]

    monkeypatch.setattr(
        paths_service_planning,
        "resolve_endpoint_label",
        lambda endpoint_type, value: value.title(),
    )
    monkeypatch.setattr(
        paths_service_planning,
        "compute_scene_path",
        lambda **kwargs: scene_tracks,
    )
    monkeypatch.setattr(
        paths_service_planning,
        "resolve_bliss_centroid",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("acoustic fallback should not run when scene path works")
        ),
    )

    plan = paths_service_planning.build_music_path_plan(
        "genre",
        "punk",
        "genre",
        "post-hardcore",
        step_count=8,
        user_id=1,
    )

    assert plan is not None
    assert plan["tracks"] == scene_tracks


def test_compute_scene_path_returns_music_path_entries(monkeypatch):
    from crate.db import paths_scene
    from crate.db.queries import paths_scene_queries

    candidates = {
        "punk": [
            _track(
                1,
                title="Stay Free",
                artist="The Clash",
                genre_slug="punk",
                membership_score=0.98,
            )
        ],
        "post-hardcore": [
            _track(
                2,
                title="Waiting Room",
                artist="Fugazi",
                genre_slug="post-hardcore",
                membership_score=0.96,
            )
        ],
    }

    monkeypatch.setattr(
        paths_scene,
        "build_scene_genre_route",
        lambda _origin, _dest: ["punk", "post-hardcore"],
    )
    monkeypatch.setattr(
        paths_scene_queries,
        "list_scene_path_candidates",
        lambda *_args, **_kwargs: candidates,
    )
    monkeypatch.setattr(
        paths_scene,
        "load_artist_radio_graphs",
        lambda: ({}, {}, {}),
    )

    tracks = paths_scene.compute_scene_path(
        origin_type="genre",
        origin_value="punk",
        dest_type="genre",
        dest_value="post-hardcore",
        step_count=5,
        user_id=1,
    )

    assert tracks is not None
    assert tracks[0]["track_id"] == 1
    assert tracks[0]["step"] == 0
    assert tracks[0]["path_genre"] == "punk"
    assert tracks[-1]["track_id"] == 2
    assert tracks[-1]["step"] == 4
    assert tracks[-1]["progress"] == 1.0


def test_compute_scene_path_applies_llm_refinement_before_entries(monkeypatch):
    from crate.db import paths_scene
    from crate.db.queries import paths_scene_queries

    punk_track = _track(
        1,
        title="Stay Free",
        artist="The Clash",
        genre_slug="punk",
        membership_score=0.98,
    )
    odd_track = _track(
        2,
        title="Odd Step",
        artist="Odd Artist",
        genre_slug="post-hardcore",
        membership_score=0.96,
    )
    better_track = _track(
        3,
        title="Better Step",
        artist="Better Artist",
        genre_slug="post-hardcore",
        membership_score=0.96,
    )
    candidates = {
        "punk": [punk_track],
        "post-hardcore": [odd_track, better_track],
    }

    monkeypatch.setattr(
        paths_scene,
        "build_scene_genre_route",
        lambda _origin, _dest: ["punk", "post-hardcore"],
    )
    monkeypatch.setattr(
        paths_scene_queries,
        "list_scene_path_candidates",
        lambda *_args, **_kwargs: candidates,
    )
    monkeypatch.setattr(paths_scene, "load_artist_radio_graphs", lambda: ({}, {}, {}))
    monkeypatch.setattr(
        paths_scene,
        "refine_music_path_with_llm",
        lambda **kwargs: [punk_track, better_track],
    )

    tracks = paths_scene.compute_scene_path(
        origin_type="genre",
        origin_value="punk",
        dest_type="genre",
        dest_value="post-hardcore",
        step_count=2,
        user_id=1,
    )

    assert tracks is not None
    assert [track["track_id"] for track in tracks] == [1, 3]


def test_compute_scene_path_expands_long_genre_routes_with_adjacent_scenes(
    monkeypatch,
):
    from crate.db import paths_scene
    from crate.db.queries import paths_scene_queries

    captured_routes: list[list[str]] = []

    monkeypatch.setattr(
        paths_scene,
        "get_genre_catalog",
        lambda: {
            "punk": {
                "parents": [],
                "related": [],
                "influenced_by": [],
                "fusion_of": [],
            },
            "hardcore-punk": {
                "parents": ["punk"],
                "related": ["post-hardcore", "melodic-hardcore", "screamo"],
                "influenced_by": [],
                "fusion_of": [],
            },
            "post-hardcore": {
                "parents": ["punk"],
                "related": [
                    "hardcore-punk",
                    "melodic-hardcore",
                    "emo",
                    "screamo",
                    "metalcore",
                ],
                "influenced_by": ["hardcore-punk"],
                "fusion_of": [],
            },
            "melodic-hardcore": {
                "parents": ["punk"],
                "related": ["hardcore-punk", "post-hardcore"],
                "influenced_by": [],
                "fusion_of": [],
            },
            "emo": {
                "parents": ["punk"],
                "related": ["post-hardcore", "screamo"],
                "influenced_by": [],
                "fusion_of": [],
            },
            "screamo": {
                "parents": ["punk"],
                "related": ["post-hardcore", "hardcore-punk", "emo"],
                "influenced_by": [],
                "fusion_of": [],
            },
            "metalcore": {
                "parents": ["metal"],
                "related": ["hardcore-punk", "post-hardcore"],
                "influenced_by": [],
                "fusion_of": [],
            },
        },
    )
    monkeypatch.setattr(
        paths_scene,
        "build_scene_genre_route",
        lambda _origin, _dest: ["punk", "hardcore-punk", "post-hardcore"],
    )

    def fake_candidates(route, **_kwargs):
        captured_routes.append(list(route))
        return {
            slug: [
                _track(
                    index,
                    title=f"{slug} track",
                    artist=f"{slug} artist",
                    genre_slug=slug,
                )
            ]
            for index, slug in enumerate(dict.fromkeys(route), start=1)
        }

    monkeypatch.setattr(paths_scene_queries, "list_scene_path_candidates", fake_candidates)
    monkeypatch.setattr(paths_scene, "load_artist_radio_graphs", lambda: ({}, {}, {}))

    tracks = paths_scene.compute_scene_path(
        origin_type="genre",
        origin_value="punk",
        dest_type="genre",
        dest_value="post-hardcore",
        step_count=50,
        user_id=1,
    )

    assert tracks is not None
    assert captured_routes[0] == [
        "punk",
        "hardcore-punk",
        "post-hardcore",
        "melodic-hardcore",
        "screamo",
        "emo",
        "post-hardcore",
    ]


def test_compute_scene_path_builds_artist_scene_path_with_endpoint_anchors(
    monkeypatch,
):
    from crate.db import paths_scene
    from crate.db.queries import paths_scene_queries

    profiles = {
        "beatles-id": {
            "id": 10460,
            "name": "The Beatles",
            "genres": [
                {"slug": "classic-rock", "weight": 1.0},
                {"slug": "british", "weight": 0.88},
            ],
        },
        "death-id": {
            "id": 167,
            "name": "Death",
            "genres": [
                {"slug": "death-metal", "weight": 1.0},
                {"slug": "technical-death-metal", "weight": 0.88},
            ],
        },
    }
    anchor_candidates = {
        "beatles-id": [
            _track(
                1,
                title="Come Together",
                artist="The Beatles",
                genre_slug="rock",
                membership_score=1.0,
                artist_popularity_score=0.95,
                track_popularity_score=0.95,
            )
        ],
        "death-id": [
            _track(
                8,
                title="Crystal Mountain",
                artist="Death",
                genre_slug="death-metal",
                membership_score=1.0,
                artist_popularity_score=0.9,
                track_popularity_score=0.92,
            )
        ],
    }
    scene_candidates = {
        "rock": [
            _track(
                2,
                title="Paranoid",
                artist="Black Sabbath",
                genre_slug="rock",
                membership_score=0.96,
                artist_popularity_score=0.9,
            ),
            _track(
                3,
                title="Something Else",
                artist="The Beatles",
                genre_slug="rock",
                membership_score=1.0,
                artist_popularity_score=1.0,
            ),
        ],
        "metal": [
            _track(
                4,
                title="Ace of Spades",
                artist="Motorhead",
                genre_slug="metal",
                membership_score=0.95,
                artist_popularity_score=0.86,
            )
        ],
        "death-metal": [
            _track(
                5,
                title="Seven Churches",
                artist="Possessed",
                genre_slug="death-metal",
                membership_score=0.95,
                artist_popularity_score=0.72,
            ),
            _track(
                6,
                title="Pull the Plug",
                artist="Death",
                genre_slug="death-metal",
                membership_score=1.0,
                artist_popularity_score=0.95,
            ),
            _track(
                7,
                title="Chapel of Ghouls",
                artist="Morbid Angel",
                genre_slug="death-metal",
                membership_score=0.93,
                artist_popularity_score=0.8,
            ),
        ],
    }

    monkeypatch.setattr(
        paths_scene,
        "build_scene_genre_route",
        lambda origin, dest: (
            ["rock", "metal", "death-metal"]
            if (origin, dest) == ("rock", "death-metal")
            else [origin, dest]
        ),
    )
    monkeypatch.setattr(
        paths_scene_queries,
        "get_artist_scene_profile",
        lambda artist_ref, **_kwargs: profiles.get(artist_ref),
        raising=False,
    )
    monkeypatch.setattr(
        paths_scene_queries,
        "list_artist_scene_anchor_candidates",
        lambda artist_ref, **_kwargs: anchor_candidates.get(artist_ref, []),
        raising=False,
    )
    monkeypatch.setattr(
        paths_scene_queries,
        "list_scene_path_candidates",
        lambda *_args, **_kwargs: scene_candidates,
    )
    monkeypatch.setattr(paths_scene, "load_artist_radio_graphs", lambda: ({}, {}, {}))

    tracks = paths_scene.compute_scene_path(
        origin_type="artist",
        origin_value="beatles-id",
        dest_type="artist",
        dest_value="death-id",
        step_count=6,
        user_id=1,
    )

    assert tracks is not None
    assert tracks[0]["artist"] == "The Beatles"
    assert tracks[0]["path_genre"] == "rock"
    assert tracks[-1]["artist"] == "Death"
    assert tracks[-1]["path_genre"] == "death-metal"
    artists = [track["artist"] for track in tracks]
    assert "Black Sabbath" in artists
    assert "Motorhead" in artists
    assert "The Beatles" not in artists[1:-1]
    assert "Death" not in artists[1:-1]
    assert all(count == 1 for count in Counter(artists).values())


def test_artist_scene_path_keeps_unseen_artists_before_repeating():
    from crate.db.paths_scene import build_artist_scene_path_from_candidates

    path = build_artist_scene_path_from_candidates(
        ["punk", "hardcore-punk", "post-hardcore"],
        {
            "origin": [
                _track(
                    1,
                    title="London Calling",
                    artist="The Clash",
                    genre_slug="punk",
                    membership_score=1.0,
                    artist_popularity_score=0.95,
                )
            ],
            "destination": [
                _track(
                    8,
                    title="Waiting Room",
                    artist="Fugazi",
                    genre_slug="post-hardcore",
                    membership_score=1.0,
                    artist_popularity_score=0.9,
                )
            ],
        },
        {
            "punk": [
                _track(
                    2,
                    title="Safe European Home",
                    artist="The Clash",
                    genre_slug="punk",
                    membership_score=1.0,
                    artist_popularity_score=0.98,
                ),
                _track(
                    3,
                    title="Alternative Ulster",
                    artist="Stiff Little Fingers",
                    genre_slug="punk",
                    membership_score=0.92,
                    artist_popularity_score=0.55,
                ),
            ],
            "hardcore-punk": [
                _track(
                    4,
                    title="Rise Above",
                    artist="Black Flag",
                    genre_slug="hardcore-punk",
                    membership_score=0.95,
                ),
                _track(
                    5,
                    title="Pay To Cum",
                    artist="Bad Brains",
                    genre_slug="hardcore-punk",
                    membership_score=0.94,
                ),
            ],
            "post-hardcore": [
                _track(
                    6,
                    title="Repeater",
                    artist="Fugazi",
                    genre_slug="post-hardcore",
                    membership_score=1.0,
                    artist_popularity_score=0.95,
                ),
                _track(
                    7,
                    title="Artex",
                    artist="Drive Like Jehu",
                    genre_slug="post-hardcore",
                    membership_score=0.9,
                    artist_popularity_score=0.6,
                ),
            ],
        },
        step_count=6,
    )

    artists = [track["artist"] for track in path]
    assert artists[0] == "The Clash"
    assert artists[-1] == "Fugazi"
    assert "Stiff Little Fingers" in artists
    assert "Drive Like Jehu" in artists
    assert all(count == 1 for count in Counter(artists).values())


def test_artist_scene_path_relaxes_repeats_after_unique_pool_is_exhausted():
    from crate.db.paths_scene import build_artist_scene_path_from_candidates

    path = build_artist_scene_path_from_candidates(
        ["punk", "post-hardcore"],
        {
            "origin": [
                _track(
                    1,
                    title="London Calling",
                    artist="The Clash",
                    genre_slug="punk",
                    membership_score=1.0,
                )
            ],
            "destination": [
                _track(
                    10,
                    title="Waiting Room",
                    artist="Fugazi",
                    genre_slug="post-hardcore",
                    membership_score=1.0,
                )
            ],
        },
        {
            "punk": [
                _track(2, title="Punk One A", artist="Punk One", genre_slug="punk"),
                _track(3, title="Punk Two A", artist="Punk Two", genre_slug="punk"),
                _track(4, title="Punk One B", artist="Punk One", genre_slug="punk"),
                _track(5, title="Punk Two B", artist="Punk Two", genre_slug="punk"),
            ],
            "post-hardcore": [
                _track(
                    6,
                    title="Post One A",
                    artist="Post One",
                    genre_slug="post-hardcore",
                ),
                _track(
                    7,
                    title="Post Two A",
                    artist="Post Two",
                    genre_slug="post-hardcore",
                ),
                _track(
                    8,
                    title="Post One B",
                    artist="Post One",
                    genre_slug="post-hardcore",
                ),
                _track(
                    9,
                    title="Post Two B",
                    artist="Post Two",
                    genre_slug="post-hardcore",
                ),
            ],
        },
        step_count=8,
    )

    artists = [track["artist"] for track in path]
    counts = Counter(artists)
    assert len(path) == 8
    assert artists[0] == "The Clash"
    assert artists[-1] == "Fugazi"
    assert "The Clash" not in artists[1:-1]
    assert "Fugazi" not in artists[1:-1]
    assert all(left != right for left, right in zip(artists, artists[1:]))
    assert counts["Punk One"] == 2
    assert counts["Post One"] == 2
    assert max(counts.values()) == 2


def test_artist_scene_path_skips_empty_bridge_genres_when_allocating_slots():
    from crate.db.paths_scene import build_artist_scene_path_from_candidates

    path = build_artist_scene_path_from_candidates(
        ["punk", "empty-bridge", "post-hardcore"],
        {
            "origin": [
                _track(
                    1,
                    title="London Calling",
                    artist="The Clash",
                    genre_slug="punk",
                    membership_score=1.0,
                )
            ],
            "destination": [
                _track(
                    8,
                    title="Waiting Room",
                    artist="Fugazi",
                    genre_slug="post-hardcore",
                    membership_score=1.0,
                )
            ],
        },
        {
            "punk": [
                _track(2, title="Punk One A", artist="Punk One", genre_slug="punk"),
                _track(3, title="Punk Two A", artist="Punk Two", genre_slug="punk"),
                _track(4, title="Punk One B", artist="Punk One", genre_slug="punk"),
            ],
            "empty-bridge": [],
            "post-hardcore": [
                _track(
                    5,
                    title="Post One A",
                    artist="Post One",
                    genre_slug="post-hardcore",
                ),
                _track(
                    6,
                    title="Post Two A",
                    artist="Post Two",
                    genre_slug="post-hardcore",
                ),
                _track(
                    7,
                    title="Post One B",
                    artist="Post One",
                    genre_slug="post-hardcore",
                ),
            ],
        },
        step_count=6,
    )

    assert len(path) == 6
    assert "empty-bridge" not in [track["genre_slug"] for track in path]


def test_artist_scene_path_does_not_repeat_song_variants_when_relaxing():
    from crate.db.paths_scene import build_artist_scene_path_from_candidates

    path = build_artist_scene_path_from_candidates(
        ["punk", "post-hardcore"],
        {
            "origin": [
                _track(
                    1,
                    title="London Calling",
                    artist="The Clash",
                    genre_slug="punk",
                    membership_score=1.0,
                )
            ],
            "destination": [
                _track(
                    10,
                    title="Waiting Room",
                    artist="Fugazi",
                    genre_slug="post-hardcore",
                    membership_score=1.0,
                )
            ],
        },
        {
            "punk": [
                _track(
                    2,
                    title="Anthem",
                    artist="Punk One",
                    genre_slug="punk",
                    track_popularity_score=0.9,
                ),
                _track(
                    3,
                    title="Bridge Song",
                    artist="Punk Two",
                    genre_slug="punk",
                    track_popularity_score=0.8,
                ),
                _track(
                    4,
                    title="Anthem (Remastered 2009)",
                    artist="Punk One",
                    genre_slug="punk",
                    track_popularity_score=1.0,
                ),
                _track(
                    5,
                    title="Second Song",
                    artist="Punk One",
                    genre_slug="punk",
                    track_popularity_score=0.7,
                ),
            ],
            "post-hardcore": [
                _track(
                    6,
                    title="Post One A",
                    artist="Post One",
                    genre_slug="post-hardcore",
                ),
                _track(
                    7,
                    title="Post Two A",
                    artist="Post Two",
                    genre_slug="post-hardcore",
                ),
                _track(
                    8,
                    title="Post Three A",
                    artist="Post Three",
                    genre_slug="post-hardcore",
                ),
                _track(
                    9,
                    title="Post Four A",
                    artist="Post Four",
                    genre_slug="post-hardcore",
                ),
            ],
        },
        step_count=8,
    )

    punk_one_titles = [
        track["title"] for track in path if track["artist"] == "Punk One"
    ]
    assert "Anthem" in punk_one_titles
    assert "Second Song" in punk_one_titles
    assert "Anthem (Remastered 2009)" not in punk_one_titles


def test_artist_scene_path_uses_destination_gravity_over_lateral_regional_scene():
    from crate.db.paths_scene import build_artist_scene_path_from_candidates

    path = build_artist_scene_path_from_candidates(
        ["classic-rock", "rock", "alternative-rock"],
        {
            "origin": [
                _track(
                    1,
                    title="Come Together",
                    artist="The Beatles",
                    genre_slug="classic-rock",
                    artist_country="GB",
                    artist_formed="1960",
                )
            ],
            "destination": [
                _track(
                    10,
                    title="Drive",
                    artist="Incubus",
                    genre_slug="alternative-rock",
                    artist_country="US",
                    artist_area="California",
                    artist_formed="1991",
                    artist_genre_slugs=["alternative-rock", "rock", "funk-metal"],
                )
            ],
        },
        {
            "rock": [
                _track(
                    2,
                    title="Spanish Rock Anthem",
                    artist="Extremoduro",
                    genre_slug="rock",
                    artist_country="ES",
                    artist_area="Spain",
                    artist_formed="1987",
                    artist_genre_slugs=["rock", "spanish-rock", "rock-urbano"],
                    membership_score=1.0,
                    artist_popularity_score=0.95,
                    track_popularity_score=0.95,
                ),
                _track(
                    3,
                    title="Monkey Wrench",
                    artist="Foo Fighters",
                    genre_slug="rock",
                    artist_country="US",
                    artist_area="Seattle",
                    artist_formed="1994",
                    artist_genre_slugs=["rock", "alternative-rock", "grunge"],
                    membership_score=0.88,
                    artist_popularity_score=0.62,
                    track_popularity_score=0.64,
                ),
            ],
            "alternative-rock": [
                _track(
                    4,
                    title="One Armed Scissor",
                    artist="At The Drive-In",
                    genre_slug="alternative-rock",
                    artist_country="US",
                    artist_formed="1994",
                    artist_genre_slugs=["alternative-rock", "post-hardcore"],
                    membership_score=0.92,
                )
            ],
        },
        step_count=4,
        artist_similarity_graph={"foo fighters": {"incubus": 0.6}},
        destination_profile={
            "name": "Incubus",
            "country": "US",
            "area": "California",
            "formed": "1991",
            "genres": [
                {
                    "slug": "alternative",
                    "raw_slug": "alternative-rock",
                    "weight": 1.0,
                },
                {"slug": "rock", "raw_slug": "rock", "weight": 0.88},
            ],
        },
    )

    artists = [track["artist"] for track in path]
    assert "Foo Fighters" in artists
    assert "Extremoduro" not in artists


def test_compute_scene_path_expands_sparse_artist_routes_for_long_paths(monkeypatch):
    from crate.db import paths_scene
    from crate.db.queries import paths_scene_queries

    captured_routes: list[list[str]] = []

    profiles = {
        "beatles-id": {
            "id": 10460,
            "name": "The Beatles",
            "country": "GB",
            "formed": "1960",
            "genres": [
                {"slug": "rock", "raw_slug": "classic-rock", "weight": 1.0},
                {"slug": "rock", "raw_slug": "rock", "weight": 0.88},
            ],
        },
        "incubus-id": {
            "id": 95,
            "name": "Incubus",
            "country": "US",
            "formed": "1991",
            "genres": [
                {
                    "slug": "alternative",
                    "raw_slug": "alternative-rock",
                    "weight": 1.0,
                },
                {"slug": "rock", "raw_slug": "rock", "weight": 0.88},
                {"slug": "metal", "raw_slug": "nu-metal", "weight": 0.64},
            ],
        },
    }

    monkeypatch.setattr(
        paths_scene,
        "build_scene_genre_route",
        lambda _origin, _dest: ["classic-rock", "rock", "alternative"],
    )
    monkeypatch.setattr(
        paths_scene_queries,
        "get_artist_scene_profile",
        lambda artist_ref, **_kwargs: profiles.get(artist_ref),
        raising=False,
    )
    monkeypatch.setattr(
        paths_scene_queries,
        "list_artist_scene_anchor_candidates",
        lambda artist_ref, **_kwargs: [
            _track(
                1 if artist_ref == "beatles-id" else 20,
                title="Come Together" if artist_ref == "beatles-id" else "Drive",
                artist="The Beatles" if artist_ref == "beatles-id" else "Incubus",
                genre_slug="classic-rock"
                if artist_ref == "beatles-id"
                else "alternative-rock",
            )
        ],
        raising=False,
    )

    def fake_candidates(route, **_kwargs):
        captured_routes.append(list(route))
        return {
            "classic-rock": [
                _track(2, title="Classic", artist="Classic Band", genre_slug="classic-rock")
            ],
            "rock": [_track(3, title="Rock", artist="Rock Band", genre_slug="rock")],
            "alternative-rock": [
                _track(
                    4,
                    title="Alt",
                    artist="Alt Band",
                    genre_slug="alternative-rock",
                )
            ],
            "nu-metal": [
                _track(5, title="Nu", artist="Nu Band", genre_slug="nu-metal")
            ],
            "alternative": [
                _track(
                    6,
                    title="Alternative",
                    artist="Alternative Band",
                    genre_slug="alternative",
                )
            ],
        }

    monkeypatch.setattr(paths_scene_queries, "list_scene_path_candidates", fake_candidates)
    monkeypatch.setattr(paths_scene, "load_artist_radio_graphs", lambda: ({}, {}, {}))

    tracks = paths_scene.compute_scene_path(
        origin_type="artist",
        origin_value="beatles-id",
        dest_type="artist",
        dest_value="incubus-id",
        step_count=50,
        user_id=1,
    )

    assert tracks is not None
    assert captured_routes
    assert captured_routes[0] == [
        "classic-rock",
        "rock",
        "alternative-rock",
        "nu-metal",
        "alternative",
    ]

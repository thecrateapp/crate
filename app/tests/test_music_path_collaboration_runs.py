from __future__ import annotations

from collections import Counter

from crate.db.paths_scene import (
    _MAX_TRACKS_PER_ALBUM,
    _SceneScorer,
    _artist_key,
    _album_key,
    build_artist_scene_path_from_candidates,
    build_scene_path_from_candidates,
)
from tests.test_paths_scene_engine import _track


def _credited(track_id, credit, principal, album, album_id, genre_slug="rap", **extra):
    row = _track(
        track_id,
        title=f"Song {track_id}",
        artist=credit,
        genre_slug=genre_slug,
        album=album,
        **extra,
    )
    row.update(principal_artist=principal, album_artist=principal, album_id=album_id)
    return row


def _clash_to_urano_candidates():
    collaborations = [
        _credited(
            100 + index,
            f"Flying Lotus, Guest {index}",
            "Flying Lotus",
            "Flamagra",
            500 + index % 2,
            artist_popularity_score=0.99,
        )
        for index in range(6)
    ]
    destination_album = [
        _credited(
            200 + index,
            f"Erik Urano, Flat Erik, Guest {index}",
            "Erik Urano",
            "Neovalladolor",
            600,
            artist_popularity_score=0.99,
        )
        for index in range(6)
    ]
    others = [
        _credited(
            300 + index,
            f"Rapper {index}",
            f"Rapper {index}",
            f"Record {index}",
            700 + index,
            artist_popularity_score=0.4,
        )
        for index in range(12)
    ]
    punk = [
        _credited(
            400 + index,
            f"Punk Band {index}",
            f"Punk Band {index}",
            f"Punk Record {index}",
            800 + index,
            genre_slug="punk",
        )
        for index in range(8)
    ]
    origin = _credited(
        1, "The Clash", "The Clash", "London Calling", 1, genre_slug="punk"
    )
    destination = _credited(2, "Erik Urano", "Erik Urano", "Neovalladolor", 600)
    return origin, destination, punk, [*collaborations, *destination_album, *others]


def test_guest_credits_cannot_chain_one_artist_through_an_artist_path():
    origin, destination, punk, rap = _clash_to_urano_candidates()

    path = build_artist_scene_path_from_candidates(
        ["punk", "rap"],
        {"origin": [origin], "destination": [destination]},
        {"punk": punk, "rap": rap},
        step_count=12,
        selection_seed="clash-urano",
    )

    principals = [track["principal_artist"] for track in path]
    middle = principals[1:-1]
    assert principals[0] == "The Clash" and principals[-1] == "Erik Urano"
    assert len(path) == 12
    assert "Erik Urano" not in middle
    assert Counter(middle)["Flying Lotus"] <= 1
    assert all(left != right for left, right in zip(principals, principals[1:]))
    assert [_artist_key(track) for track in path] == [
        principal.casefold() for principal in principals
    ]


def test_paths_take_at_most_two_tracks_from_one_album_and_never_back_to_back():
    rows = [
        _credited(
            10 + index,
            f"Band {index % 3}",
            f"Band {index % 3}",
            "Shared",
            900,
            genre_slug="punk",
        )
        for index in range(6)
    ] + [
        _credited(
            40 + index,
            f"Other {index}",
            f"Other {index}",
            f"Other {index}",
            950 + index,
            genre_slug="punk",
            artist_popularity_score=0.2,
        )
        for index in range(8)
    ]

    path = build_scene_path_from_candidates(
        ["punk"],
        {"punk": rows},
        step_count=10,
        selection_seed="albums",
    )

    albums = [_album_key(track) for track in path]
    assert len(path) == 10
    assert max(Counter(albums).values()) <= _MAX_TRACKS_PER_ALBUM
    assert all(left != right for left, right in zip(albums, albums[1:]))


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


def test_scene_transitions_use_profile_edges_when_both_tracks_have_them(monkeypatch):
    monkeypatch.setenv("CRATE_TRANSITION_FIT_ENABLED", "true")
    previous = {
        **_track(1, title="Fade", artist="A", genre_slug="punk"),
        **_edges(mix_outro_lufs=-20.0, mix_outro_spectral_density=0.68),
    }
    cold_open = {
        **_track(2, title="Cold", artist="B", genre_slug="punk"),
        **_edges(mix_intro_lufs=-7.0, mix_intro_spectral_density=0.86),
    }
    smooth = {
        **_track(3, title="Smooth", artist="C", genre_slug="punk", bpm=118.0),
        **_edges(
            mix_bpm=118.0,
            mix_key_camelot="3B",
            mix_intro_lufs=-19.0,
            mix_intro_spectral_density=0.69,
        ),
    }

    scorer = _SceneScorer()

    assert scorer.audio_transition_score(
        smooth, previous
    ) > scorer.audio_transition_score(cold_open, previous)


def test_scene_transitions_keep_coarse_signals_without_profile_edges(monkeypatch):
    monkeypatch.setenv("CRATE_TRANSITION_FIT_ENABLED", "true")
    previous = _track(1, title="A", artist="A", genre_slug="punk", bpm=140.0)
    close = _track(2, title="B", artist="B", genre_slug="punk", bpm=138.0)
    far = _track(3, title="C", artist="C", genre_slug="punk", bpm=90.0)

    scorer = _SceneScorer()

    assert scorer.audio_transition_score(
        close, previous
    ) > scorer.audio_transition_score(far, previous)


def test_an_exhausted_scene_borrows_from_the_previous_genre_instead_of_leaving_a_gap():
    origin, destination, punk, _rap = _clash_to_urano_candidates()
    thin_rap = [
        _credited(
            900 + index, f"MC {index}", f"MC {index}", f"Tape {index}", 990 + index
        )
        for index in range(2)
    ]

    path = build_artist_scene_path_from_candidates(
        ["punk", "rap"],
        {"origin": [origin], "destination": [destination]},
        {"punk": punk, "rap": thin_rap},
        step_count=12,
        selection_seed="thin-rap",
    )

    principals = [track["principal_artist"] for track in path]
    assert len(path) == 12
    assert "Erik Urano" not in principals[1:-1]
    assert all(left != right for left, right in zip(principals, principals[1:]))

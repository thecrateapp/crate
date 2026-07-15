from __future__ import annotations


def _track(
    track_id: int,
    *,
    title: str,
    artist: str,
    genre_slug: str,
    year: int = 2000,
) -> dict:
    return {
        "id": track_id,
        "title": title,
        "artist": artist,
        "album": "Album",
        "genre_slug": genre_slug,
        "year": year,
        "duration": 180,
        "artist_country": "US",
        "artist_area": None,
        "artist_formed": None,
        "artist_genre_slugs": [genre_slug],
        "membership_score": 0.9,
        "artist_popularity_score": 0.7,
        "track_popularity_score": 0.7,
    }


def test_llm_refinement_skips_when_no_llm_is_configured(monkeypatch):
    from crate.db import paths_llm_refinement

    tracks = [
        _track(1, title="Origin", artist="Origin Artist", genre_slug="punk"),
        _track(2, title="Middle", artist="Odd Artist", genre_slug="punk"),
        _track(
            3, title="Destination", artist="Dest Artist", genre_slug="post-hardcore"
        ),
    ]

    monkeypatch.setattr(
        paths_llm_refinement, "_llm_refinement_is_configured", lambda: False
    )
    monkeypatch.setattr(
        paths_llm_refinement,
        "ask_structured",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("LLM should not be called when refinement is unavailable")
        ),
    )

    assert (
        paths_llm_refinement.refine_music_path_with_llm(
            origin_label="Punk",
            dest_label="Post-hardcore",
            origin_type="genre",
            dest_type="genre",
            tracks=tracks,
            candidates_by_genre={"punk": tracks},
        )
        == tracks
    )


def test_llm_refinement_skips_when_admin_setting_is_disabled(monkeypatch):
    from crate.db import paths_llm_refinement

    tracks = [
        _track(1, title="Origin", artist="Origin Artist", genre_slug="punk"),
        _track(2, title="Middle", artist="Odd Artist", genre_slug="punk"),
        _track(
            3, title="Destination", artist="Dest Artist", genre_slug="post-hardcore"
        ),
    ]

    monkeypatch.setattr(
        paths_llm_refinement,
        "get_setting",
        lambda key, default=None: (
            "false" if key == "paths_llm_refinement_enabled" else default
        ),
    )
    monkeypatch.setattr(
        paths_llm_refinement,
        "get_config",
        lambda: {"provider": "gemini", "model": "gemini/gemini-2.5-flash"},
    )
    monkeypatch.setattr(
        paths_llm_refinement, "get_provider_api_key", lambda _provider: "key"
    )
    monkeypatch.setattr(
        paths_llm_refinement,
        "ask_structured",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("LLM should not be called when refinement is disabled")
        ),
    )

    assert (
        paths_llm_refinement.refine_music_path_with_llm(
            origin_label="Punk",
            dest_label="Post-hardcore",
            origin_type="genre",
            dest_type="genre",
            tracks=tracks,
            candidates_by_genre={"punk": tracks},
        )
        == tracks
    )


def test_llm_refinement_skips_when_setting_store_is_unavailable(monkeypatch):
    from crate.db import paths_llm_refinement

    tracks = [
        _track(1, title="Origin", artist="Origin Artist", genre_slug="punk"),
        _track(2, title="Middle", artist="Odd Artist", genre_slug="punk"),
        _track(
            3, title="Destination", artist="Dest Artist", genre_slug="post-hardcore"
        ),
    ]

    monkeypatch.setattr(
        paths_llm_refinement,
        "get_setting",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("db offline")),
    )
    monkeypatch.setattr(
        paths_llm_refinement,
        "ask_structured",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("LLM should not be called when settings are unavailable")
        ),
    )

    assert (
        paths_llm_refinement.refine_music_path_with_llm(
            origin_label="Punk",
            dest_label="Post-hardcore",
            origin_type="genre",
            dest_type="genre",
            tracks=tracks,
            candidates_by_genre={"punk": tracks},
        )
        == tracks
    )


def test_llm_refinement_applies_valid_candidate_replacement(monkeypatch):
    from crate.db import paths_llm_refinement
    from crate.db.paths_llm_refinement import (
        MusicPathLlmRefinementResponse,
        MusicPathReplacement,
    )

    tracks = [
        _track(1, title="Origin", artist="Origin Artist", genre_slug="punk"),
        _track(2, title="Odd Step", artist="Odd Artist", genre_slug="rock"),
        _track(
            3, title="Destination", artist="Dest Artist", genre_slug="post-hardcore"
        ),
    ]
    candidate = _track(
        4,
        title="Better Step",
        artist="Better Artist",
        genre_slug="rock",
    )

    monkeypatch.setattr(
        paths_llm_refinement, "_llm_refinement_is_configured", lambda: True
    )
    monkeypatch.setattr(
        paths_llm_refinement,
        "ask_structured",
        lambda *_args, **_kwargs: MusicPathLlmRefinementResponse(
            replacements=[
                MusicPathReplacement(
                    target_track_id=2,
                    replacement_track_id=4,
                    reason="Better bridge to the destination scene.",
                    confidence=0.84,
                )
            ],
            notes=["Odd Artist is a lateral step."],
        ),
    )

    refined = paths_llm_refinement.refine_music_path_with_llm(
        origin_label="Origin",
        dest_label="Destination",
        origin_type="artist",
        dest_type="artist",
        tracks=tracks,
        candidates_by_genre={"rock": [candidate]},
    )

    assert [track["id"] for track in refined] == [1, 4, 3]


def test_llm_refinement_uses_cache_for_identical_path(monkeypatch):
    from crate.db import paths_llm_refinement
    from crate.db.paths_llm_refinement import (
        MusicPathLlmRefinementResponse,
        MusicPathReplacement,
    )

    tracks = [
        _track(1, title="Origin", artist="Origin Artist", genre_slug="punk"),
        _track(2, title="Odd Step", artist="Odd Artist", genre_slug="rock"),
        _track(
            3, title="Destination", artist="Dest Artist", genre_slug="post-hardcore"
        ),
    ]
    candidate = _track(
        4,
        title="Better Step",
        artist="Better Artist",
        genre_slug="rock",
    )
    cache: dict[str, dict] = {}
    calls = {"count": 0}

    monkeypatch.setattr(
        paths_llm_refinement, "_llm_refinement_is_configured", lambda: True
    )
    monkeypatch.setattr(
        paths_llm_refinement, "get_cache", lambda key, **_kwargs: cache.get(key)
    )
    monkeypatch.setattr(
        paths_llm_refinement,
        "set_cache",
        lambda key, value, **_kwargs: cache.setdefault(key, value),
    )

    def fake_ask(*_args, **_kwargs):
        calls["count"] += 1
        return MusicPathLlmRefinementResponse(
            replacements=[
                MusicPathReplacement(
                    target_track_id=2,
                    replacement_track_id=4,
                    reason="Better bridge.",
                    confidence=0.84,
                )
            ],
        )

    monkeypatch.setattr(paths_llm_refinement, "ask_structured", fake_ask)

    for _ in range(2):
        refined = paths_llm_refinement.refine_music_path_with_llm(
            origin_label="Origin",
            dest_label="Destination",
            origin_type="artist",
            dest_type="artist",
            tracks=tracks,
            candidates_by_genre={"rock": [candidate]},
        )
        assert [track["id"] for track in refined] == [1, 4, 3]

    assert calls["count"] == 1


def test_llm_refinement_ignores_anchor_and_missing_candidate_replacements(monkeypatch):
    from crate.db import paths_llm_refinement
    from crate.db.paths_llm_refinement import (
        MusicPathLlmRefinementResponse,
        MusicPathReplacement,
    )

    tracks = [
        _track(1, title="Origin", artist="Origin Artist", genre_slug="punk"),
        _track(2, title="Middle", artist="Middle Artist", genre_slug="punk"),
        _track(
            3, title="Destination", artist="Dest Artist", genre_slug="post-hardcore"
        ),
    ]

    monkeypatch.setattr(
        paths_llm_refinement, "_llm_refinement_is_configured", lambda: True
    )
    monkeypatch.setattr(
        paths_llm_refinement,
        "ask_structured",
        lambda *_args, **_kwargs: MusicPathLlmRefinementResponse(
            replacements=[
                MusicPathReplacement(
                    target_track_id=1,
                    replacement_track_id=4,
                    reason="Do not replace origin.",
                    confidence=0.9,
                ),
                MusicPathReplacement(
                    target_track_id=2,
                    replacement_track_id=999,
                    reason="Unknown candidate.",
                    confidence=0.9,
                ),
            ],
        ),
    )

    refined = paths_llm_refinement.refine_music_path_with_llm(
        origin_label="Origin",
        dest_label="Destination",
        origin_type="artist",
        dest_type="artist",
        tracks=tracks,
        candidates_by_genre={
            "punk": [_track(4, title="Other", artist="Other", genre_slug="punk")]
        },
    )

    assert [track["id"] for track in refined] == [1, 2, 3]

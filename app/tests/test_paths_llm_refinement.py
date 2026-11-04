from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def pinned_legacy_refinement(monkeypatch):
    from crate import music_paths_refinement as refinement
    from tests.ai_consumer_fakes import pin_actions
    from crate.ai import configuration

    pin_actions(monkeypatch)
    context = configuration.resolve_action("music_paths.refine")
    monkeypatch.setattr(
        refinement,
        "resolve_call",
        lambda *a, **k: {
            "context": {**context, "mode": "legacy", "provider": "gemini"}
        },
    )
    monkeypatch.setattr(refinement, "revalidate_call", lambda call: None)
    monkeypatch.setattr(refinement, "get_setting", lambda key, default=None: default)
    monkeypatch.setattr(refinement, "get_cache", lambda *a, **k: None)
    monkeypatch.setattr(refinement, "set_cache", lambda *a, **k: None)


def _track(
    track_id: int,
    *,
    title: str,
    artist: str,
    genre_slug: str,
    year: int = 2000,
    bpm: float = 100.0,
) -> dict:
    return {
        "id": track_id,
        "title": title,
        "artist": artist,
        "album": "Album",
        "genre_slug": genre_slug,
        "year": year,
        "duration": 180,
        "bpm": bpm,
        "artist_country": "US",
        "artist_area": None,
        "artist_formed": None,
        "artist_genre_slugs": [genre_slug],
        "membership_score": 0.9,
        "artist_popularity_score": 0.7,
        "track_popularity_score": 0.7,
    }


def test_llm_refinement_skips_when_no_llm_is_configured(monkeypatch):
    from crate import music_paths_refinement as paths_llm_refinement

    tracks = [
        _track(1, title="Origin", artist="Origin Artist", genre_slug="punk"),
        _track(2, title="Middle", artist="Odd Artist", genre_slug="punk"),
        _track(
            3, title="Destination", artist="Dest Artist", genre_slug="post-hardcore"
        ),
    ]

    monkeypatch.setattr(
        paths_llm_refinement,
        "resolve_call",
        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("unavailable")),
    )
    monkeypatch.setattr(
        paths_llm_refinement,
        "execute_structured",
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
            candidates_by_genre={
                "punk": [
                    *tracks,
                    _track(4, title="Alternative", artist="Other", genre_slug="punk"),
                ]
            },
        )
        == tracks
    )


def test_llm_refinement_skips_when_admin_setting_is_disabled(monkeypatch):
    from crate import music_paths_refinement as paths_llm_refinement

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
        "execute_structured",
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
            candidates_by_genre={
                "punk": [
                    *tracks,
                    _track(4, title="Alternative", artist="Other", genre_slug="punk"),
                ]
            },
        )
        == tracks
    )


def test_llm_refinement_skips_when_setting_store_is_unavailable(monkeypatch):
    from crate import music_paths_refinement as paths_llm_refinement

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
        "execute_structured",
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
            candidates_by_genre={
                "punk": [
                    *tracks,
                    _track(4, title="Alternative", artist="Other", genre_slug="punk"),
                ]
            },
        )
        == tracks
    )


def test_llm_refinement_applies_valid_candidate_replacement(monkeypatch):
    from crate import music_paths_refinement as paths_llm_refinement
    from crate.music_paths_refinement import (
        MusicPathLlmRefinementResponse,
        MusicPathReplacement,
    )

    tracks = [
        _track(1, title="Origin", artist="Origin Artist", genre_slug="punk"),
        _track(2, title="Odd Step", artist="Odd Artist", genre_slug="rock", bpm=180.0),
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
        paths_llm_refinement, "_legacy_refinement_enabled", lambda context: True
    )
    monkeypatch.setattr(
        paths_llm_refinement,
        "execute_structured",
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
    from crate import music_paths_refinement as paths_llm_refinement
    from crate.music_paths_refinement import (
        MusicPathLlmRefinementResponse,
        MusicPathReplacement,
    )

    tracks = [
        _track(1, title="Origin", artist="Origin Artist", genre_slug="punk"),
        _track(2, title="Odd Step", artist="Odd Artist", genre_slug="rock", bpm=180.0),
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
        paths_llm_refinement, "_legacy_refinement_enabled", lambda context: True
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

    monkeypatch.setattr(paths_llm_refinement, "execute_structured", fake_ask)

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
    from crate import music_paths_refinement as paths_llm_refinement
    from crate.music_paths_refinement import (
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
        paths_llm_refinement, "_legacy_refinement_enabled", lambda context: True
    )
    monkeypatch.setattr(
        paths_llm_refinement,
        "execute_structured",
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


# ── SMQ.PR4: the review runs in the ai queue, never inside the request ──────


def _scene(tracks, candidates):
    return {
        "origin_label": "Origin",
        "dest_label": "Destination",
        "origin_type": "genre",
        "dest_type": "genre",
        "tracks": tracks,
        "candidates_by_genre": candidates,
        "validation_context": None,
    }


def _scene_tracks():
    return [
        _track(1, title="Origin", artist="Origin Artist", genre_slug="punk"),
        _track(2, title="Odd Step", artist="Odd Artist", genre_slug="rock", bpm=180.0),
        _track(
            3, title="Destination", artist="Dest Artist", genre_slug="post-hardcore"
        ),
    ]


def _better_candidate():
    return _track(4, title="Better Step", artist="Better Artist", genre_slug="rock")


def _replacement():
    from crate.music_paths_refinement import (
        MusicPathLlmRefinementResponse,
        MusicPathReplacement,
    )

    return MusicPathLlmRefinementResponse(
        replacements=[
            MusicPathReplacement(
                target_track_id=2,
                replacement_track_id=4,
                reason="Better bridge.",
                confidence=0.84,
            )
        ]
    )


@pytest.fixture
def scene_service(monkeypatch):
    """create_music_path over a fixed scene plan, without the library."""
    from crate import music_paths
    from crate import music_paths_refinement as refinement

    state = {"queued": [], "records": []}
    monkeypatch.setattr(refinement, "_legacy_refinement_enabled", lambda context: True)
    monkeypatch.setattr(
        refinement,
        "execute_structured",
        lambda *a, **k: pytest.fail("the request must not call the model"),
    )
    monkeypatch.setattr(music_paths, "history_for_candidates", lambda *a, **k: {})
    monkeypatch.setattr(music_paths, "resolve_endpoint_label", lambda _t, value: value)
    monkeypatch.setattr(
        music_paths,
        "prepare_scene_path",
        lambda **_: _scene(_scene_tracks(), {"rock": [_better_candidate()]}),
    )
    monkeypatch.setattr(
        music_paths,
        "validate_music_path",
        lambda tracks, **_: {
            "is_partial": False,
            "generated_step_count": len(tracks),
            "warnings": [],
        },
    )

    def record(**kwargs):
        state["records"].append(kwargs)
        return {"id": 7, "created_at": "2026-11-04T10:00:00+00:00"}

    monkeypatch.setattr(music_paths, "create_music_path_record", record)
    monkeypatch.setattr(
        music_paths,
        "create_task_dedup",
        lambda task_type, params, dedup_key: (
            state["queued"].append((task_type, params, dedup_key)) or "refine-task"
        ),
    )
    return state


def test_create_returns_deterministic_and_enqueues(scene_service):
    from crate.music_paths import create_music_path

    result = create_music_path(
        user_id=3,
        name="Origin to Destination",
        origin_type="genre",
        origin_value="punk",
        dest_type="genre",
        dest_value="post-hardcore",
        step_count=3,
    )

    assert [track["track_id"] for track in result["tracks"]] == [1, 2, 3]
    assert result["revision"] == 1
    assert result["refinement"] == {"status": "pending"}
    metadata = scene_service["records"][0]["generation_metadata"]
    assert metadata["revision"] == 1
    assert metadata["refinement"] == {"status": "pending"}
    assert len(scene_service["queued"]) == 1
    task_type, params, dedup_key = scene_service["queued"][0]
    assert task_type == "refine_music_path"
    assert params["path_id"] == 7
    assert params["user_id"] == 3
    assert params["revision"] == 1
    assert params["selection_seed"]
    assert params["planned_at"]
    assert params["previous_track_ids"] == []
    assert params["ai_acceptance"]["action_id"] == "music_paths.refine"
    assert dedup_key.startswith("music-path-refine:7:1:")


def test_cache_hit_applies_inline_without_model_call(scene_service, monkeypatch):
    from crate import music_paths_refinement as refinement
    from crate.music_paths import create_music_path

    cached = _replacement().model_dump(mode="json")
    monkeypatch.setattr(refinement, "get_cache", lambda *a, **k: cached)

    result = create_music_path(
        user_id=3,
        name="Origin to Destination",
        origin_type="genre",
        origin_value="punk",
        dest_type="genre",
        dest_value="post-hardcore",
        step_count=3,
    )

    assert [track["track_id"] for track in result["tracks"]] == [1, 4, 3]
    assert result["refinement"] == {"status": "applied", "cached": True}
    assert scene_service["queued"] == []


@pytest.fixture
def stored_path(pg_db, monkeypatch):
    """A saved deterministic path waiting for its review (revision 1)."""
    from crate import music_paths
    from crate.ai.consumers import accept_action
    from crate.db.repositories.auth_user_accounts import create_user
    from crate.db.repositories.paths import create_music_path_record

    user = create_user("paths-listener@example.test", role="user")
    entries = [
        music_paths._make_path_entry(track, index, 3, 3)
        for index, track in enumerate(_scene_tracks())
    ]
    row = create_music_path_record(
        user_id=user["id"],
        name="Origin to Destination",
        origin_type="genre",
        origin_value="punk",
        origin_label="Origin",
        dest_type="genre",
        dest_value="post-hardcore",
        dest_label="Destination",
        waypoints=[],
        step_count=3,
        tracks=entries,
        generation_metadata={
            "is_partial": False,
            "generated_step_count": 3,
            "warnings": [],
            "requested_waypoints": [],
            "revision": 1,
            "refinement": {"status": "pending"},
        },
    )
    broadcasts = []
    monkeypatch.setattr(music_paths, "history_for_candidates", lambda *a, **k: {})
    monkeypatch.setattr(
        music_paths,
        "prepare_scene_path",
        lambda **_: _scene(_scene_tracks(), {"rock": [_better_candidate()]}),
    )
    monkeypatch.setattr(
        music_paths,
        "validate_music_path",
        lambda tracks, **_: {
            "is_partial": False,
            "generated_step_count": len(tracks),
            "warnings": [],
        },
    )
    monkeypatch.setattr(
        "crate.api.cache_events.broadcast_invalidation",
        lambda *scopes: broadcasts.append(scopes),
    )
    params = {
        "path_id": row["id"],
        "user_id": user["id"],
        "revision": 1,
        "selection_seed": "seed",
        "planned_at": "2026-11-04T10:00:00+00:00",
        "previous_track_ids": [],
        "previous_song_keys": [],
        "ai_acceptance": accept_action("music_paths.refine"),
    }
    return {
        "id": row["id"],
        "user_id": user["id"],
        "params": params,
        "broadcasts": broadcasts,
    }


def _stored(path):
    from crate.db.queries.paths import get_music_path_row

    return dict(get_music_path_row(path["id"], path["user_id"]))


def test_worker_applies_refinement_as_new_revision(stored_path, monkeypatch):
    from crate import music_paths_refinement as refinement
    from crate.worker_handlers.ai_proposals import _handle_refine_music_path

    calls = []
    monkeypatch.setattr(refinement, "_legacy_refinement_enabled", lambda context: True)
    monkeypatch.setattr(
        refinement,
        "execute_structured",
        lambda *a, **k: calls.append(k) or _replacement(),
    )

    result = _handle_refine_music_path("refine-job", stored_path["params"], {})

    assert result["status"] == "applied"
    row = _stored(stored_path)
    assert [track["track_id"] for track in row["tracks"]] == [1, 4, 3]
    assert row["generation_metadata"]["revision"] == 2
    assert row["generation_metadata"]["refinement"]["status"] == "applied"
    assert calls[0]["job_id"] == "refine-job"
    assert stored_path["broadcasts"] == [("paths", f"path:{stored_path['id']}")]


def test_invalidation_event_published(stored_path, monkeypatch):
    from crate import music_paths_refinement as refinement
    from crate.music_paths_refinement import MusicPathLlmRefinementResponse
    from crate.worker_handlers.ai_proposals import _handle_refine_music_path

    monkeypatch.setattr(refinement, "_legacy_refinement_enabled", lambda context: True)
    monkeypatch.setattr(
        refinement,
        "execute_structured",
        lambda *a, **k: MusicPathLlmRefinementResponse(replacements=[]),
    )

    result = _handle_refine_music_path("refine-job", stored_path["params"], {})

    # Nothing to change: the pending state still ends and clients refetch.
    assert result["status"] == "unchanged"
    row = _stored(stored_path)
    assert [track["track_id"] for track in row["tracks"]] == [1, 2, 3]
    assert row["generation_metadata"]["revision"] == 1
    assert row["generation_metadata"]["refinement"]["status"] == "unchanged"
    assert stored_path["broadcasts"] == [("paths", f"path:{stored_path['id']}")]


def test_superseded_revision_is_left_alone(stored_path, monkeypatch):
    from crate import music_paths_refinement as refinement
    from crate.worker_handlers.ai_proposals import _handle_refine_music_path

    monkeypatch.setattr(
        refinement,
        "execute_structured",
        lambda *a, **k: pytest.fail("a superseded path needs no review"),
    )
    params = {**stored_path["params"], "revision": 0}

    result = _handle_refine_music_path("refine-job", params, {})

    assert result["status"] == "skipped"
    assert _stored(stored_path)["generation_metadata"]["revision"] == 1
    assert stored_path["broadcasts"] == []


def test_changed_inputs_keep_the_deterministic_path(stored_path, monkeypatch):
    from crate import music_paths
    from crate import music_paths_refinement as refinement
    from crate.worker_handlers.ai_proposals import _handle_refine_music_path

    monkeypatch.setattr(
        refinement,
        "execute_structured",
        lambda *a, **k: pytest.fail("a path that cannot be reproduced is kept"),
    )
    monkeypatch.setattr(
        music_paths,
        "prepare_scene_path",
        lambda **_: _scene(list(reversed(_scene_tracks())), {}),
    )

    result = _handle_refine_music_path("refine-job", stored_path["params"], {})

    assert result["status"] == "skipped"
    row = _stored(stored_path)
    assert [track["track_id"] for track in row["tracks"]] == [1, 2, 3]
    assert row["generation_metadata"]["refinement"]["status"] == "skipped"
    assert stored_path["broadcasts"] == [("paths", f"path:{stored_path['id']}")]

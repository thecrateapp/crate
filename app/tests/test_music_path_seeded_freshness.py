"""Seeded artist variation must preserve the service's freshness preference."""

from copy import deepcopy
from datetime import UTC, datetime, timedelta

import pytest
from crate import music_paths
from crate.db import paths_scene
from crate.db.queries import paths_scene_queries
from crate.track_versions import track_song_identity

from tests.test_paths_scene_engine import _track

NOW = datetime(2026, 10, 29, 12, tzinfo=UTC)


def _song(index, title, score):
    return _track(
        index,
        title=title,
        artist="Origin Artist",
        genre_slug="punk",
        track_popularity_score=(score - 0.35) / 0.35,
    )


def _catalog(monkeypatch, rows, *, history):
    destination = _track(
        99, title="Finish", artist="Destination Artist", genre_slug="post-hardcore"
    )
    profiles = {
        "origin": {
            "name": "Origin Artist",
            "genres": [{"slug": "punk", "weight": 1.0}],
        },
        "destination": {
            "name": "Destination Artist",
            "genres": [{"slug": "post-hardcore", "weight": 1.0}],
        },
    }
    calls = []

    def history_for_candidates(user_id, refs, since, *, now):
        calls.append((user_id, refs, since, now))
        return deepcopy(history)

    monkeypatch.setattr(music_paths, "history_for_candidates", history_for_candidates)
    monkeypatch.setattr(
        music_paths, "resolve_endpoint_label", lambda _kind, value: value
    )
    monkeypatch.setattr(
        music_paths, "refine_music_path_with_llm", lambda **kwargs: kwargs["tracks"]
    )
    monkeypatch.setattr(
        paths_scene,
        "build_scene_genre_route",
        lambda origin, destination: [origin, destination],
    )
    monkeypatch.setattr(paths_scene, "load_artist_radio_graphs", lambda: ({}, {}, {}))
    monkeypatch.setattr(
        paths_scene_queries,
        "get_artist_scene_profile",
        lambda ref: deepcopy(profiles[ref]),
    )
    monkeypatch.setattr(
        paths_scene_queries,
        "list_artist_scene_anchor_candidates",
        lambda ref, **_kwargs: deepcopy(rows if ref == "origin" else [destination]),
    )
    monkeypatch.setattr(
        paths_scene_queries, "list_scene_path_candidates", lambda *_args, **_kwargs: {}
    )
    return calls


def _origins_across_seeds(*, previous_tracks=None):
    ids = []
    for index in range(200):
        plan = music_paths.build_music_path_plan(
            "artist",
            "origin",
            "artist",
            "destination",
            step_count=2,
            user_id=7,
            now=NOW,
            selection_seed=f"generation-{index}",
            previous_tracks=previous_tracks,
        )
        assert plan is not None
        assert len(plan["tracks"]) == 2
        assert plan["tracks"][-1]["track_id"] == 99
        ids.append(plan["tracks"][0]["track_id"])
    return ids


@pytest.mark.parametrize("cooldown", ["recent", "previous-id", "previous-song"])
def test_two_hundred_service_seeds_never_choose_a_comparable_cooled_song(
    monkeypatch, cooldown
):
    cooled, fresh = _song(1, "Cooled", 0.55), _song(2, "Fresh", 0.568)
    assert paths_scene._track_score(cooled) == pytest.approx(0.55)
    assert paths_scene._track_score(fresh) == pytest.approx(0.568)
    history = (
        {track_song_identity(cooled): {"frequency": 1}} if cooldown == "recent" else {}
    )
    calls = _catalog(monkeypatch, [cooled, fresh], history=history)
    previous = None
    if cooldown == "previous-id":
        previous = [{"track_id": 1, "artist": "Old metadata", "title": "Old name"}]
    elif cooldown == "previous-song":
        previous = [
            {"track_id": 1001, "artist": cooled["artist"], "title": cooled["title"]}
        ]

    selected = _origins_across_seeds(previous_tracks=previous)

    assert calls == [(7, None, NOW - timedelta(days=7), NOW)] * 200
    assert set(selected) == {2}


@pytest.mark.parametrize(
    "fresh_score", [None, 0.385], ids=["no-fresh", "fresh-outside-quality-floor"]
)
def test_seeded_artist_selection_keeps_a_cooled_anchor_when_no_comparable_fresh_song_exists(
    monkeypatch, fresh_score
):
    cooled = _song(1, "Cooled", 0.55)
    rows = [cooled]
    if fresh_score is not None:
        weak = _song(2, "Weak", fresh_score)
        assert paths_scene._track_score(weak) < max(0.55 * 0.72, 0.55 - 0.18)
        rows.append(weak)
    _catalog(monkeypatch, rows, history={track_song_identity(cooled): {"frequency": 1}})

    assert set(_origins_across_seeds()) == {1}

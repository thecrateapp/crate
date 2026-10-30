from copy import deepcopy
from datetime import datetime, timedelta, timezone

import pytest

from crate import music_paths as service
from crate.db import paths_path_builder as acoustic
from crate.db import paths_scene as scene
from crate.track_versions import track_song_identity
from tests.test_music_paths_fallback import _install_builder, _row
from tests.test_paths_scene_engine import _track

NOW = datetime(2026, 10, 28, 12, tzinfo=timezone.utc)


def _song(index, *, artist="Start Artist", title=None, genre="punk", **signals):
    return _track(
        index,
        title=title or f"Song {index}",
        artist=artist,
        genre_slug=genre,
        **signals,
    )


def _keys(*tracks):
    return {track_song_identity(track) for track in tracks}


def _favorite_pair():
    return _song(1, user_play_count=20), _song(2)


@pytest.mark.parametrize("recently_listened", [True, False])
def test_strong_affinity_rotates_only_after_a_significant_listen(recently_listened):
    favorite, fresh = _favorite_pair()

    selected = scene._select_artist_track(
        [favorite, fresh],
        previous_track=None,
        selection_seed="fixed",
        recent_song_keys=_keys(favorite) if recently_listened else set(),
        previous_song_keys=set(),
    )

    assert selected["id"] == (fresh["id"] if recently_listened else favorite["id"])


def test_a_fully_cooled_artist_does_not_hide_an_equivalent_fresh_artist():
    favorite = _song(1, artist="Heard Artist", user_play_count=20)
    fresh = _song(2, artist="Fresh Artist")

    selected = scene._select_track_for_genre(
        "punk",
        [favorite, fresh],
        used_ids=set(),
        used_artists={},
        is_anchor=False,
        selection_seed="fixed",
        recent_song_keys=_keys(favorite),
        previous_song_keys=set(),
    )

    assert selected is not None
    assert selected["id"] == fresh["id"]


def test_an_artist_with_another_fresh_song_is_not_penalized_whole():
    favorite = _song(1, user_play_count=20, artist_popularity_score=0.9)
    fresh = _song(2, artist_popularity_score=0.9)
    alternative = _song(3, artist="Other Artist", artist_popularity_score=0.5)

    selected = scene._select_track_for_genre(
        "punk",
        [favorite, fresh, alternative],
        used_ids=set(),
        used_artists={},
        is_anchor=False,
        selection_seed="fixed",
        recent_song_keys=_keys(favorite),
        previous_song_keys=set(),
    )

    assert selected is not None
    assert selected["id"] == fresh["id"]


def test_recent_song_recovers_when_the_fresh_option_is_musically_weaker():
    favorite = _song(1, user_play_count=20, track_popularity_score=1.0)
    weak = _song(2, track_popularity_score=0.05, membership_score=0.7)

    selected = scene._select_artist_track(
        [favorite, weak],
        previous_track=None,
        selection_seed="fixed",
        recent_song_keys=_keys(favorite),
        previous_song_keys=set(),
    )

    assert selected["id"] == favorite["id"]


def test_previous_path_is_a_soft_preference_independent_of_listen_history():
    previous, fresh = _favorite_pair()
    recent_song_keys = set()

    selected = scene._select_artist_track(
        [previous, fresh],
        previous_track=None,
        selection_seed="fixed",
        recent_song_keys=recent_song_keys,
        previous_song_keys=_keys(previous),
    )

    assert selected["id"] == fresh["id"]
    assert recent_song_keys == set()


def test_all_cooled_candidates_still_form_a_viable_scene_path():
    origin = _song(1)
    destination = _song(2, artist="Finish Artist", genre="post-hardcore")

    path = scene.build_scene_path_from_candidates(
        ["punk", "post-hardcore"],
        {"punk": [origin], "post-hardcore": [destination]},
        step_count=2,
        selection_seed="fixed",
        recent_song_keys=_keys(origin, destination),
        previous_song_keys=_keys(origin, destination),
    )

    assert [track["id"] for track in path] == [origin["id"], destination["id"]]


def test_seeded_fresh_rotation_is_reproducible_and_can_vary():
    favorite = _song(1, user_play_count=20)
    rows = [favorite, *[_song(index) for index in range(2, 8)]]
    before = deepcopy(rows)

    def select(seed):
        return scene._select_artist_track(
            rows,
            previous_track=None,
            selection_seed=seed,
            recent_song_keys=_keys(favorite),
            previous_song_keys=set(),
        )["id"]

    assert select("fixed") == select("fixed")
    varied = {select(f"generation-{index}") for index in range(16)}
    assert favorite["id"] not in varied
    assert len(varied) > 1
    assert rows == before


def test_artist_scene_endpoint_selection_uses_song_recency():
    favorite, fresh = _favorite_pair()
    destination = _song(3, artist="Finish Artist", genre="post-hardcore")

    path = scene.build_artist_scene_path_from_candidates(
        ["punk", "post-hardcore"],
        {"origin": [favorite, fresh], "destination": [destination]},
        {},
        step_count=2,
        selection_seed="fixed",
        recent_song_keys=_keys(favorite),
        previous_song_keys=set(),
    )

    assert [track["id"] for track in path] == [fresh["id"], destination["id"]]


def _planning_fakes(monkeypatch, *, fallback=False):
    scene_calls, acoustic_calls = [], []
    tracks = [{"track_id": 90, "artist": "Generated Artist", "title": "Generated"}]
    monkeypatch.setattr(service, "resolve_endpoint_label", lambda kind, value: value)
    monkeypatch.setattr(service, "resolve_bliss_centroid", lambda *args: [0.1] * 20)
    monkeypatch.setattr(service, "load_endpoint_contexts", lambda endpoints: [])

    def plan_scene(**kwargs):
        scene_calls.append(kwargs)
        return None if fallback else deepcopy(tracks)

    def plan_acoustic(*args, **kwargs):
        acoustic_calls.append(kwargs)
        return deepcopy(tracks)

    monkeypatch.setattr(service, "compute_scene_path", plan_scene)
    monkeypatch.setattr(service, "compute_path", plan_acoustic)
    return scene_calls, acoustic_calls


def test_scene_fallback_reuses_one_listener_history_and_generation_seed(monkeypatch):
    heard, previous = _song(1), _song(2)
    history_calls = []
    history = {track_song_identity(heard): {"frequency": 1}}

    def load_history(user_id, refs, since, *, now, **kwargs):
        history_calls.append((user_id, refs, since, now))
        return deepcopy(history)

    monkeypatch.setattr(service, "history_for_candidates", load_history, raising=False)
    scene_calls, acoustic_calls = _planning_fakes(monkeypatch, fallback=True)

    plan = service.build_music_path_plan(
        "genre",
        "punk",
        "genre",
        "post-hardcore",
        user_id=7,
        selection_seed="generation",
        now=NOW,
        previous_tracks=[previous],
    )

    assert plan is not None
    assert history_calls == [(7, None, NOW - timedelta(days=7), NOW)]
    for options in (scene_calls[0], acoustic_calls[0]):
        assert options["recent_song_keys"] == _keys(heard)
        assert options["previous_song_keys"] == _keys(previous)
        assert options["previous_track_ids"] == {previous["id"]}
        assert options["selection_seed"] == "generation"
    assert history == {track_song_identity(heard): {"frequency": 1}}


def test_planning_without_a_listener_does_not_read_listening_history(monkeypatch):
    def forbid_history(*args, **kwargs):
        raise AssertionError("Anonymous planning must not query listener history")

    monkeypatch.setattr(
        service, "history_for_candidates", forbid_history, raising=False
    )
    _planning_fakes(monkeypatch)

    plan = service.build_music_path_plan(
        "genre",
        "punk",
        "genre",
        "post-hardcore",
        selection_seed="fixed",
        now=NOW,
    )

    assert plan is not None


def test_service_respects_real_significant_history_window_and_listener(
    pg_db, monkeypatch
):
    from sqlalchemy import text
    from crate.db.tx import transaction_scope
    from tests.test_recommendation_history import _events

    with transaction_scope() as session:
        session.execute(
            text("""
            INSERT INTO users (id, email, password_hash, role, created_at)
            VALUES (2, 'other-path-listener@test.invalid', 'unused', 'user', NOW())
            ON CONFLICT (id) DO NOTHING
        """)
        )
    _events(
        {"title": "Recent", "ended_at": NOW - timedelta(days=6)},
        {"title": "Boundary", "ended_at": NOW - timedelta(days=7)},
        {"title": "Old", "ended_at": NOW - timedelta(days=7, microseconds=1)},
        {"title": "Brief", "played_seconds": 18.77},
        {"title": "Other listener", "user_id": 2},
    )
    scene_calls, _ = _planning_fakes(monkeypatch)

    plan = service.build_music_path_plan(
        "genre",
        "punk",
        "genre",
        "post-hardcore",
        user_id=1,
        selection_seed="fixed",
        now=NOW,
    )

    assert plan is not None
    assert scene_calls[0]["recent_song_keys"] == {
        ("birds in row", "recent"),
        ("birds in row", "boundary"),
    }


def test_regeneration_forwards_saved_tracks_without_creating_listens(monkeypatch):
    previous = [{"track_id": 1, "artist": "Start Artist", "title": "Old"}]
    replacement = [{"track_id": 2, "artist": "Start Artist", "title": "New"}]
    path = {
        "id": 3,
        "origin": {"type": "genre", "value": "punk"},
        "destination": {"type": "genre", "value": "post-hardcore"},
        "waypoints": [],
        "step_count": 5,
        "tracks": deepcopy(previous),
    }
    stored = deepcopy(path)
    plans, writes = [], []

    def update(path_id, user_id, tracks, *, generation_metadata, waypoints):
        writes.append((path_id, user_id, tracks))
        stored["tracks"] = deepcopy(tracks)
        stored["waypoints"] = deepcopy(waypoints)
        stored.update(deepcopy(generation_metadata))
        return True

    monkeypatch.setattr(
        service, "get_music_path", lambda path_id, user_id, **kwargs: deepcopy(stored)
    )
    monkeypatch.setattr(
        service,
        "build_music_path_plan",
        lambda *args, **kwargs: (
            plans.append(kwargs) or {"tracks": replacement, "resolved_waypoints": []}
        ),
    )
    monkeypatch.setattr(service, "update_music_path_tracks", update)

    result = service.regenerate_music_path(3, 1)

    assert plans[0]["previous_tracks"] == previous
    assert writes == [(3, 1, replacement)]
    assert result["tracks"] == replacement
    assert path["tracks"] == previous


def test_acoustic_explicit_track_anchors_are_exempt_from_cooldown(monkeypatch):
    origin, destination, heard, fresh = _row(1), _row(9), _row(2), _row(3)
    _install_builder(monkeypatch, origin, destination, [heard, fresh])

    path = acoustic.compute_path(
        "track",
        "1",
        origin["bliss_vector"],
        "track",
        "9",
        destination["bliss_vector"],
        3,
        selection_seed="fixed",
        recent_song_keys=_keys(origin, destination, heard),
        previous_song_keys=set(),
    )

    assert [track["track_id"] for track in path] == [
        origin["id"],
        fresh["id"],
        destination["id"],
    ]


def test_saved_path_reads_are_stable_and_never_regenerate_or_read_history(monkeypatch):
    from crate.db import paths_service_reads as reads

    tracks = [{"track_id": 1, "artist": "Start Artist", "title": "Saved"}]
    row = {
        "id": 3,
        "name": "Saved path",
        "origin_type": "genre",
        "origin_value": "punk",
        "origin_label": "Punk",
        "dest_type": "genre",
        "dest_value": "post-hardcore",
        "dest_label": "Post-hardcore",
        "waypoints": [],
        "step_count": 5,
        "created_at": NOW,
        "updated_at": NOW,
        "tracks": tracks,
    }
    calls = []

    def fetch(path_id, user_id):
        calls.append((path_id, user_id))
        return deepcopy(row) if user_id == 1 else None

    def forbid_planning(*args, **kwargs):
        raise AssertionError("Saved path reads must preserve persisted selection")

    monkeypatch.setattr(reads, "get_music_path_row", fetch)
    monkeypatch.setattr(service, "build_music_path_plan", forbid_planning)
    monkeypatch.setattr(
        service, "history_for_candidates", forbid_planning, raising=False
    )

    first, replay = reads.get_music_path(3, 1), reads.get_music_path(3, 1)

    assert first == replay
    assert first["tracks"] == tracks
    assert reads.get_music_path(3, 2) is None
    assert calls == [(3, 1), (3, 1), (3, 2)]


@pytest.fixture
def compilation_rotation_catalog(pg_db):
    from sqlalchemy import text
    from crate.db.tx import transaction_scope
    from crate.db.bliss_vectors import to_pgvector_literal
    from tests.test_recommendation_history import _events

    owner, performer = "Compilation Owner", "Actual Performer"
    for name in (owner, performer, "Finish Performer"):
        pg_db.upsert_artist({"name": name})
    pg_db.set_artist_genres(owner, [("punk", 0.98, "test")])
    source_album = pg_db.upsert_album(
        {"artist": owner, "name": "Compilation", "path": "/music/path-source"}
    )
    finish_album = pg_db.upsert_album(
        {"artist": "Finish Performer", "name": "Finish", "path": "/music/path-finish"}
    )
    vector = [1.0] + [0.0] * 19
    with transaction_scope() as session:
        rows = []
        for title, album, artist, probe in (
            ("Heard", source_album, performer, vector),
            ("Fresh", source_album, performer, [0.999, 0.01] + [0.0] * 18),
            ("Finish", finish_album, "Finish Performer", vector),
        ):
            track_id = session.execute(
                text("""
                INSERT INTO library_tracks(album_id, artist, album, filename, title, path,
                    duration, bliss_vector, bliss_embedding)
                VALUES (:album, :artist, 'Album', :filename, :title, :path, 180,
                    CAST(:vector AS double precision[]), CAST(:embedding AS vector(20)))
                RETURNING id
            """),
                {
                    "album": album,
                    "artist": artist,
                    "filename": title + ".flac",
                    "title": title,
                    "path": f"/music/path/{title}.flac",
                    "vector": probe,
                    "embedding": to_pgvector_literal(probe),
                },
            ).scalar_one()
            rows.append({"id": track_id, "title": title, "artist": artist})
    _events({"track_id": rows[0]["id"], "artist": performer, "title": "Heard"})
    return source_album, rows, vector


@pytest.mark.parametrize("candidate_kind", ["artist_anchor", "genre_pool"])
def test_compilation_candidates_use_actual_identity_for_significant_recency(
    compilation_rotation_catalog, candidate_kind
):
    from crate.db.queries.paths_scene_queries import (
        list_artist_scene_anchor_candidates,
        list_scene_path_candidates,
    )
    from crate.db.queries.recommendation_history import history_for_candidates

    _album, tracks, _vector = compilation_rotation_catalog
    recent = set(history_for_candidates(1, None, NOW - timedelta(days=7), now=NOW))
    rows = (
        list_artist_scene_anchor_candidates("Compilation Owner", user_id=1)
        if candidate_kind == "artist_anchor"
        else list_scene_path_candidates(["punk"], user_id=1)["punk"]
    )
    by_id = {row["id"]: row for row in rows}
    heard, fresh = by_id[tracks[0]["id"]], by_id[tracks[1]["id"]]
    assert heard["artist"] == "Actual Performer"
    assert heard["album_artist"] == "Compilation Owner"
    assert track_song_identity(heard) in recent
    selected = scene._select_artist_track(
        [heard, fresh],
        previous_track=None,
        selection_seed="fixed",
        recent_song_keys=recent,
    )
    assert selected["id"] == fresh["id"]


def test_flexible_acoustic_anchor_rotates_while_explicit_track_is_preserved(
    compilation_rotation_catalog, monkeypatch
):
    album, tracks, vector = compilation_rotation_catalog
    monkeypatch.setattr(acoustic, "_load_artist_similarity_graph", lambda **_kwargs: {})
    monkeypatch.setattr(acoustic, "_load_shared_members_graph", lambda **_kwargs: {})
    monkeypatch.setattr(acoustic, "_load_artist_genres", lambda **_kwargs: {})
    path = acoustic.compute_path(
        "album",
        str(album),
        vector,
        "track",
        str(tracks[2]["id"]),
        vector,
        2,
        endpoint_contexts=[],
        selection_seed="fixed",
        recent_song_keys=_keys(tracks[0], tracks[2]),
    )
    assert [row["track_id"] for row in path] == [tracks[1]["id"], tracks[2]["id"]]


def test_acoustic_search_expands_a_cooled_prefix_before_recovering_recent_songs(
    monkeypatch,
):
    from crate.db import paths_candidates

    rows = [_row(index) for index in range(1, 17)]
    calls = []

    def fetch(target, excluded, *, limit, **kwargs):
        calls.append(limit)
        return deepcopy([row for row in rows if row["id"] not in excluded][:limit])

    monkeypatch.setattr(paths_candidates, "find_candidate_rows", fetch)
    selected = paths_candidates._find_best_candidate(
        [0.2] * 20,
        set(),
        set(),
        [],
        {},
        {},
        {},
        [],
        recent_song_keys=_keys(*rows[:15]),
        selection_seed="fixed",
    )
    assert selected is not None
    assert selected["id"] == 16
    assert 1 < len(calls) <= 3
    assert max(calls) <= 240


def test_familiarity_repeat_discount_does_not_hide_an_equivalent_fresh_artist():
    favorite = _song(
        1, artist="Heard Artist", artist_popularity_score=0.95, user_play_count=20
    )
    fresh = _song(2, artist="Fresh Artist", artist_popularity_score=0.95)
    selected = scene._select_track_for_genre(
        "punk",
        [favorite, fresh],
        used_ids=set(),
        used_artists={"heard artist": 1, "fresh artist": 1},
        is_anchor=False,
        recent_song_keys=_keys(favorite),
        selection_seed="fixed",
    )
    assert selected is not None
    assert selected["id"] == fresh["id"]


@pytest.mark.parametrize("fallback", [False, True])
def test_regeneration_relegates_ids_from_old_or_renamed_track_metadata(
    monkeypatch, fallback
):
    favorite, fresh = _favorite_pair()
    legacy = {
        "track_id": favorite["id"],
        "artist": "Old Album Owner",
        "title": "Old Favorite Title",
    }
    _planning_fakes(monkeypatch, fallback=fallback)
    monkeypatch.setattr(service, "history_for_candidates", lambda *args, **kwargs: {})

    def select(**kwargs):
        return scene._select_artist_track(
            [favorite, fresh],
            previous_track=None,
            selection_seed=kwargs.get("selection_seed"),
            previous_song_keys=kwargs.get("previous_song_keys"),
            previous_track_ids=kwargs.get("previous_track_ids"),
        )

    if fallback:
        monkeypatch.setattr(
            service, "compute_path", lambda *args, **kwargs: [select(**kwargs)]
        )
    else:
        monkeypatch.setattr(
            service, "compute_scene_path", lambda **kwargs: [select(**kwargs)]
        )

    plan = service.build_music_path_plan(
        "genre",
        "punk",
        "genre",
        "post-hardcore",
        user_id=7,
        selection_seed="fixed",
        now=NOW,
        previous_tracks=[legacy],
    )

    assert plan is not None
    assert plan["tracks"][0]["id"] == fresh["id"]


def test_acoustic_middle_track_relegates_previous_ids_with_renamed_metadata(
    monkeypatch,
):
    origin, destination, previous, fresh = _row(1), _row(9), _row(2), _row(3)
    _install_builder(monkeypatch, origin, destination, [previous, fresh])
    path = acoustic.compute_path(
        "track",
        "1",
        origin["bliss_vector"],
        "track",
        "9",
        destination["bliss_vector"],
        3,
        previous_song_keys={("old album owner", "old favorite title")},
        previous_track_ids={origin["id"], previous["id"], destination["id"]},
    )
    assert [row["track_id"] for row in path] == [1, 3, 9]


def test_flexible_anchor_relegates_previous_ids_with_renamed_metadata(
    compilation_rotation_catalog, monkeypatch
):
    album, tracks, vector = compilation_rotation_catalog
    monkeypatch.setattr(acoustic, "_load_artist_similarity_graph", lambda **_kwargs: {})
    monkeypatch.setattr(acoustic, "_load_shared_members_graph", lambda **_kwargs: {})
    monkeypatch.setattr(acoustic, "_load_artist_genres", lambda **_kwargs: {})
    path = acoustic.compute_path(
        "album",
        str(album),
        vector,
        "track",
        str(tracks[2]["id"]),
        vector,
        2,
        endpoint_contexts=[],
        previous_song_keys={("compilation owner", "heard")},
        previous_track_ids={tracks[0]["id"], tracks[2]["id"]},
    )
    assert [row["track_id"] for row in path] == [tracks[1]["id"], tracks[2]["id"]]


def test_previous_track_ids_are_recoverable_if_no_comparable_fresh_song_exists():
    favorite = _song(1, user_play_count=20, track_popularity_score=1.0)
    weak = _song(2, track_popularity_score=0.05, membership_score=0.7)
    selected = scene._select_artist_track(
        [favorite, weak],
        previous_track=None,
        selection_seed="fixed",
        previous_track_ids={favorite["id"]},
    )
    assert selected["id"] == favorite["id"]

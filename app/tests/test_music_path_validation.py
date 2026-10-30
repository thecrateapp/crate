from copy import deepcopy
from importlib import import_module

import pytest

from crate import music_paths as service
from crate.db.paths_llm_refinement import MusicPathReplacement, _apply_replacements
from crate.db.paths_service_reads import get_music_path
from crate.track_versions import track_song_identity


def _track(index, *, artist=None, title=None, **signals):
    return {
        "id": index,
        "entity_uid": f"00000000-0000-4000-8000-{index:012d}",
        "artist": artist or f"Artist {index}",
        "title": title or f"Song {index}",
        "album": "Album",
        "album_id": 100 + index,
        "album_entity_uid": f"10000000-0000-4000-8000-{index:012d}",
        "path": f"/music/path-validation/{index}.flac",
        "duration": 180.0,
        "genre_slug": "punk",
        "path_genre": "punk",
        "membership_score": 1.0,
        "track_popularity_score": 0.7,
        "artist_popularity_score": 0.7,
        "bliss_vector": [1.0] + [0.0] * 19,
        "bpm": 100.0,
        "audio_key": "C",
        "audio_scale": "major",
        "energy": 0.2,
        "year": "2000",
        "playable": True,
        "distance": 0.0,
        **signals,
    }


@pytest.fixture
def path_tracks():
    return [
        _track(
            1,
            artist="Origin Artist",
            title="Start",
            album_artist="Origin Owner",
            progress=0.0,
        ),
        _track(2, artist="Middle Artist", title="Middle", progress=0.5),
        _track(3, artist="Destination Artist", title="Finish", progress=1.0),
    ]


def _validation():
    return import_module("crate.music_path_validation")


def _warning_codes(report):
    return {warning["code"] for warning in report["warnings"]}


def _refine_middle(tracks, candidate, **policy):
    return _apply_replacements(
        tracks,
        [candidate],
        [
            MusicPathReplacement(
                target_track_id=tracks[1]["id"],
                replacement_track_id=candidate["id"],
                confidence=0.99,
            )
        ],
        **policy,
    )


def test_complete_path_accepts_real_endpoint_identities_without_mutating_tracks(
    path_tracks,
):
    before = deepcopy(path_tracks)
    endpoints = [
        (
            {"type": "track", "value": path_tracks[0]["entity_uid"]},
            {"type": "album", "value": path_tracks[-1]["album_entity_uid"]},
        ),
        (
            {"type": "artist", "value": "21", "artists": ["Origin Owner"]},
            {"type": "track", "value": "3"},
        ),
    ]

    for origin, destination in endpoints:
        report = _validation().validate_music_path(
            path_tracks, requested_steps=3, origin=origin, destination=destination
        )
        assert report["is_partial"] is False
        assert report["generated_step_count"] == 3
        assert report["warnings"] == []

    assert path_tracks == before


def test_missing_endpoints_are_reported_as_partial_instead_of_complete(path_tracks):
    report = _validation().validate_music_path(
        [path_tracks[1]],
        requested_steps=5,
        origin={"type": "track", "value": "1"},
        destination={"type": "track", "value": "3"},
    )

    assert report["is_partial"] is True
    assert report["generated_step_count"] == 1
    assert {
        "missing_origin",
        "missing_destination",
        "insufficient_tracks",
    } <= _warning_codes(report)


def test_generation_validation_detects_duplicate_song_families(path_tracks):
    path_tracks[1].update(artist=path_tracks[0]["artist"], title="Start (Live)")

    report = _validation().validate_music_path(path_tracks, requested_steps=3)

    assert report["is_partial"] is False
    assert "duplicate_song" in _warning_codes(report)


def test_generation_validation_detects_an_unavailable_track(path_tracks):
    path_tracks[1]["playable"] = False

    report = _validation().validate_music_path(path_tracks, requested_steps=3)

    assert report["is_partial"] is True
    assert "unavailable_track" in _warning_codes(report)


def test_generation_validation_reports_excess_tracks_without_changing_the_path(
    path_tracks,
):
    before = deepcopy(path_tracks)

    report = _validation().validate_music_path(path_tracks, requested_steps=2)

    assert report == {
        "is_partial": True,
        "generated_step_count": 3,
        "warnings": [{"code": "excess_tracks", "expected": 2, "actual": 3}],
    }
    assert path_tracks == before


def test_regeneration_retries_requested_waypoint_until_it_resolves_and_after_loss(
    pg_db, monkeypatch, path_tracks
):
    from sqlalchemy import event

    from crate.db.engine import get_engine
    from crate.db.paths_service_reads import list_music_paths
    from crate.db.queries.paths_store_queries import get_music_path_row

    requested = [{"type": "genre", "value": "missing-guide"}]
    requested_with_label = [{**requested[0], "label": "Old presentation label"}]
    stored_tracks = [{**track, "track_id": track["id"]} for track in path_tracks]
    guide_available = False
    planning_calls = []

    def centroid(kind, value):
        if value == "missing-guide" and not guide_available:
            return None
        return [1.0] + [0.0] * 19

    def compute(*args, diagnostics, **kwargs):
        diagnostics.update(origin_track_id=1, destination_track_id=3)
        planning_calls.append(deepcopy(kwargs))
        return deepcopy(stored_tracks)

    monkeypatch.setattr(service, "resolve_bliss_centroid", centroid)
    monkeypatch.setattr(service, "resolve_endpoint_label", lambda kind, value: value)
    monkeypatch.setattr(service, "history_for_candidates", lambda *a, **k: {})
    monkeypatch.setattr(
        service, "load_endpoint_contexts", lambda refs: [{"artists": []}] * len(refs)
    )
    monkeypatch.setattr(service, "compute_path", compute)
    monkeypatch.setattr(
        service,
        "compute_scene_path",
        lambda **kwargs: pytest.fail("Requested guides must not silently disappear"),
    )

    created = service.create_music_path(
        1,
        "Unresolved guide",
        "track",
        "1",
        "track",
        "3",
        waypoints=requested_with_label,
        step_count=3,
    )
    assert created is not None
    assert created["is_partial"] is True
    assert created["waypoints"] == []
    assert _warning_codes(created) == {"unresolved_waypoint"}
    row = get_music_path_row(created["id"], 1)
    assert row["generation_metadata"]["requested_waypoints"] == requested

    saved, replay = get_music_path(created["id"], 1), get_music_path(created["id"], 1)
    assert saved == replay
    assert saved["is_partial"] is True
    assert saved["waypoints"] == []
    assert len(planning_calls) == 1

    reads = []

    def observe(_conn, _cursor, statement, _params, _context, _many):
        if statement.lstrip().upper().startswith(("SELECT", "WITH")):
            reads.append((statement, dict(_params)))

    engine = get_engine()
    event.listen(engine, "before_cursor_execute", observe)
    try:
        retried = service.regenerate_music_path(created["id"], 1)
    finally:
        event.remove(engine, "before_cursor_execute", observe)
    assert len(reads) == 2, (
        "Load the saved plan, then reload availability after the write"
    )
    assert reads[0][0] == reads[1][0]
    assert "FROM music_paths" in reads[0][0]
    assert all(
        params["id"] == created["id"] and params["user_id"] == 1
        for _statement, params in reads
    )
    assert retried["is_partial"] is True
    assert _warning_codes(retried) == {"unresolved_waypoint"}
    assert retried["waypoints"] == []
    assert len(planning_calls) == 2

    guide_available = True
    recovered = service.regenerate_music_path(created["id"], 1)
    assert recovered["is_partial"] is False
    assert recovered["warnings"] == []
    assert recovered["waypoints"] == [{**requested[0], "label": "missing-guide"}]
    assert get_music_path(created["id"], 1)["waypoints"] == recovered["waypoints"]

    guide_available = False
    unavailable_again = service.regenerate_music_path(created["id"], 1)
    assert unavailable_again["is_partial"] is True
    assert _warning_codes(unavailable_again) == {"unresolved_waypoint"}
    assert unavailable_again["waypoints"] == []
    assert get_music_path(created["id"], 1)["waypoints"] == []
    assert (
        get_music_path_row(created["id"], 1)["generation_metadata"][
            "requested_waypoints"
        ]
        == requested
    )

    preview = service.preview_music_path(
        "track", "1", "track", "3", waypoints=requested, step_count=3
    )
    for payload in (
        created,
        saved,
        replay,
        retried,
        recovered,
        unavailable_again,
        preview,
        list_music_paths(1)[0],
    ):
        assert "requested_waypoints" not in payload
        assert "_requested_waypoints" not in payload
        assert "generation_metadata" not in payload
    count = len(planning_calls)
    assert service.regenerate_music_path(created["id"], 2) is None
    assert get_music_path(created["id"], 2, for_regeneration=True) is None
    assert len(planning_calls) == count


@pytest.mark.parametrize("requested_steps", [2, 3])
def test_legacy_regeneration_retains_existing_resolved_waypoint_references(
    pg_db, monkeypatch, path_tracks, requested_steps
):
    from crate.db.paths_service_reads import list_music_paths
    from crate.db.repositories.paths import create_music_path_record

    waypoint = {"type": "genre", "value": "punk", "label": "Punk"}
    row = create_music_path_record(
        user_id=1,
        name="Legacy guides",
        origin_type="track",
        origin_value="1",
        origin_label="Start",
        dest_type="track",
        dest_value="3",
        dest_label="Finish",
        waypoints=[waypoint],
        step_count=requested_steps,
        tracks=[{**track, "track_id": track["id"]} for track in path_tracks],
    )
    saved, summary = get_music_path(row["id"], 1), list_music_paths(1)[0]
    expected = _validation().validate_music_path(
        path_tracks, requested_steps=requested_steps
    )
    for payload in (saved, summary):
        assert {key: payload[key] for key in expected} == expected
    calls = []

    def build(*args, **kwargs):
        calls.append(kwargs)
        return {
            "tracks": path_tracks,
            "resolved_waypoints": [waypoint],
            **expected,
        }

    monkeypatch.setattr(service, "build_music_path_plan", build)

    regenerated = service.regenerate_music_path(row["id"], 1)

    assert calls[0]["waypoints"] == [{"type": "genre", "value": "punk"}]
    assert regenerated["waypoints"] == [waypoint]
    assert "_requested_waypoints" not in regenerated


def test_generation_validation_warns_about_progress_without_marking_a_complete_path_partial(
    path_tracks,
):
    path_tracks[1]["progress"] = 1.2

    report = _validation().validate_music_path(path_tracks, requested_steps=3)

    assert report["is_partial"] is False
    assert "invalid_progress" in _warning_codes(report)


def test_missing_and_reordered_waypoint_guides_are_reported(path_tracks):
    first = {"type": "genre", "value": "punk"}
    second = {"type": "genre", "value": "post-hardcore"}
    unresolved = {"type": "genre", "value": "folk"}

    report = _validation().validate_music_path(
        path_tracks,
        requested_steps=3,
        requested_waypoints=[first, second, unresolved],
        resolved_waypoints=[second, first],
    )

    assert report["is_partial"] is True
    assert {"unresolved_waypoint", "invalid_waypoint_order"} <= _warning_codes(report)


def test_an_improving_replacement_is_allowed_only_between_the_anchors(path_tracks):
    path_tracks[1].update(bpm=180.0, audio_key="F#", audio_scale="minor", energy=0.95)
    candidate = _track(4, artist="Better Artist", title="Better Transition")
    before = deepcopy(path_tracks)
    can_replace = _validation().can_replace_path_track

    assert can_replace(path_tracks, 1, candidate) is True
    assert can_replace(path_tracks, 0, candidate) is False
    assert can_replace(path_tracks, len(path_tracks) - 1, candidate) is False
    assert path_tracks == before


def test_refinement_cannot_improve_previous_transition_by_worsening_destination(
    path_tracks,
):
    path_tracks[0].update(bpm=100.0, energy=0.0)
    path_tracks[1].update(bpm=180.0, energy=0.2)
    path_tracks[2].update(bpm=250.0, energy=0.2)
    candidate = _track(
        4,
        artist="Alternative Artist",
        title="Wrong Destination Bridge",
        bpm=110.0,
        energy=0.3,
    )
    before = deepcopy(path_tracks)

    refined = _refine_middle(path_tracks, candidate)

    assert refined == before
    assert path_tracks == before


def test_equivalent_quality_does_not_justify_replacing_the_deterministic_track(
    path_tracks,
):
    candidate = _track(4, artist="Equivalent Artist", title="Equivalent Transition")

    assert _refine_middle(path_tracks, candidate) == path_tracks


@pytest.mark.parametrize("violation", ["family", "scene", "unavailable"])
def test_refinement_keeps_original_when_a_candidate_breaks_a_hard_constraint(
    path_tracks, violation
):
    path_tracks[1].update(bpm=180.0)
    candidate = _track(6, artist="Replacement Artist", title="Good Audio")
    if violation == "family":
        path_tracks = [
            path_tracks[0],
            path_tracks[1],
            _track(3, artist="Bridge Artist", progress=0.5),
            _track(4, artist="Echo Artist", title="Echo", progress=0.75),
            _track(5, artist="Destination Artist", title="Finish", progress=1.0),
        ]
        candidate.update(artist="Echo Artist", title="Echo (Live)")
    elif violation == "scene":
        candidate.update(genre_slug="electronic", path_genre="electronic")
    else:
        candidate["playable"] = False
    before = deepcopy(path_tracks)

    refined = _refine_middle(path_tracks, candidate)

    assert refined == before
    assert path_tracks == before


@pytest.mark.parametrize("preference", ["recent", "previous"])
def test_refinement_does_not_reintroduce_an_equivalent_recent_or_previous_song(
    path_tracks, preference
):
    path_tracks[1]["bpm"] = 102.0
    candidate = _track(4, artist="Heard Artist", title="Heard Transition")
    key = track_song_identity(candidate)
    recent = {key} if preference == "recent" else set()
    previous = {key} if preference == "previous" else set()
    original_recent, original_previous = set(recent), set(previous)

    refined = _refine_middle(
        path_tracks, candidate, recent_song_keys=recent, previous_song_keys=previous
    )

    assert refined == path_tracks
    assert recent == original_recent
    assert previous == original_previous


def test_partial_generation_metadata_survives_saved_read_without_replanning(
    pg_db, monkeypatch, path_tracks
):
    stored_tracks = []
    for row in (path_tracks[0], path_tracks[-1]):
        stored = deepcopy(row)
        stored["track_id"] = stored.pop("id")
        stored_tracks.append(stored)
    metadata = {
        "is_partial": True,
        "generated_step_count": 2,
        "warnings": [{"code": "insufficient_tracks", "expected": 20, "actual": 2}],
    }
    plan = {
        "origin_label": "Origin",
        "dest_label": "Destination",
        "resolved_waypoints": [],
        "tracks": stored_tracks,
        **metadata,
    }
    monkeypatch.setattr(
        service, "build_music_path_plan", lambda *a, **k: deepcopy(plan)
    )

    created = service.create_music_path(
        1, "Partial path", "track", "1", "track", "3", step_count=20
    )

    assert created is not None
    assert {key: created.get(key) for key in metadata} == metadata

    def forbid_planning(*args, **kwargs):
        raise AssertionError(
            "Reading a saved Path must not plan or read listen history"
        )

    monkeypatch.setattr(service, "build_music_path_plan", forbid_planning)
    monkeypatch.setattr(service, "compute_scene_path", forbid_planning)
    monkeypatch.setattr(service, "compute_path", forbid_planning)
    monkeypatch.setattr(service, "history_for_candidates", forbid_planning)

    saved = get_music_path(created["id"], 1)
    replay = get_music_path(created["id"], 1)

    assert saved is not None
    assert replay is not None
    assert {key: saved.get(key) for key in metadata} == metadata
    assert {key: replay.get(key) for key in metadata} == metadata
    assert [track["track_id"] for track in saved["tracks"]] == [1, 3]
    assert [track["track_id"] for track in replay["tracks"]] == [1, 3]
    assert get_music_path(created["id"], 2) is None


def test_mixed_acoustic_genre_endpoint_uses_reserved_anchor_identity(monkeypatch):
    from crate.db import paths_path_builder as builder

    origin = _track(1, artist="Compilation Performer")
    origin.pop("genre_slug")
    origin.pop("path_genre")
    destination = _track(3, artist="Destination Artist")
    middle = _track(2, artist="Bridge Artist")
    for name in (
        "_load_artist_similarity_graph",
        "_load_artist_genres",
        "_load_shared_members_graph",
    ):
        monkeypatch.setattr(builder, name, lambda **_kwargs: {})
    monkeypatch.setattr(
        builder, "_resolve_path_anchors", lambda *a, **k: (origin, destination)
    )
    monkeypatch.setattr(builder, "_find_best_candidate", lambda *a, **k: middle)
    monkeypatch.setattr(service, "compute_scene_path", lambda **k: None)
    monkeypatch.setattr(service, "compute_path", builder.compute_path)
    monkeypatch.setattr(service, "resolve_endpoint_label", lambda kind, value: value)
    monkeypatch.setattr(service, "resolve_bliss_centroid", lambda *a: [0.1] * 20)
    monkeypatch.setattr(
        service,
        "load_endpoint_contexts",
        lambda endpoints: [
            {"artists": [], "genre_weights": {"punk": 1.0}},
            {"artists": ["Destination Artist"], "genre_weights": {}},
        ],
    )

    plan = service.build_music_path_plan("genre", "punk", "artist", "3", step_count=3)

    assert [track["track_id"] for track in plan["tracks"]] == [1, 2, 3]
    assert plan["warnings"] == []
    assert plan["is_partial"] is False


@pytest.mark.parametrize("resolved_id", [1, None])
def test_resolved_flexible_anchor_must_still_occupy_the_endpoint(
    path_tracks, resolved_id
):
    report = _validation().validate_music_path(
        path_tracks[1:],
        requested_steps=2,
        origin={"type": "genre", "value": "punk", "resolved_track_id": resolved_id},
        destination={"type": "track", "value": "3"},
    )

    assert "missing_origin" in _warning_codes(report)


@pytest.mark.parametrize("neighbor_index", [0, 2, 4])
@pytest.mark.parametrize("signal", ["similarity", "shared_members"])
def test_refinement_preserves_cultural_links_to_neighbors_and_destination(
    neighbor_index, signal
):
    tracks = [
        _track(i, artist=f"Scene Artist {i}", progress=(i - 1) / 4) for i in range(1, 6)
    ]
    tracks[1]["bpm"] = 180.0
    candidate = _track(8, artist="Unrelated Artist")
    neighbor_key = tracks[neighbor_index]["artist"].casefold()
    original_key = tracks[1]["artist"].casefold()
    context = {
        "artist_similarity_graph": {neighbor_key: {original_key: 0.9}}
        if signal == "similarity"
        else {},
        "shared_members_graph": {neighbor_key: {original_key}}
        if signal == "shared_members"
        else {},
    }

    refined = _refine_middle(tracks, candidate, validation_context=context)

    assert refined == tracks


def test_a_strict_cultural_improvement_can_refine_an_equal_audio_transition(
    path_tracks,
):
    candidate = _track(4, artist="Connected Artist")
    context = {
        "artist_similarity_graph": {
            path_tracks[0]["artist"].casefold(): {"connected artist": 0.9}
        },
        "shared_members_graph": {},
    }

    refined = _refine_middle(path_tracks, candidate, validation_context=context)

    assert [track["id"] for track in refined] == [1, 4, 3]


@pytest.mark.parametrize("previous_marker", ["id", "family"])
@pytest.mark.parametrize("recent_candidate", [True, False])
def test_refinement_keeps_listened_songs_below_unheard_previous_generation(
    path_tracks, previous_marker, recent_candidate
):
    path_tracks[1]["bpm"] = 102.0
    candidate = _track(4, artist="Alternative Artist")
    heard, previous = (
        (candidate, path_tracks[1]) if recent_candidate else (path_tracks[1], candidate)
    )
    policy = {
        "recent_song_keys": {track_song_identity(heard)},
        "previous_song_keys": {track_song_identity(previous)}
        if previous_marker == "family"
        else set(),
        "previous_track_ids": {previous["id"]} if previous_marker == "id" else set(),
    }

    result = _refine_middle(path_tracks, candidate, **policy)

    assert [track["id"] for track in result] == (
        [1, 2, 3] if recent_candidate else [1, 4, 3]
    )


def test_substantially_better_transition_can_use_recent_song_outside_quality_band(
    path_tracks,
):
    path_tracks[1].update(bpm=180.0, audio_key="F#", audio_scale="minor", energy=0.95)
    candidate = _track(4, artist="Better Transition")

    result = _refine_middle(
        path_tracks,
        candidate,
        recent_song_keys={track_song_identity(candidate)},
        previous_track_ids={path_tracks[1]["id"]},
    )

    assert [track["id"] for track in result] == [1, 4, 3]


@pytest.mark.parametrize("alias_side", ["origin", "destination"])
def test_scene_genre_alias_uses_resolved_slug_without_changing_public_ref(
    monkeypatch, alias_side
):
    from crate.db import paths_scene as scene
    from crate.db.queries import paths_scene_queries as queries
    from crate import genre_taxonomy

    origin = "electronica" if alias_side == "origin" else "punk"
    destination = "electronica" if alias_side == "destination" else "punk"
    route = [
        "electronic" if value == "electronica" else value
        for value in (origin, destination)
    ]
    tracks = [
        _track(1, genre_slug=route[0]),
        _track(2, genre_slug=route[0]),
        _track(3, genre_slug=route[-1]),
    ]
    for track in tracks:
        track.pop("path_genre")
    monkeypatch.setattr(scene, "build_scene_genre_route", lambda *args: route)
    monkeypatch.setattr(
        scene, "build_scene_path_from_candidates", lambda *a, **k: tracks
    )
    monkeypatch.setattr(scene, "load_artist_radio_graphs", lambda: ({}, {}, {}))
    monkeypatch.setattr(queries, "list_scene_path_candidates", lambda *a, **k: {})
    monkeypatch.setattr(service, "resolve_endpoint_label", lambda kind, value: value)
    monkeypatch.setattr(
        service, "refine_music_path_with_llm", lambda **kwargs: kwargs["tracks"]
    )
    monkeypatch.setattr(
        genre_taxonomy,
        "get_genre_catalog",
        lambda: pytest.fail("Validation must not query taxonomy again"),
    )

    result = service.preview_music_path(
        "genre", origin, "genre", destination, step_count=3
    )

    assert result["origin"]["value"] == origin
    assert result["destination"]["value"] == destination
    assert result["warnings"] == []
    assert result["is_partial"] is False


def test_refinement_rejects_variants_blocked_by_scene_generation(path_tracks):
    from crate.db.paths_scene import _is_blocked_variant

    path_tracks[1].update(bpm=180.0, track_popularity_score=0.01)
    candidate = _track(
        4, artist="Fresh Artist", title="Fresh Song (Live)", track_popularity_score=1.0
    )
    assert _is_blocked_variant(candidate) is True

    assert _refine_middle(path_tracks, candidate) == path_tracks


@pytest.mark.parametrize("membership", [None, 0.45, 0.59])
def test_refinement_rejects_membership_below_scene_selection_floor(
    path_tracks, membership
):
    path_tracks[1].update(bpm=180.0, track_popularity_score=0.01)
    candidate = _track(
        4,
        artist="Fresh Artist",
        membership_score=membership,
        track_popularity_score=1.0,
    )

    assert _refine_middle(path_tracks, candidate) == path_tracks


def test_refinement_accepts_the_existing_scene_membership_floor(path_tracks):
    path_tracks[1].update(bpm=180.0, track_popularity_score=0.01)
    candidate = _track(
        4, artist="Fresh Artist", membership_score=0.60, track_popularity_score=1.0
    )

    assert [track["id"] for track in _refine_middle(path_tracks, candidate)] == [
        1,
        4,
        3,
    ]


def test_refinement_cannot_add_a_third_nonadjacent_song_by_one_artist():
    tracks = [_track(i, progress=(i - 1) / 7) for i in range(1, 9)]
    tracks[1]["artist"] = tracks[5]["artist"] = "Repeated Artist"
    tracks[3].update(bpm=180.0, track_popularity_score=0.01)
    candidate = _track(99, artist="Repeated Artist", track_popularity_score=1.0)
    policy = {"validation_context": {"max_repeat_per_artist": 2}}

    output = _apply_replacements(
        tracks,
        [candidate],
        [
            MusicPathReplacement(
                target_track_id=4, replacement_track_id=99, confidence=0.99
            )
        ],
        **policy,
    )

    assert output == tracks


@pytest.mark.parametrize("with_scene_cap", [True, False])
def test_generation_validation_reports_nonadjacent_artist_repeat_limit_only_for_scene(
    with_scene_cap,
):
    tracks = [_track(i, progress=(i - 1) / 7) for i in range(1, 9)]
    for index in (1, 3, 5):
        tracks[index]["artist"] = "Repeated Artist"

    policy = {"max_repeat_per_artist": 2} if with_scene_cap else {}
    report = _validation().validate_music_path(tracks, requested_steps=8, **policy)

    assert report["is_partial"] is False
    assert ("artist_repeat_limit" in _warning_codes(report)) is with_scene_cap


def test_refinement_preserves_an_already_allowed_second_artist_appearance():
    tracks = [_track(i, progress=(i - 1) / 7) for i in range(1, 9)]
    tracks[1]["artist"] = tracks[3]["artist"] = "Repeated Artist"
    tracks[3].update(bpm=180.0, track_popularity_score=0.01)
    candidate = _track(99, artist="Repeated Artist", track_popularity_score=1.0)

    output = _apply_replacements(
        tracks,
        [candidate],
        [
            MusicPathReplacement(
                target_track_id=4, replacement_track_id=99, confidence=0.99
            )
        ],
        validation_context={"max_repeat_per_artist": 2},
    )

    assert output[3]["id"] == 99
    assert sum(track["artist"] == "Repeated Artist" for track in output) == 2

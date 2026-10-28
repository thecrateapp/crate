from copy import deepcopy
from uuid import uuid4

import pytest
from sqlalchemy import text

from crate.db import paths_candidates as candidates
from crate.db import paths_path_builder as builder
from crate.db.queries.paths_bliss_candidate_queries import find_anchor_track_row
from crate.db.tx import read_scope, transaction_scope
from crate.track_versions import track_song_identity


def _row(index, *, artist=None, title=None, vector=None, **signals):
    return {
        "id": index,
        "artist": artist or f"Artist {index}",
        "title": title or f"Song {index}",
        "album": "Album",
        "duration": 180.0,
        "bliss_vector": vector or [0.2] * 20,
        "distance": 0.0,
        "bpm": 100.0,
        "audio_key": "C",
        "audio_scale": "major",
        "energy": 0.2,
        "year": "1980",
        **signals,
    }


def _install_builder(monkeypatch, origin, destination, rows):
    def anchor(kind, value, target, exclude, **kwargs):
        track = {str(origin["id"]): origin, str(destination["id"]): destination}.get(
            value
        )
        return deepcopy(track) if track and track["id"] not in exclude else None

    def fetch(target, exclude_ids, *, limit, **kwargs):
        return deepcopy([row for row in rows if row["id"] not in exclude_ids][:limit])

    monkeypatch.setattr(builder, "_find_anchor_track", anchor)
    monkeypatch.setattr(builder, "_load_artist_similarity_graph", lambda: {})
    monkeypatch.setattr(builder, "_load_shared_members_graph", lambda: {})
    monkeypatch.setattr(builder, "_load_artist_genres", lambda: {})
    monkeypatch.setattr(
        builder,
        "load_endpoint_contexts",
        lambda endpoints, **kwargs: [
            {"artists": [row["artist"]], "genre_weights": {}, "genre_signals": []}
            for row in (origin, destination)
        ],
    )
    monkeypatch.setattr(candidates, "find_candidate_rows", fetch)


def _path(origin, destination, *, count=5, waypoints=None):
    return builder.compute_path(
        "track",
        str(origin["id"]),
        origin["bliss_vector"],
        "track",
        str(destination["id"]),
        destination["bliss_vector"],
        count,
        waypoints,
    )


@pytest.mark.parametrize(
    "signal,wrong_value",
    [("bpm", 180.0), ("audio_key", "F#"), ("energy", 0.95), ("year", "2020")],
)
def test_origin_audio_context_changes_the_first_transition(
    monkeypatch, signal, wrong_value
):
    origin, destination = _row(1), _row(9)
    wrong = _row(2, **{signal: wrong_value})
    coherent = _row(3)
    _install_builder(monkeypatch, origin, destination, [wrong, coherent])

    path = _path(origin, destination)

    assert path[1]["track_id"] == coherent["id"]


def test_each_transition_uses_the_previously_selected_track(monkeypatch):
    origin, destination = _row(1), _row(9)
    first = _row(2, bpm=160.0)
    wrong = _row(3, bpm=100.0)
    coherent = _row(4, bpm=160.0)
    _install_builder(monkeypatch, origin, destination, [])

    def fetch(target, exclude_ids, *, limit, **kwargs):
        rows = [first] if first["id"] not in exclude_ids else [wrong, coherent]
        return deepcopy([row for row in rows if row["id"] not in exclude_ids][:limit])

    monkeypatch.setattr(candidates, "find_candidate_rows", fetch)

    path = _path(origin, destination)

    assert [row["track_id"] for row in path[1:3]] == [first["id"], coherent["id"]]


def test_destination_is_reserved_before_selecting_middle_tracks(monkeypatch):
    origin, destination = _row(1), _row(2)
    _install_builder(
        monkeypatch, origin, destination, [destination, _row(3), _row(4), _row(5)]
    )

    path = _path(origin, destination)

    assert path[-1]["track_id"] == destination["id"]
    assert path[-1]["progress"] == 1.0
    assert sum(row["track_id"] == destination["id"] for row in path) == 1


@pytest.mark.parametrize("reserved_endpoint", ["origin", "destination"])
def test_reserved_song_families_cannot_reappear_as_middle_versions(
    monkeypatch, reserved_endpoint
):
    origin = _row(1, title="Origin")
    destination = _row(2, title="Destination")
    anchor = origin if reserved_endpoint == "origin" else destination
    variant = _row(3, artist=anchor["artist"], title=f"{anchor['title']} (Live)")
    fresh = _row(4, vector=[-0.2] * 20)
    _install_builder(monkeypatch, origin, destination, [variant, fresh])

    path = _path(origin, destination)
    families = [track_song_identity(row) for row in path]

    assert len(families) == len(set(families))
    assert variant["id"] not in [row["track_id"] for row in path]
    assert path[0]["track_id"] == origin["id"]
    assert path[-1]["track_id"] == destination["id"]


def test_candidate_search_expands_past_an_ineligible_first_pool(monkeypatch):
    heard = [
        _row(index, artist="Heard Artist", title="Heard Song") for index in range(1, 16)
    ]
    fresh = _row(16)
    rows, calls = [*heard, fresh], []

    def fetch(target, exclude_ids, *, limit, **kwargs):
        calls.append(limit)
        return deepcopy([row for row in rows if row["id"] not in exclude_ids][:limit])

    monkeypatch.setattr(candidates, "find_candidate_rows", fetch)
    selected = candidates._find_best_candidate(
        [0.2] * 20, set(), {"heard artist::heard song"}, [], {}, {}, {}, []
    )

    assert selected is not None
    assert selected["id"] == fresh["id"]
    assert 1 < len(calls) <= 3
    assert max(calls) <= 300


def test_short_path_with_many_waypoints_keeps_requested_length(monkeypatch):
    origin, destination = _row(1), _row(2)
    _install_builder(
        monkeypatch, origin, destination, [_row(index) for index in range(10, 40)]
    )

    path = _path(
        origin,
        destination,
        count=5,
        waypoints=[[0.3 + index * 0.1] * 20 for index in range(5)],
    )

    assert len(path) == 5
    assert path[0]["track_id"] == origin["id"]
    assert path[-1]["track_id"] == destination["id"]
    assert path[-1]["progress"] == 1.0


def test_long_path_follows_waypoint_order_and_finishes_at_destination(monkeypatch):
    def axis(index):
        return [1.0 if dimension == index else 0.0 for dimension in range(20)]

    origin, destination = _row(1, vector=axis(0)), _row(2, vector=axis(3))
    _install_builder(monkeypatch, origin, destination, [])
    probes = []

    def select(target, *args, **kwargs):
        probes.append(list(target))
        return _row(100 + len(probes), vector=list(target))

    monkeypatch.setattr(builder, "_find_best_candidate", select)
    path = _path(origin, destination, count=100, waypoints=[axis(1), axis(2)])

    assert len(path) == 100
    assert path[0]["track_id"] == origin["id"]
    assert path[-1]["track_id"] == destination["id"]
    assert path[-1]["progress"] == 1.0
    assert len({track_song_identity(row) for row in path}) == 100
    assert [row["progress"] for row in path] == sorted(row["progress"] for row in path)
    first_waypoint_peak = max(range(len(probes)), key=lambda index: probes[index][1])
    second_waypoint_peak = max(range(len(probes)), key=lambda index: probes[index][2])
    assert first_waypoint_peak < second_waypoint_peak


def test_sparse_catalog_keeps_both_endpoints_without_inventing_middle_tracks(
    monkeypatch,
):
    origin, destination = _row(1), _row(2)
    _install_builder(monkeypatch, origin, destination, [destination])

    path = _path(origin, destination, count=20)

    assert [row["track_id"] for row in path] == [origin["id"], destination["id"]]
    assert [row["progress"] for row in path] == [0.0, 1.0]


def test_service_batches_resolved_waypoint_contexts_in_journey_order(monkeypatch):
    from crate import music_paths as service

    waypoints = [
        {"type": "genre", "value": "punk"},
        {"type": "artist", "value": "unresolved"},
        {"type": "album", "value": "3"},
    ]
    endpoints = [("track", "1"), ("genre", "punk"), ("album", "3"), ("album", "9")]
    contexts = [
        {"artists": [f"Endpoint {index}"], "genre_weights": {}, "genre_signals": []}
        for index in range(len(endpoints))
    ]
    loads, computations = [], []

    def load_contexts(refs):
        loads.append(deepcopy(refs))
        return deepcopy(contexts)

    def compute(*args, **kwargs):
        computations.append((args, kwargs))
        return [{"track_id": 8}]

    monkeypatch.setattr(service, "load_endpoint_contexts", load_contexts, raising=False)
    monkeypatch.setattr(
        service, "resolve_endpoint_label", lambda kind, value: f"Label {value}"
    )
    monkeypatch.setattr(
        service,
        "resolve_bliss_centroid",
        lambda kind, value: None if value == "unresolved" else [0.2] * 20,
    )
    monkeypatch.setattr(
        service,
        "compute_scene_path",
        lambda **kwargs: pytest.fail("Waypoint journey must use the acoustic builder"),
    )
    monkeypatch.setattr(service, "compute_path", compute)

    plan = service.build_music_path_plan(
        "track", "1", "album", "9", waypoints=waypoints, step_count=5
    )

    assert loads == [endpoints]
    assert len(computations) == 1
    assert computations[0][1].get("endpoint_contexts") == contexts
    assert [row["value"] for row in plan["resolved_waypoints"]] == ["punk", "3"]
    assert plan["tracks"] == [{"track_id": 8}]


def test_waypoint_segments_change_artist_and_genre_context_without_forcing_visits(
    monkeypatch,
):
    from crate.db import paths_similarity

    origin = _row(1, artist="Start Artist")
    destination = _row(2, artist="Finish Artist")
    _install_builder(monkeypatch, origin, destination, [])
    genre_map = {
        "punk candidate": {"punk": 1.0},
        "electronic candidate": {"electronic": 1.0},
    }
    contexts = [
        {"artists": ["Start Artist"], "genre_weights": {"punk": 1.0}},
        {"artists": ["Bridge Artist"], "genre_weights": {"jazz": 1.0}},
        {"artists": ["Finish Artist"], "genre_weights": {"electronic": 1.0}},
    ]
    observations = []

    def select(target, *args, **kwargs):
        artists = args[6]
        scorer = kwargs["genre_overlap"]
        observations.append(
            (
                list(artists),
                scorer("Punk Candidate", artists, genre_map),
                scorer("Electronic Candidate", artists, genre_map),
            )
        )
        return _row(100 + len(observations), vector=list(target))

    monkeypatch.setattr(builder, "_load_artist_genres", lambda: genre_map)
    monkeypatch.setattr(
        paths_similarity, "_expand_genre_weights", lambda values: values
    )
    monkeypatch.setattr(builder, "_find_best_candidate", select)
    monkeypatch.setattr(
        builder,
        "load_endpoint_contexts",
        lambda *args, **kwargs: pytest.fail(
            "Preloaded endpoint contexts must be reused"
        ),
    )

    path = builder.compute_path(
        "track",
        "1",
        origin["bliss_vector"],
        "track",
        "2",
        destination["bliss_vector"],
        7,
        [[0.3] * 20],
        endpoint_contexts=contexts,
    )

    assert set(observations[0][0]) == {"Start Artist", "Bridge Artist"}
    assert set(observations[-1][0]) == {"Bridge Artist", "Finish Artist"}
    assert observations[0][1] > observations[0][2]
    assert observations[-1][2] > observations[-1][1]
    assert len(path) == 7
    assert "Bridge Artist" not in {row["artist"] for row in path}
    assert path[-1]["track_id"] == destination["id"]


@pytest.mark.parametrize("flexible", ["destination", "origin", "both"])
def test_flexible_endpoints_find_a_valid_family_instead_of_dropping_an_anchor(
    monkeypatch, flexible
):
    origin = _row(1, artist="Seed Artist", title="Song")
    variant = _row(2, artist="Seed Artist", title="Song (Live)")
    alternative = _row(3, artist="Seed Artist", title="Another Song")
    _install_builder(monkeypatch, origin, variant, [])
    anchor_calls = []

    def anchor(kind, value, target, exclude, *, exclude_song_keys=None, **kwargs):
        anchor_calls.append((kind, value))
        if kind == "track":
            rows = [origin] if value == "1" else [variant]
        elif value == "8":
            rows = [origin, alternative]
        else:
            rows = [variant, alternative] if flexible == "destination" else [variant]
        return next(
            (
                deepcopy(row)
                for row in rows
                if row["id"] not in exclude
                and track_song_identity(row) not in (exclude_song_keys or set())
            ),
            None,
        )

    origin_ref = ("track", "1") if flexible == "destination" else ("album", "8")
    destination_ref = ("track", "2") if flexible == "origin" else ("album", "9")
    monkeypatch.setattr(builder, "_find_anchor_track", anchor)
    monkeypatch.setattr(builder, "_find_best_candidate", lambda *args, **kwargs: None)

    path = builder.compute_path(
        *origin_ref,
        origin["bliss_vector"],
        *destination_ref,
        variant["bliss_vector"],
        5,
    )

    expected = (
        [origin["id"], alternative["id"]]
        if flexible == "destination"
        else [alternative["id"], variant["id"]]
    )
    assert [row["track_id"] for row in path] == expected
    assert [row["progress"] for row in path] == [0.0, 1.0]
    assert len({track_song_identity(row) for row in path}) == 2
    assert len(anchor_calls) <= (4 if flexible == "both" else 2)


def test_real_album_destination_skips_the_origins_nearest_live_version(
    pg_db, monkeypatch
):
    from sqlalchemy import event
    from crate.db.engine import get_engine

    pg_db.upsert_artist({"name": "Seed Artist"})
    source_album = pg_db.upsert_album(
        {"artist": "Seed Artist", "name": "Source", "path": "/music/path-source"}
    )
    destination_album = pg_db.upsert_album(
        {
            "artist": "Seed Artist",
            "name": "Destination",
            "path": "/music/path-destination",
        }
    )
    target = [1.0] + [0.0] * 19
    other_vector = [0.0, 1.0] + [0.0] * 18
    track_ids = []
    with transaction_scope() as session:
        for index, (album_id, title, vector) in enumerate(
            (
                (source_album, "Song", target),
                (destination_album, "Song (Live)", target),
                (destination_album, "Another Song", other_vector),
            )
        ):
            track_ids.append(
                session.execute(
                    text("""
                INSERT INTO library_tracks
                    (album_id, artist, album, filename, title, path, bliss_vector, bliss_embedding)
                VALUES (:album_id, 'Seed Artist', 'Album', :filename, :title, :path,
                        CAST(:vector AS double precision[]), CAST(:embedding AS vector(20)))
                RETURNING id
            """),
                    {
                        "album_id": album_id,
                        "filename": f"{index}.flac",
                        "title": title,
                        "path": f"/music/path-{index}.flac",
                        "vector": vector,
                        "embedding": str(vector),
                    },
                ).scalar_one()
            )
    monkeypatch.setattr(builder, "_load_artist_similarity_graph", lambda: {})
    monkeypatch.setattr(builder, "_load_shared_members_graph", lambda: {})
    monkeypatch.setattr(builder, "_load_artist_genres", lambda: {})
    monkeypatch.setattr(builder, "_find_best_candidate", lambda *args, **kwargs: None)
    contexts = [
        {"artists": ["Seed Artist"], "genre_weights": {}, "genre_signals": []}
    ] * 2
    statements = []

    def record(_conn, _cursor, statement, *_args):
        if statement.lstrip().upper().startswith(("SELECT", "WITH")):
            statements.append(statement)

    engine = get_engine()
    event.listen(engine, "before_cursor_execute", record)
    try:
        path = builder.compute_path(
            "track",
            str(track_ids[0]),
            target,
            "album",
            str(destination_album),
            target,
            5,
            endpoint_contexts=contexts,
        )
    finally:
        event.remove(engine, "before_cursor_execute", record)

    assert [row["track_id"] for row in path] == [track_ids[0], track_ids[2]]
    assert path[-1]["progress"] == 1.0
    assert len(statements) <= 2


@pytest.fixture
def anchor_catalog(pg_db):
    pg_db.upsert_artist({"name": "Compilation Artist"})
    pg_db.upsert_artist({"name": "Track Performer"})
    album_id = pg_db.upsert_album(
        {
            "artist": "Compilation Artist",
            "name": "Compilation",
            "path": "/music/paths-compilation",
        }
    )
    performer_uid = str(uuid4())
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE library_artists SET entity_uid = :uid WHERE name = 'Track Performer'"
            ),
            {"uid": performer_uid},
        )
        track_id = session.execute(
            text("""
            INSERT INTO library_tracks(album_id, artist, album, filename, title, path, bliss_vector)
            VALUES (:album_id, 'Track Performer', 'Compilation', 'song.flac', 'Song',
                    '/music/paths-compilation/song.flac', CAST(:vector AS double precision[]))
            RETURNING id
        """),
            {"album_id": album_id, "vector": [0.2] * 20},
        ).scalar_one()
    return track_id, performer_uid


def test_explicit_track_anchor_respects_excluded_track_ids(anchor_catalog):
    track_id, _ = anchor_catalog

    assert find_anchor_track_row("track", str(track_id), [0.2] * 20, {track_id}) is None


def test_track_anchor_keeps_compilation_performer_identity(anchor_catalog):
    track_id, performer_uid = anchor_catalog

    anchor = find_anchor_track_row("track", str(track_id), [0.2] * 20, set())

    assert anchor is not None
    assert anchor["artist"] == "Track Performer"
    assert anchor["artist_entity_uid"] == performer_uid


@pytest.mark.parametrize(
    "kind,scope",
    [
        ("artist", "Compilation Artist"),
        ("artist", "Track Performer"),
        ("genre", "punk"),
    ],
)
def test_artist_and_genre_anchors_include_album_owner_and_track_performer(
    anchor_catalog, pg_db, kind, scope
):
    track_id, performer_uid = anchor_catalog
    if kind == "genre":
        pg_db.set_artist_genres("Compilation Artist", [("punk", 0.9, "test")])
        value = scope
    else:
        with read_scope() as session:
            value = str(
                session.execute(
                    text("SELECT id FROM library_artists WHERE name = :name"),
                    {"name": scope},
                ).scalar_one()
            )

    anchor = find_anchor_track_row(kind, value, [0.2] * 20, set())

    assert anchor is not None
    assert anchor["id"] == track_id
    assert anchor["artist"] == "Track Performer"
    assert anchor["artist_entity_uid"] == performer_uid


def test_generic_candidates_keep_legacy_owner_identity_until_paths_opt_in(
    anchor_catalog,
):
    from crate.db.queries.paths_bliss_candidate_queries import find_candidate_rows

    track_id, performer_uid = anchor_catalog

    legacy = find_candidate_rows([0.2] * 20, set(), limit=10)
    acoustic = find_candidate_rows([0.2] * 20, set(), limit=10, use_track_artist=True)

    assert [row["id"] for row in legacy] == [track_id]
    assert [row["id"] for row in acoustic] == [track_id]
    assert legacy[0]["artist"] == "Compilation Artist"
    assert acoustic[0]["artist"] == "Track Performer"
    assert acoustic[0]["artist_entity_uid"] == performer_uid

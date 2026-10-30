"""Music Paths retain the primary artist across performer credits."""

from uuid import uuid4

import pytest
from sqlalchemy import text

from crate.db.paths_scene import (
    build_artist_scene_path_from_candidates,
    build_scene_path_from_candidates,
)
from crate.db.queries.paths_scene_queries import (
    list_artist_scene_anchor_candidates,
    list_scene_path_candidates,
)
from crate.db.tx import transaction_scope
from crate.music_path_validation import validate_music_path
from tests.test_paths_scene_engine import _track


@pytest.fixture
def credited_artist_catalog(pg_db):
    owner_uid, performer_uid = str(uuid4()), str(uuid4())
    owner = {
        "artist_entity_uid": owner_uid,
        "artist_listeners": 9000,
        "artist_spotify_popularity": 81,
        "artist_popularity_score": 0.91,
        "artist_album_count": 5,
        "artist_track_count": 50,
    }
    performer = {
        "artist_entity_uid": performer_uid,
        "artist_listeners": 31,
        "artist_spotify_popularity": 32,
        "artist_popularity_score": 0.33,
        "artist_album_count": 3,
        "artist_track_count": 34,
    }
    with transaction_scope() as session:
        for name, signals in (
            ("X", owner),
            ("x", {**owner, "artist_entity_uid": str(uuid4())}),
            ("Registered Performer", performer),
        ):
            session.execute(
                text("""
                    INSERT INTO library_artists (
                        name, entity_uid, listeners, spotify_popularity,
                        popularity_score, album_count, track_count
                    ) VALUES (
                        :name, CAST(:artist_entity_uid AS uuid), :artist_listeners,
                        :artist_spotify_popularity, :artist_popularity_score,
                        :artist_album_count, :artist_track_count
                    )
                """),
                {"name": name, **signals},
            )
        album_id = session.execute(
            text("""
                INSERT INTO library_albums (artist, name, path, entity_uid)
                VALUES ('X', 'Credited Album', '/music/credited/album', gen_random_uuid())
                RETURNING id
            """)
        ).scalar_one()
        ids = {}
        for index, artist in enumerate(("X", "X feat. Guest", "Registered Performer")):
            ids[artist] = session.execute(
                text("""
                    INSERT INTO library_tracks (
                        album_id, artist, album, filename, title, path, entity_uid,
                        duration, format, bliss_vector, popularity_score
                    ) VALUES (
                        :album_id, :artist, 'Credited Album', :filename, :title,
                        :path, gen_random_uuid(), 180, 'flac', :vector, :popularity
                    ) RETURNING id
                """),
                {
                    "album_id": album_id,
                    "artist": artist,
                    "filename": f"{index}.flac",
                    "title": f"Credited Song {index}",
                    "path": f"/music/credited/album/{index}.flac",
                    "vector": [0.1] * 20,
                    "popularity": 0.9 - index / 10,
                },
            ).scalar_one()
        genre_id = session.execute(
            text("""
                INSERT INTO genres (name, slug)
                VALUES ('Primary Artist Genre', 'primary-artist-genre') RETURNING id
            """)
        ).scalar_one()
        session.execute(
            text("""
                INSERT INTO artist_genres (artist_name, genre_id, source, weight)
                VALUES ('X', :genre_id, 'test', 1)
            """),
            {"genre_id": genre_id},
        )
        yield session, ids, owner, performer


def _candidate_rows(catalog, query):
    session, _, owner, _ = catalog
    if query == "anchor":
        return list_artist_scene_anchor_candidates(
            owner["artist_entity_uid"], session=session
        )
    return list_scene_path_candidates(["primary-artist-genre"], session=session)[
        "primary-artist-genre"
    ]


@pytest.mark.parametrize("query", ["anchor", "scene"])
def test_missing_credited_performer_uses_album_artist_identity_and_popularity(
    credited_artist_catalog, query
):
    _, ids, owner, _ = credited_artist_catalog

    rows = _candidate_rows(credited_artist_catalog, query)

    assert sorted(row["id"] for row in rows) == sorted(ids.values())
    credited = next(row for row in rows if row["id"] == ids["X feat. Guest"])
    assert credited["artist"] == "X feat. Guest"
    assert credited["album_artist"] == "X"
    assert {key: credited[key] for key in owner} == owner


@pytest.mark.parametrize("query", ["anchor", "scene"])
def test_exact_performer_metadata_wins_without_duplicate_album_owner_rows(
    credited_artist_catalog, query
):
    _, ids, owner, performer = credited_artist_catalog

    rows = _candidate_rows(credited_artist_catalog, query)

    assert sorted(row["id"] for row in rows) == sorted(ids.values())
    by_id = {row["id"]: row for row in rows}
    assert {key: by_id[ids["X"]][key] for key in owner} == owner
    assert {
        key: by_id[ids["Registered Performer"]][key] for key in performer
    } == performer


@pytest.mark.parametrize("query", ["anchor", "scene"])
def test_existing_performer_keeps_null_metadata_without_album_owner_fallback(
    credited_artist_catalog, query
):
    session, ids, owner, performer = credited_artist_catalog
    session.execute(
        text("""
            UPDATE library_artists
            SET entity_uid = NULL, listeners = NULL, spotify_popularity = NULL,
                popularity_score = NULL, album_count = NULL, track_count = NULL
            WHERE name = 'Registered Performer'
        """)
    )

    rows = _candidate_rows(credited_artist_catalog, query)

    assert sorted(row["id"] for row in rows) == sorted(ids.values())
    by_id = {row["id"]: row for row in rows}
    assert {key: by_id[ids["X"]][key] for key in owner} == owner
    registered = by_id[ids["Registered Performer"]]
    assert registered["artist"] == "Registered Performer"
    assert registered["album_artist"] == "X"
    assert {key: registered[key] for key in performer} == {
        key: None for key in performer
    }


def _song(index, artist, *, album_artist=None, popularity=0.5, genre="punk"):
    row = _track(
        index,
        title=f"Primary Artist Song {index}",
        artist=artist,
        genre_slug=genre,
        artist_popularity_score=popularity,
        track_popularity_score=popularity,
    )
    if album_artist is not None:
        row["album_artist"] = album_artist
    return row


def test_artist_path_keeps_origin_primary_artist_out_of_the_interior():
    origin = _song(1, "X")
    credited = _song(2, "X feat. Guest", album_artist="X", popularity=1.0)
    alternative = _song(3, "Independent Artist", popularity=0.1)
    destination = _song(4, "Destination Artist", genre="post-hardcore")

    path = build_artist_scene_path_from_candidates(
        ["punk", "post-hardcore"],
        {"origin": [origin], "destination": [destination]},
        {"punk": [credited, alternative]},
        step_count=3,
    )

    assert [row["id"] for row in path] == [1, 3, 4]


def test_scene_path_artist_repeat_budget_counts_feature_credits_towards_the_principal():
    origin = _song(1, "X")
    middle = _song(2, "Middle Artist", genre="hardcore-punk")
    credited = _song(
        3, "X feat. Guest", album_artist="X", popularity=1.0, genre="post-hardcore"
    )
    alternative = _song(4, "Destination Artist", popularity=0.1, genre="post-hardcore")

    path = build_scene_path_from_candidates(
        ["punk", "hardcore-punk", "post-hardcore"],
        {
            "punk": [origin],
            "hardcore-punk": [middle],
            "post-hardcore": [credited, alternative],
        },
        step_count=3,
        max_repeat_per_artist=1,
    )

    assert [row["id"] for row in path] == [1, 2, 4]


@pytest.mark.parametrize("code", ["artist_repeat_limit", "repeated_artist"])
def test_validator_reports_three_consecutive_primary_artist_variants_at_the_third_track(
    code,
):
    tracks = [
        _song(1, "X"),
        _song(2, "x feat. Guest", album_artist="X"),
        _song(3, " X FEAT. Another ", album_artist="X"),
    ]

    report = validate_music_path(tracks, requested_steps=3, max_repeat_per_artist=2)

    assert [
        warning["position"] for warning in report["warnings"] if warning["code"] == code
    ] == [2]


def test_validator_allows_two_primary_artist_variants_within_the_consecutive_limit():
    tracks = [_song(1, "X"), _song(2, "X feat. Guest", album_artist="X")]

    report = validate_music_path(tracks, requested_steps=2, max_repeat_per_artist=2)

    assert not {"artist_repeat_limit", "repeated_artist"}.intersection(
        warning["code"] for warning in report["warnings"]
    )


def test_validator_does_not_merge_a_distinct_performer_with_the_album_owner():
    tracks = [_song(1, "X"), _song(2, "Registered Performer", album_artist="X")]

    report = validate_music_path(tracks, requested_steps=2, max_repeat_per_artist=1)

    assert not {"artist_repeat_limit", "repeated_artist"}.intersection(
        warning["code"] for warning in report["warnings"]
    )

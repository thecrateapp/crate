"""Final Music Paths identity and statistics contracts on real PostgreSQL."""

from collections import Counter
from uuid import uuid4

import pytest
from sqlalchemy import text

from crate.db.paths_scene import _artist_key
from crate.db.queries.paths_scene_queries import (
    list_artist_scene_anchor_candidates,
    list_scene_path_candidates,
)
from crate.db.tx import transaction_scope
from crate.recommendation_policy import path_artist_key


@pytest.fixture
def identity_catalog(pg_db):
    with transaction_scope() as session:
        artist_id = session.execute(
            text("""
                INSERT INTO library_artists (name, entity_uid)
                VALUES ('X', gen_random_uuid()) RETURNING id
            """)
        ).scalar_one()
        album_id = session.execute(
            text("""
                INSERT INTO library_albums (artist, name, path, entity_uid)
                VALUES ('X', 'Final Identity Album', '/music/final-identity',
                        gen_random_uuid()) RETURNING id
            """)
        ).scalar_one()
        genre_id = session.execute(
            text("""
                INSERT INTO genres (name, slug)
                VALUES ('Final Identity Genre', 'final-identity-genre') RETURNING id
            """)
        ).scalar_one()
        session.execute(
            text("""
                INSERT INTO artist_genres (artist_name, genre_id, source, weight)
                VALUES ('X', :genre_id, 'test', 1)
            """),
            {"genre_id": genre_id},
        )
        yield {"session": session, "artist_id": artist_id, "album_id": album_id}


def _add_track(catalog, artist, index):
    uid = str(uuid4())
    track_id = (
        catalog["session"]
        .execute(
            text("""
            INSERT INTO library_tracks (
                album_id, artist, album, filename, title, path, entity_uid,
                duration, format, bliss_vector, popularity_score
            ) VALUES (
                :album_id, :artist, 'Final Identity Album', :filename, :title,
                :path, CAST(:uid AS uuid), 180, 'flac', :vector, :popularity
            ) RETURNING id
        """),
            {
                "album_id": catalog["album_id"],
                "artist": artist,
                "filename": f"{index}.flac",
                "title": f"Final Identity Song {index}",
                "path": f"/music/final-identity/{index}.flac",
                "uid": uid,
                "vector": [0.1] * 20,
                "popularity": 1 - index / 100,
            },
        )
        .scalar_one()
    )
    return track_id, uid


def _rows(catalog, query):
    if query == "anchor":
        return list_artist_scene_anchor_candidates(
            str(catalog["artist_id"]), user_id=1, limit=24, session=catalog["session"]
        )
    return list_scene_path_candidates(
        ["final-identity-genre"],
        user_id=1,
        limit_per_genre=24,
        session=catalog["session"],
    )["final-identity-genre"]


@pytest.mark.parametrize(
    "credit",
    [
        "X feat. Guest",
        "X ft Guest",
        "X featuring Guest",
        "X (FEAT. Guest)",
        "X [featuring Guest]",
        " X ",
        pytest.param("\tX\t", id="tab-padded-credit"),
        pytest.param("\nX\n", id="newline-padded-credit"),
    ],
)
def test_scene_artist_cap_matches_the_planner_primary_artist_key(
    identity_catalog, credit
):
    catalog = identity_catalog
    track_ids = [
        _add_track(catalog, artist, index)[0]
        for index, artist in enumerate(("X", "X", credit, credit))
    ]
    assert _artist_key({"artist": credit}) == path_artist_key({"artist": "X"}) == "x"

    rows = _rows(catalog, "scene")

    assert Counter(_artist_key(row) for row in rows) == {"x": 2}
    assert [row["id"] for row in rows] == track_ids[:2]
    assert all(row["membership_score"] == 1 for row in rows)


_COMPLETE_COLLABORATION_NAMES = [
    "Sunn O))) & Boris",
    "Florence + The Machine",
    "X & Y",
    "X x Y",
    "X with Y",
    "X, Y",
]


@pytest.mark.parametrize("artist", _COMPLETE_COLLABORATION_NAMES)
def test_complete_band_and_collaboration_names_are_preserved_without_a_feature_suffix(
    artist,
):
    expected = artist.casefold()

    assert path_artist_key({"artist": artist}) == expected
    assert _artist_key({"artist": artist}) == expected


def test_primary_artist_lowercase_preserves_distinct_sharp_s_band_names():
    assert _artist_key({"artist": "STRAẞE"}) == _artist_key({"artist": "Straße"})
    assert path_artist_key({"artist": "Straße"}) != path_artist_key(
        {"artist": "Strasse"}
    )


def test_scene_cap_keeps_complete_collaboration_names_separate_from_their_members(
    identity_catalog,
):
    catalog = identity_catalog
    artists = ["X", *_COMPLETE_COLLABORATION_NAMES]
    for index, artist in enumerate(
        artist for name in artists for artist in (name, name)
    ):
        _add_track(catalog, artist, index)

    rows = _rows(catalog, "scene")

    assert Counter(_artist_key(row) for row in rows) == {
        artist.casefold(): 2 for artist in artists
    }
    assert len({row["id"] for row in rows}) == len(artists) * 2


def _add_stats(catalog, track_id, uid, *, identity, plays, completions):
    catalog["session"].execute(
        text("""
            INSERT INTO user_track_stats (
                user_id, stat_window, entity_key, track_id, track_entity_uid,
                play_count, complete_play_count
            ) VALUES (
                1, 'all_time', :key, :track_id, CAST(:uid AS uuid), :plays, :completions
            )
        """),
        {
            "key": f"{identity}:{track_id if identity == 'id' else uid}",
            "track_id": track_id if identity == "id" else None,
            "uid": uid if identity == "uid" else None,
            "plays": plays,
            "completions": completions,
        },
    )


@pytest.mark.parametrize("query", ["anchor", "scene"])
def test_stats_aliases_do_not_duplicate_candidates_and_the_exact_track_id_wins(
    identity_catalog, query
):
    catalog = identity_catalog
    track_id, uid = _add_track(catalog, "X", 0)
    other_id, _ = _add_track(catalog, "X", 1)
    _add_stats(catalog, track_id, uid, identity="id", plays=2, completions=1)
    _add_stats(catalog, track_id, uid, identity="uid", plays=99, completions=90)

    rows = _rows(catalog, query)

    assert sorted(row["id"] for row in rows) == sorted([track_id, other_id])
    by_id = {row["id"]: row for row in rows}
    assert (
        by_id[track_id]["user_play_count"],
        by_id[track_id]["user_complete_play_count"],
    ) == (2, 1)
    assert (
        by_id[other_id]["user_play_count"],
        by_id[other_id]["user_complete_play_count"],
    ) == (0, 0)
    assert [row["id"] for row in rows] == [track_id, other_id]
    assert all(row["membership_score"] == 1 for row in rows)


@pytest.mark.parametrize("query", ["anchor", "scene"])
@pytest.mark.parametrize("identity", ["id", "uid"])
def test_single_stats_identity_remains_available_without_multiplying_tracks(
    identity_catalog, query, identity
):
    catalog = identity_catalog
    track_id, uid = _add_track(catalog, "X", 0)
    other_id, _ = _add_track(catalog, "X", 1)
    _add_stats(catalog, track_id, uid, identity=identity, plays=7, completions=3)

    rows = _rows(catalog, query)

    assert [row["id"] for row in rows] == [track_id, other_id]
    assert (rows[0]["user_play_count"], rows[0]["user_complete_play_count"]) == (7, 3)
    assert (rows[1]["user_play_count"], rows[1]["user_complete_play_count"]) == (0, 0)

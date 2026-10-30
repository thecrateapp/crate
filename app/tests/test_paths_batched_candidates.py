from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from sqlalchemy import text

from crate.db.queries import paths_scene_queries as queries
from crate.db.tx import read_scope, transaction_scope


@pytest.fixture
def candidate_catalog(pg_db):
    owners = ("Batch Owner One", "Batch Owner Two")
    performers = ("Batch Performer", "Case Performer", "case performer")
    with transaction_scope() as session:
        session.execute(
            text("INSERT INTO library_artists (name) VALUES (:name)"),
            [{"name": name} for name in (*owners, *performers)],
        )
    pg_db.set_artist_genres(
        owners[0], [("batch-punk", 1.0, "test"), ("batch-wave", 0.8, "test")]
    )
    pg_db.set_artist_genres(
        owners[1], [("batch-alias", 1.0, "test"), ("batch-wave", 0.5, "test")]
    )
    pg_db.set_artist_genres(performers[0], [("batch-wave", 0.95, "test")])
    pg_db.set_artist_genres(performers[1], [("batch-punk", 0.6, "test")])
    pg_db.set_artist_genres(performers[2], [("batch-punk", 0.6, "test")])
    albums = [
        pg_db.upsert_album(
            {
                "artist": owner,
                "name": f"Batch Album {index}",
                "path": f"/music/batch/{index}",
            }
        )
        for index, owner in enumerate(owners)
    ]
    tracks = []
    with transaction_scope() as session:
        session.execute(
            text("""
            INSERT INTO genre_taxonomy_nodes (slug, name)
            VALUES ('batch-punk', 'batch-punk') ON CONFLICT (slug) DO NOTHING
        """)
        )
        session.execute(
            text("""
            INSERT INTO genre_taxonomy_aliases (alias_slug, alias_name, genre_id)
            SELECT 'batch-alias', 'batch alias', id FROM genre_taxonomy_nodes
            WHERE slug = 'batch-punk'
            ON CONFLICT (alias_slug) DO UPDATE SET genre_id = EXCLUDED.genre_id
        """)
        )
        session.execute(
            text("""
            UPDATE library_artists SET popularity_score = 0.7, listeners = 100,
                spotify_popularity = 45 WHERE name = :performer
        """),
            {"performer": performers[0]},
        )
        session.execute(
            text("""
            UPDATE library_artists SET popularity_score = 0.9, listeners = 200
            WHERE name IN (:upper, :lower)
        """),
            {"upper": performers[1], "lower": performers[2]},
        )
        for index in range(8):
            owner_index = 0 if index < 3 or index >= 6 else 1
            performer = (
                performers[0] if owner_index == 0 else performers[1 + (index % 2)]
            )
            entity_uid = str(uuid4())
            track_id = session.execute(
                text("""
                INSERT INTO library_tracks (
                    album_id, artist, album, filename, title, path, duration,
                    format, bliss_vector, popularity_score, entity_uid
                ) VALUES (
                    :album_id, :artist, :album, :filename, :title, :path, 180,
                    'flac', CAST(:vector AS DOUBLE PRECISION[]), :popularity,
                    CAST(:entity_uid AS UUID)
                ) RETURNING id
            """),
                {
                    "album_id": albums[owner_index],
                    "artist": performer,
                    "album": f"Batch Album {owner_index}",
                    "filename": f"{index}.flac",
                    "title": f"Batch Song {index}",
                    "path": f"/music/batch/{'.hidden' if index == 6 else 'visible'}/{index}.flac",
                    "vector": None if index == 7 else [0.1] * 20,
                    "popularity": 1.0 if index >= 6 else 0.95 - (index % 3) * 0.1,
                    "entity_uid": entity_uid,
                },
            ).scalar_one()
            tracks.append({"id": track_id, "entity_uid": entity_uid})
        session.execute(
            text("""
            INSERT INTO artist_similarities (artist_name, similar_name, score, updated_at)
            VALUES (:artist, :peer, 0.9, NOW())
        """),
            [
                {"artist": "Case Performer", "peer": "Upper Peer"},
                {"artist": "case performer", "peer": "Lower Peer"},
            ],
        )
        session.execute(
            text("""
            INSERT INTO user_track_stats (
                user_id, stat_window, entity_key, track_id, track_entity_uid,
                play_count, complete_play_count
            ) VALUES (
                1, 'all_time', :entity_key, :track_id, CAST(:track_entity_uid AS UUID),
                :play_count, :complete_play_count
            )
        """),
            [
                {
                    "entity_key": "batch-id",
                    "track_id": tracks[0]["id"],
                    "track_entity_uid": None,
                    "play_count": 5,
                    "complete_play_count": 3,
                },
                {
                    "entity_key": "batch-uid",
                    "track_id": None,
                    "track_entity_uid": tracks[1]["entity_uid"],
                    "play_count": 9,
                    "complete_play_count": 7,
                },
            ],
        )
        session.execute(
            text("""
            INSERT INTO user_liked_tracks (user_id, track_id, created_at)
            VALUES (1, :track_id, NOW())
        """),
            {"track_id": tracks[1]["id"]},
        )
        global_artist, global_track = str(uuid4()), str(uuid4())
        session.execute(
            text("""
            INSERT INTO global_catalog_artists (
                global_artist_uid, canonical_name, sort_name, normalized_name
            ) VALUES (CAST(:uid AS UUID), 'Batch Global', 'Batch Global', 'batch global')
        """),
            {"uid": global_artist},
        )
        session.execute(
            text("""
            INSERT INTO global_catalog_tracks (
                global_track_uid, global_artist_uid, canonical_title,
                normalized_title, artist_name, local_track_id
            ) VALUES (
                CAST(:uid AS UUID), CAST(:artist AS UUID), 'Batch Global Song',
                'batch global song', 'Batch Global', :track_id
            )
        """),
            {"uid": global_track, "artist": global_artist, "track_id": tracks[3]["id"]},
        )
        session.execute(
            text("""
            INSERT INTO user_global_track_likes (user_id, global_track_uid)
            VALUES (1, CAST(:uid AS UUID))
        """),
            {"uid": global_track},
        )
    return {"tracks": tracks, "albums": albums, "owners": owners}


@pytest.mark.parametrize(
    "genres",
    [
        ["batch-punk", "batch-wave"],
        ["batch-wave", "batch-missing", "batch-punk", "batch-alias", "batch-wave"],
    ],
)
def test_genres_are_loaded_in_one_batched_select(candidate_catalog, genres):
    with read_scope() as session:
        recorded = MagicMock(wraps=session)
        rows = queries.list_scene_path_candidates(genres, user_id=1, session=recorded)
        selects = [
            call
            for call in recorded.execute.call_args_list
            if str(call.args[0]).lstrip().upper().startswith(("SELECT", "WITH"))
        ]
        assert list(rows) == list(dict.fromkeys(genres))
        assert rows.get("batch-missing", []) == []
        assert len(selects) == 1
        recorded.commit.assert_not_called()
        recorded.rollback.assert_not_called()


@pytest.mark.parametrize("limit", [4, 13, 24])
def test_batched_genre_pools_keep_single_genre_rows_and_rank(candidate_catalog, limit):
    genres = ["batch-wave", "batch-punk", "batch-alias", "batch-missing"]
    expected = {
        slug: queries.list_scene_path_candidates(
            [slug], user_id=1, limit_per_genre=limit
        )[slug]
        for slug in genres
    }
    actual = queries.list_scene_path_candidates(
        genres, user_id=1, limit_per_genre=limit
    )
    assert actual == expected
    assert list(actual) == genres
    for slug, rows in actual.items():
        assert len(rows) <= limit
        assert all(row["genre_slug"] == slug for row in rows)
        assert all(row["artist_track_rank"] <= (1 if limit == 4 else 2) for row in rows)
        assert all(not any(key.startswith("_") for key in row) for row in rows)
    assert [row["id"] for row in actual["batch-punk"][:1]] == [
        candidate_catalog["tracks"][0]["id"]
    ]


def test_membership_performer_and_user_signals_remain_genre_scoped(candidate_catalog):
    tracks = candidate_catalog["tracks"]
    result = queries.list_scene_path_candidates(
        ["batch-punk", "batch-wave", "batch-alias"], user_id=1, limit_per_genre=24
    )
    punk = {row["id"]: row for row in result["batch-punk"]}
    wave = {row["id"]: row for row in result["batch-wave"]}
    alias = {row["id"]: row for row in result["batch-alias"]}
    direct, uid_listened, global_liked = (tracks[index]["id"] for index in (0, 1, 3))
    assert punk[direct]["membership_score"] == 1.0
    assert wave[direct]["membership_score"] == 0.8
    assert punk[global_liked]["membership_score"] == pytest.approx(0.7)
    assert alias[global_liked]["membership_score"] == 1.0
    assert punk[direct]["artist"] == "Batch Performer"
    assert punk[direct]["album_artist"] == "Batch Owner One"
    assert punk[direct]["artist_genre_slugs"] == ["batch-wave"]
    assert punk[direct]["artist_popularity_score"] == 0.7
    assert punk[direct]["user_play_count"] == 5
    assert punk[uid_listened]["user_play_count"] == 9
    assert punk[uid_listened]["user_complete_play_count"] == 7
    assert punk[uid_listened]["is_liked"] is True
    assert punk[global_liked]["is_liked"] is True
    assert punk[global_liked]["artist_relation_score"] == pytest.approx(0.1)
    assert not ({tracks[6]["id"], tracks[7]["id"]} & set(punk))
    anonymous = queries.list_scene_path_candidates(["batch-punk"], limit_per_genre=24)[
        "batch-punk"
    ]
    assert all(
        row["user_play_count"] == 0 and row["is_liked"] is False for row in anonymous
    )


def test_batched_read_reuses_uncommitted_session_without_finishing_it(pg_db):
    name = "Uncommitted Batch Artist"
    with read_scope() as session:
        session.execute(
            text("INSERT INTO library_artists (name) VALUES (:name)"), {"name": name}
        )
        recorded = MagicMock(wraps=session)
        result = queries.list_scene_path_candidates(
            ["batch-missing", "batch-other"], session=recorded
        )
        assert result == {"batch-missing": [], "batch-other": []}
        recorded.commit.assert_not_called()
        recorded.rollback.assert_not_called()
        assert session.in_transaction()
        assert (
            session.execute(
                text("SELECT name FROM library_artists WHERE name = :name"),
                {"name": name},
            ).scalar_one()
            == name
        )
    with read_scope() as session:
        assert (
            session.execute(
                text("SELECT name FROM library_artists WHERE name = :name"),
                {"name": name},
            ).scalar_one_or_none()
            is None
        )


def test_stats_aliases_do_not_duplicate_tracks_before_per_artist_ranking(
    candidate_catalog,
):
    first = candidate_catalog["tracks"][0]
    second = candidate_catalog["tracks"][1]
    with transaction_scope() as session:
        session.execute(
            text("""
                INSERT INTO user_track_stats (
                    user_id, stat_window, entity_key, track_entity_uid,
                    play_count, complete_play_count
                ) VALUES (1, 'all_time', 'batch-second-reference',
                          CAST(:uid AS UUID), 11, 8)
            """),
            {"uid": first["entity_uid"]},
        )
    result = queries.list_scene_path_candidates(
        ["batch-punk", "batch-wave"], user_id=1, limit_per_genre=13
    )
    for rows in result.values():
        assert len({row["id"] for row in rows}) == len(rows)
        top = rows[:2]
        assert [row["id"] for row in top] == [first["id"], second["id"]]
        assert [row["user_play_count"] for row in top] == [5, 9]
        assert [row["user_complete_play_count"] for row in top] == [3, 7]
        assert [row["artist_track_rank"] for row in top] == [1, 2]


def test_empty_genre_batch_never_opens_a_scope_or_executes_sql(monkeypatch):
    def forbidden_scope():
        raise AssertionError("Empty batches must not access the database")

    monkeypatch.setattr(queries, "read_scope", forbidden_scope)
    session = MagicMock()
    assert queries.list_scene_path_candidates([]) == {}
    assert queries.list_scene_path_candidates([], session=session) == {}
    session.execute.assert_not_called()
    session.commit.assert_not_called()
    session.rollback.assert_not_called()

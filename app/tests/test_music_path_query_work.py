"""Real PostgreSQL budgets for acoustic sessions and scene metadata work."""

from unittest.mock import MagicMock

import pytest
from sqlalchemy import event, text
from sqlalchemy.orm import Session

from crate.db import paths_path_builder
from crate.db.queries import paths_scene_queries
from crate.db.tx import read_scope, transaction_scope


@pytest.fixture
def acoustic_catalog(pg_db):
    ids, vectors = [], []
    with transaction_scope() as session:
        for index in range(5):
            artist = f"Acoustic Budget Artist {index}"
            session.execute(
                text("INSERT INTO library_artists (name) VALUES (:artist)"),
                {"artist": artist},
            )
            album_id = session.execute(
                text("""
                    INSERT INTO library_albums (artist, name, path)
                    VALUES (:artist, 'Budget Album', :path) RETURNING id
                """),
                {"artist": artist, "path": f"/music/acoustic-budget/{index}"},
            ).scalar_one()
            vector = [1.0, index / 4] + [0.01] * 18
            track_id = session.execute(
                text("""
                    INSERT INTO library_tracks (
                        album_id, artist, album, filename, title, path,
                        duration, format, bliss_vector, bliss_embedding
                    ) VALUES (
                        :album_id, :artist, 'Budget Album', 'song.flac', :title,
                        :path, 180, 'flac', :vector, CAST(:embedding AS vector(20))
                    ) RETURNING id
                """),
                {
                    "album_id": album_id,
                    "artist": artist,
                    "title": f"Acoustic Budget Song {index}",
                    "path": f"/music/acoustic-budget/{index}/song.flac",
                    "vector": vector,
                    "embedding": str(vector),
                },
            ).scalar_one()
            ids.append(track_id)
            vectors.append(vector)
    return ids, vectors


def test_acoustic_compute_path_reuses_one_real_read_transaction_and_session(
    acoustic_catalog, monkeypatch
):
    ids, vectors = acoustic_catalog
    transactions, helper_sessions = [], []

    def began(session, _transaction, _connection):
        transactions.append(session)

    for name in (
        "_load_artist_similarity_graph",
        "_load_artist_genres",
        "_load_shared_members_graph",
        "load_endpoint_contexts",
        "_find_anchor_track",
        "_find_best_candidate",
    ):
        original = getattr(paths_path_builder, name)

        def observe(*args, _name=name, _original=original, **kwargs):
            helper_sessions.append((_name, kwargs.get("session")))
            return _original(*args, **kwargs)

        monkeypatch.setattr(paths_path_builder, name, observe)

    event.listen(Session, "after_begin", began)
    try:
        path = paths_path_builder.compute_path(
            "track",
            str(ids[0]),
            vectors[0],
            "track",
            str(ids[-1]),
            vectors[-1],
            step_count=4,
        )
    finally:
        event.remove(Session, "after_begin", began)

    assert len(path) == 4
    assert path[0]["track_id"] == ids[0]
    assert path[-1]["track_id"] == ids[-1]
    assert len({row["track_id"] for row in path}) == 4
    assert {row["track_id"] for row in path} <= set(ids)
    assert [row["progress"] for row in path] == [0.0, 0.3333, 0.6667, 1.0]
    assert all(row["format"] == "flac" for row in path)
    assert len(transactions) == 1, f"Real read transactions opened: {len(transactions)}"
    assert helper_sessions
    assert all(session is transactions[0] for _name, session in helper_sessions), [
        name for name, session in helper_sessions if session is not transactions[0]
    ]


@pytest.fixture
def metadata_catalog(pg_db):
    tracks = {}
    with transaction_scope() as session:
        genre_ids = {}
        for name in ("Chosen", "Detail One", "Detail Two", "Unrelated"):
            genre_ids[name] = session.execute(
                text("""
                    INSERT INTO genres (name, slug) VALUES (:name, :slug) RETURNING id
                """),
                {
                    "name": f"Work {name}",
                    "slug": f"work-{name.lower().replace(' ', '-')}",
                },
            ).scalar_one()
        for artist in ("Z Work Target", "Z Work Second"):
            artist_id = session.execute(
                text("""
                    INSERT INTO library_artists (name, entity_uid, popularity_score)
                    VALUES (:artist, gen_random_uuid(), 0.8) RETURNING id
                """),
                {"artist": artist},
            ).scalar_one()
            album_id = session.execute(
                text("""
                    INSERT INTO library_albums (artist, name, path)
                    VALUES (:artist, 'Work Album', :path) RETURNING id
                """),
                {"artist": artist, "path": f"/music/metadata-work/{artist}"},
            ).scalar_one()
            for name, weight in (
                ("Chosen", 1.0),
                ("Detail One", 0.8),
                ("Detail Two", 0.7),
            ):
                session.execute(
                    text("""
                        INSERT INTO artist_genres (artist_name, genre_id, source, weight)
                        VALUES (:artist, :genre_id, 'test', :weight)
                    """),
                    {"artist": artist, "genre_id": genre_ids[name], "weight": weight},
                )
            ids = []
            for index in range(6):
                ids.append(
                    session.execute(
                        text("""
                            INSERT INTO library_tracks (
                                album_id, artist, album, filename, title, path,
                                duration, format, bliss_vector, popularity_score
                            ) VALUES (
                                :album_id, :artist, 'Work Album', :filename, :title,
                                :path, 180, 'flac', :vector, :popularity
                            ) RETURNING id
                        """),
                        {
                            "album_id": album_id,
                            "artist": artist,
                            "filename": f"{index}.flac",
                            "title": f"Work Song {index}",
                            "path": f"/music/metadata-work/{artist}/{index}.flac",
                            "vector": [0.1] * 20,
                            "popularity": 0.9 - index / 10,
                        },
                    ).scalar_one()
                )
            tracks[artist] = ids
            if artist == "Z Work Target":
                target_artist_id = artist_id
    return target_artist_id, tracks, genre_ids["Unrelated"]


def _metadata_rows(session, query, target_artist_id, *, user_id=None):
    if query == "anchor":
        return paths_scene_queries.list_artist_scene_anchor_candidates(
            str(target_artist_id), limit=24, user_id=user_id, session=session
        )
    return paths_scene_queries.list_scene_path_candidates(
        ["work-chosen"], limit_per_genre=24, user_id=user_id, session=session
    )["work-chosen"]


def _add_unrelated_artists(genre_id):
    with transaction_scope() as session:
        session.execute(
            text("""
            INSERT INTO library_artists (name)
            SELECT 'A Unrelated Work ' || n FROM generate_series(1, 400) n
        """)
        )
        session.execute(
            text("""
                INSERT INTO artist_genres (artist_name, genre_id, source, weight)
                SELECT 'A Unrelated Work ' || n, :genre_id, 'test', 1
                FROM generate_series(1, 400) n
            """),
            {"genre_id": genre_id},
        )
        session.execute(text("ANALYZE artist_genres"))
        session.execute(text("ANALYZE library_artists"))


def _nodes(plan):
    yield plan
    for child in plan.get("Plans", []):
        yield from _nodes(child)


def _genre_aggregate_inputs(plan):
    """Count tuples entering genre aggregates, including repeated execution."""
    return [
        sum(
            child["Actual Rows"] * child["Actual Loops"]
            for child in node.get("Plans", [])
        )
        for node in _nodes(plan)
        if node["Node Type"] == "Aggregate"
        and any(child.get("Relation Name") == "artist_genres" for child in _nodes(node))
    ]


def _explain(session, statement, parameters=None):
    document = session.execute(
        text("EXPLAIN (ANALYZE, FORMAT JSON) " + str(statement)), parameters or {}
    ).scalar_one()
    return document[0]["Plan"]


@pytest.mark.parametrize("query", ["anchor", "scene"])
def test_scene_genre_metadata_aggregation_is_bounded_by_eligible_candidates(
    metadata_catalog, query
):
    target_artist_id, tracks, unrelated_genre_id = metadata_catalog
    with read_scope() as session:
        before = _metadata_rows(session, query, target_artist_id)
        _add_unrelated_artists(unrelated_genre_id)
        recorded = MagicMock(wraps=session)
        after = _metadata_rows(recorded, query, target_artist_id)

        assert after == before
        expected_ids = (
            tracks["Z Work Target"]
            if query == "anchor"
            else [track_id for ids in tracks.values() for track_id in ids[:2]]
        )
        assert sorted(row["id"] for row in after) == sorted(expected_ids)
        assert all(
            row["artist_genre_slugs"]
            == ["work-chosen", "work-detail-one", "work-detail-two"]
            for row in after
        )
        global_plan = _explain(
            session,
            "SELECT artist_name, COUNT(*) FROM artist_genres GROUP BY artist_name",
        )
        assert max(_genre_aggregate_inputs(global_plan)) >= 400

        select_calls = [
            call
            for call in recorded.execute.call_args_list
            if str(call.args[0]).lstrip().upper().startswith(("SELECT", "WITH"))
        ]
        assert len(select_calls) == 1
        select_call = select_calls[0]
        plan = _explain(session, select_call.args[0], select_call.args[1])
        work = _genre_aggregate_inputs(plan)
        eligible_track_count = (
            len(tracks["Z Work Target"])
            if query == "anchor"
            else sum(len(ids) for ids in tracks.values())
        )
        assert max(work, default=0) <= eligible_track_count * 3, {
            "aggregate_input_rows": work,
            "eligible_candidate_tracks": eligible_track_count,
            "returned_candidate_tracks": len(after),
            "genres_per_candidate": 3,
        }


@pytest.fixture
def global_like_catalog(metadata_catalog):
    target_artist_id, tracks, _ = metadata_catalog
    with transaction_scope() as session:
        user_id = session.execute(
            text("""
                INSERT INTO users (email, created_at)
                VALUES ('global-work@example.test', NOW())
                RETURNING id
            """)
        ).scalar_one()
        noise_ids = list(
            session.execute(
                text("""
                    INSERT INTO library_tracks (
                        album_id, artist, album, filename, title, path,
                        duration, format, bliss_vector, popularity_score
                    )
                    SELECT source.album_id, source.artist, source.album,
                           'global-work-' || n || '.flac', 'Global Work Song ' || n,
                           '/music/metadata-work/global-' || n || '.flac',
                           180, 'flac', source.bliss_vector, 0.001
                    FROM library_tracks source CROSS JOIN generate_series(1, 400) n
                    WHERE source.id = :source_id
                    RETURNING id
                """),
                {"source_id": tracks["Z Work Target"][0]},
            ).scalars()
        )
        session.execute(
            text("""
                INSERT INTO global_catalog_artists (
                    global_artist_uid, canonical_name, sort_name, normalized_name
                )
                SELECT gen_random_uuid(), name, name, LOWER(name)
                FROM library_artists WHERE name = ANY(:names)
            """),
            {"names": list(tracks)},
        )
        session.execute(text("ANALYZE library_tracks"))
    all_ids = [track_id for ids in tracks.values() for track_id in ids] + noise_ids
    return target_artist_id, tracks, all_ids, user_id


def _add_global_aliases(session, track_ids):
    return {
        row["local_track_id"]: str(row["global_track_uid"])
        for row in session.execute(
            text("""
                INSERT INTO global_catalog_tracks (
                    global_track_uid, global_artist_uid, canonical_title,
                    normalized_title, artist_name, album_name, local_track_id,
                    duration_seconds, has_local
                )
                SELECT gen_random_uuid(), artist.global_artist_uid, track.title,
                       LOWER(track.title), track.artist, track.album, track.id,
                       180, TRUE
                FROM library_tracks track
                JOIN global_catalog_artists artist
                  ON artist.canonical_name = track.artist
                WHERE track.id = ANY(:ids)
                RETURNING local_track_id, global_track_uid
            """),
            {"ids": track_ids},
        ).mappings()
    }


def _global_catalog_rows_visited(plan):
    return sum(
        max(
            1,
            node["Actual Rows"]
            + node.get("Rows Removed by Filter", 0)
            + node.get("Rows Removed by Index Recheck", 0),
        )
        * node["Actual Loops"]
        for node in _nodes(plan)
        if node.get("Relation Name") == "global_catalog_tracks"
    )


@pytest.mark.parametrize("query", ["anchor", "scene"])
@pytest.mark.parametrize("has_global_like", [False, True])
def test_scene_global_like_catalog_work_is_bounded_by_likes_and_output_candidates(
    global_like_catalog, query, has_global_like
):
    target_artist_id, tracks, all_ids, user_id = global_like_catalog
    with transaction_scope() as session:
        before = _metadata_rows(session, query, target_artist_id, user_id=user_id)
        aliases = _add_global_aliases(session, all_ids)
        liked_track_id = tracks["Z Work Target"][0]
        if has_global_like:
            session.execute(
                text("""
                    INSERT INTO user_global_track_likes (user_id, global_track_uid)
                    VALUES (:user_id, CAST(:uid AS uuid))
                """),
                {"user_id": user_id, "uid": aliases[liked_track_id]},
            )
        session.execute(text("ANALYZE global_catalog_tracks"))
        session.execute(text("ANALYZE user_global_track_likes"))
        recorded = MagicMock(wraps=session)

        after = _metadata_rows(recorded, query, target_artist_id, user_id=user_id)

        expected = [
            {**row, "is_liked": has_global_like and row["id"] == liked_track_id}
            for row in before
        ]
        assert after == expected
        assert len({row["id"] for row in after}) == len(after)
        assert all(row["membership_score"] == 1 for row in after)
        select_calls = [
            call
            for call in recorded.execute.call_args_list
            if str(call.args[0]).lstrip().upper().startswith(("SELECT", "WITH"))
        ]
        assert len(select_calls) == 1
        call = select_calls[0]
        plan = _explain(session, call.args[0], call.args[1])
        work = _global_catalog_rows_visited(plan)
        assert work <= len(after) + int(has_global_like), {
            "global_catalog_rows_visited": work,
            "returned_candidates": len(after),
            "user_global_likes": int(has_global_like),
            "eligible_local_tracks": len(all_ids),
        }


@pytest.mark.parametrize("query", ["anchor", "scene"])
def test_scene_global_like_aliases_do_not_duplicate_tracks_or_change_pool_ranking(
    global_like_catalog, query
):
    target_artist_id, tracks, _, user_id = global_like_catalog
    liked_track_id = tracks["Z Work Target"][0]
    with transaction_scope() as session:
        before = _metadata_rows(session, query, target_artist_id, user_id=user_id)
        aliases = [
            _add_global_aliases(session, [liked_track_id])[liked_track_id]
            for _ in range(3)
        ]
        session.execute(
            text("""
                INSERT INTO user_global_track_likes (user_id, global_track_uid)
                SELECT :user_id, uid
                FROM UNNEST(CAST(:uids AS uuid[])) uid
            """),
            {"user_id": user_id, "uids": aliases[:2]},
        )

        after = _metadata_rows(session, query, target_artist_id, user_id=user_id)

        assert any(row["id"] == liked_track_id and row["is_liked"] for row in after)
        assert len({row["id"] for row in after}) == len(after)
        assert after == [
            {**row, "is_liked": row["id"] == liked_track_id} for row in before
        ]

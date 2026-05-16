"""Tests for paths query modules."""

import pytest

from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


class TestPathsShared:
    def test_array_distance_sql_contains_key_elements(self):
        from crate.db.queries.paths_shared import array_distance_sql

        sql = array_distance_sql("t.bliss_vector")
        assert "SQRT" in sql
        assert "UNNEST" in sql
        assert "probe_array" in sql
        assert "t.bliss_vector" in sql


class TestPathsArtistGraphQueries:
    def test_load_artist_similarity_graph_empty(self, pg_db):
        from crate.db.queries.paths_artist_graph_queries import (
            load_artist_similarity_graph,
        )

        graph = load_artist_similarity_graph()
        assert graph == {}

    def test_load_artist_similarity_graph_with_data(self, pg_db):
        from crate.db.queries.paths_artist_graph_queries import (
            load_artist_similarity_graph,
        )
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        with transaction_scope() as session:
            session.execute(
                text(
                    "INSERT INTO artist_similarities (artist_name, similar_name, score, updated_at) VALUES (:a, :b, :s, NOW())"
                ),
                {"a": "Radiohead", "b": "Thom Yorke", "s": 0.9},
            )

        graph = load_artist_similarity_graph()
        assert "radiohead" in graph
        assert "thom yorke" in graph
        assert graph["radiohead"]["thom yorke"] == 0.9

    def test_load_shared_members_graph_empty(self, pg_db):
        from crate.db.queries.paths_artist_graph_queries import (
            load_shared_members_graph,
        )

        graph = load_shared_members_graph()
        assert graph == {}

    def test_load_shared_members_graph_with_data(self, pg_db):
        from crate.db.queries.paths_artist_graph_queries import (
            load_shared_members_graph,
        )
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        pg_db.upsert_artist({"name": "Band A"})
        pg_db.upsert_artist({"name": "Band B"})
        with transaction_scope() as session:
            session.execute(
                text(
                    "UPDATE library_artists SET members_json = :mj WHERE name = 'Band A'"
                ),
                {"mj": '[{"name": "Member 1"}, {"name": "Member 2"}]'},
            )
            session.execute(
                text(
                    "UPDATE library_artists SET members_json = :mj WHERE name = 'Band B'"
                ),
                {"mj": '[{"name": "Member 1"}]'},
            )

        graph = load_shared_members_graph()
        assert "band a" in graph
        assert "band b" in graph
        assert graph["band a"] == {"band b"}

    def test_load_artist_genres_empty(self, pg_db):
        from crate.db.queries.paths_artist_graph_queries import load_artist_genres

        genres = load_artist_genres()
        assert genres == {}

    def test_load_artist_genres_with_data(self, pg_db):
        from crate.db.queries.paths_artist_graph_queries import load_artist_genres

        pg_db.upsert_artist({"name": "Genre Artist"})
        pg_db.set_artist_genres("Genre Artist", [("post-punk", 0.9, "test")])

        genres = load_artist_genres()
        assert "genre artist" in genres
        assert "post-punk" in genres["genre artist"]

    def test_load_artist_radio_graphs_combined(self, pg_db):
        from crate.db.queries.paths_artist_graph_queries import load_artist_radio_graphs

        similarity_graph, genres_graph, members_graph = load_artist_radio_graphs()
        assert isinstance(similarity_graph, dict)
        assert isinstance(genres_graph, dict)
        assert isinstance(members_graph, dict)


class TestPathsStoreQueries:
    def test_get_music_path_row_not_found(self, pg_db):
        from crate.db.queries.paths_store_queries import get_music_path_row

        assert get_music_path_row(99999, 1) is None

    def test_get_music_path_row_returns_path(self, pg_db):
        from crate.db.queries.paths_store_queries import get_music_path_row
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        with transaction_scope() as session:
            session.execute(
                text(
                    """
                    INSERT INTO music_paths (user_id, name, origin_type, origin_value, origin_label, dest_type, dest_value, dest_label, waypoints, step_count, tracks)
                    VALUES (:uid, :name, 'artist', '1', 'Artist A', 'artist', '2', 'Artist B', '[]', 3, '[]')
                    """
                ),
                {"uid": 1, "name": "Test Path"},
            )
            row = (
                session.execute(
                    text("SELECT id FROM music_paths WHERE name = 'Test Path'")
                )
                .mappings()
                .first()
            )
            path_id = row["id"]

        result = get_music_path_row(path_id, 1)
        assert result is not None
        assert result["name"] == "Test Path"
        assert result["origin_type"] == "artist"

    def test_get_music_path_row_wrong_user(self, pg_db):
        from crate.db.queries.paths_store_queries import get_music_path_row
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        with transaction_scope() as session:
            session.execute(
                text(
                    "INSERT INTO music_paths (user_id, name, origin_type, origin_value, origin_label, dest_type, dest_value, dest_label, waypoints, step_count, tracks) VALUES (:uid, 'Path', 'artist', '1', 'A', 'artist', '2', 'B', '[]', 3, '[]')"
                ),
                {"uid": 1},
            )
            row = (
                session.execute(text("SELECT id FROM music_paths WHERE name = 'Path'"))
                .mappings()
                .first()
            )
            path_id = row["id"]

        assert get_music_path_row(path_id, 2) is None

    def test_list_music_path_rows_empty(self, pg_db):
        from crate.db.queries.paths_store_queries import list_music_path_rows

        assert list_music_path_rows(1) == []

    def test_list_music_path_rows_returns_paths(self, pg_db):
        from crate.db.queries.paths_store_queries import list_music_path_rows
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        with transaction_scope() as session:
            session.execute(
                text(
                    "INSERT INTO music_paths (user_id, name, origin_type, origin_value, origin_label, dest_type, dest_value, dest_label, waypoints, step_count, tracks) VALUES (:uid, 'Path 1', 'artist', '1', 'A', 'artist', '2', 'B', '[]', 3, '[]')"
                ),
                {"uid": 1},
            )

        paths = list_music_path_rows(1)
        assert len(paths) == 1
        assert paths[0]["name"] == "Path 1"


class TestPathsEndpointQueries:
    def test_fetch_bliss_vectors_for_endpoint_track_not_found(self, pg_db):
        from crate.db.queries.paths_endpoint_queries import (
            fetch_bliss_vectors_for_endpoint,
        )

        assert fetch_bliss_vectors_for_endpoint("track", "99999") == []

    def test_fetch_bliss_vectors_for_endpoint_album_not_found(self, pg_db):
        from crate.db.queries.paths_endpoint_queries import (
            fetch_bliss_vectors_for_endpoint,
        )

        assert fetch_bliss_vectors_for_endpoint("album", "99999") == []

    def test_fetch_bliss_vectors_for_endpoint_artist_not_found(self, pg_db):
        from crate.db.queries.paths_endpoint_queries import (
            fetch_bliss_vectors_for_endpoint,
        )

        assert fetch_bliss_vectors_for_endpoint("artist", "99999") == []

    def test_fetch_bliss_vectors_for_endpoint_genre_not_found(self, pg_db):
        from crate.db.queries.paths_endpoint_queries import (
            fetch_bliss_vectors_for_endpoint,
        )

        assert fetch_bliss_vectors_for_endpoint("genre", "nonexistent-slug") == []

    def test_fetch_bliss_vectors_for_endpoint_unknown_type(self, pg_db):
        from crate.db.queries.paths_endpoint_queries import (
            fetch_bliss_vectors_for_endpoint,
        )

        assert fetch_bliss_vectors_for_endpoint("unknown", "1") == []

    def test_resolve_endpoint_label_track_not_found(self, pg_db):
        from crate.db.queries.paths_endpoint_queries import resolve_endpoint_label

        assert resolve_endpoint_label("track", "99999") == "99999"

    def test_resolve_endpoint_label_album_not_found(self, pg_db):
        from crate.db.queries.paths_endpoint_queries import resolve_endpoint_label

        assert resolve_endpoint_label("album", "99999") == "99999"

    def test_resolve_endpoint_label_artist_not_found(self, pg_db):
        from crate.db.queries.paths_endpoint_queries import resolve_endpoint_label

        assert resolve_endpoint_label("artist", "99999") == "99999"

    def test_resolve_endpoint_label_genre_not_found(self, pg_db):
        from crate.db.queries.paths_endpoint_queries import resolve_endpoint_label

        assert resolve_endpoint_label("genre", "does-not-exist") == "does-not-exist"

    def test_resolve_endpoint_label_artist_found(self, pg_db):
        from crate.db.queries.paths_endpoint_queries import resolve_endpoint_label
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        pg_db.upsert_artist({"name": "Label Artist"})
        with transaction_scope() as session:
            row = (
                session.execute(
                    text("SELECT id FROM library_artists WHERE name = 'Label Artist'")
                )
                .mappings()
                .first()
            )
            artist_id = str(row["id"])

        result = resolve_endpoint_label("artist", artist_id)
        assert result == "Label Artist"

    def test_resolve_endpoint_label_album_found(self, pg_db):
        from crate.db.queries.paths_endpoint_queries import resolve_endpoint_label

        pg_db.upsert_artist({"name": "Album Label Artist"})
        album_id = pg_db.upsert_album(
            {
                "artist": "Album Label Artist",
                "name": "Album Label Album",
                "path": "/music/album-label-artist/album-label-album",
                "track_count": 1,
                "total_size": 1000,
                "total_duration": 180.0,
                "formats": ["flac"],
            }
        )

        result = resolve_endpoint_label("album", str(album_id))
        assert "Album Label Album" in result

    def test_resolve_endpoint_label_track_found(self, pg_db):
        from crate.db.queries.paths_endpoint_queries import resolve_endpoint_label
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        pg_db.upsert_artist({"name": "Track Label Artist"})
        album_id = pg_db.upsert_album(
            {
                "artist": "Track Label Artist",
                "name": "Track Label Album",
                "path": "/music/track-label-artist/track-label-album",
                "track_count": 1,
                "total_size": 1000,
                "total_duration": 180.0,
                "formats": ["flac"],
            }
        )
        pg_db.upsert_track(
            {
                "album_id": album_id,
                "artist": "Track Label Artist",
                "album": "Track Label Album",
                "filename": "01-label.flac",
                "title": "Label Track",
                "path": "/music/track-label-artist/track-label-album/01-label.flac",
                "duration": 180.0,
                "size": 1000,
                "format": "flac",
            }
        )

        with transaction_scope() as session:
            row = (
                session.execute(
                    text("SELECT id FROM library_tracks WHERE title = 'Label Track'")
                )
                .mappings()
                .first()
            )
            track_id = str(row["id"])

        result = resolve_endpoint_label("track", track_id)
        assert "Label Track" in result

    def test_fetch_bliss_vectors_for_endpoint_track_with_vector(self, pg_db):
        from crate.db.queries.paths_endpoint_queries import (
            fetch_bliss_vectors_for_endpoint,
        )
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        pg_db.upsert_artist({"name": "Bliss Track Artist"})
        album_id = pg_db.upsert_album(
            {
                "artist": "Bliss Track Artist",
                "name": "Bliss Album",
                "path": "/music/bliss-track-artist/bliss-album",
                "track_count": 1,
                "total_size": 1000,
                "total_duration": 180.0,
                "formats": ["flac"],
            }
        )
        pg_db.upsert_track(
            {
                "album_id": album_id,
                "artist": "Bliss Track Artist",
                "album": "Bliss Album",
                "filename": "01-bliss.flac",
                "title": "Bliss T",
                "path": "/music/bliss-track-artist/bliss-album/01-bliss.flac",
                "duration": 180.0,
                "size": 1000,
                "format": "flac",
            }
        )

        bliss_vec = [0.1] * 20
        with transaction_scope() as session:
            session.execute(
                text(
                    "UPDATE library_tracks SET bliss_vector = :bv WHERE title = 'Bliss T'"
                ),
                {"bv": bliss_vec},
            )
            row = (
                session.execute(
                    text("SELECT id FROM library_tracks WHERE title = 'Bliss T'")
                )
                .mappings()
                .first()
            )
            track_id = str(row["id"])

        vectors = fetch_bliss_vectors_for_endpoint("track", track_id)
        assert len(vectors) == 1
        assert vectors[0] == bliss_vec

    def test_fetch_bliss_vectors_for_endpoint_genre_with_data(self, pg_db):
        from crate.db.queries.paths_endpoint_queries import (
            fetch_bliss_vectors_for_endpoint,
        )
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        pg_db.upsert_artist({"name": "Genre Bliss Artist"})
        album_id = pg_db.upsert_album(
            {
                "artist": "Genre Bliss Artist",
                "name": "Genre Bliss Album",
                "path": "/music/genre-bliss-artist/genre-bliss-album",
                "track_count": 1,
                "total_size": 1000,
                "total_duration": 180.0,
                "formats": ["flac"],
            }
        )
        pg_db.upsert_track(
            {
                "album_id": album_id,
                "artist": "Genre Bliss Artist",
                "album": "Genre Bliss Album",
                "filename": "01-g.bliss.flac",
                "title": "G Bliss T",
                "path": "/music/genre-bliss-artist/genre-bliss-album/01-g.bliss.flac",
                "duration": 180.0,
                "size": 1000,
                "format": "flac",
            }
        )

        bliss_vec = [0.2] * 20
        pg_db.set_artist_genres("Genre Bliss Artist", [("post-punk", 0.9, "test")])

        with transaction_scope() as session:
            session.execute(
                text(
                    "UPDATE library_tracks SET bliss_vector = :bv WHERE title = 'G Bliss T'"
                ),
                {"bv": bliss_vec},
            )

        vectors = fetch_bliss_vectors_for_endpoint("genre", "post-punk")
        assert len(vectors) >= 1
        assert vectors[0] == bliss_vec

    def test_resolve_endpoint_label_genre_found(self, pg_db):
        from crate.db.queries.paths_endpoint_queries import resolve_endpoint_label

        result = resolve_endpoint_label("genre", "post-punk")
        assert result.lower() == "post-punk"


class TestPathsBlissCandidateQueries:
    def test_find_anchor_track_row_track_not_found(self, pg_db):
        from crate.db.queries.paths_bliss_candidate_queries import find_anchor_track_row

        result = find_anchor_track_row("track", "99999", [0.1] * 20, set())
        assert result is None

    def test_find_candidate_rows_empty(self, pg_db):
        from crate.db.queries.paths_bliss_candidate_queries import find_candidate_rows

        rows = find_candidate_rows([0.1] * 20, set(), limit=10)
        assert rows == []

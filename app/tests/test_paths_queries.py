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

    def test_candidate_queries_exclude_hidden_and_quarantined_tracks(self, pg_db):
        from crate.db.queries.paths_bliss_candidate_queries import (
            find_anchor_track_row,
            find_candidate_rows,
            find_seeded_radio_candidate_rows,
        )
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        pg_db.upsert_artist({"name": "Paths Clean"})
        clean_album_id = pg_db.upsert_album(
            {
                "artist": "Paths Clean",
                "name": "Paths Clean Album",
                "path": "/music/Paths Clean/Paths Clean Album",
                "track_count": 1,
                "total_size": 1000,
                "total_duration": 180.0,
                "formats": ["flac"],
            }
        )
        clean_path = "/music/Paths Clean/Paths Clean Album/01-clean.flac"
        pg_db.upsert_track(
            {
                "album_id": clean_album_id,
                "artist": "Paths Clean",
                "album": "Paths Clean Album",
                "filename": "01-clean.flac",
                "title": "Paths Clean Track",
                "path": clean_path,
                "duration": 180.0,
                "size": 1000,
                "format": "flac",
            }
        )

        pg_db.upsert_artist({"name": ".crate-trash"})
        hidden_album_id = pg_db.upsert_album(
            {
                "artist": ".crate-trash",
                "name": ".crate-trash",
                "path": "/music/.crate-trash/Paths Hidden",
                "track_count": 1,
                "total_size": 1000,
                "total_duration": 180.0,
                "formats": ["flac"],
            }
        )
        hidden_path = "/music/.crate-trash/Paths Hidden/01-hidden.flac"
        pg_db.upsert_track(
            {
                "album_id": hidden_album_id,
                "artist": ".crate-trash",
                "album": ".crate-trash",
                "filename": "01-hidden.flac",
                "title": "Paths Hidden Track",
                "path": hidden_path,
                "duration": 180.0,
                "size": 1000,
                "format": "flac",
            }
        )

        pg_db.upsert_artist({"name": "Paths Quarantine"})
        quarantine_album_id = pg_db.upsert_album(
            {
                "artist": "Paths Quarantine",
                "name": "Paths Quarantine Album",
                "path": "/music/Paths Quarantine/Paths Quarantine Album",
                "track_count": 1,
                "total_size": 1000,
                "total_duration": 180.0,
                "formats": ["flac"],
            }
        )
        quarantine_path = "/music/Paths Quarantine/Paths Quarantine Album/01-skip.flac"
        pg_db.upsert_track(
            {
                "album_id": quarantine_album_id,
                "artist": "Paths Quarantine",
                "album": "Paths Quarantine Album",
                "filename": "01-skip.flac",
                "title": "Paths Quarantine Track",
                "path": quarantine_path,
                "duration": 180.0,
                "size": 1000,
                "format": "flac",
            }
        )

        with transaction_scope() as session:
            rows = (
                session.execute(
                    text(
                        """
                        SELECT id, path
                        FROM library_tracks
                        WHERE path = ANY(:paths)
                        """
                    ),
                    {"paths": [clean_path, hidden_path, quarantine_path]},
                )
                .mappings()
                .all()
            )
            ids_by_path = {row["path"]: row["id"] for row in rows}
            session.execute(
                text(
                    "UPDATE library_tracks SET bliss_vector = :bv WHERE path = ANY(:paths)"
                ),
                {
                    "bv": [0.2] * 20,
                    "paths": [clean_path, hidden_path, quarantine_path],
                },
            )
            session.execute(
                text("UPDATE library_albums SET quarantined_at = NOW() WHERE id = :id"),
                {"id": quarantine_album_id},
            )

        rows = find_candidate_rows([0.1] * 20, set(), limit=10)
        seeded_rows = find_seeded_radio_candidate_rows(
            [0.1] * 20,
            set(),
            seed_artists=["Paths Clean", ".crate-trash", "Paths Quarantine"],
            limit=10,
        )

        row_ids = {row["id"] for row in rows}
        seeded_ids = {row["id"] for row in seeded_rows}

        assert ids_by_path[clean_path] in row_ids
        assert ids_by_path[hidden_path] not in row_ids
        assert ids_by_path[quarantine_path] not in row_ids
        assert ids_by_path[clean_path] in seeded_ids
        assert ids_by_path[hidden_path] not in seeded_ids
        assert ids_by_path[quarantine_path] not in seeded_ids
        assert (
            find_anchor_track_row(
                "track", str(ids_by_path[hidden_path]), [0.1] * 20, set()
            )
            is None
        )


class TestPathsSceneCandidateQueries:
    def test_get_artist_scene_profile_resolves_by_id_and_sorts_genres(self, pg_db):
        from crate.db.queries.paths_scene_queries import get_artist_scene_profile
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        pg_db.upsert_artist({"name": "Profile Artist"})
        pg_db.set_artist_genres(
            "Profile Artist",
            [
                ("rock", 0.64, "test"),
                ("classic rock", 1.0, "test"),
                ("british", 0.76, "test"),
            ],
        )

        with transaction_scope() as session:
            session.execute(
                text(
                    """
                    UPDATE library_artists
                    SET country = 'GB', area = 'Liverpool', formed = '1960'
                    WHERE name = 'Profile Artist'
                    """
                )
            )
            row = (
                session.execute(
                    text("SELECT id FROM library_artists WHERE name = 'Profile Artist'")
                )
                .mappings()
                .first()
            )

        profile = get_artist_scene_profile(str(row["id"]))

        assert profile is not None
        assert profile["name"] == "Profile Artist"
        assert [genre["slug"] for genre in profile["genres"]] == [
            "rock",
            "british",
        ]
        assert profile["country"] == "GB"
        assert profile["area"] == "Liverpool"
        assert profile["formed"] == "1960"
        assert profile["genres"][0]["raw_slug"] == "classic-rock"

    def test_list_artist_scene_anchor_candidates_uses_artist_scope_and_user_signal(
        self, pg_db
    ):
        from crate.db.queries.paths_scene_queries import (
            list_artist_scene_anchor_candidates,
        )
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        pg_db.upsert_artist({"name": "Anchor Artist"})
        album_id = pg_db.upsert_album(
            {
                "artist": "Anchor Artist",
                "name": "Anchor Album",
                "path": "/music/Anchor Artist/Anchor Album",
                "track_count": 2,
                "total_size": 2000,
                "total_duration": 360.0,
                "formats": ["flac"],
            }
        )
        pg_db.upsert_track(
            {
                "album_id": album_id,
                "artist": "Anchor Artist",
                "album": "Anchor Album",
                "filename": "01-canonical.flac",
                "title": "Canonical Song",
                "path": "/music/Anchor Artist/Anchor Album/01-canonical.flac",
                "duration": 180.0,
                "size": 1000,
                "format": "flac",
            }
        )
        pg_db.upsert_track(
            {
                "album_id": album_id,
                "artist": "Anchor Artist",
                "album": "Anchor Album",
                "filename": "02-personal.flac",
                "title": "Personal Deep Cut",
                "path": "/music/Anchor Artist/Anchor Album/02-personal.flac",
                "duration": 180.0,
                "size": 1000,
                "format": "flac",
            }
        )
        pg_db.set_artist_genres("Anchor Artist", [("punk", 0.98, "test")])

        with transaction_scope() as session:
            session.execute(
                text(
                    """
                    UPDATE library_artists
                    SET listeners = 1000000, popularity_score = 0.75
                    WHERE name = 'Anchor Artist'
                    """
                )
            )
            session.execute(
                text(
                    """
                    UPDATE library_tracks
                    SET bliss_vector = CAST(:vector AS DOUBLE PRECISION[]),
                        popularity_score = CASE
                            WHEN title = 'Canonical Song' THEN 0.95
                            ELSE 0.45
                        END
                    WHERE album_id = :album_id
                    """
                ),
                {"album_id": album_id, "vector": [0.1] * 20},
            )
            personal = (
                session.execute(
                    text(
                        "SELECT id FROM library_tracks WHERE title = 'Personal Deep Cut'"
                    )
                )
                .mappings()
                .first()
            )
            session.execute(
                text(
                    """
                    INSERT INTO user_track_stats (
                        user_id, stat_window, entity_key, track_id, title, artist,
                        album, play_count, complete_play_count, minutes_listened
                    )
                    VALUES (
                        1, 'all_time', 'track:' || CAST(:track_id AS text),
                        :track_id, 'Personal Deep Cut', 'Anchor Artist',
                        'Anchor Album', 18, 18, 54
                    )
                    ON CONFLICT (user_id, stat_window, entity_key) DO UPDATE
                    SET play_count = EXCLUDED.play_count
                    """
                ),
                {"track_id": personal["id"]},
            )

        rows = list_artist_scene_anchor_candidates("Anchor Artist", user_id=1)

        assert [row["artist"] for row in rows] == ["Anchor Artist", "Anchor Artist"]
        assert rows[0]["title"] == "Personal Deep Cut"
        assert rows[0]["user_play_count"] == 18
        assert rows[0]["membership_score"] == 1.0

    def test_list_scene_path_candidates_downweights_taxonomy_alias_membership(
        self, pg_db
    ):
        from crate.db.queries.paths_scene_queries import list_scene_path_candidates
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        direct_artist = "Canonical Punk Artist"
        alias_artist = "Ska Adjacent Punk Artist"
        pg_db.upsert_artist({"name": direct_artist})
        pg_db.upsert_artist({"name": alias_artist})
        direct_album_id = pg_db.upsert_album(
            {
                "artist": direct_artist,
                "name": "Direct Album",
                "path": f"/music/{direct_artist}/Direct Album",
                "track_count": 1,
                "total_size": 1000,
                "total_duration": 180.0,
                "formats": ["flac"],
            }
        )
        alias_album_id = pg_db.upsert_album(
            {
                "artist": alias_artist,
                "name": "Alias Album",
                "path": f"/music/{alias_artist}/Alias Album",
                "track_count": 1,
                "total_size": 1000,
                "total_duration": 180.0,
                "formats": ["flac"],
            }
        )
        pg_db.upsert_track(
            {
                "album_id": direct_album_id,
                "artist": direct_artist,
                "album": "Direct Album",
                "filename": "01-direct.flac",
                "title": "Direct Song",
                "path": f"/music/{direct_artist}/Direct Album/01-direct.flac",
                "duration": 180.0,
                "size": 1000,
                "format": "flac",
            }
        )
        pg_db.upsert_track(
            {
                "album_id": alias_album_id,
                "artist": alias_artist,
                "album": "Alias Album",
                "filename": "01-alias.flac",
                "title": "Alias Song",
                "path": f"/music/{alias_artist}/Alias Album/01-alias.flac",
                "duration": 180.0,
                "size": 1000,
                "format": "flac",
            }
        )
        pg_db.set_artist_genres(direct_artist, [("punk", 1.0, "test")])
        pg_db.set_artist_genres(
            alias_artist,
            [("ska", 1.0, "test"), ("punk", 0.76, "test")],
        )

        with transaction_scope() as session:
            session.execute(
                text(
                    """
                    INSERT INTO genre_taxonomy_nodes (slug, name)
                    VALUES ('punk', 'punk')
                    ON CONFLICT (slug) DO NOTHING
                    """
                )
            )
            session.execute(
                text(
                    """
                    INSERT INTO genre_taxonomy_aliases (alias_slug, alias_name, genre_id)
                    SELECT 'ska', 'ska', id
                    FROM genre_taxonomy_nodes
                    WHERE slug = 'punk'
                    ON CONFLICT (alias_slug) DO UPDATE
                    SET alias_name = EXCLUDED.alias_name,
                        genre_id = EXCLUDED.genre_id
                    """
                )
            )
            session.execute(
                text(
                    """
                    UPDATE library_tracks
                    SET bliss_vector = CAST(:vector AS DOUBLE PRECISION[]),
                        popularity_score = 0.8
                    WHERE album_id IN (:direct_album_id, :alias_album_id)
                    """
                ),
                {
                    "direct_album_id": direct_album_id,
                    "alias_album_id": alias_album_id,
                    "vector": [0.1] * 20,
                },
            )

        rows_by_genre = list_scene_path_candidates(["punk"], limit_per_genre=20)
        rows_by_artist = {
            row["artist"]: row for row in rows_by_genre["punk"]
        }

        assert rows_by_artist[direct_artist]["membership_score"] == 1.0
        assert rows_by_artist[alias_artist]["membership_score"] == 0.76

    def test_list_scene_path_candidates_limits_tracks_per_artist(self, pg_db):
        from crate.db.queries.paths_scene_queries import list_scene_path_candidates
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        dominant_artist = "Dominant Punk Artist"
        other_artist = "Other Punk Artist"
        pg_db.upsert_artist({"name": dominant_artist})
        pg_db.upsert_artist({"name": other_artist})
        dominant_album_id = pg_db.upsert_album(
            {
                "artist": dominant_artist,
                "name": "Dominant Album",
                "path": f"/music/{dominant_artist}/Dominant Album",
                "track_count": 8,
                "total_size": 8000,
                "total_duration": 1440.0,
                "formats": ["flac"],
            }
        )
        other_album_id = pg_db.upsert_album(
            {
                "artist": other_artist,
                "name": "Other Album",
                "path": f"/music/{other_artist}/Other Album",
                "track_count": 1,
                "total_size": 1000,
                "total_duration": 180.0,
                "formats": ["flac"],
            }
        )
        for index in range(8):
            pg_db.upsert_track(
                {
                    "album_id": dominant_album_id,
                    "artist": dominant_artist,
                    "album": "Dominant Album",
                    "filename": f"{index + 1:02d}-dominant.flac",
                    "title": f"Dominant Song {index + 1}",
                    "path": f"/music/{dominant_artist}/Dominant Album/{index + 1:02d}.flac",
                    "duration": 180.0,
                    "size": 1000,
                    "format": "flac",
                }
            )
        pg_db.upsert_track(
            {
                "album_id": other_album_id,
                "artist": other_artist,
                "album": "Other Album",
                "filename": "01-other.flac",
                "title": "Other Song",
                "path": f"/music/{other_artist}/Other Album/01-other.flac",
                "duration": 180.0,
                "size": 1000,
                "format": "flac",
            }
        )
        pg_db.set_artist_genres(
            dominant_artist,
            [("punk", 0.98, "test")],
        )
        pg_db.set_artist_genres(other_artist, [("punk", 0.9, "test")])

        with transaction_scope() as session:
            session.execute(
                text(
                    """
                    UPDATE library_artists
                    SET popularity_score = CASE
                            WHEN name = :dominant_artist THEN 0.95
                            ELSE 0.2
                        END,
                        listeners = CASE
                            WHEN name = :dominant_artist THEN 5000000
                            ELSE 50000
                        END
                    WHERE name IN (:dominant_artist, :other_artist)
                    """
                ),
                {
                    "dominant_artist": dominant_artist,
                    "other_artist": other_artist,
                },
            )
            session.execute(
                text(
                    """
                    UPDATE library_tracks
                    SET bliss_vector = CAST(:vector AS DOUBLE PRECISION[]),
                        popularity_score = 0.8,
                        lastfm_playcount = 100000
                    WHERE album_id IN (:dominant_album_id, :other_album_id)
                    """
                ),
                {
                    "dominant_album_id": dominant_album_id,
                    "other_album_id": other_album_id,
                    "vector": [0.1] * 20,
                },
            )

        rows_by_genre = list_scene_path_candidates(["punk"], limit_per_genre=4)
        artists = {row["artist"] for row in rows_by_genre["punk"]}

        assert dominant_artist in artists
        assert other_artist in artists

    def test_list_scene_path_candidates_includes_genre_and_user_signals(self, pg_db):
        from crate.db.queries.paths_scene_queries import list_scene_path_candidates
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        pg_db.upsert_artist({"name": "The Clash"})
        album_id = pg_db.upsert_album(
            {
                "artist": "The Clash",
                "name": "London Calling",
                "path": "/music/The Clash/London Calling",
                "track_count": 2,
                "total_size": 1000,
                "total_duration": 360.0,
                "formats": ["flac"],
            }
        )
        pg_db.upsert_track(
            {
                "album_id": album_id,
                "artist": "The Clash",
                "album": "London Calling",
                "filename": "01-london-calling.flac",
                "title": "London Calling",
                "path": "/music/The Clash/London Calling/01-london-calling.flac",
                "duration": 180.0,
                "size": 1000,
                "format": "flac",
            }
        )
        pg_db.upsert_track(
            {
                "album_id": album_id,
                "artist": "The Clash",
                "album": "London Calling",
                "filename": "02-stay-free.flac",
                "title": "Stay Free",
                "path": "/music/The Clash/London Calling/02-stay-free.flac",
                "duration": 180.0,
                "size": 1000,
                "format": "flac",
            }
        )
        pg_db.set_artist_genres("The Clash", [("punk", 0.98, "test")])

        with transaction_scope() as session:
            session.execute(
                text(
                    """
                    UPDATE library_artists
                    SET listeners = 5000000, popularity_score = 0.8
                    WHERE name = 'The Clash'
                    """
                )
            )
            session.execute(
                text(
                    """
                    UPDATE library_tracks
                    SET bliss_vector = CAST(:vector AS DOUBLE PRECISION[]),
                        popularity_score = CASE
                            WHEN title = 'London Calling' THEN 0.95
                            ELSE 0.55
                        END,
                        lastfm_playcount = CASE
                            WHEN title = 'London Calling' THEN 5000000
                            ELSE 250000
                        END
                    WHERE album_id = :album_id
                    """
                ),
                {"album_id": album_id, "vector": [0.1] * 20},
            )
            stay_free = (
                session.execute(
                    text("SELECT id FROM library_tracks WHERE title = 'Stay Free'")
                )
                .mappings()
                .first()
            )
            session.execute(
                text(
                    """
                    INSERT INTO user_track_stats (
                        user_id, stat_window, entity_key, track_id, title, artist,
                        album, play_count, complete_play_count, minutes_listened
                    )
                    VALUES (
                        1, 'all_time', 'track:' || CAST(:track_id AS text),
                        :track_id, 'Stay Free', 'The Clash', 'London Calling',
                        20, 20, 60
                    )
                    ON CONFLICT (user_id, stat_window, entity_key) DO UPDATE
                    SET play_count = EXCLUDED.play_count
                    """
                ),
                {"track_id": stay_free["id"]},
            )

        rows_by_genre = list_scene_path_candidates(["punk"], user_id=1)
        rows = rows_by_genre["punk"]
        stay_free_row = next(row for row in rows if row["title"] == "Stay Free")

        assert stay_free_row["membership_score"] == 0.98
        assert stay_free_row["artist_popularity_score"] == 0.8
        assert stay_free_row["track_popularity_score"] == 0.55
        assert stay_free_row["user_play_count"] == 20
        assert stay_free_row["artist_genre_slugs"] == ["punk"]

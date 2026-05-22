"""Tests for radio query modules."""

import pytest

from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


class TestRadioLibraryQueries:
    def test_get_track_path_by_id_not_found(self, pg_db):
        from crate.db.queries.radio_library_queries import get_track_path_by_id

        assert get_track_path_by_id(99999) is None

    def test_get_track_path_by_id_found(self, pg_db):
        from crate.db.queries.radio_library_queries import get_track_path_by_id

        pg_db.upsert_artist({"name": "Radio Artist"})
        album_id = pg_db.upsert_album(
            {
                "artist": "Radio Artist",
                "name": "Radio Album",
                "path": "/music/Radio Artist/Radio Album",
                "track_count": 1,
                "total_size": 1000,
                "total_duration": 180.0,
                "formats": ["flac"],
            }
        )
        track_path = "/music/Radio Artist/Radio Album/01-radio-test.flac"
        pg_db.upsert_track(
            {
                "album_id": album_id,
                "artist": "Radio Artist",
                "album": "Radio Album",
                "filename": "01-radio-test.flac",
                "title": "Radio Track",
                "path": track_path,
                "duration": 180.0,
                "size": 1000,
                "format": "flac",
            }
        )

        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        with transaction_scope() as session:
            row = (
                session.execute(
                    text("SELECT id FROM library_tracks WHERE path = :p"),
                    {"p": track_path},
                )
                .mappings()
                .first()
            )

        result = get_track_path_by_id(row["id"])
        assert result == track_path

    def test_get_track_path_by_pattern_not_found(self, pg_db):
        from crate.db.queries.radio_library_queries import get_track_path_by_pattern

        assert get_track_path_by_pattern("/nonexistent.flac", "%") is None

    def test_get_album_for_radio_not_found(self, pg_db):
        from crate.db.queries.radio_library_queries import get_album_for_radio

        assert get_album_for_radio(99999) is None

    def test_get_album_for_radio_found(self, pg_db):
        from crate.db.queries.radio_library_queries import get_album_for_radio

        pg_db.upsert_artist({"name": "Radio Album Artist"})
        album_id = pg_db.upsert_album(
            {
                "artist": "Radio Album Artist",
                "name": "Radio Target Album",
                "path": "/music/Radio Album Artist/Radio Target Album",
                "track_count": 1,
                "total_size": 1000,
                "total_duration": 180.0,
                "formats": ["flac"],
            }
        )

        result = get_album_for_radio(album_id)
        assert result is not None
        assert result["name"] == "Radio Target Album"

    def test_get_playlist_for_radio_not_found(self, pg_db):
        from crate.db.queries.radio_library_queries import get_playlist_for_radio

        assert get_playlist_for_radio(99999) is None

    def test_get_playlist_for_radio_found(self, pg_db):
        from crate.db.queries.radio_library_queries import get_playlist_for_radio
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        with transaction_scope() as session:
            session.execute(
                text(
                    "INSERT INTO playlists (name, scope, user_id, is_active, created_at, updated_at) VALUES ('Radio PL', 'user', 1, true, NOW(), NOW())"
                )
            )
            row = (
                session.execute(
                    text("SELECT id FROM playlists WHERE name = 'Radio PL'")
                )
                .mappings()
                .first()
            )
            playlist_id = row["id"]

        result = get_playlist_for_radio(playlist_id)
        assert result is not None
        assert result["name"] == "Radio PL"

    def test_get_random_library_seed_rows_empty(self, pg_db):
        from crate.db.queries.radio_library_queries import get_random_library_seed_rows

        rows = get_random_library_seed_rows(limit=10)
        assert rows == []

    def test_get_random_library_seed_rows_with_data(self, pg_db):
        from crate.db.queries.radio_library_queries import get_random_library_seed_rows
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        pg_db.upsert_artist({"name": "Seed Artist"})
        album_id = pg_db.upsert_album(
            {
                "artist": "Seed Artist",
                "name": "Seed Album",
                "path": "/music/Seed Artist/Seed Album",
                "track_count": 1,
                "total_size": 1000,
                "total_duration": 180.0,
                "formats": ["flac"],
            }
        )
        pg_db.upsert_track(
            {
                "album_id": album_id,
                "artist": "Seed Artist",
                "album": "Seed Album",
                "filename": "01-seed.flac",
                "title": "Seed Track",
                "path": "/music/Seed Artist/Seed Album/01-seed.flac",
                "duration": 180.0,
                "size": 1000,
                "format": "flac",
            }
        )

        bliss_vec = [0.3] * 20
        with transaction_scope() as session:
            session.execute(
                text(
                    "UPDATE library_tracks SET bliss_vector = :bv WHERE title = 'Seed Track'"
                ),
                {"bv": bliss_vec},
            )

        rows = get_random_library_seed_rows(limit=5)
        assert len(rows) >= 1
        assert "track_id" in rows[0]
        assert "artist" in rows[0]
        assert "bliss_vector" in rows[0]

    def test_get_random_library_vectors_empty(self, pg_db):
        from crate.db.queries.radio_library_queries import get_random_library_vectors

        assert get_random_library_vectors(limit=10) == []

    def test_get_track_bliss_vector_not_found(self, pg_db):
        from crate.db.queries.radio_library_queries import get_track_bliss_vector

        assert get_track_bliss_vector(99999) is None

    def test_get_track_bliss_vector_found(self, pg_db):
        from crate.db.queries.radio_library_queries import get_track_bliss_vector
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        pg_db.upsert_artist({"name": "Bliss Vec Artist"})
        album_id = pg_db.upsert_album(
            {
                "artist": "Bliss Vec Artist",
                "name": "Bliss Vec Album",
                "path": "/music/Bliss Vec Artist/Bliss Vec Album",
                "track_count": 1,
                "total_size": 1000,
                "total_duration": 180.0,
                "formats": ["flac"],
            }
        )
        pg_db.upsert_track(
            {
                "album_id": album_id,
                "artist": "Bliss Vec Artist",
                "album": "Bliss Vec Album",
                "filename": "01-bv.flac",
                "title": "BV Track",
                "path": "/music/Bliss Vec Artist/Bliss Vec Album/01-bv.flac",
                "duration": 180.0,
                "size": 1000,
                "format": "flac",
            }
        )

        bliss_vec = [0.4] * 20
        with transaction_scope() as session:
            session.execute(
                text(
                    "UPDATE library_tracks SET bliss_vector = :bv WHERE title = 'BV Track'"
                ),
                {"bv": bliss_vec},
            )
            row = (
                session.execute(
                    text("SELECT id FROM library_tracks WHERE title = 'BV Track'")
                )
                .mappings()
                .first()
            )
            track_id = row["id"]

        result = get_track_bliss_vector(track_id)
        assert result == bliss_vec


class TestRadioUserQueries:
    def _setup_track(self, pg_db, artist_name, track_title, bliss_vec):
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        pg_db.upsert_artist({"name": artist_name})
        album_id = pg_db.upsert_album(
            {
                "artist": artist_name,
                "name": f"{track_title} Album",
                "path": f"/music/{artist_name}/{track_title} Album",
                "track_count": 1,
                "total_size": 1000,
                "total_duration": 180.0,
                "formats": ["flac"],
            }
        )
        pg_db.upsert_track(
            {
                "album_id": album_id,
                "artist": artist_name,
                "album": f"{track_title} Album",
                "filename": f"01-{track_title.lower()}.flac",
                "title": track_title,
                "path": f"/music/{artist_name}/{track_title} Album/01-{track_title.lower()}.flac",
                "duration": 180.0,
                "size": 1000,
                "format": "flac",
            }
        )
        with transaction_scope() as session:
            session.execute(
                text("UPDATE library_tracks SET bliss_vector = :bv WHERE title = :t"),
                {"bv": bliss_vec, "t": track_title},
            )
            row = (
                session.execute(
                    text("SELECT id FROM library_tracks WHERE title = :t"),
                    {"t": track_title},
                )
                .mappings()
                .first()
            )
            return row["id"]

    def test_count_user_radio_signals_empty(self, pg_db):
        from crate.db.queries.radio_user_queries import count_user_radio_signals

        signals = count_user_radio_signals(1)
        assert signals == {"likes": 0, "follows": 0, "saved_albums": 0}

    def test_get_recent_liked_seed_rows_empty(self, pg_db):
        from crate.db.queries.radio_user_queries import get_recent_liked_seed_rows

        assert get_recent_liked_seed_rows(1) == []

    def test_get_recent_liked_seed_rows_with_data(self, pg_db):
        from crate.db.queries.radio_user_queries import get_recent_liked_seed_rows
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        bliss_vec = [0.5] * 20
        track_id = self._setup_track(pg_db, "Liked Artist", "Liked Track", bliss_vec)

        with transaction_scope() as session:
            session.execute(
                text(
                    "INSERT INTO user_liked_tracks (user_id, track_id, created_at) VALUES (:uid, :tid, NOW())"
                ),
                {"uid": 1, "tid": track_id},
            )

        rows = get_recent_liked_seed_rows(1)
        assert len(rows) >= 1
        assert rows[0]["bliss_vector"] == bliss_vec

    def test_get_recent_liked_vectors_with_data(self, pg_db):
        from crate.db.queries.radio_user_queries import get_recent_liked_vectors
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        bliss_vec = [0.55] * 20
        track_id = self._setup_track(
            pg_db, "Liked V Artist", "Liked V Track", bliss_vec
        )

        with transaction_scope() as session:
            session.execute(
                text(
                    "INSERT INTO user_liked_tracks (user_id, track_id, created_at) VALUES (:uid, :tid, NOW())"
                ),
                {"uid": 1, "tid": track_id},
            )

        vectors = get_recent_liked_vectors(1)
        assert len(vectors) >= 1
        assert vectors[0] == bliss_vec

    def test_get_followed_artist_seed_rows_empty(self, pg_db):
        from crate.db.queries.radio_user_queries import get_followed_artist_seed_rows

        assert get_followed_artist_seed_rows(1) == []

    def test_get_followed_artist_seed_rows_with_data(self, pg_db):
        from crate.db.queries.radio_user_queries import get_followed_artist_seed_rows
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        bliss_vec = [0.6] * 20
        self._setup_track(pg_db, "Followed Artist", "Follow Track", bliss_vec)

        with transaction_scope() as session:
            session.execute(
                text(
                    "INSERT INTO user_follows (user_id, artist_name, created_at) VALUES (:uid, 'Followed Artist', NOW())"
                ),
                {"uid": 1},
            )

        rows = get_followed_artist_seed_rows(1)
        assert len(rows) >= 1
        assert rows[0]["artist"] == "Followed Artist"

    def test_get_followed_artist_vectors_with_data(self, pg_db):
        from crate.db.queries.radio_user_queries import get_followed_artist_vectors
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        bliss_vec = [0.65] * 20
        self._setup_track(pg_db, "Followed V Artist", "Followed V Track", bliss_vec)

        with transaction_scope() as session:
            session.execute(
                text(
                    "INSERT INTO user_follows (user_id, artist_name, created_at) VALUES (:uid, 'Followed V Artist', NOW())"
                ),
                {"uid": 1},
            )

        vectors = get_followed_artist_vectors(1)
        assert len(vectors) >= 1

    def test_get_saved_album_seed_rows_empty(self, pg_db):
        from crate.db.queries.radio_user_queries import get_saved_album_seed_rows

        assert get_saved_album_seed_rows(1) == []

    def test_get_saved_album_seed_rows_with_data(self, pg_db):
        from crate.db.queries.radio_user_queries import get_saved_album_seed_rows
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        bliss_vec = [0.7] * 20
        track_id = self._setup_track(pg_db, "Saved Artist", "Saved Track", bliss_vec)

        with transaction_scope() as session:
            row = (
                session.execute(
                    text("SELECT album_id FROM library_tracks WHERE id = :tid"),
                    {"tid": track_id},
                )
                .mappings()
                .first()
            )
            album_id = row["album_id"]
            session.execute(
                text(
                    "INSERT INTO user_saved_albums (user_id, album_id, created_at) VALUES (:uid, :aid, NOW())"
                ),
                {"uid": 1, "aid": album_id},
            )

        rows = get_saved_album_seed_rows(1)
        assert len(rows) >= 1
        assert rows[0]["bliss_vector"] == bliss_vec

    def test_get_saved_album_vectors_with_data(self, pg_db):
        from crate.db.queries.radio_user_queries import get_saved_album_vectors
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        bliss_vec = [0.75] * 20
        track_id = self._setup_track(
            pg_db, "Saved V Artist", "Saved V Track", bliss_vec
        )

        with transaction_scope() as session:
            row = (
                session.execute(
                    text("SELECT album_id FROM library_tracks WHERE id = :tid"),
                    {"tid": track_id},
                )
                .mappings()
                .first()
            )
            album_id = row["album_id"]
            session.execute(
                text(
                    "INSERT INTO user_saved_albums (user_id, album_id, created_at) VALUES (:uid, :aid, NOW())"
                ),
                {"uid": 1, "aid": album_id},
            )

        vectors = get_saved_album_vectors(1)
        assert len(vectors) >= 1

    def test_get_recent_play_seed_rows_empty(self, pg_db):
        from crate.db.queries.radio_user_queries import get_recent_play_seed_rows

        assert get_recent_play_seed_rows(1) == []

    def test_get_recent_play_seed_rows_with_data(self, pg_db):
        from crate.db.queries.radio_user_queries import get_recent_play_seed_rows
        from crate.db.tx import transaction_scope
        from sqlalchemy import text
        from datetime import datetime, timezone

        bliss_vec = [0.8] * 20
        track_id = self._setup_track(pg_db, "Play Artist", "Play Track", bliss_vec)

        with transaction_scope() as session:
            session.execute(
                text(
                    "INSERT INTO user_play_events (user_id, track_id, started_at, ended_at, created_at) VALUES (:uid, :tid, :ts, :ts, :ts)"
                ),
                {"uid": 1, "tid": track_id, "ts": datetime.now(timezone.utc)},
            )

        rows = get_recent_play_seed_rows(1)
        assert len(rows) >= 1
        assert rows[0]["bliss_vector"] == bliss_vec

    def test_get_recent_play_vectors_with_data(self, pg_db):
        from crate.db.queries.radio_user_queries import get_recent_play_vectors
        from crate.db.tx import transaction_scope
        from sqlalchemy import text
        from datetime import datetime, timezone

        bliss_vec = [0.85] * 20
        track_id = self._setup_track(pg_db, "Play V Artist", "Play V Track", bliss_vec)

        with transaction_scope() as session:
            session.execute(
                text(
                    "INSERT INTO user_play_events (user_id, track_id, started_at, ended_at, created_at) VALUES (:uid, :tid, :ts, :ts, :ts)"
                ),
                {"uid": 1, "tid": track_id, "ts": datetime.now(timezone.utc)},
            )

        vectors = get_recent_play_vectors(1)
        assert len(vectors) >= 1

    def test_count_user_radio_signals_with_data(self, pg_db):
        from crate.db.queries.radio_user_queries import count_user_radio_signals
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        with transaction_scope() as session:
            session.execute(
                text(
                    "INSERT INTO user_follows (user_id, artist_name, created_at) VALUES (:uid, 'Count Artist', NOW())"
                ),
                {"uid": 1},
            )

        signals = count_user_radio_signals(1)
        assert signals["follows"] >= 1

    def test_get_discovery_seed_sources_empty(self, pg_db):
        from crate.db.queries.radio_user_queries import get_discovery_seed_sources

        sources = get_discovery_seed_sources(1)
        assert sources == {}

    def test_get_discovery_seed_sources_with_likes(self, pg_db):
        from crate.db.queries.radio_user_queries import get_discovery_seed_sources
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        bliss_vec = [0.9] * 20
        track_id = self._setup_track(
            pg_db, "Discovery Artist", "Discovery Track", bliss_vec
        )

        with transaction_scope() as session:
            session.execute(
                text(
                    "INSERT INTO user_liked_tracks (user_id, track_id, created_at) VALUES (:uid, :tid, NOW())"
                ),
                {"uid": 1, "tid": track_id},
            )

        sources = get_discovery_seed_sources(1)
        assert 1 in sources
        assert len(sources[1]) >= 1

    def test_load_feedback_history_empty(self, pg_db):
        from crate.db.queries.radio_user_queries import load_feedback_history

        liked, disliked = load_feedback_history(1)
        assert liked == []
        assert disliked == []

    def test_load_feedback_history_with_data(self, pg_db):
        from crate.db.queries.radio_user_queries import load_feedback_history
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        bliss_vec = [0.95] * 20
        tid1 = self._setup_track(pg_db, "FB Artist", "FB Track Like", bliss_vec)
        tid2 = self._setup_track(pg_db, "FB Artist 2", "FB Track Dislike", bliss_vec)

        with transaction_scope() as session:
            session.execute(
                text(
                    "INSERT INTO radio_feedback (user_id, track_id, action, bliss_vector, created_at) VALUES (:uid, :tid, 'like', :bv, NOW())"
                ),
                {"uid": 1, "tid": tid1, "bv": bliss_vec},
            )
            session.execute(
                text(
                    "INSERT INTO radio_feedback (user_id, track_id, action, bliss_vector, created_at) VALUES (:uid, :tid, 'dislike', :bv, NOW())"
                ),
                {"uid": 1, "tid": tid2, "bv": bliss_vec},
            )

        liked, disliked = load_feedback_history(1)
        assert len(liked) >= 1
        assert len(disliked) >= 1


class TestRadioSeedQueries:
    def _setup_track_with_bliss(
        self, pg_db, artist_name, track_title, bliss_vec, path=None
    ):
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        pg_db.upsert_artist({"name": artist_name})
        album_id = pg_db.upsert_album(
            {
                "artist": artist_name,
                "name": f"{track_title} AL",
                "path": f"/music/{artist_name}/{track_title} AL",
                "track_count": 1,
                "total_size": 1000,
                "total_duration": 180.0,
                "formats": ["flac"],
            }
        )
        track_path = (
            path
            or f"/music/{artist_name}/{track_title} AL/01-{track_title.lower()}.flac"
        )
        pg_db.upsert_track(
            {
                "album_id": album_id,
                "artist": artist_name,
                "album": f"{track_title} AL",
                "filename": f"01-{track_title.lower()}.flac",
                "title": track_title,
                "path": track_path,
                "duration": 180.0,
                "size": 1000,
                "format": "flac",
            }
        )
        with transaction_scope() as session:
            session.execute(
                text("UPDATE library_tracks SET bliss_vector = :bv WHERE title = :t"),
                {"bv": bliss_vec, "t": track_title},
            )
            row = (
                session.execute(
                    text("SELECT id FROM library_tracks WHERE title = :t"),
                    {"t": track_title},
                )
                .mappings()
                .first()
            )
            return row["id"], track_path

    def test_get_track_seed_context_not_found(self, pg_db):
        from crate.db.queries.radio_seed_queries import get_track_seed_context

        assert get_track_seed_context("99999") is None

    def test_get_track_seed_context_found(self, pg_db):
        from crate.db.queries.radio_seed_queries import get_track_seed_context

        bliss_vec = [0.1] * 20
        track_id, _ = self._setup_track_with_bliss(
            pg_db, "Seed Track Artist", "Seed T", bliss_vec
        )

        result = get_track_seed_context(str(track_id))
        assert result is not None
        vector, label, context = result
        assert vector == bliss_vec
        assert "Seed T" in label
        assert context["seed_artists"] == ["Seed Track Artist"]
        assert context["seed_track_ids"] == [track_id]

    def test_get_track_seed_not_found(self, pg_db):
        from crate.db.queries.radio_seed_queries import get_track_seed

        assert get_track_seed("99999") is None

    def test_get_track_seed_found(self, pg_db):
        from crate.db.queries.radio_seed_queries import get_track_seed

        bliss_vec = [0.2] * 20
        track_id, _ = self._setup_track_with_bliss(
            pg_db, "Seed T Artist", "Seed T2", bliss_vec
        )

        result = get_track_seed(str(track_id))
        assert result is not None
        vector, label = result
        assert vector == bliss_vec

    def test_get_playlist_seed_context_not_found(self, pg_db):
        from crate.db.queries.radio_seed_queries import get_playlist_seed_context

        assert get_playlist_seed_context(99999) is None

    def test_get_playlist_seed_context_with_data(self, pg_db):
        from crate.db.queries.radio_seed_queries import get_playlist_seed_context
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        bliss_vec = [0.3] * 20
        track_id, _ = self._setup_track_with_bliss(
            pg_db, "PL Seed Artist", "PL Seed Track", bliss_vec
        )

        with transaction_scope() as session:
            session.execute(
                text(
                    "INSERT INTO playlists (name, scope, user_id, is_active, track_count, created_at, updated_at) VALUES ('PL Seed', 'user', 1, true, 1, NOW(), NOW())"
                )
            )
            row = (
                session.execute(text("SELECT id FROM playlists WHERE name = 'PL Seed'"))
                .mappings()
                .first()
            )
            playlist_id = row["id"]
            session.execute(
                text(
                    "INSERT INTO playlist_tracks (playlist_id, track_id, position, title, artist, album, duration, track_path, added_at) VALUES (:pid, :tid, 1, 'PL Seed Track', 'PL Seed Artist', 'PL Seed Track AL', 180.0, '/music/PL Seed Artist/PL Seed Track AL/01-pl_seed_track.flac', NOW())"
                ),
                {"pid": playlist_id, "tid": track_id},
            )

        result = get_playlist_seed_context(playlist_id, limit=10)
        assert result is not None
        vectors, label, context = result
        assert len(vectors) >= 1
        assert vectors[0] == bliss_vec
        assert label == "PL Seed"

    def test_get_playlist_seed_with_data(self, pg_db):
        from crate.db.queries.radio_seed_queries import get_playlist_seed
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        bliss_vec = [0.4] * 20
        track_id, _ = self._setup_track_with_bliss(
            pg_db, "PL S Artist", "PL S Track", bliss_vec
        )

        with transaction_scope() as session:
            session.execute(
                text(
                    "INSERT INTO playlists (name, scope, user_id, is_active, track_count, created_at, updated_at) VALUES ('PL Seed 2', 'user', 1, true, 1, NOW(), NOW())"
                )
            )
            row = (
                session.execute(
                    text("SELECT id FROM playlists WHERE name = 'PL Seed 2'")
                )
                .mappings()
                .first()
            )
            playlist_id = row["id"]
            session.execute(
                text(
                    "INSERT INTO playlist_tracks (playlist_id, track_id, position, title, artist, album, duration, track_path, added_at) VALUES (:pid, :tid, 1, 'PL S Track', 'PL S Artist', 'PL S Track AL', 180.0, '/music/PL S Artist/PL S Track AL/01-pl_s_track.flac', NOW())"
                ),
                {"pid": playlist_id, "tid": track_id},
            )

        result = get_playlist_seed(playlist_id, limit=10)
        assert result is not None
        vectors, label = result
        assert len(vectors) >= 1
        assert vectors[0] == bliss_vec

    def test_get_home_playlist_seed_not_found(self, pg_db):
        from crate.db.queries.radio_seed_queries import get_home_playlist_seed

        assert get_home_playlist_seed(1, "nonexistent-playlist") is None

    def test_get_home_playlist_seed_context_not_found(self, pg_db):
        from crate.db.queries.radio_seed_queries import get_home_playlist_seed_context

        assert get_home_playlist_seed_context(1, "nonexistent-playlist") is None

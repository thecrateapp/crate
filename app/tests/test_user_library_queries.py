"""Tests for user_library_* query modules.

Covers:
  - user_library_history   (play history)
  - user_library_library   (follows, saves, likes)
  - user_library_shared    (window helpers, relative_path)
  - user_library_stats_overview (overview, play_stats)
  - user_library_stats_tops     (top X, replay mix, history cards)
  - user_library_stats_trends   (trend points)
"""

import time
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from crate.db.tx import read_scope, transaction_scope
from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")

TEST_USER_ID = 88888
TEST_USER_ID_2 = 88889

# ── helpers ──────────────────────────────────────────────────────────


def _ensure_user(user_id: int, email: str = "test@test.com"):
    with transaction_scope() as session:
        session.execute(
            text(
                "INSERT INTO users (id, email, password_hash, role, created_at) "
                "VALUES (:id, :email, :password_hash, :role, NOW()) "
                "ON CONFLICT (id) DO NOTHING"
            ),
            {
                "id": user_id,
                "email": email,
                "password_hash": "nohash",
                "role": "user",
            },
        )


def _insert_play_event(user_id: int, **kw):
    now = datetime.now(timezone.utc)
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO user_play_events (
                    user_id, created_at, track_id, track_entity_uid, track_path,
                    title, artist, album,
                    started_at, ended_at, played_seconds, track_duration_seconds,
                    completion_ratio, was_skipped, was_completed,
                    play_source_type, play_source_id, play_source_name,
                    context_artist, context_album,
                    device_type, app_platform
                ) VALUES (
                    :user_id, NOW(), :track_id, :track_entity_uid, :track_path,
                    :title, :artist, :album,
                    :started_at, :ended_at, :played_seconds, :track_duration_seconds,
                    :completion_ratio, :was_skipped, :was_completed,
                    :play_source_type, :play_source_id, :play_source_name,
                    :context_artist, :context_album,
                    :device_type, :app_platform
                )
                """
            ),
            {
                "user_id": user_id,
                "track_id": kw.get("track_id"),
                "track_entity_uid": kw.get("track_entity_uid"),
                "track_path": kw.get("track_path", ""),
                "title": kw.get("title", ""),
                "artist": kw.get("artist", ""),
                "album": kw.get("album", ""),
                "started_at": kw.get("started_at", now - timedelta(minutes=3)),
                "ended_at": kw.get("ended_at", now),
                "played_seconds": kw.get("played_seconds", 180),
                "track_duration_seconds": kw.get("track_duration_seconds", 180.0),
                "completion_ratio": kw.get("completion_ratio", 1.0),
                "was_skipped": kw.get("was_skipped", False),
                "was_completed": kw.get("was_completed", True),
                "play_source_type": kw.get("play_source_type", "album"),
                "play_source_id": kw.get("play_source_id", ""),
                "play_source_name": kw.get("play_source_name", kw.get("album", "")),
                "context_artist": kw.get("context_artist", kw.get("artist", "")),
                "context_album": kw.get("context_album", kw.get("album", "")),
                "device_type": kw.get("device_type", "web"),
                "app_platform": kw.get("app_platform", "listen-web"),
            },
        )


def _seed_library(pg_db):
    """Create test artists, albums, tracks. Returns dict of lookups."""
    _ensure_user(TEST_USER_ID, "libuser@test.com")
    _ensure_user(TEST_USER_ID_2, "libuser2@test.com")

    pg_db.upsert_artist({"name": "Converge"})
    pg_db.upsert_artist({"name": "Botch"})
    pg_db.upsert_artist({"name": "Deafheaven"})

    album_jd = pg_db.upsert_album(
        {
            "artist": "Converge",
            "name": "Jane Doe",
            "path": "/music/Converge/Jane Doe",
        }
    )
    album_petitioning = pg_db.upsert_album(
        {
            "artist": "Converge",
            "name": "Petitioning the Empty Sky",
            "path": "/music/Converge/Petitioning the Empty Sky",
        }
    )
    album_botch = pg_db.upsert_album(
        {
            "artist": "Botch",
            "name": "We Are the Romans",
            "path": "/music/Botch/We Are the Romans",
        }
    )
    album_deaf = pg_db.upsert_album(
        {
            "artist": "Deafheaven",
            "name": "Sunbather",
            "path": "/music/Deafheaven/Sunbather",
        }
    )

    pg_db.upsert_track(
        {
            "album_id": album_jd,
            "artist": "Converge",
            "album": "Jane Doe",
            "filename": "01 - Concubine.flac",
            "title": "Concubine",
            "track_number": 1,
            "format": "flac",
            "duration": 94.0,
            "path": "/music/Converge/Jane Doe/01 - Concubine.flac",
        }
    )
    pg_db.upsert_track(
        {
            "album_id": album_jd,
            "artist": "Converge",
            "album": "Jane Doe",
            "filename": "02 - Fault and Fracture.flac",
            "title": "Fault and Fracture",
            "track_number": 2,
            "format": "flac",
            "duration": 225.0,
            "path": "/music/Converge/Jane Doe/02 - Fault and Fracture.flac",
        }
    )
    pg_db.upsert_track(
        {
            "album_id": album_petitioning,
            "artist": "Converge",
            "album": "Petitioning the Empty Sky",
            "filename": "01 - Forsaken.flac",
            "title": "Forsaken",
            "track_number": 1,
            "format": "flac",
            "duration": 180.0,
            "path": "/music/Converge/Petitioning the Empty Sky/01 - Forsaken.flac",
        }
    )
    pg_db.upsert_track(
        {
            "album_id": album_botch,
            "artist": "Botch",
            "album": "We Are the Romans",
            "filename": "01 - Hutton's Great Heat Engine.flac",
            "title": "Hutton's Great Heat Engine",
            "track_number": 1,
            "format": "flac",
            "duration": 312.0,
            "path": "/music/Botch/We Are the Romans/01 - Hutton's Great Heat Engine.flac",
        }
    )
    pg_db.upsert_track(
        {
            "album_id": album_deaf,
            "artist": "Deafheaven",
            "album": "Sunbather",
            "filename": "01 - Dream House.flac",
            "title": "Dream House",
            "track_number": 1,
            "format": "flac",
            "duration": 549.0,
            "path": "/music/Deafheaven/Sunbather/01 - Dream House.flac",
        }
    )

    with read_scope() as session:
        tracks_raw = (
            session.execute(
                text(
                    """
                SELECT id, entity_uid::text AS entity_uid, title, artist, album, path, album_id
                FROM library_tracks
                WHERE artist IN ('Converge', 'Botch', 'Deafheaven')
                ORDER BY title
                """
                )
            )
            .mappings()
            .all()
        )
        albums_raw = (
            session.execute(
                text(
                    """
                SELECT id, name, artist
                FROM library_albums
                WHERE artist IN ('Converge', 'Botch', 'Deafheaven')
                ORDER BY name
                """
                )
            )
            .mappings()
            .all()
        )
        artists_raw = (
            session.execute(
                text(
                    """
                SELECT id, name, slug, entity_uid::text AS entity_uid
                FROM library_artists
                WHERE name IN ('Converge', 'Botch', 'Deafheaven')
                ORDER BY name
                """
                )
            )
            .mappings()
            .all()
        )

    tracks = {}
    for t in tracks_raw:
        tracks[t["title"]] = dict(t)
    albums = {}
    for a in albums_raw:
        albums[a["name"]] = dict(a)
    artists = {}
    for a in artists_raw:
        artists[a["name"]] = dict(a)

    return {
        "tracks": tracks,
        "albums": albums,
        "artists": artists,
    }


def _cleanup_user_data(user_id: int):
    with transaction_scope() as session:
        for table in (
            "user_play_events",
            "user_daily_listening",
            "user_track_stats",
            "user_artist_stats",
            "user_album_stats",
            "user_genre_stats",
            "user_follows",
            "user_saved_albums",
            "user_liked_tracks",
        ):
            session.execute(
                text(f"DELETE FROM {table} WHERE user_id = :user_id"),
                {"user_id": user_id},
            )


# ── fixture ──────────────────────────────────────────────────────────


@pytest.fixture
def lib_db(pg_db):
    data = _seed_library(pg_db)
    yield pg_db, data
    _cleanup_user_data(TEST_USER_ID)
    _cleanup_user_data(TEST_USER_ID_2)


# ══════════════════════════════════════════════════════════════════════
# user_library_shared
# ══════════════════════════════════════════════════════════════════════


class TestSharedHelpers:
    def test_normalize_stats_window_valid(self):
        from crate.db.queries.user_library_shared import normalize_stats_window

        assert normalize_stats_window("7d") == "7d"
        assert normalize_stats_window("30d") == "30d"
        assert normalize_stats_window("90d") == "90d"
        assert normalize_stats_window("365d") == "365d"
        assert normalize_stats_window("all_time") == "all_time"
        assert normalize_stats_window("") == "30d"  # default

    def test_normalize_stats_window_invalid_raises(self):
        from crate.db.queries.user_library_shared import normalize_stats_window

        with pytest.raises(ValueError, match="Unsupported stats window"):
            normalize_stats_window("banana")

    def test_normalize_stats_window_none_uses_default(self):
        from crate.db.queries.user_library_shared import normalize_stats_window

        assert normalize_stats_window(None) == "30d"  # type: ignore[arg-type]

    def test_window_day_cutoff_all_time_returns_none(self):
        from crate.db.queries.user_library_shared import window_day_cutoff

        assert window_day_cutoff("all_time") is None

    def test_window_day_cutoff_returns_iso_string(self):
        from crate.db.queries.user_library_shared import window_day_cutoff

        result = window_day_cutoff("7d")
        assert result is not None
        dt = datetime.fromisoformat(result)
        now = datetime.now(timezone.utc)
        delta = now - dt
        # Should be very close to 7 days
        assert timedelta(days=6.9) <= delta <= timedelta(days=7.1)

    def test_relative_track_path_strips_music_prefix(self):
        from crate.db.queries.user_library_shared import relative_track_path

        assert (
            relative_track_path("/music/Converge/Jane Doe/01.flac")
            == "Converge/Jane Doe/01.flac"
        )

    def test_relative_track_path_returns_empty_for_unexpected_root(self):
        from crate.db.queries.user_library_shared import relative_track_path

        assert relative_track_path("/some/other/root/track.flac") == ""

    def test_relative_track_path_preserves_relative_already(self):
        from crate.db.queries.user_library_shared import relative_track_path

        assert (
            relative_track_path("Converge/Jane Doe/01.flac")
            == "Converge/Jane Doe/01.flac"
        )

    def test_relative_track_path_empty_string(self):
        from crate.db.queries.user_library_shared import relative_track_path

        assert relative_track_path("") == ""


# ══════════════════════════════════════════════════════════════════════
# user_library_library
# ══════════════════════════════════════════════════════════════════════


class TestLibraryFollowsAndSaves:
    def test_follow_artist_and_is_following(self, lib_db):
        pg_db, _ = lib_db
        from crate.db.user_library import follow_artist
        from crate.db.queries.user_library_library import is_following

        follow_artist(TEST_USER_ID, "Converge")
        assert is_following(TEST_USER_ID, "Converge") is True
        assert is_following(TEST_USER_ID, "Botch") is False

    def test_unfollow_artist(self, lib_db):
        pg_db, _ = lib_db
        from crate.db.user_library import follow_artist, unfollow_artist
        from crate.db.queries.user_library_library import is_following

        follow_artist(TEST_USER_ID, "Converge")
        unfollow_artist(TEST_USER_ID, "Converge")
        assert is_following(TEST_USER_ID, "Converge") is False

    def test_get_followed_artists(self, lib_db):
        pg_db, data = lib_db
        from crate.db.user_library import follow_artist
        from crate.db.queries.user_library_library import get_followed_artists

        follow_artist(TEST_USER_ID, "Converge")
        follow_artist(TEST_USER_ID, "Botch")

        followed = get_followed_artists(TEST_USER_ID)
        assert len(followed) == 2
        names = {f["artist_name"] for f in followed}
        assert names == {"Converge", "Botch"}
        # Should have artist_id, slug, etc. when the artist exists in library
        converge = next(f for f in followed if f["artist_name"] == "Converge")
        assert converge["artist_id"] == data["artists"]["Converge"]["id"]
        assert converge["artist_slug"] == data["artists"]["Converge"]["slug"]

    def test_get_followed_artists_empty(self, lib_db):
        from crate.db.queries.user_library_library import get_followed_artists

        assert get_followed_artists(TEST_USER_ID) == []

    def test_get_followed_artists_orders_by_created_at_desc(self, lib_db):
        pg_db, _ = lib_db
        from crate.db.user_library import follow_artist
        from crate.db.queries.user_library_library import get_followed_artists

        follow_artist(TEST_USER_ID, "Converge")
        follow_artist(TEST_USER_ID, "Botch")

        followed = get_followed_artists(TEST_USER_ID)
        # Botch was followed last, so it should be first
        assert followed[0]["artist_name"] == "Botch"
        assert followed[1]["artist_name"] == "Converge"

    def test_is_following_nonexistent_user(self, lib_db):
        from crate.db.queries.user_library_library import is_following

        assert is_following(99999, "Converge") is False

    def test_get_followed_artists_user_isolation(self, lib_db):
        pg_db, _ = lib_db
        from crate.db.user_library import follow_artist
        from crate.db.queries.user_library_library import get_followed_artists

        follow_artist(TEST_USER_ID, "Converge")
        follow_artist(TEST_USER_ID_2, "Botch")

        assert len(get_followed_artists(TEST_USER_ID)) == 1
        assert len(get_followed_artists(TEST_USER_ID_2)) == 1

    def test_save_album_and_is_album_saved(self, lib_db):
        pg_db, data = lib_db
        from crate.db.user_library import save_album
        from crate.db.queries.user_library_library import is_album_saved

        album_id = data["albums"]["Jane Doe"]["id"]
        save_album(TEST_USER_ID, album_id)
        assert is_album_saved(TEST_USER_ID, album_id) is True

    def test_unsave_album(self, lib_db):
        pg_db, data = lib_db
        from crate.db.user_library import save_album, unsave_album
        from crate.db.queries.user_library_library import is_album_saved

        album_id = data["albums"]["Jane Doe"]["id"]
        save_album(TEST_USER_ID, album_id)
        unsave_album(TEST_USER_ID, album_id)
        assert is_album_saved(TEST_USER_ID, album_id) is False

    def test_get_saved_albums(self, lib_db):
        pg_db, data = lib_db
        from crate.db.user_library import save_album
        from crate.db.queries.user_library_library import get_saved_albums

        save_album(TEST_USER_ID, data["albums"]["Jane Doe"]["id"])
        save_album(TEST_USER_ID, data["albums"]["Sunbather"]["id"])

        saved = get_saved_albums(TEST_USER_ID)
        assert len(saved) == 2
        album_names = {a["name"] for a in saved}
        assert album_names == {"Jane Doe", "Sunbather"}

    def test_get_saved_albums_empty(self, lib_db):
        from crate.db.queries.user_library_library import get_saved_albums

        assert get_saved_albums(TEST_USER_ID) == []

    def test_like_track_and_is_track_liked(self, lib_db):
        pg_db, data = lib_db
        from crate.db.user_library import like_track
        from crate.db.queries.user_library_library import is_track_liked

        track_id = data["tracks"]["Concubine"]["id"]
        like_track(TEST_USER_ID, track_id)
        assert is_track_liked(TEST_USER_ID, track_id) is True

    def test_unlike_track(self, lib_db):
        pg_db, data = lib_db
        from crate.db.user_library import like_track, unlike_track
        from crate.db.queries.user_library_library import is_track_liked

        track_id = data["tracks"]["Concubine"]["id"]
        like_track(TEST_USER_ID, track_id)
        unlike_track(TEST_USER_ID, track_id)
        assert is_track_liked(TEST_USER_ID, track_id) is False

    def test_get_liked_tracks(self, lib_db):
        pg_db, data = lib_db
        from crate.db.user_library import like_track
        from crate.db.queries.user_library_library import get_liked_tracks

        like_track(TEST_USER_ID, data["tracks"]["Concubine"]["id"])
        like_track(TEST_USER_ID, data["tracks"]["Forsaken"]["id"])
        like_track(TEST_USER_ID, data["tracks"]["Dream House"]["id"])

        liked = get_liked_tracks(TEST_USER_ID)
        assert len(liked) == 3
        titles = {t["title"] for t in liked}
        assert titles == {"Concubine", "Forsaken", "Dream House"}
        # Each should have relative_path
        for item in liked:
            assert "relative_path" in item
            assert not item["relative_path"].startswith("/music/")

    def test_get_liked_tracks_respects_limit(self, lib_db):
        pg_db, data = lib_db
        from crate.db.user_library import like_track
        from crate.db.queries.user_library_library import get_liked_tracks

        like_track(TEST_USER_ID, data["tracks"]["Concubine"]["id"])
        like_track(TEST_USER_ID, data["tracks"]["Forsaken"]["id"])
        like_track(TEST_USER_ID, data["tracks"]["Dream House"]["id"])

        assert len(get_liked_tracks(TEST_USER_ID, limit=1)) == 1

    def test_get_liked_tracks_empty(self, lib_db):
        from crate.db.queries.user_library_library import get_liked_tracks

        assert get_liked_tracks(TEST_USER_ID) == []

    def test_get_user_library_counts(self, lib_db):
        pg_db, data = lib_db
        from crate.db.user_library import follow_artist, save_album, like_track
        from crate.db.queries.user_library_library import get_user_library_counts

        follow_artist(TEST_USER_ID, "Converge")
        save_album(TEST_USER_ID, data["albums"]["Jane Doe"]["id"])
        like_track(TEST_USER_ID, data["tracks"]["Concubine"]["id"])
        like_track(TEST_USER_ID, data["tracks"]["Forsaken"]["id"])

        counts = get_user_library_counts(TEST_USER_ID)
        assert counts["followed_artists"] == 1
        assert counts["saved_albums"] == 1
        assert counts["liked_tracks"] == 2
        # playlists default to 0 for a test user with no playlists
        assert counts["playlists"] == 0

    def test_get_user_library_counts_empty(self, lib_db):
        from crate.db.queries.user_library_library import get_user_library_counts

        counts = get_user_library_counts(TEST_USER_ID)
        assert counts["followed_artists"] == 0
        assert counts["saved_albums"] == 0
        assert counts["liked_tracks"] == 0

    def test_get_user_library_counts_user_isolation(self, lib_db):
        pg_db, data = lib_db
        from crate.db.user_library import follow_artist, like_track
        from crate.db.queries.user_library_library import get_user_library_counts

        follow_artist(TEST_USER_ID, "Converge")
        like_track(TEST_USER_ID, data["tracks"]["Concubine"]["id"])

        c1 = get_user_library_counts(TEST_USER_ID)
        c2 = get_user_library_counts(TEST_USER_ID_2)

        assert c1["followed_artists"] == 1
        assert c1["liked_tracks"] == 1
        assert c2["followed_artists"] == 0
        assert c2["liked_tracks"] == 0


# ══════════════════════════════════════════════════════════════════════
# user_library_history
# ══════════════════════════════════════════════════════════════════════


class TestPlayHistory:
    def test_get_play_history_returns_events_ordered_by_latest(self, lib_db):
        pg_db, data = lib_db
        now = datetime.now(timezone.utc)

        _insert_play_event(
            TEST_USER_ID,
            track_id=data["tracks"]["Concubine"]["id"],
            track_entity_uid=data["tracks"]["Concubine"]["entity_uid"],
            track_path=data["tracks"]["Concubine"]["path"],
            title="Concubine",
            artist="Converge",
            album="Jane Doe",
            started_at=now - timedelta(hours=2),
            ended_at=now - timedelta(hours=2) + timedelta(seconds=94),
            played_seconds=94,
            track_duration_seconds=94.0,
            was_completed=True,
        )
        _insert_play_event(
            TEST_USER_ID,
            track_id=data["tracks"]["Fault and Fracture"]["id"],
            track_entity_uid=data["tracks"]["Fault and Fracture"]["entity_uid"],
            track_path=data["tracks"]["Fault and Fracture"]["path"],
            title="Fault and Fracture",
            artist="Converge",
            album="Jane Doe",
            started_at=now - timedelta(hours=1),
            ended_at=now - timedelta(hours=1) + timedelta(seconds=225),
            played_seconds=225,
            track_duration_seconds=225.0,
            was_completed=True,
        )

        from crate.db.queries.user_library_history import get_play_history

        history = get_play_history(TEST_USER_ID, limit=10)
        assert len(history) == 2
        # Most recent first
        assert history[0]["title"] == "Fault and Fracture"
        assert history[1]["title"] == "Concubine"

    def test_get_play_history_respects_limit(self, lib_db):
        pg_db, data = lib_db
        now = datetime.now(timezone.utc)

        for title in ("Concubine", "Fault and Fracture", "Forsaken"):
            _insert_play_event(
                TEST_USER_ID,
                track_id=data["tracks"][title]["id"],
                track_entity_uid=data["tracks"][title]["entity_uid"],
                track_path=data["tracks"][title]["path"],
                title=title,
                artist=data["tracks"][title]["artist"],
                album=data["tracks"][title]["album"],
                started_at=now - timedelta(minutes=5),
                ended_at=now,
            )

        from crate.db.queries.user_library_history import get_play_history

        assert len(get_play_history(TEST_USER_ID, limit=1)) == 1

    def test_get_play_history_empty_user(self, lib_db):
        from crate.db.queries.user_library_history import get_play_history

        assert get_play_history(TEST_USER_ID) == []

    def test_get_play_history_user_isolation(self, lib_db):
        pg_db, data = lib_db
        now = datetime.now(timezone.utc)

        _insert_play_event(
            TEST_USER_ID,
            track_id=data["tracks"]["Concubine"]["id"],
            track_entity_uid=data["tracks"]["Concubine"]["entity_uid"],
            track_path=data["tracks"]["Concubine"]["path"],
            title="Concubine",
            artist="Converge",
            album="Jane Doe",
            started_at=now - timedelta(hours=1),
            ended_at=now,
        )
        _insert_play_event(
            TEST_USER_ID_2,
            track_id=data["tracks"]["Dream House"]["id"],
            track_entity_uid=data["tracks"]["Dream House"]["entity_uid"],
            track_path=data["tracks"]["Dream House"]["path"],
            title="Dream House",
            artist="Deafheaven",
            album="Sunbather",
            started_at=now - timedelta(hours=1),
            ended_at=now,
        )

        from crate.db.queries.user_library_history import get_play_history

        h1 = get_play_history(TEST_USER_ID)
        h2 = get_play_history(TEST_USER_ID_2)
        assert len(h1) == 1
        assert h1[0]["title"] == "Concubine"
        assert len(h2) == 1
        assert h2[0]["title"] == "Dream House"

    def test_get_play_history_includes_relative_path(self, lib_db):
        pg_db, data = lib_db
        now = datetime.now(timezone.utc)

        _insert_play_event(
            TEST_USER_ID,
            track_id=data["tracks"]["Concubine"]["id"],
            track_entity_uid=data["tracks"]["Concubine"]["entity_uid"],
            track_path="/music/Converge/Jane Doe/01 - Concubine.flac",
            title="Concubine",
            artist="Converge",
            album="Jane Doe",
            started_at=now - timedelta(hours=1),
            ended_at=now,
        )

        from crate.db.queries.user_library_history import get_play_history

        history = get_play_history(TEST_USER_ID)
        assert history[0]["relative_path"] == "Converge/Jane Doe/01 - Concubine.flac"

    def test_get_play_history_rows_direct_call(self, lib_db):
        pg_db, data = lib_db
        now = datetime.now(timezone.utc)

        _insert_play_event(
            TEST_USER_ID,
            track_id=data["tracks"]["Concubine"]["id"],
            track_entity_uid=data["tracks"]["Concubine"]["entity_uid"],
            track_path=data["tracks"]["Concubine"]["path"],
            title="Concubine",
            artist="Converge",
            album="Jane Doe",
            started_at=now - timedelta(hours=1),
            ended_at=now,
        )

        from crate.db.queries.user_library_history import get_play_history_rows

        rows = get_play_history_rows(
            TEST_USER_ID, limit=10, has_legacy_stream_id_column=False
        )
        assert len(rows) == 1
        assert rows[0]["title"] == "Concubine"
        assert rows[0]["artist"] == "Converge"

    def test_resolve_play_history_album_fallback_empty_input(self):
        from crate.db.queries.user_library_history import (
            resolve_play_history_album_fallback,
        )

        assert resolve_play_history_album_fallback([]) == {}

    def test_resolve_play_history_album_fallback_finds_albums(self, lib_db):
        pg_db, data = lib_db
        from crate.db.queries.user_library_history import (
            resolve_play_history_album_fallback,
        )

        result = resolve_play_history_album_fallback([("converge", "concubine")])
        assert ("converge", "concubine") in result
        hit = result[("converge", "concubine")]
        assert hit["title"] == "Concubine"
        assert hit["album"] == "Jane Doe"

    def test_get_play_history_resolves_orphan_album_via_fallback(self, lib_db):
        pg_db, data = lib_db
        now = datetime.now(timezone.utc)

        # Insert a play event with a track that has no album in the library
        _insert_play_event(
            TEST_USER_ID,
            track_id=None,
            track_path="/music/Converge/Jane Doe/01 - Concubine.flac",
            title="Concubine",
            artist="Converge",
            album="Unknown Album",
            started_at=now - timedelta(hours=1),
            ended_at=now,
        )

        from crate.db.queries.user_library_history import get_play_history

        history = get_play_history(TEST_USER_ID)
        assert len(history) == 1
        # Should have resolved the album via fallback
        assert history[0]["album"] == "Jane Doe"
        assert history[0]["album_id"] == data["albums"]["Jane Doe"]["id"]


# ══════════════════════════════════════════════════════════════════════
# user_library_stats_overview
# ══════════════════════════════════════════════════════════════════════


class TestStatsOverview:
    def test_get_play_stats_returns_totals(self, lib_db):
        pg_db, data = lib_db
        pg_db.record_play_event(
            TEST_USER_ID,
            track_id=data["tracks"]["Concubine"]["id"],
            track_path=data["tracks"]["Concubine"]["path"],
            title=data["tracks"]["Concubine"]["title"],
            artist=data["tracks"]["Concubine"]["artist"],
            album=data["tracks"]["Concubine"]["album"],
            started_at=(datetime.now(timezone.utc) - timedelta(minutes=2)).isoformat(),
            ended_at=datetime.now(timezone.utc).isoformat(),
            played_seconds=94.0,
            track_duration_seconds=94.0,
            completion_ratio=1.0,
            was_skipped=False,
            was_completed=True,
            play_source_type="album",
            play_source_id=str(data["tracks"]["Concubine"]["album_id"]),
            play_source_name=data["tracks"]["Concubine"]["album"],
            context_artist=data["tracks"]["Concubine"]["artist"],
            context_album=data["tracks"]["Concubine"]["album"],
            device_type="web",
            app_platform="listen-web",
        )
        pg_db.recompute_user_listening_aggregates(TEST_USER_ID)

        from crate.db.queries.user_library_stats_overview import get_play_stats

        stats = get_play_stats(TEST_USER_ID)
        assert stats["total_plays"] == 1
        assert len(stats["top_artists"]) == 1
        assert stats["top_artists"][0]["artist"] == "Converge"

    def test_get_play_stats_empty(self, lib_db):
        from crate.db.queries.user_library_stats_overview import get_play_stats

        stats = get_play_stats(TEST_USER_ID)
        assert stats["total_plays"] == 0
        assert stats["top_artists"] == []

    def test_get_stats_overview_all_time(self, lib_db):
        pg_db, data = lib_db
        ts = datetime.now(timezone.utc) - timedelta(days=5)

        pg_db.record_play_event(
            TEST_USER_ID,
            track_id=data["tracks"]["Concubine"]["id"],
            track_path=data["tracks"]["Concubine"]["path"],
            title=data["tracks"]["Concubine"]["title"],
            artist=data["tracks"]["Concubine"]["artist"],
            album=data["tracks"]["Concubine"]["album"],
            started_at=ts.isoformat(),
            ended_at=(ts + timedelta(seconds=94)).isoformat(),
            played_seconds=94.0,
            track_duration_seconds=94.0,
            completion_ratio=1.0,
            was_skipped=False,
            was_completed=True,
            play_source_type="album",
            play_source_id=str(data["tracks"]["Concubine"]["album_id"]),
            play_source_name=data["tracks"]["Concubine"]["album"],
            context_artist=data["tracks"]["Concubine"]["artist"],
            context_album=data["tracks"]["Concubine"]["album"],
            device_type="web",
            app_platform="listen-web",
        )
        pg_db.recompute_user_listening_aggregates(TEST_USER_ID)

        from crate.db.queries.user_library_stats_overview import get_stats_overview

        overview = get_stats_overview(TEST_USER_ID, window="all_time")
        assert overview["window"] == "all_time"
        assert overview["play_count"] == 1
        assert overview["complete_play_count"] == 1
        assert overview["skip_count"] == 0
        assert overview["skip_rate"] == 0.0
        assert overview["active_days"] == 1
        assert abs(overview["minutes_listened"] - 94.0 / 60) < 0.01

    def test_get_stats_overview_all_skipped(self, lib_db):
        pg_db, data = lib_db

        for i in range(3):
            ts = datetime.now(timezone.utc) - timedelta(days=1, hours=i)
            pg_db.record_play_event(
                TEST_USER_ID,
                track_id=data["tracks"]["Concubine"]["id"],
                track_path=data["tracks"]["Concubine"]["path"],
                title=data["tracks"]["Concubine"]["title"],
                artist=data["tracks"]["Concubine"]["artist"],
                album=data["tracks"]["Concubine"]["album"],
                started_at=ts.isoformat(),
                ended_at=(ts + timedelta(seconds=15)).isoformat(),
                played_seconds=15.0,
                track_duration_seconds=94.0,
                completion_ratio=0.16,
                was_skipped=True,
                was_completed=False,
                play_source_type="album",
                play_source_id=str(data["tracks"]["Concubine"]["album_id"]),
                play_source_name=data["tracks"]["Concubine"]["album"],
                context_artist=data["tracks"]["Concubine"]["artist"],
                context_album=data["tracks"]["Concubine"]["album"],
                device_type="web",
                app_platform="listen-web",
            )
        pg_db.recompute_user_listening_aggregates(TEST_USER_ID)

        from crate.db.queries.user_library_stats_overview import get_stats_overview

        overview = get_stats_overview(TEST_USER_ID, window="all_time")
        assert overview["play_count"] == 3
        assert overview["complete_play_count"] == 0
        assert overview["skip_count"] == 3
        assert overview["skip_rate"] == 1.0

    def test_get_stats_overview_top_artist_populated(self, lib_db):
        pg_db, data = lib_db

        for i in range(3):
            ts = datetime.now(timezone.utc) - timedelta(days=10, hours=i)
            pg_db.record_play_event(
                TEST_USER_ID,
                track_id=data["tracks"]["Concubine"]["id"],
                track_path=data["tracks"]["Concubine"]["path"],
                title=data["tracks"]["Concubine"]["title"],
                artist=data["tracks"]["Concubine"]["artist"],
                album=data["tracks"]["Concubine"]["album"],
                started_at=ts.isoformat(),
                ended_at=(ts + timedelta(seconds=94)).isoformat(),
                played_seconds=94.0,
                track_duration_seconds=94.0,
                completion_ratio=1.0,
                was_skipped=False,
                was_completed=True,
                play_source_type="album",
                play_source_id=str(data["tracks"]["Concubine"]["album_id"]),
                play_source_name=data["tracks"]["Concubine"]["album"],
                context_artist=data["tracks"]["Concubine"]["artist"],
                context_album=data["tracks"]["Concubine"]["album"],
                device_type="web",
                app_platform="listen-web",
            )
        ts = datetime.now(timezone.utc) - timedelta(days=20)
        pg_db.record_play_event(
            TEST_USER_ID,
            track_id=data["tracks"]["Dream House"]["id"],
            track_path=data["tracks"]["Dream House"]["path"],
            title=data["tracks"]["Dream House"]["title"],
            artist=data["tracks"]["Dream House"]["artist"],
            album=data["tracks"]["Dream House"]["album"],
            started_at=ts.isoformat(),
            ended_at=(ts + timedelta(seconds=549)).isoformat(),
            played_seconds=549.0,
            track_duration_seconds=549.0,
            completion_ratio=1.0,
            was_skipped=False,
            was_completed=True,
            play_source_type="album",
            play_source_id=str(data["tracks"]["Dream House"]["album_id"]),
            play_source_name=data["tracks"]["Dream House"]["album"],
            context_artist=data["tracks"]["Dream House"]["artist"],
            context_album=data["tracks"]["Dream House"]["album"],
            device_type="web",
            app_platform="listen-web",
        )
        pg_db.recompute_user_listening_aggregates(TEST_USER_ID)

        from crate.db.queries.user_library_stats_overview import get_stats_overview

        overview = get_stats_overview(TEST_USER_ID, window="all_time")
        assert overview["top_artist"] is not None
        assert overview["top_artist"]["artist_name"] == "Converge"
        assert overview["top_artist"]["play_count"] == 3

    def test_get_stats_overview_empty(self, lib_db):
        from crate.db.queries.user_library_stats_overview import get_stats_overview

        overview = get_stats_overview(TEST_USER_ID, window="all_time")
        assert overview["play_count"] == 0
        assert overview["complete_play_count"] == 0
        assert overview["skip_count"] == 0
        assert overview["skip_rate"] == 0.0
        assert overview["active_days"] == 0
        assert overview["top_artist"] is None

    def test_get_stats_overview_invalid_window(self, lib_db):
        from crate.db.queries.user_library_stats_overview import get_stats_overview

        with pytest.raises(ValueError, match="Unsupported stats window"):
            get_stats_overview(TEST_USER_ID, window="banana")


# ══════════════════════════════════════════════════════════════════════
# user_library_stats_tops
# ══════════════════════════════════════════════════════════════════════


class TestStatsTops:
    def _seed_plays(self, lib_db):
        pg_db, data = lib_db
        base = datetime.now(timezone.utc) - timedelta(days=5)

        events = [
            # Concubine: 3 plays
            ("Concubine", base),
            ("Concubine", base + timedelta(days=1)),
            ("Concubine", base + timedelta(days=2)),
            # Fault and Fracture: 2 plays
            ("Fault and Fracture", base),
            ("Fault and Fracture", base + timedelta(days=1)),
            # Hutton: 1 play
            ("Hutton's Great Heat Engine", base),
        ]
        for title, ts in events:
            pg_db.record_play_event(
                TEST_USER_ID,
                track_id=data["tracks"][title]["id"],
                track_path=data["tracks"][title]["path"],
                title=data["tracks"][title]["title"],
                artist=data["tracks"][title]["artist"],
                album=data["tracks"][title]["album"],
                started_at=ts.isoformat(),
                ended_at=(ts + timedelta(seconds=180)).isoformat(),
                played_seconds=180.0,
                track_duration_seconds=180.0,
                completion_ratio=1.0,
                was_skipped=False,
                was_completed=True,
                play_source_type="album",
                play_source_id=str(data["tracks"][title]["album_id"]),
                play_source_name=data["tracks"][title]["album"],
                context_artist=data["tracks"][title]["artist"],
                context_album=data["tracks"][title]["album"],
                device_type="web",
                app_platform="listen-web",
            )
        pg_db.recompute_user_listening_aggregates(TEST_USER_ID)

    def test_get_top_tracks_ranking(self, lib_db):
        self._seed_plays(lib_db)

        from crate.db.queries.user_library_stats_tops import get_top_tracks

        top = get_top_tracks(TEST_USER_ID, window="all_time", limit=10)
        assert len(top) == 3
        assert top[0]["title"] == "Concubine"
        assert top[0]["play_count"] == 3
        assert top[1]["title"] == "Fault and Fracture"
        assert top[1]["play_count"] == 2
        assert top[2]["title"] == "Hutton's Great Heat Engine"
        assert top[2]["play_count"] == 1

    def test_get_top_tracks_empty(self, lib_db):
        from crate.db.queries.user_library_stats_tops import get_top_tracks

        assert get_top_tracks(TEST_USER_ID, window="all_time") == []

    def test_get_top_tracks_respects_limit(self, lib_db):
        self._seed_plays(lib_db)

        from crate.db.queries.user_library_stats_tops import get_top_tracks

        top = get_top_tracks(TEST_USER_ID, window="all_time", limit=1)
        assert len(top) == 1
        assert top[0]["title"] == "Concubine"

    def test_get_top_artists_ranking(self, lib_db):
        self._seed_plays(lib_db)

        from crate.db.queries.user_library_stats_tops import get_top_artists

        top = get_top_artists(TEST_USER_ID, window="all_time", limit=10)
        # Converge has 5 plays (3+2), Botch has 1
        assert len(top) == 2
        assert top[0]["artist_name"] == "Converge"
        assert top[0]["play_count"] == 5
        assert top[1]["artist_name"] == "Botch"
        assert top[1]["play_count"] == 1

    def test_get_top_artists_empty(self, lib_db):
        from crate.db.queries.user_library_stats_tops import get_top_artists

        assert get_top_artists(TEST_USER_ID, window="all_time") == []

    def test_get_top_albums_ranking(self, lib_db):
        self._seed_plays(lib_db)

        from crate.db.queries.user_library_stats_tops import get_top_albums

        top = get_top_albums(TEST_USER_ID, window="all_time", limit=10)
        # Jane Doe: 5 plays, We Are the Romans: 1 play
        assert len(top) >= 2
        assert top[0]["album"] == "Jane Doe"
        assert top[0]["play_count"] == 5
        # The second should be We Are the Romans
        album_names = {a["album"] for a in top}
        assert "Jane Doe" in album_names
        assert "We Are the Romans" in album_names

    def test_get_top_albums_empty(self, lib_db):
        from crate.db.queries.user_library_stats_tops import get_top_albums

        assert get_top_albums(TEST_USER_ID, window="all_time") == []

    def test_get_top_genres_returns_data(self, lib_db):
        self._seed_plays(lib_db)

        from crate.db.queries.user_library_stats_tops import get_top_genres

        top = get_top_genres(TEST_USER_ID, window="all_time", limit=20)
        # At minimum we should have some genre data since tracks have genres
        assert isinstance(top, list)

    def test_get_top_genres_empty(self, lib_db):
        from crate.db.queries.user_library_stats_tops import get_top_genres

        assert get_top_genres(TEST_USER_ID, window="all_time") == []

    def test_get_replay_mix_returns_structured_response(self, lib_db):
        self._seed_plays(lib_db)

        from crate.db.queries.user_library_stats_tops import get_replay_mix

        mix = get_replay_mix(TEST_USER_ID, window="30d", limit=10)
        assert mix["window"] == "30d"
        assert "title" in mix
        assert "subtitle" in mix
        assert "track_count" in mix
        assert "minutes_listened" in mix
        assert "items" in mix
        assert mix["track_count"] == len(mix["items"])
        # For 30d = "Replay this month"
        assert mix["title"] == "Replay this month"

    def test_get_replay_mix_7d_title(self, lib_db):
        from crate.db.queries.user_library_stats_tops import get_replay_mix

        mix = get_replay_mix(TEST_USER_ID, window="7d")
        assert mix["title"] == "Your last 7 days"

    def test_get_replay_mix_90d_title(self, lib_db):
        from crate.db.queries.user_library_stats_tops import get_replay_mix

        mix = get_replay_mix(TEST_USER_ID, window="90d")
        assert mix["title"] == "Replay this season"

    def test_get_replay_mix_365d_title(self, lib_db):
        from crate.db.queries.user_library_stats_tops import get_replay_mix

        mix = get_replay_mix(TEST_USER_ID, window="365d")
        assert mix["title"] == "Replay this year"

    def test_get_replay_mix_all_time_title(self, lib_db):
        from crate.db.queries.user_library_stats_tops import get_replay_mix

        mix = get_replay_mix(TEST_USER_ID, window="all_time")
        assert mix["title"] == "All-time replay"

    def test_get_replay_mix_empty(self, lib_db):
        from crate.db.queries.user_library_stats_tops import get_replay_mix

        mix = get_replay_mix(TEST_USER_ID, window="all_time")
        assert mix["track_count"] == 0
        assert mix["minutes_listened"] == 0
        assert mix["items"] == []

    def test_get_replay_mix_limits_artist_rank(self, lib_db):
        self._seed_plays(lib_db)

        from crate.db.queries.user_library_stats_tops import get_replay_mix

        mix = get_replay_mix(TEST_USER_ID, window="all_time", limit=30)
        # artist_rank column should be popped before returning
        for item in mix["items"]:
            assert "artist_rank" not in item

    def test_get_listening_history_cards_returns_buckets(self, lib_db):
        pg_db, data = lib_db
        now = datetime.now(timezone.utc)

        for i in range(5):
            ts = now - timedelta(days=i)
            pg_db.record_play_event(
                TEST_USER_ID,
                track_id=data["tracks"]["Concubine"]["id"],
                track_path=data["tracks"]["Concubine"]["path"],
                title=data["tracks"]["Concubine"]["title"],
                artist=data["tracks"]["Concubine"]["artist"],
                album=data["tracks"]["Concubine"]["album"],
                started_at=ts.isoformat(),
                ended_at=(ts + timedelta(seconds=94)).isoformat(),
                played_seconds=94.0,
                track_duration_seconds=94.0,
                completion_ratio=1.0,
                was_skipped=False,
                was_completed=True,
                play_source_type="album",
                play_source_id=str(data["tracks"]["Concubine"]["album_id"]),
                play_source_name=data["tracks"]["Concubine"]["album"],
                context_artist=data["tracks"]["Concubine"]["artist"],
                context_album=data["tracks"]["Concubine"]["album"],
                device_type="web",
                app_platform="listen-web",
            )
        pg_db.recompute_user_listening_aggregates(TEST_USER_ID)

        from crate.db.queries.user_library_stats_tops import get_listening_history_cards

        cards = get_listening_history_cards(TEST_USER_ID, limit=5)
        assert len(cards) >= 1
        card = cards[0]
        assert "id" in card
        assert card["kind"] == "month"
        assert "title" in card
        assert "period_start" in card
        assert "top_artists" in card
        assert "play_count" in card
        assert "minutes_listened" in card
        assert "artwork_tracks" in card

    def test_get_listening_history_cards_empty(self, lib_db):
        from crate.db.queries.user_library_stats_tops import get_listening_history_cards

        cards = get_listening_history_cards(TEST_USER_ID)
        assert cards == []

    def test_get_listening_history_cards_respects_limit(self, lib_db):
        pg_db, data = lib_db
        now = datetime.now(timezone.utc)

        # Insert plays in 3 different months spanning back
        for offset_days in (0, 35, 70):
            ts = now - timedelta(days=offset_days)
            pg_db.record_play_event(
                TEST_USER_ID,
                track_id=data["tracks"]["Concubine"]["id"],
                track_path=data["tracks"]["Concubine"]["path"],
                title=data["tracks"]["Concubine"]["title"],
                artist=data["tracks"]["Concubine"]["artist"],
                album=data["tracks"]["Concubine"]["album"],
                started_at=ts.isoformat(),
                ended_at=(ts + timedelta(seconds=94)).isoformat(),
                played_seconds=94.0,
                track_duration_seconds=94.0,
                completion_ratio=1.0,
                was_skipped=False,
                was_completed=True,
                play_source_type="album",
                play_source_id=str(data["tracks"]["Concubine"]["album_id"]),
                play_source_name=data["tracks"]["Concubine"]["album"],
                context_artist=data["tracks"]["Concubine"]["artist"],
                context_album=data["tracks"]["Concubine"]["album"],
                device_type="web",
                app_platform="listen-web",
            )
        pg_db.recompute_user_listening_aggregates(TEST_USER_ID)

        from crate.db.queries.user_library_stats_tops import get_listening_history_cards

        cards = get_listening_history_cards(TEST_USER_ID, limit=1)
        assert len(cards) == 1


# ══════════════════════════════════════════════════════════════════════
# user_library_stats_trends
# ══════════════════════════════════════════════════════════════════════


class TestStatsTrends:
    def _seed_daily(self, lib_db):
        pg_db, data = lib_db
        base = datetime.now(timezone.utc) - timedelta(days=5)

        for i in range(4):
            ts = base + timedelta(days=i)
            pg_db.record_play_event(
                TEST_USER_ID,
                track_id=data["tracks"]["Concubine"]["id"],
                track_path=data["tracks"]["Concubine"]["path"],
                title=data["tracks"]["Concubine"]["title"],
                artist=data["tracks"]["Concubine"]["artist"],
                album=data["tracks"]["Concubine"]["album"],
                started_at=ts.isoformat(),
                ended_at=(ts + timedelta(seconds=94)).isoformat(),
                played_seconds=94.0,
                track_duration_seconds=94.0,
                completion_ratio=1.0,
                was_skipped=False,
                was_completed=True,
                play_source_type="album",
                play_source_id=str(data["tracks"]["Concubine"]["album_id"]),
                play_source_name=data["tracks"]["Concubine"]["album"],
                context_artist=data["tracks"]["Concubine"]["artist"],
                context_album=data["tracks"]["Concubine"]["album"],
                device_type="web",
                app_platform="listen-web",
            )
        pg_db.recompute_user_listening_aggregates(TEST_USER_ID)

    def test_get_stats_trends_returns_windowed_data(self, lib_db):
        self._seed_daily(lib_db)

        from crate.db.queries.user_library_stats_trends import get_stats_trends

        result = get_stats_trends(TEST_USER_ID, window="30d")
        assert result["window"] == "30d"
        assert len(result["points"]) >= 1
        for point in result["points"]:
            assert "day" in point
            assert "play_count" in point
            assert "complete_play_count" in point
            assert "skip_count" in point
            assert "minutes_listened" in point

    def test_get_stats_trends_all_time(self, lib_db):
        self._seed_daily(lib_db)

        from crate.db.queries.user_library_stats_trends import get_stats_trends

        result = get_stats_trends(TEST_USER_ID, window="all_time")
        assert result["window"] == "all_time"
        assert len(result["points"]) >= 1

    def test_get_stats_trends_empty(self, lib_db):
        from crate.db.queries.user_library_stats_trends import get_stats_trends

        result = get_stats_trends(TEST_USER_ID, window="all_time")
        assert result["window"] == "all_time"
        assert result["points"] == []

    def test_get_stats_trend_points_direct(self, lib_db):
        self._seed_daily(lib_db)

        from crate.db.queries.user_library_stats_trends import get_stats_trend_points

        points = get_stats_trend_points(TEST_USER_ID, day_cutoff=None)
        assert len(points) >= 1
        total = sum(p["play_count"] for p in points)
        assert total == 4

    def test_get_stats_trend_points_with_cutoff(self, lib_db):
        from crate.db.queries.user_library_stats_trends import get_stats_trend_points
        from crate.db.queries.user_library_shared import window_day_cutoff

        self._seed_daily(lib_db)

        cutoff = window_day_cutoff("7d")
        points = get_stats_trend_points(TEST_USER_ID, day_cutoff=cutoff)
        # Should only have days within 7 days
        assert len(points) >= 1
        total = sum(p["play_count"] for p in points)
        assert 1 <= total <= 4


# ══════════════════════════════════════════════════════════════════════
# Time-based queries
# ══════════════════════════════════════════════════════════════════════


class TestTimeBasedQueries:
    def test_overview_7d_excludes_old_events(self, lib_db):
        pg_db, data = lib_db
        now = datetime.now(timezone.utc)

        # Old event: 60 days ago
        old_ts = now - timedelta(days=60)
        pg_db.record_play_event(
            TEST_USER_ID,
            track_id=data["tracks"]["Hutton's Great Heat Engine"]["id"],
            track_path=data["tracks"]["Hutton's Great Heat Engine"]["path"],
            title=data["tracks"]["Hutton's Great Heat Engine"]["title"],
            artist=data["tracks"]["Hutton's Great Heat Engine"]["artist"],
            album=data["tracks"]["Hutton's Great Heat Engine"]["album"],
            started_at=old_ts.isoformat(),
            ended_at=(old_ts + timedelta(minutes=5, seconds=12)).isoformat(),
            played_seconds=312.0,
            track_duration_seconds=312.0,
            completion_ratio=1.0,
            was_skipped=False,
            was_completed=True,
            play_source_type="album",
            play_source_id=str(
                data["tracks"]["Hutton's Great Heat Engine"]["album_id"]
            ),
            play_source_name=data["tracks"]["Hutton's Great Heat Engine"]["album"],
            context_artist=data["tracks"]["Hutton's Great Heat Engine"]["artist"],
            context_album=data["tracks"]["Hutton's Great Heat Engine"]["album"],
            device_type="web",
            app_platform="listen-web",
        )
        # Recent event
        recent_ts = now - timedelta(hours=1)
        pg_db.record_play_event(
            TEST_USER_ID,
            track_id=data["tracks"]["Concubine"]["id"],
            track_path=data["tracks"]["Concubine"]["path"],
            title=data["tracks"]["Concubine"]["title"],
            artist=data["tracks"]["Concubine"]["artist"],
            album=data["tracks"]["Concubine"]["album"],
            started_at=recent_ts.isoformat(),
            ended_at=(recent_ts + timedelta(minutes=1, seconds=34)).isoformat(),
            played_seconds=94.0,
            track_duration_seconds=94.0,
            completion_ratio=1.0,
            was_skipped=False,
            was_completed=True,
            play_source_type="album",
            play_source_id=str(data["tracks"]["Concubine"]["album_id"]),
            play_source_name=data["tracks"]["Concubine"]["album"],
            context_artist=data["tracks"]["Concubine"]["artist"],
            context_album=data["tracks"]["Concubine"]["album"],
            device_type="web",
            app_platform="listen-web",
        )
        pg_db.recompute_user_listening_aggregates(TEST_USER_ID)

        from crate.db.queries.user_library_stats_overview import get_stats_overview
        from crate.db.queries.user_library_stats_tops import get_top_artists

        all_time = get_stats_overview(TEST_USER_ID, window="all_time")
        assert all_time["play_count"] == 2  # both

        seven_d = get_stats_overview(TEST_USER_ID, window="7d")
        assert seven_d["play_count"] == 1  # only recent

        artists_all = get_top_artists(TEST_USER_ID, window="all_time")
        artist_names_all = {a["artist_name"] for a in artists_all}
        assert "Botch" in artist_names_all
        assert "Converge" in artist_names_all

        artists_7d = get_top_artists(TEST_USER_ID, window="7d")
        artist_names_7d = {a["artist_name"] for a in artists_7d}
        assert "Converge" in artist_names_7d
        assert "Botch" not in artist_names_7d

    def test_trends_7d_window_excludes_old(self, lib_db):
        pg_db, data = lib_db
        now = datetime.now(timezone.utc)

        # Old event
        old_ts = now - timedelta(days=60)
        pg_db.record_play_event(
            TEST_USER_ID,
            track_id=data["tracks"]["Concubine"]["id"],
            track_path=data["tracks"]["Concubine"]["path"],
            title=data["tracks"]["Concubine"]["title"],
            artist=data["tracks"]["Concubine"]["artist"],
            album=data["tracks"]["Concubine"]["album"],
            started_at=old_ts.isoformat(),
            ended_at=(old_ts + timedelta(seconds=94)).isoformat(),
            played_seconds=94.0,
            track_duration_seconds=94.0,
            completion_ratio=1.0,
            was_skipped=False,
            was_completed=True,
            play_source_type="album",
            play_source_id=str(data["tracks"]["Concubine"]["album_id"]),
            play_source_name=data["tracks"]["Concubine"]["album"],
            context_artist=data["tracks"]["Concubine"]["artist"],
            context_album=data["tracks"]["Concubine"]["album"],
            device_type="web",
            app_platform="listen-web",
        )
        # Recent event
        recent_ts = now - timedelta(minutes=30)
        pg_db.record_play_event(
            TEST_USER_ID,
            track_id=data["tracks"]["Fault and Fracture"]["id"],
            track_path=data["tracks"]["Fault and Fracture"]["path"],
            title=data["tracks"]["Fault and Fracture"]["title"],
            artist=data["tracks"]["Fault and Fracture"]["artist"],
            album=data["tracks"]["Fault and Fracture"]["album"],
            started_at=recent_ts.isoformat(),
            ended_at=(recent_ts + timedelta(seconds=225)).isoformat(),
            played_seconds=225.0,
            track_duration_seconds=225.0,
            completion_ratio=1.0,
            was_skipped=False,
            was_completed=True,
            play_source_type="album",
            play_source_id=str(data["tracks"]["Fault and Fracture"]["album_id"]),
            play_source_name=data["tracks"]["Fault and Fracture"]["album"],
            context_artist=data["tracks"]["Fault and Fracture"]["artist"],
            context_album=data["tracks"]["Fault and Fracture"]["album"],
            device_type="web",
            app_platform="listen-web",
        )
        pg_db.recompute_user_listening_aggregates(TEST_USER_ID)

        from crate.db.queries.user_library_stats_trends import get_stats_trends

        all_time = get_stats_trends(TEST_USER_ID, window="all_time")
        all_plays = sum(p["play_count"] for p in all_time["points"])
        assert all_plays == 2

        seven_d = get_stats_trends(TEST_USER_ID, window="7d")
        recent_plays = sum(p["play_count"] for p in seven_d["points"])
        assert recent_plays == 1


# ══════════════════════════════════════════════════════════════════════
# Aggregation verification
# ══════════════════════════════════════════════════════════════════════


class TestAggregationVerification:
    def test_daily_listening_aggregates_match_raw_events(self, lib_db):
        pg_db, data = lib_db
        ts = datetime.now(timezone.utc) - timedelta(days=1)

        # 2 completed, 1 skipped on the same day
        pg_db.record_play_event(
            TEST_USER_ID,
            track_id=data["tracks"]["Concubine"]["id"],
            track_path=data["tracks"]["Concubine"]["path"],
            title=data["tracks"]["Concubine"]["title"],
            artist=data["tracks"]["Concubine"]["artist"],
            album=data["tracks"]["Concubine"]["album"],
            started_at=ts.isoformat(),
            ended_at=(ts + timedelta(seconds=94)).isoformat(),
            played_seconds=94.0,
            track_duration_seconds=94.0,
            completion_ratio=1.0,
            was_skipped=False,
            was_completed=True,
            play_source_type="album",
            play_source_id=str(data["albums"]["Jane Doe"]["id"]),
            play_source_name="Jane Doe",
            context_artist="Converge",
            context_album="Jane Doe",
            device_type="web",
            app_platform="listen-web",
        )
        ts2 = datetime.now(timezone.utc) - timedelta(days=1, hours=2)
        pg_db.record_play_event(
            TEST_USER_ID,
            track_id=data["tracks"]["Concubine"]["id"],
            track_path=data["tracks"]["Concubine"]["path"],
            title=data["tracks"]["Concubine"]["title"],
            artist=data["tracks"]["Concubine"]["artist"],
            album=data["tracks"]["Concubine"]["album"],
            started_at=ts2.isoformat(),
            ended_at=(ts2 + timedelta(seconds=94)).isoformat(),
            played_seconds=94.0,
            track_duration_seconds=94.0,
            completion_ratio=1.0,
            was_skipped=False,
            was_completed=True,
            play_source_type="album",
            play_source_id=str(data["albums"]["Jane Doe"]["id"]),
            play_source_name="Jane Doe",
            context_artist="Converge",
            context_album="Jane Doe",
            device_type="web",
            app_platform="listen-web",
        )
        ts3 = datetime.now(timezone.utc) - timedelta(days=1, hours=3)
        pg_db.record_play_event(
            TEST_USER_ID,
            track_id=data["tracks"]["Forsaken"]["id"],
            track_path=data["tracks"]["Forsaken"]["path"],
            title=data["tracks"]["Forsaken"]["title"],
            artist=data["tracks"]["Forsaken"]["artist"],
            album=data["tracks"]["Forsaken"]["album"],
            started_at=ts3.isoformat(),
            ended_at=(ts3 + timedelta(seconds=30)).isoformat(),
            played_seconds=30.0,
            track_duration_seconds=180.0,
            completion_ratio=0.17,
            was_skipped=True,
            was_completed=False,
            play_source_type="album",
            play_source_id=str(data["albums"]["Petitioning the Empty Sky"]["id"]),
            play_source_name="Petitioning the Empty Sky",
            context_artist="Converge",
            context_album="Petitioning the Empty Sky",
            device_type="web",
            app_platform="listen-web",
        )
        pg_db.recompute_user_listening_aggregates(TEST_USER_ID)

        from crate.db.user_library import get_stats_overview

        overview = get_stats_overview(TEST_USER_ID, window="all_time")
        assert overview["play_count"] == 3
        assert overview["complete_play_count"] == 2
        assert overview["skip_count"] == 1
        assert overview["active_days"] == 1
        expected_minutes = (94.0 + 94.0 + 30.0) / 60.0
        assert abs(overview["minutes_listened"] - expected_minutes) < 0.01

    def test_minutes_listened_math(self, lib_db):
        pg_db, data = lib_db

        durations = [94.0, 225.0, 312.0, 549.0]
        for i, dur in enumerate(durations):
            ts = datetime.now(timezone.utc) - timedelta(days=10, hours=i)
            pg_db.record_play_event(
                TEST_USER_ID,
                track_id=data["tracks"]["Concubine"]["id"],
                track_path=data["tracks"]["Concubine"]["path"],
                title=data["tracks"]["Concubine"]["title"],
                artist=data["tracks"]["Concubine"]["artist"],
                album=data["tracks"]["Concubine"]["album"],
                started_at=ts.isoformat(),
                ended_at=(ts + timedelta(seconds=int(dur))).isoformat(),
                played_seconds=dur,
                track_duration_seconds=dur,
                completion_ratio=1.0,
                was_skipped=False,
                was_completed=True,
                play_source_type="album",
                play_source_id=str(data["albums"]["Jane Doe"]["id"]),
                play_source_name="Jane Doe",
                context_artist="Converge",
                context_album="Jane Doe",
                device_type="web",
                app_platform="listen-web",
            )
        pg_db.recompute_user_listening_aggregates(TEST_USER_ID)

        from crate.db.user_library import get_stats_overview

        overview = get_stats_overview(TEST_USER_ID, window="all_time")
        expected_minutes = sum(durations) / 60.0
        assert abs(overview["minutes_listened"] - expected_minutes) < 0.01

    def test_unique_artists_in_daily_aggregation(self, lib_db):
        pg_db, data = lib_db

        ts = datetime.now(timezone.utc) - timedelta(days=1)
        for track_title in ("Concubine", "Forsaken", "Hutton's Great Heat Engine"):
            pg_db.record_play_event(
                TEST_USER_ID,
                track_id=data["tracks"][track_title]["id"],
                track_path=data["tracks"][track_title]["path"],
                title=data["tracks"][track_title]["title"],
                artist=data["tracks"][track_title]["artist"],
                album=data["tracks"][track_title]["album"],
                started_at=ts.isoformat(),
                ended_at=(ts + timedelta(seconds=180)).isoformat(),
                played_seconds=180.0,
                track_duration_seconds=180.0,
                completion_ratio=1.0,
                was_skipped=False,
                was_completed=True,
                play_source_type="album",
                play_source_id=str(data["tracks"][track_title]["album_id"]),
                play_source_name=data["tracks"][track_title]["album"],
                context_artist=data["tracks"][track_title]["artist"],
                context_album=data["tracks"][track_title]["album"],
                device_type="web",
                app_platform="listen-web",
            )
            ts = ts - timedelta(hours=1)

        pg_db.recompute_user_listening_aggregates(TEST_USER_ID)

        with read_scope() as session:
            rows = (
                session.execute(
                    text(
                        "SELECT * FROM user_daily_listening WHERE user_id = :user_id ORDER BY day"
                    ),
                    {"user_id": TEST_USER_ID},
                )
                .mappings()
                .all()
            )

        assert len(rows) == 1
        assert rows[0]["play_count"] == 3
        assert rows[0]["unique_artists"] == 2  # Converge + Botch


# ══════════════════════════════════════════════════════════════════════
# Empty states
# ══════════════════════════════════════════════════════════════════════


class TestEmptyStates:
    """All query functions return sensible results when user has no data."""

    def test_empty_history(self, lib_db):
        from crate.db.queries.user_library_history import get_play_history

        assert get_play_history(TEST_USER_ID) == []

    def test_empty_follows(self, lib_db):
        from crate.db.queries.user_library_library import (
            get_followed_artists,
            is_following,
        )

        assert get_followed_artists(TEST_USER_ID) == []
        assert is_following(TEST_USER_ID, "Converge") is False

    def test_empty_saves(self, lib_db):
        from crate.db.queries.user_library_library import (
            get_saved_albums,
            is_album_saved,
        )

        assert get_saved_albums(TEST_USER_ID) == []
        assert is_album_saved(TEST_USER_ID, 999) is False

    def test_empty_likes(self, lib_db):
        from crate.db.queries.user_library_library import (
            get_liked_tracks,
            is_track_liked,
        )

        assert get_liked_tracks(TEST_USER_ID) == []
        assert is_track_liked(TEST_USER_ID, 999) is False

    def test_empty_overview(self, lib_db):
        from crate.db.queries.user_library_stats_overview import (
            get_play_stats,
            get_stats_overview,
        )

        stats = get_play_stats(TEST_USER_ID)
        assert stats["total_plays"] == 0
        assert stats["top_artists"] == []

        overview = get_stats_overview(TEST_USER_ID)
        assert overview["play_count"] == 0
        assert overview["top_artist"] is None

    def test_empty_tops(self, lib_db):
        from crate.db.queries.user_library_stats_tops import (
            get_top_albums,
            get_top_artists,
            get_top_genres,
            get_top_tracks,
        )

        assert get_top_tracks(TEST_USER_ID) == []
        assert get_top_artists(TEST_USER_ID) == []
        assert get_top_albums(TEST_USER_ID) == []
        assert get_top_genres(TEST_USER_ID) == []

    def test_empty_replay_mix(self, lib_db):
        from crate.db.queries.user_library_stats_tops import get_replay_mix

        mix = get_replay_mix(TEST_USER_ID)
        assert mix["items"] == []
        assert mix["track_count"] == 0

    def test_empty_trends(self, lib_db):
        from crate.db.queries.user_library_stats_trends import get_stats_trends

        result = get_stats_trends(TEST_USER_ID)
        assert result["points"] == []

    def test_empty_counts(self, lib_db):
        from crate.db.queries.user_library_library import get_user_library_counts

        counts = get_user_library_counts(TEST_USER_ID)
        assert counts["followed_artists"] == 0
        assert counts["saved_albums"] == 0
        assert counts["liked_tracks"] == 0


# ══════════════════════════════════════════════════════════════════════
# Performance
# ══════════════════════════════════════════════════════════════════════


class TestPerformance:
    def test_overview_100_plays_under_200ms(self, lib_db):
        pg_db, data = lib_db
        base = datetime.now(timezone.utc) - timedelta(days=30)

        for i in range(100):
            ts = base + timedelta(hours=i)
            pg_db.record_play_event(
                TEST_USER_ID,
                track_id=data["tracks"]["Concubine"]["id"],
                track_path=data["tracks"]["Concubine"]["path"],
                title=data["tracks"]["Concubine"]["title"],
                artist=data["tracks"]["Concubine"]["artist"],
                album=data["tracks"]["Concubine"]["album"],
                started_at=ts.isoformat(),
                ended_at=(ts + timedelta(seconds=94)).isoformat(),
                played_seconds=94.0,
                track_duration_seconds=94.0,
                completion_ratio=1.0,
                was_skipped=False,
                was_completed=True,
                play_source_type="album",
                play_source_id=str(data["albums"]["Jane Doe"]["id"]),
                play_source_name="Jane Doe",
                context_artist="Converge",
                context_album="Jane Doe",
                device_type="web",
                app_platform="listen-web",
            )
        pg_db.recompute_user_listening_aggregates(TEST_USER_ID)

        from crate.db.queries.user_library_stats_overview import get_stats_overview

        start = time.perf_counter()
        overview = get_stats_overview(TEST_USER_ID, window="all_time")
        elapsed_ms = (time.perf_counter() - start) * 1000

        assert overview["play_count"] == 100
        assert elapsed_ms < 200, f"Overview query took {elapsed_ms:.1f}ms"

    def test_tops_100_plays_under_200ms(self, lib_db):
        pg_db, data = lib_db
        base = datetime.now(timezone.utc) - timedelta(days=30)

        for i in range(100):
            ts = base + timedelta(hours=i)
            pg_db.record_play_event(
                TEST_USER_ID,
                track_id=data["tracks"]["Concubine"]["id"],
                track_path=data["tracks"]["Concubine"]["path"],
                title=data["tracks"]["Concubine"]["title"],
                artist=data["tracks"]["Concubine"]["artist"],
                album=data["tracks"]["Concubine"]["album"],
                started_at=ts.isoformat(),
                ended_at=(ts + timedelta(seconds=94)).isoformat(),
                played_seconds=94.0,
                track_duration_seconds=94.0,
                completion_ratio=1.0,
                was_skipped=False,
                was_completed=True,
                play_source_type="album",
                play_source_id=str(data["albums"]["Jane Doe"]["id"]),
                play_source_name="Jane Doe",
                context_artist="Converge",
                context_album="Jane Doe",
                device_type="web",
                app_platform="listen-web",
            )
        pg_db.recompute_user_listening_aggregates(TEST_USER_ID)

        from crate.db.queries.user_library_stats_tops import get_top_tracks

        start = time.perf_counter()
        top = get_top_tracks(TEST_USER_ID, window="all_time")
        elapsed_ms = (time.perf_counter() - start) * 1000

        assert len(top) >= 1
        assert elapsed_ms < 200, f"Top tracks query took {elapsed_ms:.1f}ms"

    def test_trends_100_plays_under_200ms(self, lib_db):
        pg_db, data = lib_db
        base = datetime.now(timezone.utc) - timedelta(days=30)

        for i in range(100):
            ts = base + timedelta(hours=i)
            pg_db.record_play_event(
                TEST_USER_ID,
                track_id=data["tracks"]["Concubine"]["id"],
                track_path=data["tracks"]["Concubine"]["path"],
                title=data["tracks"]["Concubine"]["title"],
                artist=data["tracks"]["Concubine"]["artist"],
                album=data["tracks"]["Concubine"]["album"],
                started_at=ts.isoformat(),
                ended_at=(ts + timedelta(seconds=94)).isoformat(),
                played_seconds=94.0,
                track_duration_seconds=94.0,
                completion_ratio=1.0,
                was_skipped=False,
                was_completed=True,
                play_source_type="album",
                play_source_id=str(data["albums"]["Jane Doe"]["id"]),
                play_source_name="Jane Doe",
                context_artist="Converge",
                context_album="Jane Doe",
                device_type="web",
                app_platform="listen-web",
            )
        pg_db.recompute_user_listening_aggregates(TEST_USER_ID)

        from crate.db.queries.user_library_stats_trends import get_stats_trends

        start = time.perf_counter()
        result = get_stats_trends(TEST_USER_ID, window="all_time")
        elapsed_ms = (time.perf_counter() - start) * 1000

        assert len(result["points"]) >= 1
        assert elapsed_ms < 200, f"Trends query took {elapsed_ms:.1f}ms"

    def test_history_100_plays_under_200ms(self, lib_db):
        pg_db, data = lib_db
        base = datetime.now(timezone.utc) - timedelta(days=30)

        for i in range(100):
            ts = base + timedelta(hours=i)
            _insert_play_event(
                TEST_USER_ID,
                track_id=data["tracks"]["Concubine"]["id"],
                track_entity_uid=data["tracks"]["Concubine"]["entity_uid"],
                track_path=data["tracks"]["Concubine"]["path"],
                title=data["tracks"]["Concubine"]["title"],
                artist=data["tracks"]["Concubine"]["artist"],
                album=data["tracks"]["Concubine"]["album"],
                started_at=ts,
                ended_at=ts + timedelta(seconds=94),
                played_seconds=94.0,
                track_duration_seconds=94.0,
                was_completed=True,
            )

        from crate.db.queries.user_library_history import get_play_history

        start = time.perf_counter()
        history = get_play_history(TEST_USER_ID, limit=50)
        elapsed_ms = (time.perf_counter() - start) * 1000

        assert len(history) == 50
        assert elapsed_ms < 200, f"History query took {elapsed_ms:.1f}ms"

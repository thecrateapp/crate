"""Tests for social query modules."""

import pytest
from datetime import datetime, timedelta, timezone

from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def _create_user2(session):
    """Create a second user for FK-dependent tests."""
    from sqlalchemy import text

    existing = session.execute(text("SELECT id FROM users WHERE id = 2")).first()
    if existing:
        return
    session.execute(
        text(
            """
            INSERT INTO users (id, email, username, name, role, password_hash, created_at)
            VALUES (2, 'user2@test.com', 'user2', 'User Two', 'user', 'hash', NOW())
            """
        )
    )


class TestSocialShared:
    def test_cache_key_ordered_pair(self):
        from crate.db.queries.social_shared import cache_key

        assert cache_key(1, 2) == (1, 2)
        assert cache_key(2, 1) == (1, 2)
        assert cache_key(5, 5) == (5, 5)

    def test_user_profile_sql_includes_followers_following_friends(self):
        from crate.db.queries.social_shared import user_profile_sql

        sql = user_profile_sql("u.id = :user_id")
        assert "followers_count" in sql
        assert "following_count" in sql
        assert "friends_count" in sql
        assert "user_relationships" in sql


class TestSocialRelationships:
    def test_get_relationship_state_self_returns_false(self):
        from crate.db.queries.social_relationships import get_relationship_state

        state = get_relationship_state(1, 1)
        assert state == {"following": False, "followed_by": False, "is_friend": False}

    def test_get_relationship_state_no_relation(self, pg_db):
        from crate.db.queries.social_relationships import get_relationship_state

        state = get_relationship_state(999, 888)
        assert state["following"] is False
        assert state["followed_by"] is False
        assert state["is_friend"] is False

    def test_get_relationship_state_following_only(self, pg_db):
        from crate.db.queries.social_relationships import get_relationship_state
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        with transaction_scope() as session:
            _create_user2(session)
            session.execute(
                text(
                    "INSERT INTO user_relationships (follower_user_id, followed_user_id, created_at) VALUES (:f, :t, NOW())"
                ),
                {"f": 1, "t": 2},
            )

        state = get_relationship_state(1, 2)
        assert state["following"] is True
        assert state["followed_by"] is False
        assert state["is_friend"] is False

    def test_get_relationship_state_mutual_follow(self, pg_db):
        from crate.db.queries.social_relationships import get_relationship_state
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        with transaction_scope() as session:
            _create_user2(session)
            session.execute(
                text(
                    "INSERT INTO user_relationships (follower_user_id, followed_user_id, created_at) VALUES (:f, :t, NOW()), (:t, :f, NOW())"
                ),
                {"f": 1, "t": 2},
            )

        state = get_relationship_state(1, 2)
        assert state["following"] is True
        assert state["followed_by"] is True
        assert state["is_friend"] is True

    def test_get_relationship_state_followed_by_only(self, pg_db):
        from crate.db.queries.social_relationships import get_relationship_state
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        with transaction_scope() as session:
            _create_user2(session)
            session.execute(
                text(
                    "INSERT INTO user_relationships (follower_user_id, followed_user_id, created_at) VALUES (:f, :t, NOW())"
                ),
                {"f": 2, "t": 1},
            )

        state = get_relationship_state(1, 2)
        assert state["following"] is False
        assert state["followed_by"] is True
        assert state["is_friend"] is False


class TestSocialProfiles:
    def test_get_followers_empty(self, pg_db):
        from crate.db.queries.social_profiles import get_followers

        assert get_followers(1) == []

    def test_get_followers_returns_users(self, pg_db):
        from crate.db.queries.social_profiles import get_followers
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        with transaction_scope() as session:
            _create_user2(session)
            session.execute(
                text(
                    "INSERT INTO user_relationships (follower_user_id, followed_user_id, created_at) VALUES (:f, :t, NOW())"
                ),
                {"f": 1, "t": 2},
            )

        followers = get_followers(2)
        assert len(followers) == 1
        assert followers[0]["id"] == 1
        assert followers[0]["username"] == "admin"
        assert "followed_at" in followers[0]

    def test_get_followers_respects_limit(self, pg_db):
        from crate.db.queries.social_profiles import get_followers

        assert get_followers(1, limit=2) == []

    def test_get_following_empty(self, pg_db):
        from crate.db.queries.social_profiles import get_following

        assert get_following(1) == []

    def test_get_following_returns_users(self, pg_db):
        from crate.db.queries.social_profiles import get_following
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        with transaction_scope() as session:
            _create_user2(session)
            session.execute(
                text(
                    "INSERT INTO user_relationships (follower_user_id, followed_user_id, created_at) VALUES (:f, :t, NOW())"
                ),
                {"f": 1, "t": 2},
            )

        following = get_following(1)
        assert len(following) == 1
        assert following[0]["id"] == 2

    def test_search_users_empty_query(self, pg_db):
        from crate.db.queries.social_profiles import search_users

        assert search_users("") == []
        assert search_users("   ") == []

    def test_search_users_finds_by_username(self, pg_db):
        from crate.db.queries.social_profiles import search_users

        results = search_users("admin")
        assert len(results) >= 1
        assert results[0]["username"] == "admin"

    def test_search_users_no_match(self, pg_db):
        from crate.db.queries.social_profiles import search_users

        assert search_users("zzzz_nonexistent_32123") == []

    def test_get_public_user_profile_exists(self, pg_db):
        from crate.db.queries.social_profiles import get_public_user_profile

        profile = get_public_user_profile(1)
        assert profile is not None
        assert profile["id"] == 1
        assert profile["username"] == "admin"

    def test_get_public_user_profile_not_found(self, pg_db):
        from crate.db.queries.social_profiles import get_public_user_profile

        assert get_public_user_profile(99999) is None

    def test_get_public_user_profile_by_username_exists(self, pg_db):
        from crate.db.queries.social_profiles import get_public_user_profile_by_username

        profile = get_public_user_profile_by_username("admin")
        assert profile is not None
        assert profile["username"] == "admin"

    def test_get_public_user_profile_by_username_not_found(self, pg_db):
        from crate.db.queries.social_profiles import get_public_user_profile_by_username

        assert get_public_user_profile_by_username("nonexistent_xyzk") is None

    def test_get_public_playlists_for_user_empty(self, pg_db):
        from crate.db.queries.social_profiles import get_public_playlists_for_user

        assert get_public_playlists_for_user(1) == []

    def test_get_public_playlists_for_user_returns_public(self, pg_db):
        from crate.db.queries.social_profiles import get_public_playlists_for_user
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        with transaction_scope() as session:
            session.execute(
                text(
                    """
                    INSERT INTO playlists (name, scope, visibility, is_collaborative, track_count, total_duration, created_at, updated_at)
                    VALUES ('Public List', 'user', 'public', false, 0, 0, NOW(), NOW())
                    """
                )
            )
            row = (
                session.execute(
                    text("SELECT id FROM playlists WHERE name = 'Public List'")
                )
                .mappings()
                .first()
            )
            playlist_id = row["id"]
            session.execute(
                text(
                    "INSERT INTO playlist_members (playlist_id, user_id, role, created_at) VALUES (:pid, :uid, 'owner', NOW())"
                ),
                {"pid": playlist_id, "uid": 1},
            )

        playlists = get_public_playlists_for_user(1)
        assert len(playlists) == 1
        assert playlists[0]["name"] == "Public List"

    def test_get_public_playlists_for_user_excludes_private(self, pg_db):
        from crate.db.queries.social_profiles import get_public_playlists_for_user
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        with transaction_scope() as session:
            session.execute(
                text(
                    """
                    INSERT INTO playlists (name, scope, visibility, is_collaborative, track_count, total_duration, created_at, updated_at)
                    VALUES ('Private List', 'user', 'private', false, 0, 0, NOW(), NOW())
                    """
                )
            )
            row = (
                session.execute(
                    text("SELECT id FROM playlists WHERE name = 'Private List'")
                )
                .mappings()
                .first()
            )
            playlist_id = row["id"]
            session.execute(
                text(
                    "INSERT INTO playlist_members (playlist_id, user_id, role, created_at) VALUES (:pid, :uid, 'owner', NOW())"
                ),
                {"pid": playlist_id, "uid": 1},
            )

        playlists = get_public_playlists_for_user(1)
        assert playlists == []


class TestSocialAffinity:
    def test_get_cached_affinity_miss(self, pg_db):
        from crate.db.queries.social_affinity import get_cached_affinity

        assert get_cached_affinity(1, 2) is None

    def test_get_cached_affinity_hit(self, pg_db):
        from crate.db.queries.social_affinity import get_cached_affinity
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        now = datetime.now(timezone.utc)
        with transaction_scope() as session:
            _create_user2(session)
            session.execute(
                text(
                    """
                    INSERT INTO user_affinity_cache (user_a_id, user_b_id, affinity_score, affinity_band, reasons_json, computed_at)
                    VALUES (:a, :b, :score, :band, :reasons, :ts)
                    """
                ),
                {
                    "a": 1,
                    "b": 2,
                    "score": 75,
                    "band": "high",
                    "reasons": '["shared artists", "similar taste"]',
                    "ts": now,
                },
            )

        result = get_cached_affinity(1, 2)
        assert result is not None
        assert result["affinity_score"] == 75
        assert result["affinity_band"] == "high"
        assert result["affinity_reasons"] == ["shared artists", "similar taste"]

    def test_get_cached_affinity_reversed_order(self, pg_db):
        from crate.db.queries.social_affinity import get_cached_affinity
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        now = datetime.now(timezone.utc)
        with transaction_scope() as session:
            _create_user2(session)
            session.execute(
                text(
                    """
                    INSERT INTO user_affinity_cache (user_a_id, user_b_id, affinity_score, affinity_band, reasons_json, computed_at)
                    VALUES (:a, :b, :score, :band, :reasons, :ts)
                    """
                ),
                {
                    "a": 1,
                    "b": 2,
                    "score": 75,
                    "band": "high",
                    "reasons": '["shared"]',
                    "ts": now,
                },
            )

        result = get_cached_affinity(2, 1)
        assert result is not None
        assert result["affinity_score"] == 75

    def test_get_cached_affinity_expired(self, pg_db):
        from crate.db.queries.social_affinity import get_cached_affinity
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        old = datetime.now(timezone.utc) - timedelta(hours=25)
        with transaction_scope() as session:
            _create_user2(session)
            session.execute(
                text(
                    """
                    INSERT INTO user_affinity_cache (user_a_id, user_b_id, affinity_score, affinity_band, reasons_json, computed_at)
                    VALUES (:a, :b, :score, :band, :reasons, :ts)
                    """
                ),
                {
                    "a": 1,
                    "b": 2,
                    "score": 75,
                    "band": "high",
                    "reasons": '["shared"]',
                    "ts": old,
                },
            )

        assert get_cached_affinity(1, 2, max_age_hours=12) is None

    def test_get_affinity_overlap_counts_empty(self, pg_db):
        from crate.db.queries.social_affinity import get_affinity_overlap_counts

        counts = get_affinity_overlap_counts(1, 2)
        assert counts["shared_followed_artists"] == 0
        assert counts["shared_likes"] == 0
        assert counts["shared_top_artists"] == 0
        assert counts["shared_top_albums"] == 0
        assert counts["shared_top_tracks"] == 0
        assert counts["shared_recent_artists"] == 0
        assert counts["shared_discovery"] == 0

    def test_get_affinity_overlap_counts_shared_follows(self, pg_db):
        from crate.db.queries.social_affinity import get_affinity_overlap_counts
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        with transaction_scope() as session:
            _create_user2(session)
            session.execute(
                text(
                    "INSERT INTO user_follows (user_id, artist_name, created_at) VALUES (:uid, 'Artist One', NOW()), (:uid2, 'Artist One', NOW())"
                ),
                {"uid": 1, "uid2": 2},
            )

        counts = get_affinity_overlap_counts(1, 2)
        assert counts["shared_followed_artists"] == 1

    def test_get_affinity_overlap_counts_shared_likes(self, pg_db):
        from crate.db.queries.social_affinity import get_affinity_overlap_counts
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        with transaction_scope() as session:
            _create_user2(session)

        pg_db.upsert_artist({"name": "Like Artist"})
        album_id = pg_db.upsert_album(
            {
                "artist": "Like Artist",
                "name": "Like Album",
                "path": "/music/like-artist/like-album",
                "track_count": 1,
                "total_size": 1000,
                "total_duration": 180.0,
                "formats": ["flac"],
            }
        )
        pg_db.upsert_track(
            {
                "album_id": album_id,
                "artist": "Like Artist",
                "album": "Like Album",
                "filename": "01-like.flac",
                "title": "Like Track",
                "path": "/music/like-artist/like-album/01-like.flac",
                "duration": 180.0,
                "size": 1000,
                "format": "flac",
            }
        )

        with transaction_scope() as session:
            row = (
                session.execute(
                    text("SELECT id FROM library_tracks WHERE artist = 'Like Artist'")
                )
                .mappings()
                .first()
            )
            track_id = row["id"]
            session.execute(
                text(
                    "INSERT INTO user_liked_tracks (user_id, track_id, created_at) VALUES (:uid, :tid, NOW()), (:uid2, :tid, NOW())"
                ),
                {"uid": 1, "uid2": 2, "tid": track_id},
            )

        counts = get_affinity_overlap_counts(1, 2)
        assert counts["shared_likes"] == 1

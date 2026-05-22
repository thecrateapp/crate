"""Contract tests for the social API router.

Covers follow/unfollow, followers/following listings, user search,
public profiles, pagination, and auth requirements.
"""

from unittest.mock import patch

# ── Synthetic test data ──────────────────────────────────────────────

_VIEWER = {"id": 1, "email": "admin@cratemusic.app", "username": "admin"}

_TARGET_USER_ID = 2

_PROFILE = {
    "id": _TARGET_USER_ID,
    "username": "listener",
    "display_name": "Listener One",
    "avatar": "/avatars/2.webp",
    "bio": "Music lover",
    "joined_at": "2024-01-15T12:00:00",
    "followers_count": 42,
    "following_count": 17,
    "friends_count": 5,
}

_SEARCH_RESULTS = [
    {
        "id": 2,
        "username": "listener",
        "display_name": "Listener One",
        "avatar": "/avatars/2.webp",
        "bio": "Music lover",
        "joined_at": "2024-01-15T12:00:00",
    },
    {
        "id": 3,
        "username": "dj_test",
        "display_name": "DJ Test",
        "avatar": None,
        "bio": None,
        "joined_at": "2024-06-01T08:30:00",
    },
]

_PLAYLISTS = [
    {
        "id": 10,
        "name": "My Favorites",
        "track_count": 25,
        "is_smart": False,
        "follower_count": 3,
        "is_followed": False,
    },
]

_RELATIONSHIP = {"following": False, "followed_by": False, "is_friend": False}

_RELATIONSHIP_FOLLOWING = {"following": True, "followed_by": False, "is_friend": False}

_AFFINITY = {
    "affinity_score": 75,
    "affinity_band": "medium",
    "affinity_reasons": ["similar genre taste"],
    "computed_at": "2024-06-15T10:00:00",
}

_FOLLOWERS = [
    {
        "id": 4,
        "username": "fan1",
        "display_name": "Fan One",
        "avatar": None,
        "followed_at": "2024-02-01T12:00:00",
    },
    {
        "id": 5,
        "username": "fan2",
        "display_name": "Fan Two",
        "avatar": "/avatars/5.webp",
        "followed_at": "2024-03-15T09:00:00",
    },
]

_FOLLOWING = [
    {
        "id": 6,
        "username": "artist_x",
        "display_name": "Artist X",
        "avatar": None,
        "followed_at": "2024-01-20T14:00:00",
    },
]

_ME_SOCIAL = {
    "followers_count": 10,
    "following_count": 25,
    "friends_count": 3,
}

_SELF_PROFILE = {
    "id": 1,
    "username": "admin",
    "display_name": "Test Admin",
    "avatar": None,
    "bio": None,
    "joined_at": "2024-01-01T00:00:00",
    "followers_count": 10,
    "following_count": 25,
    "friends_count": 3,
}


# ── Error helpers ────────────────────────────────────────────────────


def _assert_401(resp):
    assert resp.status_code == 401


def _assert_404(resp):
    assert resp.status_code == 404
    assert "detail" in resp.json()


def _assert_422(resp):
    assert resp.status_code == 422


# ── /api/me/social ───────────────────────────────────────────────────


class TestSocialMe:
    def test_my_social_returns_profile_and_counts(self, test_app):
        with (
            patch(
                "crate.api.social.get_public_user_profile",
                return_value=_SELF_PROFILE,
            ),
            patch(
                "crate.api.social.get_me_social",
                return_value=_ME_SOCIAL,
            ),
        ):
            resp = test_app.get("/api/me/social")
            assert resp.status_code == 200
            data = resp.json()
            assert data["followers_count"] == 10
            assert data["following_count"] == 25
            assert data["friends_count"] == 3
            assert data["profile"]["username"] == "admin"
            assert data["profile"]["id"] == 1

    def test_my_social_profile_not_found(self, test_app):
        with patch(
            "crate.api.social.get_public_user_profile",
            return_value=None,
        ):
            resp = test_app.get("/api/me/social")
            _assert_404(resp)


# ── /api/users/search ────────────────────────────────────────────────


class TestSocialSearch:
    def test_search_returns_results(self, test_app):
        with patch(
            "crate.api.social.search_users",
            return_value=_SEARCH_RESULTS,
        ):
            resp = test_app.get("/api/users/search?q=listener")
            assert resp.status_code == 200
            data = resp.json()
            assert isinstance(data, list)
            assert len(data) == 2
            assert data[0]["username"] == "listener"
            assert data[1]["username"] == "dj_test"

    def test_search_empty_results(self, test_app):
        with patch(
            "crate.api.social.search_users",
            return_value=[],
        ):
            resp = test_app.get("/api/users/search?q=nonexistent")
            assert resp.status_code == 200
            assert resp.json() == []

    def test_search_missing_query_param(self, test_app):
        """q is required (min_length=1), so missing/empty returns 422."""
        resp = test_app.get("/api/users/search")
        _assert_422(resp)

    def test_search_with_limit(self, test_app):
        with patch(
            "crate.api.social.search_users",
            return_value=_SEARCH_RESULTS[:1],
        ) as mock_search:
            resp = test_app.get("/api/users/search?q=listener&limit=1")
            assert resp.status_code == 200
            mock_search.assert_called_once_with("listener", limit=1)


# ── /api/users/{username} ────────────────────────────────────────────


class TestSocialProfile:
    def test_profile_returns_full_detail(self, test_app):
        with (
            patch(
                "crate.api.social.get_public_user_profile_by_username",
                return_value=dict(_PROFILE),
            ),
            patch(
                "crate.api.social.get_public_playlists_for_user",
                return_value=_PLAYLISTS,
            ),
            patch(
                "crate.api.social.get_relationship_state",
                return_value=_RELATIONSHIP,
            ),
            patch(
                "crate.api.social.get_affinity",
                return_value=dict(_AFFINITY),
            ),
        ):
            resp = test_app.get("/api/users/listener")
            assert resp.status_code == 200
            data = resp.json()
            assert data["username"] == "listener"
            assert data["display_name"] == "Listener One"
            assert data["followers_count"] == 42
            assert len(data["public_playlists"]) == 1
            assert data["public_playlists"][0]["name"] == "My Favorites"
            assert data["public_playlists"][0]["track_count"] == 25
            assert data["relationship_state"] == _RELATIONSHIP
            assert data["affinity_score"] == 75
            assert data["affinity_band"] == "medium"

    def test_profile_user_not_found(self, test_app):
        with patch(
            "crate.api.social.get_public_user_profile_by_username",
            return_value=None,
        ):
            resp = test_app.get("/api/users/nonexistent")
            _assert_404(resp)

    def test_profile_relationship_state_following(self, test_app):
        with (
            patch(
                "crate.api.social.get_public_user_profile_by_username",
                return_value=dict(_PROFILE),
            ),
            patch(
                "crate.api.social.get_public_playlists_for_user",
                return_value=[],
            ),
            patch(
                "crate.api.social.get_relationship_state",
                return_value=_RELATIONSHIP_FOLLOWING,
            ),
            patch(
                "crate.api.social.get_affinity",
                return_value=dict(_AFFINITY),
            ),
        ):
            resp = test_app.get("/api/users/listener")
            data = resp.json()
            assert data["relationship_state"]["following"] is True
            assert data["relationship_state"]["is_friend"] is False


# ── /api/users/{username}/page ───────────────────────────────────────


class TestSocialProfilePage:
    def test_profile_page_includes_previews(self, test_app):
        with (
            patch(
                "crate.api.social.get_public_user_profile_by_username",
                return_value=dict(_PROFILE),
            ),
            patch(
                "crate.api.social.get_public_playlists_for_user",
                return_value=_PLAYLISTS,
            ),
            patch(
                "crate.api.social.get_relationship_state",
                return_value=_RELATIONSHIP,
            ),
            patch(
                "crate.api.social.get_affinity",
                return_value=dict(_AFFINITY),
            ),
            patch(
                "crate.api.social.get_followers",
                return_value=_FOLLOWERS,
            ),
            patch(
                "crate.api.social.get_following",
                return_value=_FOLLOWING,
            ),
        ):
            resp = test_app.get("/api/users/listener/page")
            assert resp.status_code == 200
            data = resp.json()
            assert data["username"] == "listener"
            assert data["followers_preview"] == _FOLLOWERS
            assert data["following_preview"] == _FOLLOWING
            assert len(data["followers_preview"]) == 2
            assert len(data["following_preview"]) == 1

    def test_profile_page_user_not_found(self, test_app):
        with patch(
            "crate.api.social.get_public_user_profile_by_username",
            return_value=None,
        ):
            resp = test_app.get("/api/users/nonexistent/page")
            _assert_404(resp)


# ── /api/users/{username}/followers ──────────────────────────────────


class TestSocialFollowers:
    def test_followers_list(self, test_app):
        with (
            patch(
                "crate.api.social.get_public_user_profile_by_username",
                return_value=dict(_PROFILE),
            ),
            patch(
                "crate.api.social.get_followers",
                return_value=_FOLLOWERS,
            ),
        ):
            resp = test_app.get("/api/users/listener/followers")
            assert resp.status_code == 200
            data = resp.json()
            assert isinstance(data, list)
            assert len(data) == 2
            assert data[0]["username"] == "fan1"
            assert data[1]["username"] == "fan2"

    def test_followers_empty(self, test_app):
        with (
            patch(
                "crate.api.social.get_public_user_profile_by_username",
                return_value=dict(_PROFILE),
            ),
            patch(
                "crate.api.social.get_followers",
                return_value=[],
            ),
        ):
            resp = test_app.get("/api/users/listener/followers")
            assert resp.status_code == 200
            assert resp.json() == []

    def test_followers_with_limit(self, test_app):
        with (
            patch(
                "crate.api.social.get_public_user_profile_by_username",
                return_value=dict(_PROFILE),
            ),
            patch(
                "crate.api.social.get_followers",
                return_value=_FOLLOWERS[:1],
            ) as mock_get,
        ):
            resp = test_app.get("/api/users/listener/followers?limit=1")
            assert resp.status_code == 200
            mock_get.assert_called_once_with(_TARGET_USER_ID, limit=1)

    def test_followers_user_not_found(self, test_app):
        with patch(
            "crate.api.social.get_public_user_profile_by_username",
            return_value=None,
        ):
            resp = test_app.get("/api/users/nonexistent/followers")
            _assert_404(resp)


# ── /api/users/{username}/following ──────────────────────────────────


class TestSocialFollowing:
    def test_following_list(self, test_app):
        with (
            patch(
                "crate.api.social.get_public_user_profile_by_username",
                return_value=dict(_PROFILE),
            ),
            patch(
                "crate.api.social.get_following",
                return_value=_FOLLOWING,
            ),
        ):
            resp = test_app.get("/api/users/listener/following")
            assert resp.status_code == 200
            data = resp.json()
            assert isinstance(data, list)
            assert len(data) == 1
            assert data[0]["username"] == "artist_x"

    def test_following_empty(self, test_app):
        with (
            patch(
                "crate.api.social.get_public_user_profile_by_username",
                return_value=dict(_PROFILE),
            ),
            patch(
                "crate.api.social.get_following",
                return_value=[],
            ),
        ):
            resp = test_app.get("/api/users/listener/following")
            assert resp.status_code == 200
            assert resp.json() == []

    def test_following_with_limit(self, test_app):
        with (
            patch(
                "crate.api.social.get_public_user_profile_by_username",
                return_value=dict(_PROFILE),
            ),
            patch(
                "crate.api.social.get_following",
                return_value=_FOLLOWING,
            ) as mock_get,
        ):
            resp = test_app.get("/api/users/listener/following?limit=10")
            assert resp.status_code == 200
            mock_get.assert_called_once_with(_TARGET_USER_ID, limit=10)

    def test_following_user_not_found(self, test_app):
        with patch(
            "crate.api.social.get_public_user_profile_by_username",
            return_value=None,
        ):
            resp = test_app.get("/api/users/nonexistent/following")
            _assert_404(resp)


# ── /api/users/{user_id}/follow (POST) ───────────────────────────────


class TestSocialFollow:
    def test_follow_user_success(self, test_app):
        with (
            patch(
                "crate.api.social.get_public_user_profile",
                return_value=dict(_PROFILE),
            ),
            patch(
                "crate.api.social.follow_user",
                return_value=True,
            ) as mock_follow,
            patch(
                "crate.api.social.get_relationship_state",
                return_value=_RELATIONSHIP_FOLLOWING,
            ),
        ):
            resp = test_app.post("/api/users/2/follow")
            assert resp.status_code == 200
            data = resp.json()
            assert data["ok"] is True
            assert data["added"] is True
            assert data["relationship_state"]["following"] is True
            mock_follow.assert_called_once_with(_VIEWER["id"], _TARGET_USER_ID)

    def test_follow_already_following(self, test_app):
        """Following an already-followed user returns added=False."""
        with (
            patch(
                "crate.api.social.get_public_user_profile",
                return_value=dict(_PROFILE),
            ),
            patch(
                "crate.api.social.follow_user",
                return_value=False,
            ),
            patch(
                "crate.api.social.get_relationship_state",
                return_value=_RELATIONSHIP_FOLLOWING,
            ),
        ):
            resp = test_app.post("/api/users/2/follow")
            assert resp.status_code == 200
            data = resp.json()
            assert data["ok"] is True
            assert data["added"] is False

    def test_follow_user_not_found(self, test_app):
        with patch(
            "crate.api.social.get_public_user_profile",
            return_value=None,
        ):
            resp = test_app.post("/api/users/999/follow")
            _assert_404(resp)


# ── /api/users/{user_id}/follow (DELETE) ─────────────────────────────


class TestSocialUnfollow:
    def test_unfollow_user_success(self, test_app):
        with (
            patch(
                "crate.api.social.get_public_user_profile",
                return_value=dict(_PROFILE),
            ),
            patch(
                "crate.api.social.unfollow_user",
                return_value=True,
            ) as mock_unfollow,
            patch(
                "crate.api.social.get_relationship_state",
                return_value=_RELATIONSHIP,
            ),
        ):
            resp = test_app.delete("/api/users/2/follow")
            assert resp.status_code == 200
            data = resp.json()
            assert data["ok"] is True
            assert data["relationship_state"]["following"] is False
            mock_unfollow.assert_called_once_with(_VIEWER["id"], _TARGET_USER_ID)

    def test_unfollow_not_following(self, test_app):
        """Unfollowing someone you don't follow returns 404."""
        with (
            patch(
                "crate.api.social.get_public_user_profile",
                return_value=dict(_PROFILE),
            ),
            patch(
                "crate.api.social.unfollow_user",
                return_value=False,
            ),
        ):
            resp = test_app.delete("/api/users/2/follow")
            _assert_404(resp)

    def test_unfollow_user_not_found(self, test_app):
        with patch(
            "crate.api.social.get_public_user_profile",
            return_value=None,
        ):
            resp = test_app.delete("/api/users/999/follow")
            _assert_404(resp)

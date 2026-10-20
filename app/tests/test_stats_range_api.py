"""Range summary routes for the signed-in listener and other users."""

from datetime import date
from unittest.mock import patch

TODAY = date(2026, 10, 21)

_PAYLOAD = {
    "start": "2026-10-01",
    "end": "2026-10-21",
    "available": True,
    "top_artists": [
        {
            "artist_name": "Converge",
            "artist_id": 3,
            "artist_slug": "converge",
            "minutes": 120.5,
            "plays": 30,
            "share": 0.4,
        }
    ],
    "top_albums": [
        {
            "album": "Jane Doe",
            "artist": "Converge",
            "plays": 12,
            "minutes": 50.0,
            "album_id": 18,
            "album_slug": "jane-doe",
            "global_album_uid": "abc-123",
        }
    ],
    "top_tracks": [
        {
            "track_id": 7,
            "title": "Concubine",
            "artist": "Converge",
            "album": "Jane Doe",
            "album_id": 18,
            "album_slug": "jane-doe",
            "global_album_uid": "abc-123",
            "artist_id": 3,
            "artist_slug": "converge",
            "plays": 5,
            "minutes": 4.0,
        }
    ],
    "discoveries": [
        {
            "artist_name": "Cult of Luna",
            "artist_id": 9,
            "artist_slug": "cult-of-luna",
            "first_day": "2026-10-05",
            "minutes": 33.0,
        }
    ],
}

_PROFILE = {"id": 42, "username": "ana", "display_name": "Ana", "avatar": None}


def _today_for(user_id):
    # The viewer (id 1) is far behind the profile owner (id 42): only the
    # owner's "today" lets the 2026-10 ranges through.
    return TODAY if user_id == 42 else date(2026, 1, 1)


def _me(test_app, qs):
    with (
        patch("crate.api.me.user_stats_today", return_value=TODAY),
        patch("crate.api.me.get_user_stats_range", return_value=dict(_PAYLOAD)) as q,
    ):
        return test_app.get(f"/api/me/stats/range?{qs}"), q


def _user(test_app, qs, profile=_PROFILE):
    with (
        patch(
            "crate.api.social.get_public_user_profile_by_username",
            return_value=profile,
        ),
        patch("crate.api.social.user_stats_today", side_effect=_today_for) as today,
        patch(
            "crate.api.social.get_user_stats_range", return_value=dict(_PAYLOAD)
        ) as q,
    ):
        resp = test_app.get(f"/api/users/ana/stats/range?{qs}")
    q.today_mock = today
    return resp, q


def _assert_shape(data):
    assert data["available"] is True
    assert data["top_artists"][0]["share"] == 0.4
    assert data["top_albums"][0]["global_album_uid"] == "abc-123"
    assert data["top_tracks"][0]["album_slug"] == "jane-doe"
    assert data["top_tracks"][0]["minutes"] == 4.0
    assert data["discoveries"][0]["first_day"] == "2026-10-05"


def test_me_range_returns_the_summary(test_app):
    resp, q = _me(test_app, "start=2026-10-01&end=2026-10-21&limit=5")
    assert resp.status_code == 200
    _assert_shape(resp.json())
    assert q.call_args.args[1:] == (date(2026, 10, 1), date(2026, 10, 21))
    assert q.call_args.kwargs["limit"] == 5


def test_user_range_returns_the_summary(test_app):
    resp, q = _user(test_app, "start=2026-10-01&end=2026-10-21")
    assert resp.status_code == 200
    _assert_shape(resp.json())
    assert q.call_args.args[0] == 42
    assert q.call_args.kwargs["limit"] == 3


def test_range_accepts_400_days_and_rejects_401(test_app):
    assert (date(2026, 10, 21) - date(2025, 9, 16)).days == 400
    ok, _ = _me(test_app, "start=2025-09-16&end=2026-10-21")
    assert ok.status_code == 200
    too_long, q = _me(test_app, "start=2025-09-15&end=2026-10-21")
    assert too_long.status_code == 422
    q.assert_not_called()


def test_range_rejects_inverted_and_future_ranges(test_app):
    assert _me(test_app, "start=2026-10-10&end=2026-10-01")[0].status_code == 422
    assert _me(test_app, "start=2026-10-10&end=2026-10-22")[0].status_code == 422
    assert _user(test_app, "start=2026-10-10&end=2026-10-01")[0].status_code == 422


def test_range_rejects_out_of_bounds_limit(test_app):
    base = "start=2026-10-01&end=2026-10-21"
    assert _me(test_app, f"{base}&limit=21")[0].status_code == 422
    assert _me(test_app, f"{base}&limit=0")[0].status_code == 422


def test_user_range_404s_for_unknown_username(test_app):
    resp, q = _user(test_app, "start=2026-10-01&end=2026-10-21", profile=None)
    assert resp.status_code == 404
    q.assert_not_called()


def test_user_range_uses_the_profile_owners_today(test_app):
    resp, q = _user(test_app, "start=2026-10-01&end=2026-10-21")
    assert resp.status_code == 200
    q.today_mock.assert_called_once_with(42)
    # Same range is future for the viewer's timezone, so the check must follow
    # the profile owner and nobody else.
    assert _today_for(1) < date(2026, 10, 21)


def test_user_stats_today_follows_the_listener_timezone():
    from crate.db.queries import user_library_stats_range as mod

    with patch.object(mod, "user_stats_timezone", return_value="Pacific/Kiritimati"):
        ahead = mod.user_stats_today(5)
    with patch.object(mod, "user_stats_timezone", return_value="Pacific/Pago_Pago"):
        behind = mod.user_stats_today(5)
    assert ahead > behind

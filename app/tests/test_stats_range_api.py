"""Range summary routes for the signed-in listener and other users."""

from datetime import date
from unittest.mock import patch

from crate.db.queries.user_library_stats_range import validate_stats_range

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


def _reader(*, known: bool = True):
    """Stand-in for the range readers: validate the bounds as they do, then answer.

    The readers resolve the subject's "today" inside their read scope and raise
    ``StatsRangeError`` before querying (``tests/test_user_stats_range.py``); the
    routes only map that error to 422 and an unknown profile to 404.
    """

    def _read(*args, limit):
        start, end = args[-2:]
        if not known:
            return None
        validate_stats_range(start, end, today=TODAY)
        return dict(_PAYLOAD)

    return _read


def _me(test_app, qs):
    with patch("crate.api.me.get_user_stats_range", side_effect=_reader()) as q:
        return test_app.get(f"/api/me/stats/range?{qs}"), q


def _user(test_app, qs, *, known=True):
    with patch(
        "crate.api.social.get_public_user_stats_range",
        side_effect=_reader(known=known),
    ) as q:
        return test_app.get(f"/api/users/ana/stats/range?{qs}"), q


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
    # The profile owner, never the viewer, bounds the range: the route hands
    # the username to the reader, which resolves the owner in its own scope.
    assert q.call_args.args == ("ana", date(2026, 10, 1), date(2026, 10, 21))
    assert q.call_args.kwargs["limit"] == 3


def test_range_accepts_400_days_and_rejects_401(test_app):
    assert (date(2026, 10, 21) - date(2025, 9, 16)).days == 400
    ok, _ = _me(test_app, "start=2025-09-16&end=2026-10-21")
    assert ok.status_code == 200
    too_long, _ = _me(test_app, "start=2025-09-15&end=2026-10-21")
    assert too_long.status_code == 422
    assert "400 days" in too_long.json()["detail"]


def test_range_rejects_inverted_and_future_ranges(test_app):
    assert _me(test_app, "start=2026-10-10&end=2026-10-01")[0].status_code == 422
    assert _me(test_app, "start=2026-10-10&end=2026-10-22")[0].status_code == 422
    assert _user(test_app, "start=2026-10-10&end=2026-10-01")[0].status_code == 422


def test_range_rejects_out_of_bounds_limit(test_app):
    base = "start=2026-10-01&end=2026-10-21"
    assert _me(test_app, f"{base}&limit=21")[0].status_code == 422
    assert _me(test_app, f"{base}&limit=0")[0].status_code == 422


def test_user_range_404s_for_unknown_username(test_app):
    resp, _ = _user(test_app, "start=2026-10-01&end=2026-10-21", known=False)
    assert resp.status_code == 404


def test_user_stats_today_follows_the_listener_timezone():
    from crate.db.queries import user_library_stats_range as mod

    with patch.object(mod, "user_stats_timezone", return_value="Pacific/Kiritimati"):
        ahead = mod.user_stats_today(5)
    with patch.object(mod, "user_stats_timezone", return_value="Pacific/Pago_Pago"):
        behind = mod.user_stats_today(5)
    assert ahead > behind


def _instance(test_app, qs):
    with patch(
        "crate.api.analytics.get_instance_stats_range", side_effect=_reader()
    ) as q:
        return test_app.get(f"/api/stats/range?{qs}"), q


def test_instance_range_route_returns_the_summary_and_validates(test_app):
    resp, q = _instance(test_app, "start=2026-10-01&end=2026-10-21&limit=4")
    assert resp.status_code == 200
    _assert_shape(resp.json())
    assert q.call_args.args == (date(2026, 10, 1), date(2026, 10, 21))
    assert q.call_args.kwargs["limit"] == 4
    for qs in (
        "start=2026-10-10&end=2026-10-01",
        "start=2026-10-10&end=2026-10-22",
        "start=2025-09-15&end=2026-10-21",
    ):
        bad, _ = _instance(test_app, qs)
        assert bad.status_code == 422
    bad, q = _instance(test_app, "start=2026-10-01&end=2026-10-21&limit=21")
    assert bad.status_code == 422
    q.assert_not_called()


def test_instance_stats_today_admits_the_furthest_ahead_listener_day(monkeypatch):
    from datetime import date, datetime, timezone

    from crate.db.queries import user_library_stats_range as module

    class FixedDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 10, 24, 22, 30, tzinfo=timezone.utc)

    monkeypatch.setattr(module, "datetime", FixedDatetime)

    assert module.instance_stats_today() == date(2026, 10, 25)
    module.validate_stats_range(
        date(2026, 10, 25), date(2026, 10, 25), today=module.instance_stats_today()
    )

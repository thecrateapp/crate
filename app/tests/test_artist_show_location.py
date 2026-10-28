from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from starlette.requests import Request


def test_upcoming_uses_the_same_city_fallback_as_artist_pages(test_app):
    location = dict(
        user_lat=40.4,
        user_lon=-3.7,
        user_radius=60,
        user_city="Madrid",
        user_country="ES",
    )
    with (
        patch(
            "crate.api.me.get_followed_artists",
            return_value=[{"artist_name": "Samiam"}],
        ),
        patch("crate.api.me.resolve_show_location", return_value=location),
        patch("crate.api.me.get_upcoming_releases", return_value=[]),
        patch("crate.api.me.get_upcoming_shows", return_value=[]) as shows,
        patch("crate.api.me.get_attending_show_ids", return_value=set()),
        patch("crate.api.me.get_artist_genres_for_names", return_value={}),
        patch("crate.api.me._build_upcoming_insights", return_value=[]),
    ):
        response = test_app.get("/api/me/upcoming?limit=12")
    assert response.status_code == 200
    assert shows.call_args.kwargs == dict(limit=12, **location)
    assert response.json()["summary"]["followed_artists"] == 1


def test_artist_page_applies_saved_location_before_the_show_limit():
    from crate.api.browse_artist import _get_artist_page_shows

    location = dict(
        user_lat=40.4168,
        user_lon=-3.7038,
        user_radius=60,
        user_city="Madrid",
        user_country="ES",
    )
    with (
        patch("crate.api.browse_artist._library_artist_ref", return_value=None),
        patch("crate.api.browse_artist.get_artist_genres_by_name", return_value=[]),
        patch("crate.setlistfm.get_cached_probable_setlist", return_value=[]),
        patch("crate.ticketmaster.is_configured", return_value=False),
        patch("crate.api.browse_artist.db_get_shows", return_value=[]) as all_shows,
        patch(
            "crate.api.browse_artist.get_user_upcoming_shows", return_value=[]
        ) as nearby,
    ):
        _get_artist_page_shows(
            user_id=1, name="Samiam", limit=1, country="", location=location
        )
    all_shows.assert_not_called()
    nearby.assert_called_once()
    assert nearby.call_args.kwargs == dict(
        followed_names=["Samiam"],
        today=datetime.now(timezone.utc).date(),
        limit=1,
        **location,
    )


def test_resolve_show_location_uses_full_saved_profile_not_session_claims():
    from crate.api.show_location import resolve_show_location

    request = Request({"type": "http", "client": ("127.0.0.1", 1234), "headers": []})
    with patch(
        "crate.api.show_location.get_user_by_id",
        return_value=dict(
            city="Madrid",
            country_code="ES",
            latitude=40.4,
            longitude=-3.7,
            show_radius_km=60,
        ),
    ):
        assert resolve_show_location(request, 1) == dict(
            user_lat=40.4,
            user_lon=-3.7,
            user_radius=60,
            user_city="Madrid",
            user_country="ES",
        )


def test_resolve_near_me_uses_detected_city_for_ungeocoded_shows():
    from crate.api.show_location import resolve_show_location

    request = Request({"type": "http", "client": ("127.0.0.1", 1234), "headers": []})
    with (
        patch(
            "crate.api.show_location.get_user_by_id",
            return_value=dict(
                city="Madrid", show_location_mode="near_me", show_radius_km=80
            ),
        ),
        patch(
            "crate.geolocation.detect_location_from_ip",
            return_value=dict(
                city="Barcelona", country_code="ES", latitude=41.4, longitude=2.1
            ),
        ),
    ):
        assert resolve_show_location(request, 1) == dict(
            user_lat=41.4,
            user_lon=2.1,
            user_radius=80,
            user_city="Barcelona",
            user_country="ES",
        )


def test_resolve_show_location_without_a_configured_location():
    from crate.api.show_location import resolve_show_location

    request = Request({"type": "http", "headers": []})
    with patch("crate.api.show_location.get_user_by_id", return_value={}):
        assert resolve_show_location(request, 1) is None


def test_ungeocoded_madrid_show_is_not_hidden_by_earlier_foreign_dates(pg_db):
    from sqlalchemy import text
    from crate.db.tx import transaction_scope
    from crate.db.queries.user import get_upcoming_shows

    today = datetime.now(timezone.utc).date()
    shows = [("London", "GB", None, None)] * 13 + [
        ("Madrid", "US", None, None),
        ("Madrid", "ES", None, None),
        ("Getafe", "ES", 40.30, -3.73),
    ]
    with transaction_scope() as session:
        for index, (city, country, lat, lon) in enumerate(shows):
            session.execute(
                text(
                    "INSERT INTO shows (artist_name, date, city, country_code, venue, latitude, longitude, created_at, updated_at) VALUES ('Samiam', :date, :city, :country, :venue, :lat, :lon, NOW(), NOW())"
                ),
                dict(
                    date=today + timedelta(days=index + 1),
                    city=city,
                    country=country,
                    venue=f"Venue {index}",
                    lat=lat,
                    lon=lon,
                ),
            )
    rows = get_upcoming_shows(
        ["Samiam"],
        today,
        40.4168,
        -3.7038,
        60,
        1,
        user_city="Madrid",
        user_country="ES",
    )
    assert [(row["city"], row["country_code"]) for row in rows] == [("Madrid", "ES")]
    rows = get_upcoming_shows(
        ["Samiam"],
        today,
        40.4168,
        -3.7038,
        60,
        10,
        user_city="Madrid",
        user_country="ES",
    )
    assert [row["city"] for row in rows] == ["Madrid", "Getafe"]


def test_failed_ip_lookups_are_cached_so_requests_do_not_retry_the_provider(
    monkeypatch,
):
    import requests

    from crate import geolocation
    from crate.db import cache_store

    store: dict = {}
    calls: list[str] = []
    monkeypatch.setattr(
        cache_store, "get_cache", lambda key, max_age_seconds=None: store.get(key)
    )
    monkeypatch.setattr(
        cache_store,
        "set_cache",
        lambda key, value, ttl=None: store.__setitem__(key, value),
    )

    def unreachable(url, **kwargs):
        calls.append(url)
        assert kwargs["timeout"] == 2
        raise requests.Timeout("ip-api unreachable")

    monkeypatch.setattr(geolocation.requests, "get", unreachable)

    assert geolocation.detect_location_from_ip("203.0.113.7") is None
    assert geolocation.detect_location_from_ip("203.0.113.7") is None
    assert len(calls) == 1
    assert store["geo:ip:203.0.113.7"] == {"failed": True}

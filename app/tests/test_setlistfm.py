from datetime import date
from unittest.mock import patch

from crate.setlistfm import (
    _predict_setlist,
    get_cached_probable_setlist_context,
    get_upcoming_shows,
    is_shows_sync_enabled,
    normalize_upcoming_show,
    shows_sync_max_artists,
)


def _event(**overrides):
    event = {
        "id": "setlist-123",
        "eventDate": "31-12-2099",
        "artist": {"name": "The Example"},
        "venue": {
            "name": "The Venue",
            "city": {
                "name": "Madrid",
                "state": "Madrid",
                "stateCode": "MD",
                "country": {"name": "Spain", "code": "ES"},
                "coords": {"lat": 40.4168, "long": -3.7038},
            },
        },
        "url": "https://www.setlist.fm/setlist/example/setlist-123.html",
    }
    event.update(overrides)
    return event


def test_normalize_upcoming_show_maps_stable_event_fields():
    result = normalize_upcoming_show(_event(), today=date(2026, 8, 22))

    assert result == {
        "external_id": "setlistfm:setlist-123",
        "artist_name": "The Example",
        "date": "2099-12-31",
        "local_time": None,
        "venue": "The Venue",
        "address_line1": None,
        "city": "Madrid",
        "region": "Madrid",
        "postal_code": None,
        "country": "Spain",
        "country_code": "ES",
        "latitude": 40.4168,
        "longitude": -3.7038,
        "url": "https://www.setlist.fm/setlist/example/setlist-123.html",
        "image_url": None,
        "lineup": ["The Example"],
        "price_range": None,
        "tickets_url": None,
        "status": "scheduled",
        "source": "setlistfm",
    }


def test_normalize_upcoming_show_rejects_past_and_malformed_dates():
    assert (
        normalize_upcoming_show(_event(eventDate="21-08-2026"), today=date(2026, 8, 22))
        is None
    )
    assert (
        normalize_upcoming_show(_event(eventDate="2026-08-23"), today=date(2026, 8, 22))
        is None
    )


def test_normalize_upcoming_show_keeps_today_without_fabricating_time_or_ticketing():
    result = normalize_upcoming_show(
        _event(eventDate="22-08-2026"), today=date(2026, 8, 22)
    )

    assert result is not None
    assert result["date"] == "2026-08-22"
    assert result["local_time"] is None
    assert result["price_range"] is None
    assert result["tickets_url"] is None


def test_normalize_upcoming_show_uses_fallback_artist_name():
    result = normalize_upcoming_show(
        _event(artist=None),
        fallback_artist_name="Fallback Artist",
        today=date(2026, 8, 22),
    )

    assert result is not None
    assert result["artist_name"] == "Fallback Artist"
    assert result["lineup"] == ["Fallback Artist"]


def test_normalize_upcoming_show_requires_id_artist_venue_and_date():
    assert normalize_upcoming_show(_event(id=""), today=date(2026, 8, 22)) is None
    assert (
        normalize_upcoming_show(_event(artist={"name": ""}), today=date(2026, 8, 22))
        is None
    )
    assert (
        normalize_upcoming_show(_event(venue={"name": ""}), today=date(2026, 8, 22))
        is None
    )
    assert (
        normalize_upcoming_show(_event(eventDate=""), today=date(2026, 8, 22)) is None
    )


def test_setlist_prediction_prioritizes_the_active_tour_over_historical_shows():
    predicted = _predict_setlist(
        [
            {
                "date": "10-01-2025",
                "tour": "Previous Tour",
                "songs": ["Old Anthem", "Old Closer"],
            },
            {
                "date": "09-01-2025",
                "tour": "Previous Tour",
                "songs": ["Old Anthem", "Old Closer"],
            },
            {
                "date": "28-09-2026",
                "tour": "30th Anniversary Tour",
                "songs": ["New Intro", "New Single", "New Closer"],
            },
            {
                "date": "27-09-2026",
                "tour": "30th Anniversary Tour",
                "songs": ["New Intro", "New Single", "New Closer"],
            },
        ],
        today=date(2026, 9, 30),
    )

    assert predicted is not None
    titles = [song["title"] for song in predicted]
    assert titles[:3] == ["New Intro", "New Single", "New Closer"]
    assert "Old Anthem" not in titles


def test_setlist_prediction_sorts_dates_and_counts_each_song_once_per_show():
    predicted = _predict_setlist(
        [
            {
                "date": "27-09-2026",
                "tour": "Current Tour",
                "songs": ["Anchor", "Finale"],
            },
            {
                "date": "28-09-2026",
                "tour": "Current Tour",
                "songs": ["Anchor", "Anchor", "Finale"],
            },
        ],
        today=date(2026, 9, 30),
    )

    assert predicted is not None
    anchor = next(song for song in predicted if song["title"] == "Anchor")
    assert anchor["play_count"] == 2
    assert anchor["last_played"] == "28-09-2026"
    assert anchor["frequency"] == 1.0


def test_setlist_prediction_does_not_mix_one_recent_show_with_old_history():
    predicted = _predict_setlist(
        [
            {
                "date": "10-01-2025",
                "tour": "Previous Tour",
                "songs": ["Old Anthem"],
            },
            {
                "date": "28-09-2026",
                "tour": "30th Anniversary Tour",
                "songs": ["New Intro"],
            },
        ],
        today=date(2026, 9, 30),
    )

    assert predicted is not None
    assert [song["title"] for song in predicted] == ["New Intro"]


def test_setlist_prediction_uses_recency_when_no_active_tour_is_detected():
    predicted = _predict_setlist(
        [
            {
                "date": "01-01-2026",
                "tour": "Older Tour",
                "songs": ["Recent Opening"],
            },
            {
                "date": "30-06-2025",
                "tour": "Older Tour",
                "songs": ["Old Anthem"],
            },
            {
                "date": "29-06-2025",
                "tour": "Older Tour",
                "songs": ["Old Anthem"],
            },
            {
                "date": "28-06-2025",
                "tour": "Older Tour",
                "songs": ["Old Anthem"],
            },
        ],
        today=date(2026, 9, 30),
    )

    assert predicted is not None
    assert predicted[0]["title"] == "Recent Opening"


def test_cached_probable_setlist_context_validates_the_model_version():
    payload = {
        "model_version": 2,
        "context": {
            "model_version": 2,
            "mode": "active_tour",
            "source_show_count": 4,
            "source_date_from": "2026-09-20",
            "source_date_to": "2026-09-28",
            "tour_name": "30th Anniversary Tour",
        },
        "songs": [],
    }
    with patch("crate.setlistfm.get_cache", return_value=payload):
        context = get_cached_probable_setlist_context("Placebo")

    assert context == payload["context"]


def test_normalize_upcoming_show_does_not_trust_invalid_coordinates():
    event = _event()
    event["venue"]["city"]["coords"] = {"lat": "not-a-number", "long": None}

    result = normalize_upcoming_show(event, today=date(2026, 8, 22))

    assert result is not None
    assert result["latitude"] is None
    assert result["longitude"] is None


def test_get_upcoming_shows_is_bounded_filters_past_events_and_deduplicates(
    monkeypatch,
):
    calls = []
    duplicate = _event(id="show-a", eventDate="23-08-2026")

    def fake_get_setlists(mbid, page=1, per_page=20):
        calls.append((mbid, page, per_page))
        return {
            "setlist": [
                duplicate,
                _event(id="show-past", eventDate="21-08-2026"),
                {**duplicate, "venue": {"name": "Updated Venue"}},
            ]
        }

    monkeypatch.setattr("crate.setlistfm.get_setlists", fake_get_setlists)

    result = get_upcoming_shows("artist-mbid", limit=10, today=date(2026, 8, 22))

    assert [show["external_id"] for show in result] == ["setlistfm:show-a"]
    assert result[0]["venue"] == "Updated Venue"
    assert calls == [("artist-mbid", 1, 20)]


def test_get_upcoming_shows_does_not_call_provider_without_mbid(monkeypatch):
    called = False

    def fail_get_setlists(*args, **kwargs):
        nonlocal called
        called = True
        raise AssertionError("provider should not be called")

    monkeypatch.setattr("crate.setlistfm.get_setlists", fail_get_setlists)

    assert get_upcoming_shows("", limit=10) == []
    assert called is False


def test_setlist_shows_sync_is_opt_in(monkeypatch):
    monkeypatch.delenv("SETLISTFM_SHOWS_SYNC_ENABLED", raising=False)
    assert is_shows_sync_enabled() is False

    monkeypatch.setenv("SETLISTFM_SHOWS_SYNC_ENABLED", "true")
    assert is_shows_sync_enabled() is True


def test_setlist_shows_sync_artist_limit_is_bounded(monkeypatch):
    monkeypatch.setenv("SETLISTFM_SHOWS_SYNC_MAX_ARTISTS", "5000")
    assert shows_sync_max_artists() == 1000

    monkeypatch.setenv("SETLISTFM_SHOWS_SYNC_MAX_ARTISTS", "invalid")
    assert shows_sync_max_artists() == 100

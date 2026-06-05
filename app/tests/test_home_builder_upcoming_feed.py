from datetime import date

from crate.db.home_builder_upcoming_feed import (
    _build_release_items,
    _build_show_items,
    _load_probable_setlists,
)


def test_build_release_items_preserves_card_ready_metadata():
    items = _build_release_items(
        [
            {
                "id": 8,
                "artist_name": "Nid Archives",
                "artist_id": 42,
                "artist_slug": "nid-archives",
                "album_id": 99,
                "album_slug": "emotional-junglist",
                "album_title": "Emotional Junglist",
                "release_type": "Album",
                "release_date": "2026-07-24",
                "cover_url": "https://img.example/cover.jpg",
                "tidal_url": "https://tidal.com/album/123",
                "status": "detected",
            }
        ],
        today=date(2026, 5, 17),
    )

    assert items == [
        {
            "type": "release",
            "date": "2026-07-24",
            "artist": "Nid Archives",
            "artist_id": 42,
            "artist_slug": "nid-archives",
            "album_id": 99,
            "album_slug": "emotional-junglist",
            "title": "Emotional Junglist",
            "subtitle": "Album",
            "cover_url": "https://img.example/cover.jpg",
            "status": "detected",
            "tidal_url": "https://tidal.com/album/123",
            "release_id": 8,
            "is_upcoming": True,
        }
    ]


def test_build_show_items_preserves_home_card_metadata():
    items = _build_show_items(
        [
            {
                "id": 7,
                "artist_name": "Placebo",
                "artist_id": 12,
                "artist_slug": "placebo",
                "date": "2026-10-01",
                "local_time": "20:30:00",
                "venue": "Movistar Arena",
                "city": "Madrid",
                "country": "Spain",
                "url": "https://tickets.example/placebo",
                "image_url": "https://img.example/placebo.jpg",
            }
        ],
        probable_setlists={"Placebo": [{"title": "Pure Morning"}]},
        attending_show_ids={7},
    )

    assert items[0] == {
        "id": 7,
        "type": "show",
        "date": "2026-10-01",
        "time": "20:30:00",
        "artist": "Placebo",
        "artist_id": 12,
        "artist_slug": "placebo",
        "title": "Movistar Arena",
        "subtitle": "Madrid, Spain",
        "cover_url": "https://img.example/placebo.jpg",
        "venue": "Movistar Arena",
        "city": "Madrid",
        "country": "Spain",
        "url": "https://tickets.example/placebo",
        "is_upcoming": True,
        "user_attending": True,
        "probable_setlist": [{"title": "Pure Morning"}],
    }


def test_load_probable_setlists_uses_cached_values_and_fetches_missing(monkeypatch):
    cached = {"Placebo": [{"title": "Pure Morning"}]}
    fetched: list[str] = []

    def fake_cached(artist_name: str):
        return cached.get(artist_name)

    def fake_live(artist_name: str):
        fetched.append(artist_name)
        return [{"title": "Una historia con las manos"}]

    monkeypatch.setattr("crate.setlistfm.get_cached_probable_setlist", fake_cached)
    monkeypatch.setattr("crate.setlistfm.get_probable_setlist", fake_live)

    result = _load_probable_setlists(
        ["Placebo", "Biznaga"],
        live_fetch_limit=1,
    )

    assert result == {
        "Placebo": [{"title": "Pure Morning"}],
        "Biznaga": [{"title": "Una historia con las manos"}],
    }
    assert fetched == ["Biznaga"]


def test_load_probable_setlists_limits_live_fetches(monkeypatch):
    fetched: list[str] = []

    monkeypatch.setattr(
        "crate.setlistfm.get_cached_probable_setlist", lambda _artist_name: None
    )

    def fake_live(artist_name: str):
        fetched.append(artist_name)
        return [{"title": artist_name}]

    monkeypatch.setattr("crate.setlistfm.get_probable_setlist", fake_live)

    result = _load_probable_setlists(
        ["Artist A", "Artist B", "Artist C"],
        live_fetch_limit=2,
    )

    assert result == {
        "Artist A": [{"title": "Artist A"}],
        "Artist B": [{"title": "Artist B"}],
    }
    assert fetched == ["Artist A", "Artist B"]

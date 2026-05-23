from datetime import date

from crate.db.home_builder_upcoming_feed import _build_release_items, _build_show_items


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

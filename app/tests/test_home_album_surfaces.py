from datetime import date

from crate.db.home_album_surfaces import (
    filter_published_albums,
    filter_upcoming_albums,
    merge_upcoming_albums,
)
from crate.db.home_builder_release_recommendations import build_upcoming_albums


def test_published_albums_exclude_future_and_explicit_pre_releases():
    albums = [
        {"album_name": "Published", "release_date": "2026-08-01"},
        {"album_name": "Future", "release_date": "2026-08-20"},
        {
            "album_name": "Announced",
            "release_date": "2026-08-01",
            "is_pre_release": True,
        },
        {"album_name": "Status only", "status": "pre-release"},
        {"album_name": "Undated"},
    ]

    result = filter_published_albums(albums, today=date(2026, 8, 15))

    assert [album["album_name"] for album in result] == ["Published", "Undated"]


def test_upcoming_albums_are_sorted_by_nearest_release_date():
    albums = [
        {"album_name": "Later", "release_date": "2026-09-01"},
        {"album_name": "Soon", "release_date": "2026-08-16"},
        {"album_name": "Today", "release_date": "2026-08-15"},
        {"album_name": "Missing date"},
    ]

    result = filter_upcoming_albums(albums, today=date(2026, 8, 15))

    assert [album["album_name"] for album in result] == ["Soon", "Later"]


def test_upcoming_albums_dedupe_local_and_global_candidates():
    result = merge_upcoming_albums(
        [
            {
                "album_name": "Soon",
                "artist_name": "Artist",
                "release_date": "2026-08-20",
                "album_id": 10,
            }
        ],
        [
            {
                "album_name": "Soon",
                "artist_name": "Artist",
                "release_date": "2026-08-20",
                "global_album_uid": "global-soon",
            },
            {
                "album_name": "Later",
                "artist_name": "Other Artist",
                "release_date": "2026-09-01",
                "global_album_uid": "global-later",
            },
        ],
        limit=10,
        today=date(2026, 8, 15),
    )

    assert [album["album_name"] for album in result] == ["Soon", "Later"]
    assert result[0]["album_id"] == 10


def test_build_upcoming_albums_maps_release_tracker_rows_to_album_cards():
    result = build_upcoming_albums(
        [
            {
                "id": 44,
                "artist_name": "Rival Schools",
                "album_title": "New Record",
                "artist_id": 7,
                "artist_slug": "rival-schools",
                "release_date": "2026-09-01",
                "cover_url": "https://img.example/new-record.jpg",
            }
        ],
        10,
    )

    assert result == [
        {
            "album_id": -44,
            "global_album_uid": None,
            "global_artist_uid": None,
            "album_entity_uid": None,
            "album_slug": None,
            "artist_name": "Rival Schools",
            "artist_id": 7,
            "artist_entity_uid": None,
            "artist_slug": "rival-schools",
            "album_name": "New Record",
            "year": None,
            "release_date": "2026-09-01",
            "release_type": "Album",
            "cover_url": "https://img.example/new-record.jpg",
            "is_pre_release": True,
        }
    ]

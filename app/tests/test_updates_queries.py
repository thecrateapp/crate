from crate.db.queries.updates import build_updates_feed


def test_build_updates_feed_deduplicates_and_preserves_source_metadata():
    items = build_updates_feed(
        releases=[
            {
                "type": "release",
                "artist": "Artist",
                "title": "New LP",
                "date": "2026-08-20",
                "source": "new_releases",
                "source_url": "https://crate.test/releases/new-lp",
            },
            {
                "artist_name": "Artist",
                "album_title": "Future LP",
                "release_date": "2026-09-10",
                "detected_at": "2026-08-18T10:00:00+00:00",
                "source_url": "https://crate.test/releases/future-lp",
            },
        ],
        shows=[
            {
                "id": 7,
                "artist_name": "Artist",
                "venue": "Sala Radar",
                "city": "Madrid",
                "country": "ES",
                "date": "2026-08-25",
                "url": "https://shows.test/7",
                "source": "ticketmaster",
            },
            {
                "id": 8,
                "artist_name": "Artist",
                "venue": "Sala Radar",
                "city": "Madrid",
                "country": "ES",
                "date": "2026-08-25",
                "url": "https://shows.test/duplicate",
                "source": "setlistfm",
            },
        ],
        radar_items=[
            {
                "source": "wishlist",
                "item_url": "https://artist.bandcamp.com/album/new-lp",
                "artist_name": "Artist",
                "album_title": "New LP",
                "updated_at": "2026-08-19T10:00:00+00:00",
            },
            {
                "source": "following",
                "item_url": "https://other.bandcamp.com/album/other-lp",
                "artist_name": "Other Artist",
                "album_title": "Other LP",
                "release_date": "2026-08-19",
            },
        ],
        followed_artists=[
            {"artist_name": "New Follow", "created_at": "2026-08-21T09:00:00+00:00"}
        ],
        bandcamp_connected=True,
        limit=20,
    )

    assert [item["type"] for item in items] == [
        "release",
        "show",
        "artist",
        "release",
        "bandcamp",
    ]
    assert items[0]["title"] == "Future LP"
    assert items[0]["source"] == "new_releases"
    assert items[1]["canonical_url"] == "https://shows.test/7"
    assert items[2]["artist"] == "New Follow"
    assert items[3]["title"] == "New LP"
    assert items[4]["canonical_url"] == "https://other.bandcamp.com/album/other-lp"
    assert len({item["dedupe_key"] for item in items}) == len(items)


def test_build_updates_feed_supports_stable_offset_and_limit():
    releases = [
        {
            "artist": "Artist",
            "title": f"Release {index}",
            "date": f"2026-08-{20 - index:02d}",
        }
        for index in range(4)
    ]

    all_items = build_updates_feed(
        releases=releases,
        shows=[],
        radar_items=[],
        followed_artists=[],
        bandcamp_connected=False,
        limit=20,
    )
    page = build_updates_feed(
        releases=releases,
        shows=[],
        radar_items=[],
        followed_artists=[],
        bandcamp_connected=False,
        limit=2,
        offset=1,
    )

    assert [item["title"] for item in page] == [
        all_items[1]["title"],
        all_items[2]["title"],
    ]


def test_build_updates_feed_excludes_bandcamp_without_active_connection():
    items = build_updates_feed(
        releases=[],
        shows=[],
        radar_items=[
            {
                "source": "wishlist",
                "item_url": "https://artist.bandcamp.com/album/lp",
                "artist_name": "Artist",
                "album_title": "LP",
            }
        ],
        followed_artists=[],
        bandcamp_connected=False,
        limit=20,
    )

    assert items == []

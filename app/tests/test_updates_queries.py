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


def test_build_updates_feed_keeps_provenance_when_local_release_wins_dedupe():
    items = build_updates_feed(
        releases=[
            {
                "artist": "Artist",
                "title": "New LP",
                "date": "2026-08-20",
                "source_url": "https://crate.test/releases/new-lp",
            }
        ],
        shows=[],
        radar_items=[
            {
                "source": "discover_followed",
                "item_url": "https://artist.bandcamp.com/album/new-lp",
                "artist_name": "Artist",
                "album_title": "New LP",
                "release_date": "2026-08-20",
            }
        ],
        followed_artists=[],
        bandcamp_connected=True,
        limit=20,
    )

    assert len(items) == 1
    assert items[0]["source"] == "new_releases"
    assert items[0]["provenance"] == [
        {
            "source": "new_releases",
            "canonical_url": "https://crate.test/releases/new-lp",
        },
        {
            "source": "bandcamp",
            "source_detail": "discover_followed",
            "canonical_url": "https://artist.bandcamp.com/album/new-lp",
        },
    ]


def test_build_updates_feed_exposes_bandcamp_provenance_for_unique_item():
    items = build_updates_feed(
        releases=[],
        shows=[],
        radar_items=[
            {
                "source": "discover_followed",
                "item_url": "https://artist.bandcamp.com/album/unique-lp",
                "artist_name": "Artist",
                "album_title": "Unique LP",
                "release_date": "2026-08-20",
            }
        ],
        followed_artists=[],
        bandcamp_connected=True,
        limit=20,
    )

    assert items[0]["source"] == "bandcamp"
    assert items[0]["source_detail"] == "discover_followed"
    assert items[0]["provenance"] == [
        {
            "source": "bandcamp",
            "source_detail": "discover_followed",
            "canonical_url": "https://artist.bandcamp.com/album/unique-lp",
        }
    ]


def test_build_updates_feed_maps_rss_news_and_keeps_release_deduplication():
    items = build_updates_feed(
        releases=[
            {
                "artist": "Artist",
                "title": "New LP",
                "date": "2026-08-20",
                "source": "new_releases",
            }
        ],
        shows=[],
        radar_items=[],
        external_feed_items=[
            {
                "item_kind": "release",
                "artist_name": "Artist",
                "title": "New LP",
                "canonical_url": "https://artist.bandcamp.com/album/new-lp",
                "published_at": "2026-08-20T10:00:00+00:00",
                "source_kind": "bandcamp_rss",
                "payload_json": {"image_url": "https://artist.bandcamp.com/cover.jpg"},
            },
            {
                "item_kind": "news",
                "artist_name": "Artist",
                "title": "Tour announcement",
                "canonical_url": "https://artist.bandcamp.com/news/tour",
                "published_at": "2026-08-21T10:00:00+00:00",
                "excerpt": "New dates announced.",
                "source_kind": "bandcamp_rss",
                "payload_json": {},
            },
        ],
        followed_artists=[],
        bandcamp_connected=True,
        limit=20,
    )

    assert [item["type"] for item in items] == ["news", "release"]
    assert items[0]["source"] == "bandcamp_rss"
    assert items[0]["title"] == "Tour announcement"
    assert "payload_json" not in items[0]
    assert items[1]["source"] == "new_releases"
    assert items[1]["provenance"] == [
        {"source": "new_releases"},
        {
            "source": "bandcamp_rss",
            "canonical_url": "https://artist.bandcamp.com/album/new-lp",
        },
    ]


def test_build_updates_feed_excludes_rss_without_active_connection():
    items = build_updates_feed(
        releases=[],
        shows=[],
        radar_items=[],
        external_feed_items=[
            {
                "item_kind": "news",
                "artist_name": "Artist",
                "title": "Private feed item",
                "canonical_url": "https://artist.bandcamp.com/news/private",
            }
        ],
        followed_artists=[],
        bandcamp_connected=False,
        limit=20,
    )

    assert items == []


def test_build_updates_feed_exposes_only_accepted_editorial_summary():
    items = build_updates_feed(
        releases=[],
        shows=[],
        radar_items=[],
        external_feed_items=[
            {
                "item_kind": "news",
                "artist_name": "Artist",
                "title": "Tour announcement",
                "canonical_url": "https://artist.bandcamp.com/news/tour",
                "published_at": "2026-08-23T10:00:00+00:00",
                "source_kind": "bandcamp_rss",
                "accepted_enrichment_json": {
                    "summary": "The band announced European tour dates.",
                    "key_points": ["European tour"],
                    "generated_at": "2026-08-23T12:00:00+00:00",
                },
                "accepted_enrichment_model": "ollama/test",
                "accepted_enrichment_prompt_version": "external-feed-summary-v1",
            }
        ],
        followed_artists=[],
        bandcamp_connected=True,
        limit=20,
    )

    assert items[0]["editorial_summary"] == ("The band announced European tour dates.")
    assert items[0]["editorial_summary_key_points"] == ["European tour"]
    assert items[0]["editorial_summary_model"] == "ollama/test"
    assert items[0]["editorial_summary_prompt_version"] == "external-feed-summary-v1"
    assert items[0]["editorial_summary_generated_at"] == "2026-08-23T12:00:00+00:00"


def test_build_updates_feed_does_not_expose_missing_editorial_summary():
    items = build_updates_feed(
        releases=[],
        shows=[],
        radar_items=[],
        external_feed_items=[
            {
                "item_kind": "news",
                "artist_name": "Artist",
                "title": "Pending announcement",
                "canonical_url": "https://artist.bandcamp.com/news/pending",
                "source_kind": "bandcamp_rss",
            }
        ],
        followed_artists=[],
        bandcamp_connected=True,
        limit=20,
    )

    assert "editorial_summary" not in items[0]

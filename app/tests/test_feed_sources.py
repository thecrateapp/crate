from crate.feeds.sources import select_bandcamp_feed_candidates


def test_select_bandcamp_feed_candidates_validates_deduplicates_and_prefers_user_intent():
    candidates = select_bandcamp_feed_candidates(
        [
            {
                "artist_id": 10,
                "artist_name": "Example",
                "artist_url": "https://example.bandcamp.com/",
                "association_method": "explicit_artist_url",
            },
            {
                "artist_id": None,
                "artist_name": "Example",
                "artist_url": "https://EXAMPLE.bandcamp.com",
                "association_method": "bandcamp_wishlist",
            },
            {
                "artist_id": 10,
                "artist_name": "Example",
                "artist_url": "https://example.bandcamp.com",
                "association_method": "followed_artist",
            },
            {
                "artist_id": 11,
                "artist_name": "Not Bandcamp",
                "artist_url": "https://example.com",
                "association_method": "explicit_artist_url",
            },
            {
                "artist_id": 12,
                "artist_name": "Root",
                "artist_url": "https://bandcamp.com",
                "association_method": "explicit_artist_url",
            },
        ]
    )

    assert candidates == (
        {
            "artist_id": 10,
            "artist_name": "Example",
            "artist_url": "https://example.bandcamp.com",
            "association_method": "followed_artist",
        },
    )


def test_select_bandcamp_feed_candidates_applies_limit_after_deduplication():
    rows = [
        {
            "artist_id": index,
            "artist_name": f"Artist {index}",
            "artist_url": f"https://artist-{index}.bandcamp.com",
            "association_method": "explicit_artist_url",
        }
        for index in range(3)
    ]

    selected = select_bandcamp_feed_candidates(rows, limit=2)

    assert len(selected) == 2
    assert [item["artist_id"] for item in selected] == [0, 1]


def test_select_bandcamp_feed_candidates_skips_malformed_ports():
    assert (
        select_bandcamp_feed_candidates(
            [
                {
                    "artist_url": "https://artist.bandcamp.com:invalid",
                    "association_method": "explicit_artist_url",
                }
            ]
        )
        == ()
    )

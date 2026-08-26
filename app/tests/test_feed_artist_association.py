from crate.feeds.artist_association import rank_artist_association_candidates


def test_rank_artist_association_auto_selects_unique_exact_title_match():
    result = rank_artist_association_candidates(
        item={
            "title": "Neon Wolves announce their new album",
            "author": "",
            "excerpt": "The band returns this autumn.",
            "canonical_url": "https://pitchfork.com/news/neon-wolves",
        },
        artists=[
            {"id": 7, "name": "Neon Wolves", "slug": "neon-wolves"},
        ],
    )

    assert result["auto_candidate"]["artist_id"] == 7
    assert result["auto_candidate"]["association_method"] == "deterministic_title_match"
    assert result["candidates"][0]["artist_name"] == "Neon Wolves"


def test_rank_artist_association_keeps_close_matches_for_review():
    result = rank_artist_association_candidates(
        item={
            "title": "New music from The Cure",
            "author": "",
            "excerpt": "A new piece arrives this week.",
            "canonical_url": "https://example.test/news/cure",
        },
        artists=[
            {"id": 7, "name": "The Cure", "slug": "the-cure"},
            {"id": 8, "name": "Cure", "slug": "cure"},
        ],
    )

    assert result["auto_candidate"] is None
    assert {candidate["artist_id"] for candidate in result["candidates"]} == {7, 8}
    assert result["requires_review"] is True


def test_rank_artist_association_returns_no_candidates_for_unrelated_item():
    result = rank_artist_association_candidates(
        item={
            "title": "The state of independent music",
            "author": "Editorial desk",
            "excerpt": "A broad overview of the scene.",
            "canonical_url": "https://example.test/news/scene",
        },
        artists=[
            {"id": 7, "name": "Neon Wolves", "slug": "neon-wolves"},
        ],
    )

    assert result["candidates"] == []
    assert result["auto_candidate"] is None
    assert result["requires_review"] is False


def test_rank_artist_association_does_not_auto_apply_editorial_author_match():
    result = rank_artist_association_candidates(
        item={
            "title": "A new story from the scene",
            "author": "Neon Wolves",
            "excerpt": "The editorial team shares a roundup.",
            "canonical_url": "https://example.test/news/roundup",
        },
        artists=[{"id": 7, "name": "Neon Wolves", "slug": "neon-wolves"}],
    )

    assert result["auto_candidate"] is None
    assert result["requires_review"] is True

from datetime import datetime, timedelta, timezone

import pytest

from crate.lyrics_cache_policy import (
    has_lyrics,
    is_fresh,
    lyrics_rank,
    normalize_refresh_mode,
    should_replace_lyrics,
)

NOW = datetime(2026, 10, 28, 12, 0, tzinfo=timezone.utc)
SYNCED = {"syncedLyrics": "[00:01.00]Words", "plainLyrics": "Words"}
PLAIN = {"syncedLyrics": None, "plainLyrics": "Words"}
EMPTY = {"syncedLyrics": None, "plainLyrics": None}


@pytest.mark.parametrize(
    ("payload", "rank"),
    [
        (None, 0),
        (EMPTY, 0),
        ({"syncedLyrics": "  ", "plainLyrics": "\n"}, 0),
        (PLAIN, 1),
        (SYNCED, 2),
        ({"syncedLyrics": "[00:01.00]Words", "plainLyrics": None}, 2),
    ],
)
def test_lyrics_rank_orders_none_plain_synced(payload, rank):
    assert lyrics_rank(payload) == rank
    assert has_lyrics(payload) is (rank > 0)


@pytest.mark.parametrize(
    ("existing", "candidate", "replace"),
    [
        (None, EMPTY, True),
        (None, PLAIN, True),
        (EMPTY, EMPTY, False),
        (EMPTY, PLAIN, True),
        (PLAIN, SYNCED, True),
        (SYNCED, PLAIN, False),
        (SYNCED, EMPTY, False),
        (PLAIN, EMPTY, False),
        (PLAIN, {"syncedLyrics": None, "plainLyrics": "Other words"}, False),
        (SYNCED, {"syncedLyrics": "[00:02.00]Other", "plainLyrics": None}, False),
    ],
)
def test_should_replace_lyrics_only_promotes_better_content(
    existing, candidate, replace
):
    assert should_replace_lyrics(existing, candidate) is replace


def test_is_fresh_respects_age_and_parses_iso_strings():
    recent = NOW - timedelta(days=1)
    old = NOW - timedelta(days=31)
    ttl = 86400 * 30

    assert is_fresh(recent, ttl, now=NOW) is True
    assert is_fresh(old, ttl, now=NOW) is False
    assert is_fresh(recent.isoformat(), ttl, now=NOW) is True
    assert is_fresh(recent.replace(tzinfo=None), ttl, now=NOW) is True
    assert is_fresh(old, None, now=NOW) is True
    assert is_fresh(None, ttl, now=NOW) is False
    assert is_fresh("not-a-date", ttl, now=NOW) is False


def test_normalize_refresh_mode_defaults_to_missing_and_rejects_unknown():
    assert normalize_refresh_mode(None) == "missing"
    assert normalize_refresh_mode(" DUE ") == "due"
    assert normalize_refresh_mode("upgrade") == "upgrade"
    with pytest.raises(ValueError):
        normalize_refresh_mode("everything")

from datetime import timedelta

import pytest


def test_policy_defaults_define_seven_day_significant_listening():
    from crate.recommendation_policy import (
        RECENT_PLAY_WINDOW,
        SIGNIFICANT_PLAY_RATIO,
        SIGNIFICANT_PLAY_SECONDS,
    )

    assert RECENT_PLAY_WINDOW == timedelta(days=7)
    assert SIGNIFICANT_PLAY_SECONDS == 30.0
    assert SIGNIFICANT_PLAY_RATIO == 0.5


@pytest.mark.parametrize(
    ("duration", "expected"),
    [(180, 30), (60, 30), (40, 20), (1, 0.5), (None, 30), (0, 30), (-1, 30)],
)
def test_significant_play_threshold_caps_half_duration_at_thirty_seconds(
    duration, expected
):
    from crate.recommendation_policy import significant_play_threshold

    assert significant_play_threshold(duration) == expected


@pytest.mark.parametrize(
    ("seconds", "duration", "completed", "expected"),
    [
        (18.77, 180, False, False),
        (29.999, 180, False, False),
        (30, 180, False, True),
        (19.99, 40, False, False),
        (20, 40, False, True),
        (0, 40, False, False),
        (0, 40, True, True),
        (18.77, 180, True, True),
        (29.99, None, False, False),
        (30, None, False, True),
        (30, 0, False, True),
        (0, None, False, False),
        (-10, 180, False, False),
        (None, None, False, False),
        (float("nan"), 180, False, False),
    ],
)
def test_significance_uses_each_events_seconds_or_completion(
    seconds, duration, completed, expected
):
    from crate.recommendation_policy import is_significant_play

    assert is_significant_play(seconds, duration, was_completed=completed) is expected


def test_canonical_key_reuses_version_families_without_grouping_an_artist():
    from crate.recommendation_policy import canonical_key
    from crate.track_versions import track_song_identity

    track = {"artist": "Birds In Row", "title": "Noah (2022 Remastered)"}
    assert (
        canonical_key(track) == track_song_identity(track) == ("birds in row", "noah")
    )
    assert canonical_key(track) == canonical_key(
        {"artist_name": "BIRDS IN ROW", "title": "Noah - Live"}
    )
    assert canonical_key(track) != canonical_key(
        {"artist": "Birds In Row", "title": "Cathedrals"}
    )
    assert canonical_key({"id": 123}) is None

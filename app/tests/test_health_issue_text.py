"""Readable copy and stable identity for health issues."""

import pytest

from crate.health_issue_text import describe_health_issue, health_issue_identity


def test_identity_ignores_key_order_and_changes_with_details():
    first = health_issue_identity("duplicate_tracks", {"a": 1, "b": [1, 2]})
    same = health_issue_identity("duplicate_tracks", {"b": [1, 2], "a": 1})
    changed = health_issue_identity("duplicate_tracks", {"a": 1, "b": [1, 3]})
    other_check = health_issue_identity("duplicate_albums", {"a": 1, "b": [1, 2]})

    assert first == same
    assert first != changed
    assert first != other_check


def test_identity_falls_back_to_the_description_without_details():
    assert health_issue_identity("missing_cover", None, "x") != health_issue_identity(
        "missing_cover", None, "y"
    )


@pytest.mark.parametrize(
    ("check", "details", "expected"),
    [
        (
            "duplicate_tracks",
            {
                "artist": "Converge",
                "album": "Jane Doe",
                "title": "Concubine",
                "track_number": 1,
                "count": 2,
            },
            "Converge / Jane Doe: #1 'Concubine' appears 2 times",
        ),
        (
            "duplicate_albums",
            {"artist": "Converge", "album": "Jane Doe", "count": 3},
            "Converge / Jane Doe: 3 copies of the album",
        ),
        (
            "fk_orphan_tracks",
            {"track_path": "/music/a/b/01 - Song.flac", "album_id": 4},
            "Track without an album: 01 - Song.flac",
        ),
        (
            "unindexed_files",
            {"dir": "/music/Unknown/Loose", "count": 12},
            "12 audio files not in the library: Loose",
        ),
        (
            "tag_mismatch",
            {
                "track_path": "/music/x/1.flac",
                "db_artist": "Converge",
                "tag_artist": "converge",
            },
            "1.flac: tag artist 'converge' differs from 'Converge'",
        ),
    ],
)
def test_descriptions_are_human_readable(check, details, expected):
    assert describe_health_issue(check, details) == expected


def test_unknown_checks_still_get_a_label():
    assert describe_health_issue("brand_new_check", {}) == "brand new check"

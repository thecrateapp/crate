import pytest

from crate.album_editions import edition_base_key, edition_overlaps


@pytest.mark.parametrize(
    ("name", "key"),
    [
        ("October Rust (Special Edition)", "october rust"),
        ("October Rust", "october rust"),
        ("Slow, Deep and Hard (2009 Remaster)", "slow deep and hard"),
        ("The Origin of the Feces (2007 Reissue)", "the origin of the feces"),
        ("Mass VI [Deluxe Edition]", "mass vi"),
        ("Blending - 10th Anniversary Edition", "blending"),
        ("Album (Live)", "album live"),
        ("Bloody Kisses (Top Shelf Edition)", "bloody kisses"),
    ],
)
def test_edition_base_key_strips_only_edition_qualifiers(name, key):
    assert edition_base_key(name) == key


def _album(album_id, name, titles, artist="Type O Negative"):
    return {"id": album_id, "artist": artist, "name": name, "titles": titles}


STANDARD = [f"Song {number}" for number in range(1, 16)]


def test_special_edition_superset_overlaps_the_standard_edition():
    overlaps = edition_overlaps(
        [
            _album(1, "October Rust", STANDARD),
            _album(
                2,
                "October Rust (Special Edition)",
                STANDARD + ["Bonus A", "Bonus B", "Bonus C"],
            ),
        ]
    )

    assert overlaps == [
        {
            "artist": "Type O Negative",
            "album_id": 1,
            "album": "October Rust",
            "track_count": 15,
            "edition_album_id": 2,
            "edition": "October Rust (Special Edition)",
            "edition_track_count": 18,
            "shared_tracks": 15,
        }
    ]


def test_editions_with_different_tracklists_are_not_overlaps():
    assert (
        edition_overlaps(
            [
                _album(1, "Mass VI", STANDARD),
                _album(
                    2,
                    "Mass VI (Remastered)",
                    STANDARD[:5] + [f"Other {number}" for number in range(10)],
                ),
            ]
        )
        == []
    )


def test_live_albums_other_artists_and_empty_albums_are_ignored():
    assert (
        edition_overlaps(
            [
                _album(1, "Album", STANDARD),
                _album(2, "Album (Live)", STANDARD),
                _album(3, "Album (Deluxe)", STANDARD, artist="Someone Else"),
                _album(4, "Album (Remastered)", []),
            ]
        )
        == []
    )


def test_title_matching_ignores_case_and_punctuation():
    overlaps = edition_overlaps(
        [
            _album(1, "Blending", ["Talk For Hours", "Fever Dream"]),
            _album(2, "Blending (Deluxe)", ["talk for hours", "Fever  Dream!"]),
        ]
    )

    assert overlaps[0]["shared_tracks"] == 2

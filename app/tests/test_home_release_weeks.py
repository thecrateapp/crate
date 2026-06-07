from __future__ import annotations

from datetime import date

from crate.db.home_release_weeks import (
    build_new_arrivals_album_ids,
    group_releases_by_release_week,
    release_week_index,
    release_week_start,
)


def test_release_week_start_uses_friday_boundaries():
    assert release_week_start(date(2026, 6, 5)) == date(2026, 6, 5)
    assert release_week_start(date(2026, 6, 11)) == date(2026, 6, 5)
    assert release_week_start(date(2026, 6, 12)) == date(2026, 6, 12)


def test_release_week_index_walks_back_from_current_week():
    today = date(2026, 6, 10)

    assert release_week_index(today, date(2026, 6, 5)) == 0
    assert release_week_index(today, date(2026, 6, 4)) == 1
    assert release_week_index(today, date(2026, 5, 22)) == 2
    assert release_week_index(today, date(2026, 6, 12)) == -1


def test_group_releases_by_release_week_skips_future_old_and_duplicate_albums():
    groups = group_releases_by_release_week(
        [
            {"album_id": 10, "release_date": "2026-06-05", "album_title": "Current"},
            {"album_id": 20, "release_date": "2026-06-04", "album_title": "Previous"},
            {"album_id": 10, "release_date": "2026-06-06", "album_title": "Dupe"},
            {"album_id": 30, "release_date": "2026-06-12", "album_title": "Future"},
            {"album_id": 40, "release_date": "2026-03-01", "album_title": "Old"},
            {"album_id": None, "release_date": "2026-06-05", "album_title": "No album"},
        ],
        today=date(2026, 6, 10),
        max_lookback_weeks=4,
    )

    assert [[release["album_id"] for release in group] for group in groups] == [
        [10],
        [20],
    ]
    assert groups[0][0]["release_week_label"] == "This week"
    assert groups[1][0]["release_week_label"] == "Last week"


def test_build_new_arrivals_album_ids_uses_current_week_then_previous_weeks():
    album_ids = build_new_arrivals_album_ids(
        [
            {"album_id": 30, "release_date": "2026-05-29", "album_title": "Two weeks"},
            {"album_id": 20, "release_date": "2026-06-04", "album_title": "Last week"},
            {"album_id": 10, "release_date": "2026-06-06", "album_title": "Current"},
        ],
        today=date(2026, 6, 10),
        limit=2,
        max_lookback_weeks=12,
    )

    assert album_ids == [10, 20]

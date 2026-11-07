"""Profiles for a pool of tracks with the worker's handler (Smart Mix 3, SM5)."""

from __future__ import annotations

import pytest

from analyze_pool import (
    SHARED_DATABASES,
    pool_files,
    read_tracks,
    refuse_shared_database,
)


def test_read_tracks_takes_ids_and_optional_groups(tmp_path) -> None:
    listing = tmp_path / "tracks.tsv"
    listing.write_text(
        "track_id\tbucket\tsize\n"
        "10\thouse\t123\n"
        "\n"
        "11\ttechno\t456\n"
        "12\n"
        "10\thouse\t123\n"
    )
    assert read_tracks(listing) == {10: "house", 11: "techno", 12: None}


def test_shared_development_database_is_refused() -> None:
    assert "crate" in SHARED_DATABASES
    with pytest.raises(SystemExit):
        refuse_shared_database({"database": "crate", "host": "localhost"})
    refuse_shared_database({"database": "crate_eval", "host": "localhost"})


def test_pool_files_keep_tracks_ready_for_v3() -> None:
    rows = [
        {
            "track_id": 1,
            "entity_uid": "u1",
            "analyzer_version": "smart-mix-audio-v7",
            "has_phrases": True,
            "stale": False,
            "quality": "full",
        },
        {
            "track_id": 2,
            "entity_uid": "u2",
            "analyzer_version": "smart-mix-audio-v7",
            "has_phrases": False,
            "stale": False,
            "quality": "partial",
        },
        {
            "track_id": 3,
            "entity_uid": "u3",
            "analyzer_version": "smart-mix-audio-v5",
            "has_phrases": False,
            "stale": False,
            "quality": "full",
        },
        {
            "track_id": 4,
            "entity_uid": "u4",
            "analyzer_version": "smart-mix-audio-v7",
            "has_phrases": True,
            "stale": True,
            "quality": "full",
        },
        {
            "track_id": 5,
            "entity_uid": "u5",
            "analyzer_version": "smart-mix-audio-v7",
            "has_phrases": True,
            "stale": False,
            "quality": "unavailable",
        },
    ]
    uids, groups, states = pool_files(
        rows, {1: "house", 2: "techno", 3: None, 4: "x", 5: "y"}
    )
    assert uids == ["u1"]
    assert groups == {"u1": "house"}
    assert states == {
        "ready": 1,
        "no_phrases": 1,
        "not_current_analyzer": 1,
        "stale": 1,
        "unavailable": 1,
    }

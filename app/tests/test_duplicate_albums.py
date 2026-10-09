"""Duplicate album detection and the quarantine fix for the current layout."""

from __future__ import annotations

import uuid
from unittest.mock import patch

import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE


def _album(artist: str, name: str, path: str, year: str, tracks: int) -> int:
    from crate.db.repositories.library_artist_upserts import upsert_artist
    from crate.db.tx import transaction_scope

    upsert_artist({"name": artist})
    with transaction_scope() as session:
        return session.execute(
            text(
                """
                INSERT INTO library_albums (entity_uid, artist, name, path, year, track_count)
                VALUES (:uid, :artist, :name, :path, :year, :tracks)
                RETURNING id
                """
            ),
            {
                "uid": str(uuid.uuid4()),
                "artist": artist,
                "name": name,
                "path": path,
                "year": year,
                "tracks": tracks,
            },
        ).scalar_one()


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_duplicates_require_same_year_and_track_count(pg_db):
    from crate.db.queries.health import get_duplicate_albums
    from crate.db.repositories.library_quarantine import quarantine_album

    first = _album("Converge", "Jane Doe", "/music/u1/jane-a", "2001", 12)
    _album("Converge", "jane doe ", "/music/u1/jane-b", "2001", 12)
    _album("Converge", "Petitioning", "/music/u1/pet-a", "1993", 10)
    _album("Converge", "petitioning", "/music/u1/pet-b", "2022", 10)
    _album("Converge", "Axe", "/music/u1/axe-a", "2012", 10)
    _album("Converge", "AXE", "/music/u1/axe-b", "2012", 14)
    quarantined = _album("Birds", "Gris", "/music/u2/gris-a", "2022", 9)
    _album("Birds", "gris", "/music/u2/gris-b", "2022", 9)
    quarantine_album(quarantined, "test")

    rows = get_duplicate_albums()

    assert [row["album_name"] for row in rows] == ["Jane Doe"]
    copies = rows[0]["copies"]
    assert {copy["album_id"] for copy in copies} >= {first}
    assert all(copy["track_count"] == 12 for copy in copies)
    assert [row["album_name"] for row in get_duplicate_albums("Birds")] == []


def test_fixer_keeps_the_lossless_complete_copy_and_quarantines_the_rest(tmp_path):
    from crate.repair import LibraryRepair

    repair = LibraryRepair({"library_path": str(tmp_path)})
    issue = {
        "check": "duplicate_albums",
        "details": {
            "artist": "Converge",
            "album": "Jane Doe",
            "copies": [
                {
                    "album_id": 1,
                    "path": "/a",
                    "track_count": 12,
                    "formats": ["mp3"],
                    "total_size": 900,
                },
                {
                    "album_id": 2,
                    "path": "/b",
                    "track_count": 12,
                    "formats": ["flac"],
                    "total_size": 100,
                },
                {
                    "album_id": 3,
                    "path": "/c",
                    "track_count": 11,
                    "formats": ["flac"],
                    "total_size": 999,
                },
            ],
        },
    }

    preview = repair._fix_duplicate_albums(issue, dry_run=True)
    assert preview["details"]["keep"]["album_id"] == 2
    assert [copy["album_id"] for copy in preview["details"]["quarantine"]] == [1, 3]
    assert preview["applied"] is False

    with (
        patch("crate.repair.quarantine_album", return_value=True) as quarantine,
        patch("crate.repair.log_audit"),
    ):
        applied = repair._fix_duplicate_albums(issue, dry_run=False, task_id="t1")

    assert applied["applied"] is True
    assert [call.args for call in quarantine.call_args_list] == [(1, "t1"), (3, "t1")]


def test_duplicate_track_issues_explain_why_cleanup_skipped_them(tmp_path):
    from crate.health_check import LibraryHealthCheck

    checker = LibraryHealthCheck({"library_path": str(tmp_path)})
    row = {
        "album_id": 1,
        "artist": "Converge",
        "album": "Jane Doe",
        "title": "Concubine",
        "cnt": 2,
        "paths": ["/a.flac", "/b.flac"],
    }
    with patch(
        "crate.repair.LibraryRepair.duplicate_track_resolution",
        return_value="durations differ by 4.0s",
    ):
        [issue] = checker._duplicate_track_issues([row])

    assert issue["details"]["cleanup_blocked_reason"] == "durations differ by 4.0s"


def test_duplicate_cleanup_endpoint_queues_or_reports_the_running_task(test_app):
    with patch("crate.api.management.create_task_dedup", return_value="t-9") as create:
        queued = test_app.post("/api/manage/repair-duplicate-tracks").json()
    assert queued == {"task_id": "t-9", "status": "queued", "deduplicated": False}
    assert create.call_args.args[0] == "repair_duplicate_tracks"

    with (
        patch("crate.api.management.create_task_dedup", return_value=None),
        patch(
            "crate.api.management.find_active_task_by_type_params",
            return_value="t-1",
        ),
    ):
        again = test_app.post("/api/manage/repair-duplicate-tracks").json()
    assert again == {"task_id": "t-1", "status": "already_queued", "deduplicated": True}

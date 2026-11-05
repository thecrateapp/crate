"""Library scans that meet an album or track already indexed at another path.

Regressions for two production failures of the library pipeline:

* an album folder whose artist and name (or derived entity UID) already belong
  to an album indexed at a different path made ``upsert_album`` insert a second
  row and violate ``library_albums_artist_name_key`` or
  ``idx_lib_albums_entity_uid``;
* a track without a UUID file stem took its entity UID from its MusicBrainz
  recording id alone, so the same recording on a second release violated
  ``idx_lib_tracks_entity_uid``.
"""

from __future__ import annotations

import logging
import shutil
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")

ARTIST = "Synthetic Artist"
ALBUM = "Synthetic Album"
RECORDING_MBID = "0f0e0d0c-0b0a-4908-8706-050403020100"
MANAGED_ARTIST_UID = "6a1d3c2e-1111-5abc-9def-000000000001"
MANAGED_ALBUM_UID = "6a1d3c2e-2222-5abc-9def-000000000002"
MANAGED_TRACK_UID = "6a1d3c2e-3333-5abc-9def-000000000003"


def _rows(sql: str, **params) -> list[dict]:
    from crate.db.tx import read_scope

    with read_scope() as session:
        return [dict(row) for row in session.execute(text(sql), params).mappings()]


def _albums() -> list[dict]:
    return _rows(
        "SELECT id, path, name, entity_uid::text AS entity_uid "
        "FROM library_albums WHERE artist = :artist ORDER BY id",
        artist=ARTIST,
    )


def _tracks() -> list[dict]:
    return _rows(
        "SELECT id, album_id, path, entity_uid::text AS entity_uid "
        "FROM library_tracks WHERE artist = :artist ORDER BY id",
        artist=ARTIST,
    )


def _write_track(album_dir: Path, filename: str) -> Path:
    album_dir.mkdir(parents=True, exist_ok=True)
    path = album_dir / filename
    path.write_bytes(b"\x00" * 1024)
    return path


def _tags_for(path) -> dict:
    return {
        "artist": ARTIST,
        "albumartist": ARTIST,
        "album": ALBUM,
        "title": "Synthetic Track",
        "tracknumber": "1",
        "discnumber": "1",
        "date": "2020",
    }


class _Scanner:
    """Drive ``LibrarySync`` over real folders with synthetic tags."""

    def __init__(self, library: Path):
        from crate.library_sync import LibrarySync

        self.sync = LibrarySync(
            {"library_path": str(library), "audio_extensions": [".flac"]}
        )

    def sync_artist_dirs(self, *artist_dirs: Path) -> int:
        audio = MagicMock()
        audio.info.length = 180.0
        audio.info.bitrate = 900_000
        audio.info.sample_rate = 44_100
        audio.info.bits_per_sample = 16
        audio.pictures = []
        audio.tags = {}
        with (
            patch("crate.library_sync.read_tags", side_effect=_tags_for),
            patch("crate.library_sync.mutagen.File", return_value=audio),
            patch("crate.library_sync._read_audio_info_batch_native", return_value={}),
            patch(
                "crate.native_scan.maybe_prepare_native_album_payload",
                return_value=None,
            ),
            patch("crate.library_sync.queue_artwork_materialization"),
        ):
            return self.sync.sync_artist_dirs(ARTIST, list(artist_dirs))


def _sync_errors(caplog) -> list[logging.LogRecord]:
    return [
        record
        for record in caplog.records
        if record.name == "crate.library_sync" and record.levelno >= logging.ERROR
    ]


@pytest.fixture
def library(tmp_path) -> Path:
    root = tmp_path / "music"
    root.mkdir()
    return root


@pytest.mark.parametrize("scan_both_folders", [True, False])
def test_second_live_copy_of_an_indexed_album_is_skipped_not_failed(
    pg_db, library, caplog, scan_both_folders
):
    legacy_artist_dir = library / ARTIST
    legacy_album_dir = legacy_artist_dir / "2020" / ALBUM
    _write_track(legacy_album_dir, "01 - Synthetic Track.flac")
    managed_artist_dir = library / MANAGED_ARTIST_UID
    managed_album_dir = managed_artist_dir / MANAGED_ALBUM_UID
    _write_track(managed_album_dir, f"{MANAGED_TRACK_UID}.flac")
    scanner = _Scanner(library)
    scanner.sync_artist_dirs(legacy_artist_dir)
    [indexed] = _albums()
    indexed_tracks = _tracks()
    caplog.clear()

    with caplog.at_level(logging.WARNING, logger="crate.library_sync"):
        if scan_both_folders:
            scanner.sync_artist_dirs(legacy_artist_dir, managed_artist_dir)
        else:
            scanner.sync_artist_dirs(managed_artist_dir)

    assert _sync_errors(caplog) == []
    assert any(
        "already indexed" in record.getMessage() and record.levelno == logging.WARNING
        for record in caplog.records
    )
    # The indexed copy is untouched, the duplicate is not indexed and the
    # pass that skipped it does not delete albums it did not scan.
    assert _albums() == [indexed]
    assert indexed["path"] == str(legacy_album_dir)
    assert _tracks() == indexed_tracks


def test_album_folder_moved_away_from_its_indexed_path_adopts_the_row(
    pg_db, library, caplog
):
    legacy_artist_dir = library / ARTIST
    legacy_album_dir = legacy_artist_dir / "2020" / ALBUM
    _write_track(legacy_album_dir, "01 - Synthetic Track.flac")
    scanner = _Scanner(library)
    scanner.sync_artist_dirs(legacy_artist_dir)
    [indexed] = _albums()
    [old_track] = _tracks()

    managed_artist_dir = library / MANAGED_ARTIST_UID
    managed_album_dir = managed_artist_dir / MANAGED_ALBUM_UID
    managed_album_dir.parent.mkdir(parents=True)
    shutil.move(str(legacy_album_dir), str(managed_album_dir))
    moved_track = managed_album_dir / f"{MANAGED_TRACK_UID}.flac"
    (managed_album_dir / "01 - Synthetic Track.flac").rename(moved_track)
    caplog.clear()

    with caplog.at_level(logging.WARNING, logger="crate.library_sync"):
        scanner.sync_artist_dirs(managed_artist_dir)

    assert _sync_errors(caplog) == []
    [album] = _albums()
    assert album["id"] == indexed["id"]
    assert album["entity_uid"] == indexed["entity_uid"]
    assert album["path"] == str(managed_album_dir)
    # The track row left behind at the vanished path is dropped in the same pass.
    [track] = _tracks()
    assert track["album_id"] == indexed["id"]
    assert track["path"] == str(moved_track)
    assert track["path"] != old_track["path"]


def _seed_artist(pg_db) -> str:
    pg_db.upsert_artist({"name": ARTIST})
    [row] = _rows(
        "SELECT entity_uid::text AS uid FROM library_artists WHERE name = :name",
        name=ARTIST,
    )
    return row["uid"]


def _scan_payload(path: str, *, name: str = ALBUM) -> dict:
    return {"name": name, "tag_album": name, "year": "2020", "path": path}


@pytest.mark.parametrize("conflict_key", ["artist_and_name", "entity_uid"])
def test_scanned_album_conflicting_with_a_live_indexed_path_raises_typed_conflict(
    pg_db, conflict_key
):
    from crate.db.repositories.library_album_upserts import (
        LibraryAlbumIdentityConflict,
    )
    from crate.db.repositories.library_sync_writes import upsert_scanned_album
    from crate.entity_ids import album_entity_uid

    artist_uid = _seed_artist(pg_db)
    incoming_name = ALBUM if conflict_key == "artist_and_name" else "Other Name"
    indexed = {"artist": ARTIST, "name": ALBUM, "path": "/music/indexed"}
    if conflict_key == "entity_uid":
        indexed["entity_uid"] = str(
            album_entity_uid(
                artist_name=ARTIST,
                artist_uid=artist_uid,
                album_name=incoming_name,
                year="2020",
                tag_album=incoming_name,
            )
        )
    indexed_id = pg_db.upsert_album(indexed)
    checked: list[str] = []

    def _live(path: str) -> bool:
        checked.append(path)
        return True

    with pytest.raises(LibraryAlbumIdentityConflict) as raised:
        upsert_scanned_album(
            artist_payload={"name": ARTIST},
            album_payload=_scan_payload("/music/incoming", name=incoming_name),
            track_payloads=[],
            indexed_album_path_is_live=_live,
        )

    assert checked == ["/music/indexed"]
    assert raised.value.existing_album_id == indexed_id
    assert raised.value.existing_path == "/music/indexed"
    assert raised.value.path == "/music/incoming"
    assert [(row["id"], row["path"]) for row in _albums()] == [
        (indexed_id, "/music/indexed")
    ]


@pytest.mark.parametrize("conflict_key", ["artist_and_name", "entity_uid"])
def test_scanned_album_conflicting_with_a_vanished_indexed_path_moves_the_row(
    pg_db, conflict_key
):
    from crate.db.repositories.library_sync_writes import upsert_scanned_album
    from crate.entity_ids import album_entity_uid

    artist_uid = _seed_artist(pg_db)
    incoming_name = ALBUM if conflict_key == "artist_and_name" else "Other Name"
    indexed = {"artist": ARTIST, "name": ALBUM, "path": "/music/vanished"}
    if conflict_key == "entity_uid":
        indexed["entity_uid"] = str(
            album_entity_uid(
                artist_name=ARTIST,
                artist_uid=artist_uid,
                album_name=incoming_name,
                year="2020",
                tag_album=incoming_name,
            )
        )
    indexed_id = pg_db.upsert_album(indexed)
    [before] = _albums()

    _, album_id, album_uid, _ = upsert_scanned_album(
        artist_payload={"name": ARTIST},
        album_payload=_scan_payload("/music/incoming", name=incoming_name),
        track_payloads=[],
        indexed_album_path_is_live=lambda _path: False,
    )

    assert album_id == indexed_id
    assert album_uid == before["entity_uid"]
    assert [(row["id"], row["path"], row["name"]) for row in _albums()] == [
        (indexed_id, "/music/incoming", incoming_name)
    ]


def test_quarantined_album_is_never_adopted_by_a_scanned_folder(pg_db):
    from crate.db.repositories.library_album_upserts import (
        LibraryAlbumIdentityConflict,
    )
    from crate.db.repositories.library_quarantine import quarantine_album
    from crate.db.repositories.library_sync_writes import upsert_scanned_album

    _seed_artist(pg_db)
    indexed_id = pg_db.upsert_album(
        {"artist": ARTIST, "name": ALBUM, "path": "/music/quarantined"}
    )
    assert quarantine_album(indexed_id, "task-quarantine")

    with pytest.raises(LibraryAlbumIdentityConflict):
        upsert_scanned_album(
            artist_payload={"name": ARTIST},
            album_payload=_scan_payload("/music/incoming"),
            track_payloads=[],
            indexed_album_path_is_live=lambda _path: False,
        )

    assert [row["path"] for row in _albums()] == ["/music/quarantined"]


def test_upsert_album_without_a_liveness_check_keeps_rejecting_conflicts(pg_db):
    from sqlalchemy.exc import IntegrityError

    _seed_artist(pg_db)
    pg_db.upsert_album({"artist": ARTIST, "name": ALBUM, "path": "/music/indexed"})

    with pytest.raises(IntegrityError):
        pg_db.upsert_album({"artist": ARTIST, "name": ALBUM, "path": "/music/other"})


def _legacy_track(album_id: int, album: str, path: str, **overrides) -> dict:
    return {
        "album_id": album_id,
        "artist": ARTIST,
        "album": album,
        "filename": Path(path).name,
        "title": "Synthetic Track",
        "track_number": 1,
        "disc_number": 1,
        "musicbrainz_trackid": RECORDING_MBID,
        "path": path,
        **overrides,
    }


def test_same_recording_on_two_releases_without_uid_stems_indexes_both(pg_db):
    from crate.db.repositories.library_sync_writes import upsert_scanned_album

    _seed_artist(pg_db)
    standard_id = pg_db.upsert_album(
        {"artist": ARTIST, "name": ALBUM, "path": "/music/standard"}
    )
    pg_db.upsert_track(
        _legacy_track(standard_id, ALBUM, "/music/standard/01 - Synthetic Track.flac")
    )
    deluxe_name = f"{ALBUM} (Deluxe)"
    deluxe_path = "/music/deluxe"

    _, deluxe_id, _, synced = upsert_scanned_album(
        artist_payload={"name": ARTIST},
        album_payload=_scan_payload(deluxe_path, name=deluxe_name),
        track_payloads=[
            _legacy_track(
                0,
                deluxe_name,
                f"{deluxe_path}/03 - Synthetic Track.flac",
                track_number=3,
            )
        ],
    )

    tracks = _tracks()
    assert synced == {f"{deluxe_path}/03 - Synthetic Track.flac"}
    assert [track["album_id"] for track in tracks] == [standard_id, deluxe_id]
    assert len({track["entity_uid"] for track in tracks}) == 2


def test_renamed_track_file_without_uid_stem_keeps_its_row(pg_db):
    _seed_artist(pg_db)
    album_id = pg_db.upsert_album(
        {"artist": ARTIST, "name": ALBUM, "path": "/music/standard"}
    )
    pg_db.upsert_track(
        _legacy_track(album_id, ALBUM, "/music/standard/01 Synthetic Track.flac")
    )
    [before] = _tracks()

    pg_db.upsert_track(
        _legacy_track(album_id, ALBUM, "/music/standard/01 - Synthetic Track.flac")
    )

    [after] = _tracks()
    assert after["id"] == before["id"]
    assert after["entity_uid"] == before["entity_uid"]
    assert after["path"] == "/music/standard/01 - Synthetic Track.flac"

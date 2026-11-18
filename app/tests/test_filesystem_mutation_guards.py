import zipfile
from pathlib import Path

import pytest

from crate import tidal
from crate.duplicate_album import AlbumComparison, DuplicateVerdict
from crate.duplicate_album import apply_duplicate_resolution
from crate.fixer import LibraryFixer
from crate.importer import ImportQueue
from crate.models import Issue, IssueType, Severity
from crate.repair import LibraryRepair
from crate.smart_mix.stem_files import enforce_stem_quota
from crate.storage_import import (
    ManagedTrackPlacement,
    install_managed_track,
    move_album_tree,
    move_file,
)
from crate.storage_layout import UnsafeMutationPathError
from crate.worker_handlers.acquisition import _handle_library_upload, _safe_extract_zip
from crate.worker_handlers.management import (
    _handle_delete_album,
    _handle_delete_artist,
    _handle_move_artist,
    _handle_resolve_duplicates,
    _handle_split_album,
)
from crate.worker_handlers.migration import _rmdir_if_empty

MANAGEMENT = "crate.worker_handlers.management"


@pytest.fixture
def library(tmp_path: Path) -> Path:
    root = tmp_path / "music"
    root.mkdir()
    return root


@pytest.fixture
def outside(tmp_path: Path) -> Path:
    victim = tmp_path / "victim"
    victim.mkdir()
    (victim / "keep.txt").write_text("keep")
    return victim


@pytest.fixture
def quiet_management(monkeypatch):
    deleted: list[str] = []
    monkeypatch.setattr(
        f"{MANAGEMENT}.run_artist_deletion", lambda _name, operation: operation()
    )
    monkeypatch.setattr(f"{MANAGEMENT}.db_delete_artist", deleted.append)
    monkeypatch.setattr(f"{MANAGEMENT}.db_delete_album", deleted.append)
    monkeypatch.setattr(f"{MANAGEMENT}.delete_cache", lambda *_a, **_k: None)
    monkeypatch.setattr(f"{MANAGEMENT}.emit_task_event", lambda *_a, **_k: None)
    monkeypatch.setattr(f"{MANAGEMENT}.log_audit", lambda *_a, **_k: None)
    monkeypatch.setattr(f"{MANAGEMENT}.start_scan", lambda: None)
    monkeypatch.setattr(f"{MANAGEMENT}.get_library_artist", lambda _name: None)
    monkeypatch.setattr(f"{MANAGEMENT}.get_library_albums", lambda _name: [])
    return deleted


@pytest.mark.parametrize("name", ["..", "../victim", ""])
def test_delete_artist_full_refuses_paths_outside_or_at_the_root(
    library, outside, quiet_management, name
):
    (library / "Other").mkdir()

    result = _handle_delete_artist(
        "task", {"name": name, "mode": "full"}, {"library_path": str(library)}
    )

    assert "error" in result
    assert quiet_management == []
    assert (outside / "keep.txt").exists()
    assert (library / "Other").is_dir()


def test_delete_artist_full_refuses_a_db_folder_that_escapes(
    library, outside, quiet_management, monkeypatch
):
    monkeypatch.setattr(
        f"{MANAGEMENT}.get_library_artist",
        lambda _name: {"name": "Artist", "folder_name": "../victim"},
    )

    result = _handle_delete_artist(
        "task", {"name": "Artist", "mode": "full"}, {"library_path": str(library)}
    )

    assert "error" in result
    assert (outside / "keep.txt").exists()


def test_delete_artist_full_refuses_a_symlinked_folder_outside(
    library, outside, quiet_management
):
    (library / "Artist").symlink_to(outside, target_is_directory=True)

    result = _handle_delete_artist(
        "task", {"name": "Artist", "mode": "full"}, {"library_path": str(library)}
    )

    assert "error" in result
    assert (outside / "keep.txt").exists()


def test_delete_artist_full_still_deletes_inside_the_library(library, quiet_management):
    (library / "Artist" / "Album").mkdir(parents=True)

    result = _handle_delete_artist(
        "task", {"name": "Artist", "mode": "full"}, {"library_path": str(library)}
    )

    assert result == {"deleted": "Artist", "mode": "full"}
    assert not (library / "Artist").exists()
    assert quiet_management == ["Artist"]


def test_delete_album_full_refuses_a_db_path_outside(
    library, outside, quiet_management, monkeypatch
):
    monkeypatch.setattr(f"{MANAGEMENT}.find_album_path", lambda *_args: str(outside))

    result = _handle_delete_album(
        "task",
        {"artist": "Artist", "album": "Album", "mode": "full"},
        {"library_path": str(library)},
    )

    assert "error" in result
    assert (outside / "keep.txt").exists()
    assert quiet_management == []


def test_delete_album_full_still_deletes_inside_the_library(
    library, quiet_management, monkeypatch
):
    album = library / "Artist" / "Album"
    album.mkdir(parents=True)
    monkeypatch.setattr(f"{MANAGEMENT}.find_album_path", lambda *_args: str(album))

    result = _handle_delete_album(
        "task",
        {"artist": "Artist", "album": "Album", "mode": "full"},
        {"library_path": str(library)},
    )

    assert result == {"deleted": "Artist/Album", "mode": "full"}
    assert not album.exists()
    assert quiet_management == [str(album)]


def test_move_artist_refuses_a_target_outside_the_library(
    library, tmp_path, monkeypatch
):
    (library / "Artist").mkdir()
    monkeypatch.setattr(
        f"{MANAGEMENT}.get_library_artist",
        lambda _name: {"name": "Artist", "folder_name": "Artist"},
    )

    result = _handle_move_artist(
        "task",
        {"name": "Artist", "new_name": "../escaped"},
        {"library_path": str(library)},
    )

    assert "error" in result
    assert (library / "Artist").is_dir()
    assert not (tmp_path / "escaped").exists()


def test_resolve_duplicates_skips_paths_outside_the_library(
    library, outside, monkeypatch
):
    (library / "Artist" / "Dup").mkdir(parents=True)
    monkeypatch.setattr(f"{MANAGEMENT}.emit_task_event", lambda *_a, **_k: None)

    result = _handle_resolve_duplicates(
        "task",
        {"keep": "Artist/Album", "remove": ["../victim", "Artist/Dup"]},
        {"library_path": str(library)},
    )

    assert result["removed"] == ["Artist/Dup"]
    assert (outside / "keep.txt").exists()
    assert (library / ".crate-trash" / "Artist" / "Dup").is_dir()


def test_split_album_refuses_an_album_path_at_the_library_root(library, monkeypatch):
    (library / "track.flac").write_bytes(b"audio")
    monkeypatch.setattr(
        f"{MANAGEMENT}.get_library_album_by_id",
        lambda _id: {"id": 1, "name": "Album", "path": str(library)},
    )
    monkeypatch.setattr(
        f"{MANAGEMENT}.get_library_tracks",
        lambda _id: [
            {"id": 1, "path": str(library / "track.flac")},
            {"id": 2, "path": str(library / "other.flac")},
        ],
    )

    result = _handle_split_album(
        "task",
        {"album_id": 1, "target_album_name": "Split", "track_ids": [1]},
        {"library_path": str(library)},
    )

    assert result == {"error": "Album path is outside the library"}
    assert (library / "track.flac").exists()
    assert not (library.parent / "Split").exists()


def test_import_queue_remove_source_is_confined_to_import_sources(
    library, outside, tmp_path
):
    source_root = tmp_path / "imports"
    staged = source_root / "Artist - Album"
    staged.mkdir(parents=True)
    queue = ImportQueue(
        {
            "library_path": str(library),
            "import_sources": [{"name": "tidal", "path": str(source_root)}],
        }
    )

    with pytest.raises(UnsafeMutationPathError):
        queue.remove_source(str(outside))
    with pytest.raises(UnsafeMutationPathError):
        queue.remove_source(str(source_root))
    with pytest.raises(UnsafeMutationPathError):
        queue.remove_source(str(source_root / ".." / "victim"))

    assert queue.remove_source(str(staged)) is True
    assert (outside / "keep.txt").exists()
    assert source_root.is_dir()
    assert not staged.exists()


def test_move_file_refuses_a_destination_outside_the_library(
    library, outside, tmp_path
):
    src = tmp_path / "incoming.flac"
    src.write_bytes(b"audio")

    with pytest.raises(UnsafeMutationPathError):
        move_file(src, outside, library_root=library)

    assert (outside / "keep.txt").exists()
    assert src.exists()

    move_file(src, library / "Artist" / "Album" / src.name, library_root=library)
    assert (library / "Artist" / "Album" / src.name).exists()


def test_install_managed_track_refuses_placements_outside_the_library(
    library, outside, tmp_path
):
    src = tmp_path / "incoming.flac"
    src.write_bytes(b"audio")

    with pytest.raises(UnsafeMutationPathError):
        install_managed_track(
            src,
            ManagedTrackPlacement(dest=outside / "keep.txt"),
            library_root=library,
        )
    with pytest.raises(UnsafeMutationPathError):
        install_managed_track(
            src,
            ManagedTrackPlacement(
                dest=library / "Artist" / "new.flac", replaces=outside / "keep.txt"
            ),
            library_root=library,
        )

    assert (outside / "keep.txt").read_text() == "keep"
    assert src.exists()


def test_move_album_tree_refuses_a_target_outside_the_library(
    library, outside, tmp_path
):
    staged = tmp_path / "staged"
    staged.mkdir()
    (staged / "01.flac").write_bytes(b"audio")

    with pytest.raises(UnsafeMutationPathError):
        move_album_tree(
            staged,
            outside,
            managed_track_names=False,
            artist_name="Artist",
            album_name="Album",
            library_root=library,
        )

    assert (staged / "01.flac").exists()
    assert sorted(path.name for path in outside.iterdir()) == ["keep.txt"]


def test_library_upload_refuses_staging_outside_the_uploads_dir(
    monkeypatch, tmp_path, outside
):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))

    result = _handle_library_upload(
        "task", {"staging_dir": str(outside)}, {"library_path": str(tmp_path)}
    )

    assert result == {"error": "Upload staging is outside the uploads directory"}
    assert (outside / "keep.txt").exists()


def test_safe_extract_zip_rejects_entries_escaping_into_a_sibling(tmp_path):
    archive = tmp_path / "upload.zip"
    with zipfile.ZipFile(archive, "w") as handle:
        handle.writestr("../extracted-evil/payload.txt", "x")
    dest = tmp_path / "extracted"
    dest.mkdir()

    with pytest.raises(ValueError):
        _safe_extract_zip(archive, dest)

    assert not (tmp_path / "extracted-evil").exists()


def test_safe_extract_zip_extracts_normal_entries(tmp_path):
    archive = tmp_path / "upload.zip"
    with zipfile.ZipFile(archive, "w") as handle:
        handle.writestr("Album/", "")
        handle.writestr("Album/01.flac", "audio")
    dest = tmp_path / "extracted"
    dest.mkdir()

    _safe_extract_zip(archive, dest)

    assert (dest / "Album" / "01.flac").read_text() == "audio"


def test_migration_rmdir_if_empty_never_removes_the_library_root(library):
    album = library / "Artist" / "Album"
    album.mkdir(parents=True)

    _rmdir_if_empty(album, library)

    assert not (library / "Artist").exists()
    assert library.is_dir()


def test_repair_duplicate_folders_refuses_folders_outside_the_library(library, outside):
    (library / "Artist").mkdir()
    (library / "Artist" / "song.flac").write_bytes(b"audio")
    repair = LibraryRepair({"library_path": str(library)})

    with pytest.raises(UnsafeMutationPathError):
        repair._fix_duplicate_folders(
            {"details": {"folders": ["Artist", "../victim"]}}, dry_run=False
        )

    assert (outside / "keep.txt").exists()
    assert (library / "Artist" / "song.flac").exists()


def test_repair_duplicate_folders_still_merges_inside_the_library(library, monkeypatch):
    monkeypatch.setattr("crate.repair.log_audit", lambda *_a, **_k: None)
    (library / "Artist").mkdir()
    (library / "Artist_").mkdir()
    (library / "Artist_" / "song.flac").write_bytes(b"audio")
    repair = LibraryRepair({"library_path": str(library)})

    result = repair._fix_duplicate_folders(
        {"details": {"folders": ["Artist_", "Artist"]}}, dry_run=False
    )

    assert result["applied"] is True
    assert (library / "Artist" / "song.flac").exists()
    assert not (library / "Artist_").exists()


def test_fixer_skips_a_rename_that_escapes_the_library(library, tmp_path):
    album = library / "Artist" / "Album"
    album.mkdir(parents=True)
    issue = Issue(
        type=IssueType.BAD_NAMING,
        severity=Severity.LOW,
        confidence=100,
        description="bad name",
        paths=[album],
        suggestion="rename",
        details={"proposed": "../../escaped"},
    )

    LibraryFixer({"library_path": str(library)}).fix([issue], dry_run=False)

    assert album.is_dir()
    assert not (tmp_path / "escaped").exists()


def test_duplicate_resolution_refuses_a_loose_dir_outside_the_library(library, outside):
    verdict = DuplicateVerdict(
        action="delete_loose",
        canonical_dir=library / "Artist" / "Album",
        loose_dir=outside,
        reason="test",
        comparison=AlbumComparison(loose=[], canonical=[]),
    )

    with pytest.raises(UnsafeMutationPathError):
        apply_duplicate_resolution(verdict, library_root=library)

    assert (outside / "keep.txt").exists()


def test_tidal_cleanup_only_removes_processing_dirs(monkeypatch, tmp_path, library):
    monkeypatch.setattr(tidal, "PROCESSING_DIR", str(tmp_path / "processing"))
    inside = tmp_path / "processing" / "task-1"
    inside.mkdir(parents=True)
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()

    tidal.move_to_library_detailed(str(elsewhere), str(library))
    tidal.move_to_library_detailed(str(inside), str(library))

    assert elsewhere.is_dir()
    assert not inside.exists()
    assert (tmp_path / "processing").is_dir()


def test_stem_quota_eviction_ignores_paths_escaping_the_stems_dir(
    monkeypatch, tmp_path, outside
):
    stems = tmp_path / "stems"
    stems.mkdir()
    (stems / "old.m4a").write_bytes(b"stem")
    monkeypatch.setattr(
        "crate.db.jobs.smart_mix_stems.evict_stem_files",
        lambda _limit: [("../victim/keep.txt", 4), ("old.m4a", 4)],
    )

    freed = enforce_stem_quota(0, root=stems)

    assert freed == 8
    assert (outside / "keep.txt").exists()
    assert not (stems / "old.m4a").exists()

import os
from pathlib import Path

import pytest

from crate.storage_layout import (
    LIBRARY_EXTRA_ROOTS_ENV,
    UnsafeMutationPathError,
    ensure_within_roots,
    library_extra_roots,
    library_mutation_roots,
)
from crate.worker_handlers.management import (
    _handle_delete_album,
    _resolve_library_path,
    _resolve_library_track_path,
)
from crate.worker_handlers.migration import _rmdir_if_empty

MANAGEMENT = "crate.worker_handlers.management"


@pytest.fixture
def library(tmp_path: Path, monkeypatch) -> Path:
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv(LIBRARY_EXTRA_ROOTS_ENV, raising=False)
    root = tmp_path / "music"
    root.mkdir()
    return root


@pytest.fixture
def second_disk(tmp_path: Path) -> Path:
    disk = tmp_path / "disk2"
    (disk / "Artist" / "Album").mkdir(parents=True)
    (disk / "Artist" / "Album" / "01.flac").write_bytes(b"audio")
    return disk


@pytest.fixture
def outside(tmp_path: Path) -> Path:
    victim = tmp_path / "victim"
    victim.mkdir()
    (victim / "keep.flac").write_bytes(b"audio")
    return victim


@pytest.fixture
def linked_artist(library: Path, second_disk: Path) -> Path:
    link = library / "Artist"
    link.symlink_to(second_disk / "Artist", target_is_directory=True)
    return link


def test_default_is_no_extra_roots(library):
    assert library_extra_roots(library) == ()
    assert library_mutation_roots(library) == (library,)


def test_parses_pathsep_and_comma_separated_entries(library, tmp_path, monkeypatch):
    first, second, third = (tmp_path / name for name in ("a", "b", "c"))
    for directory in (first, second, third):
        directory.mkdir()
    monkeypatch.setenv(
        LIBRARY_EXTRA_ROOTS_ENV, f" {first}{os.pathsep}{second} , ,{third},"
    )

    assert library_extra_roots(library) == (
        first.resolve(),
        second.resolve(),
        third.resolve(),
    )
    assert library_mutation_roots(library) == (
        library,
        first.resolve(),
        second.resolve(),
        third.resolve(),
    )


@pytest.mark.parametrize(
    "entry",
    ["relative/disk", "/", "/etc", "/usr/share", "/nonexistent-crate-extra-root"],
)
def test_rejects_invalid_entries(library, monkeypatch, entry):
    monkeypatch.setenv(LIBRARY_EXTRA_ROOTS_ENV, entry)

    with pytest.raises(UnsafeMutationPathError):
        library_mutation_roots(library)


def test_rejects_a_file(library, tmp_path, monkeypatch):
    regular = tmp_path / "file"
    regular.write_text("x")
    monkeypatch.setenv(LIBRARY_EXTRA_ROOTS_ENV, str(regular))

    with pytest.raises(UnsafeMutationPathError):
        library_extra_roots(library)


def test_rejects_roots_that_contain_the_library_or_data_dir(
    library, tmp_path, monkeypatch
):
    monkeypatch.setenv(LIBRARY_EXTRA_ROOTS_ENV, str(tmp_path))
    with pytest.raises(UnsafeMutationPathError, match="library"):
        library_extra_roots(library)

    data_parent = tmp_path / "state"
    (data_parent / "data").mkdir(parents=True)
    monkeypatch.setenv("DATA_DIR", str(data_parent / "data"))
    monkeypatch.setenv(LIBRARY_EXTRA_ROOTS_ENV, str(data_parent))
    with pytest.raises(UnsafeMutationPathError, match="DATA_DIR"):
        library_extra_roots(library)


def test_one_invalid_entry_fails_the_whole_setting(library, second_disk, monkeypatch):
    monkeypatch.setenv(LIBRARY_EXTRA_ROOTS_ENV, f"{second_disk},relative")

    with pytest.raises(UnsafeMutationPathError):
        library_mutation_roots(library)


def test_symlinked_folder_needs_its_disk_listed(
    library, second_disk, outside, linked_artist, monkeypatch
):
    (library / "Escape").symlink_to(outside, target_is_directory=True)
    album = linked_artist / "Album"

    with pytest.raises(UnsafeMutationPathError):
        ensure_within_roots(album, library_mutation_roots(library))

    monkeypatch.setenv(LIBRARY_EXTRA_ROOTS_ENV, str(second_disk))
    roots = library_mutation_roots(library)

    assert (
        ensure_within_roots(album, roots)
        == (second_disk / "Artist" / "Album").resolve()
    )
    with pytest.raises(UnsafeMutationPathError):
        ensure_within_roots(library / "Escape", roots)
    with pytest.raises(UnsafeMutationPathError):
        ensure_within_roots(second_disk, roots)
    with pytest.raises(UnsafeMutationPathError):
        ensure_within_roots(library, roots)


@pytest.fixture
def quiet_management(monkeypatch):
    deleted: list[str] = []
    monkeypatch.setattr(f"{MANAGEMENT}.db_delete_album", deleted.append)
    monkeypatch.setattr(f"{MANAGEMENT}.emit_task_event", lambda *_a, **_k: None)
    monkeypatch.setattr(f"{MANAGEMENT}.log_audit", lambda *_a, **_k: None)
    monkeypatch.setattr(f"{MANAGEMENT}.start_scan", lambda: None)
    monkeypatch.setattr(f"{MANAGEMENT}.get_library_artist", lambda _name: None)
    return deleted


def _delete_album(library: Path, album: Path, monkeypatch) -> dict:
    monkeypatch.setattr(f"{MANAGEMENT}.find_album_path", lambda *_args: str(album))
    return _handle_delete_album(
        "task",
        {"artist": "Artist", "album": "Album", "mode": "full"},
        {"library_path": str(library)},
    )


def test_delete_album_under_symlinked_artist_is_refused_by_default(
    library, second_disk, linked_artist, quiet_management, monkeypatch
):
    result = _delete_album(library, linked_artist / "Album", monkeypatch)

    assert "error" in result
    assert (second_disk / "Artist" / "Album" / "01.flac").exists()
    assert quiet_management == []


def test_delete_album_under_symlinked_artist_works_with_extra_root(
    library, second_disk, linked_artist, quiet_management, monkeypatch
):
    monkeypatch.setenv(LIBRARY_EXTRA_ROOTS_ENV, str(second_disk))
    album = linked_artist / "Album"

    result = _delete_album(library, album, monkeypatch)

    assert result == {"deleted": "Artist/Album", "mode": "full"}
    assert not (second_disk / "Artist" / "Album").exists()
    assert quiet_management == [str(album)]


def test_delete_album_fails_closed_on_invalid_setting(
    library, second_disk, linked_artist, quiet_management, monkeypatch
):
    monkeypatch.setenv(LIBRARY_EXTRA_ROOTS_ENV, f"{second_disk},/")
    album = library / "Plain" / "Album"
    album.mkdir(parents=True)

    result = _delete_album(library, album, monkeypatch)

    assert "error" in result
    assert album.is_dir()
    assert quiet_management == []


def test_library_paths_keep_their_library_location_under_extra_roots(
    library, second_disk, linked_artist, outside, monkeypatch
):
    monkeypatch.setenv(LIBRARY_EXTRA_ROOTS_ENV, str(second_disk))
    album = linked_artist / "Album"

    assert _resolve_library_path(library, str(album)) == (album, Path("Artist/Album"))
    assert _resolve_library_track_path(library, "Artist/Album/01.flac") == (
        album / "01.flac",
        Path("Artist/Album/01.flac"),
    )
    assert _resolve_library_path(library, str(outside)) is None
    assert _resolve_library_path(library, "Artist/../..") is None


def test_migration_cleanup_follows_extra_roots(
    library, second_disk, linked_artist, monkeypatch
):
    empty = second_disk / "Artist" / "Empty"
    empty.mkdir()

    _rmdir_if_empty(linked_artist / "Empty", library)
    assert empty.is_dir()

    monkeypatch.setenv(LIBRARY_EXTRA_ROOTS_ENV, str(second_disk))
    _rmdir_if_empty(linked_artist / "Empty", library)
    assert not empty.exists()
    assert (second_disk / "Artist").is_dir()

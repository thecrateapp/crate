from pathlib import Path

import pytest

from crate.storage_layout import (
    UnsafeMutationPathError,
    ensure_within_roots,
    upload_staging_root,
)


@pytest.fixture
def library(tmp_path: Path) -> Path:
    root = tmp_path / "music"
    (root / "Artist" / "Album").mkdir(parents=True)
    return root


def test_accepts_paths_inside_a_root(library: Path) -> None:
    album = library / "Artist" / "Album"

    assert ensure_within_roots(album, (library,)) == album.resolve()
    assert ensure_within_roots(str(album / "new.flac"), [str(library)]) == (
        album.resolve() / "new.flac"
    )


def test_accepts_paths_inside_any_of_several_roots(
    library: Path, tmp_path: Path
) -> None:
    downloads = tmp_path / "downloads"
    downloads.mkdir()

    assert ensure_within_roots(downloads / "user" / "album", (library, downloads)) == (
        downloads.resolve() / "user" / "album"
    )


def test_rejects_parent_traversal(library: Path, tmp_path: Path) -> None:
    (tmp_path / "outside").mkdir()

    with pytest.raises(UnsafeMutationPathError):
        ensure_within_roots(library / ".." / "outside", (library,))
    with pytest.raises(UnsafeMutationPathError):
        ensure_within_roots(library / "Artist" / ".." / ".." / "outside", (library,))


def test_rejects_absolute_paths_outside_the_roots(library: Path) -> None:
    with pytest.raises(UnsafeMutationPathError):
        ensure_within_roots("/etc/passwd", (library,))
    with pytest.raises(UnsafeMutationPathError):
        ensure_within_roots(library.parent, (library,))


def test_rejects_a_sibling_that_shares_the_root_prefix(
    library: Path, tmp_path: Path
) -> None:
    sibling = tmp_path / "music-private" / "Album"
    sibling.mkdir(parents=True)

    with pytest.raises(UnsafeMutationPathError):
        ensure_within_roots(sibling, (library,))


def test_rejects_symlinks_that_point_outside(library: Path, tmp_path: Path) -> None:
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "keep.flac").write_bytes(b"audio")
    (library / "Escape").symlink_to(outside, target_is_directory=True)
    (library / "Artist" / "link.flac").symlink_to(outside / "keep.flac")

    with pytest.raises(UnsafeMutationPathError):
        ensure_within_roots(library / "Escape", (library,))
    with pytest.raises(UnsafeMutationPathError):
        ensure_within_roots(library / "Escape" / "keep.flac", (library,))
    with pytest.raises(UnsafeMutationPathError):
        ensure_within_roots(library / "Artist" / "link.flac", (library,))


def test_accepts_symlinks_that_stay_inside(library: Path) -> None:
    (library / "Alias").symlink_to(library / "Artist", target_is_directory=True)

    assert ensure_within_roots(library / "Alias" / "Album", (library,)) == (
        (library / "Artist" / "Album").resolve()
    )


def test_rejects_the_root_itself_unless_allowed(library: Path) -> None:
    with pytest.raises(UnsafeMutationPathError):
        ensure_within_roots(library, (library,))
    with pytest.raises(UnsafeMutationPathError):
        ensure_within_roots(library / "Artist" / "..", (library,))

    assert ensure_within_roots(library, (library,), allow_root=True) == (
        library.resolve()
    )


def test_rejects_any_root_even_when_nested_in_another(library: Path) -> None:
    nested_root = library / "Artist"

    with pytest.raises(UnsafeMutationPathError):
        ensure_within_roots(nested_root, (library, nested_root))


def test_rejects_empty_paths_and_missing_roots(library: Path) -> None:
    with pytest.raises(UnsafeMutationPathError):
        ensure_within_roots("", (library,))
    with pytest.raises(UnsafeMutationPathError):
        ensure_within_roots(library / "Artist", ())


def test_upload_staging_root_follows_data_dir(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("DATA_DIR", str(tmp_path))

    assert upload_staging_root() == tmp_path / "uploads"

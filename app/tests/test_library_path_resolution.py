"""Library paths stay inside the library root, and stored paths resolve the
same way in FastAPI as in the read plane (`app/readplane/internal/media/path.go`)."""

from __future__ import annotations

from pathlib import Path

import pytest

from crate.api._deps import safe_path


@pytest.fixture
def library(tmp_path: Path) -> Path:
    root = tmp_path / "music"
    (root / "Artist").mkdir(parents=True)
    (root / "Artist" / "track.flac").write_bytes(b"fLaC")
    private = tmp_path / "music-private"
    private.mkdir()
    (private / "secret.flac").write_bytes(b"fLaC")
    return root


def test_safe_path_accepts_a_path_inside_the_library(library):
    assert (
        safe_path(library, "Artist/track.flac")
        == (library / "Artist" / "track.flac").resolve()
    )


@pytest.mark.parametrize("user_path", ["../outside.flac", "/etc/passwd"])
def test_safe_path_rejects_paths_outside_the_library(library, user_path):
    assert safe_path(library, user_path) is None


# A sibling directory whose name starts with the library's name used to pass,
# because containment was a string prefix check.
def test_safe_path_rejects_a_sibling_directory_sharing_the_prefix(library):
    assert safe_path(library, "../music-private/secret.flac") is None


def test_safe_path_rejects_a_symlink_into_a_sibling_directory(library):
    link = library / "Artist" / "leak.flac"
    link.symlink_to(library.parent / "music-private" / "secret.flac")

    assert safe_path(library, "Artist/leak.flac") is None


@pytest.mark.parametrize(
    "stored",
    ["/data/Artist/track.flac", "/music/Artist/track.flac", "Artist/track.flac"],
)
def test_resolve_source_path_maps_stored_paths_like_the_read_plane(
    library, monkeypatch, stored
):
    from crate.streaming import service

    monkeypatch.setattr(service, "library_path", lambda: library)

    assert (
        service.resolve_source_path({"path": stored})
        == (library / "Artist" / "track.flac").resolve()
    )


@pytest.mark.parametrize(
    "stored", ["/data/../music-private/secret.flac", "/elsewhere/track.flac"]
)
def test_resolve_source_path_rejects_stored_paths_outside_the_library(
    library, monkeypatch, stored
):
    from crate.streaming import service

    monkeypatch.setattr(service, "library_path", lambda: library)

    assert service.resolve_source_path({"path": stored}) is None

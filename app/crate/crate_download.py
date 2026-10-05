"""Crate ZIP packaging shared by the API (cache lookups) and the worker (builds)."""

from __future__ import annotations

import os
import re
import zipfile
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any

from crate.utils import COVER_NAMES

CRATE_DOWNLOAD_KIND = "crate"
CRATE_DOWNLOAD_TASK_TYPE = "crate_download"

_CACHE_KEY_RE = re.compile(r"^[0-9a-f]{64}$")
_ZIP_COMPONENT_RE = re.compile(r"[\\/:*?\"<>|]+")
_ARCHIVE_COVER_NAMES = (*COVER_NAMES, "album.jpg", "album.png")
_ZIP_ENTRY_OVERHEAD_BYTES = 512


def is_crate_download_cache_key(value: str) -> bool:
    return bool(_CACHE_KEY_RE.match(value or ""))


def zip_component(value: object, fallback: str) -> str:
    component = _ZIP_COMPONENT_RE.sub("-", str(value or "")).strip()
    return component or fallback


def crate_download_filename(name: object) -> str:
    return f"{zip_component(name, 'crate')}.zip"


def crate_download_url(crate_id: str, cache_key: str) -> str:
    return f"/api/crates/{crate_id}/download/{cache_key}"


def crate_download_dedup_key(cache_key: str) -> str:
    return f"{CRATE_DOWNLOAD_KIND}:{cache_key}"


def library_file(raw_path: object, library_root: Path) -> Path | None:
    if not raw_path:
        return None
    candidate = Path(str(raw_path))
    if not candidate.is_absolute():
        candidate = library_root / candidate
    resolved = Path(os.path.realpath(candidate))
    if not resolved.is_relative_to(library_root) or not resolved.is_file():
        return None
    return resolved


def _track_source_path(raw_path: object, library_root: Path) -> Path | None:
    if not raw_path:
        return None
    candidate = Path(str(raw_path))
    return candidate if candidate.is_absolute() else library_root / candidate


def estimate_crate_zip_bytes(
    tracks: Iterable[dict[str, Any]], *, library_root: Path
) -> int:
    root = Path(os.path.realpath(library_root))
    total = 0
    directories: set[Path] = set()
    for track in tracks:
        source_path = _track_source_path(track.get("path"), root)
        if source_path is None:
            continue
        size = track.get("size")
        if size is None:
            source = library_file(source_path, root)
            if source is None:
                continue
            size = source.stat().st_size
        total += int(size) + _ZIP_ENTRY_OVERHEAD_BYTES
        directories.add(source_path.parent)
    for directory in directories:
        for cover_name in _ARCHIVE_COVER_NAMES:
            cover = library_file(directory / cover_name, root)
            if cover is not None:
                total += cover.stat().st_size + _ZIP_ENTRY_OVERHEAD_BYTES
    return total


def _unique_archive_name(directory: str, filename: str, used: set[str]) -> str:
    stem, extension = os.path.splitext(filename)
    archive_name = f"{directory}/{filename}"
    suffix = 2
    while archive_name in used:
        archive_name = f"{directory}/{stem} ({suffix}){extension}"
        suffix += 1
    used.add(archive_name)
    return archive_name


def build_crate_zip(
    tracks: Iterable[dict[str, Any]],
    archive_path: Path,
    *,
    library_root: Path,
    on_progress: Callable[[int, dict[str, Any]], None] | None = None,
) -> int:
    root = Path(os.path.realpath(library_root))
    used_names: set[str] = set()
    archived_directories: set[Path] = set()
    written_files = 0

    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_STORED) as archive:
        for index, track in enumerate(tracks, start=1):
            source = library_file(track.get("path"), root)
            if source is not None:
                artist = zip_component(track.get("artist"), "Unknown artist")
                album = zip_component(track.get("album"), "Unknown album")
                archive_prefix = f"{artist}/{album}"
                filename = zip_component(source.name, "track")
                archive.write(
                    source, _unique_archive_name(archive_prefix, filename, used_names)
                )
                written_files += 1

                if source.parent not in archived_directories:
                    archived_directories.add(source.parent)
                    for cover_name in _ARCHIVE_COVER_NAMES:
                        cover = library_file(source.parent / cover_name, root)
                        if cover is None:
                            continue
                        archive.write(
                            cover,
                            _unique_archive_name(
                                archive_prefix, cover_name, used_names
                            ),
                        )
            if on_progress is not None:
                on_progress(index, track)

    return written_files


__all__ = [
    "CRATE_DOWNLOAD_KIND",
    "CRATE_DOWNLOAD_TASK_TYPE",
    "build_crate_zip",
    "crate_download_dedup_key",
    "crate_download_filename",
    "crate_download_url",
    "estimate_crate_zip_bytes",
    "is_crate_download_cache_key",
    "library_file",
    "zip_component",
]

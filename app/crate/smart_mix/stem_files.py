"""The stem files the server keeps for Crate Decks (Smart Mix Stems, STEM-D6).

For each separated track of a Smart Mix playlist, the server keeps one MP4 with three AAC
streams at 256 kbps: drums, bass and vocals, in that order, each named in its handler
(``handler_name``). ``other`` is not stored: Decks rebuilds it as the residual against
its own decode (STEM-D9). A five-minute track is about 29 MB.

Files live in ``CRATE_STEMS_DIR`` on the music volume, at ``<track id mod 256 in
hex>/<track id>-<first 16 characters of the source revision>.mp4``. ffmpeg writes each one
in the separation's scratch directory, on the same volume, and it moves into place with a
rename. An admin quota caps their total size (:func:`enforce_stem_quota`); files no row
refers to, and scratch left by a separation that died, are swept
(:func:`sweep_stem_directory`).

The API imports this module, and its image has no numpy.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import time
from pathlib import Path
from typing import TYPE_CHECKING

from crate.smart_mix.stem_storage import (
    SCRATCH_NAME,
    StemsVolumeError,
    configured_stems_directory,
)

if TYPE_CHECKING:
    from crate.smart_mix.separation import SeparatedStems

log = logging.getLogger(__name__)

# Stream order of the file (STEM-D6).
STEM_FILE_SOURCES = ("drums", "bass", "vocals")
STEM_FILE_BITRATE = "256k"
STEM_FILE_MEDIA_TYPE = "audio/mp4"
_ENCODE_TIMEOUT_SECONDS = 1800
_GIB = 1024**3


def stem_quota_bytes(quota_gib: int) -> int:
    return max(0, int(quota_gib)) * _GIB


def stem_file_name(track_id: int, source_revision: str) -> str:
    """The file's path relative to the stems directory."""
    return f"{track_id % 256:02x}/{track_id}-{source_revision[:16]}.mp4"


def _inside(root: Path, path: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
    except ValueError:
        return False
    return True


def write_stem_file(stems: SeparatedStems, out: Path, *, threads: int = 1) -> int:
    """Encode drums, bass and vocals into one MP4 at ``out``; returns its size.

    ``out`` must be in the stems directory and outside its scratch, so the file only
    ever lands on the music volume. ffmpeg writes it next to the stems, in their scratch
    directory on the same volume, and it is renamed into place.
    """
    from crate.resource_governor import low_priority_command

    root = configured_stems_directory()
    if root is None:
        raise StemsVolumeError("CRATE_STEMS_DIR is not set: the server keeps no stems")
    if not _inside(root, out) or _inside(root / SCRATCH_NAME, out):
        raise StemsVolumeError(f"{out} is not in the stems directory {root}")
    if not _inside(root, stems.directory):
        raise StemsVolumeError(f"{stems.directory} is not in the stems directory")
    encoded = stems.directory / "stems.mp4"
    command = ["ffmpeg", "-nostdin", "-v", "error", "-y"]
    for stem in STEM_FILE_SOURCES:
        command += [
            "-f",
            "f32le",
            "-ar",
            str(stems.sample_rate),
            "-ac",
            "2",
            "-i",
            str(stems.path(stem)),
        ]
    for index in range(len(STEM_FILE_SOURCES)):
        command += ["-map", f"{index}:a"]
    command += ["-c:a", "aac", "-b:a", STEM_FILE_BITRATE]
    for index, stem in enumerate(STEM_FILE_SOURCES):
        command += [f"-metadata:s:a:{index}", f"handler_name={stem}"]
    command += [
        "-threads",
        str(max(1, threads)),
        "-movflags",
        "+faststart",
        "-f",
        "mp4",
        str(encoded),
    ]
    try:
        result = subprocess.run(
            low_priority_command(command),
            capture_output=True,
            timeout=_ENCODE_TIMEOUT_SECONDS,
            check=False,
        )
        if result.returncode != 0:
            detail = result.stderr.decode("utf-8", "replace").strip().splitlines()
            raise RuntimeError(
                "ffmpeg could not write the stem file: "
                f"{detail[-1] if detail else f'exit {result.returncode}'}"
            )
        out.parent.mkdir(parents=True, exist_ok=True)
        os.replace(encoded, out)
    finally:
        encoded.unlink(missing_ok=True)
    return out.stat().st_size


def enforce_stem_quota(limit_bytes: int, *, root: Path | None = None) -> int:
    """Evict stem files until they fit ``limit_bytes``; returns the bytes freed.

    The files of tracks in no Smart Mix playlist that is on go first, then the rest,
    each least recently used first (the later of the file's last download and its
    playlists' last use).
    """
    from crate.db.jobs.smart_mix_stems import evict_stem_files

    directory = root or configured_stems_directory()
    freed = 0
    for path, size in evict_stem_files(limit_bytes):
        freed += size
        if directory is None:
            continue
        try:
            (directory / path).unlink(missing_ok=True)
        except OSError:
            log.warning(
                "Could not delete the evicted stem file %s", path, exc_info=True
            )
    return freed


def sweep_stem_directory(root: Path, *, min_age_seconds: int) -> int:
    """Delete files no row refers to and scratch left behind; returns how many.

    Only what has not changed for ``min_age_seconds`` goes, so a file being moved into
    place and a separation still running are left alone.
    """
    from crate.db.jobs.smart_mix_stems import stem_file_paths

    cutoff = time.time() - min_age_seconds
    removed = 0
    scratch = root / SCRATCH_NAME
    if scratch.is_dir():
        for entry in scratch.iterdir():
            if _newest_change(entry) < cutoff:
                if entry.is_dir():
                    shutil.rmtree(entry, ignore_errors=True)
                else:
                    entry.unlink(missing_ok=True)
                removed += 1
    kept = stem_file_paths()
    for path in root.rglob("*"):
        if not path.is_file() or _inside(scratch, path):
            continue
        if path.relative_to(root).as_posix() in kept:
            continue
        if path.stat().st_mtime < cutoff:
            path.unlink(missing_ok=True)
            removed += 1
    return removed


def _newest_change(path: Path) -> float:
    newest = path.stat().st_mtime
    if path.is_dir():
        for child in path.iterdir():
            newest = max(newest, child.stat().st_mtime)
    return newest


__all__ = [
    "STEM_FILE_BITRATE",
    "STEM_FILE_MEDIA_TYPE",
    "STEM_FILE_SOURCES",
    "enforce_stem_quota",
    "stem_file_name",
    "stem_quota_bytes",
    "sweep_stem_directory",
    "write_stem_file",
]

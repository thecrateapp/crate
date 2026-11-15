"""Where the server keeps stem audio (Smart Mix Stems, STEM-D6).

Separation writes its scratch audio, and the stem files Crate Decks downloads, to one
directory on the music volume, ``CRATE_STEMS_DIR`` (``/stems`` in the Compose files,
``STEMS_DIR`` on the host, ``${MEDIA_DIR}/smart-mix-stems`` by default). Never to
``/tmp`` or the root disk: a
five-minute track decodes to about 100 MB and separates into four stems of the same
size, and the server's root disk has a few gigabytes free.

A writer only accepts the directory when it is on the same filesystem as the library,
which is how the worker tells the music volume from the container's own disk or a
``tmpfs``. Scratch lives in ``.scratch`` inside it, so a finished file moves into place
with an atomic rename. The API mounts the directory read-only and only reads it.

The API imports this module, so it imports nothing beyond the standard library.
"""

from __future__ import annotations

import os
from pathlib import Path

STEMS_DIR_ENV = "CRATE_STEMS_DIR"
SCRATCH_NAME = ".scratch"


class StemsVolumeError(RuntimeError):
    """The stems directory is not configured, missing, or not on the music volume."""


def configured_stems_directory() -> Path | None:
    """``CRATE_STEMS_DIR`` when it is set to an absolute path, else None."""
    value = (os.environ.get(STEMS_DIR_ENV) or "").strip()
    if not value:
        return None
    path = Path(value)
    return path if path.is_absolute() else None


def writable_stems_directory(library: str | Path) -> Path:
    """The stems directory, checked before anything is written to it.

    It must be configured as an absolute path, exist, be writable and share the
    library's filesystem (the music volume). Raises :class:`StemsVolumeError`.
    """
    value = (os.environ.get(STEMS_DIR_ENV) or "").strip()
    if not value:
        raise StemsVolumeError(
            f"{STEMS_DIR_ENV} is not set: the server keeps no stem audio"
        )
    directory = Path(value)
    if not directory.is_absolute():
        raise StemsVolumeError(f"{STEMS_DIR_ENV} must be an absolute path: {value}")
    if not directory.is_dir():
        raise StemsVolumeError(f"{STEMS_DIR_ENV} does not exist: {directory}")
    try:
        same_volume = os.stat(directory).st_dev == os.stat(library).st_dev
    except OSError as error:
        raise StemsVolumeError(f"Cannot check the music volume: {error}") from error
    if not same_volume:
        raise StemsVolumeError(
            f"{directory} is not on the music volume of the library {library}"
        )
    if not os.access(directory, os.W_OK | os.X_OK):
        raise StemsVolumeError(f"{directory} is not writable")
    return directory


def scratch_directory(library: str | Path) -> Path:
    """``.scratch`` inside the checked stems directory, created when missing."""
    scratch = writable_stems_directory(library) / SCRATCH_NAME
    scratch.mkdir(exist_ok=True)
    return scratch


__all__ = [
    "SCRATCH_NAME",
    "STEMS_DIR_ENV",
    "StemsVolumeError",
    "configured_stems_directory",
    "scratch_directory",
    "writable_stems_directory",
]

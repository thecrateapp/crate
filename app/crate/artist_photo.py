"""Bounded filesystem evidence for a single local artist's photo flag."""

import hashlib
import json
import stat
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

from crate.db.jobs.artist_photo import read_artist_photo
from crate.utils import PHOTO_NAMES


class PhotoObservationError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def observe_artist_photo(config: dict, artist_uid: str) -> dict:
    try:
        artist_uid = str(UUID(str(artist_uid)))
    except (TypeError, ValueError, AttributeError):
        raise PhotoObservationError(
            "INVALID_ARGUMENT", "artist_uid must be a UUID"
        ) from None
    artist = read_artist_photo(artist_uid)
    if artist is None:
        raise PhotoObservationError("ARTIST_NOT_FOUND", "Artist no longer exists")
    folder = artist["folder_name"] or artist["name"]
    if not folder or Path(folder).is_absolute():
        raise PhotoObservationError(
            "PATH_UNSAFE", "Artist directory is outside the library"
        )
    try:
        base = Path(config["library_path"]).resolve(strict=True)
        directory = (base / folder).resolve(strict=True)
        if directory == base or not directory.is_relative_to(base):
            raise PhotoObservationError(
                "PATH_UNSAFE", "Artist directory is outside the library"
            )
        directory_stat = directory.stat()
        if not stat.S_ISDIR(directory_stat.st_mode):
            raise PhotoObservationError(
                "DIRECTORY_MISSING", "Artist directory is unavailable"
            )
        photos = []
        for filename in sorted(PHOTO_NAMES):
            candidate = directory / filename
            resolved = candidate.resolve(strict=False)
            if not resolved.is_relative_to(base):
                raise PhotoObservationError(
                    "PATH_UNSAFE", "Artist photo is outside the library"
                )
            try:
                info = candidate.stat()
            except FileNotFoundError:
                continue
            if stat.S_ISREG(info.st_mode):
                photos.append(
                    [
                        filename,
                        str(resolved.relative_to(base)),
                        info.st_dev,
                        info.st_ino,
                        info.st_size,
                        info.st_mtime_ns,
                        info.st_ctime_ns,
                    ]
                )
        identity = {
            "artist_uid": artist_uid,
            "name": artist["name"],
            "folder_name": artist["folder_name"],
        }
        fingerprint_data = {
            **identity,
            "directory": str(directory.relative_to(base)),
            "directory_id": [directory_stat.st_dev, directory_stat.st_ino],
            "photos": photos,
        }
    except FileNotFoundError:
        raise PhotoObservationError(
            "DIRECTORY_MISSING", "Artist directory is unavailable"
        ) from None
    except (OSError, RuntimeError):
        raise PhotoObservationError(
            "FILESYSTEM_UNAVAILABLE", "Artist photo could not be observed"
        ) from None
    return {
        **identity,
        "db_has_photo": bool(artist["has_photo"]),
        "fs_has_photo": bool(photos),
        "filesystem_fingerprint": hashlib.sha256(
            json.dumps(fingerprint_data, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest(),
        "observed_at": datetime.now(UTC).isoformat(),
    }


__all__ = ["PhotoObservationError", "observe_artist_photo"]

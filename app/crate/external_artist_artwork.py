"""Durable, worker-owned cache for artwork of artists outside the library."""

from __future__ import annotations

import hashlib
import logging
import re
import time
from io import BytesIO
from pathlib import Path
from typing import TypedDict

from PIL import Image, ImageOps, UnidentifiedImageError

from crate.db.cache_store import get_cache, set_cache
from crate.streaming.paths import cache_root

log = logging.getLogger(__name__)

_ARTWORK_TTL_SECONDS = 30 * 86400
_ARTWORK_STALE_TTL_SECONDS = 30 * 86400
_NEGATIVE_TTL_SECONDS = 86400
_MAX_DIMENSION = 640


class CachedExternalArtistArtwork(TypedDict):
    content: bytes
    content_type: str
    stale: bool


class CachedExternalArtistArtworkPath(TypedDict):
    path: Path
    content_type: str
    stale: bool


def _normalized_artist_name(name: str) -> str:
    return re.sub(r"\s+", " ", (name or "").strip()).casefold()


def external_artist_artwork_key(name: str) -> str:
    """Return a safe, stable key for an external artist name."""
    normalized = _normalized_artist_name(name)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _status_cache_key(name: str) -> str:
    return f"external_artist_artwork:{external_artist_artwork_key(name)}"


def external_artist_artwork_root() -> Path:
    return cache_root() / "external-artist-artwork"


def _artwork_path(name: str) -> Path:
    return external_artist_artwork_root() / f"{external_artist_artwork_key(name)}.webp"


def external_artist_artwork_path_from_key(entity_key: str) -> Path | None:
    if not re.fullmatch(r"[a-f0-9]{64}", entity_key or ""):
        return None
    return external_artist_artwork_root() / f"{entity_key}.webp"


def _missing_marker_path(name: str) -> Path:
    return (
        external_artist_artwork_root() / f"{external_artist_artwork_key(name)}.missing"
    )


def _is_fresh(path: Path, ttl_seconds: int) -> bool:
    try:
        return path.is_file() and time.time() - path.stat().st_mtime <= ttl_seconds
    except OSError:
        return False


def get_cached_external_artist_artwork(
    name: str,
) -> CachedExternalArtistArtwork | None:
    """Read an already materialised image without performing remote I/O."""
    path = _artwork_path(name)
    try:
        if not path.is_file():
            return None
        age_seconds = max(0.0, time.time() - path.stat().st_mtime)
        if age_seconds > _ARTWORK_TTL_SECONDS + _ARTWORK_STALE_TTL_SECONDS:
            return None
        return {
            "content": path.read_bytes(),
            "content_type": "image/webp",
            "stale": age_seconds > _ARTWORK_TTL_SECONDS,
        }
    except OSError as exc:
        log.debug("External artist artwork read skipped: %s", exc)
        return None


def get_cached_external_artist_artwork_path(
    name: str,
) -> CachedExternalArtistArtworkPath | None:
    """Resolve a durable cached file without copying it into Python memory."""
    path = _artwork_path(name)
    try:
        if not path.is_file():
            return None
        age_seconds = max(0.0, time.time() - path.stat().st_mtime)
        if age_seconds > _ARTWORK_TTL_SECONDS + _ARTWORK_STALE_TTL_SECONDS:
            return None
        return {
            "path": path,
            "content_type": "image/webp",
            "stale": age_seconds > _ARTWORK_TTL_SECONDS,
        }
    except OSError as exc:
        log.debug("External artist artwork path lookup skipped: %s", exc)
        return None


def persist_external_artist_artwork(name: str, content: bytes) -> None:
    """Validate, downsize and atomically persist artwork from a worker task."""
    if not (name or "").strip():
        raise ValueError("Artist name is required")
    if not content:
        raise ValueError("Artwork payload is empty")

    try:
        with Image.open(BytesIO(content)) as source:
            source.load()
            image = ImageOps.exif_transpose(source)
            image.thumbnail((_MAX_DIMENSION, _MAX_DIMENSION), Image.Resampling.LANCZOS)
            output = BytesIO()
            image.save(output, format="WEBP", quality=82, method=4)
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise ValueError("Artwork payload is not a supported image") from exc

    path = _artwork_path(name)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = path.with_suffix(".tmp")
        tmp_path.write_bytes(output.getvalue())
        tmp_path.replace(path)
        _missing_marker_path(name).unlink(missing_ok=True)
    except OSError as exc:
        raise RuntimeError("Could not persist external artist artwork") from exc

    set_cache(_status_cache_key(name), {"status": "ready"}, ttl=_ARTWORK_TTL_SECONDS)


def mark_external_artist_artwork_missing(name: str) -> None:
    """Negative-cache a provider miss so clients do not repeatedly enqueue it."""
    try:
        marker_path = _missing_marker_path(name)
        marker_path.parent.mkdir(parents=True, exist_ok=True)
        marker_path.touch(exist_ok=True)
    except OSError as exc:
        log.debug("External artist artwork negative cache write skipped: %s", exc)
    set_cache(
        _status_cache_key(name),
        {"status": "missing"},
        ttl=_NEGATIVE_TTL_SECONDS,
    )


def is_external_artist_artwork_missing(name: str) -> bool:
    cached = get_cache(_status_cache_key(name), max_age_seconds=_NEGATIVE_TTL_SECONDS)
    if cached and cached.get("status") == "missing":
        return True
    return _is_fresh(_missing_marker_path(name), _NEGATIVE_TTL_SECONDS)


def queue_external_artist_artwork(name: str) -> str | None:
    """Queue a single background resolution for an artist across all API workers."""
    artist_name = (name or "").strip()
    if not artist_name:
        return None

    from crate.db.repositories.tasks import create_task_dedup

    return create_task_dedup(
        "resolve_external_artist_artwork",
        {"artist_name": artist_name},
        dedup_key=external_artist_artwork_key(artist_name),
    )


def resolve_external_artist_artwork(name: str) -> bytes | None:
    """Fetch external artwork. This function must only run in a worker."""
    try:
        from crate.lastfm import get_external_artist_image

        return get_external_artist_image(name)
    except Exception:
        log.debug("External artist artwork lookup failed for %s", name, exc_info=True)
        return None


__all__ = [
    "CachedExternalArtistArtwork",
    "external_artist_artwork_key",
    "external_artist_artwork_path_from_key",
    "external_artist_artwork_root",
    "get_cached_external_artist_artwork",
    "get_cached_external_artist_artwork_path",
    "is_external_artist_artwork_missing",
    "mark_external_artist_artwork_missing",
    "persist_external_artist_artwork",
    "queue_external_artist_artwork",
    "resolve_external_artist_artwork",
]

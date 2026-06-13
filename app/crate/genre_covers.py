from __future__ import annotations

import os
import re
from io import BytesIO
from pathlib import Path
from urllib.parse import quote

from PIL import Image, UnidentifiedImageError


_ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}
_CONTENT_TYPE_EXTENSIONS = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}
_MEDIA_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}


def genre_covers_root() -> Path:
    root = Path(os.environ.get("DATA_DIR", "/data")) / "genre-covers"
    root.mkdir(parents=True, exist_ok=True)
    return root


def genre_cover_public_url(
    slug: str, *, size: int = 640, image_format: str = "webp"
) -> str:
    encoded_slug = quote((slug or "").strip().lower(), safe="")
    return f"/api/genres/{encoded_slug}/cover?size={size}&format={image_format}"


def genre_cover_abspath(cover_path: str | None) -> Path | None:
    if not cover_path:
        return None
    root = genre_covers_root().resolve()
    candidate = (root / cover_path).resolve()
    try:
        candidate.relative_to(root)
    except ValueError:
        return None
    return candidate


def genre_cover_media_type(path: Path) -> str:
    return _MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream")


def persist_genre_cover_upload(
    slug: str,
    *,
    filename: str,
    content_type: str | None,
    payload: bytes,
) -> str:
    normalized_slug = re.sub(r"[^a-z0-9]+", "-", (slug or "").strip().lower()).strip(
        "-"
    )
    if not normalized_slug:
        raise ValueError("Genre slug is required")
    if not payload:
        raise ValueError("Genre cover image is empty")

    suffix = Path(filename or "").suffix.lower().lstrip(".")
    ext = suffix if suffix in _ALLOWED_EXTENSIONS else None
    if not ext:
        ext = _CONTENT_TYPE_EXTENSIONS.get((content_type or "").lower())
    if not ext:
        raise ValueError("Unsupported genre cover format")
    if ext == "jpeg":
        ext = "jpg"

    try:
        image = Image.open(BytesIO(payload))
        image.verify()
    except (UnidentifiedImageError, OSError) as exc:
        raise ValueError("Invalid genre cover image") from exc

    root = genre_covers_root()
    for existing_ext in _ALLOWED_EXTENSIONS:
        existing = root / f"{normalized_slug}.{existing_ext}"
        if existing.exists() and existing.suffix.lower().lstrip(".") != ext:
            existing.unlink()

    cover_path = f"{normalized_slug}.{ext}"
    (root / cover_path).write_bytes(payload)
    return cover_path


def delete_genre_cover(cover_path: str | None) -> None:
    absolute = genre_cover_abspath(cover_path)
    if absolute and absolute.exists():
        absolute.unlink()


__all__ = [
    "delete_genre_cover",
    "genre_cover_abspath",
    "genre_cover_media_type",
    "genre_cover_public_url",
    "genre_covers_root",
    "persist_genre_cover_upload",
]

"""Helpers for serving lightweight image variants to frontend clients."""

from __future__ import annotations

import hashlib
import os
import threading
from collections import OrderedDict
from io import BytesIO
from typing import Mapping

from fastapi.responses import Response
from PIL import Image, UnidentifiedImageError

_RASTER_MEDIA_TO_FORMAT = {
    "image/jpeg": "JPEG",
    "image/png": "PNG",
    "image/webp": "WEBP",
}

_OUTPUT_FORMAT_TO_MEDIA = {
    "webp": "image/webp",
}

_VARIANT_CACHE_MAX_BYTES = max(
    0, int(os.environ.get("IMAGE_VARIANT_CACHE_MAX_BYTES", 32 * 1024 * 1024))
)
_variant_cache: OrderedDict[
    tuple[str, str, int | None, str | None], tuple[bytes, str]
] = OrderedDict()
_variant_cache_bytes = 0
_variant_cache_lock = threading.Lock()


def clear_image_variant_cache() -> None:
    """Clear process-local materialized image variants."""
    global _variant_cache_bytes
    with _variant_cache_lock:
        _variant_cache.clear()
        _variant_cache_bytes = 0


def _cached_variant(
    key: tuple[str, str, int | None, str | None],
) -> tuple[bytes, str] | None:
    with _variant_cache_lock:
        cached = _variant_cache.get(key)
        if cached is not None:
            _variant_cache.move_to_end(key)
        return cached


def _store_variant(
    key: tuple[str, str, int | None, str | None], value: tuple[bytes, str]
) -> None:
    global _variant_cache_bytes
    content_size = len(value[0])
    if _VARIANT_CACHE_MAX_BYTES <= 0 or content_size > _VARIANT_CACHE_MAX_BYTES:
        return
    with _variant_cache_lock:
        previous = _variant_cache.pop(key, None)
        if previous is not None:
            _variant_cache_bytes -= len(previous[0])
        while (
            _variant_cache
            and _variant_cache_bytes + content_size > _VARIANT_CACHE_MAX_BYTES
        ):
            _, evicted = _variant_cache.popitem(last=False)
            _variant_cache_bytes -= len(evicted[0])
        _variant_cache[key] = value
        _variant_cache_bytes += content_size


def resize_image_bytes(
    content: bytes,
    media_type: str,
    *,
    size: int | None = None,
    output_format: str | None = None,
) -> tuple[bytes, str]:
    target_media_type = _OUTPUT_FORMAT_TO_MEDIA.get((output_format or "").lower())
    if not size and not target_media_type:
        return content, media_type

    image_format = _RASTER_MEDIA_TO_FORMAT.get(media_type)
    if image_format is None:
        return content, media_type

    normalized_output_format = (output_format or "").lower() or None
    cache_key = (
        hashlib.sha256(content).hexdigest(),
        media_type,
        size,
        normalized_output_format,
    )
    cached = _cached_variant(cache_key)
    if cached is not None:
        return cached

    try:
        image = Image.open(BytesIO(content))
    except (UnidentifiedImageError, OSError):
        return content, media_type

    if size and max(image.size) > size:
        image.thumbnail((size, size), Image.Resampling.LANCZOS)
    elif not target_media_type:
        return content, media_type

    output = BytesIO()
    save_format = _RASTER_MEDIA_TO_FORMAT.get(
        target_media_type or media_type, image_format
    )

    if save_format == "JPEG":
        if image.mode not in ("RGB", "L"):
            image = image.convert("RGB")
        image.save(
            output, format=save_format, quality=85, optimize=True, progressive=True
        )
    elif save_format == "PNG":
        image.save(output, format=save_format, optimize=True)
    else:
        image.save(output, format=save_format, quality=82, method=4)

    variant = (output.getvalue(), target_media_type or media_type)
    _store_variant(cache_key, variant)
    return variant


def build_image_response(
    content: bytes,
    media_type: str,
    *,
    size: int | None = None,
    output_format: str | None = None,
    headers: Mapping[str, str] | None = None,
) -> Response:
    resized_content, resized_media_type = resize_image_bytes(
        content,
        media_type,
        size=size,
        output_format=output_format,
    )
    return Response(
        content=resized_content,
        media_type=resized_media_type,
        headers=dict(headers or {}),
    )

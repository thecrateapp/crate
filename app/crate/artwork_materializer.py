"""Worker-only generation of persistent artwork variants."""

from __future__ import annotations

import hashlib
import shutil
import time
import uuid
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps, UnidentifiedImageError

from crate.artwork_variants import (
    VARIANT_SIZE_BUCKETS,
    ArtworkAsset,
    artwork_asset_root,
    load_current_manifest,
    publish_manifest_atomically,
    select_variant_size,
)
from crate.metrics import record_later

_MAX_SOURCE_PIXELS = 80_000_000


class ArtworkMaterializationError(RuntimeError):
    pass


def _write_webp_variant(image: Image.Image, path: Path, size: int) -> tuple[int, int]:
    variant = image.copy()
    variant.thumbnail((size, size), Image.Resampling.LANCZOS)
    if variant.mode not in ("RGB", "RGBA"):
        variant = variant.convert("RGBA" if "transparency" in variant.info else "RGB")
    variant.save(path, format="WEBP", quality=82, method=4)
    return variant.size


def _variant_sizes(asset: ArtworkAsset) -> tuple[int, ...]:
    maximum = select_variant_size(asset.kind, None)
    return tuple(size for size in VARIANT_SIZE_BUCKETS if size <= maximum)


def _current_revision_is_complete(asset: ArtworkAsset, source_sha256: str) -> bool:
    manifest = load_current_manifest(asset)
    if manifest is None or manifest.get("source_sha256") != source_sha256:
        return False
    variants = manifest.get("variants")
    if not isinstance(variants, dict) or not variants:
        return False
    root = artwork_asset_root(asset).resolve()
    for relative in variants.values():
        if not isinstance(relative, str):
            return False
        candidate = (root / relative).resolve()
        try:
            candidate.relative_to(root)
        except ValueError:
            return False
        if not candidate.is_file():
            return False
    return True


def _materialize_artwork(
    asset: ArtworkAsset,
    source_content: bytes,
    *,
    source_media_type: str | None = None,
) -> dict[str, Any]:
    if not source_content:
        raise ArtworkMaterializationError("invalid image: empty payload")

    source_sha256 = hashlib.sha256(source_content).hexdigest()
    source_revision = source_sha256[:16]
    if _current_revision_is_complete(asset, source_sha256):
        return {
            "status": "current",
            "source_revision": source_revision,
            "variant_count": len(_variant_sizes(asset)),
        }

    try:
        with Image.open(BytesIO(source_content)) as opened:
            width, height = opened.size
            if width <= 0 or height <= 0 or width * height > _MAX_SOURCE_PIXELS:
                raise ArtworkMaterializationError("invalid image: unsafe dimensions")
            opened.load()
            source = ImageOps.exif_transpose(opened)
            if source.mode not in ("RGB", "RGBA"):
                source = source.convert(
                    "RGBA" if "transparency" in source.info else "RGB"
                )
    except ArtworkMaterializationError:
        raise
    except (
        Image.DecompressionBombError,
        UnidentifiedImageError,
        OSError,
        ValueError,
    ) as exc:
        raise ArtworkMaterializationError(f"invalid image: {exc}") from exc

    root = artwork_asset_root(asset)
    root.mkdir(parents=True, exist_ok=True)
    temporary = root / f".{source_revision}-{uuid.uuid4().hex}.tmp"
    final_revision = root / source_revision
    temporary.mkdir()
    variants: dict[str, str] = {}
    dimensions: dict[str, list[int]] = {}
    physical_by_size: dict[int, tuple[str, tuple[int, int]]] = {}

    try:
        source_max = max(source.size)
        for requested_size in _variant_sizes(asset):
            physical_size = min(requested_size, source_max)
            existing = physical_by_size.get(physical_size)
            if existing is None:
                filename = f"{physical_size}.webp"
                output_dimensions = _write_webp_variant(
                    source, temporary / filename, physical_size
                )
                existing = (filename, output_dimensions)
                physical_by_size[physical_size] = existing
            filename, output_dimensions = existing
            variants[str(requested_size)] = f"{source_revision}/{filename}"
            dimensions[str(requested_size)] = list(output_dimensions)

        if final_revision.exists():
            shutil.rmtree(temporary)
        else:
            temporary.replace(final_revision)

        manifest = {
            "version": 1,
            "kind": asset.kind,
            "entity_key": asset.entity_key,
            "source_revision": source_revision,
            "source_sha256": source_sha256,
            "source_bytes": len(source_content),
            "source_media_type": source_media_type,
            "generated_at": datetime.now(UTC).isoformat(),
            "variants": variants,
            "dimensions": dimensions,
        }
        publish_manifest_atomically(asset, manifest)
    except Exception as exc:
        shutil.rmtree(temporary, ignore_errors=True)
        if isinstance(exc, ArtworkMaterializationError):
            raise
        raise ArtworkMaterializationError(
            f"failed to materialize artwork: {exc}"
        ) from exc

    return {
        "status": "materialized",
        "source_revision": source_revision,
        "variant_count": len(variants),
    }


def materialize_artwork(
    asset: ArtworkAsset,
    source_content: bytes,
    *,
    source_media_type: str | None = None,
) -> dict[str, Any]:
    started = time.monotonic()
    try:
        result = _materialize_artwork(
            asset, source_content, source_media_type=source_media_type
        )
    except ArtworkMaterializationError as exc:
        reason = "invalid_source" if "invalid image" in str(exc) else "write_failed"
        record_later(
            "artwork.materialize.errors",
            1.0,
            {"kind": asset.kind, "reason": reason},
        )
        raise
    finally:
        record_later(
            "artwork.materialize.duration_ms",
            (time.monotonic() - started) * 1000,
            {"kind": asset.kind},
        )
    record_later(
        "artwork.materialize.bytes",
        float(len(source_content)),
        {"kind": asset.kind},
    )
    return result

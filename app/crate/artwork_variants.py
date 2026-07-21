"""Persistent, worker-owned artwork variant contracts."""

from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, cast

from crate.streaming.paths import cache_root

ArtworkKind = Literal[
    "album-cover",
    "artist-photo",
    "artist-background",
    "external-artist",
    "genre-cover",
    "release-cover",
]

ARTWORK_KINDS: frozenset[str] = frozenset(
    {
        "album-cover",
        "artist-photo",
        "artist-background",
        "external-artist",
        "genre-cover",
        "release-cover",
    }
)
VARIANT_SIZE_BUCKETS = (128, 256, 384, 512, 768, 1024, 1280, 2048)
_MAX_SIZE_BY_KIND: dict[str, int] = {
    "album-cover": 1024,
    "artist-photo": 1024,
    "artist-background": 2048,
    "external-artist": 768,
    "genre-cover": 2048,
    "release-cover": 1024,
}
_SAFE_ENTITY_KEY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$")


@dataclass(frozen=True)
class ArtworkAsset:
    kind: ArtworkKind
    entity_key: str

    def __post_init__(self) -> None:
        if self.kind not in ARTWORK_KINDS:
            raise ValueError(f"Unsupported artwork kind: {self.kind}")
        if not _SAFE_ENTITY_KEY.fullmatch(self.entity_key or ""):
            raise ValueError("Unsafe artwork entity key")


@dataclass(frozen=True)
class MaterializedArtwork:
    path: Path
    media_type: str
    source_revision: str
    width: int
    height: int


def artwork_variant_root() -> Path:
    return cache_root() / "artwork-variants" / "v1"


def artwork_asset_root(asset: ArtworkAsset) -> Path:
    return artwork_variant_root() / asset.kind / asset.entity_key


def external_artist_asset(name: str) -> ArtworkAsset:
    normalized = re.sub(r"\s+", " ", (name or "").strip()).casefold()
    if not normalized:
        raise ValueError("Artist name is required")
    key = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    return ArtworkAsset("external-artist", key)


def select_variant_size(kind: ArtworkKind | str, requested: int | None) -> int:
    maximum = _MAX_SIZE_BY_KIND.get(kind)
    if maximum is None:
        raise ValueError(f"Unsupported artwork kind: {kind}")
    if requested is None:
        return maximum
    bounded = max(1, min(int(requested), maximum))
    for size in VARIANT_SIZE_BUCKETS:
        if size >= bounded:
            return min(size, maximum)
    return maximum


def load_current_manifest(asset: ArtworkAsset) -> dict | None:
    manifest_path = artwork_asset_root(asset) / "current.json"
    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    if payload.get("version") != 1:
        return None
    if (
        payload.get("kind") != asset.kind
        or payload.get("entity_key") != asset.entity_key
    ):
        return None
    return payload


def publish_manifest_atomically(asset: ArtworkAsset, manifest: dict) -> None:
    root = artwork_asset_root(asset)
    root.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=".current-", suffix=".json.tmp", dir=root
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(manifest, handle, sort_keys=True, separators=(",", ":"))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, root / "current.json")
        directory_fd = os.open(root, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise


def resolve_materialized_variant(
    asset: ArtworkAsset, requested_size: int | None
) -> MaterializedArtwork | None:
    manifest = load_current_manifest(asset)
    if manifest is None:
        return None

    revision = manifest.get("source_revision")
    variants = manifest.get("variants")
    if not isinstance(revision, str) or not _SAFE_ENTITY_KEY.fullmatch(revision):
        return None
    if not isinstance(variants, dict):
        return None

    target_size = select_variant_size(asset.kind, requested_size)
    relative_path = variants.get(str(target_size))
    if not isinstance(relative_path, str) or not relative_path:
        return None

    root = artwork_asset_root(asset).resolve()
    candidate = Path(relative_path)
    if candidate.is_absolute():
        return None
    try:
        resolved = (root / candidate).resolve()
        resolved.relative_to(root)
    except (OSError, ValueError):
        return None
    if not resolved.is_file():
        return None

    width = 0
    height = 0
    dimensions = manifest.get("dimensions")
    if isinstance(dimensions, dict):
        raw_dimensions = dimensions.get(str(target_size))
        if (
            isinstance(raw_dimensions, list)
            and len(raw_dimensions) == 2
            and all(isinstance(value, int) for value in raw_dimensions)
        ):
            width, height = cast(list[int], raw_dimensions)

    return MaterializedArtwork(
        path=resolved,
        media_type="image/webp",
        source_revision=revision,
        width=width,
        height=height,
    )

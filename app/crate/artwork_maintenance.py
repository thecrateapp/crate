"""Bounded integrity and cleanup operations for persistent artwork variants."""

from __future__ import annotations

import shutil
import time
from typing import Iterator, cast

from crate.artwork_variants import (
    ARTWORK_KINDS,
    ArtworkAsset,
    ArtworkKind,
    artwork_variant_root,
    load_current_manifest,
)

_TEMP_MAX_AGE_SECONDS = 24 * 3600


def _iter_assets(max_assets: int) -> Iterator[ArtworkAsset]:
    root = artwork_variant_root()
    if not root.is_dir():
        return
    emitted = 0
    for kind_root in sorted(root.iterdir()):
        if not kind_root.is_dir() or kind_root.name not in ARTWORK_KINDS:
            continue
        for asset_root in sorted(kind_root.iterdir()):
            if not asset_root.is_dir():
                continue
            try:
                yield ArtworkAsset(cast(ArtworkKind, kind_root.name), asset_root.name)
            except ValueError:
                continue
            emitted += 1
            if emitted >= max_assets:
                return


def inspect_artwork_variants(*, max_assets: int = 1000) -> dict[str, int]:
    result = {
        "assets_checked": 0,
        "valid_assets": 0,
        "corrupt_assets": 0,
        "invalid_manifests": 0,
        "missing_variant_files": 0,
        "revision_count": 0,
        "bytes_used": 0,
        "truncated_assets": 0,
    }
    for asset in _iter_assets(max(1, int(max_assets))):
        result["assets_checked"] += 1
        root = artwork_variant_root() / asset.kind / asset.entity_key
        manifest = load_current_manifest(asset)
        if manifest is None:
            result["invalid_manifests"] += 1
            result["corrupt_assets"] += 1
        else:
            missing = 0
            variants = manifest.get("variants")
            if isinstance(variants, dict):
                for relative in set(variants.values()):
                    if not isinstance(relative, str):
                        missing += 1
                        continue
                    candidate = (root / relative).resolve()
                    try:
                        candidate.relative_to(root.resolve())
                    except ValueError:
                        missing += 1
                        continue
                    if not candidate.is_file():
                        missing += 1
            else:
                missing += 1
            result["missing_variant_files"] += missing
            if missing:
                result["corrupt_assets"] += 1
            else:
                result["valid_assets"] += 1

        files_seen = 0
        truncated = False
        for child in root.iterdir():
            files_seen += 1
            if files_seen > 128:
                truncated = True
                break
            if child.is_dir() and not child.name.startswith("."):
                result["revision_count"] += 1
            if child.is_file():
                try:
                    result["bytes_used"] += child.stat().st_size
                except OSError:
                    pass
            elif child.is_dir():
                for file_path in child.iterdir():
                    files_seen += 1
                    if files_seen > 128:
                        truncated = True
                        break
                    if file_path.is_file():
                        try:
                            result["bytes_used"] += file_path.stat().st_size
                        except OSError:
                            pass
        if truncated:
            result["truncated_assets"] += 1
    return result


def find_corrupt_artwork_assets(*, max_assets: int = 1000) -> list[ArtworkAsset]:
    corrupt: list[ArtworkAsset] = []
    for asset in _iter_assets(max(1, int(max_assets))):
        root = artwork_variant_root() / asset.kind / asset.entity_key
        manifest = load_current_manifest(asset)
        if manifest is None:
            corrupt.append(asset)
            continue
        variants = manifest.get("variants")
        if not isinstance(variants, dict) or not variants:
            corrupt.append(asset)
            continue
        for relative in variants.values():
            if not isinstance(relative, str):
                corrupt.append(asset)
                break
            candidate = (root / relative).resolve()
            try:
                candidate.relative_to(root.resolve())
            except ValueError:
                corrupt.append(asset)
                break
            if not candidate.is_file():
                corrupt.append(asset)
                break
    return corrupt


def repair_artwork_manifest_permissions(*, max_assets: int = 1000) -> dict[str, int]:
    result = {"assets_checked": 0, "permissions_repaired": 0}
    for asset in _iter_assets(max(1, int(max_assets))):
        result["assets_checked"] += 1
        manifest = (
            artwork_variant_root() / asset.kind / asset.entity_key / "current.json"
        )
        try:
            if not manifest.is_file():
                continue
            if manifest.stat().st_mode & 0o777 == 0o644:
                continue
            manifest.chmod(0o644)
            result["permissions_repaired"] += 1
        except OSError:
            continue
    return result


def cleanup_artwork_variants(*, max_assets: int = 1000) -> dict[str, int]:
    now = time.time()
    result = {
        "assets_checked": 0,
        "revisions_removed": 0,
        "temporary_removed": 0,
    }
    for asset in _iter_assets(max(1, int(max_assets))):
        result["assets_checked"] += 1
        root = artwork_variant_root() / asset.kind / asset.entity_key
        manifest = load_current_manifest(asset) or {}
        current_revision = str(manifest.get("source_revision") or "")
        revisions = sorted(
            (
                child
                for child in root.iterdir()
                if child.is_dir() and not child.name.startswith(".")
            ),
            key=lambda path: path.stat().st_mtime_ns,
            reverse=True,
        )
        keep = {current_revision} if current_revision else set()
        previous = next(
            (path.name for path in revisions if path.name != current_revision), None
        )
        if previous:
            keep.add(previous)

        for child in root.iterdir():
            if child.name.startswith(".") and child.name.endswith(".tmp"):
                try:
                    expired = now - child.stat().st_mtime > _TEMP_MAX_AGE_SECONDS
                except OSError:
                    expired = False
                if expired:
                    shutil.rmtree(child, ignore_errors=True)
                    result["temporary_removed"] += 1

        for revision in revisions:
            latest = load_current_manifest(asset) or {}
            latest_current = str(latest.get("source_revision") or "")
            if revision.name in keep or revision.name == latest_current:
                continue
            shutil.rmtree(revision, ignore_errors=True)
            result["revisions_removed"] += 1
    return result


__all__ = [
    "cleanup_artwork_variants",
    "find_corrupt_artwork_assets",
    "inspect_artwork_variants",
    "repair_artwork_manifest_permissions",
]

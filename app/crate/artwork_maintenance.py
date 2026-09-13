"""Bounded integrity and cleanup operations for persistent artwork variants."""

from __future__ import annotations

import shutil
import time
import logging
from typing import Iterator, cast

from crate.artist_hero_publication import (
    ARTIST_HERO_PUBLICATION_PREFIX,
    ArtistHeroArtifactIdentity,
    artist_hero_artifact_asset,
    artist_hero_artifact_root,
    artist_hero_publication_lock,
    delete_artist_hero_storage,
)
from crate.artist_hero_retention import (
    retained_artist_hero_revisions,
    retained_artist_hero_revisions_from_manifests,
)
from crate.artwork_variants import (
    ARTWORK_KINDS,
    ArtworkAsset,
    ArtworkKind,
    artwork_asset_root,
    artwork_variant_root,
    load_current_manifest,
)
from crate.db.repositories.artist_hero_artwork import (
    artist_hero_manifest_id,
    get_artist_hero_artwork,
    list_artist_hero_manifest_history,
    list_artist_hero_render_revision_artists,
    list_artist_hero_render_revisions,
)
from crate.db.repositories.library_artist_reads import (
    get_library_artist_by_entity_uid,
)
from crate.streaming.paths import cache_root

_TEMP_MAX_AGE_SECONDS = 24 * 3600
log = logging.getLogger(__name__)


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
    try:
        hero_result = cleanup_artist_hero_publications(max_artists=max_assets)
    except Exception:
        log.warning("Artist hero publication cleanup failed", exc_info=True)
        hero_result = {
            "artists_checked": 0,
            "revisions_removed": 0,
            "temporary_removed": 0,
            "orphan_revisions_removed": 0,
        }
    result.update(
        {
            "artist_hero_artists_checked": hero_result["artists_checked"],
            "artist_hero_revisions_removed": hero_result["revisions_removed"],
            "artist_hero_temporary_removed": hero_result["temporary_removed"],
            "artist_hero_orphan_revisions_removed": hero_result[
                "orphan_revisions_removed"
            ],
        }
    )
    return result


def cleanup_artist_hero_publications(
    *, max_artists: int = 1000, keep_per_composition: int = 2
) -> dict[str, int]:
    """Remove stale publications and expired artifacts left by crashed workers."""

    now = time.time()
    result = {
        "artists_checked": 0,
        "revisions_removed": 0,
        "temporary_removed": 0,
        "orphan_revisions_removed": 0,
    }
    capped_limit = max(1, int(max_artists))
    artists = list_artist_hero_render_revision_artists(limit=capped_limit)
    publication_root = cache_root()
    namespace_root = publication_root / ARTIST_HERO_PUBLICATION_PREFIX

    def _expired(path) -> bool:
        try:
            return now - path.stat().st_mtime > _TEMP_MAX_AGE_SECONDS
        except OSError:
            return False

    def _remove_tree(path) -> bool:
        try:
            if path.is_symlink():
                path.unlink()
            elif path.is_dir():
                shutil.rmtree(path)
        except OSError:
            return False
        return not path.exists()

    known_entity_uids = {str(artist.get("entity_uid") or "") for artist in artists}
    discovered_count = len(artists)
    if namespace_root.is_dir() and len(artists) < capped_limit:
        for entity_root in sorted(namespace_root.iterdir()):
            entity_uid = entity_root.name
            if (
                discovered_count >= capped_limit
                or not entity_root.is_dir()
                or entity_root.is_symlink()
                or entity_uid in known_entity_uids
            ):
                continue
            artist = get_library_artist_by_entity_uid(entity_uid)
            if not artist:
                if not _expired(entity_root):
                    continue
                revision_count = sum(
                    1
                    for composition_root in entity_root.iterdir()
                    if composition_root.is_dir() and not composition_root.is_symlink()
                    for revision_root in composition_root.iterdir()
                    if revision_root.is_dir()
                    and not revision_root.is_symlink()
                    and not revision_root.name.startswith(".")
                )
                removed = delete_artist_hero_storage(entity_uid)
                if removed["publication_roots_removed"]:
                    result["orphan_revisions_removed"] += revision_count
                    result["revisions_removed"] += revision_count
                result["artists_checked"] += 1
                discovered_count += 1
                continue
            artists.append({"artist_id": int(artist["id"]), "entity_uid": entity_uid})
            known_entity_uids.add(entity_uid)
            discovered_count += 1

    for artist in artists:
        result["artists_checked"] += 1
        artist_id = int(artist["artist_id"])
        with artist_hero_publication_lock(publication_root, artist_id):
            profile = get_artist_hero_artwork(artist_id) or {}
            enabled_compositions = {
                composition
                for composition in ("desktop", "mobile")
                if profile.get(f"{composition}_enabled", True) is not False
            }
            manifest = profile.get("render_manifest")
            artifacts = manifest.get("artifacts") if isinstance(manifest, dict) else {}
            active_revisions = {
                composition: str(artifact.get("render_revision") or "")
                for composition, artifact in (artifacts or {}).items()
                if composition in enabled_compositions and isinstance(artifact, dict)
            }
            history = list_artist_hero_render_revisions(artist_id)
            known_revisions = {
                (
                    str(row.get("composition") or ""),
                    str(row.get("render_revision") or ""),
                )
                for row in history
            }
            manifest_history = list_artist_hero_manifest_history(artist_id)
            if isinstance(manifest, dict) and manifest_history:
                retained = retained_artist_hero_revisions_from_manifests(
                    manifest_history,
                    artist_hero_manifest_id(manifest),
                    keep_manifest_count=max(2, keep_per_composition),
                )
                retained.update(active_revisions.items())
            else:
                retained = retained_artist_hero_revisions(
                    history,
                    active_revisions,
                    keep_per_composition=keep_per_composition,
                )
            retained = {item for item in retained if item[0] in enabled_compositions}
            for row in history:
                composition = str(row.get("composition") or "")
                revision = str(row.get("render_revision") or "")
                if (composition, revision) in retained:
                    continue
                try:
                    identity = ArtistHeroArtifactIdentity(
                        artist_entity_uid=str(artist.get("entity_uid") or ""),
                        composition=composition,
                        render_revision=revision,
                    )
                except ValueError:
                    continue
                removed = False
                path = artist_hero_artifact_root(identity, root=publication_root)
                if path.is_dir() and _remove_tree(path):
                    removed = True
                variant_path = artwork_asset_root(artist_hero_artifact_asset(identity))
                if variant_path.is_dir() and _remove_tree(variant_path):
                    removed = True
                if removed:
                    result["revisions_removed"] += 1

            entity_root = namespace_root / str(artist.get("entity_uid") or "")
            if not entity_root.is_dir() or entity_root.is_symlink():
                continue
            for composition in ("desktop", "mobile"):
                composition_root = entity_root / composition
                if not composition_root.is_dir() or composition_root.is_symlink():
                    continue
                for child in list(composition_root.iterdir()):
                    if child.name.startswith("."):
                        if _expired(child) and _remove_tree(child):
                            result["temporary_removed"] += 1
                        continue
                    identity_key = (composition, child.name)
                    if (
                        not child.is_dir()
                        or identity_key in known_revisions
                        or active_revisions.get(composition) == child.name
                        or not _expired(child)
                    ):
                        continue
                    if _remove_tree(child):
                        result["orphan_revisions_removed"] += 1
                        result["revisions_removed"] += 1
                try:
                    composition_root.rmdir()
                except OSError:
                    pass
            try:
                entity_root.rmdir()
            except OSError:
                pass
    return result


__all__ = [
    "cleanup_artist_hero_publications",
    "cleanup_artwork_variants",
    "find_corrupt_artwork_assets",
    "inspect_artwork_variants",
    "repair_artwork_manifest_permissions",
]

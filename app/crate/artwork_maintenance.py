"""Bounded integrity and cleanup operations for persistent artwork variants."""

from __future__ import annotations

import json
import fcntl
import logging
import os
import shutil
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path
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
from crate.streaming.paths import cache_root, data_root

_TEMP_MAX_AGE_SECONDS = 24 * 3600
log = logging.getLogger(__name__)


@contextmanager
def _artwork_cleanup_cursor_lock(cursor_name: str) -> Iterator[None]:
    lock_root = (data_root() / ".crate-locks" / "artwork-maintenance").resolve()
    lock_root.mkdir(parents=True, exist_ok=True)
    with (lock_root / f"{cursor_name}.lock").open("a+b") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def _rotating_name_batch(names: set[str], *, limit: int, cursor_name: str) -> list[str]:
    ordered = sorted(name for name in names if name)
    if not ordered:
        return []
    batch_size = min(max(1, int(limit)), len(ordered))
    cursor_root = (data_root() / ".crate-maintenance").resolve()
    cursor_path = cursor_root / f"{cursor_name}.json"

    with _artwork_cleanup_cursor_lock(cursor_name):
        cursor = ""
        try:
            payload = json.loads(cursor_path.read_text(encoding="utf-8"))
            if isinstance(payload, dict):
                cursor = str(payload.get("last_name") or "")
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            pass

        start = next(
            (index for index, name in enumerate(ordered) if name > cursor),
            0,
        )
        selected = [
            ordered[(start + offset) % len(ordered)] for offset in range(batch_size)
        ]

        try:
            cursor_root.mkdir(parents=True, exist_ok=True)
            descriptor, temporary_name = tempfile.mkstemp(
                prefix=f".{cursor_path.name}.",
                suffix=".tmp",
                dir=cursor_root,
            )
            temporary_path = Path(temporary_name)
            try:
                with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                    json.dump({"last_name": selected[-1]}, handle)
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(temporary_path, cursor_path)
            except Exception:
                temporary_path.unlink(missing_ok=True)
                raise
        except OSError:
            log.warning("Could not persist artwork cleanup cursor %s", cursor_name)
        return selected


def _iter_assets(
    max_assets: int, *, exclude_kinds: set[ArtworkKind] | None = None
) -> Iterator[ArtworkAsset]:
    root = artwork_variant_root()
    if not root.is_dir():
        return
    emitted = 0
    for kind_root in sorted(root.iterdir()):
        if (
            not kind_root.is_dir()
            or kind_root.name not in ARTWORK_KINDS
            or kind_root.name in (exclude_kinds or set())
        ):
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


def cleanup_artwork_variants(
    *, max_assets: int = 1000, library_root: Path | None = None
) -> dict[str, int]:
    now = time.time()
    result = {
        "assets_checked": 0,
        "revisions_removed": 0,
        "temporary_removed": 0,
    }
    for asset in _iter_assets(max(1, int(max_assets)), exclude_kinds={"artist-hero"}):
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
        hero_result = cleanup_artist_hero_publications(
            max_artists=max_assets,
            library_root=library_root,
        )
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
    *,
    max_artists: int = 1000,
    keep_per_composition: int = 2,
    library_root: Path | None = None,
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
    history_artists = list_artist_hero_render_revision_artists(limit=10_000)
    artists: list[dict] = []
    publication_root = cache_root()
    namespace_root = publication_root / ARTIST_HERO_PUBLICATION_PREFIX
    materialization_namespace_root = artwork_variant_root() / "artist-hero"

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
            elif path.is_file():
                path.unlink()
        except OSError:
            return False
        return not path.exists()

    def _count_revision_directories(entity_root) -> int:
        try:
            composition_roots = list(entity_root.iterdir())
        except OSError:
            return 0
        count = 0
        for composition_root in composition_roots:
            if not composition_root.is_dir() or composition_root.is_symlink():
                continue
            try:
                revision_roots = list(composition_root.iterdir())
            except OSError:
                continue
            count += sum(
                1
                for revision_root in revision_roots
                if revision_root.is_dir()
                and not revision_root.is_symlink()
                and not revision_root.name.startswith(".")
            )
        return count

    def _index_materialization_roots() -> dict[str, list]:
        if (
            not materialization_namespace_root.is_dir()
            or materialization_namespace_root.is_symlink()
        ):
            return {}
        try:
            candidates = list(materialization_namespace_root.iterdir())
        except OSError:
            return {}
        indexed: dict[str, list] = {}
        for candidate in candidates:
            key_parts = candidate.name.split(":", 2)
            if (
                len(key_parts) < 2
                or key_parts[1] not in {"desktop", "mobile"}
                or not candidate.is_dir()
                or candidate.is_symlink()
            ):
                continue
            indexed.setdefault(key_parts[0], []).append(candidate)
        return indexed

    def _cleanup_library_temporaries() -> int:
        if library_root is None:
            return 0
        if library_root.is_symlink():
            return 0
        resolved_library_root = library_root.resolve()
        if not resolved_library_root.is_dir():
            return 0
        removed = 0
        try:
            artist_names = {path.name for path in resolved_library_root.iterdir()}
        except OSError:
            return 0
        for artist_name in _rotating_name_batch(
            artist_names,
            limit=capped_limit,
            cursor_name="artist-hero-library-temporaries",
        ):
            artist_root = resolved_library_root / artist_name
            if not artist_root.is_dir() or artist_root.is_symlink():
                continue
            try:
                children = list(artist_root.iterdir())
            except OSError:
                continue
            for child in children:
                if (
                    child.is_symlink()
                    or not child.is_file()
                    or not child.name.startswith(".artist-hero-")
                    or not child.name.endswith(".tmp")
                    or not _expired(child)
                ):
                    continue
                if _remove_tree(child):
                    removed += 1
        return removed

    materialization_roots_by_uid = _index_materialization_roots()
    result["temporary_removed"] += _cleanup_library_temporaries()
    publication_uids: set[str] = set()
    if namespace_root.is_dir() and not namespace_root.is_symlink():
        try:
            publication_uids = {path.name for path in namespace_root.iterdir()}
        except OSError:
            pass
    history_uids = {str(artist.get("entity_uid") or "") for artist in history_artists}
    selected_uids = _rotating_name_batch(
        history_uids | set(materialization_roots_by_uid) | publication_uids,
        limit=capped_limit,
        cursor_name="artist-hero-publications",
    )

    for entity_uid in selected_uids:
        try:
            ArtistHeroArtifactIdentity(
                artist_entity_uid=entity_uid,
                composition="desktop",
                render_revision="cleanup",
            )
        except ValueError:
            continue
        materialization_roots = materialization_roots_by_uid.get(entity_uid, [])
        entity_root = namespace_root / entity_uid
        get_library_artist_by_entity_uid(entity_uid)
        with artist_hero_publication_lock(entity_uid):
            artist = get_library_artist_by_entity_uid(entity_uid)
            if not artist:
                removed = sum(1 for root in materialization_roots if _remove_tree(root))
                result["revisions_removed"] += removed
                if (
                    entity_root.is_dir()
                    and not entity_root.is_symlink()
                    and _expired(entity_root)
                ):
                    revision_count = _count_revision_directories(entity_root)
                    deleted = delete_artist_hero_storage(entity_uid)
                    if deleted["publication_roots_removed"]:
                        result["orphan_revisions_removed"] += revision_count
                        result["revisions_removed"] += revision_count
                result["artists_checked"] += 1
                continue
            if materialization_roots:
                profile = get_artist_hero_artwork(int(artist["id"])) or {}
                manifest = profile.get("render_manifest")
                artifacts = (
                    manifest.get("artifacts") if isinstance(manifest, dict) else {}
                )
                for materialization_root in materialization_roots:
                    key_parts = materialization_root.name.split(":", 2)
                    if len(key_parts) == 2:
                        composition = key_parts[1]
                        artifact = (
                            artifacts.get(composition)
                            if isinstance(artifacts, dict)
                            else None
                        )
                        if (
                            not profile
                            or profile.get(f"{composition}_enabled", True) is False
                            or (
                                isinstance(artifact, dict)
                                and artifact.get("render_revision")
                            )
                        ):
                            if _remove_tree(materialization_root):
                                result["revisions_removed"] += 1
                            continue
                    try:
                        materialization_children = list(materialization_root.iterdir())
                    except OSError:
                        continue
                    for child in materialization_children:
                        if (
                            child.name.startswith(".")
                            and child.name.endswith(".tmp")
                            and _expired(child)
                            and _remove_tree(child)
                        ):
                            result["temporary_removed"] += 1
            artists.append({"artist_id": int(artist["id"]), "entity_uid": entity_uid})

    for artist in artists:
        result["artists_checked"] += 1
        entity_uid = str(artist.get("entity_uid") or "")
        if not entity_uid:
            continue
        with artist_hero_publication_lock(entity_uid):
            current_artist = get_library_artist_by_entity_uid(entity_uid)
            if not current_artist:
                continue
            artist_id = int(current_artist["id"])
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
            for composition in ("desktop", "mobile"):
                legacy_asset = ArtworkAsset(
                    "artist-hero", f"{entity_uid}:{composition}"
                )
                legacy_root = artwork_asset_root(legacy_asset)
                if (
                    not profile
                    or composition not in enabled_compositions
                    or active_revisions.get(composition)
                ) and legacy_root.is_dir():
                    if _remove_tree(legacy_root):
                        result["revisions_removed"] += 1
            for row in history:
                composition = str(row.get("composition") or "")
                revision = str(row.get("render_revision") or "")
                if (composition, revision) in retained:
                    continue
                try:
                    identity = ArtistHeroArtifactIdentity(
                        artist_entity_uid=entity_uid,
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

            entity_root = namespace_root / entity_uid
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

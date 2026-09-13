"""Revision-scoped publication primitives for artist hero artifacts.

The publication namespace is deliberately separate from the library's legacy
``artist-hero-*.webp`` pointers.  A render can therefore be prepared and
retried without replacing bytes that an older profile or cache may still
reference.
"""

from __future__ import annotations

import hashlib
import errno
import json
import os
import re
import shutil
import tempfile
import fcntl
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, Literal

from PIL.Image import Image

from crate.artwork_variants import ArtworkAsset
from crate.streaming.paths import cache_root

ARTIST_HERO_PUBLICATION_VERSION = 1
ARTIST_HERO_PUBLICATION_PREFIX = "artist-hero-publications/v1"
ARTIST_HERO_ARTIFACT_FILENAME = "artifact.webp"
ARTIST_HERO_SOURCE_FILENAME = "source.jpg"
ARTIST_HERO_ARTIFACT_MANIFEST_FILENAME = "manifest.json"
ArtistHeroComposition = Literal["desktop", "mobile"]

_SAFE_SEGMENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$")


class ArtistHeroPublicationConflict(RuntimeError):
    """Raised when an immutable revision is retried with different metadata."""


@dataclass(frozen=True)
class ArtistHeroArtifactIdentity:
    """Stable identity shared by source resolution, materialization and delivery."""

    artist_entity_uid: str
    composition: ArtistHeroComposition
    render_revision: str

    def __post_init__(self) -> None:
        _validate_segment(self.artist_entity_uid, "artist entity UID")
        if self.composition not in {"desktop", "mobile"}:
            raise ValueError("Invalid artist hero composition")
        _validate_segment(self.render_revision, "artist hero render revision")

    @property
    def asset_key(self) -> str:
        return f"{self.artist_entity_uid}:{self.composition}:{self.render_revision}"


@dataclass(frozen=True)
class ArtistHeroArtifactPublication:
    identity: ArtistHeroArtifactIdentity
    artifact_path: Path
    source_path: Path
    manifest_path: Path
    manifest: dict[str, str | int]


def _validate_segment(value: str, label: str) -> None:
    if not isinstance(value, str) or not value or not _SAFE_SEGMENT.fullmatch(value):
        raise ValueError(f"Invalid {label}")
    if value in {".", ".."} or ".." in value.split("/"):
        raise ValueError(f"Invalid {label}")


def artist_hero_artifact_asset(identity: ArtistHeroArtifactIdentity) -> ArtworkAsset:
    return ArtworkAsset("artist-hero", identity.asset_key)


def artist_hero_artifact_root(
    identity: ArtistHeroArtifactIdentity, *, root: Path | None = None
) -> Path:
    base = root if root is not None else cache_root()
    return (
        base
        / ARTIST_HERO_PUBLICATION_PREFIX
        / identity.artist_entity_uid
        / identity.composition
        / identity.render_revision
    )


def artist_hero_artifact_source_path(
    identity: ArtistHeroArtifactIdentity, *, root: Path | None = None
) -> Path:
    return (
        artist_hero_artifact_root(identity, root=root) / ARTIST_HERO_ARTIFACT_FILENAME
    )


def artist_hero_artifact_original_source_path(
    identity: ArtistHeroArtifactIdentity, *, root: Path | None = None
) -> Path:
    return artist_hero_artifact_root(identity, root=root) / ARTIST_HERO_SOURCE_FILENAME


def artist_hero_artifact_manifest_path(
    identity: ArtistHeroArtifactIdentity, *, root: Path | None = None
) -> Path:
    return (
        artist_hero_artifact_root(identity, root=root)
        / ARTIST_HERO_ARTIFACT_MANIFEST_FILENAME
    )


def resolve_artist_hero_publication_path(
    relative_path: object, *, root: Path | None = None
) -> Path | None:
    stored = str(relative_path or "").strip()
    if not stored or Path(stored).is_absolute() or ".." in Path(stored).parts:
        return None
    base = (root if root is not None else cache_root()).resolve()
    candidate = (base / stored).resolve()
    return candidate if candidate.is_relative_to(base) else None


def artist_hero_source_fingerprint(source_content: bytes) -> str:
    return f"sha256:{hashlib.sha256(source_content).hexdigest()}"


def _relative_artifact_path(identity: ArtistHeroArtifactIdentity) -> str:
    return (
        f"{ARTIST_HERO_PUBLICATION_PREFIX}/{identity.artist_entity_uid}/"
        f"{identity.composition}/{identity.render_revision}/"
        f"{ARTIST_HERO_ARTIFACT_FILENAME}"
    )


def _relative_source_path(identity: ArtistHeroArtifactIdentity) -> str:
    return (
        f"{ARTIST_HERO_PUBLICATION_PREFIX}/{identity.artist_entity_uid}/"
        f"{identity.composition}/{identity.render_revision}/"
        f"{ARTIST_HERO_SOURCE_FILENAME}"
    )


def build_artist_hero_artifact_manifest(
    identity: ArtistHeroArtifactIdentity,
    *,
    source_fingerprint: str,
    recipe_hash: str,
    renderer_version: str,
) -> dict[str, str | int]:
    values = {
        "source_fingerprint": source_fingerprint,
        "recipe_hash": recipe_hash,
        "renderer_version": renderer_version,
    }
    if any(
        not isinstance(value, str) or not value.strip() for value in values.values()
    ):
        raise ValueError("Artist hero artifact metadata is required")
    return {
        "manifest_version": ARTIST_HERO_PUBLICATION_VERSION,
        "artist_entity_uid": identity.artist_entity_uid,
        "composition": identity.composition,
        "render_revision": identity.render_revision,
        "source_fingerprint": source_fingerprint,
        "recipe_hash": recipe_hash,
        "renderer_version": renderer_version,
        "relative_path": _relative_artifact_path(identity),
        "source_relative_path": _relative_source_path(identity),
    }


def _read_manifest(path: Path) -> dict[str, str | int] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _write_manifest(path: Path, manifest: dict[str, str | int]) -> None:
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    temporary_path = Path(temporary_name)
    try:
        os.fchmod(descriptor, 0o644)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(manifest, handle, sort_keys=True, separators=(",", ":"))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, path)
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise


def _fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _existing_publication(
    identity: ArtistHeroArtifactIdentity,
    manifest: dict[str, str | int],
    *,
    root: Path,
) -> ArtistHeroArtifactPublication:
    artifact_path = artist_hero_artifact_source_path(identity, root=root)
    source_path = artist_hero_artifact_original_source_path(identity, root=root)
    manifest_path = artist_hero_artifact_manifest_path(identity, root=root)
    if (
        _read_manifest(manifest_path) != manifest
        or not artifact_path.is_file()
        or not source_path.is_file()
    ):
        raise ArtistHeroPublicationConflict(
            f"Artifact identity already exists with different contents: {identity.asset_key}"
        )
    return ArtistHeroArtifactPublication(
        identity, artifact_path, source_path, manifest_path, manifest
    )


@contextmanager
def artist_hero_publication_lock(
    coordination_root: Path, artist_id: int
) -> Iterator[None]:
    """Serialize profile activation, rollback and cleanup for one artist."""

    resolved_coordination_root = coordination_root.resolve()
    lock_root = (resolved_coordination_root / ".crate-locks" / "artist-hero").resolve()
    if not lock_root.is_relative_to(resolved_coordination_root):
        raise ValueError("Artist hero lock path is outside the coordination root")
    lock_root.mkdir(parents=True, exist_ok=True)
    with (lock_root / f"{int(artist_id)}.lock").open("a+b") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def publish_artist_hero_artifact(
    identity: ArtistHeroArtifactIdentity,
    image: Image,
    *,
    source_fingerprint: str,
    recipe_hash: str,
    renderer_version: str,
    source_content: bytes,
    root: Path | None = None,
) -> ArtistHeroArtifactPublication:
    """Publish one immutable hero artifact and its sidecar atomically.

    The final directory is installed only after both the WebP and manifest are
    durable. Repeating the same publication is safe; reusing an identity with
    different metadata is rejected rather than overwriting history.
    """

    if not source_content:
        raise ValueError("Artist hero source content is required")
    base = root if root is not None else cache_root()
    manifest = build_artist_hero_artifact_manifest(
        identity,
        source_fingerprint=source_fingerprint,
        recipe_hash=recipe_hash,
        renderer_version=renderer_version,
    )
    final_root = artist_hero_artifact_root(identity, root=base)
    if final_root.exists():
        return _existing_publication(identity, manifest, root=base)

    final_root.parent.mkdir(parents=True, exist_ok=True)
    staging_root = Path(
        tempfile.mkdtemp(prefix=f".{identity.composition}-", dir=final_root.parent)
    )
    try:
        source_path = staging_root / ARTIST_HERO_SOURCE_FILENAME
        with source_path.open("wb") as handle:
            handle.write(source_content)
            handle.flush()
            os.fsync(handle.fileno())
        artifact_path = staging_root / ARTIST_HERO_ARTIFACT_FILENAME
        image.save(artifact_path, "WEBP", quality=95, method=6)
        with artifact_path.open("rb") as handle:
            os.fsync(handle.fileno())
        _write_manifest(staging_root / ARTIST_HERO_ARTIFACT_MANIFEST_FILENAME, manifest)
        _fsync_directory(staging_root)
        try:
            os.rename(staging_root, final_root)
        except OSError as exc:
            if exc.errno not in {errno.EEXIST, errno.ENOTEMPTY}:
                raise
            shutil.rmtree(staging_root, ignore_errors=True)
            return _existing_publication(identity, manifest, root=base)
        _fsync_directory(final_root.parent)
    except Exception:
        shutil.rmtree(staging_root, ignore_errors=True)
        raise

    return ArtistHeroArtifactPublication(
        identity=identity,
        artifact_path=artist_hero_artifact_source_path(identity, root=base),
        source_path=artist_hero_artifact_original_source_path(identity, root=base),
        manifest_path=artist_hero_artifact_manifest_path(identity, root=base),
        manifest=manifest,
    )


__all__ = [
    "ARTIST_HERO_ARTIFACT_FILENAME",
    "ARTIST_HERO_ARTIFACT_MANIFEST_FILENAME",
    "ARTIST_HERO_SOURCE_FILENAME",
    "ARTIST_HERO_PUBLICATION_PREFIX",
    "ARTIST_HERO_PUBLICATION_VERSION",
    "ArtistHeroArtifactIdentity",
    "ArtistHeroArtifactPublication",
    "ArtistHeroPublicationConflict",
    "artist_hero_artifact_asset",
    "artist_hero_artifact_manifest_path",
    "artist_hero_artifact_original_source_path",
    "artist_hero_artifact_root",
    "artist_hero_artifact_source_path",
    "artist_hero_publication_lock",
    "resolve_artist_hero_publication_path",
    "artist_hero_source_fingerprint",
    "build_artist_hero_artifact_manifest",
    "publish_artist_hero_artifact",
]

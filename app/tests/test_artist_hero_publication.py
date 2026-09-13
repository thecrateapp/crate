from __future__ import annotations

import errno
import json
import os
import shutil
from io import BytesIO
from pathlib import Path

import pytest
from PIL import Image


def _image() -> Image.Image:
    return Image.new("RGBA", (32, 16), (20, 120, 160, 220))


def test_artist_hero_artifact_identity_is_revision_scoped():
    from crate.artist_hero_publication import (
        ArtistHeroArtifactIdentity,
        artist_hero_artifact_asset,
        artist_hero_artifact_root,
    )

    first = ArtistHeroArtifactIdentity(
        artist_entity_uid="artist-1",
        composition="desktop",
        render_revision="cover-fit-v5:revision-a",
    )
    second = ArtistHeroArtifactIdentity(
        artist_entity_uid="artist-1",
        composition="desktop",
        render_revision="cover-fit-v5:revision-b",
    )

    assert (
        artist_hero_artifact_asset(first).entity_key
        != artist_hero_artifact_asset(second).entity_key
    )
    assert artist_hero_artifact_root(
        first, root=Path("/tmp")
    ) != artist_hero_artifact_root(second, root=Path("/tmp"))


@pytest.mark.parametrize(
    ("artist_entity_uid", "composition", "render_revision"),
    [
        ("../artist", "desktop", "revision-a"),
        ("artist-1", "desktop/mobile", "revision-a"),
        ("artist-1", "desktop", "../revision-a"),
        ("artist-1", "desktop", "revision-a/other"),
        ("artist-1", "desktop", ""),
    ],
)
def test_artist_hero_artifact_identity_rejects_path_unsafe_values(
    artist_entity_uid: str, composition: str, render_revision: str
):
    from crate.artist_hero_publication import ArtistHeroArtifactIdentity

    with pytest.raises(ValueError):
        ArtistHeroArtifactIdentity(
            artist_entity_uid=artist_entity_uid,
            composition=composition,
            render_revision=render_revision,
        )


def test_publish_artist_hero_artifact_writes_durable_sidecar_and_is_idempotent(
    tmp_path,
):
    from crate.artist_hero_publication import (
        ArtistHeroArtifactIdentity,
        artist_hero_artifact_original_source_path,
        artist_hero_artifact_manifest_path,
        artist_hero_artifact_source_path,
        publish_artist_hero_artifact,
    )

    identity = ArtistHeroArtifactIdentity(
        artist_entity_uid="artist-1",
        composition="desktop",
        render_revision="cover-fit-v5:revision-a",
    )
    first = publish_artist_hero_artifact(
        identity,
        _image(),
        source_fingerprint="sha256:source-a",
        recipe_hash="recipe-a",
        renderer_version="cover-fit-v5-neutral-alpha",
        source_content=b"editable-source-a",
        root=tmp_path,
    )
    second = publish_artist_hero_artifact(
        identity,
        _image(),
        source_fingerprint="sha256:source-a",
        recipe_hash="recipe-a",
        renderer_version="cover-fit-v5-neutral-alpha",
        source_content=b"editable-source-a",
        root=tmp_path,
    )

    assert first == second
    artifact_path = artist_hero_artifact_source_path(identity, root=tmp_path)
    original_source_path = artist_hero_artifact_original_source_path(
        identity, root=tmp_path
    )
    manifest_path = artist_hero_artifact_manifest_path(identity, root=tmp_path)
    assert artifact_path.is_file()
    assert original_source_path.read_bytes() == b"editable-source-a"
    assert manifest_path.is_file()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["render_revision"] == identity.render_revision
    assert manifest["relative_path"].endswith(
        "artist-hero-publications/v1/artist-1/desktop/cover-fit-v5:revision-a/artifact.webp"
    )
    assert manifest["source_relative_path"].endswith(
        "artist-hero-publications/v1/artist-1/desktop/cover-fit-v5:revision-a/source.jpg"
    )
    with Image.open(BytesIO(artifact_path.read_bytes())) as rendered:
        assert rendered.mode == "RGBA"
        assert rendered.getpixel((0, 0))[3] == 220


def test_publish_artist_hero_artifact_rejects_conflicting_retry(tmp_path):
    from crate.artist_hero_publication import (
        ArtistHeroArtifactIdentity,
        ArtistHeroPublicationConflict,
        publish_artist_hero_artifact,
    )

    identity = ArtistHeroArtifactIdentity("artist-1", "mobile", "revision-a")
    publish_artist_hero_artifact(
        identity,
        _image(),
        source_fingerprint="sha256:source-a",
        recipe_hash="recipe-a",
        renderer_version="renderer-a",
        source_content=b"editable-source-a",
        root=tmp_path,
    )

    with pytest.raises(ArtistHeroPublicationConflict):
        publish_artist_hero_artifact(
            identity,
            _image(),
            source_fingerprint="sha256:source-b",
            recipe_hash="recipe-a",
            renderer_version="renderer-a",
            source_content=b"editable-source-b",
            root=tmp_path,
        )


def test_publish_artist_hero_artifact_rejects_namespace_symlink_escape(tmp_path):
    from crate.artist_hero_publication import (
        ArtistHeroArtifactIdentity,
        publish_artist_hero_artifact,
    )

    cache_root = tmp_path / "cache"
    outside_root = tmp_path / "outside"
    cache_root.mkdir()
    outside_root.mkdir()
    (cache_root / "artist-hero-publications").symlink_to(
        outside_root, target_is_directory=True
    )
    identity = ArtistHeroArtifactIdentity("artist-1", "desktop", "revision-a")

    with pytest.raises(ValueError, match="outside the storage root"):
        publish_artist_hero_artifact(
            identity,
            _image(),
            source_fingerprint="sha256:source-a",
            recipe_hash="recipe-a",
            renderer_version="renderer-a",
            source_content=b"editable-source-a",
            root=cache_root,
        )

    assert list(outside_root.iterdir()) == []


def test_resolve_artist_hero_artifact_source_rejects_file_symlink_escape(tmp_path):
    from crate.artist_hero_publication import (
        ArtistHeroArtifactIdentity,
        artist_hero_artifact_source_path,
        resolve_artist_hero_artifact_source_path,
    )

    identity = ArtistHeroArtifactIdentity("artist-1", "desktop", "revision-a")
    artifact_path = artist_hero_artifact_source_path(identity, root=tmp_path)
    outside_path = tmp_path.parent / f"{tmp_path.name}-outside.webp"
    artifact_path.parent.mkdir(parents=True)
    outside_path.write_bytes(b"outside")
    artifact_path.symlink_to(outside_path)

    assert resolve_artist_hero_artifact_source_path(identity, root=tmp_path) is None


def test_publish_manifest_rolls_back_a_partial_composition_bundle(
    monkeypatch, tmp_path
):
    from crate.artist_hero_publication import (
        ArtistHeroArtifactIdentity,
        artist_hero_artifact_root,
    )
    from crate.worker_handlers import artwork

    monkeypatch.setenv("CACHE_DIR", str(tmp_path))
    monkeypatch.setattr(
        artwork,
        "get_library_artist_by_id",
        lambda _artist_id: {"id": 42, "entity_uid": "artist-1"},
    )
    publish = artwork.publish_artist_hero_artifact

    def fail_second_composition(identity, *args, **kwargs):
        if identity.composition == "mobile":
            raise RuntimeError("mobile publication failed")
        return publish(identity, *args, **kwargs)

    monkeypatch.setattr(
        artwork, "publish_artist_hero_artifact", fail_second_composition
    )
    desktop = ArtistHeroArtifactIdentity("artist-1", "desktop", "revision-a")

    with pytest.raises(RuntimeError, match="mobile publication failed"):
        artwork._publish_artist_hero_manifest(
            artist_row={"id": 42, "entity_uid": "artist-1"},
            revision="revision-a",
            rendered={"desktop": _image(), "mobile": _image()},
            raw_sources={"desktop": b"desktop", "mobile": b"mobile"},
            recipes={"desktop": {"mode": "cover"}, "mobile": {"mode": "cover"}},
            existing={},
            enabled=("desktop", "mobile"),
        )

    assert not artist_hero_artifact_root(desktop).exists()


def test_manifest_rollback_preserves_identity_activated_by_cas_winner(monkeypatch):
    from crate.artist_hero_publication import ArtistHeroArtifactIdentity
    from crate.worker_handlers import artwork

    identity = ArtistHeroArtifactIdentity("artist-1", "desktop", "revision-a")
    monkeypatch.setattr(
        artwork,
        "get_artist_hero_artwork",
        lambda _artist_id: {
            "render_manifest": {
                "artifacts": {"desktop": {"render_revision": identity.render_revision}}
            }
        },
    )
    monkeypatch.setattr(
        artwork,
        "delete_artist_hero_artifact",
        lambda _identity: pytest.fail("the CAS winner owns this publication"),
    )

    artwork._rollback_unactivated_artist_hero_publications(42, [identity])


def test_publish_manifest_skips_artist_deleted_before_lock(monkeypatch):
    from crate.worker_handlers import artwork

    monkeypatch.setattr(artwork, "get_library_artist_by_id", lambda _artist_id: None)

    def fail_publish(*_args, **_kwargs):
        raise AssertionError("deleted artists must not publish new files")

    monkeypatch.setattr(artwork, "publish_artist_hero_artifact", fail_publish)

    manifest = artwork._publish_artist_hero_manifest(
        artist_row={"id": 42, "entity_uid": "artist-1"},
        revision="revision-a",
        rendered={"desktop": _image()},
        raw_sources={"desktop": b"source"},
        recipes={"desktop": {"mode": "cover"}},
        existing={},
        enabled=("desktop",),
    )

    assert manifest is None


def test_publish_manifest_does_not_write_when_enabled_composition_is_missing(
    monkeypatch,
):
    from crate.worker_handlers import artwork

    monkeypatch.setattr(
        artwork,
        "get_library_artist_by_id",
        lambda _artist_id: {"id": 42, "entity_uid": "artist-1"},
    )

    def fail_publish(*_args, **_kwargs):
        raise AssertionError("incomplete manifests must not publish new files")

    monkeypatch.setattr(artwork, "publish_artist_hero_artifact", fail_publish)

    manifest = artwork._publish_artist_hero_manifest(
        artist_row={"id": 42, "entity_uid": "artist-1"},
        revision="revision-a",
        rendered={"desktop": _image()},
        raw_sources={"desktop": b"source"},
        recipes={"desktop": {"mode": "cover"}},
        existing={},
        enabled=("desktop", "mobile"),
    )

    assert manifest is None


def test_publish_manifest_does_not_write_when_existing_composition_files_are_missing(
    monkeypatch,
):
    from crate.worker_handlers import artwork

    monkeypatch.setattr(
        artwork,
        "get_library_artist_by_id",
        lambda _artist_id: {"id": 42, "entity_uid": "artist-1"},
    )

    def fail_publish(*_args, **_kwargs):
        raise AssertionError("incomplete manifest siblings must block publication")

    monkeypatch.setattr(artwork, "publish_artist_hero_artifact", fail_publish)

    manifest = artwork._publish_artist_hero_manifest(
        artist_row={"id": 42, "entity_uid": "artist-1"},
        revision="revision-a",
        rendered={"desktop": _image()},
        raw_sources={"desktop": b"source"},
        recipes={"desktop": {"mode": "cover"}},
        existing={
            "render_manifest": {
                "artifacts": {
                    "mobile": {
                        "relative_path": "missing/mobile/artifact.webp",
                        "source_relative_path": "missing/mobile/source.jpg",
                    }
                }
            }
        },
        enabled=("desktop", "mobile"),
    )

    assert manifest is None


def test_publish_artist_hero_artifact_accepts_concurrent_identical_winner(
    monkeypatch, tmp_path
):
    from crate import artist_hero_publication
    from crate.artist_hero_publication import (
        ArtistHeroArtifactIdentity,
        artist_hero_artifact_root,
        publish_artist_hero_artifact,
    )

    identity = ArtistHeroArtifactIdentity("artist-1", "desktop", "revision-race")
    final_root = artist_hero_artifact_root(identity, root=tmp_path)
    original_rename = os.rename

    def lose_install_race(source, destination):
        if Path(destination) == final_root:
            shutil.copytree(source, destination)
            raise OSError(errno.ENOTEMPTY, "Directory not empty", destination)
        return original_rename(source, destination)

    monkeypatch.setattr(artist_hero_publication.os, "rename", lose_install_race)

    publication = publish_artist_hero_artifact(
        identity,
        _image(),
        source_fingerprint="sha256:source-a",
        recipe_hash="recipe-a",
        renderer_version="renderer-a",
        source_content=b"editable-source-a",
        root=tmp_path,
    )

    assert publication.artifact_path.is_file()
    assert publication.manifest_path.is_file()


def test_artist_hero_publication_lock_uses_the_durable_data_root(monkeypatch, tmp_path):
    from crate.artist_hero_publication import artist_hero_publication_lock

    data_dir = tmp_path / "data"
    cache_dir = tmp_path / "cache"
    monkeypatch.setenv("DATA_DIR", str(data_dir))
    monkeypatch.setenv("CACHE_DIR", str(cache_dir))

    with artist_hero_publication_lock("artist-entity"):
        pass

    assert len(list((data_dir / ".crate-locks" / "artist-hero").iterdir())) == 1
    assert not (cache_dir / ".crate-locks").exists()

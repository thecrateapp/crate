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

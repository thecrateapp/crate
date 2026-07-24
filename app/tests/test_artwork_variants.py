from __future__ import annotations

import json
from pathlib import Path

import pytest


def test_artwork_asset_uses_safe_stable_identity(monkeypatch, tmp_path):
    from crate.artwork_variants import ArtworkAsset, artwork_asset_root

    monkeypatch.setenv("DATA_DIR", str(tmp_path))

    asset = ArtworkAsset(
        kind="artist-photo",
        entity_key="695179a0-3863-50c2-9302-61f5cf144daa",
    )

    assert artwork_asset_root(asset) == (
        tmp_path
        / "artwork-variants"
        / "v1"
        / "artist-photo"
        / "695179a0-3863-50c2-9302-61f5cf144daa"
    )


@pytest.mark.parametrize(
    "value", ["", ".", "..", "../escape", "a/b", "a\\b", "a\x00b", "None"]
)
def test_artwork_asset_rejects_unsafe_entity_keys(value):
    from crate.artwork_variants import ArtworkAsset

    with pytest.raises(ValueError):
        ArtworkAsset(kind="album-cover", entity_key=value)


def test_external_artist_identity_is_hashed():
    from crate.artwork_variants import external_artist_asset

    first = external_artist_asset("  Converge ")
    second = external_artist_asset("converge")

    assert first == second
    assert first.kind == "external-artist"
    assert len(first.entity_key) == 64
    assert "/" not in first.entity_key


@pytest.mark.parametrize(
    ("kind", "requested", "expected"),
    [
        ("album-cover", None, 1024),
        ("album-cover", 32, 128),
        ("album-cover", 128, 128),
        ("album-cover", 160, 256),
        ("album-cover", 320, 384),
        ("album-cover", 640, 768),
        ("album-cover", 2048, 1024),
        ("artist-photo", None, 1024),
        ("external-artist", None, 768),
        ("artist-background", None, 2048),
        ("genre-cover", 1280, 1280),
    ],
)
def test_select_variant_size_uses_canonical_buckets(kind, requested, expected):
    from crate.artwork_variants import select_variant_size

    assert select_variant_size(kind, requested) == expected


def test_resolve_materialized_variant_reads_only_current_revision(
    monkeypatch, tmp_path
):
    from crate.artwork_variants import (
        ArtworkAsset,
        artwork_asset_root,
        resolve_materialized_variant,
    )

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    asset = ArtworkAsset("album-cover", "album-entity")
    root = artwork_asset_root(asset)
    revision = root / "revision-a"
    revision.mkdir(parents=True)
    (revision / "256.webp").write_bytes(b"webp-a")
    (root / "current.json").write_text(
        json.dumps(
            {
                "version": 1,
                "kind": "album-cover",
                "entity_key": "album-entity",
                "source_revision": "revision-a",
                "variants": {"256": "revision-a/256.webp"},
                "dimensions": {"256": [256, 256]},
            }
        )
    )

    resolved = resolve_materialized_variant(asset, 160)

    assert resolved is not None
    assert resolved.path == revision / "256.webp"
    assert resolved.media_type == "image/webp"
    assert resolved.source_revision == "revision-a"
    assert (resolved.width, resolved.height) == (256, 256)


@pytest.mark.parametrize(
    "relative_path",
    ["../outside.webp", "revision-a/../../outside.webp", "/tmp/outside.webp"],
)
def test_resolve_materialized_variant_rejects_manifest_path_escape(
    monkeypatch, tmp_path, relative_path
):
    from crate.artwork_variants import (
        ArtworkAsset,
        artwork_asset_root,
        resolve_materialized_variant,
    )

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    asset = ArtworkAsset("album-cover", "album-entity")
    root = artwork_asset_root(asset)
    root.mkdir(parents=True)
    Path(tmp_path / "outside.webp").write_bytes(b"outside")
    (root / "current.json").write_text(
        json.dumps(
            {
                "version": 1,
                "kind": "album-cover",
                "entity_key": "album-entity",
                "source_revision": "revision-a",
                "variants": {"256": relative_path},
                "dimensions": {"256": [256, 256]},
            }
        )
    )

    assert resolve_materialized_variant(asset, 160) is None

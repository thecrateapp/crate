from __future__ import annotations

import json
from io import BytesIO

import pytest
from PIL import Image


def _image_bytes(
    size: tuple[int, int] = (1600, 1200), *, image_format: str = "JPEG", color="navy"
) -> bytes:
    output = BytesIO()
    Image.new("RGB", size, color=color).save(output, format=image_format)
    return output.getvalue()


def test_materialize_artwork_publishes_complete_webp_revision(monkeypatch, tmp_path):
    from crate.artwork_materializer import materialize_artwork
    from crate.artwork_variants import ArtworkAsset, resolve_materialized_variant

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    asset = ArtworkAsset("album-cover", "album-entity")

    result = materialize_artwork(asset, _image_bytes())

    assert result["status"] == "materialized"
    assert result["variant_count"] > 0
    variant = resolve_materialized_variant(asset, 320)
    assert variant is not None
    with Image.open(variant.path) as image:
        assert image.format == "WEBP"
        assert max(image.size) == 384


def test_materialize_artwork_never_upscales_small_source(monkeypatch, tmp_path):
    from crate.artwork_materializer import materialize_artwork
    from crate.artwork_variants import ArtworkAsset, artwork_asset_root

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    asset = ArtworkAsset("artist-photo", "artist-entity")

    materialize_artwork(asset, _image_bytes((96, 64)))

    manifest = json.loads(
        (artwork_asset_root(asset) / "current.json").read_text(encoding="utf-8")
    )
    physical_paths = set(manifest["variants"].values())
    assert len(physical_paths) == 1
    output_path = artwork_asset_root(asset) / next(iter(physical_paths))
    with Image.open(output_path) as image:
        assert image.size == (96, 64)


def test_materialize_artwork_reuses_identical_source(monkeypatch, tmp_path):
    from crate.artwork_materializer import materialize_artwork
    from crate.artwork_variants import ArtworkAsset

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    asset = ArtworkAsset("album-cover", "album-entity")
    content = _image_bytes()

    first = materialize_artwork(asset, content)
    second = materialize_artwork(asset, content)

    assert first["source_revision"] == second["source_revision"]
    assert second["status"] == "current"


def test_materialize_artwork_changes_revision_when_source_changes(
    monkeypatch, tmp_path
):
    from crate.artwork_materializer import materialize_artwork
    from crate.artwork_variants import ArtworkAsset

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    asset = ArtworkAsset("album-cover", "album-entity")

    first = materialize_artwork(asset, _image_bytes(color="navy"))
    second = materialize_artwork(asset, _image_bytes(color="red"))

    assert first["source_revision"] != second["source_revision"]


def test_materialize_failure_keeps_previous_manifest(monkeypatch, tmp_path):
    from crate import artwork_materializer
    from crate.artwork_materializer import ArtworkMaterializationError
    from crate.artwork_variants import ArtworkAsset, artwork_asset_root

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    asset = ArtworkAsset("album-cover", "album-entity")
    artwork_materializer.materialize_artwork(asset, _image_bytes(color="navy"))
    manifest_path = artwork_asset_root(asset) / "current.json"
    previous = manifest_path.read_bytes()
    real_write = artwork_materializer._write_webp_variant
    calls = 0

    def fail_after_first(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError("disk full")
        return real_write(*args, **kwargs)

    monkeypatch.setattr(artwork_materializer, "_write_webp_variant", fail_after_first)

    with pytest.raises(ArtworkMaterializationError, match="disk full"):
        artwork_materializer.materialize_artwork(asset, _image_bytes(color="red"))

    assert manifest_path.read_bytes() == previous


def test_materialize_artwork_rejects_invalid_image(monkeypatch, tmp_path):
    from crate.artwork_materializer import (
        ArtworkMaterializationError,
        materialize_artwork,
    )
    from crate.artwork_variants import ArtworkAsset

    monkeypatch.setenv("DATA_DIR", str(tmp_path))

    with pytest.raises(ArtworkMaterializationError, match="invalid image"):
        materialize_artwork(ArtworkAsset("album-cover", "album-entity"), b"broken")


def test_materializer_records_duration_bytes_and_failures(monkeypatch, tmp_path):
    from crate import artwork_materializer
    from crate.artwork_variants import ArtworkAsset

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    metrics = []
    monkeypatch.setattr(
        artwork_materializer,
        "record_later",
        lambda name, value, tags=None: metrics.append((name, value, tags)),
    )
    asset = ArtworkAsset("album-cover", "album-entity")
    artwork_materializer.materialize_artwork(asset, _image_bytes())
    with pytest.raises(artwork_materializer.ArtworkMaterializationError):
        artwork_materializer.materialize_artwork(asset, b"broken")

    assert any(name == "artwork.materialize.duration_ms" for name, _, _ in metrics)
    assert any(name == "artwork.materialize.bytes" for name, _, _ in metrics)
    assert any(name == "artwork.materialize.errors" for name, _, _ in metrics)

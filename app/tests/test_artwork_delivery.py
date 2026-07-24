from __future__ import annotations

import asyncio
from io import BytesIO

from fastapi.responses import Response
from PIL import Image


def _jpeg_bytes() -> bytes:
    output = BytesIO()
    Image.new("RGB", (640, 480), color="navy").save(output, format="JPEG")
    return output.getvalue()


def test_deliver_artwork_prefers_materialized_variant(monkeypatch, tmp_path):
    from crate.api import artwork_delivery
    from crate.artwork_materializer import materialize_artwork
    from crate.artwork_variants import ArtworkAsset

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    asset = ArtworkAsset("album-cover", "album-entity")
    materialize_artwork(asset, _jpeg_bytes())
    queued: list[ArtworkAsset] = []
    monkeypatch.setattr(
        artwork_delivery,
        "queue_artwork_materialization",
        lambda queued_asset, **_kwargs: queued.append(queued_asset),
    )

    response = artwork_delivery.deliver_artwork(
        asset,
        requested_size=320,
        local_original=None,
        missing_response=Response(status_code=404),
    )

    assert response.status_code == 200
    assert response.media_type == "image/webp"
    assert response.headers["etag"]
    assert response.headers["x-crate-artwork"] == "variant"
    assert str(getattr(response, "path")).endswith("384.webp")
    assert queued == []


def test_deliver_artwork_serves_original_and_queues_variant(monkeypatch, tmp_path):
    from crate.api import artwork_delivery
    from crate.artwork_variants import ArtworkAsset

    asset = ArtworkAsset("album-cover", "album-entity")
    original = tmp_path / "cover.jpg"
    original.write_bytes(_jpeg_bytes())
    queued: list[tuple[ArtworkAsset, str]] = []
    monkeypatch.setattr(
        artwork_delivery,
        "queue_artwork_materialization",
        lambda queued_asset, *, reason: queued.append((queued_asset, reason)),
    )

    response = artwork_delivery.deliver_artwork(
        asset,
        requested_size=320,
        local_original=original,
        missing_response=Response(status_code=404),
    )

    assert response.status_code == 200
    assert response.media_type == "image/jpeg"
    assert response.headers["x-crate-artwork"] == "original"
    assert queued == []
    assert response.background is not None
    asyncio.run(response.background())
    assert queued == [(asset, "variant-miss")]


def test_deliver_artwork_returns_missing_response_when_queue_fails(
    monkeypatch, tmp_path
):
    from crate.api import artwork_delivery
    from crate.artwork_variants import ArtworkAsset

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    asset = ArtworkAsset("artist-photo", "artist-entity")
    monkeypatch.setattr(
        artwork_delivery,
        "queue_artwork_materialization",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("redis down")),
    )
    missing = Response(status_code=404)

    response = artwork_delivery.deliver_artwork(
        asset,
        requested_size=320,
        local_original=None,
        missing_response=missing,
    )

    assert response is missing
    assert response.headers["x-crate-artwork"] == "missing"
    assert response.background is not None
    asyncio.run(response.background())


def test_delivery_records_result_and_queue_outcome(monkeypatch, tmp_path):
    from crate.api import artwork_delivery
    from crate.artwork_variants import ArtworkAsset

    asset = ArtworkAsset("artist-photo", "artist-entity")
    metrics = []
    monkeypatch.setattr(
        artwork_delivery,
        "record_counter_later",
        lambda name, tags=None: metrics.append((name, tags)),
    )
    monkeypatch.setattr(
        artwork_delivery,
        "queue_artwork_materialization",
        lambda *_args, **_kwargs: None,
    )

    response = artwork_delivery.deliver_artwork(
        asset,
        requested_size=128,
        local_original=None,
        missing_response=Response(status_code=404),
    )
    assert response.background is not None
    asyncio.run(response.background())

    assert (
        "artwork.requests",
        {"kind": "artist-photo", "result": "missing"},
    ) in metrics
    assert (
        "artwork.queue",
        {"kind": "artist-photo", "result": "deduplicated"},
    ) in metrics

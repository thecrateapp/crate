from __future__ import annotations

import os
import time
from io import BytesIO
from types import SimpleNamespace

from PIL import Image


def _jpeg_bytes() -> bytes:
    output = BytesIO()
    Image.new("RGB", (128, 128), color="navy").save(output, format="JPEG")
    return output.getvalue()


def test_external_artist_artwork_round_trips_as_a_durable_webp(tmp_path, monkeypatch):
    from crate import external_artist_artwork

    monkeypatch.setenv("DATA_DIR", str(tmp_path))

    external_artist_artwork.persist_external_artist_artwork("Converge", _jpeg_bytes())

    cached = external_artist_artwork.get_cached_external_artist_artwork("Converge")

    assert cached is not None
    assert cached["content_type"] == "image/webp"
    assert cached["content"].startswith(b"RIFF")
    assert list((tmp_path / "external-artist-artwork").glob("*.webp"))


def test_external_artist_artwork_remains_available_while_stale(tmp_path, monkeypatch):
    from crate import external_artist_artwork

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    external_artist_artwork.persist_external_artist_artwork("Converge", _jpeg_bytes())
    artwork_path = next((tmp_path / "external-artist-artwork").glob("*.webp"))
    expired_at = time.time() - (366 * 86400)
    os.utime(artwork_path, (expired_at, expired_at))

    cached = external_artist_artwork.get_cached_external_artist_artwork("Converge")

    assert cached is not None
    assert cached["stale"] is True
    assert cached["content"].startswith(b"RIFF")


def test_external_artist_artwork_stays_fresh_for_one_year(tmp_path, monkeypatch):
    from crate import external_artist_artwork

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    external_artist_artwork.persist_external_artist_artwork("Converge", _jpeg_bytes())
    artwork_path = next((tmp_path / "external-artist-artwork").glob("*.webp"))
    still_fresh_at = time.time() - (364 * 86400)
    os.utime(artwork_path, (still_fresh_at, still_fresh_at))

    cached = external_artist_artwork.get_cached_external_artist_artwork("Converge")

    assert cached is not None
    assert cached["stale"] is False


def test_external_artist_artwork_keeps_multi_year_stale_fallback(tmp_path, monkeypatch):
    from crate import external_artist_artwork

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    external_artist_artwork.persist_external_artist_artwork("Converge", _jpeg_bytes())
    artwork_path = next((tmp_path / "external-artist-artwork").glob("*.webp"))
    old_but_usable_at = time.time() - (5 * 365 * 86400)
    os.utime(artwork_path, (old_but_usable_at, old_but_usable_at))

    cached = external_artist_artwork.get_cached_external_artist_artwork("Converge")

    assert cached is not None
    assert cached["stale"] is True


def test_external_artist_artwork_path_lookup_does_not_read_image_bytes(
    tmp_path, monkeypatch
):
    from crate import external_artist_artwork

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    external_artist_artwork.persist_external_artist_artwork("Converge", _jpeg_bytes())
    monkeypatch.setattr(
        "pathlib.Path.read_bytes",
        lambda _path: (_ for _ in ()).throw(
            AssertionError("path lookup must not copy artwork bytes")
        ),
    )

    cached = external_artist_artwork.get_cached_external_artist_artwork_path("Converge")

    assert cached is not None
    assert cached["path"].is_file()
    assert cached["stale"] is False


def test_external_artist_artwork_negative_cache_survives_redis_eviction(
    tmp_path, monkeypatch
):
    from crate import external_artist_artwork

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setattr(
        external_artist_artwork,
        "get_cache",
        lambda _key, max_age_seconds=None: None,
    )
    monkeypatch.setattr(
        external_artist_artwork,
        "set_cache",
        lambda _key, _value, ttl=None: None,
    )

    external_artist_artwork.mark_external_artist_artwork_missing("Converge")

    assert external_artist_artwork.is_external_artist_artwork_missing("Converge")
    assert list((tmp_path / "external-artist-artwork").glob("*.missing"))


def test_external_artist_resolver_uses_bounded_sources_without_musicbrainz(
    monkeypatch,
):
    from crate import lastfm

    calls: list[tuple[str, int]] = []
    monkeypatch.setattr(
        lastfm,
        "_deezer_artist_image",
        lambda _name, *, timeout=10: "https://images.example.test/converge.jpg",
    )
    monkeypatch.setattr(
        lastfm,
        "get_fanart_artist_image",
        lambda _name: (_ for _ in ()).throw(
            AssertionError("external artwork must not depend on MusicBrainz/Fanart")
        ),
    )
    monkeypatch.setattr(
        lastfm,
        "download_artist_image",
        lambda url, *, timeout=15: calls.append((url, timeout)) or b"image",
    )

    assert lastfm.get_external_artist_image("Converge") == b"image"
    assert calls == [("https://images.example.test/converge.jpg", 5)]


def test_external_artist_resolver_uses_lightweight_lastfm_fallback(monkeypatch):
    from crate import lastfm

    calls: list[tuple[str, int]] = []
    monkeypatch.setattr(
        lastfm,
        "_deezer_artist_image",
        lambda _name, *, timeout=10: None,
    )
    monkeypatch.setattr(
        lastfm,
        "_lastfm_external_artist_image_url",
        lambda _name, *, timeout=5: "https://images.example.test/converge.jpg",
    )
    monkeypatch.setattr(
        lastfm,
        "download_artist_image",
        lambda url, *, timeout=15: calls.append((url, timeout)) or b"image",
    )

    assert lastfm.get_external_artist_image("Converge") == b"image"
    assert calls == [("https://images.example.test/converge.jpg", 5)]


def test_external_artist_artwork_queue_uses_a_stable_deduplication_key(monkeypatch):
    from crate import external_artist_artwork

    queued: list[tuple[str, dict, str]] = []
    monkeypatch.setattr(
        "crate.db.repositories.tasks.create_task_dedup",
        lambda task_type, params, dedup_key: (
            queued.append((task_type, params, dedup_key)) or "task-id"
        ),
    )

    assert (
        external_artist_artwork.queue_external_artist_artwork(" Converge ") == "task-id"
    )
    assert queued == [
        (
            "resolve_external_artist_artwork",
            {"artist_name": "Converge"},
            external_artist_artwork.external_artist_artwork_key("Converge"),
        )
    ]


def test_external_artist_artwork_resolver_delegates_to_bounded_lookup(monkeypatch):
    from crate import external_artist_artwork

    monkeypatch.setattr(
        "crate.lastfm.get_external_artist_image", lambda name: f"image:{name}".encode()
    )

    assert (
        external_artist_artwork.resolve_external_artist_artwork("Converge")
        == b"image:Converge"
    )


def test_external_artist_photo_serves_cached_bytes_without_remote_lookup(
    monkeypatch, tmp_path
):
    from crate.api import browse_artist

    queued: list[str] = []
    monkeypatch.setattr(
        browse_artist,
        "_require_auth",
        lambda _request: (_ for _ in ()).throw(
            AssertionError("public external artwork must not require authentication")
        ),
    )
    cached_path = tmp_path / "cached.webp"
    cached_path.write_bytes(_jpeg_bytes())
    monkeypatch.setattr(
        browse_artist,
        "get_cached_external_artist_artwork_path",
        lambda _name: {
            "path": cached_path,
            "content_type": "image/webp",
            "stale": False,
        },
    )
    monkeypatch.setattr(
        browse_artist,
        "queue_external_artist_artwork",
        lambda name: queued.append(name),
        raising=False,
    )

    def unexpected_remote_lookup(_name: str):
        raise AssertionError("the image read path must not call remote providers")

    monkeypatch.setattr("crate.lastfm.get_best_artist_image", unexpected_remote_lookup)

    response = browse_artist.api_external_artist_photo(
        SimpleNamespace(), "Converge", size=64, image_format="webp"
    )

    assert response.status_code == 200
    assert response.media_type == "image/webp"
    assert response.headers["cache-control"] == (
        "public, max-age=2592000, stale-while-revalidate=31536000, "
        "stale-if-error=31536000"
    )
    assert queued == []


def test_external_artist_photo_serves_stale_bytes_without_public_revalidation(
    monkeypatch, tmp_path
):
    from crate.api import browse_artist

    queued: list[str] = []
    monkeypatch.setattr(browse_artist, "_require_auth", lambda _request: {"id": 1})
    cached_path = tmp_path / "cached.webp"
    cached_path.write_bytes(_jpeg_bytes())
    monkeypatch.setattr(
        browse_artist,
        "get_cached_external_artist_artwork_path",
        lambda _name: {
            "path": cached_path,
            "content_type": "image/webp",
            "stale": True,
        },
    )
    monkeypatch.setattr(
        browse_artist,
        "is_external_artist_artwork_missing",
        lambda _name: False,
        raising=False,
    )
    monkeypatch.setattr(
        browse_artist,
        "queue_external_artist_artwork",
        lambda name: queued.append(name),
        raising=False,
    )

    response = browse_artist.api_external_artist_photo(
        SimpleNamespace(), "Converge", size=64, image_format="webp"
    )

    assert response.status_code == 200
    assert queued == []


def test_external_artist_photo_public_cache_miss_does_not_queue_remote_work(
    monkeypatch,
):
    from crate.api import browse_artist

    queued: list[str] = []
    monkeypatch.setattr(browse_artist, "_require_auth", lambda _request: {"id": 1})
    monkeypatch.setattr(
        browse_artist,
        "get_cached_external_artist_artwork_path",
        lambda _name: None,
    )
    monkeypatch.setattr(
        browse_artist,
        "is_external_artist_artwork_missing",
        lambda _name: False,
        raising=False,
    )
    monkeypatch.setattr(
        browse_artist,
        "queue_external_artist_artwork",
        lambda name: queued.append(name),
        raising=False,
    )

    def unexpected_remote_lookup(_name: str):
        raise AssertionError("the HTTP request must not resolve remote artwork")

    monkeypatch.setattr("crate.lastfm.get_best_artist_image", unexpected_remote_lookup)

    response = browse_artist.api_external_artist_photo(SimpleNamespace(), "Converge")

    assert response.status_code == 404
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["retry-after"] == "2"
    assert queued == []


def test_authenticated_related_artist_enrichment_queues_external_artwork(
    monkeypatch,
):
    from crate.api import browse_artist

    queued: list[str] = []
    monkeypatch.setattr(browse_artist, "get_similar_artist_refs", lambda _names: {})
    monkeypatch.setattr(browse_artist, "get_cached_artist_info", lambda _name: None)
    monkeypatch.setattr(
        browse_artist,
        "get_cached_external_artist_artwork_path",
        lambda _name: None,
    )
    monkeypatch.setattr(
        browse_artist,
        "queue_external_artist_artwork",
        lambda name: queued.append(name),
    )

    enriched = browse_artist._enrich_similar_artists(
        [{"name": "Converge", "match": 1.0}]
    )

    assert enriched[0]["image_url"] == (
        "/api/network/external-artist/photo?name=Converge"
    )
    assert queued == ["Converge"]


def test_external_artist_artwork_worker_persists_success_and_negative_caches_failure(
    monkeypatch,
):
    from crate.worker_handlers import artwork

    persisted: list[tuple[str, bytes]] = []
    missing: list[str] = []
    monkeypatch.setattr(
        "crate.external_artist_artwork.resolve_external_artist_artwork",
        lambda _name: _jpeg_bytes(),
    )
    monkeypatch.setattr(
        "crate.external_artist_artwork.persist_external_artist_artwork",
        lambda name, content: persisted.append((name, content)),
    )
    monkeypatch.setattr(
        "crate.external_artist_artwork.mark_external_artist_artwork_missing",
        lambda name: missing.append(name),
    )

    result = artwork._handle_resolve_external_artist_artwork(
        "task", {"artist_name": "Converge"}, {}
    )

    assert result == {"status": "cached", "artist_name": "Converge"}
    assert persisted == [("Converge", _jpeg_bytes())]
    assert missing == []


def test_external_artist_artwork_worker_negative_caches_missing_images(monkeypatch):
    from crate.worker_handlers import artwork

    missing: list[str] = []
    monkeypatch.setattr(
        "crate.external_artist_artwork.resolve_external_artist_artwork",
        lambda _name: None,
    )
    monkeypatch.setattr(
        "crate.external_artist_artwork.mark_external_artist_artwork_missing",
        lambda name: missing.append(name),
    )

    result = artwork._handle_resolve_external_artist_artwork(
        "task", {"artist_name": "Converge"}, {}
    )

    assert result == {"status": "missing", "artist_name": "Converge"}
    assert missing == ["Converge"]

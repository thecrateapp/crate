import uuid

import pytest

from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def test_remote_json_facet_is_cached_after_first_fetch(pg_db, monkeypatch):
    from crate.federation.global_remote_facets import get_or_fetch_remote_json_facet

    calls = []

    def fake_remote_json_facet(node_uid, remote_entity_uid, entity_type, facet, request):
        calls.append((node_uid, remote_entity_uid, entity_type, facet))
        return {"bio": "cached remote bio"}

    monkeypatch.setattr(
        "crate.api.federation_remote.remote_json_facet",
        fake_remote_json_facet,
    )
    selection = {
        "kind": "remote",
        "entity_type": "artist",
        "global_entity_uid": str(uuid.uuid4()),
        "node_uid": str(uuid.uuid4()),
        "remote_entity_uid": "remote-artist-1",
        "source_revision": "rev-1",
        "facet": "artist_info",
        "facet_payload": {"available": True, "revision": "rev-1", "ttl_seconds": 300},
    }

    first = get_or_fetch_remote_json_facet(selection, request=object())
    second = get_or_fetch_remote_json_facet(selection, request=object())

    assert first == {"bio": "cached remote bio"}
    assert second == {"bio": "cached remote bio"}
    assert calls == [
        (
            selection["node_uid"],
            "remote-artist-1",
            "artist",
            "artist_info",
        )
    ]


def test_remote_json_facet_cache_is_revision_scoped(pg_db, monkeypatch):
    from crate.federation.global_remote_facets import get_or_fetch_remote_json_facet

    calls = []

    def fake_remote_json_facet(node_uid, remote_entity_uid, entity_type, facet, request):
        calls.append(len(calls) + 1)
        return {"bio": f"remote bio {len(calls)}"}

    monkeypatch.setattr(
        "crate.api.federation_remote.remote_json_facet",
        fake_remote_json_facet,
    )
    base_selection = {
        "kind": "remote",
        "entity_type": "artist",
        "global_entity_uid": str(uuid.uuid4()),
        "node_uid": str(uuid.uuid4()),
        "remote_entity_uid": "remote-artist-1",
        "facet": "artist_info",
        "facet_payload": {"available": True, "ttl_seconds": 300},
    }

    rev_1 = {**base_selection, "source_revision": "rev-1"}
    rev_2 = {**base_selection, "source_revision": "rev-2"}

    assert get_or_fetch_remote_json_facet(rev_1, request=object())["bio"] == "remote bio 1"
    assert get_or_fetch_remote_json_facet(rev_2, request=object())["bio"] == "remote bio 2"
    assert calls == [1, 2]


def test_blob_facet_cache_round_trips_content(pg_db, tmp_path, monkeypatch):
    from crate.federation.global_content_cache import (
        get_cached_blob_facet,
        store_blob_facet,
    )

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    selection = {
        "kind": "remote",
        "entity_type": "artist",
        "global_entity_uid": str(uuid.uuid4()),
        "node_uid": str(uuid.uuid4()),
        "remote_entity_uid": "remote-artist-1",
        "source_revision": "rev-1",
        "facet": "artist_background",
        "cache_variant": {"asset": "background", "size": 1280, "format": "webp"},
    }

    store_blob_facet(
        selection,
        b"image-bytes",
        content_type="image/webp",
        ttl_seconds=300,
    )

    cached = get_cached_blob_facet(selection)

    assert cached == {"content": b"image-bytes", "content_type": "image/webp"}
    assert list((tmp_path / "global-content-cache").glob("*/*.webp"))


def test_blob_facet_cache_is_variant_scoped(pg_db, tmp_path, monkeypatch):
    from crate.federation.global_content_cache import (
        get_cached_blob_facet,
        store_blob_facet,
    )

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    base_selection = {
        "kind": "remote",
        "entity_type": "artist",
        "global_entity_uid": str(uuid.uuid4()),
        "node_uid": str(uuid.uuid4()),
        "remote_entity_uid": "remote-artist-1",
        "source_revision": "rev-1",
        "facet": "artist_background",
    }
    small = {
        **base_selection,
        "cache_variant": {"asset": "background", "size": 512, "format": "webp"},
    }
    large = {
        **base_selection,
        "cache_variant": {"asset": "background", "size": 1280, "format": "webp"},
    }

    store_blob_facet(small, b"small", content_type="image/webp", ttl_seconds=300)
    store_blob_facet(large, b"large", content_type="image/webp", ttl_seconds=300)

    assert get_cached_blob_facet(small)["content"] == b"small"
    assert get_cached_blob_facet(large)["content"] == b"large"

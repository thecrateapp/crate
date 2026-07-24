from __future__ import annotations

import pytest


def test_catalog_cursor_is_peer_bound_and_tamper_evident(monkeypatch):
    from crate.federation import catalog

    monkeypatch.setenv(
        "CRATE_FEDERATION_CURSOR_SECRET", "test-secret-at-least-32-bytes-long"
    )
    cursor = catalog.encode_catalog_cursor(
        peer_uid="peer-a",
        mode="delta",
        position={"sequence": 42},
    )

    assert catalog.decode_catalog_cursor(cursor, peer_uid="peer-a") == {
        "version": 1,
        "mode": "delta",
        "position": {"sequence": 42},
    }
    with pytest.raises(catalog.InvalidCatalogCursor):
        catalog.decode_catalog_cursor(cursor, peer_uid="peer-b")
    with pytest.raises(catalog.InvalidCatalogCursor):
        catalog.decode_catalog_cursor(
            cursor[:-1] + ("A" if cursor[-1] != "A" else "B"), peer_uid="peer-a"
        )


def test_catalog_cursor_rejects_unknown_schema(monkeypatch):
    from crate.federation import catalog

    monkeypatch.setenv(
        "CRATE_FEDERATION_CURSOR_SECRET", "test-secret-at-least-32-bytes-long"
    )
    cursor = catalog.encode_catalog_cursor(
        peer_uid="peer-a",
        mode="snapshot",
        position={"entity_type": "album", "entity_uid": "x"},
    )
    raw = catalog._decode_cursor_envelope(cursor)
    raw["payload"]["version"] = 99
    bad = catalog._encode_cursor_envelope(raw)

    with pytest.raises(catalog.InvalidCatalogCursor):
        catalog.decode_catalog_cursor(bad, peer_uid="peer-a")


def test_snapshot_manifest_uses_keyset_cursor_and_high_water_mark(monkeypatch):
    import asyncio

    from crate.api import federation

    async def peer(_request):
        return {"node_uid": "peer-a"}

    monkeypatch.setenv(
        "CRATE_FEDERATION_CURSOR_SECRET", "test-secret-at-least-32-bytes-long"
    )
    monkeypatch.setattr(federation, "_require_signed_node_request", peer)
    monkeypatch.setattr(federation, "_require_capability", lambda *_args: None)
    monkeypatch.setattr(federation, "_peer_has_capability", lambda *_args: False)
    monkeypatch.setattr(federation, "_catalog_share_policy", lambda: {})
    monkeypatch.setattr(
        federation,
        "_catalog_manifest_snapshot",
        lambda _policy: {
            "revision": "sha256:snapshot",
            "total_items": 2,
            "snapshot_sequence": 17,
        },
    )
    seen: list[tuple[str, str]] = []

    def items(*, after_entity_type, after_entity_uid, page_size, include_genres):
        del page_size, include_genres
        seen.append((after_entity_type, after_entity_uid))
        if not after_entity_uid:
            return [
                {
                    "entity_type": "artist",
                    "remote_entity_uid": "artist-1",
                    "title": "High Vis",
                }
            ]
        return []

    def compatibility_items(*, page, page_size, include_genres):
        del page
        return items(
            after_entity_type="",
            after_entity_uid="",
            page_size=page_size,
            include_genres=include_genres,
        )

    monkeypatch.setattr(federation, "_catalog_manifest_items", compatibility_items)
    monkeypatch.setattr(federation, "_catalog_manifest_items_after", items)

    first = asyncio.run(federation.catalog_manifest(object(), page_size=1))
    second = asyncio.run(
        federation.catalog_manifest(object(), cursor=first["next_cursor"], page_size=1)
    )

    assert first["snapshot_cursor"]
    assert first["has_more"] is True
    assert second["snapshot_cursor"] == first["snapshot_cursor"]
    assert seen == [("", ""), ("artist", "artist-1")]


def test_delta_returns_full_tombstones_and_rejects_expired_cursor(monkeypatch):
    import asyncio

    from fastapi import HTTPException

    from crate.api import federation
    from crate.federation.catalog import encode_catalog_cursor

    async def peer(_request):
        return {"node_uid": "peer-a"}

    monkeypatch.setenv(
        "CRATE_FEDERATION_CURSOR_SECRET", "test-secret-at-least-32-bytes-long"
    )
    monkeypatch.setattr(federation, "_require_signed_node_request", peer)
    monkeypatch.setattr(federation, "_require_capability", lambda *_args: None)
    monkeypatch.setattr(federation, "_catalog_share_policy", lambda: {})
    monkeypatch.setattr(federation, "catalog_retention_floor", lambda: 10)
    monkeypatch.setattr(federation, "catalog_high_water_mark", lambda: 12)
    monkeypatch.setattr(
        federation,
        "list_catalog_changes",
        lambda **_kwargs: [
            {
                "sequence": 11,
                "entity_type": "track",
                "entity_uid": "track-1",
                "operation": "delete",
                "payload_revision": "sha256:deleted",
                "payload_json": {"deleted": True},
            }
        ],
    )
    cursor = encode_catalog_cursor(
        peer_uid="peer-a", mode="delta", position={"sequence": 10}
    )

    response = asyncio.run(federation.catalog_delta(object(), cursor=cursor, limit=50))

    assert response["items"][0]["operation"] == "delete"
    assert response["items"][0]["payload"]["deleted"] is True

    expired = encode_catalog_cursor(
        peer_uid="peer-a", mode="delta", position={"sequence": 1}
    )
    with pytest.raises(HTTPException) as exc:
        asyncio.run(federation.catalog_delta(object(), cursor=expired, limit=50))
    assert exc.value.status_code == 410
    assert exc.value.detail["code"] == "full_sync_required"

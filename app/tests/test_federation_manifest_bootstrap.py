from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException


@pytest.fixture
def manifest_api(monkeypatch):
    from crate.api import federation
    from crate.federation.authorization import GrantConstraints

    async def peer(_request):
        return {"node_uid": "peer-a"}

    monkeypatch.setenv(
        "CRATE_FEDERATION_CURSOR_SECRET", "manifest-bootstrap-test-secret"
    )
    monkeypatch.setattr(federation, "_require_signed_node_request", peer)
    monkeypatch.setattr(
        federation,
        "_require_capability",
        lambda *_args: SimpleNamespace(constraints=GrantConstraints(max_results=20)),
    )
    monkeypatch.setattr(federation, "_peer_has_capability", lambda *_args: False)
    monkeypatch.setattr(federation, "_catalog_share_policy", dict)
    monkeypatch.setattr(
        federation,
        "_catalog_manifest_snapshot",
        lambda _policy: {
            "revision": "sha256:initial",
            "total_items": 1_001,
            "snapshot_sequence": 17,
        },
    )
    monkeypatch.setattr(
        federation,
        "_catalog_manifest_items",
        lambda **kwargs: [
            {"entity_type": "track", "remote_entity_uid": str(index), "title": "Track"}
            for index in range(kwargs["page_size"])
        ],
    )
    monkeypatch.setattr(
        federation,
        "_catalog_manifest_items_after",
        lambda **_kwargs: [
            {"entity_type": "track", "remote_entity_uid": "last", "title": "Track"}
        ],
    )
    return federation


@pytest.mark.parametrize("requested,expected", [(200, 200), (2_000, 500)])
def test_sync_page_size_is_independent_of_search_result_limit(
    manifest_api, requested, expected
):
    page = asyncio.run(manifest_api.catalog_manifest(object(), page_size=requested))

    assert page["page_size"] == expected
    assert len(page["items"]) == expected


def test_manifest_continuation_retains_initial_metadata_without_rescanning(
    manifest_api, monkeypatch
):
    first = asyncio.run(manifest_api.catalog_manifest(object(), page_size=200))

    def metadata_changed(_policy):
        pytest.fail("A continuation must not recount the live library")

    monkeypatch.setattr(manifest_api, "_catalog_manifest_snapshot", metadata_changed)
    second = asyncio.run(
        manifest_api.catalog_manifest(
            object(), cursor=first["next_cursor"], page_size=200
        )
    )

    assert second["revision"] == first["revision"]
    assert second["total_items"] == first["total_items"]
    assert second["snapshot_sequence"] == first["snapshot_sequence"] == 17
    assert second["snapshot_cursor"] == first["snapshot_cursor"]


def test_manifest_continuation_rejects_a_changed_sharing_policy(
    manifest_api, monkeypatch
):
    first = asyncio.run(manifest_api.catalog_manifest(object(), page_size=200))
    monkeypatch.setattr(
        manifest_api,
        "_catalog_share_policy",
        lambda: {"catalog_filter": {"deny_entity_uids": ["last"]}},
    )

    with pytest.raises(HTTPException) as error:
        asyncio.run(
            manifest_api.catalog_manifest(object(), cursor=first["next_cursor"])
        )

    assert error.value.status_code == 410
    assert error.value.detail["code"] == "full_sync_required"


def test_manifest_still_requires_sync_permission_before_reading(
    manifest_api, monkeypatch
):
    def denied(*_args):
        raise HTTPException(status_code=403, detail="capability_denied")

    monkeypatch.setattr(manifest_api, "_require_capability", denied)
    monkeypatch.setattr(
        manifest_api,
        "_catalog_manifest_snapshot",
        lambda _policy: pytest.fail("Denied peers must not read the manifest"),
    )

    with pytest.raises(HTTPException) as error:
        asyncio.run(manifest_api.catalog_manifest(object(), page_size=500))

    assert error.value.status_code == 403


def test_legacy_manifest_cursor_keeps_its_initial_delta_watermark(manifest_api):
    from crate.federation.catalog import encode_catalog_cursor

    cursor = encode_catalog_cursor(
        peer_uid="peer-a",
        mode="snapshot",
        position={"entity_type": "track", "entity_uid": "a", "snapshot_sequence": 9},
    )

    page = asyncio.run(manifest_api.catalog_manifest(object(), cursor=cursor))

    assert page["snapshot_sequence"] == 9


def test_manifest_query_receives_selected_grant_scope(manifest_api, monkeypatch):
    from crate.federation.authorization import GrantConstraints

    scopes = []
    monkeypatch.setattr(
        manifest_api,
        "_require_capability",
        lambda *_args: SimpleNamespace(
            constraints=GrantConstraints(
                allowed_entity_types=frozenset({"artist"}),
                allowed_entity_uids=frozenset({"artist-a"}),
            )
        ),
    )
    monkeypatch.setattr(
        manifest_api,
        "_catalog_manifest_items",
        lambda **kwargs: scopes.append(kwargs.get("policy")) or [],
    )

    asyncio.run(manifest_api.catalog_manifest(object(), page_size=500))

    assert scopes[0]["_grant_scope"]["allowed_entity_types"] == ["artist"]
    assert scopes[0]["_grant_scope"]["allowed_entity_uids"] == ["artist-a"]


def test_delta_filters_selected_grant_and_binds_its_scope(manifest_api, monkeypatch):
    from crate.federation.authorization import GrantConstraints

    allowed = ["artist-a"]
    monkeypatch.setattr(
        manifest_api,
        "_require_capability",
        lambda *_args: SimpleNamespace(
            constraints=GrantConstraints(
                allowed_entity_types=frozenset({"artist"}),
                allowed_entity_uids=frozenset(allowed),
            )
        ),
    )
    monkeypatch.setattr(manifest_api, "catalog_retention_floor", lambda: 0)
    monkeypatch.setattr(manifest_api, "catalog_high_water_mark", lambda: 2)
    monkeypatch.setattr(
        manifest_api,
        "list_catalog_changes",
        lambda **_kwargs: [
            {
                "sequence": index,
                "entity_type": "artist",
                "entity_uid": uid,
                "operation": "upsert",
                "payload_revision": str(index),
                "payload_json": {
                    "title": uid,
                    "genres": ["rock"],
                    "genre_assertions": ["rock"],
                },
            }
            for index, uid in enumerate(("artist-a", "artist-b"), start=1)
        ],
    )

    page = asyncio.run(manifest_api.catalog_delta(object()))

    assert [item["remote_entity_uid"] for item in page["items"]] == ["artist-a"]
    assert "genres" not in page["items"][0]["payload"]
    assert "genre_assertions" not in page["items"][0]["payload"]
    allowed[:] = ["artist-b"]
    with pytest.raises(HTTPException) as error:
        asyncio.run(manifest_api.catalog_delta(object(), cursor=page["next_cursor"]))
    assert error.value.status_code == 410


@pytest.mark.parametrize("allowed_type,expected", [("artist", 1), ("track", 0)])
def test_manifest_sql_intersects_share_and_grant_scope(pg_db, allowed_type, expected):
    from uuid import uuid4

    from crate.api.federation import _catalog_manifest_policy_params
    from crate.db.queries.federation_manifest import (
        get_federation_manifest_revision_row,
        list_federation_manifest_rows,
    )

    uid_a, uid_b = str(uuid4()), str(uuid4())
    pg_db.upsert_artist({"name": "Grant Scope A", "entity_uid": uid_a})
    pg_db.upsert_artist({"name": "Grant Scope B", "entity_uid": uid_b})
    params = _catalog_manifest_policy_params(
        {
            "catalog_filter": {"entity_uids": [uid_a, uid_b]},
            "_grant_scope": {
                "allowed_entity_types": [allowed_type],
                "allowed_entity_uids": [uid_a],
            },
        }
    )

    rows = list_federation_manifest_rows(
        after_entity_type="", after_entity_uid="", limit=500, policy_params=params
    )
    snapshot = get_federation_manifest_revision_row(params)

    assert len(rows) == expected
    assert {row["remote_entity_uid"] for row in rows} <= {uid_a}
    assert snapshot["total_items"] == expected


def test_delta_retention_race_requests_a_new_bootstrap(manifest_api, monkeypatch):
    from crate.db.jobs.federation_catalog_changes import CatalogHistoryExpired

    monkeypatch.setattr(manifest_api, "catalog_retention_floor", lambda: 0)

    def pruned(**_kwargs):
        raise CatalogHistoryExpired("history was pruned after the precheck")

    monkeypatch.setattr(manifest_api, "list_catalog_changes", pruned)
    with pytest.raises(HTTPException) as error:
        asyncio.run(manifest_api.catalog_delta(object()))
    assert error.value.status_code == 410
    assert error.value.detail["code"] == "full_sync_required"


@pytest.mark.parametrize("endpoint", ["manifest", "delta"])
@pytest.mark.parametrize("metadata_type", ["artist", "album"])
def test_genre_metadata_respects_its_own_grant_scope(
    monkeypatch, endpoint, metadata_type
):
    from crate.api import federation
    from crate.federation.authorization import GrantConstraints

    async def peer(_request):
        return {"node_uid": "peer-a"}

    def decision(_peer, capability):
        constraints = GrantConstraints()
        if capability == "catalog.metadata.genres":
            constraints = GrantConstraints(
                allowed_entity_types=frozenset({metadata_type}),
                allowed_entity_uids=frozenset({"artist-a"}),
            )
        return SimpleNamespace(constraints=constraints)

    monkeypatch.setattr(federation, "_require_signed_node_request", peer)
    monkeypatch.setattr(federation, "_require_capability", decision)
    monkeypatch.setattr(federation, "_peer_has_capability", lambda *_args: True)
    monkeypatch.setattr(federation, "_catalog_share_policy", dict)
    monkeypatch.setattr(
        federation,
        "_catalog_manifest_snapshot",
        lambda _: {
            "revision": "initial",
            "total_items": 2,
            "snapshot_sequence": 2,
        },
    )
    monkeypatch.setattr(
        federation,
        "list_federation_manifest_rows",
        lambda **_kwargs: [
            {
                "entity_type": "artist",
                "remote_entity_uid": uid,
                "title": uid,
                "genres_json": [{"raw_label": "rock", "weight": 1}],
            }
            for uid in ("artist-a", "artist-b")
        ],
    )
    monkeypatch.setattr(federation, "catalog_retention_floor", lambda: 0)
    monkeypatch.setattr(federation, "catalog_high_water_mark", lambda: 2)
    monkeypatch.setattr(
        federation,
        "list_catalog_changes",
        lambda **_kwargs: [
            {
                "sequence": index,
                "entity_type": "artist",
                "entity_uid": uid,
                "operation": "upsert",
                "payload_revision": str(index),
                "payload_json": {"title": uid, "genres": ["rock"]},
            }
            for index, uid in enumerate(("artist-a", "artist-b"), start=1)
        ],
    )

    page = asyncio.run(
        federation.catalog_manifest(object())
        if endpoint == "manifest"
        else federation.catalog_delta(object())
    )
    payloads = [
        item if endpoint == "manifest" else item["payload"] for item in page["items"]
    ]

    assert len(payloads) == 2
    assert ("genres" in payloads[0]) is (metadata_type == "artist")
    assert "genres" not in payloads[1]
    monkeypatch.setattr(
        federation,
        "_require_capability",
        lambda _peer, cap: (
            SimpleNamespace(
                constraints=GrantConstraints(
                    allowed_entity_uids=frozenset({"artist-b"})
                )
            )
            if cap == "catalog.metadata.genres"
            else decision(_peer, cap)
        ),
    )
    with pytest.raises(HTTPException) as error:
        asyncio.run(
            federation.catalog_manifest(object(), cursor=page["next_cursor"])
            if endpoint == "manifest"
            else federation.catalog_delta(object(), cursor=page["next_cursor"])
        )
    assert error.value.status_code == 410


def test_delta_empty_read_does_not_loop_on_a_concurrently_published_watermark(
    manifest_api, monkeypatch
):
    from crate.federation.catalog import encode_catalog_cursor

    monkeypatch.setattr(manifest_api, "catalog_retention_floor", lambda: 0)
    monkeypatch.setattr(manifest_api, "list_catalog_changes", lambda **_kwargs: [])
    monkeypatch.setattr(manifest_api, "catalog_high_water_mark", lambda: 6)
    cursor = encode_catalog_cursor(
        peer_uid="peer-a", mode="delta", position={"sequence": 5}
    )

    page = asyncio.run(manifest_api.catalog_delta(object(), cursor=cursor))

    assert page["items"] == []
    assert page["scanned_sequence"] == 5
    assert page["has_more"] is False

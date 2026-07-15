from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest
from starlette.requests import Request


def test_signed_user_assertion_round_trip_and_tamper_rejection():
    from crate.federation.assertions import (
        build_assertion,
        sign_assertion,
        verify_signed_assertion,
    )
    from crate.federation.identity import (
        generate_ed25519_key_pair,
        public_key_to_base64,
    )

    private_key, public_key = generate_ed25519_key_pair()
    assertion = build_assertion(
        issuer_node_uid="node-a",
        audience_node_uid="node-b",
        subject_hash="subject-123",
        purpose="catalog.search",
        capabilities=["federation.catalog.search"],
    )

    token = sign_assertion(assertion, private_key, key_id="k1")
    verified = verify_signed_assertion(
        token,
        public_keys=[
            {
                "key_id": "k1",
                "algorithm": "ed25519",
                "public_key": public_key_to_base64(public_key),
                "status": "active",
            }
        ],
        expected_audience="node-b",
        expected_purpose="catalog.search",
        required_capability="federation.catalog.search",
    )

    assert verified["sub"] == "subject-123"

    version, key_id, payload, signature = token.split(".")
    replacement = "A" if payload[-1] != "A" else "B"
    tampered = ".".join([version, key_id, payload[:-1] + replacement, signature])
    with pytest.raises(ValueError):
        verify_signed_assertion(
            tampered,
            public_keys=[
                {
                    "key_id": "k1",
                    "algorithm": "ed25519",
                    "public_key": public_key_to_base64(public_key),
                    "status": "active",
                }
            ],
            expected_audience="node-b",
            expected_purpose="catalog.search",
            required_capability="federation.catalog.search",
        )


def test_search_fanout_sends_signed_user_assertion(monkeypatch):
    from crate.federation import search_fanout

    captured: dict[str, object] = {}

    class Response:
        status_code = 200

        def json(self):
            return {"artists": [], "albums": [], "tracks": []}

    def fake_federated_post(**kwargs):
        captured.update(kwargs)
        return Response()

    monkeypatch.setattr(search_fanout, "federated_post", fake_federated_post)
    monkeypatch.setattr(
        "crate.federation.assertions.build_outbound_user_assertion",
        lambda local_node, peer, user, purpose, capabilities, ttl=None: (
            "assertion-token"
        ),
    )

    result = search_fanout._search_one_peer(
        peer={
            "node_uid": "node-b",
            "display_name": "Node B",
            "api_base_url": "https://node-b.test",
            "default_grant_preset": "catalog",
        },
        query="high vis",
        limit=10,
        local_node={
            "node_uid": "node-a",
            "active_key_id": "k1",
            "private_key_ref": "federation/keys/k1.pem",
        },
        user={"id": 7, "role": "user"},
    )

    assert result == {"artists": [], "albums": [], "tracks": []}
    assert captured["user_assertion"] == "assertion-token"


def test_catalog_sync_worker_treats_standalone_as_one_node_network(monkeypatch):
    from crate.worker_handlers import federation

    monkeypatch.setattr(federation.repo, "list_peers", lambda **kwargs: [])

    result = federation._handle_catalog_sync("task-1", {}, {})

    assert result == {"peers": 0, "synced": 0, "results": []}


def test_projector_refreshes_ops_for_federation_catalog_events(monkeypatch):
    from crate import projector

    calls = {"ops": [], "home": [], "processed": []}
    monkeypatch.setattr(
        projector,
        "list_domain_events",
        lambda limit, unprocessed_only=True: [
            {
                "id": "1682349000100-0",
                "event_type": "federation.catalog.synced",
                "scope": "federation.catalog",
                "subject_key": "node-b",
                "payload_json": {"node_uid": "node-b", "items": 42},
            }
        ],
    )
    monkeypatch.setattr(
        projector,
        "get_cached_ops_snapshot",
        lambda fresh=False: calls["ops"].append(fresh) or {"status": {}},
    )
    monkeypatch.setattr(
        projector,
        "get_cached_home_discovery",
        lambda user_id, fresh=False: calls["home"].append((user_id, fresh)) or {},
    )
    monkeypatch.setattr(
        projector,
        "mark_domain_events_processed",
        lambda event_ids: calls["processed"].append(event_ids),
    )

    result = projector.process_domain_events(limit=10)

    assert result == {"processed": 1, "ops_refreshes": 1, "home_refreshes": 0}
    assert calls["ops"] == [True]
    assert calls["processed"] == [["1682349000100-0"]]


def test_catalog_share_policy_filters_non_federated_rows():
    from crate.api.federation import _catalog_policy_allows_item

    policy = {"catalog_filter": {"share_scope": "federated"}}

    assert _catalog_policy_allows_item(
        {"remote_entity_uid": "album-1", "_share_scope": "federated"}, policy
    )
    assert not _catalog_policy_allows_item(
        {"remote_entity_uid": "album-2", "_share_scope": "library"}, policy
    )


def test_node_to_node_track_detail_route_is_registered(monkeypatch):
    monkeypatch.setenv("CRATE_FEDERATION_ENABLED", "false")

    from crate.api import create_app

    app = create_app()
    paths = app.openapi()["paths"]

    assert "/api/federation/v1/tracks/{remote_entity_uid}" in paths


def test_signed_directory_manifest_requires_valid_signature():
    from crate.federation.directory import (
        build_community_manifest,
        sign_community_manifest,
        validate_signed_manifest,
    )
    from crate.federation.identity import (
        generate_ed25519_key_pair,
        public_key_to_base64,
    )

    private_key, public_key = generate_ed25519_key_pair()
    manifest = build_community_manifest(
        [
            {
                "node_uid": "11111111-1111-1111-1111-111111111111",
                "name": "Node 1",
                "api_base_url": "https://node1.example.test",
            }
        ]
    )
    trusted_keys = [
        {
            "key_id": "dir-key",
            "algorithm": "ed25519",
            "public_key": public_key_to_base64(public_key),
            "status": "active",
        }
    ]

    assert not validate_signed_manifest(manifest, trusted_keys)

    signed = sign_community_manifest(manifest, private_key, key_id="dir-key")
    assert validate_signed_manifest(signed, trusted_keys)

    signed["nodes"][0]["api_base_url"] = "https://evil.example.test"
    assert not validate_signed_manifest(signed, trusted_keys)


def _stream_request(headers: dict[str, str] | None = None) -> Request:
    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    scope = {
        "type": "http",
        "method": "GET",
        "scheme": "https",
        "path": "/api/federation/remote/streams/local-ticket",
        "query_string": b"",
        "headers": [
            (name.lower().encode("latin-1"), value.encode("latin-1"))
            for name, value in (headers or {}).items()
        ],
        "server": ("api.test.net", 443),
        "client": ("127.0.0.1", 12345),
        "app": type("App", (), {"state": type("State", (), {"redis": object()})()})(),
    }
    return Request(scope, receive)


def _install_prepared_stream(monkeypatch, federation_remote) -> None:
    monkeypatch.setattr(
        federation_remote,
        "prepare_outbound_resource",
        lambda base_url, candidate: SimpleNamespace(
            external_url=f"{base_url}{candidate}",
            connection_url=f"{base_url}{candidate}",
            host_header="node-b.test",
            sni_hostname="node-b.test",
        ),
    )


def _install_proxy_stream_mocks(
    monkeypatch,
    *,
    status_code: int = 200,
    headers: dict[str, str] | None = None,
    chunks: tuple[bytes, ...] = (b"abc",),
    send_error: Exception | None = None,
    chunk_error: Exception | None = None,
) -> dict[str, object]:
    from crate.api import federation_remote
    from crate.federation import quotas, stream_proxy

    calls: dict[str, object] = {"bytes": [], "released": [], "audit": []}

    upstream_status_code = status_code
    upstream_headers = headers or {"content-type": "audio/mpeg"}

    class Upstream:
        status_code = upstream_status_code
        headers = upstream_headers

        async def aiter_bytes(self, chunk_size: int):
            del chunk_size
            for chunk in chunks:
                yield chunk
            if chunk_error:
                raise chunk_error

        async def aclose(self):
            calls["upstream_closed"] = True

    class Client:
        def __init__(self, *args, **kwargs):
            pass

        def build_request(self, method, url, headers, **kwargs):
            del kwargs
            calls["upstream_request"] = (method, url, headers)
            return object()

        async def send(self, request, stream):
            del request, stream
            if send_error:
                raise send_error
            return Upstream()

        async def aclose(self):
            calls["client_closed"] = True

    monkeypatch.setattr(federation_remote, "_require_auth", lambda request: {"id": 7})
    monkeypatch.setattr(
        federation_remote.repo,
        "get_peer",
        lambda uid: {
            "node_uid": uid,
            "display_name": "Node B",
            "api_base_url": "https://node-b.test",
            "trust_state": "approved",
            "disabled_at": None,
        },
    )
    monkeypatch.setattr(
        federation_remote.repo,
        "get_local_node",
        lambda: {
            "node_uid": "node-a",
            "active_key_id": "k1",
            "private_key_ref": "federation/keys/k1.pem",
        },
    )
    monkeypatch.setattr(
        federation_remote.repo,
        "record_audit_event",
        lambda **kwargs: calls["audit"].append(kwargs),
    )
    monkeypatch.setattr(
        stream_proxy,
        "validate_ticket",
        lambda uid: {
            "ticket_uid": uid,
            "node_uid": "node-b",
            "remote_entity_uid": "remote-ticket",
            "subject_hash": "subject-1",
        },
    )
    monkeypatch.setattr(quotas, "check_byte_quota", lambda *args: (True, None))
    monkeypatch.setattr(
        quotas, "acquire_stream_slot", lambda *args: (True, None, "stream-1")
    )
    monkeypatch.setattr(
        quotas,
        "record_bytes_sent",
        lambda redis, node_uid, count, subject_hash=None: calls["bytes"].append(
            (node_uid, count, subject_hash)
        ),
    )
    monkeypatch.setattr(
        quotas,
        "release_stream_slot",
        lambda redis, node_uid, subject_hash, stream_id: calls["released"].append(
            (node_uid, subject_hash, stream_id)
        ),
    )
    monkeypatch.setattr(
        federation_remote,
        "build_signed_headers",
        lambda **kwargs: {"X-Crate-Node-Id": kwargs["node_id"]},
    )
    monkeypatch.setattr(federation_remote.httpx, "AsyncClient", Client)
    _install_prepared_stream(monkeypatch, federation_remote)
    return calls


def test_proxy_remote_stream_preserves_206_headers_and_accounts_bytes(monkeypatch):
    from crate.api import federation_remote
    from crate.federation import quotas, stream_proxy

    calls: dict[str, object] = {"bytes": [], "released": [], "audit": []}

    class Upstream:
        status_code = 206
        headers = {
            "content-type": "audio/flac",
            "content-range": "bytes 0-5/12",
            "accept-ranges": "bytes",
            "connection": "keep-alive",
            "etag": '"abc"',
        }

        async def aiter_bytes(self, chunk_size: int):
            del chunk_size
            yield b"abc"
            yield b"def"

        async def aclose(self):
            calls["upstream_closed"] = True

    class Client:
        def __init__(self, *args, **kwargs):
            pass

        def build_request(self, method, url, headers, **kwargs):
            del kwargs
            calls["upstream_request"] = (method, url, headers)
            return object()

        async def send(self, request, stream):
            del request, stream
            return Upstream()

        async def aclose(self):
            calls["client_closed"] = True

    monkeypatch.setattr(federation_remote, "_require_auth", lambda request: {"id": 7})
    monkeypatch.setattr(
        federation_remote.repo,
        "get_peer",
        lambda uid: {
            "node_uid": uid,
            "display_name": "Node B",
            "api_base_url": "https://node-b.test",
            "trust_state": "approved",
            "disabled_at": None,
        },
    )
    monkeypatch.setattr(
        federation_remote.repo,
        "get_local_node",
        lambda: {
            "node_uid": "node-a",
            "active_key_id": "k1",
            "private_key_ref": "federation/keys/k1.pem",
        },
    )
    monkeypatch.setattr(
        federation_remote.repo,
        "record_audit_event",
        lambda **kwargs: calls["audit"].append(kwargs),
    )
    monkeypatch.setattr(
        stream_proxy,
        "validate_ticket",
        lambda uid: {
            "ticket_uid": uid,
            "node_uid": "node-b",
            "remote_entity_uid": "remote-ticket",
            "subject_hash": "subject-1",
        },
    )
    monkeypatch.setattr(quotas, "check_byte_quota", lambda *args: (True, None))
    monkeypatch.setattr(
        quotas, "acquire_stream_slot", lambda *args: (True, None, "stream-1")
    )
    monkeypatch.setattr(
        quotas,
        "record_bytes_sent",
        lambda redis, node_uid, count, subject_hash=None: calls["bytes"].append(
            (node_uid, count, subject_hash)
        ),
    )
    monkeypatch.setattr(
        quotas,
        "release_stream_slot",
        lambda redis, node_uid, subject_hash, stream_id: calls["released"].append(
            (node_uid, subject_hash, stream_id)
        ),
    )
    monkeypatch.setattr(
        federation_remote,
        "build_signed_headers",
        lambda **kwargs: {"X-Crate-Node-Id": kwargs["node_id"]},
    )
    monkeypatch.setattr(federation_remote.httpx, "AsyncClient", Client)
    _install_prepared_stream(monkeypatch, federation_remote)

    async def run():
        response = await federation_remote.proxy_remote_stream(
            "local-ticket",
            _stream_request({"Range": "bytes=0-5", "Cookie": "secret=1"}),
        )
        body = b"".join([chunk async for chunk in response.body_iterator])
        return response, body

    response, body = asyncio.run(run())

    assert response.status_code == 206
    assert body == b"abcdef"
    assert response.headers["content-range"] == "bytes 0-5/12"
    assert response.headers["etag"] == '"abc"'
    assert "connection" not in response.headers
    assert calls["bytes"] == [("node-b", 6, "subject-1")]
    assert calls["released"] == [("node-b", "subject-1", "stream-1")]
    assert calls["audit"][-1]["event_type"] == "stream.proxy.completed"


def test_proxy_remote_stream_records_midstream_failure_and_releases_slot(monkeypatch):
    from crate.api import federation_remote
    from crate.federation import quotas, stream_proxy

    calls: dict[str, object] = {"released": [], "audit": []}

    class Upstream:
        status_code = 200
        headers = {"content-type": "audio/mpeg"}

        async def aiter_bytes(self, chunk_size: int):
            del chunk_size
            yield b"abc"
            raise RuntimeError("upstream disconnected")

        async def aclose(self):
            calls["upstream_closed"] = True

    class Client:
        def __init__(self, *args, **kwargs):
            pass

        def build_request(self, method, url, headers, **kwargs):
            del method, url, headers, kwargs
            return object()

        async def send(self, request, stream):
            del request, stream
            return Upstream()

        async def aclose(self):
            calls["client_closed"] = True

    monkeypatch.setattr(federation_remote, "_require_auth", lambda request: {"id": 7})
    monkeypatch.setattr(
        federation_remote.repo,
        "get_peer",
        lambda uid: {
            "node_uid": uid,
            "display_name": "Node B",
            "api_base_url": "https://node-b.test",
            "trust_state": "approved",
            "disabled_at": None,
        },
    )
    monkeypatch.setattr(
        federation_remote.repo,
        "get_local_node",
        lambda: {
            "node_uid": "node-a",
            "active_key_id": "k1",
            "private_key_ref": "federation/keys/k1.pem",
        },
    )
    monkeypatch.setattr(
        federation_remote.repo,
        "record_audit_event",
        lambda **kwargs: calls["audit"].append(kwargs),
    )
    monkeypatch.setattr(
        stream_proxy,
        "validate_ticket",
        lambda uid: {
            "ticket_uid": uid,
            "node_uid": "node-b",
            "remote_entity_uid": "remote-ticket",
            "subject_hash": "subject-1",
        },
    )
    monkeypatch.setattr(quotas, "check_byte_quota", lambda *args: (True, None))
    monkeypatch.setattr(
        quotas, "acquire_stream_slot", lambda *args: (True, None, "stream-1")
    )
    monkeypatch.setattr(quotas, "record_bytes_sent", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        quotas,
        "release_stream_slot",
        lambda redis, node_uid, subject_hash, stream_id: calls["released"].append(
            (node_uid, subject_hash, stream_id)
        ),
    )
    monkeypatch.setattr(
        federation_remote,
        "build_signed_headers",
        lambda **kwargs: {"X-Crate-Node-Id": kwargs["node_id"]},
    )
    monkeypatch.setattr(federation_remote.httpx, "AsyncClient", Client)
    _install_prepared_stream(monkeypatch, federation_remote)

    async def run():
        response = await federation_remote.proxy_remote_stream(
            "local-ticket",
            _stream_request(),
        )
        return b"".join([chunk async for chunk in response.body_iterator])

    assert asyncio.run(run()) == b"abc"
    assert calls["released"] == [("node-b", "subject-1", "stream-1")]
    assert calls["audit"][-1]["event_type"] == "stream.proxy.failed"


def test_proxy_remote_stream_returns_upstream_416_and_releases_slot(monkeypatch):
    from fastapi import HTTPException

    from crate.api import federation_remote

    calls = _install_proxy_stream_mocks(
        monkeypatch,
        status_code=416,
        headers={"content-type": "text/plain", "content-range": "bytes */12"},
        chunks=(),
    )

    async def run():
        return await federation_remote.proxy_remote_stream(
            "local-ticket",
            _stream_request({"Range": "bytes=100-200"}),
        )

    with pytest.raises(HTTPException) as exc:
        asyncio.run(run())

    assert exc.value.status_code == 416
    assert calls["released"] == [("node-b", "subject-1", "stream-1")]
    assert calls["audit"][-1]["event_type"] == "stream.proxy.failed"
    assert calls["audit"][-1]["metadata"]["upstream_status"] == 416


def test_proxy_remote_stream_timeout_before_headers_releases_slot(monkeypatch):
    from fastapi import HTTPException
    import httpx

    from crate.api import federation_remote

    calls = _install_proxy_stream_mocks(
        monkeypatch,
        send_error=httpx.TimeoutException("upstream timed out"),
    )

    async def run():
        return await federation_remote.proxy_remote_stream(
            "local-ticket",
            _stream_request(),
        )

    with pytest.raises(HTTPException) as exc:
        asyncio.run(run())

    assert exc.value.status_code == 502
    assert calls["released"] == [("node-b", "subject-1", "stream-1")]
    assert calls["audit"][-1]["event_type"] == "stream.proxy.failed"


def test_proxy_remote_stream_downstream_close_releases_slot(monkeypatch):
    from crate.api import federation_remote

    calls = _install_proxy_stream_mocks(
        monkeypatch,
        status_code=200,
        chunks=(b"abc", b"def"),
    )

    async def run():
        response = await federation_remote.proxy_remote_stream(
            "local-ticket",
            _stream_request(),
        )
        first = await anext(response.body_iterator)
        await response.body_iterator.aclose()
        return first

    assert asyncio.run(run()) == b"abc"
    assert calls["released"] == [("node-b", "subject-1", "stream-1")]


def test_playlist_add_tracks_rejects_non_imported_remote_refs(monkeypatch):
    from fastapi import HTTPException

    from crate.api import playlists
    from crate.api.schemas.playlists import AddTracksRequest

    called = {"add": False}
    monkeypatch.setattr(playlists, "_require_auth", lambda request: {"id": 7})
    monkeypatch.setattr(
        playlists, "get_playlist", lambda playlist_id: {"id": playlist_id}
    )
    monkeypatch.setattr(playlists, "can_edit_playlist", lambda playlist, user_id: True)
    monkeypatch.setattr(
        playlists,
        "add_playlist_tracks",
        lambda playlist_id, tracks: called.update(add=True) or len(tracks),
    )

    body = AddTracksRequest(
        tracks=[
            {
                "origin": "remote",
                "node_uid": "node-b",
                "remote_entity_uid": "track-1",
                "title": "Remote Track",
            }
        ]
    )

    with pytest.raises(HTTPException) as exc:
        playlists.add_tracks(object(), 42, body)

    assert exc.value.status_code == 422
    assert called["add"] is False


def test_worker_registry_uses_real_federation_import_album_handler():
    from crate.worker import TASK_HANDLERS
    from crate.worker_handlers.federation import _handle_federation_import

    assert TASK_HANDLERS["federation_import_album"] is _handle_federation_import


def test_catalog_sync_accepts_manifest_item_list(monkeypatch):
    from crate.worker_handlers.federation import _handle_catalog_sync

    upserts: list[dict] = []
    cursors: list[tuple[str, str]] = []

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "revision": "rev-list",
                "page": 0,
                "page_size": 100,
                "items": [
                    {
                        "entity_type": "artist",
                        "remote_entity_uid": "artist-1",
                        "title": "High Vis",
                    },
                    {
                        "entity_type": "album",
                        "remote_entity_uid": "album-1",
                        "title": "Blending",
                        "artist": "High Vis",
                        "year": "2022",
                    },
                    {
                        "entity_type": "track",
                        "remote_entity_uid": "track-1",
                        "title": "Talk For Hours",
                        "artist": "High Vis",
                        "album": "Blending",
                        "duration_seconds": 180.4,
                    },
                ],
            }

    monkeypatch.setattr(
        "crate.db.repositories.federation.get_peer",
        lambda node_uid: {
            "node_uid": node_uid,
            "api_base_url": "https://peer.test",
        },
    )
    monkeypatch.setattr(
        "crate.db.repositories.federation.get_local_node",
        lambda: {
            "node_uid": "local",
            "active_key_id": "key-1",
            "private_key_ref": "federation/keys/key-1.pem",
        },
    )
    monkeypatch.setattr(
        "crate.federation.client.federated_get", lambda **kwargs: Response()
    )
    monkeypatch.setattr(
        "crate.federation.catalog.upsert_catalog_item",
        lambda **kwargs: upserts.append(kwargs),
    )
    monkeypatch.setattr(
        "crate.federation.catalog.upsert_cursor",
        lambda node_uid, cursor: cursors.append((node_uid, cursor)),
    )
    monkeypatch.setattr(
        "crate.federation.catalog.tombstone_catalog_items_missing_from_revision",
        lambda *_args, **_kwargs: 0,
    )
    monkeypatch.setattr(
        "crate.federation.events.emit_catalog_sync_completed",
        lambda *args, **kwargs: None,
    )

    result = _handle_catalog_sync("task-1", {"node_uid": "node-b"}, {})

    assert result["synced"] == 3
    assert [item["entity_type"] for item in upserts] == ["artist", "album", "track"]
    assert cursors == [("node-b", "rev-list")]


def test_catalog_sync_consumes_every_manifest_page_without_implicit_cap(monkeypatch):
    from urllib.parse import parse_qs, urlsplit

    from crate.worker_handlers.federation import _handle_catalog_sync

    requested_pages: list[int] = []
    completed: list[tuple[str, int, str]] = []
    pruned: list[tuple[str, str]] = []

    class Response:
        def __init__(self, page: int):
            self.page = page

        def raise_for_status(self):
            return None

        def json(self):
            return {
                "revision": "rev-12-pages",
                "page": self.page,
                "page_size": 1,
                "total_pages": 12,
                "items": [
                    {
                        "entity_type": "artist",
                        "remote_entity_uid": f"artist-{self.page}",
                        "title": f"Artist {self.page}",
                    }
                ],
            }

    monkeypatch.setattr(
        "crate.db.repositories.federation.get_peer",
        lambda node_uid: {"node_uid": node_uid, "api_base_url": "https://peer.test"},
    )
    monkeypatch.setattr(
        "crate.db.repositories.federation.get_local_node",
        lambda: {
            "node_uid": "local",
            "active_key_id": "key-1",
            "private_key_ref": "federation/keys/key-1.pem",
        },
    )

    def federated_get(**kwargs):
        page = int(parse_qs(urlsplit(kwargs["path"]).query)["page"][0])
        requested_pages.append(page)
        return Response(page)

    monkeypatch.setattr("crate.federation.client.federated_get", federated_get)
    monkeypatch.setattr(
        "crate.federation.catalog.upsert_catalog_item", lambda **_kwargs: None
    )
    monkeypatch.setattr(
        "crate.federation.catalog.upsert_cursor", lambda *_args, **_kwargs: None
    )
    monkeypatch.setattr(
        "crate.federation.catalog.save_catalog_sync_checkpoint",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        "crate.federation.catalog.tombstone_catalog_items_missing_from_revision",
        lambda node_uid, revision: pruned.append((node_uid, revision)) or 0,
    )
    monkeypatch.setattr(
        "crate.federation.events.emit_catalog_sync_completed",
        lambda node_uid, count, revision: completed.append((node_uid, count, revision)),
    )

    result = _handle_catalog_sync("task-1", {"node_uid": "node-b", "page_size": 1}, {})

    assert requested_pages == list(range(12))
    assert result["synced"] == 12
    assert result["pages"] == 12
    assert result["status"] == "completed"
    assert completed == [("node-b", 12, "rev-12-pages")]
    assert pruned == [("node-b", "rev-12-pages")]


def test_catalog_sync_partial_failure_is_not_marked_completed(monkeypatch):
    from crate.worker_handlers.federation import _handle_catalog_sync

    calls = {"request": 0, "cursor": 0, "completed": 0, "failed": 0}

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "revision": "rev-partial",
                "page": 0,
                "page_size": 1,
                "total_pages": 2,
                "items": [
                    {
                        "entity_type": "artist",
                        "remote_entity_uid": "artist-1",
                        "title": "High Vis",
                    }
                ],
            }

    monkeypatch.setattr(
        "crate.db.repositories.federation.get_peer",
        lambda node_uid: {"node_uid": node_uid, "api_base_url": "https://peer.test"},
    )
    monkeypatch.setattr(
        "crate.db.repositories.federation.get_local_node",
        lambda: {
            "node_uid": "local",
            "active_key_id": "key-1",
            "private_key_ref": "federation/keys/key-1.pem",
        },
    )
    monkeypatch.setattr(
        "crate.db.repositories.federation.update_peer", lambda *_args, **_kwargs: None
    )

    def federated_get(**_kwargs):
        calls["request"] += 1
        if calls["request"] == 1:
            return Response()
        raise RuntimeError("peer disconnected")

    monkeypatch.setattr("crate.federation.client.federated_get", federated_get)
    monkeypatch.setattr(
        "crate.federation.catalog.upsert_catalog_item", lambda **_kwargs: None
    )
    monkeypatch.setattr(
        "crate.federation.catalog.upsert_cursor",
        lambda *_args, **_kwargs: calls.__setitem__("cursor", calls["cursor"] + 1),
    )
    monkeypatch.setattr(
        "crate.federation.catalog.save_catalog_sync_checkpoint",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        "crate.federation.events.emit_catalog_sync_completed",
        lambda *_args, **_kwargs: calls.__setitem__(
            "completed", calls["completed"] + 1
        ),
    )
    monkeypatch.setattr(
        "crate.federation.events.emit_catalog_sync_failed",
        lambda *_args, **_kwargs: calls.__setitem__("failed", calls["failed"] + 1),
    )

    result = _handle_catalog_sync("task-1", {"node_uid": "node-b", "page_size": 1}, {})

    assert result["status"] == "failed"
    assert result["synced"] == 1
    assert result["error"] == "peer disconnected"
    assert calls == {"request": 2, "cursor": 0, "completed": 0, "failed": 1}


def test_catalog_sync_resumes_a_matching_partial_manifest(monkeypatch):
    import json
    from urllib.parse import parse_qs, urlsplit

    from crate.worker_handlers.federation import _handle_catalog_sync

    requested_pages: list[int] = []

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "revision": "rev-resume",
                "page": 3,
                "page_size": 1,
                "total_items": 4,
                "total_pages": 4,
                "items": [
                    {
                        "entity_type": "artist",
                        "remote_entity_uid": "artist-3",
                        "title": "Artist 3",
                    }
                ],
            }

    monkeypatch.setattr(
        "crate.db.repositories.federation.get_peer",
        lambda node_uid: {"node_uid": node_uid, "api_base_url": "https://peer.test"},
    )
    monkeypatch.setattr(
        "crate.db.repositories.federation.get_local_node",
        lambda: {
            "node_uid": "local",
            "active_key_id": "key-1",
            "private_key_ref": "federation/keys/key-1.pem",
        },
    )
    monkeypatch.setattr(
        "crate.federation.catalog.get_cursor",
        lambda _node_uid: {
            "cursor": json.dumps(
                {
                    "status": "partial",
                    "revision": "rev-resume",
                    "next_page": 3,
                    "page_size": 1,
                    "synced": 3,
                }
            )
        },
    )

    def federated_get(**kwargs):
        requested_pages.append(int(parse_qs(urlsplit(kwargs["path"]).query)["page"][0]))
        return Response()

    monkeypatch.setattr("crate.federation.client.federated_get", federated_get)
    monkeypatch.setattr(
        "crate.federation.catalog.upsert_catalog_item", lambda **_kwargs: None
    )
    monkeypatch.setattr(
        "crate.federation.catalog.save_catalog_sync_checkpoint",
        lambda *_args, **_kwargs: None,
        raising=False,
    )
    monkeypatch.setattr(
        "crate.federation.catalog.tombstone_catalog_items_missing_from_revision",
        lambda *_args, **_kwargs: 0,
    )
    monkeypatch.setattr(
        "crate.federation.catalog.upsert_cursor", lambda *_args, **_kwargs: None
    )
    monkeypatch.setattr(
        "crate.federation.events.emit_catalog_sync_completed",
        lambda *_args, **_kwargs: None,
    )

    result = _handle_catalog_sync("task-1", {"node_uid": "node-b", "page_size": 1}, {})

    assert requested_pages == [3]
    assert result["synced"] == 4
    assert result["status"] == "completed"


def test_catalog_sync_without_node_uid_iterates_approved_peers(monkeypatch):
    from crate.worker_handlers import federation as federation_handlers

    synced: list[str] = []

    monkeypatch.setattr(
        federation_handlers.repo,
        "list_peers",
        lambda trust_state=None: [
            {"node_uid": "node-a", "disabled_at": None},
            {"node_uid": "node-b", "disabled_at": "2026-01-01T00:00:00Z"},
            {"node_uid": "node-c", "disabled_at": None},
        ],
    )
    monkeypatch.setattr(
        federation_handlers,
        "_sync_single_peer_catalog",
        lambda node_uid, params: (
            synced.append(node_uid) or {"synced": 2, "revision": f"rev-{node_uid}"}
        ),
    )

    result = federation_handlers._handle_catalog_sync("task-1", {}, {})

    assert synced == ["node-a", "node-c"]
    assert result["peers"] == 2
    assert result["synced"] == 4


def test_remote_stream_slot_limits_allow_browser_overlap(monkeypatch):
    from crate.api.federation_remote import _stream_slot_limits

    monkeypatch.setattr(
        "crate.federation.grants.resolve_preset",
        lambda preset: {"constraints": {"max_concurrent_streams": 1}},
    )

    peer_limit, subject_limit = _stream_slot_limits(
        {"default_grant_preset": "trusted_library"}
    )

    assert subject_limit == 2
    assert peer_limit >= subject_limit


def test_catalog_sync_invalidates_cached_remote_facets(monkeypatch):
    from crate.worker_handlers.federation import _handle_catalog_sync

    invalidations: list[tuple[str, str | None]] = []

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "revision": "rev-next",
                "page": 0,
                "total_pages": 1,
                "items": [
                    {
                        "entity_type": "artist",
                        "remote_entity_uid": "artist-remote-1",
                        "title": "Birds In Row",
                        "facets": {
                            "artist_info": {
                                "available": True,
                                "revision": "rev-next",
                            }
                        },
                    },
                ],
            }

    monkeypatch.setattr(
        "crate.db.repositories.federation.get_peer",
        lambda node_uid: {
            "node_uid": node_uid,
            "api_base_url": "https://peer.test",
        },
    )
    monkeypatch.setattr(
        "crate.db.repositories.federation.get_local_node",
        lambda: {
            "node_uid": "local",
            "active_key_id": "key-1",
            "private_key_ref": "federation/keys/key-1.pem",
        },
    )
    monkeypatch.setattr(
        "crate.federation.client.federated_get",
        lambda **kwargs: Response(),
    )
    monkeypatch.setattr(
        "crate.federation.catalog.upsert_catalog_item",
        lambda **kwargs: None,
    )
    monkeypatch.setattr(
        "crate.federation.catalog.upsert_cursor",
        lambda node_uid, cursor: None,
    )
    monkeypatch.setattr(
        "crate.federation.catalog.tombstone_catalog_items_missing_from_revision",
        lambda *_args, **_kwargs: 0,
    )
    monkeypatch.setattr(
        "crate.federation.events.emit_catalog_sync_completed",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(
        "crate.federation.global_content_cache.invalidate_source_cache",
        lambda node_uid, remote_entity_uid=None: (
            invalidations.append((node_uid, remote_entity_uid)) or 1
        ),
    )

    result = _handle_catalog_sync("task-1", {"node_uid": "node-b"}, {})

    assert result["synced"] == 1
    assert invalidations == [("node-b", "artist-remote-1")]


def test_federation_event_emitters_append_domain_events(monkeypatch):
    from crate.federation.events import emit_catalog_sync_completed

    events: list[dict] = []

    monkeypatch.setattr(
        "crate.db.domain_events.append_domain_event",
        lambda event_type, payload, **kwargs: (
            events.append({"event_type": event_type, "payload": payload, **kwargs}) or 1
        ),
    )

    emit_catalog_sync_completed("node-b", 3, "rev-1")

    assert events == [
        {
            "event_type": "federation.catalog.sync.completed",
            "payload": {
                "node_uid": "node-b",
                "items_synced": 3,
                "revision": "rev-1",
                "completed_at": events[0]["payload"]["completed_at"],
            },
            "scope": "federation",
            "subject_key": "node-b",
        }
    ]

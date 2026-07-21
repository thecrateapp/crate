from __future__ import annotations

import asyncio
import json
import uuid
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from starlette.requests import Request
from starlette.responses import Response


class _FakeRedis:
    def __init__(self) -> None:
        self._keys: set[str] = set()

    def set(self, key: str, value: str, *, nx: bool = False, ex: int | None = None):
        if nx and key in self._keys:
            return False
        self._keys.add(key)
        return True


def _request_with_body(
    method: str,
    path: str,
    body: bytes,
    headers: dict[str, str],
) -> Request:
    sent = False

    async def receive():
        nonlocal sent
        if sent:
            return {"type": "http.request", "body": b"", "more_body": False}
        sent = True
        return {"type": "http.request", "body": body, "more_body": False}

    scope = {
        "type": "http",
        "method": method,
        "scheme": "https",
        "path": path,
        "query_string": b"",
        "headers": [
            (name.lower().encode("latin-1"), value.encode("latin-1"))
            for name, value in headers.items()
        ],
        "server": ("api.test.net", 443),
        "client": ("127.0.0.1", 12345),
        "app": SimpleNamespace(state=SimpleNamespace(redis=_FakeRedis())),
    }
    return Request(scope, receive)


def test_create_app_imports_with_federation_router_registered(monkeypatch):
    monkeypatch.setenv("CRATE_FEDERATION_ENABLED", "false")

    from crate.api import create_app

    app = create_app()

    paths = app.openapi()["paths"]
    assert "/.well-known/crate-node" in paths
    assert "/api/federation/v1/search" in paths


def test_create_app_does_not_bootstrap_federation_before_lifespan(monkeypatch):
    monkeypatch.setenv("CRATE_FEDERATION_ENABLED", "true")

    import crate.api as api

    def fail_if_called():
        raise AssertionError("Federation bootstrap must run after init_db")

    monkeypatch.setattr(api, "_bootstrap_federation_identity", fail_if_called)

    app = api.create_app()

    assert app.title == "Crate"


def test_auth_cookie_overrides_support_localhost_federation_listen(monkeypatch):
    from crate.api import auth

    monkeypatch.setenv("DOMAIN", "node-a.federation.local")
    monkeypatch.setenv("CRATE_AUTH_COOKIE_DOMAIN", "")
    monkeypatch.setenv("CRATE_AUTH_COOKIE_SECURE", "false")
    monkeypatch.setenv("CRATE_AUTH_COOKIE_SAMESITE", "lax")

    response = Response()

    auth._set_auth_cookie(response, "token", auth.COOKIE_NAME_LISTEN)

    set_cookie = response.headers["set-cookie"]
    assert "crate_session_listen=token" in set_cookie
    assert "Domain=" not in set_cookie
    assert "Secure" not in set_cookie
    assert "SameSite=lax" in set_cookie


def test_auth_cookie_defaults_remain_secure_for_real_domain(monkeypatch):
    from crate.api import auth

    monkeypatch.setenv("DOMAIN", "lespedants.org")
    monkeypatch.delenv("CRATE_AUTH_COOKIE_DOMAIN", raising=False)
    monkeypatch.delenv("CRATE_AUTH_COOKIE_SECURE", raising=False)
    monkeypatch.delenv("CRATE_AUTH_COOKIE_SAMESITE", raising=False)

    response = Response()

    auth._set_auth_cookie(response, "token")

    set_cookie = response.headers["set-cookie"]
    assert "crate_session=token" in set_cookie
    assert "Domain=.lespedants.org" in set_cookie
    assert "Secure" in set_cookie
    assert "SameSite=none" in set_cookie


def test_sanitize_base_url_blocks_private_ip_addresses():
    from crate.federation.client import _sanitize_base_url

    with pytest.raises(ValueError, match="non-public"):
        _sanitize_base_url("https://10.0.0.1:8585")


def test_remote_search_payload_strips_local_only_identifiers():
    from crate.api.federation import _strip_paths

    payload = {
        "artists": [
            {"id": 1, "entity_uid": "artist-uid", "slug": "artist", "name": "A"}
        ],
        "albums": [
            {
                "id": 2,
                "artist_id": 1,
                "entity_uid": "album-uid",
                "artist_entity_uid": "artist-uid",
                "slug": "album",
                "name": "B",
                "artist": "A",
            }
        ],
        "tracks": [
            {
                "id": 3,
                "album_id": 2,
                "artist_id": 1,
                "entity_uid": "track-uid",
                "album_entity_uid": "album-uid",
                "artist_entity_uid": "artist-uid",
                "slug": "track",
                "path": "/music/A/B/01.flac",
                "title": "T",
                "artist": "A",
                "album": "B",
            }
        ],
    }

    sanitized = _strip_paths(payload)

    for artist in sanitized["artists"]:
        assert "id" not in artist
        assert "slug" not in artist
    for album in sanitized["albums"]:
        assert "id" not in album
        assert "artist_id" not in album
        assert "slug" not in album
    for track in sanitized["tracks"]:
        assert "id" not in track
        assert "album_id" not in track
        assert "artist_id" not in track
        assert "slug" not in track
        assert "path" not in track


def test_search_response_accepts_remote_track_without_path():
    from crate.api.schemas.media import SearchResponse

    payload = SearchResponse.model_validate(
        {
            "artists": [],
            "albums": [],
            "tracks": [
                {
                    "title": "Travel by Telephone",
                    "artist": "Rival Schools",
                    "album": "United By Fate",
                    "origin": "remote",
                    "node_uid": "node-b",
                    "remote_entity_uid": "123e4567-e89b-12d3-a456-426614174000",
                }
            ],
        }
    )

    assert payload.tracks[0].path is None


def test_record_audit_event_serializes_uuid_metadata(monkeypatch):
    from crate.db.repositories import federation as repo

    captured: dict[str, object] = {}

    class _Result:
        def mappings(self):
            return self

        def one(self):
            return {"id": 1}

    class _Session:
        def execute(self, _statement, params=None):
            if params is not None and "metadata" in params:
                captured["metadata"] = params["metadata"]
            return _Result()

    class _Transaction:
        def __enter__(self):
            return _Session()

        def __exit__(self, *_exc):
            return False

    monkeypatch.setattr(repo, "transaction_scope", lambda: _Transaction())

    request_uid = uuid.uuid4()
    repo.record_audit_event(
        event_type="pairing.started",
        status="success",
        metadata={"request_uid": request_uid},
    )

    assert json.loads(captured["metadata"]) == {"request_uid": str(request_uid)}


def test_build_signed_headers_normalizes_uuid_identifiers(monkeypatch):
    from crate.federation import client

    captured: dict[str, object] = {}

    def fake_sign_request(**kwargs):
        captured.update(kwargs)
        return {
            "X-Crate-Node-Id": kwargs["node_id"],
            "X-Crate-Key-Id": kwargs["key_id"],
        }

    monkeypatch.setattr(client, "load_private_key", lambda _key_id: object())
    monkeypatch.setattr(client, "sign_request", fake_sign_request)

    node_uid = uuid.uuid4()
    key_id = uuid.uuid4()
    headers = client.build_signed_headers(
        method="GET",
        url="https://node.example/api/federation/v1/catalog/manifest",
        node_id=node_uid,
        key_id=key_id,
        private_key_ref=f"federation/keys/{key_id}.pem",
    )

    assert captured["node_id"] == str(node_uid)
    assert captured["key_id"] == str(key_id)
    assert headers["X-Crate-Node-Id"] == str(node_uid)


def test_federated_post_serializes_uuid_body(monkeypatch):
    from crate.federation import client

    captured: dict[str, object] = {}

    class _Response:
        status_code = 200
        content = b""

    class _Client:
        def __enter__(self):
            return self

        def __exit__(self, *_exc):
            return False

        def request(self, **kwargs):
            captured.update(kwargs)
            return _Response()

        def close(self):
            pass

    monkeypatch.setattr(client, "_build_client", lambda _timeout: _Client())
    monkeypatch.setattr(client, "build_signed_headers", lambda **_kwargs: {})

    node_uid = uuid.uuid4()
    client.federated_post(
        base_url="https://node.example",
        path="/api/federation/v1/stream-tickets",
        node_id="node-a",
        key_id="key-a",
        private_key_ref="federation/keys/key-a.pem",
        json_body={"requesting_node_uid": node_uid},
        policy=client.FederationURLPolicy(
            resolver=lambda host, port, **kwargs: [
                (2, 1, 6, "", ("93.184.216.34", port))
            ]
        ),
    )

    assert json.loads(captured["content"]) == {"requesting_node_uid": str(node_uid)}


def test_create_stream_ticket_accepts_uuid_peer_node_uid(monkeypatch):
    from crate.api import federation as federation_api
    from crate.db import domain_events
    from crate.federation import stream_proxy

    node_uid = uuid.uuid4()
    captured: dict[str, object] = {}

    async def fake_require_signed_node_request(_request):
        return {"node_uid": node_uid, "default_grant_preset": "trusted_library"}

    monkeypatch.setattr(
        federation_api,
        "_require_signed_node_request",
        fake_require_signed_node_request,
    )
    monkeypatch.setattr(
        federation_api,
        "_require_user_assertion",
        lambda *_args, **_kwargs: {"sub": "subject-hash"},
    )
    monkeypatch.setattr(
        federation_api,
        "_require_capability",
        lambda *_args, **_kwargs: SimpleNamespace(
            allowed=True,
            constraints=None,
            grant_uid=None,
            policy_revision=1,
        ),
    )
    monkeypatch.setattr(
        stream_proxy,
        "validate_peer_stream_grant",
        lambda _peer, _delivery_policy: (True, None),
    )

    def fake_create_ticket(**kwargs):
        captured.update(kwargs)
        return {"ticket_uid": "ticket-1", "expires_at": "2026-07-10T11:00:00Z"}

    monkeypatch.setattr(stream_proxy, "create_ticket", fake_create_ticket)
    monkeypatch.setattr(federation_api.repo, "record_audit_event", lambda **_kwargs: {})
    monkeypatch.setattr(
        domain_events, "append_domain_event", lambda *_args, **_kwargs: None
    )

    body = federation_api.StreamTicketBody(
        remote_entity_uid="track-1",
        delivery_policy="balanced",
        requesting_node_uid=str(node_uid),
    )

    result = asyncio.run(federation_api.create_stream_ticket(body, object()))

    assert captured["node_uid"] == str(node_uid)
    assert result["ticket_uid"] == "ticket-1"


def test_indexed_federated_search_normalizes_album_contract(monkeypatch):
    from crate.federation import catalog, search_fanout

    node_uid = uuid.uuid4()

    def fake_search_federated_catalog(
        query: str,
        entity_type: str,
        limit: int = 20,
        node_uid: str | None = None,
    ):
        if entity_type == "album":
            return [
                {
                    "node_uid": node_uid,
                    "remote_entity_uid": "album-1",
                    "entity_type": "album",
                    "title": "Pedals",
                    "artist": "Rival Schools",
                    "album": "Pedals",
                    "year": "2011",
                }
            ]
        return []

    monkeypatch.setattr(
        catalog, "search_federated_catalog", fake_search_federated_catalog
    )
    monkeypatch.setattr(catalog, "is_catalog_stale", lambda _node_uid: False)

    results = search_fanout._search_local_index(
        "Pedals",
        10,
        [
            {
                "node_uid": node_uid,
                "display_name": "Node B",
                "default_grant_preset": "trusted_library",
            }
        ],
    )

    album = results[0]["albums"][0]
    assert album["name"] == "Pedals"
    assert album["node_uid"] == str(node_uid)
    assert album["availability"]["stream"] is True


def test_remote_import_endpoint_requires_import_permission(monkeypatch):
    from crate.api import federation_remote

    def fail_if_peer_lookup(_node_uid):
        raise AssertionError("permission check should run before peer lookup")

    request = SimpleNamespace(
        state=SimpleNamespace(
            user={"id": 7, "email": "listener@example.test", "role": "user"}
        )
    )
    monkeypatch.setattr(federation_remote, "_get_peer", fail_if_peer_lookup)

    with pytest.raises(HTTPException) as exc:
        federation_remote.request_remote_import(
            "node-b",
            "album-1",
            federation_remote.ImportRequestBody(title="Album", artist="Artist"),
            request,  # type: ignore[arg-type]
        )

    assert exc.value.status_code == 403


def test_remote_album_cover_proxies_artwork_with_image_options(monkeypatch):
    from crate.api import federation_remote

    captured: dict[str, object] = {}

    class _RemoteResponse:
        status_code = 200
        content = b"cover-bytes"
        headers = {
            "content-type": "image/webp",
            "cache-control": "public, max-age=3600",
        }

        def raise_for_status(self):
            return None

    def fake_federated_get(**kwargs):
        captured.update(kwargs)
        return _RemoteResponse()

    request = SimpleNamespace(
        state=SimpleNamespace(
            user={"id": 7, "email": "listener@example.test", "role": "user"}
        )
    )
    monkeypatch.setattr(
        federation_remote,
        "_get_local_node",
        lambda: {
            "node_uid": "node-a",
            "active_key_id": "key-a",
            "private_key_ref": "federation/keys/key-a.pem",
        },
    )
    monkeypatch.setattr(
        federation_remote,
        "_get_peer",
        lambda _node_uid: {
            "node_uid": "node-b",
            "api_base_url": "https://node-b.test",
            "display_name": "Node B",
            "default_grant_preset": "listen",
        },
    )
    monkeypatch.setattr(
        federation_remote,
        "_user_assertion",
        lambda *_args, **_kwargs: "assertion",
    )
    monkeypatch.setattr(federation_remote, "federated_get", fake_federated_get)

    response = federation_remote.remote_album_cover(
        "node-b",
        "album-1",
        request,  # type: ignore[arg-type]
        size=128,
        image_format="webp",
    )

    assert (
        captured["path"]
        == "/api/federation/v1/assets/album/album-1/cover?size=128&format=webp"
    )
    assert response.body == b"cover-bytes"
    assert response.headers["content-type"] == "image/webp"
    assert response.headers["cache-control"] == "public, max-age=3600"


def test_federated_artwork_serves_image_variants(tmp_path, monkeypatch):
    from PIL import Image

    from crate.api import federation as federation_api

    cover = BytesIO()
    Image.new("RGB", (64, 64), (18, 52, 86)).save(cover, format="PNG")
    (tmp_path / "cover.png").write_bytes(cover.getvalue())
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    from crate.artwork_materializer import materialize_artwork
    from crate.artwork_variants import ArtworkAsset

    materialize_artwork(ArtworkAsset("album-cover", "album-1"), cover.getvalue())

    async def fake_require_signed_node_request(_request):
        return {"node_uid": "node-a", "default_grant_preset": "catalog"}

    monkeypatch.setattr(
        federation_api,
        "_require_signed_node_request",
        fake_require_signed_node_request,
    )
    monkeypatch.setattr(
        federation_api,
        "_require_capability",
        lambda *_args, **_kwargs: SimpleNamespace(allowed=True, constraints=None),
    )
    monkeypatch.setattr(
        federation_api, "_require_user_assertion", lambda *_args, **_kwargs: None
    )
    monkeypatch.setattr(
        "crate.db.repositories.library.get_library_album_by_entity_uid",
        lambda _remote_entity_uid: {"path": str(tmp_path)},
    )

    response = asyncio.run(
        federation_api.federated_artwork(
            "album-1",
            object(),  # type: ignore[arg-type]
            size=32,
            image_format="webp",
        )
    )

    assert response.headers["content-type"] == "image/webp"
    assert response.headers["cache-control"].startswith("public, max-age=86400")
    assert Path(response.path).is_file()


def test_federated_artist_photo_serves_sidecar_without_local_user_session(
    tmp_path, monkeypatch
):
    from PIL import Image

    from crate.api import federation as federation_api

    photo = BytesIO()
    Image.new("RGB", (64, 64), (96, 32, 128)).save(photo, format="JPEG")
    (tmp_path / "artist.jpg").write_bytes(photo.getvalue())
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    from crate.artwork_materializer import materialize_artwork
    from crate.artwork_variants import ArtworkAsset

    materialize_artwork(ArtworkAsset("artist-photo", "artist-1"), photo.getvalue())

    async def fake_require_signed_node_request(_request):
        return {"node_uid": "node-a", "default_grant_preset": "catalog"}

    monkeypatch.setattr(
        federation_api,
        "_require_signed_node_request",
        fake_require_signed_node_request,
    )
    monkeypatch.setattr(
        federation_api,
        "_require_capability",
        lambda *_args, **_kwargs: SimpleNamespace(allowed=True, constraints=None),
    )
    monkeypatch.setattr(
        federation_api, "_require_user_assertion", lambda *_args, **_kwargs: None
    )
    monkeypatch.setattr(
        federation_api, "_catalog_policy_allows_item", lambda *_args: True
    )
    monkeypatch.setattr(federation_api, "_catalog_share_policy", lambda: {})
    monkeypatch.setattr(
        "crate.db.repositories.library.get_library_artist_by_entity_uid",
        lambda _remote_entity_uid: {"name": "Rival Schools"},
    )
    monkeypatch.setattr("crate.api._deps.library_path", lambda: tmp_path)
    monkeypatch.setattr(
        "crate.storage_layout.resolve_artist_dir",
        lambda *_args, **_kwargs: tmp_path,
    )

    response = asyncio.run(
        federation_api.federated_artist_photo(
            "artist-1",
            object(),  # type: ignore[arg-type]
            size=32,
            image_format="webp",
        )
    )

    assert response.headers["content-type"] == "image/webp"
    assert response.headers["cache-control"].startswith("public, max-age=86400")
    assert Path(response.path).is_file()


def test_federated_generic_artist_background_serves_sidecar(tmp_path, monkeypatch):
    from PIL import Image

    from crate.api import federation as federation_api

    background = BytesIO()
    Image.new("RGB", (96, 64), (12, 80, 140)).save(background, format="JPEG")
    (tmp_path / "background.jpg").write_bytes(background.getvalue())
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    from crate.artwork_materializer import materialize_artwork
    from crate.artwork_variants import ArtworkAsset

    materialize_artwork(
        ArtworkAsset("artist-background", "artist-1"), background.getvalue()
    )

    async def fake_require_signed_node_request(_request):
        return {"node_uid": "node-a", "default_grant_preset": "catalog"}

    monkeypatch.setattr(
        federation_api,
        "_require_signed_node_request",
        fake_require_signed_node_request,
    )
    monkeypatch.setattr(
        federation_api,
        "_require_capability",
        lambda *_args, **_kwargs: SimpleNamespace(allowed=True, constraints=None),
    )
    monkeypatch.setattr(
        federation_api, "_require_user_assertion", lambda *_args, **_kwargs: None
    )
    monkeypatch.setattr(
        federation_api, "_catalog_policy_allows_item", lambda *_args: True
    )
    monkeypatch.setattr(federation_api, "_catalog_share_policy", lambda: {})
    monkeypatch.setattr(
        "crate.db.repositories.library.get_library_artist_by_entity_uid",
        lambda _remote_entity_uid: {"name": "High Vis"},
    )
    monkeypatch.setattr("crate.api._deps.library_path", lambda: tmp_path)
    monkeypatch.setattr(
        "crate.storage_layout.resolve_artist_dir",
        lambda *_args, **_kwargs: tmp_path,
    )

    response = asyncio.run(
        federation_api.federated_asset(
            "artist",
            "artist-1",
            "background",
            object(),  # type: ignore[arg-type]
            size=64,
            image_format="webp",
        )
    )

    assert response.headers["content-type"] == "image/webp"
    assert response.headers["cache-control"].startswith("public, max-age=86400")
    assert Path(response.path).is_file()


def test_artist_info_facet_preserves_remote_popularity_fields():
    from crate.api import federation as federation_api

    payload = federation_api._artist_info_facet(
        {
            "bio": "remote bio",
            "tags_json": ["post-hardcore"],
            "similar_json": [{"name": "Militarie Gun"}],
            "listeners": 1234,
            "lastfm_playcount": 5678,
            "image_url": "https://img.example/artist.jpg",
            "url": "https://last.fm/music/High+Vis",
        }
    )

    assert payload["bio"] == "remote bio"
    assert payload["listeners"] == 1234
    assert payload["playcount"] == 5678
    assert payload["image_url"] == "https://img.example/artist.jpg"
    assert payload["url"] == "https://last.fm/music/High+Vis"


def test_artist_info_facet_includes_public_page_intelligence(monkeypatch):
    from crate.api import federation as federation_api

    monkeypatch.setattr(
        federation_api.browse_artist_api,
        "build_public_artist_page_facet",
        lambda artist: {
            "top_tracks": [{"title": "Choose To Lose"}],
            "shows": {"events": [{"id": "show-1"}]},
            "enrichment": {"setlist": {"probable_setlist": [{"title": "On We Lose"}]}},
        },
    )

    payload = federation_api._artist_info_facet({"name": "High Vis"})

    assert payload["top_tracks"][0]["title"] == "Choose To Lose"
    assert payload["shows"]["events"][0]["id"] == "show-1"
    assert payload["enrichment"]["setlist"]["probable_setlist"][0]["title"] == (
        "On We Lose"
    )


def test_valid_signed_post_body_is_accepted(monkeypatch):
    from crate.api import federation as federation_api
    from crate.federation.identity import (
        generate_ed25519_key_pair,
        public_key_to_base64,
    )
    from crate.federation.signing import sign_request

    private_key, public_key = generate_ed25519_key_pair()
    node_uid = str(uuid.uuid4())
    key_id = "2026-07-test"
    body = b'{"q":"High Vis","limit":10}'
    headers = sign_request(
        private_key=private_key,
        method="POST",
        path_with_query="/api/federation/v1/search",
        host="api.test.net",
        content_type="application/json",
        node_id=node_uid,
        key_id=key_id,
        body=body,
    )
    request = _request_with_body("POST", "/api/federation/v1/search", body, headers)

    peer = {
        "node_uid": node_uid,
        "trust_state": "approved",
        "disabled_at": None,
        "active_key_id": key_id,
        "default_grant_preset": "catalog",
        "public_keys_json": [
            {
                "key_id": key_id,
                "algorithm": "ed25519",
                "public_key": public_key_to_base64(public_key),
                "status": "active",
            }
        ],
    }
    monkeypatch.setattr(
        federation_api.repo, "get_peer", lambda uid: peer if uid == node_uid else None
    )
    monkeypatch.setattr(
        federation_api.trust_repo,
        "get_peer_verification_key",
        lambda _node_uid, _key_id: None,
    )
    monkeypatch.setattr(
        federation_api.trust_repo,
        "list_peer_verification_keys",
        lambda _node_uid: [],
    )

    result_or_coro = federation_api._require_signed_node_request(request)
    if asyncio.iscoroutine(result_or_coro):
        result = asyncio.run(result_or_coro)
    else:
        result = result_or_coro

    assert result["node_uid"] == node_uid


def test_replayed_signed_post_nonce_is_rejected(monkeypatch):
    from crate.api import federation as federation_api
    from crate.federation.identity import (
        generate_ed25519_key_pair,
        public_key_to_base64,
    )
    from crate.federation.signing import sign_request

    private_key, public_key = generate_ed25519_key_pair()
    node_uid = str(uuid.uuid4())
    key_id = "2026-07-test"
    body = b'{"q":"High Vis","limit":10}'
    headers = sign_request(
        private_key=private_key,
        method="POST",
        path_with_query="/api/federation/v1/search",
        host="api.test.net",
        content_type="application/json",
        node_id=node_uid,
        key_id=key_id,
        body=body,
    )
    redis = _FakeRedis()

    def make_request() -> Request:
        request = _request_with_body("POST", "/api/federation/v1/search", body, headers)
        request.scope["app"].state.redis = redis
        return request

    peer = {
        "node_uid": node_uid,
        "trust_state": "approved",
        "disabled_at": None,
        "active_key_id": key_id,
        "default_grant_preset": "catalog",
        "public_keys_json": [
            {
                "key_id": key_id,
                "algorithm": "ed25519",
                "public_key": public_key_to_base64(public_key),
                "status": "active",
            }
        ],
    }
    monkeypatch.setattr(
        federation_api.repo, "get_peer", lambda uid: peer if uid == node_uid else None
    )
    monkeypatch.setattr(
        federation_api.trust_repo,
        "get_peer_verification_key",
        lambda _node_uid, _key_id: None,
    )
    monkeypatch.setattr(
        federation_api.trust_repo,
        "list_peer_verification_keys",
        lambda _node_uid: [],
    )

    first = federation_api._require_signed_node_request(make_request())
    if asyncio.iscoroutine(first):
        asyncio.run(first)

    second = federation_api._require_signed_node_request(make_request())
    with pytest.raises(HTTPException) as exc:
        if asyncio.iscoroutine(second):
            asyncio.run(second)
        else:
            second
    assert exc.value.status_code == 401
    assert "Nonce" in str(exc.value.detail)

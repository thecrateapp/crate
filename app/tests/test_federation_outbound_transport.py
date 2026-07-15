from __future__ import annotations

import socket
from datetime import datetime, timezone

import httpx
import pytest


def _public_resolver(host: str, port: int, **kwargs):
    del host, kwargs
    return [
        (
            socket.AF_INET,
            socket.SOCK_STREAM,
            socket.IPPROTO_TCP,
            "",
            ("93.184.216.34", port),
        )
    ]


def test_signed_client_connects_to_the_validated_ip_with_original_sni(monkeypatch):
    from crate.federation.client import SignedFederationClient
    from crate.federation.url_policy import FederationURLPolicy

    captured: dict[str, object] = {}

    class Client:
        def __init__(self, **kwargs):
            captured["client_kwargs"] = kwargs

        def request(self, **kwargs):
            captured["request"] = kwargs
            return httpx.Response(200, json={"ok": True})

        def close(self):
            captured["closed"] = True

    monkeypatch.setattr("crate.federation.client.httpx.Client", Client)
    client = SignedFederationClient(
        base_url="https://peer.example.test",
        node_id="node-a",
        key_id="key-a",
        private_key_ref="federation/keys/key-a.pem",
        policy=FederationURLPolicy(resolver=_public_resolver),
    )
    monkeypatch.setattr(
        "crate.federation.client.build_signed_headers",
        lambda **kwargs: {"Host": "peer.example.test", "X-Test": "signed"},
    )

    response = client.request("GET", "/api/federation/v1/health")
    client.close()

    assert response.status_code == 200
    request = captured["request"]
    assert request["url"] == "https://93.184.216.34/api/federation/v1/health"
    assert request["headers"]["Host"] == "peer.example.test"
    assert request["extensions"] == {"sni_hostname": "peer.example.test"}
    assert request["follow_redirects"] is False
    assert captured["client_kwargs"]["follow_redirects"] is False
    assert captured["closed"] is True


def test_signed_client_revalidates_dns_for_every_request(monkeypatch):
    from crate.federation.client import SignedFederationClient
    from crate.federation.url_policy import FederationURLPolicy

    calls = 0

    def resolver(host: str, port: int, **kwargs):
        nonlocal calls
        del host, kwargs
        calls += 1
        address = "93.184.216.34" if calls == 1 else "127.0.0.1"
        return [
            (
                socket.AF_INET,
                socket.SOCK_STREAM,
                socket.IPPROTO_TCP,
                "",
                (address, port),
            )
        ]

    class Client:
        def __init__(self, **kwargs):
            pass

        def request(self, **kwargs):
            return httpx.Response(200)

        def close(self):
            pass

    monkeypatch.setattr("crate.federation.client.httpx.Client", Client)
    monkeypatch.setattr(
        "crate.federation.client.build_signed_headers",
        lambda **kwargs: {"Host": "peer.example.test"},
    )
    client = SignedFederationClient(
        base_url="https://peer.example.test",
        node_id="node-a",
        key_id="key-a",
        private_key_ref="federation/keys/key-a.pem",
        policy=FederationURLPolicy(resolver=resolver),
    )

    with pytest.raises(ValueError, match="non-public"):
        client.request("GET", "/health")


def test_signed_client_rejects_oversized_control_plane_response(monkeypatch):
    from crate.federation.client import SignedFederationClient
    from crate.federation.url_policy import FederationURLPolicy

    class Client:
        def __init__(self, **kwargs):
            pass

        def request(self, **kwargs):
            return httpx.Response(200, content=b"x" * 11)

        def close(self):
            pass

    monkeypatch.setattr("crate.federation.client.httpx.Client", Client)
    monkeypatch.setattr(
        "crate.federation.client.build_signed_headers",
        lambda **kwargs: {"Host": "peer.example.test"},
    )
    client = SignedFederationClient(
        base_url="https://peer.example.test",
        node_id="node-a",
        key_id="key-a",
        private_key_ref="federation/keys/key-a.pem",
        policy=FederationURLPolicy(resolver=_public_resolver),
        max_response_bytes=10,
    )

    with pytest.raises(ValueError, match="response exceeded"):
        client.request("GET", "/health")


def test_peer_resource_url_is_pinned_and_cannot_change_origin():
    from crate.federation.client import prepare_outbound_resource
    from crate.federation.url_policy import FederationURLPolicy

    policy = FederationURLPolicy(resolver=_public_resolver)
    prepared = prepare_outbound_resource(
        "https://peer.example.test",
        "/api/federation/v1/streams/ticket-a",
        policy=policy,
    )

    assert prepared.external_url == (
        "https://peer.example.test/api/federation/v1/streams/ticket-a"
    )
    assert prepared.connection_url == (
        "https://93.184.216.34/api/federation/v1/streams/ticket-a"
    )
    assert prepared.host_header == "peer.example.test"
    assert prepared.sni_hostname == "peer.example.test"

    with pytest.raises(ValueError, match="origin"):
        prepare_outbound_resource(
            "https://peer.example.test",
            "https://evil.example.test/stream",
            policy=policy,
        )


def test_directory_fetch_uses_the_shared_safe_transport(monkeypatch):
    from crate.federation import directory

    calls: list[str] = []

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {"manifest_version": "1", "nodes": []}

    monkeypatch.setattr(
        directory,
        "safe_get",
        lambda url, **kwargs: calls.append(url) or Response(),
        raising=False,
    )

    assert directory.fetch_signed_community_manifest(
        "https://directory.example.test/nodes.json"
    ) == {"manifest_version": "1", "nodes": []}
    assert calls == ["https://directory.example.test/nodes.json"]


def test_unsigned_pairing_post_uses_pinned_safe_transport(monkeypatch):
    from crate.federation import client
    from crate.federation.url_policy import FederationURLPolicy

    captured: dict[str, object] = {}

    class Client:
        def __init__(self, **kwargs):
            captured["client"] = kwargs

        def request(self, **kwargs):
            captured["request"] = kwargs
            return httpx.Response(202, json={"status": "remote_pending"})

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return None

    monkeypatch.setattr(client, "_build_client", lambda timeout: Client())
    response = client.safe_post_json(
        "https://peer.example.test",
        "/api/federation/v1/pairing/offers",
        {"pairing_uid": "offer-a"},
        policy=FederationURLPolicy(resolver=_public_resolver),
    )

    assert response.status_code == 202
    assert captured["request"]["url"] == (
        "https://93.184.216.34/api/federation/v1/pairing/offers"
    )
    assert captured["request"]["headers"]["Host"] == "peer.example.test"
    assert captured["request"]["follow_redirects"] is False


def test_failed_health_poll_persists_exponential_backoff(monkeypatch):
    from crate.federation import health

    updates: list[dict] = []
    monkeypatch.setattr(health, "fetch_descriptor", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        health.repo,
        "update_peer",
        lambda node_uid, **fields: updates.append({"node_uid": node_uid, **fields}),
    )
    monkeypatch.setattr(health, "_emit_health_transition", lambda *args, **kwargs: None)

    health.poll_peer(
        {
            "node_uid": "peer-a",
            "api_base_url": "https://peer.example.test",
            "health_json": {"healthy": False, "consecutive_failures": 2},
        }
    )

    persisted = updates[0]["health_json"]
    assert persisted["healthy"] is False
    assert persisted["consecutive_failures"] == 3
    assert datetime.fromisoformat(persisted["backoff_until"]) > datetime.now(
        timezone.utc
    )


def test_successful_health_poll_resets_backoff(monkeypatch):
    from crate.federation import health

    updates: list[dict] = []
    monkeypatch.setattr(
        health, "fetch_descriptor", lambda *args, **kwargs: {"ok": True}
    )
    monkeypatch.setattr(
        health.repo,
        "update_peer",
        lambda node_uid, **fields: updates.append({"node_uid": node_uid, **fields}),
    )
    monkeypatch.setattr(health, "_emit_health_transition", lambda *args, **kwargs: None)

    health.poll_peer(
        {
            "node_uid": "peer-a",
            "api_base_url": "https://peer.example.test",
            "health_json": {
                "healthy": False,
                "consecutive_failures": 4,
                "backoff_until": "2099-01-01T00:00:00+00:00",
            },
        }
    )

    assert updates[0]["health_json"] == {
        "healthy": True,
        "latency_ms": updates[0]["health_json"]["latency_ms"],
        "consecutive_failures": 0,
        "backoff_until": None,
    }

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient


SERVICE_TOKEN = "readplane-test-service-token-32-bytes"
LOCAL_TICKET_UID = "11111111-1111-4111-8111-111111111111"
REMOTE_TICKET_UID = "22222222-2222-4222-8222-222222222222"
PEER_UID = "33333333-3333-4333-8333-333333333333"
LOCAL_NODE_UID = "44444444-4444-4444-8444-444444444444"


def _client(monkeypatch) -> TestClient:
    monkeypatch.setenv("CRATE_READPLANE_SERVICE_TOKEN", SERVICE_TOKEN)
    from crate.api.internal_federation import router

    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def _ticket() -> dict:
    return {
        "ticket_uid": LOCAL_TICKET_UID,
        "node_uid": PEER_UID,
        "remote_entity_uid": REMOTE_TICKET_UID,
        "local_user_id": 7,
        "subject_hash": "subject-hash",
        "constraints_json": {"playback_session": "playback-session"},
    }


def _local_node() -> dict:
    return {
        "node_uid": LOCAL_NODE_UID,
        "active_key_id": "key-1",
        "private_key_ref": "federation/keys/key-1.pem",
    }


def _peer() -> dict:
    return {
        "node_uid": PEER_UID,
        "api_base_url": "https://peer.example.test",
        "trust_state": "approved",
    }


def _request_body(**overrides) -> dict:
    return {
        "ticket_uid": LOCAL_TICKET_UID,
        "local_user_id": 7,
        "method": "GET",
        "request_path": f"/api/federation/remote/streams/{LOCAL_TICKET_UID}",
        "audience": "crate-readplane",
        "range": "bytes=0-1023",
        **overrides,
    }


def test_internal_signer_rejects_missing_or_wrong_service_identity(monkeypatch):
    client = _client(monkeypatch)

    assert (
        client.post(
            "/internal/federation/streams/authorize", json=_request_body()
        ).status_code
        == 401
    )
    assert (
        client.post(
            "/internal/federation/streams/authorize",
            json=_request_body(),
            headers={"X-Crate-Service-Token": "wrong"},
        ).status_code
        == 401
    )


def test_internal_signer_issues_short_lived_path_bound_material(monkeypatch):
    client = _client(monkeypatch)
    signed_headers = {
        "Host": "peer.example.test",
        "X-Crate-Node-Id": LOCAL_NODE_UID,
        "X-Crate-Key-Id": "key-1",
        "X-Crate-Timestamp": "1700000000000",
        "X-Crate-Nonce": "nonce-1",
        "X-Crate-Signature": "ed25519:test",
    }

    with (
        patch(
            "crate.api.internal_federation.stream_ticket_repo.validate_ticket",
            return_value=_ticket(),
        ) as validate_ticket,
        patch(
            "crate.api.internal_federation.federation_repo.get_local_node",
            return_value=_local_node(),
        ),
        patch(
            "crate.api.internal_federation.federation_repo.get_peer",
            return_value=_peer(),
        ),
        patch(
            "crate.api.internal_federation.prepare_outbound_resource"
        ) as prepare_resource,
        patch(
            "crate.api.internal_federation.build_signed_headers",
            return_value=signed_headers,
        ) as build_headers,
    ):
        prepare_resource.return_value.external_url = (
            f"https://peer.example.test/api/federation/v1/streams/{REMOTE_TICKET_UID}"
        )
        prepare_resource.return_value.connection_url = (
            f"https://203.0.113.10/api/federation/v1/streams/{REMOTE_TICKET_UID}"
        )
        prepare_resource.return_value.host_header = "peer.example.test"
        prepare_resource.return_value.sni_hostname = "peer.example.test"

        before = datetime.now(timezone.utc)
        response = client.post(
            "/internal/federation/streams/authorize",
            json=_request_body(),
            headers={"X-Crate-Service-Token": SERVICE_TOKEN},
        )
        after = datetime.now(timezone.utc)

    assert response.status_code == 200
    payload = response.json()
    assert payload["audience"] == "crate-readplane"
    assert payload["method"] == "GET"
    assert payload["request_path"].endswith(LOCAL_TICKET_UID)
    assert payload["external_url"].endswith(REMOTE_TICKET_UID)
    assert payload["signed_headers"]["Range"] == "bytes=0-1023"
    assert payload["signed_headers"]["X-Crate-Playback-Session"] == "playback-session"
    assert "private_key_ref" not in payload
    assert "private_key" not in str(payload).lower()
    expires_at = datetime.fromisoformat(payload["expires_at"])
    assert before.timestamp() + 10 <= expires_at.timestamp()
    assert expires_at.timestamp() <= after.timestamp() + 15.5
    validate_ticket.assert_called_once_with(
        LOCAL_TICKET_UID,
        expected_local_user_id=7,
        requested_range="bytes=0-1023",
    )
    build_headers.assert_called_once()


def test_internal_signer_binds_ticket_to_user_path_method_and_audience(monkeypatch):
    client = _client(monkeypatch)
    headers = {"X-Crate-Service-Token": SERVICE_TOKEN}

    invalid_requests = [
        _request_body(local_user_id=8),
        _request_body(method="POST"),
        _request_body(request_path="/api/federation/remote/streams/another"),
        _request_body(audience="another-service"),
    ]
    for body in invalid_requests[1:]:
        assert (
            client.post(
                "/internal/federation/streams/authorize", json=body, headers=headers
            ).status_code
            == 422
        )

    with patch(
        "crate.api.internal_federation.stream_ticket_repo.validate_ticket",
        return_value=None,
    ):
        response = client.post(
            "/internal/federation/streams/authorize",
            json=invalid_requests[0],
            headers=headers,
        )
    assert response.status_code == 410


def test_internal_signer_rejects_untrusted_peer_without_loading_key(monkeypatch):
    client = _client(monkeypatch)
    denied_peer = {**_peer(), "trust_state": "pending"}
    with (
        patch(
            "crate.api.internal_federation.stream_ticket_repo.validate_ticket",
            return_value=_ticket(),
        ),
        patch(
            "crate.api.internal_federation.federation_repo.get_local_node",
            return_value=_local_node(),
        ),
        patch(
            "crate.api.internal_federation.federation_repo.get_peer",
            return_value=denied_peer,
        ),
        patch("crate.api.internal_federation.build_signed_headers") as signer,
    ):
        response = client.post(
            "/internal/federation/streams/authorize",
            json=_request_body(),
            headers={"X-Crate-Service-Token": SERVICE_TOKEN},
        )

    assert response.status_code == 403
    signer.assert_not_called()


def test_internal_signer_requires_a_strong_configured_token(monkeypatch):
    from crate.api.internal_federation import validate_service_token_configuration

    monkeypatch.delenv("CRATE_READPLANE_SERVICE_TOKEN", raising=False)
    try:
        validate_service_token_configuration()
    except RuntimeError as exc:
        assert "CRATE_READPLANE_SERVICE_TOKEN" in str(exc)
    else:
        raise AssertionError("missing service token must fail closed")

    monkeypatch.setenv("CRATE_READPLANE_SERVICE_TOKEN", "short")
    try:
        validate_service_token_configuration()
    except RuntimeError as exc:
        assert "at least 32" in str(exc)
    else:
        raise AssertionError("weak service token must fail closed")

from __future__ import annotations


class _TicketResponse:
    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return {
            "ticket_uid": "remote-ticket-1",
            "expires_at": "2026-07-17T10:00:00Z",
            "delivery_policy": "data_saver",
        }


def test_remote_playback_forwards_the_requested_delivery_policy(monkeypatch):
    from crate.api import federation_remote
    from crate.api import permissions
    from crate.federation import client, stream_proxy
    from crate import playback_provenance

    captured: dict = {}
    monkeypatch.setattr(federation_remote, "_require_auth", lambda _request: {"id": 7})
    monkeypatch.setattr(permissions, "require_permission", lambda *_args: None)
    local_node_uid = "11111111-1111-4111-8111-111111111111"
    remote_node_uid = "22222222-2222-4222-8222-222222222222"
    monkeypatch.setattr(
        federation_remote,
        "_get_local_node",
        lambda: {
            "node_uid": local_node_uid,
            "active_key_id": "key-local",
            "private_key_ref": "env:CRATE_FEDERATION_PRIVATE_KEY",
        },
    )
    monkeypatch.setattr(
        federation_remote,
        "_get_peer",
        lambda _node_uid: {
            "node_uid": remote_node_uid,
            "api_base_url": "https://remote",
        },
    )
    monkeypatch.setattr(
        federation_remote, "_user_assertion", lambda *_args, **_kwargs: "assertion"
    )
    monkeypatch.setattr(
        playback_provenance, "issue_playback_session", lambda **_kwargs: "session-token"
    )

    def fake_federated_post(**kwargs):
        captured.update(kwargs)
        return _TicketResponse()

    monkeypatch.setattr(client, "federated_post", fake_federated_post)
    monkeypatch.setattr(
        stream_proxy,
        "create_ticket",
        lambda **kwargs: {
            "ticket_uid": "local-ticket-1",
            "expires_at": "2026-07-17T10:00:00Z",
            **kwargs,
        },
    )

    result = federation_remote.resolve_remote_playback(
        remote_node_uid,
        "remote-track-1",
        object(),
        requested_policy="data_saver",
    )

    assert captured["json_body"]["delivery_policy"] == "data_saver"
    assert result["delivery_policy"] == "data_saver"

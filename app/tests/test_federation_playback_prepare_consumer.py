from __future__ import annotations


class _PrepareResponse:
    status_code = 200

    def json(self) -> dict:
        return {
            "items": [
                {
                    "remote_entity_uid": "22222222-2222-4222-8222-222222222222",
                    "status": "preparing",
                },
                {
                    "remote_entity_uid": "33333333-3333-4333-8333-333333333333",
                    "status": "ready",
                },
            ]
        }


def test_consumer_prepares_at_most_two_tracks_on_one_owner(monkeypatch):
    from crate.federation import playback_prepare

    captured: dict = {}
    local_node = {
        "node_uid": "11111111-1111-4111-8111-111111111111",
        "active_key_id": "key-local",
        "private_key_ref": "env:CRATE_FEDERATION_PRIVATE_KEY",
    }
    peer = {
        "node_uid": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "api_base_url": "https://owner.example",
        "trust_state": "approved",
    }
    monkeypatch.setattr(
        playback_prepare.federation_repo, "get_local_node", lambda: local_node
    )
    monkeypatch.setattr(playback_prepare.federation_repo, "get_peer", lambda _uid: peer)

    def fake_assertion(**kwargs):
        captured["assertion"] = kwargs
        return "assertion"

    def fake_post(**kwargs):
        captured["request"] = kwargs
        return _PrepareResponse()

    monkeypatch.setattr(
        playback_prepare, "build_outbound_user_assertion", fake_assertion
    )
    monkeypatch.setattr(playback_prepare, "federated_post", fake_post)

    result = playback_prepare.prepare_remote_playback_variants(
        user={"id": 7, "role": "user"},
        node_uid=peer["node_uid"],
        remote_entity_uids=[
            "22222222-2222-4222-8222-222222222222",
            "33333333-3333-4333-8333-333333333333",
            "44444444-4444-4444-8444-444444444444",
        ],
        delivery_policy="balanced",
    )

    assert result == {
        "22222222-2222-4222-8222-222222222222": "preparing",
        "33333333-3333-4333-8333-333333333333": "ready",
    }
    assert captured["assertion"]["purpose"] == "stream.prepare"
    assert captured["request"] == {
        "base_url": "https://owner.example",
        "path": "/api/federation/v1/playback/prepare",
        "node_id": local_node["node_uid"],
        "key_id": "key-local",
        "private_key_ref": "env:CRATE_FEDERATION_PRIVATE_KEY",
        "json_body": {
            "requesting_node_uid": local_node["node_uid"],
            "delivery_policy": "balanced",
            "remote_entity_uids": [
                "22222222-2222-4222-8222-222222222222",
                "33333333-3333-4333-8333-333333333333",
            ],
        },
        "timeout": playback_prepare.PREPARE_TIMEOUT,
        "user_assertion": "assertion",
    }


def test_consumer_treats_remote_prepare_failures_as_unavailable(monkeypatch):
    from crate.federation import playback_prepare

    monkeypatch.setattr(
        playback_prepare.federation_repo,
        "get_local_node",
        lambda: {
            "node_uid": "11111111-1111-4111-8111-111111111111",
            "active_key_id": "key-local",
            "private_key_ref": "env:CRATE_FEDERATION_PRIVATE_KEY",
        },
    )
    monkeypatch.setattr(
        playback_prepare.federation_repo,
        "get_peer",
        lambda _uid: {
            "trust_state": "approved",
            "api_base_url": "https://owner.example",
        },
    )
    monkeypatch.setattr(
        playback_prepare,
        "build_outbound_user_assertion",
        lambda **_kwargs: "assertion",
    )
    monkeypatch.setattr(
        playback_prepare,
        "federated_post",
        lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("network unavailable")),
    )

    result = playback_prepare.prepare_remote_playback_variants(
        user={"id": 7},
        node_uid="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        remote_entity_uids=["22222222-2222-4222-8222-222222222222"],
        delivery_policy="balanced",
    )

    assert result == {"22222222-2222-4222-8222-222222222222": "unavailable"}

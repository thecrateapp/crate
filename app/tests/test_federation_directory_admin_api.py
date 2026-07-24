from __future__ import annotations

import base64
from unittest.mock import patch

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


def _public_key() -> str:
    return base64.b64encode(
        Ed25519PrivateKey.generate()
        .public_key()
        .public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )
    ).decode("ascii")


def test_admin_creates_directory_subscription_and_queues_refresh(test_app):
    subscription = {
        "id": 3,
        "subscription_uid": "11111111-1111-4111-8111-111111111111",
        "url": "https://directory.example/nodes.json",
    }
    validated_url = type(
        "ValidatedURL", (), {"url": "https://directory.example/nodes.json"}
    )()
    with (
        patch(
            "crate.federation.url_policy.FederationURLPolicy.validate_base_url",
            return_value=validated_url,
        ),
        patch(
            "crate.api.admin_federation.directory_repo.create_subscription",
            return_value=subscription,
        ) as create,
        patch("crate.db.repositories.tasks.create_task_dedup", return_value="task-1"),
        patch("crate.api.admin_federation.repo.record_audit_event"),
    ):
        response = test_app.post(
            "/api/admin/federation/directories",
            json={
                "url": "https://directory.example/nodes.json",
                "trusted_key_id": "directory-2026",
                "trusted_public_key": _public_key(),
                "refresh_interval_seconds": 1800,
            },
        )

    assert response.status_code == 200
    assert response.json()["task_id"] == "task-1"
    assert create.call_args.kwargs["trusted_keys"][0]["key_id"] == "directory-2026"
    assert create.call_args.kwargs["created_by"] == 1


def test_directory_candidate_pair_reuses_pairing_without_approval(test_app):
    candidate = {
        "id": 7,
        "state": "pending",
        "metadata_json": {"api_base_url": "https://node-b.example"},
    }
    with (
        patch(
            "crate.api.admin_federation.directory_repo.get_candidate",
            return_value=candidate,
        ),
        patch(
            "crate.api.admin_federation.start_pairing",
            return_value={"pairing": {"state": "offered"}},
        ) as start,
        patch("crate.api.admin_federation.approve_pairing") as approve,
    ):
        response = test_app.post(
            "/api/admin/federation/directory-candidates/7/pair",
            json={"outbound_grant": "discovery"},
        )

    assert response.status_code == 200
    assert response.json()["pairing"]["state"] == "offered"
    assert start.call_args.args[0].url == "https://node-b.example"
    approve.assert_not_called()

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest


NOW = datetime(2026, 7, 14, 12, 0, tzinfo=timezone.utc)


@pytest.mark.parametrize(
    ("state", "at", "expected"),
    [
        ("prepared", NOW, "announce"),
        ("announced", NOW - timedelta(seconds=1), "activate"),
        ("active", NOW - timedelta(seconds=1), "wait"),
        ("active", NOW - timedelta(hours=2), "retire"),
        ("retired", NOW, "none"),
    ],
)
def test_rotation_due_action_is_deterministic(state: str, at: datetime, expected: str):
    from crate.federation.key_rotation import rotation_due_action

    rotation = {
        "state": state,
        "activate_at": at,
        "grace_until": NOW - timedelta(hours=1),
    }
    if state == "active" and expected == "wait":
        rotation["grace_until"] = NOW + timedelta(hours=1)

    assert rotation_due_action(rotation, now=NOW) == expected


def test_prepare_rotation_keeps_current_key_active(monkeypatch):
    from crate.federation import key_rotation

    writes: list[dict] = []
    monkeypatch.setattr(
        key_rotation.trust_repo,
        "get_active_local_key",
        lambda: {"key_id": "old", "node_uid": "node-a"},
    )
    monkeypatch.setattr(key_rotation, "generate_key_id", lambda: "new")
    monkeypatch.setattr(
        key_rotation,
        "generate_ed25519_key_pair",
        lambda: (object(), object()),
    )
    monkeypatch.setattr(key_rotation, "store_private_key", lambda *args: None)
    monkeypatch.setattr(key_rotation, "public_key_to_base64", lambda key: "pub-new")
    monkeypatch.setattr(
        key_rotation.trust_repo,
        "upsert_local_key",
        lambda **kwargs: writes.append(kwargs) or kwargs,
    )
    monkeypatch.setattr(
        key_rotation.trust_repo,
        "create_key_rotation",
        lambda **kwargs: {"rotation_uid": "rotation-a", **kwargs},
    )

    rotation = key_rotation.prepare_local_rotation(
        node_uid="node-a",
        activate_at=NOW + timedelta(minutes=5),
        grace_until=NOW + timedelta(hours=1),
    )

    assert rotation["old_key_id"] == "old"
    assert rotation["new_key_id"] == "new"
    assert writes[0]["status"] == "pending"


@pytest.mark.parametrize(
    ("status", "not_before", "not_after", "expected"),
    [
        ("active", None, None, True),
        ("pending", NOW + timedelta(seconds=1), None, False),
        ("pending", NOW - timedelta(seconds=1), None, True),
        ("retiring", None, NOW + timedelta(seconds=1), True),
        ("retiring", None, NOW - timedelta(seconds=1), False),
        ("revoked", None, None, False),
    ],
)
def test_peer_key_verification_respects_overlap_window(
    status: str,
    not_before: datetime | None,
    not_after: datetime | None,
    expected: bool,
):
    from crate.db.repositories.federation_trust import is_key_verifiable

    assert (
        is_key_verifiable(
            {
                "status": status,
                "not_before": not_before,
                "not_after": not_after,
            },
            now=NOW,
        )
        is expected
    )


def test_rotation_activation_is_atomic_and_old_key_remains_verifiable(pg_db):
    del pg_db
    from crate.db.repositories import federation as legacy_repo
    from crate.db.repositories import federation_trust as trust_repo

    local = legacy_repo.ensure_local_node(
        display_name="Local",
        api_base_url="https://local.example.test",
        active_key_id="old",
        private_key_ref="federation/keys/old.pem",
    )
    trust_repo.upsert_local_key(
        node_uid=str(local["node_uid"]),
        key_id="old",
        public_key="pub-old",
        private_key_ref="federation/keys/old.pem",
        status="active",
    )
    trust_repo.upsert_local_key(
        node_uid=str(local["node_uid"]),
        key_id="new",
        public_key="pub-new",
        private_key_ref="federation/keys/new.pem",
        status="pending",
        not_before=NOW,
    )
    rotation = trust_repo.create_key_rotation(
        node_uid=str(local["node_uid"]),
        old_key_id="old",
        new_key_id="new",
        activate_at=NOW,
        grace_until=NOW + timedelta(hours=1),
        state="announced",
    )

    activated = trust_repo.activate_key_rotation(
        str(rotation["rotation_uid"]),
        now=NOW,
    )

    assert activated["state"] == "active"
    keys = trust_repo.list_local_public_keys(now=NOW)
    assert {key["key_id"]: key["status"] for key in keys} == {
        "old": "retiring",
        "new": "active",
    }

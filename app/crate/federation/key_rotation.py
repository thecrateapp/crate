"""Local federation key rotation lifecycle."""

from __future__ import annotations

from datetime import datetime, timezone

from crate.db.repositories import federation_trust as trust_repo
from crate.federation.identity import (
    generate_ed25519_key_pair,
    generate_key_id,
    public_key_to_base64,
    store_private_key,
)


def rotation_due_action(rotation: dict, *, now: datetime | None = None) -> str:
    current_time = now or datetime.now(timezone.utc)
    state = str(rotation["state"])
    if state == "prepared":
        return "announce"
    if state == "announced":
        return "activate" if rotation["activate_at"] <= current_time else "wait"
    if state == "active":
        return "retire" if rotation["grace_until"] <= current_time else "wait"
    return "none"


def prepare_local_rotation(
    *,
    node_uid: str,
    activate_at: datetime,
    grace_until: datetime,
) -> dict:
    if grace_until <= activate_at:
        raise ValueError("Rotation grace period must end after activation")
    active_key = trust_repo.get_active_local_key()
    if active_key is None or str(active_key["node_uid"]) != str(node_uid):
        raise ValueError("Local active federation key was not found")
    new_key_id = generate_key_id()
    private_key, public_key = generate_ed25519_key_pair()
    store_private_key(new_key_id, private_key)
    trust_repo.upsert_local_key(
        node_uid=node_uid,
        key_id=new_key_id,
        public_key=public_key_to_base64(public_key),
        private_key_ref=f"federation/keys/{new_key_id}.pem",
        status="pending",
        not_before=activate_at,
    )
    return trust_repo.create_key_rotation(
        node_uid=node_uid,
        old_key_id=str(active_key["key_id"]),
        new_key_id=new_key_id,
        activate_at=activate_at,
        grace_until=grace_until,
    )


def announce_local_rotation(rotation_uid: str) -> dict:
    return trust_repo.transition_key_rotation(
        rotation_uid,
        expected_states={"prepared"},
        target="announced",
    )


def activate_local_rotation(
    rotation_uid: str,
    *,
    now: datetime | None = None,
) -> dict:
    return trust_repo.activate_key_rotation(rotation_uid, now=now)


def retire_local_rotation(
    rotation_uid: str,
    *,
    now: datetime | None = None,
) -> dict:
    return trust_repo.retire_key_rotation(rotation_uid, now=now)


def cancel_local_rotation(rotation_uid: str) -> dict:
    return trust_repo.transition_key_rotation(
        rotation_uid,
        expected_states={"prepared", "announced"},
        target="cancelled",
    )

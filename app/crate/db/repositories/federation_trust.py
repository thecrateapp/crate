"""Persistence for normalized federation keys, pairings and rotations."""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone

from sqlalchemy import text

from crate.db.tx import read_scope, transaction_scope


KEY_TRANSITIONS = {
    "pending": frozenset({"active", "revoked"}),
    "active": frozenset({"retiring", "revoked"}),
    "retiring": frozenset({"retired", "revoked"}),
    "retired": frozenset({"revoked"}),
    "revoked": frozenset(),
}
VERIFICATION_KEY_STATES = frozenset({"active", "retiring"})
PUBLISHED_KEY_STATES = VERIFICATION_KEY_STATES | {"pending"}
PAIRING_TERMINAL_STATES = frozenset({"completed", "rejected", "expired", "failed"})
PAIRING_STATES = frozenset(
    {
        "created",
        "offered",
        "remote_pending",
        "accepted",
        "completed",
        "rejected",
        "expired",
        "failed",
    }
)


def is_key_verifiable(row: dict, *, now: datetime | None = None) -> bool:
    current_time = now or datetime.now(timezone.utc)
    status = row.get("status")
    if status not in {"pending", "active", "retiring"}:
        return False
    not_before = row.get("not_before")
    not_after = row.get("not_after")
    if not_before is not None and current_time < not_before:
        return False
    return not (not_after is not None and current_time > not_after)


def validate_key_transition(current: str, target: str) -> str:
    if current == target:
        return target
    if current not in KEY_TRANSITIONS or target not in KEY_TRANSITIONS[current]:
        raise ValueError(f"Invalid federation key transition: {current} -> {target}")
    return target


def project_public_keys(
    rows: list[dict],
    *,
    now: datetime | None = None,
) -> list[dict]:
    current_time = now or datetime.now(timezone.utc)
    projected: list[dict] = []
    for row in rows:
        status = row.get("status")
        if status not in PUBLISHED_KEY_STATES:
            continue
        not_before = row.get("not_before")
        not_after = row.get("not_after")
        if status != "pending" and not_before is not None and current_time < not_before:
            continue
        if not_after is not None and current_time > not_after:
            continue
        projected.append(
            {
                "key_id": str(row["key_id"]),
                "algorithm": "ed25519",
                "public_key": str(row["public_key"]),
                "status": str(row["status"]),
                "not_before": not_before,
                "not_after": not_after,
            }
        )
    return projected


def upsert_local_key(
    *,
    node_uid: str,
    key_id: str,
    public_key: str,
    private_key_ref: str | None,
    status: str,
    not_before: datetime | None = None,
    not_after: datetime | None = None,
) -> dict:
    if status not in KEY_TRANSITIONS:
        raise ValueError(f"Unknown federation key status: {status}")
    with transaction_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    INSERT INTO federation_local_keys (
                        node_uid, key_id, public_key, private_key_ref, status,
                        not_before, not_after
                    )
                    VALUES (
                        CAST(:node_uid AS uuid), :key_id, :public_key,
                        :private_key_ref, :status, :not_before, :not_after
                    )
                    ON CONFLICT (node_uid, key_id) DO UPDATE SET
                        public_key = EXCLUDED.public_key,
                        private_key_ref = EXCLUDED.private_key_ref,
                        status = EXCLUDED.status,
                        not_before = EXCLUDED.not_before,
                        not_after = EXCLUDED.not_after,
                        updated_at = NOW()
                    RETURNING *
                    """
                ),
                {
                    "node_uid": node_uid,
                    "key_id": key_id,
                    "public_key": public_key,
                    "private_key_ref": private_key_ref,
                    "status": status,
                    "not_before": not_before,
                    "not_after": not_after,
                },
            )
            .mappings()
            .one()
        )
        return dict(row)


def upsert_peer_key(
    *,
    node_uid: str,
    key_id: str,
    public_key: str,
    status: str,
    not_before: datetime | None = None,
    not_after: datetime | None = None,
) -> dict:
    if status not in KEY_TRANSITIONS:
        raise ValueError(f"Unknown federation key status: {status}")
    fingerprint = hashlib.sha256(public_key.encode("utf-8")).hexdigest()
    with transaction_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    INSERT INTO federation_peer_keys (
                        node_uid, key_id, public_key, fingerprint, status,
                        not_before, not_after
                    )
                    VALUES (
                        CAST(:node_uid AS uuid), :key_id, :public_key,
                        :fingerprint, :status, :not_before, :not_after
                    )
                    ON CONFLICT (node_uid, key_id) DO UPDATE SET
                        public_key = EXCLUDED.public_key,
                        fingerprint = EXCLUDED.fingerprint,
                        status = EXCLUDED.status,
                        not_before = EXCLUDED.not_before,
                        not_after = EXCLUDED.not_after,
                        updated_at = NOW()
                    RETURNING *
                    """
                ),
                {
                    "node_uid": node_uid,
                    "key_id": key_id,
                    "public_key": public_key,
                    "fingerprint": fingerprint,
                    "status": status,
                    "not_before": not_before,
                    "not_after": not_after,
                },
            )
            .mappings()
            .one()
        )
        return dict(row)


def get_active_local_key() -> dict | None:
    now = datetime.now(timezone.utc)
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    SELECT *
                    FROM federation_local_keys
                    WHERE status = 'active'
                      AND (not_before IS NULL OR not_before <= :now)
                      AND (not_after IS NULL OR not_after >= :now)
                    LIMIT 1
                    """
                ),
                {"now": now},
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None


def get_local_key(key_id: str) -> dict | None:
    with read_scope() as session:
        row = (
            session.execute(
                text("SELECT * FROM federation_local_keys WHERE key_id = :key_id"),
                {"key_id": key_id},
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None


def list_local_public_keys(*, now: datetime | None = None) -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT key_id, public_key, status, not_before, not_after
                    FROM federation_local_keys
                    ORDER BY created_at, key_id
                    """
                )
            )
            .mappings()
            .all()
        )
        return project_public_keys([dict(row) for row in rows], now=now)


def list_peer_public_keys(
    node_uid: str,
    *,
    now: datetime | None = None,
) -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT key_id, public_key, status, not_before, not_after
                    FROM federation_peer_keys
                    WHERE node_uid = CAST(:node_uid AS uuid)
                    ORDER BY created_at, key_id
                    """
                ),
                {"node_uid": node_uid},
            )
            .mappings()
            .all()
        )
        return project_public_keys([dict(row) for row in rows], now=now)


def get_peer_verification_key(
    node_uid: str,
    key_id: str,
    *,
    now: datetime | None = None,
) -> dict | None:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    SELECT key_id, public_key, status, not_before, not_after
                    FROM federation_peer_keys
                    WHERE node_uid = CAST(:node_uid AS uuid)
                      AND key_id = :key_id
                    """
                ),
                {"node_uid": node_uid, "key_id": key_id},
            )
            .mappings()
            .first()
        )
    key = dict(row) if row else None
    return key if key is not None and is_key_verifiable(key, now=now) else None


def list_peer_verification_keys(
    node_uid: str,
    *,
    now: datetime | None = None,
) -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT key_id, public_key, status, not_before, not_after
                    FROM federation_peer_keys
                    WHERE node_uid = CAST(:node_uid AS uuid)
                    ORDER BY created_at, key_id
                    """
                ),
                {"node_uid": node_uid},
            )
            .mappings()
            .all()
        )
    keys = [dict(row) for row in rows]
    return [key for key in keys if is_key_verifiable(key, now=now)]


def transition_local_key(key_id: str, target: str) -> dict:
    with transaction_scope() as session:
        current = session.execute(
            text(
                "SELECT status FROM federation_local_keys "
                "WHERE key_id = :key_id FOR UPDATE"
            ),
            {"key_id": key_id},
        ).scalar_one()
        validate_key_transition(str(current), target)
        row = (
            session.execute(
                text(
                    """
                    UPDATE federation_local_keys
                    SET status = :target, updated_at = NOW()
                    WHERE key_id = :key_id
                    RETURNING *
                    """
                ),
                {"key_id": key_id, "target": target},
            )
            .mappings()
            .one()
        )
        return dict(row)


def create_pairing(
    *,
    remote_base_url: str,
    direction: str,
    local_challenge: str,
    expires_at: datetime,
    remote_node_uid: str | None = None,
    state: str = "created",
    pairing_uid: str | None = None,
    remote_challenge: str | None = None,
    negotiated_protocol: str | None = None,
    signature_profile: str | None = None,
    descriptor_digest: str | None = None,
    offer_json: dict | None = None,
) -> dict:
    if direction not in {"inbound", "outbound"}:
        raise ValueError(f"Invalid pairing direction: {direction}")
    if state not in PAIRING_STATES:
        raise ValueError(f"Invalid pairing state: {state}")
    pairing_uid = pairing_uid or str(uuid.uuid4())
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO federation_pairings (
                    pairing_uid, remote_node_uid, remote_base_url,
                    direction, state, local_challenge, remote_challenge,
                    negotiated_protocol, signature_profile, descriptor_digest,
                    offer_json, expires_at
                )
                VALUES (
                    CAST(:pairing_uid AS uuid), CAST(:remote_node_uid AS uuid),
                    :remote_base_url, :direction, :state,
                    :local_challenge, :remote_challenge, :negotiated_protocol,
                    :signature_profile, :descriptor_digest,
                    CAST(:offer_json AS jsonb), :expires_at
                )
                ON CONFLICT (pairing_uid) DO NOTHING
                """
            ),
            {
                "pairing_uid": pairing_uid,
                "remote_node_uid": remote_node_uid,
                "remote_base_url": remote_base_url,
                "direction": direction,
                "state": state,
                "local_challenge": local_challenge,
                "remote_challenge": remote_challenge,
                "negotiated_protocol": negotiated_protocol,
                "signature_profile": signature_profile,
                "descriptor_digest": descriptor_digest,
                "offer_json": json.dumps(offer_json or {}, default=str),
                "expires_at": expires_at,
            },
        )
        row = (
            session.execute(
                text(
                    "SELECT * FROM federation_pairings "
                    "WHERE pairing_uid = CAST(:pairing_uid AS uuid)"
                ),
                {"pairing_uid": pairing_uid},
            )
            .mappings()
            .one()
        )
        return dict(row)


def update_pairing(
    pairing_uid: str,
    *,
    expected_states: set[str] | frozenset[str],
    **fields,
) -> dict:
    allowed = {
        "state",
        "remote_node_uid",
        "remote_challenge",
        "negotiated_protocol",
        "signature_profile",
        "descriptor_digest",
        "offer_json",
        "acceptance_json",
        "verified_at",
        "completed_at",
        "failure_reason",
    }
    updates = {name: value for name, value in fields.items() if name in allowed}
    if not updates:
        pairing = get_pairing(pairing_uid)
        if pairing is None:
            raise ValueError("Pairing not found")
        return pairing
    if "state" in updates and updates["state"] not in PAIRING_STATES:
        raise ValueError(f"Invalid pairing state: {updates['state']}")
    if not expected_states:
        raise ValueError("At least one expected pairing state is required")

    expressions: list[str] = []
    params: dict = {
        "pairing_uid": pairing_uid,
        "expected_states": sorted(expected_states),
    }
    for name, value in updates.items():
        if name in {"offer_json", "acceptance_json"}:
            expressions.append(f"{name} = CAST(:{name} AS jsonb)")
            params[name] = json.dumps(value or {}, default=str)
        elif name == "remote_node_uid":
            expressions.append("remote_node_uid = CAST(:remote_node_uid AS uuid)")
            params[name] = value
        else:
            expressions.append(f"{name} = :{name}")
            params[name] = value
    expressions.append("updated_at = NOW()")

    with transaction_scope() as session:
        row = (
            session.execute(
                text(
                    f"""
                    UPDATE federation_pairings
                    SET {", ".join(expressions)}
                    WHERE pairing_uid = CAST(:pairing_uid AS uuid)
                      AND state = ANY(:expected_states)
                    RETURNING *
                    """
                ),
                params,
            )
            .mappings()
            .first()
        )
        if row is None:
            raise ValueError("Pairing state changed or pairing was not found")
        return dict(row)


def get_pairing(pairing_uid: str) -> dict | None:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    "SELECT * FROM federation_pairings "
                    "WHERE pairing_uid = CAST(:pairing_uid AS uuid)"
                ),
                {"pairing_uid": pairing_uid},
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None


def expire_pairings(*, now: datetime | None = None) -> int:
    current_time = now or datetime.now(timezone.utc)
    with transaction_scope() as session:
        result = session.execute(
            text(
                """
                UPDATE federation_pairings
                SET state = 'expired', updated_at = :now
                WHERE expires_at < :now
                  AND state NOT IN ('completed', 'rejected', 'expired', 'failed')
                """
            ),
            {"now": current_time},
        )
        return int(getattr(result, "rowcount", 0) or 0)


def create_key_rotation(
    *,
    node_uid: str,
    old_key_id: str,
    new_key_id: str,
    activate_at: datetime,
    grace_until: datetime,
    state: str = "prepared",
) -> dict:
    if old_key_id == new_key_id:
        raise ValueError("Rotation keys must differ")
    if grace_until <= activate_at:
        raise ValueError("Rotation grace period must end after activation")
    if state not in {"prepared", "announced"}:
        raise ValueError(f"Invalid initial rotation state: {state}")
    rotation_uid = str(uuid.uuid4())
    with transaction_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    INSERT INTO federation_key_rotations (
                        rotation_uid, node_uid, old_key_id, new_key_id,
                        state, activate_at, grace_until
                    )
                    VALUES (
                        CAST(:rotation_uid AS uuid), CAST(:node_uid AS uuid),
                        :old_key_id, :new_key_id, :state,
                        :activate_at, :grace_until
                    )
                    RETURNING *
                    """
                ),
                {
                    "rotation_uid": rotation_uid,
                    "node_uid": node_uid,
                    "old_key_id": old_key_id,
                    "new_key_id": new_key_id,
                    "state": state,
                    "activate_at": activate_at,
                    "grace_until": grace_until,
                },
            )
            .mappings()
            .one()
        )
        return dict(row)


def get_key_rotation(rotation_uid: str) -> dict | None:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    "SELECT * FROM federation_key_rotations "
                    "WHERE rotation_uid = CAST(:rotation_uid AS uuid)"
                ),
                {"rotation_uid": rotation_uid},
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None


def transition_key_rotation(
    rotation_uid: str,
    *,
    expected_states: set[str],
    target: str,
    failure_reason: str | None = None,
) -> dict:
    if target not in {"announced", "cancelled", "failed"}:
        raise ValueError(f"Unsupported rotation transition target: {target}")
    with transaction_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    UPDATE federation_key_rotations
                    SET state = :target,
                        failure_reason = :failure_reason,
                        updated_at = NOW()
                    WHERE rotation_uid = CAST(:rotation_uid AS uuid)
                      AND state = ANY(:expected_states)
                    RETURNING *
                    """
                ),
                {
                    "rotation_uid": rotation_uid,
                    "expected_states": sorted(expected_states),
                    "target": target,
                    "failure_reason": failure_reason,
                },
            )
            .mappings()
            .first()
        )
        if row is None:
            raise ValueError("Rotation state changed or rotation was not found")
        if target == "cancelled":
            session.execute(
                text(
                    """
                    UPDATE federation_local_keys
                    SET status = 'revoked', updated_at = NOW()
                    WHERE key_id = :new_key_id AND status = 'pending'
                    """
                ),
                {"new_key_id": row["new_key_id"]},
            )
        return dict(row)


def activate_key_rotation(
    rotation_uid: str,
    *,
    now: datetime | None = None,
) -> dict:
    current_time = now or datetime.now(timezone.utc)
    with transaction_scope() as session:
        rotation = (
            session.execute(
                text(
                    "SELECT * FROM federation_key_rotations "
                    "WHERE rotation_uid = CAST(:rotation_uid AS uuid) FOR UPDATE"
                ),
                {"rotation_uid": rotation_uid},
            )
            .mappings()
            .first()
        )
        if rotation is None or rotation["state"] != "announced":
            raise ValueError("Rotation is not announced")
        if rotation["activate_at"] > current_time:
            raise ValueError("Rotation activation time has not arrived")
        session.execute(
            text(
                """
                UPDATE federation_local_keys
                SET status = 'retiring', not_after = :grace_until, updated_at = NOW()
                WHERE node_uid = :node_uid AND key_id = :old_key_id
                  AND status = 'active'
                """
            ),
            {
                "node_uid": rotation["node_uid"],
                "old_key_id": rotation["old_key_id"],
                "grace_until": rotation["grace_until"],
            },
        )
        new_key = (
            session.execute(
                text(
                    """
                    UPDATE federation_local_keys
                    SET status = 'active', not_before = LEAST(
                        COALESCE(not_before, :now), :now
                    ), updated_at = NOW()
                    WHERE node_uid = :node_uid AND key_id = :new_key_id
                      AND status = 'pending'
                    RETURNING private_key_ref
                    """
                ),
                {
                    "node_uid": rotation["node_uid"],
                    "new_key_id": rotation["new_key_id"],
                    "now": current_time,
                },
            )
            .mappings()
            .one()
        )
        session.execute(
            text(
                """
                UPDATE federation_local_node
                SET active_key_id = :new_key_id,
                    private_key_ref = :private_key_ref,
                    updated_at = NOW()
                WHERE node_uid = :node_uid
                """
            ),
            {
                "node_uid": rotation["node_uid"],
                "new_key_id": rotation["new_key_id"],
                "private_key_ref": new_key["private_key_ref"],
            },
        )
        row = (
            session.execute(
                text(
                    """
                    UPDATE federation_key_rotations
                    SET state = 'active', updated_at = NOW()
                    WHERE rotation_uid = CAST(:rotation_uid AS uuid)
                    RETURNING *
                    """
                ),
                {"rotation_uid": rotation_uid},
            )
            .mappings()
            .one()
        )
        return dict(row)


def retire_key_rotation(
    rotation_uid: str,
    *,
    now: datetime | None = None,
) -> dict:
    current_time = now or datetime.now(timezone.utc)
    with transaction_scope() as session:
        rotation = (
            session.execute(
                text(
                    "SELECT * FROM federation_key_rotations "
                    "WHERE rotation_uid = CAST(:rotation_uid AS uuid) FOR UPDATE"
                ),
                {"rotation_uid": rotation_uid},
            )
            .mappings()
            .one()
        )
        if rotation["state"] != "active" or rotation["grace_until"] > current_time:
            raise ValueError("Rotation grace period is still active")
        session.execute(
            text(
                """
                UPDATE federation_local_keys
                SET status = 'retired', updated_at = NOW()
                WHERE node_uid = :node_uid AND key_id = :old_key_id
                  AND status = 'retiring'
                """
            ),
            {
                "node_uid": rotation["node_uid"],
                "old_key_id": rotation["old_key_id"],
            },
        )
        row = (
            session.execute(
                text(
                    """
                    UPDATE federation_key_rotations
                    SET state = 'retired', retired_at = :now, updated_at = NOW()
                    WHERE rotation_uid = CAST(:rotation_uid AS uuid)
                    RETURNING *
                    """
                ),
                {"rotation_uid": rotation_uid, "now": current_time},
            )
            .mappings()
            .one()
        )
        return dict(row)

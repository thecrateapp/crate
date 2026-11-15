"""Atomic completion of verified bilateral pairing exchanges."""

import hashlib
import json
from datetime import UTC, datetime

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.tx import optional_scope


def _upsert_grant(current, node_uid, preset, capabilities, constraints):
    selector = f"peer_users:{node_uid}"
    parameters = {
        "node_uid": node_uid,
        "selector": selector,
        "preset": preset,
        "caps": json.dumps(capabilities),
        "constraints": json.dumps(constraints),
    }
    existing = current.execute(
        text(
            "SELECT id FROM federation_peer_grants "
            "WHERE node_uid = CAST(:node_uid AS uuid) AND principal_selector = :selector "
            "ORDER BY id LIMIT 1 FOR UPDATE"
        ),
        parameters,
    ).scalar()
    if existing is not None:
        current.execute(
            text(
                "UPDATE federation_peer_grants SET preset = :preset, "
                "capabilities_json = CAST(:caps AS jsonb), "
                "constraints_json = CAST(:constraints AS jsonb), "
                "subject_selector = :selector, constraints_version = 1, "
                "policy_revision = policy_revision + 1, updated_at = NOW() WHERE id = :id"
            ),
            {**parameters, "id": existing},
        )
    else:
        current.execute(
            text(
                "INSERT INTO federation_peer_grants "
                "(node_uid, principal_selector, subject_selector, preset, "
                "capabilities_json, constraints_json, valid_from) VALUES "
                "(CAST(:node_uid AS uuid), :selector, :selector, :preset, "
                "CAST(:caps AS jsonb), CAST(:constraints AS jsonb), NOW())"
            ),
            parameters,
        )


def _check_grant_consent(current, node_uid, consent_at):
    grants = (
        current.execute(
            text(
                "SELECT created_at, updated_at FROM federation_peer_grants "
                "WHERE node_uid = CAST(:node_uid AS uuid) "
                "AND principal_selector = :selector FOR UPDATE"
            ),
            {"node_uid": node_uid, "selector": f"peer_users:{node_uid}"},
        )
        .mappings()
        .all()
    )
    if any(
        max(grant["created_at"], grant["updated_at"]) > consent_at for grant in grants
    ):
        raise ValueError("Peer grant changed after consent; start a new pairing")


def check_inbound_pairing_policy(
    pairing_uid: str,
    *,
    session: Session | None = None,
) -> dict:
    """Reject stale consent after an owner policy change, under row locks.

    Used both before the remote callback and within atomic completion. Health
    refreshes update the peer's timestamp too, so only grant timestamps establish
    later policy writes. An Off peer also covers the preset endpoint's gap before
    its separate grant write, unless the signed consent itself grants nothing.
    """
    with optional_scope(session) as current:
        row = (
            current.execute(
                text(
                    "SELECT * FROM federation_pairings "
                    "WHERE pairing_uid = CAST(:uid AS uuid) FOR UPDATE"
                ),
                {"uid": pairing_uid},
            )
            .mappings()
            .first()
        )
        if not row or row["direction"] != "inbound":
            raise ValueError("Inbound pairing not found")
        if row["state"] == "completed":
            return dict(row)
        if row["state"] != "accepted":
            raise ValueError("Pairing is not accepted")
        consent_at = row["verified_at"]
        if consent_at is None:
            raise ValueError(
                "Pairing consent timestamp is missing; start a new pairing"
            )
        node_uid = str(row["remote_node_uid"])
        peer = (
            current.execute(
                text(
                    "SELECT * FROM federation_nodes "
                    "WHERE node_uid = CAST(:node_uid AS uuid) FOR UPDATE"
                ),
                {"node_uid": node_uid},
            )
            .mappings()
            .first()
        )
        if (
            not peer
            or peer["disabled_at"] is not None
            or peer["trust_state"] not in {"pending", "approved"}
        ):
            raise ValueError("Peer is disabled or unavailable")
        preset = (row["acceptance_json"] or {}).get("outbound_grant")
        if peer["default_grant_preset"] == "off" and preset != "off":
            raise ValueError("Peer grant changed after acceptance; start a new pairing")
        _check_grant_consent(current, node_uid, consent_at)
        return dict(row)


def complete_inbound_pairing(
    pairing_uid: str,
    *,
    preset: str,
    capabilities: list[str],
    constraints: dict,
    session: Session | None = None,
) -> dict:
    """Commit trust, grant, audit and completion together; completed retries do nothing.

    The caller must authenticate the operator and verify the remote signed ACK first.
    Locking the pairing also serializes concurrent retries of the same acceptance.
    """
    with optional_scope(session) as current:
        row = check_inbound_pairing_policy(pairing_uid, session=current)
        if row["state"] == "completed":
            return row
        if (row["acceptance_json"] or {}).get("outbound_grant") != preset:
            raise ValueError("Grant differs from the signed acceptance")
        node_uid = str(row["remote_node_uid"])
        peer = current.execute(
            text(
                "UPDATE federation_nodes SET trust_state = 'approved', "
                "default_grant_preset = :preset, updated_at = NOW() "
                "WHERE node_uid = CAST(:node_uid AS uuid) AND disabled_at IS NULL "
                "AND trust_state IN ('pending', 'approved') RETURNING node_uid"
            ),
            {"node_uid": node_uid, "preset": preset},
        ).first()
        if peer is None:
            raise ValueError("Peer is disabled or unavailable")
        _upsert_grant(current, node_uid, preset, capabilities, constraints)
        current.execute(
            text(
                "INSERT INTO federation_audit_events "
                "(node_uid, event_type, status, metadata_json) VALUES "
                "(CAST(:node_uid AS uuid), 'pairing.approved', 'approved', CAST(:metadata AS jsonb))"
            ),
            {
                "node_uid": node_uid,
                "metadata": json.dumps({"pairing_uid": pairing_uid}),
            },
        )
        completed = (
            current.execute(
                text(
                    "UPDATE federation_pairings SET state = 'completed', "
                    "completed_at = NOW(), updated_at = NOW() "
                    "WHERE pairing_uid = CAST(:uid AS uuid) RETURNING *"
                ),
                {"uid": pairing_uid},
            )
            .mappings()
            .one()
        )
        return dict(completed)


def complete_outbound_pairing(
    pairing_uid: str,
    *,
    acceptance: dict,
    preset: str,
    capabilities: list[str],
    constraints: dict,
    session: Session | None = None,
) -> dict:
    """Apply a verified acceptance once, preserving later owner decisions on replay.

    The caller verifies the remote envelope and prepares its signed ACK before
    entering this transaction. A completed exact replay returns without writes,
    including key updates, grant revisions and peer metadata refreshes.
    """
    with optional_scope(session) as current:
        row = (
            current.execute(
                text(
                    "SELECT * FROM federation_pairings "
                    "WHERE pairing_uid = CAST(:uid AS uuid) FOR UPDATE"
                ),
                {"uid": pairing_uid},
            )
            .mappings()
            .first()
        )
        if not row or row["direction"] != "outbound":
            raise ValueError("Outbound pairing not found")
        if row["state"] == "completed":
            if row["acceptance_json"] != acceptance:
                raise ValueError(
                    "Completed pairing acceptance differs from the stored envelope"
                )
            return dict(row)
        if row["state"] not in {"offered", "accepted"}:
            raise ValueError("Pairing is not awaiting acceptance")
        if row["expires_at"] <= datetime.now(UTC):
            raise ValueError("Pairing offer expired")
        offer = row["offer_json"]
        source = acceptance["source_descriptor"]
        node_uid = str(row["remote_node_uid"])
        if (
            acceptance["pairing_uid"] != str(row["pairing_uid"])
            or acceptance["source_node_uid"] != node_uid
            or source["node_uid"] != node_uid
            or offer["target_node_uid"] != node_uid
            or acceptance["target_node_uid"] != offer["source_node_uid"]
            or offer["outbound_grant"] != preset
        ):
            raise ValueError("Pairing identities or grant changed")
        peer = (
            current.execute(
                text(
                    "SELECT * FROM federation_nodes "
                    "WHERE node_uid = CAST(:node_uid AS uuid) FOR UPDATE"
                ),
                {"node_uid": node_uid},
            )
            .mappings()
            .first()
        )
        if (
            not peer
            or peer["disabled_at"] is not None
            or peer["trust_state"] not in {"pending", "approved"}
        ):
            raise ValueError("Peer is disabled or unavailable")
        if peer["default_grant_preset"] != preset:
            raise ValueError("Peer grant changed after the offer; start a new pairing")
        # New offers retain consent from before the remote probe/signing work.
        # Older pending offers have only their creation timestamp available.
        _check_grant_consent(current, node_uid, row["verified_at"] or row["created_at"])
        for key in source["public_keys"]:
            current.execute(
                text(
                    "INSERT INTO federation_peer_keys "
                    "(node_uid, key_id, public_key, fingerprint, status, not_before, not_after) "
                    "VALUES (CAST(:node_uid AS uuid), :key_id, :public_key, :fingerprint, "
                    ":status, :not_before, :not_after) "
                    "ON CONFLICT (node_uid, key_id) DO UPDATE SET "
                    "public_key = EXCLUDED.public_key, fingerprint = EXCLUDED.fingerprint, "
                    "status = EXCLUDED.status, not_before = EXCLUDED.not_before, "
                    "not_after = EXCLUDED.not_after, updated_at = NOW()"
                ),
                {
                    "node_uid": node_uid,
                    "key_id": key["key_id"],
                    "public_key": key["public_key"],
                    "fingerprint": hashlib.sha256(
                        key["public_key"].encode()
                    ).hexdigest(),
                    "status": key["status"],
                    "not_before": datetime.fromisoformat(key["not_before"])
                    if key.get("not_before")
                    else None,
                    "not_after": datetime.fromisoformat(key["not_after"])
                    if key.get("not_after")
                    else None,
                },
            )
        current.execute(
            text(
                "UPDATE federation_nodes SET display_name = :name, api_base_url = :url, "
                "listen_base_url = :listen_url, active_key_id = :key_id, "
                "public_keys_json = CAST(:keys AS jsonb), capabilities_json = CAST(:caps AS jsonb), "
                "trust_state = 'approved', direction = 'outbound', "
                "last_seen_at = NOW(), updated_at = NOW() WHERE node_uid = CAST(:node_uid AS uuid)"
            ),
            {
                "node_uid": node_uid,
                "name": source["name"],
                "url": source["api_base_url"],
                "listen_url": source.get("listen_base_url"),
                "key_id": source["active_key_id"],
                "keys": json.dumps(source["public_keys"]),
                "caps": json.dumps({cap: True for cap in source["capabilities"]}),
            },
        )
        _upsert_grant(current, node_uid, preset, capabilities, constraints)
        current.execute(
            text(
                "INSERT INTO federation_audit_events "
                "(node_uid, event_type, status, metadata_json) VALUES "
                "(CAST(:node_uid AS uuid), 'pairing.completed', 'approved', CAST(:metadata AS jsonb))"
            ),
            {
                "node_uid": node_uid,
                "metadata": json.dumps({"pairing_uid": pairing_uid}),
            },
        )
        completed = (
            current.execute(
                text(
                    "UPDATE federation_pairings SET state = 'completed', "
                    "remote_challenge = :challenge, acceptance_json = CAST(:acceptance AS jsonb), "
                    "verified_at = NOW(), completed_at = NOW(), updated_at = NOW() "
                    "WHERE pairing_uid = CAST(:uid AS uuid) RETURNING *"
                ),
                {
                    "uid": pairing_uid,
                    "challenge": acceptance["challenge"],
                    "acceptance": json.dumps(acceptance),
                },
            )
            .mappings()
            .one()
        )
        return dict(completed)


__all__ = [
    "check_inbound_pairing_policy",
    "complete_inbound_pairing",
    "complete_outbound_pairing",
]

"""Federation repositories — CRUD for federation tables.

Phase 1 tables: federation_local_node, federation_nodes, federation_pairing_requests,
federation_peer_grants, federation_remote_subjects, federation_audit_events.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text

from crate.db.tx import read_scope, transaction_scope

log = logging.getLogger(__name__)

JSON_FIELD_NAMES = {
    "capabilities_json",
    "constraints_json",
    "health_json",
    "metadata_json",
    "policy_json",
    "public_keys_json",
}


def _dump_json(value: Any) -> str:
    return json.dumps(value, default=str)


def _prepare_json_fields(fields: dict[str, Any]) -> dict[str, Any]:
    prepared = dict(fields)
    for name in JSON_FIELD_NAMES & prepared.keys():
        value = prepared[name]
        if value is not None and not isinstance(value, str):
            prepared[name] = _dump_json(value)
    return prepared


# ── Local node ────────────────────────────────────────────────────────────


def ensure_local_node(
    display_name: str,
    api_base_url: str,
    active_key_id: str,
    private_key_ref: str,
    listen_base_url: str | None = None,
    public_base_url: str | None = None,
) -> dict:
    """Create the local node identity row if it does not exist."""
    with transaction_scope() as s:
        existing = s.execute(
            text("SELECT node_uid FROM federation_local_node LIMIT 1")
        ).scalar()
        if existing:
            row = (
                s.execute(
                    text("SELECT * FROM federation_local_node WHERE node_uid = :uid"),
                    {"uid": existing},
                )
                .mappings()
                .one()
            )
            return dict(row)

        node_uid = str(uuid.uuid4())
        s.execute(
            text(
                """
                INSERT INTO federation_local_node
                    (node_uid, display_name, public_base_url, api_base_url,
                     listen_base_url, active_key_id, private_key_ref)
                VALUES
                    (:node_uid, :display_name, :public_base_url, :api_base_url,
                     :listen_base_url, :active_key_id, :private_key_ref)
                """
            ),
            {
                "node_uid": node_uid,
                "display_name": display_name,
                "public_base_url": public_base_url,
                "api_base_url": api_base_url,
                "listen_base_url": listen_base_url,
                "active_key_id": active_key_id,
                "private_key_ref": private_key_ref,
            },
        )
        row = (
            s.execute(
                text("SELECT * FROM federation_local_node WHERE node_uid = :uid"),
                {"uid": node_uid},
            )
            .mappings()
            .one()
        )
        return dict(row)


def get_local_node() -> dict | None:
    with read_scope() as s:
        row = (
            s.execute(text("SELECT * FROM federation_local_node LIMIT 1"))
            .mappings()
            .first()
        )
        return dict(row) if row else None


def update_local_node(node_uid: str, **fields) -> dict | None:
    allowed = {
        "display_name",
        "public_base_url",
        "api_base_url",
        "listen_base_url",
        "active_key_id",
        "public_keys_json",
        "private_key_ref",
        "capabilities_json",
        "policy_json",
    }
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return get_local_node()
    updates = _prepare_json_fields(updates)
    updates["updated_at"] = datetime.now(timezone.utc)

    set_clause = ", ".join(f"{k} = :{k}" for k in updates)
    with transaction_scope() as s:
        s.execute(
            text(
                f"UPDATE federation_local_node SET {set_clause} "
                "WHERE node_uid = :node_uid"
            ),
            {"node_uid": node_uid, **updates},
        )
        row = (
            s.execute(
                text("SELECT * FROM federation_local_node WHERE node_uid = :uid"),
                {"uid": node_uid},
            )
            .mappings()
            .one()
        )
        return dict(row)


# ── Peers ─────────────────────────────────────────────────────────────────


def list_peers(
    trust_state: str | None = None,
) -> list[dict]:
    with read_scope() as s:
        if trust_state:
            rows = (
                s.execute(
                    text(
                        "SELECT * FROM federation_nodes WHERE trust_state = :state "
                        "ORDER BY created_at DESC"
                    ),
                    {"state": trust_state},
                )
                .mappings()
                .all()
            )
        else:
            rows = (
                s.execute(
                    text("SELECT * FROM federation_nodes ORDER BY created_at DESC")
                )
                .mappings()
                .all()
            )
        return [dict(r) for r in rows]


def get_peer(node_uid: str) -> dict | None:
    with read_scope() as s:
        row = (
            s.execute(
                text("SELECT * FROM federation_nodes WHERE node_uid = :uid"),
                {"uid": node_uid},
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None


def upsert_peer(
    node_uid: str,
    display_name: str,
    api_base_url: str,
    active_key_id: str,
    public_keys_json: list[dict] | None = None,
    listen_base_url: str | None = None,
    trust_state: str = "pending",
    direction: str = "outbound",
    default_grant_preset: str = "discovery",
    capabilities_json: dict | None = None,
) -> dict:
    now = datetime.now(timezone.utc)
    with transaction_scope() as s:
        existing = s.execute(
            text("SELECT id FROM federation_nodes WHERE node_uid = :uid"),
            {"uid": node_uid},
        ).scalar()

        if existing:
            s.execute(
                text(
                    """
                    UPDATE federation_nodes SET
                        display_name = :display_name,
                        api_base_url = :api_base_url,
                        listen_base_url = :listen_base_url,
                        active_key_id = :active_key_id,
                        public_keys_json = :public_keys_json,
                        capabilities_json = :capabilities_json,
                        trust_state = :trust_state,
                        direction = :direction,
                        default_grant_preset = :default_grant_preset,
                        last_seen_at = :now,
                        updated_at = :now
                    WHERE node_uid = :node_uid
                    """
                ),
                {
                    "node_uid": node_uid,
                    "display_name": display_name,
                    "api_base_url": api_base_url,
                    "listen_base_url": listen_base_url,
                    "active_key_id": active_key_id,
                    "public_keys_json": _dump_json(public_keys_json or []),
                    "capabilities_json": _dump_json(capabilities_json or {}),
                    "trust_state": trust_state,
                    "direction": direction,
                    "default_grant_preset": default_grant_preset,
                    "now": now,
                },
            )
        else:
            s.execute(
                text(
                    """
                    INSERT INTO federation_nodes
                        (node_uid, display_name, api_base_url, listen_base_url,
                         active_key_id, public_keys_json, trust_state, direction,
                         default_grant_preset, capabilities_json)
                    VALUES
                        (:node_uid, :display_name, :api_base_url, :listen_base_url,
                         :active_key_id, :public_keys_json, :trust_state, :direction,
                         :default_grant_preset, :capabilities_json)
                    """
                ),
                {
                    "node_uid": node_uid,
                    "display_name": display_name,
                    "api_base_url": api_base_url,
                    "listen_base_url": listen_base_url,
                    "active_key_id": active_key_id,
                    "public_keys_json": _dump_json(public_keys_json or []),
                    "trust_state": trust_state,
                    "direction": direction,
                    "default_grant_preset": default_grant_preset,
                    "capabilities_json": _dump_json(capabilities_json or {}),
                },
            )

        row = (
            s.execute(
                text("SELECT * FROM federation_nodes WHERE node_uid = :uid"),
                {"uid": node_uid},
            )
            .mappings()
            .one()
        )
        return dict(row)


def update_peer(node_uid: str, **fields) -> dict | None:
    allowed = {
        "display_name",
        "api_base_url",
        "listen_base_url",
        "active_key_id",
        "public_keys_json",
        "trust_state",
        "default_grant_preset",
        "capabilities_json",
        "policy_json",
        "health_json",
        "last_health_at",
        "last_seen_at",
        "last_success_at",
        "last_error",
        "disabled_at",
    }
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return get_peer(node_uid)
    updates = _prepare_json_fields(updates)
    updates["updated_at"] = datetime.now(timezone.utc)

    set_clause = ", ".join(f"{k} = :{k}" for k in updates)
    with transaction_scope() as s:
        s.execute(
            text(
                f"UPDATE federation_nodes SET {set_clause} WHERE node_uid = :node_uid"
            ),
            {"node_uid": node_uid, **updates},
        )
        row = (
            s.execute(
                text("SELECT * FROM federation_nodes WHERE node_uid = :uid"),
                {"uid": node_uid},
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None


def disable_peer(node_uid: str) -> dict | None:
    disabled_at = datetime.now(timezone.utc)
    with transaction_scope() as session:
        peer = (
            session.execute(
                text(
                    """
                    UPDATE federation_nodes
                    SET
                        disabled_at = :disabled_at,
                        trust_state = 'disabled',
                        updated_at = :disabled_at
                    WHERE node_uid = CAST(:node_uid AS uuid)
                    RETURNING *
                    """
                ),
                {"node_uid": node_uid, "disabled_at": disabled_at},
            )
            .mappings()
            .first()
        )
        if peer is None:
            return None

        catalog_items = (
            session.execute(
                text(
                    """
                    UPDATE federation_catalog_items
                    SET
                        deleted_at = :disabled_at,
                        tombstone_json = jsonb_build_object(
                            'deleted_at', CAST(:disabled_at AS text),
                            'reason', 'peer_disabled'
                        )
                    WHERE node_uid = CAST(:node_uid AS uuid)
                      AND deleted_at IS NULL
                    RETURNING entity_type, remote_entity_uid
                    """
                ),
                {"node_uid": node_uid, "disabled_at": disabled_at},
            )
            .mappings()
            .all()
        )

        from crate.db.repositories.global_catalog_dirty_sources import (
            enqueue_federated_dirty_source,
        )

        for item in catalog_items:
            enqueue_federated_dirty_source(
                item["entity_type"],
                node_uid,
                str(item["remote_entity_uid"]),
                "delete",
                session=session,
            )

        active_sources = (
            session.execute(
                text(
                    """
                    SELECT entity_type, remote_entity_uid
                    FROM global_catalog_sources
                    WHERE node_uid = CAST(:node_uid AS uuid)
                      AND source_kind = 'federated'
                      AND source_deleted_at IS NULL
                    """
                ),
                {"node_uid": node_uid},
            )
            .mappings()
            .all()
        )
        from crate.db.jobs.global_catalog_reconciliation import (
            tombstone_federated_source,
        )

        for source in active_sources:
            tombstone_federated_source(
                str(source["entity_type"]),
                node_uid,
                str(source["remote_entity_uid"]),
                session=session,
            )

    from crate.db.repositories.global_content_cache import invalidate_source_cache

    invalidate_source_cache(node_uid)
    return dict(peer)


# ── Pairing ───────────────────────────────────────────────────────────────


def create_pairing_request(
    remote_base_url: str,
    challenge: str,
    remote_node_uid: str | None = None,
    remote_public_key: str | None = None,
    ttl_hours: int = 24,
) -> dict:
    request_uid = str(uuid.uuid4())
    expires_at = datetime.now(timezone.utc)
    from datetime import timedelta

    expires_at = expires_at + timedelta(hours=ttl_hours)

    with transaction_scope() as s:
        s.execute(
            text(
                """
                INSERT INTO federation_pairing_requests
                    (request_uid, remote_node_uid, remote_base_url,
                     remote_public_key, challenge, expires_at)
                VALUES
                    (:request_uid, :remote_node_uid, :remote_base_url,
                     :remote_public_key, :challenge, :expires_at)
                """
            ),
            {
                "request_uid": request_uid,
                "remote_node_uid": remote_node_uid,
                "remote_base_url": remote_base_url,
                "remote_public_key": remote_public_key,
                "challenge": challenge,
                "expires_at": expires_at,
            },
        )
        row = (
            s.execute(
                text(
                    "SELECT * FROM federation_pairing_requests WHERE request_uid = :uid"
                ),
                {"uid": request_uid},
            )
            .mappings()
            .one()
        )
        return dict(row)


def get_pairing_request(request_uid: str) -> dict | None:
    with read_scope() as s:
        row = (
            s.execute(
                text(
                    "SELECT * FROM federation_pairing_requests WHERE request_uid = :uid"
                ),
                {"uid": request_uid},
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None


def approve_pairing_request(request_uid: str) -> dict | None:
    now = datetime.now(timezone.utc)
    with transaction_scope() as s:
        s.execute(
            text(
                "UPDATE federation_pairing_requests "
                "SET status = 'approved', completed_at = :now "
                "WHERE request_uid = :uid"
            ),
            {"uid": request_uid, "now": now},
        )
        row = (
            s.execute(
                text(
                    "SELECT * FROM federation_pairing_requests WHERE request_uid = :uid"
                ),
                {"uid": request_uid},
            )
            .mappings()
            .one()
        )
        return dict(row)


# ── Grants ────────────────────────────────────────────────────────────────


def upsert_peer_grant(
    node_uid: str,
    principal_selector: str,
    preset: str = "discovery",
    capabilities_json: list[str] | None = None,
    constraints_json: dict | None = None,
) -> dict:
    now = datetime.now(timezone.utc)
    with transaction_scope() as s:
        existing = s.execute(
            text(
                "SELECT id FROM federation_peer_grants "
                "WHERE node_uid = :node_uid AND principal_selector = :sel"
            ),
            {"node_uid": node_uid, "sel": principal_selector},
        ).scalar()

        if existing:
            s.execute(
                text(
                    "UPDATE federation_peer_grants SET "
                    "preset = :preset, capabilities_json = :caps, "
                    "constraints_json = :constraints, "
                    "subject_selector = :sel, constraints_version = 1, "
                    "policy_revision = policy_revision + 1, updated_at = :now "
                    "WHERE id = :id"
                ),
                {
                    "id": existing,
                    "preset": preset,
                    "sel": principal_selector,
                    "caps": _dump_json(capabilities_json or []),
                    "constraints": _dump_json(constraints_json or {}),
                    "now": now,
                },
            )
        else:
            s.execute(
                text(
                    """
                    INSERT INTO federation_peer_grants
                        (node_uid, principal_selector, subject_selector, preset,
                         capabilities_json, constraints_json, valid_from)
                    VALUES
                        (:node_uid, :sel, :sel, :preset, :caps, :constraints, :now)
                    """
                ),
                {
                    "node_uid": node_uid,
                    "sel": principal_selector,
                    "preset": preset,
                    "caps": _dump_json(capabilities_json or []),
                    "constraints": _dump_json(constraints_json or {}),
                    "now": now,
                },
            )

        row = (
            s.execute(
                text(
                    "SELECT * FROM federation_peer_grants "
                    "WHERE node_uid = :node_uid AND principal_selector = :sel"
                ),
                {"node_uid": node_uid, "sel": principal_selector},
            )
            .mappings()
            .one()
        )
        return dict(row)


def get_peer_grants(node_uid: str) -> list[dict]:
    with read_scope() as s:
        rows = (
            s.execute(
                text(
                    "SELECT * FROM federation_peer_grants "
                    "WHERE node_uid = :uid AND disabled_at IS NULL "
                    "ORDER BY priority DESC"
                ),
                {"uid": node_uid},
            )
            .mappings()
            .all()
        )
        return [dict(r) for r in rows]


# ── Remote subjects ───────────────────────────────────────────────────────


def ensure_remote_subject(
    node_uid: str,
    subject_hash: str,
    roles: list[str] | None = None,
) -> dict:
    now = datetime.now(timezone.utc)
    with transaction_scope() as s:
        existing = s.execute(
            text(
                "SELECT id FROM federation_remote_subjects "
                "WHERE node_uid = :node_uid AND subject_hash = :hash"
            ),
            {"node_uid": node_uid, "hash": subject_hash},
        ).scalar()

        if existing:
            s.execute(
                text(
                    "UPDATE federation_remote_subjects SET "
                    "last_seen_at = :now, last_roles_json = :roles "
                    "WHERE id = :id"
                ),
                {
                    "id": existing,
                    "now": now,
                    "roles": _dump_json(roles or []),
                },
            )
        else:
            s.execute(
                text(
                    """
                    INSERT INTO federation_remote_subjects
                        (node_uid, subject_hash, last_roles_json)
                    VALUES (:node_uid, :hash, :roles)
                    """
                ),
                {
                    "node_uid": node_uid,
                    "hash": subject_hash,
                    "roles": _dump_json(roles or []),
                },
            )

        row = (
            s.execute(
                text(
                    "SELECT * FROM federation_remote_subjects "
                    "WHERE node_uid = :node_uid AND subject_hash = :hash"
                ),
                {"node_uid": node_uid, "hash": subject_hash},
            )
            .mappings()
            .one()
        )
        return dict(row)


def get_remote_subject(node_uid: str, subject_hash: str) -> dict | None:
    with read_scope() as s:
        row = (
            s.execute(
                text(
                    "SELECT * FROM federation_remote_subjects "
                    "WHERE node_uid = :node_uid AND subject_hash = :hash"
                ),
                {"node_uid": node_uid, "hash": subject_hash},
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None


def list_remote_subjects(node_uid: str) -> list[dict]:
    with read_scope() as s:
        rows = (
            s.execute(
                text(
                    "SELECT * FROM federation_remote_subjects "
                    "WHERE node_uid = :uid ORDER BY last_seen_at DESC"
                ),
                {"uid": node_uid},
            )
            .mappings()
            .all()
        )
        return [dict(r) for r in rows]


def block_remote_subject(
    node_uid: str, subject_hash: str, reason: str | None = None
) -> dict | None:
    now = datetime.now(timezone.utc)
    with transaction_scope() as s:
        s.execute(
            text(
                "UPDATE federation_remote_subjects SET "
                "blocked_at = :now, blocked_reason = :reason "
                "WHERE node_uid = :node_uid AND subject_hash = :hash"
            ),
            {"node_uid": node_uid, "hash": subject_hash, "now": now, "reason": reason},
        )
        return get_remote_subject(node_uid, subject_hash)


def unblock_remote_subject(node_uid: str, subject_hash: str) -> dict | None:
    with transaction_scope() as s:
        s.execute(
            text(
                "UPDATE federation_remote_subjects SET "
                "blocked_at = NULL, blocked_reason = NULL "
                "WHERE node_uid = :node_uid AND subject_hash = :hash"
            ),
            {"node_uid": node_uid, "hash": subject_hash},
        )
        return get_remote_subject(node_uid, subject_hash)


# ── Audit ─────────────────────────────────────────────────────────────────


def record_audit_event(
    event_type: str,
    status: str,
    node_uid: str | None = None,
    actor_user_id: int | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict:
    with transaction_scope() as s:
        s.execute(
            text(
                """
                INSERT INTO federation_audit_events
                    (node_uid, event_type, actor_user_id, status, metadata_json)
                VALUES (:node_uid, :event_type, :actor_user_id, :status, :metadata)
                """
            ),
            {
                "node_uid": node_uid,
                "event_type": event_type,
                "actor_user_id": actor_user_id,
                "status": status,
                "metadata": _dump_json(metadata or {}),
            },
        )
        row = (
            s.execute(
                text("SELECT * FROM federation_audit_events ORDER BY id DESC LIMIT 1")
            )
            .mappings()
            .one()
        )
        return dict(row)


def list_audit_events(
    node_uid: str | None = None,
    event_type: str | None = None,
    limit: int = 50,
) -> list[dict]:
    with read_scope() as s:
        conditions = []
        params: dict[str, Any] = {"limit": limit}

        if node_uid:
            conditions.append("node_uid = :node_uid")
            params["node_uid"] = node_uid
        if event_type:
            conditions.append("event_type = :event_type")
            params["event_type"] = event_type

        where = ""
        if conditions:
            where = "WHERE " + " AND ".join(conditions)

        rows = (
            s.execute(
                text(
                    f"SELECT * FROM federation_audit_events {where} "
                    "ORDER BY created_at DESC LIMIT :limit"
                ),
                params,
            )
            .mappings()
            .all()
        )
        return [dict(r) for r in rows]


# ── Cleanup ───────────────────────────────────────────────────────────────


def cleanup_expired_pairing_requests() -> int:
    now = datetime.now(timezone.utc)
    with transaction_scope() as s:
        result = s.execute(
            text(
                "DELETE FROM federation_pairing_requests "
                "WHERE expires_at < :now AND status = 'pending'"
            ),
            {"now": now},
        )
        return int(getattr(result, "rowcount", 0) or 0)


def cleanup_old_audit_events(retention_days: int = 90) -> int:
    from datetime import timedelta

    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    with transaction_scope() as s:
        result = s.execute(
            text("DELETE FROM federation_audit_events WHERE created_at < :cutoff"),
            {"cutoff": cutoff},
        )
        return int(getattr(result, "rowcount", 0) or 0)

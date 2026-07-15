"""Persistence operations for short-lived federation stream tickets."""

from __future__ import annotations

import logging
import json
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.exc import ProgrammingError

from crate.db.tx import read_scope, transaction_scope

log = logging.getLogger(__name__)

TICKET_TTL_MINUTES = 2


def create_ticket(
    node_uid: str,
    remote_entity_uid: str,
    delivery_policy: str = "balanced",
    subject_hash: str | None = None,
    local_user_id: int | None = None,
    direction: str = "outbound",
    audience: str | None = None,
    playback_session: str | None = None,
    range_policy: str = "bytes",
    max_bytes: int | None = None,
    grant_uid: str | None = None,
    policy_revision: int = 0,
    assertion_jti: str | None = None,
) -> dict:
    ticket_uid = str(uuid.uuid4())
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=TICKET_TTL_MINUTES)

    constraints = {
        "audience": audience,
        "playback_session": playback_session,
        "range_policy": range_policy,
        "max_bytes": max_bytes,
        "grant_uid": grant_uid,
        "policy_revision": policy_revision,
    }
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO federation_stream_tickets
                    (ticket_uid, direction, node_uid, subject_hash,
                     remote_entity_uid, delivery_policy, local_user_id,
                     assertion_jti, constraints_json, expires_at)
                VALUES
                    (:ticket_uid, :direction, :node_uid, :subject_hash,
                     :remote_entity_uid, :delivery_policy, :local_user_id,
                     :assertion_jti, CAST(:constraints_json AS jsonb), :expires_at)
                """
            ),
            {
                "ticket_uid": ticket_uid,
                "direction": direction,
                "node_uid": node_uid,
                "subject_hash": subject_hash,
                "remote_entity_uid": remote_entity_uid,
                "delivery_policy": delivery_policy,
                "local_user_id": local_user_id,
                "assertion_jti": assertion_jti,
                "constraints_json": json.dumps(constraints),
                "expires_at": expires_at,
            },
        )
        row = (
            session.execute(
                text("SELECT * FROM federation_stream_tickets WHERE ticket_uid = :uid"),
                {"uid": ticket_uid},
            )
            .mappings()
            .one()
        )
    return dict(row)


def validate_ticket(
    ticket_uid: str,
    *,
    expected_node_uid: str | None = None,
    expected_audience: str | None = None,
    expected_subject: str | None = None,
    expected_local_user_id: int | None = None,
    playback_session: str | None = None,
    requested_range: str | None = None,
    current_policy_revision: int | None = None,
) -> dict | None:
    now = datetime.now(timezone.utc)
    with transaction_scope() as session:
        row = (
            session.execute(
                text(
                    "SELECT * FROM federation_stream_tickets "
                    "WHERE ticket_uid = :uid AND status = 'active' "
                    "AND expires_at > :now AND used_at IS NULL FOR UPDATE"
                ),
                {"uid": ticket_uid, "now": now},
            )
            .mappings()
            .first()
        )
        if not row:
            return None

        ticket = dict(row)
        constraints = ticket.get("constraints_json") or {}
        if isinstance(constraints, str):
            constraints = json.loads(constraints)
        if expected_node_uid and str(ticket["node_uid"]) != str(expected_node_uid):
            return None
        if expected_subject and ticket.get("subject_hash") != expected_subject:
            return None
        if (
            expected_local_user_id is not None
            and ticket.get("local_user_id") != expected_local_user_id
        ):
            return None
        if expected_audience and constraints.get("audience") != expected_audience:
            return None
        if playback_session and constraints.get("playback_session") != playback_session:
            return None
        if requested_range and constraints.get("range_policy") != "bytes":
            return None
        ticket_revision = int(constraints.get("policy_revision") or 0)
        if (
            current_policy_revision is not None
            and ticket_revision != current_policy_revision
        ):
            session.execute(
                text(
                    "UPDATE federation_stream_tickets SET status = 'revoked' "
                    "WHERE ticket_uid = :uid"
                ),
                {"uid": ticket_uid},
            )
            return None
        session.execute(
            text(
                "UPDATE federation_stream_tickets SET used_at = :now "
                "WHERE ticket_uid = :uid"
            ),
            {"uid": ticket_uid, "now": now},
        )
    return ticket


def get_ticket(ticket_uid: str) -> dict | None:
    with read_scope() as session:
        row = (
            session.execute(
                text("SELECT * FROM federation_stream_tickets WHERE ticket_uid = :uid"),
                {"uid": ticket_uid},
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None


def list_active_tickets(
    *,
    node_uid: str | None = None,
    subject_hash: str | None = None,
    grant_uid: str | None = None,
) -> list[dict]:
    clauses = ["status = 'active'", "expires_at > :now"]
    params: dict = {"now": datetime.now(timezone.utc)}
    if node_uid is not None:
        clauses.append("node_uid = CAST(:node_uid AS uuid)")
        params["node_uid"] = node_uid
    if subject_hash is not None:
        clauses.append("subject_hash = :subject_hash")
        params["subject_hash"] = subject_hash
    if grant_uid is not None:
        clauses.append("constraints_json->>'grant_uid' = :grant_uid")
        params["grant_uid"] = grant_uid
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    "SELECT * FROM federation_stream_tickets WHERE "
                    + " AND ".join(clauses)
                    + " ORDER BY created_at"
                ),
                params,
            )
            .mappings()
            .all()
        )
        return [dict(row) for row in rows]


def revoke_grant_tickets(grant_uid: str) -> int:
    with transaction_scope() as session:
        result = session.execute(
            text(
                """
                UPDATE federation_stream_tickets
                SET status = 'revoked'
                WHERE status = 'active'
                  AND constraints_json->>'grant_uid' = :grant_uid
                """
            ),
            {"grant_uid": grant_uid},
        )
        return int(getattr(result, "rowcount", 0) or 0)


def revoke_peer_tickets(node_uid: str) -> int:
    try:
        with transaction_scope() as session:
            result = session.execute(
                text(
                    "UPDATE federation_stream_tickets SET status = 'revoked' "
                    "WHERE node_uid = :uid AND status = 'active'"
                ),
                {"uid": node_uid},
            )
            return int(getattr(result, "rowcount", 0) or 0)
    except ProgrammingError as exc:
        log.warning("Could not revoke federation peer tickets: %s", exc)
        return 0


def revoke_subject_tickets(node_uid: str, subject_hash: str) -> int:
    try:
        with transaction_scope() as session:
            result = session.execute(
                text(
                    "UPDATE federation_stream_tickets SET status = 'revoked' "
                    "WHERE node_uid = :uid AND subject_hash = :hash "
                    "AND status = 'active'"
                ),
                {"uid": node_uid, "hash": subject_hash},
            )
            return int(getattr(result, "rowcount", 0) or 0)
    except ProgrammingError as exc:
        log.warning("Could not revoke federation subject tickets: %s", exc)
        return 0


def revoke_ticket(ticket_uid: str) -> bool:
    with transaction_scope() as session:
        row = session.execute(
            text(
                """
                UPDATE federation_stream_tickets
                SET status = 'revoked'
                WHERE ticket_uid = :ticket_uid
                  AND status = 'active'
                RETURNING ticket_uid
                """
            ),
            {"ticket_uid": ticket_uid},
        ).first()
        return row is not None


__all__ = [
    "TICKET_TTL_MINUTES",
    "create_ticket",
    "get_ticket",
    "list_active_tickets",
    "revoke_peer_tickets",
    "revoke_grant_tickets",
    "revoke_subject_tickets",
    "revoke_ticket",
    "validate_ticket",
]

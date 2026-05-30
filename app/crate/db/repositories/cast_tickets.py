from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Any

from sqlalchemy import text

from crate.auth import _get_jwt_secret
from crate.db.tx import optional_scope, read_scope, transaction_scope
from crate.streaming.policy import BALANCED_POLICY, DATA_SAVER_POLICY, ORIGINAL_POLICY

DEFAULT_CAST_TICKET_TTL_SECONDS = 900
MIN_CAST_TICKET_TTL_SECONDS = 60
MAX_CAST_TICKET_TTL_SECONDS = 3600
CAST_AUTO_POLICY = "auto"
CAST_RECEIVER_SAFE_POLICY = "receiver_safe"
CAST_TICKET_PURPOSES = {"google_cast", "airplay", "external_receiver"}
CAST_DELIVERY_POLICIES = {
    CAST_AUTO_POLICY,
    ORIGINAL_POLICY,
    BALANCED_POLICY,
    DATA_SAVER_POLICY,
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _json(value: Any) -> str:
    return json.dumps(value or {}, default=str)


def _coerce_json(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return {}
    return value or {}


@lru_cache(maxsize=1)
def _ticket_secret() -> str:
    return os.environ.get("CRATE_CAST_TICKET_SECRET") or _get_jwt_secret()


def clear_cast_ticket_secret_cache_for_tests() -> None:
    _ticket_secret.cache_clear()


def _base64_url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _sign_ticket(ticket_id: str, nonce: str) -> str:
    payload = f"{ticket_id}.{nonce}".encode("utf-8")
    digest = hmac.new(_ticket_secret().encode("utf-8"), payload, hashlib.sha256)
    return _base64_url(digest.digest())


def _ticket_hash(ticket: str) -> str:
    return hashlib.sha256(ticket.encode("utf-8")).hexdigest()


def _ttl_seconds(value: int | None) -> int:
    try:
        ttl = int(value or DEFAULT_CAST_TICKET_TTL_SECONDS)
    except (TypeError, ValueError):
        ttl = DEFAULT_CAST_TICKET_TTL_SECONDS
    return max(MIN_CAST_TICKET_TTL_SECONDS, min(MAX_CAST_TICKET_TTL_SECONDS, ttl))


def normalize_cast_purpose(value: str | None) -> str:
    purpose = (value or "google_cast").strip().lower().replace("-", "_")
    return purpose if purpose in CAST_TICKET_PURPOSES else "google_cast"


def receiver_safe_delivery_policy(value: str | None) -> str:
    policy = (value or CAST_AUTO_POLICY).strip().lower().replace("-", "_")
    if policy == CAST_RECEIVER_SAFE_POLICY:
        return CAST_AUTO_POLICY
    return policy if policy in CAST_DELIVERY_POLICIES else CAST_AUTO_POLICY


def generate_cast_ticket() -> tuple[str, str]:
    ticket_id = uuid.uuid4().hex
    nonce = secrets.token_urlsafe(24)
    signature = _sign_ticket(ticket_id, nonce)
    return ticket_id, f"{ticket_id}.{nonce}.{signature}"


def verify_cast_ticket_signature(ticket: str) -> bool:
    parts = str(ticket or "").split(".")
    if len(parts) != 3:
        return False
    ticket_id, nonce, signature = parts
    if not ticket_id or not nonce or not signature:
        return False
    expected = _sign_ticket(ticket_id, nonce)
    return hmac.compare_digest(signature, expected)


def _ticket_from_row(row: dict[str, Any] | None) -> dict | None:
    if not row:
        return None
    return {
        "ticket_id": row.get("ticket_id"),
        "user_id": row.get("user_id"),
        "track_id": row.get("track_id"),
        "track_entity_uid": row.get("track_entity_uid"),
        "track_path": row.get("track_path"),
        "purpose": row.get("purpose"),
        "target_device_id": row.get("target_device_id"),
        "delivery_policy": row.get("delivery_policy") or CAST_AUTO_POLICY,
        "receiver_capabilities": _coerce_json(row.get("receiver_capabilities_json")),
        "created_at": row.get("created_at"),
        "expires_at": row.get("expires_at"),
        "revoked_at": row.get("revoked_at"),
        "last_used_at": row.get("last_used_at"),
    }


def create_cast_ticket(
    user_id: int,
    *,
    track_id: int | None = None,
    track_entity_uid: str | None = None,
    track_path: str | None = None,
    purpose: str | None = None,
    target_device_id: str | None = None,
    expires_in_seconds: int | None = None,
    delivery_policy: str | None = None,
    receiver_capabilities: dict[str, Any] | None = None,
    session=None,
) -> dict:
    now = _now()
    ttl = _ttl_seconds(expires_in_seconds)
    ticket_id, ticket = generate_cast_ticket()
    payload = {
        "ticket_hash": _ticket_hash(ticket),
        "ticket_id": ticket_id,
        "user_id": user_id,
        "track_id": track_id,
        "track_entity_uid": str(track_entity_uid) if track_entity_uid else None,
        "track_path": track_path,
        "purpose": normalize_cast_purpose(purpose),
        "target_device_id": target_device_id,
        "delivery_policy": receiver_safe_delivery_policy(delivery_policy),
        "receiver_capabilities_json": _json(receiver_capabilities),
        "created_at": now,
        "expires_at": now + timedelta(seconds=ttl),
    }
    with optional_scope(session) as s:
        row = (
            s.execute(
                text(
                    """
                    INSERT INTO cast_stream_tickets (
                        ticket_hash, ticket_id, user_id, track_id,
                        track_entity_uid, track_path, purpose,
                        target_device_id, delivery_policy,
                        receiver_capabilities_json, created_at, expires_at
                    )
                    VALUES (
                        :ticket_hash, :ticket_id, :user_id, :track_id,
                        CAST(:track_entity_uid AS uuid), :track_path, :purpose,
                        :target_device_id, :delivery_policy,
                        CAST(:receiver_capabilities_json AS jsonb),
                        :created_at, :expires_at
                    )
                    RETURNING *
                    """
                ),
                payload,
            )
            .mappings()
            .one()
        )
    created = _ticket_from_row(dict(row))
    if created is None:
        raise RuntimeError("Failed to create cast stream ticket")
    return {**created, "ticket": ticket}


def get_cast_ticket(
    ticket: str,
    *,
    user_id: int | None = None,
    include_expired: bool = False,
) -> dict | None:
    if not verify_cast_ticket_signature(ticket):
        return None
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    SELECT *
                    FROM cast_stream_tickets
                    WHERE ticket_hash = :ticket_hash
                      AND revoked_at IS NULL
                      AND (:include_expired OR expires_at > :now)
                      AND (:user_id IS NULL OR user_id = :user_id)
                    LIMIT 1
                    """
                ),
                {
                    "ticket_hash": _ticket_hash(ticket),
                    "include_expired": include_expired,
                    "now": _now(),
                    "user_id": user_id,
                },
            )
            .mappings()
            .first()
        )
    return _ticket_from_row(dict(row) if row else None)


def mark_cast_ticket_used(ticket: str) -> None:
    if not verify_cast_ticket_signature(ticket):
        return
    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE cast_stream_tickets
                SET last_used_at = :now
                WHERE ticket_hash = :ticket_hash
                  AND revoked_at IS NULL
                  AND expires_at > :now
                """
            ),
            {"ticket_hash": _ticket_hash(ticket), "now": _now()},
        )


def revoke_cast_ticket(user_id: int, ticket: str) -> bool:
    if not verify_cast_ticket_signature(ticket):
        return False
    with transaction_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    UPDATE cast_stream_tickets
                    SET revoked_at = COALESCE(revoked_at, :now)
                    WHERE ticket_hash = :ticket_hash
                      AND user_id = :user_id
                      AND revoked_at IS NULL
                    RETURNING ticket_id
                    """
                ),
                {
                    "ticket_hash": _ticket_hash(ticket),
                    "user_id": user_id,
                    "now": _now(),
                },
            )
            .mappings()
            .first()
        )
    return row is not None

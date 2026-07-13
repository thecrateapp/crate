"""Remote user assertions — creation and validation of short-lived tokens
that represent a remote user without creating local user accounts.

Local JWTs never cross instance boundaries. These assertions are signed by
the sending node's key and validated by the receiving node.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import secrets
import time
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

log = logging.getLogger(__name__)

ASSERTION_TTL_SEARCH = 300  # 5 minutes for search/detail
ASSERTION_TTL_STREAM = 60  # 1 minute for stream/import ticket creation
ASSERTION_TOKEN_VERSION = "crate-user-assertion-v1"


def canonical_json(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def pairwise_subject_hash(
    sender_secret: str,
    local_user_id: str,
    destination_node_uid: str,
) -> str:
    import base64

    payload = {"v": 1, "aud": destination_node_uid, "sub": local_user_id}
    canonical = canonical_json(payload)
    digest = hmac.digest(sender_secret.encode("utf-8"), canonical, hashlib.sha256)
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def build_assertion(
    issuer_node_uid: str,
    audience_node_uid: str,
    subject_hash: str,
    purpose: str,
    roles: list[str] | None = None,
    capabilities: list[str] | None = None,
    ttl: int = ASSERTION_TTL_SEARCH,
) -> dict[str, Any]:
    now = int(time.time())
    return {
        "iss": issuer_node_uid,
        "aud": audience_node_uid,
        "sub": subject_hash,
        "roles": roles or ["user"],
        "capabilities": capabilities or [],
        "purpose": purpose,
        "iat": now,
        "exp": now + ttl,
        "jti": secrets.token_hex(12),
    }


def sign_assertion(
    assertion: dict[str, Any],
    private_key: Ed25519PrivateKey,
    key_id: str,
) -> str:
    payload = canonical_json(assertion)
    signature = private_key.sign(payload)
    return ".".join(
        [
            ASSERTION_TOKEN_VERSION,
            key_id,
            _b64url_encode(payload),
            _b64url_encode(signature),
        ]
    )


def _public_key_from_entry(entry: dict[str, Any]) -> Ed25519PublicKey:
    raw = base64.b64decode(str(entry["public_key"]))
    return Ed25519PublicKey.from_public_bytes(raw)


def verify_signed_assertion(
    token: str,
    public_keys: list[dict[str, Any]],
    expected_audience: str,
    expected_purpose: str,
    required_capability: str | None = None,
) -> dict[str, Any]:
    try:
        version, key_id, payload_b64, signature_b64 = token.split(".", 3)
    except ValueError as exc:
        raise ValueError("Invalid assertion token format") from exc

    if version != ASSERTION_TOKEN_VERSION:
        raise ValueError("Unsupported assertion token version")

    key_entry = next(
        (
            key
            for key in public_keys
            if key.get("key_id") == key_id
            and key.get("status", "active") in {"active", "pending"}
        ),
        None,
    )
    if key_entry is None:
        raise ValueError("Unknown assertion signing key")

    try:
        payload_bytes = _b64url_decode(payload_b64)
        signature = _b64url_decode(signature_b64)
        _public_key_from_entry(key_entry).verify(signature, payload_bytes)
        assertion = json.loads(payload_bytes.decode("utf-8"))
    except (InvalidSignature, ValueError, json.JSONDecodeError) as exc:
        raise ValueError("Invalid assertion signature") from exc

    ok, error = validate_assertion(
        assertion,
        expected_audience=expected_audience,
        expected_purpose=expected_purpose,
    )
    if not ok:
        raise ValueError(error or "Invalid assertion")

    if required_capability:
        capabilities = set(assertion.get("capabilities") or [])
        if required_capability not in capabilities:
            raise ValueError(f"missing capability: {required_capability}")

    return assertion


def validate_assertion(
    assertion: dict[str, Any],
    expected_audience: str,
    expected_purpose: str,
) -> tuple[bool, str | None]:
    now = int(time.time())
    aud = assertion.get("aud")
    if aud != expected_audience:
        return False, f"aud mismatch: expected {expected_audience}, got {aud}"

    purpose = assertion.get("purpose")
    if purpose != expected_purpose:
        return False, f"purpose mismatch: expected {expected_purpose}, got {purpose}"

    exp = assertion.get("exp", 0)
    if now > exp:
        return False, "assertion expired"

    iat = assertion.get("iat", 0)
    if iat > now:
        return False, "assertion issued in the future"

    jti = assertion.get("jti")
    if not jti:
        return False, "missing jti"

    return True, None


def _key_id_from_ref(ref: str) -> str:
    return ref.replace("federation/keys/", "").replace(".pem", "")


def _subject_secret(local_node: dict[str, Any]) -> str:
    configured = os.environ.get("CRATE_FEDERATION_SUBJECT_SECRET")
    if configured:
        return configured
    log.warning(
        "CRATE_FEDERATION_SUBJECT_SECRET not set. "
        "Using a random secret for this session. "
        "Set this env var to a stable value for consistent pairwise subject hashing."
    )
    import secrets as _secrets

    return _secrets.token_hex(32)


def outbound_subject_hash(
    local_node: dict[str, Any],
    peer: dict[str, Any],
    user: dict[str, Any],
) -> str:
    local_user_id = str(user.get("id") or "worker")
    return pairwise_subject_hash(
        _subject_secret(local_node),
        local_user_id=local_user_id,
        destination_node_uid=str(peer["node_uid"]),
    )


def build_outbound_user_assertion(
    local_node: dict[str, Any],
    peer: dict[str, Any],
    user: dict[str, Any],
    purpose: str,
    capabilities: list[str],
    ttl: int | None = None,
) -> str:
    from crate.federation.identity import load_private_key

    if ttl is None:
        ttl = (
            ASSERTION_TTL_STREAM
            if purpose.startswith("stream")
            else ASSERTION_TTL_SEARCH
        )
    subject_hash = outbound_subject_hash(local_node, peer, user)
    role = str(user.get("role") or "user")
    assertion = build_assertion(
        issuer_node_uid=str(local_node["node_uid"]),
        audience_node_uid=str(peer["node_uid"]),
        subject_hash=subject_hash,
        purpose=purpose,
        roles=[role],
        capabilities=capabilities,
        ttl=ttl,
    )
    return sign_assertion(
        assertion,
        load_private_key(_key_id_from_ref(str(local_node["private_key_ref"]))),
        key_id=str(local_node["active_key_id"]),
    )

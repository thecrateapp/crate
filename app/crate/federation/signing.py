"""Request signing and validation for crate-ed25519-v1.

Uses the golden canonicalization fixtures from signing_golden.py to produce
deterministic signed payloads.
"""

from __future__ import annotations

import hashlib
import logging
import secrets
import time

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

log = logging.getLogger(__name__)

SIGNATURE_VERSION = "crate-ed25519-v1"
SIGNED_HEADER_NAMES = [
    "host",
    "content-type",
    "x-crate-node-id",
    "x-crate-signature-version",
    "x-crate-key-id",
    "x-crate-timestamp",
    "x-crate-nonce",
    "x-crate-body-sha256",
]
SIGNED_HEADERS = ";".join(SIGNED_HEADER_NAMES)
TIMESTAMP_SKEW_SECONDS = 300


def generate_nonce() -> str:
    return secrets.token_hex(16)


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def build_canonical_payload(
    method: str,
    path_with_query: str,
    host: str,
    content_type: str,
    node_id: str,
    key_id: str,
    timestamp: int,
    nonce: str,
    body: bytes,
) -> bytes:
    body_hash = sha256_hex(body)
    parts = [
        "CRATE-SIGNATURE-V1",
        method.upper(),
        path_with_query,
        host,
        content_type,
        node_id,
        key_id,
        str(timestamp),
        nonce,
        body_hash,
        SIGNED_HEADERS,
    ]
    return "\n".join(parts).encode("utf-8")


def sign_request(
    private_key: Ed25519PrivateKey,
    method: str,
    path_with_query: str,
    host: str,
    content_type: str,
    node_id: str,
    key_id: str,
    body: bytes,
) -> dict[str, str]:
    import base64

    timestamp = int(time.time() * 1000)
    nonce = generate_nonce()
    canonical = build_canonical_payload(
        method=method,
        path_with_query=path_with_query,
        host=host,
        content_type=content_type,
        node_id=node_id,
        key_id=key_id,
        timestamp=timestamp,
        nonce=nonce,
        body=body,
    )
    signature_bytes = private_key.sign(canonical)
    signature_b64 = base64.b64encode(signature_bytes).decode("ascii")

    headers = {
        "Host": host,
        "X-Crate-Node-Id": node_id,
        "X-Crate-Signature-Version": SIGNATURE_VERSION,
        "X-Crate-Key-Id": key_id,
        "X-Crate-Timestamp": str(timestamp),
        "X-Crate-Nonce": nonce,
        "X-Crate-Body-SHA256": sha256_hex(body),
        "X-Crate-Signed-Headers": SIGNED_HEADERS,
        "X-Crate-Signature": f"ed25519:{signature_b64}",
    }
    if content_type:
        headers["Content-Type"] = content_type
    return headers


def verify_signature(
    public_key: Ed25519PublicKey,
    method: str,
    path_with_query: str,
    host: str,
    content_type: str,
    node_id: str,
    key_id: str,
    timestamp: int,
    nonce: str,
    body: bytes,
    signature_b64: str,
) -> bool:
    import base64

    canonical = build_canonical_payload(
        method=method,
        path_with_query=path_with_query,
        host=host,
        content_type=content_type,
        node_id=node_id,
        key_id=key_id,
        timestamp=timestamp,
        nonce=nonce,
        body=body,
    )
    try:
        signature_bytes = base64.b64decode(signature_b64)
        public_key.verify(signature_bytes, canonical)
        return True
    except (InvalidSignature, ValueError) as e:
        log.debug("Signature verification failed: %s", e)
        return False


def validate_timestamp(timestamp: int, now: int | None = None) -> bool:
    if now is None:
        now = int(time.time() * 1000)
    skew = abs(now - timestamp)
    return skew <= TIMESTAMP_SKEW_SECONDS * 1000

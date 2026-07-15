"""Node identity — key generation, local node management, and the public
descriptor endpoint (/.well-known/crate-node).

The descriptor is public metadata. It must never reveal peer lists, users,
credentials, private IPs, filesystem paths, or library contents.
"""

from __future__ import annotations

import logging
import os
import secrets
import base64
import hashlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

from crate.federation.contracts import (
    MIN_PROTOCOL_VERSION,
    PROTOCOL_VERSION,
    SIGNATURE_PROFILE,
    SUPPORTED_PROTOCOL_VERSIONS,
    FederationErrorCode,
    FederationProtocolError,
    NodeDescriptorV1,
    negotiate_protocol,
    require_remote_node,
)

log = logging.getLogger(__name__)

# Optional explicit override kept for embedders and tests. Normal runtimes resolve
# the configured path lazily so environment setup does not depend on import order.
KEYS_DIR: Path | None = None
KEY_ID_PREFIX = datetime.now(timezone.utc).strftime("%Y-%m")


def get_keys_dir() -> Path:
    if KEYS_DIR is not None:
        return KEYS_DIR
    explicit = os.environ.get("FEDERATION_KEYS_DIR", "").strip()
    if explicit:
        return Path(explicit)
    return Path(os.environ.get("DATA_DIR", "./data")) / "federation" / "keys"


def ensure_keys_dir() -> Path:
    keys_dir = get_keys_dir()
    keys_dir.mkdir(parents=True, exist_ok=True)
    if keys_dir.stat().st_mode & 0o777 != 0o700:
        keys_dir.chmod(0o700)
    return keys_dir


def generate_key_id() -> str:
    suffix = secrets.token_hex(4)
    return f"{KEY_ID_PREFIX}-{suffix}"


def generate_ed25519_key_pair() -> tuple[Ed25519PrivateKey, Ed25519PublicKey]:
    private_key = Ed25519PrivateKey.generate()
    public_key = private_key.public_key()
    return private_key, public_key


def store_private_key(key_id: str, private_key: Ed25519PrivateKey) -> Path:
    pem_path = ensure_keys_dir() / f"{key_id}.pem"
    pem_bytes = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    pem_path.write_bytes(pem_bytes)
    pem_path.chmod(0o600)
    return pem_path


def load_private_key(key_id: str) -> Ed25519PrivateKey:
    pem_path = get_keys_dir() / f"{key_id}.pem"
    if not pem_path.exists():
        raise FileNotFoundError(f"Private key not found: {pem_path}")
    private_key = serialization.load_pem_private_key(
        pem_path.read_bytes(),
        password=None,
    )
    if not isinstance(private_key, Ed25519PrivateKey):
        raise ValueError(f"Private key is not Ed25519: {pem_path}")
    return private_key


def public_key_to_base64(public_key: Ed25519PublicKey) -> str:
    raw = public_key.public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    return base64.b64encode(raw).decode("ascii")


def _descriptor_data(payload: dict | NodeDescriptorV1) -> dict:
    descriptor = (
        payload
        if isinstance(payload, NodeDescriptorV1)
        else NodeDescriptorV1.model_validate(payload)
    )
    return descriptor.model_dump(
        mode="json",
        exclude={"descriptor_digest", "signature"},
    )


def canonical_descriptor_bytes(payload: dict | NodeDescriptorV1) -> bytes:
    return json.dumps(
        _descriptor_data(payload),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode("utf-8")


def build_signed_descriptor(
    *,
    node_uid: str,
    display_name: str,
    api_base_url: str,
    listen_base_url: str | None,
    active_key_id: str,
    public_keys: list[dict],
    capabilities: dict | list[str],
    private_key: Ed25519PrivateKey,
    now: datetime | None = None,
    software: str = "crate",
    version: str = "0.0.0",
    taxonomy_release: dict | None = None,
) -> dict:
    signed_at = now or datetime.now(timezone.utc)
    capability_names = (
        sorted(str(name) for name, enabled in capabilities.items() if enabled)
        if isinstance(capabilities, dict)
        else sorted({str(name) for name in capabilities})
    )
    normalized_keys = []
    for key in public_keys:
        public_key = key.get("public_key")
        if isinstance(public_key, Ed25519PublicKey):
            public_key = public_key_to_base64(public_key)
        normalized_keys.append(
            {
                "key_id": str(key["key_id"]),
                "algorithm": "ed25519",
                "public_key": str(public_key),
                "status": str(key.get("status") or "active"),
                "not_before": key.get("not_before"),
                "not_after": key.get("not_after"),
            }
        )
    unsigned = {
        "node_uid": str(node_uid),
        "name": display_name,
        "software": software,
        "version": version,
        "api_base_url": api_base_url,
        "listen_base_url": listen_base_url,
        "audience": "public",
        "protocol_version": PROTOCOL_VERSION,
        "min_protocol_version": MIN_PROTOCOL_VERSION,
        "federation_protocol_versions": list(SUPPORTED_PROTOCOL_VERSIONS),
        "signature_profile": SIGNATURE_PROFILE,
        "signature_versions": [SIGNATURE_PROFILE],
        "active_key_id": active_key_id,
        "public_keys": normalized_keys,
        "capabilities": capability_names,
        "taxonomy_release": taxonomy_release,
        "signed_at": signed_at,
        "expires_at": signed_at + timedelta(minutes=5),
        "descriptor_digest": "",
        "key_id": active_key_id,
        "signature": "",
    }
    canonical = canonical_descriptor_bytes(unsigned)
    digest = hashlib.sha256(canonical).hexdigest()
    signature = base64.b64encode(private_key.sign(canonical)).decode("ascii")
    return NodeDescriptorV1.model_validate(
        {**unsigned, "descriptor_digest": digest, "signature": signature}
    ).model_dump(mode="json")


def verify_signed_descriptor(
    payload: dict,
    *,
    local_node_uid: str,
    now: datetime | None = None,
) -> NodeDescriptorV1:
    descriptor = NodeDescriptorV1.model_validate(payload)
    require_remote_node(local_node_uid, descriptor.node_uid)
    negotiate_protocol(descriptor.federation_protocol_versions)
    if descriptor.signature_profile != SIGNATURE_PROFILE:
        raise FederationProtocolError(
            FederationErrorCode.INCOMPATIBLE_VERSION,
            "Unsupported descriptor signature profile",
        )
    current_time = now or datetime.now(timezone.utc)
    if (
        descriptor.expires_at < current_time
        or descriptor.signed_at > current_time + timedelta(seconds=60)
    ):
        raise FederationProtocolError(
            FederationErrorCode.INVALID_DESCRIPTOR,
            "Descriptor is expired or not yet valid",
        )
    matching_key = next(
        (
            key
            for key in descriptor.public_keys
            if key.key_id == descriptor.key_id and key.status in {"active", "retiring"}
        ),
        None,
    )
    if matching_key is None:
        raise FederationProtocolError(
            FederationErrorCode.UNKNOWN_KEY,
            "Descriptor signing key is not published",
        )
    canonical = canonical_descriptor_bytes(descriptor)
    if not secrets.compare_digest(
        descriptor.descriptor_digest,
        hashlib.sha256(canonical).hexdigest(),
    ):
        raise FederationProtocolError(
            FederationErrorCode.INVALID_DESCRIPTOR,
            "Descriptor digest mismatch",
        )
    try:
        public_key = Ed25519PublicKey.from_public_bytes(
            base64.b64decode(matching_key.public_key, validate=True)
        )
        public_key.verify(
            base64.b64decode(descriptor.signature, validate=True), canonical
        )
    except (ValueError, TypeError) as exc:
        raise FederationProtocolError(
            FederationErrorCode.INVALID_DESCRIPTOR,
            "Descriptor signature is invalid",
        ) from exc
    except Exception as exc:
        raise FederationProtocolError(
            FederationErrorCode.INVALID_DESCRIPTOR,
            "Descriptor signature is invalid",
        ) from exc
    return descriptor


def is_valid_key_ref(ref: str) -> bool:
    if not ref:
        return False
    if ref.startswith("/"):
        return False
    if ".." in ref:
        return False
    if " " in ref:
        return False
    if not ref.startswith("federation/keys/"):
        return False
    if not ref.endswith(".pem"):
        return False
    return True


def build_descriptor(
    node_uid: str,
    display_name: str,
    api_base_url: str,
    listen_base_url: str | None,
    active_key_id: str,
    public_keys: list[dict],
    capabilities: dict,
    policy: dict,
    software: str = "crate",
    version: str = "0.0.0",
    federation_protocol_versions: list[str] | None = None,
    signature_versions: list[str] | None = None,
) -> dict:
    if federation_protocol_versions is None:
        federation_protocol_versions = ["v1"]
    if signature_versions is None:
        signature_versions = ["crate-ed25519-v1"]

    return {
        "node_uid": node_uid,
        "name": display_name,
        "software": software,
        "version": version,
        "api_base_url": api_base_url,
        "listen_base_url": listen_base_url,
        "federation_protocol_versions": federation_protocol_versions,
        "signature_versions": signature_versions,
        "active_key_id": active_key_id,
        "public_keys": public_keys,
        "capabilities": capabilities,
        "policy": policy,
    }


def negotiate_versions(
    local_versions: list[str],
    remote_versions: list[str],
) -> str | None:
    """Return the highest mutually supported version, or None."""
    common = set(local_versions) & set(remote_versions)
    if not common:
        return None
    return sorted(common, reverse=True)[0]

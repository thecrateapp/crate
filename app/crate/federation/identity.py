"""Node identity — key generation, local node management, and the public
descriptor endpoint (/.well-known/crate-node).

The descriptor is public metadata. It must never reveal peer lists, users,
credentials, private IPs, filesystem paths, or library contents.
"""

from __future__ import annotations

import logging
import os
import secrets
from datetime import datetime, timezone
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

log = logging.getLogger(__name__)

DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))
KEYS_DIR = DATA_DIR / "federation" / "keys"
KEY_ID_PREFIX = datetime.now(timezone.utc).strftime("%Y-%m")


def ensure_keys_dir() -> Path:
    KEYS_DIR.mkdir(parents=True, exist_ok=True)
    if KEYS_DIR.stat().st_mode & 0o777 != 0o700:
        KEYS_DIR.chmod(0o700)
    return KEYS_DIR


def generate_key_id() -> str:
    suffix = secrets.token_hex(4)
    return f"{KEY_ID_PREFIX}-{suffix}"


def generate_ed25519_key_pair() -> tuple[Ed25519PrivateKey, Ed25519PublicKey]:
    private_key = Ed25519PrivateKey.generate()
    public_key = private_key.public_key()
    return private_key, public_key


def store_private_key(key_id: str, private_key: Ed25519PrivateKey) -> Path:
    ensure_keys_dir()
    pem_path = KEYS_DIR / f"{key_id}.pem"
    pem_bytes = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    pem_path.write_bytes(pem_bytes)
    pem_path.chmod(0o600)
    return pem_path


def load_private_key(key_id: str) -> Ed25519PrivateKey:
    pem_path = KEYS_DIR / f"{key_id}.pem"
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
    import base64

    raw = public_key.public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    return base64.b64encode(raw).decode("ascii")


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

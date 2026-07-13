"""Community directory — import signed peer manifests for discovery.

Phase 6: A directory is an optional signed JSON manifest listing known nodes.
It does NOT auto-grant access, store catalogs, broker streams, or hold keys.
Each peer from the directory still requires explicit admin approval.
"""

from __future__ import annotations

import logging
import base64
import copy
import json
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

log = logging.getLogger(__name__)

MANIFEST_VERSION = "1"
MANIFEST_SIGNATURE_VERSION = "crate-directory-ed25519-v1"


def build_community_manifest(
    nodes: list[dict],
    name: str = "Crate Community",
    description: str = "",
    version: str = MANIFEST_VERSION,
) -> dict:
    return {
        "manifest_version": version,
        "name": name,
        "description": description,
        "nodes": [
            {
                "node_uid": n["node_uid"],
                "name": n.get("name", n.get("display_name", "")),
                "api_base_url": n.get("api_base_url", ""),
                "federation_protocol_versions": n.get(
                    "federation_protocol_versions", ["v1"]
                ),
                "signature_versions": n.get("signature_versions", ["crate-ed25519-v1"]),
                "suggested_preset": n.get("suggested_preset", "discovery"),
            }
            for n in nodes
        ],
    }


def fetch_community_manifest(url: str) -> dict | None:
    return fetch_signed_community_manifest(url)


def fetch_signed_community_manifest(
    url: str,
    trusted_public_keys: list[dict[str, Any]] | None = None,
) -> dict | None:
    import httpx

    try:
        resp = httpx.get(url, timeout=httpx.Timeout(10.0))
        resp.raise_for_status()
        data = resp.json()
        if not _validate_manifest(data):
            log.warning("Invalid community manifest from %s", url)
            return None
        if trusted_public_keys is not None and not validate_signed_manifest(
            data, trusted_public_keys
        ):
            log.warning("Invalid community manifest signature from %s", url)
            return None
        return data
    except Exception as e:
        log.warning("Failed to fetch community manifest from %s: %s", url, e)
        return None


def _validate_manifest(data: dict) -> bool:
    if data.get("manifest_version") != MANIFEST_VERSION:
        return False
    if "nodes" not in data or not isinstance(data["nodes"], list):
        return False
    for node in data["nodes"]:
        if "node_uid" not in node or "api_base_url" not in node:
            return False
    return True


def _manifest_payload(data: dict[str, Any]) -> bytes:
    unsigned = copy.deepcopy(data)
    unsigned.pop("signature", None)
    return json.dumps(unsigned, separators=(",", ":"), sort_keys=True).encode("utf-8")


def sign_community_manifest(
    manifest: dict[str, Any],
    private_key: Ed25519PrivateKey,
    key_id: str,
) -> dict[str, Any]:
    signed = copy.deepcopy(manifest)
    signature = private_key.sign(_manifest_payload(signed))
    signed["signature"] = {
        "version": MANIFEST_SIGNATURE_VERSION,
        "algorithm": "ed25519",
        "key_id": key_id,
        "signature": base64.b64encode(signature).decode("ascii"),
    }
    return signed


def _public_key_from_entry(entry: dict[str, Any]) -> Ed25519PublicKey:
    raw = base64.b64decode(str(entry["public_key"]))
    return Ed25519PublicKey.from_public_bytes(raw)


def validate_signed_manifest(
    manifest: dict[str, Any],
    trusted_public_keys: list[dict[str, Any]],
) -> bool:
    signature = manifest.get("signature")
    if not isinstance(signature, dict):
        return False
    if signature.get("version") != MANIFEST_SIGNATURE_VERSION:
        return False
    key_id = signature.get("key_id")
    key_entry = next(
        (
            key
            for key in trusted_public_keys
            if key.get("key_id") == key_id
            and key.get("status", "active") in {"active", "pending"}
        ),
        None,
    )
    if key_entry is None:
        return False
    try:
        _public_key_from_entry(key_entry).verify(
            base64.b64decode(str(signature["signature"])),
            _manifest_payload(manifest),
        )
        return True
    except (InvalidSignature, ValueError, KeyError):
        return False


def import_nodes_from_manifest(data: dict, dry_run: bool = True) -> list[dict]:
    """Return list of new/discovered nodes from a manifest. Does NOT auto-approve."""
    nodes = data.get("nodes", [])
    discovered = []

    for node in nodes:
        discovered.append(
            {
                "node_uid": node["node_uid"],
                "display_name": node["name"],
                "api_base_url": node["api_base_url"],
                "suggested_preset": node.get("suggested_preset", "discovery"),
                "federation_protocol_versions": node.get(
                    "federation_protocol_versions", ["v1"]
                ),
                "signature_versions": node.get(
                    "signature_versions", ["crate-ed25519-v1"]
                ),
            }
        )

    return discovered


def verify_signed_manifest(url: str, trusted_public_key_b64: str | None = None) -> bool:
    """Verify a signed community manifest. Returns True if valid."""
    data = fetch_community_manifest(url)
    if not data:
        return False

    signature = data.pop("signature", None)
    if not signature:
        log.debug("Manifest has no signature field")
        return False

    if not signature.startswith("ed25519:"):
        return False

    import base64
    import json as _json

    try:
        sig_b64 = signature[7:]
        sig_bytes = base64.b64decode(sig_b64)
    except Exception:
        return False

    canonical = _json.dumps(data, separators=(",", ":"), sort_keys=True).encode("utf-8")

    if trusted_public_key_b64:
        try:
            from cryptography.hazmat.primitives.asymmetric.ed25519 import (
                Ed25519PublicKey,
            )

            pub_bytes = base64.b64decode(trusted_public_key_b64)
            pub_key = Ed25519PublicKey.from_public_bytes(pub_bytes)
            pub_key.verify(sig_bytes, canonical)
            return True
        except Exception:
            return False

    log.debug("No trusted public key provided for manifest verification")
    return False

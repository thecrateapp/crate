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
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import re
from typing import Any
import uuid

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

from crate.federation.client import safe_get
from crate.db.repositories import federation as federation_repo
from crate.db.repositories import federation_directories as directory_repo
from crate.federation.identity import verify_signed_descriptor
from crate.federation.url_policy import FederationURLPolicy

log = logging.getLogger(__name__)

MANIFEST_VERSION = "1"
MANIFEST_SIGNATURE_VERSION = "crate-directory-ed25519-v1"
DIRECTORY_VERSION = "1"
_DESCRIPTOR_DIGEST_RE = re.compile(r"^[0-9a-f]{64}$")


class DirectoryValidationError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class ValidatedDirectoryDocument:
    signing_key_id: str
    issued_at: datetime
    expires_at: datetime
    entries: tuple[dict[str, str], ...]


def _parse_directory_time(value: object, field: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError) as exc:
        raise DirectoryValidationError(f"Directory {field} is invalid") from exc
    if parsed.tzinfo is None:
        raise DirectoryValidationError(f"Directory {field} must include timezone")
    return parsed.astimezone(timezone.utc)


def _directory_payload(document: dict[str, Any]) -> bytes:
    unsigned = copy.deepcopy(document)
    unsigned.pop("signature", None)
    return json.dumps(unsigned, separators=(",", ":"), sort_keys=True).encode("utf-8")


def sign_directory_document(
    document: dict[str, Any], private_key: Ed25519PrivateKey, *, key_id: str
) -> dict[str, Any]:
    signed = copy.deepcopy(document)
    signed["signature"] = {
        "version": MANIFEST_SIGNATURE_VERSION,
        "algorithm": "ed25519",
        "key_id": key_id,
        "signature": base64.b64encode(
            private_key.sign(_directory_payload(signed))
        ).decode("ascii"),
    }
    return signed


def validate_directory_document(
    document: dict[str, Any],
    *,
    trusted_keys: list[dict[str, Any]],
    local_node_uid: str,
    policy: FederationURLPolicy | None = None,
    now: datetime | None = None,
) -> ValidatedDirectoryDocument:
    if document.get("directory_version") != DIRECTORY_VERSION:
        raise DirectoryValidationError("Unsupported directory version")
    signature = document.get("signature")
    if not isinstance(signature, dict):
        raise DirectoryValidationError("Directory signature is missing")
    if (
        signature.get("version") != MANIFEST_SIGNATURE_VERSION
        or signature.get("algorithm") != "ed25519"
    ):
        raise DirectoryValidationError("Directory signature profile is invalid")
    key_id = str(signature.get("key_id") or "")
    key = next(
        (
            item
            for item in trusted_keys
            if item.get("key_id") == key_id and item.get("status", "active") == "active"
        ),
        None,
    )
    if key is None:
        raise DirectoryValidationError("Directory signing key is not trusted")
    try:
        _public_key_from_entry(key).verify(
            base64.b64decode(str(signature.get("signature") or ""), validate=True),
            _directory_payload(document),
        )
    except Exception as exc:
        raise DirectoryValidationError("Directory signature is invalid") from exc

    current = now or datetime.now(timezone.utc)
    issued_at = _parse_directory_time(document.get("issued_at"), "issued_at")
    expires_at = _parse_directory_time(document.get("expires_at"), "expires_at")
    if issued_at > current + timedelta(minutes=5):
        raise DirectoryValidationError("Directory document is not yet valid")
    if expires_at <= current:
        raise DirectoryValidationError("Directory document is expired")
    if expires_at - issued_at > timedelta(days=30):
        raise DirectoryValidationError("Directory document validity is too long")

    raw_entries = document.get("entries")
    if not isinstance(raw_entries, list) or len(raw_entries) > 10_000:
        raise DirectoryValidationError("Directory entries are invalid")
    active_policy = policy or FederationURLPolicy()
    normalized_local = str(uuid.UUID(local_node_uid))
    seen: set[str] = set()
    entries: list[dict[str, str]] = []
    for raw in raw_entries:
        if not isinstance(raw, dict):
            raise DirectoryValidationError("Directory descriptor entry is invalid")
        try:
            node_uid = str(uuid.UUID(str(raw.get("node_uid"))))
        except (TypeError, ValueError, AttributeError) as exc:
            raise DirectoryValidationError("Directory node UID is invalid") from exc
        if node_uid == normalized_local:
            raise DirectoryValidationError("Directory contains the local node")
        if node_uid in seen:
            raise DirectoryValidationError("Directory contains a duplicate node")
        seen.add(node_uid)
        digest = str(raw.get("descriptor_digest") or "").lower()
        if not _DESCRIPTOR_DIGEST_RE.fullmatch(digest):
            raise DirectoryValidationError("Directory descriptor digest is invalid")
        try:
            descriptor_url = active_policy.validate_base_url(
                str(raw.get("descriptor_url") or "")
            ).url
        except ValueError as exc:
            raise DirectoryValidationError(
                "Directory descriptor URL is unsafe"
            ) from exc
        entries.append(
            {
                "node_uid": node_uid,
                "descriptor_url": descriptor_url,
                "descriptor_digest": digest,
            }
        )
    return ValidatedDirectoryDocument(
        signing_key_id=key_id,
        issued_at=issued_at,
        expires_at=expires_at,
        entries=tuple(entries),
    )


def refresh_directory_subscription(
    subscription: dict,
    *,
    policy: FederationURLPolicy | None = None,
) -> dict:
    run = directory_repo.claim_refresh(int(subscription["id"]))
    if run is None:
        return {"status": "already_running"}
    run_uid = str(run["run_uid"])
    headers: dict[str, str] = {}
    if subscription.get("etag"):
        headers["If-None-Match"] = str(subscription["etag"])
    if subscription.get("last_modified"):
        headers["If-Modified-Since"] = str(subscription["last_modified"])
    try:
        response = safe_get(
            str(subscription["url"]),
            policy=policy,
            headers=headers,
            max_response_bytes=4 * 1024 * 1024,
        )
        if response.status_code == 304:
            directory_repo.finish_refresh(
                run_uid,
                status="not_modified",
                http_status=304,
                etag=response.headers.get("etag"),
                last_modified=response.headers.get("last-modified"),
            )
            return {"status": "not_modified", "run_uid": run_uid}
        response.raise_for_status()
        local = federation_repo.get_local_node()
        if local is None:
            raise DirectoryValidationError("Local node is not configured")
        validated = validate_directory_document(
            response.json(),
            trusted_keys=list(subscription.get("trusted_keys_json") or []),
            local_node_uid=str(local["node_uid"]),
            policy=policy,
        )
        changed = 0
        seen: list[str] = []
        for entry in validated.entries:
            descriptor_response = safe_get(
                entry["descriptor_url"],
                policy=policy,
                max_response_bytes=512 * 1024,
            )
            descriptor_response.raise_for_status()
            descriptor = verify_signed_descriptor(
                descriptor_response.json(),
                local_node_uid=str(local["node_uid"]),
            ).model_dump(mode="json")
            if str(descriptor["node_uid"]) != entry["node_uid"]:
                raise DirectoryValidationError("Directory descriptor node mismatch")
            if str(descriptor["descriptor_digest"]) != entry["descriptor_digest"]:
                raise DirectoryValidationError("Directory descriptor digest mismatch")
            candidate = directory_repo.upsert_candidate(
                subscription_id=int(subscription["id"]),
                node_uid=entry["node_uid"],
                descriptor_url=entry["descriptor_url"],
                descriptor_digest=entry["descriptor_digest"],
                display_name=str(descriptor.get("name") or entry["node_uid"]),
                advertised_key_id=str(descriptor.get("active_key_id") or "") or None,
                metadata={
                    "api_base_url": descriptor.get("api_base_url"),
                    "protocol_version": descriptor.get("protocol_version"),
                    "directory_expires_at": validated.expires_at.isoformat(),
                },
            )
            seen.append(entry["node_uid"])
            if candidate["state"] == "changed":
                changed += 1
        directory_repo.mark_unseen_candidates_stale(int(subscription["id"]), seen)
        directory_repo.finish_refresh(
            run_uid,
            status="succeeded",
            http_status=response.status_code,
            signing_key_id=validated.signing_key_id,
            candidates_seen=len(seen),
            candidates_changed=changed,
            etag=response.headers.get("etag"),
            last_modified=response.headers.get("last-modified"),
        )
        return {
            "status": "succeeded",
            "run_uid": run_uid,
            "candidates_seen": len(seen),
            "candidates_changed": changed,
        }
    except Exception as exc:
        code = (
            "validation_failed"
            if isinstance(exc, DirectoryValidationError)
            else "fetch_failed"
        )
        directory_repo.finish_refresh(
            run_uid,
            status="failed",
            error_code=code,
            error_detail=str(exc),
        )
        log.warning(
            "Directory refresh failed for subscription %s: %s",
            subscription.get("subscription_uid"),
            exc,
        )
        return {"status": "failed", "run_uid": run_uid, "error_code": code}


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
    try:
        resp = safe_get(url)
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

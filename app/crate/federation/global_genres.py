"""Signed core taxonomy release and global catalog genre projection."""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from crate.db.jobs.global_catalog_genres import (
    normalize_genre_assertions,
    project_source_genre_assertions,
    recompute_entity_genre_memberships,
    refresh_global_catalog_genre_snapshots,
)


class TaxonomyReleaseError(ValueError):
    pass


@dataclass(frozen=True)
class TaxonomyReleasePaths:
    release: Path
    signature: Path
    trust_roots: Path


def _default_paths() -> TaxonomyReleasePaths:
    data = Path(__file__).resolve().parents[1] / "data" / "taxonomy"
    return TaxonomyReleasePaths(
        release=data / "crate-core-1.0.0.json",
        signature=data / "crate-core-1.0.0.sig.json",
        trust_roots=data / "trust-roots.json",
    )


def _canonical_json(payload: dict[str, Any]) -> bytes:
    return json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode("utf-8")


def _parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def verify_taxonomy_release_files(
    *,
    release: Path,
    signature: Path,
    trust_roots: Path,
    expected_digest: str | None,
    now: datetime | None = None,
) -> dict[str, Any]:
    try:
        payload = json.loads(release.read_text())
        signature_data = json.loads(signature.read_text())
        roots_data = json.loads(trust_roots.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise TaxonomyReleaseError("Taxonomy release files are invalid") from exc
    if payload.get("schema") != "crate-taxonomy-release-v1":
        raise TaxonomyReleaseError("Unsupported taxonomy release schema")
    key_id = str(signature_data.get("key_id") or "")
    root = next(
        (item for item in roots_data.get("roots", []) if item.get("key_id") == key_id),
        None,
    )
    if root is None:
        raise TaxonomyReleaseError("Unknown taxonomy signing root")
    if root.get("status") == "revoked":
        raise TaxonomyReleaseError("Taxonomy signing root is revoked")
    current = now or datetime.now(timezone.utc)
    if current < _parse_time(root["not_before"]) or current > _parse_time(
        root["not_after"]
    ):
        raise TaxonomyReleaseError(
            "Taxonomy signing root is outside its validity window"
        )
    try:
        public_key = Ed25519PublicKey.from_public_bytes(
            base64.b64decode(root["public_key"], validate=True)
        )
        public_key.verify(
            base64.b64decode(signature_data["signature"], validate=True),
            _canonical_json(payload),
        )
    except (InvalidSignature, ValueError, TypeError, KeyError) as exc:
        raise TaxonomyReleaseError("Taxonomy release signature is invalid") from exc
    if payload.get("taxonomy_id") != "crate-core" or payload.get("version") != "1.0.0":
        raise TaxonomyReleaseError("Incompatible taxonomy release")
    if expected_digest and payload.get("taxonomy_digest") != expected_digest:
        raise TaxonomyReleaseError("Taxonomy release digest mismatch")
    return {
        "valid": True,
        "taxonomy_id": payload["taxonomy_id"],
        "version": payload["version"],
        "digest": payload["taxonomy_digest"],
        "key_id": key_id,
        "signature": signature_data["signature"],
        "released_at": payload["released_at"],
    }


verify_taxonomy_release_files.default_paths = _default_paths  # type: ignore[attr-defined]


def verify_shipped_taxonomy_release() -> dict[str, Any]:
    from crate.genre_taxonomy import get_core_taxonomy_descriptor

    paths = _default_paths()
    descriptor = get_core_taxonomy_descriptor(include_release=False)
    return verify_taxonomy_release_files(
        release=paths.release,
        signature=paths.signature,
        trust_roots=paths.trust_roots,
        expected_digest=str(descriptor["digest"]),
    )


def taxonomy_release_health() -> dict[str, Any]:
    try:
        return {"status": "ok", **verify_shipped_taxonomy_release()}
    except TaxonomyReleaseError as exc:
        return {"status": "degraded", "valid": False, "error": str(exc)}


__all__ = [
    "normalize_genre_assertions",
    "project_source_genre_assertions",
    "recompute_entity_genre_memberships",
    "refresh_global_catalog_genre_snapshots",
    "TaxonomyReleaseError",
    "taxonomy_release_health",
    "verify_shipped_taxonomy_release",
    "verify_taxonomy_release_files",
]

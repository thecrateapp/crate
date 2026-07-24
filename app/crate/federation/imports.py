"""Federated import policy, manifests and persistence facade."""

from __future__ import annotations

import hashlib
import json
import re
import base64
from pathlib import Path
from pathlib import PurePosixPath
from urllib.parse import urlsplit

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

from crate.db.repositories.federation_imports import (
    approve_import_request,
    create_import_request,
    deny_import_request,
    get_import_request,
    list_import_requests,
    record_import_provenance,
    update_import_request,
)
from crate.federation.grants import preset_allows


def can_request_import(peer: dict) -> tuple[bool, str | None]:
    preset = peer.get("default_grant_preset", "discovery")
    if not preset_allows(preset, "import.request"):
        return False, "peer does not have import.request grant"
    return True, None


def safe_staging_relative_path(value: str) -> PurePosixPath:
    path = PurePosixPath(value)
    if (
        path.is_absolute()
        or not path.parts
        or any(part in {"", ".", ".."} for part in path.parts)
    ):
        raise ValueError("Import staging path must be relative and normalized")
    return path


def validate_import_manifest(manifest: dict, *, max_bytes: int) -> dict:
    if manifest.get("schema") != "crate-import-manifest-v1":
        raise ValueError("Unsupported import manifest schema")
    tracks = manifest.get("tracks")
    if not isinstance(tracks, list) or not tracks:
        raise ValueError("Import manifest must contain tracks")
    total = 0
    seen: set[str] = set()
    for track in tracks:
        if not isinstance(track, dict):
            raise ValueError("Invalid import track")
        entity_uid = str(track.get("entity_uid") or "")
        if not entity_uid or entity_uid in seen:
            raise ValueError("Import track IDs must be unique")
        seen.add(entity_uid)
        size = int(track.get("size_bytes") or 0)
        if size <= 0:
            raise ValueError("Import track size must be positive")
        total += size
        if not re.fullmatch(r"[0-9a-f]{64}", str(track.get("sha256") or "")):
            raise ValueError("Import track requires a SHA-256 digest")
        parsed = urlsplit(str(track.get("url") or ""))
        if parsed.scheme or parsed.netloc or parsed.fragment:
            raise ValueError("Import track URL must be relative")
        if not parsed.path.startswith("/api/federation/v1/import-files/"):
            raise ValueError("Import track URL is outside the fixed import path")
        if any(part == ".." for part in PurePosixPath(parsed.path).parts):
            raise ValueError("Import track URL cannot traverse paths")
    if total != int(manifest.get("total_bytes") or 0):
        raise ValueError("Import manifest total_bytes mismatch")
    if total > max(0, int(max_bytes)):
        raise ValueError("Import manifest exceeds the configured byte limit")
    return manifest


def import_manifest_digest(manifest: dict) -> str:
    canonical = json.dumps(
        manifest,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(canonical).hexdigest()}"


def sign_import_manifest(
    manifest: dict,
    *,
    key_id: str,
    private_key: Ed25519PrivateKey,
) -> dict:
    canonical = json.dumps(
        manifest,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode("utf-8")
    return {
        "manifest": manifest,
        "key_id": key_id,
        "signature": base64.b64encode(private_key.sign(canonical)).decode("ascii"),
        "manifest_digest": f"sha256:{hashlib.sha256(canonical).hexdigest()}",
    }


def verify_signed_import_manifest(
    envelope: dict,
    *,
    public_key: Ed25519PublicKey,
    max_bytes: int,
) -> dict:
    manifest = envelope.get("manifest")
    if not isinstance(manifest, dict):
        raise ValueError("Import manifest envelope is invalid")
    canonical = json.dumps(
        manifest,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode("utf-8")
    digest = f"sha256:{hashlib.sha256(canonical).hexdigest()}"
    if envelope.get("manifest_digest") != digest:
        raise ValueError("Import manifest digest mismatch")
    try:
        public_key.verify(
            base64.b64decode(str(envelope.get("signature") or ""), validate=True),
            canonical,
        )
    except (InvalidSignature, ValueError, TypeError) as exc:
        raise ValueError("Import manifest signature is invalid") from exc
    return validate_import_manifest(manifest, max_bytes=max_bytes)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_album_import_manifest(remote_album_uid: str) -> dict:
    from crate.db.repositories.library import (
        get_library_album_by_entity_uid,
        get_library_tracks,
    )

    album = get_library_album_by_entity_uid(remote_album_uid)
    if not album:
        raise ValueError("Album not found")
    tracks = []
    total_bytes = 0
    for track in get_library_tracks(int(album["id"])):
        entity_uid = str(track.get("entity_uid") or "")
        path = Path(str(track.get("path") or ""))
        if not entity_uid or not path.is_file():
            continue
        size = path.stat().st_size
        total_bytes += size
        tracks.append(
            {
                "entity_uid": entity_uid,
                "title": track.get("title") or track.get("filename"),
                "track_number": track.get("track_number"),
                "disc_number": track.get("disc_number"),
                "format": track.get("format"),
                "size_bytes": size,
                "sha256": _sha256_file(path),
                "url": f"/api/federation/v1/import-files/{entity_uid}",
            }
        )
    if not tracks:
        raise ValueError("Album has no importable tracks")
    return {
        "schema": "crate-import-manifest-v1",
        "album_uid": remote_album_uid,
        "title": album.get("name"),
        "artist": album.get("artist"),
        "total_bytes": total_bytes,
        "tracks": tracks,
    }


__all__ = [
    "approve_import_request",
    "can_request_import",
    "create_import_request",
    "deny_import_request",
    "get_import_request",
    "list_import_requests",
    "import_manifest_digest",
    "build_album_import_manifest",
    "record_import_provenance",
    "update_import_request",
    "safe_staging_relative_path",
    "sign_import_manifest",
    "validate_import_manifest",
    "verify_signed_import_manifest",
]

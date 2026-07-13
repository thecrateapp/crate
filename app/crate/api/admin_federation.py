"""Admin federation endpoints — peer management, pairing, grants, subjects, audit.

All endpoints require authentication. Specific capabilities gate each action.
"""

from __future__ import annotations

import json as _json
import logging
import secrets

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from crate.api.openapi_responses import AUTH_ERROR_RESPONSES, error_response
from crate.api.permissions import require_any_permission, require_permission
from crate.db.repositories import federation as repo
from crate.federation.client import fetch_descriptor
from crate.federation.grants import (
    PRESET_NAMES,
    resolve_preset,
)
from crate.federation.identity import (
    ensure_keys_dir,
    generate_ed25519_key_pair,
    generate_key_id,
    store_private_key,
)


# ── Pydantic request bodies ───────────────────────────────────────────────


class ProbeBody(BaseModel):
    url: str


class PairingStartBody(BaseModel):
    url: str


class PresetPatchBody(BaseModel):
    preset: str


class LimitsPatchBody(BaseModel):
    max_streams: int | None = None
    daily_bytes: int | None = None
    max_results: int | None = None


class KeyChangeBody(BaseModel):
    new_key_id: str


class URLUpdateBody(BaseModel):
    api_base_url: str


class BlockSubjectBody(BaseModel):
    reason: str | None = None


class DirectoryImportBody(BaseModel):
    url: str
    trusted_public_key: str = ""
    trusted_key_id: str = "directory"


# ═══════════════════════════════════════════════════════════════════════════

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/federation", tags=["federation"])

_RESPONSES = {
    **AUTH_ERROR_RESPONSES,
    400: error_response("Bad request."),
    403: error_response("You do not have the required capability."),
    404: error_response("Peer, subject, or request not found."),
}


def _require_nodes_view(request: Request):
    return require_permission(request, "federation.nodes.view")


def _require_nodes_manage(request: Request):
    return require_permission(request, "federation.nodes.manage")


def _public_local_node(node: dict | None) -> dict | None:
    if node is None:
        return None
    safe = dict(node)
    safe.pop("private_key_ref", None)
    return safe


# ── Status ────────────────────────────────────────────────────────────────


@router.get("/status")
def get_status(request: Request):
    _require_nodes_view(request)
    node = repo.get_local_node()
    peers = repo.list_peers()
    pending = [p for p in peers if p["trust_state"] == "pending"]

    return {
        "local_node": _public_local_node(node),
        "peer_count": len(peers),
        "approved_peer_count": len(
            [p for p in peers if p["trust_state"] == "approved"]
        ),
        "pending_pairing_count": len(pending),
        "peers": peers,
    }


# ── Nodes (peers) ─────────────────────────────────────────────────────────


@router.get("/nodes")
def list_nodes(request: Request):
    _require_nodes_view(request)
    return repo.list_peers()


@router.post("/nodes/probe")
def probe_node(body: ProbeBody, request: Request):
    _require_nodes_view(request)

    url = body.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="url is required")

    descriptor = fetch_descriptor(url)
    if descriptor is None:
        raise HTTPException(
            status_code=404, detail=f"Could not fetch descriptor from {url}"
        )

    return {
        "url": url,
        "descriptor": descriptor,
    }


# ── Pairing ───────────────────────────────────────────────────────────────


@router.post("/pairing/start")
def start_pairing(body: PairingStartBody, request: Request):
    _require_nodes_manage(request)

    url = body.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="url is required")

    descriptor = fetch_descriptor(url)
    if descriptor is None:
        raise HTTPException(
            status_code=400, detail=f"Could not fetch descriptor from {url}"
        )

    remote_node_uid = descriptor.get("node_uid")
    remote_public_key = None
    public_keys = descriptor.get("public_keys", [])
    if public_keys:
        remote_public_key = public_keys[0].get("public_key")

    challenge = secrets.token_hex(16)
    pairing = repo.create_pairing_request(
        remote_base_url=url,
        challenge=challenge,
        remote_node_uid=remote_node_uid,
        remote_public_key=remote_public_key,
    )

    peer = None
    if remote_node_uid:
        peer = repo.upsert_peer(
            node_uid=remote_node_uid,
            display_name=descriptor.get("name", remote_node_uid),
            api_base_url=descriptor.get("api_base_url", url),
            listen_base_url=descriptor.get("listen_base_url"),
            active_key_id=descriptor.get("active_key_id", ""),
            public_keys_json=public_keys,
            capabilities_json=descriptor.get("capabilities", {}),
            trust_state="pending",
        )

    repo.record_audit_event(
        event_type="pairing.started",
        status="pending",
        node_uid=remote_node_uid,
        metadata={"url": url, "request_uid": pairing["request_uid"]},
    )

    return {
        "pairing": pairing,
        "peer": peer,
        "descriptor": descriptor,
    }


@router.post("/pairing/{request_uid}/approve")
def approve_pairing(request_uid: str, request: Request):
    _require_nodes_manage(request)

    pairing = repo.get_pairing_request(request_uid)
    if not pairing:
        raise HTTPException(status_code=404, detail="Pairing request not found")

    if pairing["status"] != "pending":
        raise HTTPException(status_code=400, detail="Pairing request is not pending")

    approved = repo.approve_pairing_request(request_uid)
    node_uid = pairing.get("remote_node_uid")
    if node_uid:
        repo.update_peer(node_uid, trust_state="approved")

    repo.record_audit_event(
        event_type="pairing.approved",
        status="approved",
        node_uid=node_uid,
        metadata={"request_uid": request_uid},
    )

    return approved


# ── Peer management ───────────────────────────────────────────────────────


@router.post("/nodes/{node_uid}/disable")
def disable_node(node_uid: str, request: Request):
    _require_nodes_manage(request)

    peer = repo.get_peer(node_uid)
    if not peer:
        raise HTTPException(status_code=404, detail="Peer not found")

    repo.disable_peer(node_uid)

    from crate.federation.stream_proxy import revoke_peer_tickets

    revoked = revoke_peer_tickets(node_uid)
    log.info("Revoked %d active tickets for disabled peer %s", revoked, node_uid)

    repo.record_audit_event(
        event_type="peer.disabled",
        status="disabled",
        node_uid=node_uid,
        metadata={"tickets_revoked": revoked},
    )
    return {"status": "ok"}


@router.post("/nodes/{node_uid}/rotate-local-key")
def rotate_local_key(node_uid: str, request: Request):
    _require_nodes_manage(request)

    local = repo.get_local_node()
    if not local or local["node_uid"] != node_uid:
        raise HTTPException(status_code=403, detail="Can only rotate local node key")

    ensure_keys_dir()
    key_id = generate_key_id()
    private_key, public_key = generate_ed25519_key_pair()
    store_private_key(key_id, private_key)

    from crate.federation.identity import public_key_to_base64

    public_key_b64 = public_key_to_base64(public_key)

    repo.update_local_node(
        node_uid,
        active_key_id=key_id,
        private_key_ref=f"federation/keys/{key_id}.pem",
        public_keys_json=[
            {
                "key_id": key_id,
                "algorithm": "ed25519",
                "public_key": public_key_b64,
                "status": "active",
                "not_before": None,
                "not_after": None,
            }
        ],
    )

    repo.record_audit_event(
        event_type="key.rotated",
        status="success",
        node_uid=node_uid,
        metadata={"key_id": key_id},
    )

    return {
        "key_id": key_id,
        "public_key": public_key_b64,
    }


@router.patch("/nodes/{node_uid}/preset")
def update_peer_preset(node_uid: str, body: PresetPatchBody, request: Request):
    _require_nodes_manage(request)

    preset = body.preset.lower()
    if preset not in PRESET_NAMES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid preset: {preset}. Valid: {', '.join(PRESET_NAMES)}",
        )

    peer = repo.get_peer(node_uid)
    if not peer:
        raise HTTPException(status_code=404, detail="Peer not found")

    resolved = resolve_preset(preset)
    repo.update_peer(node_uid, default_grant_preset=preset)

    repo.upsert_peer_grant(
        node_uid=node_uid,
        principal_selector=f"peer_users:{node_uid}",
        preset=preset,
        capabilities_json=resolved.get("capabilities", []),
        constraints_json=resolved.get("constraints", {}),
    )

    repo.record_audit_event(
        event_type="grant.preset_changed",
        status="success",
        node_uid=node_uid,
        metadata={"preset": preset},
    )

    return {"preset": preset, "resolved": resolved}


@router.patch("/nodes/{node_uid}/limits")
def update_peer_limits(node_uid: str, body: LimitsPatchBody, request: Request):
    _require_nodes_manage(request)

    peer = repo.get_peer(node_uid)
    if not peer:
        raise HTTPException(status_code=404, detail="Peer not found")

    policy_updates = {}
    if body.max_streams is not None:
        policy_updates["max_streams"] = body.max_streams
    if body.daily_bytes is not None:
        policy_updates["daily_bytes"] = body.daily_bytes
    if body.max_results is not None:
        policy_updates["max_results"] = body.max_results

    if policy_updates:
        existing_policy = (
            _json.loads(peer["policy_json"])
            if isinstance(peer["policy_json"], str)
            else peer["policy_json"]
        )
        existing_policy.update(policy_updates)
        repo.update_peer(node_uid, policy_json=existing_policy)

    repo.record_audit_event(
        event_type="peer.limits_updated",
        status="success",
        node_uid=node_uid,
        metadata=policy_updates,
    )
    return {"limits": policy_updates}


@router.post("/sync-catalog")
def sync_all_peer_catalogs(request: Request):
    require_permission(request, "federation.catalog.sync.manage")

    from crate.db.repositories.tasks import create_task

    task_id = create_task("federation_sync_catalog", {"triggered_by": "admin"})
    repo.record_audit_event(
        event_type="catalog.sync_all.queued",
        status="queued",
        metadata={"task_id": task_id},
    )
    return {"task_id": task_id, "status": "queued"}


@router.post("/nodes/{node_uid}/sync-catalog")
def sync_peer_catalog(node_uid: str, request: Request):
    require_permission(request, "federation.catalog.sync.manage")

    peer = repo.get_peer(node_uid)
    if not peer:
        raise HTTPException(status_code=404, detail="Peer not found")
    if peer.get("disabled_at") or peer.get("trust_state") != "approved":
        raise HTTPException(status_code=403, detail="Peer is not approved")

    from crate.db.repositories.tasks import create_task

    task_id = create_task("federation_sync_catalog", {"node_uid": node_uid})
    repo.record_audit_event(
        event_type="catalog.sync.queued",
        status="queued",
        node_uid=node_uid,
        metadata={"task_id": task_id},
    )
    return {"task_id": task_id, "status": "queued"}


@router.post("/nodes/{node_uid}/approve-key-change")
def approve_key_change(node_uid: str, body: KeyChangeBody, request: Request):
    _require_nodes_manage(request)

    if not body.new_key_id:
        raise HTTPException(status_code=400, detail="new_key_id required")

    repo.update_peer(node_uid, active_key_id=body.new_key_id, trust_state="approved")
    repo.record_audit_event(
        event_type="key.change_approved",
        status="success",
        node_uid=node_uid,
        metadata={"new_key_id": body.new_key_id},
    )
    return {"status": "ok"}


@router.post("/nodes/{node_uid}/update-base-url")
def update_base_url(node_uid: str, body: URLUpdateBody, request: Request):
    _require_nodes_manage(request)

    if not body.api_base_url:
        raise HTTPException(status_code=400, detail="api_base_url required")

    repo.update_peer(node_uid, api_base_url=body.api_base_url)
    repo.record_audit_event(
        event_type="peer.url_changed",
        status="success",
        node_uid=node_uid,
        metadata={"new_url": body.api_base_url},
    )
    return {"status": "ok"}


# ── Subjects ──────────────────────────────────────────────────────────────


@router.get("/nodes/{node_uid}/subjects")
def list_subjects(node_uid: str, request: Request):
    _require_nodes_view(request)
    return repo.list_remote_subjects(node_uid)


@router.post("/nodes/{node_uid}/subjects/{subject_hash}/block")
def block_subject(
    node_uid: str, subject_hash: str, body: BlockSubjectBody, request: Request
):
    _require_nodes_manage(request)

    subject = repo.block_remote_subject(node_uid, subject_hash, body.reason)
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")

    from crate.federation.stream_proxy import revoke_subject_tickets

    revoked = revoke_subject_tickets(node_uid, subject_hash)
    log.info(
        "Revoked %d active tickets for blocked subject %s/%s",
        revoked,
        node_uid,
        subject_hash,
    )

    repo.record_audit_event(
        event_type="subject.blocked",
        status="blocked",
        node_uid=node_uid,
        metadata={
            "subject_hash": subject_hash,
            "reason": body.reason,
            "tickets_revoked": revoked,
        },
    )

    return subject


@router.post("/nodes/{node_uid}/subjects/{subject_hash}/unblock")
def unblock_subject(node_uid: str, subject_hash: str, request: Request):
    _require_nodes_manage(request)

    subject = repo.unblock_remote_subject(node_uid, subject_hash)
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")

    repo.record_audit_event(
        event_type="subject.unblocked",
        status="unblocked",
        node_uid=node_uid,
        metadata={"subject_hash": subject_hash},
    )

    return subject


# ── Audit ─────────────────────────────────────────────────────────────────


@router.get("/audit")
def get_audit_events(
    request: Request,
    node_uid: str | None = Query(None),
    event_type: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
):
    _require_nodes_view(request)
    require_any_permission(request, ["federation.audit.view", "federation.nodes.view"])
    return repo.list_audit_events(
        node_uid=node_uid,
        event_type=event_type,
        limit=limit,
    )


# ── Streaming stats ───────────────────────────────────────────────────────


@router.get("/streaming-stats")
def streaming_stats(request: Request):
    _require_nodes_view(request)

    from crate.federation.quotas import (
        get_active_stream_count,
        get_daily_bytes,
    )

    peers = repo.list_peers(trust_state="approved")
    stats = []
    from crate.db.cache_runtime import get_redis

    redis_client = get_redis()
    if redis_client is None:
        raise HTTPException(status_code=503, detail="Redis is required for federation")

    for peer in peers:
        nuid = peer["node_uid"]
        stats.append(
            {
                "node_uid": nuid,
                "display_name": peer["display_name"],
                "preset": peer["default_grant_preset"],
                "active_streams": get_active_stream_count(redis_client, nuid),
                "daily_bytes": get_daily_bytes(redis_client, nuid),
            }
        )

    return {"peers": stats}


# ── Import management ─────────────────────────────────────────────────────


@router.get("/import-requests")
def list_import_requests_endpoint(
    request: Request,
    node_uid: str | None = None,
    status: str | None = None,
):
    _require_nodes_view(request)
    from crate.federation.imports import list_import_requests

    return list_import_requests(node_uid=node_uid, status=status)


@router.post("/import-requests/{request_id}/approve")
def approve_import_endpoint(request_id: str, request: Request):
    require_permission(request, "federation.import.manage")
    from crate.db.repositories.tasks import create_task
    from crate.federation.imports import (
        approve_import_request,
        get_import_request,
        update_import_request,
    )

    user = request.state.user
    existing = get_import_request(request_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Import request not found")

    result = approve_import_request(request_id, approved_by_user_id=user.get("id", 0))
    if not result:
        raise HTTPException(status_code=404, detail="Import request not found")

    task_id = create_task(
        "federation_import_album",
        {
            "request_id": request_id,
            "node_uid": str(existing["node_uid"]),
            "remote_entity_uid": existing["remote_entity_uid"],
            "title": existing["title"],
            "requested_by_user_id": existing.get("requested_by_user_id"),
        },
    )
    result = (
        update_import_request(
            request_id,
            status="queued",
            metadata_patch={"task_id": task_id},
        )
        or result
    )
    repo.record_audit_event(
        event_type="import.approved",
        status="approved",
        metadata={"request_id": request_id, "task_id": task_id},
    )
    return result


@router.post("/import-requests/{request_id}/deny")
def deny_import_endpoint(request_id: str, request: Request):
    require_permission(request, "federation.import.manage")
    from crate.federation.imports import deny_import_request

    result = deny_import_request(request_id)
    if not result:
        raise HTTPException(status_code=404, detail="Import request not found")
    return result


# ── Community directory ───────────────────────────────────────────────────


@router.post("/directory/import")
def import_community_directory(body: DirectoryImportBody, request: Request):
    _require_nodes_manage(request)

    url = body.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="url is required")
    trusted_public_key = body.trusted_public_key.strip()
    if not trusted_public_key:
        raise HTTPException(
            status_code=400,
            detail="trusted_public_key is required for signed directory manifests",
        )

    from crate.federation.directory import (
        fetch_signed_community_manifest,
        import_nodes_from_manifest,
    )

    manifest = fetch_signed_community_manifest(
        url,
        trusted_public_keys=[
            {
                "key_id": body.trusted_key_id.strip() or "directory",
                "algorithm": "ed25519",
                "public_key": trusted_public_key,
                "status": "active",
            }
        ],
    )
    if not manifest:
        raise HTTPException(
            status_code=400, detail="Invalid or unreachable community manifest"
        )

    discovered = import_nodes_from_manifest(manifest, dry_run=False)

    results = []
    for node in discovered:
        existing = repo.get_peer(node["node_uid"])
        if not existing:
            repo.upsert_peer(
                node_uid=node["node_uid"],
                display_name=node["display_name"],
                api_base_url=node["api_base_url"],
                active_key_id="",
                trust_state="pending",
                default_grant_preset=node["suggested_preset"],
            )
            results.append(
                {
                    "node_uid": node["node_uid"],
                    "status": "pending",
                    "name": node["display_name"],
                }
            )
        else:
            results.append(
                {
                    "node_uid": node["node_uid"],
                    "status": "already_known",
                    "name": existing["display_name"],
                }
            )

    repo.record_audit_event(
        event_type="directory.imported",
        status="success",
        metadata={
            "url": url,
            "discovered": len(discovered),
            "new": len([r for r in results if r["status"] == "pending"]),
        },
    )

    return {
        "manifest_name": manifest.get("name", ""),
        "nodes": results,
    }

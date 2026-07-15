"""Admin federation endpoints — peer management, pairing, grants, subjects, audit.

All endpoints require authentication. Specific capabilities gate each action.
"""

from __future__ import annotations

import json as _json
import logging
import secrets
import base64
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from crate.api.openapi_responses import AUTH_ERROR_RESPONSES, error_response
from crate.api.permissions import require_any_permission, require_permission
from crate.db.repositories import federation as repo
from crate.db.repositories import federation_trust as trust_repo
from crate.db.repositories import federation_directories as directory_repo
from crate.db.repositories import federation_risk as risk_repo
from crate.db.repositories import federation_stream_tickets as stream_ticket_repo
from crate.federation.client import fetch_descriptor, safe_post_json
from crate.federation.grants import (
    PRESET_NAMES,
    resolve_preset,
)
from crate.federation.identity import (
    load_private_key,
)
from crate.federation.events import signal_active_stream_revocations
from crate.federation.key_verify import get_key_material_health
from crate.federation.key_rotation import (
    activate_local_rotation,
    announce_local_rotation,
    cancel_local_rotation,
    prepare_local_rotation,
    retire_local_rotation,
)
from crate.federation.pairing import (
    build_acceptance,
    build_offer,
    verify_ack,
)


# ── Pydantic request bodies ───────────────────────────────────────────────


class ProbeBody(BaseModel):
    url: str


class PairingStartBody(BaseModel):
    url: str
    outbound_grant: str = "discovery"


class PairingApprovalBody(BaseModel):
    outbound_grant: str = "discovery"


class RotationStartBody(BaseModel):
    activate_in_seconds: int = Field(default=300, ge=30, le=86400)
    grace_seconds: int = Field(default=3600, ge=300, le=604800)


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


class DirectorySubscriptionBody(BaseModel):
    url: str
    trusted_key_id: str = Field(min_length=1, max_length=160)
    trusted_public_key: str = Field(min_length=1, max_length=512)
    refresh_interval_seconds: int = Field(default=3600, ge=300, le=604800)


class DirectorySubscriptionStateBody(BaseModel):
    state: str


class DirectoryCandidatePairBody(BaseModel):
    outbound_grant: str = "discovery"


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
        "key_health": get_key_material_health(),
        "peers": peers,
    }


@router.get("/health")
def get_federation_health(request: Request):
    _require_nodes_view(request)
    from crate.federation.health import federation_health_snapshot

    return federation_health_snapshot()


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

    local = repo.get_local_node()
    descriptor = fetch_descriptor(
        url,
        local_node_uid=str(local["node_uid"]) if local else "",
    )
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

    local = repo.get_local_node()
    if local is None:
        raise HTTPException(status_code=503, detail="Local node not configured")
    descriptor = fetch_descriptor(url, local_node_uid=str(local["node_uid"]))
    if descriptor is None:
        raise HTTPException(
            status_code=400, detail=f"Could not fetch descriptor from {url}"
        )

    if body.outbound_grant not in PRESET_NAMES:
        raise HTTPException(status_code=400, detail="Invalid outbound grant preset")
    from crate.api.federation import _build_local_descriptor

    local_descriptor = _build_local_descriptor(request)
    active_key = trust_repo.get_active_local_key()
    if active_key is None:
        raise HTTPException(
            status_code=503, detail="Federation signing key unavailable"
        )
    challenge = secrets.token_hex(16)
    offer = build_offer(
        source_descriptor=local_descriptor,
        target_descriptor=descriptor,
        challenge=challenge,
        private_key=load_private_key(active_key["key_id"]),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
        outbound_grant=body.outbound_grant,
    )
    remote_node_uid = str(descriptor["node_uid"])
    pairing = trust_repo.create_pairing(
        pairing_uid=offer["pairing_uid"],
        remote_base_url=url,
        remote_node_uid=remote_node_uid,
        direction="outbound",
        state="offered",
        local_challenge=challenge,
        negotiated_protocol=descriptor["protocol_version"],
        signature_profile=descriptor["signature_profile"],
        descriptor_digest=descriptor["descriptor_digest"],
        offer_json=offer,
        expires_at=datetime.fromisoformat(offer["expires_at"]),
    )
    public_keys = descriptor.get("public_keys", [])
    for key in public_keys:
        trust_repo.upsert_peer_key(
            node_uid=remote_node_uid,
            key_id=key["key_id"],
            public_key=key["public_key"],
            status=key["status"],
            not_before=datetime.fromisoformat(key["not_before"])
            if key.get("not_before")
            else None,
            not_after=datetime.fromisoformat(key["not_after"])
            if key.get("not_after")
            else None,
        )
    peer = repo.upsert_peer(
        node_uid=remote_node_uid,
        display_name=descriptor.get("name", remote_node_uid),
        api_base_url=descriptor.get("api_base_url", url),
        listen_base_url=descriptor.get("listen_base_url"),
        active_key_id=descriptor.get("active_key_id", ""),
        public_keys_json=public_keys,
        capabilities_json={name: True for name in descriptor.get("capabilities", [])},
        trust_state="pending",
        direction="outbound",
        default_grant_preset=body.outbound_grant,
    )
    try:
        response = safe_post_json(
            url,
            "/api/federation/v1/pairing/offers",
            offer,
        )
        response.raise_for_status()
    except Exception as exc:
        trust_repo.update_pairing(
            str(pairing["pairing_uid"]),
            expected_states={"offered"},
            state="failed",
            failure_reason=str(exc)[:500],
        )
        raise HTTPException(
            status_code=502, detail="Remote pairing offer failed"
        ) from exc

    repo.record_audit_event(
        event_type="pairing.started",
        status="pending",
        node_uid=remote_node_uid,
        metadata={"url": url, "pairing_uid": str(pairing["pairing_uid"])},
    )

    return {
        "pairing": pairing,
        "peer": peer,
        "descriptor": descriptor,
    }


@router.post("/pairing/{request_uid}/approve")
def approve_pairing(
    request_uid: str,
    request: Request,
    body: PairingApprovalBody | None = None,
):
    _require_nodes_manage(request)
    body = body or PairingApprovalBody()

    pairing = trust_repo.get_pairing(request_uid)
    if not pairing:
        raise HTTPException(status_code=404, detail="Pairing request not found")

    if pairing["direction"] != "inbound" or pairing["state"] != "remote_pending":
        raise HTTPException(status_code=400, detail="Pairing request is not pending")
    if body.outbound_grant not in PRESET_NAMES:
        raise HTTPException(status_code=400, detail="Invalid outbound grant preset")

    from crate.api.federation import _build_local_descriptor
    from crate.api.schemas.federation import PairingOfferV1

    offer = PairingOfferV1.model_validate(pairing["offer_json"])
    local_descriptor = _build_local_descriptor(request)
    active_key = trust_repo.get_active_local_key()
    if active_key is None:
        raise HTTPException(
            status_code=503, detail="Federation signing key unavailable"
        )
    acceptance = build_acceptance(
        offer=offer,
        source_descriptor=local_descriptor,
        challenge=secrets.token_hex(16),
        private_key=load_private_key(active_key["key_id"]),
        outbound_grant=body.outbound_grant,
    )
    trust_repo.update_pairing(
        request_uid,
        expected_states={"remote_pending"},
        state="accepted",
        remote_challenge=acceptance["challenge"],
        acceptance_json=acceptance,
        verified_at=datetime.now(timezone.utc),
    )
    try:
        response = safe_post_json(
            pairing["remote_base_url"],
            "/api/federation/v1/pairing/acceptances",
            acceptance,
        )
        response.raise_for_status()
        verify_ack(
            response.json(),
            pairing_acceptance=acceptance,
            local_descriptor=local_descriptor,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Remote pairing acceptance failed; retry approval",
        ) from exc
    approved = trust_repo.update_pairing(
        request_uid,
        expected_states={"accepted"},
        state="completed",
        completed_at=datetime.now(timezone.utc),
    )
    node_uid = str(pairing["remote_node_uid"])
    repo.update_peer(
        node_uid,
        trust_state="approved",
        default_grant_preset=body.outbound_grant,
    )
    resolved_grant = resolve_preset(body.outbound_grant)
    repo.upsert_peer_grant(
        node_uid=node_uid,
        principal_selector=f"peer_users:{node_uid}",
        preset=body.outbound_grant,
        capabilities_json=resolved_grant["capabilities"],
        constraints_json=resolved_grant["constraints"],
    )

    repo.record_audit_event(
        event_type="pairing.approved",
        status="approved",
        node_uid=node_uid,
        metadata={"pairing_uid": request_uid},
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

    signalled = signal_active_stream_revocations(node_uid=node_uid)
    revoked = revoke_peer_tickets(node_uid)
    log.info("Revoked %d active tickets for disabled peer %s", revoked, node_uid)

    repo.record_audit_event(
        event_type="peer.disabled",
        status="disabled",
        node_uid=node_uid,
        metadata={"tickets_revoked": revoked, "streams_signalled": signalled},
    )
    return {"status": "ok"}


@router.post("/nodes/{node_uid}/rotate-local-key")
def rotate_local_key(
    node_uid: str,
    request: Request,
    body: RotationStartBody | None = None,
):
    _require_nodes_manage(request)
    body = body or RotationStartBody()

    local = repo.get_local_node()
    if not local or str(local["node_uid"]) != node_uid:
        raise HTTPException(status_code=403, detail="Can only rotate local node key")

    activate_at = datetime.now(timezone.utc) + timedelta(
        seconds=body.activate_in_seconds
    )
    rotation = prepare_local_rotation(
        node_uid=node_uid,
        activate_at=activate_at,
        grace_until=activate_at + timedelta(seconds=body.grace_seconds),
    )
    rotation = announce_local_rotation(str(rotation["rotation_uid"]))

    repo.record_audit_event(
        event_type="key.rotation_announced",
        status="announced",
        node_uid=node_uid,
        metadata={
            "rotation_uid": str(rotation["rotation_uid"]),
            "new_key_id": rotation["new_key_id"],
            "activate_at": rotation["activate_at"],
            "grace_until": rotation["grace_until"],
        },
    )
    return rotation


@router.post("/key-rotations/{rotation_uid}/activate")
def activate_key_rotation(rotation_uid: str, request: Request):
    _require_nodes_manage(request)
    return activate_local_rotation(rotation_uid)


@router.post("/key-rotations/{rotation_uid}/retire")
def retire_key_rotation(rotation_uid: str, request: Request):
    _require_nodes_manage(request)
    return retire_local_rotation(rotation_uid)


@router.post("/key-rotations/{rotation_uid}/cancel")
def cancel_key_rotation(rotation_uid: str, request: Request):
    _require_nodes_manage(request)
    return cancel_local_rotation(rotation_uid)


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
    signalled = signal_active_stream_revocations(node_uid=node_uid)
    repo.update_peer(node_uid, default_grant_preset=preset)

    repo.upsert_peer_grant(
        node_uid=node_uid,
        principal_selector=f"peer_users:{node_uid}",
        preset=preset,
        capabilities_json=resolved.get("capabilities", []),
        constraints_json=resolved.get("constraints", {}),
    )
    from crate.federation.stream_proxy import revoke_peer_tickets

    revoked = revoke_peer_tickets(node_uid)

    repo.record_audit_event(
        event_type="grant.preset_changed",
        status="success",
        node_uid=node_uid,
        metadata={
            "preset": preset,
            "tickets_revoked": revoked,
            "streams_signalled": signalled,
        },
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
        signalled = signal_active_stream_revocations(node_uid=node_uid)
        existing_policy = (
            _json.loads(peer["policy_json"])
            if isinstance(peer["policy_json"], str)
            else peer["policy_json"]
        )
        existing_policy.update(policy_updates)
        repo.update_peer(node_uid, policy_json=existing_policy)
        from crate.federation.stream_proxy import revoke_peer_tickets

        revoked = revoke_peer_tickets(node_uid)
    else:
        signalled = 0
        revoked = 0

    repo.record_audit_event(
        event_type="peer.limits_updated",
        status="success",
        node_uid=node_uid,
        metadata={
            **policy_updates,
            "tickets_revoked": revoked,
            "streams_signalled": signalled,
        },
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

    signalled = signal_active_stream_revocations(
        node_uid=node_uid,
        subject_hash=subject_hash,
    )
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
            "streams_signalled": signalled,
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


@router.get("/streams")
def list_active_stream_tickets(
    request: Request,
    node_uid: str | None = Query(None),
    subject_hash: str | None = Query(None),
):
    _require_nodes_view(request)
    return stream_ticket_repo.list_active_tickets(
        node_uid=node_uid,
        subject_hash=subject_hash,
    )


@router.post("/streams/{ticket_uid}/revoke")
def revoke_stream_ticket(ticket_uid: str, request: Request):
    _require_nodes_manage(request)
    if not stream_ticket_repo.revoke_ticket(ticket_uid):
        raise HTTPException(status_code=404, detail="Active stream ticket not found")
    repo.record_audit_event(
        event_type="stream.ticket_revoked",
        status="success",
        metadata={"ticket_uid": ticket_uid},
    )
    return {"ok": True}


# ── Risk telemetry ────────────────────────────────────────────────────────


@router.get("/risk")
def get_risk_dashboard(
    request: Request,
    node_uid: str = Query(...),
    limit: int = Query(100, ge=1, le=200),
):
    _require_nodes_view(request)
    return risk_repo.get_risk_dashboard(peer_node_uid=node_uid, limit=limit)


@router.post("/risk/actions/{action_id}/reverse")
def reverse_risk_action(action_id: int, request: Request):
    _require_nodes_manage(request)
    if not risk_repo.reverse_temporary_action(action_id):
        raise HTTPException(status_code=404, detail="Temporary action not found")
    repo.record_audit_event(
        event_type="risk.action_reversed",
        status="success",
        metadata={"action_id": action_id},
    )
    return {"ok": True}


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
    if existing.get("status") != "awaiting_approval":
        return existing

    result = approve_import_request(request_id, approved_by_user_id=user.get("id", 0))
    if not result:
        raise HTTPException(status_code=404, detail="Import request not found")
    if not result.pop("_approval_transitioned", False):
        return result

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
            status="approved",
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
    from crate.db.repositories.tasks import update_task
    from crate.federation.imports import deny_import_request, get_import_request

    existing = get_import_request(request_id)
    result = deny_import_request(request_id)
    if not result:
        raise HTTPException(status_code=404, detail="Import request not found")
    metadata = (existing or {}).get("metadata_json") or {}
    task_id = metadata.get("task_id") if isinstance(metadata, dict) else None
    if task_id and (existing or {}).get("status") in {
        "approved",
        "reserving",
        "downloading",
        "verifying",
        "importing",
    }:
        update_task(str(task_id), status="cancelled")
    return result


# ── Community directory ───────────────────────────────────────────────────


def _directory_trusted_key(body: DirectorySubscriptionBody) -> dict:
    try:
        raw = base64.b64decode(body.trusted_public_key, validate=True)
        Ed25519PublicKey.from_public_bytes(raw)
    except Exception as exc:
        raise HTTPException(
            status_code=400, detail="trusted_public_key must be a valid Ed25519 key"
        ) from exc
    return {
        "key_id": body.trusted_key_id,
        "algorithm": "ed25519",
        "public_key": body.trusted_public_key,
        "status": "active",
    }


@router.get("/directories")
def list_directory_subscriptions(request: Request):
    _require_nodes_view(request)
    return directory_repo.list_subscriptions()


@router.post("/directories")
def create_directory_subscription(body: DirectorySubscriptionBody, request: Request):
    user = _require_nodes_manage(request)
    from crate.federation.url_policy import FederationURLPolicy

    try:
        url = FederationURLPolicy().validate_base_url(body.url.strip()).url
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    trusted_key = _directory_trusted_key(body)
    try:
        subscription = directory_repo.create_subscription(
            url=url,
            trusted_keys=[trusted_key],
            refresh_interval_seconds=body.refresh_interval_seconds,
            created_by=int(user["id"]),
        )
    except Exception as exc:
        raise HTTPException(
            status_code=409, detail="Directory subscription already exists"
        ) from exc
    from crate.db.repositories.tasks import create_task_dedup

    task_id = create_task_dedup(
        "federation_directory_refresh",
        {"subscription_uid": str(subscription["subscription_uid"])},
        dedup_key=f"directory:{subscription['subscription_uid']}",
    )
    repo.record_audit_event(
        event_type="directory.subscription_created",
        status="queued",
        metadata={
            "subscription_uid": str(subscription["subscription_uid"]),
            "url": url,
            "trusted_key_id": trusted_key["key_id"],
            "task_id": task_id,
        },
    )
    return {**subscription, "task_id": task_id}


@router.patch("/directories/{subscription_uid}")
def update_directory_subscription_state(
    subscription_uid: str,
    body: DirectorySubscriptionStateBody,
    request: Request,
):
    _require_nodes_manage(request)
    try:
        subscription = directory_repo.set_subscription_state(
            subscription_uid, body.state
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if subscription is None:
        raise HTTPException(status_code=404, detail="Directory subscription not found")
    repo.record_audit_event(
        event_type="directory.subscription_state_changed",
        status=body.state,
        metadata={"subscription_uid": subscription_uid},
    )
    return subscription


@router.delete("/directories/{subscription_uid}")
def remove_directory_subscription(subscription_uid: str, request: Request):
    _require_nodes_manage(request)
    if not directory_repo.delete_subscription(subscription_uid):
        raise HTTPException(status_code=404, detail="Directory subscription not found")
    repo.record_audit_event(
        event_type="directory.subscription_deleted",
        status="success",
        metadata={"subscription_uid": subscription_uid},
    )
    return {"ok": True}


@router.post("/directories/{subscription_uid}/refresh")
def refresh_directory_subscription(subscription_uid: str, request: Request):
    _require_nodes_manage(request)
    if directory_repo.get_subscription(subscription_uid) is None:
        raise HTTPException(status_code=404, detail="Directory subscription not found")
    from crate.db.repositories.tasks import create_task_dedup

    task_id = create_task_dedup(
        "federation_directory_refresh",
        {"subscription_uid": subscription_uid},
        dedup_key=f"directory:{subscription_uid}",
    )
    repo.record_audit_event(
        event_type="directory.refresh_requested",
        status="queued" if task_id else "already_queued",
        metadata={"subscription_uid": subscription_uid, "task_id": task_id},
    )
    return {"task_id": task_id, "status": "queued" if task_id else "already_queued"}


@router.post("/directory-candidates/{candidate_id}/pair")
def pair_directory_candidate(
    candidate_id: int, body: DirectoryCandidatePairBody, request: Request
):
    _require_nodes_manage(request)
    candidate = directory_repo.get_candidate(candidate_id)
    if candidate is None:
        raise HTTPException(status_code=404, detail="Directory candidate not found")
    if candidate["state"] == "stale":
        raise HTTPException(status_code=409, detail="Directory candidate is stale")
    metadata = candidate.get("metadata_json") or {}
    url = str(metadata.get("api_base_url") or "")
    if not url:
        raise HTTPException(status_code=409, detail="Candidate has no verified API URL")
    return start_pairing(
        PairingStartBody(url=url, outbound_grant=body.outbound_grant), request
    )


@router.post("/directory/import")
def import_community_directory(body: DirectoryImportBody, request: Request):
    return create_directory_subscription(
        DirectorySubscriptionBody(
            url=body.url,
            trusted_key_id=body.trusted_key_id,
            trusted_public_key=body.trusted_public_key,
        ),
        request,
    )

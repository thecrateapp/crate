"""Local proxy endpoints for remote browse.

Listen calls these local endpoints, which proxy to the remote node via signed
federation requests. Remote detail never exposes filesystem paths, raw stream
URLs, or bearer tokens.
"""

from __future__ import annotations

import json
import logging
import uuid
from urllib.parse import urlencode

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse
import httpx
from pydantic import BaseModel

from crate.api.auth import _require_auth
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES, error_response
from crate.db.repositories import federation as repo
from crate.federation.client import (
    DEFAULT_TIMEOUT,
    build_signed_headers,
    federated_get,
    prepare_outbound_resource,
)


def _append_federation_event(
    event_type: str,
    payload: dict,
    *,
    scope: str,
    subject_key: str,
) -> None:
    from crate.db.domain_events import append_domain_event

    append_domain_event(event_type, payload, scope=scope, subject_key=subject_key)


log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/federation/remote", tags=["federation"])

_RESPONSES = {
    **AUTH_ERROR_RESPONSES,
    404: error_response("Remote resource not found."),
    503: error_response("Remote peer is unreachable."),
}


class ImportRequestBody(BaseModel):
    title: str = ""
    artist: str = ""


# ═══════════════════════════════════════════════════════════════════════════


def _get_local_node() -> dict:
    node = repo.get_local_node()
    if not node:
        raise HTTPException(status_code=503, detail="Local node not configured")
    return node


def _get_peer(node_uid: str) -> dict:
    peer = repo.get_peer(node_uid)
    if not peer:
        raise HTTPException(status_code=404, detail="Peer not found")
    if peer.get("disabled_at"):
        raise HTTPException(status_code=503, detail="Peer is disabled")
    if peer["trust_state"] != "approved":
        raise HTTPException(status_code=403, detail="Peer is not approved")
    return peer


def _request_redis(request: Request):
    state = getattr(getattr(request, "app", None), "state", None)
    redis_client = getattr(state, "redis", None) if state is not None else None
    if redis_client is not None:
        return redis_client

    from crate.db.cache_runtime import get_redis

    redis_client = get_redis()
    if redis_client is None:
        raise HTTPException(status_code=503, detail="Redis is required for federation")
    return redis_client


def _peer_allows(peer: dict, capability: str) -> bool:
    from crate.federation.grants import preset_allows

    return preset_allows(peer.get("default_grant_preset", "discovery"), capability)


def _stream_slot_limits(peer: dict) -> tuple[int, int]:
    from crate.federation.grants import resolve_preset
    from crate.federation.quotas import (
        DEFAULT_MAX_STREAMS_PER_PEER,
        DEFAULT_MAX_STREAMS_PER_SUBJECT,
    )

    try:
        preset = resolve_preset(peer.get("default_grant_preset", "discovery"))
    except ValueError:
        return DEFAULT_MAX_STREAMS_PER_PEER, DEFAULT_MAX_STREAMS_PER_SUBJECT

    raw_limit = (preset.get("constraints") or {}).get("max_concurrent_streams")
    subject_limit = _integer_constraint(raw_limit, DEFAULT_MAX_STREAMS_PER_SUBJECT)
    subject_limit = max(2, min(subject_limit, 16))
    peer_limit = max(DEFAULT_MAX_STREAMS_PER_PEER, subject_limit * 2)
    return peer_limit, subject_limit


def _stream_byte_limits(peer: dict) -> tuple[int, int]:
    from crate.federation.grants import resolve_preset
    from crate.federation.quotas import (
        DEFAULT_DAILY_BYTES_PER_PEER,
        DEFAULT_DAILY_BYTES_PER_SUBJECT,
    )

    try:
        preset = resolve_preset(peer.get("default_grant_preset", "discovery"))
    except ValueError:
        return DEFAULT_DAILY_BYTES_PER_PEER, DEFAULT_DAILY_BYTES_PER_SUBJECT

    raw_limit = (preset.get("constraints") or {}).get("daily_stream_bytes")
    peer_limit = _integer_constraint(raw_limit, DEFAULT_DAILY_BYTES_PER_PEER)
    peer_limit = max(DEFAULT_DAILY_BYTES_PER_PEER, peer_limit)
    subject_limit = max(DEFAULT_DAILY_BYTES_PER_SUBJECT, peer_limit // 2)
    return peer_limit, subject_limit


def _integer_constraint(value: object, default: int) -> int:
    if not isinstance(value, int | float | str):
        return default
    try:
        return int(value)
    except ValueError:
        return default


def _user_assertion(
    local_node: dict,
    peer: dict,
    user: dict,
    purpose: str,
    capabilities: list[str],
) -> str:
    from crate.federation.assertions import build_outbound_user_assertion

    return build_outbound_user_assertion(
        local_node=local_node,
        peer=peer,
        user=user,
        purpose=purpose,
        capabilities=capabilities,
    )


@router.get("/nodes/{node_uid}/albums/{remote_entity_uid}")
def remote_album_detail(
    node_uid: str,
    remote_entity_uid: str,
    request: Request,
):
    user = _require_auth(request)
    local_node = _get_local_node()
    peer = _get_peer(node_uid)
    from crate.api.permissions import require_permission

    require_permission(request, "federation.catalog.search")

    try:
        resp = federated_get(
            base_url=peer["api_base_url"],
            path=f"/api/federation/v1/albums/{remote_entity_uid}",
            node_id=local_node["node_uid"],
            key_id=local_node["active_key_id"],
            private_key_ref=local_node["private_key_ref"],
            timeout=DEFAULT_TIMEOUT,
            user_assertion=_user_assertion(
                local_node,
                peer,
                user,
                purpose="catalog.album.read",
                capabilities=["federation.catalog.search"],
            ),
        )
        resp.raise_for_status()
        remote_data = resp.json()
    except Exception as e:
        log.warning(
            "Failed to fetch remote album %s from %s: %s",
            remote_entity_uid,
            node_uid,
            e,
        )
        raise HTTPException(
            status_code=503,
            detail="Remote peer is unreachable or returned an error.",
        )

    from crate.federation.cross_instance import build_remote_album_detail

    return build_remote_album_detail(peer, remote_data)


@router.get("/nodes/{node_uid}/albums/{remote_entity_uid}/cover")
def remote_album_cover(
    node_uid: str,
    remote_entity_uid: str,
    request: Request,
    size: int | None = Query(None, ge=32, le=1024),
    image_format: str | None = Query(None, alias="format", pattern="^webp$"),
):
    return _remote_album_cover(
        node_uid,
        remote_entity_uid,
        request,
        size=size,
        image_format=image_format,
        selection=None,
    )


def remote_album_cover_cached(
    node_uid: str,
    remote_entity_uid: str,
    request: Request,
    *,
    size: int | None = None,
    image_format: str | None = None,
    selection: dict | None = None,
):
    return _remote_album_cover(
        node_uid,
        remote_entity_uid,
        request,
        size=size,
        image_format=image_format,
        selection=selection,
    )


def _remote_album_cover(
    node_uid: str,
    remote_entity_uid: str,
    request: Request,
    *,
    size: int | None,
    image_format: str | None,
    selection: dict | None,
):
    return remote_asset(
        node_uid,
        remote_entity_uid,
        "album",
        "cover",
        request,
        size=size,
        image_format=image_format,
        selection=selection,
        not_found_detail="Artwork not found",
    )


def remote_asset(
    node_uid: str,
    remote_entity_uid: str,
    entity_type: str,
    asset_name: str,
    request: Request,
    *,
    size: int | None = None,
    image_format: str | None = None,
    selection: dict | None = None,
    not_found_detail: str = "Remote asset not found",
):
    user = _require_auth(request)
    local_node = _get_local_node()
    peer = _get_peer(node_uid)
    from crate.api.permissions import require_permission

    require_permission(request, "federation.catalog.search")

    cache_selection = _asset_cache_selection(
        selection,
        asset_name=asset_name,
        size=size,
        image_format=image_format,
    )
    if cache_selection is not None:
        from crate.federation.global_content_cache import get_cached_blob_facet

        cached = get_cached_blob_facet(cache_selection)
        if cached is not None:
            return _asset_response(
                bytes(cached["content"]),
                str(cached["content_type"]),
                "public, max-age=900",
            )

    try:
        asset_path = (
            f"/api/federation/v1/assets/{entity_type}/{remote_entity_uid}/{asset_name}"
        )
        query = urlencode(
            {
                key: value
                for key, value in {
                    "size": size,
                    "format": image_format,
                }.items()
                if value is not None
            }
        )
        if query:
            asset_path = f"{asset_path}?{query}"

        resp = federated_get(
            base_url=peer["api_base_url"],
            path=asset_path,
            node_id=local_node["node_uid"],
            key_id=local_node["active_key_id"],
            private_key_ref=local_node["private_key_ref"],
            timeout=DEFAULT_TIMEOUT,
            user_assertion=_user_assertion(
                local_node,
                peer,
                user,
                purpose="artwork.read",
                capabilities=["federation.catalog.search"],
            ),
        )
        if resp.status_code == 404:
            raise HTTPException(status_code=404, detail=not_found_detail)
        resp.raise_for_status()
    except HTTPException:
        raise
    except Exception as e:
        log.warning(
            "Failed to fetch remote %s asset %s from %s: %s",
            entity_type,
            remote_entity_uid,
            node_uid,
            e,
        )
        raise HTTPException(
            status_code=503,
            detail="Remote peer is unreachable or returned an error.",
        )

    content_type = resp.headers.get("content-type", "image/jpeg")
    cache_control = resp.headers.get("cache-control", "public, max-age=900")
    if cache_selection is not None:
        from crate.federation.global_content_cache import store_blob_facet

        store_blob_facet(
            cache_selection,
            resp.content,
            content_type=content_type,
            ttl_seconds=_ttl_seconds(selection),
        )
    return _asset_response(resp.content, content_type, cache_control)


def _asset_cache_selection(
    selection: dict | None,
    *,
    asset_name: str,
    size: int | None,
    image_format: str | None,
) -> dict | None:
    if not selection:
        return None
    return {
        **selection,
        "cache_variant": {
            "asset": asset_name,
            "size": size,
            "format": image_format,
        },
    }


def _asset_response(
    content: bytes,
    content_type: str,
    cache_control: str,
) -> Response:
    return Response(
        content=content,
        media_type=content_type,
        headers={"Cache-Control": cache_control},
    )


def _ttl_seconds(selection: dict | None) -> int:
    if not selection:
        return 86400
    facet_payload = selection.get("facet_payload")
    if isinstance(facet_payload, dict):
        try:
            return int(facet_payload.get("ttl_seconds") or 86400)
        except (TypeError, ValueError):
            return 86400
    return 86400


@router.get("/nodes/{node_uid}/tracks/{remote_entity_uid}")
def remote_track_detail(
    node_uid: str,
    remote_entity_uid: str,
    request: Request,
):
    user = _require_auth(request)
    local_node = _get_local_node()
    peer = _get_peer(node_uid)
    from crate.api.permissions import require_permission

    require_permission(request, "federation.catalog.search")

    try:
        resp = federated_get(
            base_url=peer["api_base_url"],
            path=f"/api/federation/v1/tracks/{remote_entity_uid}",
            node_id=local_node["node_uid"],
            key_id=local_node["active_key_id"],
            private_key_ref=local_node["private_key_ref"],
            timeout=DEFAULT_TIMEOUT,
            user_assertion=_user_assertion(
                local_node,
                peer,
                user,
                purpose="catalog.track.read",
                capabilities=["federation.catalog.search"],
            ),
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        log.warning(
            "Failed to fetch remote track %s from %s: %s",
            remote_entity_uid,
            node_uid,
            e,
        )
        raise HTTPException(status_code=503, detail="Remote peer is unreachable")

    data["origin"] = "remote"
    data["node_uid"] = node_uid
    data["node_name"] = peer["display_name"]
    data["remote_entity_uid"] = remote_entity_uid
    data["availability"] = {
        "catalog": True,
        "stream": _peer_allows(peer, "stream.proxy"),
        "import": _peer_allows(peer, "import.request"),
    }
    return data


@router.get("/nodes/{node_uid}/artists/{remote_entity_uid}")
def remote_artist_detail(
    node_uid: str,
    remote_entity_uid: str,
    request: Request,
):
    user = _require_auth(request)
    peer = _get_peer(node_uid)
    from crate.api.permissions import require_permission

    require_permission(request, "federation.catalog.search")

    try:
        from crate.federation.client import federated_get

        local_node = _get_local_node()
        resp = federated_get(
            base_url=peer["api_base_url"],
            path=f"/api/federation/v1/artists/{remote_entity_uid}",
            node_id=local_node["node_uid"],
            key_id=local_node["active_key_id"],
            private_key_ref=local_node["private_key_ref"],
            timeout=DEFAULT_TIMEOUT,
            user_assertion=_user_assertion(
                local_node,
                peer,
                user,
                purpose="catalog.artist.read",
                capabilities=["federation.catalog.search"],
            ),
        )
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        log.warning(
            "Failed to fetch remote artist %s from %s: %s",
            remote_entity_uid,
            node_uid,
            e,
        )
        raise HTTPException(status_code=503, detail="Remote peer is unreachable")


def remote_json_facet(
    node_uid: str,
    remote_entity_uid: str,
    entity_type: str,
    facet: str,
    request: Request,
) -> dict:
    user = _require_auth(request)
    local_node = _get_local_node()
    peer = _get_peer(node_uid)
    from crate.api.permissions import require_permission

    require_permission(request, "federation.catalog.search")

    try:
        resp = federated_get(
            base_url=peer["api_base_url"],
            path=f"/api/federation/v1/facets/{entity_type}/{remote_entity_uid}/{facet}",
            node_id=local_node["node_uid"],
            key_id=local_node["active_key_id"],
            private_key_ref=local_node["private_key_ref"],
            timeout=DEFAULT_TIMEOUT,
            user_assertion=_user_assertion(
                local_node,
                peer,
                user,
                purpose="catalog.facet.read",
                capabilities=["federation.catalog.search"],
            ),
        )
        resp.raise_for_status()
        data = resp.json()
        return data if isinstance(data, dict) else {}
    except Exception as e:
        log.warning(
            "Failed to fetch remote %s facet %s/%s from %s: %s",
            facet,
            entity_type,
            remote_entity_uid,
            node_uid,
            e,
        )
        raise HTTPException(status_code=503, detail="Remote peer is unreachable")


def remote_artist_photo(
    node_uid: str,
    remote_entity_uid: str,
    request: Request,
    size: int | None = Query(None, ge=32, le=1024),
    image_format: str | None = Query(None, alias="format", pattern="^webp$"),
    selection: dict | None = None,
):
    return remote_asset(
        node_uid,
        remote_entity_uid,
        "artist",
        "photo",
        request,
        size=size,
        image_format=image_format,
        selection=selection,
        not_found_detail="Artist photo not found",
    )


def remote_artist_background(
    node_uid: str,
    remote_entity_uid: str,
    request: Request,
    size: int | None = Query(None, ge=32, le=2048),
    image_format: str | None = Query(None, alias="format", pattern="^webp$"),
    selection: dict | None = None,
):
    return remote_asset(
        node_uid,
        remote_entity_uid,
        "artist",
        "background",
        request,
        size=size,
        image_format=image_format,
        selection=selection,
        not_found_detail="Artist background not found",
    )


# ── Playback resolution ───────────────────────────────────────────────────


@router.post("/nodes/{node_uid}/tracks/{remote_entity_uid}/playback")
def resolve_remote_playback(
    node_uid: str,
    remote_entity_uid: str,
    request: Request,
    global_track_uid: str | None = None,
):
    user = _require_auth(request)
    from crate.api.permissions import require_permission

    require_permission(request, "federation.stream.play")

    local_node = _get_local_node()
    peer = _get_peer(node_uid)
    playback_session = str(uuid.uuid4())

    from crate.federation.client import federated_post

    try:
        resp = federated_post(
            base_url=peer["api_base_url"],
            path="/api/federation/v1/stream-tickets",
            node_id=local_node["node_uid"],
            key_id=local_node["active_key_id"],
            private_key_ref=local_node["private_key_ref"],
            json_body={
                "remote_entity_uid": remote_entity_uid,
                "delivery_policy": "balanced",
                "requesting_node_uid": local_node["node_uid"],
                "playback_session": playback_session,
            },
            timeout=DEFAULT_TIMEOUT,
            user_assertion=_user_assertion(
                local_node,
                peer,
                user,
                purpose="stream.ticket",
                capabilities=["federation.stream.play"],
            ),
        )
        resp.raise_for_status()
        ticket_data = resp.json()
    except Exception as e:
        log.warning("Failed to create stream ticket from %s: %s", node_uid, e)
        raise HTTPException(
            status_code=502,
            detail="Remote peer could not create stream ticket.",
        )

    from crate.federation.stream_proxy import create_ticket as create_local_ticket
    from crate.federation.assertions import outbound_subject_hash

    local_ticket = create_local_ticket(
        node_uid=node_uid,
        remote_entity_uid=ticket_data["ticket_uid"],
        delivery_policy=ticket_data.get("delivery_policy", "balanced"),
        subject_hash=outbound_subject_hash(local_node, peer, user),
        local_user_id=int(user["id"]) if user.get("id") is not None else None,
        audience=str(local_node["node_uid"]),
        playback_session=playback_session,
    )

    from crate.playback_provenance import issue_playback_session

    return {
        "stream_url": f"/api/federation/remote/streams/{local_ticket['ticket_uid']}",
        "expires_at": local_ticket.get("expires_at"),
        "delivery_policy": ticket_data.get("delivery_policy", "balanced"),
        "playback_session": issue_playback_session(
            user_id=int(user["id"]),
            global_track_uid=global_track_uid,
            content_origin="remote",
            source_node_uid=node_uid,
        ),
        "content_origin": "remote",
    }


# ── Proxy stream ──────────────────────────────────────────────────────────


@router.get("/streams/{ticket_uid}")
async def proxy_remote_stream(ticket_uid: str, request: Request):
    _require_auth(request)
    from crate.federation.stream_proxy import (
        filter_request_headers,
        filter_response_headers,
        validate_ticket,
    )

    ticket = validate_ticket(ticket_uid)
    if not ticket:
        raise HTTPException(
            status_code=404, detail="Stream ticket not found or expired"
        )

    peer = _get_peer(ticket["node_uid"])
    local_node = _get_local_node()
    remote_ticket_uid = ticket["remote_entity_uid"]
    prepared_stream = prepare_outbound_resource(
        peer["api_base_url"],
        f"/api/federation/v1/streams/{remote_ticket_uid}",
    )
    remote_stream_url = prepared_stream.external_url

    from crate.federation.quotas import (
        acquire_stream_slot,
        check_byte_quota,
        record_bytes_sent,
        release_stream_slot,
    )

    redis_client = _request_redis(request)
    subject_hash = ticket.get("subject_hash")
    ok, reason = check_byte_quota(
        redis_client,
        ticket["node_uid"],
        subject_hash,
        *_stream_byte_limits(peer),
    )
    if not ok:
        raise HTTPException(status_code=429, detail=f"Quota exceeded: {reason}")

    ok, reason, stream_id = acquire_stream_slot(
        redis_client,
        ticket["node_uid"],
        subject_hash,
        *_stream_slot_limits(peer),
        ticket_uid,
    )
    if not ok:
        raise HTTPException(status_code=429, detail=f"Stream limit: {reason}")

    request_headers = {k.lower(): v for k, v in request.headers.items()}
    upstream_headers = filter_request_headers(request_headers)
    upstream_headers.update(
        build_signed_headers(
            method="GET",
            url=remote_stream_url,
            node_id=local_node["node_uid"],
            key_id=local_node["active_key_id"],
            private_key_ref=local_node["private_key_ref"],
            body=b"",
            content_type="",
        )
    )
    constraints = ticket.get("constraints_json") or {}
    if isinstance(constraints, str):
        constraints = json.loads(constraints)
    upstream_headers["X-Crate-Playback-Session"] = str(
        constraints.get("playback_session") or ""
    )

    client = httpx.AsyncClient(
        timeout=httpx.Timeout(30.0, connect=10.0),
        follow_redirects=False,
    )
    try:
        upstream = await client.send(
            client.build_request(
                "GET",
                prepared_stream.connection_url,
                headers=upstream_headers,
                extensions={"sni_hostname": prepared_stream.sni_hostname},
            ),
            stream=True,
        )
    except Exception as exc:
        await client.aclose()
        release_stream_slot(redis_client, ticket["node_uid"], subject_hash, stream_id)
        repo.record_audit_event(
            event_type="stream.proxy.failed",
            status="failed",
            node_uid=ticket["node_uid"],
            metadata={"ticket_uid": ticket_uid, "error": str(exc)[:500]},
        )
        _append_federation_event(
            "federation.stream.proxy.failed",
            {
                "ticket_uid": ticket_uid,
                "node_uid": ticket["node_uid"],
                "error": str(exc)[:500],
            },
            scope="federation.stream",
            subject_key=ticket["node_uid"],
        )
        log.warning("Failed to open remote stream %s: %s", ticket_uid, exc)
        raise HTTPException(
            status_code=502, detail="Remote stream is unavailable"
        ) from exc

    if upstream.status_code >= 400:
        await upstream.aclose()
        await client.aclose()
        release_stream_slot(redis_client, ticket["node_uid"], subject_hash, stream_id)
        repo.record_audit_event(
            event_type="stream.proxy.failed",
            status="failed",
            node_uid=ticket["node_uid"],
            metadata={
                "ticket_uid": ticket_uid,
                "upstream_status": upstream.status_code,
            },
        )
        _append_federation_event(
            "federation.stream.proxy.failed",
            {
                "ticket_uid": ticket_uid,
                "node_uid": ticket["node_uid"],
                "upstream_status": upstream.status_code,
            },
            scope="federation.stream",
            subject_key=ticket["node_uid"],
        )
        raise HTTPException(
            status_code=upstream.status_code,
            detail="Remote stream returned an error",
        )

    safe_headers = filter_response_headers(dict(upstream.headers))
    media_type = safe_headers.pop("content-type", "audio/mpeg")

    async def generate():
        bytes_sent = 0
        try:
            async for chunk in upstream.aiter_bytes(chunk_size=65536):
                if chunk:
                    bytes_sent += len(chunk)
                    yield chunk
            record_bytes_sent(
                redis_client, ticket["node_uid"], bytes_sent, subject_hash
            )
            repo.record_audit_event(
                event_type="stream.proxy.completed",
                status="success",
                node_uid=ticket["node_uid"],
                metadata={"ticket_uid": ticket_uid, "bytes_sent": bytes_sent},
            )
            _append_federation_event(
                "federation.stream.proxy.completed",
                {
                    "ticket_uid": ticket_uid,
                    "node_uid": ticket["node_uid"],
                    "bytes_sent": bytes_sent,
                },
                scope="federation.stream",
                subject_key=ticket["node_uid"],
            )
        except Exception as e:
            repo.record_audit_event(
                event_type="stream.proxy.failed",
                status="failed",
                node_uid=ticket["node_uid"],
                metadata={"ticket_uid": ticket_uid, "error": str(e)[:500]},
            )
            _append_federation_event(
                "federation.stream.proxy.failed",
                {
                    "ticket_uid": ticket_uid,
                    "node_uid": ticket["node_uid"],
                    "error": str(e)[:500],
                },
                scope="federation.stream",
                subject_key=ticket["node_uid"],
            )
            log.warning("Proxy stream failed for ticket %s: %s", ticket_uid, e)
        finally:
            await upstream.aclose()
            await client.aclose()
            release_stream_slot(
                redis_client, ticket["node_uid"], subject_hash, stream_id
            )

    safe_headers.setdefault("accept-ranges", "bytes")
    safe_headers.setdefault("cache-control", "no-cache")
    return StreamingResponse(
        generate(),
        status_code=upstream.status_code,
        media_type=media_type,
        headers=safe_headers,
    )


# ── Import ────────────────────────────────────────────────────────────────


@router.post("/nodes/{node_uid}/albums/{remote_entity_uid}/import")
def request_remote_import(
    node_uid: str,
    remote_entity_uid: str,
    body: ImportRequestBody,
    request: Request,
):
    user = _require_auth(request)
    from crate.api.permissions import require_permission

    require_permission(request, "federation.import.request")
    peer = _get_peer(node_uid)

    from crate.federation.imports import (
        can_request_import,
        create_import_request,
    )

    ok, err = can_request_import(peer)
    if not ok:
        raise HTTPException(status_code=403, detail=err)

    import_req = create_import_request(
        node_uid=node_uid,
        remote_entity_uid=remote_entity_uid,
        entity_type="album",
        title=body.title or remote_entity_uid,
        requested_by_user_id=int(user["id"]) if user.get("id") is not None else None,
        metadata={"album_name": body.title, "artist": body.artist},
        requires_approval=True,
    )
    _append_federation_event(
        "federation.import.requested",
        {
            "node_uid": node_uid,
            "remote_entity_uid": remote_entity_uid,
            "request_id": str(import_req["request_id"]),
        },
        scope="federation.import",
        subject_key=node_uid,
    )
    return {
        "request_id": import_req["request_id"],
        "status": import_req["status"],
        "task_id": None,
    }


@router.post("/albums/{global_album_uid}/import")
def request_global_album_import(global_album_uid: str, request: Request):
    user = _require_auth(request)
    from crate.api.permissions import require_permission
    from crate.federation.global_source_resolver import (
        GlobalEntityNotFound,
        NoGlobalSource,
        resolve_global_source,
    )
    from crate.federation.imports import can_request_import, create_import_request

    require_permission(request, "federation.import.request")
    try:
        source = resolve_global_source(
            global_entity_uid=global_album_uid,
            entity_type="album",
            facet="album_detail",
        )
    except GlobalEntityNotFound as exc:
        raise HTTPException(status_code=404, detail="Album not found") from exc
    except NoGlobalSource as exc:
        raise HTTPException(status_code=503, detail="No healthy album source") from exc
    if source["kind"] == "local":
        raise HTTPException(
            status_code=409, detail="Album is already available locally"
        )
    peer = _get_peer(str(source["node_uid"]))
    ok, error = can_request_import(peer)
    if not ok:
        raise HTTPException(status_code=403, detail=error)
    payload = source.get("source_payload") or {}
    import_request = create_import_request(
        node_uid=str(source["node_uid"]),
        remote_entity_uid=str(source["remote_entity_uid"]),
        global_album_uid=global_album_uid,
        entity_type="album",
        title=str(payload.get("title") or payload.get("name") or global_album_uid),
        requested_by_user_id=int(user["id"]) if user.get("id") is not None else None,
        metadata={"global_album_uid": global_album_uid},
        requires_approval=True,
    )
    return {
        "request_id": str(import_request["request_id"]),
        "status": import_request["status"],
        "task_id": (import_request.get("metadata_json") or {}).get("task_id"),
    }


@router.get("/import-requests/{request_id}")
def get_remote_import_status(request_id: str, request: Request):
    user = _require_auth(request)
    from crate.federation.imports import get_import_request

    import_request = get_import_request(request_id)
    if not import_request:
        raise HTTPException(status_code=404, detail="Import request not found")
    requester_id = import_request.get("requested_by_user_id")
    user_id = user.get("id")
    if requester_id is None or user_id is None or int(requester_id) != int(user_id):
        # Deliberately hide the existence and owner of another user's request.
        raise HTTPException(status_code=404, detail="Import request not found")
    metadata = import_request.get("metadata_json") or {}
    if not isinstance(metadata, dict):
        metadata = {}
    return {
        "request_id": str(import_request["request_id"]),
        "status": str(import_request["status"]),
        "task_id": metadata.get("task_id"),
        "expected_bytes": import_request.get("expected_bytes"),
        "received_bytes": import_request.get("received_bytes"),
        "failure_reason": import_request.get("failure_reason"),
    }

"""Node-to-node federation API endpoints.

All /api/federation/v1/* endpoints require valid Ed25519 node signatures.
The descriptor (/.well-known/crate-node) is public.
"""

from __future__ import annotations

import base64
import json as _json
import logging
import re
import time
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import text

from crate.api.openapi_responses import error_response
from crate.db.repositories import federation as repo
from crate.db.tx import read_scope
from crate.federation.grants import evaluate_grant
from crate.federation.identity import build_descriptor
from crate.federation.search import handle_remote_search
from crate.federation.assertions import verify_signed_assertion
from crate.federation.signing import (
    SIGNATURE_VERSION,
    SIGNED_HEADERS,
    sha256_hex,
    validate_timestamp,
    verify_signature,
)

log = logging.getLogger(__name__)
_GENRE_SPLIT_RE = re.compile(r"[;,]")
_MANIFEST_AUDIO_KEYS = (
    "bpm",
    "energy",
    "danceability",
    "valence",
    "acousticness",
    "instrumentalness",
)
_MANIFEST_QUALITY_KEYS = (
    "format",
    "bitrate",
    "sample_rate",
    "bit_depth",
    "size_bytes",
)

router = APIRouter(prefix="/api/federation/v1", tags=["federation"])
well_known = APIRouter(tags=["federation"])

_RESPONSES = {
    401: error_response("Invalid or missing node signature."),
    403: error_response("Peer does not have the required grant."),
}

_LOCAL_ONLY_KEYS = {
    "id",
    "artist_id",
    "album_id",
    "track_id",
    "path",
    "local_path",
    "filename",
    "folder_name",
    "storage_id",
    "slug",
    "artist_slug",
    "album_slug",
    "cover_file",
    "quarantine_task_id",
    "rating",
}


# -- Pydantic request bodies -------------------------------------------------


class SearchBody(BaseModel):
    q: str = ""
    limit: int = Field(default=20, ge=1, le=50)


class StreamTicketBody(BaseModel):
    remote_entity_uid: str
    delivery_policy: str = "balanced"
    requesting_node_uid: str


class PairingOfferBody(BaseModel):
    challenge: str = ""


class PairingAcceptBody(BaseModel):
    node_uid: str = ""


class KeyRotationBody(BaseModel):
    node_uid: str = ""
    new_key_id: str = ""


# -- Signature validation ----------------------------------------------------


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


def _peer_public_keys(peer: dict) -> list[dict[str, Any]]:
    public_keys = peer.get("public_keys_json", [])
    if isinstance(public_keys, str):
        return list(_json.loads(public_keys or "[]"))
    return list(public_keys or [])


async def _require_signed_node_request(
    request: Request,
    body_bytes: bytes | None = None,
) -> dict:
    """Validate crate-ed25519-v1 signatures on node-to-node requests.

    POST signatures must be verified against the exact raw request body. FastAPI
    caches parsed bodies, so this can safely read the body after Pydantic parsing.
    """
    if body_bytes is None:
        body_bytes = await request.body() if request.method != "GET" else b""
    return _verify_signed_node_request(request, body_bytes)


def _verify_signed_node_request(request: Request, body_bytes: bytes) -> dict:
    """Validate crate-ed25519-v1 signatures on node-to-node requests.

    For GET requests, body_bytes should be b"".
    For POST requests, pass the raw body bytes for body hash verification.
    """
    node_id = request.headers.get("X-Crate-Node-Id")
    if not node_id:
        raise HTTPException(status_code=401, detail="Missing X-Crate-Node-Id header")

    peer = repo.get_peer(node_id)
    if not peer or peer.get("disabled_at") or peer["trust_state"] != "approved":
        raise HTTPException(status_code=403, detail="Peer not approved or disabled")

    sig_version = request.headers.get("X-Crate-Signature-Version")
    if sig_version != SIGNATURE_VERSION:
        raise HTTPException(status_code=401, detail="Unsupported signature version")

    signed_headers = request.headers.get("X-Crate-Signed-Headers")
    if signed_headers != SIGNED_HEADERS:
        raise HTTPException(status_code=401, detail="Unexpected signed headers")

    key_id = request.headers.get("X-Crate-Key-Id")
    timestamp_str = request.headers.get("X-Crate-Timestamp")
    nonce = request.headers.get("X-Crate-Nonce")
    body_sha256_header = request.headers.get("X-Crate-Body-SHA256")
    signature_full = request.headers.get("X-Crate-Signature")

    if not all([key_id, timestamp_str, nonce, body_sha256_header, signature_full]):
        raise HTTPException(status_code=401, detail="Missing signature headers")

    try:
        timestamp = int(timestamp_str or "")
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Invalid timestamp") from exc

    if not validate_timestamp(timestamp):
        raise HTTPException(status_code=401, detail="Timestamp outside allowed skew")

    computed_hash = sha256_hex(body_bytes)
    if computed_hash != body_sha256_header:
        raise HTTPException(status_code=401, detail="Body hash mismatch")

    if not signature_full or not signature_full.startswith("ed25519:"):
        raise HTTPException(status_code=401, detail="Invalid signature format")
    sig_b64 = signature_full.removeprefix("ed25519:")

    matching_key = next(
        (
            pk
            for pk in _peer_public_keys(peer)
            if pk.get("key_id") == key_id and pk.get("status") in ("active", "pending")
        ),
        None,
    )
    if not matching_key:
        raise HTTPException(status_code=401, detail="Unknown or inactive key ID")

    try:
        public_key_bytes = base64.b64decode(matching_key["public_key"])
        public_key = Ed25519PublicKey.from_public_bytes(public_key_bytes)
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid public key") from exc

    host = request.headers.get("host", "")
    content_type = request.headers.get("content-type", "")
    path_with_query = request.url.path
    if request.url.query:
        path_with_query += "?" + request.url.query

    if not verify_signature(
        public_key=public_key,
        method=request.method,
        path_with_query=path_with_query,
        host=host,
        content_type=content_type,
        node_id=node_id,
        key_id=key_id or "",
        timestamp=timestamp,
        nonce=nonce or "",
        body=body_bytes,
        signature_b64=sig_b64,
    ):
        raise HTTPException(status_code=401, detail="Invalid signature")

    from crate.federation.abuse import check_and_record_nonce

    if not check_and_record_nonce(_request_redis(request), nonce or "", node_id):
        raise HTTPException(status_code=401, detail="Nonce already used")

    return peer


def _require_capability(peer: dict, capability: str) -> None:
    ok, err = evaluate_grant(
        peer_trust_state=peer.get("trust_state", ""),
        peer_disabled_at=peer.get("disabled_at"),
        preset_name=peer.get("default_grant_preset") or "discovery",
        required_capability=capability,
    )
    if not ok:
        raise HTTPException(status_code=403, detail=err or "Capability denied")


def _peer_has_capability(peer: dict, capability: str) -> bool:
    ok, _ = evaluate_grant(
        peer_trust_state=peer.get("trust_state", ""),
        peer_disabled_at=peer.get("disabled_at"),
        preset_name=peer.get("default_grant_preset") or "discovery",
        required_capability=capability,
    )
    return ok


def _local_node_uid() -> str:
    node = repo.get_local_node()
    if not node:
        raise HTTPException(status_code=503, detail="Local node not configured")
    return str(node["node_uid"])


def _require_user_assertion(
    request: Request,
    peer: dict,
    purpose: str,
    required_capability: str,
) -> dict[str, Any]:
    token = request.headers.get("X-Crate-User-Assertion")
    if not token:
        raise HTTPException(status_code=403, detail="Missing remote user assertion")
    try:
        assertion = verify_signed_assertion(
            token,
            public_keys=_peer_public_keys(peer),
            expected_audience=_local_node_uid(),
            expected_purpose=purpose,
            required_capability=required_capability,
        )
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    subject_hash = str(assertion.get("sub") or "")
    if not subject_hash:
        raise HTTPException(status_code=403, detail="Missing remote subject")

    subject = repo.ensure_remote_subject(
        peer["node_uid"],
        subject_hash,
        roles=list(assertion.get("roles") or []),
    )
    if subject and subject.get("blocked_at"):
        raise HTTPException(status_code=403, detail="Remote subject is blocked")
    return assertion


def _catalog_share_policy() -> dict[str, Any]:
    node = repo.get_local_node()
    if not node:
        return {}
    raw_policy = node.get("policy_json") or {}
    if isinstance(raw_policy, str):
        try:
            return dict(_json.loads(raw_policy or "{}"))
        except ValueError:
            return {}
    return dict(raw_policy)


def _catalog_policy_allows_item(item: dict[str, Any], policy: dict[str, Any]) -> bool:
    catalog_filter = policy.get("catalog_filter") or {}
    expected_scope = catalog_filter.get("share_scope")
    if expected_scope:
        item_scope = item.get("_share_scope") or item.get("share_scope") or "library"
        if item_scope != expected_scope:
            return False

    allowed_entity_uids = set(catalog_filter.get("entity_uids") or [])
    type_key = f"{item.get('entity_type')}_entity_uids"
    allowed_entity_uids.update(catalog_filter.get(type_key) or [])
    if allowed_entity_uids and item.get("remote_entity_uid") not in allowed_entity_uids:
        return False

    denied_entity_uids = set(catalog_filter.get("deny_entity_uids") or [])
    if item.get("remote_entity_uid") in denied_entity_uids:
        return False

    return True


def _catalog_policy_allows_live_search(policy: dict[str, Any]) -> bool:
    catalog_filter = policy.get("catalog_filter") or {}
    expected_scope = catalog_filter.get("share_scope")
    return expected_scope in (None, "", "library")


def _empty_search_response() -> dict[str, list[dict]]:
    return {"artists": [], "albums": [], "tracks": []}


# -- Public descriptor -------------------------------------------------------


@well_known.get("/.well-known/crate-node")
def get_descriptor(request: Request):
    node = repo.get_local_node()
    if not node:
        raise HTTPException(status_code=503, detail="Local node not configured")
    return build_descriptor(
        node_uid=node["node_uid"],
        display_name=node["display_name"],
        api_base_url=node["api_base_url"] or str(request.base_url).rstrip("/"),
        listen_base_url=node["listen_base_url"],
        active_key_id=node["active_key_id"],
        public_keys=_json.loads(node["public_keys_json"])
        if isinstance(node["public_keys_json"], str)
        else node["public_keys_json"],
        capabilities=_json.loads(node["capabilities_json"])
        if isinstance(node["capabilities_json"], str)
        else node["capabilities_json"],
        policy=_json.loads(node["policy_json"])
        if isinstance(node["policy_json"], str)
        else node["policy_json"],
    )


# -- Capabilities / health ---------------------------------------------------


@router.get("/capabilities")
async def get_capabilities(request: Request):
    peer = await _require_signed_node_request(request)
    _require_capability(peer, "catalog.search")
    node = repo.get_local_node()
    if not node:
        raise HTTPException(status_code=503, detail="Local node not configured")
    caps = (
        _json.loads(node["capabilities_json"])
        if isinstance(node["capabilities_json"], str)
        else node["capabilities_json"]
    )
    return {
        "node_uid": node["node_uid"],
        "name": node["display_name"],
        "capabilities": caps,
    }


@router.get("/health")
async def get_health(request: Request):
    await _require_signed_node_request(request)
    return {"status": "ok"}


# -- Search ------------------------------------------------------------------


@router.post("/search")
async def federated_search(body: SearchBody, request: Request):
    peer = await _require_signed_node_request(request)
    _require_capability(peer, "catalog.search")
    _require_user_assertion(
        request,
        peer,
        purpose="catalog.search",
        required_capability="federation.catalog.search",
    )
    if not _catalog_policy_allows_live_search(_catalog_share_policy()):
        return _empty_search_response()
    return _strip_paths(handle_remote_search(query=body.q, limit=body.limit))


def _strip_paths(result: Any) -> Any:
    if isinstance(result, list):
        return [_strip_paths(item) for item in result]
    if not isinstance(result, dict):
        return result
    return {
        key: _strip_paths(value)
        for key, value in result.items()
        if key not in _LOCAL_ONLY_KEYS
    }


# -- Metadata detail ---------------------------------------------------------


@router.get("/albums/{remote_entity_uid}")
async def federated_album_detail(remote_entity_uid: str, request: Request):
    peer = await _require_signed_node_request(request)
    _require_capability(peer, "catalog.album.read")
    _require_user_assertion(
        request,
        peer,
        purpose="catalog.album.read",
        required_capability="federation.catalog.search",
    )
    if not _catalog_policy_allows_item(
        {
            "entity_type": "album",
            "remote_entity_uid": remote_entity_uid,
            "_share_scope": "library",
        },
        _catalog_share_policy(),
    ):
        raise HTTPException(status_code=404, detail="Album not found")
    album = _public_album_detail(remote_entity_uid)
    if not album:
        raise HTTPException(status_code=404, detail="Album not found")
    return _strip_paths(album)


@router.get("/artists/{remote_entity_uid}")
async def federated_artist_detail(remote_entity_uid: str, request: Request):
    peer = await _require_signed_node_request(request)
    _require_capability(peer, "catalog.artist.read")
    _require_user_assertion(
        request,
        peer,
        purpose="catalog.artist.read",
        required_capability="federation.catalog.search",
    )
    if not _catalog_policy_allows_item(
        {
            "entity_type": "artist",
            "remote_entity_uid": remote_entity_uid,
            "_share_scope": "library",
        },
        _catalog_share_policy(),
    ):
        raise HTTPException(status_code=404, detail="Artist not found")
    artist = _public_artist_detail(remote_entity_uid)
    if not artist:
        raise HTTPException(status_code=404, detail="Artist not found")
    return _strip_paths(artist)


@router.get("/tracks/{remote_entity_uid}")
async def federated_track_detail(remote_entity_uid: str, request: Request):
    peer = await _require_signed_node_request(request)
    _require_capability(peer, "catalog.track.read")
    _require_user_assertion(
        request,
        peer,
        purpose="catalog.track.read",
        required_capability="federation.catalog.search",
    )
    if not _catalog_policy_allows_item(
        {
            "entity_type": "track",
            "remote_entity_uid": remote_entity_uid,
            "_share_scope": "library",
        },
        _catalog_share_policy(),
    ):
        raise HTTPException(status_code=404, detail="Track not found")
    track = _public_track_detail(remote_entity_uid)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")
    return _strip_paths(track)


@router.get("/artwork/{remote_entity_uid}")
async def federated_artwork(
    remote_entity_uid: str,
    request: Request,
    size: int | None = Query(None, ge=32, le=1024),
    image_format: str | None = Query(None, alias="format", pattern="^webp$"),
):
    peer = await _require_signed_node_request(request)
    _require_capability(peer, "artwork.read")
    _require_user_assertion(
        request,
        peer,
        purpose="artwork.read",
        required_capability="federation.catalog.search",
    )
    return _serve_federated_album_asset(
        remote_entity_uid,
        size=size,
        image_format=image_format,
        not_found_detail="Artwork not found",
    )


def _serve_federated_album_asset(
    remote_entity_uid: str,
    *,
    size: int | None,
    image_format: str | None,
    not_found_detail: str,
):

    from crate.api._deps import COVER_NAMES
    from crate.api.image_variants import build_image_response
    from crate.db.repositories.library import get_library_album_by_entity_uid

    album = get_library_album_by_entity_uid(remote_entity_uid)
    if not album:
        raise HTTPException(status_code=404, detail=not_found_detail)

    album_dir = Path(str(album.get("path") or ""))
    for cover_name in COVER_NAMES:
        cover = album_dir / cover_name
        if not cover.is_file():
            continue
        media_type = "image/png" if cover.suffix.lower() == ".png" else "image/jpeg"
        return build_image_response(
            cover.read_bytes(),
            media_type,
            size=size,
            output_format=image_format,
            headers={"Cache-Control": "public, max-age=3600"},
        )

    raise HTTPException(status_code=404, detail=not_found_detail)


@router.get("/assets/artists/{remote_entity_uid}/photo")
async def federated_artist_photo(
    remote_entity_uid: str,
    request: Request,
    size: int | None = Query(None, ge=32, le=1024),
    image_format: str | None = Query(None, alias="format", pattern="^webp$"),
):
    peer = await _require_signed_node_request(request)
    _require_capability(peer, "artwork.read")
    _require_user_assertion(
        request,
        peer,
        purpose="artist_photo.read",
        required_capability="federation.catalog.search",
    )
    if not _catalog_policy_allows_item(
        {
            "entity_type": "artist",
            "remote_entity_uid": remote_entity_uid,
            "_share_scope": "library",
        },
        _catalog_share_policy(),
    ):
        raise HTTPException(status_code=404, detail="Artist photo not found")

    return _federated_artist_sidecar_image(
        remote_entity_uid,
        candidate_names=_artist_photo_names(),
        size=size,
        image_format=image_format,
        not_found_detail="Artist photo not found",
    )


@router.get("/assets/artists/{remote_entity_uid}/background")
async def federated_artist_background(
    remote_entity_uid: str,
    request: Request,
    size: int | None = Query(None, ge=32, le=2048),
    image_format: str | None = Query(None, alias="format", pattern="^webp$"),
):
    peer = await _require_signed_node_request(request)
    _require_capability(peer, "artwork.read")
    _require_user_assertion(
        request,
        peer,
        purpose="artist_background.read",
        required_capability="federation.catalog.search",
    )
    if not _catalog_policy_allows_item(
        {
            "entity_type": "artist",
            "remote_entity_uid": remote_entity_uid,
            "_share_scope": "library",
        },
        _catalog_share_policy(),
    ):
        raise HTTPException(status_code=404, detail="Artist background not found")

    return _federated_artist_sidecar_image(
        remote_entity_uid,
        candidate_names=_artist_background_names(),
        size=size,
        image_format=image_format,
        not_found_detail="Artist background not found",
    )


@router.get("/assets/{entity_type}/{remote_entity_uid}/{asset_name}")
async def federated_asset(
    entity_type: str,
    remote_entity_uid: str,
    asset_name: str,
    request: Request,
    size: int | None = Query(None, ge=32, le=2048),
    image_format: str | None = Query(None, alias="format", pattern="^webp$"),
):
    peer = await _require_signed_node_request(request)
    _require_capability(peer, "artwork.read")
    _require_user_assertion(
        request,
        peer,
        purpose="artwork.read",
        required_capability="federation.catalog.search",
    )
    normalized_type = entity_type.strip().lower()
    normalized_asset = asset_name.strip().lower()
    if not _catalog_policy_allows_item(
        {
            "entity_type": normalized_type,
            "remote_entity_uid": remote_entity_uid,
            "_share_scope": "library",
        },
        _catalog_share_policy(),
    ):
        raise HTTPException(status_code=404, detail="Asset not found")

    return _serve_federated_asset(
        normalized_type,
        remote_entity_uid,
        normalized_asset,
        size=size,
        image_format=image_format,
    )


def _serve_federated_asset(
    entity_type: str,
    remote_entity_uid: str,
    asset_name: str,
    *,
    size: int | None,
    image_format: str | None,
):
    if entity_type == "album" and asset_name in {"cover", "artwork"}:
        return _serve_federated_album_asset(
            remote_entity_uid,
            size=size,
            image_format=image_format,
            not_found_detail="Asset not found",
        )
    if entity_type == "artist" and asset_name == "photo":
        return _federated_artist_sidecar_image(
            remote_entity_uid,
            candidate_names=_artist_photo_names(),
            size=size,
            image_format=image_format,
            not_found_detail="Asset not found",
        )
    if entity_type == "artist" and asset_name == "background":
        return _federated_artist_sidecar_image(
            remote_entity_uid,
            candidate_names=_artist_background_names(),
            size=size,
            image_format=image_format,
            not_found_detail="Asset not found",
        )
    raise HTTPException(status_code=404, detail="Asset not found")


def _artist_photo_names() -> tuple[str, ...]:
    from crate.api.browse_shared import ARTIST_PHOTO_NAMES

    return tuple(ARTIST_PHOTO_NAMES)


def _artist_background_names() -> tuple[str, ...]:
    return (
        "background.jpg",
        "background.jpeg",
        "background.png",
        "background.webp",
        "fanart.jpg",
        "fanart.jpeg",
        "fanart.png",
        "fanart.webp",
        *_artist_photo_names(),
    )


def _federated_artist_sidecar_image(
    remote_entity_uid: str,
    *,
    candidate_names: tuple[str, ...],
    size: int | None,
    image_format: str | None,
    not_found_detail: str,
):
    from crate.api._deps import library_path
    from crate.api.image_variants import build_image_response
    from crate.db.repositories.library import get_library_artist_by_entity_uid
    from crate.storage_layout import resolve_artist_dir

    artist = get_library_artist_by_entity_uid(remote_entity_uid)
    if not artist:
        raise HTTPException(status_code=404, detail=not_found_detail)

    artist_dir = resolve_artist_dir(
        library_path(),
        artist,
        fallback_name=str(artist.get("name") or ""),
        existing_only=True,
    )
    if not artist_dir or not artist_dir.is_dir():
        raise HTTPException(status_code=404, detail=not_found_detail)

    for image_name in candidate_names:
        image = artist_dir / image_name
        if not image.is_file():
            continue
        media_type = _image_media_type(image.suffix)
        return build_image_response(
            image.read_bytes(),
            media_type,
            size=size,
            output_format=image_format,
            headers={"Cache-Control": "public, max-age=3600"},
        )

    raise HTTPException(status_code=404, detail=not_found_detail)


def _image_media_type(suffix: str) -> str:
    normalized = suffix.lower()
    if normalized == ".png":
        return "image/png"
    if normalized == ".webp":
        return "image/webp"
    return "image/jpeg"


@router.get("/facets/{entity_type}/{remote_entity_uid}/{facet}")
async def federated_json_facet(
    entity_type: str,
    remote_entity_uid: str,
    facet: str,
    request: Request,
):
    peer = await _require_signed_node_request(request)
    _require_capability(peer, _facet_capability(entity_type))
    _require_user_assertion(
        request,
        peer,
        purpose="catalog.facet.read",
        required_capability="federation.catalog.search",
    )
    if not _catalog_policy_allows_item(
        {
            "entity_type": entity_type,
            "remote_entity_uid": remote_entity_uid,
            "_share_scope": "library",
        },
        _catalog_share_policy(),
    ):
        raise HTTPException(status_code=404, detail="Facet not found")

    payload = _public_facet_payload(entity_type, remote_entity_uid, facet)
    if payload is None:
        raise HTTPException(status_code=404, detail="Facet not found")
    return _strip_paths(payload)


def _facet_capability(entity_type: str) -> str:
    if entity_type == "artist":
        return "catalog.artist.read"
    if entity_type == "album":
        return "catalog.album.read"
    if entity_type == "track":
        return "catalog.track.read"
    raise HTTPException(status_code=404, detail="Unsupported entity type")


def _public_facet_payload(
    entity_type: str,
    remote_entity_uid: str,
    facet: str,
) -> dict | None:
    if entity_type == "artist" and facet in {"metadata", "artist_info"}:
        artist = _public_artist_detail(remote_entity_uid)
        if not artist:
            return None
        if facet == "metadata":
            return artist
        return _artist_info_facet(artist)
    if entity_type == "album" and facet in {"metadata", "album_detail"}:
        return _public_album_detail(remote_entity_uid)
    if entity_type == "track" and facet in {"metadata", "track_info"}:
        return _public_track_detail(remote_entity_uid)
    return None


def _artist_info_facet(artist: dict) -> dict:
    return {
        "bio": artist.get("bio") or "",
        "tags": _json_list(artist.get("tags_json")),
        "similar": _json_list(artist.get("similar_json")),
        "listeners": int(artist.get("listeners") or 0),
        "playcount": int(artist.get("lastfm_playcount") or 0),
        "image_url": artist.get("image_url"),
        "url": artist.get("url") or "",
        "country": artist.get("country"),
        "area": artist.get("area"),
        "formed": artist.get("formed"),
        "ended": artist.get("ended"),
    }


def _json_list(value: Any) -> list:
    if isinstance(value, list):
        return value
    if isinstance(value, str) and value:
        try:
            decoded = _json.loads(value)
        except Exception:
            return []
        return decoded if isinstance(decoded, list) else []
    return []


def _public_album_detail(remote_entity_uid: str) -> dict | None:
    from crate.db.repositories.library import (
        get_library_album_by_entity_uid,
        get_library_tracks,
    )

    album = get_library_album_by_entity_uid(remote_entity_uid)
    if not album:
        return None
    tracks = get_library_tracks(int(album["id"]))
    return {
        "entity_uid": album.get("entity_uid"),
        "name": album.get("name"),
        "artist": album.get("artist"),
        "year": album.get("year"),
        "genre": album.get("genre"),
        "track_count": album.get("track_count"),
        "total_duration": album.get("total_duration"),
        "has_cover": bool(album.get("has_cover")),
        "tracks": [
            {
                "entity_uid": track.get("entity_uid"),
                "title": track.get("title") or track.get("filename"),
                "artist": track.get("artist"),
                "album": track.get("album"),
                "duration": track.get("duration"),
                "track_number": track.get("track_number"),
                "disc_number": track.get("disc_number"),
                "format": track.get("format"),
                "year": track.get("year"),
                "genre": track.get("genre"),
            }
            for track in tracks
            if track.get("entity_uid")
        ],
    }


def _public_artist_detail(remote_entity_uid: str) -> dict | None:
    from crate.db.repositories.library import (
        get_library_albums,
        get_library_artist_by_entity_uid,
    )

    artist = get_library_artist_by_entity_uid(remote_entity_uid)
    if not artist:
        return None
    albums = get_library_albums(str(artist["name"]))
    return {
        "entity_uid": artist.get("entity_uid"),
        "name": artist.get("name"),
        "album_count": artist.get("album_count"),
        "track_count": artist.get("track_count"),
        "primary_format": artist.get("primary_format"),
        "has_photo": bool(artist.get("has_photo")),
        "bio": artist.get("bio"),
        "tags_json": artist.get("tags_json"),
        "similar_json": artist.get("similar_json"),
        "listeners": artist.get("listeners"),
        "lastfm_playcount": artist.get("lastfm_playcount"),
        "image_url": artist.get("image_url"),
        "url": artist.get("url"),
        "country": artist.get("country"),
        "area": artist.get("area"),
        "formed": artist.get("formed"),
        "ended": artist.get("ended"),
        "albums": [
            {
                "entity_uid": album.get("entity_uid"),
                "name": album.get("name"),
                "artist": album.get("artist"),
                "year": album.get("year"),
                "track_count": album.get("track_count"),
                "total_duration": album.get("total_duration"),
                "has_cover": bool(album.get("has_cover")),
            }
            for album in albums
            if album.get("entity_uid")
        ],
    }


def _public_track_detail(remote_entity_uid: str) -> dict | None:
    from crate.db.repositories.library import get_library_track_by_entity_uid

    track = get_library_track_by_entity_uid(remote_entity_uid)
    if not track:
        return None
    return {
        "entity_uid": track.get("entity_uid"),
        "title": track.get("title") or track.get("filename"),
        "artist": track.get("artist"),
        "album": track.get("album"),
        "duration": track.get("duration"),
        "track_number": track.get("track_number"),
        "disc_number": track.get("disc_number"),
        "format": track.get("format"),
        "year": track.get("year"),
        "genre": track.get("genre"),
        "bitrate": track.get("bitrate"),
        "sample_rate": track.get("sample_rate"),
        "bit_depth": track.get("bit_depth"),
    }


# -- Catalog sync ------------------------------------------------------------


@router.get("/catalog/manifest")
async def catalog_manifest(request: Request, page: int = 0, page_size: int = 100):
    peer = await _require_signed_node_request(request)
    _require_capability(peer, "catalog.sync")
    capped_page = max(0, page)
    capped_page_size = max(1, min(page_size, 500))
    genres_allowed = _peer_has_capability(peer, "catalog.metadata.genres")
    payload = {
        "revision": str(int(time.time())),
        "page": capped_page,
        "page_size": capped_page_size,
        "items": _catalog_manifest_items(
            page=capped_page,
            page_size=capped_page_size,
            include_genres=genres_allowed,
        ),
    }
    if genres_allowed:
        from crate.genre_taxonomy import get_core_taxonomy_descriptor

        payload["taxonomy"] = get_core_taxonomy_descriptor()
    return payload


@router.get("/catalog/delta")
async def catalog_delta(request: Request, cursor: str = ""):
    await _require_signed_node_request(request)
    from crate.federation.catalog import get_cursor

    stored = get_cursor(request.headers.get("X-Crate-Node-Id", ""))
    operations: list[dict] = []

    if stored and stored.get("cursor"):
        import time
        from crate.db.queries import browse_media_search

        recent = browse_media_search.search_all_hybrid(query="", limit=50)
        for album in recent.get("albums", [])[:20]:
            operations.append(
                {
                    "op": "upsert",
                    "entity_type": "album",
                    "remote_entity_uid": album.get("entity_uid", ""),
                    "revision": str(int(time.time())),
                }
            )

    return {"cursor": cursor, "operations": operations}


def _catalog_manifest_items(
    page: int,
    page_size: int,
    *,
    include_genres: bool = True,
) -> list[dict]:
    offset = page * page_size
    policy = _catalog_share_policy()
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                SELECT *
                FROM (
                    SELECT
                        'artist' AS entity_type,
                        entity_uid::text AS remote_entity_uid,
                        name AS title,
                        name AS artist,
                        NULL::text AS album,
                        NULL::text AS year,
                        NULL::double precision AS duration_seconds,
                        NULL::integer AS track_number,
                        NULL::integer AS disc_number,
                        (COALESCE(has_photo, 0) <> 0) AS has_photo,
                        NULL::boolean AS has_cover,
                        (
                            SELECT COALESCE(
                                jsonb_agg(
                                    jsonb_build_object('raw_label', g.name, 'weight', ag.weight)
                                    ORDER BY ag.weight DESC, g.name ASC
                                ),
                                '[]'::jsonb
                            )
                            FROM artist_genres ag
                            JOIN genres g ON g.id = ag.genre_id
                            WHERE ag.artist_name = library_artists.name
                        ) AS genres_json,
                        NULL::text AS genre,
                        NULL::double precision AS bpm,
                        NULL::double precision AS energy,
                        NULL::double precision AS danceability,
                        NULL::double precision AS valence,
                        NULL::double precision AS acousticness,
                        NULL::double precision AS instrumentalness,
                        NULL::text AS format,
                        NULL::integer AS bitrate,
                        NULL::integer AS sample_rate,
                        NULL::integer AS bit_depth,
                        NULL::bigint AS size_bytes,
                        updated_at AS updated_at,
                        'library' AS _share_scope
                    FROM library_artists
                    WHERE entity_uid IS NOT NULL
                      AND name NOT LIKE '.%'
                      AND (folder_name IS NULL OR folder_name NOT LIKE '.%')
                    UNION ALL
                    SELECT
                        'album' AS entity_type,
                        entity_uid::text AS remote_entity_uid,
                        name AS title,
                        artist AS artist,
                        name AS album,
                        year::text AS year,
                        total_duration::double precision AS duration_seconds,
                        NULL::integer AS track_number,
                        NULL::integer AS disc_number,
                        NULL::boolean AS has_photo,
                        (COALESCE(has_cover, 0) <> 0) AS has_cover,
                        (
                            SELECT COALESCE(
                                jsonb_agg(
                                    jsonb_build_object('raw_label', g.name, 'weight', ag.weight)
                                    ORDER BY ag.weight DESC, g.name ASC
                                ),
                                '[]'::jsonb
                            )
                            FROM album_genres ag
                            JOIN genres g ON g.id = ag.genre_id
                            WHERE ag.album_id = library_albums.id
                        ) AS genres_json,
                        NULL::text AS genre,
                        NULL::double precision AS bpm,
                        NULL::double precision AS energy,
                        NULL::double precision AS danceability,
                        NULL::double precision AS valence,
                        NULL::double precision AS acousticness,
                        NULL::double precision AS instrumentalness,
                        NULL::text AS format,
                        NULL::integer AS bitrate,
                        NULL::integer AS sample_rate,
                        NULL::integer AS bit_depth,
                        NULL::bigint AS size_bytes,
                        updated_at AS updated_at,
                        'library' AS _share_scope
                    FROM library_albums
                    WHERE entity_uid IS NOT NULL
                      AND quarantined_at IS NULL
                    UNION ALL
                    SELECT
                        'track' AS entity_type,
                        lt.entity_uid::text AS remote_entity_uid,
                        COALESCE(NULLIF(lt.title, ''), lt.filename) AS title,
                        lt.artist AS artist,
                        lt.album AS album,
                        lt.year::text AS year,
                        lt.duration::double precision AS duration_seconds,
                        lt.track_number AS track_number,
                        lt.disc_number AS disc_number,
                        NULL::boolean AS has_photo,
                        NULL::boolean AS has_cover,
                        '[]'::jsonb AS genres_json,
                        lt.genre::text AS genre,
                        COALESCE(taf.bpm, lt.bpm)::double precision AS bpm,
                        COALESCE(taf.energy, lt.energy)::double precision AS energy,
                        COALESCE(taf.danceability, lt.danceability)::double precision AS danceability,
                        COALESCE(taf.valence, lt.valence)::double precision AS valence,
                        COALESCE(taf.acousticness, lt.acousticness)::double precision AS acousticness,
                        COALESCE(taf.instrumentalness, lt.instrumentalness)::double precision AS instrumentalness,
                        LOWER(NULLIF(lt.format, ''))::text AS format,
                        CASE
                            WHEN lt.bitrate IS NULL THEN NULL
                            ELSE FLOOR(lt.bitrate / 1000.0)::integer
                        END AS bitrate,
                        lt.sample_rate::integer AS sample_rate,
                        lt.bit_depth::integer AS bit_depth,
                        lt.size::bigint AS size_bytes,
                        lt.updated_at AS updated_at,
                        'library' AS _share_scope
                    FROM library_tracks lt
                    LEFT JOIN track_analysis_features taf
                      ON taf.track_id = lt.id
                    WHERE lt.entity_uid IS NOT NULL
                ) AS catalog
                ORDER BY entity_type, artist, album, title
                OFFSET :offset
                LIMIT :limit
                """
                ),
                {"offset": offset, "limit": page_size},
            )
            .mappings()
            .all()
        )

    items: list[dict] = []
    for row in rows:
        item = dict(row)
        item["entity_uid"] = item["remote_entity_uid"]
        if include_genres:
            item["genres"] = _manifest_genres(item)
            item["genre_assertions"] = _manifest_genre_assertions(item)
        _normalize_manifest_audio(item)
        _normalize_manifest_quality(item)
        item["facets"] = _manifest_facets(item)
        if not _catalog_policy_allows_item(item, policy):
            continue
        item.pop("_share_scope", None)
        item.pop("updated_at", None)
        item.pop("has_photo", None)
        item.pop("has_cover", None)
        item.pop("genres_json", None)
        item.pop("genre", None)
        items.append(item)
    return items


def _normalize_manifest_audio(item: dict[str, Any]) -> None:
    for key in _MANIFEST_AUDIO_KEYS:
        value = item.get(key)
        if value is None:
            item.pop(key, None)
            continue
        try:
            item[key] = float(value)
        except (TypeError, ValueError):
            item.pop(key, None)


def _normalize_manifest_quality(item: dict[str, Any]) -> None:
    fmt = str(item.get("format") or "").strip().lower()
    if fmt:
        item["format"] = fmt
    else:
        item.pop("format", None)

    for key in ("bitrate", "sample_rate", "bit_depth", "size_bytes"):
        value = item.get(key)
        if value is None:
            item.pop(key, None)
            continue
        try:
            normalized = int(value)
        except (TypeError, ValueError):
            item.pop(key, None)
            continue
        if normalized <= 0:
            item.pop(key, None)
            continue
        item[key] = normalized


def _manifest_genres(item: dict[str, Any]) -> list[str]:
    genres = item.get("genres_json")
    if isinstance(genres, str):
        try:
            genres = _json.loads(genres)
        except Exception:
            genres = []

    values: list[str] = []
    seen: set[str] = set()
    if isinstance(genres, list):
        for value in genres:
            _append_manifest_genre(values, seen, value)
    _append_manifest_genre(values, seen, item.get("genre"))
    return values


def _append_manifest_genre(values: list[str], seen: set[str], value: Any) -> None:
    if isinstance(value, dict):
        value = value.get("raw_label") or value.get("label") or value.get("name")
    if value is None:
        return
    for part in _GENRE_SPLIT_RE.split(str(value)):
        genre = part.strip().lower()
        if not genre or genre in seen:
            continue
        seen.add(genre)
        values.append(genre)


def _manifest_genre_assertions(item: dict[str, Any]) -> list[dict[str, Any]]:
    """Expose typed core taxonomy evidence alongside legacy ``genres``."""
    from crate.genre_taxonomy import (
        core_genre_uid,
        get_core_taxonomy_descriptor,
        resolve_static_genre_slug,
        split_genre_names,
    )

    descriptor = get_core_taxonomy_descriptor()
    known_slugs = {genre["slug"] for genre in descriptor["genres"]}
    raw_values = item.get("genres_json")
    if isinstance(raw_values, str):
        try:
            raw_values = _json.loads(raw_values)
        except ValueError:
            raw_values = []
    candidates: list[dict[str, Any]] = []
    if isinstance(raw_values, list):
        for value in raw_values:
            if isinstance(value, dict):
                candidates.append(value)
            else:
                candidates.append({"raw_label": value})
    for value in split_genre_names(str(item.get("genre") or "")):
        candidates.append({"raw_label": value})

    assertions: list[dict[str, Any]] = []
    seen: set[str] = set()
    for candidate in candidates:
        raw_label = str(candidate.get("raw_label") or "").strip().lower()
        if not raw_label or raw_label in seen:
            continue
        seen.add(raw_label)
        canonical_slug = resolve_static_genre_slug(raw_label)
        assertion: dict[str, Any] = {
            "raw_label": raw_label,
            "weight": _manifest_genre_weight(candidate.get("weight")),
            "confidence": 1.0,
            "is_direct": True,
        }
        if canonical_slug in known_slugs:
            assertion.update(
                {
                    "global_genre_uid": core_genre_uid(canonical_slug),
                    "canonical_slug": canonical_slug,
                    "taxonomy": {
                        "id": descriptor["taxonomy_id"],
                        "version": descriptor["version"],
                        "digest": descriptor["digest"],
                    },
                }
            )
        assertions.append(assertion)
    return assertions


def _manifest_genre_weight(value: Any) -> float:
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return 1.0


def _manifest_facets(item: dict[str, Any]) -> dict[str, dict[str, Any]]:
    entity_type = str(item.get("entity_type") or "")
    revision = _manifest_revision(item)

    if entity_type == "artist":
        has_photo = bool(item.get("has_photo"))
        return {
            "metadata": _facet(True, revision),
            "artist_info": _facet(True, revision),
            "artist_background": _facet(has_photo, revision),
            "artist_photo": _facet(has_photo, revision),
            "artist_shows": _facet(False, revision),
        }
    if entity_type == "album":
        has_cover = bool(item.get("has_cover"))
        return {
            "metadata": _facet(True, revision),
            "album_detail": _facet(True, revision),
            "album_artwork": _facet(has_cover, revision),
        }
    if entity_type == "track":
        return {
            "metadata": _facet(True, revision),
            "track_info": _facet(True, revision),
            "track_analysis": _facet(False, revision),
            "playback": _facet(True, revision),
        }
    return {"metadata": _facet(True, revision)}


def _facet(available: bool, revision: str | None) -> dict[str, Any]:
    payload: dict[str, Any] = {"available": bool(available)}
    if revision:
        payload["revision"] = revision
    return payload


def _manifest_revision(item: dict[str, Any]) -> str:
    updated_at = item.get("updated_at")
    if hasattr(updated_at, "isoformat"):
        return updated_at.isoformat()
    return str(int(time.time()))


# -- Pairing -----------------------------------------------------------------


@router.post("/pairing/offer")
def pairing_offer(body: PairingOfferBody, request: Request):
    node_id = request.headers.get("X-Crate-Node-Id", "")
    if not node_id:
        raise HTTPException(status_code=401, detail="Missing node identity")
    return {"status": "received", "challenge": body.challenge}


@router.post("/pairing/accept")
def pairing_accept(body: PairingAcceptBody, request: Request):
    node_id = request.headers.get("X-Crate-Node-Id", "")
    if body.node_uid and node_id and body.node_uid != node_id:
        raise HTTPException(status_code=400, detail="Mismatched node identity")
    return {
        "status": "manual_approval_required",
        "node_uid": body.node_uid or node_id,
    }


@router.post("/key-rotation")
async def key_rotation(body: KeyRotationBody, request: Request):
    peer = await _require_signed_node_request(request)
    if body.node_uid and body.node_uid != peer["node_uid"]:
        raise HTTPException(status_code=403, detail="Cannot rotate another peer key")
    if not body.new_key_id:
        raise HTTPException(status_code=400, detail="new_key_id required")

    key_ids = {pk.get("key_id") for pk in _peer_public_keys(peer)}
    if body.new_key_id not in key_ids:
        raise HTTPException(status_code=400, detail="Unknown new_key_id")

    repo.update_peer(peer["node_uid"], active_key_id=body.new_key_id)
    repo.record_audit_event(
        event_type="key.rotation.received",
        status="success",
        node_uid=peer["node_uid"],
        metadata={"new_key_id": body.new_key_id},
    )
    return {"status": "ok"}


# -- Stream tickets ----------------------------------------------------------


@router.post("/stream-tickets")
async def create_stream_ticket(body: StreamTicketBody, request: Request):
    peer = await _require_signed_node_request(request)
    peer_uid = str(peer["node_uid"])
    if body.requesting_node_uid != peer_uid:
        raise HTTPException(status_code=403, detail="requesting_node_uid mismatch")
    assertion = _require_user_assertion(
        request,
        peer,
        purpose="stream.ticket",
        required_capability="federation.stream.play",
    )

    from crate.federation.stream_proxy import (
        create_ticket,
        validate_peer_stream_grant,
    )

    ok, err = validate_peer_stream_grant(peer, body.delivery_policy)
    if not ok:
        raise HTTPException(status_code=403, detail=err)

    ticket = create_ticket(
        node_uid=peer_uid,
        remote_entity_uid=body.remote_entity_uid,
        delivery_policy=body.delivery_policy,
        subject_hash=str(assertion.get("sub") or ""),
    )

    repo.record_audit_event(
        event_type="stream.ticket.created",
        status="success",
        node_uid=peer_uid,
        metadata={
            "ticket_uid": ticket["ticket_uid"],
            "delivery_policy": body.delivery_policy,
        },
    )
    from crate.db.domain_events import append_domain_event

    append_domain_event(
        "federation.stream.ticket.created",
        {
            "node_uid": peer_uid,
            "ticket_uid": ticket["ticket_uid"],
            "delivery_policy": body.delivery_policy,
        },
        scope="federation.stream",
        subject_key=peer_uid,
    )

    return {
        "ticket_uid": ticket["ticket_uid"],
        "expires_at": str(ticket["expires_at"]),
        "delivery_policy": body.delivery_policy,
        "stream_url": f"/api/federation/v1/streams/{ticket['ticket_uid']}",
    }


@router.get("/streams/{ticket_uid}")
async def serve_stream(ticket_uid: str, request: Request):
    peer = await _require_signed_node_request(request)

    from crate.api.browse_media import _playback_headers, _stream_resolved_file
    from crate.db.repositories.streaming import get_track_delivery_row_by_entity_uid
    from crate.federation.stream_proxy import validate_ticket
    from crate.streaming.service import media_type_for_path, resolve_playback

    ticket = validate_ticket(ticket_uid)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found or expired")
    if ticket["node_uid"] != peer["node_uid"]:
        raise HTTPException(status_code=403, detail="Ticket belongs to another peer")

    track = get_track_delivery_row_by_entity_uid(ticket["remote_entity_uid"])
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")

    resolution = resolve_playback(
        track,
        ticket.get("delivery_policy") or "balanced",
        enqueue=True,
    )
    if resolution is None:
        raise HTTPException(status_code=404, detail="Track not found")

    return _stream_resolved_file(
        request,
        resolution.file_path,
        media_type=resolution.media_type or media_type_for_path(resolution.file_path),
        extra_headers=_playback_headers(resolution),
        require_auth=False,
    )

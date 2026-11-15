"""Crate Decks library navigation (S3): container tree and cursor-paged tracks; and
batch mix profiles (S4).

Session users only: `crv_` access tokens never reach these routes (the auth
middleware drops them) and the handlers refuse them too.
"""

from __future__ import annotations

import base64
import hashlib
import json
from typing import Any

from fastapi import APIRouter, HTTPException, Path, Query, Request, Response

from crate.api.auth import _require_auth
from crate.api.openapi_responses import (
    AUTH_ERROR_RESPONSES,
    OpenApiResponses,
    error_response,
    merge_responses,
)
from crate.api.schemas.decks import (
    DecksContainerKind,
    DecksContainerNodeResponse,
    DecksContainersResponse,
    DecksLibraryResponse,
    DecksMixProfilesRequest,
    DecksMixProfilesResponse,
    DecksTracksPageResponse,
)
from crate.api.smart_mix import full_mix_profile_response
from crate.db.queries.decks_library import (
    DECKS_PAGE_LIMIT,
    coerce_after,
    get_decks_container_tracks,
    get_decks_containers,
    normalize_container_id,
)
from crate.db.queries.decks_profiles import get_decks_mix_profiles
from crate.smart_mix.source import smart_mix_source_revision_from_stat
from crate.smart_mix.stems import choose_analysis
from crate.streaming.service import stat_playable_sources

router = APIRouter(prefix="/api/decks", tags=["browse"])

_NOT_MODIFIED: OpenApiResponses = {
    304: {"description": "Not modified: the If-None-Match ETag still matches."}
}
_TREE_RESPONSES = merge_responses(AUTH_ERROR_RESPONSES, _NOT_MODIFIED)
_TRACKS_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    _NOT_MODIFIED,
    {
        400: error_response("The cursor is not valid for this container."),
        403: error_response("The container belongs to another user."),
        404: error_response(
            "The container does not exist, or its id is not valid for its kind."
        ),
        422: error_response("The request parameters failed validation."),
    },
)


def _require_session_user(request: Request) -> dict:
    user = _require_auth(request)
    if user.get("auth_type") == "access_token":
        raise HTTPException(
            status_code=403,
            detail="The Decks library needs a user session, not an access token",
        )
    if user.get("id") is None:
        raise HTTPException(
            status_code=403, detail="The Decks library needs a Crate account"
        )
    return user


@router.get(
    "/containers",
    response_model=DecksContainersResponse,
    responses=_TREE_RESPONSES,
    summary="List the user's Decks library containers",
)
def decks_containers(request: Request) -> Response:
    """The library's track count, and playlists, crates, top genres, moods,
    recent and likes.

    Supports If-None-Match.
    """
    user = _require_session_user(request)
    tree = get_decks_containers(int(user["id"]))
    nodes = []
    for row in tree["containers"]:
        node = DecksContainerNodeResponse.model_validate(row).model_dump(mode="json")
        if node["track_count"] is None:
            del node["track_count"]
        nodes.append(node)
    library = DecksLibraryResponse.model_validate(tree["library"]).model_dump(
        mode="json"
    )
    return _conditional_json(request, {"library": library, "containers": nodes})


@router.get(
    "/containers/{kind}/{container_id}/tracks",
    response_model=DecksTracksPageResponse,
    responses=_TRACKS_RESPONSES,
    summary="Page through a Decks container's tracks with DJ fields",
)
def decks_container_tracks(
    request: Request,
    kind: DecksContainerKind,
    container_id: str = Path(max_length=64),
    cursor: str | None = Query(default=None, max_length=1024),
    limit: int = Query(default=DECKS_PAGE_LIMIT, ge=1, le=DECKS_PAGE_LIMIT),
) -> Response:
    """Tracks in container order, keyset-paginated. Supports If-None-Match."""
    user = _require_session_user(request)
    canonical_id = normalize_container_id(kind, container_id)
    if canonical_id is None:
        raise HTTPException(status_code=404, detail="Container not found")
    container_id = canonical_id
    after = _decode_cursor(cursor, kind, container_id) if cursor is not None else None
    page = get_decks_container_tracks(
        kind, container_id, user_id=int(user["id"]), after=after, limit=limit
    )
    if page is None:
        raise HTTPException(status_code=404, detail="Container not found")
    if not page["allowed"]:
        raise HTTPException(status_code=403, detail="This container is private")
    payload = DecksTracksPageResponse.model_validate(
        {
            "container": {"kind": kind, "id": container_id},
            "tracks": _with_audio_state(page["tracks"]),
            "next_cursor": (
                _encode_cursor(kind, container_id, page["next_after"])
                if page["next_after"]
                else None
            ),
        }
    ).model_dump(mode="json")
    return _conditional_json(request, payload)


@router.post(
    "/mix-profiles",
    response_model=DecksMixProfilesResponse,
    response_model_exclude_none=True,
    responses=merge_responses(
        AUTH_ERROR_RESPONSES,
        {
            403: error_response(
                "An access token, or a trusted-header user without a Crate account."
            ),
            422: error_response(
                "No UIDs, more than 200, a UID that is not one, or a detail other "
                "than full."
            ),
        },
    ),
    summary="Read the full Smart Mix profiles of up to 200 tracks",
)
def decks_mix_profiles(
    request: Request, payload: DecksMixProfilesRequest
) -> DecksMixProfilesResponse:
    """The `detail=full` profile of each track, as the single profile endpoint
    serves it, in one bounded query; tracks without a current profile are listed in
    `missing`."""
    _require_session_user(request)
    uids = list(dict.fromkeys(str(uid) for uid in payload.entity_uids))
    reads = get_decks_mix_profiles(uids)
    profiles = {}
    missing = []
    for uid in uids:
        read = reads.get(uid)
        if read is None:
            missing.append(uid)
            continue
        analysis = choose_analysis(
            read.analyses, source_revision=read.profile.source_revision
        )
        profiles[uid] = full_mix_profile_response(read.profile, analysis)
    return DecksMixProfilesResponse(profiles=profiles, missing=missing)


def _with_audio_state(tracks: list[dict]) -> list[dict]:
    """Replace each server path with `playable`, `source_revision` and size.

    Same check as the stream endpoints and the DJ search (S9): a regular file
    inside the library. One stat per track gives all three: `byte_length`
    becomes the size of the file the stream serves, and keeps the scanner's
    size when there is no file.
    """
    stats = stat_playable_sources([track.get("path") for track in tracks])
    items = []
    for track, file_stat in zip(tracks, stats, strict=True):
        item = {key: value for key, value in track.items() if key != "path"}
        item["playable"] = file_stat is not None
        item["source_revision"] = (
            smart_mix_source_revision_from_stat(file_stat) if file_stat else None
        )
        if file_stat is not None:
            item["byte_length"] = file_stat.st_size
        items.append(item)
    return items


def _encode_cursor(kind: str, container_id: str, after: list[Any]) -> str:
    raw = json.dumps([kind, container_id, after], separators=(",", ":"))
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def _decode_cursor(cursor: str, kind: str, container_id: str) -> list[Any]:
    invalid = HTTPException(status_code=400, detail="Invalid cursor for this container")
    try:
        raw = base64.b64decode(
            cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True
        )
        decoded = json.loads(raw)
    except ValueError as exc:
        raise invalid from exc
    if (
        not isinstance(decoded, list)
        or len(decoded) != 3
        or decoded[0] != kind
        or decoded[1] != container_id
        or not isinstance(decoded[2], list)
    ):
        raise invalid
    try:
        return coerce_after(kind, decoded[2])
    except ValueError as exc:
        raise invalid from exc


def _conditional_json(request: Request, payload: dict) -> Response:
    """Serve `payload` with a strong ETag, or 304 when If-None-Match matches."""
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode()
    etag = f'"{hashlib.sha256(body).hexdigest()[:32]}"'
    headers = {"ETag": etag, "Cache-Control": "private, no-cache"}
    if _etag_matches(request.headers.get("if-none-match", ""), etag):
        return Response(status_code=304, headers=headers)
    return Response(content=body, media_type="application/json", headers=headers)


def _etag_matches(header: str, etag: str) -> bool:
    for candidate in header.split(","):
        candidate = candidate.strip()
        if candidate.startswith("W/"):
            candidate = candidate[2:]
        if candidate in {"*", etag}:
            return True
    return False

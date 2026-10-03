"""Listen Crate API and collaboration workflow."""

import os
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, Response, status
from fastapi.responses import FileResponse

from crate.api.auth import _require_auth
from crate.api.openapi_responses import (
    AUTH_ERROR_RESPONSES,
    error_response,
    merge_responses,
)
from crate.api.schemas.common import OkResponse
from crate.api.schemas.crates import (
    AddCrateAlbumRequest,
    CrateAlbumResponse,
    CrateCreateResponse,
    CrateDetailResponse,
    CrateDownloadResponse,
    CrateInviteAcceptResponse,
    CrateInvitePreviewResponse,
    CrateInviteResponse,
    CrateMemberResponse,
    CrateMembersMutationResponse,
    CratePlaybackTrackResponse,
    CrateSummaryResponse,
    CreateCrateInviteRequest,
    CreateCrateRequest,
    ReorderCrateAlbumsRequest,
    UpdateCrateRequest,
)
from crate.crate_download import (
    CRATE_DOWNLOAD_KIND,
    CRATE_DOWNLOAD_TASK_TYPE,
    crate_download_dedup_key,
    crate_download_filename,
    crate_download_url,
    is_crate_download_cache_key,
)
from crate.db.queries.crates import (
    get_active_crate_invites,
    get_crate_access,
    get_crate_download_source_for_user,
    get_crate_for_user,
    get_crate_invite,
    get_crate_members,
    get_crate_playback_tracks_for_user,
    get_crates_for_user,
    get_followed_crates_for_user,
    resolve_crate_ref,
)
from crate.db.repositories.crates import (
    CrateAlbumAlreadyExistsError,
    CrateAlbumNotFoundError,
    CrateAccessDeniedError,
    CrateCollaborationDisabledError,
    CrateInviteExhaustedError,
    CrateNotFoundError,
    CrateSelfFollowError,
    InvalidCrateAlbumOrderError,
    accept_crate_invite,
    add_crate_album,
    create_crate,
    create_crate_invite,
    delete_crate,
    follow_crate,
    remove_crate_album,
    remove_crate_member,
    reorder_crate_albums,
    revoke_crate_invite,
    unfollow_crate,
    update_crate,
)
from crate.db.repositories.tasks import (
    create_task_dedup,
    find_active_task_by_type_params,
)
from crate.download_cache import (
    crate_cache_ttl_seconds,
    crate_download_cache_key,
    download_cache_enabled,
    find_cached_download,
    get_cached_download,
)

router = APIRouter(prefix="/api/crates", tags=["crates"])
me_router = APIRouter(prefix="/api/me", tags=["crates"])

_CRATE_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        400: error_response("The request could not be processed."),
        403: error_response("You are not allowed to manage this Crate."),
        404: error_response("The requested Crate resource could not be found."),
        409: error_response("The Crate conflicts with its current state."),
        422: error_response("The request payload failed validation."),
    },
)


def _require_crate_access(crate_id: UUID, user_id: int) -> str:
    access = get_crate_access(str(crate_id), user_id)
    if access == "none":
        raise HTTPException(status_code=404, detail="Crate not found")
    return access


def _require_editor(crate_id: UUID, user_id: int) -> str:
    access = _require_crate_access(crate_id, user_id)
    if access not in {"owner", "collaborator"}:
        raise HTTPException(status_code=403, detail="Not allowed to edit this Crate")
    return access


def _require_owner(crate_id: UUID, user_id: int, *, detail: str) -> None:
    access = _require_crate_access(crate_id, user_id)
    if access != "owner":
        raise HTTPException(status_code=403, detail=detail)


def _listen_public_origin() -> str:
    listen_origin = os.environ.get("CRATE_LISTEN_PUBLIC_BASE_URL")
    if not listen_origin:
        raise RuntimeError("CRATE_LISTEN_PUBLIC_BASE_URL must be configured")
    return listen_origin.rstrip("/")


def _invite_join_url(token: str, *, listen_origin: str | None = None) -> str:
    origin = listen_origin or _listen_public_origin()
    return f"{origin}/crate/invite/{token}"


@router.get(
    "",
    response_model=list[CrateSummaryResponse],
    responses=AUTH_ERROR_RESPONSES,
    summary="List Crates owned by or shared with the current user",
)
def list_crates(request: Request):
    user = _require_auth(request)
    return get_crates_for_user(user["id"])


@me_router.get(
    "/crates",
    response_model=list[CrateSummaryResponse],
    responses=AUTH_ERROR_RESPONSES,
    summary="List the current user's Crates",
)
def list_my_crates(request: Request):
    user = _require_auth(request)
    return get_crates_for_user(user["id"])


@me_router.get(
    "/crates/followed",
    response_model=list[CrateSummaryResponse],
    responses=AUTH_ERROR_RESPONSES,
    summary="List public Crates followed by the current user",
)
def list_followed_crates(request: Request):
    user = _require_auth(request)
    return get_followed_crates_for_user(user["id"])


@router.post(
    "",
    response_model=CrateCreateResponse,
    status_code=status.HTTP_201_CREATED,
    responses=_CRATE_RESPONSES,
    summary="Create a private Crate",
)
def create(request: Request, body: CreateCrateRequest):
    user = _require_auth(request)
    crate_id = create_crate(
        owner_id=user["id"],
        name=body.name,
        description=body.description,
        visibility=body.visibility,
        is_collaborative=body.is_collaborative,
        is_ordered=body.is_ordered,
        sort_direction=body.sort_direction,
        loop_enabled=body.loop_enabled,
    )
    return {"id": crate_id}


@router.get(
    "/invites/{token}",
    response_model=CrateInvitePreviewResponse,
    responses=_CRATE_RESPONSES,
    summary="Get a valid Crate invitation preview",
)
def get_invite(request: Request, token: str):
    user = _require_auth(request)
    invite = get_crate_invite(token, user["id"])
    if invite is None:
        raise HTTPException(status_code=404, detail="Invite not found or expired")
    return invite


@router.post(
    "/invites/{token}/accept",
    response_model=CrateInviteAcceptResponse,
    responses=_CRATE_RESPONSES,
    summary="Accept a Crate invitation",
)
def accept_invite(request: Request, token: str):
    user = _require_auth(request)
    try:
        accepted = accept_crate_invite(token, user["id"])
    except CrateInviteExhaustedError as exc:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Invite has reached its maximum uses",
        ) from exc
    if accepted is None:
        raise HTTPException(status_code=404, detail="Invite not found or expired")
    crate_id = accepted["crate_id"]
    return {"ok": True, "crate_id": crate_id}


@router.get(
    "/{crate_id}",
    response_model=CrateDetailResponse,
    responses=_CRATE_RESPONSES,
    summary="Get a Crate and its ordered albums",
)
def get_one(request: Request, crate_id: str):
    resolved_id = resolve_crate_ref(crate_id)
    if resolved_id is None:
        raise HTTPException(status_code=404, detail="Crate not found")
    user = getattr(getattr(request, "state", None), "user", None)
    crate, access = get_crate_for_user(resolved_id, int(user["id"]) if user else None)
    if crate is None:
        raise HTTPException(status_code=404, detail="Crate not found")
    crate["access"] = access
    return crate


@router.get(
    "/{crate_id}/playback",
    response_model=list[CratePlaybackTrackResponse],
    responses=_CRATE_RESPONSES,
    summary=(
        "Get playable tracks for an accessible Crate in album order "
        "(public Crates are available to authenticated users)"
    ),
)
def playback(request: Request, crate_id: UUID):
    user = _require_auth(request)
    tracks = get_crate_playback_tracks_for_user(str(crate_id), user["id"])
    if tracks is None:
        raise HTTPException(status_code=404, detail="Crate not found")
    return tracks


@router.post(
    "/{crate_id}/follow",
    response_model=OkResponse,
    responses=_CRATE_RESPONSES,
    summary="Follow a public Crate",
)
def follow(request: Request, crate_id: UUID):
    user = _require_auth(request)
    try:
        follow_crate(str(crate_id), user["id"])
    except CrateNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Public Crate not found") from exc
    except CrateSelfFollowError as exc:
        raise HTTPException(
            status_code=409, detail="You cannot follow your own Crate"
        ) from exc
    return {"ok": True}


@router.delete(
    "/{crate_id}/follow",
    response_model=OkResponse,
    responses=_CRATE_RESPONSES,
    summary="Unfollow a Crate",
)
def unfollow(request: Request, crate_id: UUID):
    user = _require_auth(request)
    unfollow_crate(str(crate_id), user["id"])
    return {"ok": True}


def _is_crate_download_cached(cache_key: str, filename: str) -> bool:
    cached = get_cached_download(
        CRATE_DOWNLOAD_KIND,
        cache_key,
        filename,
        ttl_seconds=crate_cache_ttl_seconds(),
    )
    return cached is not None


def _queue_crate_download(crate_id: str, cache_key: str) -> str | None:
    dedup_key = crate_download_dedup_key(cache_key)
    task_id = create_task_dedup(
        CRATE_DOWNLOAD_TASK_TYPE, {"crate_id": crate_id}, dedup_key=dedup_key
    )
    return task_id or find_active_task_by_type_params(
        CRATE_DOWNLOAD_TASK_TYPE, dedup_key=dedup_key
    )


@router.post(
    "/{crate_id}/download",
    response_model=CrateDownloadResponse,
    responses=merge_responses(
        _CRATE_RESPONSES,
        {
            202: {
                "model": CrateDownloadResponse,
                "description": "The ZIP archive is being prepared by the worker.",
            },
            503: error_response("The download cache is disabled."),
        },
    ),
    summary="Prepare a ZIP archive of the local tracks in a Crate",
)
def request_download(request: Request, response: Response, crate_id: UUID):
    user = _require_auth(request)
    crate, tracks = get_crate_download_source_for_user(str(crate_id), user["id"])
    if crate is None:
        raise HTTPException(status_code=404, detail="Crate not found")
    if not tracks:
        raise HTTPException(
            status_code=404, detail="Crate has no downloadable local tracks"
        )
    if not download_cache_enabled():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Download cache is disabled",
        )

    cache_key = crate_download_cache_key(crate, tracks)
    filename = crate_download_filename(crate.get("name"))
    ready = {
        "status": "ready",
        "download_url": crate_download_url(str(crate_id), cache_key),
        "filename": filename,
    }
    if _is_crate_download_cached(cache_key, filename):
        return ready
    task_id = _queue_crate_download(str(crate_id), cache_key)
    if task_id is None:
        if _is_crate_download_cached(cache_key, filename):
            return ready
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Crate download could not be queued",
        )
    response.status_code = status.HTTP_202_ACCEPTED
    return {"status": "pending", "task_id": task_id, "filename": filename}


@router.get(
    "/{crate_id}/download/{cache_key}",
    responses=merge_responses(
        _CRATE_RESPONSES,
        {
            200: {
                "description": "ZIP archive of the Crate's local tracks.",
                "content": {"application/zip": {}},
            }
        },
    ),
    summary="Download a prepared Crate ZIP archive",
)
def download_artifact(request: Request, crate_id: UUID, cache_key: str):
    user = _require_auth(request)
    _require_crate_access(crate_id, user["id"])
    if not is_crate_download_cache_key(cache_key):
        raise HTTPException(status_code=404, detail="Download not found")
    found = find_cached_download(
        CRATE_DOWNLOAD_KIND, cache_key, ttl_seconds=crate_cache_ttl_seconds()
    )
    if found is None:
        raise HTTPException(status_code=404, detail="Download not found")
    cached, metadata = found
    if metadata.get("crate_id") != str(crate_id):
        raise HTTPException(status_code=404, detail="Download not found")
    return FileResponse(
        cached.path,
        media_type="application/zip",
        filename=str(metadata.get("filename") or cached.filename),
    )


@router.put(
    "/{crate_id}",
    response_model=OkResponse,
    responses=_CRATE_RESPONSES,
    summary="Update Crate details",
)
def update(request: Request, crate_id: UUID, body: UpdateCrateRequest):
    user = _require_auth(request)
    access = _require_editor(crate_id, user["id"])
    if (
        body.visibility is not None or body.is_collaborative is not None
    ) and access != "owner":
        raise HTTPException(
            status_code=403,
            detail="Only the owner can change Crate visibility or collaboration",
        )

    try:
        update_crate(
            str(crate_id),
            name=body.name,
            description=body.description,
            visibility=body.visibility,
            is_collaborative=body.is_collaborative,
            is_ordered=body.is_ordered,
            sort_direction=body.sort_direction,
            loop_enabled=body.loop_enabled,
            actor_id=user["id"],
        )
    except CrateNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Crate not found") from exc
    except CrateAccessDeniedError as exc:
        raise HTTPException(
            status_code=403, detail="Not allowed to edit this Crate"
        ) from exc
    return {"ok": True}


@router.delete(
    "/{crate_id}",
    response_model=OkResponse,
    responses=_CRATE_RESPONSES,
    summary="Delete a Crate",
)
def delete(request: Request, crate_id: UUID):
    user = _require_auth(request)
    _require_owner(
        crate_id,
        user["id"],
        detail="Only the owner can delete this Crate",
    )
    try:
        delete_crate(str(crate_id), actor_id=user["id"])
    except CrateNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Crate not found") from exc
    except CrateAccessDeniedError as exc:
        raise HTTPException(
            status_code=403, detail="Only the owner can delete this Crate"
        ) from exc
    return {"ok": True}


@router.post(
    "/{crate_id}/albums",
    response_model=CrateAlbumResponse,
    status_code=status.HTTP_201_CREATED,
    responses=_CRATE_RESPONSES,
    summary="Add an album to a Crate",
)
def add_album(request: Request, crate_id: UUID, body: AddCrateAlbumRequest):
    user = _require_auth(request)
    _require_editor(crate_id, user["id"])
    try:
        added_album = add_crate_album(
            str(crate_id), str(body.global_album_uid), added_by=user["id"]
        )
    except CrateNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Crate not found") from exc
    except CrateAccessDeniedError as exc:
        raise HTTPException(
            status_code=403, detail="Not allowed to edit this Crate"
        ) from exc
    except CrateAlbumNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Album not found") from exc
    except CrateAlbumAlreadyExistsError as exc:
        raise HTTPException(
            status_code=409, detail="Album is already in this Crate"
        ) from exc
    return added_album


@router.delete(
    "/{crate_id}/albums/{global_album_uid}",
    response_model=OkResponse,
    responses=_CRATE_RESPONSES,
    summary="Remove an album from a Crate",
)
def delete_album(request: Request, crate_id: UUID, global_album_uid: UUID):
    user = _require_auth(request)
    _require_editor(crate_id, user["id"])
    try:
        removed = remove_crate_album(
            str(crate_id), str(global_album_uid), actor_id=user["id"]
        )
    except CrateNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Crate not found") from exc
    except CrateAccessDeniedError as exc:
        raise HTTPException(
            status_code=403, detail="Not allowed to edit this Crate"
        ) from exc
    if not removed:
        raise HTTPException(status_code=404, detail="Album not found in Crate")
    return {"ok": True}


@router.put(
    "/{crate_id}/albums/order",
    response_model=OkResponse,
    responses=_CRATE_RESPONSES,
    summary="Reorder albums in a Crate",
)
def reorder_albums(request: Request, crate_id: UUID, body: ReorderCrateAlbumsRequest):
    user = _require_auth(request)
    _require_editor(crate_id, user["id"])
    try:
        reorder_crate_albums(
            str(crate_id),
            [str(album_uid) for album_uid in body.global_album_uids],
            actor_id=user["id"],
        )
    except CrateAccessDeniedError as exc:
        raise HTTPException(
            status_code=403, detail="Not allowed to edit this Crate"
        ) from exc
    except CrateNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Crate not found") from exc
    except InvalidCrateAlbumOrderError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"ok": True}


@router.get(
    "/{crate_id}/members",
    response_model=list[CrateMemberResponse],
    responses=_CRATE_RESPONSES,
    summary="List the Crate owner and collaborators",
)
def members(request: Request, crate_id: UUID):
    user = _require_auth(request)
    access = _require_crate_access(crate_id, user["id"])
    if access not in {"owner", "collaborator"}:
        raise HTTPException(
            status_code=403, detail="Only Crate members can view its members"
        )
    return get_crate_members(str(crate_id))


@router.delete(
    "/{crate_id}/members/{user_id}",
    response_model=CrateMembersMutationResponse,
    responses=_CRATE_RESPONSES,
    summary="Remove a Crate collaborator, or leave a Crate as a collaborator",
)
def delete_member(request: Request, crate_id: UUID, user_id: int):
    user = _require_auth(request)
    access = _require_crate_access(crate_id, user["id"])
    is_self = user_id == user["id"]
    if access == "owner" and is_self:
        raise HTTPException(
            status_code=409, detail="The owner cannot leave their own Crate"
        )
    if access != "owner" and not (is_self and access == "collaborator"):
        raise HTTPException(
            status_code=403, detail="Only the owner can manage Crate members"
        )
    try:
        removed = remove_crate_member(str(crate_id), user_id, actor_id=user["id"])
    except CrateNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Crate not found") from exc
    except CrateAccessDeniedError as exc:
        raise HTTPException(
            status_code=403, detail="Only the owner can manage Crate members"
        ) from exc
    if not removed:
        raise HTTPException(status_code=404, detail="Crate member not found")
    if is_self:
        return {"ok": True, "members": []}
    return {"ok": True, "members": get_crate_members(str(crate_id))}


@router.get(
    "/{crate_id}/invites",
    response_model=list[CrateInviteResponse],
    responses=_CRATE_RESPONSES,
    summary="List active Crate collaboration invites",
)
def list_invites(request: Request, crate_id: UUID):
    user = _require_auth(request)
    _require_owner(
        crate_id,
        user["id"],
        detail="Only the owner can manage Crate invites",
    )
    invites = get_active_crate_invites(str(crate_id))
    if not invites:
        return []
    try:
        listen_origin = _listen_public_origin()
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Listen public URL is not configured",
        ) from exc
    result = []
    for invite_row in invites:
        join_url = _invite_join_url(invite_row["token"], listen_origin=listen_origin)
        result.append({**invite_row, "join_url": join_url, "qr_value": join_url})
    return result


@router.post(
    "/{crate_id}/invites",
    response_model=CrateInviteResponse,
    status_code=status.HTTP_201_CREATED,
    responses=_CRATE_RESPONSES,
    summary="Create a Crate collaboration invite",
)
def invite(request: Request, crate_id: UUID, body: CreateCrateInviteRequest):
    user = _require_auth(request)
    _require_owner(
        crate_id,
        user["id"],
        detail="Only the owner can manage Crate invites",
    )
    try:
        listen_origin = _listen_public_origin()
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Listen public URL is not configured",
        ) from exc
    try:
        invite_row = create_crate_invite(
            str(crate_id),
            user["id"],
            expires_in_hours=body.expires_in_hours,
            max_uses=body.max_uses,
        )
    except CrateNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Crate not found") from exc
    except CrateCollaborationDisabledError as exc:
        raise HTTPException(
            status_code=409, detail="Enable collaboration before creating an invite"
        ) from exc
    except CrateAccessDeniedError as exc:
        raise HTTPException(
            status_code=403, detail="Only the owner can manage Crate invites"
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    join_url = _invite_join_url(invite_row["token"], listen_origin=listen_origin)
    return {**invite_row, "join_url": join_url, "qr_value": join_url}


@router.delete(
    "/{crate_id}/invites/{token}",
    response_model=OkResponse,
    responses=_CRATE_RESPONSES,
    summary="Revoke a Crate invitation",
)
def revoke_invite(request: Request, crate_id: UUID, token: str):
    user = _require_auth(request)
    _require_owner(
        crate_id,
        user["id"],
        detail="Only the owner can manage Crate invites",
    )
    try:
        revoked = revoke_crate_invite(str(crate_id), token, actor_id=user["id"])
    except CrateNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Crate not found") from exc
    except CrateAccessDeniedError as exc:
        raise HTTPException(
            status_code=403, detail="Only the owner can manage Crate invites"
        ) from exc
    if not revoked:
        raise HTTPException(status_code=404, detail="Invite not found")
    return {"ok": True}


__all__ = ["me_router", "router"]

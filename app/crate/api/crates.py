"""Listen Crate API and collaboration workflow."""

from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, status

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
from crate.db.queries.crates import (
    get_crate,
    get_crate_access,
    get_crate_invite,
    get_crate_members,
    get_crate_playback_tracks,
    get_crates_for_user,
)
from crate.db.repositories.crates import (
    CrateAlbumAlreadyExistsError,
    CrateAlbumNotFoundError,
    CrateCollaborationDisabledError,
    CrateNotFoundError,
    InvalidCrateAlbumOrderError,
    accept_crate_invite,
    add_crate_album,
    create_crate,
    create_crate_invite,
    delete_crate,
    remove_crate_album,
    remove_crate_member,
    reorder_crate_albums,
    revoke_crate_invite,
    update_crate,
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


def _require_owner(crate_id: UUID, user_id: int) -> None:
    access = _require_crate_access(crate_id, user_id)
    if access != "owner":
        raise HTTPException(
            status_code=403, detail="Only the owner can manage Crate members"
        )


def _get_crate_or_404(crate_id: UUID) -> dict:
    crate = get_crate(str(crate_id))
    if crate is None:
        raise HTTPException(status_code=404, detail="Crate not found")
    return crate


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
        is_collaborative=body.is_collaborative,
    )
    return {"id": crate_id}


@router.get(
    "/invites/{token}",
    response_model=CrateInvitePreviewResponse,
    responses=_CRATE_RESPONSES,
    summary="Get a valid Crate invitation preview",
)
def get_invite(request: Request, token: str):
    _require_auth(request)
    invite = get_crate_invite(token)
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
    accepted = accept_crate_invite(token, user["id"])
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
def get_one(request: Request, crate_id: UUID):
    user = _require_auth(request)
    access = _require_crate_access(crate_id, user["id"])
    crate = _get_crate_or_404(crate_id)
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
    _require_crate_access(crate_id, user["id"])
    return get_crate_playback_tracks(str(crate_id))


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

    if not update_crate(
        str(crate_id),
        name=body.name,
        description=body.description,
        visibility=body.visibility,
        is_collaborative=body.is_collaborative,
    ):
        raise HTTPException(status_code=404, detail="Crate not found")
    return {"ok": True}


@router.delete(
    "/{crate_id}",
    response_model=OkResponse,
    responses=_CRATE_RESPONSES,
    summary="Delete a Crate",
)
def delete(request: Request, crate_id: UUID):
    user = _require_auth(request)
    _require_owner(crate_id, user["id"])
    if not delete_crate(str(crate_id)):
        raise HTTPException(status_code=404, detail="Crate not found")
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
    removed = remove_crate_album(str(crate_id), str(global_album_uid))
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
            str(crate_id), [str(album_uid) for album_uid in body.global_album_uids]
        )
    except CrateNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Crate not found") from exc
    except InvalidCrateAlbumOrderError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"ok": True}


@router.get(
    "/{crate_id}/members",
    response_model=list[CrateMemberResponse],
    responses=_CRATE_RESPONSES,
    summary="List Crate collaborators",
)
def members(request: Request, crate_id: UUID):
    user = _require_auth(request)
    _require_owner(crate_id, user["id"])
    return get_crate_members(str(crate_id))


@router.delete(
    "/{crate_id}/members/{user_id}",
    response_model=CrateMembersMutationResponse,
    responses=_CRATE_RESPONSES,
    summary="Remove a Crate collaborator",
)
def delete_member(request: Request, crate_id: UUID, user_id: int):
    user = _require_auth(request)
    _require_owner(crate_id, user["id"])
    if not remove_crate_member(str(crate_id), user_id):
        raise HTTPException(status_code=404, detail="Crate member not found")
    return {"ok": True, "members": get_crate_members(str(crate_id))}


@router.post(
    "/{crate_id}/invites",
    response_model=CrateInviteResponse,
    status_code=status.HTTP_201_CREATED,
    responses=_CRATE_RESPONSES,
    summary="Create a Crate collaboration invite",
)
def invite(request: Request, crate_id: UUID, body: CreateCrateInviteRequest):
    user = _require_auth(request)
    _require_owner(crate_id, user["id"])
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

    join_url = f"/crate/invite/{invite_row['token']}"
    return {**invite_row, "join_url": join_url, "qr_value": join_url}


@router.delete(
    "/{crate_id}/invites/{token}",
    response_model=OkResponse,
    responses=_CRATE_RESPONSES,
    summary="Revoke a Crate invitation",
)
def revoke_invite(request: Request, crate_id: UUID, token: str):
    user = _require_auth(request)
    _require_owner(crate_id, user["id"])
    if not revoke_crate_invite(str(crate_id), token):
        raise HTTPException(status_code=404, detail="Invite not found")
    return {"ok": True}


__all__ = ["me_router", "router"]

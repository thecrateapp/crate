from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from crate.api.auth import _require_auth
from crate.api.openapi_responses import (
    AUTH_ERROR_RESPONSES,
    error_response,
    merge_responses,
)
from crate.api.playlist_utils import apply_playlist_cover_payload
from crate.api.schemas.common import OkResponse
from crate.api.schemas.playlists import (
    AddTracksRequest,
    CreatePlaylistRequest,
    PlaylistCopyResponse,
    PlaylistCreateResponse,
    PlaylistDetailResponse,
    PlaylistFilterOptionsResponse,
    PlaylistFollowResponse,
    PlaylistGenerateResponse,
    PlaylistInviteAcceptResponse,
    PlaylistInviteRequest,
    PlaylistInviteResponse,
    PlaylistMemberRequest,
    PlaylistMemberResponse,
    PlaylistMembersMutationResponse,
    PlaylistSummaryResponse,
    PlaylistTracksAddedResponse,
    ReorderRequest,
    UpdatePlaylistRequest,
)
from crate.db.genres import get_all_genres
from crate.db.repositories.playlists import (
    add_playlist_tracks,
    can_edit_playlist,
    can_view_playlist,
    create_playlist,
    delete_playlist,
    execute_smart_rules,
    get_playlist,
    get_playlist_filter_options,
    get_playlist_members,
    get_playlist_tracks,
    get_playlists,
    is_playlist_owner,
    regenerate_playlist_tracks,
    remove_playlist_member,
    remove_playlist_track,
    reorder_playlist,
    update_playlist,
)
from crate.db.repositories.playlists_collection_reads import get_playlist_follow_state
from crate.db.repositories.playlists_collaboration import (
    add_playlist_collaborator,
    copy_playlist,
    leave_playlist,
)
from crate.db.repositories.playlists_follows import follow_playlist, unfollow_playlist
from crate.db.repositories.playlists_membership_reads import get_playlist_access
from crate.db.repositories.users import get_user_by_username
from crate.playlist_covers import delete_playlist_cover, playlist_cover_abspath

router = APIRouter(prefix="/api/playlists", tags=["playlists"])

_PLAYLIST_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        400: error_response("The request could not be processed."),
        404: error_response("The requested playlist resource could not be found."),
        422: error_response("The request payload failed validation."),
    },
)

_PLAYLIST_COVER_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        200: {
            "description": "Playlist cover image.",
            "content": {
                "image/jpeg": {"schema": {"type": "string", "format": "binary"}},
                "image/png": {"schema": {"type": "string", "format": "binary"}},
                "image/webp": {"schema": {"type": "string", "format": "binary"}},
            },
        },
        404: error_response("The requested playlist cover could not be found."),
    },
)


# ── Filter options ───────────────────────────────────────────────


@router.get(
    "/filter-options",
    response_model=PlaylistFilterOptionsResponse,
    responses={
        200: {
            "description": "Available smart-playlist filter values.",
        }
    },
    summary="List available smart-playlist filter options",
)
def filter_options():
    """Return available values for smart playlist filters."""
    genres = [g["name"] for g in get_all_genres()]
    opts = get_playlist_filter_options()
    return {"genres": genres, **opts}


# ── CRUD ─────────────────────────────────────────────────────────


@router.get(
    "",
    response_model=list[PlaylistSummaryResponse],
    responses=AUTH_ERROR_RESPONSES,
    summary="List playlists visible to the current user",
)
def list_playlists(request: Request):
    user = _require_auth(request)
    playlists = get_playlists(user_id=user["id"])
    return playlists


@router.post(
    "",
    response_model=PlaylistCreateResponse,
    responses=_PLAYLIST_RESPONSES,
    summary="Create a playlist",
)
def create(request: Request, body: CreatePlaylistRequest):
    user = _require_auth(request)
    if not body.name.strip():
        raise HTTPException(status_code=422, detail="Name is required")
    playlist_id = create_playlist(
        name=body.name.strip(),
        description=body.description,
        user_id=user["id"],
        is_smart=body.is_smart,
        smart_rules=body.smart_rules,
        visibility=body.visibility,
        is_collaborative=body.is_collaborative,
    )
    cover_update = apply_playlist_cover_payload(playlist_id, body.cover_data_url)
    if cover_update:
        update_playlist(playlist_id, **cover_update)
    return {"id": playlist_id}


@router.get(
    "/{playlist_id}",
    response_model=PlaylistDetailResponse,
    responses=_PLAYLIST_RESPONSES,
    summary="Get a playlist with tracks and members",
)
def get_one(request: Request, playlist_id: int):
    user = _require_auth(request)
    pl = get_playlist(playlist_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    access = get_playlist_access(pl, user["id"])
    if access == "none" and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Playlist is private")
    pl["tracks"] = get_playlist_tracks(playlist_id)
    pl["access"] = access
    pl["can_edit"] = access in {"owner", "collaborator"}
    pl.update(get_playlist_follow_state(playlist_id, user["id"]))
    pl["members"] = (
        get_playlist_members(playlist_id) if access in {"owner", "collaborator"} else []
    )
    return pl


@router.put(
    "/{playlist_id}",
    response_model=OkResponse,
    responses=_PLAYLIST_RESPONSES,
    summary="Update a playlist",
)
def update(request: Request, playlist_id: int, body: UpdatePlaylistRequest):
    user = _require_auth(request)
    pl = get_playlist(playlist_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if user.get("role") != "admin" and not can_edit_playlist(pl, user["id"]):
        raise HTTPException(status_code=403, detail="Not allowed to edit this playlist")
    kwargs = {}
    if body.name is not None:
        kwargs["name"] = body.name.strip()
    if body.description is not None:
        kwargs["description"] = body.description
    if body.cover_data_url is not None:
        kwargs.update(
            apply_playlist_cover_payload(
                playlist_id, body.cover_data_url, pl.get("cover_path")
            )
            or {}
        )
    if body.smart_rules is not None:
        kwargs["smart_rules"] = body.smart_rules
    if body.visibility is not None:
        if user.get("role") != "admin" and not is_playlist_owner(pl, user["id"]):
            raise HTTPException(
                status_code=403, detail="Only the owner can change playlist visibility"
            )
        kwargs["visibility"] = body.visibility
    if body.is_collaborative is not None:
        if user.get("role") != "admin" and not is_playlist_owner(pl, user["id"]):
            raise HTTPException(
                status_code=403,
                detail="Only the owner can change playlist collaboration",
            )
        kwargs["is_collaborative"] = body.is_collaborative
    if kwargs:
        update_playlist(playlist_id, **kwargs)
    return {"ok": True}


@router.delete(
    "/{playlist_id}",
    response_model=OkResponse,
    responses=_PLAYLIST_RESPONSES,
    summary="Delete a playlist",
)
def delete(request: Request, playlist_id: int):
    user = _require_auth(request)
    pl = get_playlist(playlist_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if user.get("role") != "admin" and not is_playlist_owner(pl, user["id"]):
        raise HTTPException(
            status_code=403, detail="Only the owner can delete this playlist"
        )
    delete_playlist_cover(pl.get("cover_path"))
    delete_playlist(playlist_id)
    return {"ok": True}


@router.get(
    "/{playlist_id}/cover",
    responses=_PLAYLIST_COVER_RESPONSES,
    summary="Fetch the cover image for a playlist",
)
def get_cover(request: Request, playlist_id: int):
    user = _require_auth(request)
    pl = get_playlist(playlist_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if user.get("role") != "admin" and not can_view_playlist(pl, user["id"]):
        raise HTTPException(status_code=403, detail="Playlist is private")
    cover_path = playlist_cover_abspath(pl.get("cover_path"))
    if not cover_path or not cover_path.exists():
        raise HTTPException(status_code=404, detail="Cover not found")
    return FileResponse(cover_path)


# ── Tracks ───────────────────────────────────────────────────────


@router.post(
    "/{playlist_id}/tracks",
    response_model=PlaylistTracksAddedResponse,
    responses=_PLAYLIST_RESPONSES,
    summary="Add tracks to a playlist",
)
def add_tracks(request: Request, playlist_id: int, body: AddTracksRequest):
    user = _require_auth(request)
    pl = get_playlist(playlist_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if user.get("role") != "admin" and not can_edit_playlist(pl, user["id"]):
        raise HTTPException(status_code=403, detail="Not allowed to edit this playlist")
    if not body.tracks:
        raise HTTPException(status_code=422, detail="No tracks provided")
    tracks = [track.model_dump(exclude_none=True) for track in body.tracks]
    from crate.federation.cross_instance import deny_remote_for_local_action

    for track in tracks:
        if track.get("global_track_uid") or track.get("globalTrackUid"):
            continue
        deny_remote_for_local_action(track, "add to playlist")
    added = add_playlist_tracks(playlist_id, tracks)
    return {"ok": True, "added": added}


@router.delete(
    "/{playlist_id}/tracks/{position}",
    response_model=OkResponse,
    responses=_PLAYLIST_RESPONSES,
    summary="Remove a track from a playlist by position",
)
def remove_track(request: Request, playlist_id: int, position: int):
    user = _require_auth(request)
    pl = get_playlist(playlist_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if user.get("role") != "admin" and not can_edit_playlist(pl, user["id"]):
        raise HTTPException(status_code=403, detail="Not allowed to edit this playlist")
    is_smart_playlist = bool(pl.get("is_smart") or pl.get("generation_mode") == "smart")
    remove_playlist_track(
        playlist_id,
        position,
        record_exclusion=is_smart_playlist,
        excluded_by_user_id=user["id"],
    )
    return {"ok": True}


@router.post(
    "/{playlist_id}/reorder",
    response_model=OkResponse,
    responses=_PLAYLIST_RESPONSES,
    summary="Reorder playlist tracks",
)
def reorder(request: Request, playlist_id: int, body: ReorderRequest):
    user = _require_auth(request)
    pl = get_playlist(playlist_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if user.get("role") != "admin" and not can_edit_playlist(pl, user["id"]):
        raise HTTPException(status_code=403, detail="Not allowed to edit this playlist")
    is_smart_playlist = bool(pl.get("is_smart") or pl.get("generation_mode") == "smart")
    reorder_playlist(playlist_id, body.track_ids, lock_tracks=is_smart_playlist)
    return {"ok": True}


# ── Smart playlist generation ───────────────────────────────────


@router.post(
    "/{playlist_id}/generate",
    response_model=PlaylistGenerateResponse,
    responses=_PLAYLIST_RESPONSES,
    summary="Generate tracks for a smart playlist",
)
def generate_smart(request: Request, playlist_id: int):
    """Re-generate tracks for a smart playlist based on its rules."""
    user = _require_auth(request)
    pl = get_playlist(playlist_id)
    if not pl or not pl.get("is_smart") or not pl.get("smart_rules"):
        raise HTTPException(
            status_code=400, detail="Not a smart playlist or no rules defined"
        )
    if user.get("role") != "admin" and not can_edit_playlist(pl, user["id"]):
        raise HTTPException(status_code=403, detail="Not allowed to edit this playlist")

    rules = pl["smart_rules"]
    tracks = execute_smart_rules(rules)
    target_count = int(rules.get("limit") or len(tracks or []) or 50)
    track_count = regenerate_playlist_tracks(
        playlist_id,
        tracks or [],
        target_count=target_count,
    )

    return {"ok": True, "track_count": track_count}


@router.get(
    "/{playlist_id}/members",
    response_model=list[PlaylistMemberResponse],
    responses=_PLAYLIST_RESPONSES,
    summary="List playlist members",
)
def members(request: Request, playlist_id: int):
    user = _require_auth(request)
    pl = get_playlist(playlist_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if user.get("role") != "admin" and get_playlist_access(pl, user["id"]) not in {
        "owner",
        "collaborator",
    }:
        raise HTTPException(status_code=403, detail="Only collaborators see members")
    return get_playlist_members(playlist_id)


@router.post(
    "/{playlist_id}/members",
    response_model=PlaylistMembersMutationResponse,
    responses=_PLAYLIST_RESPONSES,
    summary="Add or update a playlist member",
)
def add_member(request: Request, playlist_id: int, body: PlaylistMemberRequest):
    user = _require_auth(request)
    pl = get_playlist(playlist_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if user.get("role") != "admin" and not is_playlist_owner(pl, user["id"]):
        raise HTTPException(status_code=403, detail="Only the owner can manage members")
    if body.role != "collab":
        raise HTTPException(status_code=422, detail="Invalid member role")
    target_id = body.user_id
    if target_id is None and body.username:
        target = get_user_by_username(body.username.strip().lstrip("@"))
        target_id = int(target["id"]) if target else None
    if target_id is None:
        raise HTTPException(status_code=404, detail="User not found")
    if target_id == pl.get("user_id"):
        raise HTTPException(status_code=400, detail="The owner is already a member")
    add_playlist_collaborator(playlist_id, target_id, added_by=user["id"])
    return {"ok": True, "members": get_playlist_members(playlist_id)}


@router.post(
    "/{playlist_id}/leave",
    response_model=OkResponse,
    responses=_PLAYLIST_RESPONSES,
    summary="Leave a playlist you collaborate on",
)
def leave(request: Request, playlist_id: int):
    user = _require_auth(request)
    if not leave_playlist(playlist_id, user["id"]):
        raise HTTPException(status_code=404, detail="Not a collaborator")
    return {"ok": True}


def _followable_playlist(request: Request, playlist_id: int) -> tuple[dict, dict]:
    user = _require_auth(request)
    pl = get_playlist(playlist_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if get_playlist_access(pl, user["id"]) != "public":
        raise HTTPException(status_code=403, detail="Playlist cannot be followed")
    return user, pl


@router.post(
    "/{playlist_id}/follow",
    response_model=PlaylistFollowResponse,
    responses=_PLAYLIST_RESPONSES,
    summary="Follow a public playlist",
)
def follow(request: Request, playlist_id: int):
    user, _pl = _followable_playlist(request, playlist_id)
    follow_playlist(user["id"], playlist_id)
    return {"ok": True, **get_playlist_follow_state(playlist_id, user["id"])}


@router.delete(
    "/{playlist_id}/follow",
    response_model=PlaylistFollowResponse,
    responses=_PLAYLIST_RESPONSES,
    summary="Stop following a playlist",
)
def unfollow(request: Request, playlist_id: int):
    user = _require_auth(request)
    unfollow_playlist(user["id"], playlist_id)
    return {"ok": True, **get_playlist_follow_state(playlist_id, user["id"])}


@router.post(
    "/{playlist_id}/copy",
    response_model=PlaylistCopyResponse,
    responses=_PLAYLIST_RESPONSES,
    summary="Copy a playlist into the current user's playlists",
)
def copy(request: Request, playlist_id: int):
    user = _require_auth(request)
    pl = get_playlist(playlist_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if get_playlist_access(pl, user["id"]) == "none":
        raise HTTPException(status_code=403, detail="Playlist is private")
    new_id = copy_playlist(pl, get_playlist_tracks(playlist_id), user["id"])
    return {"id": new_id}


@router.delete(
    "/{playlist_id}/members/{user_id}",
    response_model=PlaylistMembersMutationResponse,
    responses=_PLAYLIST_RESPONSES,
    summary="Remove a playlist member",
)
def delete_member(request: Request, playlist_id: int, user_id: int):
    user = _require_auth(request)
    pl = get_playlist(playlist_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if user.get("role") != "admin" and not is_playlist_owner(pl, user["id"]):
        raise HTTPException(status_code=403, detail="Only the owner can manage members")
    if user_id == pl.get("user_id"):
        raise HTTPException(status_code=400, detail="The owner cannot be removed")
    removed = remove_playlist_member(playlist_id, user_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Member not found")
    return {"ok": True, "members": get_playlist_members(playlist_id)}


@router.post(
    "/{playlist_id}/invites",
    response_model=PlaylistInviteResponse,
    responses=_PLAYLIST_RESPONSES,
    summary="Create a playlist invite",
)
def invite(request: Request, playlist_id: int, body: PlaylistInviteRequest):
    _require_auth(request)
    raise HTTPException(
        status_code=410,
        detail="Invite links are disabled; the owner adds collaborators directly",
    )


@router.post(
    "/invites/{token}/accept",
    response_model=PlaylistInviteAcceptResponse,
    responses=_PLAYLIST_RESPONSES,
    summary="Accept a playlist invite",
)
def accept_invite(request: Request, token: str):
    _require_auth(request)
    raise HTTPException(
        status_code=410,
        detail="Invite links are disabled; ask the owner to add you",
    )

"""Smart Mix playlists (Smart Mix Stems, STEM-D2 and design section 5).

A playlist's owner turns Smart Mix on or off; the server then separates its tracks into
stems, within the instance's limits (admin settings ``stem_max_tracks_per_playlist`` and
``stem_max_tracks_per_user`` in ``/api/settings/smart-mix``). Crate Decks syncs the
user's Smart Mix playlists with "changes since revision N", and every client reads a
playlist's per-track progress here. Playlist responses carry a ``smartMix`` summary.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request

from crate.api.auth import _require_auth
from crate.api.openapi_responses import (
    AUTH_ERROR_RESPONSES,
    error_response,
    merge_responses,
)
from crate.api.schemas.smart_mix import (
    SmartMixPlaylistResponse,
    SmartMixPlaylistsResponse,
    SmartMixPlaylistStateCounts,
    SmartMixPlaylistStatusResponse,
    SmartMixPlaylistUpdateRequest,
    SmartMixTrackStateResponse,
)
from crate.db.repositories.playlists_membership_reads import get_playlist_access
from crate.db.repositories.smart_mix_playlists import (
    SmartMixPlaylistLimitError,
    SmartMixPlaylistNotFoundError,
    SmartMixPlaylistOwnerError,
    SmartMixPlaylistState,
    list_smart_mix_playlists,
    set_smart_mix_playlist,
    smart_mix_playlist_status,
)

router = APIRouter(prefix="/api/smart-mix/playlists", tags=["smart-mix"])

_LIST_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {422: error_response("sinceRevision is not a non-negative integer.")},
)
_STATUS_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        403: error_response("Only the playlist's owner and collaborators read it."),
        404: error_response("No playlist with this ID."),
    },
)
_UPDATE_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        403: error_response("Only the playlist's owner turns Smart Mix on or off."),
        404: error_response("No playlist with this ID."),
        409: error_response(
            "The playlist, or all of the owner's Smart Mix playlists, would hold "
            "more tracks than the instance allows."
        ),
        422: error_response("The body is not {enabled: boolean}."),
    },
)


@router.get(
    "",
    response_model=SmartMixPlaylistsResponse,
    responses=_LIST_RESPONSES,
    summary="List the caller's Smart Mix playlists changed since a revision",
)
def list_playlists(
    request: Request,
    since_revision: int | None = Query(
        default=None,
        alias="sinceRevision",
        ge=0,
        description="Only changes after this revision; all of them when omitted.",
    ),
) -> SmartMixPlaylistsResponse:
    user = _require_auth(request)
    states = list_smart_mix_playlists(int(user["id"]), since_revision=since_revision)
    cursor = max([since_revision or 0, *(state.revision for state in states)])
    return SmartMixPlaylistsResponse(
        revision=cursor,
        playlists=[_state_response(state.playlist_id, state) for state in states],
    )


@router.get(
    "/{playlist_id}",
    response_model=SmartMixPlaylistStatusResponse,
    responses=_STATUS_RESPONSES,
    summary="Read a playlist's Smart Mix state and per-track stem progress",
)
def playlist_status(
    request: Request, playlist_id: int
) -> SmartMixPlaylistStatusResponse:
    user = _require_auth(request)
    status = smart_mix_playlist_status(playlist_id)
    if status is None:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if user.get("role") != "admin" and get_playlist_access(
        status.playlist, int(user["id"])
    ) not in {"owner", "collaborator"}:
        raise HTTPException(
            status_code=403,
            detail="Only the playlist's owner and collaborators read its Smart Mix state",
        )
    state = _state_response(playlist_id, status.state)
    return SmartMixPlaylistStatusResponse(
        **state.model_dump(),
        total=len(status.tracks),
        counts=SmartMixPlaylistStateCounts(**status.counts),
        tracks=[
            SmartMixTrackStateResponse(
                track_id=track.track_id,
                track_entity_uid=track.entity_uid,
                state=track.state,
                attempts=track.attempts,
            )
            for track in status.tracks
        ],
        estimated_seconds_left=status.estimated_seconds_left,
    )


@router.put(
    "/{playlist_id}",
    response_model=SmartMixPlaylistResponse,
    responses=_UPDATE_RESPONSES,
    summary="Turn a playlist's Smart Mix on or off",
)
def update_playlist(
    request: Request, playlist_id: int, body: SmartMixPlaylistUpdateRequest
) -> SmartMixPlaylistResponse:
    user = _require_auth(request)
    try:
        state = set_smart_mix_playlist(
            playlist_id, user_id=int(user["id"]), enabled=body.enabled
        )
    except SmartMixPlaylistNotFoundError:
        raise HTTPException(status_code=404, detail="Playlist not found") from None
    except SmartMixPlaylistOwnerError as error:
        raise HTTPException(status_code=403, detail=str(error)) from None
    except SmartMixPlaylistLimitError as error:
        raise HTTPException(status_code=409, detail=str(error)) from None
    return _state_response(playlist_id, state)


def _state_response(
    playlist_id: int, state: SmartMixPlaylistState | None
) -> SmartMixPlaylistResponse:
    if state is None:
        return SmartMixPlaylistResponse(playlist_id=playlist_id, enabled=False)
    return SmartMixPlaylistResponse(
        playlist_id=state.playlist_id,
        enabled=state.enabled,
        enabled_at=state.enabled_at,
        disabled_at=state.disabled_at,
        last_used_at=state.last_used_at,
        revision=state.revision,
        updated_at=state.updated_at,
    )


__all__ = ["router"]

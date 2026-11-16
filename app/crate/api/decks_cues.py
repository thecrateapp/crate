"""Crate Decks synchronised cues and corrections (S7).

Each user keeps their own cue set and correction (BPM, beat grid, key) per
track. Clients read them in batches and replace one track's set at a time with
compare-and-set on its revision; a stale revision answers 409 with the stored
content. Session users only, as for the rest of /api/decks.

Every response body carries `server_time`, the database clock (see
`crate.db.queries.decks_cues`), so clients compare edit times with
`updated_at` in the server's clock.

User corrections do not change the Smart Mix profiles or plans yet: Decks
applies them on top of the profile. Feeding them into Smart Mix is planned as
F8.SM (gate G5).
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from crate.api.decks import _require_session_user
from crate.api.openapi_responses import (
    AUTH_ERROR_RESPONSES,
    error_response,
    merge_responses,
)
from crate.api.schemas.decks_cues import (
    DecksCorrectionConflictResponse,
    DecksCorrectionPutRequest,
    DecksCorrectionPutResponse,
    DecksCorrectionsQueryRequest,
    DecksCorrectionsQueryResponse,
    DecksCueSetConflictResponse,
    DecksCueSetPutRequest,
    DecksCueSetPutResponse,
    DecksCuesQueryRequest,
    DecksCuesQueryResponse,
)
from crate.db.queries.decks_cues import get_decks_corrections, get_decks_cue_sets
from crate.db.repositories.decks_cues import (
    DecksSyncResult,
    put_decks_correction,
    put_decks_cue_set,
)

router = APIRouter(prefix="/api/decks", tags=["browse"])

_FORBIDDEN = {
    403: error_response(
        "An access token, or a trusted-header user without a Crate account."
    )
}
_QUERY_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    _FORBIDDEN,
    {
        422: error_response(
            "No UIDs, more than 200, a UID that is not one, or extra fields."
        )
    },
)


def _put_responses(conflict_model: type, what: str) -> dict:
    return merge_responses(
        AUTH_ERROR_RESPONSES,
        _FORBIDDEN,
        {
            404: error_response("The track is not in the local library."),
            409: {
                "model": conflict_model,
                "description": (
                    f"base_revision is not the stored revision; `current` is the "
                    f"stored {what}."
                ),
            },
            422: error_response(f"The {what} or the path UID failed validation."),
        },
    )


@router.post(
    "/cues/query",
    response_model=DecksCuesQueryResponse,
    responses=_QUERY_RESPONSES,
    summary="Read the caller's cue sets of up to 200 tracks",
)
def decks_cues_query(
    request: Request, payload: DecksCuesQueryRequest
) -> DecksCuesQueryResponse:
    """One SQL statement per batch. Tracks without a stored set are in `missing`."""
    user = _require_session_user(request)
    uids = _unique(payload.entity_uids)
    read = get_decks_cue_sets(int(user["id"]), uids)
    return DecksCuesQueryResponse(
        cue_sets=read.found,
        missing=[uid for uid in uids if uid not in read.found],
        server_time=read.server_time,
    )


@router.put(
    "/cues/{entity_uid}",
    response_model=DecksCueSetPutResponse,
    responses=_put_responses(DecksCueSetConflictResponse, "cue set"),
    summary="Replace the caller's cue set of a track",
)
def decks_cues_put(request: Request, entity_uid: UUID, payload: DecksCueSetPutRequest):
    """Compare-and-set on `base_revision`. Content equal to the stored set is
    answered 200 with the stored revision, whatever the base revision."""
    user = _require_session_user(request)
    result = put_decks_cue_set(
        int(user["id"]),
        str(entity_uid),
        [cue.model_dump() for cue in payload.cues],
        base_revision=payload.base_revision,
        client_id=payload.client_id,
    )
    return _sync_response(
        result,
        DecksCueSetPutResponse,
        DecksCueSetConflictResponse,
        "Cue set revision conflict",
    )


@router.post(
    "/corrections/query",
    response_model=DecksCorrectionsQueryResponse,
    responses=_QUERY_RESPONSES,
    summary="Read the caller's BPM, grid and key corrections of up to 200 tracks",
)
def decks_corrections_query(
    request: Request, payload: DecksCorrectionsQueryRequest
) -> DecksCorrectionsQueryResponse:
    """One SQL statement per batch. Tracks without a stored correction are in
    `missing`."""
    user = _require_session_user(request)
    uids = _unique(payload.entity_uids)
    read = get_decks_corrections(int(user["id"]), uids)
    return DecksCorrectionsQueryResponse(
        corrections=read.found,
        missing=[uid for uid in uids if uid not in read.found],
        server_time=read.server_time,
    )


@router.put(
    "/corrections/{entity_uid}",
    response_model=DecksCorrectionPutResponse,
    responses=_put_responses(DecksCorrectionConflictResponse, "correction"),
    summary="Replace the caller's BPM, grid and key correction of a track",
)
def decks_corrections_put(
    request: Request, entity_uid: UUID, payload: DecksCorrectionPutRequest
):
    """Compare-and-set on `base_revision`; all values null clears the correction."""
    user = _require_session_user(request)
    result = put_decks_correction(
        int(user["id"]),
        str(entity_uid),
        base_revision=payload.base_revision,
        bpm=payload.bpm,
        beat_grid_ms=payload.beat_grid_ms,
        key=payload.key,
        client_id=payload.client_id,
    )
    return _sync_response(
        result,
        DecksCorrectionPutResponse,
        DecksCorrectionConflictResponse,
        "Correction revision conflict",
    )


def _unique(uids: list[UUID]) -> list[str]:
    return list(dict.fromkeys(str(uid) for uid in uids))


def _sync_response(
    result: DecksSyncResult, stored_model: type, conflict_model: type, detail: str
):
    if result.status == "not_found":
        raise HTTPException(status_code=404, detail="Track not found")
    if result.status == "conflict":
        body = conflict_model.model_validate(
            {
                "detail": detail,
                "current": result.current,
                "server_time": result.server_time,
            }
        )
        return JSONResponse(status_code=409, content=jsonable_encoder(body))
    return stored_model.model_validate(
        {**result.current, "server_time": result.server_time}
    )

"""Crate Decks synchronised cues and corrections (S7).

Each user keeps their own cue set and correction (BPM, beat grid, key) per
track. Clients read them in batches and replace one track's set at a time with
compare-and-set on its revision; a stale revision answers 409 with the stored
content. Session users only, as for the rest of /api/decks.

User corrections do not change the Smart Mix profiles or plans (decision
pending, gate G5): they are applied by Decks on top of the profile.
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
    DecksCorrectionResponse,
    DecksCorrectionsQueryRequest,
    DecksCorrectionsQueryResponse,
    DecksCueSetConflictResponse,
    DecksCueSetPutRequest,
    DecksCueSetResponse,
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
    sets = get_decks_cue_sets(int(user["id"]), uids)
    return DecksCuesQueryResponse(
        cue_sets=sets, missing=[uid for uid in uids if uid not in sets]
    )


@router.put(
    "/cues/{entity_uid}",
    response_model=DecksCueSetResponse,
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
    return _sync_response(result, DecksCueSetResponse, "Cue set revision conflict")


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
    corrections = get_decks_corrections(int(user["id"]), uids)
    return DecksCorrectionsQueryResponse(
        corrections=corrections,
        missing=[uid for uid in uids if uid not in corrections],
    )


@router.put(
    "/corrections/{entity_uid}",
    response_model=DecksCorrectionResponse,
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
        result, DecksCorrectionResponse, "Correction revision conflict"
    )


def _unique(uids: list[UUID]) -> list[str]:
    return list(dict.fromkeys(str(uid) for uid in uids))


def _sync_response(result: DecksSyncResult, model: type, conflict: str):
    if result.status == "not_found":
        raise HTTPException(status_code=404, detail="Track not found")
    current = model.model_validate(result.current)
    if result.status == "conflict":
        return JSONResponse(
            status_code=409,
            content=jsonable_encoder({"detail": conflict, "current": current}),
        )
    return current

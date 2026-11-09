"""Stem analyses and stem files for Crate Decks (Smart Mix Stems, STEM-D6, D8, §7).

Decks reads the stem analysis Smart Mix uses for a track before it separates the track
itself, and may upload its own. An upload is untrusted input: it needs the
``smart_mix.stems.contribute`` permission and uploads turned on, fits in 64 KiB, follows
``stem-analysis/1`` with a ``crate-decks/`` producer, and describes the track's current
file: its source revision and, within 2 %, its duration. The store keeps a stronger
analysis of the same file (``kept_stronger``).

Decks may also download the stem file the server keeps for a track of a Smart Mix
playlist: one MP4 with drums, bass and vocals, served with Range support while it was
separated from the track's current file.
"""

from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse
from pydantic import ValidationError

from crate.api.auth import _require_auth
from crate.api.openapi_responses import (
    AUTH_ERROR_RESPONSES,
    error_response,
    merge_responses,
)
from crate.api.permissions import require_permission
from crate.api.schemas.smart_mix import StemAnalysisUploadResponse
from crate.db.repositories.smart_mix_stem_files import (
    get_stem_file_download,
    mark_stem_file_used,
)
from crate.db.repositories.smart_mix_stems import (
    get_stem_track,
    stem_uploads_enabled,
    upsert_stem_analysis,
)
from crate.smart_mix.stem_files import STEM_FILE_MEDIA_TYPE
from crate.smart_mix.stem_storage import configured_stems_directory
from crate.smart_mix.stems import (
    STEM_CONTRIBUTE_PERMISSION,
    StemAnalysis,
    choose_analysis,
    duration_matches,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/decks", tags=["smart-mix"])

# Design section 6: a stem-analysis/1 document is 2-4 KB for a typical track.
MAX_UPLOAD_BYTES = 64 * 1024

_READ_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        404: error_response(
            "No local track with this UID, or no stem analysis of its current file."
        )
    },
)
_UPLOAD_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        403: error_response(
            "No smart_mix.stems.contribute permission, or uploads are turned off."
        ),
        404: error_response("No local track with this UID."),
        409: error_response(
            "sourceRevision is not the revision of the track's current file."
        ),
        413: error_response("The body is larger than 64 KiB."),
        422: error_response(
            "Not a stem-analysis/1 document from Crate Decks, or its duration is not "
            "the track's."
        ),
    },
)


@router.get(
    "/tracks/{entity_uid}/stem-analysis",
    response_model=StemAnalysis,
    response_model_exclude_none=True,
    responses=_READ_RESPONSES,
    summary="Read the stem analysis Smart Mix uses for a track",
)
def read_stem_analysis(request: Request, entity_uid: UUID) -> StemAnalysis:
    _require_auth(request)
    track = get_stem_track(str(entity_uid))
    if track is None:
        raise HTTPException(status_code=404, detail="Track not found")
    analysis = None
    if track.source_revision is not None:
        analysis = choose_analysis(
            track.analyses, source_revision=track.source_revision
        )
    if analysis is None:
        raise HTTPException(
            status_code=404, detail="No stem analysis of the track's current file"
        )
    return analysis


_FILE_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        200: {
            "description": "The MP4 with three AAC streams: drums, bass and vocals.",
            "content": {
                STEM_FILE_MEDIA_TYPE: {"schema": {"type": "string", "format": "binary"}}
            },
        },
        206: {
            "description": "The requested byte range of the stem file.",
            "content": {
                STEM_FILE_MEDIA_TYPE: {"schema": {"type": "string", "format": "binary"}}
            },
        },
        404: error_response(
            "No local track with this UID, or no stem file of its current file."
        ),
    },
)


@router.get(
    "/tracks/{entity_uid}/stems",
    response_class=FileResponse,
    responses=_FILE_RESPONSES,
    summary="Download the server's stem file of a track",
)
def download_stems(request: Request, entity_uid: UUID) -> FileResponse:
    user = _require_auth(request)
    root = configured_stems_directory()
    stem_file = get_stem_file_download(str(entity_uid)) if root else None
    if root is None or stem_file is None:
        raise HTTPException(status_code=404, detail="No stem file of this track")
    path = root / stem_file.path
    try:
        inside = path.resolve().is_relative_to(root.resolve()) and path.is_file()
    except OSError:
        inside = False
    if not inside:
        raise HTTPException(status_code=404, detail="No stem file of this track")
    user_id = user.get("id")
    try:
        mark_stem_file_used(
            stem_file.track_id, user_id=None if user_id is None else int(user_id)
        )
    except Exception:
        # The quota's LRU only loses one mark; the download goes on.
        log.warning(
            "Could not mark the stem file of %s used", entity_uid, exc_info=True
        )
    return FileResponse(
        path=str(path),
        media_type=STEM_FILE_MEDIA_TYPE,
        headers={"Accept-Ranges": "bytes", "Cache-Control": "private, max-age=0"},
    )


@router.put(
    "/tracks/{entity_uid}/stem-analysis",
    response_model=StemAnalysisUploadResponse,
    responses=_UPLOAD_RESPONSES,
    # The handler reads the body itself to cap its size, so it declares it here.
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                "application/json": {
                    "schema": {"$ref": "#/components/schemas/StemAnalysis"}
                }
            },
        }
    },
    summary="Upload a Crate Decks stem analysis of a track",
)
async def upload_stem_analysis(
    request: Request, entity_uid: UUID
) -> StemAnalysisUploadResponse:
    user = require_permission(request, STEM_CONTRIBUTE_PERMISSION)
    body = await _read_capped_body(request)
    return await run_in_threadpool(_store_upload, entity_uid, body, user)


async def _read_capped_body(request: Request) -> bytes:
    too_large = HTTPException(
        status_code=413, detail="A stem analysis upload is at most 64 KiB"
    )
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > MAX_UPLOAD_BYTES:
        raise too_large
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > MAX_UPLOAD_BYTES:
            raise too_large
    return bytes(body)


def _store_upload(
    entity_uid: UUID, body: bytes, user: dict[str, Any]
) -> StemAnalysisUploadResponse:
    if not stem_uploads_enabled():
        raise HTTPException(status_code=403, detail="Stem uploads are turned off")
    try:
        analysis = StemAnalysis.model_validate_json(body)
    except ValidationError as error:
        # The same 422 shape as a body FastAPI validates, without echoing the input.
        raise RequestValidationError(
            [
                {**detail, "loc": ("body", *detail["loc"])}
                for detail in error.errors(
                    include_url=False, include_context=False, include_input=False
                )
            ]
        ) from None
    if analysis.producer_kind != "decks":
        raise HTTPException(
            status_code=422, detail="A Decks upload needs a crate-decks/ producer"
        )
    track = get_stem_track(str(entity_uid))
    if track is None:
        raise HTTPException(status_code=404, detail="Track not found")
    if track.source_revision is None or analysis.source_revision != (
        track.source_revision
    ):
        raise HTTPException(
            status_code=409,
            detail="sourceRevision is not the revision of the track's current file",
        )
    if track.duration_ms is None or not duration_matches(
        analysis.duration_ms, track.duration_ms
    ):
        raise HTTPException(
            status_code=422,
            detail="durationMs differs from the track's duration by more than 2 %",
        )
    user_id = user.get("id")
    result = upsert_stem_analysis(
        track.track_id,
        analysis,
        producer_kind="decks",
        contributed_by=None if user_id is None else int(user_id),
    )
    return StemAnalysisUploadResponse(result=result)


__all__ = ["MAX_UPLOAD_BYTES", "router"]

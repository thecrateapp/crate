from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

from crate.api._deps import extensions, library_path
from crate.api.openapi_responses import (
    AUTH_ERROR_RESPONSES,
    error_response,
    merge_responses,
)
from crate.api.permissions import require_permission
from crate.api.schemas.common import TaskEnqueueResponse
from crate.api.schemas.utility import (
    OrganizeApplyRequest,
    OrganizePresetsResponse,
    OrganizePreviewResponse,
)
from crate.db.repositories.library import get_library_album_by_id
from crate.db.repositories.tasks import (
    create_task_dedup,
    find_active_task_by_type_params,
)
from crate.organizer import (
    PRESETS,
    album_directory,
    preview_organize,
    suggest_folder_name,
)
from crate.storage_layout import (
    UnsafeMutationPathError,
    ensure_within_roots,
    library_mutation_roots,
)

router = APIRouter(tags=["organizer"])

_ORGANIZER_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        404: error_response("The requested album could not be found."),
        409: error_response("The organize task could not be queued."),
        422: error_response("The request payload failed validation."),
    },
)


def _require_metadata_editor(request: Request) -> dict:
    return require_permission(request, "library.metadata.write")


@router.get(
    "/api/organize/presets",
    response_model=OrganizePresetsResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="List file-organization presets",
)
def api_organize_presets(request: Request):
    _require_metadata_editor(request)
    return PRESETS


def _album_dir_or_404(album: dict) -> Path:
    lib = library_path()
    album_dir = album_directory(lib, album)
    try:
        ensure_within_roots(album_dir, library_mutation_roots(lib))
    except UnsafeMutationPathError:
        raise HTTPException(status_code=404, detail="Not found")
    if not album_dir.is_dir():
        raise HTTPException(status_code=404, detail="Not found")
    return album_dir


@router.get(
    "/api/organize/albums/{album_id}/preview",
    response_model=OrganizePreviewResponse,
    responses=_ORGANIZER_RESPONSES,
    summary="Preview file-organization changes for an album",
)
def api_organize_preview_by_id(
    request: Request, album_id: int, pattern: str | None = None
):
    _require_metadata_editor(request)
    album = get_library_album_by_id(album_id)
    if not album:
        raise HTTPException(status_code=404, detail="Not found")
    album_dir = _album_dir_or_404(album)

    exts = extensions()
    preview = preview_organize(album_dir, exts, pattern)
    folder_suggestion = suggest_folder_name(
        album_dir, exts, include_year="year" in (pattern or "")
    )

    return {
        "tracks": preview,
        "folder_current": album_dir.name,
        "folder_suggested": folder_suggestion,
        "changes": sum(1 for p in preview if p["changed"]),
    }


@router.post(
    "/api/organize/albums/{album_id}/apply",
    response_model=TaskEnqueueResponse,
    responses=_ORGANIZER_RESPONSES,
    summary="Queue file-organization changes for an album",
)
def api_organize_apply_by_id(
    request: Request, album_id: int, data: OrganizeApplyRequest | None = None
):
    actor = _require_metadata_editor(request)
    album = get_library_album_by_id(album_id)
    if not album:
        raise HTTPException(status_code=404, detail="Not found")
    _album_dir_or_404(album)

    params = {
        "album_id": album_id,
        "pattern": data.pattern if data else None,
        "rename_folder": data.rename_folder if data else None,
        "actor_user_id": actor.get("id"),
    }
    dedup_key = f"library_album_organize:{album_id}"
    task_id = create_task_dedup("library_album_organize", params, dedup_key=dedup_key)
    if task_id:
        return {"task_id": task_id, "status": "queued", "deduplicated": False}
    existing = find_active_task_by_type_params(
        "library_album_organize", params, dedup_key=dedup_key
    )
    if not existing:
        raise HTTPException(
            status_code=409, detail="Could not queue the organize task, try again"
        )
    return {"task_id": existing, "status": "queued", "deduplicated": True}

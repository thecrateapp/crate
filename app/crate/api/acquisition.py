"""Unified music acquisition API — Tidal + Soulseek + uploads."""

import asyncio
import json
import logging
import os
import re
import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from starlette.responses import StreamingResponse

from crate import soulseek, tidal
from crate.acquisition_tasks import (
    build_soulseek_download_params,
    build_tidal_download_params,
    soulseek_download_dedup_key,
    tidal_download_dedup_key,
)
from crate.api._deps import json_dumps
from crate.api.auth import _require_auth
from crate.api.openapi_responses import (
    AUTH_ERROR_RESPONSES,
    error_response,
    merge_responses,
)
from crate.api.permissions import require_any_permission, require_permission
from crate.api.schemas.acquisition import (
    AcquisitionDownloadRequest,
    AcquisitionDownloadResponse,
    AcquisitionQueueResponse,
    AcquisitionStatusResponse,
    AcquisitionSurfaceResponse,
    AcquisitionUploadChunkedInitRequest,
    AcquisitionUploadChunkedInitResponse,
    AcquisitionUploadResponse,
    ArtistSuggestionResponse,
    ArtistSuggestionsResponse,
    ArtistSuggestionStatusRequest,
    NewReleasesResponse,
    NewReleasesSurfaceResponse,
    QueueClearResponse,
    SoulseekSearchPollResponse,
    SoulseekSearchRequest,
    SoulseekSearchStartResponse,
)
from crate.api.schemas.common import OkResponse, TaskEnqueueResponse
from crate.db.cache_settings import get_setting
from crate.db.releases import (
    get_new_releases,
    mark_release_dismissed,
    mark_release_downloading,
)
from crate.db.repositories.artist_suggestions import (
    list_artist_suggestions,
    update_artist_suggestion_status,
)
from crate.db.repositories.library import get_release_by_id
from crate.db.repositories.tasks import (
    create_task,
    create_task_dedup,
    find_active_task_by_type_params,
)
from crate.db.tidal import get_tidal_downloads

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/acquisition", tags=["acquisition"])

_ACQUISITION_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        400: error_response("The request could not be processed."),
        404: error_response("The requested acquisition resource could not be found."),
        422: error_response("The request payload failed validation."),
        502: error_response("The upstream acquisition service failed."),
    },
)

ALLOWED_UPLOAD_EXTENSIONS = {
    ".flac",
    ".mp3",
    ".m4a",
    ".ogg",
    ".opus",
    ".wav",
    ".aac",
    ".alac",
    ".zip",
}
UPLOAD_CHUNK_BYTES = int(os.environ.get("CRATE_UPLOAD_CHUNK_BYTES", 24 * 1024 * 1024))
MAX_UPLOAD_CHUNK_BYTES = int(
    os.environ.get("CRATE_MAX_UPLOAD_CHUNK_BYTES", 32 * 1024 * 1024)
)


def _require_acquisition_manager(request: Request) -> dict:
    return require_any_permission(
        request,
        ("library.import.manage", "library.tidal.manage"),
    )


def _get_soulseek_queue_items() -> list[dict]:
    queue: list[dict] = []
    try:
        for item in soulseek.get_downloads():
            queue.append(
                {
                    "source": "soulseek",
                    "artist": "",
                    "album": item.get("directory", "").replace("\\", "/").split("/")[-1]
                    if item.get("directory")
                    else "",
                    "filename": item.get("filename", ""),
                    "fullPath": item.get("fullPath", ""),
                    "status": item.get("state", ""),
                    "progress": item.get("percentComplete", 0),
                    "username": item.get("username", ""),
                    "speed": item.get("averageSpeed", 0),
                }
            )
    except Exception:
        return []
    return queue


def _build_acquisition_surface() -> dict:
    return {
        "tidal_authenticated": tidal.is_authenticated(),
        "tidal_queue": get_tidal_downloads(),
        "soulseek_queue": _get_soulseek_queue_items(),
    }


def _acquisition_surface_signature(surface: dict) -> str:
    return json_dumps(
        {
            "tidal_authenticated": surface.get("tidal_authenticated"),
            "tidal_queue": [
                {
                    "id": item.get("id"),
                    "status": item.get("status"),
                    "task_id": item.get("task_id"),
                    "updated_at": item.get("updated_at"),
                }
                for item in surface.get("tidal_queue") or []
            ],
            "soulseek_queue": [
                {
                    "fullPath": item.get("fullPath"),
                    "status": item.get("status"),
                    "progress": item.get("progress"),
                    "speed": item.get("speed"),
                }
                for item in surface.get("soulseek_queue") or []
            ],
        },
        sort_keys=True,
    )


async def _stream_acquisition_surface():
    last_signature: str | None = None
    heartbeat_counter = 0
    while True:
        surface = _build_acquisition_surface()
        signature = _acquisition_surface_signature(surface)
        if signature != last_signature:
            last_signature = signature
            yield f"data: {json_dumps(surface)}\n\n"
        await asyncio.sleep(3)
        heartbeat_counter += 3
        if heartbeat_counter >= 30:
            heartbeat_counter = 0
            yield ": heartbeat\n\n"


def _build_new_releases_surface(*, status: str = "", upcoming: bool = False) -> dict:
    return {
        "releases": get_new_releases(status=status, upcoming=upcoming),
    }


def _new_releases_surface_signature(surface: dict) -> str:
    return json_dumps(surface, sort_keys=True)


async def _stream_new_releases_surface():
    last_signature: str | None = None
    heartbeat_counter = 0
    while True:
        surface = _build_new_releases_surface()
        signature = _new_releases_surface_signature(surface)
        if signature != last_signature:
            last_signature = signature
            yield f"data: {json_dumps(surface)}\n\n"
        await asyncio.sleep(5)
        heartbeat_counter += 5
        if heartbeat_counter >= 30:
            heartbeat_counter = 0
            yield ": heartbeat\n\n"


def _upload_staging_root() -> Path:
    return Path(os.environ.get("DATA_DIR", "/data")) / "uploads"


def _upload_manifest_path(staging_dir: Path) -> Path:
    return staging_dir / "manifest.json"


def _load_upload_manifest(staging_dir: Path) -> dict:
    manifest_path = _upload_manifest_path(staging_dir)
    if not manifest_path.exists():
        raise HTTPException(status_code=404, detail="Upload session not found")
    try:
        return json.loads(manifest_path.read_text())
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid upload session") from exc


def _write_upload_manifest(staging_dir: Path, manifest: dict) -> None:
    _upload_manifest_path(staging_dir).write_text(json.dumps(manifest, sort_keys=True))


def _chunk_count(size: int) -> int:
    if size <= 0:
        return 1
    return max(1, (size + UPLOAD_CHUNK_BYTES - 1) // UPLOAD_CHUNK_BYTES)


def _chunked_staging_dir(upload_id: str) -> Path:
    if not re.fullmatch(r"[0-9a-f]{12}", upload_id or ""):
        raise HTTPException(status_code=404, detail="Upload session not found")
    return _upload_staging_root() / upload_id


def _safe_upload_name(filename: str, index: int) -> str:
    raw_name = Path(filename or f"upload-{index}").name
    cleaned = re.sub(r"[^A-Za-z0-9._ ()-]+", "_", raw_name).strip(" .")
    if not cleaned:
        cleaned = f"upload-{index}"
    return f"{index:03d}_{cleaned}"


def _queue_library_upload(
    *,
    user: dict,
    upload_id: str,
    staging_dir: Path,
    saved_files: list[dict],
) -> tuple[str, int]:
    total_bytes = sum(int(file.get("size") or 0) for file in saved_files)
    task_id = create_task(
        "library_upload",
        {
            "upload_id": upload_id,
            "staging_dir": str(staging_dir),
            "uploader_user_id": user["id"],
            "files": saved_files,
            "source": "upload",
        },
    )
    return task_id, total_bytes


@router.get(
    "/status",
    response_model=AcquisitionStatusResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get acquisition source status",
)
def acquisition_status(request: Request):
    """Get status of all acquisition sources."""
    _require_auth(request)
    tidal_status = {"authenticated": tidal.is_authenticated()}
    slsk_status = soulseek.get_status()
    return {"tidal": tidal_status, "soulseek": slsk_status}


@router.get(
    "/snapshot",
    response_model=AcquisitionSurfaceResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get the canonical acquisition surface snapshot",
)
def acquisition_snapshot(request: Request):
    _require_auth(request)
    return _build_acquisition_surface()


@router.get(
    "/artist-suggestions",
    response_model=ArtistSuggestionsResponse,
    responses=_ACQUISITION_RESPONSES,
    summary="List listener artist suggestions for acquisition triage",
)
def acquisition_artist_suggestions(
    request: Request,
    status: str = "open",
    limit: int = 50,
):
    _require_acquisition_manager(request)
    return {
        "suggestions": list_artist_suggestions(status=status, limit=limit),
    }


@router.patch(
    "/artist-suggestions/{suggestion_id}",
    response_model=ArtistSuggestionResponse,
    responses=_ACQUISITION_RESPONSES,
    summary="Update a listener artist suggestion",
)
def update_acquisition_artist_suggestion(
    request: Request,
    suggestion_id: int,
    body: ArtistSuggestionStatusRequest,
):
    user = _require_acquisition_manager(request)
    try:
        suggestion = update_artist_suggestion_status(
            suggestion_id,
            status=body.status,
            actor_user_id=int(user["id"]),
            linked_artist_id=body.linked_artist_id,
            linked_task_id=body.linked_task_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not suggestion:
        raise HTTPException(status_code=404, detail="Artist suggestion not found")
    return suggestion


@router.get(
    "/stream",
    responses=AUTH_ERROR_RESPONSES,
    summary="Stream acquisition surface updates",
)
async def acquisition_stream(request: Request):
    _require_auth(request)
    return StreamingResponse(
        _stream_acquisition_surface(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post(
    "/search/soulseek",
    response_model=SoulseekSearchStartResponse,
    responses=_ACQUISITION_RESPONSES,
    summary="Start a Soulseek search",
)
def start_soulseek_search(request: Request, body: SoulseekSearchRequest):
    """Start a Soulseek search (non-blocking). Returns search_id to poll."""
    _require_acquisition_manager(request)
    query = body.query.strip()
    artist = body.artist.strip()
    album = body.album.strip()

    if not query and not artist:
        raise HTTPException(status_code=400, detail="query or artist required")

    search_text = query or f"{artist} {album}".strip()
    quality_filter = get_setting("soulseek_quality", "flac")

    # Add FLAC to query if filtering by lossless
    if quality_filter == "flac" and "flac" not in search_text.lower():
        search_text += " FLAC"

    search_id = soulseek.start_search(search_text)
    if not search_id:
        raise HTTPException(status_code=502, detail="Failed to start search")

    return {"search_id": search_id, "query": search_text}


@router.get(
    "/search/soulseek/{search_id}",
    response_model=SoulseekSearchPollResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Poll Soulseek search results",
)
def poll_soulseek_search(request: Request, search_id: str):
    """Poll Soulseek search results (progressive — call every 2-3s)."""
    _require_auth(request)
    status = soulseek.get_search_status(search_id)
    quality_filter = get_setting("soulseek_quality", "flac")
    results = soulseek.get_search_results(search_id, quality_filter)
    return {
        "state": status.get("state", "Unknown"),
        "isComplete": status.get("isComplete", False),
        "responseCount": status.get("responseCount", 0),
        "fileCount": status.get("fileCount", 0),
        "results": results,
    }


async def _stream_soulseek_search(search_id: str):
    quality_filter = get_setting("soulseek_quality", "flac")
    heartbeat_counter = 0

    while True:
        status = soulseek.get_search_status(search_id)
        results = soulseek.get_search_results(search_id, quality_filter)
        payload = {
            "state": status.get("state", "Unknown"),
            "isComplete": status.get("isComplete", False),
            "responseCount": status.get("responseCount", 0),
            "fileCount": status.get("fileCount", 0),
            "results": results,
        }
        yield f"data: {json_dumps(payload)}\n\n"
        if payload["isComplete"]:
            break

        await asyncio.sleep(3)
        heartbeat_counter += 3
        if heartbeat_counter >= 30:
            heartbeat_counter = 0
            yield ": heartbeat\n\n"


@router.get(
    "/search/soulseek/{search_id}/stream",
    responses=AUTH_ERROR_RESPONSES,
    summary="Stream Soulseek search results",
)
async def stream_soulseek_search(request: Request, search_id: str):
    """Stream Soulseek search progress until the search completes."""
    _require_auth(request)
    return StreamingResponse(
        _stream_soulseek_search(search_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post(
    "/download",
    response_model=AcquisitionDownloadResponse,
    responses=_ACQUISITION_RESPONSES,
    summary="Queue a Tidal or Soulseek download",
)
def acquisition_download(request: Request, body: AcquisitionDownloadRequest):
    """Download from the specified source."""
    _require_acquisition_manager(request)
    source = body.source
    artist = body.artist
    album = body.album

    if source == "tidal":
        tidal_id = body.tidal_id
        if not tidal_id:
            raise HTTPException(status_code=400, detail="tidal_id required")
        task_params = build_tidal_download_params(
            url=f"https://tidal.com/{body.tidal_type or 'album'}/{tidal_id}",
            quality="max",
            content_type=body.tidal_type or "album",
            artist=artist,
            album=album,
        )
        task_params["tidal_id"] = tidal_id
        task_id = create_task_dedup(
            "tidal_download",
            task_params,
            dedup_key=tidal_download_dedup_key(task_params),
        )
        if not task_id:
            task_id = find_active_task_by_type_params(
                "tidal_download",
                task_params,
                dedup_key=tidal_download_dedup_key(task_params),
            )
        return {"task_id": task_id, "source": "tidal"}

    elif source == "soulseek":
        username = body.username
        files = body.files
        find_alternate = body.find_alternate

        if not files:
            raise HTTPException(status_code=400, detail="files required")

        file_names = [
            f.get("filename", "") if isinstance(f, dict) else f for f in files
        ]

        # If explicitly asked to find alternate, skip original peer entirely
        upgrade_id = body.upgrade_album_id

        def _slsk_params(**extra) -> dict:
            return build_soulseek_download_params(
                username=username or "unknown",
                artist=artist,
                album=album,
                files=list(extra.get("files") or []),
                file_count=int(extra.get("file_count") or 0),
                find_alternate=bool(extra.get("find_alternate")),
                upgrade_album_id=upgrade_id,
            )

        if find_alternate or not username:
            task_params = _slsk_params(
                files=file_names, file_count=len(files), find_alternate=True
            )
            task_id = create_task_dedup(
                "soulseek_download",
                task_params,
                dedup_key=soulseek_download_dedup_key(task_params),
            )
            if not task_id:
                task_id = find_active_task_by_type_params(
                    "soulseek_download",
                    task_params,
                    dedup_key=soulseek_download_dedup_key(task_params),
                )
            return {"task_id": task_id, "source": "soulseek", "finding_alternate": True}

        # Try original peer
        result = soulseek.download_files(username, files)
        enqueued = result.get("enqueued", [])

        if enqueued:
            task_params = _slsk_params(
                files=[f.get("filename", "") for f in enqueued],
                file_count=len(enqueued),
            )
            task_id = create_task_dedup(
                "soulseek_download",
                task_params,
                dedup_key=soulseek_download_dedup_key(task_params),
            )
            if not task_id:
                task_id = find_active_task_by_type_params(
                    "soulseek_download",
                    task_params,
                    dedup_key=soulseek_download_dedup_key(task_params),
                )
            return {"task_id": task_id, "source": "soulseek", "enqueued": len(enqueued)}

        # Peer rejected — go straight to alternate search
        task_params = _slsk_params(
            files=file_names, file_count=len(files), find_alternate=True
        )
        task_id = create_task_dedup(
            "soulseek_download",
            task_params,
            dedup_key=soulseek_download_dedup_key(task_params),
        )
        if not task_id:
            task_id = find_active_task_by_type_params(
                "soulseek_download",
                task_params,
                dedup_key=soulseek_download_dedup_key(task_params),
            )
        return {"task_id": task_id, "source": "soulseek", "finding_alternate": True}

    raise HTTPException(status_code=400, detail="source must be 'tidal' or 'soulseek'")


@router.post(
    "/upload",
    response_model=AcquisitionUploadResponse,
    responses=_ACQUISITION_RESPONSES,
    summary="Upload and stage music files for import",
)
async def acquisition_upload(request: Request, files: list[UploadFile] = File(...)):
    """Stage uploaded music into shared /data and queue worker import."""
    user = _require_auth(request)

    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded")

    upload_id = uuid.uuid4().hex[:12]
    staging_root = _upload_staging_root()
    staging_dir = staging_root / upload_id
    raw_dir = staging_dir / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)

    saved_files: list[dict] = []
    total_bytes = 0

    invalid_name = next(
        (
            upload.filename or "unknown"
            for upload in files
            if Path(upload.filename or "").suffix.lower()
            not in ALLOWED_UPLOAD_EXTENSIONS
        ),
        None,
    )
    if invalid_name:
        shutil.rmtree(staging_dir, ignore_errors=True)
        raise HTTPException(
            status_code=400, detail=f"Unsupported file type: {invalid_name}"
        )

    try:
        for index, upload in enumerate(files, start=1):
            safe_name = _safe_upload_name(upload.filename or "", index)
            dest = raw_dir / safe_name
            with dest.open("wb") as fh:
                while True:
                    chunk = await upload.read(1024 * 1024)
                    if not chunk:
                        break
                    fh.write(chunk)
                    total_bytes += len(chunk)

            saved_files.append(
                {
                    "original_name": upload.filename or safe_name,
                    "stored_name": safe_name,
                    "size": dest.stat().st_size,
                }
            )
    except Exception:
        shutil.rmtree(staging_dir, ignore_errors=True)
        raise
    finally:
        for upload in files:
            try:
                await upload.close()
            except Exception:
                pass

    task_id, total_bytes = _queue_library_upload(
        user=user,
        upload_id=upload_id,
        staging_dir=staging_dir,
        saved_files=saved_files,
    )
    return {
        "task_id": task_id,
        "upload_id": upload_id,
        "file_count": len(saved_files),
        "total_bytes": total_bytes,
    }


@router.post(
    "/upload/chunked",
    response_model=AcquisitionUploadChunkedInitResponse,
    responses=_ACQUISITION_RESPONSES,
    summary="Create a chunked music upload session",
)
def acquisition_upload_chunked_init(
    request: Request, payload: AcquisitionUploadChunkedInitRequest
):
    """Create a resumable-ish upload staging area for large browser uploads."""
    user = _require_auth(request)

    invalid_name = next(
        (
            file.name or "unknown"
            for file in payload.files
            if Path(file.name or "").suffix.lower() not in ALLOWED_UPLOAD_EXTENSIONS
        ),
        None,
    )
    if invalid_name:
        raise HTTPException(
            status_code=400, detail=f"Unsupported file type: {invalid_name}"
        )

    upload_id = uuid.uuid4().hex[:12]
    staging_dir = _upload_staging_root() / upload_id
    (staging_dir / "chunks").mkdir(parents=True, exist_ok=True)
    (staging_dir / "raw").mkdir(parents=True, exist_ok=True)

    manifest_files = []
    for index, file in enumerate(payload.files, start=1):
        manifest_files.append(
            {
                "index": index - 1,
                "original_name": file.name,
                "stored_name": _safe_upload_name(file.name, index),
                "size": file.size,
                "chunk_count": _chunk_count(file.size),
                "received_chunks": [],
            }
        )

    _write_upload_manifest(
        staging_dir,
        {
            "upload_id": upload_id,
            "uploader_user_id": user["id"],
            "files": manifest_files,
        },
    )
    return {
        "upload_id": upload_id,
        "file_count": len(manifest_files),
        "chunk_size": UPLOAD_CHUNK_BYTES,
    }


@router.post(
    "/upload/chunked/{upload_id}/chunk",
    response_model=OkResponse,
    responses=_ACQUISITION_RESPONSES,
    summary="Upload one chunk for a chunked music upload session",
)
async def acquisition_upload_chunked_chunk(
    request: Request,
    upload_id: str,
    file_index: int = Form(...),
    chunk_index: int = Form(...),
    chunk: UploadFile = File(...),
):
    user = _require_auth(request)
    staging_dir = _chunked_staging_dir(upload_id)
    manifest = _load_upload_manifest(staging_dir)
    if manifest.get("uploader_user_id") != user["id"]:
        raise HTTPException(status_code=404, detail="Upload session not found")

    files = manifest.get("files") or []
    if file_index < 0 or file_index >= len(files):
        raise HTTPException(status_code=400, detail="Invalid upload file index")

    file_manifest = files[file_index]
    chunk_count = int(file_manifest.get("chunk_count") or 0)
    if chunk_index < 0 or chunk_index >= chunk_count:
        raise HTTPException(status_code=400, detail="Invalid upload chunk index")

    chunk_dir = staging_dir / "chunks" / str(file_index)
    chunk_dir.mkdir(parents=True, exist_ok=True)
    dest = chunk_dir / f"{chunk_index:06d}.part"
    written = 0
    try:
        with dest.open("wb") as fh:
            while True:
                data = await chunk.read(1024 * 1024)
                if not data:
                    break
                written += len(data)
                if written > MAX_UPLOAD_CHUNK_BYTES:
                    raise HTTPException(
                        status_code=413, detail="Upload chunk is too large"
                    )
                fh.write(data)
    except Exception:
        dest.unlink(missing_ok=True)
        raise
    finally:
        try:
            await chunk.close()
        except Exception:
            pass

    received = set(int(value) for value in file_manifest.get("received_chunks") or [])
    received.add(chunk_index)
    file_manifest["received_chunks"] = sorted(received)
    _write_upload_manifest(staging_dir, manifest)
    return {"ok": True}


@router.post(
    "/upload/chunked/{upload_id}/complete",
    response_model=AcquisitionUploadResponse,
    responses=_ACQUISITION_RESPONSES,
    summary="Complete a chunked music upload and queue library import",
)
def acquisition_upload_chunked_complete(request: Request, upload_id: str):
    user = _require_auth(request)
    staging_dir = _chunked_staging_dir(upload_id)
    manifest = _load_upload_manifest(staging_dir)
    if manifest.get("uploader_user_id") != user["id"]:
        raise HTTPException(status_code=404, detail="Upload session not found")

    raw_dir = staging_dir / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    saved_files: list[dict] = []
    for file_manifest in manifest.get("files") or []:
        file_index = int(file_manifest["index"])
        chunk_count = int(file_manifest["chunk_count"])
        received = set(
            int(value) for value in file_manifest.get("received_chunks") or []
        )
        missing = [index for index in range(chunk_count) if index not in received]
        if missing:
            raise HTTPException(
                status_code=400,
                detail=f"Missing upload chunks for {file_manifest['original_name']}",
            )

        dest = raw_dir / file_manifest["stored_name"]
        with dest.open("wb") as fh:
            for chunk_index in range(chunk_count):
                chunk_path = (
                    staging_dir / "chunks" / str(file_index) / f"{chunk_index:06d}.part"
                )
                if not chunk_path.exists():
                    raise HTTPException(
                        status_code=400,
                        detail=f"Missing upload chunks for {file_manifest['original_name']}",
                    )
                with chunk_path.open("rb") as chunk_fh:
                    shutil.copyfileobj(chunk_fh, fh)

        size = dest.stat().st_size
        if size != int(file_manifest.get("size") or 0):
            dest.unlink(missing_ok=True)
            raise HTTPException(
                status_code=400,
                detail=f"Uploaded file size mismatch for {file_manifest['original_name']}",
            )
        saved_files.append(
            {
                "original_name": file_manifest["original_name"],
                "stored_name": file_manifest["stored_name"],
                "size": size,
            }
        )

    task_id, total_bytes = _queue_library_upload(
        user=user,
        upload_id=upload_id,
        staging_dir=staging_dir,
        saved_files=saved_files,
    )
    shutil.rmtree(staging_dir / "chunks", ignore_errors=True)
    return {
        "task_id": task_id,
        "upload_id": upload_id,
        "file_count": len(saved_files),
        "total_bytes": total_bytes,
    }


# ── New Releases ──────────────────────────────────────────────────


@router.get(
    "/new-releases",
    response_model=NewReleasesResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="List detected new releases",
)
def api_new_releases(request: Request, status: str = "", upcoming: bool = False):
    """Get detected new releases."""
    _require_auth(request)
    return _build_new_releases_surface(status=status, upcoming=upcoming)


@router.get(
    "/new-releases/snapshot",
    response_model=NewReleasesSurfaceResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get the canonical new-releases surface snapshot",
)
def api_new_releases_snapshot(request: Request):
    _require_auth(request)
    return _build_new_releases_surface()


@router.get(
    "/new-releases/stream",
    responses=AUTH_ERROR_RESPONSES,
    summary="Stream new-release surface updates",
)
async def api_new_releases_stream(request: Request):
    _require_auth(request)
    return StreamingResponse(
        _stream_new_releases_surface(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post(
    "/new-releases/{release_id}/download",
    response_model=TaskEnqueueResponse,
    responses=_ACQUISITION_RESPONSES,
    summary="Queue download of a detected release",
)
def api_download_release(request: Request, release_id: int):
    """Download a detected new release via Tidal."""
    require_any_permission(request, ("curation.releases.write", "library.tidal.manage"))
    release = get_release_by_id(release_id)
    if not release or not release.get("tidal_url"):
        raise HTTPException(status_code=404, detail="Release not found or no Tidal URL")
    mark_release_downloading(release_id)
    task_params = build_tidal_download_params(
        url=release["tidal_url"],
        quality=get_setting("tidal_quality", "max"),
        artist=release["artist_name"],
        album=release["album_title"],
        new_release_id=release_id,
    )
    task_id = create_task_dedup(
        "tidal_download", task_params, dedup_key=tidal_download_dedup_key(task_params)
    )
    if not task_id:
        task_id = find_active_task_by_type_params(
            "tidal_download",
            task_params,
            dedup_key=tidal_download_dedup_key(task_params),
        )
    return {"task_id": task_id}


@router.post(
    "/new-releases/{release_id}/dismiss",
    response_model=OkResponse,
    responses=_ACQUISITION_RESPONSES,
    summary="Dismiss a detected release",
)
def api_dismiss_release(request: Request, release_id: int):
    """Dismiss a new release (won't be shown again)."""
    require_permission(request, "curation.releases.write")
    mark_release_dismissed(release_id)
    return {"ok": True}


@router.post(
    "/new-releases/check",
    response_model=TaskEnqueueResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Queue a new-release check",
)
def api_check_new_releases(request: Request, force: bool = False):
    """Trigger a new release check for all library artists."""
    require_permission(request, "curation.releases.write")
    params = {"force": True} if force else {}
    task_id = create_task("check_new_releases", params)
    return {"task_id": task_id}


@router.get(
    "/queue",
    response_model=AcquisitionQueueResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="List the unified acquisition queue",
)
def acquisition_queue(request: Request):
    """Get unified download queue from all sources."""
    _require_auth(request)
    return _build_acquisition_surface()["soulseek_queue"]


@router.post(
    "/queue/clear-completed",
    response_model=QueueClearResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Clear completed Soulseek downloads",
)
def clear_completed(request: Request):
    """Clear completed Soulseek downloads from slskd queue."""
    _require_acquisition_manager(request)
    ok = soulseek.clear_completed_downloads()
    return {"cleared": ok}


@router.post(
    "/queue/clear-errored",
    response_model=QueueClearResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Clear errored Soulseek downloads",
)
def clear_errored(request: Request):
    """Clear errored/cancelled Soulseek downloads from slskd queue."""
    _require_acquisition_manager(request)
    ok = soulseek.clear_errored_downloads()
    return {"cleared": ok}


@router.post(
    "/queue/cleanup-incomplete",
    response_model=TaskEnqueueResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Queue cleanup of incomplete downloads",
)
def cleanup_incomplete(request: Request):
    """Create task to clean up incomplete Soulseek album downloads."""
    _require_acquisition_manager(request)
    task_id = create_task("cleanup_incomplete_downloads", {})
    return {"task_id": task_id}

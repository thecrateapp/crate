from __future__ import annotations

import contextlib
import logging
import os
import time
import uuid
from pathlib import Path

from crate.crate_download import (
    CRATE_DOWNLOAD_KIND,
    CRATE_DOWNLOAD_TASK_TYPE,
    build_crate_zip,
    crate_download_filename,
    crate_download_url,
    estimate_crate_zip_bytes,
)
from crate.db.events import emit_task_event
from crate.db.queries.crates import get_crate_download_source
from crate.download_cache import (
    cached_download_artifact_path,
    crate_cache_ttl_seconds,
    crate_download_cache_key,
    download_cache_enabled,
    download_cache_lock,
    ensure_download_cache_capacity,
    get_cached_download,
    register_cached_download,
    remove_download_tmp_files,
)
from crate.task_progress import TaskProgress, emit_progress
from crate.worker_handlers import TaskHandler

log = logging.getLogger(__name__)

_PROGRESS_EVENT_INTERVAL_SECONDS = 1.0


def _emit_progress_event(task_id: str, progress: TaskProgress) -> None:
    try:
        emit_task_event(task_id, "progress", progress.to_dict())
    except Exception:
        log.debug("Failed to emit crate download progress", exc_info=True)


def _build_artifact(
    task_id: str,
    *,
    crate: dict,
    tracks: list[dict],
    cache_key: str,
    filename: str,
    library_root: Path,
):
    progress = TaskProgress(phase="packaging", total=len(tracks))
    last_event_at = 0.0

    def on_progress(done: int, track: dict) -> None:
        nonlocal last_event_at
        progress.done = done
        progress.item = str(track.get("album") or "")
        emit_progress(task_id, progress)
        now = time.monotonic()
        if done == progress.total or now - last_event_at >= (
            _PROGRESS_EVENT_INTERVAL_SECONDS
        ):
            last_event_at = now
            _emit_progress_event(task_id, progress)

    remove_download_tmp_files(CRATE_DOWNLOAD_KIND, cache_key)
    ensure_download_cache_capacity(
        estimate_crate_zip_bytes(tracks, library_root=library_root)
    )
    _emit_progress_event(task_id, progress)
    artifact_path = cached_download_artifact_path(
        CRATE_DOWNLOAD_KIND, cache_key, filename
    )
    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = artifact_path.with_name(f".{artifact_path.name}.{uuid.uuid4().hex}.tmp")
    try:
        written_files = build_crate_zip(
            tracks, tmp_path, library_root=library_root, on_progress=on_progress
        )
        if written_files == 0:
            raise RuntimeError("Crate has no downloadable local tracks")
        os.replace(tmp_path, artifact_path)
    except BaseException:
        with contextlib.suppress(Exception):
            tmp_path.unlink(missing_ok=True)
        raise

    cached = register_cached_download(
        CRATE_DOWNLOAD_KIND,
        cache_key,
        filename,
        artifact_path,
        metadata={
            "crate_id": crate["id"],
            "filename": filename,
            "tracks": len(tracks),
            "files": written_files,
        },
    )
    if cached is None:
        raise RuntimeError("Crate download exceeds the download cache size limit")
    progress.phase = "complete"
    progress.done = progress.total
    emit_progress(task_id, progress, force=True)
    return cached


def _handle_crate_download(task_id: str, params: dict, config: dict) -> dict:
    crate_id = str(params.get("crate_id") or "").strip()
    if not crate_id:
        raise ValueError("crate_id is required")
    if not download_cache_enabled():
        raise RuntimeError("Download cache is disabled")

    crate, tracks = get_crate_download_source(crate_id)
    if crate is None:
        raise RuntimeError("Crate not found")
    if not tracks:
        raise RuntimeError("Crate has no downloadable local tracks")

    cache_key = crate_download_cache_key(crate, tracks)
    filename = crate_download_filename(crate.get("name"))
    ttl_seconds = crate_cache_ttl_seconds()

    cached = get_cached_download(
        CRATE_DOWNLOAD_KIND, cache_key, filename, ttl_seconds=ttl_seconds
    )
    if cached is None:
        with download_cache_lock(CRATE_DOWNLOAD_KIND, cache_key):
            cached = get_cached_download(
                CRATE_DOWNLOAD_KIND, cache_key, filename, ttl_seconds=ttl_seconds
            )
            if cached is None:
                cached = _build_artifact(
                    task_id,
                    crate=crate,
                    tracks=tracks,
                    cache_key=cache_key,
                    filename=filename,
                    library_root=Path(str(config.get("library_path") or "/music")),
                )

    return {
        "crate_id": crate_id,
        "cache_key": cache_key,
        "filename": filename,
        "download_url": crate_download_url(crate_id, cache_key),
        "bytes": cached.bytes,
        "tracks": len(tracks),
    }


CRATE_DOWNLOAD_TASK_HANDLERS: dict[str, TaskHandler] = {
    CRATE_DOWNLOAD_TASK_TYPE: _handle_crate_download,
}

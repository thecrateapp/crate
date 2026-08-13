"""Read-only delivery facade for worker-materialized artwork."""

from __future__ import annotations

import hashlib
import logging
from pathlib import Path
from typing import Literal

from fastapi.responses import FileResponse, Response
from starlette.background import BackgroundTask, BackgroundTasks

from crate.artwork_tasks import queue_artwork_materialization
from crate.artwork_variants import ArtworkAsset, resolve_materialized_variant
from crate.metrics import record_counter_later

log = logging.getLogger(__name__)

_MEDIA_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}


def _file_etag(path: Path, source_revision: str | None = None) -> str:
    stat = path.stat()
    seed = source_revision or f"{stat.st_mtime_ns}:{stat.st_size}"
    return f'W/"{hashlib.sha256(seed.encode("utf-8")).hexdigest()[:24]}"'


def _file_source_revision(path: Path) -> str | None:
    """Return the materializer revision for a local source, if readable."""
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()[:16]
    except OSError:
        return None


def _record_request(asset: ArtworkAsset, result: str) -> None:
    record_counter_later("artwork.requests", {"kind": asset.kind, "result": result})


def _queue_safely(asset: ArtworkAsset, *, reason: str) -> None:
    try:
        task_id = queue_artwork_materialization(asset, reason=reason)
        result = "created" if task_id else "deduplicated"
        record_counter_later("artwork.queue", {"kind": asset.kind, "result": result})
    except Exception:
        record_counter_later("artwork.queue", {"kind": asset.kind, "result": "failed"})
        log.debug(
            "Artwork materialization queue failed for %s:%s",
            asset.kind,
            asset.entity_key,
            exc_info=True,
        )


def _queue_after_response(
    response: Response, asset: ArtworkAsset, *, reason: str
) -> Response:
    task = BackgroundTask(_queue_safely, asset, reason=reason)
    if response.background is None:
        response.background = task
    elif isinstance(response.background, BackgroundTasks):
        response.background.tasks.append(task)
    else:
        response.background = BackgroundTasks([response.background, task])
    return response


def deliver_original_artwork(
    path: Path,
    *,
    cache_control: str = "public, max-age=300, stale-while-revalidate=86400",
) -> FileResponse:
    return FileResponse(
        path,
        media_type=_MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream"),
        headers={
            "Cache-Control": cache_control,
            "ETag": _file_etag(path),
            "X-Crate-Artwork": "original",
        },
    )


def deliver_artwork(
    asset: ArtworkAsset,
    *,
    requested_size: int | None,
    local_original: Path | None,
    missing_response: Response,
    queue_on_miss: bool = True,
    cache_visibility: Literal["public", "private"] = "public",
    validate_source_revision: bool = False,
) -> Response:
    variant = resolve_materialized_variant(asset, requested_size)
    if validate_source_revision and variant is not None and local_original is not None:
        current_revision = _file_source_revision(local_original)
        if current_revision is not None and current_revision != variant.source_revision:
            # A worker can finish the canonical write before its deduplicated
            # materialization task. Never serve the previous composition while
            # that task catches up.
            variant = None
    if variant is not None:
        _record_request(asset, "variant")
        return FileResponse(
            variant.path,
            media_type=variant.media_type,
            headers={
                "Cache-Control": (
                    f"{cache_visibility}, max-age=86400, stale-while-revalidate=604800"
                ),
                "ETag": _file_etag(variant.path, variant.source_revision),
                "X-Crate-Artwork": "variant",
                "X-Crate-Artwork-Revision": variant.source_revision,
            },
        )

    if local_original is not None and local_original.is_file():
        _record_request(asset, "original")
        response = deliver_original_artwork(
            local_original,
            cache_control=(
                f"{cache_visibility}, max-age=300, stale-while-revalidate=86400"
            ),
        )
        return (
            _queue_after_response(response, asset, reason="variant-miss")
            if queue_on_miss
            else response
        )

    _record_request(asset, "missing")
    missing_response.headers["X-Crate-Artwork"] = "missing"
    return (
        _queue_after_response(missing_response, asset, reason="source-miss")
        if queue_on_miss
        else missing_response
    )

from __future__ import annotations

import contextlib
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone

from crate.db.queries.user_data_export import (
    USER_DATA_EXPORT_SECTIONS,
    get_user_data_export,
    iter_user_data_export_rows,
)
from crate.db.repositories.user_data_exports import (
    USER_DATA_EXPORT_TASK_TYPE,
    expire_user_data_exports,
    fail_stale_user_data_exports,
    mark_user_data_export_failed,
    mark_user_data_export_ready,
)
from crate.download_cache import (
    account_export_ttl_seconds,
    cached_download_artifact_path,
    download_cache_enabled,
    register_cached_download,
    remove_cached_download,
    remove_download_tmp_files,
)
from crate.user_data_export import (
    USER_DATA_EXPORT_CLEANUP_TASK_TYPE,
    USER_DATA_EXPORT_KIND,
    is_user_data_export_id,
    user_data_export_filename,
    write_user_data_export_zip,
)
from crate.worker_handlers import TaskHandler, is_cancelled

log = logging.getLogger(__name__)


def _handle_export_user_data(task_id: str, params: dict, config: dict) -> dict:
    export_id = params.get("export_id")
    user_id = int(params["user_id"])
    if not is_user_data_export_id(export_id):
        raise ValueError("A valid export_id is required")

    export = get_user_data_export(str(export_id), user_id=user_id)
    if export is None:
        return {"status": "skipped", "reason": "not_found"}
    if export["status"] != "pending":
        return {"status": "skipped", "reason": export["status"]}
    if not download_cache_enabled():
        mark_user_data_export_failed(export["id"], "Download cache is disabled")
        return {"error": "Download cache is disabled"}

    filename = user_data_export_filename(export["created_at"])
    artifact_path = cached_download_artifact_path(
        USER_DATA_EXPORT_KIND, export["id"], filename
    )
    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    remove_download_tmp_files(USER_DATA_EXPORT_KIND, export["id"])
    tmp_path = artifact_path.with_name(f".{artifact_path.name}.{uuid.uuid4().hex}.tmp")
    generated_at = datetime.now(timezone.utc)
    try:
        counts = write_user_data_export_zip(
            tmp_path,
            user_id=user_id,
            generated_at=generated_at,
            sections=[name for name, _sql in USER_DATA_EXPORT_SECTIONS],
            rows_for=lambda section: iter_user_data_export_rows(user_id, section),
            should_stop=lambda: is_cancelled(task_id),
        )
        if counts is None:
            tmp_path.unlink(missing_ok=True)
            mark_user_data_export_failed(export["id"], "Export was cancelled")
            return {"cancelled": True, "export_id": export["id"]}
        os.replace(tmp_path, artifact_path)
        cached = register_cached_download(
            USER_DATA_EXPORT_KIND,
            export["id"],
            filename,
            artifact_path,
            metadata={"user_id": user_id, "export_id": export["id"]},
        )
        if cached is None:
            raise RuntimeError("Export exceeds the download cache size limit")
    except Exception:
        with contextlib.suppress(OSError):
            tmp_path.unlink(missing_ok=True)
        remove_cached_download(USER_DATA_EXPORT_KIND, export["id"])
        mark_user_data_export_failed(export["id"], "Export could not be built")
        raise

    ready = mark_user_data_export_ready(
        export["id"],
        filename=filename,
        size_bytes=cached.bytes,
        expires_at=generated_at + timedelta(seconds=account_export_ttl_seconds()),
    )
    if ready is None:
        remove_cached_download(USER_DATA_EXPORT_KIND, export["id"])
        return {"status": "skipped", "reason": "superseded"}

    superseded = expire_user_data_exports(user_id=user_id, keep_export_id=export["id"])
    for previous_id in superseded:
        remove_cached_download(USER_DATA_EXPORT_KIND, previous_id)

    return {
        "export_id": export["id"],
        "filename": filename,
        "bytes": cached.bytes,
        "sections": counts,
        "superseded": len(superseded),
    }


def _handle_cleanup_user_data_exports(task_id: str, params: dict, config: dict) -> dict:
    raw_user_id = params.get("user_id")
    stale_failed = 0
    if raw_user_id is None:
        expired = expire_user_data_exports()
        stale_failed = fail_stale_user_data_exports()
    else:
        expired = expire_user_data_exports(user_id=int(raw_user_id))
    for export_id in expired:
        remove_cached_download(USER_DATA_EXPORT_KIND, export_id)
    return {"expired": len(expired), "stale_failed": stale_failed}


USER_DATA_EXPORT_TASK_HANDLERS: dict[str, TaskHandler] = {
    USER_DATA_EXPORT_TASK_TYPE: _handle_export_user_data,
    USER_DATA_EXPORT_CLEANUP_TASK_TYPE: _handle_cleanup_user_data_exports,
}

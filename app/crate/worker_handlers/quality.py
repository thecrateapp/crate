"""Quality scanning runs only in a worker; HTTP readers use persisted evidence."""

import time
from pathlib import Path

from crate.db.analytics_quality_surface import (
    QualityMutationInProgress,
    begin_quality_report_scan,
    complete_quality_report_scan,
)
from crate.db.repositories.agent_task_control import with_task_authority
from crate.quality import QualityScanCancelled, quality_report
from crate.worker_handlers import audio_extensions, is_cancelled


def _handle_quality_check(task_id: str, params: dict, config: dict) -> dict:
    if params.get("scope") != "global":
        return {"error": "Quality check requires explicit global scope"}
    library_path = config.get("library_path")
    if not library_path:
        return {"error": "Library path is not configured"}
    try:
        observation = begin_quality_report_scan()
    except QualityMutationInProgress:
        return {
            "status": "conflict",
            "published": False,
            "reason": "A library mutation is in progress",
        }
    started = time.monotonic()
    next_cancel_check = 0.0
    was_cancelled = False

    def cancelled():
        nonlocal next_cancel_check, was_cancelled
        now = time.monotonic()
        if now >= next_cancel_check:
            was_cancelled = is_cancelled(task_id)
            next_cancel_check = now + 1
        return was_cancelled

    try:
        report = quality_report(
            Path(str(library_path)),
            audio_extensions(),
            cancelled=cancelled,
        )
    except QualityScanCancelled:
        return {"status": "cancelled", "published": False}
    if is_cancelled(task_id):
        return {"status": "cancelled", "published": False}
    published = with_task_authority(
        task_id,
        lambda: complete_quality_report_scan(
            report,
            observation=observation,
            generation_ms=int((time.monotonic() - started) * 1000),
        ),
    )
    return {
        "status": "completed" if published else "conflict",
        "published": published,
        "scanned_tracks": report["scanned_tracks"],
        "method": report["method"],
        "verification": "snapshot_persisted"
        if published
        else "library_changed_during_scan",
    }


QUALITY_TASK_HANDLERS = {"quality_check": _handle_quality_check}

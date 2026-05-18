from __future__ import annotations

import logging
import re

from crate.db.events import emit_task_event
from crate.db.repositories.bandcamp import mark_bandcamp_imports_withdrawn
from crate.db.repositories.library_contributions import (
    count_active_album_contributors,
    get_user_album_contribution,
    mark_album_contribution_withdrawn,
)
from crate.task_progress import TaskProgress, emit_progress
from crate.worker_handlers import TaskHandler, is_cancelled

log = logging.getLogger(__name__)

_BANDCAMP_SOURCE_REF_RE = re.compile(r"^bandcamp:(?P<item_id>\d+)(?::\d+)?$")


def _bandcamp_item_id_from_source_ref(source_ref: str | None) -> int | None:
    match = _BANDCAMP_SOURCE_REF_RE.match(str(source_ref or "").strip())
    if not match:
        return None
    return int(match.group("item_id"))


def _delete_library_album_for_withdrawal(
    task_id: str,
    contribution: dict,
    config: dict,
    *,
    exclude_user_id: int | None = None,
) -> dict:
    album_id = contribution.get("album_id")
    if not album_id:
        return {"deleted": False, "reason": "missing_album_id"}

    remaining = count_active_album_contributors(
        int(album_id),
        exclude_user_id=exclude_user_id,
    )
    if remaining > 0:
        return {"deleted": False, "reason": "shared_album"}

    artist = str(contribution.get("artist_name") or "").strip()
    album = str(contribution.get("album_name") or "").strip()
    if not artist or not album:
        return {"deleted": False, "reason": "missing_album_identity"}

    from crate.worker_handlers.management import _handle_delete_album

    result = _handle_delete_album(
        task_id,
        {"artist": artist, "album": album, "mode": "full"},
        config,
    )
    return {"deleted": True, "result": result}


def _mark_source_withdrawn(contribution: dict, user_id: int) -> dict:
    source = str(contribution.get("source") or "")
    if source != "bandcamp":
        return {"source": source, "updated": 0}

    bandcamp_item_id = _bandcamp_item_id_from_source_ref(contribution.get("source_ref"))
    if bandcamp_item_id is None:
        return {"source": source, "updated": 0, "reason": "missing_source_ref"}

    updated = mark_bandcamp_imports_withdrawn(
        user_id=user_id,
        bandcamp_item_id=bandcamp_item_id,
    )
    return {"source": source, "updated": updated}


def _handle_library_withdraw_contribution(
    task_id: str, params: dict, config: dict
) -> dict:
    user_id = int(params["user_id"])
    contribution_id = int(params["contribution_id"])

    progress = TaskProgress(phase="contribution_withdraw", phase_count=2, total=2)
    emit_progress(task_id, progress, force=True)
    emit_task_event(
        task_id,
        "contribution.withdraw.started",
        {"message": "Withdrawing library contribution"},
    )

    contribution = get_user_album_contribution(
        user_id=user_id,
        contribution_id=contribution_id,
    )
    if not contribution:
        raise RuntimeError("Library contribution not found")
    if contribution.get("status") != "active":
        return {"withdrawn": False, "reason": "not_active"}

    if is_cancelled(task_id):
        return {"cancelled": True}

    withdrawn = mark_album_contribution_withdrawn(
        user_id=user_id,
        contribution_id=contribution_id,
    )
    if not withdrawn:
        raise RuntimeError("Library contribution could not be withdrawn")

    source_update = _mark_source_withdrawn(contribution, user_id)

    progress.done = 1
    emit_progress(task_id, progress, force=True)

    delete_result = _delete_library_album_for_withdrawal(
        task_id,
        contribution,
        config,
    )

    progress.done = 2
    progress.phase = "complete"
    emit_progress(task_id, progress, force=True)
    emit_task_event(
        task_id,
        "contribution.withdraw.succeeded",
        {
            "message": "Library contribution withdrawn",
            "album_deleted": bool(delete_result.get("deleted")),
            "source": contribution.get("source"),
        },
    )
    return {
        "withdrawn": True,
        "contribution_id": contribution_id,
        "source_update": source_update,
        "album_delete": delete_result,
    }


def _handle_library_cleanup_user_contributions(
    task_id: str, params: dict, config: dict
) -> dict:
    user_id = int(params["user_id"])
    contributions = [
        item for item in (params.get("contributions") or []) if isinstance(item, dict)
    ]
    progress = TaskProgress(
        phase="contribution_user_cleanup",
        phase_count=1,
        total=max(len(contributions), 1),
        done=0,
    )
    emit_progress(task_id, progress, force=True)

    deleted = 0
    skipped = 0
    seen_album_ids: set[int] = set()
    for index, contribution in enumerate(contributions, start=1):
        if is_cancelled(task_id):
            return {"cancelled": True, "deleted": deleted, "skipped": skipped}

        raw_album_id = contribution.get("album_id")
        if raw_album_id is None:
            skipped += 1
            continue
        try:
            album_id = int(raw_album_id)
        except (TypeError, ValueError):
            skipped += 1
            continue
        if album_id in seen_album_ids:
            skipped += 1
            continue
        seen_album_ids.add(album_id)

        result = _delete_library_album_for_withdrawal(
            task_id,
            contribution,
            config,
            exclude_user_id=user_id,
        )
        if result.get("deleted"):
            deleted += 1
        else:
            skipped += 1

        progress.done = index
        emit_progress(task_id, progress)

    progress.done = progress.total
    progress.phase = "complete"
    emit_progress(task_id, progress, force=True)
    emit_task_event(
        task_id,
        "contribution.user_cleanup.succeeded",
        {
            "message": "User library contributions cleanup completed",
            "deleted": deleted,
            "skipped": skipped,
        },
    )
    return {"deleted": deleted, "skipped": skipped, "total": len(contributions)}


CONTRIBUTION_TASK_HANDLERS: dict[str, TaskHandler] = {
    "library_withdraw_contribution": _handle_library_withdraw_contribution,
    "library_cleanup_user_contributions": _handle_library_cleanup_user_contributions,
}

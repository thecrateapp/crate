"""Project domain events into persisted UI snapshots."""

from __future__ import annotations

import logging
from typing import Any, Mapping

from crate.content import queue_process_new_content_if_needed
from crate.db.domain_events import list_domain_events, mark_domain_events_processed
from crate.db.home import get_cached_home_discovery
from crate.db.home_warming import list_recent_home_user_ids
from crate.db.ops_snapshot import get_cached_ops_snapshot
from crate.db.queries.tasks import has_inflight_acquisition_for_artist

log = logging.getLogger(__name__)

_OPS_EVENT_TYPES = {
    "library.import_queue.changed",
    "library.scan.completed",
    "track.analysis.updated",
    "track.bliss.updated",
    "snapshot.built",
}

_HOME_EVENT_TYPES = {
    "user.follows.changed",
    "user.likes.changed",
    "user.listening_aggregates.updated",
    "user.play_event.recorded",
    "user.saved_albums.changed",
}

_OPS_INVALIDATION_SCOPES = {
    "library",
    "shows",
    "upcoming",
    "curation",
    "playlists",
}


def _refreshes_ops_from_invalidation(scope: str) -> bool:
    return scope in _OPS_INVALIDATION_SCOPES or scope.startswith(
        ("artist:", "album:", "playlist:")
    )


def _coerce_int(value: object) -> int | None:
    if value is None:
        return None
    if isinstance(value, int):
        return value
    if not isinstance(value, str | float):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _queue_post_acquisition_processing(payload: Mapping[str, Any]) -> bool:
    artist_name = str(payload.get("artist") or "").strip()
    if not artist_name:
        return True

    if has_inflight_acquisition_for_artist(artist_name):
        return False

    queue_process_new_content_if_needed(artist_name, force=True)
    return True


def warm_recent_home_discovery_snapshots(
    *, window_minutes: int = 30, limit: int = 10
) -> int:
    warmed = 0
    for user_id in list_recent_home_user_ids(
        window_minutes=window_minutes, limit=limit
    ):
        get_cached_home_discovery(user_id, fresh=True)
        warmed += 1
    return warmed


def process_domain_events(*, limit: int = 100) -> dict[str, int]:
    """Consume a small batch of domain events and warm affected snapshots."""
    events = list_domain_events(limit=max(1, min(limit, 1000)), unprocessed_only=True)
    if not events:
        return {"processed": 0, "ops_refreshes": 0, "home_refreshes": 0}

    refresh_ops = False
    refresh_home_users: set[int] = set()
    event_ids: list[str] = []

    for event in events:
        event_type = event.get("event_type")
        scope = str(event.get("scope") or "")
        payload_raw = event.get("payload_json")
        payload: Mapping[str, Any] = (
            payload_raw if isinstance(payload_raw, dict) else {}
        )

        if (
            event_type in _OPS_EVENT_TYPES
            or scope.startswith("pipeline:")
            or scope == "ops"
        ):
            refresh_ops = True

        if event_type == "library.acquisition.completed":
            try:
                if not _queue_post_acquisition_processing(payload):
                    continue
            except Exception:
                log.debug("Failed to queue post-acquisition processing", exc_info=True)

        event_id = event.get("id")
        if not event_id:
            continue
        event_ids.append(str(event_id))

        if scope == "home:discovery":
            user_id = _coerce_int(event.get("subject_key"))
            if user_id is not None:
                refresh_home_users.add(user_id)
        elif event_type in _HOME_EVENT_TYPES:
            user_id = _coerce_int(payload.get("user_id") or event.get("subject_key"))
            if user_id is not None:
                refresh_home_users.add(user_id)
        elif scope == "ui.invalidate":
            invalidation_scope = str(
                payload.get("scope") or event.get("subject_key") or ""
            )
            if _refreshes_ops_from_invalidation(invalidation_scope):
                refresh_ops = True
            if invalidation_scope.startswith("home:user:"):
                try:
                    refresh_home_users.add(int(invalidation_scope.split(":")[-1]))
                except (TypeError, ValueError):
                    pass

    ops_refreshes = 0
    home_refreshes = 0

    if refresh_ops:
        get_cached_ops_snapshot(fresh=True)
        ops_refreshes = 1

    for user_id in sorted(refresh_home_users):
        get_cached_home_discovery(user_id, fresh=True)
        home_refreshes += 1

    if event_ids:
        mark_domain_events_processed(event_ids)
    log.debug(
        "Processed %d domain events (ops=%d, home=%d)",
        len(event_ids),
        ops_refreshes,
        home_refreshes,
    )
    return {
        "processed": len(event_ids),
        "ops_refreshes": ops_refreshes,
        "home_refreshes": home_refreshes,
    }

"""Project domain events into persisted UI snapshots."""

from __future__ import annotations

import logging
from typing import Any, Mapping

from crate.content import queue_process_new_content_if_needed
from crate.db.domain_events import (
    list_domain_events,
    mark_domain_event_failed,
    mark_domain_events_processed,
)
from crate.db.home import get_cached_home_discovery
from crate.db.home_discovery_surface import refresh_home_recently_played_snapshot
import crate.db.home_warming as home_warming
from crate.db.ops_snapshot import get_cached_ops_snapshot
from crate.db.queries.tasks import has_inflight_acquisition_for_artist
from crate.db.user_stats_dashboard_surface import (
    refresh_user_stats_dashboard_snapshots,
)

log = logging.getLogger(__name__)

_OPS_EVENT_TYPES = {
    "library.import_queue.changed",
    "library.scan.completed",
    "track.analysis.updated",
    "track.bliss.updated",
    "snapshot.built",
    "federation.catalog.sync.started",
    "federation.catalog.sync.completed",
    "federation.catalog.sync.failed",
    "federation.catalog.synced",
    "federation.catalog.item.upserted",
    "federation.catalog.item.deleted",
    "federation.catalog.peer.stale",
    "federation.stream.ticket.created",
    "federation.stream.proxy.completed",
    "federation.stream.proxy.failed",
    "federation.import.requested",
    "federation.import.completed",
    "federation.import.failed",
    "global_catalog.reconcile.started",
    "global_catalog.reconcile.completed",
    "global_catalog.reconcile.failed",
    "global_catalog.entity.changed",
    "global_catalog.peer.stale",
}

_HOME_EVENT_TYPES = {
    "user.follows.changed",
    "user.likes.changed",
    "user.listening_aggregates.updated",
    "user.saved_albums.changed",
}

_OPS_INVALIDATION_SCOPES = {
    "library",
    "global_catalog",
    "shows",
    "upcoming",
    "curation",
    "playlists",
}

_HOME_GLOBAL_INVALIDATION_SCOPES = {
    "home",
    "library",
    "global_catalog",
    "shows",
    "upcoming",
    "curation",
    "playlists",
}

_HOME_GLOBAL_INVALIDATION_PREFIXES = ("artist:", "album:", "playlist:")


def _refreshes_ops_from_invalidation(scope: str) -> bool:
    return scope in _OPS_INVALIDATION_SCOPES or scope.startswith(
        ("artist:", "album:", "playlist:")
    )


def _refreshes_recent_home_from_invalidation(scope: str) -> bool:
    return scope in _HOME_GLOBAL_INVALIDATION_SCOPES or scope.startswith(
        _HOME_GLOBAL_INVALIDATION_PREFIXES
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


def process_domain_events(*, limit: int = 100) -> dict[str, int]:
    """Consume events, coalesce projections, and acknowledge only successful work."""
    events = list_domain_events(limit=max(1, min(limit, 1000)), unprocessed_only=True)
    if not events:
        return {"processed": 0, "ops_refreshes": 0, "home_refreshes": 0}

    event_by_id: dict[str, dict[str, Any]] = {}
    actions_by_event: dict[str, set[tuple[str, int | None]]] = {}
    deferred: set[str] = set()
    failures: dict[str, Exception] = {}
    for event in events:
        event_id = str(event.get("id") or "")
        if not event_id:
            continue
        event_by_id[event_id] = event
        try:
            actions, should_defer = _projection_actions(event)
            actions_by_event[event_id] = actions
            if should_defer:
                deferred.add(event_id)
        except Exception as exc:
            failures[event_id] = exc
            log.warning(
                "Failed to classify domain event",
                extra={"event_id": event_id, "event_type": event.get("event_type")},
                exc_info=True,
            )

    ops_refreshes = 0
    home_refreshes = 0
    events_by_action: dict[tuple[str, int | None], set[str]] = {}
    for event_id, actions in actions_by_event.items():
        if event_id in deferred or event_id in failures:
            continue
        for action in actions:
            events_by_action.setdefault(action, set()).add(event_id)

    for action, dependent_ids in sorted(
        events_by_action.items(), key=lambda item: (item[0][0], str(item[0][1]))
    ):
        try:
            ops_delta, home_delta = _execute_projection_action(action)
            ops_refreshes += ops_delta
            home_refreshes += home_delta
        except Exception as exc:
            for event_id in dependent_ids:
                failures.setdefault(event_id, exc)
            log.warning(
                "Domain-event projection failed",
                extra={"projection": action[0]},
                exc_info=True,
            )

    for event_id, error in failures.items():
        mark_domain_event_failed(event_by_id[event_id], error)

    processed_ids = [
        event_id
        for event_id in event_by_id
        if event_id not in deferred and event_id not in failures
    ]
    if processed_ids:
        mark_domain_events_processed(processed_ids)
    log.debug(
        "Processed %d domain events (ops=%d, home=%d)",
        len(processed_ids),
        ops_refreshes,
        home_refreshes,
    )
    return {
        "processed": len(processed_ids),
        "ops_refreshes": ops_refreshes,
        "home_refreshes": home_refreshes,
    }


def _projection_actions(
    event: Mapping[str, Any],
) -> tuple[set[tuple[str, int | None]], bool]:
    event_type = str(event.get("event_type") or "")
    scope = str(event.get("scope") or "")
    payload_raw = event.get("payload_json")
    if not isinstance(payload_raw, dict):
        raise ValueError("Domain event payload must be an object")
    payload: Mapping[str, Any] = payload_raw
    actions: set[tuple[str, int | None]] = set()

    if (
        event_type in _OPS_EVENT_TYPES
        or scope.startswith("pipeline:")
        or scope.startswith("federation.")
        or scope == "global_catalog"
        or scope == "ops"
    ):
        actions.add(("ops", None))
        if scope == "global_catalog":
            actions.add(("recent-global", None))

    if event_type == "library.acquisition.completed":
        if not _queue_post_acquisition_processing(payload):
            return set(), True
        actions.add(("ops", None))
        actions.add(("recent-global", None))

    if event_type == "user.play_event.recorded":
        user_id = _coerce_int(payload.get("user_id") or event.get("subject_key"))
        if user_id is not None:
            actions.add(("recent-user", user_id))
    elif scope == "home:discovery":
        user_id = _coerce_int(event.get("subject_key"))
        if user_id is not None:
            actions.add(("home-user", user_id))
    elif event_type in _HOME_EVENT_TYPES:
        user_id = _coerce_int(payload.get("user_id") or event.get("subject_key"))
        if user_id is not None:
            actions.add(("home-user", user_id))
            if event_type == "user.listening_aggregates.updated":
                actions.add(("stats-user", user_id))
    elif scope == "ui.invalidate":
        invalidation_scope = str(payload.get("scope") or event.get("subject_key") or "")
        if _refreshes_ops_from_invalidation(invalidation_scope):
            actions.add(("ops", None))
        if _refreshes_recent_home_from_invalidation(invalidation_scope):
            actions.add(("recent-global", None))
        if invalidation_scope.startswith("home:user:"):
            user_id = _coerce_int(invalidation_scope.rsplit(":", 1)[-1])
            if user_id is not None:
                actions.add(("home-user", user_id))
    return actions, False


def _execute_projection_action(action: tuple[str, int | None]) -> tuple[int, int]:
    name, subject = action
    if name == "ops":
        get_cached_ops_snapshot(fresh=True)
        return 1, 0
    if name == "recent-global":
        return 0, home_warming.warm_recent_home_discovery_snapshots()
    if subject is None:
        raise ValueError(f"Projection {name} requires a user ID")
    if name == "home-user":
        get_cached_home_discovery(subject, fresh=True)
        return 0, 1
    if name == "recent-user":
        refresh_home_recently_played_snapshot(subject)
        return 0, 1
    if name == "stats-user":
        refresh_user_stats_dashboard_snapshots(subject)
        return 0, 0
    raise ValueError(f"Unsupported projection action: {name}")

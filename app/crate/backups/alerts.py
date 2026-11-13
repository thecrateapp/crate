"""Backup alerts, pushed from a scheduled task (admin backups, BK6).

``crate.backups.health.build_overview`` computes the alerts Admin shows: a failing
destination, a late copy, a failed verification or restore drill, a failed dump
or local retention. ``sync_backup_alerts`` runs them every few minutes in the
``backup_alerts`` task, never in a request, and keeps one open alert per
condition (its ``kind`` and destination) until the condition clears:

- a condition seen for the first time opens an alert with an occurrence ``id``;
- while it holds, the same alert stays open (its text and level follow the latest
  reading, its ``id`` and ``opened_at`` do not change);
- when it is gone, the alert resolves; if it comes back later, a new occurrence
  opens with a new ``id``.

The state lives in ``ops_runtime_state`` under ``backup_alerts``. Crate's push
channel is Crate Operator's supervisor (``docs/technical/crate-operator.md``): the
Crate MCP serves the open alerts in ``get_observability_summary`` as
``sources.backup_alerts`` and the ``backups/backup-alerts`` digest rule sends each
new occurrence once, by its ``id``. Openings and resolutions are also logged.
"""

from __future__ import annotations

import hashlib
import logging
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

log = logging.getLogger(__name__)

STATE_KEY = "backup_alerts"
SCHEMA_VERSION = 1
MAX_OPEN = 20
MAX_RESOLVED = 20
MAX_TEXT = 300


@dataclass(slots=True)
class AlertSync:
    state: dict[str, Any]
    opened: list[dict[str, Any]] = field(default_factory=list)
    resolved: list[dict[str, Any]] = field(default_factory=list)
    still_open: int = 0

    def summary(self) -> dict[str, Any]:
        return {
            "open": len(self.state["open"]),
            "opened": [a["id"] for a in self.opened],
            "resolved": [a["id"] for a in self.resolved],
        }


def condition_key(alert: Mapping[str, Any]) -> str:
    return f"{alert['kind']}:{alert.get('destination_id') or 'local'}"


def _iso(value: Any) -> str | None:
    if isinstance(value, datetime):
        return value.isoformat()
    return None if value is None else str(value)


def _occurrence_id(key: str, opened_at: str) -> str:
    return hashlib.sha256(f"{key}\0{opened_at}".encode()).hexdigest()[:16]


def _view(alert: Mapping[str, Any], names: Mapping[str, str]) -> dict[str, Any]:
    destination_id = alert.get("destination_id")
    return {
        "kind": str(alert["kind"])[:40],
        "level": alert.get("level")
        if alert.get("level") in ("danger", "warning")
        else "warning",
        "destination_id": destination_id,
        "destination": names.get(str(destination_id), "") if destination_id else "",
        "title": str(alert.get("title") or "")[:120],
        "text": " ".join(str(alert.get("text") or "").split())[:MAX_TEXT],
        "at": _iso(alert.get("at")),
    }


def reconcile(
    previous: Mapping[str, Any] | None,
    alerts: Sequence[Mapping[str, Any]],
    *,
    names: Mapping[str, str] | None = None,
    now: datetime | None = None,
) -> AlertSync:
    """The next state from the stored one and the alerts that hold now."""
    now = now or datetime.now(timezone.utc)
    stamp = now.isoformat()
    names = names or {}
    before = {
        str(entry["key"]): dict(entry)
        for entry in ((previous or {}).get("open") or [])
        if isinstance(entry, Mapping) and entry.get("key") and entry.get("id")
    }
    sync = AlertSync(state={})
    current: dict[str, dict[str, Any]] = {}
    for alert in alerts:
        key = condition_key(alert)
        if key in current:
            continue
        view = _view(alert, names)
        if key in before:
            entry = {**before[key], **view, "last_seen_at": stamp}
            sync.still_open += 1
        else:
            entry = {
                "id": _occurrence_id(key, stamp),
                "key": key,
                **view,
                "opened_at": stamp,
                "last_seen_at": stamp,
            }
            sync.opened.append(entry)
        current[key] = entry
    for key, entry in before.items():
        if key not in current:
            sync.resolved.append({**entry, "resolved_at": stamp})
    resolved_before = [
        dict(entry)
        for entry in ((previous or {}).get("resolved") or [])
        if isinstance(entry, Mapping)
    ]
    open_entries = sorted(current.values(), key=lambda e: (e["opened_at"], e["key"]))
    sync.state = {
        "schema_version": SCHEMA_VERSION,
        "checked_at": stamp,
        "open": open_entries[:MAX_OPEN],
        "open_count": len(open_entries),
        "resolved": [*reversed(sync.resolved), *resolved_before][:MAX_RESOLVED],
    }
    return sync


def read_inputs() -> dict[str, Any]:
    """The rows the alerts and the metrics need: a handful of small reads."""
    from crate.backups.destinations import list_destinations
    from crate.db.queries.backup_policies import list_backup_policies
    from crate.db.queries.backup_runs import (
        latest_destination_runs,
        latest_local_runs,
        latest_successful_dump,
    )

    return {
        "destinations": list_destinations(),
        "policy_rows": list_backup_policies(),
        "latest": latest_destination_runs(),
        "latest_dump": latest_successful_dump(),
        "local_runs": latest_local_runs(),
        "size_series": {},
    }


def sync_backup_alerts(
    *, inputs: Mapping[str, Any] | None = None, now: datetime | None = None
) -> AlertSync:
    """Compute the alerts, reconcile them with the stored state, store and log."""
    from crate.backups.health import build_overview
    from crate.db.ops_runtime import get_ops_runtime_state, set_ops_runtime_state

    inputs = dict(inputs or read_inputs())
    overview = build_overview(**inputs, now=now)
    names = {d["id"]: d["name"] for d in overview["destinations"]}
    sync = reconcile(
        get_ops_runtime_state(STATE_KEY),
        overview["alerts"],
        names=names,
        now=now,
    )
    set_ops_runtime_state(STATE_KEY, sync.state)
    for alert in sync.opened:
        log.warning("Backup alert opened: %s (%s)", alert["title"], alert["text"])
    for alert in sync.resolved:
        log.info("Backup alert resolved: %s", alert["title"])
    return sync


def has_open_alerts() -> bool:
    from crate.db.ops_runtime import get_ops_runtime_state

    state = get_ops_runtime_state(STATE_KEY) or {}
    return bool(state.get("open"))


__all__ = [
    "AlertSync",
    "MAX_OPEN",
    "STATE_KEY",
    "condition_key",
    "has_open_alerts",
    "read_inputs",
    "reconcile",
    "sync_backup_alerts",
]

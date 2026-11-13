"""Health of the backups for Admin: per destination, alerts, the overview (BK4).

Health words, as Admin shows them: ``disabled``, ``untested`` (never passed a
test), ``failing`` (the last test, copy or check failed: red, BG1-3), ``late``
(no good copy within 1.5 times the shortest interval of its tiers in any enabled
policy: amber, BG1-6) and ``healthy``. The sidebar counter is the number of
failing destinations (BG1-1). Everything comes from a handful of small reads of
the backup tables; nothing here runs restic.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import datetime, timedelta, timezone
from typing import Any

from crate.backups import policies as rules

HEALTHS = ("healthy", "late", "failing", "untested", "disabled")


def _tiers_by_destination(
    policy_rows: Sequence[Mapping[str, Any]],
) -> dict[str, list[tuple[Mapping[str, Any], list[str]]]]:
    out: dict[str, list[tuple[Mapping[str, Any], list[str]]]] = {}
    for policy in policy_rows:
        if not policy.get("enabled"):
            continue
        for destination_id, tiers in (policy.get("destinations") or {}).items():
            out.setdefault(destination_id, []).append((policy, list(tiers)))
    return out


def allowed_age(
    links: Sequence[tuple[Mapping[str, Any], list[str]]],
) -> timedelta | None:
    ages = [age for policy, tiers in links if (age := rules.late_after(policy, tiers))]
    return min(ages) if ages else None


def destination_health(
    destination: Mapping[str, Any],
    *,
    last_copy_at: datetime | None,
    allowed: timedelta | None,
    now: datetime,
) -> str:
    if not destination.get("enabled"):
        return "disabled"
    if destination.get("repository_initialized_at") is None:
        return "untested"
    if destination.get("status") in ("failing", "unavailable"):
        return "failing"
    if allowed is not None and rules.is_late(last_copy_at, now, allowed):
        return "late"
    return "healthy"


def kit_covered(destination: Mapping[str, Any]) -> bool:
    return destination.get("recovery_kit_confirmed_at") is not None


def _run_time(run: Mapping[str, Any] | None) -> datetime | None:
    if not run:
        return None
    return run.get("finished_at") or run.get("started_at")


def build_overview(
    *,
    destinations: Sequence[Mapping[str, Any]],
    policy_rows: Sequence[Mapping[str, Any]],
    latest: Mapping[str, Mapping[str, Mapping[str, Any]]],
    latest_dump: Mapping[str, Any] | None,
    size_series: Mapping[str, list[dict[str, Any]]],
    now: datetime | None = None,
) -> dict[str, Any]:
    """The overview payload from rows already read (public destination views)."""
    now = now or datetime.now(timezone.utc)
    links = _tiers_by_destination(policy_rows)
    entries = []
    for destination in destinations:
        runs = latest.get(destination["id"], {})
        last_copy = runs.get("offsite_succeeded")
        allowed = allowed_age(links.get(destination["id"], []))
        health = destination_health(
            destination, last_copy_at=_run_time(last_copy), allowed=allowed, now=now
        )
        entries.append(
            {
                **destination,
                "health": health,
                "last_copy_at": _run_time(last_copy),
                "last_copy_snapshot": (last_copy or {}).get("snapshot_id"),
                "late_after_hours": (
                    None if allowed is None else allowed.total_seconds() / 3600
                ),
                "tiers": sorted(
                    {t for _, tiers in links.get(destination["id"], []) for t in tiers},
                    key=rules.TIERS.index,
                ),
                "policy_ids": [p["id"] for p, _ in links.get(destination["id"], [])],
                "last_verify": runs.get("verify"),
                "last_drill": runs.get("restore_drill"),
                "kit_covered": kit_covered(destination),
            }
        )

    alerts: list[dict[str, Any]] = []
    for entry in entries:
        if entry["health"] == "failing":
            alerts.append(
                {
                    "level": "danger",
                    "kind": "destination_failing",
                    "destination_id": entry["id"],
                    "title": f"{entry['name']} is failing",
                    "text": entry.get("last_error") or "The last test or copy failed.",
                    "at": entry.get("last_checked_at"),
                    "action": "test",
                }
            )
        elif entry["health"] == "late":
            alerts.append(
                {
                    "level": "warning",
                    "kind": "copy_late",
                    "destination_id": entry["id"],
                    "title": f"No recent copy on {entry['name']}",
                    "text": (
                        "No good copy within "
                        f"{entry['late_after_hours']:.0f} hours, 1.5 times its schedule."
                    ),
                    "at": entry["last_copy_at"],
                    "action": "run",
                }
            )
        for kind, label in (("last_verify", "Verify"), ("last_drill", "Restore drill")):
            run = entry.get(kind)
            if run and run.get("status") == "failed":
                alerts.append(
                    {
                        "level": "danger",
                        "kind": f"{kind[5:]}_failed",
                        "destination_id": entry["id"],
                        "title": f"{label} failed on {entry['name']}",
                        "text": run.get("error") or f"The last {label.lower()} failed.",
                        "at": _run_time(run),
                        "action": "verify"
                        if kind == "last_verify"
                        else "restore_drill",
                    }
                )

    usable = [e for e in entries if e["health"] != "disabled"]
    copies = [(e["last_copy_at"], e) for e in entries if e["last_copy_at"] is not None]
    last_copy = max(copies, key=lambda pair: pair[0]) if copies else None
    # Every destination's password matters, a disabled one's too.
    uncovered = [e for e in entries if not e["kit_covered"]]
    names = {e["id"]: e["name"] for e in entries}
    return {
        "generated_at": now,
        "destinations": entries,
        "failing_count": sum(1 for e in entries if e["health"] == "failing"),
        "late_count": sum(1 for e in entries if e["health"] == "late"),
        "kit": {
            "saved": not uncovered,
            "uncovered": len(uncovered),
            "total": len(entries),
            "downloaded_at": max(
                (
                    e["recovery_kit_downloaded_at"]
                    for e in entries
                    if e.get("recovery_kit_downloaded_at")
                ),
                default=None,
            ),
        },
        "stats": {
            "last_copy_at": last_copy[0] if last_copy else None,
            "last_copy_destination": last_copy[1]["name"] if last_copy else None,
            "stored_bytes": sum(e.get("repository_bytes") or 0 for e in usable),
            "repositories": sum(1 for e in usable if e.get("repository_bytes")),
            "snapshots": sum(e.get("snapshot_count") or 0 for e in usable),
            "latest_dump": latest_dump,
            "last_verify": _latest_of(entries, "last_verify"),
            "last_drill": _latest_of(entries, "last_drill"),
        },
        "alerts": alerts,
        "size_series": [
            {"destination_id": d, "name": names.get(d, d), "points": points}
            for d, points in size_series.items()
            if d in names
        ],
        "policies": [
            {
                "id": p["id"],
                "name": p["name"],
                "enabled": p["enabled"],
                "schedule_kind": p["schedule_kind"],
                "next_run": rules.next_run(p, rules.local_now()),
                "destination_count": len(p.get("destinations") or {}),
            }
            for p in policy_rows
        ],
    }


def _latest_of(entries: Sequence[Mapping[str, Any]], key: str) -> dict[str, Any] | None:
    best: tuple[Mapping[str, Any], Mapping[str, Any]] | None = None
    for entry in entries:
        run = entry.get(key)
        at = _run_time(run)
        if run and at and (best is None or at > (_run_time(best[1]) or at)):
            best = (entry, run)
    if best is None:
        return None
    entry, run = best
    return {
        "at": _run_time(run),
        "destination_id": entry["id"],
        "destination": entry["name"],
        "status": run.get("status"),
        "details": run.get("details") or {},
    }


__all__ = [
    "HEALTHS",
    "allowed_age",
    "build_overview",
    "destination_health",
    "kit_covered",
]

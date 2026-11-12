"""Backup policies: validation, schedule, tiers, retention and lateness (BK3).

Pure functions, so the scheduler, the worker and the Admin API agree on them.
Times are wall-clock times in the server's time zone (``local_now``): a policy
"daily at 03:30" runs at 03:30 on the server's clock, as the Admin page says.

- **Schedule.** ``daily`` runs once a day at ``daily_at``; a worker that was down
  at that time still starts it within ``DAILY_GRACE``. ``hours`` runs every
  ``interval_hours``. ``manual`` runs only from Run now or the deploy
  (``make backup-before-upgrade``).
- **Tiers.** Every scheduled run is a daily copy. It is also the weekly copy when
  no weekly copy was made since the start of the last Sunday, and the monthly copy
  when none was made this calendar month. A destination receives a run only for
  the tiers it has; a manual run goes to every destination of its policy.
- **Retention.** ``restic forget --group-by host`` with the policy's counts for the
  tiers the destination receives, so the sidecar's older snapshots (same host,
  ``crate``) are pruned with the engine's (decision D6). Manual policies use their
  own host, ``crate-manual``, so a copy taken before an upgrade never displaces a
  scheduled one.
- **Lateness.** A destination is late once its last good copy is older than 1.5
  times the shortest interval of its tiers: a weekly-only destination after 10.5
  days (BG1-6).
- **Drill.** One restore drill every ``drill_every_days`` per policy, from the
  fixed destination or, by default, from the destination whose last drill is the
  oldest (BG1-7).
"""

from __future__ import annotations

import os
import re
from collections.abc import Iterable, Mapping, Sequence
from datetime import datetime, timedelta, tzinfo
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

TIERS = ("daily", "weekly", "monthly")
SCHEDULE_KINDS = ("daily", "hours", "manual")
COMPRESSIONS = ("auto", "max", "off")
SCHEDULED_HOST = "crate"
MANUAL_HOST = "crate-manual"
DAILY_GRACE = timedelta(hours=12)
LATE_FACTOR = 1.5
MAX_KEEP = 1000
MAX_INTERVAL_HOURS = 168
_HHMM = re.compile(r"^(\d{1,2}):(\d{2})$")
_INTERVALS = {"weekly": timedelta(days=7), "monthly": timedelta(days=31)}

DEFAULTS: dict[str, Any] = {
    "enabled": True,
    "daily_at": None,
    "interval_hours": None,
    "window_start": None,
    "window_end": None,
    "keep_daily": 7,
    "keep_weekly": 4,
    "keep_monthly": 3,
    "compression": "auto",
    "verify_every_days": 7,
    "verify_read_percent": 5,
    "drill_every_days": 30,
    "drill_destination_id": None,
    "run_before_upgrade": False,
}
FIELDS = ("name", "schedule_kind", *DEFAULTS)


class PolicyError(ValueError):
    """A policy or its tiers are not valid; the message is safe to show."""


# ── time ────────────────────────────────────────────────────────────


def local_zone() -> tzinfo:
    """The server's time zone: ``TZ`` if it names one, else the system's."""
    name = os.environ.get("TZ", "").strip()
    if name:
        try:
            return ZoneInfo(name)
        except (ZoneInfoNotFoundError, ValueError):
            pass
    zone = datetime.now().astimezone().tzinfo
    assert zone is not None
    return zone


def local_now() -> datetime:
    return datetime.now(local_zone())


def _minutes(hhmm: str) -> int:
    hours, minutes = hhmm.split(":")
    return int(hours) * 60 + int(minutes)


def _slot(now: datetime, hhmm: str) -> datetime:
    minutes = _minutes(hhmm)
    return now.replace(hour=minutes // 60, minute=minutes % 60, second=0, microsecond=0)


# ── validation ──────────────────────────────────────────────────────


def _hhmm(name: str, value: Any) -> str:
    match = _HHMM.match(str(value or "").strip())
    if not match or int(match.group(1)) > 23 or int(match.group(2)) > 59:
        raise PolicyError(f"{name} must be a time of day as HH:MM")
    return f"{int(match.group(1)):02d}:{match.group(2)}"


def _count(name: str, value: Any, low: int, high: int, what: str) -> int:
    if type(value) is not int or not low <= value <= high:
        raise PolicyError(f"{name} must be {what} from {low} to {high}")
    return value


def _check(merged: dict[str, Any]) -> dict[str, Any]:
    clean: dict[str, Any] = {}
    name = str(merged.get("name") or "").strip()
    if not 1 <= len(name) <= 80:
        raise PolicyError("The policy needs a name of 1 to 80 characters")
    clean["name"] = name
    kind = merged.get("schedule_kind")
    if kind not in SCHEDULE_KINDS:
        raise PolicyError("The schedule must be daily, every N hours or manual")
    clean["schedule_kind"] = kind
    clean["enabled"] = bool(merged.get("enabled", True))
    clean["daily_at"] = clean["interval_hours"] = None
    if kind == "daily":
        if merged.get("daily_at") in (None, ""):
            raise PolicyError("A daily policy needs its time, as HH:MM")
        clean["daily_at"] = _hhmm("The daily time", merged["daily_at"])
    elif kind == "hours":
        clean["interval_hours"] = _count(
            "Every N hours",
            merged.get("interval_hours"),
            1,
            MAX_INTERVAL_HOURS,
            "a number of hours",
        )
    start, end = merged.get("window_start"), merged.get("window_end")
    if (start in (None, "")) != (end in (None, "")):
        raise PolicyError("A window needs both its start and its end")
    if start not in (None, "") and kind == "manual":
        raise PolicyError("A manual policy runs at once; it has no window")
    clean["window_start"] = None if start in (None, "") else _hhmm("The window", start)
    clean["window_end"] = None if end in (None, "") else _hhmm("The window", end)
    for tier in TIERS:
        key = f"keep_{tier}"
        clean[key] = _count(
            f"keep_{tier}",
            merged.get(key, DEFAULTS[key]),
            0,
            MAX_KEEP,
            "a whole number",
        )
    if not any(clean[f"keep_{tier}"] for tier in TIERS):
        raise PolicyError("The policy must keep at least one copy (keep_*)")
    compression = merged.get("compression", DEFAULTS["compression"])
    if compression not in COMPRESSIONS:
        raise PolicyError("The compression must be auto, max or off")
    clean["compression"] = compression
    clean["verify_every_days"] = _count(
        "Verify every",
        merged.get("verify_every_days", DEFAULTS["verify_every_days"]),
        0,
        365,
        "a number of days",
    )
    clean["verify_read_percent"] = _count(
        "The verify read percent",
        merged.get("verify_read_percent", DEFAULTS["verify_read_percent"]),
        1,
        100,
        "a percent",
    )
    clean["drill_every_days"] = _count(
        "Restore drill every",
        merged.get("drill_every_days", DEFAULTS["drill_every_days"]),
        0,
        365,
        "a number of days",
    )
    drill = merged.get("drill_destination_id")
    clean["drill_destination_id"] = str(drill) if drill else None
    clean["run_before_upgrade"] = bool(merged.get("run_before_upgrade", False))
    return clean


def validate_policy(
    values: Mapping[str, Any], *, current: Mapping[str, Any] | None = None
) -> dict[str, Any]:
    """Check a new policy, or a change to ``current``.

    A new policy comes back whole, with defaults. A change comes back as the
    fields it changes, plus the ones the change clears (a daily time when the
    schedule becomes every N hours, for example).
    """
    unknown = set(values) - set(FIELDS)
    if unknown:
        raise PolicyError(f"Unknown policy fields: {', '.join(sorted(unknown))}")
    if current is None:
        return _check({**DEFAULTS, **values})
    before = _check({**DEFAULTS, **{k: current.get(k) for k in FIELDS if k in current}})
    base = before
    if values.get("schedule_kind") not in (None, before["schedule_kind"]):
        # The old schedule's own fields do not carry over.
        base = {**base, "daily_at": None, "interval_hours": None}
        if values["schedule_kind"] == "manual":
            base = {**base, "window_start": None, "window_end": None}
    after = _check({**base, **values})
    return {k: v for k, v in after.items() if k in values or before.get(k) != v}


def validate_tiers(tiers: Mapping[str, Iterable[str]]) -> dict[str, list[str]]:
    """``{destination_id: tiers}``, each tier known and listed once, in order."""
    clean: dict[str, list[str]] = {}
    for destination_id, values in tiers.items():
        listed = list(values or [])
        if not listed or any(tier not in TIERS for tier in listed):
            raise PolicyError(
                "Each destination needs one tier or more: daily, weekly or monthly"
            )
        clean[str(destination_id)] = [tier for tier in TIERS if tier in listed]
    return clean


# ── schedule ────────────────────────────────────────────────────────


def is_due(policy: Mapping[str, Any], now: datetime) -> bool:
    """Whether the scheduler should start the policy now."""
    if not policy.get("enabled") or policy.get("schedule_kind") == "manual":
        return False
    last = policy.get("last_scheduled_at")
    if policy["schedule_kind"] == "hours":
        interval = timedelta(hours=int(policy["interval_hours"]))
        return last is None or now - last >= interval
    slot = _slot(now, policy["daily_at"])
    if now < slot:
        slot -= timedelta(days=1)
    if now - slot > DAILY_GRACE:
        return False
    return last is None or last < slot


def next_run(policy: Mapping[str, Any], now: datetime) -> datetime | None:
    if not policy.get("enabled") or policy.get("schedule_kind") == "manual":
        return None
    if policy["schedule_kind"] == "hours":
        last = policy.get("last_scheduled_at")
        if last is None:
            return now
        return max(now, last + timedelta(hours=int(policy["interval_hours"])))
    slot = _slot(now, policy["daily_at"])
    return slot if now < slot else slot + timedelta(days=1)


def seconds_until_window(policy: Mapping[str, Any], now: datetime) -> int:
    """0 inside the window (or without one), else the seconds until it opens."""
    start, end = policy.get("window_start"), policy.get("window_end")
    if not start or not end:
        return 0
    start_min, end_min = _minutes(start), _minutes(end)
    now_min = now.hour * 60 + now.minute
    if start_min == end_min:
        return 0
    if start_min < end_min:
        inside = start_min <= now_min < end_min
    else:
        inside = now_min >= start_min or now_min < end_min
    if inside:
        return 0
    return ((start_min - now_min) % (24 * 60)) * 60


# ── tiers and retention ─────────────────────────────────────────────


def due_tiers(now: datetime, last_copies: Mapping[str, datetime | None]) -> set[str]:
    """The tiers a scheduled run makes, from the destination's last copy of each."""
    due = {"daily"}
    weekly = last_copies.get("weekly")
    sunday = (now - timedelta(days=now.isoweekday() % 7)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    if weekly is None or weekly < sunday:
        due.add("weekly")
    monthly = last_copies.get("monthly")
    if monthly is None:
        due.add("monthly")
    else:
        local = monthly.astimezone(now.tzinfo)
        if (local.year, local.month) != (now.year, now.month):
            due.add("monthly")
    return due


def run_tiers(
    policy: Mapping[str, Any],
    now: datetime,
    last_copies: Mapping[str, datetime | None],
) -> set[str]:
    if policy.get("schedule_kind") == "manual":
        return set(TIERS)
    return due_tiers(now, last_copies)


def destination_tags(destination_tiers: Iterable[str], due: Iterable[str]) -> list[str]:
    wanted, made = set(destination_tiers), set(due)
    return [tier for tier in TIERS if tier in wanted and tier in made]


def snapshot_host(policy: Mapping[str, Any]) -> str:
    return MANUAL_HOST if policy.get("schedule_kind") == "manual" else SCHEDULED_HOST


def forget_arguments(
    policy: Mapping[str, Any], destination_tiers: Sequence[str]
) -> list[str]:
    """``restic forget`` arguments for one destination of the policy.

    ``--keep-last 1`` always keeps the newest snapshot, whatever the counts.
    """
    args = [
        "--host",
        snapshot_host(policy),
        "--group-by",
        "host",
        "--keep-last",
        "1",
    ]
    for tier in TIERS:
        count = int(policy.get(f"keep_{tier}") or 0)
        if tier in destination_tiers and count > 0:
            args += [f"--keep-{tier}", str(count)]
    return args


# ── lateness ────────────────────────────────────────────────────────


def expected_interval(
    policy: Mapping[str, Any], destination_tiers: Iterable[str]
) -> timedelta | None:
    """The shortest interval between two copies to a destination, if scheduled."""
    if policy.get("schedule_kind") == "manual":
        return None
    intervals = []
    tiers = set(destination_tiers)
    if "daily" in tiers:
        if policy.get("schedule_kind") == "hours":
            intervals.append(timedelta(hours=int(policy["interval_hours"])))
        else:
            intervals.append(timedelta(hours=24))
    intervals += [_INTERVALS[t] for t in ("weekly", "monthly") if t in tiers]
    return min(intervals) if intervals else None


def late_after(
    policy: Mapping[str, Any], destination_tiers: Iterable[str]
) -> timedelta | None:
    interval = expected_interval(policy, destination_tiers)
    return None if interval is None else interval * LATE_FACTOR


def is_late(
    last_success: datetime | None, now: datetime, allowed: timedelta | None
) -> bool:
    if allowed is None:
        return False
    return last_success is None or now - last_success > allowed


# ── verify and drill cadence ────────────────────────────────────────


def verify_due(
    policy: Mapping[str, Any], last_verify: datetime | None, now: datetime
) -> bool:
    every = int(policy.get("verify_every_days") or 0)
    if every <= 0:
        return False
    return last_verify is None or now - last_verify >= timedelta(days=every)


def drill_source(
    policy: Mapping[str, Any],
    candidates: Sequence[str],
    last_drills: Mapping[str, datetime],
    now: datetime,
) -> str | None:
    """The destination of the policy's next drill, or None when none is due."""
    every = int(policy.get("drill_every_days") or 0)
    if every <= 0 or not candidates:
        return None
    if last_drills and now - max(last_drills.values()) < timedelta(days=every):
        return None
    fixed = policy.get("drill_destination_id")
    if fixed and fixed in candidates:
        return fixed
    never = [c for c in candidates if c not in last_drills]
    if never:
        return never[0]
    return min(candidates, key=lambda c: last_drills[c])


__all__ = [
    "COMPRESSIONS",
    "DEFAULTS",
    "FIELDS",
    "MANUAL_HOST",
    "PolicyError",
    "SCHEDULED_HOST",
    "SCHEDULE_KINDS",
    "TIERS",
    "destination_tags",
    "drill_source",
    "due_tiers",
    "expected_interval",
    "forget_arguments",
    "is_due",
    "is_late",
    "late_after",
    "local_now",
    "local_zone",
    "next_run",
    "run_tiers",
    "seconds_until_window",
    "snapshot_host",
    "validate_policy",
    "validate_tiers",
    "verify_due",
]

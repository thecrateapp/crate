"""Policy logic of the backups engine: schedule, tiers, retention, lateness (BK3)."""

from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from crate.backups import policies
from crate.backups.policies import PolicyError

MADRID = ZoneInfo("Europe/Madrid")


def at(text: str) -> datetime:
    return datetime.fromisoformat(text).replace(tzinfo=MADRID)


def nightly(**overrides):
    policy = {
        "id": "p1",
        "name": "Nightly",
        "enabled": True,
        "schedule_kind": "daily",
        "daily_at": "03:30",
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
        "last_scheduled_at": None,
        "destinations": {},
    }
    policy.update(overrides)
    return policy


# ── validation ──────────────────────────────────────────────────────


def test_validation_normalises_a_full_policy():
    clean = policies.validate_policy(
        {
            "name": "  Nightly ",
            "schedule_kind": "daily",
            "daily_at": "3:30",
            "window_start": "02:00",
            "window_end": "06:00",
            "keep_daily": 7,
            "keep_weekly": 4,
            "keep_monthly": 3,
        }
    )
    assert clean["name"] == "Nightly"
    assert clean["daily_at"] == "03:30"
    assert clean["interval_hours"] is None
    assert (clean["window_start"], clean["window_end"]) == ("02:00", "06:00")


@pytest.mark.parametrize(
    "values, message",
    [
        ({"schedule_kind": "daily"}, "time"),
        ({"schedule_kind": "daily", "daily_at": "24:00"}, "HH:MM"),
        ({"schedule_kind": "hours"}, "hours"),
        ({"schedule_kind": "hours", "interval_hours": 0}, "hours"),
        ({"schedule_kind": "yearly"}, "schedule"),
        (
            {"schedule_kind": "manual", "window_start": "02:00", "window_end": "03:00"},
            "window",
        ),
        (
            {"schedule_kind": "daily", "daily_at": "03:00", "window_start": "02:00"},
            "window",
        ),
        (
            {
                "schedule_kind": "manual",
                "keep_daily": 0,
                "keep_weekly": 0,
                "keep_monthly": 0,
            },
            "keep",
        ),
        ({"schedule_kind": "manual", "keep_daily": -1}, "keep"),
        ({"schedule_kind": "manual", "keep_daily": True}, "keep"),
        ({"schedule_kind": "manual", "compression": "zstd"}, "compression"),
        ({"schedule_kind": "manual", "verify_read_percent": 0}, "percent"),
        ({"schedule_kind": "manual", "name": ""}, "name"),
        ({"schedule_kind": "manual", "unknown": 1}, "unknown"),
    ],
)
def test_validation_refuses_bad_policies(values, message):
    base = {"name": "P", "keep_daily": 1}
    with pytest.raises(PolicyError, match=message):
        policies.validate_policy({**base, **values})


def test_partial_validation_checks_the_merged_policy():
    current = nightly()
    clean = policies.validate_policy({"keep_daily": 5}, current=current)
    assert clean == {"keep_daily": 5}
    # Switching to hours drops the daily time and needs an interval.
    with pytest.raises(PolicyError, match="hours"):
        policies.validate_policy({"schedule_kind": "hours"}, current=current)
    clean = policies.validate_policy(
        {"schedule_kind": "hours", "interval_hours": 6}, current=current
    )
    assert clean == {"schedule_kind": "hours", "interval_hours": 6, "daily_at": None}


def test_tiers_must_be_known():
    assert policies.validate_tiers({"d1": ["weekly", "daily", "daily"]}) == {
        "d1": ["daily", "weekly"]
    }
    with pytest.raises(PolicyError, match="tier"):
        policies.validate_tiers({"d1": ["yearly"]})
    with pytest.raises(PolicyError, match="tier"):
        policies.validate_tiers({"d1": []})


# ── schedule ────────────────────────────────────────────────────────


def test_a_daily_policy_is_due_once_per_day_after_its_time():
    policy = nightly()
    assert not policies.is_due(policy, at("2026-11-10T03:29"))
    assert policies.is_due(policy, at("2026-11-10T03:30"))
    # A worker that was down at 03:30 still runs it later that morning.
    assert policies.is_due(policy, at("2026-11-10T09:00"))
    started = nightly(last_scheduled_at=at("2026-11-10T03:30"))
    assert not policies.is_due(started, at("2026-11-10T23:59"))
    assert policies.is_due(started, at("2026-11-11T03:31"))
    # Missed by more than the grace, it waits for the next day.
    assert not policies.is_due(started, at("2026-11-11T16:00"))


def test_an_hourly_policy_and_a_manual_one():
    hourly = nightly(schedule_kind="hours", daily_at=None, interval_hours=6)
    assert policies.is_due(hourly, at("2026-11-10T10:00"))
    ran = nightly(
        schedule_kind="hours",
        daily_at=None,
        interval_hours=6,
        last_scheduled_at=at("2026-11-10T10:00"),
    )
    assert not policies.is_due(ran, at("2026-11-10T15:59"))
    assert policies.is_due(ran, at("2026-11-10T16:00"))
    manual = nightly(schedule_kind="manual", daily_at=None)
    assert not policies.is_due(manual, at("2026-11-10T03:30"))
    assert not policies.is_due(nightly(enabled=False), at("2026-11-10T03:30"))


def test_next_run():
    assert policies.next_run(nightly(), at("2026-11-10T16:50")) == at(
        "2026-11-11T03:30"
    )
    assert policies.next_run(nightly(), at("2026-11-10T01:00")) == at(
        "2026-11-10T03:30"
    )
    assert (
        policies.next_run(nightly(schedule_kind="manual"), at("2026-11-10T01:00"))
        is None
    )


def test_window():
    windowed = nightly(window_start="02:00", window_end="06:00")
    assert policies.seconds_until_window(windowed, at("2026-11-10T03:30")) == 0
    assert policies.seconds_until_window(windowed, at("2026-11-10T06:00")) == 20 * 3600
    overnight = nightly(window_start="23:00", window_end="05:00")
    assert policies.seconds_until_window(overnight, at("2026-11-10T01:00")) == 0
    assert policies.seconds_until_window(overnight, at("2026-11-10T22:00")) == 3600
    assert policies.seconds_until_window(nightly(), at("2026-11-10T12:00")) == 0


# ── tiers ───────────────────────────────────────────────────────────


def test_due_tiers_follow_the_calendar():
    tuesday = at("2026-11-10T03:30")
    sunday = at("2026-11-15T03:30")
    # A destination with no copies yet gets every tier.
    assert policies.due_tiers(tuesday, {}) == {"daily", "weekly", "monthly"}
    copied = {
        "weekly": at("2026-11-08T03:30"),  # last Sunday
        "monthly": at("2026-11-01T03:30"),
    }
    assert policies.due_tiers(tuesday, copied) == {"daily"}
    assert policies.due_tiers(sunday, copied) == {"daily", "weekly"}
    december = {"weekly": at("2026-11-29T03:30"), "monthly": at("2026-11-01T03:30")}
    assert policies.due_tiers(at("2026-12-01T03:30"), december) == {
        "daily",
        "monthly",
    }
    # A weekly copy that failed on Sunday catches up once a week has passed.
    late = {"weekly": at("2026-11-01T03:30"), "monthly": at("2026-11-01T03:30")}
    assert policies.due_tiers(tuesday, late) == {"daily", "weekly"}


def test_destination_tags_and_forget_arguments():
    assert policies.destination_tags(["weekly", "monthly"], {"daily"}) == []
    assert policies.destination_tags(["daily", "weekly"], {"daily", "weekly"}) == [
        "daily",
        "weekly",
    ]
    policy = nightly(keep_daily=7, keep_weekly=4, keep_monthly=0)
    assert policies.forget_arguments(policy, ["daily", "weekly", "monthly"]) == [
        "--host",
        "crate",
        "--group-by",
        "host",
        "--keep-last",
        "1",
        "--keep-daily",
        "7",
        "--keep-weekly",
        "4",
    ]
    # Only the tiers a destination receives count for its repository.
    assert policies.forget_arguments(policy, ["weekly"])[-2:] == ["--keep-weekly", "4"]


def test_manual_policies_use_their_own_snapshot_host():
    manual = nightly(schedule_kind="manual", daily_at=None, run_before_upgrade=True)
    assert policies.snapshot_host(manual) == "crate-manual"
    assert policies.snapshot_host(nightly()) == "crate"
    assert policies.forget_arguments(manual, ["daily"])[:2] == [
        "--host",
        "crate-manual",
    ]
    # A manual run sends every tier of its destinations.
    assert policies.run_tiers(manual, at("2026-11-10T10:00"), {}) == {
        "daily",
        "weekly",
        "monthly",
    }


# ── lateness ────────────────────────────────────────────────────────


def test_expected_interval_comes_from_the_tiers():
    assert policies.expected_interval(nightly(), ["daily", "weekly"]) == timedelta(
        hours=24
    )
    hourly = nightly(schedule_kind="hours", daily_at=None, interval_hours=6)
    assert policies.expected_interval(hourly, ["daily"]) == timedelta(hours=6)
    assert policies.expected_interval(nightly(), ["weekly", "monthly"]) == timedelta(
        days=7
    )
    assert policies.expected_interval(nightly(), ["monthly"]) == timedelta(days=31)
    manual = nightly(schedule_kind="manual", daily_at=None)
    assert policies.expected_interval(manual, ["daily"]) is None


def test_a_weekly_only_destination_is_late_after_ten_and_a_half_days():
    late_after = policies.late_after(nightly(), ["weekly"])
    assert late_after == timedelta(days=10, hours=12)
    assert policies.is_late(at("2026-11-01T03:30"), at("2026-11-11T15:31"), late_after)
    assert not policies.is_late(
        at("2026-11-01T03:30"), at("2026-11-11T15:29"), late_after
    )
    assert policies.is_late(None, at("2026-11-11T15:29"), late_after)
    assert not policies.is_late(None, at("2026-11-11T15:29"), None)


# ── verify and drill cadence ────────────────────────────────────────


def test_verify_is_due_per_destination():
    policy = nightly(verify_every_days=7)
    now = at("2026-11-10T04:00")
    assert policies.verify_due(policy, None, now)
    assert not policies.verify_due(policy, at("2026-11-05T04:00"), now)
    assert policies.verify_due(policy, at("2026-11-03T03:59"), now)
    assert not policies.verify_due(nightly(verify_every_days=0), None, now)


def test_the_drill_rotates_through_the_destinations():
    policy = nightly(drill_every_days=30)
    now = at("2026-11-10T04:00")
    last = {"r2": at("2026-10-29T04:05"), "gdrive": at("2026-10-01T04:00")}
    # The last drill of the policy, whichever destination, sets the cadence.
    assert policies.drill_source(policy, ["local", "r2", "gdrive"], last, now) is None
    later = at("2026-11-29T04:06")
    # The destination never drilled goes first, then the oldest.
    assert (
        policies.drill_source(policy, ["local", "r2", "gdrive"], last, later) == "local"
    )
    assert policies.drill_source(policy, ["r2", "gdrive"], last, later) == "gdrive"
    fixed = nightly(drill_every_days=30, drill_destination_id="r2")
    assert policies.drill_source(fixed, ["local", "r2"], last, later) == "r2"
    # A fixed source that is not usable falls back to the rotation.
    assert policies.drill_source(fixed, ["local"], last, later) == "local"
    assert policies.drill_source(nightly(drill_every_days=0), ["r2"], {}, later) is None
    assert policies.drill_source(policy, [], {}, later) is None

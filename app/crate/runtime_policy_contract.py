"""Pure contracts for bounded runtime and schedule configuration."""

from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictInt,
    field_validator,
    model_validator,
)

POOLS = ("fast", "default", "heavy", "maintenance", "playback")
ADOPTION_COMPONENTS = (
    "scheduler",
    "governor",
    "maintenance_window",
    "download_window",
) + tuple(f"pool:{pool}" for pool in POOLS)
SCHEDULE_MAX_INTERVAL = 31 * 86400


class PolicyRevisionConflict(ValueError):
    """Configuration changed after the caller observed its revision."""


class _ClosedModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class _Pools(_ClosedModel):
    fast: StrictInt = Field(ge=1, le=64)
    default: StrictInt = Field(ge=1, le=64)
    heavy: StrictInt = Field(ge=1, le=64)
    maintenance: StrictInt = Field(ge=1, le=64)
    playback: StrictInt = Field(ge=1, le=64)


class _Window(_ClosedModel):
    enabled: StrictBool
    start: str
    end: str
    timezone: str

    @field_validator("start", "end")
    @classmethod
    def valid_time(cls, value):
        import re

        if not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value):
            raise ValueError("Window times must use HH:MM")
        return value

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value):
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("A valid IANA timezone is required") from None
        return value


class _Governor(_ClosedModel):
    enabled: StrictBool
    max_load_ratio: float = Field(ge=0.05, le=8)
    max_iowait_percent: float = Field(ge=0, le=100)
    max_swap_percent: float = Field(ge=0, le=100)
    min_swap_used_mb: float = Field(ge=0, le=1048576)
    min_memory_available_percent: float = Field(ge=0, le=100)
    max_active_users: StrictInt = Field(ge=0, le=10000)
    max_active_streams: StrictInt = Field(ge=0, le=10000)
    defer_seconds: StrictInt = Field(ge=1, le=86400)
    fingerprint_window_limit: StrictInt = Field(ge=1, le=10000)


class _Downloads(_ClosedModel):
    max_active_users: StrictInt = Field(ge=0, le=10000)
    max_active_streams: StrictInt = Field(ge=0, le=10000)


class _RuntimePolicy(_ClosedModel):
    max_running: StrictInt = Field(ge=1, le=64)
    pools: _Pools
    governor: _Governor
    maintenance_window: _Window
    download_window: _Window
    downloads: _Downloads

    @model_validator(mode="after")
    def coherent_slots(self):
        if any(value > self.max_running for value in self.pools.model_dump().values()):
            raise ValueError("Pool slots cannot exceed max_running")
        return self


def policy_hash(value: dict) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode()
    ).hexdigest()


def validate_runtime_policy(policy: dict) -> dict:
    return _RuntimePolicy.model_validate(policy).model_dump()


def merge_runtime_policy(policy: dict, patch: dict) -> dict:
    if not isinstance(patch, dict) or not patch:
        raise ValueError("A nonempty runtime policy patch is required")

    def merge(before, changes):
        result = dict(before)
        for key, value in changes.items():
            if key not in before:
                raise ValueError("Unknown runtime policy field")
            if isinstance(before[key], dict):
                if not isinstance(value, dict) or not value:
                    raise ValueError("Nested runtime changes must be nonempty objects")
                result[key] = merge(before[key], value)
            else:
                result[key] = value
        return result

    return validate_runtime_policy(merge(policy, patch))


def default_runtime_policy(settings: dict | None = None) -> dict:
    """Materialize existing env/download settings without persisting defaults."""
    settings = settings or {}

    def number(
        name, default, *, integer=False, minimum: float = 0, maximum: float = 10000
    ):
        try:
            raw = os.environ.get(name, str(default))
            value = int(raw) if integer else float(raw)
            bounded = max(minimum, min(maximum, value))
            return int(bounded) if integer else float(bounded)
        except (ValueError, TypeError):
            return default

    def enabled(name, default):
        return str(os.environ.get(name, default)).strip().lower() in {
            "1",
            "true",
            "yes",
            "on",
        }

    def download_limit(key):
        try:
            return max(0, min(10000, int(settings.get(key, "0"))))
        except (ValueError, TypeError):
            return 0

    maintenance = {
        "enabled": enabled("CRATE_MAINTENANCE_WINDOW_ENABLED", "false"),
        "start": os.environ.get("CRATE_MAINTENANCE_WINDOW_START", "02:00"),
        "end": os.environ.get("CRATE_MAINTENANCE_WINDOW_END", "07:00"),
        "timezone": os.environ.get("TZ", "UTC"),
    }
    download = {
        "enabled": settings.get("download_window_enabled", "false") == "true",
        "start": settings.get("download_window_start", "02:00"),
        "end": settings.get("download_window_end", "07:00"),
        "timezone": settings.get("download_window_timezone", "UTC"),
    }
    # Legacy invalid values never silently open an enabled maintenance window.
    for window in (maintenance, download):
        try:
            _Window.model_validate(window)
        except ValueError:
            window.update(start="02:00", end="07:00", timezone="UTC")
    return validate_runtime_policy(
        {
            "max_running": 64,
            "pools": dict.fromkeys(POOLS, 64),
            "maintenance_window": maintenance,
            "download_window": download,
            "downloads": {
                "max_active_users": download_limit("download_max_active_users"),
                "max_active_streams": download_limit("download_max_active_streams"),
            },
            "governor": {
                "enabled": enabled("CRATE_RESOURCE_GOVERNOR_ENABLED", "true"),
                "max_load_ratio": number(
                    "CRATE_RESOURCE_MAX_LOAD_RATIO", 0.85, minimum=0.05, maximum=8
                ),
                "max_iowait_percent": number(
                    "CRATE_RESOURCE_MAX_IOWAIT_PERCENT", 25.0, maximum=100
                ),
                "max_swap_percent": number(
                    "CRATE_RESOURCE_MAX_SWAP_PERCENT", 30.0, maximum=100
                ),
                "min_swap_used_mb": number(
                    "CRATE_RESOURCE_MIN_SWAP_USED_MB", 512.0, maximum=1048576
                ),
                "min_memory_available_percent": number(
                    "CRATE_RESOURCE_MIN_MEMORY_AVAILABLE_PERCENT", 15.0, maximum=100
                ),
                "max_active_users": number(
                    "CRATE_RESOURCE_MAX_ACTIVE_USERS", 10, integer=True
                ),
                "max_active_streams": number(
                    "CRATE_RESOURCE_MAX_ACTIVE_STREAMS", 10, integer=True
                ),
                "defer_seconds": number(
                    "CRATE_RESOURCE_DEFER_SECONDS",
                    300,
                    integer=True,
                    minimum=1,
                    maximum=86400,
                ),
                "fingerprint_window_limit": number(
                    "CRATE_MAINTENANCE_WINDOW_FINGERPRINT_LIMIT",
                    1000,
                    integer=True,
                    minimum=1,
                ),
            },
        }
    )


def window_status(window: dict, *, now: datetime | None = None) -> dict:
    value = _Window.model_validate(window)
    instant = now or datetime.now(timezone.utc)
    if instant.tzinfo is None:
        raise ValueError("Window evaluation requires an aware instant")
    local = instant.astimezone(ZoneInfo(value.timezone))
    minute = local.hour * 60 + local.minute
    start = int(value.start[:2]) * 60 + int(value.start[3:])
    end = int(value.end[:2]) * 60 + int(value.end[3:])
    inside = (
        not value.enabled
        or start == end
        or (start <= minute < end if start < end else minute >= start or minute < end)
    )
    delay = 0
    if not inside:
        # Advance instants rather than replacing a local clock across DST gaps/folds.
        cursor = instant.astimezone(timezone.utc).replace(second=0, microsecond=0)
        for offset in range(1, 26 * 60 + 1):
            candidate = cursor + timedelta(minutes=offset)
            clock = candidate.astimezone(ZoneInfo(value.timezone))
            current = clock.hour * 60 + clock.minute
            if (
                start <= current < end
                if start < end
                else current >= start or current < end
            ):
                delay = max(1, int((candidate - instant).total_seconds()))
                break
    return {
        **value.model_dump(),
        "now": local.strftime("%H:%M"),
        "in_window": inside,
        "seconds_until_start": delay,
    }


def download_policy_status(
    policy: dict,
    *,
    active_users: int | None,
    active_streams: int | None,
    now: datetime | None = None,
) -> dict:
    window = window_status(policy["download_window"], now=now)
    users, streams = (
        policy["downloads"]["max_active_users"],
        policy["downloads"]["max_active_streams"],
    )
    return {
        "downloads_allowed_now": window["in_window"]
        and (users == 0 or active_users is not None and active_users < users)
        and (streams == 0 or active_streams is not None and active_streams < streams),
        "signals_available": (users == 0 or active_users is not None)
        and (streams == 0 or active_streams is not None),
        "active_users": active_users,
        "active_streams": active_streams,
        "time_window": window,
        "user_limit": {"enabled": users > 0, "max": users},
        "stream_limit": {"enabled": streams > 0, "max": streams},
    }


__all__ = [
    "ADOPTION_COMPONENTS",
    "POOLS",
    "SCHEDULE_MAX_INTERVAL",
    "policy_hash",
    "validate_runtime_policy",
    "merge_runtime_policy",
    "default_runtime_policy",
    "window_status",
    "download_policy_status",
    "PolicyRevisionConflict",
]

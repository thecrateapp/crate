"""Dev-only memory fallback helpers for native authentication handoffs."""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone


def local_memory_allowed() -> bool:
    environment = os.environ.get("CRATE_ENV", "").strip().lower()
    return environment in {"dev", "development", "test"}


def purge_expired_memory_records(
    records: dict[str, str], *, monotonic_now: float | None = None
) -> None:
    now = datetime.now(timezone.utc)
    now_monotonic = time.monotonic() if monotonic_now is None else monotonic_now
    expired_keys: list[str] = []

    for key, raw in records.items():
        if key.endswith(":pending"):
            try:
                lease_expires_at = float(raw)
            except ValueError:
                expires_at = _record_expiry(raw)
            else:
                if lease_expires_at <= now_monotonic:
                    expired_keys.append(key)
                continue
        else:
            expires_at = _record_expiry(raw)

        if expires_at is None or expires_at <= now:
            expired_keys.append(key)

    for key in expired_keys:
        records.pop(key, None)


def _record_expiry(raw: str) -> datetime | None:
    try:
        payload = json.loads(raw)
        expires_at = datetime.fromisoformat(
            str(payload["expires_at"]).replace("Z", "+00:00")
        )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        return None
    if expires_at.tzinfo is None:
        return expires_at.replace(tzinfo=timezone.utc)
    return expires_at

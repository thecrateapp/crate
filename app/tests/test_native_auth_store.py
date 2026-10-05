from datetime import datetime, timedelta, timezone
import json
import time


def test_memory_fallback_requires_explicit_nonproduction_environment(monkeypatch):
    from crate.api.native_auth_store import local_memory_allowed

    monkeypatch.delenv("CRATE_ENV", raising=False)
    monkeypatch.delenv("DOMAIN", raising=False)
    assert local_memory_allowed() is False

    monkeypatch.setenv("DOMAIN", "localhost")
    assert local_memory_allowed() is False

    for environment in ("dev", "development", "test"):
        monkeypatch.setenv("CRATE_ENV", environment)
        assert local_memory_allowed() is True

    monkeypatch.setenv("CRATE_ENV", "production")
    monkeypatch.setenv("DOMAIN", "localhost")
    assert local_memory_allowed() is False


def test_purge_expired_memory_records_removes_expired_and_invalid_values():
    from crate.api.native_auth_store import purge_expired_memory_records

    now = datetime.now(timezone.utc)
    records = {
        "handoff:expired": json.dumps(
            {"expires_at": (now - timedelta(seconds=1)).isoformat()}
        ),
        "handoff:active": json.dumps(
            {"expires_at": (now + timedelta(minutes=1)).isoformat()}
        ),
        "handoff:pending": str(time.monotonic() - 1),
        "handoff:active:pending": str(time.monotonic() + 60),
        "handoff:corrupt": "not-json",
    }

    purge_expired_memory_records(records)

    assert set(records) == {"handoff:active", "handoff:active:pending"}

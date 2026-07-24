from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace


def test_days_until_full_projects_positive_growth_only():
    from crate.storage_health import estimate_days_until_full

    now = datetime.now(timezone.utc)
    history = [
        {
            "timestamp": (now - timedelta(days=1)).isoformat(),
            "avg": 100.0,
        }
    ]

    assert (
        estimate_days_until_full(
            history, current_used_bytes=200, free_bytes=300, now=now
        )
        == 3.0
    )
    assert (
        estimate_days_until_full(
            history, current_used_bytes=90, free_bytes=300, now=now
        )
        is None
    )


def test_storage_snapshot_tracks_data_cache_and_music_separately(monkeypatch, tmp_path):
    import shutil

    from crate import metrics
    from crate.storage_health import collect_storage_health

    data = tmp_path / "data"
    cache = tmp_path / "cache"
    data.mkdir()
    cache.mkdir()
    monkeypatch.setenv("DATA_DIR", str(data))
    monkeypatch.setenv("CACHE_DIR", str(cache))

    def disk_usage(path):
        if str(path) == str(data):
            return SimpleNamespace(total=100, used=86, free=14)
        if str(path) == str(cache):
            return SimpleNamespace(total=100, used=91, free=9)
        return SimpleNamespace(total=100, used=70, free=30)

    recorded = []
    monkeypatch.setattr(shutil, "disk_usage", disk_usage)
    monkeypatch.setattr(metrics, "query_recent", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(
        metrics,
        "record",
        lambda name, value, tags=None: recorded.append((name, value, tags)),
    )

    snapshot = collect_storage_health()

    assert snapshot["data"]["percent"] == 86.0
    assert snapshot["cache"]["percent"] == 91.0
    assert snapshot["music"]["percent"] == 70.0
    assert snapshot["cache"]["pressure"] == "emergency"
    assert {name for name, _, _ in recorded} == {
        "storage.data.used_bytes",
        "storage.cache.used_bytes",
        "storage.music.used_bytes",
    }


def test_alerting_uses_worst_storage_pressure_instead_of_only_music(monkeypatch):
    from crate import alerting

    monkeypatch.setattr(
        "crate.metrics.query_summary",
        lambda *_args, **_kwargs: {"count": 0, "max": 0},
    )
    monkeypatch.setattr(
        "crate.storage_health.collect_storage_health",
        lambda: {
            "music": {
                "percent": 70.0,
                "free_gb": 30.0,
                "pressure": "healthy",
                "days_until_full": None,
            },
            "data": {
                "percent": 86.0,
                "free_gb": 14.0,
                "pressure": "critical",
                "days_until_full": 7.0,
            },
            "cache": {
                "percent": 91.0,
                "free_gb": 9.0,
                "pressure": "emergency",
                "days_until_full": 2.0,
            },
        },
    )
    monkeypatch.setattr(alerting, "_get_threshold", lambda _key, default: default)

    status = alerting.evaluate_health()

    assert status.metrics["disk_usage_pct"] == 91.0
    assert status.metrics["disk_free_gb"] == 9.0
    assert status.metrics["disk_days_until_full"] == 2.0
    assert {breach.name for breach in status.breaches} >= {
        "Data disk critical",
        "Cache disk emergency",
    }


def test_alerting_reports_shared_filesystem_only_once(monkeypatch):
    from crate import alerting

    monkeypatch.setattr(
        "crate.metrics.query_summary",
        lambda *_args, **_kwargs: {"count": 0, "max": 0},
    )
    monkeypatch.setattr(
        "crate.storage_health.collect_storage_health",
        lambda: {
            "music": {
                "path": "/music",
                "filesystem_id": 42,
                "percent": 91.0,
                "free_gb": 9.0,
                "days_until_full": 2.0,
            },
            "cache": {
                "path": "/cache",
                "filesystem_id": 42,
                "percent": 91.0,
                "free_gb": 9.0,
                "days_until_full": 2.0,
            },
        },
    )
    monkeypatch.setattr(alerting, "_get_threshold", lambda _key, default: default)

    status = alerting.evaluate_health()

    disk_breaches = [
        breach for breach in status.breaches if "disk emergency" in breach.name
    ]
    assert len(disk_breaches) == 1

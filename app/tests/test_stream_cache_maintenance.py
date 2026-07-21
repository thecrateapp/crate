from __future__ import annotations

import os
import time
from contextlib import contextmanager


def _variant(root, relative: str, content: bytes, *, accessed_at: float):
    path = root / relative.removeprefix("stream-cache/")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    os.utime(path, (accessed_at, accessed_at))
    return path


def test_stream_cache_policy_reads_and_bounds_environment(monkeypatch):
    from crate.streaming.maintenance import StreamCachePolicy

    monkeypatch.setenv("CRATE_STREAM_CACHE_MAX_BYTES", "100")
    monkeypatch.setenv("CRATE_STREAM_CACHE_LOW_WATERMARK_BYTES", "200")
    monkeypatch.setenv("CRATE_STREAM_CACHE_MAX_IDLE_SECONDS", "invalid")
    monkeypatch.setenv("CRATE_STREAM_CACHE_ORPHAN_GRACE_SECONDS", "1")
    monkeypatch.setenv("CRATE_STREAM_CACHE_CLEANUP_MAX_FILES", "999999")

    policy = StreamCachePolicy.from_env()

    assert policy.max_bytes == 100
    assert policy.low_watermark_bytes == 100
    assert policy.max_idle_seconds == 30 * 86400
    assert policy.orphan_grace_seconds == 60
    assert policy.max_files == 500_000


def test_cleanup_reconciles_missing_rows_and_evicts_only_cold_orphans(
    monkeypatch, tmp_path
):
    from crate.streaming.maintenance import StreamCachePolicy, cleanup_stream_variants

    now = time.time()
    cache = tmp_path / "stream-cache"
    monkeypatch.setenv("CACHE_DIR", str(tmp_path))
    cold = _variant(
        cache,
        "stream-cache/balanced/aa/cold.opus",
        b"cold",
        accessed_at=now - 40 * 86400,
    )
    hot = _variant(
        cache,
        "stream-cache/balanced/bb/hot.opus",
        b"hot",
        accessed_at=now - 3600,
    )
    old_orphan = _variant(
        cache,
        "stream-cache/balanced/cc/orphan.opus",
        b"orphan",
        accessed_at=now - 7200,
    )
    fresh_orphan = _variant(
        cache,
        "stream-cache/balanced/dd/fresh.opus",
        b"fresh",
        accessed_at=now - 60,
    )
    rows = [
        {
            "cache_key": "cold",
            "status": "ready",
            "relative_path": "stream-cache/balanced/aa/cold.opus",
        },
        {
            "cache_key": "hot",
            "status": "ready",
            "relative_path": "stream-cache/balanced/bb/hot.opus",
        },
        {
            "cache_key": "missing",
            "status": "ready",
            "relative_path": "stream-cache/balanced/ee/missing.opus",
        },
    ]
    marked = []

    monkeypatch.setattr(
        "crate.streaming.maintenance.list_stream_variants_for_cleanup",
        lambda *, limit: rows,
    )

    def mark_missing(cache_keys):
        assert cold.exists()
        marked.extend(cache_keys)
        return len(cache_keys)

    monkeypatch.setattr(
        "crate.streaming.maintenance.mark_stream_variants_missing", mark_missing
    )

    result = cleanup_stream_variants(
        now=now,
        policy=StreamCachePolicy(
            max_bytes=1024,
            low_watermark_bytes=900,
            max_idle_seconds=30 * 86400,
            orphan_grace_seconds=3600,
            max_files=100,
        ),
    )

    assert marked == ["cold", "missing"]
    assert cold.exists() is False
    assert old_orphan.exists() is False
    assert hot.exists() is True
    assert fresh_orphan.exists() is True
    assert result["idle_files_removed"] == 1
    assert result["orphan_files_removed"] == 1
    assert result["missing_rows_reconciled"] == 1


def test_cleanup_uses_lru_until_low_watermark(monkeypatch, tmp_path):
    from crate.streaming.maintenance import StreamCachePolicy, cleanup_stream_variants

    now = time.time()
    cache = tmp_path / "stream-cache"
    monkeypatch.setenv("CACHE_DIR", str(tmp_path))
    rows = []
    paths = []
    for index, age in enumerate((300, 200, 100)):
        relative = f"stream-cache/balanced/aa/{index}.opus"
        paths.append(_variant(cache, relative, b"123456", accessed_at=now - age))
        rows.append(
            {
                "cache_key": str(index),
                "status": "ready",
                "relative_path": relative,
            }
        )
    marked = []
    monkeypatch.setattr(
        "crate.streaming.maintenance.list_stream_variants_for_cleanup",
        lambda *, limit: rows,
    )
    monkeypatch.setattr(
        "crate.streaming.maintenance.mark_stream_variants_missing",
        lambda keys: marked.extend(keys) or len(keys),
    )

    result = cleanup_stream_variants(
        now=now,
        policy=StreamCachePolicy(
            max_bytes=15,
            low_watermark_bytes=10,
            max_idle_seconds=86400,
            orphan_grace_seconds=3600,
            max_files=100,
        ),
    )

    assert marked == ["0", "1"]
    assert [path.exists() for path in paths] == [False, False, True]
    assert result["quota_files_removed"] == 2
    assert result["bytes_after"] == 6


def test_cleanup_records_bounded_low_cardinality_metrics(monkeypatch, tmp_path):
    from crate import metrics
    from crate.streaming.maintenance import StreamCachePolicy, cleanup_stream_variants

    monkeypatch.setenv("CACHE_DIR", str(tmp_path))
    monkeypatch.setattr(
        "crate.streaming.maintenance.list_stream_variants_for_cleanup",
        lambda *, limit: [],
    )
    monkeypatch.setattr(
        "crate.streaming.maintenance.mark_stream_variants_missing",
        lambda keys: 0,
    )
    recorded = []
    monkeypatch.setattr(
        metrics,
        "record",
        lambda name, value, tags=None: recorded.append((name, value, tags)),
    )

    cleanup_stream_variants(
        policy=StreamCachePolicy(
            max_bytes=100,
            low_watermark_bytes=80,
            max_idle_seconds=86400,
            orphan_grace_seconds=3600,
            max_files=100,
        )
    )

    assert recorded == [
        ("stream.cache.bytes", 0.0, None),
        ("stream.cache.files", 0.0, None),
        ("stream.cache.bytes_removed", 0.0, None),
        ("stream.cache.files_removed", 0.0, None),
        ("stream.cache.orphan_files", 0.0, None),
    ]


def test_stream_cache_cleanup_is_scheduled_on_maintenance_queue():
    from crate.api.admin_metrics import _SUMMARY_METRICS
    from crate.actors import TASK_POOL_CONFIG
    from crate.scheduler import DEFAULT_SCHEDULES
    from crate.worker_handlers.playback import PLAYBACK_TASK_HANDLERS

    assert DEFAULT_SCHEDULES["cleanup_stream_variants"] == 3600
    assert TASK_POOL_CONFIG["cleanup_stream_variants"].queue == "maintenance"
    assert "cleanup_stream_variants" in PLAYBACK_TASK_HANDLERS
    assert _SUMMARY_METRICS["stream_cache_bytes"] == ("stream.cache.bytes", 120)
    assert _SUMMARY_METRICS["stream_cache_bytes_removed"] == (
        "stream.cache.bytes_removed",
        120,
    )


def test_streaming_repository_lists_bounded_ready_variants(monkeypatch):
    from crate.db.repositories import streaming

    executed = []

    class Result:
        def mappings(self):
            return self

        def all(self):
            return [{"cache_key": "abc", "relative_path": "stream-cache/a.opus"}]

    class Session:
        def execute(self, statement, params):
            executed.append((str(statement), params))
            return Result()

    @contextmanager
    def scope():
        yield Session()

    monkeypatch.setattr(streaming, "read_scope", scope)

    rows = streaming.list_stream_variants_for_cleanup(limit=999_999)

    assert rows == [{"cache_key": "abc", "relative_path": "stream-cache/a.opus"}]
    assert "status = 'ready'" in executed[0][0]
    assert executed[0][1] == {"limit": 500_000}


def test_streaming_repository_marks_variants_missing_in_one_batch(monkeypatch):
    from crate.db.repositories import streaming

    executed = []

    class Session:
        def execute(self, statement, params):
            executed.append((str(statement), params))
            return type("Result", (), {"rowcount": 2})()

    @contextmanager
    def scope():
        yield Session()

    monkeypatch.setattr(streaming, "transaction_scope", scope)

    updated = streaming.mark_stream_variants_missing(["a", "a", "b", ""])

    assert updated == 2
    assert executed[0][1] == {"cache_keys": ["a", "b"]}
    assert "status = 'pending'" in executed[0][0]

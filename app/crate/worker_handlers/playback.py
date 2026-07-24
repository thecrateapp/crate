from __future__ import annotations

import logging
import os
import shutil
import time

from crate.db.cache_runtime import get_redis
from crate.db.cache_settings import get_setting
from crate.db.events import emit_task_event
from crate.db.repositories.streaming import (
    list_recent_local_delivery_tracks,
    mark_variant_running,
)
from crate.streaming.service import prepare_playback
from crate.streaming.maintenance import cleanup_stream_variants
from crate.streaming.transcode import transcode_variant
from crate.task_progress import TaskProgress, emit_progress
from crate.worker_handlers import TaskHandler, is_cancelled

log = logging.getLogger(__name__)

_TRANSCODE_SLOT_KEY = "crate:stream_transcode_slots"
_TRANSCODE_SLOT_TTL_SECONDS = 1200
_TRANSCODE_SLOT_WAIT_SECONDS = 600
_WARMUP_DEFAULT_LIMIT = 25
_WARMUP_MAX_LIMIT = 100
_WARMUP_DEFAULT_MAX_SOURCE_BYTES = 1024 * 1024 * 1024
_WARMUP_MAX_SOURCE_BYTES = 5 * 1024 * 1024 * 1024
_WARMUP_DEFAULT_MAX_SECONDS = 60
_WARMUP_MAX_SECONDS = 600


def _max_concurrent_transcodes(config: dict) -> int:
    raw = config.get("stream_transcode_max_concurrent", 1)
    raw = os.environ.get("CRATE_STREAM_TRANSCODE_MAX_CONCURRENT", raw)
    try:
        raw = get_setting("stream_transcode_max_concurrent", str(raw))
    except Exception:
        pass
    try:
        return max(1, min(int(raw or 1), 4))
    except (TypeError, ValueError):
        return 1


def _playback_warmup_enabled() -> bool:
    return os.environ.get("CRATE_PLAYBACK_WARMUP_ENABLED", "false").lower() == "true"


def _has_warmup_disk_headroom() -> bool:
    raw_minimum_gb = os.environ.get("CRATE_PLAYBACK_WARMUP_MIN_FREE_GB", "20")
    try:
        minimum_bytes = max(0, float(raw_minimum_gb)) * 1024**3
    except ValueError:
        minimum_bytes = 20 * 1024**3
    try:
        return shutil.disk_usage("/music").free >= minimum_bytes
    except OSError:
        log.warning("Unable to inspect free disk before playback warmup")
        return False


def _bounded_int(
    params: dict, key: str, default: int, maximum: int, *, minimum: int = 1
) -> int:
    try:
        value = int(params.get(key, default))
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(value, maximum))


def prune_stream_transcode_slots() -> None:
    redis = get_redis()
    if redis is None:
        return
    try:
        redis.zremrangebyscore(
            _TRANSCODE_SLOT_KEY, 0, time.time() - _TRANSCODE_SLOT_TTL_SECONDS
        )
    except Exception:
        log.debug("Failed to prune stream transcode slots", exc_info=True)


def get_stream_transcode_runtime(config: dict | None = None) -> dict:
    redis = get_redis()
    active = 0
    slots: list[dict] = []
    now = time.time()
    if redis is not None:
        try:
            redis.zremrangebyscore(
                _TRANSCODE_SLOT_KEY, 0, now - _TRANSCODE_SLOT_TTL_SECONDS
            )
            active = int(redis.zcard(_TRANSCODE_SLOT_KEY) or 0)
            slots = [
                {
                    "task_id": task_id.decode("utf-8", "replace")
                    if isinstance(task_id, bytes)
                    else str(task_id),
                    "started_at": float(started_at),
                }
                for task_id, started_at in redis.zrange(
                    _TRANSCODE_SLOT_KEY, 0, -1, withscores=True
                )
            ]
        except Exception:
            log.debug("Failed to read stream transcode runtime", exc_info=True)
    return {
        "limit": _max_concurrent_transcodes(config or {}),
        "active": active,
        "slots": slots,
    }


def _acquire_slot(task_id: str, limit: int) -> bool:
    redis = get_redis()
    if redis is None:
        return True

    acquire_script = """
    local key = KEYS[1]
    local task_id = ARGV[1]
    local now = tonumber(ARGV[2])
    local ttl = tonumber(ARGV[3])
    local limit = tonumber(ARGV[4])
    redis.call('ZREMRANGEBYSCORE', key, 0, now - ttl)
    if redis.call('ZSCORE', key, task_id) then
        redis.call('ZADD', key, now, task_id)
        redis.call('EXPIRE', key, ttl)
        return 1
    end
    if redis.call('ZCARD', key) < limit then
        redis.call('ZADD', key, now, task_id)
        redis.call('EXPIRE', key, ttl)
        return 1
    end
    return 0
    """
    deadline = time.time() + _TRANSCODE_SLOT_WAIT_SECONDS
    while time.time() < deadline:
        now = time.time()
        try:
            acquired = redis.eval(
                acquire_script,
                1,
                _TRANSCODE_SLOT_KEY,
                task_id,
                str(now),
                str(_TRANSCODE_SLOT_TTL_SECONDS),
                str(limit),
            )
            if int(acquired or 0) == 1:
                return True
        except Exception:
            log.debug("Failed to acquire stream transcode slot", exc_info=True)
            return True
        time.sleep(2)
    return False


def _release_slot(task_id: str) -> None:
    redis = get_redis()
    if redis is None:
        return
    try:
        redis.zrem(_TRANSCODE_SLOT_KEY, task_id)
    except Exception:
        log.debug("Failed to release stream transcode slot", exc_info=True)


def _handle_prepare_stream_variant(task_id: str, params: dict, config: dict) -> dict:
    cache_key = str(params.get("cache_key") or "").strip()
    if not cache_key:
        raise ValueError("cache_key is required")

    progress = TaskProgress(phase="waiting", total=1, done=0, item=cache_key[:12])
    emit_progress(task_id, progress)
    emit_task_event(
        task_id,
        "info",
        {"message": "Preparing playback variant", "cache_key": cache_key},
    )

    limit = _max_concurrent_transcodes(config)
    if not _acquire_slot(task_id, limit):
        raise RuntimeError("Timed out waiting for stream transcode slot")

    try:
        progress.phase = "transcoding"
        emit_progress(task_id, progress)
        mark_variant_running(cache_key, task_id)
        transcode_started = time.monotonic()
        try:
            row = transcode_variant(cache_key)
            elapsed = time.monotonic() - transcode_started
            try:
                from crate.metrics import record

                preset = str(row.get("preset") or params.get("preset") or "unknown")
                record(
                    "stream.transcode.duration",
                    elapsed,
                    {"preset": preset, "status": "completed"},
                )
                record("stream.transcode.completed", 1, {"preset": preset})
                if row.get("bytes"):
                    record(
                        "stream.transcode.bytes",
                        float(row["bytes"]),
                        {"preset": preset},
                    )
            except Exception:
                pass
        except Exception:
            elapsed = time.monotonic() - transcode_started
            try:
                from crate.metrics import record

                record(
                    "stream.transcode.duration",
                    elapsed,
                    {"preset": "unknown", "status": "failed"},
                )
                record("stream.transcode.failed", 1, {"preset": "unknown"})
            except Exception:
                pass
            raise
        progress.phase = "complete"
        progress.done = 1
        emit_progress(task_id, progress)
        return {
            "cache_key": cache_key,
            "variant_id": row.get("id"),
            "bytes": row.get("bytes"),
            "relative_path": row.get("relative_path"),
        }
    finally:
        _release_slot(task_id)


def _handle_warmup_stream_variants(task_id: str, params: dict, config: dict) -> dict:
    """Queue a small, explicitly enabled set of local playback variants."""
    if not _playback_warmup_enabled():
        return {"status": "disabled", "enqueued": 0, "skipped": 0}
    if not _has_warmup_disk_headroom():
        return {"status": "insufficient_disk", "enqueued": 0, "skipped": 0}

    limit = _bounded_int(params, "limit", _WARMUP_DEFAULT_LIMIT, _WARMUP_MAX_LIMIT)
    max_source_bytes = _bounded_int(
        params,
        "max_source_bytes",
        _WARMUP_DEFAULT_MAX_SOURCE_BYTES,
        _WARMUP_MAX_SOURCE_BYTES,
    )
    max_seconds = _bounded_int(
        params,
        "max_seconds",
        _WARMUP_DEFAULT_MAX_SECONDS,
        _WARMUP_MAX_SECONDS,
    )
    include_data_saver = bool(params.get("include_data_saver", False))
    started_at = time.monotonic()
    consumed_source_bytes = 0
    enqueued = 0
    skipped = 0

    def warm(policy: str) -> None:
        nonlocal consumed_source_bytes, enqueued, skipped
        for track in list_recent_local_delivery_tracks(limit):
            if is_cancelled(task_id) or time.monotonic() - started_at >= max_seconds:
                return
            try:
                source_size = max(0, int(track.get("size") or 0))
            except (TypeError, ValueError):
                source_size = 0
            if consumed_source_bytes + source_size > max_source_bytes:
                skipped += 1
                continue
            resolution = prepare_playback(track, policy, reason="lookahead")
            if resolution is None or not resolution.preparing:
                skipped += 1
                continue
            consumed_source_bytes += source_size
            enqueued += 1

    warm("balanced")
    if include_data_saver and not is_cancelled(task_id):
        warm("data_saver")

    status = "cancelled" if is_cancelled(task_id) else "completed"
    return {"status": status, "enqueued": enqueued, "skipped": skipped}


def _handle_cleanup_stream_variants(task_id: str, params: dict, config: dict) -> dict:
    del task_id, params, config
    return cleanup_stream_variants()


PLAYBACK_TASK_HANDLERS: dict[str, TaskHandler] = {
    "prepare_stream_variant": _handle_prepare_stream_variant,
    "warmup_stream_variants": _handle_warmup_stream_variants,
    "cleanup_stream_variants": _handle_cleanup_stream_variants,
}

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from pathlib import Path

from crate.db.repositories.streaming import (
    list_stream_variants_for_cleanup,
    mark_stream_variants_missing,
)
from crate.streaming.paths import stream_cache_root

log = logging.getLogger(__name__)

_GIB = 1024**3


@dataclass(frozen=True)
class StreamCachePolicy:
    max_bytes: int = 12 * _GIB
    low_watermark_bytes: int = 10 * _GIB
    max_idle_seconds: int = 30 * 86400
    orphan_grace_seconds: int = 3600
    max_files: int = 100_000

    @classmethod
    def from_env(cls) -> StreamCachePolicy:
        max_bytes = _env_int("CRATE_STREAM_CACHE_MAX_BYTES", 12 * _GIB, minimum=0)
        low_bytes = _env_int(
            "CRATE_STREAM_CACHE_LOW_WATERMARK_BYTES", 10 * _GIB, minimum=0
        )
        return cls(
            max_bytes=max_bytes,
            low_watermark_bytes=min(low_bytes, max_bytes),
            max_idle_seconds=_env_int(
                "CRATE_STREAM_CACHE_MAX_IDLE_SECONDS", 30 * 86400, minimum=0
            ),
            orphan_grace_seconds=_env_int(
                "CRATE_STREAM_CACHE_ORPHAN_GRACE_SECONDS", 3600, minimum=60
            ),
            max_files=_env_int(
                "CRATE_STREAM_CACHE_CLEANUP_MAX_FILES",
                100_000,
                minimum=100,
                maximum=500_000,
            ),
        )


@dataclass(frozen=True)
class _CacheFile:
    path: Path
    relative_path: str
    size: int
    accessed_at: float
    modified_at: float


def _env_int(
    name: str,
    default: int,
    *,
    minimum: int,
    maximum: int | None = None,
) -> int:
    try:
        value = int(os.environ.get(name, default))
    except (TypeError, ValueError):
        value = default
    value = max(minimum, value)
    return min(value, maximum) if maximum is not None else value


def _cache_files(root: Path, limit: int) -> tuple[list[_CacheFile], bool]:
    if not root.is_dir():
        return [], False
    files: list[_CacheFile] = []
    truncated = False
    for path in root.rglob("*"):
        if path.is_symlink() or not path.is_file():
            continue
        if len(files) >= limit:
            truncated = True
            break
        try:
            stat = path.stat()
            relative = Path("stream-cache") / path.relative_to(root)
        except (OSError, ValueError):
            continue
        files.append(
            _CacheFile(
                path=path,
                relative_path=str(relative),
                size=max(0, stat.st_size),
                accessed_at=stat.st_atime,
                modified_at=stat.st_mtime,
            )
        )
    return files, truncated


def _record_cleanup_metrics(result: dict[str, int]) -> None:
    try:
        from crate.metrics import record

        record("stream.cache.bytes", float(result["bytes_after"]))
        record("stream.cache.files", float(result["files_after"]))
        record("stream.cache.bytes_removed", float(result["bytes_removed"]))
        record("stream.cache.files_removed", float(result["files_removed"]))
        record("stream.cache.orphan_files", float(result["orphan_files_seen"]))
    except Exception:
        log.debug("Unable to record stream cache cleanup metrics", exc_info=True)


def cleanup_stream_variants(
    *,
    now: float | None = None,
    policy: StreamCachePolicy | None = None,
) -> dict[str, int]:
    active_policy = policy or StreamCachePolicy.from_env()
    current_time = time.time() if now is None else float(now)
    root = stream_cache_root()
    files, files_truncated = _cache_files(root, active_policy.max_files)
    rows = list_stream_variants_for_cleanup(limit=active_policy.max_files)
    rows_truncated = len(rows) >= active_policy.max_files

    files_by_relative = {item.relative_path: item for item in files}
    rows_by_relative: dict[str, dict] = {}
    missing_keys: list[str] = []
    for row in rows:
        relative = str(row.get("relative_path") or "")
        cache_key = str(row.get("cache_key") or "")
        if not relative.startswith("stream-cache/") or not cache_key:
            continue
        rows_by_relative[relative] = row
        if relative not in files_by_relative:
            missing_keys.append(cache_key)

    candidates: dict[str, tuple[_CacheFile, str]] = {}
    idle_cutoff = current_time - active_policy.max_idle_seconds
    orphan_cutoff = current_time - active_policy.orphan_grace_seconds
    for item in files:
        if item.relative_path in rows_by_relative:
            if item.accessed_at < idle_cutoff:
                candidates[item.relative_path] = (item, "idle")
        elif not rows_truncated and item.modified_at < orphan_cutoff:
            candidates[item.relative_path] = (item, "orphan")

    bytes_before = sum(item.size for item in files)
    planned_after = bytes_before - sum(item.size for item, _ in candidates.values())
    if planned_after > active_policy.max_bytes:
        remaining = sorted(
            (
                item
                for item in files
                if item.relative_path in rows_by_relative
                and item.relative_path not in candidates
            ),
            key=lambda item: (item.accessed_at, item.relative_path),
        )
        for item in remaining:
            if planned_after <= active_policy.low_watermark_bytes:
                break
            candidates[item.relative_path] = (item, "quota")
            planned_after -= item.size

    referenced_candidates = sorted(
        (
            (item, reason, str(rows_by_relative[item.relative_path]["cache_key"]))
            for item, reason in candidates.values()
            if item.relative_path in rows_by_relative
        ),
        key=lambda value: (value[0].accessed_at, value[0].relative_path),
    )
    cache_keys = [cache_key for _, _, cache_key in referenced_candidates]
    cache_keys.extend(key for key in missing_keys if key not in cache_keys)
    if cache_keys:
        mark_stream_variants_missing(cache_keys)

    removed_by_reason = {"idle": 0, "quota": 0, "orphan": 0}
    bytes_removed = 0
    failed = 0
    for item, reason in sorted(
        candidates.values(), key=lambda value: (value[0].accessed_at, value[0].path)
    ):
        try:
            item.path.unlink(missing_ok=True)
        except OSError:
            failed += 1
            continue
        removed_by_reason[reason] += 1
        bytes_removed += item.size

    for directory in sorted(
        (path for path in root.rglob("*") if path.is_dir()),
        key=lambda path: len(path.parts),
        reverse=True,
    ):
        try:
            directory.rmdir()
        except OSError:
            pass

    files_removed = sum(removed_by_reason.values())
    result = {
        "files_before": len(files),
        "files_after": max(0, len(files) - files_removed),
        "bytes_before": bytes_before,
        "bytes_after": max(0, bytes_before - bytes_removed),
        "files_removed": files_removed,
        "bytes_removed": bytes_removed,
        "idle_files_removed": removed_by_reason["idle"],
        "quota_files_removed": removed_by_reason["quota"],
        "orphan_files_seen": sum(
            1 for item in files if item.relative_path not in rows_by_relative
        ),
        "orphan_files_removed": removed_by_reason["orphan"],
        "missing_rows_reconciled": len(missing_keys),
        "remove_failures": failed,
        "rows_truncated": int(rows_truncated),
        "files_truncated": int(files_truncated),
    }
    _record_cleanup_metrics(result)
    return result


__all__ = ["StreamCachePolicy", "cleanup_stream_variants"]

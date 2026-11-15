"""Recycling a Dramatiq worker process that keeps too much memory.

After each message ``crate.actors`` asks ``recycle_if_over`` whether the process
should go. It reads the resident set now, not ``ru_maxrss``: that is the lifetime
peak, so one large analysis (a Smart Mix profile with the madmom meter arbiter
peaks above 1.5 GB) would retire a process that already gave the memory back.
Only when the resident set is over the limit does it collect garbage, hand the
heap that native code freed back to the system and read it again.

A process still over the limit retires gracefully. Its worker thread takes no
further message, and the process sends itself SIGTERM, Dramatiq's graceful stop:
the current message finishes and is acknowledged, and the process exits with 0.
Dramatiq's parent stops every process of its pool when any of them exits, so
``crate.worker`` runs each process in a pool of its own and starts a new pool when
one exits with 0. A crash (non-zero exit) still stops every pool.
"""

from __future__ import annotations

import ctypes
import gc
import logging
import os
import signal
import threading

log = logging.getLogger(__name__)

DEFAULT_MAX_RSS_MB = 1500
MAX_RSS_ENV = "CRATE_WORKER_MAX_RSS_MB"

_retire_lock = threading.Lock()
_retire_requested = False


def max_rss_mb() -> int:
    """The recycling limit, from ``CRATE_WORKER_MAX_RSS_MB`` when it is valid."""
    try:
        value = int(os.environ.get(MAX_RSS_ENV, "") or DEFAULT_MAX_RSS_MB)
    except ValueError:
        return DEFAULT_MAX_RSS_MB
    return value if value > 0 else DEFAULT_MAX_RSS_MB


def current_rss_mb() -> float | None:
    """The resident set of this process now, or None where /proc is missing."""
    try:
        with open("/proc/self/statm") as statm:
            resident_pages = int(statm.read().split()[1])
    except (OSError, ValueError, IndexError):
        return None
    return resident_pages * os.sysconf("SC_PAGE_SIZE") / (1024 * 1024)


def release_freed_memory() -> None:
    """Collect cycles and return glibc's free heap to the system.

    numpy, TensorFlow and torch free large buffers into glibc's heap, which keeps
    them mapped until it is trimmed, so the resident set overstates what the
    process holds.
    """
    gc.collect()
    try:
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except (OSError, AttributeError):
        pass  # not glibc (macOS development); the measure stays as it is


def recycle_if_over() -> bool:
    """Retire this process when its resident set stays over the limit.

    Returns True when the process is retiring (now or by an earlier call).
    """
    if _retire_requested:
        return True
    limit = max_rss_mb()
    rss = current_rss_mb()
    if rss is None or rss <= limit:
        return False
    release_freed_memory()
    rss = current_rss_mb()
    if rss is None or rss <= limit:
        return False
    _retire(rss, limit)
    return True


def _retire(rss: float, limit: int) -> None:
    global _retire_requested
    with _retire_lock:
        # A second SIGTERM makes Dramatiq kill the process at once.
        if _retire_requested:
            return
        _retire_requested = True
    log.warning(
        "Recycling: RSS=%dMB > %dMB limit; this process exits after its task",
        int(rss),
        limit,
    )
    from dramatiq.worker import WorkerThread

    current = threading.current_thread()
    if isinstance(current, WorkerThread):
        current.stop()
    os.kill(os.getpid(), signal.SIGTERM)

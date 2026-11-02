from __future__ import annotations

from importlib import import_module
from threading import Event, Thread
import time
from types import SimpleNamespace

import pytest


class _TickEvent:
    def __init__(self, ticks, clock, before_first_wait=None):
        self.ticks = ticks
        self.clock = clock
        self.index = 0
        self.before_first_wait = before_first_wait

    def is_set(self):
        return self.index >= len(self.ticks)

    def wait(self, timeout):
        assert timeout == 2
        if self.index == 0 and self.before_first_wait is not None:
            self.before_first_wait()
        self.index += 1
        if not self.is_set():
            self.clock["now"] = self.ticks[self.index]


@pytest.fixture
def service_runtime(monkeypatch):
    from crate import metrics, worker

    ticks = [1000.0, 1059.0, 1061.0, 1120.0, 1122.0, 1301.0]
    clock = {"now": ticks[0]}
    auto_dj = []
    schedules = []

    class Watcher:
        def __init__(self, *_args):
            pass

        def start(self):
            pass

        def stop(self):
            pass

    dependencies = [
        ("crate.library_sync", "LibrarySync", lambda config: SimpleNamespace()),
        ("crate.library_watcher", "LibraryWatcher", Watcher),
        ("crate.jam_auto_dj", "run_auto_dj_once", lambda: auto_dj.append(clock["now"])),
        (
            "crate.scheduler",
            "check_and_create_scheduled_tasks",
            lambda: schedules.append(clock["now"]),
        ),
        (
            "crate.importer",
            "ImportQueue",
            lambda config: SimpleNamespace(refresh_pending_state=lambda: []),
        ),
        ("crate.config", "load_config", lambda: {}),
        (
            "crate.db.import_queue_mutations",
            "release_orphaned_import_claims",
            lambda: None,
        ),
        ("crate.db.ops_runtime", "set_ops_runtime_state", lambda *args, **kwargs: None),
        ("crate.resource_governor", "build_governor_surface", lambda: {}),
        (
            "crate.alerting",
            "evaluate_health",
            lambda: SimpleNamespace(snapshot=lambda: {}),
        ),
        (
            "crate.media_worker_progress",
            "bridge_media_worker_task_events",
            lambda **kwargs: None,
        ),
        (
            "crate.db.jobs.analysis",
            "backfill_pipeline_read_models",
            lambda **kwargs: {},
        ),
    ]
    for module_name, name, replacement in dependencies:
        monkeypatch.setattr(import_module(module_name), name, replacement)
    monkeypatch.setattr(worker, "cleanup_zombie_tasks", lambda **kwargs: None)
    monkeypatch.setattr(worker, "redispatch_stale_pending_tasks", lambda **kwargs: None)
    monkeypatch.setattr(worker, "set_cache", lambda *args, **kwargs: None)
    monkeypatch.setattr(worker, "_refresh_analysis_runtime_state", lambda: None)
    monkeypatch.setattr(worker, "_run_periodic_cleanup", lambda config: None)
    monkeypatch.setattr(
        worker,
        "get_task_activity_snapshot",
        lambda **kwargs: {
            "running_tasks": [],
            "pending_tasks": [],
            "recent_tasks": [],
            "running_count": 0,
            "pending_count": 0,
        },
    )
    monkeypatch.setattr(metrics, "record", lambda *args, **kwargs: None)
    monkeypatch.setattr(time, "time", lambda: clock["now"])
    return worker, metrics, clock, ticks, auto_dj, schedules


@pytest.mark.parametrize("failure", ["flush", "prune"])
def test_real_service_loop_runs_independent_flush_and_retention_cadences(
    service_runtime, monkeypatch, failure
):
    worker, metrics, clock, ticks, _auto_dj, _schedules = service_runtime
    flush_times = []
    prune_times = []

    def flush():
        flush_times.append(clock["now"])
        if failure == "flush":
            raise RuntimeError("Injected Redis flush failure")

    def prune(limit=1000):
        assert limit == 1000
        prune_times.append(clock["now"])
        if failure == "prune":
            raise RuntimeError("Injected retention PostgreSQL failure")
        return 0

    class ImmediateThread:
        def __init__(self, *, target, args=(), kwargs=None, daemon=None, name=None):
            assert daemon is True
            self.target = target
            self.args = args
            self.kwargs = kwargs or {}

        def start(self):
            self.target(*self.args, **self.kwargs)

        def is_alive(self):
            return False

    monkeypatch.setattr(metrics, "flush_to_postgres", flush)
    monkeypatch.setattr(metrics, "prune_history", prune, raising=False)
    monkeypatch.setattr(worker.threading, "Thread", ImmediateThread)

    worker._run_service_loop({}, _TickEvent(ticks, clock))

    assert flush_times == [1000.0, 1301.0]
    assert prune_times == [1000.0, 1061.0, 1122.0, 1301.0]


def test_real_service_loop_keeps_advancing_with_one_blocked_retention_thread(
    service_runtime, monkeypatch
):
    worker, metrics, clock, ticks, auto_dj, schedules = service_runtime
    entered = Event()
    release = Event()
    finished = Event()
    spawned = []
    prune_calls = []

    def blocked_prune(limit=1000):
        prune_calls.append(limit)
        entered.set()
        try:
            assert release.wait(timeout=5), "Test did not release retention thread"
        finally:
            finished.set()
        return 0

    def tracked_thread(*args, **kwargs):
        thread = Thread(*args, **kwargs)
        spawned.append(thread)
        return thread

    def wait_until_prune_blocks():
        assert entered.wait(timeout=2), "Retention thread was not started"

    monkeypatch.setattr(metrics, "flush_to_postgres", lambda: None)
    monkeypatch.setattr(metrics, "prune_history", blocked_prune, raising=False)
    monkeypatch.setattr(worker.threading, "Thread", tracked_thread)

    try:
        worker._run_service_loop(
            {}, _TickEvent(ticks, clock, before_first_wait=wait_until_prune_blocks)
        )

        assert len(auto_dj) > 1
        assert auto_dj[-1] == ticks[-1]
        assert len(schedules) > 1
        assert schedules[-1] == ticks[-1]
        assert len(spawned) == 1
        assert spawned[0].daemon is True
        assert prune_calls == [1000]
        assert not finished.is_set()
    finally:
        release.set()
        for thread in spawned:
            thread.join(timeout=2)
            assert not thread.is_alive()


def test_real_service_loop_recovers_when_retention_thread_start_fails_once(
    service_runtime, monkeypatch
):
    worker, metrics, clock, ticks, auto_dj, _schedules = service_runtime
    starts = []
    prunes = []

    class StartFailureOnce:
        def __init__(self, *, target, args=(), kwargs=None, daemon=None, name=None):
            assert daemon is True
            self.target = target
            self.args = args
            self.kwargs = kwargs or {}

        def start(self):
            starts.append(clock["now"])
            if len(starts) == 1:
                raise RuntimeError("Injected retention thread start failure")
            self.target(*self.args, **self.kwargs)

        def is_alive(self):
            return False

    monkeypatch.setattr(metrics, "flush_to_postgres", lambda: None)
    monkeypatch.setattr(
        metrics, "prune_history", lambda limit=1000: prunes.append(clock["now"]) or 0
    )
    monkeypatch.setattr(worker.threading, "Thread", StartFailureOnce)

    worker._run_service_loop({}, _TickEvent(ticks, clock))

    assert starts[0] == ticks[0]
    assert len(starts) > 1
    assert prunes
    assert prunes[-1] == ticks[-1]
    assert len(auto_dj) > 1
    assert auto_dj[-1] == ticks[-1]

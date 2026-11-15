"""A worker process recycles on its current memory, and only that process goes."""

from __future__ import annotations

import os
from pathlib import Path
import queue
import signal
import subprocess
import sys
import textwrap

import pytest

from crate import process_recycle


@pytest.fixture(autouse=True)
def _fresh_state(monkeypatch):
    monkeypatch.setattr(process_recycle, "_retire_requested", False)
    monkeypatch.delenv(process_recycle.MAX_RSS_ENV, raising=False)


@pytest.fixture
def kills(monkeypatch):
    sent: list[tuple[int, int]] = []
    monkeypatch.setattr(
        process_recycle.os, "kill", lambda pid, sig: sent.append((pid, sig))
    )
    return sent


def _readings(monkeypatch, *values):
    pending = list(values)
    monkeypatch.setattr(process_recycle, "current_rss_mb", lambda: pending.pop(0))
    return pending


@pytest.mark.skipif(not Path("/proc/self/statm").exists(), reason="needs /proc")
def test_current_rss_is_the_resident_set_now():
    status = Path("/proc/self/status").read_text()
    vm_rss_kb = int(
        next(line for line in status.splitlines() if line.startswith("VmRSS:")).split()[
            1
        ]
    )

    assert process_recycle.current_rss_mb() == pytest.approx(vm_rss_kb / 1024, rel=0.2)


def test_a_past_peak_does_not_recycle(monkeypatch, kills):
    """ru_maxrss is the lifetime peak; a process that gave its memory back stays."""
    import resource

    class Peak:
        ru_maxrss = 4 * 1024 * 1024  # 4 GB in KiB

    monkeypatch.setattr(resource, "getrusage", lambda who: Peak)
    _readings(monkeypatch, 900.0)

    assert process_recycle.recycle_if_over() is False
    assert kills == []


def test_freed_memory_is_released_before_deciding(monkeypatch, kills):
    released = []
    monkeypatch.setattr(
        process_recycle, "release_freed_memory", lambda: released.append(True)
    )
    _readings(monkeypatch, 1_600.0, 1_200.0)

    assert process_recycle.recycle_if_over() is False
    assert released == [True]
    assert kills == []


def test_a_process_still_over_the_limit_retires_with_sigterm(monkeypatch, kills):
    monkeypatch.setattr(process_recycle, "release_freed_memory", lambda: None)
    _readings(monkeypatch, 1_600.0, 1_550.0)

    assert process_recycle.recycle_if_over() is True
    # SIGTERM is Dramatiq's graceful stop: the current message finishes and is acked.
    assert kills == [(os.getpid(), signal.SIGTERM)]


def test_the_worker_thread_takes_no_further_message(monkeypatch, kills):
    from dramatiq.brokers.stub import StubBroker
    from dramatiq.worker import WorkerThread

    thread = WorkerThread(
        broker=StubBroker(),
        consumers={},
        work_queue=queue.PriorityQueue(),
        worker_timeout=1000,
    )
    thread.running = True
    monkeypatch.setattr(process_recycle.threading, "current_thread", lambda: thread)
    monkeypatch.setattr(process_recycle, "release_freed_memory", lambda: None)
    _readings(monkeypatch, 1_600.0, 1_600.0)

    assert process_recycle.recycle_if_over() is True
    assert thread.running is False


def test_a_process_retires_once(monkeypatch, kills):
    """A second SIGTERM makes Dramatiq kill the process, cutting other threads' work."""
    monkeypatch.setattr(process_recycle, "release_freed_memory", lambda: None)
    _readings(monkeypatch, 1_600.0, 1_600.0, 1_700.0)

    assert process_recycle.recycle_if_over() is True
    assert process_recycle.recycle_if_over() is True
    assert len(kills) == 1


def test_the_limit_follows_the_environment(monkeypatch, kills):
    monkeypatch.setattr(process_recycle, "release_freed_memory", lambda: None)
    monkeypatch.setenv(process_recycle.MAX_RSS_ENV, "1800")
    _readings(monkeypatch, 1_700.0)

    assert process_recycle.max_rss_mb() == 1800
    assert process_recycle.recycle_if_over() is False
    assert kills == []


@pytest.mark.parametrize("raw", ["", "many", "0", "-5"])
def test_an_unreadable_limit_keeps_the_default(monkeypatch, raw):
    monkeypatch.setenv(process_recycle.MAX_RSS_ENV, raw)

    assert process_recycle.max_rss_mb() == process_recycle.DEFAULT_MAX_RSS_MB


def test_unknown_memory_never_recycles(monkeypatch, kills):
    _readings(monkeypatch, None)

    assert process_recycle.recycle_if_over() is False
    assert kills == []


def test_actors_check_memory_recycles_through_the_helper(monkeypatch):
    from crate import actors

    calls = []
    monkeypatch.setattr(actors, "recycle_if_over", lambda: calls.append(True) or False)

    actors._check_memory()

    assert calls == [True]


# A real single-process Dramatiq pool on a stub broker: the task that asks to retire
# finishes after the request, the next message never starts, and the pool exits 0.
_POOL_MODULE = """
    import os
    from pathlib import Path
    import time

    import dramatiq
    from dramatiq.brokers.stub import StubBroker

    from crate import process_recycle

    broker = StubBroker()
    dramatiq.set_broker(broker)
    MARKER = Path(os.environ["RECYCLE_MARKER"])


    @dramatiq.actor
    def analyse(n):
        process_recycle.current_rss_mb = lambda: 10_000.0
        process_recycle.release_freed_memory = lambda: None
        retiring = process_recycle.recycle_if_over()
        time.sleep(0.5)
        with MARKER.open("a") as marker:
            marker.write(f"{n} {retiring}\\n")


    analyse.send(1)
    analyse.send(2)
"""


def test_a_retiring_dramatiq_process_finishes_its_task_and_exits_zero(tmp_path):
    (tmp_path / "recycle_pool.py").write_text(textwrap.dedent(_POOL_MODULE))
    marker = tmp_path / "marker"
    app_dir = Path(__file__).resolve().parents[1]
    env = {
        **os.environ,
        "RECYCLE_MARKER": str(marker),
        "PYTHONPATH": os.pathsep.join([str(tmp_path), str(app_dir)]),
    }

    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "dramatiq",
            "recycle_pool",
            "--processes",
            "1",
            "--threads",
            "1",
            "--worker-shutdown-timeout",
            "10000",
        ],
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )

    assert result.returncode == 0, result.stderr[-2000:]
    assert marker.read_text().splitlines() == ["1 True"]

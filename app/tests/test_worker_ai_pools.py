"""crate-worker runs each AI lane in its own Dramatiq pool (SM3-D8)."""

import sys

import pytest

from crate import worker


def _queues(command):
    return command[command.index("--queues") + 1 :]


def _option(command, name):
    return command[command.index(name) + 1]


@pytest.fixture(autouse=True)
def _default_lane_threads(monkeypatch):
    monkeypatch.delenv("CRATE_AI_WORKER_THREADS", raising=False)
    monkeypatch.delenv("CRATE_AI_BULK_WORKER_THREADS", raising=False)


def test_crate_worker_runs_ai_lanes_in_separate_pools():
    commands = worker._dramatiq_commands(["default", "fast", "ai", "ai_bulk"], 3)

    assert [_queues(command) for command in commands] == [
        ["default", "fast"],
        ["default", "fast"],
        ["default", "fast"],
        ["ai"],
        ["ai_bulk"],
    ]
    *general, interactive, bulk = commands
    for pool in general:
        assert pool[:4] == [sys.executable, "-m", "dramatiq", "crate.actors"]
        assert (_option(pool, "--processes"), _option(pool, "--threads")) == (
            "1",
            "1",
        )
    assert (_option(interactive, "--processes"), _option(interactive, "--threads")) == (
        "1",
        "2",
    )
    assert (_option(bulk, "--processes"), _option(bulk, "--threads")) == ("1", "1")


def test_ai_lane_threads_follow_environment(monkeypatch):
    monkeypatch.setenv("CRATE_AI_WORKER_THREADS", "4")
    monkeypatch.setenv("CRATE_AI_BULK_WORKER_THREADS", "3")

    commands = worker._dramatiq_commands(["ai", "ai_bulk"], 2)

    assert [_option(command, "--threads") for command in commands] == ["4", "3"]


@pytest.mark.parametrize("raw", ["0", "-2", "many", ""])
def test_invalid_lane_threads_stay_bounded(monkeypatch, raw):
    monkeypatch.setenv("CRATE_AI_WORKER_THREADS", raw)

    (command,) = worker._dramatiq_commands(["ai"], 2)

    assert int(_option(command, "--threads")) >= 1


def test_each_general_process_is_a_pool_of_its_own():
    """Dramatiq stops a whole pool when one of its processes exits, so a process
    that recycles itself must be alone in its pool to go alone."""
    commands = worker._dramatiq_commands(["fast"], 2)

    assert [_queues(command) for command in commands] == [["fast"], ["fast"]]
    assert all(_option(command, "--processes") == "1" for command in commands)
    assert all(_option(command, "--threads") == "1" for command in commands)


def test_default_worker_queues_include_ai_lanes():
    assert {"ai", "ai_bulk"} <= set(worker._normalise_queues(None))


def test_cli_default_queues_include_ai_lanes(monkeypatch):
    import crate.__main__ as cli

    captured = {}
    monkeypatch.delenv("CRATE_WORKER_QUEUES", raising=False)
    monkeypatch.setattr(cli, "load_config", lambda: {})
    monkeypatch.setattr(worker, "run_worker", captured.update)
    monkeypatch.setattr("sys.argv", ["crate", "worker"])
    cli.main()

    assert {"ai", "ai_bulk"} <= set(worker._normalise_queues(captured["worker_queues"]))


# A child that behaves like a Dramatiq parent (dramatiq/cli.py termhandler): the
# first SIGTERM drains the in-flight task, a second one exits at once with
# RET_KILLED (1). With exit_after it also stops on its own, like an OOM kill.
_DRAMATIQ_LIKE = r"""
import signal, sys, time
drain, exit_after, code = float(sys.argv[1]), float(sys.argv[2]), int(sys.argv[3])
state = {"stopping": False}
def term(signum, frame):
    if state["stopping"]:
        sys.exit(1)
    state["stopping"] = True
signal.signal(signal.SIGTERM, term)
started = time.monotonic()
while not state["stopping"]:
    if exit_after >= 0 and time.monotonic() - started >= exit_after:
        sys.exit(code)
    time.sleep(0.05)
end = time.monotonic() + drain
while time.monotonic() < end:
    time.sleep(0.05)
sys.exit(0)
"""


def _pool(drain, *, exit_after=-1.0, code=0):
    import subprocess

    return subprocess.Popen(
        [sys.executable, "-c", _DRAMATIQ_LIKE, str(drain), str(exit_after), str(code)]
    )


def test_requested_stop_lets_busy_pools_drain():
    import signal
    import threading
    import time

    idle, busy = _pool(0.2), _pool(2.0)
    time.sleep(0.3)
    stopping = threading.Event()

    worker._request_pool_stop([idle, busy], stopping, signal.SIGTERM)
    code = worker._supervise_pools([idle, busy], stopping=stopping, poll_seconds=0.05)

    # The idle pool exits first; the busy one must not get a second SIGTERM.
    assert code == 0
    assert busy.returncode == 0


def test_unexpected_exit_sends_one_sigterm_and_waits_for_the_drain():
    general = _pool(0.0, exit_after=0.3, code=3)
    lane = _pool(1.5)

    code = worker._supervise_pools([general, lane], grace_seconds=10, poll_seconds=0.05)

    assert code == 3
    assert lane.returncode == 0


def test_unexpected_exit_kills_a_sibling_that_outlives_the_grace():
    general = _pool(0.0, exit_after=0.2, code=3)
    stuck = _pool(30.0)

    code = worker._supervise_pools(
        [general, stuck], grace_seconds=0.5, poll_seconds=0.05
    )

    assert code == 3
    assert stuck.returncode == -9


def test_pools_stop_within_the_shared_shutdown_timeout():
    commands = worker._dramatiq_commands(["default", "fast", "ai", "ai_bulk"], 3)

    timeout_ms = str(worker.POOL_SHUTDOWN_TIMEOUT_SECONDS * 1000)
    assert all(
        _option(command, "--worker-shutdown-timeout") == timeout_ms
        for command in commands
    )
    assert worker.POOL_STOP_GRACE_SECONDS > worker.POOL_SHUTDOWN_TIMEOUT_SECONDS


def test_ai_pools_size_their_database_pool_from_their_threads(monkeypatch):
    monkeypatch.setenv("CRATE_AI_WORKER_THREADS", "3")
    monkeypatch.delenv("CRATE_SQLALCHEMY_POOL_SIZE", raising=False)
    *general, interactive, bulk = worker._dramatiq_commands(
        ["default", "ai", "ai_bulk"], 2
    )

    # Each running task holds a handler and a heartbeat session.
    assert all(worker._pool_environment(pool) is None for pool in general)
    assert worker._pool_environment(interactive)["CRATE_SQLALCHEMY_POOL_SIZE"] == "6"
    assert worker._pool_environment(bulk)["CRATE_SQLALCHEMY_POOL_SIZE"] == "2"

    monkeypatch.setenv("CRATE_SQLALCHEMY_POOL_SIZE", "8")
    assert worker._pool_environment(interactive)["CRATE_SQLALCHEMY_POOL_SIZE"] == "8"


def test_a_pool_that_exits_cleanly_is_replaced_alone():
    """A recycled process exits 0 after its task; only its pool starts again."""
    import signal
    import threading
    import time

    recycled = _pool(0.0, exit_after=0.3, code=0)
    sibling = _pool(0.2)
    pools = [recycled, sibling]
    replaced = []

    def respawn(index):
        replaced.append(index)
        return _pool(0.2)

    stopping = threading.Event()
    sibling_alive_before_stop = []

    def stop_later():
        time.sleep(1.5)
        sibling_alive_before_stop.append(sibling.poll() is None)
        worker._request_pool_stop(pools, stopping, signal.SIGTERM)

    stopper = threading.Thread(target=stop_later)
    stopper.start()
    code = worker._supervise_pools(
        pools, stopping=stopping, poll_seconds=0.05, respawn=respawn
    )
    stopper.join()

    assert code == 0
    assert replaced == [0]
    assert sibling_alive_before_stop == [True]
    assert pools[0] is not recycled
    assert pools[0].returncode == 0
    assert sibling.returncode == 0


def test_a_crashed_pool_still_stops_every_pool():
    general = _pool(0.0, exit_after=0.3, code=3)
    lane = _pool(0.5)
    replaced = []

    code = worker._supervise_pools(
        [general, lane],
        grace_seconds=10,
        poll_seconds=0.05,
        respawn=lambda index: replaced.append(index),
    )

    assert code == 3
    assert replaced == []
    assert lane.returncode == 0

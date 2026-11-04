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
        ["ai"],
        ["ai_bulk"],
    ]
    general, interactive, bulk = commands
    assert general[:4] == [sys.executable, "-m", "dramatiq", "crate.actors"]
    assert (_option(general, "--processes"), _option(general, "--threads")) == (
        "3",
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


def test_workers_without_ai_lanes_keep_a_single_pool():
    (command,) = worker._dramatiq_commands(["fast"], 2)

    assert _queues(command) == ["fast"]
    assert _option(command, "--processes") == "2"
    assert _option(command, "--threads") == "1"


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


class _FakeProcess:
    def __init__(self, exits_after=None, code=0):
        self.exits_after = exits_after
        self.code = code
        self.polls = 0
        self.terminated = False

    def poll(self):
        self.polls += 1
        if self.terminated:
            return -15
        if self.exits_after is not None and self.polls >= self.exits_after:
            return self.code
        return None

    def terminate(self):
        self.terminated = True

    def kill(self):
        self.terminated = True

    def wait(self, timeout=None):
        return self.poll()


def test_one_pool_exit_stops_the_others_and_keeps_its_code(monkeypatch):
    monkeypatch.setattr(worker.time, "sleep", lambda _seconds: None)
    general = _FakeProcess()
    lane = _FakeProcess(exits_after=3, code=7)
    bulk = _FakeProcess()

    code = worker._supervise_pools([general, lane, bulk])

    assert code == 7
    assert general.terminated and bulk.terminated
    assert not lane.terminated

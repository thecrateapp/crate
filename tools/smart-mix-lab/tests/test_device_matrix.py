from __future__ import annotations

from pathlib import Path

import device_matrix
from device_matrix import Device, Scenario, run_scenario, scenarios, summarize


def _device() -> Device:
    return Device(serial="phone", sleep=lambda _seconds: None, run=lambda _command: "")


def test_a_scenario_seeks_captures_restores_and_analyzes(tmp_path: Path) -> None:
    device = _device()
    scenario = Scenario(
        "screen-off",
        setup=(("shell", "input", "keyevent", "223"),),
        teardown=(("shell", "input", "keyevent", "224"),),
    )
    analyzed: list[Path] = []

    row = run_scenario(
        device,
        scenario,
        tmp_path,
        lambda path: analyzed.append(path) or {"passed": True, "transitions": []},
    )

    commands = [" ".join(command[3:]) for command in device.log]
    seek = next(i for i, c in enumerate(commands) if "BUS_SEEK_TO_CUE" in c)
    setup = commands.index("shell input keyevent 223")
    start = next(i for i, c in enumerate(commands) if "BUS_CAPTURE_START" in c)
    stop = next(i for i, c in enumerate(commands) if "BUS_CAPTURE_STOP" in c)
    teardown = commands.index("shell input keyevent 224")
    assert seek < setup < start < stop < teardown
    assert all(command[:3] == ["adb", "-s", "phone"] for command in device.log)
    assert analyzed == [tmp_path / "matrix-screen-off.wav"]
    assert (tmp_path / "screen-off.json").exists()
    assert row["passed"] is False


def test_a_scenario_without_a_measured_transition_fails() -> None:
    row = summarize("doze", {"passed": True, "transitions": []})

    assert row["passed"] is False
    assert row["completed"] == 0


def test_the_summary_reports_the_worst_phase_and_counters() -> None:
    row = summarize(
        "baseline",
        {
            "passed": True,
            "underruns": 0,
            "droppedFrames": 0,
            "transitions": [
                {"status": "measured", "engaged": True, "phase": {"p95Ms": 3.0}},
                {"status": "measured", "engaged": True, "phase": {"p95Ms": 6.0}},
            ],
        },
    )

    assert row["passed"] is True
    assert row["phaseP95Ms"] == 6.0
    assert row["engaged"] == 2


def test_offline_removes_and_restores_the_server_tunnel() -> None:
    offline = next(item for item in scenarios(8585) if item.name == "offline")

    assert offline.setup == (("reverse", "--remove", "tcp:8585"),)
    assert offline.teardown == (("reverse", "tcp:8585", "tcp:8585"),)


def test_a_missing_capture_never_passes(tmp_path: Path) -> None:
    result = device_matrix.analyze_capture(tmp_path / "absent.wav")

    assert result == {"status": "missing_capture", "passed": False}

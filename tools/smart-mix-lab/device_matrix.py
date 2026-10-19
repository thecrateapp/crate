"""Run the A06 lifecycle matrix on an Android device through PCM bus captures.

Each scenario seeks the native player to just before the next transition cue,
applies a device condition (screen off, Doze, lost server tunnel), captures the
bus while the transition plays, restores the device and analyzes the capture.
Everything goes through adb, so it works while the WebView is frozen.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import capture_analysis

PACKAGE = "app.cratemusic.crate.debug"
CAPTURE_DIR = f"/sdcard/Android/data/{PACKAGE}/files/captures"
LEAD_MS = 14_000
SETTLE_S = 2.0
TRANSITION_TAIL_S = 6.0
MIX_S = 12.0


@dataclass(frozen=True)
class Scenario:
    name: str
    setup: tuple[tuple[str, ...], ...] = ()
    teardown: tuple[tuple[str, ...], ...] = ()


def scenarios(api_port: int) -> list[Scenario]:
    tunnel = f"tcp:{api_port}"
    return [
        Scenario("baseline"),
        Scenario(
            "screen-off",
            setup=(("shell", "input", "keyevent", "223"),),
            teardown=(("shell", "input", "keyevent", "224"),),
        ),
        Scenario(
            "doze",
            setup=(
                ("shell", "dumpsys", "battery", "unplug"),
                ("shell", "input", "keyevent", "223"),
                ("shell", "dumpsys", "deviceidle", "force-idle"),
            ),
            teardown=(
                ("shell", "dumpsys", "deviceidle", "unforce"),
                ("shell", "dumpsys", "battery", "reset"),
                ("shell", "input", "keyevent", "224"),
            ),
        ),
        Scenario(
            "offline",
            setup=(("reverse", "--remove", tunnel),),
            teardown=(("reverse", tunnel, tunnel),),
        ),
    ]


@dataclass
class Device:
    serial: str | None = None
    adb: str = "adb"
    sleep: Callable[[float], None] = time.sleep
    run: Callable[[list[str]], str] | None = None
    log: list[list[str]] = field(default_factory=list)

    def call(self, *args: str) -> str:
        command = [self.adb, *(["-s", self.serial] if self.serial else []), *args]
        self.log.append(command)
        if self.run is not None:
            return self.run(command)
        return subprocess.run(
            command, capture_output=True, text=True, check=False
        ).stdout

    def broadcast(self, action: str, *extras: str) -> None:
        self.call("shell", "am", "broadcast", "-a", f"{PACKAGE}.{action}", *extras)


def summarize(name: str, result: dict[str, Any]) -> dict[str, Any]:
    transitions = result.get("transitions", [])
    measured = [item for item in transitions if item.get("status") == "measured"]
    phases = [item["phase"]["p95Ms"] for item in transitions if "phase" in item]
    return {
        "name": name,
        "passed": bool(result.get("passed")) and bool(measured),
        "transitions": len(transitions),
        "completed": len(measured),
        "engaged": sum(1 for item in transitions if item.get("engaged")),
        "phaseP95Ms": max(phases) if phases else None,
        "underruns": result.get("underruns"),
        "droppedFrames": result.get("droppedFrames"),
        "gates": result.get("gates", {}),
    }


def run_scenario(
    device: Device,
    scenario: Scenario,
    output: Path,
    analyze: Callable[[Path], dict[str, Any]],
) -> dict[str, Any]:
    capture = f"matrix-{scenario.name}"
    device.broadcast("BUS_SEEK_TO_CUE", "--el", "leadMs", str(LEAD_MS))
    device.sleep(SETTLE_S)
    for command in scenario.setup:
        device.call(*command)
    device.broadcast("BUS_CAPTURE_START", "--es", "name", capture)
    device.sleep(LEAD_MS / 1000 - SETTLE_S + MIX_S + TRANSITION_TAIL_S)
    device.broadcast("BUS_CAPTURE_STOP")
    device.sleep(SETTLE_S)
    for command in scenario.teardown:
        device.call(*command)
    output.mkdir(parents=True, exist_ok=True)
    for suffix in (".wav", ".json"):
        device.call(
            "pull",
            f"{CAPTURE_DIR}/{capture}{suffix}",
            str(output / f"{capture}{suffix}"),
        )
    result = analyze(output / f"{capture}.wav")
    (output / f"{scenario.name}.json").write_text(json.dumps(result, indent=2) + "\n")
    return summarize(scenario.name, result)


def analyze_capture(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"status": "missing_capture", "passed": False}
    return capture_analysis.analyze(capture_analysis.load_capture(path))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--serial")
    parser.add_argument("--adb", default="adb")
    parser.add_argument("--api-port", type=int, default=8585)
    parser.add_argument("--only", nargs="*", help="Scenario names to run")
    args = parser.parse_args(argv)
    device = Device(serial=args.serial, adb=args.adb)
    selected = [
        scenario
        for scenario in scenarios(args.api_port)
        if not args.only or scenario.name in args.only
    ]
    rows = [
        run_scenario(device, scenario, args.output, analyze_capture)
        for scenario in selected
    ]
    matrix = {"device": args.serial, "scenarios": rows}
    (args.output / "matrix.json").write_text(json.dumps(matrix, indent=2) + "\n")
    for row in rows:
        print(
            f"{row['name']:<12} passed={row['passed']} completed={row['completed']}"
            f" engaged={row['engaged']} phaseP95={row['phaseP95Ms']}"
            f" underruns={row['underruns']} dropped={row['droppedFrames']}"
        )
    return 0 if all(row["passed"] for row in rows) else 1


if __name__ == "__main__":
    sys.exit(main())

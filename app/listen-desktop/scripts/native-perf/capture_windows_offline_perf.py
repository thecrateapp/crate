"""Run the isolated Tauri offline-storage performance probe on Windows."""

from __future__ import annotations

import argparse
import http.client
import json
import os
import platform
import re
import shutil
import socket
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parents[3]
FIXTURE_SERVER = ROOT / "app/listen-desktop/scripts/audio-rss/fixture_server.py"
REVISION_PATTERN = re.compile(r"^[0-9a-f]{40}$")
ASSET_COUNTS = (100, 1_000, 5_000)
PROBE_STARTUP_TIMEOUT_SECONDS = 600


def make_tauri_config(
    revision: str, report_port: int, identifier: str
) -> dict[str, Any]:
    if not REVISION_PATTERN.fullmatch(revision):
        raise ValueError("revision must be a 40-character Git SHA")
    if not 1 <= report_port <= 65_535:
        raise ValueError("report port must be between 1 and 65535")
    if not re.fullmatch(r"[a-zA-Z0-9.-]+", identifier):
        raise ValueError("Tauri identifier contains unsupported characters")
    return {
        "identifier": identifier,
        "build": {
            "devUrl": (
                "http://127.0.0.1:5178/scripts/native-perf/probe.html"
                f"?port={report_port}&revision={revision}"
            )
        },
    }


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def validate_measurement_report(report: dict[str, Any], expected_revision: str) -> None:
    _require(
        report.get("event") == "native-performance-results",
        "missing native performance results event",
    )
    _require(not report.get("error"), f"probe reported an error: {report.get('error')}")
    _require(
        report.get("revision") == expected_revision,
        "probe revision does not match the checked out source",
    )
    _require(
        "windows" in str(report.get("host", "")).casefold(),
        "probe user agent does not identify Windows",
    )

    hydration = report.get("hydration")
    _require(isinstance(hydration, list), "missing hydration measurements")
    _require(
        [result.get("assets") for result in hydration] == list(ASSET_COUNTS),
        "hydration asset sizes do not match the benchmark contract",
    )
    for result in hydration:
        count = result["assets"]
        samples = result.get("samples", [])
        _require(len(samples) == 3, f"hydration {count}: expected 3 repetitions")
        for sample in samples:
            _require(
                sample.get("hydratedEntries") == count,
                f"hydration {count}: incomplete index hydration",
            )
            _require(
                sample.get("firstPassStats", {})
                .get("commands", {})
                .get("reconcile_offline_media")
                == 1,
                f"hydration {count}: first pass did not reconcile once",
            )
            _require(
                not sample.get("warmPassStats", {}).get("commands"),
                f"hydration {count}: warm pass unexpectedly invoked native commands",
            )

    verification = report.get("verification")
    _require(isinstance(verification, dict), "missing asset verification measurements")
    batches = verification.get("batches", [])
    _require(
        [result.get("assets") for result in batches] == list(ASSET_COUNTS),
        "verification asset sizes do not match the benchmark contract",
    )
    for result in batches:
        count = result["assets"]
        expected_batches = (count + 499) // 500
        samples = result.get("samples", [])
        _require(len(samples) == 3, f"verification {count}: expected 3 repetitions")
        _require(
            result.get("expectedIpcBatches") == expected_batches,
            f"verification {count}: unexpected IPC batch count",
        )
        _require(
            result.get("validAssets") == [count] * 3,
            f"verification {count}: one or more files failed validation",
        )
        for sample in samples:
            _require(
                sample.get("validAssets") == count,
                f"verification {count}: incomplete verification result",
            )
            _require(
                sample.get("stats", {})
                .get("commands", {})
                .get("verify_offline_media_assets")
                == expected_batches,
                f"verification {count}: observed IPC count differs from expected",
            )

    two_callers = verification.get("twoCallers", {})
    _require(
        len(two_callers.get("samples", [])) == 3,
        "two-caller verification did not complete all repetitions",
    )
    _require(
        all(
            sample.get("validConcurrent") == 2_000 for sample in two_callers["samples"]
        ),
        "two-caller verification returned invalid or missing assets",
    )

    index_writes = report.get("indexWrites")
    _require(isinstance(index_writes, dict), "missing index write measurements")
    serial = index_writes.get("serialControl", {})
    serial_samples = serial.get("samples", [])
    _require(len(serial_samples) == 3, "serial index writes need 3 repetitions")
    for sample in serial_samples:
        _require(sample.get("durableEntries") == 100, "serial snapshot is incomplete")
        _require(
            sample.get("stats", {}).get("indexWriteCalls") == 100,
            "serial control did not record 100 durable writes",
        )
        _require(
            sample.get("stats", {}).get("indexWriteBytes", 0) > 0,
            "serial control did not record written bytes",
        )

    batched = index_writes.get("batched", [])
    _require(
        [result.get("mutations") for result in batched] == list(ASSET_COUNTS),
        "batched mutation sizes do not match the benchmark contract",
    )
    for result in batched:
        count = result["mutations"]
        samples = result.get("samples", [])
        _require(len(samples) == 3, f"batched {count}: expected 3 repetitions")
        for sample in samples:
            _require(
                sample.get("durableEntries") == count,
                f"batched {count}: durable index is incomplete",
            )
            _require(
                sample.get("stats", {}).get("indexWriteCalls") == 1,
                f"batched {count}: expected one durable snapshot write",
            )
            _require(
                sample.get("stats", {}).get("indexWriteBytes", 0) > 0,
                f"batched {count}: no payload bytes were recorded",
            )

    pairwise = report.get("pairwiseIndexWrites", {})
    pairwise_samples = pairwise.get("samples", [])
    _require(len(pairwise_samples) == 3, "pairwise writes need 3 repetitions")
    _require(
        pairwise.get("commitsPerRun") == 500,
        "pairwise write run does not represent 500 two-at-a-time commits",
    )
    for sample in pairwise_samples:
        _require(sample.get("durableEntries") == 1_000, "pairwise index is incomplete")
        _require(
            sample.get("stats", {}).get("indexWriteCalls") == 500,
            "pairwise run did not record 500 durable writes",
        )
        _require(
            sample.get("stats", {}).get("indexWriteBytes", 0) > 0,
            "pairwise run did not record written bytes",
        )


def _reserve_loopback_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    events: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as source:
        for line in source:
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(event, dict):
                events.append(event)
    return events


def _probe_started(events: list[dict[str, Any]]) -> bool:
    return any(
        event.get("event") == "native-performance-progress"
        and event.get("phase") == "probe"
        and event.get("status") == "started"
        for event in events
    )


def _latest_progress_summary(events: list[dict[str, Any]]) -> str:
    progress = next(
        (
            event
            for event in reversed(events)
            if event.get("event") == "native-performance-progress"
        ),
        None,
    )
    if progress is None:
        return "none received"
    phase = progress.get("phase", "unknown phase")
    status = progress.get("status", "unknown status")
    return f"{phase}/{status}"


def _wait_for_fixture_server(
    process: subprocess.Popen[Any], port: int, timeout_seconds: float
) -> None:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("offline performance fixture server exited")
        try:
            connection = http.client.HTTPConnection("127.0.0.1", port, timeout=1)
            connection.request("GET", "/track/placeholder.flac")
            response = connection.getresponse()
            response.read()
            connection.close()
            if response.status == 200:
                return
        except OSError:
            pass
        time.sleep(0.1)
    raise TimeoutError("offline performance fixture server did not start")


def _wait_for_measurement(
    process: subprocess.Popen[Any], event_path: Path, timeout_seconds: float
) -> dict[str, Any]:
    started_at = time.monotonic()
    deadline = started_at + timeout_seconds
    startup_deadline = min(deadline, started_at + PROBE_STARTUP_TIMEOUT_SECONDS)
    while time.monotonic() < deadline:
        events = _read_jsonl(event_path)
        reports = [
            event
            for event in events
            if event.get("event") == "native-performance-results"
        ]
        if reports:
            return reports[-1]
        latest_progress = _latest_progress_summary(events)
        if process.poll() is not None:
            raise RuntimeError(
                f"Tauri dev command exited before the probe reported results "
                f"(exit code {process.returncode}; latest progress: "
                f"{latest_progress})"
            )
        if not _probe_started(events) and time.monotonic() >= startup_deadline:
            raise TimeoutError(
                "native offline performance probe did not start within "
                f"{PROBE_STARTUP_TIMEOUT_SECONDS} seconds; latest progress: "
                f"{latest_progress}"
            )
        time.sleep(0.5)
    raise TimeoutError(
        "native offline performance probe did not finish in time; latest "
        f"progress: {_latest_progress_summary(_read_jsonl(event_path))}"
    )


def _terminate_process_tree(process: subprocess.Popen[Any] | None) -> None:
    if process is None or process.poll() is not None:
        return
    taskkill = shutil.which("taskkill.exe") if os.name == "nt" else None
    if taskkill:
        subprocess.run(
            [taskkill, "/PID", str(process.pid), "/T", "/F"],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    else:
        process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def _tail(path: Path, lines: int = 80) -> str:
    if not path.is_file():
        return ""
    return "\n".join(
        path.read_text(encoding="utf-8", errors="replace").splitlines()[-lines:]
    )


def capture(output_dir: Path, revision: str, timeout_seconds: int) -> Path:
    if os.name != "nt":
        raise RuntimeError("this capture must run on a Windows WebView2 runner")
    if not REVISION_PATTERN.fullmatch(revision):
        raise ValueError("revision must be a 40-character Git SHA")
    checked_out_revision = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if checked_out_revision != revision:
        raise ValueError(
            f"requested revision {revision} differs from checkout {checked_out_revision}"
        )

    output_dir = output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    run_id = re.sub(r"[^a-zA-Z0-9.-]", "", os.environ.get("GITHUB_RUN_ID", "local"))
    attempt = re.sub(r"[^0-9]", "", os.environ.get("GITHUB_RUN_ATTEMPT", "1")) or "1"
    identifier = f"app.cratemusic.crate.desktop.nativeperf.run{run_id}.attempt{attempt}"
    report_port = _reserve_loopback_port()
    config_path = output_dir / "tauri.native-perf.config.json"
    config_path.write_text(
        json.dumps(make_tauri_config(revision, report_port, identifier), indent=2)
        + "\n",
        encoding="utf-8",
    )
    placeholder_path = output_dir / "fixture-placeholder.flac"
    placeholder_path.write_bytes(b"x")
    event_path = output_dir / "events.jsonl"
    server_log_path = output_dir / "fixture-server.log"
    tauri_log_path = output_dir / "tauri-dev.log"

    server_log = server_log_path.open("w", encoding="utf-8")
    tauri_log = tauri_log_path.open("w", encoding="utf-8")
    server: subprocess.Popen[Any] | None = None
    tauri: subprocess.Popen[Any] | None = None
    try:
        server = subprocess.Popen(
            [
                sys.executable,
                str(FIXTURE_SERVER),
                "--track",
                f"placeholder={placeholder_path}",
                "--port",
                str(report_port),
                "--report-file",
                str(event_path),
            ],
            cwd=ROOT,
            stdout=server_log,
            stderr=subprocess.STDOUT,
        )
        _wait_for_fixture_server(server, report_port, timeout_seconds=15)

        command = (
            "npm run --workspace=app/listen-desktop tauri:dev -- "
            f'--config "{config_path}"'
        )
        tauri_environment = os.environ.copy()
        tauri_environment["CRATE_NATIVE_PERF_TELEMETRY"] = "1"
        tauri = subprocess.Popen(
            command,
            cwd=ROOT,
            env=tauri_environment,
            shell=True,
            stdout=tauri_log,
            stderr=subprocess.STDOUT,
            creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
        )
        report = _wait_for_measurement(tauri, event_path, timeout_seconds)
        validate_measurement_report(report, revision)

        capture_path = output_dir / "native-offline-performance.json"
        capture_path.write_text(
            json.dumps(
                {
                    "schema": "crate.tauri.native-offline-performance.windows.v1",
                    "capture": {
                        "capturedAt": datetime.now(timezone.utc).isoformat(),
                        "revision": revision,
                        "identifier": identifier,
                        "runnerName": os.environ.get("RUNNER_NAME"),
                        "imageOS": os.environ.get("ImageOS"),
                        "imageVersion": os.environ.get("ImageVersion"),
                        "platform": platform.platform(),
                        "pythonVersion": platform.python_version(),
                    },
                    "measurement": report,
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        print(f"Windows offline performance evidence: {capture_path}", flush=True)
        return capture_path
    except Exception as error:
        print(f"Offline performance capture failed: {error}", file=sys.stderr)
        print(f"Tauri log tail:\n{_tail(tauri_log_path)}", file=sys.stderr)
        print(f"Fixture log tail:\n{_tail(server_log_path)}", file=sys.stderr)
        raise
    finally:
        _terminate_process_tree(tauri)
        _terminate_process_tree(server)
        tauri_log.close()
        server_log.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--timeout-seconds", type=int, default=1_500)
    args = parser.parse_args()
    if args.timeout_seconds <= 0:
        parser.error("--timeout-seconds must be positive")
    capture(args.output_dir, args.revision, args.timeout_seconds)


if __name__ == "__main__":
    main()

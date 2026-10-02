"""Capture WebView2 memory while Tauri decodes and releases long WAV fixtures."""

from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import socket
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parents[3]
FIXTURE_SERVER = SCRIPT_DIR / "fixture_server.py"
FIXTURE_GENERATOR = SCRIPT_DIR / "generate_wav_fixtures.py"
TARGET_EXE = ROOT / "app/listen-desktop/src-tauri/target/debug/crate-desktop.exe"
TAURI_COMMAND = (
    "npm run --workspace=app/listen-desktop tauri:dev -- "
    "--config scripts/audio-rss/tauri.config.json"
)
TRACKS = (("track20", 1220.4), ("track16", 991.8))
MIB = 1024 * 1024


def summarize_bytes(values: list[int]) -> dict[str, float]:
    if not values:
        raise ValueError("cannot summarize an empty sample")
    import statistics

    return {
        "min": round(min(values) / MIB, 1),
        "median": round(statistics.median(values) / MIB, 1),
        "max": round(max(values) / MIB, 1),
    }


def _read_events(path: Path) -> list[dict[str, Any]]:
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


def _event_time(event: dict[str, Any]) -> datetime:
    return datetime.fromisoformat(str(event["time"]).replace("Z", "+00:00"))


def _phase_at(timestamp: datetime, events: list[dict[str, Any]]) -> str:
    ready = next((event for event in events if event.get("event") == "ready"), None)
    released = next(
        (event for event in events if event.get("event") == "released"), None
    )
    if ready is None or timestamp < _event_time(ready):
        return "decode"
    if released is None or timestamp < _event_time(released):
        return "hold"
    return "post_release"


def _find_target_process(executable: Path, ignored_pids: set[int]) -> Any | None:
    import psutil

    expected = os.path.normcase(os.path.abspath(executable))
    for process in psutil.process_iter(["pid", "exe"]):
        if process.pid in ignored_pids:
            continue
        try:
            actual = process.info.get("exe")
            if actual and os.path.normcase(os.path.abspath(actual)) == expected:
                return process
        except (psutil.AccessDenied, psutil.NoSuchProcess):
            continue
    return None


def _process_snapshot(process: Any) -> dict[str, Any]:
    import psutil

    try:
        descendants = process.children(recursive=True)
    except (psutil.AccessDenied, psutil.NoSuchProcess):
        descendants = []

    process_rows: list[dict[str, Any]] = []
    for child in [process, *descendants]:
        try:
            name = child.name()
            info = child.memory_info()
            private_bytes = getattr(info, "private", None)
            if private_bytes is None:
                raise RuntimeError(
                    "psutil did not expose Windows private commit for "
                    f"{name} (PID {child.pid})"
                )
            try:
                executable = child.exe()
            except (psutil.AccessDenied, psutil.NoSuchProcess):
                executable = None
            process_rows.append(
                {
                    "pid": child.pid,
                    "name": name,
                    "executable": executable,
                    "rss_bytes": info.rss,
                    "private_bytes": private_bytes,
                    "is_webview2": name.lower() == "msedgewebview2.exe",
                }
            )
        except (psutil.AccessDenied, psutil.NoSuchProcess, psutil.ZombieProcess):
            continue

    if not any(row["pid"] == process.pid for row in process_rows):
        raise psutil.NoSuchProcess(process.pid)

    webview = [row for row in process_rows if row["is_webview2"]]
    return {
        "root_pid": process.pid,
        "root_rss_bytes": sum(
            row["rss_bytes"] for row in process_rows if row["pid"] == process.pid
        ),
        "group_rss_bytes": sum(row["rss_bytes"] for row in process_rows),
        "webview2_rss_bytes": sum(row["rss_bytes"] for row in webview),
        "group_private_bytes": sum(row["private_bytes"] for row in process_rows),
        "webview2_private_bytes": sum(row["private_bytes"] for row in webview),
        "webview2_process_count": len(webview),
        "processes": process_rows,
    }


def _wait_for_server(process: subprocess.Popen[Any], port: int, timeout: float) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("audio fixture server exited before accepting requests")
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                return
        except OSError:
            time.sleep(0.1)
    raise TimeoutError("audio fixture server did not start in time")


def _wait_for_probe(
    process: subprocess.Popen[Any],
    target: Any,
    event_path: Path,
    sample_path: Path,
    *,
    interval_seconds: float,
    after_release_seconds: float,
    run_timeout_seconds: float,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    import psutil

    run_started = time.monotonic()
    samples: list[dict[str, Any]] = []
    release_time: datetime | None = None
    with sample_path.open("w", encoding="utf-8") as sample_file:
        while time.monotonic() - run_started < run_timeout_seconds:
            if process.poll() is not None:
                raise RuntimeError("Tauri dev command exited during the audio probe")
            now = datetime.now(timezone.utc)
            events = _read_events(event_path)
            errors = [event for event in events if event.get("event") == "error"]
            if errors:
                raise RuntimeError(f"audio probe failed: {errors[-1].get('message')}")
            released = next(
                (event for event in events if event.get("event") == "released"), None
            )
            if released is not None:
                release_time = _event_time(released)

            try:
                snapshot = _process_snapshot(target)
            except psutil.NoSuchProcess as exc:
                raise RuntimeError(
                    "Tauri app exited before memory capture finished"
                ) from exc
            sample = {
                "time": now.isoformat(),
                "phase": _phase_at(now, events),
                **snapshot,
            }
            samples.append(sample)
            sample_file.write(json.dumps(sample, separators=(",", ":")) + "\n")
            sample_file.flush()

            if release_time is not None and now >= release_time + timedelta(
                seconds=after_release_seconds
            ):
                return samples, events
            time.sleep(interval_seconds)

    raise TimeoutError("audio probe did not finish within its run timeout")


def _terminate_process_tree(process: subprocess.Popen[Any] | None) -> None:
    if process is None:
        return
    taskkill = shutil.which("taskkill.exe")
    if taskkill is None:
        process.kill()
        return
    subprocess.run(
        [taskkill, "/PID", str(process.pid), "/T", "/F"],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()


def _summarize_run(
    run_number: int,
    events: list[dict[str, Any]],
    samples: list[dict[str, Any]],
) -> dict[str, Any]:
    import psutil

    decoded = {
        str(event.get("name"))
        for event in events
        if event.get("event") == "decode-done"
    }
    expected_tracks = {name for name, _duration in TRACKS}
    if decoded != expected_tracks:
        raise RuntimeError(
            f"decoded tracks were {sorted(decoded)}, expected {sorted(expected_tracks)}"
        )
    if not any(event.get("event") == "ready" for event in events):
        raise RuntimeError("audio probe never reported ready")
    if not any(event.get("event") == "released" for event in events):
        raise RuntimeError("audio probe never released its decoded buffers")
    if not any(sample["webview2_process_count"] for sample in samples):
        raise RuntimeError("memory samples did not include a WebView2 process")

    metrics = {
        "root_rss_mib": "root_rss_bytes",
        "process_group_rss_mib": "group_rss_bytes",
        "webview2_rss_mib": "webview2_rss_bytes",
        "process_group_private_commit_mib": "group_private_bytes",
        "webview2_private_commit_mib": "webview2_private_bytes",
    }
    phases: dict[str, Any] = {}
    for phase in ("decode", "hold", "post_release"):
        phase_samples = [sample for sample in samples if sample["phase"] == phase]
        phases[phase] = {
            metric_name: summarize_bytes(
                [sample[source_key] for sample in phase_samples]
            )
            if phase_samples
            else None
            for metric_name, source_key in metrics.items()
        }
        phases[phase]["sample_count"] = len(phase_samples)

    return {
        "run": run_number,
        "host": {
            "platform": platform.platform(),
            "architecture": platform.machine(),
            "physical_memory_bytes": psutil.virtual_memory().total,
            "cpu_count": psutil.cpu_count(logical=True),
        },
        "sample_interval_seconds": 0.25,
        "webview2_shared_pages_may_be_counted_in_process_group_rss": True,
        "events": events,
        "phases": phases,
    }


def _capture_run(
    run_number: int,
    output_dir: Path,
    fixture_paths: dict[str, Path],
    *,
    startup_timeout_seconds: float,
    run_timeout_seconds: float,
) -> dict[str, Any]:
    run_dir = output_dir / f"run-{run_number}"
    run_dir.mkdir(parents=True, exist_ok=True)
    event_path = run_dir / "events.jsonl"
    sample_path = run_dir / "samples.jsonl"
    server_log_path = run_dir / "fixture-server.log"
    tauri_log_path = run_dir / "tauri-dev.log"
    server_log = server_log_path.open("w", encoding="utf-8")
    tauri_log = tauri_log_path.open("w", encoding="utf-8")
    server: subprocess.Popen[Any] | None = None
    tauri: subprocess.Popen[Any] | None = None
    target = None

    try:
        server_args = [
            sys.executable,
            str(FIXTURE_SERVER),
            "--report-file",
            str(event_path),
        ]
        for name, path in fixture_paths.items():
            server_args.extend(["--track", f"{name}={path}"])
        server = subprocess.Popen(
            server_args,
            cwd=ROOT,
            stdout=server_log,
            stderr=subprocess.STDOUT,
        )
        _wait_for_server(server, 18_765, timeout=10)

        tauri = subprocess.Popen(
            TAURI_COMMAND,
            cwd=ROOT,
            shell=True,
            stdout=tauri_log,
            stderr=subprocess.STDOUT,
            creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
        )
        import psutil

        ignored_pids = {tauri.pid}
        startup_deadline = time.monotonic() + startup_timeout_seconds
        while time.monotonic() < startup_deadline:
            if tauri.poll() is not None:
                raise RuntimeError(f"Tauri dev command exited with {tauri.returncode}")
            target = _find_target_process(TARGET_EXE, ignored_pids)
            if target is not None:
                break
            time.sleep(0.1)
        if target is None:
            raise TimeoutError("Tauri app did not start before the startup timeout")

        samples, events = _wait_for_probe(
            tauri,
            target,
            event_path,
            sample_path,
            interval_seconds=0.25,
            after_release_seconds=60,
            run_timeout_seconds=run_timeout_seconds,
        )
        summary = _summarize_run(run_number, events, samples)
        summary_path = run_dir / "summary.json"
        summary_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
        print(f"Windows audio RSS run {run_number}: {summary_path}", flush=True)
        return summary
    finally:
        if target is not None:
            try:
                target.terminate()
                target.wait(timeout=5)
            except psutil.TimeoutExpired:
                try:
                    target.kill()
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
        _terminate_process_tree(tauri)
        if server is not None and server.poll() is None:
            server.terminate()
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill()
        server_log.close()
        tauri_log.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--fixture-dir", type=Path, required=True)
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--startup-timeout-seconds", type=float, default=240)
    parser.add_argument("--run-timeout-seconds", type=float, default=360)
    args = parser.parse_args()
    if os.name != "nt":
        parser.error("this capture requires Windows and WebView2")
    if args.runs < 1:
        parser.error("runs must be at least one")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    args.fixture_dir.mkdir(parents=True, exist_ok=True)
    generator_args = [
        sys.executable,
        str(FIXTURE_GENERATOR),
        "--output-dir",
        str(args.fixture_dir),
    ]
    for name, duration_seconds in TRACKS:
        generator_args.extend(["--track", f"{name}={duration_seconds}"])
    subprocess.run(
        generator_args,
        cwd=ROOT,
        check=True,
    )

    fixture_paths: dict[str, Path] = {}
    for name, _duration_seconds in TRACKS:
        fixture_paths[name] = args.fixture_dir / f"{name}.wav"

    all_summaries = [
        _capture_run(
            run_number,
            args.output_dir,
            fixture_paths,
            startup_timeout_seconds=args.startup_timeout_seconds,
            run_timeout_seconds=args.run_timeout_seconds,
        )
        for run_number in range(1, args.runs + 1)
    ]
    result = {
        "application_revision": os.environ.get("GITHUB_SHA"),
        "run_count": len(all_summaries),
        "fixture_format": {
            "container": "WAVE PCM",
            "sample_rate_hz": 44_100,
            "channels": 2,
            "sample_width_bits": 16,
            "decoded_track_seconds": dict(TRACKS),
        },
        "hold_seconds": 90,
        "after_release_seconds": 60,
        "runs": all_summaries,
    }
    result_path = args.output_dir / "windows-audio-rss.json"
    result_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f"Windows audio RSS measurements: {result_path}", flush=True)


if __name__ == "__main__":
    main()

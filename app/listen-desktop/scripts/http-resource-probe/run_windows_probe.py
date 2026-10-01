#!/usr/bin/env python3
"""Run the isolated Tauri HTTP resource lifetime probe on Windows."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import queue
import socket
import subprocess
import sys
import threading
import time
import urllib.parse
from collections.abc import Mapping
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


SCENARIOS = (
    "consumed-200",
    "consumed-500",
    "connection-refused",
    "bodyless-204",
    "abort-before-headers",
    "cancel-after-first-chunk",
)
ITERATIONS = 25
EXPECTED_PROBE_TITLE = "Crate HTTP resource probe"


def describe_exit_code(return_code: int) -> str:
    unsigned_code = return_code & 0xFFFFFFFF
    status = {
        0xC0000135: "STATUS_DLL_NOT_FOUND",
        0xC0000139: "STATUS_ENTRYPOINT_NOT_FOUND",
    }.get(unsigned_code)
    description = f"{return_code} (0x{unsigned_code:08X}"
    if status:
        description += f", {status}"
    return f"{description})"


def unexpected_probe_document(diagnostics: str) -> str | None:
    prefix = "document-state:"
    for line in diagnostics.splitlines():
        if not line.startswith(prefix):
            continue
        try:
            document = json.loads(line.removeprefix(prefix))
        except json.JSONDecodeError:
            continue
        if (
            document.get("title") != EXPECTED_PROBE_TITLE
            or document.get("hasStatusElement") is not True
        ):
            return (
                "probe loaded an unexpected frontend document: "
                f"title={document.get('title')!r}, "
                f"hasStatusElement={document.get('hasStatusElement')!r}"
            )
    return None


class FixtureState:
    def __init__(self) -> None:
        self.events = {name: threading.Event() for name in SCENARIOS}
        self.hits: dict[str, int] = {}
        self.condition = threading.Condition()
        self.report: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=1)
        self.failure: str | None = None

    def record(self, path: str) -> None:
        with self.condition:
            self.hits[path] = self.hits.get(path, 0) + 1
            self.condition.notify_all()

    def wait_for_hit(self, path: str, expected: int, timeout: float) -> bool:
        deadline = time.monotonic() + timeout
        with self.condition:
            while self.hits.get(path, 0) < expected:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return False
                self.condition.wait(remaining)
            return True


class FixtureHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    state: FixtureState

    def log_message(self, _format: str, *_args: object) -> None:
        return

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.end_headers()

    def _send(self, status: int, body: bytes) -> None:
        self.send_response(status)
        if status != 204:
            self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        self.state.record(path)
        if path == "/ok":
            self._send(200, b"resource-body")
        elif path == "/error":
            self._send(500, b"server-error")
        elif path == "/empty":
            self._send(204, b"")
        elif path == "/delayed":
            self.state.events["abort-before-headers"].wait(8)
            try:
                self._send(200, b"late-response")
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
        elif path == "/stream":
            self.send_response(200)
            self.send_header("Content-Length", "12")
            self.end_headers()
            try:
                self.wfile.write(b"first")
                self.wfile.flush()
                self.state.events["cancel-after-first-chunk"].wait(8)
                self.wfile.write(b" second")
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
        elif path.startswith("/wait/"):
            name = path.removeprefix("/wait/")
            query = urllib.parse.parse_qs(urlparse(self.path).query)
            iteration = int(query.get("iteration", ["1"])[0])
            if name == "delayed-started":
                ready = self.state.wait_for_hit("/delayed", iteration, 8)
            else:
                event = self.state.events.get(name)
                ready = event is not None and event.wait(8)
            if not ready:
                self._send(408, b"event timeout")
            else:
                self._send(200, b"ready")
        else:
            self._send(404, b"not found")

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        self.state.record(path)
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        if path == "/result":
            try:
                self.state.report.put_nowait(json.loads(body))
            except (json.JSONDecodeError, queue.Full) as error:
                self.state.failure = f"invalid or duplicate probe report: {error}"
                self._send(400, b"invalid report")
                return
            self._send(200, b"stored")
            return
        if path.startswith("/release/"):
            name = path.removeprefix("/release/")
            event = self.state.events.get(name)
            if event is None:
                self._send(404, b"unknown release event")
                return
            event.set()
            self._send(200, b"released")
            return
        self._send(404, b"not found")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_probe_environment(
    source_environment: Mapping[str, str],
    *,
    path_separator: str = os.pathsep,
) -> tuple[dict[str, str], list[str]]:
    environment = dict(source_environment)
    python_location = next(
        (
            value
            for key, value in source_environment.items()
            if key.casefold() == "pythonlocation"
        ),
        None,
    )
    removed_python_paths: list[str] = []
    if python_location:
        normalized_root = python_location.rstrip("\\/").casefold()
        path_entries = environment.get("PATH", "").split(path_separator)
        retained_path_entries: list[str] = []
        for entry in path_entries:
            normalized_entry = entry.rstrip("\\/").casefold()
            if normalized_entry == normalized_root or normalized_entry.startswith(
                (normalized_root + "\\", normalized_root + "/")
            ):
                removed_python_paths.append(entry)
            else:
                retained_path_entries.append(entry)
        environment["PATH"] = path_separator.join(retained_path_entries)

    for key in list(environment):
        if key.casefold().startswith("python"):
            environment.pop(key, None)

    return environment, removed_python_paths


def launch_probe_process(
    executable: Path,
    environment: Mapping[str, str],
) -> subprocess.Popen[str]:
    # WebView2 child processes can inherit redirected standard handles. A PIPE
    # keeps reads open after the probe process exits and can hang the timeout
    # path, so this diagnostic process must not use captured stdout/stderr.
    return subprocess.Popen(
        [str(executable)],
        env=environment,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--executable", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--timeout-seconds", type=int, default=90)
    args = parser.parse_args()

    executable = args.executable.resolve()
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    diagnostics_path = output.with_name("tauri-r02-windows-frontend-diagnostics.txt")
    diagnostics_path.unlink(missing_ok=True)
    if not executable.is_file():
        output.write_text(
            json.dumps(
                {
                    "status": "failed",
                    "error": f"probe executable does not exist: {executable}",
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        return 1
    state = FixtureState()
    fixture_type = type("BoundFixtureHandler", (FixtureHandler,), {"state": state})
    server = ThreadingHTTPServer(("127.0.0.1", 0), fixture_type)
    server.daemon_threads = True
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()

    refused_socket = socket.socket()
    refused_socket.bind(("127.0.0.1", 0))
    refused_port = refused_socket.getsockname()[1]
    refused_socket.close()

    result: dict[str, Any] = {
        "status": "running",
        "headSha": os.environ.get("GITHUB_SHA"),
        "platform": platform.platform(),
        "python": sys.version,
        "executable": str(executable),
        "executableSha256": sha256(executable),
        "workingDirectory": os.getcwd(),
        "fixtureOrigin": f"http://127.0.0.1:{server.server_port}",
        "refusedOrigin": f"http://127.0.0.1:{refused_port}",
        "iterationsPerScenario": ITERATIONS,
        "scenarios": list(SCENARIOS),
    }
    process: subprocess.Popen[str] | None = None
    try:
        environment, removed_python_paths = build_probe_environment(os.environ)
        environment["CRATE_HTTP_RESOURCE_PROBE_ORIGIN"] = result["fixtureOrigin"]
        environment["CRATE_HTTP_RESOURCE_PROBE_REFUSED_ORIGIN"] = result[
            "refusedOrigin"
        ]
        environment["CRATE_HTTP_RESOURCE_PROBE_DIAGNOSTICS"] = str(diagnostics_path)
        result["pythonPathEntriesRemoved"] = removed_python_paths
        process = launch_probe_process(executable, environment)
        deadline = time.monotonic() + args.timeout_seconds
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(
                    f"probe did not report within {args.timeout_seconds}s"
                )
            try:
                report = state.report.get(timeout=min(remaining, 0.5))
                break
            except queue.Empty:
                if diagnostics_path.is_file():
                    diagnostic_text = diagnostics_path.read_text(
                        encoding="utf-8",
                        errors="replace",
                    )
                    document_failure = unexpected_probe_document(diagnostic_text)
                    if document_failure:
                        raise RuntimeError(document_failure)
                return_code = process.poll()
                if return_code is not None:
                    raise RuntimeError(
                        "probe exited with "
                        f"{describe_exit_code(return_code)} before reporting"
                    )
        result["report"] = report

        return_code = process.wait(timeout=15)
        with state.condition:
            request_hits = dict(state.hits)
        expected_paths = {
            "/ok": ITERATIONS,
            "/error": ITERATIONS,
            "/empty": ITERATIONS,
            "/delayed": ITERATIONS,
            "/stream": ITERATIONS,
        }
        expected_scenarios = {name: ITERATIONS for name in SCENARIOS}
        scenario_counts = report.get("completedScenarioCounts", {})
        if scenario_counts != expected_scenarios:
            result["scenarioCountFailure"] = {
                "expected": expected_scenarios,
                "actual": scenario_counts,
            }
        path_failures = {
            path: {"expected": expected, "actual": request_hits.get(path, 0)}
            for path, expected in expected_paths.items()
            if request_hits.get(path, 0) != expected
        }
        result.update(
            {
                "status": "passed"
                if report.get("passed")
                and return_code == 0
                and not path_failures
                and scenario_counts == expected_scenarios
                else "failed",
                "returnCode": return_code,
                "report": report,
                "requestHits": request_hits,
                "pathFailures": path_failures,
            }
        )
        if state.failure:
            result["fixtureFailure"] = state.failure
            result["status"] = "failed"
        if result["status"] != "passed":
            raise RuntimeError(f"Windows resource probe failed: {result}")
        return 0
    except Exception as error:  # Persist a report artifact on every failure.
        result["status"] = "failed"
        result["error"] = str(error)
        if process is not None:
            if process.poll() is None:
                process.kill()
            try:
                result["returnCode"] = process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                result["returnCode"] = None
        with state.condition:
            result["requestHits"] = dict(state.hits)
        return_code = 1
    finally:
        for event in state.events.values():
            event.set()
        server.shutdown()
        server.server_close()
        server_thread.join(timeout=2)
        if diagnostics_path.is_file():
            result["frontendDiagnostics"] = diagnostics_path.read_text(
                encoding="utf-8",
                errors="replace",
            )[-10_000:]
        output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")

    return return_code


if __name__ == "__main__":
    raise SystemExit(main())

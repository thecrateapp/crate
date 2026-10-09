from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from verify_benchmarks import load_gates, verify_artifact

GATES = load_gates(
    Path(__file__).resolve().parents[1] / "schemas/release-gates-v1.json"
)


def _server_artifact() -> dict:
    return {
        "kind": "server",
        "command": "benchmark_server.py --fixture representative-48k",
        "commit": "abc123",
        "dirty": False,
        "environment": {
            "hardware": {"machine": "arm64", "cpus": 10},
            "versions": {"python": "3.13.11", "postgres": "15.8"},
        },
        "dataset": {"fixture": "representative-48k", "tracks": 48_000},
        "warmup": 100,
        "iterations": 1_000,
        "concurrency": 16,
        "scenarios": {
            "cached_batch32": {
                "p50_ms": 8.0,
                "p95_ms": 20.0,
                "p99_ms": 30.0,
                "samples": 1_000,
            },
            "uncached_batch32": {
                "p50_ms": 40.0,
                "p95_ms": 90.0,
                "p99_ms": 120.0,
                "samples": 1_000,
            },
            "compatible500": {
                "p50_ms": 60.0,
                "p95_ms": 150.0,
                "p99_ms": 200.0,
                "samples": 1_000,
            },
        },
        "suites": {"rust_parity": "passed"},
    }


def test_complete_artifact_within_budget_passes() -> None:
    assert verify_artifact(_server_artifact(), GATES) == []


def test_gates_carry_the_design_budgets() -> None:
    budgets = {name: gate["p95_ms"] for name, gate in GATES["server"].items()}

    assert budgets == {
        "cached_batch32": 50,
        "uncached_batch32": 150,
        "compatible500": 250,
    }


@pytest.mark.parametrize(
    "path",
    [
        ("environment", "hardware"),
        ("environment", "versions"),
        ("dataset",),
        ("warmup",),
        ("commit",),
    ],
)
def test_missing_provenance_is_rejected(path: tuple[str, ...]) -> None:
    artifact = _server_artifact()
    target = artifact
    for key in path[:-1]:
        target = target[key]
    del target[path[-1]]

    assert verify_artifact(artifact, GATES)


def test_zero_warmup_is_rejected() -> None:
    artifact = _server_artifact()
    artifact["warmup"] = 0

    assert any("warmup" in error for error in verify_artifact(artifact, GATES))


def test_percentile_over_budget_is_rejected() -> None:
    artifact = _server_artifact()
    artifact["scenarios"]["uncached_batch32"]["p95_ms"] = 151.0

    errors = verify_artifact(artifact, GATES)

    assert any("uncached_batch32" in error for error in errors)


def test_missing_scenario_is_rejected() -> None:
    artifact = _server_artifact()
    del artifact["scenarios"]["compatible500"]

    assert any("compatible500" in error for error in verify_artifact(artifact, GATES))


@pytest.mark.parametrize("status", ["skipped", None])
def test_skipped_rust_suite_is_rejected(status: str | None) -> None:
    artifact = _server_artifact()
    if status is None:
        del artifact["suites"]["rust_parity"]
    else:
        artifact["suites"]["rust_parity"] = status

    assert any("rust_parity" in error for error in verify_artifact(artifact, GATES))


def test_declared_but_unmeasured_audio_fixture_is_rejected() -> None:
    artifact = {
        "kind": "analysis",
        "command": "benchmark_analysis.py --fixture generated-v1",
        "commit": "abc123",
        "dirty": False,
        "environment": {
            "hardware": {"machine": "arm64"},
            "versions": {"python": "3.13"},
        },
        "dataset": {"fixture": "generated-v1"},
        "warmup": 1,
        "iterations": 1,
        "concurrency": 1,
        "files": [
            {
                "name": "click-120.wav",
                "analyzer": "python",
                "status": "measured",
                "seconds": 1.2,
                "max_rss_mb": 180.0,
            },
            {"name": "long-7200.wav", "analyzer": "python", "status": "declared"},
        ],
        "suites": {"rust_parity": "passed"},
    }

    errors = verify_artifact(artifact, GATES)

    assert any("long-7200.wav" in error for error in errors)


def test_cli_exits_non_zero_for_a_failing_artifact(tmp_path: Path) -> None:
    from verify_benchmarks import main

    artifact = copy.deepcopy(_server_artifact())
    artifact["scenarios"]["cached_batch32"]["p95_ms"] = 99.0
    path = tmp_path / "artifact.json"
    path.write_text(json.dumps(artifact))

    assert main([str(path)]) == 1

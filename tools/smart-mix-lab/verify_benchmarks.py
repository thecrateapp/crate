"""Check Smart Mix benchmark artefacts against the release gates."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

DEFAULT_GATES = Path(__file__).resolve().parent / "schemas/release-gates-v1.json"


def load_gates(path: Path = DEFAULT_GATES) -> dict[str, Any]:
    return json.loads(path.read_text())


def verify_artifact(artifact: dict[str, Any], gates: dict[str, Any]) -> list[str]:
    errors = [
        f"missing {key}"
        for key in gates["required_provenance"]
        if artifact.get(key) in (None, "", {}, [])
    ]
    environment = artifact.get("environment") or {}
    errors.extend(
        f"missing environment.{key}"
        for key in gates["required_environment"]
        if not environment.get(key)
    )
    for key in ("warmup", "iterations", "concurrency"):
        value = artifact.get(key)
        if isinstance(value, int) and value <= 0:
            errors.append(f"{key} must be positive")
    suites = artifact.get("suites") or {}
    errors.extend(
        f"suite {suite} did not pass: {suites.get(suite)}"
        for suite in gates["required_suites"]
        if suites.get(suite) != "passed"
    )
    if artifact.get("kind") == "server":
        errors.extend(_server_errors(artifact.get("scenarios") or {}, gates["server"]))
    elif artifact.get("kind") == "analysis":
        errors.extend(_analysis_errors(artifact.get("files") or []))
    else:
        errors.append(f"unknown artefact kind: {artifact.get('kind')}")
    return errors


def _server_errors(
    scenarios: dict[str, Any], budgets: dict[str, dict[str, float]]
) -> list[str]:
    errors = []
    for name, budget in budgets.items():
        scenario = scenarios.get(name)
        if not scenario or not scenario.get("samples"):
            errors.append(f"scenario {name} was not measured")
            continue
        if scenario["p95_ms"] > budget["p95_ms"]:
            errors.append(
                f"scenario {name} p95 {scenario['p95_ms']} ms exceeds {budget['p95_ms']} ms"
            )
    return errors


def _analysis_errors(files: list[dict[str, Any]]) -> list[str]:
    if not files:
        return ["no audio fixtures were measured"]
    return [
        f"fixture {item.get('name')} ({item.get('analyzer')}) was not measured"
        for item in files
        if item.get("status") != "measured"
    ]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("artifacts", nargs="+", type=Path)
    parser.add_argument("--gates", type=Path, default=DEFAULT_GATES)
    args = parser.parse_args(argv)
    gates = load_gates(args.gates)
    failed = False
    for path in args.artifacts:
        errors = verify_artifact(json.loads(path.read_text()), gates)
        for error in errors:
            print(f"{path}: {error}", file=sys.stderr)
        failed = failed or bool(errors)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Fail a deploy preflight when a required Dramatiq queue has no consumer.

Reads the rendered Compose model (``docker compose config --format json``) from
a file or from standard input. Tasks sent to a queue nobody consumes stay
pending forever, so the AI lanes (SM3-D8) must be consumed by some worker.

Usage: docker compose ... config --format json | worker_queue_contract.py -
"""

from __future__ import annotations

import json
import shlex
import sys

# Keep in sync with crate.ai.queues.AI_QUEUES (checked by the deploy tests).
REQUIRED_QUEUES = ("ai", "ai_bulk")


def worker_queues(command) -> set[str]:
    """Queues named by --queues X or --queues=X in a worker command."""
    if isinstance(command, str):
        command = shlex.split(command)
    if not isinstance(command, list) or "worker" not in command:
        return set()
    raw = None
    for index, arg in enumerate(command):
        arg = str(arg)
        if arg == "--queues" and index + 1 < len(command):
            raw = command[index + 1]
        elif arg.startswith("--queues="):
            raw = arg.split("=", 1)[1]
    if raw is None:
        return set()
    return {queue.strip() for queue in str(raw).split(",") if queue.strip()}


def runs_by_default(service: dict) -> bool:
    """False for services that start no container (scale or replicas 0) or that
    only run with an opt-in profile."""
    if service.get("profiles"):
        return False
    if str(service.get("scale", 1)) == "0":
        return False
    replicas = (service.get("deploy") or {}).get("replicas")
    return replicas is None or str(replicas) != "0"


def consumers(model: dict) -> dict[str, list[str]]:
    services = model.get("services") or {}
    found: dict[str, list[str]] = {queue: [] for queue in REQUIRED_QUEUES}
    for name, service in sorted(services.items()):
        service = service or {}
        if not runs_by_default(service):
            continue
        queues = worker_queues(service.get("command"))
        for queue in REQUIRED_QUEUES:
            if queue in queues:
                found[queue].append(name)
    return found


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: worker_queue_contract.py <compose.json|->", file=sys.stderr)
        return 2
    source = sys.stdin if argv[1] == "-" else open(argv[1], encoding="utf-8")
    with source:
        try:
            model = json.load(source)
        except json.JSONDecodeError:
            print("Could not read the rendered Compose model", file=sys.stderr)
            return 2
    if not isinstance(model, dict):
        print("The rendered Compose model is not an object", file=sys.stderr)
        return 2
    found = consumers(model)
    missing = [queue for queue, names in found.items() if not names]
    if missing:
        print(
            "No worker consumes the required queue(s): "
            + ", ".join(missing)
            + ". crate-worker must run with --queues including them.",
            file=sys.stderr,
        )
        return 1
    for queue, names in found.items():
        print(f"Queue {queue} consumed by {', '.join(names)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

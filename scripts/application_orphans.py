#!/usr/bin/env python3
"""Review obsolete application containers and retire only explicitly approved IDs."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

PROTECTED = {
    "crate-prometheus",
    "crate-grafana",
    "crate-node-exporter",
    "crate-postgres-exporter",
    "crate-redis-exporter",
    "crate-redis-durable-exporter",
    "crate-cadvisor",
    "crate-observability-docker-proxy",
    "crate-agent",
    "crate-operator",
    "crate-infra-relay",
}
CONTAINER_ID = re.compile(r"[0-9a-f]{64}")
MAX_CONTAINERS = 500


def classify_orphans(configuration: dict, containers: list[dict]) -> list[dict]:
    project = configuration.get("name")
    services = configuration.get("services")
    if (
        not isinstance(project, str)
        or not project
        or not isinstance(services, dict)
        or not services
    ):
        raise ValueError("A non-empty resolved application configuration is required")
    if not isinstance(containers, list) or len(containers) > MAX_CONTAINERS:
        raise ValueError("Invalid or oversized application container inventory")
    result = []
    for container in containers:
        labels = container.get("Config", {}).get("Labels") or {}
        service = labels.get("com.docker.compose.service")
        if (
            labels.get("com.docker.compose.project") != project
            or not service
            or service in services
            or service in PROTECTED
            or labels.get("com.docker.compose.oneoff", "").lower() != "false"
        ):
            continue
        identity = container.get("Id", "")
        if not CONTAINER_ID.fullmatch(identity):
            raise ValueError("Full immutable container IDs are required")
        result.append(
            {
                "id": identity,
                "service": service,
                "name": container.get("Name", "").lstrip("/"),
                "image": container["Config"].get("Image"),
                "running": bool(container.get("State", {}).get("Running")),
            }
        )
    return sorted(result, key=lambda item: (item["service"], item["id"]))


def _output(command):
    result = subprocess.run(command, capture_output=True, text=True, timeout=30)
    if result.returncode:
        raise ValueError("Docker inventory or retirement command failed")
    return result.stdout


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-directory", type=Path, required=True)
    parser.add_argument("--compose-file", action="append", required=True)
    actions = parser.add_subparsers(dest="action", required=True)
    actions.add_parser("audit")
    retire = actions.add_parser("retire")
    retire.add_argument("container_ids", nargs="+")
    retire.add_argument("--confirm-retirement", action="store_true")
    retire.add_argument("--expected-config-sha256", required=True)
    args = parser.parse_args(argv)
    try:
        compose = [
            "docker",
            "compose",
            "--project-directory",
            str(args.project_directory),
            "--env-file",
            str(args.project_directory / ".env"),
        ]
        for name in args.compose_file:
            path = args.project_directory / name
            if not path.is_file():
                raise ValueError("Missing application Compose file")
            compose.extend(["-f", str(path)])
        configuration = json.loads(
            _output([*compose, "--profile", "*", "config", "--format", "json"])
        )
        config_digest = hashlib.sha256(
            json.dumps(configuration, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        project = configuration.get("name")
        if not isinstance(project, str) or not project:
            raise ValueError("Cannot identify the application project")
        identities = _output(
            [
                "docker",
                "ps",
                "--all",
                "--quiet",
                "--no-trunc",
                "--filter",
                f"label=com.docker.compose.project={project}",
            ]
        ).split()
        if len(identities) > MAX_CONTAINERS or any(
            not CONTAINER_ID.fullmatch(value) for value in identities
        ):
            raise ValueError("Invalid or oversized application container inventory")
        containers = (
            json.loads(_output(["docker", "inspect", *identities]))
            if identities
            else []
        )
        orphans = classify_orphans(configuration, containers)
        if args.action == "retire":
            if args.expected_config_sha256 != config_digest:
                raise ValueError(
                    "Application configuration changed since the reviewed audit"
                )
            requested = set(args.container_ids)
            if (
                not args.confirm_retirement
                or len(requested) > 20
                or any(not CONTAINER_ID.fullmatch(value) for value in requested)
            ):
                raise ValueError("Confirm retirement of at most 20 full container IDs")
            current = json.loads(
                _output([*compose, "--profile", "*", "config", "--format", "json"])
            )
            if current != configuration:
                raise ValueError("Application configuration changed during retirement")
            inspected = json.loads(_output(["docker", "inspect", *sorted(requested)]))
            eligible = {item["id"] for item in classify_orphans(current, inspected)}
            if not requested <= eligible or not requested <= {
                item["id"] for item in orphans
            }:
                raise ValueError(
                    "Requested IDs are not current eligible application orphans"
                )
            for identity in sorted(requested):
                _output(["docker", "rm", "-f", "--", identity])
        print(
            json.dumps(
                {
                    "project": project,
                    "configuration_sha256": config_digest,
                    "action": args.action,
                    "orphans": orphans,
                },
                sort_keys=True,
            )
        )
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print(f"Application orphan operation rejected: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Host, deployment and service inventory for the Admin Stack map."""

from __future__ import annotations

import os
import socket

from crate import docker_ctl

INVENTORY_SCHEMA = 1
OBSERVABILITY_SERVICES = frozenset(
    {
        "crate-prometheus",
        "crate-grafana",
        "crate-node-exporter",
        "crate-cadvisor",
        "crate-postgres-exporter",
        "crate-redis-exporter",
        "crate-redis-durable-exporter",
        "crate-observability-docker-proxy",
    }
)
ACTION_PREFIXES = ("librarian-", "tidalrr", "slskd", "soulsync", "traefik", "nginx")
ACTIONS = ["restart", "stop", "start"]


def observability_project() -> str:
    return os.environ.get("CRATE_OBSERVABILITY_PROJECT", "").strip() or (
        "crate-observability"
    )


def host_identity() -> dict[str, str]:
    host_id = os.environ.get("CRATE_HOST_ID", "").strip() or socket.gethostname()
    return {
        "id": host_id,
        "name": os.environ.get("CRATE_HOST_NAME", "").strip() or host_id,
    }


def actions_for(name: str, project: str, application: str) -> list[str]:
    """The unchanged prefix allowlist, limited to containers of this deployment."""
    if project != application or not name.startswith(ACTION_PREFIXES):
        return []
    return list(ACTIONS)


def build_inventory() -> dict:
    """Fail closed: Docker errors raise instead of returning an empty inventory."""
    application = docker_ctl.application_project()
    observability = observability_project()
    containers = docker_ctl.list_compose_containers([application, observability])
    services = []
    for container in containers:
        service = container["service"] or container["name"]
        observed = (
            container["project"] == observability or service in OBSERVABILITY_SERVICES
        )
        services.append(
            {
                "id": f"{container['project']}/{service}",
                "stack_id": "observability" if observed else "application",
                "service": service,
                "project": container["project"],
                "container_id": container["id"],
                "container_name": container["name"],
                "image": container["image"],
                "runtime_state": container["state"],
                "health": container["health"],
                "status": container["status"],
                "actions": actions_for(
                    container["name"], container["project"], application
                ),
            }
        )
    return {
        "schema_version": INVENTORY_SCHEMA,
        "availability": "available",
        "reason": None,
        "host": host_identity(),
        "stacks": [
            {"id": "application", "kind": "application", "project": application},
            {
                "id": "observability",
                "kind": "observability",
                "project": observability,
            },
        ],
        "services": services,
    }


def unavailable_inventory(reason: str) -> dict:
    return {
        "schema_version": INVENTORY_SCHEMA,
        "availability": "unavailable",
        "reason": reason,
        "host": host_identity(),
        "stacks": [],
        "services": [],
    }


__all__ = [
    "ACTIONS",
    "OBSERVABILITY_SERVICES",
    "actions_for",
    "build_inventory",
    "host_identity",
    "observability_project",
    "unavailable_inventory",
]

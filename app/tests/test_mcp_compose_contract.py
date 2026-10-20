"""API and action workers share explicit, disabled-by-default OAuth settings."""

from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]


def service_environment(services, name):
    service = services[name]
    parent = service.get("extends", {}).get("service")
    inherited = service_environment(services, parent) if parent else {}
    environment = service.get("environment", {})
    if isinstance(environment, list):
        environment = dict(entry.split("=", 1) for entry in environment)
    return {**inherited, **environment}


@pytest.mark.parametrize(
    "compose_name,prefix",
    [
        ("docker-compose.dev.yaml", ""),
        ("docker-compose.yaml", "crate-"),
        ("docker-compose.home.yaml", "crate-"),
    ],
)
def test_mcp_action_services_receive_oauth_authority_configuration(
    compose_name, prefix
):
    services = yaml.safe_load((ROOT / compose_name).read_text())["services"]
    environments = {name: service_environment(services, name) for name in services}
    action_services = {
        name
        for name, environment in environments.items()
        if "CRATE_MCP_ACTIONS_ENABLED" in environment
    }
    expected_services = {
        f"{prefix}{name}"
        for name in ("api", "worker", "maintenance-worker", "fast-worker")
    }
    assert expected_services <= action_services
    for name in action_services:
        environment = environments[name]
        assert (
            environment["CRATE_MCP_OAUTH_ENABLED"]
            == "${CRATE_MCP_OAUTH_ENABLED:-false}"
        ), name
        assert environment["CRATE_MCP_OAUTH_ISSUER"] == "${CRATE_MCP_OAUTH_ISSUER:-}", (
            name
        )
        assert (
            environment["CRATE_MCP_OAUTH_ALLOW_LOCALHOST"]
            == "${CRATE_MCP_OAUTH_ALLOW_LOCALHOST:-false}"
        ), name
    assert (
        environments[f"{prefix}api"]["CRATE_MCP_ADMIN_ORIGINS"]
        == "${CRATE_MCP_ADMIN_ORIGINS:-}"
    )

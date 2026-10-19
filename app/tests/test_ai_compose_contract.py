"""All inference processes receive the same explicit credential key ring."""

from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]


def _environment(services, name):
    service = services[name]
    parent = service.get("extends", {}).get("service")
    inherited = _environment(services, parent) if parent else {}
    environment = service.get("environment", {})
    if isinstance(environment, list):
        environment = dict(entry.split("=", 1) for entry in environment)
    return {**inherited, **environment}


@pytest.mark.parametrize(
    "filename,prefix",
    [
        ("docker-compose.yaml", "crate-"),
        ("docker-compose.dev.yaml", ""),
        ("docker-compose.home.yaml", "crate-"),
    ],
)
def test_inference_services_receive_explicit_credential_ring(filename, prefix):
    services = yaml.safe_load((ROOT / filename).read_text())["services"]
    expected = {
        prefix + name
        for name in (
            "api",
            "worker",
            "fast-worker",
            "maintenance-worker",
            "analysis-worker",
        )
    }
    for name in services:
        environment = _environment(services, name)
        for variable in ("CRATE_CREDENTIAL_KEY", "CRATE_CREDENTIAL_PREVIOUS_KEYS"):
            if name in expected:
                assert environment.get(variable) == "${" + variable + ":-}", name
            else:
                assert variable not in environment, name

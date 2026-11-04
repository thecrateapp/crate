"""The API receives the VirtualDJ flags in every compose file that runs it."""

from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
VDJ_FLAGS = ("CRATE_VDJ_ENABLED", "CRATE_VDJ_AUTOMATION_ENABLED")


def _environment(service):
    environment = service.get("environment", {})
    if isinstance(environment, list):
        environment = dict(entry.split("=", 1) for entry in environment)
    return environment


@pytest.mark.parametrize("filename", ["docker-compose.yaml", "docker-compose.home.yaml"])
@pytest.mark.parametrize("flag", VDJ_FLAGS)
def test_api_reads_vdj_flags_from_the_env_file_and_defaults_off(filename, flag):
    services = yaml.safe_load((ROOT / filename).read_text())["services"]

    environment = _environment(services["crate-api"])

    assert environment.get(flag) == f"${{{flag}:-false}}"

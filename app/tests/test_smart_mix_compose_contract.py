"""The Smart Mix switches `/api/capabilities` reads reach the API container.

The compose files list the API's environment one variable at a time, so a switch that
is only in `.env` never reaches the process: it stays at its default whatever the
operator writes there.
"""

from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]

API_SMART_MIX_SWITCHES = (
    "CRATE_SMART_MIX_ENABLED",
    "CRATE_ANDROID_NATIVE_CROSSFADE_ENABLED",
    "CRATE_ANDROID_BEATMATCH_ENABLED",
    "CRATE_ANDROID_BASS_HANDOFF_ENABLED",
    "CRATE_LISTEN_SMART_MIX_V3_ENABLED",
)


def _environment(service: dict) -> dict[str, str]:
    environment = service.get("environment", {})
    if isinstance(environment, list):
        environment = dict(entry.split("=", 1) for entry in environment)
    return environment


@pytest.mark.parametrize(
    "filename", ["docker-compose.yaml", "docker-compose.home.yaml"]
)
@pytest.mark.parametrize("switch", API_SMART_MIX_SWITCHES)
def test_api_receives_smart_mix_switch(filename: str, switch: str) -> None:
    services = yaml.safe_load((ROOT / filename).read_text())["services"]
    environment = _environment(services["crate-api"])

    assert environment.get(switch) == f"${{{switch}:-false}}"

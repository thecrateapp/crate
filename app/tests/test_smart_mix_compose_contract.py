"""The Smart Mix switches `/api/capabilities` reads reach the API container.

The compose files list the API's environment one variable at a time, so a switch that
is only in `.env` never reaches the process: it stays at its default whatever the
operator writes there.
"""

from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]

# Each switch with the default the compose files give it, which is the code's.
API_SMART_MIX_SWITCHES = (
    ("CRATE_SMART_MIX_ENABLED", "false"),
    ("CRATE_ANDROID_NATIVE_CROSSFADE_ENABLED", "false"),
    ("CRATE_ANDROID_BEATMATCH_ENABLED", "false"),
    ("CRATE_ANDROID_BASS_HANDOFF_ENABLED", "false"),
    # Crate Decks' switches are on by default (Diego, 2026-11-15).
    ("CRATE_DECKS_BEATMATCH_ENABLED", "true"),
    ("CRATE_DECKS_BASS_HANDOFF_ENABLED", "true"),
    ("CRATE_LISTEN_SMART_MIX_V3_ENABLED", "false"),
)


def _environment(service: dict) -> dict[str, str]:
    environment = service.get("environment", {})
    if isinstance(environment, list):
        environment = dict(entry.split("=", 1) for entry in environment)
    return environment


@pytest.mark.parametrize(
    "filename", ["docker-compose.yaml", "docker-compose.home.yaml"]
)
@pytest.mark.parametrize(("switch", "default"), API_SMART_MIX_SWITCHES)
def test_api_receives_smart_mix_switch(
    filename: str, switch: str, default: str
) -> None:
    services = yaml.safe_load((ROOT / filename).read_text())["services"]
    environment = _environment(services["crate-api"])

    assert environment.get(switch) == f"${{{switch}:-{default}}}"


@pytest.mark.parametrize(("switch", "default"), API_SMART_MIX_SWITCHES)
def test_compose_default_matches_the_code(monkeypatch, switch: str, default: str):
    from crate import config

    readers = {
        "CRATE_SMART_MIX_ENABLED": config.smart_mix_enabled,
        "CRATE_ANDROID_NATIVE_CROSSFADE_ENABLED": (
            config.android_native_crossfade_enabled
        ),
        "CRATE_ANDROID_BEATMATCH_ENABLED": config.android_beatmatch_enabled,
        "CRATE_ANDROID_BASS_HANDOFF_ENABLED": config.android_bass_handoff_enabled,
        "CRATE_DECKS_BEATMATCH_ENABLED": config.decks_beatmatch_enabled,
        "CRATE_DECKS_BASS_HANDOFF_ENABLED": config.decks_bass_handoff_enabled,
        "CRATE_LISTEN_SMART_MIX_V3_ENABLED": config.listen_smart_mix_v3_enabled,
    }
    monkeypatch.delenv(switch, raising=False)

    assert readers[switch]() is (default == "true")

"""The Crate-specific launcher fails closed before starting Hermes."""

import importlib.util
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def _runtime():
    spec = importlib.util.spec_from_file_location(
        "hermes_runtime", ROOT / "deploy/hermes/runtime.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_launcher_loads_only_dedicated_valid_secrets(tmp_path):
    (tmp_path / "mcp-token").write_text("crate_mcp_" + "a" * 43)
    (tmp_path / "telegram-token").write_text("123456:" + "a" * 35)
    (tmp_path / "allowed-users").write_text("12345678\n")
    settings = _runtime().load_secrets(tmp_path)
    assert settings["TELEGRAM_ALLOWED_USERS"] == "12345678"
    assert settings["TELEGRAM_ALLOW_ALL_USERS"] == "false"
    assert settings["TELEGRAM_ALLOWED_CHATS"] == "12345678"
    assert settings["CRATE_MCP_TOKEN"].startswith("crate_mcp_")
    managed = _runtime().managed_environment(tmp_path)
    assert "TELEGRAM_ALLOWED_USERS=12345678\n" in managed
    assert "TELEGRAM_ALLOW_ALL_USERS=false\n" in managed


@pytest.mark.parametrize("missing", ["mcp-token", "telegram-token", "allowed-users"])
def test_launcher_rejects_missing_secret(tmp_path, missing):
    values = {
        "mcp-token": "crate_mcp_" + "a" * 43,
        "telegram-token": "123456:" + "a" * 35,
        "allowed-users": "12345678",
    }
    for name, value in values.items():
        if name != missing:
            (tmp_path / name).write_text(value)
    with pytest.raises(ValueError):
        _runtime().load_secrets(tmp_path)


@pytest.mark.parametrize("users", ["", "*", "-100123", "123,admin"])
def test_launcher_rejects_an_open_or_group_allowlist(tmp_path, users):
    (tmp_path / "mcp-token").write_text("crate_mcp_" + "a" * 43)
    (tmp_path / "telegram-token").write_text("123456:" + "a" * 35)
    (tmp_path / "allowed-users").write_text(users)
    with pytest.raises(ValueError, match="allowlist"):
        _runtime().load_secrets(tmp_path)


def test_launcher_refuses_a_mutation_capable_mcp_catalog():
    runtime = _runtime()
    runtime.validate_read_tools(
        [{"name": "get_instance_status", "annotations": {"readOnlyHint": True}}]
    )
    with pytest.raises(ValueError, match="read-only"):
        runtime.validate_read_tools(
            [{"name": "apply_repairs", "annotations": {"readOnlyHint": False}}]
        )
    with pytest.raises(ValueError, match="read-only"):
        runtime.validate_read_tools([{"name": "unknown_tool"}])


def test_runtime_health_requires_a_fresh_running_gateway(tmp_path):
    status = tmp_path / "gateway_state.json"
    status.write_text(
        json.dumps(
            {
                "gateway_state": "running",
                "updated_at": time.time(),
                "platforms": {"telegram": {"state": "connected"}},
            }
        )
    )
    assert _runtime().healthy(tmp_path)
    result = subprocess.run(
        [sys.executable, str(ROOT / "deploy/hermes/runtime.py"), "--health"],
        env={**os.environ, "HERMES_HOME": str(tmp_path)},
        check=False,
    )
    assert result.returncode == 0
    status.write_text(
        json.dumps(
            {
                "gateway_state": "running",
                "updated_at": time.time(),
                "platforms": {"telegram": {"state": "disconnected"}},
            }
        )
    )
    assert not _runtime().healthy(tmp_path)
    status.write_text(
        json.dumps({"gateway_state": "running", "updated_at": time.time() - 3600})
    )
    assert not _runtime().healthy(tmp_path)
    status.write_text(
        json.dumps({"gateway_state": "stopped", "updated_at": time.time()})
    )
    assert not _runtime().healthy(tmp_path)


def test_install_identity_seeds_raw_config_without_secret_values(tmp_path):
    home = tmp_path / "home"
    assets = tmp_path / "assets"
    home.mkdir()
    assets.mkdir()
    (assets / "SOUL.md").write_text("Operator identity")
    (assets / "CONTEXT.md").write_text("Versioned context map")
    config = '{"mcp_servers": {"crate": {"url": "${CRATE_MCP_URL}"}}}'
    (assets / "config.json").write_text(config)
    _runtime().install_identity(home, assets)
    assert "Versioned context map" in (home / "SOUL.md").read_text()
    assert (home / "config.yaml").read_text() == config

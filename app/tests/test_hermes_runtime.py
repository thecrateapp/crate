"""The Crate-specific launcher fails closed before starting Hermes."""

import importlib.util
import json
import os
import re
import stat
import subprocess
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def _mode(path):
    return stat.S_IMODE(path.stat().st_mode)


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


CODEX_LOGIN = {"credential_pool": {"openai-codex": [{"id": "one"}]}}


def test_runtime_health_requires_a_fresh_running_gateway(tmp_path, monkeypatch):
    for name in ("CRATE_AGENT_PROVIDER", "CRATE_AGENT_MODEL", "CRATE_AGENT_PROFILE"):
        monkeypatch.delenv(name, raising=False)
    (tmp_path / "auth.json").write_text(json.dumps(CODEX_LOGIN))
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


@pytest.mark.parametrize("host", [None, "", "api.", "https://api.example.test", "*"])
def test_mcp_host_is_required_and_never_defaults_to_an_instance(monkeypatch, host):
    runtime = _runtime()
    if host is None:
        monkeypatch.delenv("CRATE_MCP_HOST", raising=False)
    else:
        monkeypatch.setenv("CRATE_MCP_HOST", host)
    with pytest.raises(runtime.ConfigurationError, match="CRATE_MCP_HOST"):
        runtime.mcp_host()


def test_mcp_host_comes_from_the_environment(monkeypatch):
    monkeypatch.setenv("CRATE_MCP_HOST", "api.crate.example.test")
    assert _runtime().mcp_host() == "api.crate.example.test"
    monkeypatch.setenv("CRATE_MCP_HOST", "localhost:8585")
    assert _runtime().mcp_host() == "localhost:8585"


def test_operator_configuration_fails_fast_without_mcp_host(tmp_path, monkeypatch):
    runtime = _runtime()
    monkeypatch.delenv("CRATE_MCP_HOST", raising=False)
    monkeypatch.setenv("HOME", "/root")
    with pytest.raises(runtime.ConfigurationError):
        runtime.configure_operator(
            tmp_path, ROOT / "deploy/hermes", domain_available=False
        )
    assert not (tmp_path / "config.yaml").exists()
    assert os.environ["HOME"] == "/root"


def test_launcher_reports_missing_mcp_host_before_reading_secrets(tmp_path):
    env = {
        key: value
        for key, value in os.environ.items()
        if key not in {"CRATE_MCP_HOST", "CRATE_AGENT_PROFILE"}
    }
    result = subprocess.run(
        [sys.executable, str(ROOT / "deploy/hermes/runtime.py")],
        env={**env, "HERMES_HOME": str(tmp_path)},
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 1
    assert "CRATE_MCP_HOST" in result.stderr
    assert "CRATE_AGENT_MCP_HOST" in result.stderr


def test_hermes_assets_carry_no_instance_specific_hosts():
    paths = [
        ROOT / "docker-compose.yaml",
        ROOT / ".env.example",
        *(ROOT / "deploy/hermes").rglob("*"),
        *(ROOT / "deploy/operator").rglob("*"),
    ]
    offenders = [
        str(path.relative_to(ROOT))
        for path in paths
        if path.is_file()
        and path.suffix != ".pyc"
        and "lespedants" in path.read_text(errors="ignore")
    ]
    assert offenders == []


def _clean_model_env(monkeypatch):
    for name in (
        "CRATE_AGENT_PROVIDER",
        "CRATE_AGENT_MODEL",
        "CRATE_AGENT_BASE_URL",
        "CRATE_AGENT_PROFILE",
        "CRATE_RELEASE_SHA",
        "HERMES_MANAGED_DIR",
    ):
        monkeypatch.delenv(name, raising=False)


def test_model_defaults_to_codex_luna_without_a_key(tmp_path):
    model, env = _runtime().model_settings(tmp_path, {})
    assert model == {"provider": "openai-codex", "default": "gpt-6-luna"}
    assert env == {}


@pytest.mark.parametrize(
    ("values", "message"),
    [
        ({"CRATE_AGENT_PROVIDER": "ollama"}, "not supported"),
        ({"CRATE_AGENT_PROVIDER": "anthropic"}, "CRATE_AGENT_MODEL is required"),
        (
            {"CRATE_AGENT_PROVIDER": "anthropic", "CRATE_AGENT_MODEL": "claude"},
            "secrets/model-keys/anthropic",
        ),
        (
            {"CRATE_AGENT_PROVIDER": "custom", "CRATE_AGENT_MODEL": "qwen"},
            "CRATE_AGENT_BASE_URL is required",
        ),
        (
            {
                "CRATE_AGENT_PROVIDER": "openai-codex",
                "CRATE_AGENT_BASE_URL": "http://example.test",
            },
            "not used by provider",
        ),
        (
            {
                "CRATE_AGENT_PROVIDER": "custom",
                "CRATE_AGENT_MODEL": "qwen",
                "CRATE_AGENT_BASE_URL": "ftp://example.test",
            },
            "http(s) URL",
        ),
    ],
)
def test_model_configuration_fails_fast_with_a_clear_error(tmp_path, values, message):
    runtime = _runtime()
    with pytest.raises(runtime.ConfigurationError, match=re.escape(message)):
        runtime.model_settings(tmp_path, values)


@pytest.mark.parametrize(
    ("provider", "variable"),
    [
        ("openai-api", "OPENAI_API_KEY"),
        ("anthropic", "ANTHROPIC_API_KEY"),
        ("openrouter", "OPENROUTER_API_KEY"),
        ("nous", "NOUS_API_KEY"),
        ("gemini", "GEMINI_API_KEY"),
        ("deepseek", "DEEPSEEK_API_KEY"),
    ],
)
def test_model_key_file_maps_to_the_provider_variable(tmp_path, provider, variable):
    (tmp_path / "model-keys").mkdir()
    (tmp_path / "model-keys" / provider).write_text("sk-test-0123456789\n")
    model, env = _runtime().model_settings(
        tmp_path,
        {"CRATE_AGENT_PROVIDER": provider, "CRATE_AGENT_MODEL": "some/model-1"},
    )
    assert model == {"provider": provider, "default": "some/model-1"}
    assert env == {variable: "sk-test-0123456789"}


def test_each_provider_reads_only_its_own_key(tmp_path):
    runtime = _runtime()
    keys = tmp_path / "model-keys"
    keys.mkdir()
    (keys / "anthropic").write_text("sk-ant-0123456789")
    (keys / "openrouter").write_text("sk-or-0123456789")
    _model, env = runtime.model_settings(
        tmp_path, {"CRATE_AGENT_PROVIDER": "openrouter", "CRATE_AGENT_MODEL": "a/b"}
    )
    assert env == {"OPENROUTER_API_KEY": "sk-or-0123456789"}
    with pytest.raises(runtime.ConfigurationError, match="model-keys/gemini"):
        runtime.model_settings(
            tmp_path, {"CRATE_AGENT_PROVIDER": "gemini", "CRATE_AGENT_MODEL": "g"}
        )
    (keys / "gemini").write_text("two words")
    with pytest.raises(runtime.ConfigurationError, match="without spaces"):
        runtime.model_settings(
            tmp_path, {"CRATE_AGENT_PROVIDER": "gemini", "CRATE_AGENT_MODEL": "g"}
        )


def test_legacy_single_key_counts_only_until_per_provider_keys_exist(tmp_path):
    runtime = _runtime()
    (tmp_path / "model-api-key").write_text("sk-legacy-0123456789")
    values = {"CRATE_AGENT_PROVIDER": "anthropic", "CRATE_AGENT_MODEL": "claude"}
    assert runtime.model_settings(tmp_path, values)[1] == {
        "ANTHROPIC_API_KEY": "sk-legacy-0123456789"
    }
    (tmp_path / "model-keys").mkdir()
    (tmp_path / "model-keys" / "openrouter").write_text("sk-or-0123456789")
    with pytest.raises(runtime.ConfigurationError, match="model-keys/anthropic"):
        runtime.model_settings(tmp_path, values)


def test_base_urls_follow_each_provider_contract(tmp_path):
    runtime = _runtime()
    (tmp_path / "model-keys").mkdir()
    for provider in ("openai-api", "custom"):
        (tmp_path / "model-keys" / provider).write_text("sk-test-0123456789")
    model, env = runtime.model_settings(
        tmp_path,
        {
            "CRATE_AGENT_PROVIDER": "openai-api",
            "CRATE_AGENT_MODEL": "gpt-test",
            "CRATE_AGENT_BASE_URL": "https://llm.example.test/v1",
        },
    )
    assert env["OPENAI_BASE_URL"] == "https://llm.example.test/v1"
    assert "base_url" not in model
    model, env = runtime.model_settings(
        tmp_path,
        {
            "CRATE_AGENT_PROVIDER": "custom",
            "CRATE_AGENT_MODEL": "qwen3",
            "CRATE_AGENT_BASE_URL": "http://ollama:11434/v1",
        },
    )
    assert model["base_url"] == "http://ollama:11434/v1"
    assert model["api_key"] == "sk-test-0123456789"
    assert env == {}


def test_oauth_providers_report_a_missing_login(tmp_path):
    runtime = _runtime()
    codex = {"provider": "openai-codex", "default": "gpt-6-luna"}
    assert "make agent-auth" in runtime.model_credential_problem(tmp_path, codex, {})
    (tmp_path / "auth.json").write_text(json.dumps(CODEX_LOGIN))
    assert runtime.model_credential_problem(tmp_path, codex, {}) is None
    nous = {"provider": "nous", "default": "hermes"}
    assert runtime.model_credential_problem(tmp_path, nous, {})
    assert (
        runtime.model_credential_problem(tmp_path, nous, {"NOUS_API_KEY": "k" * 12})
        is None
    )
    anthropic = {"provider": "anthropic", "default": "claude"}
    assert runtime.model_credential_problem(tmp_path, anthropic, {}) is None


def test_health_reports_missing_key_and_optional_webhook(tmp_path, monkeypatch):
    runtime = _runtime()
    _clean_model_env(monkeypatch)
    (tmp_path / "auth.json").write_text(json.dumps(CODEX_LOGIN))
    secrets = tmp_path / "secrets"
    secrets.mkdir()
    monkeypatch.setattr(runtime, "SECRETS", secrets)
    monkeypatch.setattr(runtime, "DELIVERY", tmp_path / "delivery")
    (tmp_path / "gateway_state.json").write_text(
        json.dumps(
            {
                "gateway_state": "running",
                "updated_at": time.time(),
                "platforms": {"telegram": {"state": "connected"}},
            }
        )
    )
    monkeypatch.setenv("CRATE_AGENT_PROFILE", "operator")
    assert runtime.health_problem(tmp_path) is None
    (tmp_path / "delivery").mkdir()
    (tmp_path / "delivery/secret").write_text("s" * 40)
    assert "webhook" in runtime.health_problem(tmp_path)
    monkeypatch.delenv("CRATE_AGENT_PROFILE")
    monkeypatch.setenv("CRATE_AGENT_PROVIDER", "anthropic")
    monkeypatch.setenv("CRATE_AGENT_MODEL", "claude")
    assert "model-keys/anthropic" in runtime.health_problem(tmp_path)


def test_context_root_prefers_host_activation_then_image(tmp_path):
    runtime = _runtime()
    host, image = tmp_path / "host/active", tmp_path / "image/active"
    assert runtime.select_context_root((host, image)) is None
    image.mkdir(parents=True)
    (image / "context-manifest.json").write_text("{}")
    assert runtime.select_context_root((host, image)) == image
    host.mkdir(parents=True)
    (host / "context-manifest.json").write_text("{}")
    assert runtime.select_context_root((host, image)) == host


def test_agent_renders_managed_policy_and_degrades_without_context(
    tmp_path, monkeypatch
):
    runtime = _runtime()
    _clean_model_env(monkeypatch)
    home, managed = tmp_path / "home", tmp_path / "managed"
    home.mkdir()
    monkeypatch.setenv("HERMES_MANAGED_DIR", str(managed))
    monkeypatch.setenv("CRATE_RELEASE_SHA", "a" * 40)
    model = {"provider": "custom", "default": "qwen3", "api_key": "secret-key-1"}
    runtime.configure_agent(
        home,
        ROOT / "deploy/hermes",
        model=model,
        model_env={"TELEGRAM_BOT_TOKEN": "123:abc"},
        context_root=None,
    )
    config = json.loads((managed / "config.yaml").read_text())
    assert config["model"] == model
    assert config["mcp_servers"]["crate_context"]["env"] == {
        "CRATE_CONTEXT_ROOT": "/opt/crate-context/active",
        "CRATE_RELEASE_SHA": "a" * 40,
    }
    assert _mode(managed / ".env") == 0o600
    assert _mode(managed / "config.yaml") == 0o600
    assert (managed / ".env").read_text() == "TELEGRAM_BOT_TOKEN=123:abc\n"
    seed = (home / "config.yaml").read_text()
    assert "secret-key-1" not in seed
    assert json.loads(seed)["model"]["default"] == "qwen3"
    assert "Crate knowledge map" in (home / "SOUL.md").read_text()
    assert runtime._context_summary(None)["availability"] == "unavailable"


def test_operator_installs_the_image_plugin_and_managed_policy(tmp_path, monkeypatch):
    runtime = _runtime()
    _clean_model_env(monkeypatch)
    monkeypatch.setenv("CRATE_MCP_HOST", "api.example.test")
    monkeypatch.setattr(runtime, "DELIVERY", tmp_path / "missing")
    monkeypatch.setenv("HOME", "/root")
    monkeypatch.setenv("XDG_STATE_HOME", "/root/.local/state")
    monkeypatch.setenv("HERMES_MANAGED_DIR", str(tmp_path / "managed"))
    home = tmp_path / "home"
    (home / "plugins/crate-confirmation").mkdir(parents=True)
    (home / "plugins/crate-confirmation/stale.py").write_text("old")
    runtime.configure_operator(
        home,
        ROOT / "deploy/hermes",
        domain_available=False,
        model={"provider": "anthropic", "default": "claude"},
        model_env={"ANTHROPIC_API_KEY": "sk-test-0123456789"},
    )
    plugin = home / "plugins/crate-confirmation"
    assert (plugin / "plugin.yaml").is_file()
    assert not (plugin / "stale.py").exists()
    managed = json.loads((tmp_path / "managed/config.yaml").read_text())
    assert managed["model"] == {"provider": "anthropic", "default": "claude"}
    assert "webhook" not in managed["platforms"]
    assert "ANTHROPIC_API_KEY=" in (tmp_path / "managed/.env").read_text()


def test_context_reports_stale_when_the_running_release_differs(tmp_path, monkeypatch):
    sys.path.insert(0, str(ROOT / "deploy/hermes"))
    from context_server import ContextStore

    active = tmp_path / "active"
    active.mkdir()
    (active / "context-manifest.json").write_text(
        json.dumps(
            {
                "release_sha": "a" * 40,
                "deployment": {"release_sha": "a" * 40},
                "files": {},
            }
        )
    )
    monkeypatch.delenv("CRATE_RELEASE_SHA", raising=False)
    assert ContextStore(active).summary()["availability"] == "available"
    monkeypatch.setenv("CRATE_RELEASE_SHA", "a" * 40)
    assert ContextStore(active).summary()["availability"] == "available"
    monkeypatch.setenv("CRATE_RELEASE_SHA", "b" * 40)
    assert ContextStore(active).summary()["availability"] == "stale"


def test_prompts_are_english_and_carry_no_owner_specific_settings():
    texts = [
        (ROOT / "deploy/hermes" / name).read_text()
        for name in ("SOUL.md", "SOUL.operator.md", "CONTEXT.md", "OPERATOR.md")
    ]
    for text in texts:
        assert "Europe/Madrid" not in text
        assert "gpt-6-luna" not in text
        assert not re.search(r"[áéíóúñ¿¡]", text)
    for name in ("config.json", "config.operator.json"):
        assert "model" not in json.loads((ROOT / "deploy/hermes" / name).read_text())

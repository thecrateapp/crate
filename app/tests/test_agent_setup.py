"""Guided Crate Agent setup prepares any instance and never overwrites secrets silently."""

import argparse
import importlib.util
import json
import re
import stat
from pathlib import Path
from types import SimpleNamespace

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
TOKEN = "crate_mcp_" + "a" * 43
TELEGRAM = "123456:" + "a" * 35
PRINCIPAL = "00000000-0000-0000-0000-00000000000a"


def _setup():
    spec = importlib.util.spec_from_file_location(
        "agent_setup", ROOT / "scripts/agent_setup.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _settings(tmp_path, **values):
    return {
        "DATA_DIR": str(tmp_path / "data"),
        "DOMAIN": "crate.example.test",
        "PUID": "1000",
        "PGID": "1000",
        **values,
    }


def _mode(path):
    return stat.S_IMODE(path.stat().st_mode)


def _write_secrets(secrets):
    secrets.mkdir(parents=True, exist_ok=True)
    (secrets / "mcp-token").write_text(TOKEN)
    (secrets / "telegram-token").write_text(TELEGRAM)
    (secrets / "allowed-users").write_text("12345678")


def _args(tmp_path, profile="agent", **values):
    defaults = {
        "profile": profile,
        "env_file": tmp_path / ".env",
        "compose_files": "docker-compose.yaml",
        "overlay": ROOT / "deploy/operator/compose.operator.yaml",
        "non_interactive": True,
        "replace": False,
        "no_start": True,
        "no_network": True,
        "provider": "",
        "model": "",
        "base_url": "",
    }
    return argparse.Namespace(**{**defaults, **values})


class FakeDocker:
    """Records docker invocations and answers like the real CLI would."""

    def __init__(self, running=("crate-api",), scopes=("ops.status.read",)):
        self.calls, self.running, self.scopes = [], set(running), list(scopes)
        self.issued, self.revoked, self.bindings, self.inputs = {}, [], {}, []
        self.approval = {}

    def known(self, token, principal, credential, approval=True):
        self.issued[token] = {
            "credential_id": credential,
            "principal_id": principal,
            "name": "Crate Operator",
            "require_approval": approval,
            "active": True,
        }

    def _cli(self, argv):
        command = argv[argv.index("crate.agent_credentials_cli") + 1 :]
        name = command[0]
        if name == "create":
            count = len(self.issued)
            token = TOKEN if count == 0 else "crate_mcp_" + f"{count:x}".rjust(43, "b")
            principal = PRINCIPAL if count == 0 else f"{count:032x}"
            credential = "c" * 8 + str(count)
            self.known(token, principal, credential, "--require-approval" in command)
            return 0, {
                "principal_id": principal,
                "credential_id": credential,
                "name": command[command.index("--name") + 1],
                "grants": sorted(
                    command[i + 1] for i, a in enumerate(command) if a == "--grant"
                ),
                "expires_at": "2027-10-26T00:00:00+00:00",
                "token": token,
                "require_approval": "--require-approval" in command,
            }
        if name == "identify":
            found = self.issued.get(self.inputs[-1].strip())
            return (0, found) if found else (2, None)
        if name == "revoke":
            self.revoked.append(command[1])
            return 0, {"credential_id": command[1], "revoked": True}
        if name == "require-approval":
            self.approval[command[1]] = True
            return 0, {"principal_id": command[1], "changed": True}
        principal = command[command.index("--principal-id") + 1]
        if name == "show-approver":
            return 0, self.bindings.get(principal)
        telegram = int(command[command.index("--telegram-user-id") + 1])
        self.bindings[principal] = {
            "binding_id": "b" * 8,
            "user_id": 1,
            "username": "admin",
            "telegram_user_id": telegram,
        }
        return 0, {"binding_id": "b" * 8, "telegram_user_id": telegram}

    def __call__(
        self, argv, check=True, capture=True, timeout=120, interactive=False, input=None
    ):
        self.calls.append(argv)
        if input is not None:
            self.inputs.append(input)
        output, code = "", 0
        if argv[:2] == ["docker", "inspect"]:
            output = "true" if argv[-1] in self.running else "false"
        elif "crate.agent_credentials_cli" in argv:
            code, value = self._cli(argv)
            output = json.dumps(value)
        elif "-c" in argv:
            output = json.dumps(self.scopes)
        elif "up" in argv and "-d" in argv:
            self.running.add(argv[-1] if "--no-deps" in argv else "crate-operator")
        elif "--check" in argv:
            output = '{"mcp": "12 tools", "model_credentials": "configured"}'
        elif "-z" in argv:
            output = "OK"
        return SimpleNamespace(
            returncode=code, stdout=output, stderr="" if code == 0 else "unknown"
        )

    def cli_calls(self, name):
        return [
            call[call.index("crate.agent_credentials_cli") + 1 :]
            for call in self.calls
            if "crate.agent_credentials_cli" in call
            and call[call.index("crate.agent_credentials_cli") + 1] == name
        ]


def test_env_values_replace_the_last_assignment_and_keep_the_file_private(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text("A=1\n# A=comment\nexport B=2\nA=3\n")
    env_file.chmod(0o640)
    _setup().set_env_values(env_file, {"A": "9", "B": "8", "C": "7"})
    assert env_file.read_text() == "A=1\n# A=comment\nB=8\nA=9\nC=7\n"
    assert _mode(env_file) == 0o640
    created = tmp_path / "new.env"
    _setup().set_env_values(created, {"X": "1"})
    assert _mode(created) == 0o600


def test_layouts_default_under_data_dir_and_honor_the_operator_root(tmp_path):
    setup = _setup()
    agent = setup.layout(_settings(tmp_path), "agent")
    assert agent.secrets == tmp_path / "data/crate-agent/secrets"
    operator = setup.layout(_settings(tmp_path), "operator")
    assert operator.root == tmp_path / "data/crate-operator"
    assert operator.secrets == tmp_path / "data/crate-operator/secrets/domain"
    custom = setup.layout(
        _settings(tmp_path, CRATE_OPERATOR_ROOT="/opt/crate-operator"), "operator"
    )
    assert custom.root == Path("/opt/crate-operator")


def test_operator_layout_is_private(tmp_path):
    setup = _setup()
    setup.prepare_layout(_settings(tmp_path), "operator")
    root = tmp_path / "data/crate-operator"
    assert _mode(root / "home") == 0o700
    assert _mode(root / "secrets/domain") == 0o700
    assert _mode(root / "secrets/domain-native") == 0o700
    assert _mode(root / "context/public") == 0o755
    assert _mode(root / "provenance") == 0o755
    assert _mode(root / "supervisor-state") == 0o700


def test_noninteractive_agent_init_writes_private_secrets_and_env(
    tmp_path, monkeypatch
):
    setup = _setup()
    monkeypatch.setenv("AGENT_TELEGRAM_TOKEN", TELEGRAM)
    monkeypatch.setenv("AGENT_ALLOWED_USERS", "12345678, 87654321")
    docker = FakeDocker(scopes=["ops.status.read", "ops.jobs.read"])
    args = _args(tmp_path)
    settings = _settings(tmp_path)
    report = "\n".join(setup.init(args, settings, setup.Prompter(False), runner=docker))
    secrets = tmp_path / "data/crate-agent/secrets"
    assert _mode(secrets) == 0o700
    for name, value in (
        ("telegram-token", TELEGRAM),
        ("allowed-users", "12345678,87654321"),
        ("mcp-token", TOKEN),
    ):
        assert (secrets / name).read_text() == value
        assert _mode(secrets / name) == 0o600
    env = (tmp_path / ".env").read_text()
    assert "CRATE_MCP_ENABLED=true" in env
    assert "CRATE_AGENT_PROVIDER=openai-codex" in env
    assert "CRATE_AGENT_MODEL=gpt-6-luna" in env
    create = next(
        call for call in docker.calls if "crate.agent_credentials_cli" in call
    )
    assert create[:7] == [
        "docker",
        "exec",
        "crate-api",
        "python",
        "-m",
        "crate.agent_credentials_cli",
        "create",
    ]
    assert "--require-approval" not in create
    assert create[create.index("--name") + 1] == "Crate Agent (read only)"
    assert create[create.index("--expires-in-days") + 1] == "365"
    assert [create[i + 1] for i, a in enumerate(create) if a == "--grant"] == [
        "ops.status.read",
        "ops.jobs.read",
    ]
    assert PRINCIPAL in report
    assert "make agent-up" in report


def test_init_never_replaces_existing_secrets_without_confirmation(tmp_path):
    setup = _setup()
    secrets = tmp_path / "data/crate-agent/secrets"
    _write_secrets(secrets)
    docker = FakeDocker()
    setup.init(_args(tmp_path), _settings(tmp_path), setup.Prompter(False, {}), docker)
    assert (secrets / "telegram-token").read_text() == TELEGRAM
    assert (secrets / "allowed-users").read_text() == "12345678"
    assert not any("crate.agent_credentials_cli" in call for call in docker.calls)
    replaced = {"AGENT_TELEGRAM_TOKEN": "999:" + "b" * 35, "AGENT_ALLOWED_USERS": "99"}
    setup.init(
        _args(tmp_path, replace=True),
        _settings(tmp_path),
        setup.Prompter(False, replaced),
        docker,
    )
    assert (secrets / "telegram-token").read_text() == "999:" + "b" * 35
    assert (secrets / "allowed-users").read_text() == "99"


def test_explicit_values_replace_only_what_changed(tmp_path):
    setup = _setup()
    secrets = tmp_path / "data/crate-agent/secrets"
    _write_secrets(secrets)
    docker = FakeDocker()
    given = {"AGENT_TELEGRAM_TOKEN": TELEGRAM, "AGENT_ALLOWED_USERS": "12345678"}
    report = "\n".join(
        setup.init(
            _args(tmp_path), _settings(tmp_path), setup.Prompter(False, given), docker
        )
    )
    assert report.count("Kept") == 3
    given["AGENT_ALLOWED_USERS"] = "12345678, 555"
    setup.init(
        _args(tmp_path), _settings(tmp_path), setup.Prompter(False, given), docker
    )
    assert (secrets / "telegram-token").read_text() == TELEGRAM
    assert (secrets / "allowed-users").read_text() == "12345678,555"
    assert (secrets / "mcp-token").read_text() == TOKEN
    assert not any("crate.agent_credentials_cli" in call for call in docker.calls)


def test_an_explicit_model_key_replaces_the_stored_one(tmp_path):
    setup = _setup()
    secrets = tmp_path / "data/crate-agent/secrets"
    _write_secrets(secrets)
    (secrets / "model-keys").mkdir()
    (secrets / "model-keys/anthropic").write_text("sk-ant-old-0123")
    model = {"CRATE_AGENT_PROVIDER": "anthropic", "CRATE_AGENT_MODEL": "claude-x"}
    for key, expected in (
        ("", "sk-ant-old-0123"),
        ("sk-ant-new-4567", "sk-ant-new-4567"),
    ):
        given = {**model, "AGENT_MODEL_API_KEY": key} if key else model
        setup.init(
            _args(tmp_path),
            _settings(tmp_path),
            setup.Prompter(False, given),
            FakeDocker(),
        )
        assert (secrets / "model-keys/anthropic").read_text() == expected


@pytest.mark.parametrize(
    ("variables", "message"),
    [
        ({"AGENT_TELEGRAM_TOKEN": "not-a-token"}, "BotFather"),
        (
            {"AGENT_TELEGRAM_TOKEN": TELEGRAM, "AGENT_ALLOWED_USERS": "@me"},
            "numeric Telegram user IDs",
        ),
        (
            {
                "AGENT_TELEGRAM_TOKEN": TELEGRAM,
                "AGENT_ALLOWED_USERS": "1",
                "CRATE_AGENT_PROVIDER": "anthropic",
                "CRATE_AGENT_MODEL": "claude",
            },
            "needs an API key",
        ),
    ],
)
def test_init_rejects_invalid_input_with_clear_errors(
    tmp_path, monkeypatch, variables, message
):
    setup = _setup()
    for key, value in variables.items():
        monkeypatch.setenv(key, value)
    with pytest.raises(setup.SetupError, match=message):
        setup.init(
            _args(tmp_path),
            _settings(tmp_path, **variables),
            setup.Prompter(False),
            FakeDocker(),
        )


def test_init_stores_the_model_key_for_api_providers(tmp_path, monkeypatch):
    setup = _setup()
    for key, value in {
        "AGENT_TELEGRAM_TOKEN": TELEGRAM,
        "AGENT_ALLOWED_USERS": "1",
        "CRATE_AGENT_PROVIDER": "openrouter",
        "CRATE_AGENT_MODEL": "anthropic/claude-sonnet",
        "AGENT_MODEL_API_KEY": "sk-or-0123456789",
    }.items():
        monkeypatch.setenv(key, value)
    setup.init(
        _args(tmp_path), _settings(tmp_path), setup.Prompter(False), FakeDocker()
    )
    key = tmp_path / "data/crate-agent/secrets/model-keys/openrouter"
    assert key.read_text() == "sk-or-0123456789"
    assert _mode(key) == 0o600
    assert _mode(key.parent) == 0o700
    env = (tmp_path / ".env").read_text()
    assert "CRATE_AGENT_PROVIDER=openrouter" in env
    assert "sk-or-" not in env


def test_operator_init_binds_identity_principal_and_native_files(tmp_path, monkeypatch):
    setup = _setup()
    monkeypatch.setenv("AGENT_TELEGRAM_TOKEN", TELEGRAM)
    monkeypatch.setenv("AGENT_ALLOWED_USERS", "12345678")
    docker = FakeDocker()
    setup.init(
        _args(tmp_path, profile="operator"),
        _settings(tmp_path),
        setup.Prompter(False),
        docker,
    )
    env = (tmp_path / ".env").read_text()
    assert "CRATE_MCP_ACTIONS_ENABLED=true" in env
    assert f"CRATE_OPERATOR_PRINCIPAL_IDS={PRINCIPAL}" in env
    instance = re.search(r"CRATE_AGENT_INSTANCE_ID=(crate-[a-f0-9]{12})", env)[1]
    native = tmp_path / "data/crate-operator/secrets/domain-native"
    assert len((native / "callback-key").read_text()) == 64
    assert _mode(native / "callback-key") == 0o600
    assert json.loads((native / "identity.json").read_text()) == {
        "instance_id": instance,
        "allowed_users": [12345678],
    }
    create = next(
        call for call in docker.calls if "crate.agent_credentials_cli" in call
    )
    assert create[create.index("--name") + 1] == "Crate Operator"
    assert (tmp_path / "data/crate-operator/secrets/domain/mcp-token").is_file()


def test_init_starts_logs_in_guidance_and_runs_the_smoke_test(tmp_path, monkeypatch):
    setup = _setup()
    monkeypatch.setenv("AGENT_TELEGRAM_TOKEN", TELEGRAM)
    monkeypatch.setenv("AGENT_ALLOWED_USERS", "1")
    docker = FakeDocker()
    report = "\n".join(
        setup.init(
            _args(tmp_path, no_start=False),
            _settings(tmp_path, PUID="1001", PGID="1002"),
            setup.Prompter(False),
            docker,
        )
    )
    assert any(call[-1] == "crate-api" and "up" in call for call in docker.calls)
    assert any(
        call[-4:] == ["up", "-d", "--no-deps", "crate-agent"] for call in docker.calls
    )
    check = next(call for call in docker.calls if "--check" in call)
    assert check[:5] == ["docker", "exec", "-u", "1001:1002", "crate-agent"]
    assert any("-z" in call and "memory" in call for call in docker.calls)
    assert "make agent-auth" in report
    assert "Smoke test passed" in report


def test_start_refuses_to_run_both_profiles(tmp_path):
    setup = _setup()
    with pytest.raises(setup.SetupError, match="Never run"):
        setup.start(
            _args(tmp_path, profile="operator"),
            _settings(tmp_path),
            FakeDocker(running=("crate-agent",)),
        )


def test_model_switch_updates_env_and_recreates_only_the_agent(tmp_path):
    setup = _setup()
    secrets = tmp_path / "data/crate-agent/secrets"
    _write_secrets(secrets)
    (secrets / "model-keys").mkdir()
    (secrets / "model-keys/anthropic").write_text("sk-ant-0123456789")
    docker = FakeDocker()
    args = _args(tmp_path, provider="anthropic", model="claude-sonnet-5")
    report = setup.model_command(
        args, _settings(tmp_path), setup.Prompter(False), docker
    )
    env = (tmp_path / ".env").read_text()
    assert "CRATE_AGENT_PROVIDER=anthropic\n" in env
    assert "CRATE_AGENT_MODEL=claude-sonnet-5\n" in env
    assert "CRATE_AGENT_BASE_URL=\n" in env
    assert docker.calls[-1][-4:] == ["up", "-d", "--no-deps", "crate-agent"]
    assert "--profile" in docker.calls[-1]
    assert "Recreated crate-agent" in report


@pytest.mark.parametrize(
    ("provider", "model", "base_url", "message"),
    [
        ("ollama", "llama3", "", "Unknown provider"),
        ("deepseek", "deepseek-chat", "", "API key"),
        ("custom", "qwen3", "", "CRATE_AGENT_BASE_URL is required"),
    ],
)
def test_model_switch_fails_fast(tmp_path, provider, model, base_url, message):
    setup = _setup()
    _write_secrets(tmp_path / "data/crate-agent/secrets")
    docker = FakeDocker()
    with pytest.raises(setup.SetupError, match=message):
        setup.model_command(
            _args(tmp_path, provider=provider, model=model, base_url=base_url),
            _settings(tmp_path),
            setup.Prompter(False),
            docker,
        )
    assert docker.calls == []
    assert not (tmp_path / ".env").exists()


def test_optional_operator_services_start_only_when_provisioned(tmp_path, monkeypatch):
    setup = _setup()
    monkeypatch.setattr(setup, "INFRA_SOCKET", tmp_path / "bridge.sock")
    settings = _settings(tmp_path)
    assert setup.scale_args(settings) == [
        "--scale",
        "crate-operator-supervisor=0",
        "--scale",
        "crate-infra-relay=0",
    ]
    root = tmp_path / "data/crate-operator"
    root.mkdir(parents=True)
    (root / "supervisor-config.json").write_text("{}")
    (tmp_path / "bridge.sock").write_text("")
    assert setup.scale_args(settings) == []


def test_agent_check_needs_flags_secrets_and_a_valid_model(tmp_path):
    setup = _setup()
    settings = _settings(tmp_path, CRATE_MCP_ENABLED="false")
    problems = "\n".join(setup.agent_problems(settings))
    assert "CRATE_MCP_ENABLED=true" in problems
    assert "Missing secret file" in problems
    _write_secrets(tmp_path / "data/crate-agent/secrets")
    settings["CRATE_MCP_ENABLED"] = "true"
    assert setup.agent_problems(settings) == []
    settings["CRATE_AGENT_PROVIDER"] = "gemini"
    settings["CRATE_AGENT_MODEL"] = "gemini-pro"
    assert any("model-keys/gemini" in item for item in setup.agent_problems(settings))


@pytest.mark.parametrize(
    ("values", "ok"),
    [
        ({"DOMAIN": "crate.example.test"}, True),
        ({"DOMAIN": ""}, False),
        ({"DOMAIN": "", "CRATE_AGENT_MCP_HOST": "localhost:8585"}, True),
        (
            {
                "CRATE_AGENT_MCP_HOST": "mcp.example.test",
                "CRATE_MCP_ALLOWED_HOSTS": "api.crate.example.test",
            },
            False,
        ),
        (
            {
                "CRATE_AGENT_MCP_HOST": "mcp.example.test",
                "CRATE_MCP_ALLOWED_HOSTS": "api.crate.example.test,mcp.example.test",
            },
            True,
        ),
    ],
)
def test_mcp_host_must_be_derivable_and_allowed(tmp_path, values, ok):
    problems = _setup().host_problems(_settings(tmp_path, **values))
    assert (problems == []) is ok


def test_settings_prefer_the_shell_over_the_env_file(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text('# comment\nDOMAIN="file.example"\nDATA_DIR=./data\n')
    settings = _setup().load_settings(env_file, {"DOMAIN": "shell.example"})
    assert settings["DOMAIN"] == "shell.example"
    assert settings["DATA_DIR"] == "./data"


def test_operator_overlay_works_with_the_base_compose_alone():
    setup = _setup()
    overlay = ROOT / "deploy/operator/compose.operator.yaml"
    assert setup.overlay_problems("docker-compose.yaml", overlay) == []
    assert (
        setup.overlay_problems(
            "docker-compose.yaml:docker-compose.project.yaml", overlay
        )
        == []
    )


def test_operator_check_reports_missing_identity_and_flags(tmp_path):
    problems = "\n".join(
        _setup().operator_problems(
            _settings(tmp_path, CRATE_OPERATOR_ROOT=str(tmp_path / "missing")),
            "docker-compose.yaml",
            ROOT / "deploy/operator/compose.operator.yaml",
        )
    )
    assert "CRATE_MCP_ACTIONS_ENABLED=true" in problems
    assert "CRATE_OPERATOR_PRINCIPAL_IDS" in problems
    assert "CRATE_AGENT_INSTANCE_ID" in problems
    assert "make agent-init AGENT_PROFILE=operator" in problems


def test_env_example_documents_every_agent_variable():
    compose = yaml.safe_load((ROOT / "docker-compose.yaml").read_text())
    sources = (
        str(compose["services"]["crate-agent"]),
        (ROOT / "deploy/operator/compose.operator.yaml").read_text(),
    )
    variables = set()
    for text in sources:
        variables |= set(re.findall(r"\$\{([A-Z0-9_]+)", text))
    documented = set(
        re.findall(r"^([A-Z0-9_]+)=", (ROOT / ".env.example").read_text(), re.M)
    )
    assert variables - documented == set()
    assert {
        "CRATE_AGENT_IMAGE",
        "CRATE_AGENT_MCP_URL",
        "CRATE_AGENT_MCP_HOST",
        "CRATE_AGENT_PROVIDER",
        "CRATE_AGENT_MODEL",
        "CRATE_AGENT_BASE_URL",
        "CRATE_OPERATOR_ROOT",
        "CRATE_OPERATOR_PRINCIPAL_IDS",
        "CRATE_AGENT_INSTANCE_ID",
        "CRATE_INFRA_RELAY_GID",
        "CRATE_MCP_ENABLED",
        "CRATE_MCP_ACTIONS_ENABLED",
        "CRATE_MCP_ALLOWED_HOSTS",
    } <= documented


def test_agent_presets_only_grant_scopes_the_credential_cli_accepts():
    from crate.agent_access import ALLOWED_GRANTS
    from crate.agent_scope_catalog import SCOPE_PRESETS

    setup = _setup()
    presets = {preset.id: preset for preset in SCOPE_PRESETS}
    for profile in setup.PROFILES.values():
        scopes = set(presets[profile.preset].scopes)
        assert scopes and scopes <= ALLOWED_GRANTS
        assert presets[profile.preset].label == profile.preset_label


def _operator_env(monkeypatch, users="12345678,87654321", **extra):
    monkeypatch.setenv("AGENT_TELEGRAM_TOKEN", TELEGRAM)
    monkeypatch.setenv("AGENT_ALLOWED_USERS", users)
    for key, value in extra.items():
        monkeypatch.setenv(key, value)


def _operator_init(setup, tmp_path, docker, **args):
    env_file = tmp_path / ".env"
    settings = setup.load_settings(env_file, _settings(tmp_path))
    return "\n".join(
        setup.init(
            _args(tmp_path, profile="operator", **args),
            settings,
            setup.Prompter(False),
            docker,
        )
    )


def test_operator_credential_requires_approval_and_the_approver_is_bound(
    tmp_path, monkeypatch
):
    setup = _setup()
    _operator_env(
        monkeypatch,
        AGENT_APPROVER_EMAIL="admin@example.test",
        AGENT_APPROVER_TELEGRAM_ID="87654321",
    )
    docker = FakeDocker()
    report = _operator_init(setup, tmp_path, docker)
    operator, supervisor = docker.cli_calls("create")
    assert "--require-approval" in operator
    assert operator[operator.index("--name") + 1] == "Crate Operator"
    assert "--require-approval" not in supervisor
    assert supervisor[supervisor.index("--name") + 1] == setup.SUPERVISOR_NAME
    assert [supervisor[i + 1] for i, a in enumerate(supervisor) if a == "--grant"] == [
        "library.health.read",
        "ops.jobs.read",
        "ops.status.read",
    ]
    instance = re.search(
        r"CRATE_AGENT_INSTANCE_ID=(\S+)", (tmp_path / ".env").read_text()
    )[1]
    bind = next(call for call in docker.calls if "bind-approver" in call)
    assert bind[:4] == ["docker", "exec", "-e", f"CRATE_AGENT_INSTANCE_ID={instance}"]
    assert bind[bind.index("--principal-id") + 1] == PRINCIPAL
    assert bind[bind.index("--telegram-user-id") + 1] == "87654321"
    assert bind[bind.index("--user-email") + 1] == "admin@example.test"
    assert "Bound admin@example.test" in report
    assert "Telegram approver, connection" not in report


def test_operator_approver_must_be_an_allowed_telegram_user(tmp_path, monkeypatch):
    setup = _setup()
    _operator_env(
        monkeypatch,
        AGENT_APPROVER_EMAIL="admin@example.test",
        AGENT_APPROVER_TELEGRAM_ID="555",
    )
    with pytest.raises(setup.SetupError, match="allowed users"):
        _operator_init(setup, tmp_path, FakeDocker())


def test_operator_without_approver_email_points_to_the_admin_binding(
    tmp_path, monkeypatch
):
    setup = _setup()
    _operator_env(monkeypatch)
    docker = FakeDocker()
    report = _operator_init(setup, tmp_path, docker)
    assert not docker.cli_calls("bind-approver")
    assert "AGENT_APPROVER_EMAIL" in report
    assert "Admin > Agents > Connections > Telegram approver" in report


def test_operator_init_provisions_supervisor_delivery_to_the_approver(
    tmp_path, monkeypatch
):
    setup = _setup()
    monkeypatch.setattr(setup, "INFRA_SOCKET", tmp_path / "bridge.sock")
    _operator_env(
        monkeypatch,
        AGENT_APPROVER_EMAIL="admin@example.test",
        AGENT_APPROVER_TELEGRAM_ID="87654321",
    )
    docker = FakeDocker()
    _operator_init(setup, tmp_path, docker)
    root = tmp_path / "data/crate-operator"
    secrets = root / "secrets"
    supervisor_token = (secrets / "supervisor/operator_mcp_read").read_text()
    assert setup.MCP_TOKEN.fullmatch(supervisor_token)
    assert supervisor_token != (secrets / "domain/mcp-token").read_text()
    values = []
    for primary, copy in setup.SUPERVISOR_SHARED_KEYS:
        value = (secrets / primary).read_text()
        assert len(value) >= 32
        assert (secrets / copy).read_text() == value
        assert _mode(secrets / primary) == _mode(secrets / copy) == 0o600
        values.append(value)
    assert len(set(values + [supervisor_token])) == 4
    assert (secrets / "delivery/destination").read_text() == "87654321"
    instance = re.search(
        r"CRATE_AGENT_INSTANCE_ID=(\S+)", (tmp_path / ".env").read_text()
    )[1]
    assert json.loads((secrets / "supervisor-native/identity.json").read_text()) == {
        "instance_id": instance,
        "allowed_users": [12345678, 87654321],
    }
    config = json.loads((root / "supervisor-config.json").read_text())
    example = json.loads(setup.SUPERVISOR_EXAMPLE.read_text())
    assert config["instance"] == instance
    assert config["mcp_host"] == "api.crate.example.test"
    assert config["allowed_operators"] == ["telegram:12345678", "telegram:87654321"]
    assert config["rules"] == example["rules"]
    assert {(rule["subsystem"], rule["id"]) for rule in config["rules"]} >= {
        ("instance", "health-score"),
        ("tasks", "failed-tasks"),
        ("library", "new-releases"),
    }
    assert setup.scale_args(_settings(tmp_path)) == [
        "--scale",
        "crate-infra-relay=0",
    ]
    assert setup.supervisor_problems(root) == []


def test_supervisor_config_and_secrets_load_in_the_real_supervisor(
    tmp_path, monkeypatch
):
    import sys

    setup = _setup()
    _operator_env(monkeypatch)
    _operator_init(setup, tmp_path, FakeDocker())
    root = tmp_path / "data/crate-operator"
    config = json.loads((root / "supervisor-config.json").read_text())
    mounted = root / "secrets/supervisor"
    for field in (
        "mcp_token_file",
        "api_token_file",
        "webhook_secret_file",
        "human_callback_secret_file",
    ):
        config[field] = str(mounted / Path(config[field]).name)
    config["state_directory"] = str(root / "supervisor-state")
    adapted = tmp_path / "config.json"
    adapted.write_text(json.dumps(config))
    monkeypatch.syspath_prepend(str(ROOT))
    sys.modules.pop("deploy.operator.server", None)
    from deploy.operator import server

    server.main(["--config", str(adapted), "--check"])


def test_rerun_keeps_supervisor_secrets_binding_and_config_edits(tmp_path, monkeypatch):
    setup = _setup()
    _operator_env(
        monkeypatch,
        AGENT_APPROVER_EMAIL="admin@example.test",
        AGENT_APPROVER_TELEGRAM_ID="87654321",
    )
    docker = FakeDocker()
    _operator_init(setup, tmp_path, docker)
    root = tmp_path / "data/crate-operator"
    before = {
        path: path.read_text()
        for path in (root / "secrets").rglob("*")
        if path.is_file()
    }
    config = json.loads((root / "supervisor-config.json").read_text())
    config["poll_seconds"] = 60
    (root / "supervisor-config.json").write_text(json.dumps(config))
    monkeypatch.delenv("AGENT_APPROVER_EMAIL")
    _operator_init(setup, tmp_path, docker)
    after = {
        path: path.read_text()
        for path in (root / "secrets").rglob("*")
        if path.is_file()
    }
    assert after == before
    assert len(docker.cli_calls("create")) == 2
    assert len(docker.cli_calls("bind-approver")) == 1
    assert docker.revoked == []
    assert (
        json.loads((root / "supervisor-config.json").read_text())["poll_seconds"] == 60
    )


def test_mismatched_shared_key_is_never_overwritten_silently(tmp_path, monkeypatch):
    setup = _setup()
    _operator_env(monkeypatch)
    secrets = tmp_path / "data/crate-operator/secrets"
    (secrets / "supervisor").mkdir(parents=True)
    (secrets / "delivery").mkdir(parents=True)
    (secrets / "supervisor/operator_webhook").write_text("w" * 40)
    (secrets / "delivery/secret").write_text("d" * 40)
    report = _operator_init(setup, tmp_path, FakeDocker())
    assert (secrets / "delivery/secret").read_text() == "d" * 40
    assert "Warning: kept" in report
    _operator_init(setup, tmp_path, FakeDocker(), replace=True)
    assert (secrets / "delivery/secret").read_text() == "w" * 40


def test_replace_revokes_previous_credentials_and_swaps_the_principal(
    tmp_path, monkeypatch
):
    setup = _setup()
    _operator_env(monkeypatch)
    docker = FakeDocker()
    _operator_init(setup, tmp_path, docker)
    secrets = tmp_path / "data/crate-operator/secrets"
    first_supervisor = (secrets / "supervisor/operator_mcp_read").read_text()
    webhook = (secrets / "delivery/secret").read_text()
    env_file = tmp_path / ".env"
    setup.set_env_values(
        env_file, {"CRATE_OPERATOR_PRINCIPAL_IDS": f"keep-me,{PRINCIPAL}"}
    )
    report = _operator_init(setup, tmp_path, docker, replace=True)
    new_token = (secrets / "domain/mcp-token").read_text()
    assert new_token != TOKEN
    new_principal = docker.issued[new_token]["principal_id"]
    assert docker.revoked == [
        docker.issued[TOKEN]["credential_id"],
        docker.issued[first_supervisor]["credential_id"],
    ]
    assert TOKEN + "\n" in docker.inputs
    assert (
        f"CRATE_OPERATOR_PRINCIPAL_IDS=keep-me,{new_principal}\n"
        in env_file.read_text()
    )
    assert (
        PRINCIPAL
        not in re.search(r"CRATE_OPERATOR_PRINCIPAL_IDS=(\S+)", env_file.read_text())[1]
    )
    assert (secrets / "delivery/secret").read_text() == webhook
    assert "Revoked the replaced credential" in report


def test_replace_on_crate_agent_revokes_the_old_credential(tmp_path, monkeypatch):
    setup = _setup()
    secrets = tmp_path / "data/crate-agent/secrets"
    _write_secrets(secrets)
    docker = FakeDocker()
    docker.known(TOKEN, "f" * 32, "old-credential")
    _operator_env(monkeypatch)
    setup.init(
        _args(tmp_path, replace=True),
        _settings(tmp_path),
        setup.Prompter(False),
        docker,
    )
    assert docker.revoked == ["old-credential"]
    assert "CRATE_OPERATOR_PRINCIPAL_IDS" not in (tmp_path / ".env").read_text()


def test_kept_operator_credential_gets_approval_and_its_principal(
    tmp_path, monkeypatch
):
    setup = _setup()
    secrets = tmp_path / "data/crate-operator/secrets/domain"
    _write_secrets(secrets)
    docker = FakeDocker()
    docker.known(TOKEN, "e" * 32, "kept", approval=False)
    _operator_env(monkeypatch)
    report = _operator_init(setup, tmp_path, docker)
    assert docker.approval == {"e" * 32: True}
    assert f"CRATE_OPERATOR_PRINCIPAL_IDS={'e' * 32}" in (tmp_path / ".env").read_text()
    assert "now need approval" in report
    assert docker.revoked == []


def test_operator_check_reports_an_incomplete_supervisor(tmp_path):
    setup = _setup()
    root = tmp_path / "data/crate-operator"
    root.mkdir(parents=True)
    (root / "supervisor-config.json").write_text("{}")
    problems = "\n".join(setup.supervisor_problems(root))
    assert "secrets/supervisor/operator_mcp_read" in problems
    assert "secrets/delivery/secret" in problems


def test_model_switch_refuses_a_missing_key_with_a_clear_message(tmp_path):
    setup = _setup()
    _write_secrets(tmp_path / "data/crate-agent/secrets")
    docker = FakeDocker()
    with pytest.raises(setup.SetupError) as error:
        setup.model_command(
            _args(tmp_path, provider="gemini", model="gemini-pro"),
            _settings(tmp_path),
            setup.Prompter(False),
            docker,
        )
    assert "model-keys/gemini" in str(error.value)
    assert "AGENT_MODEL_API_KEY" in str(error.value)
    assert docker.calls == []


def test_model_switch_stores_one_key_per_provider(tmp_path, monkeypatch):
    setup = _setup()
    secrets = tmp_path / "data/crate-agent/secrets"
    _write_secrets(secrets)
    monkeypatch.setenv("AGENT_MODEL_API_KEY", "sk-ant-0123456789")
    setup.model_command(
        _args(tmp_path, provider="anthropic", model="claude"),
        _settings(tmp_path),
        setup.Prompter(False),
        FakeDocker(),
    )
    monkeypatch.setenv("AGENT_MODEL_API_KEY", "sk-or-0123456789")
    settings = setup.load_settings(tmp_path / ".env", _settings(tmp_path))
    setup.model_command(
        _args(tmp_path, provider="openrouter", model="a/b"),
        settings,
        setup.Prompter(False),
        FakeDocker(),
    )
    assert (secrets / "model-keys/anthropic").read_text() == "sk-ant-0123456789"
    assert (secrets / "model-keys/openrouter").read_text() == "sk-or-0123456789"
    monkeypatch.setenv("AGENT_MODEL_API_KEY", "two words here")
    with pytest.raises(setup.SetupError, match="without spaces"):
        setup.model_command(
            _args(tmp_path, provider="gemini", model="g"),
            settings,
            setup.Prompter(False),
            FakeDocker(),
        )


def test_model_switch_migrates_the_legacy_key_to_its_provider(tmp_path):
    setup = _setup()
    secrets = tmp_path / "data/crate-agent/secrets"
    _write_secrets(secrets)
    (secrets / "model-api-key").write_text("sk-ant-0123456789")
    settings = _settings(
        tmp_path, CRATE_AGENT_PROVIDER="anthropic", CRATE_AGENT_MODEL="claude"
    )
    with pytest.raises(setup.SetupError, match="model-keys/deepseek"):
        setup.model_command(
            _args(tmp_path, provider="deepseek", model="deepseek-chat"),
            settings,
            setup.Prompter(False),
            FakeDocker(),
        )
    assert not (secrets / "model-api-key").exists()
    assert (secrets / "model-keys/anthropic").read_text() == "sk-ant-0123456789"
    assert _mode(secrets / "model-keys/anthropic") == 0o600
    report = setup.model_command(
        _args(tmp_path, provider="anthropic", model="claude-2"),
        settings,
        setup.Prompter(False),
        FakeDocker(),
    )
    assert "Recreated crate-agent" in report


def test_legacy_key_of_an_unknown_provider_is_not_guessed(tmp_path):
    setup = _setup()
    runtime = setup.runtime_module()
    secrets = tmp_path / "secrets"
    secrets.mkdir()
    (secrets / "model-api-key").write_text("sk-0123456789")
    paths = setup.Layout(tmp_path, tmp_path / "home", secrets, tmp_path / "context")
    report = setup.migrate_legacy_key(paths, _settings(tmp_path), runtime)
    assert "unknown" in report[0]
    assert (secrets / "model-api-key").exists()
    assert not (secrets / "model-keys").exists()


def test_operator_check_requires_the_provenance_directory(tmp_path):
    setup = _setup()
    settings = _settings(tmp_path)
    overlay = ROOT / "deploy/operator/compose.operator.yaml"
    (tmp_path / "data/crate-operator").mkdir(parents=True)
    problems = "\n".join(
        setup.operator_problems(settings, "docker-compose.yaml", overlay)
    )
    assert "crate-operator/provenance is missing" in problems
    setup.prepare_layout(settings, "operator")
    problems = "\n".join(
        setup.operator_problems(settings, "docker-compose.yaml", overlay)
    )
    assert "provenance is missing" not in problems


@pytest.mark.parametrize(
    ("observation", "expected"),
    [
        (None, "not published yet"),
        (
            {
                "state": "verified",
                "mode": "image",
                "observed_at": 1000,
                "identity": {"release_sha": "a" * 40, "images": {"crate-api": {}}},
            },
            "verified (image mode, release aaaaaaaaaaaa, 1 services)",
        ),
        (
            {"state": "unverified", "reason": "unofficial_image:crate-api"},
            "unverified (unofficial_image:crate-api)",
        ),
        ({"state": "verified", "observed_at": 800}, "last published 200s ago"),
    ],
)
def test_status_reports_the_published_provenance(tmp_path, observation, expected):
    setup = _setup()
    settings = _settings(tmp_path)
    if observation is not None:
        evidence = tmp_path / "data/crate-operator/provenance"
        evidence.mkdir(parents=True)
        observation.setdefault("observed_at", 990)
        (evidence / "observation.json").write_text(json.dumps(observation))
    (line,) = setup.provenance_report(settings, now=1000)
    assert expected in line


def test_an_explicit_approver_email_rebinds_the_approver(tmp_path, monkeypatch):
    setup = _setup()
    _operator_env(
        monkeypatch,
        AGENT_APPROVER_EMAIL="admin@example.test",
        AGENT_APPROVER_TELEGRAM_ID="87654321",
    )
    docker = FakeDocker()
    _operator_init(setup, tmp_path, docker)
    monkeypatch.setenv("AGENT_APPROVER_EMAIL", "other@example.test")
    monkeypatch.setenv("AGENT_APPROVER_TELEGRAM_ID", "12345678")
    report = _operator_init(setup, tmp_path, docker)
    rebind = docker.cli_calls("bind-approver")[-1]
    assert len(docker.cli_calls("bind-approver")) == 2
    assert rebind[rebind.index("--user-email") + 1] == "other@example.test"
    assert "Bound other@example.test (Telegram user 12345678)" in report


def test_env_values_keep_the_owner_when_written_as_root(tmp_path, monkeypatch):
    setup = _setup()
    env_file = tmp_path / ".env"
    env_file.write_text("A=1\n")
    owner = (env_file.stat().st_uid, env_file.stat().st_gid)
    calls = []
    monkeypatch.setattr(setup.os, "geteuid", lambda: 0)
    monkeypatch.setattr(setup.os, "chown", lambda path, *ids: calls.append(ids))
    setup.set_env_values(env_file, {"A": "2"})
    assert calls == [owner]
    assert env_file.read_text() == "A=2\n"


def test_settings_read_the_values_the_installer_quotes(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text('DATA_DIR="/srv/crate \\"data\\" \\$HOME"\nPUID=\'1001\'\n')
    settings = _setup().load_settings(env_file, {})
    assert settings["DATA_DIR"] == '/srv/crate "data" $HOME'
    assert settings["PUID"] == "1001"


def test_in_container_init_runs_the_credential_cli_locally_and_starts_nothing(
    tmp_path, monkeypatch
):
    setup = _setup()
    monkeypatch.setattr(setup, "IN_CONTAINER", True)
    docker = FakeDocker(running=())
    given = {
        "AGENT_TELEGRAM_TOKEN": TELEGRAM,
        "AGENT_ALLOWED_USERS": "1",
        "AGENT_SETUP_COMMAND": "crate configure agent",
    }
    settings = _settings(tmp_path, **given)
    report = "\n".join(
        setup.init(
            _args(tmp_path, no_start=False),
            settings,
            setup.Prompter(False, given),
            docker,
        )
    )
    assert not any(call[0] == "docker" for call in docker.calls)
    create = docker.cli_calls("create")[0]
    call = next(call for call in docker.calls if call[-len(create) :] == create)
    assert call[:4] == [
        "env",
        setup.sys.executable,
        "-m",
        "crate.agent_credentials_cli",
    ]
    assert (tmp_path / "data/crate-agent/secrets/mcp-token").read_text() == TOKEN
    assert "crate configure agent changes the bot" in report
    assert "make agent" not in report


def test_in_container_settings_ignore_the_container_environment(tmp_path, monkeypatch):
    setup = _setup()
    env_file = tmp_path / ".env"
    env_file.write_text(f"DATA_DIR={tmp_path / 'data'}\nDOMAIN=crate.example.test\n")
    monkeypatch.setenv("DATA_DIR", "/data")
    monkeypatch.setenv("AGENT_ALLOWED_USERS", "12345678")
    seen = {}

    def check(settings):
        seen.update(settings)
        return []

    monkeypatch.setattr(setup, "agent_problems", check)
    monkeypatch.setattr(setup, "container_running", lambda *args: False)
    assert setup.main(["check", "--in-container", "--env-file", str(env_file)]) == 0
    assert seen["DATA_DIR"] == str(tmp_path / "data")
    assert seen["AGENT_ALLOWED_USERS"] == "12345678"
    assert setup.IN_CONTAINER is True


def test_reuse_copies_the_other_profiles_bot_allowlist_and_model_keys(
    tmp_path, monkeypatch
):
    setup = _setup()
    secrets = tmp_path / "data/crate-agent/secrets"
    _write_secrets(secrets)
    (secrets / "model-keys").mkdir()
    (secrets / "model-keys/anthropic").write_text("sk-ant-0123456789")
    monkeypatch.setenv("CRATE_AGENT_PROVIDER", "anthropic")
    monkeypatch.setenv("CRATE_AGENT_MODEL", "claude-x")
    report = _operator_init(setup, tmp_path, FakeDocker(), reuse=True)
    domain = tmp_path / "data/crate-operator/secrets/domain"
    assert (domain / "telegram-token").read_text() == TELEGRAM
    assert (domain / "allowed-users").read_text() == "12345678"
    assert (domain / "model-keys/anthropic").read_text() == "sk-ant-0123456789"
    assert _mode(domain / "model-keys") == 0o700
    assert report.count("Reused") == 3


def test_revoke_turns_a_profile_off_but_keeps_model_keys(tmp_path, monkeypatch):
    setup = _setup()
    _operator_env(monkeypatch)
    docker = FakeDocker()
    _operator_init(setup, tmp_path, docker)
    root = tmp_path / "data/crate-operator"
    supervisor = (root / "secrets/supervisor/operator_mcp_read").read_text()
    (root / "secrets/domain/model-keys").mkdir()
    (root / "secrets/domain/model-keys/anthropic").write_text("sk-ant-0123")
    env_file = tmp_path / ".env"
    setup.set_env_values(
        env_file, {"CRATE_OPERATOR_PRINCIPAL_IDS": f"keep-me,{PRINCIPAL}"}
    )
    settings = setup.load_settings(env_file, _settings(tmp_path))
    report = "\n".join(
        setup.revoke(_args(tmp_path, profile="operator"), settings, docker)
    )
    assert docker.revoked == [
        docker.issued[TOKEN]["credential_id"],
        docker.issued[supervisor]["credential_id"],
    ]
    for name in ("telegram-token", "allowed-users", "mcp-token"):
        assert not (root / "secrets/domain" / name).exists()
    assert not (root / "secrets/supervisor/operator_mcp_read").exists()
    assert (root / "secrets/domain/model-keys/anthropic").is_file()
    assert "CRATE_OPERATOR_PRINCIPAL_IDS=keep-me\n" in env_file.read_text()
    assert "Revoked the MCP credential" in report


def test_revoke_warns_about_a_credential_crate_does_not_know(tmp_path):
    setup = _setup()
    secrets = tmp_path / "data/crate-agent/secrets"
    _write_secrets(secrets)
    docker = FakeDocker()
    report = "\n".join(setup.revoke(_args(tmp_path), _settings(tmp_path), docker))
    assert docker.revoked == []
    assert "does not know the credential" in report
    assert not (secrets / "mcp-token").exists()


@pytest.mark.parametrize(
    ("answer", "command", "message"),
    [
        (
            SimpleNamespace(returncode=0, stdout="null", stderr=""),
            "crate configure agent",
            "Update Crate (run `crate install` again to download the latest images), "
            "then run `crate configure agent`",
        ),
        (
            SimpleNamespace(
                returncode=1,
                stdout="",
                stderr="ModuleNotFoundError: No module named 'crate.agent_scope_catalog'",
            ),
            "",
            "Update the stack images, then run make agent-init again",
        ),
    ],
)
def test_an_image_without_the_agent_presets_asks_to_update_crate(
    monkeypatch, answer, command, message
):
    setup = _setup()
    monkeypatch.setattr(setup, "IN_CONTAINER", True)
    monkeypatch.setenv("AGENT_SETUP_COMMAND", command)
    with pytest.raises(setup.SetupError) as error:
        setup.create_credential("agent", lambda argv, **kwargs: answer)
    assert str(error.value).startswith(
        "This Crate version does not support Crate Agent yet."
    )
    assert message in str(error.value)
    assert "StopIteration" not in str(error.value)

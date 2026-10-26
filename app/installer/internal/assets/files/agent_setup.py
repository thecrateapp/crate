#!/usr/bin/env python3
"""Guided setup and checks for Crate Agent and Crate Operator on the stack host.

Secrets are written with mode 600 and never replaced without explicit confirmation.
Non-interactive runs read AGENT_TELEGRAM_TOKEN, AGENT_ALLOWED_USERS,
AGENT_MODEL_API_KEY, AGENT_APPROVER_EMAIL and AGENT_APPROVER_TELEGRAM_ID plus
CRATE_AGENT_PROVIDER/MODEL/BASE_URL from the environment; an explicit value that
differs from the stored one replaces only that value.

--in-container runs inside a crate-api container with the install folder and the
data folder mounted at their host paths (the `crate` installer does this, so the
host needs no Python): the credential CLI runs locally and nothing is started.
"""

from __future__ import annotations

import argparse
import getpass
import importlib.util
import json
import os
import re
import secrets as tokens
import subprocess
import sys
import time
import urllib.request
import uuid
from pathlib import Path
from typing import NamedTuple

REPO = Path(__file__).resolve().parents[1]
SECRET_FILES = ("telegram-token", "allowed-users", "mcp-token")
HOST = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?(?::[0-9]{1,5})?")
TELEGRAM_TOKEN = re.compile(r"[0-9]+:[A-Za-z0-9_-]{30,}")
ALLOWED_USERS = re.compile(r"[1-9][0-9]*(,[1-9][0-9]*)*")
MCP_TOKEN = re.compile(r"crate_mcp_[A-Za-z0-9_-]{43}")
OPERATOR_SECRET_DIRS = (
    "domain",
    "domain-native",
    "infra-native",
    "supervisor-native",
    "delivery",
    "infra-client",
    "supervisor-client",
    "supervisor",
)
INFRA_SOCKET = Path("/run/crate-infra/bridge.sock")
CREDENTIAL_DAYS = 365
SUPERVISOR_NAME = "Crate Operator supervisor (read only)"
SUPERVISOR_GRANTS = ("library.health.read", "ops.jobs.read", "ops.status.read")
SUPERVISOR_EXAMPLE = REPO / "deploy/operator/config.operator.example.json"
SHARED_KEY = re.compile(r"[\x21-\x7e]{32,4096}")
MODEL_KEY = re.compile(r"[\x21-\x7e]{8,4096}")
SUPERVISOR_SHARED_KEYS = (
    ("supervisor/operator_api", "supervisor-client/read-token"),
    ("supervisor/operator_webhook", "delivery/secret"),
    ("supervisor/operator_human", "supervisor-native/callback-key"),
)
CONTAINER_ENVIRONMENT = (
    "AGENT_TELEGRAM_TOKEN",
    "AGENT_ALLOWED_USERS",
    "AGENT_MODEL_API_KEY",
    "AGENT_APPROVER_EMAIL",
    "AGENT_APPROVER_TELEGRAM_ID",
    "AGENT_SETUP_COMMAND",
    "CRATE_AGENT_PROVIDER",
    "CRATE_AGENT_MODEL",
    "CRATE_AGENT_BASE_URL",
)
IN_CONTAINER = False


class SetupError(Exception):
    pass


class Profile(NamedTuple):
    name: str
    container: str
    compose_profile: str
    preset: str
    preset_label: str
    flags: tuple


PROFILES = {
    "agent": Profile(
        "Crate Agent",
        "crate-agent",
        "agent",
        "crate_agent",
        "Crate Agent (read only)",
        ("CRATE_MCP_ENABLED",),
    ),
    "operator": Profile(
        "Crate Operator",
        "crate-operator",
        "crate-operator",
        "crate_operator",
        "Crate Operator",
        ("CRATE_MCP_ENABLED", "CRATE_MCP_ACTIONS_ENABLED"),
    ),
}


def load_settings(env_file: Path, environ=None) -> dict:
    settings = {}
    if env_file.is_file():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip().removeprefix("export ").strip()
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] == '"':
                value = re.sub(
                    r"\\(.)",
                    lambda match: "\n" if match[1] == "n" else match[1],
                    value[1:-1],
                )
            elif len(value) >= 2 and value[0] == value[-1] == "'":
                value = value[1:-1]
            settings[key] = value
    settings.update(os.environ if environ is None else environ)
    return settings


def set_env_values(env_file: Path, values: dict) -> None:
    """Replace each key's last assignment in place, appending missing keys."""
    lines = env_file.read_text().splitlines() if env_file.is_file() else []
    for key, value in values.items():
        pattern = re.compile(rf"\s*(export\s+)?{re.escape(key)}\s*=")
        matches = [index for index, line in enumerate(lines) if pattern.match(line)]
        if matches:
            lines[matches[-1]] = f"{key}={value}"
        else:
            lines.append(f"{key}={value}")
    mode, owner = 0o600, None
    if env_file.exists():
        info = env_file.stat()
        mode, owner = info.st_mode & 0o777, (info.st_uid, info.st_gid)
    staging = env_file.with_name(f".{env_file.name}.{os.getpid()}")
    staging.write_text("\n".join(lines) + "\n")
    staging.chmod(mode)
    if owner and os.geteuid() == 0:
        os.chown(staging, *owner)
    os.replace(staging, env_file)


def mcp_host(settings: dict) -> str:
    host = settings.get("CRATE_AGENT_MCP_HOST") or (
        "api." + settings["DOMAIN"] if settings.get("DOMAIN") else ""
    )
    return host if HOST.fullmatch(host) else ""


def _allowed_hosts(settings: dict) -> list:
    configured = settings.get("CRATE_MCP_ALLOWED_HOSTS") or (
        f"localhost:*,127.0.0.1:*,api.{settings.get('DOMAIN') or 'localhost'}"
    )
    return [value.strip() for value in configured.split(",") if value.strip()]


def host_problems(settings: dict) -> list:
    host = mcp_host(settings)
    if not host:
        return [
            "No MCP Host: set DOMAIN or CRATE_AGENT_MCP_HOST in .env "
            "(the API host clients use, e.g. api.example.com)"
        ]
    if not any(
        host == entry or (entry.endswith(":*") and host.startswith(entry[:-1]))
        for entry in _allowed_hosts(settings)
    ):
        return [f"Add {host} to CRATE_MCP_ALLOWED_HOSTS so crate-api accepts it"]
    return []


def flag_problems(settings: dict, names) -> list:
    return [
        f"{name}=true is required in .env (then recreate crate-api)"
        for name in names
        if settings.get(name, "false").lower() != "true"
    ]


def _data_dir(settings: dict) -> Path:
    if not settings.get("DATA_DIR"):
        raise SetupError("DATA_DIR is not set in .env")
    path = Path(settings["DATA_DIR"]).expanduser()
    return path if path.is_absolute() else REPO / path


def data_root(settings: dict) -> Path:
    return _data_dir(settings) / "crate-agent"


def operator_root(settings: dict) -> Path:
    if settings.get("CRATE_OPERATOR_ROOT"):
        return Path(settings["CRATE_OPERATOR_ROOT"])
    return _data_dir(settings) / "crate-operator"


class Layout(NamedTuple):
    root: Path
    home: Path
    secrets: Path
    context: Path


def layout(settings: dict, profile: str) -> Layout:
    if profile == "operator":
        root = operator_root(settings)
        return Layout(root, root / "home", root / "secrets/domain", root / "context")
    root = data_root(settings)
    return Layout(root, root / "home", root / "secrets", root / "context")


def runtime_module(source: Path = REPO / "deploy/hermes"):
    spec = importlib.util.spec_from_file_location(
        "crate_agent_runtime", source / "runtime.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _ids(settings: dict) -> tuple:
    return int(settings.get("PUID") or 1000), int(settings.get("PGID") or 1000)


def _chown(path: Path, settings: dict) -> None:
    if os.geteuid() == 0:
        os.chown(path, *_ids(settings), follow_symlinks=False)


def write_secret(path: Path, value: str, settings: dict) -> None:
    staging = path.with_name(f".{path.name}.{os.getpid()}")
    descriptor = os.open(staging, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as output:
        output.write(value)
    _chown(staging, settings)
    os.replace(staging, path)


def prepare_layout(settings: dict, profile: str) -> list:
    paths = layout(settings, profile)
    directories = {paths.root: 0o755, paths.home: 0o700, paths.context: 0o755}
    if profile == "operator":
        directories[paths.root / "secrets"] = 0o700
        directories[paths.context / "public"] = 0o755
        directories[paths.root / "provenance"] = 0o755
        directories[paths.root / "supervisor-state"] = 0o700
        for name in OPERATOR_SECRET_DIRS:
            directories[paths.root / "secrets" / name] = 0o700
    else:
        directories[paths.secrets] = 0o700
    report = []
    try:
        for path, mode in directories.items():
            if not path.exists():
                path.mkdir(mode=mode, parents=True)
                path.chmod(mode)
                _chown(path, settings)
                report.append(f"Created {path}")
    except PermissionError:
        raise SetupError(
            f"Cannot create {paths.root}; rerun as its owner or as root"
        ) from None
    if os.geteuid() != 0 and os.getuid() != _ids(settings)[0]:
        report.append(
            f"Warning: you are uid {os.getuid()} but the containers run as PUID "
            f"{_ids(settings)[0]}; rerun as root or fix ownership"
        )
    return report


class Prompter:
    def __init__(self, interactive: bool, environ=None):
        self.interactive = interactive
        self.environ = os.environ if environ is None else environ

    def value(self, label: str, variable: str, default: str = "", secret=False):
        provided = self.environ.get(variable, "").strip()
        if provided or not self.interactive:
            return provided or default
        suffix = f" [{default}]" if default and not secret else ""
        reader = getpass.getpass if secret else input
        return reader(f"{label}{suffix}: ").strip() or default

    def confirm(self, question: str, default: bool, assume: bool) -> bool:
        if not self.interactive:
            return assume
        answer = input(f"{question} [{'Y/n' if default else 'y/N'}]: ").strip().lower()
        return default if not answer else answer in {"y", "yes"}


def telegram_bot_name(token: str) -> str:
    request = urllib.request.Request(f"https://api.telegram.org/bot{token}/getMe")
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            payload = json.loads(response.read(65536))
    except (OSError, ValueError):
        raise SetupError(
            "Telegram rejected the bot token or is unreachable "
            "(use --no-network to skip this check)"
        ) from None
    if not payload.get("ok") or not payload.get("result", {}).get("is_bot"):
        raise SetupError("Telegram rejected the bot token")
    return payload["result"].get("username", "")


def _existing(path: Path, pattern) -> str | None:
    try:
        value = path.read_text().strip()
    except OSError:
        return None
    return value if pattern.fullmatch(value) else None


def _keep(path: Path, pattern, label: str, prompter, replace: bool, given="") -> bool:
    """An explicit value replaces a different stored one without asking."""
    current = _existing(path, pattern)
    if current is None:
        return False
    if given:
        return given == current
    return not prompter.confirm(
        f"{label} already exists in {path}. Replace it?", False, replace
    )


def _other_profile(profile: str) -> str:
    return "agent" if profile == "operator" else "operator"


def reuse_other(paths, settings, args) -> list:
    """Switching profiles: copy the other profile's bot, allowlist and model keys
    where this profile has none."""
    if not getattr(args, "reuse", False):
        return []
    source = layout(settings, _other_profile(args.profile)).secrets
    names = [("telegram-token", TELEGRAM_TOKEN), ("allowed-users", ALLOWED_USERS)]
    keys = source / "model-keys"
    if keys.is_dir():
        names += [(f"model-keys/{key.name}", MODEL_KEY) for key in keys.iterdir()]
    report = []
    for name, pattern in names:
        value = _existing(source / name, pattern)
        if value is None or (paths.secrets / name).exists():
            continue
        _private_dir((paths.secrets / name).parent, settings)
        write_secret(paths.secrets / name, value, settings)
        report.append(f"Reused {source / name}")
    return report


def ask_telegram(paths, settings, prompter, args) -> list:
    path = paths.secrets / "telegram-token"
    given = prompter.environ.get("AGENT_TELEGRAM_TOKEN", "").strip()
    if _keep(
        path, TELEGRAM_TOKEN, "A Telegram bot token", prompter, args.replace, given
    ):
        return [f"Kept {path}"]
    token = prompter.value(
        "Telegram bot token from @BotFather (/newbot)",
        "AGENT_TELEGRAM_TOKEN",
        secret=True,
    )
    if not TELEGRAM_TOKEN.fullmatch(token):
        raise SetupError(
            "A BotFather token looks like 123456789:AA... (set AGENT_TELEGRAM_TOKEN)"
        )
    bot = "" if args.no_network else telegram_bot_name(token)
    write_secret(path, token, settings)
    return [f"Stored {path}" + (f" for @{bot}" if bot else "")]


def ask_users(paths, settings, prompter, args) -> list:
    path = paths.secrets / "allowed-users"
    given = prompter.environ.get("AGENT_ALLOWED_USERS", "").replace(" ", "")
    if _keep(
        path, ALLOWED_USERS, "A Telegram allowlist", prompter, args.replace, given
    ):
        return [f"Kept {path}"]
    users = prompter.value(
        "Numeric Telegram user IDs allowed to talk to the bot, comma-separated "
        "(ask @userinfobot)",
        "AGENT_ALLOWED_USERS",
    ).replace(" ", "")
    if not ALLOWED_USERS.fullmatch(users):
        raise SetupError(
            "Allowed users must be numeric Telegram user IDs such as 12345678,87654321 "
            "(set AGENT_ALLOWED_USERS)"
        )
    write_secret(path, users, settings)
    return [f"Stored {path}"]


def run(argv, *, check=True, capture=True, timeout=120, interactive=False, input=None):
    try:
        return subprocess.run(
            argv,
            cwd=None if IN_CONTAINER else REPO,
            check=check,
            text=True,
            capture_output=capture and not interactive,
            timeout=timeout,
            input=input,
        )
    except FileNotFoundError:
        raise SetupError(f"{argv[0]} is not installed") from None
    except subprocess.CalledProcessError as error:
        detail = (error.stderr or "").strip().splitlines()
        raise SetupError(
            f"{' '.join(argv[:4])} failed" + (f": {detail[-1]}" if detail else "")
        ) from None
    except subprocess.TimeoutExpired:
        raise SetupError(f"{' '.join(argv[:4])} timed out") from None


def container_running(name: str, runner=run) -> bool:
    result = runner(
        ["docker", "inspect", "-f", "{{.State.Running}}", name], check=False
    )
    return result.returncode == 0 and result.stdout.strip() == "true"


def api_running(runner=run) -> bool:
    return IN_CONTAINER or container_running("crate-api", runner)


def crate_python(argv, *, stdin=False, environment=()) -> list:
    """Python with the crate package: crate-api, or this container itself."""
    if IN_CONTAINER:
        return ["env", *environment, sys.executable, *argv]
    command = ["docker", "exec"]
    if stdin:
        command.append("-i")
    for item in environment:
        command += ["-e", item]
    return [*command, "crate-api", "python", *argv]


def credential_cli(command, runner=run, *, instance=None, stdin=None) -> object:
    """Run crate.agent_credentials_cli inside crate-api and parse its JSON output."""
    argv = crate_python(
        ["-m", "crate.agent_credentials_cli", *command],
        stdin=stdin is not None,
        environment=[f"CRATE_AGENT_INSTANCE_ID={instance}"] if instance else (),
    )
    result = runner(argv, check=False, input=stdin)
    if result.returncode != 0:
        detail = (result.stderr or "").strip().splitlines()
        raise SetupError(
            f"crate.agent_credentials_cli {command[0]} failed"
            + (f": {detail[-1]}" if detail else "")
        )
    try:
        return json.loads(result.stdout)
    except ValueError:
        raise SetupError(
            f"crate.agent_credentials_cli {command[0]} returned unexpected output"
        ) from None


def issue_credential(name, scopes, runner=run, *, require_approval=False) -> dict:
    if not api_running(runner):
        raise SetupError("crate-api is not running; start the stack first")
    command = ["create", "--name", name, "--expires-in-days", str(CREDENTIAL_DAYS)]
    for scope in scopes:
        command += ["--grant", scope]
    if require_approval:
        command.append("--require-approval")
    issued = credential_cli(command, runner)
    if not MCP_TOKEN.fullmatch(issued.get("token", "")):
        raise SetupError("The credential CLI returned an unexpected token")
    if require_approval and issued.get("require_approval") is not True:
        raise SetupError(
            "crate-api did not confirm that changes need approval; update the stack "
            "images before setting up Crate Operator"
        )
    return issued


def create_credential(profile: str, runner=run) -> dict:
    """Issue the preset's grants with the real CLI inside crate-api."""
    if not api_running(runner):
        raise SetupError("crate-api is not running; start the stack first")
    preset = PROFILES[profile].preset
    scopes = json.loads(
        runner(
            crate_python(
                [
                    "-c",
                    "import json; from crate.agent_scope_catalog import SCOPE_PRESETS; "
                    f"print(json.dumps(next(p.scopes for p in SCOPE_PRESETS if p.id == {preset!r})))",
                ]
            )
        ).stdout
    )
    return issue_credential(
        PROFILES[profile].preset_label,
        scopes,
        runner,
        require_approval=profile == "operator",
    )


def identify_credential(token: str, runner=run) -> dict | None:
    try:
        return credential_cli(["identify"], runner, stdin=token + "\n")
    except SetupError:
        return None


def revoke_previous(token: str, runner=run) -> tuple:
    """Revoke a replaced credential so stale secrets and principals do not pile up."""
    previous = identify_credential(token, runner)
    if previous is None:
        return [
            "The replaced credential is unknown to crate-api; nothing to revoke"
        ], None
    credential_cli(["revoke", previous["credential_id"]], runner)
    return [
        f"Revoked the replaced credential {previous['credential_id']} "
        f"(principal {previous['principal_id']})"
    ], previous["principal_id"]


def ask_credential(paths, settings, prompter, args, runner=run) -> tuple:
    """Returns the report, the current principal and the principal it replaced."""
    path = paths.secrets / "mcp-token"
    existing = _existing(path, MCP_TOKEN)
    if existing and not prompter.confirm(
        f"An MCP credential already exists in {path}. Replace it?", False, args.replace
    ):
        report = [f"Kept {path}"]
        if args.profile != "operator":
            return report, None, None
        kept = identify_credential(existing, runner) if api_running(runner) else None
        if kept is None:
            return report, None, None
        if not kept["require_approval"] and prompter.confirm(
            f"The kept credential ({kept['name']}) runs changes without approval. "
            "Require approval for every change?",
            True,
            True,
        ):
            credential_cli(["require-approval", kept["principal_id"]], runner)
            report.append(
                f"Changes by principal {kept['principal_id']} now need approval"
            )
        return report, kept["principal_id"], None
    issued = create_credential(args.profile, runner)
    write_secret(path, issued["token"], settings)
    report = [
        f"Created MCP credential '{issued['name']}' (principal {issued['principal_id']}, "
        f"expires {issued['expires_at']}); stored {path}"
    ]
    previous = None
    if existing:
        revoked, previous = revoke_previous(existing, runner)
        report += revoked
    return report, issued["principal_id"], previous


def ask_model(paths, settings, prompter, args, runtime) -> tuple:
    names = ", ".join(runtime.PROVIDERS)
    provider = prompter.value(
        f"Model provider ({names})",
        "CRATE_AGENT_PROVIDER",
        settings.get("CRATE_AGENT_PROVIDER") or runtime.DEFAULT_PROVIDER,
    )
    if provider not in runtime.PROVIDERS:
        raise SetupError(f"Unknown provider {provider}; use one of {names}")
    current = settings.get("CRATE_AGENT_MODEL") or ""
    if settings.get("CRATE_AGENT_PROVIDER", runtime.DEFAULT_PROVIDER) != provider:
        current = ""
    model = prompter.value(
        "Model",
        "CRATE_AGENT_MODEL",
        current
        or (runtime.DEFAULT_MODEL if provider == runtime.DEFAULT_PROVIDER else ""),
    )
    spec = runtime.PROVIDERS[provider]
    base_url = ""
    if spec.base_url_env or spec.base_url_required:
        base_url = prompter.value(
            "Base URL" + ("" if spec.base_url_required else " (empty for the default)"),
            "CRATE_AGENT_BASE_URL",
            settings.get("CRATE_AGENT_BASE_URL", ""),
        )
    report = migrate_legacy_key(paths, settings, runtime)
    if spec.key_env or provider == "custom":
        report += ask_model_key(paths, settings, prompter, args, provider, runtime)
    values = {
        "CRATE_AGENT_PROVIDER": provider,
        "CRATE_AGENT_MODEL": model,
        "CRATE_AGENT_BASE_URL": base_url,
    }
    try:
        runtime.model_settings(paths.secrets, values)
    except runtime.ConfigurationError as error:
        raise SetupError(str(error)) from None
    return report, values


def _private_dir(path: Path, settings: dict) -> None:
    if not path.is_dir():
        path.mkdir(mode=0o700, parents=True)
        path.chmod(0o700)
        _chown(path, settings)


def migrate_legacy_key(paths, settings, runtime) -> list:
    """Move the single key of older setups to the provider it was stored for."""
    legacy = paths.secrets / runtime.LEGACY_MODEL_KEY_FILE
    keys = paths.secrets / runtime.MODEL_KEYS_DIR
    if not legacy.is_file() or keys.exists():
        return []
    provider = settings.get("CRATE_AGENT_PROVIDER") or runtime.DEFAULT_PROVIDER
    spec = runtime.PROVIDERS.get(provider)
    if spec is None or not (spec.key_env or provider == "custom"):
        return [
            f"Ignoring {legacy}: the configured provider {provider} takes no API key, "
            "so the key's provider is unknown; enter it again for its provider"
        ]
    _private_dir(keys, settings)
    target = runtime.model_key_path(paths.secrets, provider)
    write_secret(target, legacy.read_text().strip(), settings)
    legacy.unlink()
    return [f"Moved {legacy} to {target}"]


def ask_model_key(paths, settings, prompter, args, provider, runtime) -> list:
    spec = runtime.PROVIDERS[provider]
    path = runtime.model_key_path(paths.secrets, provider)
    given = prompter.environ.get("AGENT_MODEL_API_KEY", "").strip()
    stored = path.read_text().strip() if path.is_file() else ""
    if stored and (
        given == stored
        if given
        else not prompter.confirm(
            f"An API key for {provider} already exists in {path}. Replace it?",
            False,
            args.replace,
        )
    ):
        return [f"Kept {path}"]
    optional = spec.oauth or provider == "custom"
    hint = " (empty to log in with OAuth instead)" if spec.oauth else ""
    hint = " (empty if the endpoint needs none)" if provider == "custom" else hint
    key = prompter.value(
        f"API key for {provider}{hint}", "AGENT_MODEL_API_KEY", secret=True
    )
    if not key:
        if optional:
            return []
        raise SetupError(
            f"Provider {provider} needs an API key in {path}: run the command from a "
            "terminal to enter it, or set AGENT_MODEL_API_KEY"
        )
    if not runtime._KEY.fullmatch(key):
        raise SetupError(
            "An API key is one value of 8 to 4096 printable characters without spaces"
        )
    _private_dir(path.parent, settings)
    write_secret(path, key, settings)
    return [f"Stored {path}"]


def operator_identity(paths, settings, env_file, users: str) -> list:
    report = []
    instance = settings.get("CRATE_AGENT_INSTANCE_ID")
    if not instance:
        instance = "crate-" + uuid.uuid4().hex[:12]
        set_env_values(env_file, {"CRATE_AGENT_INSTANCE_ID": instance})
        settings["CRATE_AGENT_INSTANCE_ID"] = instance
        report.append(f"Set CRATE_AGENT_INSTANCE_ID={instance} in .env")
    native = paths.root / "secrets/domain-native"
    if not (native / "callback-key").is_file():
        write_secret(native / "callback-key", tokens.token_hex(32), settings)
        report.append(f"Generated {native / 'callback-key'}")
    return report + _write_if_changed(
        native / "identity.json", _identity(instance, users), settings
    )


def _identity(instance: str, users: str) -> str:
    return json.dumps(
        {
            "instance_id": instance,
            "allowed_users": [int(user) for user in users.split(",")],
        }
    )


def _write_if_changed(path: Path, text: str, settings: dict) -> list:
    if path.is_file() and path.read_text() == text:
        return []
    write_secret(path, text, settings)
    return [f"Wrote {path}"]


def ask_approver(paths, settings, prompter, args, principal, users, runner=run):
    """Bind the Crate user whose Telegram button presses approve plans."""
    later = "bind one in Admin > Agents > Connections > Telegram approver"
    if not principal:
        return [
            f"No approver bound: the Crate Operator principal is unknown; {later}"
        ], None
    instance = settings["CRATE_AGENT_INSTANCE_ID"]
    current = credential_cli(
        ["show-approver", "--principal-id", principal], runner, instance=instance
    )
    rebind = prompter.environ.get("AGENT_APPROVER_EMAIL", "").strip()
    if current and not rebind:
        who = current.get("username") or f"user #{current.get('user_id')}"
        if not prompter.confirm(
            f"Plans are approved by {who} from Telegram user "
            f"{current['telegram_user_id']}. Bind someone else?",
            False,
            args.replace,
        ):
            return [f"Kept {who} as the approver"], current["telegram_user_id"]
    email = prompter.value(
        "Email of the Crate admin who approves plans in Telegram (empty to skip)",
        "AGENT_APPROVER_EMAIL",
    )
    if not email:
        kept = current["telegram_user_id"] if current else None
        return [f"No approver bound; set AGENT_APPROVER_EMAIL or {later}"], kept
    allowed = users.split(",")
    telegram = prompter.value(
        "Telegram user ID of that person", "AGENT_APPROVER_TELEGRAM_ID", allowed[0]
    ).strip()
    if telegram not in allowed:
        raise SetupError(
            f"The approver's Telegram user ID must be one of the allowed users ({users})"
        )
    credential_cli(
        [
            "bind-approver",
            "--principal-id",
            principal,
            "--telegram-user-id",
            telegram,
            "--user-email",
            email,
        ],
        runner,
        instance=instance,
    )
    return [f"Bound {email} (Telegram user {telegram}) as the approver"], int(telegram)


def _sync_shared_key(primary: Path, copy: Path, settings, prompter, args) -> list:
    values = {path: _existing(path, SHARED_KEY) for path in (primary, copy)}
    value = values[primary] or values[copy] or tokens.token_hex(32)
    report = []
    for path in (primary, copy):
        if values[path] == value:
            continue
        if path.exists() and not prompter.confirm(
            f"{path} does not match the key the supervisor and Crate Operator share. "
            "Replace it?",
            True,
            args.replace,
        ):
            report.append(f"Warning: kept {path}; alerts fail until both copies match")
            continue
        write_secret(path, value, settings)
        report.append(f"Wrote {path}")
    return report


def _supervisor_credential(secrets: Path, settings, prompter, args, runner) -> list:
    path = secrets / "supervisor/operator_mcp_read"
    existing = _existing(path, MCP_TOKEN)
    if existing and not prompter.confirm(
        f"The supervisor credential in {path} exists. Replace it?", False, args.replace
    ):
        return [f"Kept {path}"]
    issued = issue_credential(SUPERVISOR_NAME, SUPERVISOR_GRANTS, runner)
    write_secret(path, issued["token"], settings)
    report = [f"Created the supervisor's read-only MCP credential; stored {path}"]
    if existing:
        report += revoke_previous(existing, runner)[0]
    return report


def provision_supervisor(paths, settings, prompter, args, users, approver, runner=run):
    """Secrets, identity and config that let the supervisor push alerts to Telegram."""
    if not prompter.confirm(
        "Set up the supervisor that sends alerts (health, failed tasks, new releases) "
        "to Telegram?",
        True,
        True,
    ):
        return ["Supervisor not set up; make agent-up leaves it stopped"]
    instance = settings["CRATE_AGENT_INSTANCE_ID"]
    if not re.fullmatch(r"[a-zA-Z0-9_.-]{1,80}", instance):
        raise SetupError(
            "The supervisor needs CRATE_AGENT_INSTANCE_ID made of letters, digits, "
            "'.', '_' or '-' (at most 80)"
        )
    secrets = paths.root / "secrets"
    report = _supervisor_credential(secrets, settings, prompter, args, runner)
    for primary, copy in SUPERVISOR_SHARED_KEYS:
        report += _sync_shared_key(
            secrets / primary, secrets / copy, settings, prompter, args
        )
    allowed = users.split(",")
    destination = secrets / "delivery/destination"
    current = destination.read_text().strip() if destination.is_file() else ""
    if current not in allowed:
        wanted = str(approver) if str(approver) in allowed else allowed[0]
        if not current or prompter.confirm(
            f"Alerts go to Telegram user {current}, who is not allowed. "
            f"Send them to {wanted}?",
            True,
            True,
        ):
            write_secret(destination, wanted, settings)
            report.append(f"Alerts go to Telegram user {wanted} ({destination})")
    report += _write_if_changed(
        secrets / "supervisor-native/identity.json",
        _identity(instance, users),
        settings,
    )
    config_path = paths.root / "supervisor-config.json"
    try:
        config = json.loads(
            (config_path if config_path.is_file() else SUPERVISOR_EXAMPLE).read_text()
        )
    except ValueError:
        raise SetupError(f"{config_path} is not valid JSON; fix or remove it") from None
    config.update(
        instance=instance,
        mcp_host=mcp_host(settings),
        allowed_operators=[f"telegram:{user}" for user in allowed],
    )
    return report + _write_if_changed(
        config_path, json.dumps(config, indent=2) + "\n", settings
    )


def supervisor_problems(root: Path) -> list:
    if not (root / "supervisor-config.json").is_file():
        return []
    required = ["supervisor/operator_mcp_read", "delivery/destination"]
    required += [name for pair in SUPERVISOR_SHARED_KEYS for name in pair]
    required.append("supervisor-native/identity.json")
    return [
        f"Supervisor is missing secrets/{name}; rerun make agent-init "
        "AGENT_PROFILE=operator"
        for name in required
        if not (root / "secrets" / name).is_file()
    ]


def compose_argv(args, profile: str) -> list:
    argv = ["docker", "compose"]
    if args.env_file.resolve() != (REPO / ".env").resolve():
        argv += ["--env-file", str(args.env_file)]
    for name in filter(None, args.compose_files.split(":")):
        argv += ["-f", name]
    if profile == "operator":
        argv += ["-f", str(args.overlay)]
    return argv + ["--profile", PROFILES[profile].compose_profile]


def disabled_services(settings: dict) -> list:
    """Optional operator services whose prerequisites are absent on this host."""
    disabled = []
    try:
        if not (operator_root(settings) / "supervisor-config.json").is_file():
            disabled.append(("crate-operator-supervisor", "no supervisor-config.json"))
    except PermissionError:
        pass
    if not INFRA_SOCKET.exists():
        disabled.append(("crate-infra-relay", f"no {INFRA_SOCKET}"))
    return disabled


def scale_args(settings: dict) -> list:
    args = []
    for service, _reason in disabled_services(settings):
        args += ["--scale", f"{service}=0"]
    return args


def start(args, settings, runner=run) -> list:
    profile = PROFILES[args.profile]
    other = PROFILES["agent" if args.profile == "operator" else "operator"]
    if container_running(other.container, runner):
        raise SetupError(
            f"{other.container} is running. Never run Crate Agent and Crate Operator "
            "together; stop it first"
        )
    if args.profile == "operator":
        argv = compose_argv(args, "operator") + ["up", "-d"] + scale_args(settings)
    else:
        argv = compose_argv(args, "agent") + [
            "up",
            "-d",
            "--no-deps",
            profile.container,
        ]
    runner(argv, capture=False, timeout=900)
    deadline = time.monotonic() + 90
    while not container_running(profile.container, runner):
        if time.monotonic() > deadline:
            raise SetupError(f"{profile.container} did not start; read make agent-logs")
        time.sleep(3)
    return [f"Started {profile.container}"]


def _exec(settings, container, argv, **kwargs) -> list:
    uid, gid = _ids(settings)
    flags = ["-it"] if kwargs.get("interactive") else []
    return ["docker", "exec", *flags, "-u", f"{uid}:{gid}", container, *argv]


def needs_oauth(paths, settings, runtime) -> str | None:
    try:
        model, env = runtime.model_settings(paths.secrets, settings)
    except (runtime.ConfigurationError, OSError):
        return None
    try:
        problem = runtime.model_credential_problem(paths.home, model, env)
    except OSError:
        return None
    return model["provider"] if problem else None


def login(args, settings, runner=run) -> list:
    runtime = runtime_module()
    paths = layout(settings, args.profile)
    provider = needs_oauth(paths, settings, runtime)
    container = PROFILES[args.profile].container
    if provider is None:
        return ["Model credentials are already configured"]
    command = ["hermes", "auth", "add", provider, "--type", "oauth"]
    if not sys.stdin.isatty():
        uid, gid = _ids(settings)
        return [
            "Log in to the model provider inside this agent's own home:\n     "
            f"docker exec -it -u {uid}:{gid} {container} {' '.join(command)}"
        ]
    runner(
        _exec(settings, container, command, interactive=True),
        capture=False,
        interactive=True,
        timeout=900,
    )
    return [f"Logged in to {provider}"]


def smoke(args, settings, runner=run) -> tuple:
    container = PROFILES[args.profile].container
    if not container_running(container, runner):
        return False, [f"{container} is not running"]
    check = runner(
        _exec(
            settings, container, ["python3", "/opt/crate-hermes/runtime.py", "--check"]
        ),
        check=False,
    )
    report = [f"Readiness: {(check.stdout or check.stderr).strip()}"]
    ok = check.returncode == 0
    if ok:
        reply = runner(
            _exec(
                settings,
                container,
                ["hermes", "-z", "Reply with the single word OK.", "-t", "memory"],
            ),
            check=False,
            timeout=240,
        )
        answered = reply.returncode == 0 and reply.stdout.strip()
        report.append(
            "Model answered"
            if answered
            else "Model check failed: "
            + ((reply.stderr or reply.stdout).strip().splitlines() or ["no output"])[-1]
        )
        ok = bool(answered)
    return ok, report


def init(args, settings, prompter, runner=run) -> list:
    runtime = runtime_module()
    profile = PROFILES[args.profile]
    report = prepare_layout(settings, args.profile)
    paths = layout(settings, args.profile)
    updates, recreate_api = {}, False
    for name in profile.flags:
        if settings.get(name, "false").lower() != "true" and prompter.confirm(
            f"Set {name}=true in .env (recreates crate-api)?", True, True
        ):
            updates[name] = "true"
            recreate_api = True
    for problem in host_problems(settings):
        host = mcp_host(settings)
        if host and prompter.confirm(
            f"Add {host} to CRATE_MCP_ALLOWED_HOSTS?", True, True
        ):
            updates["CRATE_MCP_ALLOWED_HOSTS"] = ",".join(
                _allowed_hosts(settings) + [host]
            )
            recreate_api = True
        else:
            raise SetupError(problem)
    report += reuse_other(paths, settings, args)
    report += ask_telegram(paths, settings, prompter, args)
    report += ask_users(paths, settings, prompter, args)
    issued, principal, previous = ask_credential(
        paths, settings, prompter, args, runner
    )
    report += issued
    model_report, model = ask_model(paths, settings, prompter, args, runtime)
    report += model_report
    updates.update(model)
    if args.profile == "operator":
        known = [
            value
            for value in settings.get("CRATE_OPERATOR_PRINCIPAL_IDS", "").split(",")
            if value
        ]
        principals = [value for value in known if value != previous]
        if principal and principal not in principals:
            principals.append(principal)
        if principals != known:
            updates["CRATE_OPERATOR_PRINCIPAL_IDS"] = ",".join(principals)
    set_env_values(args.env_file, updates)
    settings.update(updates)
    report.append("Updated .env: " + ", ".join(sorted(updates)))
    approver = None
    if args.profile == "operator":
        users = (paths.secrets / "allowed-users").read_text().strip()
        report += operator_identity(paths, settings, args.env_file, users)
        if not settings.get("CRATE_OPERATOR_PRINCIPAL_IDS"):
            report.append(
                "Warning: CRATE_OPERATOR_PRINCIPAL_IDS is empty; add the principal of "
                "the kept MCP credential (Admin > Agents)"
            )
        approver_report, approver = ask_approver(
            paths, settings, prompter, args, principal, users, runner
        )
        report += approver_report
        report += provision_supervisor(
            paths, settings, prompter, args, users, approver, runner
        )
    if args.no_start or IN_CONTAINER:
        return report + next_steps(args, settings, principal, approver)
    if recreate_api and args.profile == "agent":
        runner(
            compose_argv(args, "agent") + ["up", "-d", "--no-deps", "crate-api"],
            capture=False,
            timeout=600,
        )
        report.append("Recreated crate-api with the new MCP settings")
    report += start(args, settings, runner)
    if needs_oauth(paths, settings, runtime):
        if prompter.interactive:
            report += login(args, settings, runner)
        else:
            report.append(
                "Model login skipped in non-interactive mode; run make agent-auth"
            )
    ok, results = smoke(args, settings, runner)
    report += results
    report.append("Smoke test passed" if ok else "Smoke test failed; see above")
    return report + next_steps(args, settings, principal, approver)


def next_steps(args, settings, principal, approver=None) -> list:
    profile = "" if args.profile == "agent" else " AGENT_PROFILE=operator"
    command = settings.get("AGENT_SETUP_COMMAND", "").strip()
    if command:
        steps = [f"{command} changes the bot, the allowed users or the model"]
    else:
        steps = [
            f"make agent-status{profile} shows health; make agent-logs{profile} follows it",
            f"make agent-model{profile} PROVIDER=... MODEL=... switches the model",
        ]
        if args.no_start:
            steps.insert(0, f"Start it: make agent-up{profile}")
    if args.profile == "operator":
        if approver is None:
            steps.append(
                "Bind the human who approves plans: Admin > Agents > Connections > "
                f"Telegram approver, connection {principal or 'Crate Operator'}"
            )
        status = (
            "crate doctor" if command else "make agent-status AGENT_PROFILE=operator"
        )
        steps += [
            "Changes open once crate-provenance verifies that every running Crate "
            f"image is an official GHCR image ({status} shows it); instances running "
            "locally built images stay read-only",
            "Optional: the infrastructure bridge needs root and systemd on the host "
            "(deploy/operator/README.infra.md); "
            + ("the relay starts" if command else "make agent-up starts the relay")
            + " only once its socket exists",
        ]
    return ["", "Next:"] + [f"  {index}. {step}" for index, step in enumerate(steps, 1)]


def revoke(args, settings, runner=run) -> list:
    """Turn a profile off: revoke its MCP credentials and delete the bot, the
    allowlist and the tokens. Model keys, the model login and memory stay."""
    paths = layout(settings, args.profile)
    token_files = [paths.secrets / "mcp-token"]
    if args.profile == "operator":
        token_files.append(paths.root / "secrets/supervisor/operator_mcp_read")
    report, revoked = [], []
    for path in token_files:
        token = _existing(path, MCP_TOKEN)
        if token is None:
            continue
        found = identify_credential(token, runner) if api_running(runner) else None
        if found is None:
            report.append(
                f"Warning: crate-api does not know the credential in {path}; "
                "check Admin > Agents"
            )
            continue
        try:
            credential_cli(["revoke", found["credential_id"]], runner)
        except SetupError as error:
            report.append(f"Warning: {error}; revoke it in Admin > Agents")
            continue
        revoked.append(found["principal_id"])
        report.append(f"Revoked the MCP credential {found['credential_id']}")
    known = [
        value
        for value in settings.get("CRATE_OPERATOR_PRINCIPAL_IDS", "").split(",")
        if value
    ]
    if any(value in revoked for value in known):
        set_env_values(
            args.env_file,
            {
                "CRATE_OPERATOR_PRINCIPAL_IDS": ",".join(
                    value for value in known if value not in revoked
                )
            },
        )
        report.append("Removed the revoked principal from CRATE_OPERATOR_PRINCIPAL_IDS")
    for path in [paths.secrets / name for name in SECRET_FILES] + token_files[1:]:
        if path.is_file():
            path.unlink()
            report.append(f"Deleted {path}")
    return report


def secret_status(secrets: Path, runtime) -> tuple:
    missing = [name for name in SECRET_FILES if not (secrets / name).is_file()]
    if missing:
        return missing, None
    try:
        runtime.load_secrets(secrets)
    except ValueError as error:
        return [], str(error)
    return [], None


def _secret_problems(paths, settings) -> list:
    runtime = runtime_module()
    try:
        missing, invalid = secret_status(paths.secrets, runtime)
    except PermissionError:
        return [f"Cannot read {paths.secrets}; run the check as root to verify it"]
    problems = [f"Missing secret file {paths.secrets / name}" for name in missing]
    if invalid:
        problems.append(f"Invalid secrets: {invalid}")
    try:
        runtime.model_settings(paths.secrets, settings)
    except runtime.ConfigurationError as error:
        problems.append(f"Model: {error}")
    except PermissionError:
        pass
    return problems


def agent_problems(settings: dict) -> list:
    problems = host_problems(settings) + flag_problems(settings, ("CRATE_MCP_ENABLED",))
    return problems + _secret_problems(layout(settings, "agent"), settings)


def declared_services(compose: Path) -> dict:
    services, current, inside = {}, None, False
    for line in compose.read_text().splitlines():
        if re.fullmatch(r"services:\s*", line):
            inside = True
        elif inside and re.match(r"[^\s#]", line):
            inside = False
        elif inside and (match := re.fullmatch(r"  ([A-Za-z0-9_.-]+):\s*", line)):
            current = match.group(1)
            services[current] = False
        elif inside and current and re.match(r"    (image|build):", line):
            services[current] = True
    return services


def overlay_problems(compose_files: str, overlay: Path) -> list:
    declared = set()
    for name in filter(None, compose_files.split(":")):
        declared |= set(declared_services(REPO / name))
    missing = sorted(
        name
        for name, defined in declared_services(overlay).items()
        if not defined and name not in declared
    )
    if not missing:
        return []
    return [
        f"{overlay.name} extends {', '.join(missing)}, which "
        f"{compose_files} does not declare"
    ]


def operator_problems(settings: dict, compose_files: str, overlay: Path) -> list:
    problems = overlay_problems(compose_files, overlay)
    problems += host_problems(settings) + flag_problems(
        settings, ("CRATE_MCP_ENABLED", "CRATE_MCP_ACTIONS_ENABLED")
    )
    problems += [
        f"{name} is required in .env for the operator overlay"
        for name in ("CRATE_OPERATOR_PRINCIPAL_IDS", "CRATE_AGENT_INSTANCE_ID")
        if not settings.get(name)
    ]
    paths = layout(settings, "operator")
    try:
        if not paths.root.is_dir():
            return problems + [
                f"Operator root {paths.root} does not exist; run "
                "make agent-init AGENT_PROFILE=operator"
            ]
        problems += supervisor_problems(paths.root)
        if not (paths.root / "provenance").is_dir():
            problems.append(
                f"{paths.root / 'provenance'} is missing; run "
                "make agent-init AGENT_PROFILE=operator"
            )
    except PermissionError:
        return problems + [f"Cannot read {paths.root}; run the check as root"]
    return problems + _secret_problems(paths, settings)


def provenance_report(settings: dict, now=None) -> list:
    """What crate-provenance last published; unverified is expected on local builds."""
    path = operator_root(settings) / "provenance/observation.json"
    try:
        observation = json.loads(path.read_text())
        observed = float(observation["observed_at"])
    except PermissionError:
        return [f"Release provenance: cannot read {path}; run the check as root"]
    except (OSError, ValueError, TypeError, KeyError):
        return ["Release provenance: not published yet; changes stay closed"]
    age = int((time.time() if now is None else now) - observed)
    if age > 90:
        return [
            f"Release provenance: last published {age}s ago; check crate-provenance "
            "and crate-provenance-docker. Changes stay closed"
        ]
    if observation.get("state") == "verified":
        identity = observation.get("identity") or {}
        return [
            f"Release provenance: verified ({observation.get('mode', 'release')} mode, "
            f"release {str(identity.get('release_sha'))[:12]}, "
            f"{len(identity.get('images') or {})} services). Changes can be applied"
        ]
    return [
        f"Release provenance: unverified ({observation.get('reason', 'unknown')}). "
        "Changes stay closed; expected with locally built images"
    ]


def health_report(container: str, runner=run) -> list:
    result = runner(
        ["docker", "inspect", "-f", "{{json .State.Health}}", container], check=False
    )
    if result.returncode != 0:
        return [f"{container} does not exist"]
    try:
        health = json.loads(result.stdout) or {}
    except ValueError:
        return []
    lines = [f"{container} health: {health.get('Status', 'unknown')}"]
    log = health.get("Log") or []
    if log and log[-1].get("Output", "").strip():
        lines.append("  " + log[-1]["Output"].strip().splitlines()[-1])
    return lines


def model_command(args, settings, prompter, runner=run) -> list:
    runtime = runtime_module()
    paths = layout(settings, args.profile)
    spec = runtime.PROVIDERS.get(args.provider)
    if spec is None:
        raise SetupError(
            f"Unknown provider {args.provider}; use one of {', '.join(runtime.PROVIDERS)}"
        )
    values = {
        "CRATE_AGENT_PROVIDER": args.provider,
        "CRATE_AGENT_MODEL": args.model,
        "CRATE_AGENT_BASE_URL": args.base_url,
    }
    try:
        report = migrate_legacy_key(paths, settings, runtime)
        try:
            runtime.model_settings(paths.secrets, values)
        except runtime.ConfigurationError as error:
            if "API key" not in str(error):
                raise SetupError(str(error)) from None
        if spec.key_env or args.provider == "custom":
            report += ask_model_key(
                paths, settings, prompter, args, args.provider, runtime
            )
        try:
            runtime.model_settings(paths.secrets, values)
        except runtime.ConfigurationError as error:
            raise SetupError(str(error)) from None
    except PermissionError:
        raise SetupError(f"Cannot read {paths.secrets}; rerun as root") from None
    set_env_values(args.env_file, values)
    report.append(f"Set {args.provider}/{args.model or runtime.DEFAULT_MODEL} in .env")
    container = PROFILES[args.profile].container
    runner(
        compose_argv(args, args.profile) + ["up", "-d", "--no-deps", container],
        capture=False,
        timeout=600,
    )
    report.append(f"Recreated {container}")
    if needs_oauth(paths, {**settings, **values}, runtime):
        report.append(f"{args.provider} needs a login: make agent-auth")
    return report


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command",
        choices=("init", "check", "model", "auth", "smoke", "scale-args", "revoke"),
    )
    parser.add_argument("--profile", choices=tuple(PROFILES), default="agent")
    parser.add_argument("--env-file", type=Path, default=REPO / ".env")
    parser.add_argument("--compose-files", default="docker-compose.yaml")
    parser.add_argument(
        "--overlay", type=Path, default=REPO / "deploy/operator/compose.operator.yaml"
    )
    parser.add_argument("--non-interactive", action="store_true")
    parser.add_argument(
        "--replace",
        action="store_true",
        help="non-interactive only: replace existing secrets",
    )
    parser.add_argument("--no-start", action="store_true")
    parser.add_argument("--no-network", action="store_true")
    parser.add_argument(
        "--in-container",
        action="store_true",
        help="run inside crate-api: local credential CLI, no docker, no start",
    )
    parser.add_argument(
        "--reuse",
        action="store_true",
        help="copy the other profile's bot, allowlist and model keys it lacks",
    )
    parser.add_argument("--provider", default="")
    parser.add_argument("--model", default="")
    parser.add_argument("--base-url", default="")
    args = parser.parse_args(argv)
    global IN_CONTAINER
    IN_CONTAINER = args.in_container
    environ = None
    if args.in_container:
        environ = {
            name: os.environ[name]
            for name in CONTAINER_ENVIRONMENT
            if name in os.environ
        }
    settings = load_settings(args.env_file, environ)
    interactive = (
        not args.non_interactive and not args.in_container and sys.stdin.isatty()
    )
    prompter = Prompter(interactive, environ)
    try:
        if args.command == "scale-args":
            print(" ".join(scale_args(settings)))
            return 0
        if args.command == "init":
            print("\n".join(init(args, settings, prompter)))
            return 0
        if args.command == "revoke":
            print("\n".join(revoke(args, settings)))
            return 0
        if args.command == "model":
            print("\n".join(model_command(args, settings, prompter)))
            return 0
        if args.command == "auth":
            print("\n".join(login(args, settings)))
            return 0
        if args.command == "smoke":
            ok, report = smoke(args, settings)
            print("\n".join(report))
            return 0 if ok else 1
        problems = (
            operator_problems(settings, args.compose_files, args.overlay.resolve())
            if args.profile == "operator"
            else agent_problems(settings)
        )
    except SetupError as error:
        print(f"Crate Agent setup: {error}", file=sys.stderr)
        return 1
    except PermissionError as error:
        print(
            f"Crate Agent setup: {error}; rerun as the owner or root", file=sys.stderr
        )
        return 1
    for problem in problems:
        print(f"  - {problem}", file=sys.stderr)
    if args.profile == "operator":
        for service, reason in disabled_services(settings):
            print(f"  - {service} stays stopped ({reason})")
        try:
            print("\n".join(provenance_report(settings)))
        except SetupError:
            pass
    if container_running(PROFILES[args.profile].container):
        print("\n".join(health_report(PROFILES[args.profile].container)))
    if problems:
        print(f"{PROFILES[args.profile].name} is not ready.", file=sys.stderr)
        return 1
    print(f"{PROFILES[args.profile].name} prerequisites are in place.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

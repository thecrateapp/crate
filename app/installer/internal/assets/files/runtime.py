"""Start Crate Agent or Crate Operator: the Hermes Agent gateway with a closed
Telegram policy, Crate MCP and a managed model configuration."""

from __future__ import annotations

import json
import os
import re
import shutil
import sys
import time
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import NamedTuple

_HOST = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?(?::[0-9]{1,5})?")
_MODEL = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}")
_URL = re.compile(r"https?://[^\s\"'<>]{1,2000}")
_KEY = re.compile(r"[\x21-\x7e]{8,4096}")

SECRETS = Path("/run/crate-hermes-secrets")
ASSETS = Path("/opt/crate-hermes")
HOST_CONTEXT = Path("/opt/crate-context/active")
IMAGE_CONTEXT = Path("/opt/crate-hermes-context/active")
DELIVERY = Path("/run/crate-hermes-delivery")
MODEL_KEYS_DIR = "model-keys"
LEGACY_MODEL_KEY_FILE = "model-api-key"
DEFAULT_PROVIDER = "openai-codex"
DEFAULT_MODEL = "gpt-6-luna"


class Provider(NamedTuple):
    key_env: str | None = None
    oauth: bool = False
    base_url_env: str | None = None
    base_url_required: bool = False


PROVIDERS = {
    "openai-codex": Provider(oauth=True),
    "openai-api": Provider(key_env="OPENAI_API_KEY", base_url_env="OPENAI_BASE_URL"),
    "anthropic": Provider(key_env="ANTHROPIC_API_KEY"),
    "openrouter": Provider(key_env="OPENROUTER_API_KEY"),
    "nous": Provider(key_env="NOUS_API_KEY", oauth=True),
    "gemini": Provider(key_env="GEMINI_API_KEY"),
    "deepseek": Provider(key_env="DEEPSEEK_API_KEY"),
    "custom": Provider(base_url_required=True),
}


class ConfigurationError(ValueError):
    pass


def mcp_host() -> str:
    host = os.environ.get("CRATE_MCP_HOST", "").strip()
    if not _HOST.fullmatch(host):
        raise ConfigurationError(
            "CRATE_MCP_HOST must be the API host listed in CRATE_MCP_ALLOWED_HOSTS; "
            "set CRATE_AGENT_MCP_HOST or DOMAIN in .env"
        )
    return host


def load_secrets(directory: Path) -> dict:
    try:
        token = (directory / "mcp-token").read_text().strip()
        telegram = (directory / "telegram-token").read_text().strip()
        users = (directory / "allowed-users").read_text().strip()
    except OSError:
        raise ValueError("Dedicated agent secrets are missing") from None
    if not re.fullmatch(r"crate_mcp_[A-Za-z0-9_-]{43}", token):
        raise ValueError("Invalid dedicated MCP credential")
    if not re.fullmatch(r"[0-9]+:[A-Za-z0-9_-]{30,}", telegram):
        raise ValueError("Invalid dedicated Telegram credential")
    if not re.fullmatch(r"[1-9][0-9]*(,[1-9][0-9]*)*", users):
        raise ValueError("Telegram requires an explicit private user allowlist")
    return {
        "CRATE_MCP_TOKEN": token,
        "TELEGRAM_BOT_TOKEN": telegram,
        "TELEGRAM_ALLOWED_USERS": users,
        "TELEGRAM_ALLOWED_CHATS": users,
        "TELEGRAM_ALLOW_ALL_USERS": "false",
        "TELEGRAM_ALLOW_BOTS": "false",
    }


def model_key_path(directory: Path, provider: str) -> Path:
    return directory / MODEL_KEYS_DIR / provider


def _read_key(path: Path, label: str) -> str | None:
    try:
        key = path.read_text().strip()
    except FileNotFoundError:
        return None
    except OSError:
        raise ConfigurationError(f"Cannot read {label}") from None
    if not key:
        return None
    if not _KEY.fullmatch(key):
        raise ConfigurationError(f"{label} must hold one API key without spaces")
    return key


def _model_key(directory: Path, provider: str) -> str | None:
    """Each provider has its own key file; the single legacy file only counts
    until the first per-provider key exists (make agent-model migrates it)."""
    key = _read_key(
        model_key_path(directory, provider), f"secrets/{MODEL_KEYS_DIR}/{provider}"
    )
    if key is None and not (directory / MODEL_KEYS_DIR).exists():
        key = _read_key(
            directory / LEGACY_MODEL_KEY_FILE, f"secrets/{LEGACY_MODEL_KEY_FILE}"
        )
    return key


def model_settings(directory: Path, environ=None) -> tuple[dict, dict]:
    """Managed `model` section plus provider env from CRATE_AGENT_* and its key file."""
    environ = os.environ if environ is None else environ
    name = environ.get("CRATE_AGENT_PROVIDER", "").strip() or DEFAULT_PROVIDER
    provider = PROVIDERS.get(name)
    if provider is None:
        raise ConfigurationError(
            f"CRATE_AGENT_PROVIDER={name} is not supported; use one of "
            + ", ".join(PROVIDERS)
        )
    model = environ.get("CRATE_AGENT_MODEL", "").strip()
    if not model and name == DEFAULT_PROVIDER:
        model = DEFAULT_MODEL
    if not model:
        raise ConfigurationError(f"CRATE_AGENT_MODEL is required for provider {name}")
    if not _MODEL.fullmatch(model):
        raise ConfigurationError(f"CRATE_AGENT_MODEL={model} is not a valid model id")
    base_url = environ.get("CRATE_AGENT_BASE_URL", "").strip()
    if base_url and not _URL.fullmatch(base_url):
        raise ConfigurationError("CRATE_AGENT_BASE_URL must be an http(s) URL")
    if provider.base_url_required and not base_url:
        raise ConfigurationError(
            f"CRATE_AGENT_BASE_URL is required for provider {name}"
        )
    if base_url and not (provider.base_url_env or provider.base_url_required):
        raise ConfigurationError(
            f"CRATE_AGENT_BASE_URL is not used by provider {name}; leave it empty"
        )
    key = _model_key(directory, name)
    if provider.key_env and not provider.oauth and key is None:
        raise ConfigurationError(
            f"Provider {name} needs its API key in secrets/{MODEL_KEYS_DIR}/{name}"
        )
    config, env = {"provider": name, "default": model}, {}
    if base_url:
        if provider.base_url_env:
            env[provider.base_url_env] = base_url
        else:
            config["base_url"] = base_url
    if key is not None:
        if provider.key_env:
            env[provider.key_env] = key
        elif name == "custom":
            config["api_key"] = key
    return config, env


def _has_oauth(home: Path, provider: str) -> bool:
    try:
        store = json.loads((home / "auth.json").read_text())
    except (OSError, ValueError):
        return False
    if not isinstance(store, dict):
        return False
    pool = store.get("credential_pool")
    state = store.get("providers")
    return bool(
        (isinstance(pool, dict) and pool.get(provider))
        or (isinstance(state, dict) and state.get(provider))
    )


def model_credential_problem(home: Path, model: dict, env: dict) -> str | None:
    name = model["provider"]
    provider = PROVIDERS[name]
    if not provider.oauth or (provider.key_env and provider.key_env in env):
        return None
    if _has_oauth(home, name):
        return None
    return (
        f"provider {name} has no login in this agent's home; run make agent-auth "
        "(add AGENT_PROFILE=operator for Crate Operator)"
    )


def validate_read_tools(tools: list) -> None:
    if not tools or any(
        tool.get("annotations", {}).get("readOnlyHint") is not True for tool in tools
    ):
        raise ValueError("MCP credential must expose only explicitly read-only tools")


def managed_environment(directory: Path, environ=None) -> str:
    """Render the private managed env used by independently supervised gateways."""
    values = dict(load_secrets(directory))
    values.update(model_settings(directory, environ)[1])
    return "".join(f"{key}={value}\n" for key, value in sorted(values.items()))


def _write_private(path: Path, text: str) -> None:
    staging = path.with_name(f".{path.name}.{os.getpid()}")
    descriptor = os.open(staging, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w") as output:
        output.write(text)
    os.replace(staging, path)


def write_managed(home: Path, config: dict, env: dict) -> Path:
    """Managed scope wins key-by-key over $HERMES_HOME, so console edits cannot drift."""
    managed = Path(os.environ.get("HERMES_MANAGED_DIR") or home / "crate-managed")
    managed.mkdir(mode=0o700, parents=True, exist_ok=True)
    _write_private(managed / "config.yaml", json.dumps(config, indent=2))
    _write_private(
        managed / ".env",
        "".join(f"{key}={value}\n" for key, value in sorted(env.items())),
    )
    os.environ["HERMES_MANAGED_DIR"] = str(managed)
    return managed


def select_context_root(candidates=(HOST_CONTEXT, IMAGE_CONTEXT)) -> Path | None:
    """A host-activated release context wins over the one baked into the image."""
    for root in candidates:
        if (root / "context-manifest.json").is_file():
            return root
    return None


def _context_env(context_root: Path | None) -> dict:
    env = {"CRATE_CONTEXT_ROOT": str(context_root or HOST_CONTEXT)}
    release = os.environ.get("CRATE_RELEASE_SHA", "").strip()
    if release:
        env["CRATE_RELEASE_SHA"] = release
    return env


def _public(config: dict) -> dict:
    public = json.loads(json.dumps(config))
    public.get("model", {}).pop("api_key", None)
    return public


def _mcp_request(url, token, method, params, request_id):
    request = urllib.request.Request(
        url,
        method="POST",
        headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": "2025-11-25",
            "Host": mcp_host(),
        },
        data=json.dumps(
            {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}
        ).encode(),
    )

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            raise ValueError("MCP redirects forbidden")

    opener = urllib.request.build_opener(NoRedirect(), urllib.request.ProxyHandler({}))
    with opener.open(request, timeout=20) as response:
        raw = response.read(262145)
    if len(raw) > 262144:
        raise ValueError("MCP response too large")
    result = json.loads(raw)
    if "error" in result:
        raise ValueError("MCP readiness request was rejected")
    return result["result"]


def _discover(url, token, client):
    _mcp_request(
        url,
        token,
        "initialize",
        {
            "protocolVersion": "2025-11-25",
            "capabilities": {},
            "clientInfo": {"name": client, "version": "1"},
        },
        1,
    )
    return _mcp_request(url, token, "tools/list", {}, 2)["tools"]


def _preflight(url, token):
    validate_read_tools(_discover(url, token, "crate-agent-readiness"))


def validate_operator_profile(tools: list, policy: dict, config: dict) -> None:
    """A reviewed finite MCP allowlist plus current server approval identity."""
    server = config["mcp_servers"]["crate"]
    included = set(server["tools"]["include"])
    advertised = {tool["name"]: tool for tool in tools}
    required = {
        "get_confirmation_policy",
        "request_plan_confirmation",
        "get_plan",
        "get_job",
    }
    if (
        not required <= included
        or not required <= advertised.keys()
        or server.get("trust") != "full"
        or included & {"retry_job", "cancel_job"}
        or policy.get("operator_provenance_required") is not True
        or policy.get("require_approval") is not True
        or policy.get("actions_enabled") is not True
        or not policy.get("instance_id")
        or not policy.get("credential_id")
        or not policy.get("principal_id")
        or type(policy.get("policy_revision")) is not int
        or not policy.get("grants")
    ):
        raise ValueError("Exact native approval policy is required")
    expected = json.loads((Path(__file__).parent / "config.operator.json").read_text())
    if included != set(expected["mcp_servers"]["crate"]["tools"]["include"]):
        raise ValueError("Unreviewed operator tool exposure")
    reviewed_writes = {
        "editorial_plan_prepare",
        "preview_job_retry",
        "preview_schedule_update",
        "run_analysis",
        "preview_repairs",
        "apply_repairs",
        "plan_library_sync",
        "editorial_plan_apply",
        "apply_acquisition",
        "apply_tidal_acquisition",
        "apply_tidal_artist_acquisition",
        "preview_shows_import",
        "preview_acquisition",
        "preview_tidal_acquisition",
        "preview_tidal_artist_acquisition",
        "search_acquisition",
        "search_tidal_missing_albums",
        "search_tidal_missing_artist",
        "apply_job_retry",
        "apply_metadata_update",
        "run_quality_check",
        "request_plan_confirmation",
        "preview_runtime_update",
        "apply_runtime_update",
        "preview_metadata_update",
        "run_schedule",
        "plan_enrichment",
        "apply_schedule_update",
        "apply_acquisition_publication",
        "apply_shows_import",
        "run_metadata_export",
        "preview_job_cancel",
        "editorial_publication_set",
        "apply_job_cancel",
        "run_enrichment",
        "plan_analysis",
        "run_library_sync",
        "preview_acquisition_publication",
        "plan_metadata_export",
        "run_health_check",
        "run_metadata_rehydrate",
        "plan_metadata_rehydrate",
    }
    for name, tool in advertised.items():
        if name in included and tool.get("annotations", {}).get("readOnlyHint") is not (
            name not in reviewed_writes
        ):
            raise ValueError("Operator tool annotation changed")


def operator_preflight(url, token, supervisor_token, config):
    if token == supervisor_token:
        raise ValueError("Supervisor requires a separate read-only credential")
    _preflight(url, supervisor_token)
    tools = _discover(url, token, "crate-operator-readiness")
    result = _mcp_request(
        url,
        token,
        "tools/call",
        {"name": "get_confirmation_policy", "arguments": {}},
        3,
    )
    if result.get("isError"):
        raise ValueError("Approval policy unavailable")
    payload = result.get("structuredContent")
    if payload is None:
        payload = json.loads(result["content"][0]["text"])
    validate_operator_profile(tools, payload["data"], config)


def install_plugin(home: Path, assets: Path) -> None:
    """Install the image's native plugin unless a reviewed copy is bind-mounted."""
    plugins = home / "plugins"
    target = plugins / "crate-confirmation"
    if os.path.ismount(target):
        return
    plugins.mkdir(exist_ok=True)
    staging = plugins / f".crate-confirmation-{os.getpid()}"
    shutil.rmtree(staging, ignore_errors=True)
    shutil.copytree(
        assets / "plugins/crate_confirmation",
        staging,
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
    )
    shutil.rmtree(target, ignore_errors=True)
    staging.rename(target)


def configure_operator(
    home: Path,
    assets: Path,
    *,
    domain_available: bool,
    model: dict | None = None,
    model_env: dict | None = None,
    context_root: Path | None = None,
) -> None:
    host = mcp_host()
    # The pinned MCP launcher resolves default cwd through HOME independently
    # of HERMES_HOME. Never inherit root's HOME after dropping the runtime UID.
    os.environ["HOME"] = str(home)
    os.environ["XDG_STATE_HOME"] = str(home / "xdg-state")
    config = json.loads((assets / "config.operator.json").read_text())
    config["model"] = model or {"provider": DEFAULT_PROVIDER, "default": DEFAULT_MODEL}
    # Pinned Hermes strips non-allowlisted parent variables from MCP children.
    config["mcp_servers"]["crate"]["env"] = {
        "CRATE_MCP_URL": os.environ.get("CRATE_MCP_URL", "http://crate-api:8585/mcp"),
        "CRATE_MCP_HOST": host,
    }
    config["mcp_servers"]["crate_context"]["env"] = _context_env(context_root)
    (home / "SOUL.md").write_text(
        (assets / "SOUL.operator.md").read_text()
        + "\n\n"
        + (assets / "CONTEXT.md").read_text()
        + "\n\n"
        + (assets / "OPERATOR.md").read_text()
    )
    # Fixed local catalog remains discoverable during API/context outages. Every
    # call revalidates current server authority; recovery needs no gateway restart.
    del domain_available
    if delivery_configured():
        secret = (DELIVERY / "secret").read_text().strip()
        destination = (DELIVERY / "destination").read_text().strip()
        if (
            len(secret) < 32
            or not destination.isdecimal()
            or destination
            not in os.environ.get("TELEGRAM_ALLOWED_USERS", "").split(",")
        ):
            raise ValueError("Dedicated fixed allowlisted delivery route required")
        config["platforms"]["webhook"] = {
            "enabled": True,
            "extra": {
                "host": "0.0.0.0",
                "port": 8644,
                "routes": {
                    "crate-operator": {
                        "secret": secret,
                        "prompt": "{message}",
                        "deliver": "telegram",
                        "deliver_extra": {"chat_id": destination},
                        "deliver_only": True,
                        "mirror_to_session": False,
                    }
                },
            },
        }
    install_plugin(home, assets)
    write_managed(home, config, model_env or {})
    (home / "config.yaml").write_text(json.dumps(_public(config), indent=2))


def configure_agent(
    home: Path,
    assets: Path,
    *,
    model: dict,
    model_env: dict,
    context_root: Path | None,
) -> None:
    config = json.loads((assets / "config.json").read_text())
    config["model"] = model
    config["mcp_servers"]["crate_context"]["env"] = _context_env(context_root)
    install_identity(home, assets)
    write_managed(home, config, model_env)
    # Upstream CLI MCP discovery probes read_raw_config(), without the managed overlay.
    # A complete local seed prevents it from incorrectly skipping configured servers.
    (home / "config.yaml").write_text(json.dumps(_public(config), indent=2))


def delivery_configured() -> bool:
    return (DELIVERY / "secret").is_file()


def health_problem(home: Path) -> str | None:
    try:
        status = json.loads((home / "gateway_state.json").read_text())
        updated = status.get("updated_at")
        when = (
            float(updated)
            if isinstance(updated, (float, int))
            else datetime.fromisoformat(str(updated)).timestamp()
        )
        platforms = status.get("platforms", {})
        if status.get("gateway_state") != "running" or time.time() - when >= 180:
            return "Agent gateway is not running"
        if platforms.get("telegram", {}).get("state") != "connected":
            return "Telegram is not connected; check secrets/telegram-token"
        if (
            os.environ.get("CRATE_AGENT_PROFILE") == "operator"
            and delivery_configured()
            and platforms.get("webhook", {}).get("state") != "connected"
        ):
            return "Supervisor delivery webhook is not connected"
        model, env = model_settings(SECRETS)
    except ConfigurationError as error:
        return str(error)
    except (OSError, ValueError, TypeError, AttributeError):
        return "Agent gateway is not running"
    return model_credential_problem(home, model, env)


def healthy(home: Path) -> bool:
    problem = health_problem(home)
    if problem:
        print(f"Crate Agent unhealthy: {problem}.")
    return problem is None


def install_identity(home: Path, assets: Path) -> None:
    identity = (assets / "SOUL.md").read_text()
    identity += "\n\n" + (assets / "CONTEXT.md").read_text()
    (home / "SOUL.md").write_text(identity)
    (home / "config.yaml").write_text((assets / "config.json").read_text())


def _context_summary(context_root: Path | None) -> dict:
    if context_root is None:
        return {"availability": "unavailable", "release_sha": None}
    sys.path.insert(0, str(Path(__file__).parent))
    from context_server import ContextStore

    try:
        summary = ContextStore(context_root).summary()
    except (OSError, ValueError, KeyError, TypeError):
        return {"availability": "unavailable", "release_sha": None}
    return {
        "availability": summary["availability"],
        "release_sha": summary["release_sha"],
    }


def check(home: Path, url: str, settings: dict, model: dict, model_env: dict) -> int:
    """Smoke readiness: live MCP discovery, model credentials and release context."""
    operator = os.environ.get("CRATE_AGENT_PROFILE") == "operator"
    report = {
        "profile": "operator" if operator else "agent",
        "model": f"{model['provider']}/{model['default']}",
        "context": _context_summary(select_context_root())["availability"],
    }
    ok = True
    try:
        tools = _discover(url, settings["CRATE_MCP_TOKEN"], "crate-agent-check")
        names = {tool["name"] for tool in tools}
        if operator:
            ready = "get_confirmation_policy" in names
        else:
            validate_read_tools(tools)
            ready = True
        report["mcp"] = f"{len(tools)} tools" if ready else "operator tools missing"
        ok = ok and ready
    except (OSError, ValueError, KeyError, TypeError):
        report["mcp"] = "unreachable or rejected; check the credential and MCP flags"
        ok = False
    problem = model_credential_problem(home, model, model_env)
    report["model_credentials"] = problem or "configured"
    ok = ok and problem is None
    print(json.dumps(report))
    return 0 if ok else 1


def main() -> int:
    home = Path(os.environ.get("HERMES_HOME", "/opt/data"))
    if "--health" in sys.argv:
        return 0 if healthy(home) else 1
    try:
        mcp_host()
        settings = load_secrets(SECRETS)
        model, model_env = model_settings(SECRETS)
        os.environ.update(settings)
        os.environ.update(model_env)
        operator = os.environ.get("CRATE_AGENT_PROFILE", "agent") == "operator"
        url = os.environ.get("CRATE_MCP_URL", "http://crate-api:8585/mcp")
        if "--check" in sys.argv:
            return check(home, url, settings, model, model_env)
        context_root = select_context_root()
        if operator:
            # Independent recovery starts without API, DB or a usable context.
            configure_operator(
                home,
                ASSETS,
                domain_available=False,
                model=model,
                model_env={**settings, **model_env},
                context_root=context_root,
            )
        else:
            configure_agent(
                home,
                ASSETS,
                model=model,
                model_env={**settings, **model_env},
                context_root=context_root,
            )
        context = _context_summary(context_root)
        for attempt in range(0 if operator else 6):
            try:
                _preflight(url, settings["CRATE_MCP_TOKEN"])
                break
            except (OSError, ValueError):
                if attempt == 5:
                    raise ValueError("Read-only Crate MCP readiness failed") from None
                time.sleep(5)
        problem = model_credential_problem(home, model, model_env)
        print(
            json.dumps(
                {
                    "service": "crate-agent",
                    "release_sha": context["release_sha"],
                    "context": context["availability"],
                    "mcp": "live-per-call" if operator else "read-only",
                    "model": f"{model['provider']}/{model['default']}",
                    "model_credentials": "missing" if problem else "configured",
                }
            ),
            flush=True,
        )
        if problem:
            print(f"Crate Agent model not ready: {problem}.", file=sys.stderr)
    except (OSError, ValueError) as error:
        detail = (
            str(error)
            if isinstance(error, ConfigurationError)
            else "check dedicated secrets and managed profile configuration"
        )
        print(f"Crate Agent startup blocked: {detail}.", file=sys.stderr)
        return 1
    os.execvp("hermes", ["hermes", "gateway", "run"])
    return 1  # exec only returns on failure.


if __name__ == "__main__":
    raise SystemExit(main())

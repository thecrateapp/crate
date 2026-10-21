"""Start the dedicated operator only with a closed Telegram policy and read MCP."""

import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime
from pathlib import Path


def load_secrets(directory: Path) -> dict:
    try:
        token = (directory / "mcp-token").read_text().strip()
        telegram = (directory / "telegram-token").read_text().strip()
        users = (directory / "allowed-users").read_text().strip()
    except OSError:
        raise ValueError("Dedicated Hermes secrets are missing") from None
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


def validate_read_tools(tools: list) -> None:
    if not tools or any(
        tool.get("annotations", {}).get("readOnlyHint") is not True for tool in tools
    ):
        raise ValueError("MCP credential must expose only explicitly read-only tools")


def managed_environment(directory: Path) -> str:
    """Render the private managed env used by independently supervised gateways."""
    return "".join(
        f"{key}={value}\n" for key, value in sorted(load_secrets(directory).items())
    )


def _mcp_request(url, token, method, params, request_id):
    request = urllib.request.Request(
        url,
        method="POST",
        headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": "2025-11-25",
            "Host": os.environ.get("CRATE_MCP_HOST", "api.lespedants.org"),
        },
        data=json.dumps(
            {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}
        ).encode(),
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        result = json.load(response)
    if "error" in result:
        raise ValueError("MCP readiness request was rejected")
    return result["result"]


def _preflight(url, token):
    _mcp_request(
        url,
        token,
        "initialize",
        {
            "protocolVersion": "2025-11-25",
            "capabilities": {},
            "clientInfo": {"name": "crate-hermes-readiness", "version": "1"},
        },
        1,
    )
    validate_read_tools(_mcp_request(url, token, "tools/list", {}, 2)["tools"])


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
        "preview_shows_import",
        "preview_acquisition",
        "search_acquisition",
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
    _mcp_request(
        url,
        token,
        "initialize",
        {
            "protocolVersion": "2025-11-25",
            "capabilities": {},
            "clientInfo": {"name": "crate-hermes-operator-readiness", "version": "1"},
        },
        1,
    )
    tools = _mcp_request(url, token, "tools/list", {}, 2)["tools"]
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


def configure_operator(home: Path, assets: Path, *, domain_available: bool) -> None:
    config = json.loads((assets / "config.operator.json").read_text())
    (home / "SOUL.md").write_text(
        (assets / "SOUL.operator.md").read_text()
        + "\n\n"
        + (assets / "CONTEXT.md").read_text()
        + "\n\n"
        + (assets / "OPERATOR.md").read_text()
    )
    if not domain_available:
        # Task7 can continue independent recovery; no domain mutation tool is
        # discoverable during outage. Recovery/revalidation needs a gateway restart.
        del config["mcp_servers"]["crate"]
    managed = home / "crate-operator-managed"
    managed.mkdir(exist_ok=True)
    encoded = json.dumps(config, indent=2)
    (managed / "config.yaml").write_text(encoded)
    (home / "config.yaml").write_text(encoded)
    os.environ["HERMES_MANAGED_DIR"] = str(managed)


def healthy(home: Path) -> bool:
    try:
        status = json.loads((home / "gateway_state.json").read_text())
        updated = status.get("updated_at")
        when = (
            float(updated)
            if isinstance(updated, (float, int))
            else datetime.fromisoformat(str(updated)).timestamp()
        )
        return (
            status.get("gateway_state") == "running"
            and time.time() - when < 180
            and status.get("platforms", {}).get("telegram", {}).get("state")
            == "connected"
        )
    except (OSError, ValueError, TypeError):
        return False


def install_identity(home: Path, assets: Path) -> None:
    """Seed raw-config readers too; the managed policy remains authoritative."""
    identity = (assets / "SOUL.md").read_text()
    identity += "\n\n" + (assets / "CONTEXT.md").read_text()
    (home / "SOUL.md").write_text(identity)
    # Upstream CLI MCP discovery probes read_raw_config(), without the managed overlay.
    # A complete local seed prevents it from incorrectly skipping configured servers.
    (home / "config.yaml").write_text((assets / "config.json").read_text())


def main() -> int:
    home = Path(os.environ.get("HERMES_HOME", "/opt/data"))
    if "--health" in sys.argv:
        return 0 if healthy(home) else 1
    try:
        settings = load_secrets(Path("/run/crate-hermes-secrets"))
        os.environ.update(settings)
        from context_server import ContextStore

        context = ContextStore(Path("/opt/crate-context/active")).summary()
        install_identity(home, Path("/opt/crate-hermes"))
        url = os.environ.get("CRATE_MCP_URL", "http://crate-api:8585/mcp")
        operator = os.environ.get("CRATE_HERMES_PROFILE", "pilot") == "operator"
        domain_available = False
        if operator:
            config = json.loads(
                Path("/opt/crate-hermes/config.operator.json").read_text()
            )
            try:
                supervisor_token = (
                    Path("/run/crate-hermes-secrets/supervisor-token")
                    .read_text()
                    .strip()
                )
                operator_preflight(
                    url, settings["CRATE_MCP_TOKEN"], supervisor_token, config
                )
                domain_available = True
            except (OSError, ValueError, KeyError):
                pass  # independent native recovery may remain available in Task7
            configure_operator(
                home, Path("/opt/crate-hermes"), domain_available=domain_available
            )
        for attempt in range(0 if operator else 6):
            try:
                _preflight(url, settings["CRATE_MCP_TOKEN"])
                break
            except (OSError, ValueError):
                if attempt == 5:
                    raise ValueError("Read-only Crate MCP readiness failed") from None
                time.sleep(5)
        print(
            json.dumps(
                {
                    "service": "crate-hermes-agent",
                    "release_sha": context["release_sha"],
                    "mcp": ("operator" if domain_available else "domain-unavailable")
                    if operator
                    else "read-only",
                }
            ),
            flush=True,
        )
    except (OSError, ValueError):
        print(
            "Crate Hermes startup blocked: check dedicated secrets, context integrity and read-only MCP access.",
            file=sys.stderr,
        )
        return 1
    os.execvp("hermes", ["hermes", "gateway", "run"])
    return 1  # exec only returns on failure.


if __name__ == "__main__":
    raise SystemExit(main())

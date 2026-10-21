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
        for attempt in range(6):
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
                    "mcp": "read-only",
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

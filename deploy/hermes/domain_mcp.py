"""Offline fixed discovery, live authority per call; reconnects after API recovery."""

import json
import os
import sys
from pathlib import Path

from runtime import _mcp_request, validate_operator_profile

ASSETS = Path(__file__).parent


def dispatch(message):
    method, params = message.get("method"), message.get("params", {})
    catalog = json.loads((ASSETS / "operator-catalog.json").read_text())
    if method == "initialize":
        return {
            "protocolVersion": "2025-03-26",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "crate-domain-gate", "version": "1"},
        }
    if method == "ping":
        return {}
    if method == "tools/list":
        return {"tools": catalog}
    if method != "tools/call":
        raise ValueError("Unsupported method")
    name = params["name"]
    tool = next((item for item in catalog if item["name"] == name), None)
    if tool is None or set(params) - {"name", "arguments", "_meta"}:
        raise ValueError("Unsupported tool")
    # Standard MCP client metadata is transport-only, never domain authority.
    if "_meta" in params and not isinstance(params["_meta"], dict):
        raise ValueError("Invalid transport metadata")
    params = {"name": name, "arguments": params.get("arguments", {})}
    url = os.environ.get("CRATE_MCP_URL", "http://crate-api:8585/mcp")
    token = Path("/run/crate-hermes-secrets/mcp-token").read_text().strip()
    if not tool["annotations"]["readOnlyHint"]:
        current = _mcp_request(url, token, "tools/list", {}, 1)["tools"]
        policy = _mcp_request(
            url,
            token,
            "tools/call",
            {"name": "get_confirmation_policy", "arguments": {}},
            2,
        )
        if policy.get("isError"):
            raise ValueError("Current domain authority unavailable")
        payload = policy.get("structuredContent") or json.loads(
            policy["content"][0]["text"]
        )
        validate_operator_profile(
            current,
            payload["data"],
            json.loads((ASSETS / "config.operator.json").read_text()),
        )
        if name not in {item["name"] for item in current}:
            raise ValueError("Current grant missing")
    # The server independently binds its configured operator principal to fresh
    # provenance, including direct calls that bypass this managed adapter.
    return _mcp_request(url, token, "tools/call", params, 3)


def main():
    while True:
        line = sys.stdin.buffer.readline(65537)
        if not line or len(line) > 65536 or not line.endswith(b"\n"):
            return
        identity, message = None, {}
        try:
            message = json.loads(line)
            identity = message.get("id")
            if identity is None:
                continue
            response = {"jsonrpc": "2.0", "id": identity, "result": dispatch(message)}
        except Exception:  # noqa: BLE001 — never forward upstream secrets/error bodies
            if isinstance(message, dict) and message.get("method") == "tools/call":
                # Domain unavailability is an observed result, not a broken local
                # MCP transport. Pinned Hermes also strikes its server breaker on
                # isError results. Preserve uncertainty if a forwarded write lost
                # its response: never imply it did not execute or replay it here.
                payload = {
                    "availability": "unavailable",
                    "outcome": "unverified",
                    "reason": "Current domain authority or evidence unavailable",
                    "next_step": "Read current plan/job state before retrying a mutation",
                }
                response = {
                    "jsonrpc": "2.0",
                    "id": identity,
                    "result": {
                        "isError": False,
                        "structuredContent": payload,
                        "content": [{"type": "text", "text": json.dumps(payload)}],
                    },
                }
            else:
                response = {
                    "jsonrpc": "2.0",
                    "id": identity,
                    "error": {"code": -32603, "message": "Unsupported MCP request"},
                }
        print(json.dumps(response, separators=(",", ":")), flush=True)


if __name__ == "__main__":
    main()

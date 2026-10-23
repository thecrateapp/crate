"""Small stdio MCP adapter; fixed relay routes, no native signing or host authority.

Gateway config may run `python -m deploy.operator.infra_mcp`. Dedicated scoped
service bearer files authorize requests only; native human approval is independent.
"""

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

BASE = "http://crate-infra-relay:8788"
SECRET_ROOT = Path("/run/crate-infra-client")


def schema(properties, required):
    return {
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": False,
    }


STRING = {"type": "string"}
TOOLS = [
    {
        "name": "infra_inspect",
        "description": "Observe one allowed host service or exact infrastructure plan.",
        "inputSchema": schema({"service": STRING, "plan_id": STRING}, []),
        "annotations": {
            "readOnlyHint": True,
            "destructiveHint": False,
            "openWorldHint": False,
        },
    },
    {
        "name": "infra_prepare",
        "description": "Prepare an immutable infrastructure plan and request independent native human review. Approval automatically admits the exact operation.",
        "inputSchema": schema(
            {
                "operation": {
                    "type": "string",
                    "enum": ["restart", "backup", "deploy", "restore"],
                },
                "target": STRING,
                "version": {"type": ["string", "null"]},
                "human_id": {"type": "integer", "minimum": 1},
            },
            ["operation", "target", "human_id"],
        ),
        "annotations": {
            "readOnlyHint": False,
            "destructiveHint": False,
            "openWorldHint": False,
        },
    },
    {
        "name": "infra_apply",
        "description": "Inspect admission of an exact independently approved plan; cannot approve or bypass review.",
        "inputSchema": schema(
            {"plan_id": STRING, "plan_hash": STRING}, ["plan_id", "plan_hash"]
        ),
        "annotations": {
            "readOnlyHint": False,
            "destructiveHint": True,
            "openWorldHint": False,
        },
    },
    {
        "name": "infra_reconcile",
        "description": "Observe uncertain host outcome without replaying effects.",
        "inputSchema": schema({"plan_id": STRING}, ["plan_id"]),
        "annotations": {
            "readOnlyHint": True,
            "destructiveHint": False,
            "openWorldHint": False,
        },
    },
]
ROUTES = {
    "infra_inspect": ("read", "read"),
    "infra_prepare": ("prepare", "prepare"),
    "infra_apply": ("apply", "apply"),
    "infra_reconcile": ("read", "reconcile"),
}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Redirect forbidden")


def call(name, arguments):
    if name not in ROUTES or not isinstance(arguments, dict):
        raise ValueError("Unknown tool")
    tool = next(tool for tool in TOOLS if tool["name"] == name)
    shape = tool["inputSchema"]
    if (
        set(arguments) - shape["properties"].keys()
        or not set(shape["required"]) <= arguments.keys()
    ):
        raise ValueError("Closed tool arguments required")
    role, route = ROUTES[name]
    token = (SECRET_ROOT / (role + "-token")).read_text().strip()
    request = urllib.request.Request(
        BASE + "/v1/" + route,
        data=json.dumps(arguments).encode(),
        method="POST",
        headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
        },
    )
    opener = urllib.request.build_opener(NoRedirect(), urllib.request.ProxyHandler({}))
    failed = False
    try:
        with opener.open(request, timeout=60) as response:
            raw = response.read(200001)
    except urllib.error.HTTPError as exc:
        if exc.code != 409:
            raise ValueError("Infrastructure request denied or unavailable") from None
        raw = exc.read(16385)
        failed = True
    if len(raw) > 200000:
        raise ValueError("Response too large")
    result = json.loads(raw)
    return {
        "content": [{"type": "text", "text": json.dumps(result)}],
        "structuredContent": result,
        "isError": failed,
    }


def dispatch(message):
    method, params = message.get("method"), message.get("params", {})
    if method == "initialize":
        return {
            "protocolVersion": "2025-03-26",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "crate-infrastructure", "version": "1"},
        }
    if method == "ping":
        return {}
    if method == "tools/list":
        return {"tools": TOOLS}
    if method == "tools/call":
        return call(params["name"], params.get("arguments", {}))
    raise ValueError("Unsupported MCP method")


def main():
    while True:
        line = sys.stdin.buffer.readline(16385)
        if not line:
            return
        if len(line) > 16384 or not line.endswith(b"\n"):
            return
        identity = None
        try:
            message = json.loads(line)
            identity = message.get("id")
            if identity is None:
                continue
            response = {"jsonrpc": "2.0", "id": identity, "result": dispatch(message)}
        except Exception:  # noqa: BLE001 — fail closed without exposing host or credential details.
            response = {
                "jsonrpc": "2.0",
                "id": identity,
                "error": {
                    "code": -32603,
                    "message": "Infrastructure request unavailable",
                },
            }
        print(json.dumps(response, separators=(",", ":")), flush=True)


if __name__ == "__main__":
    main()

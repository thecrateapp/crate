"""Bounded read/watch MCP, never incident decisions or delivery mutation."""

import json
from pathlib import Path

from . import infra_mcp
from .delivery import request_json

ROOT = Path("/run/crate-supervisor-client")
BASE = "http://crate-operator-supervisor:8791"
ROUTES = {
    "supervisor_status": "/v1/status",
    "supervisor_incidents": "/v1/incidents",
    "supervisor_events": "/v1/events",
    "supervisor_delivery": "/v1/delivery",
    "supervisor_watch_job": "/v1/watch-job",
}
PAGES = {
    "supervisor_events": {
        "cursor": {"type": "integer", "minimum": 0},
        "limit": {"type": "integer", "minimum": 1, "maximum": 100},
    },
    "supervisor_incidents": {
        "offset": {"type": "integer", "minimum": 0, "maximum": 500},
        "limit": {"type": "integer", "minimum": 1, "maximum": 100},
    },
    "supervisor_delivery": {
        "offset": {"type": "integer", "minimum": 0, "maximum": 1000},
        "limit": {"type": "integer", "minimum": 1, "maximum": 50},
    },
}
TOOLS = [
    {
        "name": name,
        "description": "Read bounded independent supervisor evidence or register an exact job watch.",
        "inputSchema": infra_mcp.schema(
            {
                "job_id": {"type": "string"},
                "ttl": {"type": "integer", "minimum": 1, "maximum": 259200},
            }
            if name == "supervisor_watch_job"
            else PAGES.get(name, {}),
            ["job_id"] if name == "supervisor_watch_job" else [],
        ),
        "annotations": {
            "readOnlyHint": True,
            "destructiveHint": False,
            "openWorldHint": False,
        },
    }
    for name in ROUTES
]


def dispatch(message):
    method, params = message.get("method"), message.get("params", {})
    if method == "initialize":
        return {
            "protocolVersion": "2025-03-26",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "crate-supervisor", "version": "1"},
        }
    if method == "ping":
        return {}
    if method == "tools/list":
        return {"tools": TOOLS}
    if method != "tools/call" or params["name"] not in ROUTES:
        raise ValueError("Unknown supervisor tool")
    name, arguments = params["name"], params.get("arguments", {})
    schema = next(tool["inputSchema"] for tool in TOOLS if tool["name"] == name)
    if (
        not isinstance(arguments, dict)
        or set(arguments) - schema["properties"].keys()
        or not set(schema["required"]) <= arguments.keys()
    ):
        raise ValueError("Closed supervisor arguments")
    for key, value in arguments.items():
        shape = schema["properties"][key]
        if shape["type"] == "integer":
            if (
                type(value) is not int
                or value < shape["minimum"]
                or ("maximum" in shape and value > shape["maximum"])
            ):
                raise ValueError("Invalid supervisor bounds")
        elif not isinstance(value, str) or not value:
            raise ValueError("Invalid supervisor identifier")
    status, value = request_json(
        BASE + ROUTES[name],
        payload=json.dumps(arguments).encode()
        if name == "supervisor_watch_job"
        else None,
        headers={
            "Authorization": "Bearer " + (ROOT / "read-token").read_text().strip(),
            "Content-Type": "application/json",
        },
        timeout=5,
        query=arguments if name in PAGES else None,
    )
    return {
        "content": [{"type": "text", "text": json.dumps(value)}],
        "structuredContent": value,
        "isError": status != 200,
    }


if __name__ == "__main__":
    infra_mcp.dispatch = dispatch
    infra_mcp.main()

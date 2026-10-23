"""Real MCP SDK interoperability; synthetic credentials and loopback only."""

import asyncio
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest


def test_real_sdk_initialization_discovery_read_and_health_gap(tmp_path):
    mcp = pytest.importorskip("mcp")
    from mcp.client.stdio import StdioServerParameters, stdio_client

    observed = []
    for role in ("read", "prepare", "apply"):
        (tmp_path / (role + "-token")).write_text(role + "-synthetic-token" * 3)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            observed.append((self.path, body, self.headers["Authorization"]))
            if self.path == "/v1/prepare":
                status = 409
                result = {
                    "error": "health_coverage_missing",
                    "services": ["crate-worker"],
                }
            else:
                status, result = 200, {"service": "crate-api", "healthy": True}
            raw = json.dumps(result).encode()
            self.send_response(status)
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        root = Path(__file__).resolve().parents[2]
        code = (
            "from pathlib import Path; from deploy.operator import infra_mcp as m; "
            f"m.BASE='http://127.0.0.1:{server.server_port}'; "
            f"m.SECRET_ROOT=Path({str(tmp_path)!r}); m.main()"
        )

        async def check():
            params = StdioServerParameters(
                command=sys.executable, args=["-c", code], cwd=str(root)
            )
            async with (
                stdio_client(params) as (read, write),
                mcp.ClientSession(read, write) as session,
            ):
                initialized = await session.initialize()
                assert (
                    initialized.model_dump(by_alias=True)["serverInfo"]["name"]
                    == "crate-infrastructure"
                )
                names = {tool.name for tool in (await session.list_tools()).tools}
                assert names == {
                    "infra_inspect",
                    "infra_prepare",
                    "infra_apply",
                    "infra_reconcile",
                }
                result = await session.call_tool(
                    "infra_inspect", {"service": "crate-api"}
                )
                assert (
                    not result.model_dump(by_alias=True)["isError"]
                    and result.model_dump(by_alias=True)["structuredContent"]["healthy"]
                )
                result = await session.call_tool(
                    "infra_prepare",
                    {"operation": "restart", "target": "crate-worker", "human_id": 123},
                )
                assert result.model_dump(by_alias=True)["isError"]
                assert result.model_dump(by_alias=True)["structuredContent"][
                    "services"
                ] == ["crate-worker"]

        try:
            asyncio.run(check())
        finally:
            server.shutdown()
            thread.join(2)
    assert [row[0] for row in observed] == ["/v1/read", "/v1/prepare"]
    assert observed[0][2] != observed[1][2]

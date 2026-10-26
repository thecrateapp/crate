"""Actual stateless MCP protocol compatibility without network or live services."""

import asyncio
import json
import sys
from pathlib import Path

import pytest

pytest.importorskip("httpx2")
import httpx2

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from deploy.operator import server
from deploy.operator.server import MCPReader
from tests.test_mcp_transport import diagnostic_boundary as diagnostic_boundary  # noqa: PLC0414
from tests.test_mcp_transport import transport_app as transport_app  # noqa: PLC0414


@pytest.mark.parametrize(
    "name,args",
    [
        ("get_instance_inventory", {}),
        ("get_observability_summary", {}),
        ("get_pipeline_status", {"pipeline": "analysis"}),
        ("get_smart_mix_status", {}),
        ("get_job", {"job_id": "synthetic-task"}),
    ],
)
def test_stdlib_reader_requests_match_actual_crate_mcp(
    monkeypatch, transport_app, diagnostic_boundary, name, args
):
    from crate import agent_observability

    from tests.test_agent_observability import fixture_evidence

    app, tokens, _ = transport_app
    monkeypatch.setattr(
        agent_observability.evidence_store,
        "read_observation_evidence",
        lambda **_kwargs: fixture_evidence(),
    )
    monkeypatch.setattr(
        "crate.agent_diagnostics.agent_operations.read_job",
        lambda _job_id: {
            "id": "synthetic-task",
            "status": "completed",
            "updated_at": "2026-10-21T12:00:00Z",
            "verification_status": "unknown",
            "projection_status": "pending",
        },
    )

    def request(url, *, payload, headers, timeout):
        async def invoke():
            async with (
                app.router.lifespan_context(app),
                httpx2.AsyncClient(transport=httpx2.ASGITransport(app=app)) as client,
            ):
                response = await client.post(url, content=payload, headers=headers)
                return response.status_code, response.json()

        return asyncio.run(invoke())

    monkeypatch.setattr(server, "request_json", request)
    result = MCPReader("http://localhost:8585/mcp", tokens["all"]).call(name, args)
    assert result["schema_version"] == "1"
    assert len(json.dumps(result)) < 60000
    if name == "get_job":
        assert result["data"]["verification_status"] == "unknown"
        assert result["data"]["projection_status"] == "pending"


@pytest.mark.parametrize("custom", [False, True])
@pytest.mark.parametrize(
    "name,args",
    [("get_instance_inventory", {}), ("get_job", {"job_id": "synthetic-task"})],
)
def test_shipped_internal_authority_uses_fixed_host_with_actual_transport(
    monkeypatch, transport_app, diagnostic_boundary, custom, name, args
):

    from crate import agent_observability
    from crate.mcp.server import create_mcp_server
    from fastapi import FastAPI
    from starlette.routing import Route

    from deploy.operator.delivery import TransportError
    from tests.test_agent_observability import fixture_evidence

    config = json.loads(
        (
            Path(__file__).resolve().parents[2]
            / "deploy/operator/config.operator.example.json"
        ).read_text()
    )
    monkeypatch.setenv("DOMAIN", "example.com")
    monkeypatch.delenv("CRATE_MCP_ALLOWED_HOSTS", raising=False)
    host = config["mcp_host"]
    if custom:
        host = "mcp.example.test:8443"
        monkeypatch.setenv("CRATE_MCP_ALLOWED_HOSTS", host)
    monkeypatch.setattr(
        agent_observability.evidence_store,
        "read_observation_evidence",
        lambda **_: fixture_evidence(),
    )
    monkeypatch.setattr(
        "crate.agent_diagnostics.agent_operations.read_job",
        lambda _: {
            "id": "synthetic-task",
            "status": "completed",
            "updated_at": "2026-10-21T12:00:00Z",
            "verification_status": "unknown",
            "projection_status": "pending",
        },
    )
    calls = []

    def request(url, *, payload, headers, timeout):
        calls.append((url, headers["Host"]))

        async def invoke():
            _, fresh_manager, fresh_endpoint = create_mcp_server()
            fresh_app = FastAPI(redirect_slashes=False)
            fresh_app.router.routes.append(Route("/mcp", endpoint=fresh_endpoint))
            async with (
                fresh_manager.run(),
                httpx2.AsyncClient(
                    transport=httpx2.ASGITransport(app=fresh_app)
                ) as client,
            ):
                response = await client.post(url, content=payload, headers=headers)
                return (
                    response.status_code,
                    response.json() if response.status_code == 200 else {},
                )

        return asyncio.run(invoke())

    monkeypatch.setattr(server, "request_json", request)
    assert (
        MCPReader(config["mcp_url"], transport_app[1]["all"], host).call(name, args)[
            "schema_version"
        ]
        == "1"
    )
    assert calls[-1] == ("http://crate-api:8585/mcp", host)
    with pytest.raises(TransportError):
        MCPReader(config["mcp_url"], transport_app[1]["all"], "crate-api:8585").call(
            name, args
        )

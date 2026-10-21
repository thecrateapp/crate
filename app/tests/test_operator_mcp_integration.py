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

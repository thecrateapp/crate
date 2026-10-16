"""Distribution contracts report readiness and reject saturation without queuing."""

import asyncio
import json
from pathlib import Path
from threading import Event
from types import SimpleNamespace

import anyio
import mcp.types as types

from crate.agent_access import AgentPrincipal
from crate.agent_discovery import get_operation_catalog
from crate.mcp import tools
from tests.test_mcp_actions import action_transport as action_transport  # noqa: PLC0414


def test_protocol_negotiation_preserves_contract_version_and_rejects_unknown_revision(
    action_transport,
):
    import httpx2

    app, token, *_ = action_transport

    async def run():
        async with (
            app.router.lifespan_context(app),
            httpx2.AsyncClient(
                transport=httpx2.ASGITransport(app=app),
                base_url="http://localhost:8585",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/json, text/event-stream",
                },
            ) as client,
        ):
            rejected = await client.post(
                "/mcp",
                headers={"MCP-Protocol-Version": "2999-01-01"},
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/list",
                    "params": {},
                },
            )
            assert rejected.status_code == 400
            accepted = await client.post(
                "/mcp",
                json={
                    "jsonrpc": "2.0",
                    "id": 2,
                    "method": "initialize",
                    "params": {
                        "protocolVersion": "2025-11-25",
                        "capabilities": {},
                        "clientInfo": {"name": "phase7-compatibility", "version": "1"},
                    },
                },
            )
            assert accepted.status_code == 200, accepted.text
            assert accepted.json()["result"]["serverInfo"]["version"] == "1.0.0"
            assert accepted.json()["result"]["protocolVersion"] == "2025-11-25"

    asyncio.run(run())


def test_distribution_contains_every_tool_schema_and_no_private_configuration():
    from crate.mcp.contract import export_contract

    artifact = export_contract()
    definitions = {row["name"]: row for row in artifact["tools"]}
    assert len(definitions) == 49
    assert (
        definitions["editorial_plan_prepare"]["input_schema"]["additionalProperties"]
        is False
    )
    assert definitions["get_instance_status"]["read_only"] is True
    assert artifact["output_schema"]["additionalProperties"] is False
    assert "private_key" not in json.dumps(artifact)
    published = json.loads(
        (
            Path(__file__).resolve().parents[2] / "docs/technical/crate-mcp-v1.json"
        ).read_text()
    )
    assert published["version"] == artifact["version"]
    assert {row["name"]: row["input_schema_sha256"] for row in published["tools"]} == {
        row["name"]: row["input_schema_sha256"] for row in artifact["tools"]
    }


def test_auth_denial_metric_does_not_include_bearer_or_identity(monkeypatch):
    from fastapi.testclient import TestClient
    from crate.mcp.auth import AgentAuth
    from tests.test_mcp_auth import _identity

    samples = []
    monkeypatch.setattr(
        "crate.metrics.record_later", lambda *args: samples.append(args)
    )
    response = TestClient(AgentAuth(_identity)).post("/mcp")
    assert response.status_code == 401
    assert samples == [("mcp.auth.denied", 1)]


def test_catalog_versions_schemas_and_explains_missing_worker(monkeypatch):
    monkeypatch.setenv("CRATE_MCP_ACTIONS_ENABLED", "true")
    monkeypatch.setattr(
        "crate.agent_diagnostics.get_instance_status",
        lambda: {"data": {"worker": {"availability": "unavailable"}}},
    )
    principal = AgentPrincipal("a", "c", "Agent", frozenset({"library.health.run"}))
    catalog = get_operation_catalog(principal)["data"]
    assert catalog["contract"]["version"] == "1.0.0"
    assert catalog["contract"]["protocol_versions"]
    operations = {row["name"]: row for row in catalog["operations"]}
    health = operations["run_health_check"]
    assert health["status"] == "unavailable"
    assert health["readiness"]["missing"] == ["fresh_worker_evidence"]
    assert len(health["input_schema_sha256"]) == 64
    assert health["contract_version"] == "1.0.0"
    assert operations["get_instance_status"]["status"] == "denied"


def test_catalog_fresh_evidence_still_requires_exact_preview(monkeypatch):
    monkeypatch.setenv("CRATE_MCP_ACTIONS_ENABLED", "true")
    monkeypatch.setattr(
        "crate.agent_diagnostics.get_instance_status",
        lambda: {"data": {"worker": {"availability": "available"}}},
    )
    principal = AgentPrincipal("a", "c", "Agent", frozenset({"library.health.run"}))
    health = next(
        row
        for row in get_operation_catalog(principal)["data"]["operations"]
        if row["name"] == "run_health_check"
    )
    assert health["status"] == "enabled"
    assert health["readiness"]["status"] == "evidence_available"
    assert "target_preconditions" in health["readiness"]["checked_in_worker"]


def test_catalog_does_not_enable_actions_without_registered_worker_handlers(
    monkeypatch,
):
    from crate import worker

    monkeypatch.setenv("CRATE_MCP_ACTIONS_ENABLED", "true")
    monkeypatch.setattr(
        "crate.agent_diagnostics.get_instance_status",
        lambda: {"data": {"worker": {"availability": "available"}}},
    )
    monkeypatch.setattr(worker, "_HANDLER_GROUPS", ())
    principal = AgentPrincipal("a", "c", "Agent", frozenset({"library.health.run"}))
    health = next(
        row
        for row in get_operation_catalog(principal)["data"]["operations"]
        if row["name"] == "run_health_check"
    )
    assert health["status"] == "unavailable"
    assert health["readiness"]["missing"] == ["worker_handler_registration"]


def test_local_saturation_returns_retry_without_waiting_for_a_thread(monkeypatch):
    entered, release = Event(), Event()
    principal = AgentPrincipal("a", "c", "Agent", frozenset({"ops.status.read"}))
    context = SimpleNamespace(
        request=SimpleNamespace(
            state=SimpleNamespace(agent_principal=principal), scope={}
        )
    )

    def execute(*_args):
        entered.set()
        assert release.wait(5)
        return {"schema_version": "1", "availability": "available"}

    monkeypatch.setattr(tools, "_execute", execute)
    monkeypatch.setattr(
        tools, "_request_limiter", anyio.CapacityLimiter(1), raising=False
    )

    async def run():
        first = asyncio.create_task(
            tools.call_tool(
                context,
                types.CallToolRequestParams(name="get_instance_status", arguments={}),
            )
        )
        try:
            async with asyncio.timeout(2):
                while not entered.is_set():
                    await asyncio.sleep(0.001)
            second = await asyncio.wait_for(
                tools.call_tool(
                    context,
                    types.CallToolRequestParams(
                        name="get_instance_status", arguments={}
                    ),
                ),
                timeout=0.5,
            )
            assert second.structured_content["error"]["code"] == "RATE_LIMITED"
        finally:
            release.set()
            await first

    asyncio.run(run())


def test_tool_metrics_are_bounded_and_contain_no_request_content(monkeypatch):
    from crate.mcp.telemetry import record_tool_result

    samples = []
    monkeypatch.setattr(
        "crate.metrics.record_later", lambda *args: samples.append(args)
    )
    record_tool_result(
        "inspect_artist",
        12.5,
        {
            "error": {"code": "FORBIDDEN", "message": "private-token"},
            "data": {"artist": "private-artist"},
        },
        120,
    )
    assert {row[0] for row in samples} == {
        "mcp.tool.inspect_artist.latency_ms",
        "mcp.tool.inspect_artist.response_bytes",
        "mcp.tool.inspect_artist.denied",
        "mcp.tool.latency_ms",
        "mcp.tool.response_bytes",
        "mcp.tool.denied",
    }
    assert "private" not in json.dumps(samples)
    samples.clear()
    record_tool_result("private-unknown-tool", 1, {}, 10)
    assert samples == []


def test_worker_verification_failure_has_its_own_metric(monkeypatch):
    from crate.worker_handlers.agent_library import _handle_agent_maintenance

    samples = []
    monkeypatch.setattr(
        "crate.metrics.record_later", lambda *args: samples.append(args)
    )
    monkeypatch.setattr(
        "crate.worker_handlers.agent_library.execute_operation_job",
        lambda *_: {
            "status": "failed",
            "execution": {"status": "partial", "path": "/private"},
            "verification": {"status": "manual_reconciliation_required"},
        },
    )
    result = _handle_agent_maintenance("job", {}, {})
    assert result["verification"]["status"] == "manual_reconciliation_required"
    assert samples == [("mcp.job.verification_failed", 1)]
    assert "/private" not in json.dumps(result)


def test_mcp_metrics_can_be_read_only_through_the_closed_series_contract(monkeypatch):
    from crate.agent_diagnostics import read_diagnostics
    from crate.mcp.schemas import DiagnosticsInput

    monkeypatch.setattr("crate.metrics.query_recent", lambda *_, **__: [])
    args = DiagnosticsInput.model_validate(
        {"source": "metric_series", "series": "mcp.tool.denied"}
    )
    result = read_diagnostics(**args.model_dump())
    assert result["data"]["series"] == "mcp.tool.denied"
    assert result["availability"] == "unavailable"

"""Actual SDK discovery, grants, closed schemas and pure observation execution."""

import asyncio
from unittest.mock import Mock

import pytest
from crate import agent_observability as observations
from crate.agent_access import AgentPrincipal
from crate.agent_discovery import get_operation_catalog
from crate.mcp.tools import OBSERVATION_TOOLS

from tests.test_agent_observability import fixture_evidence
from tests.test_mcp_transport import (
    _client,
)
from tests.test_mcp_transport import (
    diagnostic_boundary as diagnostic_boundary,  # noqa: PLC0414
)
from tests.test_mcp_transport import (
    transport_app as transport_app,  # noqa: PLC0414
)

CASES = [
    ("get_instance_inventory", {}, "ops.status.read"),
    ("get_observability_summary", {}, "ops.status.read"),
    ("get_pipeline_status", {"pipeline": "analysis"}, "ops.status.read"),
    ("get_smart_mix_status", {}, "library.health.read"),
]


@pytest.mark.parametrize("name,arguments,grant", CASES)
def test_sdk_observations_enforce_grants_and_never_refresh(
    monkeypatch, transport_app, diagnostic_boundary, name, arguments, grant
):
    app, tokens, _ = transport_app
    reads = Mock(return_value=fixture_evidence())
    monkeypatch.setattr(observations.evidence_store, "read_observation_evidence", reads)
    forbidden = Mock(
        side_effect=AssertionError("Observation attempted a domain side effect")
    )
    for path in (
        "crate.api.smart_mix_admin.smart_mix_status",
        "crate.db.jobs.smart_mix_backfill.refresh_smart_mix_coverage",
        "crate.db.jobs.smart_mix_backfill.queue_next_smart_mix_batch",
        "crate.db.repositories.tasks.create_task",
        "crate.db.repositories.tasks.create_task_dedup",
        "crate.db.admin_stack_surface.get_cached_stack_surface",
        "crate.db.ops_snapshot.get_cached_ops_snapshot",
    ):
        monkeypatch.setattr(path, forbidden)

    async def run():
        async with app.router.lifespan_context(app):
            for kind in ("ops", "library"):
                allowed = (kind == "ops") == (grant == "ops.status.read")
                async with _client(app, tokens[kind]) as client:
                    catalog = {
                        tool.name: tool for tool in (await client.list_tools()).tools
                    }
                    assert (name in catalog) is allowed
                    if allowed:
                        assert catalog[name].annotations.read_only_hint
                        assert catalog[name].annotations.idempotent_hint
                        assert not catalog[name].annotations.open_world_hint
                        assert (
                            catalog[name].input_schema["additionalProperties"] is False
                        )
                    result = await client.call_tool(name, arguments)
                    assert bool(result.is_error) is not allowed
                    if allowed:
                        assert result.structured_content["data"]["sources"]
                    else:
                        assert result.structured_content["error"]["code"] == "FORBIDDEN"

    asyncio.run(run())
    reads.assert_called_once()
    forbidden.assert_not_called()
    assert diagnostic_boundary[1].call_count == 1


def test_discovery_and_export_have_consistent_limits_and_authority(monkeypatch):
    monkeypatch.setenv("CRATE_MCP_ACTIONS_ENABLED", "false")
    from crate.mcp.contract import export_contract

    artifact = export_contract()
    definitions = {tool["name"]: tool for tool in artifact["tools"]}
    for grant in ("ops.status.read", "library.health.read"):
        principal = AgentPrincipal("a", "c", "test", frozenset({grant}))
        entries = {
            tool["name"]: tool
            for tool in get_operation_catalog(principal)["data"]["operations"]
        }
        for name, (model, required, _) in OBSERVATION_TOOLS.items():
            assert entries[name]["status"] == (
                "enabled" if required == grant else "denied"
            )
            assert definitions[name]["base_grant"] == required
            assert definitions[name]["read_only"]
            assert definitions[name]["input_schema"] == model.model_json_schema()
            assert entries[name]["contract_version"] == "1.2.0"
    assert entries["get_smart_mix_status"]["limits"]["tracks"] == 50


@pytest.mark.parametrize(
    "name,args",
    [
        ("get_instance_inventory", {"refresh": True}),
        ("get_observability_summary", {"shell": "true"}),
        ("get_pipeline_status", {"pipeline": "unknown"}),
        ("get_smart_mix_status", {"track_uids": ["invalid"]}),
    ],
)
def test_sdk_rejects_closed_observation_inputs_before_read(
    monkeypatch, transport_app, diagnostic_boundary, name, args
):
    app, tokens, _ = transport_app
    reader = Mock()
    monkeypatch.setattr(
        observations.evidence_store, "read_observation_evidence", reader
    )

    async def run():
        async with (
            app.router.lifespan_context(app),
            _client(app, tokens["all"]) as client,
        ):
            result = await client.call_tool(name, args)
            assert result.is_error
            assert result.structured_content["error"]["code"] == "INVALID_ARGUMENT"

    asyncio.run(run())
    reader.assert_not_called()


@pytest.mark.parametrize("count,allowed", [(50, True), (51, False)])
def test_sdk_exact_track_maximum(
    monkeypatch, transport_app, diagnostic_boundary, count, allowed
):
    from tests.test_agent_observability import UIDS

    app, tokens, _ = transport_app
    reader = Mock(return_value=fixture_evidence())
    monkeypatch.setattr(
        observations.evidence_store, "read_observation_evidence", reader
    )

    async def run():
        async with (
            app.router.lifespan_context(app),
            _client(app, tokens["library"]) as client,
        ):
            result = await client.call_tool(
                "get_smart_mix_status", {"track_uids": UIDS[:count]}
            )
            assert bool(result.is_error) is not allowed
            if allowed:
                assert len(result.structured_content["data"]["tracks"]) == 50
            else:
                assert result.structured_content["error"]["code"] == "INVALID_ARGUMENT"

    asyncio.run(run())
    assert reader.call_count == int(allowed)

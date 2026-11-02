"""Actual SDK discovery, grants, closed schemas and pure observation execution."""

import asyncio
from unittest.mock import Mock

import pytest
from crate import agent_observability as observations
from crate.agent_access import AgentPrincipal
from crate.agent_discovery import get_operation_catalog
from crate.mcp.tools import OBSERVATION_TOOLS

from tests.test_agent_observability import fixture_evidence
from tests.test_agent_observability import (
    observation_clock as observation_clock,  # noqa: PLC0414
)
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
    assert entries["get_observability_summary"]["limits"]["response_bytes"] == 55000


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


def test_sdk_summary_rejects_oversized_unicode_producer_fields_and_preserves_other_sources(
    monkeypatch, transport_app, diagnostic_boundary
):
    import json

    from tests.test_agent_observability import record

    app, tokens, _ = transport_app
    evidence = fixture_evidence()
    evidence["runtime"][0] = record(
        "worker_live",
        dict.fromkeys(("engine", "pending_count", "running_count"), "\U0001f600" * 512),
    )
    monkeypatch.setattr(
        observations.evidence_store, "read_observation_evidence", lambda **kw: evidence
    )

    async def run():
        async with (
            app.router.lifespan_context(app),
            _client(app, tokens["ops"]) as client,
        ):
            response = await client.call_tool("get_observability_summary", {})
            assert not response.is_error
            result = response.structured_content
            assert len(json.dumps(result, ensure_ascii=False).encode()) < 60000
            worker = result["data"]["sources"]["worker_live"]
            assert worker["availability"] == "unavailable" and worker["data"] is None
            assert set(worker["invalid_fields"]) == {
                "engine",
                "pending_count",
                "running_count",
            }
            assert worker["observed_at"] == evidence["runtime"][0]["observed_at"]
            assert (
                result["data"]["sources"]["analysis_status"]["data"]["analysis_done"]
                == 17
            )
            assert set(result["data"]["subsystems"]) == set(
                observations.evidence_store.PIPELINES
            )

    asyncio.run(run())


def test_sdk_summary_whole_response_budget_retains_provenance_and_unaffected_sources(
    monkeypatch, transport_app, diagnostic_boundary
):
    import json

    app, tokens, _ = transport_app
    evidence = fixture_evidence()
    monkeypatch.setattr(
        observations.evidence_store, "read_observation_evidence", lambda **kw: evidence
    )
    original = observations._runtime

    def legacy_source(records, name, failure=None):
        source = original(records, name, failure)
        if name == "worker_live":
            # Exercise the final assembly budget independently of typed-field
            # validation: a future projection must not reintroduce the transport bug.
            source["data"] = dict.fromkeys(
                ("engine", "pending_count", "running_count"), "\U0001f600" * 512
            )
        return source

    monkeypatch.setattr(observations, "_runtime", legacy_source)

    async def run():
        async with (
            app.router.lifespan_context(app),
            _client(app, tokens["ops"]) as client,
        ):
            response = await client.call_tool("get_observability_summary", {})
            assert not response.is_error
            result = response.structured_content
            assert result["truncated"]
            assert len(json.dumps(result, ensure_ascii=False).encode()) < 60000
            assert (
                result["data"]["sources"]["analysis_status"]["data"]["analysis_done"]
                == 17
            )
            assert result["data"]["sources"]["imports_pending"]["data"]["count"] == 2
            for path in result["data"]["omitted_source_data"]:
                source = result["data"]
                for key in path.split("."):
                    source = source[key]
                assert source["availability"] == source["coverage"] == "unavailable"
                assert source["data"] is None and source["truncated"]
                assert source["source"] == "worker_live"
                assert source["observed_at"] == evidence["runtime"][0]["observed_at"]
                assert source["freshness"]["fresh_seconds"] == 180

    asyncio.run(run())


def test_sdk_inventory_durable_redis_and_bounded_service_strings(
    monkeypatch, transport_app, diagnostic_boundary
):
    import json

    from tests.test_agent_observability import record

    app, tokens, _ = transport_app
    evidence = fixture_evidence()
    evidence["snapshots"] = [
        record(
            "ops:stack",
            {
                "available": True,
                "containers": [
                    {
                        "name": observations.SERVICE_CONTAINER_NAMES.get(name, name),
                        "image": "registry.example/" + "a" * 100 + ":" + "x" * 100,
                        "state": "\U0001f600" * 512,
                    }
                    for name in observations.SERVICES
                ],
            },
        )
    ]
    monkeypatch.setattr(
        observations.evidence_store, "read_observation_evidence", lambda **kw: evidence
    )

    async def run():
        async with (
            app.router.lifespan_context(app),
            _client(app, tokens["ops"]) as client,
        ):
            response = await client.call_tool("get_instance_inventory", {})
            assert not response.is_error
            result = response.structured_content
            assert len(json.dumps(result, ensure_ascii=False).encode()) < 60000
            durable = result["data"]["services"]["redis-durable"]
            assert durable["container_name"] == "crate-redis-durable"
            assert durable["availability"] == "available"
            assert durable["data"]["image_reference"]
            assert durable["observed_at"] == evidence["snapshots"][0]["observed_at"]

    asyncio.run(run())


def test_sdk_smart_mix_worst_case_profile_budget_still_returns_exact_omissions(
    monkeypatch, transport_app, diagnostic_boundary
):
    import json

    from tests.test_agent_observability import NOW, UIDS

    app, tokens, _ = transport_app
    evidence = fixture_evidence()
    evidence["profiles"] = [
        {
            "track_uid": uid,
            "profile_version": 1,
            "analyzer_version": "v" * 128,
            "profile_revision": "r" * 128,
            "source_revision": "s" * 128,
            "quality": "full",
            "analyzed_at": str(NOW),
            "source_stale_at": None,
            "processing_state": "pending",
            "attempts": 3,
            "target_generation": "t" * 128,
            "completed_at": str(NOW),
            "processing_updated_at": str(NOW),
        }
        for uid in UIDS[:50]
    ]
    monkeypatch.setattr(
        observations.evidence_store, "read_observation_evidence", lambda **kw: evidence
    )

    async def run():
        async with (
            app.router.lifespan_context(app),
            _client(app, tokens["library"]) as client,
        ):
            response = await client.call_tool(
                "get_smart_mix_status", {"track_uids": UIDS[:50]}
            )
            assert not response.is_error
            result = response.structured_content
            assert result["truncated"]
            assert len(json.dumps(result, ensure_ascii=False).encode()) < 60000
            assert [item["track_uid"] for item in result["data"]["tracks"]] + result[
                "data"
            ]["omitted_track_uids"] == UIDS[:50]

    asyncio.run(run())


def summary_record(age=0, **sections):
    from datetime import timedelta

    from tests.test_agent_observability import NOW

    payload = {
        "schema_version": 1,
        "playback": {
            "availability": "available",
            "window_minutes": 15,
            "minimum_startups": 20,
            "startups": 40,
            "stalls_per_startup": 0.1,
        },
        "product_kpis": {
            "availability": "available",
            "end": "2025-01-01",
            "computed_at": "2025-01-01T00:00:00+00:00",
            "minimum_sample": 3,
            "windows": {
                "7": {"listening": {"listening.plays": {"kind": "daily", "sum": 60.0}}},
                "30": {
                    "listening": {"listening.plays": {"kind": "daily", "sum": 900.0}}
                },
            },
            "breakdowns": {
                "listening": {
                    "listening.plays_by_platform": {
                        "day": "2025-01-01",
                        "segments": [
                            {
                                "segment": "platform=ios",
                                "value": None,
                                "suppressed": True,
                            }
                        ],
                    }
                }
            },
        },
        "stack": {
            "availability": "available",
            "host": {"id": "crate", "name": "crate"},
            "observed_at": "2025-01-01T00:00:00+00:00",
            "application": {"services": 2, "running": 2},
            "monitoring": {"status": "degraded", "missing": ["crate-grafana"]},
            "resources": "live_only",
        },
        **sections,
    }
    return {
        "observed_at": (NOW - timedelta(seconds=age)).isoformat(),
        "oversized": False,
        "payload": payload,
    }


SUMMARY_CASES = [
    ("get_playback_quality", {}),
    ("get_product_kpis", {"window_days": 7}),
    ("get_stack_status", {}),
]


@pytest.mark.parametrize("name,arguments", SUMMARY_CASES)
def test_sdk_summary_tools_need_status_grant_and_never_compute(
    monkeypatch, transport_app, diagnostic_boundary, name, arguments
):
    app, tokens, _ = transport_app
    reads = Mock(return_value=summary_record())
    monkeypatch.setattr(observations.summary_store, "read_observability_summary", reads)
    forbidden = Mock(side_effect=AssertionError("Summary tool computed evidence"))
    for path in (
        "crate.observability.summary.compute_observability_summary",
        "crate.observability.summary.build_observability_summary",
        "crate.db.repositories.tasks.create_task",
        "crate.db.admin_stack_surface.get_cached_stack_surface",
    ):
        monkeypatch.setattr(path, forbidden)

    async def run():
        async with app.router.lifespan_context(app):
            for kind in ("ops", "library"):
                async with _client(app, tokens[kind]) as client:
                    result = await client.call_tool(name, arguments)
                    assert bool(result.is_error) is (kind == "library")
                    if kind == "ops":
                        assert result.structured_content["data"]["sources"]

    asyncio.run(run())
    reads.assert_called_once()
    forbidden.assert_not_called()


def test_sdk_product_kpis_rejects_other_windows_before_read(
    monkeypatch, transport_app, diagnostic_boundary
):
    app, tokens, _ = transport_app
    reader = Mock()
    monkeypatch.setattr(
        observations.summary_store, "read_observability_summary", reader
    )

    async def run():
        async with (
            app.router.lifespan_context(app),
            _client(app, tokens["all"]) as client,
        ):
            result = await client.call_tool("get_product_kpis", {"window_days": 90})
            assert result.structured_content["error"]["code"] == "INVALID_ARGUMENT"

    asyncio.run(run())
    reader.assert_not_called()


def test_summary_tools_report_the_window_and_suppressed_segments(monkeypatch):
    monkeypatch.setattr(
        observations.summary_store, "read_observability_summary", summary_record
    )

    week = observations.get_product_kpis(7)["data"]
    month = observations.get_product_kpis(30)["data"]

    listening = week["sources"]["listening"]
    assert listening["availability"] == "available"
    assert listening["data"]["kpis"]["listening.plays"]["sum"] == 60.0
    assert (
        month["sources"]["listening"]["data"]["kpis"]["listening.plays"]["sum"] == 900.0
    )
    segment = listening["data"]["breakdowns"]["listening.plays_by_platform"][
        "segments"
    ][0]
    assert segment == {"segment": "platform=ios", "value": None, "suppressed": True}
    assert week["sources"]["federation"]["availability"] == "unavailable"
    assert week["minimum_sample"] == 3

    stack = observations.get_stack_status()["data"]
    assert stack["sources"]["monitoring"]["data"]["missing"] == ["crate-grafana"]
    assert stack["resources"] == "live_only"


@pytest.mark.parametrize(
    "record,reason",
    [
        ({}, "Observability summary is opt-in and has not run"),
        ({**summary_record(), "oversized": True, "payload": None}, "49152"),
    ],
)
def test_missing_or_oversized_summary_is_unavailable(monkeypatch, record, reason):
    monkeypatch.setattr(
        observations.summary_store, "read_observability_summary", lambda: record
    )

    for result in (
        observations.get_playback_quality(),
        observations.get_product_kpis(30),
        observations.get_stack_status(),
    ):
        assert result["availability"] == "unavailable"
        for source in result["data"]["sources"].values():
            assert source["data"] is None
            assert reason in source["reason"]


def test_summary_section_states_and_age_are_not_healthy(monkeypatch):
    empty = summary_record(
        product_kpis={"availability": "empty", "reason": "no_computed_kpis"},
        playback={"availability": "unavailable", "reason": "metric_source_unavailable"},
    )
    monkeypatch.setattr(
        observations.summary_store, "read_observability_summary", lambda: empty
    )
    playback = observations.get_playback_quality()["data"]["sources"]["playback"]
    assert (playback["availability"], playback["reason"]) == (
        "unavailable",
        "metric_source_unavailable",
    )
    kpis = observations.get_product_kpis(30)["data"]["sources"]
    assert {source["availability"] for source in kpis.values()} == {"unavailable"}

    old = summary_record(age=3600)
    monkeypatch.setattr(
        observations.summary_store, "read_observability_summary", lambda: old
    )
    assert observations.get_playback_quality()["availability"] == "stale"

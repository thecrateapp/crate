"""Large private execution evidence remains inspectable through bounded MCP outcomes."""

import asyncio
import copy
import hashlib
import json
from dataclasses import replace

import pytest
from sqlalchemy import text

from crate import agent_discovery, agent_library_operations as operations
from crate.agent_access import ALLOWED_GRANTS
from crate.agent_diagnostics import DiagnosticError
from crate.agent_operation_catalog import (
    operation_result_items,
    operation_result_summary,
)
from crate.db.repositories import agent_plans as plans
from crate.db.repositories.tasks_updates import start_task
from crate.db.tx import read_scope

from tests.agent_command_fixtures import change, other_principal
from tests.test_agent_enrichment import enrichment_artist as enrichment_artist
from tests.test_agent_metadata import metadata_library as metadata_library
from tests.test_mcp_actions import _client
from tests.test_mcp_actions import action_transport as action_transport

pytest_plugins = ["tests.agent_command_fixtures"]


def _size(value):
    return len(json.dumps(value, ensure_ascii=False, default=str).encode())


def _hash(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode()
    ).hexdigest()


@pytest.fixture
def result_world(command_world, action_transport, monkeypatch):
    monkeypatch.setenv("CRATE_MCP_ENABLED", "true")
    monkeypatch.setattr("crate.worker_handlers.is_cancelled", lambda _: False)
    app, token, _, credentials, _ = action_transport
    credentials[token] = command_world["principal"]
    return {**command_world, "app": app, "token": token, "credentials": credentials}


def _prepare(world, operation, parameters):
    queued = operations.prepare_operation(
        world["principal"], operation, parameters, "prepare"
    )["data"]
    start_task(queued["job_id"])
    result = operations.execute_operation_job(queued["job_id"], world["config"])
    assert result["execution"]["status"] == "prepared", result
    return result["plan"]


def _apply(world, operation, plan):
    queued = operations.apply_operation(
        world["principal"], operation, plan["plan_id"], plan["plan_version"], "apply"
    )["data"]
    start_task(queued["job_id"])
    raw = operations.execute_operation_job(queued["job_id"], world["config"])
    assert raw["execution"]["status"] == "completed", raw
    return queued["job_id"], raw


def test_near_budget_metadata_plan_retains_complete_diff_after_execution(
    result_world, metadata_library
):
    world = result_world
    before, after = "b" * 17000, "a" * 18000
    change(
        "UPDATE library_artists SET bio=:bio WHERE id=:id",
        {"bio": before, "id": metadata_library["artist_id"]},
    )
    plan = _prepare(
        world,
        "metadata_update",
        {
            "entity_type": "artist",
            "entity_uid": metadata_library["artist_uid"],
            "patch": {"bio": after},
        },
    )
    job_id, raw = _apply(world, "metadata_update", plan)
    full = plans.get_plan(plan["plan_id"])
    assert _size(full) > 60000
    assert full["result"] == raw

    async def run():
        async with (
            world["app"].router.lifespan_context(world["app"]),
            _client(world["app"], world["token"]) as session,
        ):
            client, _ = session
            response = await client.call_tool("get_plan", {"plan_id": plan["plan_id"]})
            assert response.is_error is False, response
            payload = response.structured_content
            assert _size(payload) < 60000
            document = payload["data"]
            assert document["changes"] == plan["changes"]
            assert document["changes"][0]["before"] == before
            assert document["changes"][0]["after"] == after
            result = document["result"]
            assert result["details"]["result_hash"] == _hash(raw)
            assert result["details"]["job_id"] == job_id
            assert result["details"]["plan_id"] == plan["plan_id"]
            assert result["items"][0]["modified_fields"] == ["bio"]
            assert after not in json.dumps(result)
            assert result["next_cursor"] is None

    asyncio.run(run())


def test_real_large_setlists_are_private_and_replay_and_owned_outcomes_stay_bounded(
    result_world, enrichment_artist, monkeypatch
):
    world = result_world
    monkeypatch.setattr(
        "crate.agent_enrichment._fetch",
        lambda *_: [{"name": "x" * 5000, "count": index} for index in range(120)],
    )
    plan = _prepare(
        world,
        "enrichment",
        {
            "artist_uids": [enrichment_artist["uid"]],
            "providers": ["setlist"],
            "facets": ["setlists"],
            "mode": "refresh",
        },
    )
    job_id, raw = _apply(world, "enrichment", plan)
    setlists = raw["execution"]["items"][0]["providers"][0]["facets"][0]["after"][
        "setlists"
    ]
    assert len(setlists) == 100
    assert len(setlists[0]["name"]) == 4096
    assert _size(raw) > 400000
    assert plans.get_plan(plan["plan_id"])["result"] == raw
    with read_scope() as current:
        stored = current.execute(
            text("SELECT result FROM agent_jobs WHERE task_id=:id"), {"id": job_id}
        ).scalar_one()
        audit = current.execute(
            text(
                "SELECT details_json FROM audit_log WHERE action='agent.operation.finished' AND target_name=:id"
            ),
            {"id": job_id},
        ).scalar_one()
    assert stored == raw
    assert audit["result"] == raw

    async def run():
        async with (
            world["app"].router.lifespan_context(world["app"]),
            _client(world["app"], world["token"]) as session,
        ):
            client, _ = session
            replay = await client.call_tool(
                "run_enrichment",
                {
                    "plan_id": plan["plan_id"],
                    "plan_version": plan["plan_version"],
                    "idempotency_key": "apply",
                },
            )
            assert replay.is_error is False, replay
            summary = replay.structured_content["data"]
            assert summary["replayed"] is True
            assert summary["job_id"] == job_id
            assert summary["result"]["details"]["result_hash"] == _hash(raw)
            assert _size(replay.structured_content) < 5000
            seen, cursor = [], None
            while True:
                arguments = {"plan_id": plan["plan_id"], "limit": 1}
                if cursor:
                    arguments["cursor"] = cursor
                response = await client.call_tool("get_plan", arguments)
                assert response.is_error is False, response
                result = response.structured_content["data"]["result"]
                seen.extend(result["items"])
                cursor = result["next_cursor"]
                if not cursor:
                    break
            assert len(seen) == result["total"] == 4
            assert len({row["result_path"] for row in seen}) == len(seen)
            facet = next(row for row in seen if row.get("facet") == "setlists")
            assert facet["artist_uid"] == enrichment_artist["uid"]
            assert facet["provider"] == "setlist"
            assert facet["status"] == "applied"
            assert facet["modified_fields"] == ["setlists"]
            assert "x" * 4096 not in json.dumps(seen)

            first = await client.call_tool(
                "get_plan", {"plan_id": plan["plan_id"], "limit": 1}
            )
            world["credentials"][world["token"]] = other_principal()
            denied = await client.call_tool(
                "get_plan",
                {
                    "plan_id": plan["plan_id"],
                    "cursor": first.structured_content["next_cursor"],
                },
            )
            assert denied.is_error is True
            assert denied.structured_content["error"]["code"] in {
                "NOT_FOUND",
                "FORBIDDEN",
            }

    asyncio.run(run())


def _large_document():
    return {
        "operation": "enrichment",
        "plan_id": "a3df9dca-dca2-42f0-b35b-dbf5ddf1c89f",
        "job_id": "job-large",
        "plan_version": "a" * 64,
        "changes": [{"field": "bio", "before": None, "after": "z" * 38000}],
        "result": {
            "execution": {
                "status": "completed",
                "items": [
                    {
                        "artist_uid": f"10000000-0000-0000-0000-{index:012d}",
                        "status": "completed",
                        "providers": [
                            {
                                "provider": provider,
                                "status": "completed",
                                "verification": "passed",
                                "facets": [
                                    {
                                        "facet": facet,
                                        "status": "applied",
                                        "before": {"bio": "old" * 2000},
                                        "after": {"bio": "new" * 2000},
                                    }
                                    for facet in (
                                        "biography",
                                        "tags",
                                        "genres",
                                        "identity",
                                        "urls",
                                        "members",
                                        "popularity",
                                        "similar_artists",
                                        "setlists",
                                    )
                                ],
                            }
                            for provider in (
                                "lastfm",
                                "spotify",
                                "musicbrainz",
                                "discogs",
                                "setlist",
                            )
                        ],
                    }
                    for index in range(20)
                ],
            },
            "verification": {"status": "passed"},
        },
    }


def test_outcome_pages_obey_byte_budget_and_cursor_binds_complete_evidence_and_authority(
    action_transport, monkeypatch
):
    app, token, principal, credentials, _ = action_transport
    principal = replace(principal, grants=ALLOWED_GRANTS)
    credentials[token] = principal
    document = _large_document()
    monkeypatch.setattr(
        agent_discovery, "get_owned_plan", lambda *_: copy.deepcopy(document)
    )
    seen, cursor = [], None
    while True:
        response = agent_discovery.get_plan(
            principal, plan_id=document["plan_id"], limit=100, cursor=cursor
        )
        result = response["data"]["result"]
        assert response["data"]["changes"] == document["changes"]
        assert _size(response) < 60000
        assert _size(result["items"]) <= 12000
        seen.extend(result["items"])
        cursor = response["next_cursor"]
        if not cursor:
            break
    assert len(seen) == result["total"] == 1020
    assert len({row["result_path"] for row in seen}) == 1020
    first = agent_discovery.get_plan(principal, plan_id=document["plan_id"], limit=1)
    cursor = first["next_cursor"]
    assert cursor
    with pytest.raises(DiagnosticError, match="cursor|filters"):
        agent_discovery.get_plan(
            replace(principal, id="other"), plan_id=document["plan_id"], cursor=cursor
        )
    with pytest.raises(DiagnosticError, match="cursor|filters"):
        agent_discovery.get_plan(
            replace(principal, authorization_id="another"),
            plan_id=document["plan_id"],
            cursor=cursor,
        )
    document["result"]["execution"]["items"][0]["providers"][0]["facets"][0]["after"][
        "bio"
    ] = "changed"
    with pytest.raises(DiagnosticError) as caught:
        agent_discovery.get_plan(principal, plan_id=document["plan_id"], cursor=cursor)
    assert caught.value.code == "CURSOR_STALE"


@pytest.mark.parametrize("limit", [0, 101, True, 1.5])
def test_plan_outcome_page_size_is_validated_before_reads(monkeypatch, limit):
    monkeypatch.setattr(
        agent_discovery,
        "get_owned_plan",
        lambda *_: pytest.fail("invalid limit read a plan"),
    )
    with pytest.raises(DiagnosticError) as caught:
        agent_discovery.get_plan(None, plan_id="unused", limit=limit)
    assert caught.value.code == "INVALID_ARGUMENT"


def test_compact_export_keeps_the_authenticated_download_reference():
    artifact_id = "a3df9dca-dca2-42f0-b35b-dbf5ddf1c89f"
    raw = {
        "execution": {
            "status": "completed",
            "artifacts": [
                {
                    "artifact_id": artifact_id,
                    "download_path": f"/mcp/artifacts/{artifact_id}",
                    "sha256": "a" * 64,
                    "byte_size": 1234,
                    "expires_in_seconds": 86400,
                }
            ],
        },
        "verification": {"status": "passed"},
    }
    summary = operation_result_summary(raw, plan_id="plan", job_id="job")
    assert summary["artifacts"][0]["download_path"] == f"/mcp/artifacts/{artifact_id}"
    assert operation_result_items(raw)[0]["artifact_id"] == artifact_id
    assert operation_result_items(raw)[0]["status"] == "completed"
    assert _size(summary) < 2000


def test_analysis_outcomes_preserve_generation_and_direct_to_pipeline_verification():
    raw = {
        "execution": {
            "status": "requeued",
            "references": [
                {
                    "track_uid": "10000000-0000-0000-0000-000000000001",
                    "pipeline": "analysis",
                    "generation": 2,
                    "source_version": "a" * 64,
                }
            ],
        },
        "verification": {"status": "pending"},
    }
    summary = operation_result_summary(raw, plan_id="plan", job_id="job")
    assert summary["details"]["analysis_status"] == {
        "tool": "get_analysis_status",
        "plan_id": "plan",
    }
    row = operation_result_items(raw)[0]
    assert row["generation"] == 2
    assert row["status"] == "requeued"


def test_compact_check_results_keep_failed_checks_and_quality_publication_evidence():
    health = {
        "execution": {
            "status": "partial",
            "checks": ["photo", "tags"],
            "failed_checks": ["tags"],
            "issue_count": 7,
        },
        "verification": {"status": "incomplete"},
    }
    summary = operation_result_summary(health)
    assert summary["execution"]["checks"] == ["photo", "tags"]
    assert summary["execution"]["failed_checks"] == ["tags"]
    quality = {
        "execution": {
            "status": "conflict",
            "code": "SOURCE_CHANGED",
            "report": {
                "status": "conflict",
                "published": False,
                "scanned_tracks": 200,
                "verification": "library_changed_during_scan",
            },
        },
        "verification": {"status": "conflict"},
    }
    assert operation_result_summary(quality)["execution"]["code"] == "SOURCE_CHANGED"
    rows = operation_result_items(quality)
    assert rows[0]["published"] is False
    assert rows[0]["scanned_tracks"] == 200
    assert rows[0]["verification"] == "library_changed_during_scan"

"""Structured show tools share Admin identity without invoking server extraction."""

from datetime import UTC, datetime, timedelta

import pytest

from tests.test_mcp_actions import action_transport as action_transport  # noqa: PLC0414

from crate import agent_shows
from crate.agent_diagnostics import DiagnosticError
from crate.db.repositories.agent_credentials import create_credential
from crate.db.repositories.show_identities import upsert_canonical_show
from tests.test_show_import_plans import items, execute
from tests.test_show_import_plans import show_world as show_world  # noqa: PLC0414


def test_structured_mcp_replays_the_same_canonical_id_as_admin(show_world, monkeypatch):
    monkeypatch.setenv("CRATE_MCP_ENABLED", "true")
    monkeypatch.setenv("CRATE_MCP_ACTIONS_ENABLED", "true")
    principal = create_credential(
        "Shows",
        ["curation.shows.read", "curation.shows.write", "ops.jobs.read"],
        datetime.now(UTC) + timedelta(days=1),
    ).principal
    original = upsert_canonical_show(
        items()[0], {"provider": "manual", "actor": "human:1"}
    )
    queued = agent_shows.preview_shows_import(
        principal, candidates=items(), idempotency_key="preview"
    )["data"]
    plan = execute(queued)["plan"]
    applied = agent_shows.apply_shows_import(
        principal,
        plan_id=plan["plan_id"],
        plan_version=plan["plan_version"],
        idempotency_key="save",
    )["data"]
    result = execute(applied)
    assert result["execution"]["items"][0]["show_id"] == original["show_id"]
    assert (
        agent_shows.apply_shows_import(
            principal,
            plan_id=plan["plan_id"],
            plan_version=plan["plan_version"],
            idempotency_key="save",
        )["data"]["job_id"]
        == applied["job_id"]
    )
    found = agent_shows.search_shows(principal, query="External", limit=1)["data"]
    assert found["items"][0]["id"] == original["show_id"]
    assert "field_provenance" not in found["items"][0]
    assert agent_shows.search_shows(principal, query="Missing")["data"]["items"] == []
    with pytest.raises(DiagnosticError):
        agent_shows.search_shows(principal, limit=1000)


def test_show_catalog_has_closed_inputs_and_canonical_outcomes():
    from crate.agent_operation_catalog import operation_result_items
    from crate.mcp.tools import CATALOG, ACTION_CATALOG

    assert CATALOG["search_shows"][1] == "curation.shows.read"
    model = ACTION_CATALOG["preview_shows_import"][0]
    with pytest.raises(ValueError):
        model.model_validate(
            {
                "candidates": items(),
                "idempotency_key": "p",
                "extract_url": "https://x.test",
            }
        )
    outcomes = operation_result_items(
        {
            "execution": {
                "items": [
                    {
                        "item_id": "date-1",
                        "show_id": 7,
                        "revision": 2,
                        "status": "created",
                    }
                ]
            }
        }
    )
    assert any(
        row.get("show_id") == 7 and row.get("item_id") == "date-1" for row in outcomes
    )


def test_two_integrations_apply_competing_exact_previews_without_duplicate_events(
    show_world, monkeypatch
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from crate.db.tx import read_scope
    from sqlalchemy import text

    monkeypatch.setenv("CRATE_MCP_ENABLED", "true")
    monkeypatch.setenv("CRATE_MCP_ACTIONS_ENABLED", "true")
    principals = [
        create_credential(
            "Shows " + str(index),
            ["curation.shows.read", "curation.shows.write"],
            datetime.now(UTC) + timedelta(days=1),
        ).principal
        for index in range(2)
    ]
    plans = []
    for principal in principals:
        accepted = agent_shows.preview_shows_import(
            principal, candidates=items(), idempotency_key="prepare"
        )["data"]
        plans.append(execute(accepted)["plan"])
    barrier = Barrier(2)

    def attempt(index):
        barrier.wait()
        try:
            accepted = agent_shows.apply_shows_import(
                principals[index],
                plan_id=plans[index]["plan_id"],
                plan_version=plans[index]["plan_version"],
                idempotency_key="apply",
            )["data"]
        except DiagnosticError as error:
            assert error.code == "TARGET_BUSY"
            return None
        return execute(accepted)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(attempt, range(2)))
    for index, result in enumerate(results):
        if result is None:
            accepted = agent_shows.apply_shows_import(
                principals[index],
                plan_id=plans[index]["plan_id"],
                plan_version=plans[index]["plan_version"],
                idempotency_key="apply",
            )["data"]
            results[index] = execute(accepted)
    assert len({result["execution"]["items"][0]["show_id"] for result in results}) == 1
    with read_scope() as db:
        assert db.execute(text("SELECT count(*) FROM shows")).scalar() == 1
        assert db.execute(text("SELECT count(*) FROM show_sources")).scalar() == 2


def test_sdk_show_workflow_exposes_exact_selection_and_stable_canonical_outcomes(
    show_world, action_transport, monkeypatch
):
    import asyncio
    from tests.test_mcp_actions import _client

    app, _, _, credentials, _ = action_transport
    monkeypatch.setenv("CRATE_MCP_ENABLED", "true")
    monkeypatch.setenv("CRATE_MCP_ACTIONS_ENABLED", "true")
    issued = create_credential(
        "SDK show client",
        ["curation.shows.read", "curation.shows.write", "ops.jobs.read"],
        datetime.now(UTC) + timedelta(days=1),
    )
    credentials[issued.token] = issued.principal

    async def run():
        async with (
            app.router.lifespan_context(app),
            _client(app, issued.token) as session,
        ):
            client, _ = session
            names = {tool.name for tool in (await client.list_tools()).tools}
            assert {
                "search_shows",
                "preview_shows_import",
                "apply_shows_import",
                "get_plan",
                "get_job",
            } <= names
            accepted = await client.call_tool(
                "preview_shows_import",
                {"candidates": items(), "idempotency_key": "sdk-preview"},
            )
            assert not accepted.is_error, accepted.structured_content
            prepared = execute(accepted.structured_content["data"])
            plan_id = prepared["plan"]["plan_id"]
            evidence = await client.call_tool("get_plan", {"plan_id": plan_id})
            assert (
                evidence.structured_content["data"]["changes"][0]["after"]["date"]
                == "2027-03-02"
            )
            assert "extract_url" not in evidence.structured_content["data"]
            params = {
                "plan_id": plan_id,
                "plan_version": prepared["plan"]["plan_version"],
                "idempotency_key": "sdk-apply",
            }
            queued = await client.call_tool("apply_shows_import", params)
            assert not queued.is_error, queued.structured_content
            result = execute(queued.structured_content["data"])
            canonical_id = result["execution"]["items"][0]["show_id"]
            replay = await client.call_tool("apply_shows_import", params)
            assert (
                replay.structured_content["data"]["job_id"]
                == queued.structured_content["data"]["job_id"]
            )
            search = await client.call_tool("search_shows", {"query": "External"})
            assert search.structured_content["data"]["items"][0]["id"] == canonical_id
            evidence = await client.call_tool("get_plan", {"plan_id": plan_id})
            assert any(
                item.get("show_id") == canonical_id
                for item in evidence.structured_content["data"]["result"]["items"]
            )

    asyncio.run(run())

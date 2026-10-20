"""Maintenance discovery remains bounded, authenticated and ownership scoped."""

import asyncio
from dataclasses import replace
from unittest.mock import Mock
from uuid import uuid4

import pytest

from crate.agent_access import ALLOWED_GRANTS, AgentPrincipal
from crate.agent_diagnostics import DiagnosticError
from crate.db.repositories import agent_plans, mcp_oauth
from crate.repair_catalog import REPAIR_CATALOG_BY_CHECK

from tests.agent_command_fixtures import change, observed_plan, other_principal
from tests.agent_command_fixtures import command_world as command_world  # noqa: PLC0414 — pytest fixture registration.
from tests.test_mcp_actions import _client
from tests.test_mcp_actions import action_transport as action_transport  # noqa: PLC0414 — pytest fixture registration.
from tests.test_mcp_oauth_integration import _code, _exchange
from tests.test_mcp_oauth_integration import oauth_env as oauth_env  # noqa: PLC0414 — pytest fixture registration.

NEW_READS = {
    "get_operation_catalog",
    "get_plan",
    "get_library_quality",
    "read_audit",
    "list_schedules",
    "get_runtime_policy",
}
INSTANCE_ACTIONS = {
    "preview_job_retry",
    "apply_job_retry",
    "preview_job_cancel",
    "apply_job_cancel",
    "run_schedule",
    "preview_schedule_update",
    "apply_schedule_update",
    "preview_runtime_update",
    "apply_runtime_update",
}
PLAN_ID = "a3df9dca-dca2-42f0-b35b-dbf5ddf1c89f"


@pytest.mark.parametrize(
    "grants,expected",
    [
        (frozenset(), set()),
        (frozenset({"ops.status.read"}), {"get_operation_catalog"}),
        (
            frozenset({"library.health.read"}),
            {"get_operation_catalog", "get_library_quality"},
        ),
        (
            frozenset({"library.repair.photo_flag"}),
            {"get_operation_catalog", "get_plan"},
        ),
        (frozenset({"library.health.run"}), {"get_operation_catalog", "get_plan"}),
        (frozenset({"ops.audit.read"}), {"get_operation_catalog", "read_audit"}),
        (
            frozenset({"ops.schedules.read"}),
            {"get_operation_catalog", "list_schedules"},
        ),
        (
            frozenset({"ops.runtime.read"}),
            {"get_operation_catalog", "get_runtime_policy"},
        ),
        (frozenset({"ops.jobs.cancel"}), {"get_operation_catalog", "get_plan"}),
        (frozenset({"ops.runtime.write"}), {"get_operation_catalog", "get_plan"}),
    ],
)
def test_new_reads_have_independent_discovery_and_call_authorization(
    action_transport, monkeypatch, grants, expected
):
    app, token, principal, credentials, admission = action_transport
    credentials[token] = AgentPrincipal(
        principal.id, principal.credential_id, principal.name, grants
    )
    operations = {}
    for name in NEW_READS:
        operation = Mock(side_effect=AssertionError("Denied call reached service"))
        module = {
            "read_audit": "agent_diagnostics",
            "list_schedules": "agent_operations",
            "get_runtime_policy": "agent_operations",
        }.get(name, "agent_discovery")
        monkeypatch.setattr(f"crate.{module}.{name}", operation)
        operations[name] = operation

    async def run():
        async with app.router.lifespan_context(app), _client(app, token) as session:
            client, _ = session
            listed = (await client.list_tools()).tools
            assert {tool.name for tool in listed} & NEW_READS == expected
            for tool in listed:
                if tool.name in NEW_READS:
                    assert tool.annotations.read_only_hint is True
                    assert tool.annotations.destructive_hint is False
                    assert tool.input_schema["additionalProperties"] is False
            for name in NEW_READS - expected:
                arguments = {"plan_id": PLAN_ID} if name == "get_plan" else {}
                result = await client.call_tool(name, arguments)
                assert result.is_error is True
                assert result.structured_content["error"]["code"] == "FORBIDDEN"

    asyncio.run(run())
    admission.assert_not_called()
    for operation in operations.values():
        operation.assert_not_called()


@pytest.mark.parametrize("enabled", ["true", "false"])
def test_operation_catalog_describes_real_tools_and_only_supported_repairs(
    action_transport, monkeypatch, enabled
):
    app, token, *_ = action_transport
    monkeypatch.setenv("CRATE_MCP_ACTIONS_ENABLED", enabled)

    async def run():
        async with app.router.lifespan_context(app), _client(app, token) as session:
            client, _ = session
            result = await client.call_tool("get_operation_catalog", {})
            assert result.is_error is False, result
            payload = result.structured_content
            assert payload["availability"] == "available"
            operations = {item["name"]: item for item in payload["data"]["operations"]}
            advertised = {tool.name for tool in (await client.list_tools()).tools}
            assert {
                name
                for name, item in operations.items()
                if item["status"] in {"enabled", "unavailable"}
            } == advertised
            assert NEW_READS <= operations.keys()
            assert INSTANCE_ACTIONS <= operations.keys()
            assert operations["run_quality_check"]["status"] == (
                "disabled" if enabled == "false" else "denied"
            )
            assert operations["run_health_check"]["status"] == (
                "unavailable" if enabled == "true" else "disabled"
            )
            checks = {item["check_type"]: item for item in payload["data"]["checks"]}
            assert checks.keys() == REPAIR_CATALOG_BY_CHECK.keys()
            assert len(checks) == 17
            assert checks["has_photo_desync"]["mcp_support"] == "automatic"
            for item in checks.values():
                assert item["mcp_support"] in {"automatic", "manual", "unavailable"}
                if item["mcp_support"] != "automatic":
                    assert item["reason"]
                else:
                    assert item["verification"] not in {None, "unavailable"}

    asyncio.run(run())


def test_operation_catalog_distinguishes_missing_grants_from_disabled_actions(
    action_transport,
):
    app, token, principal, credentials, _admission = action_transport
    credentials[token] = replace(principal, grants=frozenset({"ops.status.read"}))

    async def run():
        async with app.router.lifespan_context(app), _client(app, token) as session:
            client, _ = session
            result = await client.call_tool("get_operation_catalog", {})
            assert result.is_error is False
            operations = {
                item["name"]: item
                for item in result.structured_content["data"]["operations"]
            }
            assert operations["get_instance_status"]["status"] == "enabled"
            assert operations["get_library_quality"]["status"] == "denied"
            assert operations["get_library_quality"]["required_grants"] == [
                "library.health.read"
            ]
            assert operations["get_library_quality"]["limits"]["page_size"] == 100
            assert operations["apply_repairs"]["status"] == "denied"
            assert operations["get_runtime_policy"]["required_grants"] == [
                "ops.runtime.read"
            ]
            assert operations["list_schedules"]["required_grants"] == [
                "ops.schedules.read"
            ]
            assert operations["read_audit"]["required_grants"] == ["ops.audit.read"]
            assert operations["preview_job_cancel"]["required_grants"] == [
                "ops.jobs.cancel"
            ]
            assert (
                operations["read_diagnostics"]["grants_by_source"]["worker_logs"]
                == "ops.logs.read"
            )

    asyncio.run(run())


def test_quality_read_preserves_snapshot_semantics_without_scanning_or_enqueue(
    action_transport, monkeypatch
):
    from crate import agent_quality, quality
    from tests.test_agent_quality import _record

    app, token, *_ = action_transport
    reader = Mock(return_value=_record(items=[{"file": "evidence.mp3"}], total=2))
    monkeypatch.setattr(agent_quality, "read_quality_report_snapshot", reader)
    scanner = Mock(side_effect=AssertionError("MCP reads must not scan audio"))
    enqueue = Mock(side_effect=AssertionError("MCP reads must not enqueue work"))
    monkeypatch.setattr(quality, "quality_report", scanner)
    monkeypatch.setattr("crate.db.repositories.tasks.create_task", enqueue)
    monkeypatch.setattr("crate.db.repositories.tasks.create_task_dedup", enqueue)

    async def run():
        async with app.router.lifespan_context(app), _client(app, token) as session:
            client, _ = session
            result = await client.call_tool(
                "get_library_quality", {"category": "low_bitrate", "limit": 1}
            )
            assert result.is_error is False, result
            payload = result.structured_content
            assert payload["availability"] == "available"
            assert payload["data"]["audio_decode_verified"] is False
            assert payload["data"]["method"] == "metadata_heuristics_v1"
            assert payload["data"]["items"] == [{"file": "evidence.mp3"}]
            assert payload["returned_count"] == 1
            assert payload["next_cursor"]
            assert payload["snapshot"]["source_seq"] == 42

    asyncio.run(run())
    reader.assert_called_once_with(category="low_bitrate", offset=0, limit=1)
    scanner.assert_not_called()
    enqueue.assert_not_called()


@pytest.mark.parametrize("state", ["stale", "unavailable"])
def test_quality_mcp_does_not_reinterpret_old_or_missing_evidence_as_healthy(
    action_transport, monkeypatch, state
):
    from tests.test_agent_quality import _record

    app, token, *_ = action_transport
    monkeypatch.setattr(
        "crate.agent_quality.read_quality_report_snapshot",
        lambda **kwargs: _record(stale=True) if state == "stale" else None,
    )

    async def run():
        async with app.router.lifespan_context(app), _client(app, token) as session:
            client, _ = session
            result = await client.call_tool("get_library_quality", {})
            assert result.is_error is False
            payload = result.structured_content
            assert payload["availability"] == state
            assert payload["data"].get("historical", False) is (state == "stale")
            if state == "unavailable":
                assert payload["data"]["ready"] is False
                assert payload["data"]["reason"]

    asyncio.run(run())


@pytest.mark.parametrize(
    "name,arguments",
    [
        ("get_operation_catalog", {"refresh": True}),
        ("get_plan", {}),
        ("get_plan", {"plan_id": "not-a-uuid"}),
        ("get_plan", {"plan_id": PLAN_ID, "principal_id": "other"}),
        ("get_library_quality", {"category": "unknown"}),
        ("get_library_quality", {"limit": 0}),
        ("get_library_quality", {"limit": 101}),
        ("get_library_quality", {"limit": True}),
        ("get_library_quality", {"limit": 1.5}),
        ("get_library_quality", {"cursor": "x" * 2049}),
        ("get_library_quality", {"refresh": True}),
    ],
)
def test_new_read_inputs_are_closed_and_bounded_before_admission(
    action_transport, name, arguments
):
    app, token, _principal, _credentials, admission = action_transport

    async def run():
        async with app.router.lifespan_context(app), _client(app, token) as session:
            client, _ = session
            result = await client.call_tool(name, arguments)
            assert result.is_error is True
            assert result.structured_content["error"]["code"] == "INVALID_ARGUMENT"

    asyncio.run(run())
    admission.assert_not_called()


def test_sdk_plan_read_returns_only_owned_persisted_document(
    action_transport, command_world
):
    app, token, _principal, credentials, _admission = action_transport
    credentials[token] = command_world["principal"]
    _, plan = observed_plan(command_world)

    async def run():
        async with app.router.lifespan_context(app), _client(app, token) as session:
            client, _ = session
            result = await client.call_tool("get_plan", {"plan_id": plan["plan_id"]})
            assert result.is_error is False, result
            document = result.structured_content["data"]
            assert document["plan_id"] == plan["plan_id"]
            assert document["plan_version"] == plan["plan_version"]
            assert document["target_count"] == document["returned_count"] == 1
            assert document["authorization_context"] == {}
            credentials[token] = other_principal()
            denied = await client.call_tool("get_plan", {"plan_id": plan["plan_id"]})
            assert denied.is_error is True
            assert denied.structured_content["error"]["code"] in {
                "FORBIDDEN",
                "NOT_FOUND",
            }
            assert "Echo" not in str(denied.structured_content)

    asyncio.run(run())


@pytest.mark.parametrize("mutation", ["scope", "disabled", "revoked", "expired"])
def test_owned_plan_read_reloads_current_authority(command_world, mutation):
    _, plan = observed_plan(command_world)
    principal = command_world["principal"]
    assert (
        agent_plans.get_owned_plan(principal, plan["plan_id"])["plan_id"]
        == plan["plan_id"]
    )
    statements = {
        "scope": "UPDATE agent_principals SET grants=ARRAY['library.health.read']",
        "disabled": "UPDATE agent_principals SET enabled=FALSE",
        "revoked": "UPDATE agent_credentials SET revoked_at=NOW()",
        "expired": "UPDATE agent_credentials SET created_at=NOW()-INTERVAL '1 day', expires_at=NOW()-INTERVAL '1 second'",
    }
    change(statements[mutation])
    with pytest.raises(DiagnosticError) as error:
        agent_plans.get_owned_plan(principal, plan["plan_id"])
    assert error.value.code == "FORBIDDEN"


@pytest.fixture
def delegated_plan(command_world, oauth_env):
    mcp_oauth.update_oauth_client("test-client", scopes=ALLOWED_GRANTS)
    response = _exchange(_code(oauth_env, scope=" ".join(sorted(ALLOWED_GRANTS))))
    assert response[0] == 200, response
    principal, _expires = mcp_oauth.resolve_oauth_access_token(
        response[1]["access_token"]
    )
    world = {**command_world, "principal": principal}
    _, plan = observed_plan(world)
    return world, plan, oauth_env


@pytest.mark.parametrize(
    "field", ["authorization", "actor", "client", "accepted_scopes"]
)
def test_owned_plan_requires_exact_delegation_context(delegated_plan, field):
    world, plan, _user = delegated_plan
    principal = world["principal"]
    assert (
        agent_plans.get_owned_plan(principal, plan["plan_id"])["authorization_context"][
            "authorization_id"
        ]
        == principal.authorization_id
    )
    changed = {
        "authorization": {"authorization_id": str(uuid4())},
        "actor": {"actor_user_id": principal.actor_user_id + 99},
        "client": {"client_id": "another-client"},
        "accepted_scopes": {
            "accepted_scopes": frozenset({"library.repair.photo_flag"})
        },
    }[field]
    with pytest.raises(DiagnosticError) as error:
        agent_plans.get_owned_plan(replace(principal, **changed), plan["plan_id"])
    assert error.value.code in {"FORBIDDEN", "NOT_FOUND"}


def test_owned_plan_cannot_be_read_after_delegated_authorization_revocation(
    delegated_plan,
):
    world, plan, _user = delegated_plan
    principal = world["principal"]
    mcp_oauth.revoke_oauth_authorization(principal.authorization_id)
    with pytest.raises(DiagnosticError) as error:
        agent_plans.get_owned_plan(principal, plan["plan_id"])
    assert error.value.code == "FORBIDDEN"


def test_reconsent_does_not_expose_previous_authorization_plan(delegated_plan):
    world, plan, user = delegated_plan
    response = _exchange(_code(user, scope=" ".join(sorted(ALLOWED_GRANTS))))
    assert response[0] == 200, response
    current, _expires = mcp_oauth.resolve_oauth_access_token(
        response[1]["access_token"]
    )
    assert current.id == world["principal"].id
    assert current.authorization_id != world["principal"].authorization_id
    with pytest.raises(DiagnosticError) as error:
        agent_plans.get_owned_plan(current, plan["plan_id"])
    assert error.value.code == "NOT_FOUND"


def test_terminal_replay_requires_exact_accepted_scopes_even_for_same_authorization(
    delegated_plan,
):
    from crate.artist_photo import observe_artist_photo
    from crate.db.repositories import agent_requests as requests
    from crate.db.repositories.tasks_updates import start_task

    from tests.agent_command_fixtures import UID

    world, plan, _user = delegated_plan
    principal = world["principal"]
    job = requests.accept_apply(
        principal, plan["plan_id"], plan["plan_version"], "exact-context"
    )
    start_task(job["job_id"])
    requests.complete_photo_repair(
        job["job_id"], observe_artist_photo(world["config"], UID)
    )
    requests.record_photo_verification(
        job["job_id"], observe_artist_photo(world["config"], UID)
    )
    narrowed = principal.grants - {"ops.status.read"}
    current = replace(principal, grants=narrowed, accepted_scopes=narrowed)
    assert current.authorization_id == principal.authorization_id
    with pytest.raises(DiagnosticError) as error:
        requests.accept_apply(
            current, plan["plan_id"], plan["plan_version"], "exact-context"
        )
    assert error.value.code == "FORBIDDEN"


@pytest.mark.parametrize("job_id", ["quality-refresh-job", None])
def test_quality_refresh_requires_explicit_global_scope_and_deduplicates(
    test_app, monkeypatch, job_id
):
    enqueue = Mock(return_value=job_id)
    monkeypatch.setattr("crate.api.analytics.create_task_dedup", enqueue)
    response = test_app.post("/api/quality/refresh", json={"scope": "global"})
    assert response.status_code == 200
    assert response.json() == {"task_id": job_id, "deduplicated": job_id is None}
    enqueue.assert_called_once_with(
        "quality_check", {"scope": "global"}, dedup_key="quality:global"
    )


@pytest.mark.parametrize(
    "body", [{}, {"scope": "artist"}, {"scope": "global", "path": "/music"}]
)
def test_quality_refresh_rejects_implicit_or_expanded_scope(
    test_app, monkeypatch, body
):
    enqueue = Mock()
    monkeypatch.setattr("crate.api.analytics.create_task_dedup", enqueue)
    response = test_app.post("/api/quality/refresh", json=body)
    assert response.status_code == 422
    enqueue.assert_not_called()


def test_quality_refresh_requires_repair_capability(test_app, monkeypatch):
    from fastapi import HTTPException

    def deny(request, capability):
        assert capability == "library.repair.run"
        raise HTTPException(status_code=403, detail="Forbidden")

    monkeypatch.setattr("crate.api.analytics.require_permission", deny)
    enqueue = Mock()
    monkeypatch.setattr("crate.api.analytics.create_task_dedup", enqueue)
    assert (
        test_app.post("/api/quality/refresh", json={"scope": "global"}).status_code
        == 403
    )
    enqueue.assert_not_called()


def test_quality_check_runtime_is_registered_bounded_maintenance_work():
    from crate.actors import TASK_POOL_CONFIG
    from crate.resource_governor import RESOURCE_GOVERNED_TASK_TYPES
    from crate.task_registry import TASK_TYPES
    from crate.worker import TASK_HANDLERS

    assert "quality_check" in TASK_TYPES
    assert "quality_check" in RESOURCE_GOVERNED_TASK_TYPES
    assert callable(TASK_HANDLERS["quality_check"])
    config = TASK_POOL_CONFIG["quality_check"]
    assert config.queue == "maintenance"
    assert config.time_limit_seconds == 1800
    assert config.max_retries == 0

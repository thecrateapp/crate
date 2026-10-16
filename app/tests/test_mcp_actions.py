"""Verify bounded action contracts through the official MCP SDK transport."""

import asyncio
from contextlib import asynccontextmanager, contextmanager, nullcontext
from unittest.mock import Mock

import httpx2
import pytest
from crate.agent_access import PILOT_GRANTS, AgentPrincipal, generate_token
from fastapi import FastAPI
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from starlette.routing import Route

BASE_URL = "http://localhost:8585"
ARTIST_UID = "7e989a1d-ef6d-409e-95f1-cb0b2aa50b15"
PLAN_ID = "a3df9dca-dca2-42f0-b35b-dbf5ddf1c89f"
PLAN_VERSION = "a" * 64
ACTION_CASES = [
    (
        "run_health_check",
        "library.health.run",
        {"artist_uid": ARTIST_UID, "idempotency_key": "client-operation-1"},
    ),
    ("preview_repairs", "library.repair.photo_flag", {"issue_id": 42}),
    (
        "apply_repairs",
        "library.repair.photo_flag",
        {
            "plan_id": PLAN_ID,
            "plan_version": PLAN_VERSION,
            "idempotency_key": "client-operation-1",
        },
    ),
    (
        "retry_job",
        "ops.jobs.retry",
        {"job_id": "job-1", "idempotency_key": "client-operation-1"},
    ),
    ("cancel_job", "ops.jobs.cancel_pending", {"job_id": "job-1"}),
]
ACTION_NAMES = {case[0] for case in ACTION_CASES}
ACTION_GRANTS = frozenset(case[1] for case in ACTION_CASES)
READ_NAMES = {
    "get_operation_catalog",
    "get_plan",
    "get_library_quality",
    "get_analysis_status",
    "get_instance_status",
    "list_library_issues",
    "inspect_artist",
    "list_jobs",
    "get_job",
    "read_diagnostics",
}


@pytest.fixture
def action_transport(monkeypatch, request):
    from crate.mcp.server import create_mcp_server

    enabled = getattr(request, "param", "true")
    if enabled is None:
        monkeypatch.delenv("CRATE_MCP_ACTIONS_ENABLED", raising=False)
    else:
        monkeypatch.setenv("CRATE_MCP_ACTIONS_ENABLED", enabled)
    monkeypatch.setenv("CRATE_MCP_ALLOWED_HOSTS", "localhost:8585")
    token = generate_token()
    principal = AgentPrincipal(
        "operator", "operator-token", "Operator", PILOT_GRANTS | ACTION_GRANTS
    )
    credentials = {token: principal}
    monkeypatch.setattr("crate.mcp.auth.resolve_credential", credentials.get)
    admission = Mock(side_effect=lambda _principal_id: nullcontext())
    monkeypatch.setattr("crate.mcp.tools.admission", admission)
    monkeypatch.setattr("crate.mcp.tools.log_audit", Mock())
    _server, manager, endpoint = create_mcp_server()

    @asynccontextmanager
    async def lifespan(app):
        async with manager.run():
            yield

    app = FastAPI(lifespan=lifespan, redirect_slashes=False)

    @app.middleware("http")
    async def trace_request(request, call_next):
        request.scope["trace_id"] = "action-transport-trace"
        return await call_next(request)

    app.router.routes.append(Route("/mcp", endpoint=endpoint))
    return app, token, principal, credentials, admission


@asynccontextmanager
async def _client(app, token):
    async with (
        httpx2.AsyncClient(
            transport=httpx2.ASGITransport(app=app),
            base_url=BASE_URL,
            headers={"Authorization": f"Bearer {token}"},
        ) as http,
        streamable_http_client(BASE_URL + "/mcp", http_client=http) as streams,
        ClientSession(streams[0], streams[1]) as client,
    ):
        initialization = await client.initialize()
        yield client, initialization


def test_enabled_actions_publish_closed_schemas_and_accurate_effect_hints(
    action_transport,
):
    app, token, *_ = action_transport

    async def run():
        async with app.router.lifespan_context(app), _client(app, token) as session:
            client, initialization = session
            tools = (await client.list_tools()).tools
            assert {tool.name for tool in tools} == READ_NAMES | ACTION_NAMES
            for tool in tools:
                assert tool.input_schema["additionalProperties"] is False
                assert tool.output_schema["additionalProperties"] is False
                if tool.name in ACTION_NAMES:
                    assert tool.annotations.read_only_hint is False
                    assert tool.annotations.destructive_hint is (
                        tool.name == "apply_repairs"
                    )
                    assert tool.annotations.open_world_hint is False
                    assert tool.annotations.idempotent_hint is (
                        tool.name != "preview_repairs"
                    )
            assert "No action tools are available" not in initialization.instructions

    asyncio.run(run())


@pytest.mark.parametrize("action_transport", [None, "false"], indirect=True)
def test_actions_are_disabled_by_default_even_with_action_grants(
    action_transport, monkeypatch
):
    app, token, _principal, _credentials, admission = action_transport
    operations = {}
    for name in ACTION_NAMES:
        operations[name] = Mock()
        monkeypatch.setattr(f"crate.agent_maintenance.{name}", operations[name])

    async def run():
        async with app.router.lifespan_context(app), _client(app, token) as session:
            client, _ = session
            assert {
                tool.name for tool in (await client.list_tools()).tools
            } == READ_NAMES
            for name, _grant, arguments in ACTION_CASES:
                result = await client.call_tool(name, arguments)
                assert result.is_error is True
                assert result.structured_content["error"]["code"] == "FORBIDDEN"

    asyncio.run(run())
    admission.assert_not_called()
    for operation in operations.values():
        operation.assert_not_called()


@pytest.mark.parametrize(
    "grants,expected",
    [
        (PILOT_GRANTS, READ_NAMES - {"get_plan"}),
        (frozenset(), set()),
        (
            frozenset({"library.health.run"}),
            {"run_health_check", "get_operation_catalog", "get_plan"},
        ),
        (
            frozenset({"library.repair.photo_flag"}),
            {"preview_repairs", "apply_repairs", "get_operation_catalog", "get_plan"},
        ),
        (frozenset({"ops.jobs.retry"}), {"retry_job", "get_operation_catalog"}),
        (
            frozenset({"ops.jobs.cancel_pending"}),
            {"cancel_job", "get_operation_catalog"},
        ),
    ],
)
def test_discovery_and_direct_calls_respect_independent_action_grants(
    action_transport, monkeypatch, grants, expected
):
    app, token, principal, credentials, admission = action_transport
    credentials[token] = AgentPrincipal(
        principal.id, principal.credential_id, principal.name, grants
    )
    operations = {}
    for name in ACTION_NAMES:
        operations[name] = Mock()
        monkeypatch.setattr(f"crate.agent_maintenance.{name}", operations[name])

    async def run():
        async with app.router.lifespan_context(app), _client(app, token) as session:
            client, _ = session
            assert {tool.name for tool in (await client.list_tools()).tools} == expected
            for name, _grant, arguments in ACTION_CASES:
                if name not in expected:
                    result = await client.call_tool(name, arguments)
                    assert result.is_error is True
                    assert result.structured_content["error"]["code"] == "FORBIDDEN"

    asyncio.run(run())
    admission.assert_not_called()
    for operation in operations.values():
        operation.assert_not_called()


@pytest.mark.parametrize("name,grant,arguments", ACTION_CASES)
def test_action_receives_authenticated_principal_and_trace_exactly_once(
    action_transport, monkeypatch, name, grant, arguments
):
    app, token, principal, _credentials, admission = action_transport
    payload = {
        "schema_version": "1",
        "availability": "available",
        "source": "agent_maintenance",
        "data": {"status": "accepted", "job_id": "job-accepted"},
    }
    operation = Mock(return_value=payload)
    monkeypatch.setattr(f"crate.agent_maintenance.{name}", operation)

    async def run():
        async with app.router.lifespan_context(app), _client(app, token) as session:
            client, _ = session
            result = await client.call_tool(name, arguments)
            assert result.is_error is False
            assert result.structured_content == payload

    asyncio.run(run())
    operation.assert_called_once()
    passed_principal = (
        operation.call_args.args[0]
        if operation.call_args.args
        else operation.call_args.kwargs["principal"]
    )
    assert passed_principal is principal
    for key, value in arguments.items():
        assert str(operation.call_args.kwargs[key]) == str(value)
    assert operation.call_args.kwargs["trace_id"] == "action-transport-trace"
    if name == "run_health_check":
        assert operation.call_args.kwargs["check_type"] == "has_photo_desync"
    admission.assert_called_once_with(principal.id)


INVALID_ACTION_INPUTS = [
    ("run_health_check", {"idempotency_key": "client-operation-1"}),
    ("run_health_check", {"artist_uid": ARTIST_UID}),
    (
        "run_health_check",
        {"artist_uid": "", "idempotency_key": "client-operation-1"},
    ),
    (
        "run_health_check",
        {"artist_uid": "not-a-uuid", "idempotency_key": "client-operation-1"},
    ),
    (
        "run_health_check",
        {"artist_uid": ARTIST_UID, "idempotency_key": ""},
    ),
    (
        "run_health_check",
        {
            "artist_uid": ARTIST_UID,
            "idempotency_key": "client-operation-1",
            "check_type": "missing_artwork",
        },
    ),
    ("preview_repairs", {}),
    ("preview_repairs", {"issue_id": 0}),
    ("preview_repairs", {"issue_id": -1}),
    ("preview_repairs", {"issue_id": True}),
    ("preview_repairs", {"issue_id": "42"}),
    (
        "apply_repairs",
        {"plan_id": PLAN_ID, "idempotency_key": "client-operation-1"},
    ),
    (
        "apply_repairs",
        {
            "plan_id": "not-a-uuid",
            "plan_version": PLAN_VERSION,
            "idempotency_key": "client-operation-1",
        },
    ),
    (
        "apply_repairs",
        {
            "plan_id": PLAN_ID,
            "plan_version": "g" * 64,
            "idempotency_key": "client-operation-1",
        },
    ),
    (
        "apply_repairs",
        {
            "plan_id": PLAN_ID,
            "plan_version": "a" * 63,
            "idempotency_key": "client-operation-1",
        },
    ),
    ("retry_job", {"job_id": "job-1"}),
    ("retry_job", {"job_id": "", "idempotency_key": "client-operation-1"}),
    ("retry_job", {"job_id": "job-1", "idempotency_key": ""}),
    ("cancel_job", {}),
    ("cancel_job", {"job_id": ""}),
    *[
        (name, {**arguments, "idempotency_key": invalid_key})
        for name, _, arguments in ACTION_CASES
        if "idempotency_key" in arguments
        for invalid_key in (" ", "contains space", "key/with/slashes", "a" * 129, 42)
    ],
    *[(name, {**arguments, "confirm": True}) for name, _, arguments in ACTION_CASES],
]


@pytest.mark.parametrize("name,arguments", INVALID_ACTION_INPUTS)
def test_invalid_action_inputs_cannot_reach_admission_or_operation(
    action_transport, monkeypatch, name, arguments
):
    app, token, _principal, _credentials, admission = action_transport
    operation = Mock()
    monkeypatch.setattr(f"crate.agent_maintenance.{name}", operation)

    async def run():
        async with app.router.lifespan_context(app), _client(app, token) as session:
            client, _ = session
            result = await client.call_tool(name, arguments)
            assert result.is_error is True
            assert result.structured_content["error"]["code"] == "INVALID_ARGUMENT"

    asyncio.run(run())
    operation.assert_not_called()
    admission.assert_not_called()


@pytest.mark.parametrize("name,grant,arguments", ACTION_CASES)
def test_ambiguous_action_failure_preserves_uncertainty_and_never_auto_retries(
    action_transport, monkeypatch, name, grant, arguments
):
    app, token, *_ = action_transport
    operation = Mock(
        side_effect=RuntimeError("postgresql://operator:private-secret@db/private")
    )
    monkeypatch.setattr(f"crate.agent_maintenance.{name}", operation)

    async def run():
        async with app.router.lifespan_context(app), _client(app, token) as session:
            client, _ = session
            result = await client.call_tool(name, arguments)
            assert result.is_error is True
            assert result.structured_content["error"]["code"] == "ACTION_STATUS_UNKNOWN"
            encoded = result.model_dump_json()
            assert "private-secret" not in encoded
            assert "postgresql" not in encoded
            assert "no work was started" not in encoded.lower()
            message = result.structured_content["error"]["message"].lower()
            assert "job" in message
            if "idempotency_key" in arguments:
                assert "same" in message and "key" in message

    asyncio.run(run())
    operation.assert_called_once()


def test_action_rate_limit_rejects_without_entering_operation(
    action_transport, monkeypatch
):
    from crate.agent_diagnostics import DiagnosticError

    app, token, _principal, _credentials, admission = action_transport
    admission.side_effect = DiagnosticError("RATE_LIMITED", "Capacity reached", 12)
    operation = Mock()
    monkeypatch.setattr("crate.agent_maintenance.run_health_check", operation)

    async def run():
        async with app.router.lifespan_context(app), _client(app, token) as session:
            client, _ = session
            result = await client.call_tool("run_health_check", ACTION_CASES[0][2])
            assert result.is_error is True
            assert result.structured_content["error"]["code"] == "RATE_LIMITED"
            assert result.structured_content["error"]["retry_after"] == 12

    asyncio.run(run())
    operation.assert_not_called()


def test_admission_failure_after_acceptance_preserves_action_uncertainty(
    action_transport, monkeypatch
):
    from crate.agent_diagnostics import DiagnosticError

    app, token, _principal, _credentials, admission = action_transport

    @contextmanager
    def lease_lost_after_acceptance(_principal_id):
        yield
        raise DiagnosticError("SERVICE_UNAVAILABLE", "Lease renewal unavailable")

    admission.side_effect = lease_lost_after_acceptance
    operation = Mock(
        return_value={
            "schema_version": "1",
            "availability": "available",
            "data": {"job_id": "accepted-job", "status": "pending"},
        }
    )
    monkeypatch.setattr("crate.agent_maintenance.run_health_check", operation)

    async def run():
        async with app.router.lifespan_context(app), _client(app, token) as session:
            client, _ = session
            result = await client.call_tool("run_health_check", ACTION_CASES[0][2])
            assert result.is_error is True
            assert result.structured_content["error"]["code"] == "ACTION_STATUS_UNKNOWN"
            message = result.structured_content["error"]["message"].lower()
            assert "same" in message and "key" in message and "job" in message
            assert "no work was started" not in message

    asyncio.run(run())
    operation.assert_called_once()


def test_action_grant_revocation_takes_effect_on_next_request(
    action_transport, monkeypatch
):
    app, token, principal, credentials, admission = action_transport
    operation = Mock()
    monkeypatch.setattr("crate.agent_maintenance.run_health_check", operation)

    async def run():
        async with app.router.lifespan_context(app), _client(app, token) as session:
            client, _ = session
            assert "run_health_check" in {
                tool.name for tool in (await client.list_tools()).tools
            }
            credentials[token] = AgentPrincipal(
                principal.id, principal.credential_id, principal.name, PILOT_GRANTS
            )
            assert "run_health_check" not in {
                tool.name for tool in (await client.list_tools()).tools
            }
            result = await client.call_tool("run_health_check", ACTION_CASES[0][2])
            assert result.is_error is True
            assert result.structured_content["error"]["code"] == "FORBIDDEN"

    asyncio.run(run())
    operation.assert_not_called()
    admission.assert_not_called()

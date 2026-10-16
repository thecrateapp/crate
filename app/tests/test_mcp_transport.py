"""Exercise the actual MCP SDK client against the authenticated ASGI boundary."""

import asyncio
import json
import socket
from contextlib import asynccontextmanager, nullcontext
from unittest.mock import AsyncMock, Mock

import httpx2
import pytest
import uvicorn
from crate.agent_access import PILOT_GRANTS, AgentPrincipal, generate_token
from fastapi import FastAPI
from mcp import Client, ClientSession
from mcp.client.streamable_http import streamable_http_client
from starlette.routing import Route

BASE_URL = "http://localhost:8585"
TOOL_NAMES = {
    "get_instance_status",
    "list_library_issues",
    "inspect_artist",
    "list_jobs",
    "get_job",
    "read_diagnostics",
}


@pytest.fixture
def diagnostic_boundary(monkeypatch):
    admission = Mock(side_effect=lambda _principal_id: nullcontext())
    audit = Mock()
    monkeypatch.setattr("crate.mcp.tools.admission", admission)
    monkeypatch.setattr("crate.mcp.tools.log_audit", audit)
    return admission, audit


@pytest.fixture
def transport_app(monkeypatch):
    from crate.mcp.server import create_mcp_server

    monkeypatch.setenv("CRATE_MCP_ALLOWED_HOSTS", "localhost:8585")
    monkeypatch.setenv("CRATE_MCP_ALLOWED_ORIGINS", "https://allowed.example.test")
    tokens = {
        "all": generate_token(),
        "library": generate_token(),
        "ops": generate_token(),
    }
    principals = {
        tokens["all"]: AgentPrincipal("all", "all-token", "All", PILOT_GRANTS),
        tokens["library"]: AgentPrincipal(
            "library", "library-token", "Library", frozenset({"library.health.read"})
        ),
        tokens["ops"]: AgentPrincipal(
            "ops", "ops-token", "Ops", frozenset({"ops.status.read"})
        ),
    }
    monkeypatch.setattr("crate.mcp.auth.resolve_credential", principals.get)
    _server, manager, endpoint = create_mcp_server()

    @asynccontextmanager
    async def lifespan(app):
        async with manager.run():
            yield

    app = FastAPI(lifespan=lifespan, redirect_slashes=False)
    app.router.routes.append(Route("/mcp", endpoint=endpoint))
    return app, tokens, principals


@asynccontextmanager
async def _client(app, token, extra_headers=None):
    async with (
        httpx2.AsyncClient(
            transport=httpx2.ASGITransport(app=app),
            base_url=BASE_URL,
            headers={"Authorization": f"Bearer {token}", **(extra_headers or {})},
        ) as http,
        streamable_http_client(BASE_URL + "/mcp", http_client=http) as streams,
        ClientSession(streams[0], streams[1]) as client,
    ):
        await client.initialize()
        yield client


def test_sdk_initialize_discovery_and_shutdown_publish_only_closed_read_tools(
    transport_app,
):
    app, tokens, _ = transport_app

    async def run():
        async with (
            app.router.lifespan_context(app),
            _client(app, tokens["all"]) as client,
        ):
            result = await client.list_tools()
            assert {tool.name for tool in result.tools} == TOOL_NAMES
            for tool in result.tools:
                assert tool.input_schema["additionalProperties"] is False
                assert tool.annotations.read_only_hint is True
                assert tool.annotations.destructive_hint is False

    asyncio.run(run())


def test_discovery_filters_each_request_and_call_still_enforces_scope(transport_app):
    app, tokens, _ = transport_app

    async def run():
        async with app.router.lifespan_context(app):
            async with _client(app, tokens["library"]) as client:
                listed = await client.list_tools()
                assert {tool.name for tool in listed.tools} == {
                    "list_library_issues",
                    "inspect_artist",
                }
                result = await client.call_tool("get_instance_status", {})
                assert result.is_error is True
                assert "FORBIDDEN" in json.dumps(result.model_dump(mode="json"))
            async with _client(app, tokens["ops"]) as client:
                listed = await client.list_tools()
                assert {tool.name for tool in listed.tools} == {
                    "get_instance_status",
                    "read_diagnostics",
                }
                result = await client.call_tool(
                    "read_diagnostics", {"source": "worker_logs"}
                )
                assert result.is_error is True
                assert "FORBIDDEN" in json.dumps(result.model_dump(mode="json"))

    asyncio.run(run())


@pytest.mark.parametrize(
    "tool,arguments",
    [
        ("get_instance_status", {"refresh": True}),
        ("list_library_issues", {"limit": 0}),
        ("list_library_issues", {"limit": 101}),
        ("list_library_issues", {"limit": True}),
        ("list_library_issues", {"severity": "unknown"}),
        ("inspect_artist", {}),
        ("inspect_artist", {"artist_uid": "artist", "name": "Artist"}),
        ("list_jobs", {"states": ["arbitrary"]}),
        ("list_jobs", {"actor_id": "owner"}),
        ("get_job", {}),
        ("read_diagnostics", {"source": "/var/log/secret"}),
        ("read_diagnostics", {"source": "worker_logs", "limit": 101}),
        (
            "read_diagnostics",
            {"source": "worker_status", "since": "2026-10-15T00:00:00Z"},
        ),
    ],
)
def test_sdk_rejects_unknown_arguments_and_invalid_bounds(
    transport_app, tool, arguments
):
    app, tokens, _ = transport_app

    async def run():
        async with (
            app.router.lifespan_context(app),
            _client(app, tokens["all"]) as client,
        ):
            result = await client.call_tool(tool, arguments)
            assert result.is_error is True
            assert "INVALID_ARGUMENT" in json.dumps(result.model_dump(mode="json"))

    asyncio.run(run())


@pytest.mark.parametrize(
    "extra_headers,status",
    [
        ({"Host": "attacker.example.test"}, 421),
        ({"Origin": "https://attacker.example.test"}, 403),
    ],
)
def test_transport_rejects_untrusted_hosts_and_origins(
    transport_app, extra_headers, status
):
    app, tokens, _ = transport_app

    async def run():
        async with (
            app.router.lifespan_context(app),
            httpx2.AsyncClient(
                transport=httpx2.ASGITransport(app=app), base_url=BASE_URL
            ) as client,
        ):
            response = await client.post(
                "/mcp",
                headers={
                    "Authorization": f"Bearer {tokens['all']}",
                    "Accept": "application/json, text/event-stream",
                    **extra_headers,
                },
                json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
            )
            assert response.status_code == status

    asyncio.run(run())


def test_exact_endpoint_has_no_redirect_and_bounded_request_body(transport_app):
    app, tokens, _ = transport_app

    async def run():
        async with (
            app.router.lifespan_context(app),
            httpx2.AsyncClient(
                transport=httpx2.ASGITransport(app=app),
                base_url=BASE_URL,
                headers={
                    "Authorization": f"Bearer {tokens['all']}",
                    "Accept": "application/json, text/event-stream",
                    "Content-Type": "application/json",
                },
            ) as client,
        ):
            response = await client.post(
                "/mcp",
                json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
                follow_redirects=False,
            )
            assert response.status_code == 200
            assert "location" not in response.headers
            response = await client.post("/mcp", content=b"x" * (1024 * 1024))
            assert response.status_code == 413

    asyncio.run(run())


@pytest.mark.parametrize(
    "tool,arguments",
    [
        ("get_instance_status", {}),
        ("list_library_issues", {"limit": 2}),
        ("inspect_artist", {"artist_uid": "artist-1"}),
        ("list_jobs", {"states": ["failed"]}),
        ("get_job", {"job_id": "job-1"}),
        ("read_diagnostics", {"source": "worker_logs", "task_id": "job-1"}),
    ],
)
def test_each_tool_returns_structured_evidence_and_audits_machine_identity(
    monkeypatch, transport_app, diagnostic_boundary, tool, arguments
):
    app, tokens, principals = transport_app
    admission, audit = diagnostic_boundary
    payload = {
        "schema_version": "1",
        "availability": "available",
        "source": "fixture",
        "observed_at": "2026-10-16T00:00:00Z",
        "data": {"tool": tool},
    }
    read = Mock(return_value=payload)
    monkeypatch.setattr(f"crate.agent_diagnostics.{tool}", read)

    async def run():
        async with (
            app.router.lifespan_context(app),
            _client(app, tokens["all"]) as client,
        ):
            result = await client.call_tool(tool, arguments)
            assert result.is_error is False
            assert result.structured_content == payload

    asyncio.run(run())
    read.assert_called_once()
    for key, value in arguments.items():
        assert read.call_args.kwargs[key] == value
    principal = principals[tokens["all"]]
    admission.assert_called_once_with(principal.id)
    audit.assert_called_once()
    details = audit.call_args.kwargs["details"]
    assert details["principal_id"] == principal.id
    assert details["credential_id"] == principal.credential_id
    assert details["tool"] == tool
    assert "user_id" not in audit.call_args.kwargs
    assert tokens["all"] not in repr(audit.call_args)


def test_rate_limit_returns_retry_after_without_reading_or_retrying(
    monkeypatch, transport_app, diagnostic_boundary
):
    from crate.agent_diagnostics import DiagnosticError

    app, tokens, _ = transport_app
    admission, audit = diagnostic_boundary
    admission.side_effect = DiagnosticError("RATE_LIMITED", "Capacity reached", 12)
    read = Mock()
    monkeypatch.setattr("crate.agent_diagnostics.get_instance_status", read)

    async def run():
        async with (
            app.router.lifespan_context(app),
            _client(app, tokens["all"]) as client,
        ):
            result = await client.call_tool("get_instance_status", {})
            assert result.is_error is True
            assert result.structured_content["error"]["code"] == "RATE_LIMITED"
            assert result.structured_content["error"]["retry_after"] == 12

    asyncio.run(run())
    admission.assert_called_once()
    read.assert_not_called()
    audit.assert_not_called()


def test_oversized_source_result_is_rejected_without_leaking_partial_content(
    monkeypatch, transport_app, diagnostic_boundary
):
    app, tokens, _ = transport_app
    monkeypatch.setattr(
        "crate.agent_diagnostics.get_instance_status",
        lambda: {"data": "private-detail" * 10000},
    )

    async def run():
        async with (
            app.router.lifespan_context(app),
            _client(app, tokens["all"]) as client,
        ):
            result = await client.call_tool("get_instance_status", {})
            encoded = result.model_dump_json().encode("utf-8")
            assert result.is_error is True
            assert result.structured_content["error"]["code"] == "RESPONSE_TOO_LARGE"
            assert len(encoded) <= 65536
            assert b"private-detail" not in encoded

    asyncio.run(run())


def test_source_failure_is_sanitized_and_does_not_retry(
    monkeypatch, transport_app, diagnostic_boundary
):
    app, tokens, _ = transport_app
    read = Mock(side_effect=RuntimeError("postgresql://user:secret@database/private"))
    monkeypatch.setattr("crate.agent_diagnostics.get_instance_status", read)

    async def run():
        async with (
            app.router.lifespan_context(app),
            _client(app, tokens["all"]) as client,
        ):
            result = await client.call_tool("get_instance_status", {})
            assert result.is_error is True
            assert result.structured_content["error"]["code"] == "SOURCE_UNAVAILABLE"
            assert "secret" not in result.model_dump_json()

    asyncio.run(run())
    read.assert_called_once()


def test_official_client_connects_over_tcp_and_server_shuts_down(
    monkeypatch, transport_app, diagnostic_boundary
):
    app, tokens, _ = transport_app
    monkeypatch.setattr(
        "crate.agent_diagnostics.get_instance_status",
        lambda: {
            "schema_version": "1",
            "availability": "unavailable",
            "source": "fixture",
        },
    )

    async def run():
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen(128)
            address = f"http://127.0.0.1:{listener.getsockname()[1]}/mcp"
            server = uvicorn.Server(
                uvicorn.Config(app, log_level="warning", lifespan="on")
            )
            serving = asyncio.create_task(server.serve(sockets=[listener]))
            try:
                async with asyncio.timeout(5):
                    while not server.started:
                        if serving.done():
                            await serving
                        await asyncio.sleep(0.01)
                async with (
                    httpx2.AsyncClient(
                        headers={
                            "Authorization": f"Bearer {tokens['all']}",
                            "Host": "localhost:8585",
                        }
                    ) as http,
                    Client(streamable_http_client(address, http_client=http)) as client,
                ):
                    assert client.protocol_version == "2026-07-28"
                    assert {
                        tool.name for tool in (await client.list_tools()).tools
                    } == TOOL_NAMES
                    result = await client.call_tool("get_instance_status", {})
                    assert result.structured_content["availability"] == "unavailable"
                    assert result.is_error is False
            finally:
                server.should_exit = True
                await asyncio.wait_for(serving, 5)
            assert serving.done()

    asyncio.run(run())


@pytest.mark.parametrize("enabled", [None, "false", "true"])
def test_full_api_registers_mcp_only_when_explicitly_enabled(monkeypatch, enabled):
    from crate.api import create_app

    if enabled is None:
        monkeypatch.delenv("CRATE_MCP_ENABLED", raising=False)
    else:
        monkeypatch.setenv("CRATE_MCP_ENABLED", enabled)
    app = create_app()

    assert any(getattr(route, "path", None) == "/mcp" for route in app.routes) is (
        enabled == "true"
    )
    assert hasattr(app.state, "mcp_manager") is (enabled == "true")
    assert any(
        getattr(route, "path", None) == "/openapi-app.json" for route in app.routes
    )


def test_full_api_lifespan_preserves_runtime_and_carries_audit_trace(
    monkeypatch, diagnostic_boundary
):
    from crate import api

    monkeypatch.setenv("CRATE_MCP_ENABLED", "true")
    monkeypatch.setenv("CRATE_MCP_ALLOWED_HOSTS", "localhost:8585")
    token = generate_token()
    principal = AgentPrincipal("operator", "operator-token", "Operator", PILOT_GRANTS)
    monkeypatch.setattr("crate.mcp.auth.resolve_credential", lambda _: principal)
    startup = {}
    for name in (
        "init_db",
        "_bootstrap_federation_identity",
        "_queue_global_catalog_bootstrap",
        "_queue_artwork_variant_backfill",
        "_queue_artwork_manifest_permission_repair",
        "_queue_stats_dashboard_backfill",
        "_queue_artist_top_track_ranking_backfill",
    ):
        startup[name] = Mock()
        monkeypatch.setattr(api, name, startup[name])
    monkeypatch.setattr("crate.utils.init_musicbrainz", Mock())
    monkeypatch.setattr("crate.radio_engine._load_radio_graphs", Mock())
    start_runtime, stop_runtime, close_clients = Mock(), Mock(), Mock()
    monkeypatch.setattr(
        "crate.api.cache_events.start_cache_invalidation_runtime", start_runtime
    )
    monkeypatch.setattr(
        "crate.api.cache_events.stop_cache_invalidation_runtime", stop_runtime
    )
    monkeypatch.setattr("crate.federation.client.close_shared_clients", close_clients)
    repair = AsyncMock(return_value=0)
    monkeypatch.setattr(api, "_repair_musicbrainz_cache_ttls", repair)
    background_tasks = []

    async def background():
        background_tasks.append(asyncio.current_task())
        await asyncio.Event().wait()

    monkeypatch.setattr(api, "_refresh_radio_graphs_periodically", background)
    monkeypatch.setattr("crate.runtime_saturation.monitor_event_loop_lag", background)
    monkeypatch.setattr(
        "crate.agent_diagnostics.get_instance_status",
        lambda: {
            "schema_version": "1",
            "availability": "unavailable",
            "source": "fixture",
        },
    )
    app = api.create_app()
    stream_client = Mock(aclose=AsyncMock())
    app.state.federation_stream_client = stream_client

    async def run():
        async with (
            app.router.lifespan_context(app),
            _client(app, token, {"X-Trace-ID": "mcp-integration-trace"}) as client,
        ):
            result = await client.call_tool("get_instance_status", {})
            assert result.is_error is False
            assert result.structured_content["availability"] == "unavailable"
        assert len(background_tasks) == 2
        assert all(task.done() for task in background_tasks)

    asyncio.run(run())
    for callback in startup.values():
        callback.assert_called_once()
    start_runtime.assert_called_once()
    stop_runtime.assert_called_once()
    close_clients.assert_called_once()
    stream_client.aclose.assert_awaited_once()
    repair.assert_awaited_once()
    _, audit = diagnostic_boundary
    assert audit.call_args.kwargs["details"]["trace_id"] == "mcp-integration-trace"

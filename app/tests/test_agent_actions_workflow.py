"""Remote action workflow with real PostgreSQL, Redis and a temporary library."""

import asyncio
import socket
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from unittest.mock import Mock

import httpx2
import pytest
import uvicorn
from crate.agent_access import ALLOWED_GRANTS
from crate.db.repositories.agent_credentials import create_credential
from crate.db.repositories.tasks import start_task
from crate.db.tx import read_scope, transaction_scope
from fastapi import FastAPI
from mcp import Client
from mcp.client.streamable_http import streamable_http_client
from sqlalchemy import text
from starlette.routing import Route

from tests.test_mcp_limits import admission_redis as admission_redis  # noqa: PLC0414
from tests.test_mcp_limits import isolated_redis as isolated_redis  # noqa: PLC0414

ARTIST_UID = "7e989a1d-ef6d-409e-95f1-cb0b2aa50b15"


@pytest.mark.parametrize("change_photo", [False, True])
def test_remote_check_preview_apply_and_verify(
    pg_db, admission_redis, monkeypatch, tmp_path, change_photo
):
    from crate.mcp.server import create_mcp_server
    from crate.worker_handlers.management import _handle_health_check, _handle_repair

    monkeypatch.setenv("CRATE_MCP_ENABLED", "true")
    monkeypatch.setenv("CRATE_MCP_ACTIONS_ENABLED", "true")
    monkeypatch.setenv("CRATE_MCP_ALLOWED_HOSTS", "localhost:8585")
    dispatch = Mock()
    monkeypatch.setattr("crate.db.repositories.tasks_mutations.dispatch_task", dispatch)
    with transaction_scope() as session:
        session.execute(
            text("""
            INSERT INTO library_artists (name, entity_uid, folder_name, has_photo)
            VALUES ('Photo Artist', :uid, 'Photo Artist', 0), ('Untouched Artist', gen_random_uuid(), 'Untouched Artist', 0)
        """),
            {"uid": ARTIST_UID},
        )
    artist_dir = tmp_path / "Photo Artist"
    artist_dir.mkdir()
    photo = artist_dir / "artist.jpg"
    photo.write_bytes(b"photo fixture")
    issued = create_credential(
        "Remote action fixture", ALLOWED_GRANTS, datetime.now(UTC) + timedelta(days=1)
    )
    config = {"library_path": str(tmp_path)}
    _, manager, endpoint = create_mcp_server()

    @asynccontextmanager
    async def lifespan(app):
        async with manager.run():
            yield

    app = FastAPI(lifespan=lifespan, redirect_slashes=False)
    app.router.routes.append(Route("/mcp", endpoint=endpoint))

    def execute(job_id):
        task = start_task(job_id)
        assert task is not None
        handler = (
            _handle_health_check if task["type"] == "health_check" else _handle_repair
        )
        return handler(job_id, task["params_json"], config)

    async def run():
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen(128)
            url = f"http://127.0.0.1:{listener.getsockname()[1]}/mcp"
            server = uvicorn.Server(
                uvicorn.Config(app, log_level="warning", lifespan="on")
            )
            serving = asyncio.create_task(server.serve(sockets=[listener]))
            try:
                async with asyncio.timeout(10):
                    while not server.started:
                        if serving.done():
                            await serving
                        await asyncio.sleep(0.01)
                async with (
                    httpx2.AsyncClient(
                        headers={
                            "Authorization": f"Bearer {issued.token}",
                            "Host": "localhost:8585",
                        }
                    ) as http,
                    Client(streamable_http_client(url, http_client=http)) as client,
                ):

                    async def call(name, arguments):
                        result = await client.call_tool(name, arguments)
                        assert not result.is_error, result.structured_content
                        return result.structured_content["data"]

                    tools = (await client.list_tools()).tools
                    assert len({tool.name for tool in tools}) == len(tools)
                    assert {
                        "get_operation_catalog",
                        "get_plan",
                        "get_library_quality",
                        "get_instance_status",
                        "list_library_issues",
                        "inspect_artist",
                        "list_jobs",
                        "get_job",
                        "read_diagnostics",
                        "run_health_check",
                        "preview_repairs",
                        "apply_repairs",
                        "retry_job",
                        "cancel_job",
                    } <= {tool.name for tool in tools}
                    check_args = {
                        "artist_uid": ARTIST_UID,
                        "idempotency_key": "check-1",
                    }
                    check = await call("run_health_check", check_args)
                    assert (await call("run_health_check", check_args))[
                        "job_id"
                    ] == check["job_id"]
                    await asyncio.to_thread(execute, check["job_id"])
                    checked = await call("get_job", {"job_id": check["job_id"]})
                    assert checked["execution_status"] == "completed"
                    assert checked["issue_id"] is not None
                    plan = await call(
                        "preview_repairs", {"issue_id": int(checked["issue_id"])}
                    )
                    apply_args = {
                        "plan_id": plan["plan_id"],
                        "plan_version": plan["plan_version"],
                        "idempotency_key": "apply-1",
                    }
                    repair = await call("apply_repairs", apply_args)
                    if change_photo:
                        photo.write_bytes(b"a different photo after preview")
                    await asyncio.to_thread(execute, repair["job_id"])
                    result = await call("get_job", {"job_id": repair["job_id"]})
                    assert result["execution_status"] == (
                        "conflict" if change_photo else "applied"
                    )
                    if not change_photo:
                        assert result["verification_status"] == "verified"
                    assert (await call("apply_repairs", apply_args))[
                        "job_id"
                    ] == repair["job_id"]
            finally:
                server.should_exit = True
                await asyncio.wait_for(serving, 5)

    asyncio.run(run())
    with read_scope() as session:
        rows = session.execute(
            text("SELECT name, has_photo FROM library_artists ORDER BY name")
        ).all()
        assert rows == [
            ("Photo Artist", 0 if change_photo else 1),
            ("Untouched Artist", 0),
        ]
        assert session.execute(text("SELECT COUNT(*) FROM tasks")).scalar_one() == 2
        assert (
            session.execute(text("SELECT COUNT(*) FROM health_check_runs")).scalar_one()
            == 0
        )
    assert photo.read_bytes() == (
        b"a different photo after preview" if change_photo else b"photo fixture"
    )
    assert dispatch.call_count == 2

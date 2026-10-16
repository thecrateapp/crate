"""Durable acceptance survives loss of the API process before broker delivery."""

import asyncio
import json
import os
import subprocess
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy import text
from starlette.routing import Route

from crate.db.tx import transaction_scope
from crate.db.repositories.tasks_updates import start_task
from tests.agent_command_fixtures import UID
from tests.agent_command_fixtures import command_world as command_world  # noqa: PLC0414
from tests.test_mcp_actions import _client
from tests.test_mcp_limits import isolated_redis as isolated_redis  # noqa: PLC0414


def test_reconnect_and_new_process_redispatch_preserve_accepted_identity(
    command_world, isolated_redis, monkeypatch
):
    from crate.mcp.server import create_mcp_server
    from crate.worker_handlers.management import _handle_health_check

    monkeypatch.setenv("CRATE_MCP_ENABLED", "true")
    monkeypatch.setenv("CRATE_MCP_ACTIONS_ENABLED", "true")
    monkeypatch.setenv("CRATE_MCP_ALLOWED_HOSTS", "localhost:8585")
    monkeypatch.setattr("crate.mcp.limits._redis", lambda: isolated_redis)
    monkeypatch.setattr(
        "crate.db.repositories.tasks_mutations.dispatch_task", lambda *_: None
    )

    async def call(name, args):
        _, manager, endpoint = create_mcp_server()

        @asynccontextmanager
        async def lifespan(_app):
            async with manager.run():
                yield

        app = FastAPI(lifespan=lifespan)
        app.router.routes.append(Route("/mcp", endpoint=endpoint))
        async with (
            app.router.lifespan_context(app),
            _client(app, command_world["token"]) as (client, _),
        ):
            result = await client.call_tool(name, args)
            assert not result.is_error, result
            return result.structured_content["data"]

    args = {"artist_uid": UID, "idempotency_key": "restart-before-dispatch"}
    accepted = asyncio.run(call("run_health_check", args))
    job = accepted["job_id"]
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE tasks SET updated_at=NOW()-INTERVAL '10 minutes' WHERE id=:id"
            ),
            {"id": job},
        )
    # A fresh interpreter knows only the database, never the former API's callbacks.
    recovered = subprocess.run(
        [
            sys.executable,
            "-c",
            "import json; from crate.db.repositories import tasks_maintenance as t; "
            "sent=[]; t.dispatch_task=lambda kind,job:sent.append([kind,job]); "
            "t.redispatch_stale_pending_tasks(); print(json.dumps(sent))",
        ],
        capture_output=True,
        text=True,
        check=True,
        env=dict(os.environ),
    )
    assert json.loads(recovered.stdout) == [["health_check", job]]
    assert asyncio.run(call("run_health_check", args))["job_id"] == job
    assert start_task(job)
    result = _handle_health_check(
        job, {"agent_command": True, "artist_uid": UID}, command_world["config"]
    )
    assert result["status"] == "completed"
    replay = asyncio.run(call("run_health_check", args))
    assert replay["job_id"] == job
    assert replay["status"] == "completed"

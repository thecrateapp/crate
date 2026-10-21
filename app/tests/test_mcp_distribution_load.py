"""Paired synthetic load: equal foreground reads/workers, with added MCP traffic."""

import asyncio
from collections import defaultdict
from contextlib import asynccontextmanager
from contextvars import ContextVar
import json
import math
from pathlib import Path
import resource
import socket
from statistics import median
from time import perf_counter, process_time

import httpx2
from fastapi import FastAPI
from sqlalchemy import event
from starlette.routing import Route
import uvicorn

from crate import agent_metadata
from crate.agent_discovery import get_library_quality
from crate.db.engine import get_engine
from tests.test_mcp_library_performance import library_load_world as library_load_world  # noqa: PLC0414
from tests.test_mcp_library_performance import _sdk
from tests.test_mcp_limits import isolated_redis as isolated_redis  # noqa: PLC0414

_LABEL = ContextVar("phase7_load_label", default=None)
_OUTPUT = (
    Path(__file__).resolve().parents[2] / ".artifacts/mcp-phase7/load-measurements.json"
)


def distribution(values):
    ordered = sorted(values)
    return {
        "samples": len(values),
        "p50": round(median(ordered), 3),
        "p95": round(ordered[math.ceil(len(values) * 0.95) - 1], 3),
        "p99": round(ordered[math.ceil(len(values) * 0.99) - 1], 3),
        "max": round(ordered[-1], 3),
    }


def test_paired_api_database_worker_load_with_and_without_mcp(
    library_load_world, isolated_redis, monkeypatch, tmp_path
):
    from crate.mcp.server import create_mcp_server

    world = library_load_world
    isolated_redis.flushdb()
    monkeypatch.setattr("crate.mcp.limits._redis", lambda: isolated_redis)
    monkeypatch.setattr("crate.db.cache_runtime.get_redis", lambda: isolated_redis)
    samples, sql = defaultdict(list), defaultdict(list)
    measurements = {"fixture": world["fixture_counts"], "arms": {}, "errors": []}
    engine = get_engine()

    def before(_connection, _cursor, statement, _params, context, _many):
        context._phase7_start = perf_counter()
        context._phase7_label = _LABEL.get()

    def after(_connection, _cursor, _statement, _params, context, _many):
        if context._phase7_label:
            sql[context._phase7_label].append(
                (perf_counter() - context._phase7_start) * 1000
            )

    event.listen(engine, "before_cursor_execute", before)
    event.listen(engine, "after_cursor_execute", after)

    def worker(mode, index):
        label = f"{mode}:worker"
        reset = _LABEL.set(label)
        started = perf_counter()
        try:
            compiled = agent_metadata.compile_operation(
                "metadata_update",
                {
                    "entity_type": "artist",
                    "entity_uid": world["artist_uids"][0],
                    "patch": {"bio": f"Paired {mode} {index}"},
                },
                {"library_path": str(tmp_path)},
            )
            result = agent_metadata.apply_operation(
                "metadata_update",
                compiled["execution"],
                {"library_path": str(tmp_path)},
                task_id="paired-load",
                authorize=lambda callback=None: callback() if callback else None,
            )
            assert result["verification"]["status"] in {"passed", "verified"}, result
            samples[label].append((perf_counter() - started) * 1000)
        finally:
            _LABEL.reset(reset)

    async def run():
        with socket.socket() as listener:
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            listener.bind(("127.0.0.1", 0))
            listener.listen(128)
            port = listener.getsockname()[1]
            monkeypatch.setenv("CRATE_MCP_ALLOWED_HOSTS", f"127.0.0.1:{port}")
            _, manager, endpoint = create_mcp_server()

            @asynccontextmanager
            async def lifespan(_app):
                async with manager.run():
                    yield

            app = FastAPI(lifespan=lifespan)

            @app.middleware("http")
            async def trace(request, call_next):
                reset = _LABEL.set(request.headers.get("x-crate-benchmark"))
                try:
                    return await call_next(request)
                finally:
                    _LABEL.reset(reset)

            @app.get("/control-quality")
            def foreground():
                return get_library_quality(category="low_bitrate", limit=20)

            app.router.routes.append(Route("/mcp", endpoint=endpoint))
            server = uvicorn.Server(
                uvicorn.Config(app, log_level="warning", access_log=False)
            )
            serving = asyncio.create_task(server.serve(sockets=[listener]))
            try:
                async with asyncio.timeout(15):
                    while not server.started:
                        await asyncio.sleep(0.01)
                base = f"http://127.0.0.1:{port}"
                async with (
                    httpx2.AsyncClient(base_url=base) as http,
                    _sdk(base, world["credentials"][2].token) as sdk_a,
                    _sdk(base, world["credentials"][3].token) as sdk_b,
                ):
                    sessions = {2: sdk_a, 3: sdk_b}
                    await http.get("/control-quality")  # Warm caches before either arm.
                    for client, _transport in sessions.values():
                        assert not (
                            await client.call_tool("get_instance_status", {})
                        ).is_error
                    await asyncio.to_thread(worker, "warmup", 0)
                    for cycle in range(2):
                        for mode in (
                            ["baseline", "mixed"]
                            if cycle == 0
                            else ["mixed", "baseline"]
                        ):
                            started, cpu = perf_counter(), process_time()

                            async def reads():
                                for _ in range(12):
                                    begin = perf_counter()
                                    response = await http.get(
                                        "/control-quality",
                                        headers={"x-crate-benchmark": f"{mode}:api"},
                                    )
                                    assert response.status_code == 200
                                    samples[f"{mode}:api"].append(
                                        (perf_counter() - begin) * 1000
                                    )

                            async def mcp_reads(index):
                                client, transport = sessions[index]
                                transport.headers["X-Crate-Benchmark"] = f"{mode}:mcp"
                                for _ in range(12):
                                    begin = perf_counter()
                                    result = await client.call_tool(
                                        "get_instance_status", {}
                                    )
                                    assert not result.is_error, result
                                    samples[f"{mode}:mcp"].append(
                                        (perf_counter() - begin) * 1000
                                    )
                                    samples["mcp:bytes"].append(
                                        len(result.model_dump_json().encode())
                                    )

                            async def workers():
                                for index in range(6):
                                    await asyncio.to_thread(
                                        worker, mode, cycle * 6 + index
                                    )

                            pending = [reads(), reads(), workers()]
                            if mode == "mixed":
                                pending += [mcp_reads(2), mcp_reads(3)]
                            await asyncio.gather(*pending)
                            arm = measurements["arms"].setdefault(
                                mode, {"cpu_seconds": 0, "elapsed_seconds": 0}
                            )
                            arm["cpu_seconds"] += process_time() - cpu
                            arm["elapsed_seconds"] += perf_counter() - started
            finally:
                server.should_exit = True
                await asyncio.wait_for(serving, 10)

    try:
        asyncio.run(run())
        for mode in ("baseline", "mixed"):
            for component in ("api", "worker"):
                label = f"{mode}:{component}"
                measurements["arms"][mode][component + "_latency_ms"] = distribution(
                    samples[label]
                )
                measurements["arms"][mode][component + "_sql_ms"] = distribution(
                    sql[label]
                )
                measurements["arms"][mode][component + "_sql_statements"] = len(
                    sql[label]
                )
            assert len(samples[f"{mode}:api"]) == 48
            assert len(samples[f"{mode}:worker"]) == 12
        measurements["mcp_latency_ms"] = distribution(samples["mixed:mcp"])
        measurements["mcp_response_bytes"] = distribution(samples["mcp:bytes"])
        measurements["mcp_sql_ms"] = distribution(sql["mixed:mcp"])
        measurements["process_max_rss_kib"] = resource.getrusage(
            resource.RUSAGE_SELF
        ).ru_maxrss
        assert max(samples["mcp:bytes"]) < 65536
        measurements["interpretation"] = (
            "Synthetic common-service foreground endpoint and worker metadata adapter, loopback HTTP, same process/dataset, API concurrency 2, worker concurrency 1, MCP concurrency 2. Not production capacity or a rollout budget."
        )
    finally:
        event.remove(engine, "before_cursor_execute", before)
        event.remove(engine, "after_cursor_execute", after)
        _OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        _OUTPUT.write_text(json.dumps(measurements, indent=2, sort_keys=True))

"""Bounded local evidence comparison; latency is reported, never a CI threshold."""

import asyncio
import json
import math
import os
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from statistics import median
from time import perf_counter

import httpx2
from crate import agent_diagnostics
from crate.agent_access import PILOT_GRANTS
from fastapi import FastAPI
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from sqlalchemy import event, text
from starlette.routing import Route

from tests.test_mcp_limits import isolated_redis as isolated_redis  # noqa: PLC0414 — pytest fixture registration.

ARTIST_UID = "20000000-0000-0000-0000-000000000001"
SAMPLES = 20


def _seed_evidence():
    from crate.db.tx import transaction_scope

    now = datetime.now(UTC)
    with transaction_scope() as session:
        artist_id = session.execute(
            text("""
                INSERT INTO library_artists (name, entity_uid, album_count, track_count, updated_at)
                VALUES ('Benchmark Artist', CAST(:uid AS uuid), 12, 120, :now) RETURNING id
            """),
            {"uid": ARTIST_UID, "now": now},
        ).scalar_one()
        session.execute(
            text("""
                INSERT INTO health_issues (check_type, severity, description, status,
                                          created_at, last_seen_at, artist_id, identity_key)
                SELECT 'duplicate_tracks', 'high', 'Persisted duplicate ' || n, 'open',
                       :now, :now, :artist, 'mcp-benchmark-' || n
                FROM generate_series(1, 1000) n
            """),
            {"now": now, "artist": artist_id},
        )
        session.execute(
            text("""
                INSERT INTO health_check_runs (check_type, last_run_at, issue_count)
                VALUES ('duplicate_tracks', :now, 1000)
            """),
            {"now": now},
        )
        session.execute(
            text("""
                INSERT INTO tasks (id, type, status, created_at, updated_at, error)
                SELECT 'benchmark-job-' || n, 'scan', 'failed',
                       :now - (n || ' seconds')::interval, :now, 'Fixture failure'
                FROM generate_series(1, 2000) n
            """),
            {"now": now},
        )
        session.execute(
            text("""
                INSERT INTO worker_logs (worker_id, task_id, level, category, message, created_at)
                SELECT 'benchmark-worker', 'benchmark-job-1', 'error', 'test',
                       'Persisted diagnostic log ' || n, :now - (n || ' seconds')::interval
                FROM generate_series(1, 5000) n
            """),
            {"now": now},
        )
        session.execute(
            text("""
                INSERT INTO ui_snapshots (scope, subject_key, version, source_seq, built_at, payload_json)
                SELECT 'ops:health', 'agent:diagnostics:v1', 1, 1, :now,
                       jsonb_build_object(
                           'issues', (SELECT jsonb_agg(to_jsonb(h)) FROM health_issues h),
                           'counts', jsonb_build_object('duplicate_tracks', 1000),
                           'runs', jsonb_build_object('duplicate_tracks', jsonb_build_object('last_run_at', CAST(:now AS timestamptz)))
                       )
            """),
            {"now": now},
        )
        session.execute(
            text("""
                INSERT INTO ui_snapshots (scope, subject_key, version, source_seq, built_at, payload_json)
                VALUES ('ops', 'dashboard', 1, 1, :now,
                        '{"stats": {"artists": 1, "albums": 12, "tracks": 120, "total_size_gb": 1}}');
            """),
            {"now": now},
        )
        session.execute(
            text("""
                INSERT INTO ops_runtime_state (key, payload_json, updated_at)
                VALUES ('worker_live', '{"running_count": 1, "pending_count": 0}', :now),
                       ('analysis_status', '{"total": 120, "analysis_done": 100}', :now)
            """),
            {"now": now},
        )


def _assert_sql_budget(statements, *, through_mcp):
    normalized = [statement.strip().lower() for statement in statements]
    assert not any("library_tracks" in statement for statement in normalized)
    selects = [
        statement
        for statement in normalized
        if statement.startswith(("select", "with"))
    ]
    assert len(selects) <= (2 if through_mcp else 1)
    assert any("set local statement_timeout" in statement for statement in normalized)
    for statement in normalized:
        assert statement.startswith(("select", "with", "set local")) or (
            through_mcp and statement.startswith("insert into audit_log")
        ), statement
    return len(selects)


def _latencies(samples):
    ordered = sorted(samples)
    return {
        "p50_ms": round(median(ordered), 3),
        "p95_ms": round(ordered[math.ceil(len(ordered) * 0.95) - 1], 3),
        "max_ms": round(max(ordered), 3),
    }


def test_diagnostic_read_budget_with_real_credentials_audit_and_redis(
    pg_db, isolated_redis, monkeypatch, tmp_path
):
    from crate.db.engine import get_engine
    from crate.db.repositories.agent_credentials import create_credential
    from crate.mcp import limits
    from crate.mcp.server import create_mcp_server

    _seed_evidence()
    isolated_redis.flushdb()
    monkeypatch.setattr(limits, "_redis", lambda: isolated_redis)
    monkeypatch.setenv("CRATE_MCP_ALLOWED_HOSTS", "localhost:8585")
    cases = {
        "get_instance_status": {},
        "list_library_issues": {"limit": 20},
        "inspect_artist": {"artist_uid": ARTIST_UID, "limit": 20},
        "list_jobs": {"limit": 20},
        "get_job": {"job_id": "benchmark-job-1"},
        "read_diagnostics": {"source": "worker_logs", "limit": 20},
    }
    tokens = {
        name: create_credential(
            f"Benchmark {name}", PILOT_GRANTS, datetime.now(UTC) + timedelta(hours=1)
        ).token
        for name in cases
    }
    _, manager, endpoint = create_mcp_server()

    @asynccontextmanager
    async def lifespan(app):
        async with manager.run():
            yield

    app = FastAPI(lifespan=lifespan)
    app.router.routes.append(Route("/mcp", endpoint=endpoint))
    report = {
        "recorded_at": datetime.now(UTC).isoformat(),
        "environment": "Local disposable PostgreSQL/Redis; warm, sequential ASGI HTTP calls",
        "dataset": {
            "artists": 1,
            "health_issues": 1000,
            "jobs": 2000,
            "worker_logs": 5000,
        },
        "samples_per_tool": SAMPLES,
        "acceptance": {
            "max_response_bytes": 65536,
            "max_diagnostic_selects": 1,
            "max_mcp_selects_including_auth": 2,
            "library_tracks_queries": 0,
            "diagnostic_statement_timeout": "5s",
            "observational_p95_target_ms": 500,
        },
        "limitations": "Small synthetic dataset, no production parity, network/TLS or concurrent load. No latency assertion in CI.",
        "tools": {},
    }
    statements = []

    def observe(_connection, _cursor, statement, _parameters, _context, _executemany):
        statements.append(statement)

    engine = get_engine()
    event.listen(engine, "before_cursor_execute", observe)

    async def run():
        async with app.router.lifespan_context(app):
            for name, arguments in cases.items():
                direct_times, mcp_times, response_sizes = [], [], []
                direct = getattr(agent_diagnostics, name)
                direct(**arguments)
                for _ in range(SAMPLES):
                    statements.clear()
                    started = perf_counter()
                    evidence = direct(**arguments)
                    direct_times.append((perf_counter() - started) * 1000)
                    assert evidence["availability"] == "available"
                    _assert_sql_budget(statements, through_mcp=False)
                async with (
                    httpx2.AsyncClient(
                        transport=httpx2.ASGITransport(app=app),
                        headers={"Authorization": f"Bearer {tokens[name]}"},
                    ) as http,
                    streamable_http_client(
                        "http://localhost:8585/mcp", http_client=http
                    ) as streams,
                    ClientSession(streams[0], streams[1]) as client,
                ):
                    await client.initialize()
                    await client.list_tools()
                    await client.call_tool(name, arguments)
                    for _ in range(SAMPLES):
                        statements.clear()
                        started = perf_counter()
                        result = await client.call_tool(name, arguments)
                        mcp_times.append((perf_counter() - started) * 1000)
                        assert result.is_error is False
                        assert result.structured_content["availability"] == "available"
                        _assert_sql_budget(statements, through_mcp=True)
                        size = len(result.model_dump_json().encode("utf-8"))
                        assert size <= 65536
                        response_sizes.append(size)
                report["tools"][name] = {
                    "direct": _latencies(direct_times),
                    "mcp_including_auth_admission_audit": _latencies(mcp_times),
                    "max_response_bytes": max(response_sizes),
                }

    try:
        asyncio.run(run())
    finally:
        event.remove(engine, "before_cursor_execute", observe)
    output = Path(
        os.environ.get(
            "CRATE_MCP_BENCHMARK_REPORT",
            str(tmp_path / "mcp-diagnostic-performance.json"),
        )
    )
    output.write_text(json.dumps(report, indent=2) + "\n")
    print(f"MCP diagnostic performance report: {output}")

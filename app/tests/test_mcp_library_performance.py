"""Reproduce bounded phase-4 reads on 48K tracks over SDK HTTP and real Redis.

Run from app/: ../.venv/bin/python -m pytest tests/test_mcp_library_performance.py -q
Writes measurements to /tmp/crate-phase4-load-evidence.json. Latency is evidence,
not a machine-dependent pass/fail threshold. Query/response bounds are contracts.
"""

from __future__ import annotations

import asyncio
import importlib
import json
import math
import re
import socket
import statistics
from collections import defaultdict
from contextlib import asynccontextmanager
from contextvars import ContextVar
from datetime import UTC, datetime, timedelta
from pathlib import Path
from time import perf_counter
from unittest.mock import Mock

import httpx2
import pytest
import uvicorn
from fastapi import FastAPI
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from sqlalchemy import event, text
from starlette.routing import Route

from crate.agent_access import ALLOWED_GRANTS
from crate.db.analytics_quality_surface import save_quality_report_snapshot
from crate.db.engine import get_engine
from crate.db.repositories import agent_operation_jobs
from crate.db.repositories.agent_credentials import create_credential
from crate.db.repositories.tasks_updates import start_task
from crate.db.tx import read_scope, transaction_scope

from tests.test_mcp_limits import isolated_redis as isolated_redis  # noqa: PLC0414

_SAMPLE: ContextVar[str | None] = ContextVar("mcp_load_sample", default=None)
_EVIDENCE = Path("/tmp/crate-phase4-load-evidence.json")
_TRACKS = 48000
_SAMPLES = 12


def _distribution(values: list[float | int]) -> dict:
    ordered = sorted(values)
    return {
        "samples": len(values),
        "p50": round(statistics.median(ordered), 3),
        "p95": round(ordered[math.ceil(len(ordered) * 0.95) - 1], 3),
        "maximum": round(ordered[-1], 3),
    }


@pytest.fixture
def library_load_world(pg_db, monkeypatch):
    monkeypatch.setenv("CRATE_MCP_ENABLED", "true")
    monkeypatch.setenv("CRATE_MCP_ACTIONS_ENABLED", "true")
    monkeypatch.setenv("CRATE_MCP_OAUTH_ENABLED", "false")
    dispatched = []
    monkeypatch.setattr(
        "crate.db.repositories.tasks_mutations.dispatch_task",
        lambda kind, task_id: dispatched.append((kind, task_id)),
    )
    monkeypatch.setattr(
        "crate.db.repositories.tasks_shared.publish_tasks_surface_signal", lambda: None
    )
    with transaction_scope() as current:
        current.execute(
            text("""INSERT INTO library_artists(name,entity_uid,folder_name,updated_at)
            SELECT 'Load Artist '||g,md5('mcp-load-artist-'||g)::uuid,'artist-'||g,NOW()
            FROM generate_series(1,900) g""")
        )
        current.execute(
            text("""INSERT INTO library_albums(artist,name,path,entity_uid,
            track_count,total_size,total_duration,formats_json,updated_at)
            SELECT 'Load Artist '||((g-1)%900+1),'Load Album '||g,
                '/music/artist-'||((g-1)%900+1)||'/album-'||g,
                md5('mcp-load-album-'||g)::uuid,10,335544320,1800,'["flac"]'::jsonb,NOW()
            FROM generate_series(1,4800) g""")
        )
        current.execute(
            text("""INSERT INTO library_tracks(album_id,artist,album,filename,
            title,path,entity_uid,track_number,disc_number,format,duration,size,updated_at)
            SELECT a.id,a.artist,a.name,'track-'||n||'.flac','Load Track '||n,
                a.path||'/track-'||n||'.flac',md5('mcp-load-track-'||a.id||'-'||n)::uuid,
                n,1,'flac',180,33554432,NOW()
            FROM library_albums a CROSS JOIN generate_series(1,10) n""")
        )
        current.execute(
            text("""INSERT INTO track_processing_state(track_id,pipeline,state,generation)
            SELECT t.id,p.pipeline,'pending',1 FROM library_tracks t
            CROSS JOIN (VALUES('analysis'),('bliss')) p(pipeline)""")
        )
        current.execute(
            text("""WITH stats AS (
            SELECT artist,COUNT(*) AS albums,SUM(track_count) AS tracks,SUM(total_size) AS size
            FROM library_albums GROUP BY artist)
            UPDATE library_artists a SET album_count=s.albums,track_count=s.tracks,
                total_size=s.size,formats_json='["flac"]'::jsonb,primary_format='flac'
            FROM stats s WHERE a.name=s.artist""")
        )
        tracks = list(
            current.execute(
                text(
                    "SELECT entity_uid::text FROM library_tracks ORDER BY id LIMIT 200"
                )
            ).scalars()
        )
        current.execute(
            text("""UPDATE library_tracks SET analysis_state='done',bliss_state='done',
            bpm=120,bliss_vector=array_fill(0.2::double precision,ARRAY[20]),
            analysis_completed_at=NOW(),bliss_computed_at=NOW()
            WHERE entity_uid=ANY(CAST(:uids AS uuid[]))"""),
            {"uids": tracks},
        )
        current.execute(
            text("""INSERT INTO track_analysis_features(track_id,bpm,updated_at)
            SELECT id,120,NOW() FROM library_tracks WHERE entity_uid=ANY(CAST(:uids AS uuid[]))"""),
            {"uids": tracks},
        )
        current.execute(
            text("""INSERT INTO track_bliss_embeddings(track_id,bliss_vector,updated_at)
            SELECT id,bliss_vector,NOW() FROM library_tracks WHERE entity_uid=ANY(CAST(:uids AS uuid[]))"""),
            {"uids": tracks},
        )
        signature = {
            "schema_version": 1,
            "implementation_sha256": "a" * 64,
            "binary_sha256": "b" * 64,
            "model_sha256": "c" * 64,
            "source_version": "d" * 64,
            "components_invoked": ["crate-cli", "essentia", "panns-cnn14"],
            "packages": {
                "essentia": "fixture-version",
                "torch": "fixture-version",
                "panns-inference": "fixture-version",
                "librosa": "fixture-version",
            },
            "configuration": {
                "signal_duration": 120,
                "panns_duration": 30,
                "description": "synthetic runtime evidence " * 40,
            },
        }
        current.execute(
            text(
                "UPDATE track_processing_state SET state='done',completed_at=NOW(),pipeline_signature=:signature WHERE track_id IN (SELECT id FROM library_tracks WHERE entity_uid=ANY(CAST(:uids AS uuid[])))"
            ),
            {"uids": tracks, "signature": json.dumps(signature)},
        )
        artists = list(
            current.execute(
                text(
                    "SELECT entity_uid::text FROM library_artists ORDER BY name LIMIT 2"
                )
            ).scalars()
        )
        counts = (
            current.execute(
                text(
                    "SELECT (SELECT COUNT(*) FROM library_artists) artists,(SELECT COUNT(*) FROM library_albums) albums,(SELECT COUNT(*) FROM library_tracks) tracks,(SELECT COUNT(*) FROM track_processing_state) pipeline_rows"
                )
            )
            .mappings()
            .one()
        )
    assert dict(counts) == {
        "artists": 900,
        "albums": 4800,
        "tracks": _TRACKS,
        "pipeline_rows": _TRACKS * 2,
    }
    quality_items = [
        {
            "artist": f"Load Artist {index % 900 + 1}",
            "album": f"Load Album {index // 10 + 1}",
            "file": f"track-{index % 10 + 1}.mp3",
            "format": "mp3",
            "bitrate_kbps": 128,
            "evidence": "bitrate_heuristic",
        }
        for index in range(_TRACKS)
    ]
    save_quality_report_snapshot(
        {
            "ready": True,
            "scanned_tracks": _TRACKS,
            "method": "metadata_heuristics_v1",
            "audio_decode_verified": False,
            "corrupt_count": 0,
            "low_bitrate_count": _TRACKS,
            "lossy_with_lossless_count": 0,
            "mixed_format_count": 0,
            "corrupt": [],
            "low_bitrate": quality_items,
            "lossy_with_lossless": [],
            "mixed_format_albums": [],
        }
    )
    credentials = [
        create_credential(
            f"Load integration {index}",
            ALLOWED_GRANTS,
            datetime.now(UTC) + timedelta(days=1),
        )
        for index in range(4)
    ]
    exact_url = (
        "https://reference.example.test/artist?reference="
        + "x" * 1500
        + "&page=1&literal=%2Fz"
    )
    document = {
        "operation": "metadata_update",
        "targets": [{"entity_type": "artist", "entity_uid": artists[0]}],
        "source_versions": {"database": "a" * 64},
        "changes": [
            {"entity_uid": artists[0], "field": "bio", "before": "Old", "after": ""},
            {
                "entity_uid": artists[0],
                "field": "urls",
                "before": {},
                "after": {"reference": exact_url},
            },
        ],
        "impact": {"database": True, "filesystem": False},
        "risk": "safe",
        "reversibility": "new_plan_required",
    }
    empty_size = len(json.dumps(document).encode())
    document["changes"][0]["after"] = "b" * (39000 - empty_size)
    assert 38990 <= len(json.dumps(document).encode()) <= 40000
    accepted = agent_operation_jobs.prepare_operation(
        credentials[0].principal,
        "metadata_update",
        {"entity_type": "artist", "entity_uid": artists[0], "patch": {"bio": "New"}},
        "load-plan",
    )
    start_task(accepted["job_id"])
    prepared = agent_operation_jobs.publish_plan(
        accepted["job_id"],
        {
            "document": document,
            "execution": {
                "target_keys": ["artist:" + artists[0]],
                "private_path": "/music/not-exposed",
            },
        },
    )
    return {
        "credentials": credentials,
        "track_uids": tracks,
        "artist_uids": artists,
        "plan": prepared["plan"],
        "exact_url": exact_url,
        "fixture_counts": dict(counts),
        "plan_document_bytes": len(json.dumps(document).encode()),
        "quality_items": len(quality_items),
        "dispatched": dispatched,
    }


class _TraceEndpoint:
    def __init__(self, endpoint):
        self.endpoint = endpoint

    async def __call__(self, scope, receive, send):
        label = dict(scope.get("headers", [])).get(b"x-crate-benchmark", b"").decode()
        reset = _SAMPLE.set(label or None)
        try:
            await self.endpoint(scope, receive, send)
        finally:
            _SAMPLE.reset(reset)


@asynccontextmanager
async def _sdk(base_url: str, token: str):
    async with (
        httpx2.AsyncClient(
            headers={"Authorization": f"Bearer {token}"}, timeout=30
        ) as http,
        streamable_http_client(base_url + "/mcp", http_client=http) as streams,
        ClientSession(streams[0], streams[1]) as session,
    ):
        await session.initialize()
        yield session, http


def test_phase4_bounded_sdk_reads_and_durable_preparation_under_library_load(
    library_load_world, isolated_redis, monkeypatch
):
    from crate.mcp import limits
    from crate.mcp.server import create_mcp_server

    world = library_load_world
    isolated_redis.flushdb()
    monkeypatch.setattr(limits, "_redis", lambda: isolated_redis)
    forbidden = []
    for module_name in set(
        importlib.import_module("crate.agent_library_operations")._ADAPTERS.values()
    ):
        module = importlib.import_module(module_name)
        spy = Mock(side_effect=AssertionError("HTTP invoked an operation compiler"))
        monkeypatch.setattr(module, "compile_operation", spy)
        forbidden.append(spy)
    for dotted in (
        "crate.quality.quality_report",
        "crate.audio_analysis.analyze_track",
        "crate.audio_analysis.analyze_batch",
        "crate.library_sync.LibrarySync.prepare_album_sync",
        "crate.agent_metadata._fingerprint",
        "crate.agent_sync._manifest",
        "crate.agent_portability._read_source",
    ):
        module_name, attribute = dotted.rsplit(".", 1)
        if module_name.endswith("LibrarySync"):
            owner = importlib.import_module("crate.library_sync").LibrarySync
        else:
            owner = importlib.import_module(module_name)
        spy = Mock(side_effect=AssertionError("HTTP invoked filesystem or DSP work"))
        monkeypatch.setattr(owner, attribute, spy)
        forbidden.append(spy)
    statements = defaultdict(list)

    def capture(_connection, _cursor, statement, _parameters, _context, _executemany):
        label = _SAMPLE.get()
        if label:
            statements[label].append(statement)

    engine = get_engine()
    event.listen(engine, "before_cursor_execute", capture)
    evidence = {
        "fixture": world["fixture_counts"],
        "transport": "official MCP SDK over loopback TCP; PostgreSQL and Redis real",
        "samples_per_read": _SAMPLES,
        "latency_unit": "milliseconds",
        "latency_is_an_assertion": False,
        "prepared_plan_document_bytes": world["plan_document_bytes"],
        "quality_snapshot_items": world["quality_items"],
        "reads": {},
        "preparations": [],
        "errors": [],
        "reproduce": "cd app && ../.venv/bin/python -m pytest tests/test_mcp_library_performance.py -q",
    }

    async def sample(session, http, tool, arguments, label):
        http.headers["X-Crate-Benchmark"] = label
        started = perf_counter()
        result = await session.call_tool(tool, arguments)
        elapsed = (perf_counter() - started) * 1000
        payload = result.structured_content or {}
        measurements = {
            "latency_ms": elapsed,
            "tool_result_json_bytes": len(result.model_dump_json().encode()),
            "structured_content_bytes": len(json.dumps(payload, default=str).encode()),
            "sql_queries": len(statements[label]),
            "is_error": bool(result.is_error),
        }
        if result.is_error:
            evidence["errors"].append({"tool": tool, "error": payload.get("error")})
        return measurements, payload

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

            app = FastAPI(lifespan=lifespan, redirect_slashes=False)
            app.router.routes.append(Route("/mcp", endpoint=_TraceEndpoint(endpoint)))
            server = uvicorn.Server(
                uvicorn.Config(
                    app, log_level="warning", access_log=False, lifespan="on"
                )
            )
            serving = asyncio.create_task(server.serve(sockets=[listener]))
            try:
                async with asyncio.timeout(15):
                    while not server.started:
                        await asyncio.sleep(0.01)
                base_url = f"http://127.0.0.1:{port}"
                async with _sdk(base_url, world["credentials"][0].token) as (
                    session,
                    http,
                ):
                    definitions = [
                        ("get_plan", {"plan_id": world["plan"]["plan_id"]}),
                        (
                            "get_library_quality",
                            {"category": "low_bitrate", "limit": 100},
                        ),
                        ("get_analysis_status", {"track_uids": world["track_uids"]}),
                    ]
                    for tool, arguments in definitions:
                        samples = []
                        for index in range(_SAMPLES):
                            measured, payload = await sample(
                                session, http, tool, arguments, f"{tool}:{index}"
                            )
                            samples.append(measured)
                            if not measured["is_error"]:
                                data = payload["data"]
                                if tool == "get_plan":
                                    assert (
                                        data["changes"][1]["after"]["reference"]
                                        == world["exact_url"]
                                    )
                                    assert data["truncated"] is False
                                    assert "/music/not-exposed" not in json.dumps(data)
                                elif tool == "get_library_quality":
                                    assert (
                                        0 < len(data["items"]) <= 100
                                        and data["total"] == _TRACKS
                                    )
                                    assert data["next_cursor"]
                                else:
                                    assert (
                                        0 < len(data["items"]) <= 50
                                        and data["total"] == 400
                                    )
                                    assert data["status"] == "completed"
                                    assert data["next_cursor"]
                                    assert all(
                                        item["version_evidence"] == "recorded"
                                        for item in data["items"]
                                    )
                        evidence["reads"][tool] = {
                            key: _distribution([s[key] for s in samples])
                            for key in (
                                "latency_ms",
                                "tool_result_json_bytes",
                                "structured_content_bytes",
                                "sql_queries",
                            )
                        }
                async with _sdk(base_url, world["credentials"][3].token) as (
                    session,
                    http,
                ):
                    cursor = None
                    seen = set()
                    pages = []
                    first_cursor = None
                    while True:
                        measured, payload = await sample(
                            session,
                            http,
                            "get_analysis_status",
                            {
                                "track_uids": world["track_uids"],
                                "cursor": cursor,
                                "limit": 50,
                            },
                            f"analysis-page:{len(pages)}",
                        )
                        assert not measured["is_error"], payload
                        pages.append(measured)
                        data = payload["data"]
                        assert data["total"] == 400
                        for item in data["items"]:
                            identity = (item["track_uid"], item["pipeline"])
                            assert identity not in seen
                            seen.add(identity)
                        cursor = data["next_cursor"]
                        if first_cursor is None:
                            first_cursor = cursor
                        if cursor is None:
                            break
                        assert len(pages) < 50
                    assert len(seen) == 400
                    evidence["analysis_pagination"] = {
                        "items": len(seen),
                        "pages": len(pages),
                        "largest_page_bytes": max(
                            page["structured_content_bytes"] for page in pages
                        ),
                        "queries_per_page": _distribution(
                            [page["sql_queries"] for page in pages]
                        ),
                    }
                    with transaction_scope() as current:
                        current.execute(
                            text(
                                "UPDATE track_processing_state SET generation=generation+1 WHERE pipeline='analysis' AND track_id=(SELECT id FROM library_tracks WHERE entity_uid=CAST(:uid AS uuid))"
                            ),
                            {"uid": world["track_uids"][0]},
                        )
                    stale = await session.call_tool(
                        "get_analysis_status",
                        {
                            "track_uids": world["track_uids"],
                            "limit": 50,
                            "cursor": first_cursor,
                        },
                    )
                    assert (
                        stale.is_error
                        and stale.structured_content["error"]["code"] == "CURSOR_STALE"
                    )
                    evidence["analysis_cursor_stale_after_generation_change"] = True

                async def prepare(index):
                    async with _sdk(base_url, world["credentials"][index].token) as (
                        session,
                        http,
                    ):
                        args = {
                            "entity_type": "artist",
                            "entity_uid": world["artist_uids"][index - 1],
                            "patch": {"bio": "Scheduled, never compiled by HTTP"},
                            "idempotency_key": f"load-prepare-{index}",
                        }
                        measured, payload = await sample(
                            session,
                            http,
                            "preview_metadata_update",
                            args,
                            f"prepare:{index}",
                        )
                        replay, replayed = await sample(
                            session,
                            http,
                            "preview_metadata_update",
                            args,
                            f"replay:{index}",
                        )
                        if not measured["is_error"] and not replay["is_error"]:
                            assert (
                                payload["data"]["job_id"] == replayed["data"]["job_id"]
                            )
                            assert replayed["data"]["replayed"] is True
                            return {
                                **measured,
                                "job_id": payload["data"]["job_id"],
                                "principal_id": world["credentials"][
                                    index
                                ].principal.id,
                                "replay": replay,
                            }
                        return measured

                evidence["preparations"] = await asyncio.gather(prepare(1), prepare(2))
            finally:
                server.should_exit = True
                await asyncio.wait_for(serving, 10)

    try:
        asyncio.run(run())
        for spy in forbidden:
            spy.assert_not_called()
        all_statements = [
            statement for group in statements.values() for statement in group
        ]
        forbidden_aggregates = [
            statement
            for statement in all_statements
            if re.search(r"\b(COUNT|SUM|AVG)\s*\(", statement, re.I)
            and re.search(r"\blibrary_tracks\b", statement, re.I)
        ]
        assert not forbidden_aggregates
        assert all(group for group in statements.values())
        evidence["sql_statement_count"] = len(all_statements)
        evidence["http_library_aggregate_queries"] = len(forbidden_aggregates)
        evidence["http_compiler_filesystem_dsp_calls"] = sum(
            spy.call_count for spy in forbidden
        )
        with read_scope() as current:
            jobs = [
                dict(row)
                for row in current.execute(
                    text(
                        "SELECT j.task_id,j.principal_id::text,t.status,j.result,j.payload FROM agent_jobs j JOIN tasks t ON t.id=j.task_id WHERE j.principal_id=ANY(CAST(:ids AS uuid[])) ORDER BY j.task_id"
                    ),
                    {
                        "ids": [
                            issued.principal.id for issued in world["credentials"][1:3]
                        ]
                    },
                ).mappings()
            ]
        assert len(jobs) == 2
        assert all(
            job["status"] == "pending"
            and job["result"] is None
            and job["payload"]["domain_operation"] == "metadata_update"
            for job in jobs
        )
        assert len({job["principal_id"] for job in jobs}) == 2
        assert len(world["dispatched"]) == 3  # One fixture plan plus two new jobs.
        assert {task_id for _kind, task_id in world["dispatched"]}.issuperset(
            {job["task_id"] for job in jobs}
        )
        evidence["durable_preparation_jobs"] = len(jobs)
        assert not evidence["errors"], evidence["errors"]
        for operation in evidence["reads"].values():
            assert 0 < operation["sql_queries"]["maximum"] <= 25
            assert operation["structured_content_bytes"]["maximum"] <= 60000
            assert operation["tool_result_json_bytes"]["maximum"] <= 125000
        assert all(0 < item["sql_queries"] <= 50 for item in evidence["preparations"])
    finally:
        event.remove(engine, "before_cursor_execute", capture)
        _EVIDENCE.write_text(
            json.dumps(evidence, indent=2, sort_keys=True, default=str)
        )

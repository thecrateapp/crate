from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import math
import os
import signal
import subprocess
import sys
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

WORKSPACE = Path(os.environ.get("CRATE_BENCH_WORKSPACE", Path.cwd())).absolute()
ROOT = Path(
    os.environ.get("CRATE_BENCH_STATE", "/tmp/crate-observability-pr1a")
).absolute()
VENV = os.environ.get("CRATE_BENCH_PYTHON", str(WORKSPACE / ".venv/bin/python"))
SOURCE = Path(os.environ.get("CRATE_BENCH_SOURCE", WORKSPACE / "app")).absolute()
ROOT.mkdir(parents=True, exist_ok=True)


def emit(event, **kw):
    print(json.dumps({"event": event, **kw}, default=str), flush=True)


def conn(config):
    import psycopg2

    return psycopg2.connect(
        host="127.0.0.1",
        port=config["pg_port"],
        dbname="obsvbench",
        user="obsvbench",
        password="obsvbench",
        connect_timeout=3,
    )


def redis_client(config):
    import redis

    return redis.Redis(
        host="127.0.0.1",
        port=config["redis_port"],
        decode_responses=True,
        socket_timeout=10,
        socket_connect_timeout=3,
    )


def runtime(source, config):
    os.environ.update(
        {
            "CRATE_POSTGRES_HOST": "127.0.0.1",
            "CRATE_POSTGRES_PORT": str(config["pg_port"]),
            "CRATE_POSTGRES_DB": "obsvbench",
            "CRATE_POSTGRES_USER": "obsvbench",
            "CRATE_POSTGRES_PASSWORD": "obsvbench",
            "CRATE_RUNTIME": "api",
            "CRATE_SQLALCHEMY_POOL_SIZE": "10",
            "CRATE_SQLALCHEMY_MAX_OVERFLOW": "0",
            "CRATE_POSTGRES_STATEMENT_TIMEOUT_MS": "15000",
            "CRATE_SQLALCHEMY_POOL_TIMEOUT_SECONDS": "15",
            "REDIS_URL": f"redis://127.0.0.1:{config['redis_port']}/0",
            "CRATE_CACHE_REDIS_URL": f"redis://127.0.0.1:{config['redis_port']}/0",
            "SENTRY_DSN": "",
            "PYTHONDONTWRITEBYTECODE": "1",
        }
    )
    sys.path.insert(0, source)
    from crate.db import cache_runtime

    shared_redis = redis_client(config)
    cache_runtime.get_redis = lambda: shared_redis


def choose_series():
    from crate.api import admin_metrics
    from crate.observability.metric_catalog import (
        canonical_metric,
        get_metric_definition,
    )

    names = list(
        dict.fromkeys(
            list(admin_metrics._DASHBOARD_TIMESERIES.values())
            + [
                "mcp.tool.latency_ms",
                "mcp.tool.response_bytes",
                "mcp.tool.success",
                "mcp.tool.denied",
                "mcp.tool.rate_limited",
                "mcp.job.completed",
                "mcp.job.failed",
                "mcp.auth.denied",
            ]
            + [v[0] for v in admin_metrics._SUMMARY_METRICS.values()]
        )
    )[:40]
    assert len(names) == 40
    defaults = {
        "method": "GET",
        "status_class": "2xx",
        "route": "/api/status",
        "target": "api",
        "queue": "default",
        "task_type": "scan",
        "runtime": "desktop_web",
        "engine": "gapless",
        "origin": "local",
        "requested_policy": "original",
        "effective_policy": "original",
        "scope": "context",
        "preset": "balanced",
    }
    rows = []
    for i, name in enumerate(names):
        definition = get_metric_definition(name)
        for variant in range(3 if i < 20 else 2):
            tags = {}
            for key, allowed in definition.labels:
                candidates = sorted(allowed - {"other"})
                if key == "service":
                    tags[key] = ["api", "worker", "readplane"][variant]
                elif candidates:
                    tags[key] = (
                        defaults.get(key)
                        if defaults.get(key) in allowed
                        else candidates[0]
                    )
            s = canonical_metric(name, tags)
            value = (
                (0.03 + variant * 0.005)
                if definition.unit == "seconds"
                else (100000 + variant)
                if definition.unit == "bytes"
                else 0.5
                if definition.unit == "ratio"
                else 1
                if definition.kind == "counter"
                else 2 + variant
            )
            rows.append(
                {
                    "series_id": s.series_id,
                    "name": name,
                    "tags_json": s.tags_json,
                    "value": value,
                }
            )
    assert len(rows) == 100
    return rows


def seed(config, source):
    runtime(source, config)
    from crate import metrics
    from crate.db.schema_sections.metric_minutes_v141 import (
        create_metric_minute_snapshots_v141_schema,
    )
    from crate.observability.metric_catalog import canonical_metric
    from psycopg2.extras import execute_values

    started = time.perf_counter()
    c = conn(config)
    c.autocommit = True
    cur = c.cursor()
    create_metric_minute_snapshots_v141_schema(cur)
    cur.execute(
        "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY,value TEXT NOT NULL)"
    )
    cur.execute(
        "CREATE TABLE bench_series (series_id TEXT PRIMARY KEY,name TEXT,tags_json JSONB,value DOUBLE PRECISION)"
    )
    rows = choose_series()
    execute_values(
        cur,
        "INSERT INTO bench_series VALUES %s",
        [(r["series_id"], r["name"], r["tags_json"], r["value"]) for r in rows],
    )
    reference = os.environ.get("CRATE_BENCH_REFERENCE_UTC")
    seed_now = datetime.fromisoformat(reference) if reference else datetime.now(UTC)
    seed_end = seed_now.replace(second=0, microsecond=0) - timedelta(minutes=1)
    seed_start = seed_end - timedelta(minutes=11519)
    emit("seed_pg_start", rows=11520 * 100, start=seed_start, end=seed_end)
    cur.execute(
        """INSERT INTO metric_minute_snapshots (series_id,name,tags_json,bucket_start,source_id,revision,count,sum_value,min_value,max_value,last_value,last_observed_at,source_gap)
 SELECT s.series_id,s.name,s.tags_json,%s::timestamptz+n*INTERVAL '1 minute',repeat('b',73),20,20,20*s.value,s.value,s.value,s.value,%s::timestamptz+n*INTERVAL '1 minute'+INTERVAL '30 seconds',false
 FROM generate_series(0,11519) n CROSS JOIN bench_series s""",
        (seed_start, seed_start),
    )
    cur.execute(
        "INSERT INTO settings VALUES ('metrics_v2_cutover_at',%s)",
        (seed_start.isoformat(),),
    )
    cur.execute("ANALYZE metric_minute_snapshots")
    emit("seed_pg_done", seconds=round(time.perf_counter() - started, 2))
    r = redis_client(config)
    r.flushdb()
    r.config_set("maxmemory", "220mb")
    r.config_set("maxmemory-policy", "noeviction")
    now_min = int(seed_now.timestamp()) // 60 * 60

    def mapping(row, minute):
        v = row["value"]
        return {
            "name": row["name"],
            "tags": row["tags_json"],
            "minute": minute,
            "source_id": "b" * 73,
            "revision": 20,
            "count": 20,
            "sum": 20 * v,
            "min": v,
            "max": v,
            "last": v,
            "last_at": minute + 30,
        }

    count = 0
    pipe = r.pipeline(transaction=False)

    def queue_row(row, minute):
        nonlocal count, pipe
        key = f"{metrics._REDIS_PREFIX}:bucket:{row['series_id']}:{minute}"
        pipe.hset(key, mapping=mapping(row, minute))
        pipe.expire(key, 86400)
        pipe.zadd(f"{metrics._REDIS_PREFIX}:buckets:{row['name']}", {key: minute})
        pipe.zadd(
            f"{metrics._REDIS_PREFIX}:series:{row['name']}", {row["series_id"]: minute}
        )
        count += 1
        if count % 500 == 0:
            pipe.execute()
            pipe = r.pipeline(transaction=False)

    for row in rows:
        for offset in range(1, 61):
            queue_row(row, now_min - offset * 60)
    pipe.execute()
    emit("seed_redis_recent", hashes=count, used_memory=r.info("memory")["used_memory"])
    dense = []
    for i in range(40):
        s = canonical_metric(
            "api.request.latency",
            {
                "service": "api",
                "target": "api",
                "method": "GET",
                "path": "/api/status"
                if i == 0
                else "/api/paths"
                if i == 1
                else "/api/radio/next"
                if i == 2
                else "/api/artists/{id}"
                if i == 3
                else "/api/catalog/search",
                "status": str(200 + (i % 5) * 100) if i < 5 else "200",
            },
        )
        # Distinct closed combinations: service16 * method9, no free labels.
        services = sorted(dict(s.definition.labels)["service"] - {"other"})
        methods = sorted(dict(s.definition.labels)["method"] - {"other"})
        s = canonical_metric(
            "api.request.latency",
            {
                "service": services[i // len(methods)],
                "method": methods[i % len(methods)],
                "path": "/api/status",
                "status": "200",
            },
        )
        dense.append(
            {
                "series_id": s.series_id,
                "name": s.definition.name,
                "tags_json": s.tags_json,
                "value": 0.05,
            }
        )
    assert len({x["series_id"] for x in dense}) == 40
    pipe = r.pipeline(transaction=False)
    for row in dense:
        for offset in range(1, 1441):
            queue_row(row, now_min - offset * 60)
    pipe.execute()
    emit(
        "seed_redis_dense",
        hashes_written=count,
        used_memory=r.info("memory")["used_memory"],
    )
    route_names = sorted(
        p
        for p in dict(canonical_metric("api.route.latency").definition.labels)["route"]
        if p.startswith("/api/")
    )[:40]
    pipe = r.pipeline(transaction=False)
    for path in route_names:
        rid = metrics._route_id("api", "GET", path)
        for offset in range(1, 61):
            minute = now_min - offset * 60
            key = metrics._route_metric_key(rid, minute)
            pipe.sadd(metrics._route_bucket_key(minute), rid)
            pipe.hset(
                key,
                mapping={
                    "route_id": rid,
                    "target": "api",
                    "method": "GET",
                    "path": path,
                    "count": 20,
                    "sum": 1000,
                    "min": 50,
                    "max": 50,
                    "status_2xx": 20,
                },
            )
            pipe.rpush(key + ":samples", *([50] * 20))
        pipe.execute()
        pipe = r.pipeline(transaction=False)
    pgstats = database_stats(config)
    fixture = {
        "active_series": 100,
        "families": 40,
        "minutes": 11520,
        "pg_rows": 1152000,
        "seed_start": seed_start.isoformat(),
        "seed_end": seed_end.isoformat(),
        "redis_now_minute": now_min,
        "redis_recent_minutes": 60,
        "redis_dense_family": "api.request.latency",
        "redis_dense_family_series": 40,
        "redis_dense_minutes": 1440,
        "redis_route_series": len(route_names),
        "redis_route_minutes": 60,
        "redis_samples_per_route_minute": 20,
        "series": rows,
        "pg": pgstats,
        "redis": redis_info(r),
        "seed_seconds": time.perf_counter() - started,
        "caveats": [
            "Redis fixture uses60min for normal families plus40series/24h dense latency; normal24h completeness differs from PG eight-day fixture. No library/task/system workload is seeded. Cold dashboard measures metrics branch only with constant auxiliaries."
        ],
    }
    (ROOT / "fixture.json").write_text(json.dumps(fixture, indent=2))
    cur.close()
    c.close()
    emit(
        "seed_complete",
        seconds=round(fixture["seed_seconds"], 2),
        pg=pgstats,
        redis=fixture["redis"],
    )
    return fixture


def database_stats(config):
    with conn(config) as c, c.cursor() as q:
        q.execute(
            "SELECT pg_relation_size('metric_minute_snapshots'),pg_indexes_size('metric_minute_snapshots'),pg_total_relation_size('metric_minute_snapshots'),(SELECT count(*) FROM metric_minute_snapshots)"
        )
        table, index, total, count = q.fetchone()
        return {
            "table_bytes": table,
            "index_bytes": index,
            "total_bytes": total,
            "rows": count,
        }


def redis_info(r):
    m = r.info("memory")
    s = r.info("stats")
    return {
        "used_memory": m["used_memory"],
        "used_memory_peak": m["used_memory_peak"],
        "total_commands_processed": s["total_commands_processed"],
        "keys": r.dbsize(),
    }


def percentiles(values):
    values = sorted(values)
    return {
        k: round(
            values[min(len(values) - 1, max(0, math.ceil(len(values) * p) - 1))], 3
        )
        for k, p in [
            ("p50_ms", 0.50),
            ("p95_ms", 0.95),
            ("p99_ms", 0.99),
            ("max_ms", 1),
        ]
    }


def run_case(name, fn, reps=100, warm=10, concurrency=10):
    for _ in range(warm):
        fn()
    times = []
    sizes = []
    errors = []
    empty = []
    lengths = []
    statuses = []
    graphs = []

    def one(i):
        t = time.perf_counter()
        try:
            payload = fn()
            ms = (time.perf_counter() - t) * 1000
            size = len(json.dumps(payload, default=str, separators=(",", ":")).encode())
            if isinstance(payload, dict) and "timeseries" in payload:
                lengths.append({k: len(v) for k, v in payload["timeseries"].items()})
                empty.extend(k for k, v in payload["timeseries"].items() if not v)
                statuses.append(
                    {
                        "timeseries_status": payload.get("timeseries_status"),
                        "route_latency_status": payload.get("route_latency_status"),
                    }
                )
                graphs.append(
                    {
                        "json_bytes": len(
                            json.dumps(
                                payload["timeseries"],
                                default=str,
                                separators=(",", ":"),
                            ).encode()
                        ),
                        "total_points": sum(
                            len(v) for v in payload["timeseries"].values()
                        ),
                        "observations_by_family": {
                            k: sum(int(row.get("count", 0)) for row in v)
                            for k, v in payload["timeseries"].items()
                        },
                    }
                )
            return ms, size, None
        except Exception as e:  # noqa: BLE001 - record candidate failures in benchmark results
            return (
                (time.perf_counter() - t) * 1000,
                0,
                type(e).__name__ + ": " + str(e)[:220],
            )

    started = time.perf_counter()
    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as pool:
        for ms, size, error in pool.map(one, range(reps)):
            times.append(ms)
            sizes.append(size)
            if error:
                errors.append(error)
    result = {
        "name": name,
        "operations": reps,
        "warmups": warm,
        "concurrency": concurrency,
        "wall_seconds": round(time.perf_counter() - started, 3),
        **percentiles(times),
        "response_bytes": {
            "min": min(sizes),
            "max": max(sizes),
            "mean": round(sum(sizes) / len(sizes), 1),
        },
        "errors": errors,
        "error_count": len(errors),
        "empty_timeseries_occurrences": {key: empty.count(key) for key in set(empty)},
        "first_timeseries_lengths": lengths[0] if lengths else None,
        "first_statuses": statuses[0] if statuses else None,
        "first_graphs": graphs[0] if graphs else None,
    }
    emit(
        "case_done",
        name=name,
        p95_ms=result["p95_ms"],
        max_ms=result["max_ms"],
        errors=len(errors),
        empty=result["empty_timeseries_occurrences"],
    )
    return result


def measure(label, source, config):
    runtime(source, config)
    from crate.api import admin_metrics as admin
    from crate.db import cache_store
    from crate.db.engine import get_engine
    from crate.db.queries.metric_minutes import query_metric_minute_snapshots
    from sqlalchemy import event

    fixture = json.loads((ROOT / "fixture.json").read_text())
    end = datetime.fromisoformat(fixture["seed_end"]) + timedelta(minutes=1)
    from types import SimpleNamespace

    from crate import metrics as clocked_metrics

    fixed_now = fixture["redis_now_minute"] + 30
    clocked_metrics.time = SimpleNamespace(
        time=lambda: fixed_now, monotonic=time.monotonic
    )
    clocked_metrics._minute_bucket = lambda ts=None: (
        int(fixed_now if ts is None else ts) // 60 * 60
    )
    from crate.db.queries import metric_minutes as clocked_queries

    clocked_queries._now = lambda: datetime.fromtimestamp(fixed_now, tz=UTC)
    admin.datetime = SimpleNamespace(
        now=lambda tz=None: datetime.fromtimestamp(fixed_now, tz=tz)
    )
    captures = {}
    capture_key = {"value": None}

    def capture(connection, cursor, statement, parameters, context, executemany):
        if (
            capture_key["value"]
            and "FROM metric_minute_snapshots" in statement
            and statement.lstrip().upper().startswith(("SELECT", "WITH"))
        ):
            captures[capture_key["value"]] = (statement, parameters)

    event.listen(get_engine(), "before_cursor_execute", capture)
    results = []
    explains = {}
    r = redis_client(config)
    before = redis_info(r)
    parser_connection = r.connection_pool.get_connection()
    parser_class = (
        type(parser_connection._parser).__module__
        + "."
        + type(parser_connection._parser).__name__
    )
    r.connection_pool.release(parser_connection)
    source_before = hashlib.sha256(
        b"".join(p.read_bytes() for p in sorted((Path(source) / "crate").rglob("*.py")))
    ).hexdigest()
    for window, minutes, period in [
        ("15m", 15, "minute"),
        ("1h", 60, "minute"),
        ("24h", 1440, "hour"),
        ("7d", 10080, "hour"),
    ]:
        start = end - timedelta(minutes=minutes)
        capture_key["value"] = window
        query_metric_minute_snapshots(
            "api.request.latency", period=period, start=start, end=end, limit=12000
        )
        capture_key["value"] = None
        statement, params = captures[window]
        with conn(config) as c, c.cursor() as q:
            q.execute("EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) " + statement, params)
            explains[window] = q.fetchone()[0]
        results.append(
            run_case(
                "pg_" + window,
                lambda start=start, period=period: query_metric_minute_snapshots(
                    "api.request.latency",
                    period=period,
                    start=start,
                    end=end,
                    limit=12000,
                ),
            )
        )
    admin._build_metrics_system = dict
    admin._list_running_tasks = lambda limit=10: []
    admin._build_playback_delivery = dict
    cache_store.get_cache = lambda *a, **kw: None
    cache_store.set_cache = lambda *a, **kw: None
    for minutes in [60, 1440]:
        period = "minute" if minutes == 60 else "hour"
        results.append(
            run_case(
                f"dashboard_cold_{minutes}m",
                lambda period=period, minutes=minutes: admin._build_metrics_dashboard(
                    period, minutes
                ),
            )
        )
        cached = admin._build_metrics_dashboard(period, minutes)
        cache_store.get_cache = lambda *a, cached=cached, **kw: cached
        results.append(
            run_case(
                f"dashboard_cached_{minutes}m",
                lambda period=period, minutes=minutes: admin._build_metrics_dashboard(
                    period, minutes
                ),
            )
        )
        cache_store.get_cache = lambda *a, **kw: None
    after = redis_info(r)
    payload = {
        "label": label,
        "source_path": source,
        "fixture": {k: v for k, v in fixture.items() if k != "series"},
        "cases": results,
        "explain": explains,
        "redis_before": before,
        "redis_after": after,
        "redis_command_delta": after["total_commands_processed"]
        - before["total_commands_processed"],
        "pg": database_stats(config),
        "budgets_local_not_production_slo": {
            "pg_individual_p95_ms": 250,
            "dashboard_metrics_cold_p95_ms": 500,
        },
        "host_load": os.getloadavg(),
        "redis_parser_class": parser_class,
        "source_fingerprint_before": source_before,
        "reference_clock_utc": datetime.fromtimestamp(fixed_now, tz=UTC).isoformat(),
        "clock_controls": [
            "metrics.time.time",
            "metrics._minute_bucket",
            "metric_minutes._now",
            "admin_metrics.datetime.now",
        ],
        "timing_scope": "Python function elapsed; response size serialized outside timer; no ASGI/network; constant system/tasks/playbackDelivery helpers",
        "source_fingerprint": hashlib.sha256(
            b"".join(
                p.read_bytes() for p in sorted((Path(source) / "crate").rglob("*.py"))
            )
        ).hexdigest(),
    }
    path = ROOT / (label + ".json")
    path.write_text(json.dumps(payload, indent=2, default=str))
    emit("measurement_complete", label=label, path=str(path))
    get_engine().dispose()


def orchestrate():
    import shutil

    import docker

    baseline_source = ROOT / "baseline"
    shutil.copytree(
        SOURCE / "crate",
        baseline_source / "crate",
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
    )
    client = docker.from_env()
    assert client.api.base_url.startswith("http+docker://localhost"), (
        "Local unix Docker only"
    )
    containers = []
    config = {}

    def cleanup(*_):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, cleanup)
    try:
        token = ROOT.name.rsplit("-", 1)[-1]
        pg = client.containers.run(
            "pgvector/pgvector:pg15",
            name="crate-test-obsvbench-pg-" + token,
            environment={
                "POSTGRES_DB": "obsvbench",
                "POSTGRES_USER": "obsvbench",
                "POSTGRES_PASSWORD": "obsvbench",
            },
            command=[
                "postgres",
                "-c",
                "shared_buffers=128MB",
                "-c",
                "work_mem=8MB",
                "-c",
                "max_parallel_workers_per_gather=0",
                "-c",
                "max_connections=30",
            ],
            detach=True,
            ports={"5432/tcp": ("127.0.0.1", None)},
            mem_limit="768m",
            nano_cpus=4_000_000_000,
            labels={"crate.test": "obsvbench", "crate.obsvbench": token},
        )
        containers.append(pg)
        rd = client.containers.run(
            "redis:7-alpine",
            name="crate-test-obsvbench-redis-" + token,
            command=["redis-server", "--save", "", "--appendonly", "no"],
            detach=True,
            ports={"6379/tcp": ("127.0.0.1", None)},
            mem_limit="256m",
            nano_cpus=1_000_000_000,
            labels={"crate.test": "obsvbench", "crate.obsvbench": token},
        )
        containers.append(rd)
        pg.reload()
        rd.reload()
        config = {
            "pg_port": int(
                pg.attrs["NetworkSettings"]["Ports"]["5432/tcp"][0]["HostPort"]
            ),
            "redis_port": int(
                rd.attrs["NetworkSettings"]["Ports"]["6379/tcp"][0]["HostPort"]
            ),
            "pg_container": pg.id,
            "redis_container": rd.id,
            "limits": {
                "pg_memory_mib": 768,
                "pg_cpus": 4,
                "redis_memory_mib": 256,
                "redis_cpus": 1,
            },
            "baseline_source": str(ROOT / "baseline"),
        }
        (ROOT / "runtime.json").write_text(json.dumps(config, indent=2))
        emit("containers_started", **config)
        deadline = time.monotonic() + 40
        while True:
            try:
                c = conn(config)
                c.close()
                assert redis_client(config).ping()
                break
            except Exception:
                if time.monotonic() > deadline:
                    raise
                time.sleep(0.25)
        subprocess.run(
            [VENV, __file__, "seed", str(ROOT / "baseline")],
            check=True,
            env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
        )
        subprocess.run(
            [VENV, __file__, "measure", "baseline", str(ROOT / "baseline")],
            check=True,
            env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
        )
        stats = {c.name: c.stats(stream=False) for c in containers}
        (ROOT / "docker-baseline-stats.json").write_text(json.dumps(stats, indent=2))
        emit(
            "BASELINE_READY",
            root=str(ROOT),
            next="Send after <PYTHONPATH source>, or stop. Containers retained only for identical AFTER fixture.",
        )
        for line in sys.stdin:
            args = line.strip().split(maxsplit=1)
            if not args:
                continue
            if args[0] == "after" and len(args) == 2:
                subprocess.run(
                    [VENV, __file__, "measure", "after", args[1]],
                    check=True,
                    env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
                )
                stats = {c.name: c.stats(stream=False) for c in containers}
                (ROOT / "docker-after-stats.json").write_text(
                    json.dumps(stats, indent=2)
                )
                emit("AFTER_READY", root=str(ROOT))
                break
            if args[0] == "stop":
                break
    finally:
        for c in reversed(containers):
            try:
                c.remove(force=True, v=True)
            except docker.errors.DockerException as e:
                emit("cleanup_error", container=c.name, error=type(e).__name__)
        client.close()
        emit("CLEANED_UP")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Isolated PR1A metrics benchmark; local disposable Docker only."
    )
    parser.add_argument(
        "action", nargs="?", choices=("session", "seed", "measure"), default="session"
    )
    parser.add_argument("arguments", nargs="*")
    options = parser.parse_args()
    if options.action == "session":
        orchestrate()
    else:
        config = json.loads((ROOT / "runtime.json").read_text())
        if options.action == "seed":
            seed(config, options.arguments[0] if options.arguments else str(SOURCE))
        elif options.action == "measure":
            if not options.arguments:
                parser.error(
                    "measure requires a result label and optional source directory"
                )
            measure(
                options.arguments[0],
                options.arguments[1] if len(options.arguments) > 1 else str(SOURCE),
                config,
            )

from __future__ import annotations
import hashlib
import json
import os
import platform
import statistics
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
import docker
import redis
from crate.observability import metric_buckets as mb
from crate.observability.metric_catalog import canonical_metric
from crate.observability.http_metric_routes import HTTP_ROUTES

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parent
OUT.mkdir(parents=True, exist_ok=True)
source = (ROOT / "app/crate/observability/metric_buckets.py").read_text()
IMAGE = os.environ.get("CRATE_METRIC_BUFFER_REDIS_IMAGE", "redis:7-alpine")
scripts = {name: getattr(mb, name) for name in ("_RECORD", "_RECORD_ROUTE", "_ACK")}
P = "crate:metrics:v2"
ALL, DIRTY, QUAR, LOSS, NAMES, ROUTES = (
    f"{P}:{x}"
    for x in ("buffer", "dirty", "quarantine", "loss", "names", "route-buffer")
)
TRIM = mb.TRIM_KEY
ROUTE_TRIM = mb.ROUTE_TRIM_KEY
result = {
    "measured_at_utc": datetime.now(timezone.utc).isoformat(),
    "scope": "Local disposable Redis memory/limit smoke. Not HTTP latency, steady-state throughput, shared-cache capacity or production SLO evidence.",
    "source_file_sha256": hashlib.sha256(source.encode()).hexdigest(),
    "lua_sha256": {
        name: hashlib.sha256(value.encode()).hexdigest()
        for name, value in scripts.items()
    },
    "limits": {
        "maxmemory_bytes": 512 * 1024 * 1024,
        "policy": "volatile-lru",
        "container_memory_bytes": 768 * 1024 * 1024,
        "container_cpus": 2,
        "live_ttl_seconds": 7200,
        "generic_buckets": 24000,
        "route_buckets": 2000,
        "samples_per_route": 1000,
    },
    "cleanup": False,
    "python_version": sys.version.split()[0],
    "platform": platform.platform(),
    "architecture": platform.machine(),
    "harness_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    "source_sha256": {
        name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
        for name in (
            "app/crate/metrics.py",
            "app/crate/observability/metric_buckets.py",
            "app/crate/observability/metric_catalog.py",
            "app/crate/observability/metric_catalog_data.py",
            "app/crate/observability/http_metric_routes.py",
        )
    },
}
client = docker.from_env()
container = connection = None
start = time.monotonic()
try:
    endpoint = client.api.base_url
    if not (endpoint == "http+docker://localhost" or endpoint.startswith("unix://")):
        raise RuntimeError(f"Refusing nonlocal Docker endpoint: {endpoint}")
    container = client.containers.run(
        IMAGE,
        command=[
            "redis-server",
            "--maxmemory",
            "512mb",
            "--maxmemory-policy",
            "volatile-lru",
        ],
        detach=True,
        ports={"6379/tcp": ("127.0.0.1", None)},
        mem_limit="768m",
        nano_cpus=2_000_000_000,
        labels={"crate.test": "metric-review-buffer-bounds"},
    )
    container.reload()
    port = int(container.attrs["NetworkSettings"]["Ports"]["6379/tcp"][0]["HostPort"])
    connection = redis.Redis(
        host="127.0.0.1", port=port, decode_responses=True, socket_timeout=15
    )
    for attempt in range(100):
        try:
            if connection.ping():
                break
        except redis.ConnectionError:
            time.sleep(0.05)
    else:
        raise RuntimeError("Disposable Redis failed readiness")
    info = connection.info()
    result["redis_version"] = info["redis_version"]
    result["image_id"] = container.image.id
    result["image_reference"] = IMAGE
    result["image_digests"] = container.image.attrs.get("RepoDigests", [])
    result["rdb_save_schedule"] = connection.config_get("save")["save"]
    result["appendonly"] = connection.config_get("appendonly")["appendonly"]
    result["script_transport"] = "SCRIPT LOAD then pipelined EVALSHA, batches of500"
    shas = {name: connection.script_load(script) for name, script in scripts.items()}

    def snapshot(label):
        info = connection.info()
        entry = {
            key: info[key]
            for key in (
                "used_memory",
                "used_memory_peak",
                "used_memory_rss",
                "used_memory_dataset",
                "maxmemory",
                "maxmemory_policy",
                "evicted_keys",
                "expired_keys",
                "latest_fork_usec",
                "rdb_bgsave_in_progress",
                "rdb_last_bgsave_status",
                "rdb_last_bgsave_time_sec",
                "rdb_last_cow_size",
            )
            if key in info
        }
        entry.update(
            {
                "key_count": connection.dbsize(),
                "generic_index": connection.zcard(ALL),
                "dirty_index": connection.zcard(DIRTY),
                "quarantine_index": connection.zcard(QUAR),
                "route_index": connection.zcard(ROUTES),
                "loss_counters": connection.hgetall(LOSS),
            }
        )
        result.setdefault("snapshots", {})[label] = entry

    snapshot("baseline")
    now = int(time.time()) // 60 * 60
    series = {}
    for path in sorted(HTTP_ROUTES):
        item = canonical_metric(
            "api.request.count",
            {"method": "GET", "path": path, "status": "200", "target": "api"},
        )
        series[item.series_id] = item
        if len(series) == 500:
            break
    if len(series) != 500:
        raise RuntimeError(f"Expected500 canonical unique series, got{len(series)}")
    accepted = rejected = cardinality = 0
    phase = time.monotonic()
    pipe = connection.pipeline(transaction=False)
    for offset in range(120):
        minute = now - (119 - offset) * 60
        for item in series.values():
            key = f"{P}:bucket:{item.series_id}:{minute}"
            keys = [
                key,
                f"{P}:series:{item.definition.name}",
                f"{P}:buckets:{item.definition.name}",
                DIRTY,
                NAMES,
                ALL,
                QUAR,
                LOSS,
                TRIM,
            ]
            args = [
                "1.0",
                minute,
                minute + 30,
                7200,
                item.definition.max_series,
                item.series_id,
                item.definition.name,
                item.tags_json,
                uuid.uuid4().hex,
                24000,
                P,
            ]
            pipe.evalsha(shas["_RECORD"], len(keys), *keys, *args)
        batch = pipe.execute()
        accepted += sum(value == 1 for value in batch)
        rejected += sum(value == -1 for value in batch)
        cardinality += sum(value == 0 for value in batch)
        if time.monotonic() - start > 120:
            raise RuntimeError("Preparation budget exceeded")
    result["generic_load"] = {
        "canonical_series": 500,
        "minute_slots": 120,
        "attempts": 60000,
        "accepted": accepted,
        "capacity_rejected": rejected,
        "cardinality_rejected": cardinality,
        "duration_seconds": round(time.monotonic() - phase, 3),
        "ordering": "Chronological from now-119min through now, all500series perminute; no flusher/ACK removes dirty entries.",
    }
    assert accepted == 24000 and rejected == 36000 and cardinality == 0
    assert connection.zcard(ALL) == 24000 and connection.zcard(DIRTY) == 24000
    sample_keys = connection.zrange(ALL, 0, 49)
    sizes = [connection.memory_usage(key, samples=0) for key in sample_keys]
    result["generic_memory_samples"] = {
        "count": len(sizes),
        "min": min(sizes),
        "mean": statistics.mean(sizes),
        "max": max(sizes),
        "all_index_bytes": connection.memory_usage(ALL, samples=0),
        "dirty_index_bytes": connection.memory_usage(DIRTY, samples=0),
        "family_bucket_index_bytes": connection.memory_usage(
            f"{P}:buckets:api.request.count", samples=0
        ),
        "family_series_index_bytes": connection.memory_usage(
            f"{P}:series:api.request.count", samples=0
        ),
    }
    snapshot("generic_24000_limit")
    phase = time.monotonic()
    route_keys = []
    route_series = list(series.values())
    pipe = connection.pipeline(transaction=False)
    for number in range(2000):
        item = route_series[number % 500]
        tags = dict(item.tags)
        path = tags.get("route", "other")
        method = ("GET", "POST", "PUT", "DELETE")[number // 500]
        route_id = hashlib.sha1(f"api\0{method}\0{path}".encode()).hexdigest()[:16]
        minute = now
        key = f"{P}:route:{route_id}:{minute}"
        route_keys.append(key)
        keys = [key, f"{P}:routes:{minute}", ROUTES, LOSS, ROUTE_TRIM]
        args = [
            123.456,
            minute,
            minute + 30,
            7200,
            2000,
            route_id,
            "api",
            method,
            path,
            "2xx",
            "123.456",
            1000,
            P,
        ]
        pipe.evalsha(shas["_RECORD_ROUTE"], len(keys), *keys, *args)
        if (number + 1) % 500 == 0:
            assert all(value == 1 for value in pipe.execute())
    assert connection.zcard(ROUTES) == 2000
    overflow_path = dict(route_series[0].tags).get("route", "other")
    overflow_id = hashlib.sha1(f"api\0PATCH\0{overflow_path}".encode()).hexdigest()[:16]
    overflow_keys = [
        f"{P}:route:{overflow_id}:{now}",
        f"{P}:routes:{now}",
        ROUTES,
        LOSS,
        ROUTE_TRIM,
    ]
    rejected_route = connection.evalsha(
        shas["_RECORD_ROUTE"],
        len(overflow_keys),
        *overflow_keys,
        123.456,
        now,
        now + 30,
        7200,
        2000,
        overflow_id,
        "api",
        "PATCH",
        overflow_path,
        "2xx",
        "123.456",
        1000,
        P,
    )
    assert rejected_route == 0 and not connection.exists(overflow_keys[0])
    result["route_headers"] = {
        "actual_lua_created": 2000,
        "extra_bucket_rejected": True,
        "duration_seconds": round(time.monotonic() - phase, 3),
    }
    snapshot("generic_plus_route_headers")
    phase = time.monotonic()
    long_sample = "1.7976931348623157e+308"
    pipe = connection.pipeline(transaction=False)
    for number, key in enumerate(route_keys):
        pipe.rpush(key + ":samples", *([long_sample] * 999))
        if (number + 1) % 500 == 0:
            assert all(value == 1000 for value in pipe.execute())
    result["route_samples_memory_upperbound"] = {
        "bucket_count": 2000,
        "samples_per_bucket": 1000,
        "total_sample_slots": 2000000,
        "synthetic_sample": long_sample,
        "synthetic_sample_bytes": len(long_sample),
        "preexisting_first_sample": "123.456",
        "population": "Actual _RECORD_ROUTE creates headers plus first sample; direct batched RPUSH fills999 long finite-float strings. Synthetic memory upperbound only; header counts/sums do not model2million production observations.",
        "duration_seconds": round(time.monotonic() - phase, 3),
    }
    sample_sizes = [
        connection.memory_usage(key + ":samples", samples=0) for key in route_keys[:50]
    ]
    result["route_samples_memory_upperbound"]["sample_list_memory_bytes"] = {
        "min": min(sample_sizes),
        "mean": statistics.mean(sample_sizes),
        "max": max(sample_sizes),
    }
    snapshot("combined_synthetic_upperbound")
    assert connection.info()["evicted_keys"] == 0
    bgsave_started = time.monotonic()
    while connection.info("persistence")["rdb_bgsave_in_progress"]:
        if time.monotonic() - bgsave_started > 30:
            raise RuntimeError("Prior BGSAVE exceeded30s budget")
        time.sleep(0.05)
    before_saved = connection.lastsave().isoformat()
    reply = connection.bgsave()
    while connection.info("persistence")["rdb_bgsave_in_progress"]:
        if time.monotonic() - bgsave_started > 30:
            raise RuntimeError("BGSAVE exceeded30s budget")
        time.sleep(0.05)
    result["bgsave"] = {
        "accepted": bool(reply),
        "elapsed_seconds": round(time.monotonic() - bgsave_started, 3),
        "lastsave_before": before_saved,
        "lastsave_after": connection.lastsave().isoformat(),
        "status": connection.info("persistence")["rdb_last_bgsave_status"],
    }
    snapshot("after_bgsave")
    stats = container.stats(stream=False)
    result["container_observed"] = {
        "memory_usage_bytes": stats.get("memory_stats", {}).get("usage"),
        "memory_limit_bytes": stats.get("memory_stats", {}).get("limit"),
        "cpu_usage_total_ns": stats.get("cpu_stats", {})
        .get("cpu_usage", {})
        .get("total_usage"),
    }
    phase = time.monotonic()
    connection.flushdb()
    run_id = connection.info("server")["run_id"]
    healthy_accepted = healthy_rejected = pending_peak = 0
    for offset in range(120):
        minute = now - (119 - offset) * 60
        pipe = connection.pipeline(transaction=False)
        for item in series.values():
            key = f"{P}:bucket:{item.series_id}:{minute}"
            keys = [
                key,
                f"{P}:series:{item.definition.name}",
                f"{P}:buckets:{item.definition.name}",
                DIRTY,
                NAMES,
                ALL,
                QUAR,
                LOSS,
                TRIM,
            ]
            args = [
                "1.0",
                minute,
                minute + 30,
                7200,
                item.definition.max_series,
                item.series_id,
                item.definition.name,
                item.tags_json,
                uuid.uuid4().hex,
                24000,
                P,
            ]
            pipe.evalsha(shas["_RECORD"], len(keys), *keys, *args)
        batch = pipe.execute()
        healthy_accepted += sum(value == 1 for value in batch)
        healthy_rejected += sum(value != 1 for value in batch)
        pending_peak = max(pending_peak, connection.zcard(DIRTY))
        assert connection.zcard(ALL) <= 24000
        if (offset + 1) % 5 == 0:
            while pending := mb.pending_snapshots(connection, 500):
                pipe = connection.pipeline(transaction=False)
                for key, row in pending:
                    pipe.evalsha(
                        shas["_ACK"],
                        3,
                        key,
                        DIRTY,
                        QUAR,
                        row["source_id"],
                        row["revision"],
                        run_id,
                    )
                pipe.execute()
        if time.monotonic() - start > 120:
            raise RuntimeError("Healthy churn preparation budget exceeded")
    from unittest.mock import patch
    from types import SimpleNamespace
    from crate import metrics

    with (
        patch("crate.db.cache_runtime.get_redis", return_value=connection),
        patch.object(metrics, "_minute_bucket", lambda ts=None: now),
        patch.object(
            metrics,
            "time",
            SimpleNamespace(time=lambda: now + 30, monotonic=time.monotonic),
        ),
    ):
        spanning = metrics.query_summary("api.request.count", 120)
        fresh = metrics.query_summary("api.request.count", 5)
        last = metrics.query_summary("api.request.count", 1)
    assert healthy_accepted == 60000 and healthy_rejected == 0
    assert pending_peak <= 2500 and connection.zcard(DIRTY) == 0
    assert (
        spanning["availability"] == "partial"
        and spanning["reason"] == "live_buffer_trimmed"
    )
    assert fresh["availability"] == "available" and fresh["count"] == 2500
    assert last["availability"] == "available" and last["count"] == 500
    assert connection.info()["evicted_keys"] == 0
    result["healthy_ack_churn"] = {
        "canonical_series": 500,
        "minute_slots": 120,
        "attempts": 60000,
        "accepted": healthy_accepted,
        "rejected": healthy_rejected,
        "ack_interval_minutes": 5,
        "pending_peak": pending_peak,
        "final_pending": connection.zcard(DIRTY),
        "final_buffer_buckets": connection.zcard(ALL),
        "trimmed_before_unix": connection.get(TRIM),
        "duration_seconds": round(time.monotonic() - phase, 3),
        "summary_120m": spanning,
        "summary_5m": fresh,
        "summary_1m": last,
        "ack_scope": "Models successful durable persistence with real pending_snapshots and actual ACK Lua after each5min; no PostgreSQL workload is executed or measured.",
    }
    snapshot("healthy_500_series_ack_churn")
    phase = time.monotonic()
    route_churn_accepted = route_churn_rejected = 0
    for offset in range(120):
        minute = now - (119 - offset) * 60
        pipe = connection.pipeline(transaction=False)
        for item in route_series:
            path = dict(item.tags).get("route", "other")
            route_id = hashlib.sha1(f"api\0GET\0{path}".encode()).hexdigest()[:16]
            key = f"{P}:route:{route_id}:{minute}"
            keys = [key, f"{P}:routes:{minute}", ROUTES, LOSS, ROUTE_TRIM]
            args = [
                123.456,
                minute,
                minute + 30,
                7200,
                2000,
                route_id,
                "api",
                "GET",
                path,
                "2xx",
                "123.456",
                1000,
                P,
            ]
            pipe.evalsha(shas["_RECORD_ROUTE"], len(keys), *keys, *args)
        batch = pipe.execute()
        route_churn_accepted += sum(value == 1 for value in batch)
        route_churn_rejected += sum(value != 1 for value in batch)
        assert connection.zcard(ROUTES) <= 2000
        if time.monotonic() - start > 120:
            raise RuntimeError("Route churn preparation budget exceeded")
    with (
        patch("crate.db.cache_runtime.get_redis", return_value=connection),
        patch.object(metrics, "_minute_bucket", lambda ts=None: now),
        patch.object(
            metrics,
            "time",
            SimpleNamespace(time=lambda: now + 30, monotonic=time.monotonic),
        ),
    ):
        routes_spanning = metrics.query_route_latency_snapshot(minutes=5, limit=100)
        routes_fresh = metrics.query_route_latency_snapshot(minutes=1, limit=100)
    assert route_churn_accepted == 60000 and route_churn_rejected == 0
    assert (
        routes_spanning["availability"] == "partial"
        and routes_spanning["reason"] == "live_route_buffer_trimmed"
    )
    assert (
        routes_spanning["observed_count"] == 2000
        and routes_spanning["sample_count"] == 2000
    )
    assert (
        routes_fresh["availability"] == "available"
        and routes_fresh["observed_count"] == 500
        and routes_fresh["sample_count"] == 500
    )
    assert connection.info()["evicted_keys"] == 0

    def route_meta(snapshot):
        return {key: value for key, value in snapshot.items() if key != "routes"} | {
            "returned_routes": len(snapshot["routes"])
        }

    result["healthy_route_churn"] = {
        "routes_per_minute": 500,
        "minute_slots": 120,
        "attempts": 60000,
        "accepted": route_churn_accepted,
        "rejected": route_churn_rejected,
        "final_route_buckets": connection.zcard(ROUTES),
        "trimmed_before_unix": connection.get(ROUTE_TRIM),
        "duration_seconds": round(time.monotonic() - phase, 3),
        "snapshot_5m": route_meta(routes_spanning),
        "snapshot_1m": route_meta(routes_fresh),
        "scope": "Actual rawroute Lua with1observed_sample perroute/minute; rotates older minutes without rejecting current writes. Canonical route metrics are not also recorded by this synthetic rawstorage fixture.",
    }
    snapshot("healthy_route_churn")
    result["total_elapsed_seconds"] = round(time.monotonic() - start, 3)
except BaseException as error:
    result["error"] = {"type": type(error).__name__, "message": str(error)}
    raise
finally:
    if connection is not None:
        connection.close()
    if container is not None:
        container.remove(force=True, v=True)
        result["cleanup"] = True
    client.close()
    (OUT / "results.json").write_text(
        json.dumps(result, indent=2, sort_keys=True) + "\n"
    )
    print(
        json.dumps(
            {
                "artifact": str(OUT / "results.json"),
                "cleanup": result["cleanup"],
                "error": result.get("error"),
                "snapshots": result.get("snapshots"),
                "total_elapsed_seconds": result.get("total_elapsed_seconds"),
            },
            indent=2,
        )
    )

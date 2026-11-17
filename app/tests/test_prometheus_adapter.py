import json
from datetime import datetime, timezone

import pytest


class _Response:
    def __init__(self, payload):
        self.payload = payload

    def read(self):
        return json.dumps(self.payload).encode()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _vector(*samples):
    return {
        "status": "success",
        "data": {
            "resultType": "vector",
            "result": [
                {"metric": labels, "value": [1730462400, str(value)]}
                for labels, value in samples
            ],
        },
    }


def _targets(*targets):
    return {"status": "success", "data": {"activeTargets": list(targets)}}


def _target(
    job, health="up", interval="30s", last="2026-11-17T12:57:28.418Z", **labels
):
    return {
        "labels": {"job": job, **labels},
        "health": health,
        "scrapeInterval": interval,
        "lastScrape": last,
    }


def _opener(responses, targets, seen=None):
    from crate.observability import prometheus_adapter

    def opener(url, timeout):
        if seen is not None:
            seen.append((url, timeout))
        if url.endswith("/api/v1/targets?state=active"):
            return _Response(targets)
        for key, query in prometheus_adapter.QUERIES.items():
            if url.endswith(prometheus_adapter.quote_query(query)):
                return _Response(responses.get(key, _vector()))
        raise AssertionError(url)

    return opener


def test_resources_combine_container_and_host_readings():
    from crate.observability import prometheus_adapter

    service = "container_label_com_docker_compose_service"
    responses = {
        "cpu": _vector(({service: "crate-api"}, 12.5), ({service: "crate-worker"}, 40)),
        "memory": _vector(({service: "crate-api"}, 524288000)),
        "host_cpu": _vector(({}, 31.2)),
        "host_used": _vector(({}, 23622320128)),
        "host_total": _vector(({}, 66571993088)),
        "ingress": _vector(
            ({"router": "crate-api@docker"}, 182.4),
            ({"router": "listen@file"}, 12),
            ({}, 3),
        ),
    }
    seen = []

    resources = prometheus_adapter.fetch_stack_resources(
        "http://crate-prometheus:9090/",
        opener=_opener(responses, _targets(), seen),
        now=lambda: 1730462405.0,
    )

    assert resources["services"]["crate-api"] == {
        "cpu_percent": 12.5,
        "memory_mib": 500.0,
    }
    assert resources["services"]["crate-worker"] == {
        "cpu_percent": 40.0,
        "memory_mib": None,
    }
    assert resources["host"] == {
        "cpu_percent": 31.2,
        "memory_used_gib": 22.0,
        "memory_total_gib": 62.0,
    }
    assert resources["ingress"] == {"crate-api": 182.4, "listen": 12.0}
    assert (
        resources["observed_at"]
        == datetime.fromtimestamp(1730462405.0, tz=timezone.utc).isoformat()
    )
    assert all(
        url.startswith("http://crate-prometheus:9090/api/v1/") for url, _ in seen
    )
    assert {timeout for _, timeout in seen} == {2.0}


def test_resources_raise_instead_of_returning_partial_zeros():
    from crate.observability import prometheus_adapter

    def opener(url, timeout):
        return _Response({"status": "error", "error": "bad query"})

    with pytest.raises(prometheus_adapter.PrometheusUnavailableError):
        prometheus_adapter.fetch_stack_resources("http://p:9090", opener=opener)


def test_rate_windows_hold_four_scrapes_of_their_job():
    import re
    from pathlib import Path

    import yaml

    from crate.observability.prometheus_adapter import QUERIES

    config = yaml.safe_load(
        (
            Path(__file__).resolve().parents[2] / "deploy/observability/prometheus.yml"
        ).read_text()
    )
    default = config["global"]["scrape_interval"]
    interval = {
        job["job_name"]: job.get("scrape_interval", default)
        for job in config["scrape_configs"]
    }
    source = {
        "container_cpu_usage_seconds_total": "cadvisor",
        "node_cpu_seconds_total": "node",
        "traefik_router_requests_total": "traefik",
        "pg_stat_database_xact_commit": "postgresql",
        "pg_stat_database_xact_rollback": "postgresql",
        "redis_commands_processed_total": "redis-cache",
    }

    def seconds(value):
        return int(value[:-1]) * {"s": 1, "m": 60}[value[-1]]

    windows = [
        (metric, window)
        for query in QUERIES.values()
        for metric, window in re.findall(r"rate\((\w+)[^\[]*\[(\w+)\]", query)
    ]
    assert {metric for metric, _ in windows} == set(source)
    for metric, window in windows:
        assert seconds(window) >= 4 * seconds(interval[source[metric]]), metric


def test_store_activity_names_the_store_each_rate_belongs_to():
    from crate.observability import prometheus_adapter

    resources = prometheus_adapter.fetch_stack_resources(
        "http://p:9090",
        opener=_opener(
            {
                "postgres": _vector(({}, 998.4)),
                "redis": _vector(
                    ({"job": "redis-cache"}, 8570.66),
                    ({"job": "redis-durable"}, 9472),
                    ({"job": "unknown"}, 5),
                ),
            },
            _targets(),
        ),
    )

    assert resources["stores"] == {
        "crate-postgres": 998.4,
        "crate-redis": 8570.7,
        "crate-redis-durable": 9472.0,
    }


def test_scrapes_name_each_target_by_its_stack_service():
    from crate.observability import prometheus_adapter

    resources = prometheus_adapter.fetch_stack_resources(
        "http://p:9090",
        opener=_opener(
            {},
            _targets(
                _target(
                    "crate-app",
                    interval="15s",
                    service="crate-api",
                    last="2026-11-17T12:57:33.533123456Z",
                ),
                _target("postgresql", interval="1m"),
                _target(
                    "traefik",
                    health="down",
                    interval="1m30s",
                    last="0001-01-01T00:00:00Z",
                ),
                _target("crate-app", interval="15s"),
                _target("someone-else"),
            ),
        ),
    )

    assert resources["scrapes"] == {
        "crate-api": {
            "health": "up",
            "interval_seconds": 15,
            "last_scrape": "2026-11-17T12:57:33.533Z",
        },
        "crate-postgres-exporter": {
            "health": "up",
            "interval_seconds": 60,
            "last_scrape": "2026-11-17T12:57:28.418Z",
        },
        "traefik": {"health": "down", "interval_seconds": 90, "last_scrape": None},
    }


def test_a_down_target_wins_over_an_up_one_for_the_same_service():
    from crate.observability import prometheus_adapter

    resources = prometheus_adapter.fetch_stack_resources(
        "http://p:9090",
        opener=_opener(
            {},
            _targets(
                _target("crate-app", health="down", service="crate-worker"),
                _target("crate-app", service="crate-worker"),
            ),
        ),
    )

    assert resources["scrapes"]["crate-worker"]["health"] == "down"


def test_unreadable_targets_raise_instead_of_hiding_the_dome():
    from crate.observability import prometheus_adapter

    with pytest.raises(prometheus_adapter.PrometheusUnavailableError):
        prometheus_adapter.fetch_stack_resources(
            "http://p:9090",
            opener=_opener({}, {"status": "error", "error": "unavailable"}),
        )


def test_every_scrape_job_maps_to_a_stack_service():
    from pathlib import Path

    import yaml

    from crate.observability.prometheus_adapter import APP_JOB, SCRAPE_JOBS

    config = yaml.safe_load(
        (
            Path(__file__).resolve().parents[2] / "deploy/observability/prometheus.yml"
        ).read_text()
    )
    jobs = {job["job_name"] for job in config["scrape_configs"]}
    assert jobs == set(SCRAPE_JOBS) | {APP_JOB}

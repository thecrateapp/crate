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

    def opener(url, timeout):
        seen.append((url, timeout))
        for key, query in prometheus_adapter.QUERIES.items():
            if url.endswith(prometheus_adapter.quote_query(query)):
                return _Response(responses[key])
        raise AssertionError(url)

    resources = prometheus_adapter.fetch_stack_resources(
        "http://crate-prometheus:9090/", opener=opener, now=lambda: 1730462405.0
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
        url.startswith("http://crate-prometheus:9090/api/v1/query?query=")
        for url, _ in seen
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

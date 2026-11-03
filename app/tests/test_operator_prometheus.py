"""Direct supervisor reads of allowlisted Prometheus recording rules."""

import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import parse_qs

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from deploy.operator import prometheus as prometheus_module
from deploy.operator.delivery import TransportError
from deploy.operator.prometheus import QUERIES, PrometheusReader
from deploy.operator.server import Poller, load_config
from deploy.operator.state import State
from deploy.operator.supervisor import Rule, Supervisor

ROOT = Path(__file__).resolve().parents[2]
BASE = 1800000000
URL = "http://crate-prometheus:9090"


def vector(value, at=BASE):
    return {
        "status": "success",
        "data": {
            "resultType": "vector",
            "result": [{"metric": {}, "value": [at, value]}],
        },
    }


EMPTY = {"status": "success", "data": {"resultType": "vector", "result": []}}


class FakePrometheus:
    def __init__(self, answers):
        self.answers = answers
        self.calls = []

    def __call__(self, url, *, payload=None, headers=None, timeout=5, query=None):
        expression = parse_qs(payload.decode())["query"][0]
        self.calls.append(
            {
                "url": url,
                "expression": expression,
                "timeout": timeout,
                "headers": headers,
            }
        )
        answer = self.answers.get(expression)
        if isinstance(answer, Exception):
            raise answer
        if answer is None:
            return 400, {"status": "error", "errorType": "bad_data"}
        return 200, answer


def reader(monkeypatch, answers):
    fake = FakePrometheus(answers)
    monkeypatch.setattr(prometheus_module, "request_json", fake)
    return PrometheusReader(URL), fake


def answers_for(query_id, value, observed=BASE, sample=None):
    query = QUERIES[query_id]
    result = {
        query.value_expression: vector(value, BASE + 1),
        query.observed_expression: vector(str(observed), BASE + 1),
    }
    if query.sample is not None:
        result[query.sample_expression] = vector(
            str(query.minimum if sample is None else sample), BASE + 1
        )
    return result


def test_reader_freshness_is_the_recorded_sample_not_the_query_time(monkeypatch):
    reader_, fake = reader(monkeypatch, answers_for("queue-depth-max", "12", BASE - 40))

    source = reader_.call("prometheus_query", {"query": "queue-depth-max"})

    assert source["availability"] == "available"
    assert source["data"] == {"value": 12.0}
    assert datetime.fromisoformat(source["observed_at"]).timestamp() == BASE - 40
    assert source["schema_version"] == "1"
    assert all(call["url"] == URL + "/api/v1/query" for call in fake.calls)
    assert all(0 < call["timeout"] <= 2 for call in fake.calls)


@pytest.mark.parametrize(
    ("change", "coverage"),
    [
        ({"value": EMPTY}, "no_data"),
        ({"observed": EMPTY}, "no_data"),
        ({"value": vector("NaN")}, "invalid_value"),
        ({"value": vector("+Inf")}, "invalid_value"),
        ({"value": None}, "query_rejected"),
        ({"sample": vector("3")}, "insufficient_sample"),
        ({"sample": EMPTY}, "insufficient_sample"),
    ],
)
def test_unusable_answers_are_unavailable_never_healthy(monkeypatch, change, coverage):
    query = QUERIES["api-error-ratio"]
    answers = answers_for("api-error-ratio", "0")
    keys = {
        "value": query.value_expression,
        "observed": query.observed_expression,
        "sample": query.sample_expression,
    }
    for name, answer in change.items():
        if answer is None:
            answers.pop(keys[name])
        else:
            answers[keys[name]] = answer
    reader_, _ = reader(monkeypatch, answers)

    source = reader_.call("prometheus_query", {"query": "api-error-ratio"})

    assert source["availability"] == "unavailable"
    assert source["coverage"] == coverage
    assert "value" not in source.get("data", {})


def test_more_than_one_series_is_ambiguous(monkeypatch):
    query = QUERIES["queue-depth-max"]
    answers = answers_for("queue-depth-max", "1")
    two = vector("1")
    two["data"]["result"].append({"metric": {"queue": "x"}, "value": [BASE, "2"]})
    answers[query.value_expression] = two
    reader_, _ = reader(monkeypatch, answers)

    source = reader_.call("prometheus_query", {"query": "queue-depth-max"})

    assert (source["availability"], source["coverage"]) == ("unavailable", "ambiguous")


def test_unknown_queries_and_tools_are_rejected_before_any_request(monkeypatch):
    reader_, fake = reader(monkeypatch, {})

    for name, arguments in (
        ("prometheus_query", {"query": "up"}),
        ("prometheus_query", {"query": "queue-depth-max", "extra": 1}),
        ("get_observability_summary", {}),
    ):
        with pytest.raises(ValueError):
            reader_.call(name, arguments)
    assert fake.calls == []


def test_prometheus_down_propagates_as_transport_failure(monkeypatch):
    query = QUERIES["queue-depth-max"]
    reader_, _ = reader(
        monkeypatch,
        {query.observed_expression: TransportError("transport_or_response_failure")},
    )

    with pytest.raises(TransportError):
        reader_.call("prometheus_query", {"query": "queue-depth-max"})


def test_allowlist_reads_only_recording_rules_with_bounded_expressions():
    assert 1 <= len(QUERIES) <= 16
    for query_id, query in QUERIES.items():
        assert query.aggregate in {"max", "min", "sum"}
        assert query.selector.startswith(("crate:", "up{"))
        assert len(query.value_expression) <= 200, query_id
        if query.sample is not None:
            assert query.sample.startswith("crate:")
            assert query.minimum > 0


def iso(now):
    return datetime.fromtimestamp(now, UTC).isoformat()


def prom_source(now, value, *, observed=None, availability="available"):
    return {
        "schema_version": "1",
        "source": "prometheus",
        "availability": availability,
        "observed_at": iso(observed if observed is not None else now),
        "coverage": "complete",
        "freshness": {"fresh_seconds": 120},
        "data": {"value": value} if availability == "available" else {},
    }


def prom_rule(**kwargs):
    return Rule(
        id="queue-depth",
        subsystem="queues",
        tool="prometheus_query",
        arguments={"query": "queue-depth-max"},
        source_path=(),
        kind="high",
        field=("value",),
        threshold=100,
        clear_threshold=50,
        notify_after_seconds=0,
        **kwargs,
    )


@pytest.fixture
def state(tmp_path):
    value = State(tmp_path)
    yield value
    value.close()


def observe(supervisor, now, sample):
    supervisor.observe({supervisor.rules[0].request_key: sample}, now)


def open_incident(supervisor, state):
    observe(supervisor, BASE, prom_source(BASE, 200))
    observe(supervisor, BASE + 30, prom_source(BASE + 30, 200))
    incident = state.snapshot()["incidents"]["lab/queues/queue-depth"]
    assert incident["state"] == "open"
    return incident


@pytest.mark.parametrize(
    "bad",
    [
        {},
        prom_source(BASE + 60, 0, availability="unavailable"),
        prom_source(BASE + 60, 0, observed=BASE - 900),
        prom_source(BASE + 60, 0, observed=BASE + 30),
    ],
    ids=["prometheus-down", "empty-or-no-denominator", "old-response", "duplicate"],
)
def test_supervisor_never_recovers_from_unusable_prometheus_samples(state, bad):
    supervisor = Supervisor(state, "lab", [prom_rule(recovery_samples=1)])
    open_incident(supervisor, state)

    observe(supervisor, BASE + 60, bad)
    observe(supervisor, BASE + 90, bad)

    assert state.snapshot()["incidents"]["lab/queues/queue-depth"]["state"] == "open"


def test_supervisor_recovers_from_fresh_recorded_samples(state):
    supervisor = Supervisor(state, "lab", [prom_rule()])
    open_incident(supervisor, state)

    observe(supervisor, BASE + 60, prom_source(BASE + 60, 10))
    observe(supervisor, BASE + 90, prom_source(BASE + 90, 10))

    assert (
        state.snapshot()["incidents"]["lab/queues/queue-depth"]["state"] == "resolved"
    )


def test_prometheus_rules_are_closed_and_disabled_rules_validate(state):
    with pytest.raises(ValueError):
        prom_rule().__class__(**{**prom_rule().__dict__, "arguments": {"query": "up"}})
    with pytest.raises(ValueError):
        prom_rule().__class__(**{**prom_rule().__dict__, "arguments": {}})
    assert Rule(**{**prom_rule().__dict__, "enabled": False}).enabled is False


class FakeMCP:
    def __init__(self):
        self.calls = []

    def call(self, name, arguments):
        self.calls.append(name)
        return {}


class FakeReader:
    def __init__(self, source=None, error=None):
        self.calls, self.source, self.error = [], source, error

    def call(self, name, arguments):
        self.calls.append(arguments)
        if self.error:
            raise self.error
        return self.source


class NoDelivery:
    def tick(self, now):
        pass


def test_poller_routes_prometheus_rules_and_isolates_failures(state):
    supervisor = Supervisor(state, "lab", [prom_rule(trigger_samples=1)])
    mcp = FakeMCP()
    prometheus = FakeReader(prom_source(BASE, 200))

    Poller(supervisor, mcp, NoDelivery(), prometheus=prometheus).tick(BASE)

    assert mcp.calls == []
    assert prometheus.calls == [{"query": "queue-depth-max"}]
    assert state.snapshot()["incidents"]["lab/queues/queue-depth"]["state"] == "open"

    Poller(
        supervisor, mcp, NoDelivery(), prometheus=FakeReader(error=TransportError("x"))
    ).tick(BASE + 30)
    Poller(supervisor, mcp, NoDelivery()).tick(BASE + 60)
    assert state.snapshot()["incidents"]["lab/queues/queue-depth"]["state"] == "open"


def config(tmp_path, rules, **extra):
    base = json.loads(
        (ROOT / "deploy/operator/config.operator.example.json").read_text()
    )
    base.pop("prometheus_url")
    path = tmp_path / "config.json"
    path.write_text(json.dumps({**base, "rules": rules, **extra}))
    return path


def test_config_requires_prometheus_url_only_for_enabled_prometheus_rules(tmp_path):
    rule = {
        "id": "queue-depth",
        "subsystem": "queues",
        "tool": "prometheus_query",
        "arguments": {"query": "queue-depth-max"},
        "source_path": [],
        "kind": "high",
        "field": ["value"],
        "threshold": 100,
        "clear_threshold": 50,
    }
    mcp = {
        "id": "worker-evidence",
        "subsystem": "import",
        "tool": "get_observability_summary",
        "source_path": ["data", "subsystems", "import", "sources", "worker"],
    }

    loaded = load_config(config(tmp_path, [mcp, {**rule, "enabled": False}]))
    assert [item.id for item in loaded["parsed_rules"]] == ["worker-evidence"]
    with pytest.raises(ValueError):
        load_config(config(tmp_path, [mcp, rule]))
    loaded = load_config(config(tmp_path, [mcp, rule], prometheus_url=URL))
    assert {item.tool for item in loaded["parsed_rules"]} == {
        "get_observability_summary",
        "prometheus_query",
    }


def test_example_ships_prometheus_rules_disabled_until_after_shadow():
    rules = json.loads(
        (ROOT / "deploy/operator/config.operator.example.json").read_text()
    )["rules"]
    prometheus = [rule for rule in rules if rule["tool"] == "prometheus_query"]

    assert prometheus
    assert all(rule.get("enabled") is False for rule in prometheus)
    assert {rule["arguments"]["query"] for rule in prometheus} <= set(QUERIES)
    groups = {rule["subsystem"] for rule in prometheus}
    assert {"observability", "queues", "availability", "playback"} <= groups
    for item in rules:
        Rule(**item)


def test_summary_rules_ship_disabled_and_read_the_mcp_summary_tools():
    rules = json.loads(
        (ROOT / "deploy/operator/config.operator.example.json").read_text()
    )["rules"]
    summary = [
        rule
        for rule in rules
        if rule["tool"] in {"get_stack_status", "get_playback_quality"}
    ]

    assert {rule["id"] for rule in summary} == {"monitoring-status", "summary-stalls"}
    assert all(rule["enabled"] is False for rule in summary)
    monitoring = Rule(**next(r for r in summary if r["id"] == "monitoring-status"))
    assert (monitoring.kind, monitoring.expected) == ("drift", "running")

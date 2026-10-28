"""Loopback API, fixed MCP protocol, and full deterministic polling cycle."""

import json
import sys
import threading
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from deploy.operator.delivery import Delivery, TransportError, request_json
from deploy.operator.server import (
    MCPReader,
    Poller,
    load_config,
    main,
    make_http_server,
    read_secret,
)
from deploy.operator.state import State
from deploy.operator.supervisor import Rule, Supervisor

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def setup(tmp_path):
    state = State(tmp_path / "state")
    rule = Rule(
        "down",
        "api",
        "get_observability_summary",
        ("data", "sources", "worker"),
        trigger_samples=1,
    )
    supervisor = Supervisor(state, "lab", [rule])
    yield state, supervisor
    state.close()


def test_read_watch_api_has_no_human_or_delivery_mutation_route(setup):
    state, supervisor = setup
    server = make_http_server(supervisor, "synthetic-read-api-token")
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{server.server_port}"
    headers = {
        "Authorization": "Bearer synthetic-read-api-token",
        "Content-Type": "application/json",
    }
    try:
        code, _ = request_json(url + "/v1/status")
        assert code == 401
        code, status = request_json(url + "/v1/status", headers=headers)
        assert code == 200 and status["state"] == "degraded"
        for path in ("/v1/ack", "/v1/silence", "/v1/human", "/v1/requeue", "/v1/apply"):
            code, _ = request_json(
                url + path, payload=b'{"human":true}', headers=headers
            )
            assert code == 404
        code, body = request_json(
            url + "/v1/watch-job",
            payload=b'{"job_id":"task-1","ttl":30}',
            headers=headers,
        )
        assert code == 200 and body["job_id"] == "task-1"
        code, _ = request_json(
            url + "/v1/watch-job",
            payload=b'{"job_id":"task-2","human":true}',
            headers=headers,
        )
        assert code == 400
        for path in ("/v1/events", "/v1/incidents"):
            code, body = request_json(url + path, headers=headers)
            assert code == 200
        assert len(state.snapshot()["watches"]) == 1
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def test_mcp_fixed_read_catalog_protocol_and_failure_redaction(monkeypatch):
    calls = []
    from deploy.operator import server

    def transport(url, **kwargs):
        calls.append((url, kwargs))
        return 200, {
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "structuredContent": {
                    "schema_version": "1",
                    "availability": "unavailable",
                }
            },
        }

    monkeypatch.setattr(server, "request_json", transport)
    reader = MCPReader("http://127.0.0.1:1/mcp", "dedicated-read-only")
    assert reader.call("get_observability_summary", {})["availability"] == "unavailable"
    payload = json.loads(calls[0][1]["payload"])
    assert payload["method"] == "tools/call" and payload["params"]["arguments"] == {}
    assert calls[0][1]["timeout"] == 2
    with pytest.raises(ValueError):
        reader.call("apply_plan", {})
    monkeypatch.setattr(
        server,
        "request_json",
        lambda *_args, **_kwargs: (
            200,
            {"id": 1, "result": {"isError": True, "error": "secret"}},
        ),
    )
    with pytest.raises(TransportError, match="observation_unavailable"):
        reader.call("get_job", {"job_id": "task"})
    monkeypatch.setattr(
        server,
        "request_json",
        lambda *_args, **_kwargs: (
            200,
            {"id": 1, "result": {"structuredContent": {"schema_version": "2"}}},
        ),
    )
    with pytest.raises(TransportError, match="schema_mismatch"):
        reader.call("get_instance_inventory", {})


def test_all_services_down_still_persists_incident_and_delivers_without_model(setup):
    state, supervisor = setup
    calls, sent = [], []

    class NoServices:
        def call(self, name, arguments):
            calls.append(name)
            raise ConnectionError("Crate PostgreSQL/API/Redis unavailable")

    class FixedRoute:
        def send(self, item, attempt, now):
            sent.append(item)
            return "delivered"

    poller = Poller(supervisor, NoServices(), Delivery(state, FixedRoute()))
    poller.tick(100)
    assert supervisor.incidents()["incidents"][0]["state"] == "open"
    assert sent and sent[0]["id"] in sent[0]["message"]
    assert calls == ["get_observability_summary"]
    assert state.snapshot()["health"]["heartbeat_at"] == 100


def test_poll_requests_deduplicated_and_watch_reads_round_robin(setup):
    state, supervisor = setup
    supervisor.rules.append(
        Rule(
            "other",
            "worker",
            "get_observability_summary",
            ("data", "sources", "worker"),
        )
    )
    jobs = []

    class Reader:
        def call(self, name, arguments):
            if name == "get_job":
                jobs.append(arguments["job_id"])
            return {}

    class Sender:
        def send(self, *_):
            return "delivered"

    for number in range(30):
        supervisor.watch_job(f"task-{number}", 100)
    poller = Poller(supervisor, Reader(), Delivery(state, Sender()))
    for step in range(6):
        poller.tick(100 + step * 30)
    assert len(jobs) == 30 and len(set(jobs)) == 30


def config_file(tmp_path):
    config = json.loads((ROOT / "deploy/operator/config.example.json").read_text())
    config["state_directory"] = str(tmp_path / "state")
    for key in ("mcp_token_file", "api_token_file", "webhook_secret_file"):
        target = tmp_path / key
        target.write_text("synthetic-distinct-" + key)
        config[key] = str(target)
    path = tmp_path / "config.json"
    path.write_text(json.dumps(config))
    return path, config


def test_config_secrets_and_check_cli_are_offline(tmp_path, monkeypatch):
    path, config = config_file(tmp_path)
    assert len(load_config(path)["parsed_rules"]) == 13
    assert read_secret(config["mcp_token_file"]).startswith("synthetic-")
    from deploy.operator import server

    monkeypatch.setattr(
        server,
        "request_json",
        lambda *_args, **_kwargs: pytest.fail("offline check attempted network"),
    )
    main(["--config", str(path), "--check"])
    assert not (tmp_path / "state").exists()
    config["api_token_file"] = config["mcp_token_file"]
    path.write_text(json.dumps(config))
    with pytest.raises(ValueError, match="distinct"):
        main(["--config", str(path), "--check"])


@pytest.mark.parametrize(
    "field,value",
    [
        ("poll_seconds", 29),
        ("poll_seconds", 61),
        ("listen_host", "public.example"),
        ("unknown", True),
        ("mcp_token_file", "relative"),
        ("webhook_url", "https://user:password@host"),
    ],
)
def test_invalid_config_fails_closed(tmp_path, field, value):
    path, config = config_file(tmp_path)
    config[field] = value
    path.write_text(json.dumps(config))
    with pytest.raises(ValueError):
        load_config(path)


def test_offline_requeue_requires_local_state_and_keeps_logical_identity(tmp_path):
    path, config = config_file(tmp_path)
    from deploy.operator.state import enqueue

    state = State(config["state_directory"])
    with state.transaction() as data:
        key = enqueue(data, "synthetic", 100)
        data["outbox"][key]["state"] = "dead_letter"
    state.close()
    main(["--config", str(path), "--requeue", key])
    state = State(config["state_directory"])
    assert state.snapshot()["outbox"][key]["state"] == "pending"
    assert state.snapshot()["outbox"][key]["generation"] == 1
    state.close()


def test_maximum_observations_and_thirty_watches_fit_existing_mcp_window(tmp_path):
    pipelines = [
        "import",
        "enrichment",
        "analysis",
        "bliss",
        "playback",
        "projector",
        "federation",
        "acquisition",
    ]
    rules = [
        Rule(
            "coverage",
            pipeline,
            "get_pipeline_status",
            ("data", "sources", "worker"),
            arguments={"pipeline": pipeline},
        )
        for pipeline in pipelines
    ]
    state = State(tmp_path)
    supervisor = Supervisor(state, "lab", rules)
    for number in range(30):
        supervisor.watch_job(f"task-{number}", 100)
    calls = []
    current = [100]

    class Reader:
        def call(self, name, arguments):
            calls.append((current[0], name, arguments))
            return {}

    class Sender:
        def send(self, *_):
            return "delivered"

    poller = Poller(supervisor, Reader(), Delivery(state, Sender()))
    for step in range(6):
        current[0] = 100 + step * 30
        before = len(calls)
        poller.tick(current[0])
        assert len(calls) - before == 13  # 8 unique observations + only 5 watches.
        assert sum(current[0] - 60 <= at <= current[0] for at, _, _ in calls) <= 39
    assert len({args["job_id"] for _, name, args in calls if name == "get_job"}) == 30
    assert all(name in {"get_pipeline_status", "get_job"} for _, name, _ in calls)
    state.close()


@pytest.mark.parametrize("failed_fsync", [1, 2])
def test_http_watch_durability_fault_blocks_status_and_all_future_writes(
    setup, monkeypatch, failed_fsync
):
    import os
    import time

    state, supervisor = setup
    supervisor.observe({}, time.time())
    server = make_http_server(supervisor, "synthetic-read-api-token")
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{server.server_port}"
    headers = {
        "Authorization": "Bearer synthetic-read-api-token",
        "Content-Type": "application/json",
    }
    fsync = os.fsync
    calls = []

    def faulty_fsync(fd):
        calls.append(fd)
        if len(calls) == failed_fsync:
            raise OSError("private disk failure")
        fsync(fd)

    try:
        with monkeypatch.context() as patch:
            patch.setattr(os, "fsync", faulty_fsync)
            code, body = request_json(
                url + "/v1/watch-job",
                payload=b'{"job_id":"uncertain-watch"}',
                headers=headers,
            )
        assert code == 503 and body["error"] == "state_unavailable"
        saved = state.path.read_bytes()
        code, status = request_json(url + "/v1/status", headers=headers)
        assert code == 503 and status["state"] == "unavailable"
        assert "heartbeat_at" not in status
        code, _ = request_json(
            url + "/v1/watch-job",
            payload=b'{"job_id":"must-not-write"}',
            headers=headers,
        )
        assert code == 503 and state.path.read_bytes() == saved

        class Reader:
            def call(self, *_):
                pytest.fail("Poisoned poller must stop before requesting observations")

        with pytest.raises(OSError):
            Poller(supervisor, Reader(), None).tick()
        assert state.path.read_bytes() == saved
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def test_running_service_exits_after_watch_thread_durability_failure(
    tmp_path, monkeypatch
):
    import os

    from deploy.operator import server as service
    from deploy.operator.state import StateUnavailable

    path, config = config_file(tmp_path)
    first_cycle = threading.Event()
    captured = {}
    failures = []
    original_server = service.make_http_server
    original_tick = service.Poller.tick

    class Reader:
        def call(self, *_):
            return {}

    class Sender:
        def send(self, *_):
            return "delivered"

    def local_server(supervisor, token, *_args, **kwargs):
        server = original_server(supervisor, token, port=0, **kwargs)
        captured["server"] = server
        return server

    def first_tick(self):
        original_tick(self)
        first_cycle.set()

    def run():
        try:
            service.main(["--config", str(path)])
        except StateUnavailable as error:
            failures.append(str(error))

    monkeypatch.setattr(service, "MCPReader", lambda *_: Reader())
    monkeypatch.setattr(service, "HermesTransport", lambda *_: Sender())
    monkeypatch.setattr(service, "make_http_server", local_server)
    monkeypatch.setattr(service.Poller, "tick", first_tick)
    monkeypatch.setattr(service.signal, "signal", lambda *_: None)
    runner = threading.Thread(target=run, daemon=True)
    runner.start()
    assert first_cycle.wait(3)
    url = f"http://127.0.0.1:{captured['server'].server_port}/v1/watch-job"
    headers = {"Authorization": "Bearer " + Path(config["api_token_file"]).read_text()}
    with monkeypatch.context() as patch:
        patch.setattr(
            os,
            "fsync",
            lambda *_: (_ for _ in ()).throw(OSError("synthetic write fault")),
        )
        code, _ = request_json(
            url, payload=b'{"job_id":"watch-trigger"}', headers=headers
        )
    assert code == 503
    runner.join(3)
    assert not runner.is_alive() and failures == [
        "Operator state unavailable; restart required"
    ]
    # Main's finally block released the process lock; a new writer can reopen.
    restarted = State(config["state_directory"])
    restarted.ensure_available()
    restarted.close()


@pytest.mark.parametrize(
    "host",
    [
        "*",
        "api.example/a",
        "api.example\r\nX: y",
        "api.example:99999",
        "https://api.example",
        "",
    ],
)
def test_fixed_mcp_host_rejects_untrusted_authority(host):
    from deploy.operator.server import validate_mcp_host

    with pytest.raises(ValueError):
        validate_mcp_host(host)


def test_actual_mcp_supervisor_pages_advance_and_keep_retention_gap(
    setup, tmp_path, monkeypatch
):
    from deploy.operator import supervisor_mcp
    from deploy.operator.state import enqueue

    state, supervisor = setup
    with state.transaction() as data:
        data["incidents"] = {
            str(i): {"key": str(i), "state": "open"} for i in range(65)
        }
        for i in range(65):
            enqueue(data, "synthetic " + str(i), i)
        data["sequence"] = 75
        data["events"] = [{"seq": i, "at": 1, "kind": "fixture"} for i in range(10, 76)]
    delivery = Delivery(state, lambda *_: None)
    service = make_http_server(
        supervisor, "synthetic-read-api-token", delivery=delivery
    )
    thread = threading.Thread(target=service.serve_forever, daemon=True)
    thread.start()
    (tmp_path / "read-token").write_text("synthetic-read-api-token")
    monkeypatch.setattr(supervisor_mcp, "ROOT", tmp_path)
    monkeypatch.setattr(
        supervisor_mcp, "BASE", f"http://127.0.0.1:{service.server_port}"
    )

    def read(name, args):
        response = supervisor_mcp.dispatch(
            {"method": "tools/call", "params": {"name": name, "arguments": args}}
        )
        assert not response["isError"], response
        return response["structuredContent"]

    try:
        first = read("supervisor_events", {"cursor": 0, "limit": 20})
        assert first["retention_gap"]
        second = read(
            "supervisor_events", {"cursor": first["next_cursor"], "limit": 100}
        )
        assert second["events"][0]["seq"] > first["events"][-1]["seq"]
        assert second["events"][-1]["seq"] == 75
        for tool, field in [
            ("supervisor_incidents", "incidents"),
            ("supervisor_delivery", "items"),
        ]:
            first = read(tool, {"offset": 0, "limit": 20})
            second = read(tool, {"offset": first["next_offset"], "limit": 50})
            assert len(first[field]) == 20 and len(second[field]) == 45
            assert second["next_offset"] is None
        for tool, args in [
            ("supervisor_events", {"cursor": -1}),
            ("supervisor_events", {"cursor": True}),
            ("supervisor_events", {"limit": "2"}),
            ("supervisor_incidents", {"offset": 501}),
            ("supervisor_delivery", {"limit": 51}),
            ("supervisor_delivery", {"offset": 1001}),
            ("supervisor_status", {"limit": 1}),
            ("supervisor_events", {"x": 1}),
        ]:
            with pytest.raises(ValueError):
                read(tool, args)
    finally:
        service.shutdown()
        service.server_close()
        thread.join()

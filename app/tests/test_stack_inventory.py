from __future__ import annotations

import socketserver
import tempfile
import threading
from pathlib import Path

import pytest

from crate import docker_ctl


class _Responder(socketserver.StreamRequestHandler):
    responses: list[bytes] = []

    def handle(self):
        self.rfile.readline()
        while self.rfile.readline() not in (b"\r\n", b""):
            pass
        self.wfile.write(self.responses.pop(0))


@pytest.fixture
def docker_socket(monkeypatch):
    directory = tempfile.mkdtemp(dir="/tmp")
    path = str(Path(directory) / "d.sock")
    server = socketserver.UnixStreamServer(path, _Responder)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setattr(docker_ctl, "DOCKER_SOCKET", path)
    yield _Responder.responses
    server.shutdown()
    server.server_close()


def _http(status: str, body: str = "") -> bytes:
    return (f"HTTP/1.1 {status}\r\nContent-Length: {len(body)}\r\n\r\n{body}").encode()


def test_call_returns_the_real_status_and_body(docker_socket):
    docker_socket.extend(
        [_http("204 No Content"), _http("404 Not Found", '{"message":"x"}')]
    )

    assert docker_ctl._call("POST", "/containers/a/restart") == (204, None)
    assert docker_ctl._call("POST", "/containers/b/restart") == (404, {"message": "x"})


def test_call_raises_when_docker_is_unreachable(monkeypatch):
    monkeypatch.setattr(docker_ctl, "DOCKER_SOCKET", "/tmp/crate-missing-docker.sock")

    with pytest.raises(docker_ctl.DockerUnavailableError):
        docker_ctl._call("GET", "/containers/json")


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        (204, "done"),
        (304, "unchanged"),
        (404, "not_found"),
        (409, "failed"),
        (500, "failed"),
    ],
)
def test_container_actions_report_their_actual_outcome(monkeypatch, status, expected):
    monkeypatch.setattr(docker_ctl, "_call", lambda *_args, **_kwargs: (status, None))

    assert docker_ctl.container_action("traefik", "restart") == expected


def test_legacy_actions_no_longer_report_success_when_docker_is_down(monkeypatch):
    def unavailable(*_args, **_kwargs):
        raise docker_ctl.DockerUnavailableError("socket closed")

    monkeypatch.setattr(docker_ctl, "_call", unavailable)

    assert docker_ctl.restart_container("crate-worker") is False
    assert docker_ctl.stop_container("traefik") is False
    assert docker_ctl.start_container("traefik") is False


def _container(name, project, service, *, state="running", status="Up 3 hours"):
    return {
        "Id": f"{name:0<64}"[:64],
        "Names": [f"/{name}"],
        "Image": f"ghcr.io/crate/{service}:1",
        "State": state,
        "Status": status,
        "Labels": {
            "com.docker.compose.project": project,
            "com.docker.compose.service": service,
        },
    }


@pytest.fixture
def inventory_docker(monkeypatch):
    from crate import stack_inventory

    rows = [
        _container("crate-api", "crate", "crate-api", status="Up 2 hours (healthy)"),
        _container("traefik", "crate", "traefik"),
        _container(
            "crate-worker", "crate", "crate-worker", status="Up 1 hour (unhealthy)"
        ),
        _container("crate-prometheus", "crate", "crate-prometheus"),
        _container(
            "crate-observability-crate-grafana-1",
            "crate-observability",
            "crate-grafana",
            status="Up 5 minutes (health: starting)",
        ),
        _container("nginx", "crate-observability", "nginx"),
        _container("nginx-other", "someone-else", "nginx"),
    ]
    monkeypatch.setattr(docker_ctl, "_call", lambda *_args, **_kwargs: (200, rows))
    monkeypatch.setattr(docker_ctl, "application_project", lambda: "crate")
    monkeypatch.setenv("CRATE_OBSERVABILITY_PROJECT", "crate-observability")
    monkeypatch.setenv("CRATE_HOST_ID", "crate-production")
    monkeypatch.setenv("CRATE_HOST_NAME", "Crate production")
    return stack_inventory


def test_inventory_lists_both_deployments_with_scoped_identities(inventory_docker):
    inventory = inventory_docker.build_inventory()
    services = {service["id"]: service for service in inventory["services"]}

    assert inventory["availability"] == "available"
    assert inventory["host"] == {"id": "crate-production", "name": "Crate production"}
    assert [stack["id"] for stack in inventory["stacks"]] == [
        "application",
        "observability",
    ]
    assert "someone-else/nginx" not in services
    assert services["crate/crate-api"]["stack_id"] == "application"
    assert services["crate-observability/nginx"]["stack_id"] == "observability"
    assert services["crate/crate-prometheus"]["stack_id"] == "observability"
    assert services["crate/crate-api"]["container_id"] == "crate-api".ljust(64, "0")


def test_inventory_reports_healthcheck_state_separately_from_runtime(inventory_docker):
    services = {
        service["id"]: service
        for service in inventory_docker.build_inventory()["services"]
    }

    assert services["crate/crate-api"]["health"] == "healthy"
    assert services["crate/crate-worker"]["health"] == "unhealthy"
    assert services["crate-observability/crate-grafana"]["health"] == "starting"
    assert services["crate/traefik"]["health"] == "none"
    assert services["crate/crate-worker"]["runtime_state"] == "running"


def test_inventory_keeps_existing_action_authorization(inventory_docker):
    services = {
        service["id"]: service
        for service in inventory_docker.build_inventory()["services"]
    }

    assert services["crate/traefik"]["actions"] == ["restart", "stop", "start"]
    assert services["crate/crate-api"]["actions"] == []
    assert services["crate-observability/nginx"]["actions"] == []


def test_inventory_fails_closed_when_docker_cannot_list(monkeypatch):
    from crate import stack_inventory

    monkeypatch.setattr(
        docker_ctl, "_call", lambda *_args, **_kwargs: (500, {"message": "x"})
    )
    monkeypatch.setattr(docker_ctl, "application_project", lambda: "crate")

    with pytest.raises(docker_ctl.DockerUnavailableError):
        stack_inventory.build_inventory()


def test_stack_surface_serves_unavailable_inventory_instead_of_healthy_empty(
    monkeypatch,
):
    from crate.db import admin_stack_surface

    def failing_build(**kwargs):
        raise docker_ctl.DockerUnavailableError("socket closed")

    monkeypatch.setattr(admin_stack_surface, "get_or_build_ui_snapshot", failing_build)

    payload = admin_stack_surface.get_cached_stack_surface()

    assert payload["inventory"]["availability"] == "unavailable"
    assert payload["inventory"]["services"] == []
    assert payload["stack"]["available"] is False


@pytest.fixture
def action_docker(monkeypatch):
    from crate.api import stack

    calls = []
    state = {"project": "crate", "outcome": "done", "unavailable": False}

    def container_project(name):
        if state["unavailable"]:
            raise docker_ctl.DockerUnavailableError("socket closed")
        return state["project"]

    def container_action(name, action):
        calls.append((name, action))
        return state["outcome"]

    monkeypatch.setattr(stack, "container_project", container_project)
    monkeypatch.setattr(stack, "container_action", container_action)
    monkeypatch.setattr(stack, "application_project", lambda: "crate")
    monkeypatch.setattr(stack, "publish_stack_surface_signal", lambda: None)
    return state, calls


@pytest.mark.parametrize(
    ("outcome", "status", "body_status"),
    [("done", 200, "restarting"), ("unchanged", 200, "unchanged")],
)
def test_actions_report_done_or_unchanged(
    test_app, action_docker, outcome, status, body_status
):
    state, calls = action_docker
    state["outcome"] = outcome

    response = test_app.post("/api/stack/container/traefik/restart")

    assert response.status_code == status
    assert response.json() == {"status": body_status, "name": "traefik"}
    assert calls == [("traefik", "restart")]


def test_actions_refuse_containers_outside_this_deployment(test_app, action_docker):
    state, calls = action_docker
    state["project"] = "someone-else"

    response = test_app.post("/api/stack/container/nginx/stop")

    assert response.status_code == 403
    assert calls == []


def test_actions_keep_the_existing_allowlist(test_app, action_docker):
    _state, calls = action_docker

    response = test_app.post("/api/stack/container/crate-api/restart")

    assert response.status_code == 403
    assert calls == []


@pytest.mark.parametrize(
    ("setup", "status"),
    [("missing", 404), ("unavailable", 503), ("failed", 500)],
)
def test_actions_distinguish_missing_unreachable_and_failed(
    test_app, action_docker, setup, status
):
    state, _calls = action_docker
    if setup == "missing":
        state["project"] = None
    elif setup == "unavailable":
        state["unavailable"] = True
    else:
        state["outcome"] = "failed"

    response = test_app.post("/api/stack/container/traefik/start")

    assert response.status_code == status


def test_snapshot_response_keeps_the_inventory(test_app, monkeypatch):
    from crate.api import stack

    payload = {
        "snapshot": {
            "scope": "ops:stack",
            "subject_key": "global",
            "version": 1,
            "built_at": "2026-11-01T12:00:00+00:00",
            "stale_after": "2026-11-01T12:00:30+00:00",
            "stale": False,
            "generation_ms": 3,
        },
        "stack": {"available": True, "total": 0, "running": 0, "containers": []},
        "inventory": {
            "schema_version": 1,
            "availability": "available",
            "reason": None,
            "host": {"id": "h", "name": "Host"},
            "stacks": [
                {"id": "application", "kind": "application", "project": "crate"}
            ],
            "services": [
                {
                    "id": "crate/traefik",
                    "stack_id": "application",
                    "service": "traefik",
                    "project": "crate",
                    "container_id": "a" * 64,
                    "container_name": "traefik",
                    "image": "traefik:v3",
                    "runtime_state": "running",
                    "health": "none",
                    "status": "Up 1 hour",
                    "actions": ["restart", "stop", "start"],
                }
            ],
        },
    }
    monkeypatch.setattr(stack, "get_cached_stack_surface", lambda fresh=False: payload)

    response = test_app.get("/api/admin/stack-snapshot")

    assert response.status_code == 200
    assert response.json()["inventory"]["services"][0]["id"] == "crate/traefik"


def test_inventory_links_grafana_only_when_configured(inventory_docker, monkeypatch):
    monkeypatch.delenv("CRATE_GRAFANA_URL", raising=False)
    assert inventory_docker.build_inventory()["links"] == {"grafana": None}

    monkeypatch.setenv("CRATE_GRAFANA_URL", "https://grafana.example/")
    assert inventory_docker.build_inventory()["links"] == {
        "grafana": "https://grafana.example"
    }

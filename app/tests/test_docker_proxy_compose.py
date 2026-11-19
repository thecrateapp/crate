"""crate-api reaches Docker only through a filtering proxy that alone holds the socket."""

import json
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

from crate.api.stack import ALLOWED_PREFIXES

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / "deploy/docker-proxy/haproxy.cfg"
COMPOSE_FILES = ["docker-compose.yaml", "docker-compose.home.yaml"]
PROXY = "crate-docker-proxy"
SOCKET_HOLDERS = {"traefik", PROXY}
CONTAINER = "a" * 64


def _compose(name):
    return yaml.safe_load((ROOT / name).read_text())


def _environment(service):
    environment = service.get("environment", {})
    if isinstance(environment, list):
        return dict(entry.split("=", 1) for entry in environment)
    return environment


def _volume_sources(service):
    sources = []
    for volume in service.get("volumes", []):
        if isinstance(volume, dict):
            sources.append(volume.get("source", ""))
        else:
            sources.append(volume.split(":", 1)[0])
    return sources


def _rules():
    lines = [
        line.strip()
        for line in CONFIG.read_text().splitlines()
        if line.strip().startswith("http-request")
    ]
    assert lines[-1] == "http-request deny"
    rules = []
    for line in lines[:-1]:
        match = re.fullmatch(
            r"http-request allow if \{ method (GET|POST) \} \{ path -m reg (\S+) \}",
            line,
        )
        assert match, line
        rules.append((match[1], match[2]))
    return rules


def _allowed(method, path):
    return any(
        method == rule_method and re.fullmatch(pattern, path) is not None
        for rule_method, pattern in _rules()
    )


@pytest.mark.parametrize("name", COMPOSE_FILES)
def test_only_traefik_and_the_proxy_mount_the_docker_socket(name):
    services = _compose(name)["services"]
    holders = {
        service_name
        for service_name, service in services.items()
        if any(source.endswith("docker.sock") for source in _volume_sources(service))
    }
    assert holders == SOCKET_HOLDERS


@pytest.mark.parametrize("name", COMPOSE_FILES)
def test_api_talks_to_docker_through_the_internal_proxy_network(name):
    compose = _compose(name)
    api = compose["services"]["crate-api"]
    assert _environment(api)["DOCKER_HOST"] == f"tcp://{PROXY}:2375"
    assert "group_add" not in api
    assert "docker-api" in api["networks"]
    assert PROXY in api["depends_on"]
    assert compose["networks"]["docker-api"] == {"internal": True}
    members = {
        service_name
        for service_name, service in compose["services"].items()
        if "docker-api" in service.get("networks", [])
    }
    assert members == {"crate-api", PROXY}


@pytest.mark.parametrize("name", COMPOSE_FILES)
def test_proxy_is_pinned_unprivileged_and_unpublished(name):
    proxy = _compose(name)["services"][PROXY]
    observability = yaml.safe_load(
        (ROOT / "deploy/observability/compose.observability.yaml").read_text()
    )["services"]["crate-observability-docker-proxy"]
    assert proxy["image"] == observability["image"]
    assert re.fullmatch(r"haproxy:[^:@/]+@sha256:[a-f0-9]{64}", proxy["image"])
    assert "user" not in proxy
    assert proxy["group_add"] == ["${DOCKER_GID:-988}"]
    assert proxy["read_only"] is True
    assert proxy["cap_drop"] == ["ALL"]
    assert proxy["security_opt"] == ["no-new-privileges:true"]
    assert not proxy.get("ports")
    assert not proxy.get("privileged")
    assert proxy["networks"] == ["docker-api"]
    assert proxy["volumes"] == [
        "./deploy/docker-proxy/haproxy.cfg:/usr/local/etc/haproxy/haproxy.cfg:ro",
        "/var/run/docker.sock:/var/run/docker.sock:ro",
    ]
    assert proxy["labels"] == {"traefik.enable": False}


def test_home_and_production_run_the_same_proxy():
    production, home = (_compose(name)["services"][PROXY] for name in COMPOSE_FILES)
    assert home == production


def test_filter_has_one_read_rule_and_one_action_rule():
    assert [method for method, _ in _rules()] == ["GET", "POST"]


@pytest.mark.parametrize(
    "method,path,expected",
    [
        ("GET", "/_ping", True),
        ("GET", "/info", True),
        ("GET", "/v1.47/info", True),
        ("GET", "/containers/json", True),
        ("GET", "/v1.47/containers/json", True),
        ("GET", "/containers/crate-api/json", True),
        ("GET", f"/containers/{CONTAINER}/json", True),
        ("GET", "/containers/crate-worker/logs", True),
        ("POST", "/containers/crate-worker/restart", True),
        ("POST", "/v1.47/containers/slskd/restart", True),
        ("POST", "/containers/librarian-lidarr/stop", True),
        ("POST", "/containers/traefik/start", True),
        ("POST", "/containers/crate-worker/stop", False),
        ("POST", "/containers/crate-worker/start", False),
        ("POST", "/containers/crate-api/restart", False),
        ("POST", "/containers/crate-postgres/stop", False),
        ("POST", "/containers/create", False),
        ("POST", "/containers/slskd/exec", False),
        ("POST", "/containers/slskd/kill", False),
        ("POST", "/containers/slskd/update", False),
        ("POST", "/containers/slskd/attach", False),
        ("POST", "/containers/slskd%2F..%2Fcreate/start", False),
        ("POST", "/containers/slskd/../create/start", False),
        ("POST", "/exec/abc/start", False),
        ("POST", "/images/create", False),
        ("POST", "/build", False),
        ("POST", "/volumes/create", False),
        ("POST", "/containers/json", False),
        ("DELETE", "/containers/slskd", False),
        ("PUT", "/containers/slskd/archive", False),
        ("HEAD", "/info", False),
        ("GET", "/version", False),
        ("GET", "/events", False),
        ("GET", "/images/json", False),
        ("GET", "/volumes", False),
        ("GET", "/secrets", False),
        ("GET", "/containers/slskd/archive", False),
        ("GET", "/containers/slskd/export", False),
        ("GET", "/containers/slskd/top", False),
        ("GET", "/containers/../info", False),
        ("GET", "//containers/json", False),
    ],
)
def test_filter_allows_only_what_docker_ctl_uses(method, path, expected):
    assert _allowed(method, path) is expected


@pytest.mark.parametrize("prefix", ALLOWED_PREFIXES)
@pytest.mark.parametrize("action", ["restart", "stop", "start"])
def test_filter_permits_every_action_the_stack_api_allows(prefix, action):
    name = prefix + ("app" if prefix.endswith("-") else "")
    assert _allowed("POST", f"/containers/{name}/{action}")
    assert not _allowed("POST", f"/containers/x{name}/{action}")


@pytest.mark.parametrize("name", COMPOSE_FILES)
def test_resolved_compose_keeps_the_socket_with_traefik_and_the_proxy(tmp_path, name):
    if not shutil.which("docker"):
        pytest.skip("Docker Compose parser required; no daemon or containers used")
    files = [name] + (
        ["docker-compose.project.yaml"] if name == COMPOSE_FILES[0] else []
    )
    values = {
        "PUID": "1000",
        "PGID": "1000",
        "TZ": "UTC",
        "DOMAIN": "example.invalid",
        "DATA_DIR": "/var/lib/crate-test",
        "MEDIA_DIR": "/srv/media",
        "MUSIC_DIR": "/srv/music",
        "DOWNLOADS_DIR": "/srv/downloads",
        "TRAEFIK_HTTP_PORT": "8080",
        "TRAEFIK_HTTPS_PORT": "8443",
        "NGINX_PORT": "8081",
        "SLSKD_PORT": "5030",
        "SLSKD_LISTEN_PORT": "50300",
    }
    for file in files:
        for variable in re.findall(r"\$\{([A-Z0-9_]+):\?", (ROOT / file).read_text()):
            values.setdefault(variable, "synthetic-value")
    environment = tmp_path / "synthetic.env"
    environment.write_text("".join(f"{key}={value}\n" for key, value in values.items()))
    command = ["docker", "compose", "--env-file", str(environment)]
    for file in files:
        command.extend(["-f", file])
    result = subprocess.run(
        [*command, "--profile", "*", "config", "--format", "json"],
        cwd=ROOT,
        env={"PATH": os.environ["PATH"]},
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stderr
    services = json.loads(result.stdout)["services"]
    holders = {
        service_name
        for service_name, service in services.items()
        if any(
            mount.get("source", "").endswith("docker.sock")
            for mount in service.get("volumes", [])
        )
    }
    assert holders == SOCKET_HOLDERS
    assert set(services["crate-api"]["networks"]) >= {"docker-api"}
    assert set(services[PROXY]["networks"]) == {"docker-api"}

"""The optional containerd adapter exposes only cAdvisor's metadata Get RPC."""

import json
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
DIRECTORY = ROOT / "deploy/observability"
ADAPTER = DIRECTORY / "compose.containerd.yaml"
RPC = "/containerd.services.containers.v1.Containers/Get"


def _adapter():
    assert ADAPTER.is_file(), "The explicit containerd adapter must exist"
    return yaml.safe_load(ADAPTER.read_text())


def test_containerd_reuses_existing_services_images_and_resources():
    adapter = _adapter()
    base = yaml.safe_load((DIRECTORY / "compose.observability.yaml").read_text())
    assert set(adapter["services"]) == {
        "crate-cadvisor",
        "crate-observability-docker-proxy",
    }
    for name, service in adapter["services"].items():
        for field in ("image", "mem_limit", "cpus", "profiles"):
            assert (
                field not in service or service[field] == base["services"][name][field]
            )
        assert not service.get("ports")
        assert not service.get("privileged")


def test_host_containerd_socket_is_only_bound_to_the_filter():
    services = _adapter()["services"]
    proxy = services["crate-observability-docker-proxy"]
    host_sockets = [
        mount
        for mount in proxy["volumes"]
        if isinstance(mount, dict)
        and "OBS_CONTAINERD_SOCKET" in mount.get("source", "")
    ]
    assert len(host_sockets) == 1
    socket = host_sockets[0]
    assert socket["type"] == "bind"
    assert socket["bind"]["create_host_path"] is False
    assert socket["read_only"] is True
    assert (
        "${OBS_CONTAINERD_SOCKET:-/run/containerd/containerd.sock}" == socket["source"]
    )
    assert "OBS_CONTAINERD_SOCKET" not in str(services["crate-cadvisor"])


def test_cadvisor_uses_a_read_only_proxy_socket_volume():
    adapter = _adapter()
    services = adapter["services"]
    cadvisor = services["crate-cadvisor"]
    command = " ".join(cadvisor["command"])
    assert "--containerd=/run/crate-runtime-proxy/containerd.sock" in command
    assert "--containerd-namespace=moby" in command
    mounts = [
        mount
        for mount in cadvisor["volumes"]
        if isinstance(mount, dict) and mount.get("target") == "/run/crate-runtime-proxy"
    ]
    assert len(mounts) == 1
    volume = mounts[0]
    assert volume["type"] == "volume" and volume["read_only"] is True
    assert volume["source"] in adapter["volumes"]
    assert any(
        isinstance(mount, dict)
        and mount.get("source") == volume["source"]
        and mount.get("target") == volume["target"]
        and not mount.get("read_only", False)
        for mount in services["crate-observability-docker-proxy"]["volumes"]
    )


@pytest.mark.parametrize(
    "method,path,namespaces,allowed",
    [
        ("POST", RPC, ["moby"], True),
        ("GET", RPC, ["moby"], False),
        ("POST", RPC, [], False),
        ("POST", RPC, ["default"], False),
        ("POST", RPC, ["moby", "moby"], False),
        ("POST", RPC, ["moby", "default"], False),
        ("POST", RPC, ["moby,default"], False),
        ("POST", RPC.replace("/Get", "/List"), ["moby"], False),
        ("POST", RPC.replace("/Get", "/Update"), ["moby"], False),
        ("POST", RPC.replace("/Get", "/Delete"), ["moby"], False),
        ("POST", "/containerd.services.tasks.v1.Tasks/Get", ["moby"], False),
    ],
)
def test_containerd_filter_allows_only_get_in_one_moby_namespace(
    method, path, namespaces, allowed
):
    _adapter()
    config = (DIRECTORY / "runtime-proxy.haproxy.cfg").read_text()
    assert "bind /run/crate-runtime-proxy/containerd.sock" in config
    assert re.search(r"bind\s+:2376\b.*\bproto h2\b", config)
    sections = re.split(r"(?m)^(?:frontend|backend)\s+", config)
    frontend = next(section for section in sections if "bind :2376" in section)
    gate = next(
        line for line in frontend.splitlines() if "http-request deny unless" in line
    )
    assert "{ method POST }" in gate
    path_guard = re.search(r"\{ path -m str (\S+) \}", gate)
    assert path_guard and path_guard[1] == RPC
    assert re.search(r"\{ req\.hdr_cnt\(containerd-namespace\) (?:eq )?1 \}", gate)
    namespace_guard = re.search(
        r"\{ req\.hdr\(containerd-namespace\) -m str (\S+) \}", gate
    )
    assert namespace_guard and namespace_guard[1] == "moby"
    permitted = (
        method == "POST"
        and path == path_guard[1]
        and len(namespaces) == 1
        and namespaces[0] == namespace_guard[1]
    )
    assert permitted is allowed


@pytest.mark.parametrize("base", ["docker-compose.yaml", "docker-compose.home.yaml"])
def test_containerd_override_resolves_without_adding_services_or_public_ports(
    tmp_path, base
):
    _adapter()
    if not shutil.which("docker"):
        pytest.skip("Docker Compose parser required; no daemon or containers used")
    files = [
        base,
        "deploy/observability/compose.observability.yaml",
        str(ADAPTER.relative_to(ROOT)),
    ]
    if base == "docker-compose.yaml":
        files.insert(1, "docker-compose.project.yaml")
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
        "TIDARR_PORT": "8484",
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
        [*command, "--profile", "observability", "config", "--format", "json"],
        cwd=ROOT,
        env={"PATH": os.environ["PATH"]},
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
    services = json.loads(result.stdout)["services"]
    original = yaml.safe_load((DIRECTORY / "compose.observability.yaml").read_text())[
        "services"
    ]
    for name, service in original.items():
        resolved = services[name]
        assert resolved["image"] == service["image"]
        if name != "crate-grafana":
            assert not resolved.get("ports"), name
    proxy_mounts = services["crate-observability-docker-proxy"]["volumes"]
    assert any(
        mount.get("source") == "/run/containerd/containerd.sock"
        and mount["bind"]["create_host_path"] is False
        for mount in proxy_mounts
    )
    for name, service in services.items():
        if name != "crate-observability-docker-proxy":
            assert all(
                mount.get("source") != "/run/containerd/containerd.sock"
                for mount in service.get("volumes", [])
            ), name

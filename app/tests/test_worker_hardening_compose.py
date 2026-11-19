"""Workers that run ffmpeg and native analysis get no privileges back."""

import json
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
COMPOSE_FILES = ["docker-compose.yaml", "docker-compose.home.yaml"]
WORKERS = [
    "crate-worker",
    "crate-fast-worker",
    "crate-projector",
    "crate-maintenance-worker",
    "crate-analysis-worker",
    "crate-playback-worker",
    "crate-media-worker",
]
HARDENED = {"security_opt": ["no-new-privileges:true"], "cap_drop": ["ALL"]}


def _services(name):
    return yaml.safe_load((ROOT / name).read_text())["services"]


@pytest.mark.parametrize("name", COMPOSE_FILES)
@pytest.mark.parametrize("worker", WORKERS)
def test_workers_drop_capabilities_and_privilege_escalation(name, worker):
    services = _services(name)
    service = services[worker]
    if "extends" in service:
        assert service["extends"] == {"service": "crate-worker"}
        assert not {"user", "security_opt", "cap_drop", "cap_add"} & service.keys()
        service = services["crate-worker"]
    assert {key: service.get(key) for key in HARDENED} == HARDENED
    assert "cap_add" not in service
    assert not service.get("privileged")
    assert re.fullmatch(r"\$\{PUID(:-1000)?\}:\$\{PGID(:-1000)?\}", service["user"])


@pytest.mark.parametrize("name", COMPOSE_FILES)
def test_resolved_workers_keep_the_hardening(tmp_path, name):
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
        [*command, "config", "--format", "json"],
        cwd=ROOT,
        env={"PATH": os.environ["PATH"]},
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stderr
    services = json.loads(result.stdout)["services"]
    for worker in WORKERS:
        service = services[worker]
        assert service["security_opt"] == ["no-new-privileges:true"], worker
        assert service["cap_drop"] == ["ALL"], worker
        assert service["user"] == "1000:1000", worker

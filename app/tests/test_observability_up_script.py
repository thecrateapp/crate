from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from tests.test_observability_compose import _fake_monitoring_cli

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/observability-up.sh"
SERVICES = [
    "crate-prometheus",
    "crate-grafana",
    "crate-node-exporter",
    "crate-postgres-exporter",
    "crate-redis-exporter",
    "crate-redis-durable-exporter",
    "crate-cadvisor",
    "crate-observability-docker-proxy",
]


def _writer_docker(tmp_path: Path) -> None:
    docker = tmp_path / "docker"
    source = docker.read_text().replace(
        "elif sys.argv[1] not in {'compose', 'ps'}:",
        "elif sys.argv[1] == 'ps':\n    print(os.environ.get('FAKE_WRITER_PROJECTS', ''))\n"
        "elif sys.argv[1] != 'compose':",
    )
    docker.write_text(source)


def _run(tmp_path, environment, cwd, **extra):
    project = tmp_path / "install"
    (project / "deploy/observability").mkdir(parents=True, exist_ok=True)
    return subprocess.run(
        ["sh", str(SCRIPT)],
        check=False,
        cwd=cwd,
        env={
            **environment,
            "OBS_PROJECT_DIR": str(project),
            "OBS_ENV_FILE": str(project / "monitoring.env"),
            **extra,
        },
        capture_output=True,
        text=True,
        timeout=15,
    )


def _commands(calls: Path) -> list:
    return [json.loads(line) for line in calls.read_text().splitlines()]


def test_the_script_starts_the_eight_services_from_any_directory(tmp_path):
    calls, environment = _fake_monitoring_cli(tmp_path, "overlay2")

    result = _run(tmp_path, environment, cwd=tmp_path)

    assert result.returncode == 0, result.stdout + result.stderr
    starts = [c for c in _commands(calls) if c[0] == "compose" and "up" in c]
    assert len(starts) == 1
    command = starts[0]
    assert command[command.index("--project-directory") + 1] == str(
        tmp_path / "install"
    )
    assert command[command.index("--env-file") + 1] == str(
        tmp_path / "install/monitoring.env"
    )
    assert "deploy/observability/compose.standalone.yaml" in command
    assert "deploy/observability/compose.containerd.yaml" not in command
    assert command[-len(SERVICES) :] == SERVICES
    assert "--no-deps" in command


def test_a_docker_prefix_reaches_every_call(tmp_path):
    calls, environment = _fake_monitoring_cli(tmp_path, "overlay2")
    wrapper = tmp_path / "fakesudo"
    wrapper.write_text(
        '#!/bin/sh\necho \'["fakesudo"]\' >> "$FAKE_DOCKER_LOG"\nexec "$@"\n'
    )
    wrapper.chmod(0o755)

    result = _run(tmp_path, environment, cwd=tmp_path, DOCKER="fakesudo docker")

    assert result.returncode == 0, result.stdout + result.stderr
    commands = _commands(calls)
    docker_calls = [c for c in commands if c and c[0] in {"info", "ps", "compose"}]
    assert commands.count(["fakesudo"]) == len(docker_calls)


@pytest.mark.parametrize(
    ("projects", "admitted"),
    [
        ("", True),
        ("crate-observability", True),
        ("crate", False),
        ("unmanaged", False),
    ],
)
def test_writers_from_another_project_stop_the_start(tmp_path, projects, admitted):
    calls, environment = _fake_monitoring_cli(tmp_path, "overlay2")
    _writer_docker(tmp_path)

    result = _run(tmp_path, environment, cwd=tmp_path, FAKE_WRITER_PROJECTS=projects)

    starts = [c for c in _commands(calls) if c[0] == "compose" and "up" in c]
    assert (result.returncode == 0) is admitted, result.stdout + result.stderr
    assert bool(starts) is admitted
    if not admitted:
        assert "another project" in result.stderr


def test_an_unreachable_daemon_starts_nothing(tmp_path):
    _calls, environment = _fake_monitoring_cli(tmp_path, "overlay2")
    docker = tmp_path / "docker"
    docker.write_text(f"#!{sys.executable}\nimport sys\nsys.exit(1)\n")
    docker.chmod(0o755)

    result = _run(tmp_path, environment, cwd=tmp_path)

    assert result.returncode == 1
    assert "no services started" in result.stdout


def test_the_makefile_delegates_to_the_script():
    makefile = (ROOT / "Makefile").read_text()
    target = makefile[makefile.index("observability-up: ") :]
    target = target[: target.index("\n\n")]
    assert "scripts/observability-up.sh" in target
    assert "docker info" not in target

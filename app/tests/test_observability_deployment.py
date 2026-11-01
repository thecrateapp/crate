from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
import yaml


ROOT = Path(__file__).resolve().parents[2]
OBSERVABILITY = ROOT / "deploy/observability"
SERVICES = {
    "crate-prometheus",
    "crate-grafana",
    "crate-node-exporter",
    "crate-postgres-exporter",
    "crate-redis-exporter",
    "crate-redis-durable-exporter",
    "crate-cadvisor",
    "crate-observability-docker-proxy",
}


def _fake_cli(tmp_path):
    fake = tmp_path / "docker"
    log = tmp_path / "commands.jsonl"
    fake.write_text(
        f"#!{sys.executable}\n"
        "import json, os, sys\n"
        "with open(os.environ['DOCKER_TEST_LOG'], 'a') as output:\n"
        "    output.write(json.dumps(sys.argv[1:]) + '\\n')\n"
        "if sys.argv[1] == 'info': print('overlay2')\n"
        "if '--environment' in sys.argv:\n"
        "    for key in ('OBS_DATA_DIR', 'OBS_SECRETS_DIR', 'OBS_APP_NETWORK', 'CRATE_POSTGRES_DB'):\n"
        "        if key in os.environ: print(key + '=' + os.environ[key])\n"
        "if sys.argv[1] == 'ps':\n"
        "    if os.environ.get('DOCKER_TEST_PS_FAILURE') == '1': sys.exit(1)\n"
        "    joined = ' '.join(sys.argv[2:])\n"
        "    for name in ('crate-prometheus', 'crate-grafana'):\n"
        "        if name in joined:\n"
        "            value = os.environ.get('DOCKER_TEST_' + name.replace('-', '_').upper(), '')\n"
        "            if value: print(value)\n"
    )
    fake.chmod(0o755)
    env = {
        **os.environ,
        "PATH": f"{tmp_path}{os.pathsep}{os.environ['PATH']}",
        "DOCKER_TEST_LOG": str(log),
    }
    for name in ("OBS_COMPOSE_FILES", "OBS_ENV_FILE"):
        env.pop(name, None)
    state = tmp_path / "monitoring-state"
    for name in ("prometheus", "grafana"):
        (state / name).mkdir(parents=True)
        (state / name / "existing-data").write_text("preserved")
    env.update(
        OBS_DATA_DIR=str(state),
        OBS_SECRETS_DIR=str(tmp_path / "secrets"),
        OBS_APP_NETWORK="crate",
        CRATE_POSTGRES_DB="fixture-db",
        OBS_PYTHON=sys.executable,
    )
    return env, log


def _docker_compose():
    docker = shutil.which("docker")
    if docker is None:
        pytest.skip("Docker Compose CLI is required for configuration-only validation")
    check = subprocess.run(
        [docker, "compose", "version"], capture_output=True, timeout=15
    )
    if check.returncode:
        pytest.skip(
            "Docker Compose plugin is required for configuration-only validation"
        )
    return docker


def _resolved_config(tmp_path, *, standalone, containerd):
    docker = _docker_compose()
    if standalone:
        files = [OBSERVABILITY / "compose.standalone.yaml"]
        assert files[0].is_file(), "Autonomous observability Compose is required"
    else:
        base = tmp_path / "base.yaml"
        base.write_text("name: legacy-fixture\nnetworks:\n  crate: {}\nservices: {}\n")
        files = [base, OBSERVABILITY / "compose.observability.yaml"]
    if containerd:
        files.append(OBSERVABILITY / "compose.containerd.yaml")
    command = [
        docker,
        "compose",
        "--project-directory",
        str(ROOT),
        "--env-file",
        os.devnull,
    ]
    for path in files:
        command.extend(["-f", str(path)])
    command.extend(["--profile", "observability", "config", "--format", "json"])
    env = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith(("OBS_", "COMPOSE_"))
    }
    env.update(
        OBS_APP_NETWORK="fixture-application-network",
        OBS_DATA_DIR=str(tmp_path / "state"),
        OBS_SECRETS_DIR=str(tmp_path / "secrets"),
        CRATE_POSTGRES_DB="fixture-db",
    )
    result = subprocess.run(
        command, cwd=ROOT, env=env, capture_output=True, text=True, timeout=15
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def test_standalone_extends_only_the_eight_reviewed_monitoring_services():
    path = OBSERVABILITY / "compose.standalone.yaml"
    assert path.is_file(), "Autonomous observability Compose is required"
    standalone = yaml.safe_load(path.read_text())

    assert standalone["name"] == "crate-observability"
    assert set(standalone["services"]) == SERVICES
    for name, service in standalone["services"].items():
        assert service["extends"]["service"] == name
        assert Path(service["extends"]["file"]).name == "compose.observability.yaml"
    assert set(standalone["networks"]) == {"crate", "observability", "observability-ui"}
    assert standalone["networks"]["crate"]["external"] is True


@pytest.mark.parametrize("target", ["config", "pull", "up", "stop", "status"])
def test_make_monitoring_commands_use_only_the_autonomous_project(tmp_path, target):
    env, log = _fake_cli(tmp_path)
    result = subprocess.run(
        ["make", f"observability-{target}"],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=15,
    )

    assert result.returncode == 0, result.stderr
    commands = [json.loads(line) for line in log.read_text().splitlines()]
    compose = [command for command in commands if command[0] == "compose"]
    assert compose
    for command in compose:
        assert command[command.index("--project-name") + 1] == "crate-observability"
        assert Path(command[command.index("--project-directory") + 1]).resolve() == ROOT
        assert command[command.index("--env-file") + 1] == "/dev/null"
        files = [
            command[index + 1] for index, value in enumerate(command) if value == "-f"
        ]
        assert len(files) == 1
        assert Path(files[0]).name == "compose.standalone.yaml"


def test_make_rejects_legacy_application_compose_override_before_any_docker_command(
    tmp_path,
):
    env, log = _fake_cli(tmp_path)
    result = subprocess.run(
        [
            "make",
            "observability-up",
            "OBS_COMPOSE_FILES=docker-compose.yaml docker-compose.project.yaml",
        ],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=15,
    )

    assert result.returncode != 0
    message = result.stdout + result.stderr
    assert "OBS_COMPOSE_FILES" in message
    assert "standalone" in message.lower()
    assert not log.exists() or log.read_text() == ""


@pytest.mark.parametrize("containerd", [False, True])
def test_standalone_resolves_without_application_compose_and_preserves_reviewed_service_settings(
    tmp_path, containerd
):
    standalone = _resolved_config(tmp_path, standalone=True, containerd=containerd)
    legacy = _resolved_config(tmp_path, standalone=False, containerd=containerd)

    assert standalone["name"] == "crate-observability"
    assert set(standalone["services"]) == SERVICES
    assert set(standalone["networks"]) == {"crate", "observability", "observability-ui"}
    assert standalone["networks"]["crate"]["name"] == "fixture-application-network"
    assert standalone["networks"]["crate"]["external"] is True
    assert standalone["networks"]["observability"]["internal"] is True
    assert len(standalone["secrets"]) == 4
    for name in SERVICES:
        actual, previous = standalone["services"][name], legacy["services"][name]
        for key in (
            "image",
            "user",
            "read_only",
            "cap_drop",
            "security_opt",
            "pids_limit",
            "mem_limit",
            "cpus",
            "logging",
            "ports",
            "secrets",
            "volumes",
            "command",
            "environment",
            "tmpfs",
            "healthcheck",
        ):
            assert actual.get(key) == previous.get(key), (name, key)
    prometheus_mounts = standalone["services"]["crate-prometheus"]["volumes"]
    config_mount = next(
        mount
        for mount in prometheus_mounts
        if mount["target"] == "/etc/prometheus/prometheus.yml"
    )
    assert Path(config_mount["source"]) == OBSERVABILITY / "prometheus.yml"
    grafana_mounts = standalone["services"]["crate-grafana"]["volumes"]
    for suffix in ("provisioning", "dashboards"):
        mount = next(
            item
            for item in grafana_mounts
            if item["target"] == f"/etc/grafana/{suffix}"
        )
        assert Path(mount["source"]) == OBSERVABILITY / "grafana" / suffix


def test_make_configuration_ignores_poisoned_application_dotenv(tmp_path):
    _docker_compose()
    fixture = tmp_path / "checkout"
    fixture.mkdir()
    shutil.copy2(ROOT / "Makefile", fixture / "Makefile")
    shutil.copytree(OBSERVABILITY, fixture / "deploy/observability")
    (fixture / ".env").write_text(
        "OBS_GRAFANA_PORT=THIS_APP_DOTENV_MUST_NOT_BE_PARSED\n"
        "OBS_APP_NETWORK=APP_DOTENV_CANARY\n"
    )
    env = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith(("OBS_", "COMPOSE_"))
    }

    result = subprocess.run(
        ["make", "observability-config"],
        cwd=fixture,
        env=env,
        capture_output=True,
        text=True,
        timeout=15,
    )

    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize(
    ("prometheus_project", "grafana_project", "ps_failure", "admitted"),
    [
        ("crate", "", False, False),
        ("", "legacy-monitoring", False, False),
        ("crate-observability", "crate-observability", False, True),
        ("", "", False, True),
        ("", "", True, False),
    ],
)
def test_monitoring_up_refuses_duplicate_writers_or_unknown_running_projects(
    tmp_path, prometheus_project, grafana_project, ps_failure, admitted
):
    env, log = _fake_cli(tmp_path)
    env.update(
        DOCKER_TEST_CRATE_PROMETHEUS=prometheus_project,
        DOCKER_TEST_CRATE_GRAFANA=grafana_project,
        DOCKER_TEST_PS_FAILURE=str(int(ps_failure)),
    )

    result = subprocess.run(
        ["make", "observability-up"],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=15,
    )

    commands = [json.loads(line) for line in log.read_text().splitlines()]
    starts = [
        command for command in commands if command[0] == "compose" and "up" in command
    ]
    assert (result.returncode == 0) is admitted, result.stderr
    assert bool(starts) is admitted
    if admitted:
        first_start = commands.index(starts[0])
        probes = [command for command in commands[:first_start] if command[0] == "ps"]
        assert len(probes) == 2
        assert all(
            "com.docker.compose.service" in " ".join(command) for command in probes
        )


@pytest.mark.parametrize(
    "defect", ["missing-database", "missing-data-dir", "empty-storage"]
)
def test_monitoring_start_requires_explicit_migration_settings_and_existing_storage(
    tmp_path, defect
):
    env, log = _fake_cli(tmp_path)
    if defect == "missing-database":
        env.pop("CRATE_POSTGRES_DB")
    elif defect == "missing-data-dir":
        env.pop("OBS_DATA_DIR")
    else:
        for path in Path(env["OBS_DATA_DIR"]).glob("*/existing-data"):
            path.unlink()
    result = subprocess.run(
        ["make", "observability-up"],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert result.returncode != 0
    commands = [json.loads(line) for line in log.read_text().splitlines()]
    assert not any("up" in command for command in commands)
    assert "preflight" in (result.stdout + result.stderr).lower()


def test_new_empty_monitoring_storage_requires_explicit_initialization(tmp_path):
    env, log = _fake_cli(tmp_path)
    for path in Path(env["OBS_DATA_DIR"]).glob("*/existing-data"):
        path.unlink()
    result = subprocess.run(
        ["make", "observability-up", "OBS_INITIALIZE_EMPTY=1"],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert result.returncode == 0, result.stderr
    assert any("up" in json.loads(line) for line in log.read_text().splitlines())


def test_preflight_resolves_a_dedicated_environment_with_the_actual_compose_parser(
    tmp_path,
):
    _docker_compose()
    state = tmp_path / "preserved monitoring"
    for name in ("prometheus", "grafana"):
        (state / name).mkdir(parents=True)
        (state / name / "data").write_text("previous history")
    environment = tmp_path / "monitoring.env"
    environment.write_text(
        f"OBS_DATA_DIR='{state}'\nOBS_SECRETS_DIR='{tmp_path / 'secrets'}'\nOBS_APP_NETWORK=existing-network\nCRATE_POSTGRES_DB=actual_music_db\n"
    )
    result = subprocess.run(
        ["make", "observability-start-preflight", f"OBS_ENV_FILE={environment}"],
        cwd=ROOT,
        env={
            key: value
            for key, value in os.environ.items()
            if not key.startswith(("OBS_", "COMPOSE_")) and key != "CRATE_POSTGRES_DB"
        },
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert result.returncode == 0, result.stderr
    assert "passed" in result.stdout
    assert "actual_music_db" not in result.stdout + result.stderr


def test_preflight_refuses_the_application_environment_file(tmp_path):
    env, log = _fake_cli(tmp_path)
    result = subprocess.run(
        ["make", "observability-up", f"OBS_ENV_FILE={ROOT / '.env'}"],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert result.returncode != 0
    assert "dedicated monitoring environment" in result.stderr
    assert not any("up" in json.loads(line) for line in log.read_text().splitlines())

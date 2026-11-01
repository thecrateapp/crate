"""Disposable deploy, failed deploy and rollback rehearsal against a real Docker daemon."""

from __future__ import annotations

import base64
import importlib.util
import json
import os
import platform
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
import uuid
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
PREFIX = "deploy/observability/"
PASSWORD = "observability-rehearsal-password"
TOOLING = (
    "scripts/observability_release.py",
    "scripts/observability_preflight.py",
    "scripts/observability-deploy-remote.sh",
)
FLOCK_SHIM = """
import fcntl, sys, time
args = sys.argv[1:]
wait = float(args[args.index("-w") + 1]) if "-w" in args else 0
deadline = time.monotonic() + wait
while True:
    try:
        fcntl.flock(int(args[-1]), fcntl.LOCK_EX | fcntl.LOCK_NB)
        sys.exit(0)
    except BlockingIOError:
        if time.monotonic() >= deadline:
            sys.exit(1)
        time.sleep(0.05)
"""


def _release_module():
    spec = importlib.util.spec_from_file_location(
        "_observability_release_rehearsal", ROOT / "scripts/observability_release.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _run(command, *, env=None, check=True, timeout=120):
    result = subprocess.run(
        command, capture_output=True, text=True, env=env, timeout=timeout
    )
    if check and result.returncode:
        raise AssertionError(f"{command}: {result.stderr}")
    return result


def _git(repository, *args):
    return _run(["git", "-C", str(repository), *args]).stdout.strip()


def _free_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def _container(docker_env, name):
    return _run(
        [
            "docker",
            "inspect",
            "--format",
            "{{.Id}} {{.State.StartedAt}} {{.RestartCount}}",
            name,
        ],
        env=docker_env,
    ).stdout.strip()


def _service_container(docker_env, service):
    return _run(
        [
            "docker",
            "ps",
            "-q",
            "--filter",
            "label=com.docker.compose.project=crate-observability",
            "--filter",
            f"label=com.docker.compose.service={service}",
        ],
        env=docker_env,
    ).stdout.strip()


def _local_docker():
    docker_env = {
        key: os.environ[key]
        for key in ("PATH", "HOME", "DOCKER_CONFIG")
        if key in os.environ
    }
    endpoint = json.loads(
        _run(
            [
                "docker",
                "context",
                "inspect",
                "--format",
                "{{json .Endpoints.docker.Host}}",
            ],
            env=docker_env,
        ).stdout
    )
    if not endpoint.startswith("unix:///"):
        pytest.skip("The rehearsal never connects to remote Docker endpoints")
    docker_env["DOCKER_HOST"] = endpoint
    return docker_env


def _fixture_repository(base, release):
    repository = base / "repo"
    for name in (*TOOLING, *release.BUNDLE_FILES):
        target = repository / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(ROOT / name, target)
    _git(base, "init", "--quiet", str(repository))
    for key, value in (
        ("user.name", "Rehearsal"),
        ("user.email", "rehearsal@example.invalid"),
        ("commit.gpgsign", "false"),
    ):
        _git(repository, "config", key, value)
    prometheus = repository / PREFIX / "prometheus.yml"
    original = prometheus.read_text()
    commits = {}
    for name, content in (
        ("base", original),
        ("config", original + "\n# rehearsal: reviewed change\n"),
        (
            "broken",
            original
            + "\n  - job_name: rehearsal-missing\n"
            + "    static_configs:\n"
            + "      - targets: [crate-rehearsal-missing:9999]\n",
        ),
    ):
        prometheus.write_text(content)
        _git(repository, "add", ".")
        _git(repository, "commit", "--quiet", "--allow-empty", "-m", name)
        commits[name] = _git(repository, "rev-parse", "HEAD")
    return repository, commits, original


@pytest.fixture
def rehearsal(tmp_path_factory):
    if os.environ.get("OBSERVABILITY_RUNTIME_TEST") != "1":
        pytest.skip(
            "Set OBSERVABILITY_RUNTIME_TEST=1 for the disposable deploy rehearsal"
        )
    if not shutil.which("docker"):
        pytest.skip("Docker is required for the deploy rehearsal")
    docker_env = _local_docker()
    metadata = json.loads(
        _run(["docker", "info", "--format", "{{json .}}"], env=docker_env).stdout
    )
    driver = metadata["Driver"]
    if expected := os.environ.get("OBSERVABILITY_EXPECTED_DRIVER"):
        assert driver == expected
    if _run(
        [
            "docker",
            "ps",
            "-aq",
            "--filter",
            "label=com.docker.compose.project=crate-observability",
        ],
        env=docker_env,
    ).stdout.strip():
        pytest.skip("A crate-observability project already exists on this daemon")

    suffix = uuid.uuid4().hex[:8]
    base = tmp_path_factory.mktemp("obs-rehearsal")
    base.chmod(0o755)
    network = f"crate-rehearsal-{suffix}"
    sentinel = f"crate-rehearsal-app-{suffix}"
    server = base / "server"
    app = server / "crate"
    (app / ".deploy").mkdir(parents=True)
    (app / ".env").write_text("APP_SECRET=application-only\n")
    data = server / "data"
    secrets = server / "secrets"
    secrets.mkdir(parents=True)
    for name in ("prometheus", "grafana"):
        (data / name).mkdir(parents=True)
        (data / name).chmod(0o777)
    for directory in (server, data, secrets):
        directory.chmod(0o755)
    for name, content in {
        "grafana-admin-password": PASSWORD,
        "postgres-exporter-password": PASSWORD,
        "redis-cache-passwords.json": json.dumps(
            {"redis://crate-redis:6379": PASSWORD}
        ),
        "redis-durable-passwords.json": json.dumps(
            {"redis://crate-redis-durable:6379": PASSWORD}
        ),
    }.items():
        (secrets / name).write_text(content)
        (secrets / name).chmod(0o444)
    containerd = platform.system() == "Linux" and driver == "overlayfs"
    grafana_port = _free_port()
    env_file = server / "monitoring.env"
    lines = [
        f"OBS_DATA_DIR={data}",
        f"OBS_SECRETS_DIR={secrets}",
        f"OBS_APP_NETWORK={network}",
        "CRATE_POSTGRES_DB=crate",
        f"OBS_GRAFANA_PORT={grafana_port}",
        f"OBS_DOCKER_ROOT={metadata['DockerRootDir']}",
    ]
    if containerd:
        lines.append(f"OBS_CONTAINERD_SOCKET={metadata['Containerd']['Address']}")
    env_file.write_text("\n".join(lines) + "\n")

    release = _release_module()
    repository, commits, original = _fixture_repository(base, release)
    fake_bin = base / "bin"
    fake_bin.mkdir()
    if shutil.which("flock") is None:
        (fake_bin / "flock").write_text(f"#!{sys.executable}\n{FLOCK_SHIM}")
        (fake_bin / "flock").chmod(0o755)
    root = server / "crate-observability"
    legacy_project = f"crate-rehearsal-{suffix}"
    legacy_compose = repository / "docker-compose.legacy.yaml"
    legacy_compose.write_text(
        f"name: {legacy_project}\n"
        "networks:\n"
        "  crate:\n"
        "    external: true\n"
        f"    name: {network}\n"
        "services:\n"
        "  crate-api:\n"
        "    image: busybox:1.37\n"
        "    command: [sleep, '3600']\n"
        "    networks: [crate]\n"
    )
    legacy_command = [
        "docker",
        "compose",
        "--project-name",
        legacy_project,
        "--project-directory",
        str(repository),
        "--env-file",
        str(env_file),
        "-f",
        str(legacy_compose),
        "-f",
        str(repository / PREFIX / "compose.observability.yaml"),
        "--profile",
        "observability",
    ]

    def run(name, action="deploy", **extra):
        sha = commits[name]
        deploy_id = f"obs-{action}-{name}-{uuid.uuid4().hex[:6]}"
        if action in ("deploy", "adopt"):
            staging = root / "staging" / deploy_id
            staging.mkdir(parents=True)
            release.build_bundle(repository, sha, staging / "bundle.tar.gz")
            tools = root / "tooling" / sha
            tools.mkdir(parents=True, exist_ok=True)
            for item in TOOLING:
                shutil.copy(repository / item, tools / Path(item).name)
        active = (
            sha
            if action in ("deploy", "adopt")
            else (root / "state/current").read_text().strip()
        )
        script = root / "tooling" / active / "observability-deploy-remote.sh"
        return _run(
            ["bash", str(script), action],
            env={
                **docker_env,
                "PATH": f"{fake_bin}{os.pathsep}{docker_env['PATH']}",
                "OBS_ROOT": str(root),
                "OBS_ENV_FILE": str(env_file),
                "OBS_DEPLOY_ID": deploy_id,
                "OBS_DEPLOY_SHA": sha,
                "OBS_CONTAINERD": "1" if containerd else "0",
                "OBS_PYTHON": sys.executable,
                "OBS_VERIFY_SECONDS": "240",
                "CRATE_SERVER_PATH": str(app),
                "CRATE_APP_PROJECT": legacy_project,
                **extra,
            },
            check=False,
            timeout=900,
        )

    _run(["docker", "network", "create", network], env=docker_env)
    try:
        _run(
            [
                "docker",
                "run",
                "-d",
                "--name",
                sentinel,
                "--network",
                network,
                "busybox:1.37",
                "sleep",
                "3600",
            ],
            env=docker_env,
            timeout=300,
        )
        yield {
            "run": run,
            "root": root,
            "app": app,
            "commits": commits,
            "docker_env": docker_env,
            "sentinel": sentinel,
            "original": original,
            "legacy": legacy_command,
            "legacy_project": legacy_project,
            "grafana_port": grafana_port,
        }
    finally:
        live = root / "live"
        if live.exists():
            command = [
                "docker",
                "compose",
                "--project-name",
                "crate-observability",
                "--project-directory",
                str(live),
                "--env-file",
                str(env_file),
                "-f",
                str(live / PREFIX / "compose.standalone.yaml"),
            ]
            if containerd:
                command += ["-f", str(live / PREFIX / "compose.containerd.yaml")]
            _run(
                [*command, "--profile", "observability", "down", "--volumes"],
                env=docker_env,
                check=False,
                timeout=300,
            )
        _run(
            [*legacy_command, "down", "--volumes"],
            env=docker_env,
            check=False,
            timeout=300,
        )
        _run(["docker", "rm", "-f", sentinel], env=docker_env, check=False)
        _run(["docker", "network", "rm", network], env=docker_env, check=False)
        _run(
            [
                "docker",
                "run",
                "--rm",
                "-v",
                f"{data}:/data",
                "busybox:1.37",
                "sh",
                "-c",
                "rm -rf /data/prometheus/* /data/grafana/*",
            ],
            env=docker_env,
            check=False,
        )


def test_deploy_failed_deploy_and_rollback_leave_the_application_untouched(rehearsal):
    docker_env = rehearsal["docker_env"]
    commits = rehearsal["commits"]
    root = rehearsal["root"]
    sentinel_before = _container(docker_env, rehearsal["sentinel"])
    live_prometheus = root / "live" / PREFIX / "prometheus.yml"

    first = rehearsal["run"](
        "base", OBS_CONFIRM="first-deploy", OBS_INITIALIZE_EMPTY="1"
    )
    assert first.returncode == 0, first.stderr + first.stdout
    assert (root / "state/current").read_text().strip() == commits["base"]

    grafana = _container(docker_env, _service_container(docker_env, "crate-grafana"))
    prometheus = _container(
        docker_env, _service_container(docker_env, "crate-prometheus")
    )
    config = rehearsal["run"]("config")
    assert config.returncode == 0, config.stderr + config.stdout
    assert (
        _container(docker_env, _service_container(docker_env, "crate-grafana"))
        == grafana
    )
    assert (
        _container(docker_env, _service_container(docker_env, "crate-prometheus"))
        != prometheus
    )
    assert "rehearsal: reviewed change" in live_prometheus.read_text()

    broken = rehearsal["run"]("broken", OBS_VERIFY_SECONDS="75")
    assert broken.returncode == 1
    assert f"Rolled back to {commits['config']}" in broken.stderr, broken.stderr
    assert (root / "state/current").read_text().strip() == commits["config"]
    assert "rehearsal-missing" not in live_prometheus.read_text()

    rolled = rehearsal["run"](
        "config", action="rollback", OBS_CONFIRM="rollback-observability"
    )
    assert rolled.returncode == 0, rolled.stderr + rolled.stdout
    assert (root / "state/current").read_text().strip() == commits["base"]
    assert live_prometheus.read_text() == rehearsal["original"]

    assert _container(docker_env, rehearsal["sentinel"]) == sentinel_before
    assert (rehearsal["app"] / ".env").read_text() == "APP_SECRET=application-only\n"
    assert not (rehearsal["app"] / ".deploy/host-mutation.lease").exists()


def _prometheus_query(docker_env, container, query, at=None):
    url = "http://127.0.0.1:9090/api/v1/query?query=" + query
    if at is not None:
        url += f"&time={at}"
    result = _run(
        ["docker", "exec", container, "wget", "-qO-", url], env=docker_env, check=False
    )
    return json.loads(result.stdout)["data"]["result"] if result.returncode == 0 else []


def _eventually(check, *, seconds=180):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = check()
        if value:
            return value
        time.sleep(3)
    raise AssertionError("condition not reached")


def _grafana(port, method, path, body=None):
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}",
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "Authorization": "Basic "
            + base64.b64encode(f"admin:{PASSWORD}".encode()).decode(),
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return json.loads(response.read() or b"{}")
    except (OSError, ValueError):
        return None


def _legacy_service(rehearsal, service):
    return _run(
        [
            "docker",
            "ps",
            "-aq",
            "--filter",
            f"label=com.docker.compose.project={rehearsal['legacy_project']}",
            "--filter",
            f"label=com.docker.compose.service={service}",
        ],
        env=rehearsal["docker_env"],
    ).stdout.strip()


def _status(docker_env, container):
    return _run(
        ["docker", "inspect", "--format", "{{.State.Status}}", container],
        env=docker_env,
        check=False,
    ).stdout.strip()


def test_adoption_keeps_history_and_grafana_state_then_reverts_and_retires(rehearsal):
    docker_env = rehearsal["docker_env"]
    port = rehearsal["grafana_port"]
    _run([*rehearsal["legacy"], "up", "-d"], env=docker_env, timeout=600)
    legacy_prometheus = _legacy_service(rehearsal, "crate-prometheus")
    _eventually(lambda: _prometheus_query(docker_env, legacy_prometheus, "up"))
    before = int(time.time())
    _eventually(lambda: _grafana(port, "GET", "/api/health"))
    marker = _grafana(port, "POST", "/api/folders", {"title": "adoption-marker"})
    assert marker and marker.get("uid")
    app = _legacy_service(rehearsal, "crate-api")
    app_before = _container(docker_env, app)

    adopted = rehearsal["run"](
        "base", action="adopt", OBS_CONFIRM="adopt-legacy-monitoring"
    )

    assert adopted.returncode == 0, adopted.stderr + adopted.stdout
    assert "Application containers unchanged" in adopted.stdout
    prometheus = _service_container(docker_env, "crate-prometheus")
    assert _prometheus_query(docker_env, prometheus, "up", at=before)
    assert _grafana(port, "GET", f"/api/folders/{marker['uid']}")
    assert _grafana(port, "GET", "/api/datasources/uid/crate-prometheus")
    assert _status(docker_env, legacy_prometheus) == "exited"
    assert _container(docker_env, app) == app_before

    reverted = rehearsal["run"](
        "base", action="revert-adoption", OBS_CONFIRM="revert-adoption"
    )
    assert reverted.returncode == 0, reverted.stderr + reverted.stdout
    assert _status(docker_env, legacy_prometheus) == "running"
    _eventually(lambda: _grafana(port, "GET", f"/api/folders/{marker['uid']}"))

    readopted = rehearsal["run"](
        "base", action="adopt", OBS_CONFIRM="adopt-legacy-monitoring"
    )
    assert readopted.returncode == 0, readopted.stderr + readopted.stdout
    retired = rehearsal["run"](
        "base", action="retire-legacy", OBS_CONFIRM="retire-legacy-monitoring"
    )
    assert retired.returncode == 0, retired.stderr + retired.stdout
    assert _status(docker_env, legacy_prometheus) == ""
    assert _grafana(port, "GET", f"/api/folders/{marker['uid']}")
    assert _container(docker_env, app) == app_before
    assert (rehearsal["root"] / "state/legacy.retired").exists()

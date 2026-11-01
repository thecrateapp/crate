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
PREFIX = "deploy/observability/"
BUNDLE_FILES = (
    "compose.standalone.yaml",
    "compose.observability.yaml",
    "compose.containerd.yaml",
    "prometheus.yml",
    "docker-proxy.haproxy.cfg",
    "runtime-proxy.haproxy.cfg",
    "grafana/provisioning/dashboards/infrastructure.yaml",
    "grafana/provisioning/datasources/prometheus.yaml",
    "grafana/dashboards/infra-runtime.json",
    "grafana/dashboards/infra-data.json",
)
SCRIPTS = (
    "scripts/observability_release.py",
    "scripts/observability_preflight.py",
    "scripts/observability-deploy-remote.sh",
    "scripts/observability-deploy.sh",
)
HOST_LOCK_FUNCTIONS = (
    "host_lock_acquire",
    "host_lease_field",
    "host_lease_refuse_other",
    "host_guard",
    "cmd_host_lock",
    "cmd_host_unlock",
)
UNHEALTHY = "\n# fake: unhealthy\n"

FAKE_DOCKER = r"""
import json, os, subprocess, sys
from pathlib import Path

import yaml

argv = sys.argv[1:]
state_path = Path(os.environ["FAKE_STATE"])
state = json.loads(state_path.read_text()) if state_path.exists() else {"containers": {}, "present": []}
with open(os.environ["FAKE_LOG"], "a") as log:
    log.write(json.dumps(argv) + "\n")

def save():
    state_path.write_text(json.dumps(state))

def env_file(path):
    values = {}
    for line in Path(path).read_text().splitlines():
        key, _, value = line.partition("=")
        if key:
            values[key] = value
    return values

if argv[0] == "info":
    print(os.environ.get("FAKE_DRIVER", "overlay2"))
elif argv[0] == "ps":
    service = argv[argv.index("--filter") + 1].split("=")[-1]
    legacy = os.environ.get("FAKE_LEGACY_PROJECT")
    if legacy and service in ("crate-prometheus", "crate-grafana"):
        print(legacy)
elif argv[:2] == ["image", "inspect"]:
    sys.exit(0 if argv[2] in state["present"] else 1)
elif argv[0] == "pull":
    state["present"].append(argv[-1])
    save()
elif argv[0] == "inspect":
    container = state["containers"].get(argv[-1].removeprefix("id-"), {})
    print("running " if container.get("running") else "exited ")
elif argv[0] == "run":
    mounts = {}
    for index, item in enumerate(argv):
        if item == "-v":
            host, inside = argv[index + 1].split(":")[:2]
            mounts[inside] = host
    script = argv[-1].replace("/src", mounts["/src"]).replace("/dst", mounts["/dst"])
    sys.exit(subprocess.run(["sh", "-c", script]).returncode)
elif argv[0] == "compose":
    project = Path(argv[argv.index("--project-directory") + 1])
    environment = env_file(argv[argv.index("--env-file") + 1])
    command = argv[argv.index("--profile") + 2 :]
    images = {
        name: service["image"]
        for name, service in yaml.safe_load(
            (project / "deploy/observability/compose.observability.yaml").read_text()
        )["services"].items()
    }
    if command[:2] == ["config", "--environment"]:
        for key, value in environment.items():
            print(f"{key}={value}")
    elif command[0] == "up":
        for name in [item for item in command[1:] if item.startswith("crate-")]:
            container = state["containers"].get(name)
            if container is None or container["image"] != images[name]:
                if container and name == "crate-grafana" and images[name].endswith("e" * 64):
                    data = Path(environment["OBS_DATA_DIR"]) / "grafana"
                    (data / "migrated-by-new-image").write_text(images[name])
                state["containers"][name] = {"image": images[name], "running": True}
            state["containers"][name]["running"] = True
        save()
    elif command[0] == "stop":
        for name in command[1:]:
            if name in state["containers"]:
                state["containers"][name]["running"] = False
        save()
    elif command[:2] == ["ps", "-q"]:
        if command[2] in state["containers"]:
            print("id-" + command[2])
    elif command[0] == "exec":
        url = command[-1]
        if url.endswith("/-/ready"):
            print("Prometheus is Ready.")
        else:
            unhealthy = "fake: unhealthy" in (project / "deploy/observability/prometheus.yml").read_text()
            health = "down" if unhealthy else "up"
            print(json.dumps({"data": {"activeTargets": [{"health": health}]}}))
    elif command[0] == "port":
        print("127.0.0.1:3001")
"""

FAKE_SSH = r"""
import os, subprocess, sys
with open(os.environ["FAKE_LOG"], "a") as log:
    log.write('["ssh"]\n')
sys.exit(subprocess.run(["bash", "-c", sys.argv[-1]]).returncode)
"""

FAKE_SCP = r"""
import shutil, sys
from pathlib import Path
paths = [item for item in sys.argv[1:] if not item.startswith("-")]
*sources, target = paths
target = Path(target.split(":", 1)[1])
for source in sources:
    shutil.copy(source, target / Path(source).name if len(sources) > 1 else target)
"""

FLOCK_SHIM = r"""
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


def _git(repository, *args):
    return subprocess.run(
        ["git", "-C", str(repository), *args],
        check=True,
        capture_output=True,
        text=True,
        env={
            **os.environ,
            "GIT_AUTHOR_DATE": "2026-11-01T12:00:00+00:00",
            "GIT_COMMITTER_DATE": "2026-11-01T12:00:00+00:00",
        },
    ).stdout.strip()


def _executable(path: Path, body: str) -> None:
    path.write_text(f"#!{sys.executable}\n{body}")
    path.chmod(0o755)


class Lab:
    def __init__(self, tmp_path: Path):
        self.tmp = tmp_path
        self.repo = tmp_path / "repo"
        self.server = tmp_path / "server"
        self.root = self.server / "crate-observability"
        self.app = self.server / "crate"
        self.data = self.server / "data"
        self.log = tmp_path / "docker.jsonl"
        self.bin = tmp_path / "bin"
        self.commits: dict[str, str] = {}
        self.runs = 0
        self._repository()
        self._server()
        self._fakes()

    def _repository(self):
        self.repo.mkdir()
        for name in SCRIPTS:
            target = self.repo / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(ROOT / name, target)
        for name in BUNDLE_FILES:
            target = self.repo / PREFIX / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(ROOT / PREFIX / name, target)
        _git(self.repo, "init", "--quiet")
        _git(self.repo, "config", "user.name", "Fixture Author")
        _git(self.repo, "config", "user.email", "fixture@example.invalid")
        _git(self.repo, "config", "commit.gpgsign", "false")
        self.prometheus = (self.repo / PREFIX / "prometheus.yml").read_text()
        self.compose = (self.repo / PREFIX / "compose.observability.yaml").read_text()
        grafana = yaml.safe_load(self.compose)["services"]["crate-grafana"]["image"]
        self.grafana_image = grafana
        self.upgraded_grafana = grafana.split("@sha256:")[0] + "@sha256:" + "e" * 64
        self.commit("base")
        self.commit("config", prometheus_suffix="\n# reviewed change\n")
        self.commit("broken", prometheus_suffix=UNHEALTHY)
        self.commit("upgrade", upgrade_grafana=True)
        self.commit("broken-upgrade", prometheus_suffix=UNHEALTHY, upgrade_grafana=True)
        _git(self.repo, "update-ref", "refs/remotes/origin/main", "HEAD")
        self.commit("unreviewed", prometheus_suffix="\n# not on main\n")

    def commit(self, name, *, prometheus_suffix="", upgrade_grafana=False):
        (self.repo / PREFIX / "prometheus.yml").write_text(
            self.prometheus + prometheus_suffix
        )
        compose = self.compose
        if upgrade_grafana:
            compose = compose.replace(self.grafana_image, self.upgraded_grafana)
        (self.repo / PREFIX / "compose.observability.yaml").write_text(compose)
        _git(self.repo, "add", ".")
        _git(self.repo, "commit", "--quiet", "--allow-empty", "-m", f"test: {name}")
        self.commits[name] = _git(self.repo, "rev-parse", "HEAD")

    def _server(self):
        (self.app / ".deploy").mkdir(parents=True)
        (self.app / ".env").write_text("APP_SECRET=application-only\n")
        (self.app / "docker-compose.yaml").write_text("services: {}\n")
        (self.data / "prometheus").mkdir(parents=True)
        (self.data / "prometheus" / "chunks").write_text("tsdb")
        (self.data / "grafana").mkdir(parents=True)
        (self.data / "grafana" / "grafana.db").write_text("dashboards")
        self.env_file = self.server / "monitoring.env"
        self.env_file.write_text(
            f"OBS_DATA_DIR={self.data}\nOBS_SECRETS_DIR={self.server / 'secrets'}\n"
            "OBS_APP_NETWORK=crate\nCRATE_POSTGRES_DB=crate\n"
        )

    def _fakes(self):
        self.bin.mkdir()
        _executable(self.bin / "docker", FAKE_DOCKER)
        _executable(self.bin / "ssh", FAKE_SSH)
        _executable(self.bin / "scp", FAKE_SCP)
        (self.bin / "curl").write_text("#!/bin/sh\nexit 0\n")
        (self.bin / "curl").chmod(0o755)
        if shutil.which("flock") is None:
            _executable(self.bin / "flock", FLOCK_SHIM)

    def run(self, action, version=None, **overrides):
        self.runs += 1
        environment = {
            **os.environ,
            "PATH": f"{self.bin}{os.pathsep}{os.environ['PATH']}",
            "FAKE_LOG": str(self.log),
            "FAKE_STATE": str(self.tmp / "docker-state.json"),
            "SERVER_PATH": str(self.app),
            "OBS_REMOTE_ROOT": str(self.root),
            "OBS_REMOTE_ENV_FILE": str(self.env_file),
            "OBS_PYTHON": sys.executable,
            "OBS_DEPLOY_ID": f"obs-{action}-{self.runs}",
            "OBS_VERIFY_SECONDS": "1",
            "OBS_VERIFY_INTERVAL": "0",
            "HOST_LOCK_WAIT_SECONDS": "1",
        }
        if version:
            environment["OBS_DEPLOY_SHA"] = self.commits[version]
        environment.update(overrides)
        return subprocess.run(
            ["bash", str(self.repo / "scripts/observability-deploy.sh"), action],
            env=environment,
            capture_output=True,
            text=True,
            timeout=120,
        )

    def calls(self):
        if not self.log.exists():
            return []
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def compose_calls(self):
        return [
            call[call.index("--profile") + 2 :]
            for call in self.calls()
            if call[0] == "compose"
        ]

    def state(self, name):
        path = self.root / "state" / name
        return path.read_text().strip() if path.exists() else None

    def live_prometheus(self):
        return (self.root / "live" / PREFIX / "prometheus.yml").read_text()

    def deploy(self, version, **overrides):
        result = self.run("deploy", version, **overrides)
        assert result.returncode == 0, result.stderr
        return result


@pytest.fixture
def lab(tmp_path):
    return Lab(tmp_path)


def test_first_deploy_needs_confirmation_and_touches_only_monitoring(lab):
    refused = lab.run("deploy", "base")
    assert refused.returncode == 1
    assert "OBS_CONFIRM=first-deploy" in refused.stderr
    assert not any(call[0] == "up" for call in lab.compose_calls())

    lab.deploy("base", OBS_CONFIRM="first-deploy", OBS_DEPLOY_ID="obs-first")

    assert lab.state("current") == lab.commits["base"]
    assert lab.state("previous") == ""
    assert lab.live_prometheus() == lab.prometheus
    composes = [call for call in lab.calls() if call[0] == "compose"]
    assert composes and all(
        call[call.index("--project-name") + 1] == "crate-observability"
        for call in composes
    )
    assert all(f"{lab.app}{os.sep}" not in " ".join(call) for call in composes)
    assert not any(
        word in call for call in lab.compose_calls() for word in ("down", "rm")
    )
    assert (lab.app / ".env").read_text() == "APP_SECRET=application-only\n"
    assert not (lab.root / "staging/obs-first").exists()


def test_config_change_restarts_only_the_service_that_mounts_it(lab):
    lab.deploy("base", OBS_CONFIRM="first-deploy")
    lab.log.unlink()

    lab.deploy("config")

    restarts = [call for call in lab.compose_calls() if call[0] == "restart"]
    assert restarts == [["restart", "crate-prometheus"]]
    assert lab.state("previous") == lab.commits["base"]
    assert lab.state("current") == lab.commits["config"]
    assert "# reviewed change" in lab.live_prometheus()
    history = (lab.root / "state/history").read_text().splitlines()
    assert [line.split()[-1] for line in history] == [
        lab.commits["base"],
        lab.commits["config"],
    ]


def test_failed_verification_restores_the_previous_configuration(lab):
    lab.deploy("base", OBS_CONFIRM="first-deploy")
    lab.deploy("config")

    result = lab.run("deploy", "broken")

    assert result.returncode == 1
    assert f"Rolled back to {lab.commits['config']}" in result.stderr
    assert lab.state("current") == lab.commits["config"]
    assert "# reviewed change" in lab.live_prometheus()
    assert "fake: unhealthy" not in lab.live_prometheus()


def test_stateful_upgrade_backs_up_state_and_restores_it_when_verification_fails(lab):
    lab.deploy("base", OBS_CONFIRM="first-deploy")
    grafana = lab.data / "grafana"

    result = lab.run("deploy", "broken-upgrade", OBS_DEPLOY_ID="obs-broken-upgrade")

    assert result.returncode == 1, result.stderr
    backup = lab.root / "backups/obs-broken-upgrade/crate-grafana"
    assert (backup / "grafana.db").read_text() == "dashboards"
    assert sorted(path.name for path in grafana.iterdir()) == ["grafana.db"]
    assert lab.state("current") == lab.commits["base"]
    state = json.loads((lab.tmp / "docker-state.json").read_text())
    assert state["containers"]["crate-grafana"]["image"] == lab.grafana_image

    lab.log.unlink()
    lab.deploy("upgrade", OBS_DEPLOY_ID="obs-upgrade")

    assert (lab.root / "backups/obs-upgrade/crate-grafana/grafana.db").exists()
    assert (grafana / "migrated-by-new-image").exists()
    assert lab.state("current.backup") == str(lab.root / "backups/obs-upgrade")
    stops = [call for call in lab.compose_calls() if call[0] == "stop"]
    assert stops == [["stop", "crate-grafana"]]


def test_manual_rollback_needs_confirmation_and_refuses_stateful_downgrade(lab):
    lab.deploy("base", OBS_CONFIRM="first-deploy")
    lab.deploy("config")

    assert lab.run("rollback").returncode == 1
    rolled = lab.run("rollback", OBS_CONFIRM="rollback-observability")

    assert rolled.returncode == 0, rolled.stderr
    assert lab.state("current") == lab.commits["base"]
    assert lab.state("previous") == lab.commits["config"]
    assert "# reviewed change" not in lab.live_prometheus()

    lab.deploy("upgrade")
    downgrade = lab.run("rollback", OBS_CONFIRM="rollback-observability")
    assert downgrade.returncode == 1
    assert "migrated state" in downgrade.stderr
    assert lab.state("current") == lab.commits["upgrade"]


def test_held_lease_or_live_drift_refuse_before_any_monitoring_change(lab):
    lab.deploy("base", OBS_CONFIRM="first-deploy")
    lease = lab.app / ".deploy/host-mutation.lease"
    lease.write_text("owner=20261101-120000\nsince=2026-11-01T12:00:00Z\n")
    lab.log.unlink()

    held = lab.run("deploy", "config")

    assert held.returncode == 1
    assert "held by 20261101-120000" in held.stderr
    assert not any(call[0] in {"up", "restart", "stop"} for call in lab.compose_calls())

    lease.unlink()
    live = lab.root / "live" / PREFIX / "prometheus.yml"
    live.write_text(live.read_text() + "# edited on the host\n")
    drifted = lab.run("deploy", "config")

    assert drifted.returncode == 1
    assert "drifted" in drifted.stderr
    assert lab.state("current") == lab.commits["base"]
    assert not any(call[0] in {"up", "restart", "stop"} for call in lab.compose_calls())


def test_only_main_revisions_leave_the_workstation(lab):
    result = lab.run("deploy", "unreviewed", OBS_CONFIRM="first-deploy")

    assert result.returncode == 1
    assert "is not on origin/main" in result.stderr
    assert lab.calls() == []


def test_legacy_monitoring_writers_block_the_first_deploy(lab):
    result = lab.run(
        "deploy", "base", OBS_CONFIRM="first-deploy", FAKE_LEGACY_PROJECT="crate"
    )

    assert result.returncode == 1
    assert "another project" in result.stderr
    assert lab.state("current") is None
    assert not any(call[0] == "up" for call in lab.compose_calls())


def test_redeploying_the_active_release_only_verifies(lab):
    lab.deploy("base", OBS_CONFIRM="first-deploy")
    lab.log.unlink()

    result = lab.deploy("base")

    assert "already active" in result.stdout
    assert not any(call[0] in {"up", "restart", "stop"} for call in lab.compose_calls())


def test_status_reports_release_and_drift(lab):
    lab.deploy("base", OBS_CONFIRM="first-deploy")

    result = lab.run("status")

    assert result.returncode == 0, result.stderr
    assert f"current={lab.commits['base']}" in result.stdout
    assert "live=matches" in result.stdout


def _function(path: Path, name: str) -> str:
    script = path.read_text()
    start = script.index(f"{name}() {{")
    return script[start : script.index("\n}\n", start) + 3]


def test_both_remote_scripts_share_one_host_lock_implementation():
    application = ROOT / "scripts/deploy-remote.sh"
    observability = ROOT / "scripts/observability-deploy-remote.sh"
    for name in HOST_LOCK_FUNCTIONS:
        assert _function(application, name) == _function(observability, name), name
    assert 'HOST_LOCK_DIR="${SERVER_PATH}/.deploy"' in application.read_text()
    assert 'HOST_LOCK_DIR="${CRATE_SERVER_PATH}/.deploy"' in observability.read_text()

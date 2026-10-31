"""Optional infrastructure monitoring cannot change Crate's runtime contract."""

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
OBSERVABILITY = ROOT / "deploy/observability"
OVERLAY = OBSERVABILITY / "compose.observability.yaml"
REQUIRED_SERVICES = {
    "crate-prometheus",
    "crate-grafana",
    "crate-node-exporter",
    "crate-postgres-exporter",
    "crate-redis-exporter",
    "crate-redis-durable-exporter",
    "crate-cadvisor",
}


def _overlay():
    assert OVERLAY.is_file(), "The opt-in observability overlay must exist"
    return yaml.safe_load(OVERLAY.read_text())


def _command(service):
    command = service.get("command", [])
    return " ".join(command) if isinstance(command, list) else command


def _environment(service):
    environment = service.get("environment", {})
    if isinstance(environment, list):
        return dict(entry.split("=", 1) for entry in environment)
    return environment


def _mounts(service):
    mounts = []
    for mount in service.get("volumes", []):
        if isinstance(mount, dict):
            mounts.append(mount)
        else:
            # A source can contain Compose interpolation with a colon.
            parts = mount.rsplit(":", 2)
            if parts[-1] in {"ro", "rw", "ro,rslave", "rw,rslave"}:
                source, target, mode = parts
            else:
                source, target = mount.rsplit(":", 1)
                mode = "rw"
            mounts.append(
                {"source": source, "target": target, "read_only": "ro" in mode}
            )
    return mounts


def _memory_bytes(value):
    if isinstance(value, int):
        return value
    match = re.fullmatch(r"([0-9.]+)([kmgt]?)(?:i?b)?", value, re.IGNORECASE)
    assert match, f"Unsupported memory limit: {value}"
    exponent = " kmgt".index(match.group(2).lower()) if match.group(2) else 0
    return float(match.group(1)) * 1024**exponent


def test_monitoring_services_are_optional_and_images_are_immutable():
    services = _overlay()["services"]
    assert REQUIRED_SERVICES <= services.keys()
    for name, service in services.items():
        assert service["profiles"] == ["observability"], name
        assert re.fullmatch(r"[^\s]+:[^:@/]+@sha256:[a-f0-9]{64}", service["image"]), (
            name
        )
        assert ":latest@" not in service["image"], name
        assert not service.get("container_name"), name
        assert not service.get("privileged"), name
        labels = service.get("labels", {})
        if isinstance(labels, list):
            labels = dict(label.split("=", 1) for label in labels)
        assert str(labels.get("traefik.enable", "false")).lower() == "false", name


def test_only_grafana_has_a_loopback_published_port():
    for name, service in _overlay()["services"].items():
        ports = service.get("ports", [])
        if name == "crate-grafana":
            assert len(ports) == 1
            port = ports[0]
            if isinstance(port, dict):
                assert port["host_ip"] == "127.0.0.1"
            else:
                assert port.startswith("127.0.0.1:")
        else:
            assert not ports, name


def test_only_grafana_uses_the_non_internal_ui_network():
    overlay = _overlay()
    assert overlay["networks"]["observability"]["internal"] is True
    assert not overlay["networks"]["observability-ui"].get("internal", False)
    for name, service in overlay["services"].items():
        assert ("observability-ui" in service["networks"]) is (name == "crate-grafana")


def _fake_monitoring_cli(
    tmp_path,
    driver,
    resolved_socket="/run/containerd/containerd.sock",
    readlink_ok=True,
):
    calls = tmp_path / "docker-calls.jsonl"
    docker = tmp_path / "docker"
    docker.write_text(
        f"#!{sys.executable}\n"
        "import json, os, sys\n"
        "with open(os.environ['FAKE_DOCKER_LOG'], 'a') as output:\n"
        "    output.write(json.dumps(sys.argv[1:]) + '\\n')\n"
        "    if sys.argv[1] == 'compose':\n"
        "        socket = os.environ.get('OBS_CONTAINERD_SOCKET', '/outside/from-dotenv.sock')\n"
        "        output.write(json.dumps(['compose-socket', socket]) + '\\n')\n"
        "if sys.argv[1] == 'info':\n"
        "    print(os.environ['FAKE_DOCKER_DRIVER'])\n"
        "elif sys.argv[1] != 'compose':\n"
        "    sys.exit(2)\n"
    )
    readlink = tmp_path / "readlink"
    readlink.write_text(
        f"#!{sys.executable}\n"
        "import json, os, sys\n"
        "with open(os.environ['FAKE_DOCKER_LOG'], 'a') as output:\n"
        "    output.write(json.dumps(['readlink', *sys.argv[1:]]) + '\\n')\n"
        "if os.environ['FAKE_READLINK_OK'] != '1':\n"
        "    sys.exit(1)\n"
        "print(os.environ['FAKE_RESOLVED_SOCKET'])\n"
    )
    docker.chmod(0o755)
    readlink.chmod(0o755)
    return calls, {
        "PATH": str(tmp_path) + os.pathsep + os.defpath,
        "FAKE_DOCKER_LOG": str(calls),
        "FAKE_DOCKER_DRIVER": driver,
        "FAKE_READLINK_OK": str(int(readlink_ok)),
        "FAKE_RESOLVED_SOCKET": resolved_socket,
    }


@pytest.mark.parametrize(
    "driver,containerd,admitted",
    [
        ("overlay2", False, True),
        ("overlayfs", False, False),
        ("unknown", False, False),
        ("overlayfs", True, True),
        ("overlay2", True, False),
        ("unknown", True, False),
    ],
)
def test_monitoring_start_rejects_unreviewed_storage_drivers(
    tmp_path, driver, containerd, admitted
):
    calls, environment = _fake_monitoring_cli(tmp_path, driver)
    result = subprocess.run(
        [
            shutil.which("make") or "make",
            "observability-up",
            f"OBS_CONTAINERD={int(containerd)}",
        ],
        cwd=ROOT,
        env=environment,
        capture_output=True,
        text=True,
        timeout=15,
    )
    commands = [json.loads(line) for line in calls.read_text().splitlines()]
    starts = [
        command for command in commands if command[0] == "compose" and "up" in command
    ]
    assert (result.returncode == 0) is admitted, result.stderr
    assert bool(starts) is admitted
    if admitted:
        assert "--no-deps" in starts[0]
        if containerd:
            assert all(
                "deploy/observability/compose.containerd.yaml" in command
                for command in starts
            )
            proxy = next(
                index
                for index, command in enumerate(starts)
                if "--wait" in command and "crate-observability-docker-proxy" in command
            )
            cadvisor = next(
                index
                for index, command in enumerate(starts)
                if "crate-cadvisor" in command
            )
            assert proxy < cadvisor
        else:
            assert all(
                "deploy/observability/compose.containerd.yaml" not in command
                for command in starts
            )
    else:
        assert "no services started" in result.stdout


@pytest.mark.parametrize(
    "socket,resolved,readlink_ok,admitted",
    [
        (
            "/run/containerd/containerd.sock",
            "/run/containerd/containerd.sock",
            True,
            True,
        ),
        (
            "/var/lib/containerd/containerd.sock",
            "/var/lib/containerd/containerd.sock",
            True,
            False,
        ),
        ("/run/escape.sock", "/opt/containerd.sock", True, False),
        ("/run/missing.sock", "", False, False),
    ],
)
def test_containerd_start_rejects_socket_paths_outside_masked_run(
    tmp_path, socket, resolved, readlink_ok, admitted
):
    calls, environment = _fake_monitoring_cli(
        tmp_path, "overlayfs", resolved, readlink_ok
    )
    result = subprocess.run(
        [shutil.which("make") or "make", "observability-up", "OBS_CONTAINERD=1"],
        cwd=ROOT,
        env={**environment, "OBS_CONTAINERD_SOCKET": socket},
        capture_output=True,
        text=True,
        timeout=15,
    )
    commands = [json.loads(line) for line in calls.read_text().splitlines()]
    assert ["readlink", "-f", socket] in commands
    starts = [
        command for command in commands if command[0] == "compose" and "up" in command
    ]
    assert (result.returncode == 0) is admitted, result.stderr
    if admitted:
        assert len(starts) == 2
        assert "--wait" in starts[0] and "crate-observability-docker-proxy" in starts[0]
        assert "crate-cadvisor" in starts[1]
    else:
        assert not starts
        assert "no services started" in result.stdout


@pytest.mark.parametrize("source", ["default", "command-line", "environment"])
def test_compose_uses_the_same_socket_path_as_the_admission_guard(tmp_path, source):
    expected = {
        "default": "/run/containerd/containerd.sock",
        "command-line": "/run/containerd/command-line.sock",
        "environment": "/run/containerd/environment.sock",
    }[source]
    calls, environment = _fake_monitoring_cli(tmp_path, "overlayfs", expected)
    command = [shutil.which("make") or "make", "observability-up", "OBS_CONTAINERD=1"]
    if source == "environment":
        environment["OBS_CONTAINERD_SOCKET"] = expected
    elif source == "command-line":
        environment["OBS_CONTAINERD_SOCKET"] = "/run/containerd/overridden.sock"
        command.append(f"OBS_CONTAINERD_SOCKET={expected}")
    result = subprocess.run(
        command,
        cwd=ROOT,
        env=environment,
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert result.returncode == 0, result.stderr
    commands = [json.loads(line) for line in calls.read_text().splitlines()]
    assert ["readlink", "-f", expected] in commands
    sockets = [row[1] for row in commands if row[0] == "compose-socket"]
    assert sockets and all(socket == expected for socket in sockets)


def test_monitoring_has_bounded_cpu_memory_and_rotated_logs():
    services = _overlay()["services"]
    assert (
        sum(_memory_bytes(service["mem_limit"]) for service in services.values())
        <= 1024**3
    )
    assert sum(float(service["cpus"]) for service in services.values()) <= 1.000001
    for name, service in services.items():
        logging = service["logging"]
        assert logging["driver"] == "local", name
        assert logging["options"]["max-size"] and logging["options"]["max-file"], name


def test_c0_reallocates_memory_without_increasing_the_monitoring_budget():
    services = _overlay()["services"]
    assert _memory_bytes(services["crate-prometheus"]["mem_limit"]) == 256 * 1024**2
    assert _memory_bytes(services["crate-grafana"]["mem_limit"]) == 384 * 1024**2
    assert (
        sum(_memory_bytes(service["mem_limit"]) for service in services.values())
        == 944 * 1024**2
    )
    assert sum(
        float(service["cpus"]) for service in services.values()
    ) == pytest.approx(1.0)


@pytest.mark.parametrize("name", ["crate-prometheus", "crate-grafana"])
def test_persistent_monitoring_data_uses_configurable_var_storage(name):
    service = _overlay()["services"][name]
    target = "/prometheus" if name == "crate-prometheus" else "/var/lib/grafana"
    data = next(mount for mount in _mounts(service) if mount["target"] == target)
    assert "OBS_DATA_DIR" in data["source"]
    assert re.search(r"\$\{OBS_DATA_DIR:-/var/", data["source"])


def test_prometheus_retains_history_with_a_disk_cap_and_no_public_admin_api():
    command = _command(_overlay()["services"]["crate-prometheus"])
    assert "--storage.tsdb.retention.time=90d" in command
    assert "--storage.tsdb.retention.size=10GB" in command
    assert "--web.enable-admin-api" not in command
    assert "--web.enable-remote-write-receiver" not in command


def test_exporters_use_file_secrets_and_distinguish_both_redis_roles():
    services = _overlay()["services"]
    postgres = services["crate-postgres-exporter"]
    command = _command(postgres)
    environment = _environment(postgres)
    assert (
        "--datasource.pass-file=" in command or "DATA_SOURCE_PASS_FILE" in environment
    )
    assert "DATA_SOURCE_PASS" not in environment
    assert "DATA_SOURCE_NAME" not in environment
    assert not re.search(
        r"--collector\.stat_statements\.include_query(?:=true)?(?:\s|$)", command
    )
    targets = []
    for name in ("crate-redis-exporter", "crate-redis-durable-exporter"):
        service = services[name]
        command = _command(service)
        environment = _environment(service)
        assert (
            "--redis.password-file=" in command or "REDIS_PASSWORD_FILE" in environment
        )
        assert "REDIS_PASSWORD" not in environment
        assert not re.search(r"--redis\.password=", command)
        assert not re.search(r"redis://[^\s]*@", command + str(environment))
        targets.append(command + str(environment))
    assert "crate-redis:6379" in targets[0]
    assert "crate-redis-durable:6379" in targets[1]


def test_cadvisor_is_bounded_and_cannot_access_an_unfiltered_docker_socket():
    services = _overlay()["services"]
    service = services["crate-cadvisor"]
    command = _command(service)
    assert "--housekeeping_interval=30s" in command
    assert "--docker_only=true" in command
    assert "--store_container_labels=false" in command
    assert "--enable_metrics=" in command or "--disable_metrics=" in command
    for name, candidate in services.items():
        if name == "crate-observability-docker-proxy":
            continue
        for mount in _mounts(candidate):
            assert not mount["source"].endswith("docker.sock"), name
            assert mount["source"] not in {"/var/run", "/run"}, name


@pytest.mark.parametrize(
    "method,path,expected",
    [
        ("GET", "/_ping", True),
        ("GET", "/version", True),
        ("GET", "/v1.47/info", True),
        ("GET", "/events", True),
        ("GET", "/v1.47/containers/json", True),
        ("GET", "/containers/" + "a" * 64 + "/json", True),
        ("GET", "/images/sha256:" + "b" * 64 + "/json", True),
        ("POST", "/containers/create", False),
        ("POST", "/containers/" + "a" * 64 + "/start", False),
        ("DELETE", "/containers/" + "a" * 64, False),
        ("POST", "/containers/json", False),
        ("HEAD", "/info", False),
        ("GET", "/containers/" + "a" * 64 + "/logs", False),
        ("GET", "/v1.47/containers/" + "a" * 64 + "/archive", False),
        ("GET", "/containers/" + "a" * 64 + "/export", False),
        ("GET", "/images/sha256:" + "b" * 64 + "/get", False),
        ("GET", "/secrets", False),
    ],
)
def test_docker_proxy_only_allows_observation(method, path, expected):
    config = (OBSERVABILITY / "docker-proxy.haproxy.cfg").read_text()
    gates = [
        line.strip() for line in config.splitlines() if "http-request deny" in line
    ]
    assert len(gates) == 1
    assert "deny unless { method GET }" in gates[0]
    pattern = gates[0].split("{ path -m reg ", 1)[1].removesuffix(" }")
    allowed = method == "GET" and re.fullmatch(pattern, path) is not None
    assert allowed is expected


def test_prometheus_scrapes_only_infrastructure_with_bounded_intervals():
    _overlay()
    config = yaml.safe_load((OBSERVABILITY / "prometheus.yml").read_text())
    assert config["global"]["scrape_interval"] in {"15s", "30s"}
    jobs = config["scrape_configs"]
    targets = {
        target
        for job in jobs
        for group in job.get("static_configs", [])
        for target in group["targets"]
    }
    assert {
        "crate-node-exporter:9100",
        "crate-cadvisor:8080",
        "crate-postgres-exporter:9187",
        "crate-redis-exporter:9121",
        "crate-redis-durable-exporter:9121",
    } <= targets
    assert all(
        not target.startswith(("crate-api:", "crate-worker:")) for target in targets
    )
    for job in jobs:
        assert job.get("scrape_interval", config["global"]["scrape_interval"]) in {
            "15s",
            "30s",
            "60s",
        }
    assert not config.get("alerting"), "PR0 is shadow-only, without notification routes"


@pytest.mark.parametrize(
    "service,expected",
    [
        ("crate-api", True),
        ("crate-cadvisor", True),
        ("nginx", True),
        ("traefik", True),
        ("slskd", True),
        ("tidarr", False),
        ("unrelated-service", False),
        ("other-nginx", False),
        ("nginx-other", False),
        ("crate-", False),
        ("", False),
    ],
)
def test_cadvisor_only_keeps_crate_and_explicit_companion_services(service, expected):
    config = yaml.safe_load((OBSERVABILITY / "prometheus.yml").read_text())
    cadvisor = next(
        job for job in config["scrape_configs"] if job["job_name"] == "cadvisor"
    )
    rules = [
        rule
        for rule in cadvisor["metric_relabel_configs"]
        if rule.get("action") == "keep"
        and rule.get("source_labels") == ["container_label_com_docker_compose_service"]
    ]
    assert rules, "Container collection needs an explicit service allowlist"
    kept = all(re.fullmatch(rule["regex"], service) is not None for rule in rules)
    assert kept is expected


def test_grafana_dashboards_share_the_provisioned_datasource_and_cover_infrastructure():
    _overlay()
    files = list((OBSERVABILITY / "grafana/provisioning/datasources").glob("*.y*ml"))
    datasources = [
        source
        for file in files
        for source in yaml.safe_load(file.read_text())["datasources"]
    ]
    assert any(
        source["uid"] == "crate-prometheus" and source["type"] == "prometheus"
        for source in datasources
    )
    dashboards = list((OBSERVABILITY / "grafana/dashboards").glob("infra-*.json"))
    assert dashboards, "Infrastructure dashboards must be provisioned from Git"
    expressions = []
    for file in dashboards:
        dashboard = json.loads(file.read_text())
        panels = list(dashboard.get("panels", []))
        while panels:
            panel = panels.pop()
            panels.extend(panel.get("panels", []))
            for target in panel.get("targets", []):
                assert target.get("datasource", panel.get("datasource")) == {
                    "type": "prometheus",
                    "uid": "crate-prometheus",
                }
                expressions.append(target["expr"])
    for family in ("node_", "container_", "pg_", "redis_"):
        assert any(family in expression for expression in expressions), family
    assert any("up" in expression for expression in expressions)
    assert all("or vector(0)" not in expression for expression in expressions)


def _resolved_compose(tmp_path, base, enabled, operator):
    if not shutil.which("docker"):
        pytest.skip("Docker Compose parser required; no daemon or containers used")
    files = [base]
    if base == "docker-compose.yaml":
        files.append("docker-compose.project.yaml")
    if operator:
        files.append("deploy/operator/compose.operator.yaml")
    files.append(str(OVERLAY.relative_to(ROOT)))
    values = {
        "PUID": "1000",
        "PGID": "1000",
        "TZ": "UTC",
        "DOMAIN": "example.invalid",
        "DATA_DIR": "/var/lib/crate-test",
        "MEDIA_DIR": "/srv/media",
        "MUSIC_DIR": "/srv/media/music",
        "DOWNLOADS_DIR": "/srv/downloads",
        "TRAEFIK_HTTP_PORT": "8080",
        "TRAEFIK_HTTPS_PORT": "8443",
        "TIDARR_PORT": "8484",
        "NGINX_PORT": "8081",
        "SLSKD_PORT": "5030",
        "SLSKD_LISTEN_PORT": "50300",
        "CRATE_OPERATOR_PRINCIPAL_IDS": "00000000-0000-0000-0000-000000000001",
        "CRATE_AGENT_INSTANCE_ID": "lab",
        "OBS_DATA_DIR": "/var/lib/crate-observability-test",
    }
    for file in files:
        required = re.findall(r"\$\{([A-Z0-9_]+):\?", (ROOT / file).read_text())
        for variable in required:
            values.setdefault(variable, "synthetic-value")
    environment = tmp_path / "synthetic.env"
    environment.write_text(
        "".join(f"{name}={value}\n" for name, value in values.items())
    )
    command = ["docker", "compose", "--env-file", str(environment)]
    for file in files:
        command.extend(["-f", file])
    if enabled:
        command.extend(["--profile", "observability"])
    if operator:
        command.extend(["--profile", "crate-operator"])
    command.extend(["config", "--format", "json"])
    result = subprocess.run(
        command,
        cwd=ROOT,
        env={"PATH": os.environ["PATH"]},
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


@pytest.mark.parametrize("base", ["docker-compose.yaml", "docker-compose.home.yaml"])
@pytest.mark.parametrize("enabled", [False, True])
@pytest.mark.parametrize("operator", [False, True])
def test_overlay_resolves_opt_in_without_changing_crate_startup(
    tmp_path, base, enabled, operator
):
    overlay_services = set(_overlay()["services"])
    services = _resolved_compose(tmp_path, base, enabled, operator)["services"]
    assert (
        (overlay_services <= services.keys())
        if enabled
        else overlay_services.isdisjoint(services)
    )
    for name, service in services.items():
        if name not in overlay_services:
            assert overlay_services.isdisjoint(service.get("depends_on", {})), name

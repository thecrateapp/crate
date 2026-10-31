"""Real monitoring against disposable PG/Redis, with host checks only on Linux."""

import base64
import json
import os
import platform
import shutil
import socket
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass
from http.client import RemoteDisconnected
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
OBSERVABILITY = ROOT / "deploy/observability"
PASSWORD = "observability-runtime-test-password"


@dataclass
class MonitoringRuntime:
    command: list[str]
    environment: dict[str, str]
    grafana_url: str = ""
    containerd_address: str = ""

    def compose(self, *arguments, timeout=120):
        result = subprocess.run(
            [*self.command, *arguments],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=self.environment,
        )
        assert result.returncode == 0, result.stderr[-5000:]
        return result.stdout.strip()

    def get(self, path):
        auth = base64.b64encode(f"admin:{PASSWORD}".encode()).decode()
        request = urllib.request.Request(
            self.grafana_url + path,
            headers={"Authorization": f"Basic {auth}"},
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.load(response)

    def query(self, expression):
        parameters = urllib.parse.urlencode({"query": expression})
        result = self.get(
            "/api/datasources/proxy/uid/crate-prometheus/api/v1/query?" + parameters
        )
        assert result["status"] == "success", result
        return result["data"]["result"]


def _eventually(check, seconds=90):
    deadline = time.monotonic() + seconds
    last_error = None
    while time.monotonic() < deadline:
        try:
            check()
            return
        except (
            AssertionError,
            urllib.error.URLError,
            TimeoutError,
            ConnectionError,
            json.JSONDecodeError,
        ) as error:
            last_error = error
        time.sleep(1)
    raise AssertionError(f"Monitoring did not become ready: {last_error}")


def test_readiness_retries_a_transient_connection_reset(monkeypatch):
    calls = []
    monkeypatch.setattr(time, "sleep", lambda _: None)

    def ready():
        calls.append(True)
        if len(calls) == 1:
            raise RemoteDisconnected("Grafana is still starting")

    _eventually(ready)
    assert len(calls) == 2


def _docker_environment():
    return {
        key: os.environ[key]
        for key in ("PATH", "HOME", "DOCKER_CONFIG")
        if key in os.environ
    }


def _require_runtime_opt_in():
    if os.environ.get("OBSERVABILITY_RUNTIME_TEST") != "1":
        pytest.skip("Set OBSERVABILITY_RUNTIME_TEST=1 for isolated Docker smoke tests")


def test_runtime_does_not_inherit_deployment_configuration(monkeypatch):
    forbidden = {
        "OBS_DATA_DIR",
        "OBS_SECRETS_DIR",
        "OBS_DOCKER_ROOT",
        "OBS_GRAFANA_PORT",
        "OBS_CONTAINERD",
        "OBS_CONTAINERD_SOCKET",
        "COMPOSE_FILE",
        "COMPOSE_PROJECT_NAME",
        "COMPOSE_PROFILES",
        "DOCKER_HOST",
        "DOCKER_CONTEXT",
    }
    for key in forbidden:
        monkeypatch.setenv(key, "production-value-that-must-not-be-inherited")
    assert forbidden.isdisjoint(_docker_environment())


def test_runtime_requires_explicit_opt_in(monkeypatch):
    monkeypatch.delenv("OBSERVABILITY_RUNTIME_TEST", raising=False)
    with pytest.raises(pytest.skip.Exception):
        _require_runtime_opt_in()
    monkeypatch.setenv("OBSERVABILITY_RUNTIME_TEST", "1")
    _require_runtime_opt_in()


@pytest.fixture(scope="module")
def monitoring_runtime(tmp_path_factory):
    _require_runtime_opt_in()
    if not shutil.which("docker"):
        pytest.skip("Docker is required for the isolated monitoring smoke test")
    docker_environment = _docker_environment()
    context = subprocess.run(
        ["docker", "context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"],
        capture_output=True,
        text=True,
        timeout=15,
        env=docker_environment,
    )
    if context.returncode:
        pytest.skip("No local Docker context is available")
    endpoint = json.loads(context.stdout)
    if not endpoint.startswith("unix:///"):
        pytest.skip("Runtime smoke tests never connect to remote Docker endpoints")
    # Pin the validated local socket, even if another task changes the default context.
    docker_environment["DOCKER_HOST"] = endpoint
    info = subprocess.run(
        ["docker", "info", "--format", "{{json .}}"],
        capture_output=True,
        text=True,
        timeout=15,
        env=docker_environment,
    )
    if info.returncode:
        pytest.skip("Docker daemon is unavailable")
    metadata = json.loads(info.stdout)
    driver = metadata["Driver"]
    if expected_driver := os.environ.get("OBSERVABILITY_EXPECTED_DRIVER"):
        assert driver == expected_driver, metadata["Driver"]
    containerd = platform.system() == "Linux" and driver == "overlayfs"
    if platform.system() == "Linux":
        assert driver in {"overlay2", "overlayfs"}, driver
    docker_root = metadata["DockerRootDir"]
    directory = tmp_path_factory.mktemp("observability-runtime")
    data = directory / "data"
    secrets = directory / "secrets"
    secrets.mkdir()
    directory.chmod(0o755)
    directory.parent.chmod(0o755)
    for name in ("prometheus", "grafana"):
        path = data / name
        path.mkdir(parents=True, exist_ok=True)
        path.chmod(0o777)
    data.chmod(0o755)
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
        path = secrets / name
        path.write_text(content)
        path.chmod(0o444)
    base = directory / "fixture.yaml"
    redis = {
        "image": "redis:7-alpine",
        "command": ["redis-server", "--requirepass", PASSWORD],
        "networks": ["crate"],
        "healthcheck": {
            "test": ["CMD", "redis-cli", "-a", PASSWORD, "ping"],
            "interval": "1s",
            "timeout": "3s",
            "retries": 30,
        },
    }
    base.write_text(
        yaml.safe_dump(
            {
                "networks": {"crate": {}},
                "services": {
                    "crate-postgres": {
                        "image": "pgvector/pgvector:pg15",
                        "environment": {
                            "POSTGRES_PASSWORD": PASSWORD,
                            "POSTGRES_USER": "postgres",
                            "POSTGRES_DB": "crate",
                        },
                        "command": [
                            "postgres",
                            "-c",
                            "shared_preload_libraries=pg_stat_statements",
                            "-c",
                            "pg_stat_statements.track=all",
                        ],
                        "networks": ["crate"],
                        "healthcheck": {
                            "test": [
                                "CMD",
                                "pg_isready",
                                "-U",
                                "postgres",
                                "-d",
                                "crate",
                            ],
                            "interval": "1s",
                            "timeout": "3s",
                            "retries": 30,
                        },
                    },
                    "crate-redis": dict(redis),
                    "crate-redis-durable": dict(redis),
                },
            }
        )
    )
    environment = directory / "synthetic.env"
    fixture_values = {
        "OBS_DATA_DIR": str(data),
        "OBS_SECRETS_DIR": str(secrets),
        "OBS_DOCKER_ROOT": docker_root,
        "OBS_GRAFANA_PORT": "0",
        "CRATE_POSTGRES_DB": "crate",
    }
    extra_files = []
    if containerd:
        fixture_values["OBS_CONTAINERD_SOCKET"] = metadata["Containerd"]["Address"]
        access = directory / "test-access.yaml"
        access.write_text(
            yaml.safe_dump(
                {
                    "services": {
                        "crate-observability-docker-proxy": {
                            "ports": ["127.0.0.1:0:2376"],
                            "networks": ["observability", "observability-ui"],
                        }
                    }
                }
            )
        )
        extra_files = [
            "-f",
            str(OBSERVABILITY / "compose.containerd.yaml"),
            "-f",
            str(access),
        ]
    environment.write_text(
        "".join(f"{key}={value}\n" for key, value in fixture_values.items())
    )
    runtime = MonitoringRuntime(
        [
            "docker",
            "compose",
            "--project-name",
            "crate-obs-test-" + uuid.uuid4().hex[:10],
            "--project-directory",
            str(ROOT),
            "--env-file",
            str(environment),
            "-f",
            str(base),
            "-f",
            str(OBSERVABILITY / "compose.observability.yaml"),
            *extra_files,
            "--profile",
            "observability",
        ],
        {**docker_environment, **fixture_values},
    )
    try:
        runtime.compose(
            "up",
            "-d",
            "--wait",
            "--wait-timeout",
            "90",
            "crate-postgres",
            "crate-redis",
            "crate-redis-durable",
        )
        runtime.compose(
            "exec",
            "-T",
            "crate-postgres",
            "psql",
            "-v",
            "ON_ERROR_STOP=1",
            "-U",
            "postgres",
            "-d",
            "crate",
            "-c",
            "CREATE EXTENSION pg_stat_statements; "
            f"CREATE ROLE crate_observer LOGIN PASSWORD '{PASSWORD}'; "
            "GRANT pg_monitor TO crate_observer;",
        )
        services = list(
            yaml.safe_load((OBSERVABILITY / "compose.observability.yaml").read_text())[
                "services"
            ]
        )
        if platform.system() != "Linux":
            services = [
                name
                for name in services
                if name
                not in {
                    "crate-node-exporter",
                    "crate-cadvisor",
                    "crate-observability-docker-proxy",
                }
            ]
        if containerd:
            runtime.compose(
                "up",
                "-d",
                "--no-deps",
                "--wait",
                "--wait-timeout",
                "45",
                "crate-observability-docker-proxy",
            )
            runtime.containerd_address = runtime.compose(
                "port", "crate-observability-docker-proxy", "2376"
            )
            assert runtime.containerd_address.startswith("127.0.0.1:")
        runtime.compose("up", "-d", "--no-deps", *services)
        address = runtime.compose("port", "crate-grafana", "3000")
        assert address.startswith("127.0.0.1:"), address
        runtime.grafana_url = "http://" + address
        yield runtime
    except BaseException:
        # Keep bounded collector evidence before the disposable project is removed.
        metadata = subprocess.run(
            [
                "docker",
                "info",
                "--format",
                "driver={{.Driver}} cgroup={{.CgroupVersion}}",
            ],
            env=docker_environment,
            capture_output=True,
            text=True,
            timeout=15,
        )
        print("Collector host:", metadata.stdout.strip())
        print(
            runtime.compose(
                "logs",
                "--no-color",
                "--tail",
                "12",
                "crate-cadvisor",
                "crate-observability-docker-proxy",
            )[-8000:]
        )
        raise
    finally:
        # All names and resources belong to the random fixture project.
        runtime.compose("down", "--volumes", "--remove-orphans", timeout=90)


def test_monitoring_observes_real_dependencies_and_provisions_dashboards(
    monitoring_runtime,
):
    runtime = monitoring_runtime

    def grafana_ready():
        assert runtime.get("/api/health")["database"] == "ok"
        actual = {row["uid"] for row in runtime.get("/api/search?type=dash-db")}
        expected = {
            json.loads(path.read_text())["uid"]
            for path in (OBSERVABILITY / "grafana/dashboards").glob("infra-*.json")
        }
        assert expected and expected <= actual

    # First boot migrates a fresh SQLite store under the real CPU quota.
    _eventually(grafana_ready, seconds=180)
    runtime.compose(
        "exec",
        "-T",
        "crate-postgres",
        "psql",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "postgres",
        "-d",
        "crate",
        "-c",
        "SELECT pg_sleep(0.05), SUM(value) "
        "FROM (VALUES (11), (17)) AS crate_observability_runtime_probe(value);",
    )
    query_id = runtime.compose(
        "exec",
        "-T",
        "crate-postgres",
        "psql",
        "-At",
        "-U",
        "postgres",
        "-d",
        "crate",
        "-c",
        "SELECT queryid FROM pg_stat_statements "
        "WHERE query LIKE '%AS crate_observability_runtime_probe(value)%' "
        "AND query NOT LIKE '%pg_stat_statements%' ORDER BY calls DESC LIMIT 1;",
    )
    assert query_id.lstrip("-").isdigit(), query_id
    redis_id = runtime.compose("ps", "-q", "crate-redis")

    def dependencies_observed():
        rows = runtime.query("up")
        observed = {row["metric"]["job"]: float(row["value"][1]) for row in rows}
        expected = {"prometheus", "postgresql", "redis-cache", "redis-durable"}
        if platform.system() == "Linux":
            expected |= {"node", "cadvisor"}
        assert expected <= observed.keys(), observed
        assert all(observed[name] == 1 for name in expected), observed
        assert runtime.query("pg_up")[0]["value"][1] == "1"
        redis = runtime.query("redis_up")
        assert len(redis) == 2 and all(row["value"][1] == "1" for row in redis), redis
        if platform.system() == "Linux":
            assert runtime.query("node_memory_MemTotal_bytes")
            containers = runtime.query(
                "container_memory_working_set_bytes{"
                'container_label_com_docker_compose_service="crate-redis"}'
            )
            assert any(
                redis_id in row["metric"].get("id", "") and float(row["value"][1]) > 0
                for row in containers
            ), containers
        statements = runtime.query(
            'count({__name__=~"pg_stat_statements_.*",queryid="' + query_id + '"})'
        )
        assert statements and float(statements[0]["value"][1]) > 0, (
            "The exporter must observe the normalized probe query, without query text"
        )

    try:
        _eventually(dependencies_observed)
    except AssertionError:
        metadata = subprocess.run(
            [
                "docker",
                "info",
                "--format",
                "driver={{.Driver}} cgroup={{.CgroupVersion}}",
            ],
            env=runtime.environment,
            capture_output=True,
            text=True,
            timeout=15,
        )
        print("Collector host:", metadata.stdout.strip())
        print(
            runtime.compose(
                "logs",
                "--no-color",
                "--tail",
                "20",
                "crate-cadvisor",
                "crate-observability-docker-proxy",
            )[-10000:]
        )
        raise


def _containerd_rpc(address, method, path, namespaces, payload=b""):
    # Raw HTTP/2 checks the deployed filter, including duplicate metadata headers.
    import h2.connection
    import h2.events

    host, port = address.rsplit(":", 1)
    connection = h2.connection.H2Connection()
    headers = [
        (":method", method),
        (":scheme", "http"),
        (":authority", "containerd"),
        (":path", path),
        ("content-type", "application/grpc"),
        ("te", "trailers"),
        *(("containerd-namespace", value) for value in namespaces),
    ]
    result = {}
    body = bytearray()
    with socket.create_connection((host, int(port)), timeout=10) as client:
        connection.initiate_connection()
        connection.send_headers(1, headers)
        connection.send_data(
            1, b"\x00" + len(payload).to_bytes(4, "big") + payload, end_stream=True
        )
        client.sendall(connection.data_to_send())
        while True:
            data = client.recv(65536)
            assert data, "The proxy closed without completing the HTTP/2 response"
            done = False
            for event in connection.receive_data(data):
                if isinstance(
                    event, (h2.events.ResponseReceived, h2.events.TrailersReceived)
                ):
                    result.update(
                        {key.decode(): value.decode() for key, value in event.headers}
                    )
                elif isinstance(event, h2.events.DataReceived):
                    body.extend(event.data)
                    connection.acknowledge_received_data(
                        event.flow_controlled_length, event.stream_id
                    )
                elif isinstance(event, h2.events.StreamEnded):
                    done = True
                elif isinstance(
                    event, (h2.events.StreamReset, h2.events.ConnectionTerminated)
                ):
                    raise AssertionError(f"Unexpected HTTP/2 termination: {event}")
            if pending := connection.data_to_send():
                client.sendall(pending)
            if done:
                return result, bytes(body)


RPC = "/containerd.services.containers.v1.Containers/Get"


def test_containerd_filter_reads_real_moby_metadata(monitoring_runtime):
    runtime = monitoring_runtime
    if not runtime.containerd_address:
        pytest.skip(
            "The filtered containerd endpoint is only used with overlayfs on Linux"
        )
    container_id = runtime.compose("ps", "-q", "crate-redis").encode()
    payload = b"\x0a" + bytes([len(container_id)]) + container_id
    headers, body = _containerd_rpc(
        runtime.containerd_address, "POST", RPC, ["moby"], payload
    )
    assert headers[":status"] == "200", headers
    assert headers["grpc-status"] == "0", headers
    assert container_id in body


@pytest.mark.parametrize(
    "method,path,namespaces",
    [
        ("GET", RPC, ["moby"]),
        ("POST", RPC, []),
        ("POST", RPC, ["default"]),
        ("POST", RPC, ["moby", "moby"]),
        ("POST", RPC, ["moby", "default"]),
        ("POST", RPC, ["moby,default"]),
        ("POST", RPC.replace("/Get", "/List"), ["moby"]),
        ("POST", RPC.replace("/Get", "/Create"), ["moby"]),
        ("POST", RPC.replace("/Get", "/Update"), ["moby"]),
        ("POST", RPC.replace("/Get", "/Delete"), ["moby"]),
        ("POST", "/containerd.services.tasks.v1.Tasks/Get", ["moby"]),
    ],
)
def test_containerd_filter_rejects_other_rpcs_and_namespaces(
    monitoring_runtime, method, path, namespaces
):
    if not monitoring_runtime.containerd_address:
        pytest.skip(
            "The filtered containerd endpoint is only used with overlayfs on Linux"
        )
    headers, _ = _containerd_rpc(
        monitoring_runtime.containerd_address, method, path, namespaces
    )
    assert headers[":status"] == "403", headers

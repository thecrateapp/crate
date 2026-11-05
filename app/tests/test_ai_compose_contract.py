"""All inference processes receive the same explicit credential key ring."""

from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]


def _environment(services, name):
    service = services[name]
    parent = service.get("extends", {}).get("service")
    inherited = _environment(services, parent) if parent else {}
    environment = service.get("environment", {})
    if isinstance(environment, list):
        environment = dict(entry.split("=", 1) for entry in environment)
    return {**inherited, **environment}


@pytest.mark.parametrize(
    "filename,prefix",
    [
        ("docker-compose.yaml", "crate-"),
        ("docker-compose.dev.yaml", ""),
        ("docker-compose.home.yaml", "crate-"),
    ],
)
def test_inference_services_receive_explicit_credential_ring(filename, prefix):
    services = yaml.safe_load((ROOT / filename).read_text())["services"]
    expected = {
        prefix + name
        for name in (
            "api",
            "worker",
            "fast-worker",
            "maintenance-worker",
            "analysis-worker",
        )
    }
    for name in services:
        environment = _environment(services, name)
        for variable in ("CRATE_CREDENTIAL_KEY", "CRATE_CREDENTIAL_PREVIOUS_KEYS"):
            if name in expected:
                assert environment.get(variable) == "${" + variable + ":-}", name
            else:
                assert variable not in environment, name


def _worker_queues(service) -> set[str]:
    command = service.get("command")
    if not isinstance(command, list) or command[:1] != ["worker"]:
        return set()
    if "--queues" not in command:
        return set()
    return set(command[command.index("--queues") + 1].split(","))


@pytest.mark.parametrize(
    "filename,consumers",
    [
        ("docker-compose.yaml", {"crate-worker"}),
        ("docker-compose.dev.yaml", {"worker"}),
        ("docker-compose.home.yaml", {"crate-worker"}),
        (
            "app/installer/internal/assets/files/docker-compose.home.yaml",
            {"crate-worker"},
        ),
        ("docker-compose.federation-dev.yaml", {"node-a-worker", "node-b-worker"}),
    ],
)
def test_only_crate_worker_consumes_the_ai_lanes(filename, consumers):
    services = yaml.safe_load((ROOT / filename).read_text())["services"]
    for lane in ("ai", "ai_bulk"):
        assert {
            name
            for name, service in services.items()
            if lane in _worker_queues(service)
        } == consumers, lane
    for name in consumers:
        environment = _environment(services, name)
        assert environment["CRATE_AI_WORKER_THREADS"] == "${CRATE_AI_WORKER_THREADS:-2}"
        assert (
            environment["CRATE_AI_BULK_WORKER_THREADS"]
            == "${CRATE_AI_BULK_WORKER_THREADS:-1}"
        )


@pytest.mark.parametrize(
    "filename",
    [
        "deploy/operator/compose.operator.yaml",
        "app/installer/internal/assets/files/compose.operator.yaml",
    ],
)
def test_crate_worker_health_requires_ai_lane_consumers(filename):
    services = yaml.safe_load((ROOT / filename).read_text())["services"]
    queues = services["crate-worker"]["environment"]["CRATE_READINESS_QUEUES"]
    assert {"ai", "ai_bulk"} <= set(queues.split(","))
    for name, service in services.items():
        if name == "crate-worker":
            continue
        environment = service.get("environment") or {}
        other = str(environment.get("CRATE_READINESS_QUEUES", "")).split(",")
        assert not {"ai", "ai_bulk"} & set(other), name


def test_install_manifest_declares_ai_lane_tuning():
    manifest = yaml.safe_load((ROOT / "deploy/install/integrations.yaml").read_text())
    assert {"CRATE_AI_WORKER_THREADS", "CRATE_AI_BULK_WORKER_THREADS"} <= set(
        manifest["tuning"]
    )


@pytest.mark.parametrize(
    "filename,services",
    [
        ("docker-compose.yaml", ["crate-worker"]),
        ("docker-compose.dev.yaml", ["worker"]),
        ("docker-compose.home.yaml", ["crate-worker"]),
        (
            "app/installer/internal/assets/files/docker-compose.home.yaml",
            ["crate-worker"],
        ),
        ("docker-compose.federation-dev.yaml", ["node-a-worker", "node-b-worker"]),
    ],
)
def test_crate_worker_stop_grace_covers_the_pool_drain(filename, services):
    from crate.worker import POOL_STOP_GRACE_SECONDS

    compose = yaml.safe_load((ROOT / filename).read_text())["services"]
    for name in services:
        grace = str(compose[name].get("stop_grace_period") or "")
        assert grace.endswith(("s", "m")), name
        seconds = int(grace[:-1]) * (60 if grace.endswith("m") else 1)
        assert seconds >= POOL_STOP_GRACE_SECONDS, name


def _megabytes(value: str) -> int:
    value = str(value).strip().lower()
    if value.endswith("g"):
        return int(float(value[:-1]) * 1024)
    if value.endswith("m"):
        return int(value[:-1])
    raise AssertionError(f"unexpected memory value {value}")


@pytest.mark.parametrize(
    "filename,service,minimum",
    [
        # Measured (review I4): the AI pools add ~180 MiB idle and up to ~0.7 GB
        # at peak (OCR + vision decode + transport children) to crate-worker.
        ("docker-compose.yaml", "crate-worker", 2304),
        ("docker-compose.dev.yaml", "worker", 2304),
        ("docker-compose.home.yaml", "crate-worker", 2304),
        (
            "app/installer/internal/assets/files/docker-compose.home.yaml",
            "crate-worker",
            2304,
        ),
        ("docker-compose.project.yaml", "crate-worker", 2816),
    ],
)
def test_crate_worker_memory_covers_the_ai_pools(filename, service, minimum):
    services = yaml.safe_load((ROOT / filename).read_text())["services"]
    assert _megabytes(services[service]["mem_limit"]) >= minimum

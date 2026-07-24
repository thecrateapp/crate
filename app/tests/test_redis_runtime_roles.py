from __future__ import annotations

from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]


def test_redis_role_urls_have_backward_compatible_fallback(monkeypatch):
    from crate.config import get_cache_redis_url, get_durable_redis_url

    monkeypatch.setenv("REDIS_URL", "redis://shared:6379/0")
    monkeypatch.delenv("REDIS_CACHE_URL", raising=False)
    monkeypatch.delenv("REDIS_DURABLE_URL", raising=False)
    assert get_cache_redis_url() == "redis://shared:6379/0"
    assert get_durable_redis_url() == "redis://shared:6379/0"

    monkeypatch.setenv("REDIS_CACHE_URL", "redis://cache:6379/0")
    monkeypatch.setenv("REDIS_DURABLE_URL", "redis://durable:6379/0")
    assert get_cache_redis_url() == "redis://cache:6379/0"
    assert get_durable_redis_url() == "redis://durable:6379/0"


def test_runtime_modules_select_the_correct_redis_role():
    assert "get_cache_redis_url" in (ROOT / "app/crate/db/cache_runtime.py").read_text()
    assert "get_cache_redis_url" in (ROOT / "app/crate/api/cache_events.py").read_text()
    assert (
        "get_durable_redis_url" in (ROOT / "app/crate/db/domain_events.py").read_text()
    )
    assert "get_durable_redis_url" in (ROOT / "app/crate/broker.py").read_text()


def test_production_compose_separates_disposable_and_durable_redis():
    compose = yaml.safe_load((ROOT / "docker-compose.yaml").read_text())
    services = compose["services"]

    assert "volatile-lru" in services["crate-redis"]["command"]
    durable = services["crate-redis-durable"]
    assert "appendonly yes" in durable["command"]
    assert "appendfsync everysec" in durable["command"]
    assert "maxmemory 384mb" in durable["command"]
    assert "maxmemory-policy noeviction" in durable["command"]
    assert "crate_redis_durable:/data" in durable["volumes"]

    for service_name in (
        "crate-api",
        "crate-worker",
        "crate-projector",
        "crate-maintenance-worker",
        "crate-analysis-worker",
        "crate-playback-worker",
    ):
        environment = services[service_name]["environment"]
        cache_url = next(
            str(item)
            for item in environment
            if str(item).startswith("REDIS_CACHE_URL=")
        )
        durable_url = next(
            str(item)
            for item in environment
            if str(item).startswith("REDIS_DURABLE_URL=")
        )
        assert "${REDIS_CACHE_URL:-" in cache_url
        assert "${REDIS_DURABLE_URL:-" in durable_url


def test_dev_compose_has_role_parity():
    compose = yaml.safe_load((ROOT / "docker-compose.dev.yaml").read_text())
    services = compose["services"]
    assert "redis-durable" in services
    assert "appendonly yes" in services["redis-durable"]["command"]
    assert "maxmemory 256mb" in services["redis-durable"]["command"]
    for service_name in ("api", "worker", "projector"):
        environment = services[service_name]["environment"]
        assert any(str(item).startswith("REDIS_CACHE_URL=") for item in environment)
        assert any(str(item).startswith("REDIS_DURABLE_URL=") for item in environment)


def test_home_compose_has_role_parity():
    compose = yaml.safe_load((ROOT / "docker-compose.home.yaml").read_text())
    services = compose["services"]
    durable = services["crate-redis-durable"]
    assert "appendonly yes" in durable["command"]
    assert "maxmemory-policy noeviction" in durable["command"]

    shared = compose["x-crate-env"]
    assert "crate-redis:6379" in shared["REDIS_CACHE_URL"]
    assert "crate-redis-durable:6379" in shared["REDIS_DURABLE_URL"]
    for service_name in (
        "crate-api",
        "crate-readplane",
        "crate-worker",
        "crate-fast-worker",
        "crate-projector",
        "crate-maintenance-worker",
        "crate-analysis-worker",
        "crate-playback-worker",
    ):
        assert "crate-redis-durable" in services[service_name]["depends_on"]


def test_federation_harness_separates_redis_roles_per_node():
    compose = yaml.safe_load((ROOT / "docker-compose.federation-dev.yaml").read_text())
    services = compose["services"]

    for node in ("a", "b"):
        durable_name = f"node-{node}-redis-durable"
        durable = services[durable_name]
        assert "appendonly yes" in durable["command"]
        assert "maxmemory-policy noeviction" in durable["command"]
        for service_name in (
            f"node-{node}-api",
            f"node-{node}-readplane",
            f"node-{node}-worker",
        ):
            service = services[service_name]
            environment = set(service["environment"])
            assert any(item.startswith("REDIS_CACHE_URL=") for item in environment)
            assert any(item.startswith("REDIS_DURABLE_URL=") for item in environment)
            assert durable_name in service["depends_on"]

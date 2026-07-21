from __future__ import annotations

from pathlib import Path

import pytest
import yaml


ROOT = Path(__file__).resolve().parents[2]


def _environment(service: dict) -> dict[str, str]:
    raw = service.get("environment") or {}
    if isinstance(raw, dict):
        return {str(key): str(value) for key, value in raw.items()}
    result = {}
    for item in raw:
        key, _, value = str(item).partition("=")
        result[key] = value
    return result


@pytest.mark.parametrize(
    "compose_name", ["docker-compose.yaml", "docker-compose.home.yaml"]
)
def test_production_services_use_bounded_local_docker_logs(compose_name):
    services = yaml.safe_load((ROOT / compose_name).read_text())["services"]

    for name, service in services.items():
        logging = service.get("logging") or {}
        assert logging.get("driver") == "local", name
        assert logging.get("options") == {"max-size": "20m", "max-file": "5"}, name


@pytest.mark.parametrize(
    "compose_name", ["docker-compose.yaml", "docker-compose.home.yaml"]
)
def test_runtime_services_mount_separate_regenerable_cache(compose_name):
    services = yaml.safe_load((ROOT / compose_name).read_text())["services"]
    for name in (
        "crate-api",
        "crate-readplane",
        "crate-worker",
        "crate-maintenance-worker",
        "crate-playback-worker",
    ):
        service = services[name]
        environment = _environment(service)
        volumes = [str(volume) for volume in service.get("volumes") or []]
        if name == "crate-readplane":
            assert environment["READPLANE_CACHE_ROOT"] == "/cache"
        else:
            assert environment["CACHE_DIR"] == "/cache"
        assert any(
            volume.endswith(":/cache") or ":/cache:" in volume for volume in volumes
        ), name


@pytest.mark.parametrize(
    "compose_name", ["docker-compose.yaml", "docker-compose.home.yaml"]
)
def test_maintenance_worker_receives_stream_cache_retention_policy(compose_name):
    service = yaml.safe_load((ROOT / compose_name).read_text())["services"][
        "crate-maintenance-worker"
    ]
    environment = _environment(service)

    assert (
        environment["CRATE_STREAM_CACHE_MAX_BYTES"]
        == "${CRATE_STREAM_CACHE_MAX_BYTES:-12884901888}"
    )
    assert (
        environment["CRATE_STREAM_CACHE_LOW_WATERMARK_BYTES"]
        == "${CRATE_STREAM_CACHE_LOW_WATERMARK_BYTES:-10737418240}"
    )
    assert (
        environment["CRATE_STREAM_CACHE_MAX_IDLE_SECONDS"]
        == "${CRATE_STREAM_CACHE_MAX_IDLE_SECONDS:-2592000}"
    )


def test_deploy_cleanup_retains_rollback_and_prunes_unused_images_and_build_cache():
    script = (ROOT / "scripts/deploy-remote.sh").read_text()

    assert "prune_unused_images" in script
    assert "rollback-${DEPLOY_ID}" in script
    assert "docker builder prune -af" in script
    assert "cleanup_legacy_cache_layout" in script


@pytest.mark.parametrize(
    "compose_name", ["docker-compose.yaml", "docker-compose.home.yaml"]
)
def test_traefik_logs_are_bounded_and_use_container_log_rotation(compose_name):
    traefik = yaml.safe_load((ROOT / compose_name).read_text())["services"]["traefik"]
    command = set(traefik.get("command") or [])

    assert "--log.level=INFO" in command
    assert "--log.filePath=" in command
    assert "--accesslog.filePath=" in command
    assert "--accesslog.filters.statusCodes=400-599" in command
    assert "--accesslog.filters.retryAttempts=true" in command
    assert "--accesslog.filters.minDuration=1s" in command
    assert "--accesslog.fields.headers.defaultMode=drop" in command


def test_storage_retention_runbook_documents_cache_and_image_safety_controls():
    content = (ROOT / "docs/technical/storage-retention.md").read_text()

    assert "CACHE_DIR" in content
    assert "CRATE_STREAM_CACHE_MAX_BYTES" in content
    assert "active release and one rollback" in content
    assert "docker system prune --volumes" in content
    assert "/api/status" in content


def test_storage_retention_runbook_is_published_in_docs_site():
    manifest = yaml.safe_load((ROOT / "docs/manifest.json").read_text())
    content = (ROOT / "app/docs/src/content.ts").read_text()

    entry = next(
        item
        for item in manifest
        if item["sourcePath"] == "docs/technical/storage-retention.md"
    )
    assert entry["route"] == "/operations/storage-retention"
    assert '"docs/technical/storage-retention.md"' in content

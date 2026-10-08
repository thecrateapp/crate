from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]


def _environment_map(service: dict) -> dict[str, str]:
    environment = service.get("environment", {})
    if isinstance(environment, dict):
        return {str(key): str(value) for key, value in environment.items()}
    return {
        str(entry).split("=", 1)[0]: str(entry).split("=", 1)[1]
        for entry in environment
        if "=" in str(entry)
    }


def test_production_workers_have_distinct_sentry_service_names():
    services = yaml.safe_load((ROOT / "docker-compose.yaml").read_text())["services"]
    expected = {
        "crate-worker": "worker-default",
        "crate-fast-worker": "worker-fast",
        "crate-maintenance-worker": "worker-maintenance",
        "crate-analysis-worker": "worker-analysis",
        "crate-playback-worker": "worker-playback",
        "crate-projector": "projector",
    }

    assert {
        service_name: _environment_map(services[service_name]).get("SENTRY_SERVICE")
        for service_name in expected
    } == expected


def test_development_workers_have_distinct_sentry_service_names():
    services = yaml.safe_load((ROOT / "docker-compose.dev.yaml").read_text())[
        "services"
    ]
    expected = {
        "worker": "worker-default",
        "maintenance-worker": "worker-maintenance",
        "analysis-worker": "worker-analysis",
        "playback-worker": "worker-playback",
        "projector": "projector",
    }

    assert {
        service_name: _environment_map(services[service_name]).get("SENTRY_SERVICE")
        for service_name in expected
    } == expected

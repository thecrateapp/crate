from pathlib import Path
import tomllib

import pytest
import yaml


ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize(
    "manifest",
    ["app/media-worker/Cargo.toml", "app/listen-desktop/src-tauri/Cargo.toml"],
)
def test_rust_sentry_ureq_transport_enables_tls_for_https_dsns(manifest):
    config = tomllib.loads((ROOT / manifest).read_text())
    sentry = config["dependencies"]["sentry"]
    features = set(sentry.get("features", []))
    assert "ureq" in features, "The selected Rust transport must remain configured"
    assert sentry.get("default-features", True) or features & {
        "rustls",
        "native-tls",
    }, (
        "Sentry's ureq transport needs an explicit TLS backend when default features are disabled"
    )


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

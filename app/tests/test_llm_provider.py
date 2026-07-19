from pathlib import Path
from typing import Any, cast
from unittest.mock import patch

import yaml


ROOT = Path(__file__).resolve().parents[2]


def _settings_default(key: str, default: str | None = None) -> str | None:
    return default


def test_get_config_auto_selects_gemini_when_key_exists(monkeypatch):
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setenv("AUDIOMUSE_GEMINI_API_KEY", "test-key")

    with patch("crate.db.cache_settings.get_setting", side_effect=_settings_default):
        from crate.llm.provider import get_config

        config = get_config()

    assert config["provider"] == "gemini"
    assert config["model"] == "gemini/gemini-2.5-flash"


def test_get_config_respects_explicit_provider(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "ollama/custom")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")

    with patch("crate.db.cache_settings.get_setting", side_effect=_settings_default):
        from crate.llm.provider import get_config

        config = get_config()

    assert config["provider"] == "ollama"
    assert config["model"] == "ollama/custom"


def test_compose_stacks_do_not_embed_ollama():
    for path in sorted(ROOT.glob("docker-compose*.yaml")):
        source = path.read_text()
        compose = yaml.safe_load(source) or {}
        services = compose.get("services") or {}
        volumes = compose.get("volumes") or {}

        assert "ollama" not in services, path.name
        assert not any(
            str(service.get("image", "")).startswith("ollama/")
            for service in services.values()
        ), path.name
        assert not any(
            "ollama" in (service.get("depends_on") or {})
            for service in services.values()
        ), path.name
        assert not any("ollama" in str(name).lower() for name in volumes), path.name
        assert "http://ollama:11434" not in source, path.name
        assert "${LLM_PROVIDER:-ollama" not in source, path.name


def test_llm_status_requires_cloud_provider_key(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "gemini/gemini-2.5-flash")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("AUDIOMUSE_GEMINI_API_KEY", raising=False)

    from crate.api import admin_metrics

    monkeypatch.setattr(
        admin_metrics, "_require_llm_status_viewer", lambda request: {"id": 1}
    )
    with patch("crate.db.cache_settings.get_setting", side_effect=_settings_default):
        result = admin_metrics.llm_status(cast(Any, object()))

    assert result["available"] is False
    assert result["provider"] == "gemini"
    assert result["error"] == "GEMINI_API_KEY or AUDIOMUSE_GEMINI_API_KEY not set"

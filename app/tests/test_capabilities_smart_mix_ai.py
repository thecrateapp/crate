"""`smart_mix.ai_assisted` in /api/capabilities (SM4.PR4, SM3-D9)."""

from __future__ import annotations

import json

import pytest

GATE = {
    "enabled": True,
    "send_genre": True,
    "available": True,
    "error_code": None,
    "fingerprint": "e" * 64,
    "provider": "ollama",
    "model_id": "qwen3.8:27b",
    "budget_exhausted": False,
}


@pytest.fixture
def capabilities_env(monkeypatch):
    from crate.api import capabilities

    monkeypatch.setenv("CRATE_SMART_MIX_ENABLED", "true")
    state = {"gate": dict(GATE), "latency": None, "latency_reads": 0}

    def latency():
        state["latency_reads"] += 1
        return state["latency"]

    monkeypatch.setattr(capabilities, "get_smart_mix_structure_percent", lambda: None)
    monkeypatch.setattr(capabilities, "refinement_gate", lambda: dict(state["gate"]))
    monkeypatch.setattr(capabilities, "get_smart_mix_refinement_latency_ms", latency)
    return state


def _ai(test_app) -> dict:
    response = test_app.get("/api/capabilities")
    assert response.status_code == 200
    return response.json()["smart_mix"]["ai_assisted"]


def test_unavailable_when_setting_off(test_app, capabilities_env):
    capabilities_env["gate"].update(enabled=False, available=False, fingerprint=None)

    ai = _ai(test_app)

    assert ai["available"] is False
    assert ai["reason"] == "disabled"
    assert ai["provider_kind"] is None and ai["model_label"] is None
    assert ai["prompt_version"] == "sm3-refine-3"


def test_unavailable_without_binding(test_app, capabilities_env, monkeypatch):
    capabilities_env["gate"].update(
        available=False, error_code="AI_ACTION_DISABLED", fingerprint=None
    )

    assert _ai(test_app)["reason"] == "no_model"

    capabilities_env["gate"] = dict(GATE, budget_exhausted=True)
    assert _ai(test_app) == {
        "available": False,
        "provider_kind": "local",
        "model_label": "qwen3.8:27b",
        "prompt_version": "sm3-refine-3",
        "typical_latency_ms": None,
        "reason": "budget",
    }

    # Smart Mix itself off: nothing to refine.
    monkeypatch.delenv("CRATE_SMART_MIX_ENABLED", raising=False)
    ai = _ai(test_app)
    assert ai["available"] is False and ai["reason"] == "smart_mix_unavailable"


@pytest.mark.parametrize(
    ("provider", "kind"),
    [("ollama", "local"), ("deepseek", "cloud"), ("gemini", "cloud")],
)
def test_available_reports_local_or_cloud(test_app, capabilities_env, provider, kind):
    capabilities_env["gate"]["provider"] = provider

    ai = _ai(test_app)

    assert ai["available"] is True and ai["reason"] is None
    assert ai["provider_kind"] == kind
    assert ai["model_label"] == "qwen3.8:27b"


def test_no_secrets_in_capabilities(test_app, capabilities_env, monkeypatch):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-secret-test-value")
    capabilities_env["gate"]["provider"] = "deepseek"

    payload = json.dumps(test_app.get("/api/capabilities").json())

    assert "e" * 64 not in payload  # the configuration fingerprint
    assert "sk-secret-test-value" not in payload
    assert "fingerprint" not in payload
    assert "error_code" not in payload
    assert "endpoint" not in payload and "11434" not in payload


def test_latency_from_snapshot(test_app, capabilities_env):
    capabilities_env["latency"] = 2350

    ai = _ai(test_app)

    assert ai["typical_latency_ms"] == 2350
    assert capabilities_env["latency_reads"] == 1


def test_latency_snapshot_is_written_by_the_coverage_refresh(pg_db, monkeypatch):
    from crate.db.jobs import smart_mix_backfill
    from crate.db.queries.smart_mix_admin import get_smart_mix_refinement_latency_ms

    del pg_db
    monkeypatch.setattr(smart_mix_backfill, "refinement_latency_p50_ms", lambda: 1875)

    snapshot = smart_mix_backfill.refresh_smart_mix_coverage()

    assert snapshot["refinement_latency_p50_ms"] == 1875
    assert get_smart_mix_refinement_latency_ms() == 1875


def test_settings_switch_the_gate(test_app, monkeypatch):
    from crate.api import settings

    stored: dict[str, str] = {}
    invalidated: list[bool] = []
    monkeypatch.setattr(settings, "set_setting", stored.__setitem__)
    monkeypatch.setattr(
        settings, "get_setting", lambda key, default=None: stored.get(key, default)
    )
    monkeypatch.setattr(
        settings, "invalidate_refinement_gate", lambda: invalidated.append(True)
    )

    response = test_app.put(
        "/api/settings/smart-mix", json={"ai_enabled": True, "ai_send_genre": False}
    )

    assert response.status_code == 200
    assert stored == {
        "smart_mix_ai_enabled": "true",
        "smart_mix_ai_send_genre": "false",
    }
    assert invalidated == [True]
    assert settings._get_smart_mix_settings() == {
        "ai_enabled": True,
        "ai_send_genre": False,
        "stem_uploads_enabled": True,
        "stem_max_tracks_per_playlist": 300,
        "stem_max_tracks_per_user": None,
        "stem_quota_gib": 50,
    }
    stored.clear()
    # Defaults: off, and the genre goes when it is on (SM3-D6, SM3-D10). Stem
    # uploads are on (STEM-D8); Smart Mix playlists hold 300 tracks each, with no
    # limit per user (STEM-D2); stem files take up to 50 GiB (STEM-D6).
    assert settings._get_smart_mix_settings() == {
        "ai_enabled": False,
        "ai_send_genre": True,
        "stem_uploads_enabled": True,
        "stem_max_tracks_per_playlist": 300,
        "stem_max_tracks_per_user": None,
        "stem_quota_gib": 50,
    }

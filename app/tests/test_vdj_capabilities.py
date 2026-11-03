from __future__ import annotations


def test_vdj_capabilities_are_disabled_by_default(test_app, monkeypatch):
    monkeypatch.delenv("CRATE_VDJ_ENABLED", raising=False)
    monkeypatch.delenv("CRATE_VDJ_AUTOMATION_ENABLED", raising=False)

    response = test_app.get("/api/capabilities")

    assert response.status_code == 200
    assert response.json()["vdj"] == {
        "available": False,
        "min_plugin_version": "1.0.0",
        "max_plugin_version": "1.x",
        "contract_version": "2026-08",
        "profile_schema_version": 1,
        "planner_version": "smart-mix-v2",
        "online_source": False,
        "smart_mix_assistant": False,
        "automation": False,
    }


def test_vdj_capabilities_expose_enabled_features(test_app, monkeypatch):
    monkeypatch.setenv("CRATE_SMART_MIX_ENABLED", "true")
    monkeypatch.setenv("CRATE_VDJ_ENABLED", "true")
    monkeypatch.setenv("CRATE_VDJ_AUTOMATION_ENABLED", "true")

    response = test_app.get("/api/capabilities")

    assert response.status_code == 200
    assert response.json()["vdj"] == {
        "available": True,
        "min_plugin_version": "1.0.0",
        "max_plugin_version": "1.x",
        "contract_version": "2026-08",
        "profile_schema_version": 1,
        "planner_version": "smart-mix-v2",
        "online_source": True,
        "smart_mix_assistant": True,
        "automation": True,
    }


def test_vdj_automation_requires_smart_mix(test_app, monkeypatch):
    monkeypatch.delenv("CRATE_SMART_MIX_ENABLED", raising=False)
    monkeypatch.setenv("CRATE_VDJ_ENABLED", "true")
    monkeypatch.setenv("CRATE_VDJ_AUTOMATION_ENABLED", "true")

    response = test_app.get("/api/capabilities")

    assert response.status_code == 200
    payload = response.json()["vdj"]
    assert payload["available"] is True
    assert payload["online_source"] is True
    assert payload["smart_mix_assistant"] is False
    assert payload["automation"] is False


def test_vdj_capabilities_expose_the_listen_url_when_configured(test_app, monkeypatch):
    monkeypatch.setenv("CRATE_VDJ_ENABLED", "true")
    monkeypatch.setenv("CRATE_LISTEN_PUBLIC_BASE_URL", "https://listen.example.org/")

    response = test_app.get("/api/capabilities")

    assert response.json()["vdj"]["listen_url"] == "https://listen.example.org"


def test_vdj_capabilities_omit_the_listen_url_when_unset(test_app, monkeypatch):
    monkeypatch.setenv("CRATE_VDJ_ENABLED", "true")
    monkeypatch.delenv("CRATE_LISTEN_PUBLIC_BASE_URL", raising=False)

    response = test_app.get("/api/capabilities")

    assert "listen_url" not in response.json()["vdj"]

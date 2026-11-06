from __future__ import annotations

_DECKS_CAPABILITIES = {
    "available": True,
    "min_client_version": "0.1.0",
    "contract_version": 1,
    "features": [],
}


def test_smart_mix_capabilities_default_to_disabled(test_app, monkeypatch):
    monkeypatch.delenv("CRATE_SMART_MIX_ENABLED", raising=False)
    monkeypatch.delenv("CRATE_ANDROID_NATIVE_CROSSFADE_ENABLED", raising=False)
    monkeypatch.delenv("CRATE_ANDROID_BEATMATCH_ENABLED", raising=False)
    monkeypatch.delenv("CRATE_ANDROID_BASS_HANDOFF_ENABLED", raising=False)

    response = test_app.get("/api/capabilities")

    assert response.status_code == 200
    assert response.json() == {
        "smart_mix": {
            "available": False,
            "planner_version": None,
            "planner_versions": [],
            "structure": False,
            "android_native_crossfade": False,
            "android_beatmatch": False,
            "android_bass_handoff": False,
            "android_long_beatmatch": False,
        },
        "vdj": {
            "available": False,
            "min_plugin_version": "1.0.0",
            "max_plugin_version": "1.x",
            "contract_version": "2026-08",
            "profile_schema_version": 1,
            "planner_version": "smart-mix-v2",
            "online_source": False,
            "smart_mix_assistant": False,
            "automation": False,
        },
        "decks": _DECKS_CAPABILITIES,
    }


def test_smart_mix_capabilities_support_local_environment_overrides(
    test_app, monkeypatch
):
    monkeypatch.setattr(
        "crate.api.capabilities.get_smart_mix_structure_percent", lambda: None
    )
    monkeypatch.setenv("CRATE_SMART_MIX_ENABLED", "true")
    monkeypatch.setenv("CRATE_ANDROID_NATIVE_CROSSFADE_ENABLED", "true")
    monkeypatch.setenv("CRATE_ANDROID_BEATMATCH_ENABLED", "true")
    monkeypatch.setenv("CRATE_ANDROID_BASS_HANDOFF_ENABLED", "true")

    response = test_app.get("/api/capabilities")

    assert response.status_code == 200
    assert response.json() == {
        "smart_mix": {
            "available": True,
            "planner_version": "smart-mix-v2",
            "planner_versions": ["smart-mix-v2", "smart-mix-v3"],
            "structure": False,
            "android_native_crossfade": True,
            "android_beatmatch": True,
            "android_bass_handoff": True,
            "android_long_beatmatch": True,
        },
        "vdj": {
            "available": False,
            "min_plugin_version": "1.0.0",
            "max_plugin_version": "1.x",
            "contract_version": "2026-08",
            "profile_schema_version": 1,
            "planner_version": "smart-mix-v2",
            "online_source": False,
            "smart_mix_assistant": False,
            "automation": False,
        },
        "decks": _DECKS_CAPABILITIES,
    }


def test_bass_handoff_requires_android_beatmatch(test_app, monkeypatch):
    monkeypatch.setenv("CRATE_SMART_MIX_ENABLED", "true")
    monkeypatch.setenv("CRATE_ANDROID_NATIVE_CROSSFADE_ENABLED", "true")
    monkeypatch.delenv("CRATE_ANDROID_BEATMATCH_ENABLED", raising=False)
    monkeypatch.setenv("CRATE_ANDROID_BASS_HANDOFF_ENABLED", "true")

    response = test_app.get("/api/capabilities")

    assert response.json()["smart_mix"]["android_bass_handoff"] is False

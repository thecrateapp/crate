from __future__ import annotations


def test_smart_mix_capabilities_default_to_disabled(test_app, monkeypatch):
    monkeypatch.delenv("CRATE_SMART_MIX_ENABLED", raising=False)
    monkeypatch.delenv("CRATE_ANDROID_NATIVE_CROSSFADE_ENABLED", raising=False)
    monkeypatch.delenv("CRATE_ANDROID_BEATMATCH_ENABLED", raising=False)

    response = test_app.get("/api/capabilities")

    assert response.status_code == 200
    assert response.json() == {
        "smart_mix": {
            "available": False,
            "planner_version": None,
            "android_native_crossfade": False,
            "android_beatmatch": False,
        },
        "vdj": {
            "available": False,
            "min_plugin_version": "1.0.0",
            "max_plugin_version": "1.x",
            "contract_version": "2026-08",
            "profile_schema_version": 1,
            "planner_version": "smart-mix-v1",
            "online_source": False,
            "smart_mix_assistant": False,
            "automation": False,
        },
    }


def test_smart_mix_capabilities_support_local_environment_overrides(
    test_app, monkeypatch
):
    monkeypatch.setenv("CRATE_SMART_MIX_ENABLED", "true")
    monkeypatch.setenv("CRATE_ANDROID_NATIVE_CROSSFADE_ENABLED", "true")
    monkeypatch.setenv("CRATE_ANDROID_BEATMATCH_ENABLED", "true")

    response = test_app.get("/api/capabilities")

    assert response.status_code == 200
    assert response.json() == {
        "smart_mix": {
            "available": True,
            "planner_version": "smart-mix-v1",
            "android_native_crossfade": True,
            "android_beatmatch": True,
        },
        "vdj": {
            "available": False,
            "min_plugin_version": "1.0.0",
            "max_plugin_version": "1.x",
            "contract_version": "2026-08",
            "profile_schema_version": 1,
            "planner_version": "smart-mix-v1",
            "online_source": False,
            "smart_mix_assistant": False,
            "automation": False,
        },
    }

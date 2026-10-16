from __future__ import annotations


def test_capabilities_keep_smart_mix_contract_stable(test_app, monkeypatch):
    monkeypatch.setenv("CRATE_SMART_MIX_ENABLED", "true")
    monkeypatch.delenv("CRATE_VDJ_ENABLED", raising=False)

    response = test_app.get("/api/capabilities")

    assert response.status_code == 200
    assert response.json()["smart_mix"] == {
        "available": True,
        "planner_version": "smart-mix-v2",
        "android_native_crossfade": False,
        "android_beatmatch": False,
    }

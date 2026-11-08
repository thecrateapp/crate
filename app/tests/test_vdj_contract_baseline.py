from __future__ import annotations


def test_capabilities_keep_smart_mix_contract_stable(test_app, monkeypatch):
    monkeypatch.setattr(
        "crate.api.capabilities.get_smart_mix_structure_percent", lambda: None
    )
    monkeypatch.setenv("CRATE_SMART_MIX_ENABLED", "true")
    monkeypatch.delenv("CRATE_VDJ_ENABLED", raising=False)

    response = test_app.get("/api/capabilities")

    assert response.status_code == 200
    smart_mix = response.json()["smart_mix"]
    # Smart Mix 3 adds planner_versions, structure and ai_assisted, and Smart Mix
    # Stems adds stems; the plugin reads
    # none of the smart_mix object, and every earlier field keeps its value. AI
    # Assisted Mixing stays off until an admin enables the refinement.
    ai_assisted = smart_mix.pop("ai_assisted")
    assert set(ai_assisted) == {
        "available",
        "provider_kind",
        "model_label",
        "prompt_version",
        "typical_latency_ms",
        "reason",
    }
    assert ai_assisted["available"] is False
    # Smart Mix Stems adds stems; Smart Mix playlists and stored stem audio come later.
    assert smart_mix.pop("stems") == {
        "available": True,
        "playlists": False,
        "storage": False,
    }
    assert smart_mix == {
        "available": True,
        "planner_version": "smart-mix-v2",
        "planner_versions": ["smart-mix-v2", "smart-mix-v3"],
        "structure": False,
        "android_native_crossfade": False,
        "android_beatmatch": False,
        "android_bass_handoff": False,
        "android_long_beatmatch": False,
    }

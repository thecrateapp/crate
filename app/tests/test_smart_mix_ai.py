"""Gate, keys and cache entries shared by the plan API and the task (SM4)."""

from __future__ import annotations

from datetime import UTC, datetime

from crate import smart_mix_ai
from crate.smart_mix.refinement import context_from_payload

CONTEXT = {
    "source": "playlist",
    "automatic": True,
    "offline": False,
    "preferredDurationMs": 12000,
    "userCueProfile": "auto",
    "allowBeatmatch": True,
    "allowTempoAdjustment": True,
    "allowBassHandoff": True,
}
EDGE = {
    "outgoing_track_entity_uid": "11111111-1111-4111-8111-111111111111",
    "incoming_track_entity_uid": "22222222-2222-4222-8222-222222222222",
    "outgoing_profile_revision": "a",
    "incoming_profile_revision": "b",
    "context": CONTEXT,
    "config_fingerprint": "f" * 64,
    "send_genre": True,
}


def test_refinement_key_changes_with_every_input():
    base = smart_mix_ai.edge_refinement_key(**EDGE)
    variants = [
        {"outgoing_profile_revision": "a2"},
        {"incoming_profile_revision": "b2"},
        {"config_fingerprint": "e" * 64},
        {"send_genre": False},
        {"context": {**CONTEXT, "preferredDurationMs": 8000}},
        {"context": {**CONTEXT, "setHistory": [{"mode": "beatmatch"}]}},
        {"incoming_track_entity_uid": "33333333-3333-4333-8333-333333333333"},
    ]

    assert len(base) == 64
    assert base == smart_mix_ai.edge_refinement_key(**EDGE)
    keys = {
        smart_mix_ai.edge_refinement_key(**{**EDGE, **change}) for change in variants
    }
    assert base not in keys and len(keys) == len(variants)


def test_context_from_payload_reads_the_normalized_flags():
    context = context_from_payload({**CONTEXT, "setHistory": []})

    assert context.allow_bass_handoff is True
    assert context.allow_long_beatmatch is False
    assert context.preferred_duration_ms == 12000


def test_gate_reason_is_closed():
    ready = {"enabled": True, "available": True, "fingerprint": "f" * 64}

    assert smart_mix_ai.gate_reason(ready) is None
    assert smart_mix_ai.gate_reason({**ready, "enabled": False}) == "disabled"
    assert smart_mix_ai.gate_reason({**ready, "available": False}) == "no_model"
    assert smart_mix_ai.gate_reason({**ready, "budget_exhausted": True}) == "budget"


def test_budget_marker_lasts_until_utc_midnight(monkeypatch):
    marked, invalidated = [], []
    monkeypatch.setattr(
        smart_mix_ai,
        "set_smart_mix_refinement_budget_marker",
        lambda fingerprint, seconds: marked.append((fingerprint, seconds)),
    )
    monkeypatch.setattr(
        smart_mix_ai, "delete_smart_mix_refinement_gate", lambda: invalidated.append(1)
    )

    smart_mix_ai.mark_budget_exhausted(
        "f" * 64, now=datetime(2026, 11, 6, 22, 30, tzinfo=UTC)
    )
    smart_mix_ai.mark_budget_exhausted(
        "f" * 64, now=datetime(2026, 11, 6, 23, 59, 50, tzinfo=UTC)
    )

    assert marked == [("f" * 64, 5400), ("f" * 64, 60)]
    assert invalidated == [1, 1]


def test_gate_is_read_once_and_skips_the_action_when_off(monkeypatch):
    settings = {"smart_mix_ai_enabled": "false"}
    availability_calls = []
    cache = {}
    monkeypatch.setattr(
        smart_mix_ai, "get_setting", lambda key, default: settings.get(key, default)
    )
    monkeypatch.setattr(
        smart_mix_ai,
        "action_availability",
        lambda action: (
            availability_calls.append(action)
            or {
                "available": True,
                "fingerprint": "f" * 64,
                "provider": "ollama",
                "model_id": "qwen3.8:27b",
                "error_code": None,
            }
        ),
    )
    monkeypatch.setattr(
        smart_mix_ai, "get_smart_mix_refinement_gate", lambda: cache.get("gate")
    )
    monkeypatch.setattr(
        smart_mix_ai,
        "set_smart_mix_refinement_gate",
        lambda gate: cache.__setitem__("gate", gate),
    )
    monkeypatch.setattr(
        smart_mix_ai, "smart_mix_refinement_budget_exhausted", lambda fp: False
    )

    off = smart_mix_ai.refinement_gate()
    assert smart_mix_ai.gate_reason(off) == "disabled"
    assert availability_calls == []
    assert smart_mix_ai.refinement_gate() is off

    cache.clear()
    settings["smart_mix_ai_enabled"] = "true"
    on = smart_mix_ai.refinement_gate()
    assert smart_mix_ai.gate_reason(on) is None
    assert on["send_genre"] is True and on["provider"] == "ollama"
    assert availability_calls == [smart_mix_ai.REFINE_ACTION]
    assert smart_mix_ai.provider_kind("ollama") == "local"
    assert smart_mix_ai.provider_kind("deepseek") == "cloud"


def test_cache_entry_of_a_stored_row():
    ready = {
        "status": "ready",
        "plan": {"durationMs": 15360},
        "candidate_index": 2,
        "reason": "Blend.",
        "confidence": 0.8,
        "model_label": "qwen3.8:27b",
        "prompt_version": "sm3-refine-1",
        "outcome_code": None,
    }

    assert smart_mix_ai.refined_cache_entry(ready) == {
        "status": "ready",
        "plan": {"durationMs": 15360},
        "candidateIndex": 2,
        "reason": "Blend.",
        "confidence": 0.8,
        "modelLabel": "qwen3.8:27b",
        "promptVersion": "sm3-refine-1",
    }
    assert smart_mix_ai.refined_cache_entry(
        {**ready, "status": "rejected", "outcome_code": "low_confidence"}
    ) == {"status": "rejected", "code": "low_confidence"}

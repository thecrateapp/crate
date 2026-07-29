from __future__ import annotations

from datetime import UTC, datetime

import pytest

from crate.smart_mix.models import (
    MixProfileQuality,
    TrackMixProfile,
    TransitionContext,
    TransitionFallbackReason,
    TransitionMode,
    TransitionPlan,
)


def profile(**overrides) -> TrackMixProfile:
    values = {
        "track_entity_uid": "track-uid",
        "profile_version": 1,
        "profile_revision": "profile-sha",
        "analyzer": "crate-rust",
        "analyzer_version": "1.0.0",
        "source_revision": "source-sha",
        "duration_ms": 245_000,
        "quality": MixProfileQuality.FULL,
        "bpm": 128.1,
        "bpm_confidence": 0.94,
        "key": "A",
        "scale": "minor",
        "camelot": "8A",
        "key_confidence": 0.88,
        "beat_grid_format": "delta-ms-v1",
        "beat_grid_ms": (482, 951, 1_419),
        "analyzed_at": datetime(2026, 7, 28, tzinfo=UTC),
    }
    values.update(overrides)
    return TrackMixProfile(**values)


@pytest.mark.parametrize(
    "quality",
    ["full", "partial", "legacy", "unavailable"],
)
def test_accepts_every_profile_quality(quality: str) -> None:
    assert profile(quality=quality).quality.value == quality


def test_clamps_profile_and_plan_confidences() -> None:
    mix_profile = profile(bpm_confidence=1.4, key_confidence=-0.2)
    plan = transition_plan(confidence=1.8)

    assert mix_profile.bpm_confidence == 1.0
    assert mix_profile.key_confidence == 0.0
    assert plan.confidence == 1.0


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("duration_ms", -1),
        ("beat_anchor_ms", -1),
        ("intro_cue_ms", 1.5),
    ],
)
def test_profile_milliseconds_are_non_negative_integers(
    field: str, value: object
) -> None:
    with pytest.raises((TypeError, ValueError)):
        profile(**{field: value})


def test_transition_plan_rejects_unsafe_tempo_ratio() -> None:
    with pytest.raises(ValueError):
        transition_plan(incoming_tempo_ratio=1.20)


def test_context_and_plan_serialize_for_typescript_and_java() -> None:
    context = TransitionContext(
        source="playlist",
        automatic=True,
        offline=False,
        preferred_duration_ms=5_000,
        user_cue_profile="default",
        allow_beatmatch=True,
        allow_tempo_adjustment=True,
    )
    plan = transition_plan(
        mode=TransitionMode.ADAPTIVE,
        fallback_reason=TransitionFallbackReason.LOW_CONFIDENCE,
    )

    assert context.to_dict() == {
        "source": "playlist",
        "automatic": True,
        "offline": False,
        "preferredDurationMs": 5_000,
        "userCueProfile": "default",
        "allowBeatmatch": True,
        "allowTempoAdjustment": True,
    }
    assert plan.to_dict()["plannerVersion"] == 1
    assert plan.to_dict()["incomingTempoRatio"] == 1.0
    assert plan.to_dict()["fallbackReason"] == "low_confidence"


def test_summary_omits_grid_while_full_serialization_includes_it() -> None:
    mix_profile = profile()

    summary = mix_profile.to_summary_dict()
    full = mix_profile.to_full_dict()

    assert "beatGridMs" not in summary
    assert full["trackEntityUid"] == "track-uid"
    assert full["beatGridMs"] == [482, 951, 1_419]
    assert full["analyzedAt"] == "2026-07-28T00:00:00Z"


def transition_plan(**overrides) -> TransitionPlan:
    values = {
        "planner_version": 1,
        "outgoing_track_entity_uid": "outgoing",
        "incoming_track_entity_uid": "incoming",
        "mode": TransitionMode.BEATMATCH,
        "duration_ms": 6_000,
        "outgoing_cue_ms": 218_140,
        "incoming_cue_ms": 16_020,
        "incoming_tempo_ratio": 1.0,
        "beat_phase_offset_ms": 18,
        "handoff_progress": 0.5,
        "outgoing_gain_db": -1.2,
        "incoming_gain_db": -0.4,
        "curve": "equal-power",
        "bass_handoff": "balanced",
        "confidence": 0.91,
        "fallback_reason": None,
    }
    values.update(overrides)
    return TransitionPlan(**values)

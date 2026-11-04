from __future__ import annotations

from datetime import UTC, datetime

import pytest

from crate.smart_mix.models import (
    MAX_ENERGY_CURVE_BARS,
    MAX_PHRASES,
    MixProfileQuality,
    Phrase,
    StructureDraft,
    TrackMixProfile,
    TransitionContext,
    TransitionFallbackReason,
    TransitionMode,
    TransitionPlan,
    mix_profile_draft_from_payload,
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
        ("intro_beat_ms", -1),
        ("outro_beat_ms", 2.5),
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
        "allowBassHandoff": False,
    }
    assert plan.to_dict()["plannerVersion"] == 1
    assert plan.to_dict()["incomingTempoRatio"] == 1.0
    assert plan.to_dict()["fallbackReason"] == "low_confidence"


def test_long_beatmatch_context_and_dj_blend_plan_serialize() -> None:
    context = TransitionContext(
        source="playlist",
        automatic=True,
        offline=False,
        preferred_duration_ms=5_000,
        user_cue_profile="default",
        allow_beatmatch=True,
        allow_tempo_adjustment=True,
        allow_long_beatmatch=True,
    )

    assert context.to_dict()["allowLongBeatmatch"] is True
    assert transition_plan(curve="dj-blend").to_dict()["curve"] == "dj-blend"
    with pytest.raises(ValueError, match="Unsupported transition curve"):
        transition_plan(curve="linear")


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


@pytest.mark.parametrize("field_name", ["bpm", "intro_bpm", "outro_bpm"])
@pytest.mark.parametrize("bpm", [float("nan"), float("inf"), 0.0, -120.0])
def test_profile_rejects_non_finite_or_non_positive_bpm(
    field_name: str, bpm: float
) -> None:
    with pytest.raises(ValueError):
        profile(**{field_name: bpm})


def test_summary_exposes_the_local_cue_tempo() -> None:
    payload = profile(
        intro_bpm=121.0, intro_beat_ms=7_811, outro_bpm=121.6, outro_beat_ms=165_037
    ).to_summary_dict()

    assert payload["introBpm"] == 121.0
    assert payload["introBeatMs"] == 7_811
    assert payload["outroBpm"] == 121.6
    assert payload["outroBeatMs"] == 165_037


def test_cue_beat_measurements_are_validated_and_exposed() -> None:
    payload = profile(
        intro_tempo_stability=1.3,
        outro_tempo_stability=0.82,
        intro_downbeat_ms=2_000,
        outro_downbeat_ms=162_000,
    ).to_summary_dict()

    assert payload["introTempoStability"] == 1.0
    assert payload["outroTempoStability"] == 0.82
    assert payload["introDownbeatMs"] == 2_000
    assert payload["outroDownbeatMs"] == 162_000
    with pytest.raises((TypeError, ValueError)):
        profile(outro_downbeat_ms=-1)


def test_rust_payload_carries_the_local_cue_tempo() -> None:
    draft = mix_profile_draft_from_payload(
        {
            "durationMs": 150_000,
            "quality": "full",
            "bpm": 121.3,
            "introBpm": 121.0,
            "introBeatMs": 7_811,
            "outroBpm": 121.6,
            "outroBeatMs": 145_930,
            "introTempoStability": 0.97,
            "outroTempoStability": 0.91,
            "introDownbeatMs": 2_011,
            "outroDownbeatMs": 144_000,
        }
    )

    assert (draft.intro_bpm, draft.intro_beat_ms) == (121.0, 7_811)
    assert (draft.outro_bpm, draft.outro_beat_ms) == (121.6, 145_930)
    assert (draft.intro_tempo_stability, draft.outro_tempo_stability) == (0.97, 0.91)
    assert (draft.intro_downbeat_ms, draft.outro_downbeat_ms) == (2_011, 144_000)


@pytest.mark.parametrize(
    "field_name",
    ["intro_lufs", "outro_lufs", "integrated_lufs", "true_peak_dbfs"],
)
def test_profile_rejects_non_finite_measurements(field_name: str) -> None:
    with pytest.raises(ValueError):
        profile(**{field_name: float("nan")})


@pytest.mark.parametrize(
    ("active_start_ms", "active_end_ms"),
    [(5_000, 5_000), (10_000, 2_000), (0, 245_001)],
)
def test_profile_rejects_active_bounds_outside_the_track(
    active_start_ms: int, active_end_ms: int
) -> None:
    with pytest.raises(ValueError):
        profile(active_start_ms=active_start_ms, active_end_ms=active_end_ms)


def test_summary_exposes_measurement_provenance_additively() -> None:
    payload = profile(
        active_start_ms=120,
        active_end_ms=244_000,
        integrated_lufs=-9.5,
        measurement_version="bs1770-v1",
        duration_source="decoder",
    ).to_summary_dict()

    assert payload["activeStartMs"] == 120
    assert payload["activeEndMs"] == 244_000
    assert payload["integratedLufs"] == -9.5
    assert payload["measurementVersion"] == "bs1770-v1"
    assert payload["durationSource"] == "decoder"


def test_legacy_profile_has_no_accredited_measurement() -> None:
    payload = profile().to_summary_dict()

    assert payload["measurementVersion"] is None
    assert payload["integratedLufs"] is None


def phrase(**overrides) -> Phrase:
    values = {
        "start_beat": 0,
        "start_ms": 1_000,
        "bars": 16,
        "energy": 0.6,
        "delta_energy": None,
        "kind": "intro",
    }
    values.update(overrides)
    return Phrase(**values)


def test_rust_payload_carries_the_structure() -> None:
    draft = mix_profile_draft_from_payload(
        {
            "durationMs": 150_000,
            "quality": "full",
            "phrases": [
                {
                    "startBeat": 0,
                    "startMs": 1_000,
                    "bars": 16,
                    "energy": 0.46,
                    "deltaEnergy": None,
                    "kind": "intro",
                },
                {
                    "startBeat": 64,
                    "startMs": 33_000,
                    "bars": 32,
                    "energy": 0.75,
                    "deltaEnergy": 0.29,
                    "kind": "peak",
                },
            ],
            "energyCurve": [117, 118, 193, 255],
            "vocalPresence": None,
            "structureConfidence": 0.89,
        }
    )

    assert draft.phrases == (
        phrase(energy=0.46),
        phrase(
            start_beat=64,
            start_ms=33_000,
            bars=32,
            energy=0.75,
            delta_energy=0.29,
            kind="peak",
        ),
    )
    assert draft.energy_curve == bytes([117, 118, 193, 255])
    assert draft.vocal_presence is None
    assert draft.structure_confidence == 0.89


def test_profiles_before_structure_keep_it_null() -> None:
    draft = mix_profile_draft_from_payload({"durationMs": 150_000, "quality": "full"})

    assert (draft.phrases, draft.energy_curve, draft.vocal_presence) == (
        None,
        None,
        None,
    )
    assert draft.structure_confidence is None
    assert profile().phrases is None
    assert profile().structure_confidence is None


def test_phrase_serializes_the_stored_shape() -> None:
    assert phrase(delta_energy=-0.1, kind="break").to_dict() == {
        "start_beat": 0,
        "start_ms": 1_000,
        "bars": 16,
        "energy": 0.6,
        "delta_energy": -0.1,
        "kind": "break",
    }


@pytest.mark.parametrize(
    "overrides",
    [
        {"bars": 12},
        {"kind": "drop"},
        {"start_beat": -4},
        {"energy": float("nan")},
        {"delta_energy": 1.5},
    ],
)
def test_phrase_rejects_invalid_values(overrides) -> None:
    with pytest.raises((TypeError, ValueError)):
        phrase(**overrides)


@pytest.mark.parametrize(
    "structure",
    [
        {"phrases": (phrase(), phrase(start_beat=32, start_ms=17_000))},
        {"phrases": (phrase(start_beat=64 * index) for index in range(2))},
        {
            "phrases": tuple(
                phrase(start_beat=32 * index, start_ms=1_000 + 16_000 * index, bars=8)
                for index in range(MAX_PHRASES + 1)
            )
        },
        {"energy_curve": bytes(MAX_ENERGY_CURVE_BARS + 1)},
        {"phrases": (phrase(),), "vocal_presence": bytes(2)},
        {"vocal_presence": bytes(1)},
    ],
)
def test_structure_rejects_overlapping_or_oversized_values(structure) -> None:
    with pytest.raises((TypeError, ValueError)):
        profile(**structure)


def test_structure_draft_clamps_confidence_and_normalizes_bytes() -> None:
    draft = StructureDraft(
        phrases=[phrase()], energy_curve=bytearray([1, 2]), structure_confidence=1.4
    )

    assert draft.phrases == (phrase(),)
    assert draft.energy_curve == b"\x01\x02"
    assert draft.structure_confidence == 1.0

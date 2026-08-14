from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime
import math

import pytest

from crate.smart_mix.models import (
    MixProfileQuality,
    TrackMixProfile,
    TransitionContext,
    TransitionFallbackReason,
    TransitionMode,
)
from crate.smart_mix.planner import plan_transition, score_compatibility
from crate.smart_mix.policy import PLANNER_POLICY_V1


def _context(
    *,
    source: str,
    automatic: bool = True,
    preferred_duration_ms: int = 6_000,
) -> TransitionContext:
    return TransitionContext(
        source=source,
        automatic=automatic,
        offline=False,
        preferred_duration_ms=preferred_duration_ms,
        user_cue_profile="default",
        allow_beatmatch=True,
        allow_tempo_adjustment=True,
    )


def _profile(track_uid: str, **overrides: object) -> TrackMixProfile:
    base = TrackMixProfile(
        track_entity_uid=track_uid,
        profile_version=1,
        profile_revision=f"profile-{track_uid}",
        analyzer="crate-rust",
        analyzer_version="smart-mix-v1",
        source_revision=f"source-{track_uid}",
        duration_ms=180_000,
        quality=MixProfileQuality.FULL,
        bpm=120.0,
        bpm_confidence=0.95,
        tempo_stability=0.97,
        beat_anchor_ms=500,
        downbeat_anchor_ms=500,
        time_signature=4,
        beat_grid_format="delta-ms-v1",
        beat_grid_ms=(500, 1_000, 1_500),
        key="A",
        scale="minor",
        camelot="8A",
        key_confidence=0.9,
        intro_cue_ms=8_000,
        outro_cue_ms=165_000,
        intro_lufs=-10.0,
        outro_lufs=-10.0,
        true_peak_dbfs=-1.0,
        intro_energy=0.7,
        outro_energy=0.7,
        global_energy=0.7,
        danceability=0.7,
        valence=0.5,
        analyzed_at=datetime(2026, 7, 28, tzinfo=UTC),
    )
    return replace(base, **overrides)


def _amplitude(db: float) -> float:
    return 10.0 ** (db / 20.0)


@pytest.mark.parametrize(
    ("context", "expected_mode"),
    [
        (_context(source="album"), TransitionMode.GAPLESS),
        (
            _context(source="manual", automatic=False),
            TransitionMode.ADAPTIVE,
        ),
        (_context(source="radio"), TransitionMode.BEATMATCH),
        (_context(source="shuffle"), TransitionMode.BEATMATCH),
        (_context(source="playlist"), TransitionMode.BEATMATCH),
    ],
)
def test_selects_transition_mode(
    context: TransitionContext,
    expected_mode: TransitionMode,
) -> None:
    plan = plan_transition(_profile("outgoing"), _profile("incoming"), context)

    assert plan.mode is expected_mode
    if expected_mode is TransitionMode.GAPLESS:
        assert plan.duration_ms == 0
    elif context.source == "manual":
        assert plan.duration_ms == PLANNER_POLICY_V1.manual_ramp_ms


@pytest.mark.parametrize(
    ("outgoing", "incoming", "reason"),
    [
        (
            _profile("outgoing", quality=MixProfileQuality.PARTIAL),
            _profile("incoming"),
            TransitionFallbackReason.LOW_CONFIDENCE,
        ),
        (
            _profile("outgoing", downbeat_anchor_ms=None),
            _profile("incoming"),
            TransitionFallbackReason.LOW_CONFIDENCE,
        ),
        (
            _profile("outgoing", tempo_stability=0.65),
            _profile("incoming"),
            TransitionFallbackReason.UNSTABLE_TEMPO,
        ),
        (
            _profile("outgoing", bpm=120.0),
            _profile("incoming", bpm=132.0),
            TransitionFallbackReason.INCOMPATIBLE_TEMPO,
        ),
        (
            _profile("outgoing", time_signature=4),
            _profile("incoming", time_signature=3),
            TransitionFallbackReason.INCOMPATIBLE_METER,
        ),
    ],
)
def test_degrades_unsafe_beatmatch_to_adaptive(
    outgoing: TrackMixProfile,
    incoming: TrackMixProfile,
    reason: TransitionFallbackReason,
) -> None:
    plan = plan_transition(outgoing, incoming, _context(source="radio"))

    assert plan.mode is TransitionMode.ADAPTIVE
    assert plan.fallback_reason is reason
    assert plan.incoming_tempo_ratio == 1.0
    assert plan.bass_handoff == "none"


def test_missing_profile_uses_fixed_safe_fallback() -> None:
    plan = plan_transition(
        None,
        _profile("incoming"),
        _context(source="radio", preferred_duration_ms=9_000),
        outgoing_track_entity_uid="missing-outgoing",
    )

    assert plan.mode is TransitionMode.ADAPTIVE
    assert plan.duration_ms == PLANNER_POLICY_V1.fallback_duration_ms
    assert plan.outgoing_track_entity_uid == "missing-outgoing"
    assert plan.fallback_reason is TransitionFallbackReason.MISSING_PROFILE
    assert plan.confidence == 0.0


@pytest.mark.parametrize(
    ("incoming_bpm", "expected_ratio"),
    [
        (122.0, 120.0 / 122.0),
        (60.0, 1.0),
        (240.0, 1.0),
    ],
)
def test_normalizes_half_and_double_tempo(
    incoming_bpm: float,
    expected_ratio: float,
) -> None:
    plan = plan_transition(
        _profile("outgoing", bpm=120.0),
        _profile("incoming", bpm=incoming_bpm),
        _context(source="radio"),
    )

    assert plan.mode is TransitionMode.BEATMATCH
    assert plan.incoming_tempo_ratio == pytest.approx(expected_ratio, abs=1e-4)


@pytest.mark.parametrize(
    ("incoming_camelot", "relationship", "expected_score"),
    [
        ("8A", "same", 1.0),
        ("9A", "adjacent", 0.8),
        ("8B", "relative", 0.9),
        ("2B", "incompatible", 0.3),
        (None, "unknown", 0.5),
    ],
)
def test_scores_camelot_relationships(
    incoming_camelot: str | None,
    relationship: str,
    expected_score: float,
) -> None:
    score = score_compatibility(
        _profile("outgoing", camelot="8A"),
        _profile("incoming", camelot=incoming_camelot),
    )

    assert score.harmonic_relationship == relationship
    assert score.harmonic == expected_score


def test_compatibility_score_uses_versioned_dimensions() -> None:
    score = score_compatibility(
        _profile(
            "outgoing",
            bpm=120.0,
            outro_energy=0.7,
            danceability=0.8,
            valence=0.4,
        ),
        _profile(
            "incoming",
            bpm=121.0,
            intro_energy=0.68,
            danceability=0.75,
            valence=0.45,
        ),
        bliss_similarity=0.9,
        genre_similarity=0.8,
    )

    assert score.planner_version == PLANNER_POLICY_V1.version
    assert score.overall > 0.8
    assert score.signal_confidence > 0.8
    assert set(score.to_dict()) == {
        "plannerVersion",
        "overall",
        "signalConfidence",
        "tempo",
        "harmonic",
        "harmonicRelationship",
        "energy",
        "danceability",
        "valence",
        "bliss",
        "genre",
    }


def test_gain_matching_is_capped_and_combined_true_peak_is_protected() -> None:
    plan = plan_transition(
        _profile(
            "outgoing",
            outro_lufs=-8.0,
            true_peak_dbfs=-0.1,
        ),
        _profile(
            "incoming",
            intro_lufs=-20.0,
            true_peak_dbfs=-0.2,
        ),
        _context(source="radio"),
    )

    assert plan.incoming_gain_db <= PLANNER_POLICY_V1.max_loudness_adjustment_db
    midpoint_envelope = math.sqrt(0.5)
    combined_peak = (
        _amplitude(-0.1 + plan.outgoing_gain_db) * midpoint_envelope
        + _amplitude(-0.2 + plan.incoming_gain_db) * midpoint_envelope
    )
    assert 20.0 * math.log10(combined_peak) <= (
        PLANNER_POLICY_V1.combined_true_peak_ceiling_dbfs + 1e-6
    )


def test_planner_is_deterministic_for_identical_inputs() -> None:
    outgoing = _profile("outgoing")
    incoming = _profile("incoming")
    context = _context(source="radio")

    assert plan_transition(outgoing, incoming, context) == plan_transition(
        outgoing,
        incoming,
        context,
    )

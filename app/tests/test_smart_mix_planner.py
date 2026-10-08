from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime
import json
import math
from pathlib import Path

import pytest

from crate.smart_mix.models import (
    MixProfileQuality,
    TrackMixProfile,
    TransitionContext,
    TransitionFallbackReason,
    TransitionMode,
)
from crate.smart_mix.planner import plan_transition, score_compatibility
from crate.smart_mix.policy import PLANNER_POLICY


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
        assert plan.duration_ms == PLANNER_POLICY.manual_ramp_ms


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
    assert plan.duration_ms == PLANNER_POLICY.fallback_duration_ms
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

    assert score.planner_version == PLANNER_POLICY.version
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

    assert plan.incoming_gain_db <= PLANNER_POLICY.max_loudness_adjustment_db
    midpoint_envelope = math.sqrt(0.5)
    combined_peak = (
        _amplitude(-0.1 + plan.outgoing_gain_db) * midpoint_envelope
        + _amplitude(-0.2 + plan.incoming_gain_db) * midpoint_envelope
    )
    assert 20.0 * math.log10(combined_peak) <= (
        PLANNER_POLICY.combined_true_peak_ceiling_dbfs + 1e-6
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


def _assert_plan_fits(plan, outgoing: TrackMixProfile, incoming: TrackMixProfile):
    assert plan.duration_ms >= 0
    assert plan.outgoing_cue_ms >= 0
    assert plan.incoming_cue_ms >= 0
    assert plan.outgoing_cue_ms + plan.duration_ms <= outgoing.duration_ms
    assert (
        plan.incoming_cue_ms + plan.duration_ms * plan.incoming_tempo_ratio
        <= incoming.duration_ms
    )


def test_late_outro_cue_moves_earlier_instead_of_running_past_the_track() -> None:
    outgoing = _profile("outgoing", outro_cue_ms=176_000)
    incoming = _profile("incoming")

    plan = plan_transition(
        outgoing,
        incoming,
        _context(source="radio", preferred_duration_ms=12_000),
    )

    _assert_plan_fits(plan, outgoing, incoming)
    assert plan.duration_ms == 12_000
    assert plan.outgoing_cue_ms <= 168_000
    assert plan.fallback_reason is None


def test_outro_cue_never_moves_into_the_protected_outgoing_body() -> None:
    outgoing = _profile(
        "outgoing",
        duration_ms=40_000,
        outro_cue_ms=39_000,
        bpm=None,
        bpm_confidence=None,
    )
    incoming = _profile("incoming")

    plan = plan_transition(
        outgoing,
        incoming,
        _context(source="radio", preferred_duration_ms=12_000),
    )

    _assert_plan_fits(plan, outgoing, incoming)
    assert plan.outgoing_cue_ms >= 20_000


def test_short_incoming_shortens_the_transition() -> None:
    outgoing = _profile("outgoing")
    incoming = _profile("incoming", duration_ms=25_000, intro_cue_ms=0)

    plan = plan_transition(
        outgoing,
        incoming,
        _context(source="radio", preferred_duration_ms=12_000),
    )

    _assert_plan_fits(plan, outgoing, incoming)
    assert plan.duration_ms <= 15_000


def test_intro_cue_near_the_end_restarts_incoming_from_zero() -> None:
    outgoing = _profile("outgoing")
    incoming = _profile("incoming", intro_cue_ms=175_000)

    plan = plan_transition(
        outgoing,
        incoming,
        _context(source="radio", preferred_duration_ms=12_000),
    )

    _assert_plan_fits(plan, outgoing, incoming)
    assert plan.incoming_cue_ms == 0


def test_impossible_window_degrades_to_a_short_cut() -> None:
    outgoing = _profile("outgoing", duration_ms=2_000, outro_cue_ms=1_900)
    incoming = _profile("incoming", duration_ms=1_500, intro_cue_ms=0)

    plan = plan_transition(
        outgoing,
        incoming,
        _context(source="radio", preferred_duration_ms=12_000),
    )

    _assert_plan_fits(plan, outgoing, incoming)
    assert plan.mode is TransitionMode.ADAPTIVE
    assert plan.duration_ms <= PLANNER_POLICY.manual_ramp_ms
    assert plan.fallback_reason is TransitionFallbackReason.INSUFFICIENT_WINDOW


@pytest.mark.parametrize("incoming_bpm", [113.2, 120.0, 127.0])
def test_tempo_adjusted_incoming_consumption_stays_inside_the_track(
    incoming_bpm: float,
) -> None:
    outgoing = _profile("outgoing")
    incoming = _profile(
        "incoming",
        bpm=incoming_bpm,
        duration_ms=30_000,
        intro_cue_ms=8_000,
    )

    plan = plan_transition(
        outgoing,
        incoming,
        _context(source="radio", preferred_duration_ms=12_000),
    )

    _assert_plan_fits(plan, outgoing, incoming)


def test_phase_offset_uses_both_beat_grids() -> None:
    outgoing = _profile("outgoing", downbeat_anchor_ms=500, outro_cue_ms=165_100)
    incoming = _profile("incoming", downbeat_anchor_ms=0, intro_cue_ms=8_000)

    plan = plan_transition(outgoing, incoming, _context(source="radio"))

    assert plan.mode is TransitionMode.BEATMATCH
    beat_ms = 60_000 / 120.0
    outgoing_phase = (plan.outgoing_cue_ms - 500) % beat_ms
    incoming_phase = (plan.incoming_cue_ms - 0) % beat_ms
    assert plan.beat_phase_offset_ms == round(
        (outgoing_phase - incoming_phase) % beat_ms
    )


def test_half_time_incoming_grid_is_normalized_before_phase() -> None:
    outgoing = _profile("outgoing", downbeat_anchor_ms=500)
    incoming = _profile("incoming", bpm=60.0, downbeat_anchor_ms=0)

    plan = plan_transition(outgoing, incoming, _context(source="radio"))

    assert plan.mode is TransitionMode.BEATMATCH
    assert 0 <= plan.beat_phase_offset_ms < 500


def test_unaccredited_loudness_never_boosts_the_incoming_deck() -> None:
    plan = plan_transition(
        _profile("outgoing", outro_lufs=-6.0, true_peak_dbfs=-12.0),
        _profile("incoming", intro_lufs=-20.0, true_peak_dbfs=-12.0),
        _context(source="radio"),
    )

    assert plan.incoming_gain_db <= 0.0


def test_unknown_true_peak_reserves_full_scale_headroom() -> None:
    plan = plan_transition(
        _profile("outgoing", true_peak_dbfs=None),
        _profile("incoming", true_peak_dbfs=None),
        _context(source="radio"),
    )

    ceiling = PLANNER_POLICY.combined_true_peak_ceiling_dbfs
    headroom = PLANNER_POLICY.equal_power_midpoint_headroom_db
    assert ceiling == -1.0
    assert plan.outgoing_gain_db <= ceiling - headroom
    assert plan.incoming_gain_db <= ceiling - headroom


@pytest.mark.parametrize("source", ["radio", "playlist", "shuffle"])
@pytest.mark.parametrize("track_ms", [1_000, 20_000, 45_000, 180_000, 600_000])
@pytest.mark.parametrize("outro_offset_ms", [None, 0, 1_000, 30_000])
@pytest.mark.parametrize("intro_cue_ms", [None, 0, 8_000, 590_000])
@pytest.mark.parametrize("incoming_bpm", [113.2, 120.0, 127.0, 60.0])
@pytest.mark.parametrize("preferred_ms", [0, 1_000, 6_000, 12_000])
def test_every_plan_stays_inside_both_tracks(
    source: str,
    track_ms: int,
    outro_offset_ms: int | None,
    intro_cue_ms: int | None,
    incoming_bpm: float,
    preferred_ms: int,
) -> None:
    outro_cue_ms = (
        None if outro_offset_ms is None else max(0, track_ms - outro_offset_ms)
    )
    outgoing = _profile("outgoing", duration_ms=track_ms, outro_cue_ms=outro_cue_ms)
    incoming = _profile(
        "incoming",
        duration_ms=track_ms,
        intro_cue_ms=intro_cue_ms,
        bpm=incoming_bpm,
    )

    plan = plan_transition(
        outgoing,
        incoming,
        _context(source=source, preferred_duration_ms=preferred_ms),
    )

    _assert_plan_fits(plan, outgoing, incoming)
    assert plan == plan_transition(
        outgoing,
        incoming,
        _context(source=source, preferred_duration_ms=preferred_ms),
    )


FIXTURE_PATH = (
    Path(__file__).resolve().parent / "fixtures/smart_mix/transition_plans_v2.json"
)
FIXTURE = json.loads(FIXTURE_PATH.read_text())


def test_shared_plan_fixture_matches_the_current_planner_version() -> None:
    assert FIXTURE["plannerVersion"] == PLANNER_POLICY.version


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=lambda case: case["name"])
def test_planner_reproduces_the_shared_plan_fixture(case: dict) -> None:
    plan = plan_transition(
        _profile("11111111-1111-4111-8111-111111111111", **case["outgoing"]),
        _profile("22222222-2222-4222-8222-222222222222", **case["incoming"]),
        _context(**case["context"]),
    )

    assert plan.to_dict() == case["expected"]


def test_accredited_loudness_may_raise_the_incoming_deck() -> None:
    plan = plan_transition(
        _profile(
            "outgoing",
            outro_lufs=-8.0,
            true_peak_dbfs=-12.0,
            measurement_version="bs1770-v1",
        ),
        _profile(
            "incoming",
            intro_lufs=-12.0,
            true_peak_dbfs=-12.0,
            measurement_version="bs1770-v1",
        ),
        _context(source="radio"),
    )

    assert plan.incoming_gain_db == pytest.approx(4.0)


def test_unaccredited_true_peak_is_treated_as_full_scale() -> None:
    plan = plan_transition(
        _profile("outgoing", true_peak_dbfs=-12.0),
        _profile("incoming", true_peak_dbfs=-12.0),
        _context(source="radio"),
    )

    ceiling = PLANNER_POLICY.combined_true_peak_ceiling_dbfs
    headroom = PLANNER_POLICY.equal_power_midpoint_headroom_db
    assert plan.outgoing_gain_db == pytest.approx(ceiling - headroom)


def test_active_end_bounds_the_transition_before_trailing_silence() -> None:
    outgoing = _profile("outgoing", outro_cue_ms=176_000, active_end_ms=172_000)
    incoming = _profile("incoming")

    plan = plan_transition(
        outgoing,
        incoming,
        _context(source="radio", preferred_duration_ms=12_000),
    )

    assert plan.outgoing_cue_ms + plan.duration_ms <= 172_000

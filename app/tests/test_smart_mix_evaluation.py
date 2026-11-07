from __future__ import annotations

import json
import math
import subprocess
import sys
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from crate.smart_mix.evaluation import (
    BASS_CUT_DB,
    OVERLAP_FLOOR_DB,
    bass_cut_db,
    bass_overlap_ms,
    crossfade_gains,
    edge_tempo_delta,
    energy_step,
    evaluate_transition,
    harmonic_clash_ms,
    incoming_start_ms,
    music_left_out,
    phrase_alignment,
    policy_violations,
    staging_gains,
    vocal_clash_ms,
)
from crate.smart_mix.models import (
    VOCAL_THRESHOLD,
    TrackMixProfile,
    TransitionContext,
    TransitionPlan,
)
from crate.smart_mix.planner import plan_transition
from crate.smart_mix.versions import ANALYZER_VERSION, MEASUREMENT_VERSION


APP_ROOT = Path(__file__).resolve().parents[1]
OUTGOING_UID = "00000000-0000-4000-8000-000000000001"
INCOMING_UID = "00000000-0000-4000-8000-000000000002"


def _profile(uid: str = OUTGOING_UID, **overrides: Any) -> TrackMixProfile:
    values: dict[str, Any] = {
        "track_entity_uid": uid,
        "profile_version": 1,
        "profile_revision": f"revision-{uid[-1]}",
        "analyzer": "crate-rust",
        "analyzer_version": ANALYZER_VERSION,
        "source_revision": "source",
        "duration_ms": 300_000,
        "quality": "full",
        "analyzed_at": datetime(2026, 11, 4, tzinfo=UTC),
        "bpm": 120.0,
        "bpm_confidence": 0.95,
        "tempo_stability": 0.97,
        "beat_anchor_ms": 0,
        "downbeat_anchor_ms": 0,
        "time_signature": 4,
        "camelot": "8A",
        "key_confidence": 0.8,
        "intro_cue_ms": 32_000,
        "outro_cue_ms": 240_000,
        "intro_energy": 0.5,
        "outro_energy": 0.5,
        "intro_lufs": -9.0,
        "outro_lufs": -9.0,
        "true_peak_dbfs": -1.0,
        "active_start_ms": 0,
        "active_end_ms": 300_000,
        "measurement_version": MEASUREMENT_VERSION,
    }
    values.update(overrides)
    return TrackMixProfile(**values)


def _plan(**overrides: Any) -> TransitionPlan:
    values: dict[str, Any] = {
        "planner_version": 2,
        "outgoing_track_entity_uid": OUTGOING_UID,
        "incoming_track_entity_uid": INCOMING_UID,
        "mode": "beatmatch",
        "duration_ms": 16_000,
        "outgoing_cue_ms": 160_000,
        "incoming_cue_ms": 32_000,
        "incoming_tempo_ratio": 1.0,
        "beat_phase_offset_ms": 0,
        "handoff_progress": 0.5,
        "outgoing_gain_db": -5.0,
        "incoming_gain_db": -5.0,
        "curve": "equal-power",
        "bass_handoff": "none",
        "confidence": 0.9,
    }
    values.update(overrides)
    return TransitionPlan(**values)


class _Structured:
    """A profile with the schema 2 structure fields SM1 adds (phrases, vocals)."""

    def __init__(
        self,
        profile: TrackMixProfile,
        *,
        phrases: list[dict[str, Any]] | None = None,
        vocal_presence: bytes | None = None,
    ) -> None:
        self._profile = profile
        self.phrases = phrases
        self.vocal_presence = vocal_presence

    def __getattr__(self, name: str) -> Any:
        return getattr(self._profile, name)


def _phrases(*starts_ms: int, energies: tuple[float, ...] = ()) -> list[dict]:
    return [
        {
            "start_ms": start,
            "bars": 8,
            "energy": energies[index] if index < len(energies) else 0.5,
            "kind": "body",
        }
        for index, start in enumerate(starts_ms)
    ]


def test_phrase_alignment_counts_boundaries() -> None:
    outgoing = _profile(OUTGOING_UID)
    incoming = _profile(INCOMING_UID)

    aligned = phrase_alignment(_plan(), outgoing, incoming)
    one_beat_late = phrase_alignment(_plan(incoming_cue_ms=32_500), outgoing, incoming)
    ten_ms_late = phrase_alignment(_plan(outgoing_cue_ms=160_010), outgoing, incoming)

    assert aligned is not None and aligned.basis == "grid"
    assert (aligned.aligned, aligned.checked) == (4, 4)
    assert aligned.start_aligned and aligned.end_aligned and aligned.fully_aligned
    assert one_beat_late is not None
    assert (one_beat_late.aligned, one_beat_late.checked) == (2, 4)
    assert not one_beat_late.start_aligned and not one_beat_late.fully_aligned
    assert ten_ms_late is not None and ten_ms_late.aligned == 4


def test_phrase_alignment_uses_phrases_when_present() -> None:
    outgoing = _Structured(
        _profile(OUTGOING_UID),
        phrases=_phrases(0, 150_000, 166_000, 182_000),
    )
    incoming = _Structured(
        _profile(INCOMING_UID),
        phrases=_phrases(0, 30_000, 46_000),
    )

    grid_aligned_plan = _plan()
    phrase_aligned_plan = _plan(
        outgoing_cue_ms=150_000,
        incoming_cue_ms=30_000,
    )

    on_grid = phrase_alignment(grid_aligned_plan, outgoing, incoming)
    on_phrases = phrase_alignment(phrase_aligned_plan, outgoing, incoming)
    mixed = phrase_alignment(phrase_aligned_plan, outgoing, _profile(INCOMING_UID))

    assert on_grid is not None and on_grid.basis == "phrases"
    assert on_grid.aligned == 0
    assert on_phrases is not None and on_phrases.aligned == 4
    assert mixed is not None and mixed.basis == "mixed"


def test_phrase_alignment_is_none_without_grid_or_phrases() -> None:
    no_tempo = _profile(INCOMING_UID, bpm=None, bpm_confidence=None)

    assert phrase_alignment(_plan(), _profile(), no_tempo) is None
    assert phrase_alignment(_plan(), None, _profile(INCOMING_UID)) is None


def test_phrase_alignment_follows_the_stored_beat_grid() -> None:
    drifting_grid = tuple(range(0, 200_000, 500)) + tuple(
        200_000 + 510 * index for index in range(1, 150)
    )
    outgoing = _profile(OUTGOING_UID, beat_grid_ms=drifting_grid)
    # Beat 448 (14 phrases of 32 beats) sits on a phrase of the stored grid
    # but 990 ms away from one of a constant 120 BPM grid.
    cue_ms = drifting_grid[448]

    result = phrase_alignment(
        _plan(outgoing_cue_ms=cue_ms, duration_ms=0, mode="adaptive"),
        outgoing,
        _profile(INCOMING_UID),
    )

    assert result is not None
    assert result.aligned >= 2


def test_bass_overlap_zero_without_handoff_overlap() -> None:
    outgoing = _profile(OUTGOING_UID)
    incoming = _profile(INCOMING_UID)

    handoff = bass_overlap_ms(_plan(bass_handoff="balanced"), outgoing, incoming)
    gapless = bass_overlap_ms(
        _plan(mode="gapless", duration_ms=0, curve="equal-power"),
        outgoing,
        incoming,
    )
    both_basses = bass_overlap_ms(_plan(bass_handoff="none"), outgoing, incoming)

    assert handoff == 0
    assert gapless == 0
    # Equal power keeps both decks at or above -6 dB for the middle third.
    assert both_basses == pytest.approx(16_000 / 3, abs=20)


def test_bass_overlap_ignores_handoff_outside_beatmatch_and_silence() -> None:
    adaptive = _plan(mode="adaptive", bass_handoff="balanced")
    silent_tail = _profile(OUTGOING_UID, active_end_ms=165_000)

    assert bass_overlap_ms(adaptive, _profile(), _profile(INCOMING_UID)) > 0
    assert bass_overlap_ms(_plan(), silent_tail, _profile(INCOMING_UID)) == 0


def test_harmonic_clash_uses_camelot_compatibility() -> None:
    outgoing = _profile(OUTGOING_UID, camelot="8A")

    adjacent = harmonic_clash_ms(
        _plan(), outgoing, _profile(INCOMING_UID, camelot="9A")
    )
    relative = harmonic_clash_ms(
        _plan(), outgoing, _profile(INCOMING_UID, camelot="8B")
    )
    clash = harmonic_clash_ms(_plan(), outgoing, _profile(INCOMING_UID, camelot="2B"))
    unknown = harmonic_clash_ms(_plan(), outgoing, _profile(INCOMING_UID, camelot=None))

    assert adjacent == 0
    assert relative == 0
    assert clash == pytest.approx(16_000 / 3, abs=20)
    assert unknown is None


def test_energy_step_symmetric() -> None:
    loud_out = _profile(OUTGOING_UID, outro_energy=0.8)
    quiet_in = _profile(INCOMING_UID, intro_energy=0.3)
    quiet_out = _profile(OUTGOING_UID, outro_energy=0.3)
    loud_in = _profile(INCOMING_UID, intro_energy=0.8)

    forward = energy_step(_plan(), loud_out, quiet_in)
    backward = energy_step(_plan(), quiet_out, loud_in)

    assert forward is not None and backward is not None
    assert forward.basis == backward.basis == "intro_outro"
    assert forward.value == pytest.approx(0.5)
    assert backward.value == pytest.approx(forward.value)
    assert forward.signed == pytest.approx(-0.5)
    assert backward.signed == pytest.approx(0.5)
    assert energy_step(_plan(), _profile(outro_energy=None), quiet_in) is None


def test_energy_step_reads_the_phrases_at_the_handoff() -> None:
    outgoing = _Structured(
        _profile(OUTGOING_UID, outro_energy=0.9),
        phrases=_phrases(0, 160_000, 168_000, energies=(0.2, 0.7, 0.4)),
    )
    incoming = _Structured(
        _profile(INCOMING_UID, intro_energy=0.1),
        phrases=_phrases(0, 32_000, 40_000, energies=(0.2, 0.3, 0.6)),
    )

    result = energy_step(_plan(), outgoing, incoming)

    # Handoff at 8 s: outgoing at 168 s (0.4), incoming at 40 s (0.6).
    assert result is not None and result.basis == "phrases"
    assert result.value == pytest.approx(0.2)


def test_vocal_clash_is_none_without_detector_data() -> None:
    with_phrases = _Structured(_profile(), phrases=_phrases(0, 160_000))

    assert vocal_clash_ms(_plan(), _profile(), _profile(INCOMING_UID)) is None
    assert vocal_clash_ms(_plan(), with_phrases, _profile(INCOMING_UID)) is None


def test_vocal_clash_counts_overlapping_vocal_phrases() -> None:
    outgoing = _Structured(
        _profile(OUTGOING_UID),
        phrases=_phrases(0, 160_000, 168_000),
        vocal_presence=bytes([0, 255, 0]),
    )
    vocal_in = _Structured(
        _profile(INCOMING_UID),
        phrases=_phrases(0, 32_000),
        vocal_presence=bytes([0, 230]),
    )
    instrumental_in = _Structured(
        _profile(INCOMING_UID),
        phrases=_phrases(0, 32_000),
        vocal_presence=bytes([0, 10]),
    )

    clash = vocal_clash_ms(_plan(), outgoing, vocal_in)

    # Both vocals sound together from 1/3 of the mix until the outgoing
    # vocal phrase ends at 8 s.
    assert clash == pytest.approx(8_000 - 16_000 / 3, abs=20)
    assert vocal_clash_ms(_plan(), outgoing, instrumental_in) == 0


def test_vocal_clash_reads_voice_with_the_sg1b_cut() -> None:
    # Gate SG1b: a phrase has voice from byte VOCAL_THRESHOLD (90), the cut the
    # server applies, not from half of the byte scale.
    outgoing = _Structured(
        _profile(OUTGOING_UID),
        phrases=_phrases(0, 160_000, 168_000),
        vocal_presence=bytes([0, VOCAL_THRESHOLD, 0]),
    )
    just_voiced_in = _Structured(
        _profile(INCOMING_UID),
        phrases=_phrases(0, 32_000),
        vocal_presence=bytes([0, VOCAL_THRESHOLD]),
    )
    just_below_in = _Structured(
        _profile(INCOMING_UID),
        phrases=_phrases(0, 32_000),
        vocal_presence=bytes([0, VOCAL_THRESHOLD - 1]),
    )

    assert vocal_clash_ms(_plan(), outgoing, just_voiced_in) == pytest.approx(
        8_000 - 16_000 / 3, abs=20
    )
    assert vocal_clash_ms(_plan(), outgoing, just_below_in) == 0


def test_music_left_out_counts_unplayed_outgoing_and_skipped_incoming() -> None:
    outgoing = _profile(OUTGOING_UID, active_end_ms=290_000)
    incoming = _profile(INCOMING_UID, active_start_ms=1_000)

    left_out = music_left_out(
        _plan(beat_phase_offset_ms=200, incoming_tempo_ratio=1.02),
        outgoing,
        incoming,
    )
    gapless = music_left_out(
        _plan(
            mode="gapless",
            duration_ms=0,
            outgoing_cue_ms=300_000,
            incoming_cue_ms=0,
        ),
        outgoing,
        _profile(INCOMING_UID),
    )

    assert left_out is not None and gapless is not None
    # The mix ends at 176 s of a track whose music ends at 290 s; the incoming
    # starts at 32 s plus the phase offset at its tempo, its music at 1 s.
    assert left_out.outgoing_unplayed_ms == 290_000 - 176_000
    assert left_out.incoming_skipped_ms == 32_000 + 204 - 1_000
    assert left_out.to_dict() == {
        "outgoingUnplayedMs": 114_000,
        "incomingSkippedMs": 31_204,
    }
    assert (gapless.outgoing_unplayed_ms, gapless.incoming_skipped_ms) == (0, 0)
    assert music_left_out(_plan(), None, incoming) is None
    evaluation = evaluate_transition(_plan(), outgoing, incoming)
    assert evaluation.to_dict()["musicLeftOut"] == {
        "outgoingUnplayedMs": 114_000,
        "incomingSkippedMs": 31_000,
    }


def test_policy_violations_detects_out_of_range_plan() -> None:
    outgoing = _profile(OUTGOING_UID)
    incoming = _profile(INCOMING_UID)
    context = TransitionContext(
        source="playlist",
        automatic=True,
        offline=False,
        preferred_duration_ms=12_000,
        user_cue_profile="auto",
        allow_beatmatch=True,
        allow_tempo_adjustment=True,
        allow_bass_handoff=True,
        allow_long_beatmatch=True,
    )
    planned = plan_transition(outgoing, incoming, context)

    too_fast = _plan(incoming_tempo_ratio=1.05)
    too_long = _plan(duration_ms=60_000, curve="dj-blend")
    too_loud = _plan(incoming_gain_db=7.5)
    clipping = _plan(outgoing_gain_db=0.0)
    early_cue = _plan(outgoing_cue_ms=5_000)
    late_incoming = _plan(incoming_cue_ms=280_000)
    no_handoff_context = replace(context, allow_bass_handoff=False)

    assert policy_violations(planned, outgoing, incoming, context=context) == ()
    assert "tempo_out_of_range" in policy_violations(too_fast, outgoing, incoming)
    assert "duration_out_of_range" in policy_violations(too_long, outgoing, incoming)
    assert "gain_out_of_range" in policy_violations(too_loud, outgoing, incoming)
    assert "true_peak_exceeded" in policy_violations(clipping, outgoing, incoming)
    assert "outgoing_body_too_short" in policy_violations(early_cue, outgoing, incoming)
    assert "incoming_body_too_short" in policy_violations(
        late_incoming, outgoing, incoming
    )
    assert "bass_handoff_not_allowed" in policy_violations(
        _plan(bass_handoff="balanced"),
        outgoing,
        incoming,
        context=no_handoff_context,
    )
    assert "track_mismatch" in policy_violations(_plan(), incoming, outgoing)


def test_policy_violations_allows_peak_safety_below_the_loudness_range() -> None:
    # A +3 dBFS true peak needs -1 - 3.0103 - 3 = -7.0103 dB to keep the
    # combined peak under -1 dBFS: more than the 6 dB of loudness matching.
    hot_master = _profile(INCOMING_UID, true_peak_dbfs=3.0)
    peak_limited = _plan(curve="dj-blend", incoming_gain_db=-7.0103)
    over_attenuated = _plan(curve="dj-blend", incoming_gain_db=-9.0)
    unmeasured = _profile(INCOMING_UID, measurement_version=None)

    assert policy_violations(peak_limited, _profile(), hot_master) == ()
    assert "gain_out_of_range" in policy_violations(
        over_attenuated, _profile(), hot_master
    )
    assert "gain_out_of_range" in policy_violations(
        peak_limited, _profile(), _profile(INCOMING_UID)
    )
    assert "gain_out_of_range" in policy_violations(
        _plan(curve="dj-blend", outgoing_gain_db=-6.0, incoming_gain_db=2.0),
        _profile(),
        unmeasured,
    )


def test_policy_violations_accepts_long_beatmatch_only_when_stable() -> None:
    long_blend = _plan(duration_ms=32_000, curve="dj-blend")
    unstable = _profile(INCOMING_UID, tempo_stability=0.85)

    assert policy_violations(long_blend, _profile(), _profile(INCOMING_UID)) == ()
    assert "long_beatmatch_ineligible" in policy_violations(
        long_blend, _profile(), unstable
    )
    assert "long_beatmatch_ineligible" in policy_violations(
        _plan(duration_ms=32_000), _profile(), _profile(INCOMING_UID)
    )


def test_policy_violations_accepts_the_planner_short_cut() -> None:
    short_track = _profile(
        INCOMING_UID,
        duration_ms=10_500,
        active_end_ms=10_500,
        intro_cue_ms=0,
        outro_cue_ms=9_000,
    )
    context = TransitionContext(
        source="playlist",
        automatic=True,
        offline=False,
        preferred_duration_ms=8_000,
        user_cue_profile="auto",
        allow_beatmatch=True,
        allow_tempo_adjustment=True,
    )
    planned = plan_transition(_profile(), short_track, context)

    assert planned.fallback_reason == "insufficient_window"
    assert planned.duration_ms == 350
    assert policy_violations(planned, _profile(), short_track) == ()


def test_crossfade_gains_match_the_android_curves() -> None:
    assert crossfade_gains(0.0, "equal-power") == pytest.approx((1.0, 0.0))
    assert crossfade_gains(0.5, "equal-power") == pytest.approx(
        (math.sqrt(0.5), math.sqrt(0.5))
    )
    assert crossfade_gains(1.0, "equal-power") == pytest.approx((0.0, 1.0))
    # DJ blend holds both decks at the equal-power midpoint from 30 % to 70 %.
    assert crossfade_gains(0.4, "dj-blend") == pytest.approx(
        crossfade_gains(0.6, "dj-blend")
    )
    assert crossfade_gains(0.4, "dj-blend")[0] == pytest.approx(math.sqrt(0.5))
    assert 20 * math.log10(math.sqrt(0.5)) > OVERLAP_FLOOR_DB


def test_staging_gains_ramp_like_the_android_envelope() -> None:
    assert staging_gains(0.0, -6.0, -6.0) == pytest.approx((1.0, 10 ** (-6 / 20)))
    assert staging_gains(0.5, -6.0, -6.0) == pytest.approx(
        (10 ** (-6 / 20), 10 ** (-6 / 20))
    )
    assert staging_gains(1.0, -6.0, -6.0) == pytest.approx((10 ** (-6 / 20), 1.0))


def test_bass_cut_db_swaps_around_the_handoff() -> None:
    assert bass_cut_db(0.0, 0.5) == pytest.approx((0.0, BASS_CUT_DB))
    assert bass_cut_db(0.5, 0.5) == pytest.approx((BASS_CUT_DB / 2, BASS_CUT_DB / 2))
    assert bass_cut_db(1.0, 0.5) == pytest.approx((BASS_CUT_DB, 0.0))
    assert bass_cut_db(0.43, 0.5) == pytest.approx((0.0, BASS_CUT_DB))
    assert bass_cut_db(0.57, 0.5) == pytest.approx((BASS_CUT_DB, 0.0))


def test_incoming_start_applies_phase_offset_only_for_beatmatch() -> None:
    beatmatch = _plan(beat_phase_offset_ms=200, incoming_tempo_ratio=1.04)
    adaptive = _plan(mode="adaptive", beat_phase_offset_ms=200)

    assert incoming_start_ms(beatmatch) == 32_000 + 208
    assert incoming_start_ms(adaptive) == 32_000


def test_edge_tempo_delta_normalizes_half_and_double_time() -> None:
    outgoing = _profile(OUTGOING_UID, bpm=128.0)

    assert edge_tempo_delta(outgoing, _profile(INCOMING_UID, bpm=64.0)) == 0.0
    assert edge_tempo_delta(
        outgoing, _profile(INCOMING_UID, bpm=124.0)
    ) == pytest.approx(128 / 124 - 1)
    assert edge_tempo_delta(
        _profile(OUTGOING_UID, bpm=128.0, outro_bpm=126.0, outro_beat_ms=1_000),
        _profile(INCOMING_UID, bpm=126.0),
    ) == pytest.approx(0.0)
    assert edge_tempo_delta(outgoing, _profile(INCOMING_UID, bpm=None)) is None


def test_evaluate_transition_collects_every_metric() -> None:
    # 16 s is eight bars at 120 BPM: a long beatmatch, so it needs DJ blend.
    result = evaluate_transition(
        _plan(curve="dj-blend"),
        _profile(OUTGOING_UID),
        _profile(INCOMING_UID, camelot="2B"),
    )
    payload = result.to_dict()

    assert result.policy_violations == ()
    assert result.harmonic_relationship == "incompatible"
    assert payload["phraseAlignment"] == {
        "aligned": 4,
        "checked": 4,
        "basis": "grid",
        "startAligned": True,
        "endAligned": True,
    }
    assert payload["bassOverlapMs"] == result.bass_overlap_ms
    assert payload["harmonicClashMs"] == result.harmonic_clash_ms
    assert payload["energyStep"] == {
        "value": 0.0,
        "signed": 0.0,
        "basis": "intro_outro",
    }
    assert payload["vocalClashMs"] is None
    json.dumps(payload)


def test_evaluate_transition_without_profiles_reports_unknowns() -> None:
    plan = _plan(mode="adaptive", duration_ms=3_000, outgoing_gain_db=0.0)

    result = evaluate_transition(plan, None, None)

    assert result.phrase_alignment is None
    assert result.harmonic_clash_ms is None
    assert result.energy_step is None
    assert result.policy_violations == ()


def test_metrics_are_pure() -> None:
    outgoing = _profile(OUTGOING_UID)
    incoming = _profile(INCOMING_UID, camelot="2B")
    plan = _plan()
    before = (plan.to_dict(), outgoing.to_full_dict(), incoming.to_full_dict())

    first = evaluate_transition(plan, outgoing, incoming)
    second = evaluate_transition(plan, outgoing, incoming)

    assert first == second
    assert (plan.to_dict(), outgoing.to_full_dict(), incoming.to_full_dict()) == before
    probe = (
        "import sys\n"
        "import crate.smart_mix.evaluation\n"
        "loaded = sorted(m for m in sys.modules if m.startswith("
        "('crate.db', 'sqlalchemy', 'psycopg', 'redis', 'dramatiq')))\n"
        "print(','.join(loaded))\n"
    )
    completed = subprocess.run(
        [sys.executable, "-c", probe],
        cwd=APP_ROOT,
        check=True,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert completed.stdout.strip() == ""

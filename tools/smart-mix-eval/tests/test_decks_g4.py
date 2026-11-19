"""The pure parts of the Decks G4 and G4b tools (tools/smart-mix-eval/decks_g4)."""

from __future__ import annotations

import numpy as np
import pytest

import metrics
import select_pairs
import survey
import tables


def _profile(**values):
    base = {
        "durationMs": 300_000,
        "quality": "full",
        "activeStartMs": 1_000,
        "activeEndMs": 295_000,
        "introCueMs": 33_000,
        "outroCueMs": 263_000,
    }
    return base | values


def test_autodj_fade_takes_the_shorter_of_intro_and_outro():
    # Outro 32 s, intro 32 s: Auto DJ fades over the whole outro
    fade = survey.autodj_fade_begin_s(_profile(), _profile())
    assert fade["fadeBeginS"] == pytest.approx(263.0)
    assert fade["fadeEndS"] == pytest.approx(295.0)
    assert fade["incomingStartS"] == pytest.approx(1.0)
    # A shorter intro shortens the fade (FullIntroOutro)
    fade = survey.autodj_fade_begin_s(_profile(), _profile(introCueMs=9_000))
    assert fade["fadeBeginS"] == pytest.approx(295.0 - 8.0)


def test_autodj_fade_of_partial_profiles_uses_the_transition_time():
    # AnalysisImporter skips partial profiles: only the first and last sound
    fade = survey.autodj_fade_begin_s(_profile(quality="partial"), _profile(quality="partial"))
    assert fade["fadeBeginS"] == pytest.approx(295.0 - survey.AUTO_DJ_TRANSITION_S)


def test_director_start_is_the_cue_or_earlier_to_end_in_time():
    plan = {"durationMs": 10_000, "outgoingCueMs": 100_000}
    assert survey.director_start_ms(plan, 300_000) == 100_000
    assert survey.director_start_ms(plan, 105_000) == pytest.approx(105_000 - 10_000 - 50)
    assert survey.director_start_ms({"durationMs": 10_000, "outgoingCueMs": 0}, 60_000) == (
        pytest.approx(60_000 - 10_000 - 50)
    )


def test_voiced_share_reads_the_phrases_at_each_end():
    phrases = [{}, {}, {}, {}]
    levels = bytes([200, 10, 95, 120])
    assert survey.voiced_share(phrases, levels, last=True) == 1.0
    assert survey.voiced_share(phrases, levels, last=False) == 0.5
    assert survey.voiced_share([], b"", last=True) is None


def test_tempo_gap_folds_half_and_double_time():
    assert select_pairs.tempo_gap({"outgoingBpm": 170, "incomingBpm": 85}) == pytest.approx(0.0)
    assert select_pairs.tempo_gap({"outgoingBpm": 120, "incomingBpm": 126}) == pytest.approx(0.05)


def _edge(uid_out, uid_in, mode="adaptive", reason="incompatible_tempo", late=0.0, **extra):
    plan = {
        "mode": mode,
        "bassHandoff": "balanced" if mode == "beatmatch" else "none",
        "curve": "equal-power",
        "fallbackReason": reason,
        "durationMs": 10_000,
        "lateByMs": late,
        "directorStartMs": 100_000.0,
    }
    return {
        "outgoing": uid_out,
        "incoming": uid_in,
        "outgoingQuality": "full",
        "incomingQuality": "full",
        "outgoingBpm": 120.0,
        "incomingBpm": 150.0,
        "outgoingVoicedEnd": 0.0,
        "incomingVoicedStart": 0.0,
        "outgoingOutroStartMs": 90_000,
        "autoDj": {"handoverS": 80.0},
        "plans": {"smart-mix-v3": plan, "smart-mix-v2": dict(plan)},
        **extra,
    }


def test_select_never_uses_a_track_twice_and_fails_short(monkeypatch):
    monkeypatch.setattr(
        select_pairs,
        "RULES",
        [("tempo", 2, lambda e: True, lambda e: -select_pairs.tempo_gap(e))],
    )
    edges = [_edge("a", "b"), _edge("b", "c"), _edge("c", "d")]
    chosen = select_pairs.select(edges)
    assert [(e["outgoing"], e["incoming"]) for e in chosen] == [("a", "b"), ("c", "d")]
    assert chosen[0]["renderStartMs"] == pytest.approx(80_000 - select_pairs.LEAD_IN_MS)
    with pytest.raises(SystemExit):
        select_pairs.select([_edge("a", "b"), _edge("b", "c")])


def test_sign_test_is_two_sided():
    assert tables.sign_test(0, 0) == 1.0
    assert tables.sign_test(5, 5) == 1.0
    assert tables.sign_test(9, 1) == pytest.approx(2 * 11 / 1024)


def test_compare_counts_beyond_the_noise_floor():
    current = {"beatClashMs": 0, "lockedShare": 0.9, "dipLu": 3.0}
    baseline = {"beatClashMs": 500, "lockedShare": 0.8, "dipLu": 3.2}
    signs = tables.compare(current, baseline)
    assert signs == {"beatClashMs": 1, "lockedShare": 1, "dipLu": 0}
    assert tables.net(signs) == 1


def test_transition_times_follow_the_director_or_auto_dj():
    trace = {
        "tMs": np.asarray([0.0, 10.0, 20.0, 30.0, 40.0]),
        "play1": np.asarray([1, 1, 1, 0, 0.0]),
        "play2": np.asarray([0, 1, 1, 1, 1.0]),
    }
    mixed = {
        "mixed": True,
        "durationMs": 10_000,
        "events": [
            {"state": "Armed", "tMs": 1.0},
            {"state": "Running", "tMs": 9.0},
            {"state": "Completed", "tMs": 29.0},
        ],
    }
    assert metrics.transition_times(mixed, trace) == (9.0, 29.0)
    assert metrics.transition_times({"mixed": False, "events": []}, trace) == (10.0, 30.0)


def test_alignment_is_zero_where_the_plan_puts_the_decks():
    plan = {"mode": "beatmatch", "incomingTempoRatio": 1.02, "startIncomingCueMs": 5_000}
    report = {
        "mixed": True,
        "playedPlan": plan,
        "plannedStartOutgoingMs": 100_000,
        "startOutgoingMs": 100_004,
    }
    t = np.arange(0.0, 1_000.0, 10.0)
    trace = {
        "tMs": t,
        "pos1Ms": 100_000 + t,
        "pos2Ms": 5_000 + (t + 3.0) * 1.02,
        "rate1": np.ones_like(t),
        "play2": np.ones_like(t),
    }
    result = metrics.alignment(report, trace, 0.0, 1_000.0)
    assert result["offsetMedianMs"] == pytest.approx(3.0)
    assert result["offsetDriftMs"] == pytest.approx(0.0, abs=1e-6)
    assert result["startVsPlanOutgoingMs"] == pytest.approx(4.0)


def test_short_by_is_the_handover_past_the_plans_start():
    import compare_runs

    report = {
        "plannedStartOutgoingMs": 100_000,
        "events": [{"state": "Armed", "outgoingMs": 145_800}, {"state": "Running", "outgoingMs": 145_800}],
    }
    assert compare_runs.short_by(report) == pytest.approx(45.8)
    report["events"][0]["outgoingMs"] = 90_000
    assert compare_runs.short_by(report) == 0.0
    assert compare_runs.short_by({"plannedStartOutgoingMs": 0, "events": []}) == 0.0


def test_offsets_collect_the_decks_starts():
    import compare_runs

    measures = {
        "p01": {"decks-v3": {"alignment": {"offsetAtStartMs": 17.4}}, "decks-v2": {"alignment": {}}},
        "p02": {"decks-v3": {"alignment": None}, "decks-v2": {"alignment": {"offsetAtStartMs": 0.0}}},
    }
    assert compare_runs.offsets(measures, ["p01", "p02"]) == [17.4, 0.0]

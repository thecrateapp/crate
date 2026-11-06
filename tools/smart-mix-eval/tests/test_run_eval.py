from __future__ import annotations

import json
from dataclasses import replace
from datetime import UTC, datetime

import pytest

from run_eval import (
    CONTEXTS,
    PLANNERS,
    build_report,
    compare_reports,
    evaluate_dataset,
    percentile,
    render_markdown,
    summarize,
)
from crate.smart_mix.models import TrackMixProfile
from crate.smart_mix.versions import MEASUREMENT_VERSION

OUT = "00000000-0000-4000-8000-000000000001"
IN = "00000000-0000-4000-8000-000000000002"
OTHER = "00000000-0000-4000-8000-000000000003"


def _profile(uid: str, **overrides) -> TrackMixProfile:
    values = {
        "track_entity_uid": uid,
        "profile_version": 1,
        "profile_revision": f"rev-{uid[-1]}",
        "analyzer": "crate-rust",
        "analyzer_version": "smart-mix-audio-v6",
        "source_revision": "source",
        "duration_ms": 300_000,
        "quality": "full",
        "analyzed_at": datetime(2026, 11, 4, tzinfo=UTC),
        "bpm": 124.0,
        "bpm_confidence": 0.95,
        "tempo_stability": 0.97,
        "beat_anchor_ms": 120,
        "downbeat_anchor_ms": 120,
        "time_signature": 4,
        "camelot": "8A",
        "intro_cue_ms": 15_600,
        "outro_cue_ms": 240_000,
        "intro_energy": 0.5,
        "outro_energy": 0.6,
        "intro_lufs": -9.0,
        "outro_lufs": -9.0,
        "true_peak_dbfs": -1.0,
        "active_start_ms": 0,
        "active_end_ms": 298_000,
        "measurement_version": MEASUREMENT_VERSION,
    }
    values.update(overrides)
    return TrackMixProfile(**values)


def _row(edge_id: str, outgoing: str, incoming: str, stratum: str) -> dict:
    root, band = stratum.split("/")
    return {
        "edgeId": edge_id,
        "stratum": stratum,
        "rootGenre": root,
        "tempoBand": band,
        "tempoDelta": 0.0,
        "outgoingTrackEntityUid": outgoing,
        "incomingTrackEntityUid": incoming,
        "outgoingProfileRevision": f"rev-{outgoing[-1]}",
        "incomingProfileRevision": f"rev-{incoming[-1]}",
    }


def _records() -> list[dict]:
    profiles = {
        OUT: _profile(OUT),
        IN: _profile(IN, camelot="2B", profile_revision="rev-changed"),
        OTHER: None,
    }
    rows = [
        _row("e0001", OUT, IN, "electronic/0-2"),
        _row("e0002", IN, OUT, "electronic/2-4"),
        _row("e0003", OUT, OTHER, "rock/0-2"),
    ]
    return evaluate_dataset(
        rows, profiles, planner="smart-mix-v2", context=CONTEXTS["dj"]
    )


def test_percentile_interpolates_between_ranks() -> None:
    assert percentile([1.0, 2.0, 3.0, 4.0], 0.5) == pytest.approx(2.5)
    assert percentile([10.0], 0.95) == 10.0
    assert percentile([0.0, 100.0], 0.95) == pytest.approx(95.0)
    assert percentile([], 0.5) is None


def test_evaluate_dataset_plans_every_edge_with_the_chosen_planner() -> None:
    records = _records()

    assert [record["edgeId"] for record in records] == ["e0001", "e0002", "e0003"]
    assert records[0]["plan"]["mode"] == "beatmatch"
    assert records[0]["profiles"] == {"outgoing": "current", "incoming": "drifted"}
    assert records[2]["profiles"] == {"outgoing": "current", "incoming": "missing"}
    assert records[2]["plan"]["fallbackReason"] == "missing_profile"
    assert records[0]["metrics"]["harmonicRelationship"] == "incompatible"
    assert records[0]["metrics"]["policyViolations"] == []
    assert set(PLANNERS) == {"smart-mix-v2", "smart-mix-v3"}
    assert "structureUsed" not in records[0]
    json.dumps(records)


def test_summarize_counts_metrics_and_unavailable_values() -> None:
    summary = summarize(_records())

    assert summary["edges"] == 3
    assert summary["modes"] == {"adaptive": 1, "beatmatch": 2}
    assert summary["profiles"] == {"current": 3, "drifted": 2, "missing": 1}
    assert summary["policyViolations"]["plans"] == 0
    assert summary["phraseAlignment"]["unavailable"] == 1
    assert summary["phraseAlignment"]["byBasis"]["grid"]["n"] == 2
    assert summary["harmonicClashMs"]["unknown"] == 1
    assert summary["harmonicClashMs"]["n"] == 2
    assert summary["harmonicClashMs"]["clashRate"] == 1.0
    assert summary["vocalClashMs"]["unavailable"] == 3
    assert summary["vocalClashMs"]["n"] == 0
    assert summary["vocalClashMs"]["mean"] is None
    assert summary["energyStep"]["byBasis"]["intro_outro"]["n"] == 2
    assert summary["bassOverlapMs"]["n"] == 3


def test_build_report_groups_by_stratum_band_and_genre() -> None:
    report = build_report(_records(), meta={"planner": "smart-mix-v2"})

    assert set(report["byStratum"]) == {"electronic/0-2", "electronic/2-4", "rock/0-2"}
    assert set(report["byTempoBand"]) == {"0-2", "2-4"}
    assert set(report["byRootGenre"]) == {"electronic", "rock"}
    assert report["byStratum"]["rock/0-2"]["n"] == 1
    assert report["comparison"] is None


def test_compare_reports_gives_per_stratum_deltas() -> None:
    records = _records()
    baseline = build_report(records, meta={"planner": "smart-mix-v2"})
    longer = [
        {
            **record,
            "metrics": {**record["metrics"], "bassOverlapMs": 1_000},
        }
        for record in records
    ]
    current = build_report(longer, meta={"planner": "variant"})

    comparison = compare_reports(current, baseline)

    assert comparison["pairedEdges"] == 3
    assert comparison["overall"]["bassOverlapMsMean"] == pytest.approx(
        1_000 - baseline["overall"]["bassOverlapMsMean"]
    )
    assert set(comparison["byStratum"]) == set(baseline["byStratum"])
    assert comparison["byStratum"]["rock/0-2"]["n"] == 0


def test_render_markdown_lists_every_metric() -> None:
    report = build_report(
        _records(),
        meta={
            "planner": "smart-mix-v2",
            "context": "dj",
            "dataset": {"path": "dataset.jsonl", "edges": 3, "sha256": "abc"},
        },
    )
    report = replace_comparison(report)

    markdown = render_markdown(report)

    for heading in (
        "# Smart Mix evaluation: smart-mix-v2",
        "## Overall",
        "## By tempo band",
        "## By root genre",
        "## By stratum",
        "## Comparison",
    ):
        assert heading in markdown
    for label in (
        "Policy violations",
        "Phrase alignment",
        "Bass overlap",
        "Harmonic clash",
        "Energy step",
        "Vocal clash",
    ):
        assert label in markdown
    assert "n/a" in markdown


def replace_comparison(report: dict) -> dict:
    return {**report, "comparison": compare_reports(report, report)}


def test_contexts_cover_dj_and_listen_defaults() -> None:
    assert CONTEXTS["dj"].allow_long_beatmatch and CONTEXTS["dj"].allow_bass_handoff
    assert not CONTEXTS["listen"].allow_bass_handoff
    assert replace(CONTEXTS["dj"], allow_beatmatch=False) != CONTEXTS["dj"]


def test_load_profiles_reads_the_stored_structure(monkeypatch) -> None:
    # Phrase metrics fall back to the 8-bar grid when a profile carries no phrases,
    # so a loader that skips the structure columns measures v7 profiles like v6.
    from crate.db.repositories import smart_mix as repository

    import run_eval

    reads = []

    def fake_profiles(uids, **options):
        reads.append(options)
        return [None] * len(uids)

    monkeypatch.setattr(
        repository, "get_track_mix_profiles_by_entity_uids", fake_profiles
    )

    assert run_eval.load_profiles([OUT, IN]) == {OUT: None, IN: None}
    assert reads == [{"include_beat_grid": True, "include_structure": True}]


def _structured_pair() -> dict:
    from tests.smart_mix_candidate_cases import (
        INCOMING_LAYOUT,
        OUTGOING_LAYOUT,
        profile,
    )

    return {
        OUT: profile(OUT, layout=OUTGOING_LAYOUT, outro_cue_ms=215_520),
        IN: profile(IN, layout=INCOMING_LAYOUT),
        OTHER: _profile(OTHER),
    }


def test_v3_plans_the_edge_set_as_the_api_does() -> None:
    from crate.smart_mix.planner import plan_transition_v3

    from run_eval import PLANNER_RULES

    profiles = _structured_pair()
    rows = [
        _row("e0001", OUT, IN, "electronic/0-2"),
        _row("e0002", IN, OTHER, "electronic/0-2"),
    ]

    records = evaluate_dataset(
        rows, profiles, planner="smart-mix-v3", context=CONTEXTS["dj"]
    )
    v2 = evaluate_dataset(
        rows, profiles, planner="smart-mix-v2", context=CONTEXTS["dj"]
    )
    summary = summarize(records)

    expected = plan_transition_v3(
        profiles[OUT],
        profiles[IN],
        CONTEXTS["dj"],
        outgoing_track_entity_uid=OUT,
        incoming_track_entity_uid=IN,
    )
    assert records[0]["plan"] == expected.plan.to_dict()
    assert records[0]["structureUsed"] is True
    assert records[0]["candidates"] == len(expected.candidates)
    # Without phrases on both tracks v3 plans as v2.
    assert records[1]["structureUsed"] is False
    assert records[1]["plan"] == v2[1]["plan"]
    assert summary["structureUsed"] == {"edges": 1, "rate": 0.5}
    assert PLANNER_RULES["smart-mix-v3"] == 1
    json.dumps(records)


def test_reports_summarize_the_music_a_mix_leaves_out() -> None:
    records = _records()

    summary = summarize(records)
    group = build_report(records, meta={"planner": "smart-mix-v2"})["overall"]
    markdown = render_markdown(
        build_report(records, meta={"planner": "smart-mix-v2", "dataset": {}})
    )

    unplayed = [
        record["metrics"]["musicLeftOut"]["outgoingUnplayedMs"]
        for record in records
        if record["metrics"]["musicLeftOut"]
    ]
    assert summary["musicLeftOutMs"]["outgoingUnplayed"]["n"] == len(unplayed)
    assert group["unplayedMsMean"] == pytest.approx(sum(unplayed) / len(unplayed))
    assert "Outgoing music after the mix (ms)" in markdown
    assert "Unplayed ms" in markdown

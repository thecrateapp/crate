from __future__ import annotations

import json
from pathlib import Path
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
    assert set(PLANNERS) == {"smart-mix-v2", "smart-mix-v3", "smart-mix-v3-nostems"}
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
    # Revision 6 (LV-G1) serves every source but Crate Decks within Listen's caps.
    assert PLANNER_RULES["smart-mix-v3"] == 6
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


# --- AI refinement (SM5) ------------------------------------------------------


class FakeRefiner:
    """Answers each edge with a fixed outcome; records the jobs it was given."""

    def __init__(self, outcomes) -> None:
        self.outcomes = outcomes
        self.jobs = []

    def refine_many(self, jobs, *, concurrency=1):
        self.jobs.extend(jobs)
        return [self.outcomes[job.edge_id](job) for job in jobs]


def _ready(index: int, **values):
    from refine import EdgeRefinement

    def outcome(job):
        return EdgeRefinement(
            status="ready",
            code=None,
            called=True,
            candidate_index=index,
            plan=job.candidates[index].to_plan(),
            confidence=0.8,
            reason="Phrase-aligned.",
            **values,
        )

    return outcome


def _rejected(code: str, **values):
    from refine import EdgeRefinement

    return lambda job: EdgeRefinement(status="rejected", code=code, **values)


def _refined_records(outcomes, *, rows=None, genres=None):
    profiles = _structured_pair()
    rows = rows or [
        _row("e0001", OUT, IN, "pool/0-2"),
        _row("e0002", IN, OUT, "pool/2-4"),
        _row("e0003", OUT, "00000000-0000-4000-8000-000000000009", "pool/0-2"),
    ]
    refiner = FakeRefiner(outcomes)
    records = evaluate_dataset(
        rows,
        profiles,
        planner="smart-mix-v3",
        context=CONTEXTS["dj"],
        refiner=refiner,
        genres=genres or {OUT: "techno", IN: "deep-house"},
        genre_root=lambda slug: {
            "techno": "electronic",
            "deep-house": "electronic",
        }.get(slug or "", "unknown"),
    )
    return records, refiner


def test_refinement_serves_the_ready_plan_and_keeps_the_deterministic_one() -> None:
    records, refiner = _refined_records(
        {"e0001": _ready(1), "e0002": _rejected("low_confidence", called=True)}
    )

    # Only edges with both profiles reach the model, with the prompt's genres.
    assert [job.edge_id for job in refiner.jobs] == ["e0001", "e0002"]
    assert refiner.jobs[0].genres == ("techno", "deep-house")
    first, second, missing = records
    menu = refiner.jobs[0].candidates
    assert first["plan"] == menu[1].to_plan().to_dict()
    assert first["deterministic"]["plan"] == menu[0].to_plan().to_dict()
    assert first["refinement"]["status"] == "ready"
    assert first["refinement"]["changed"] is True
    assert first["refinement"]["candidates"] == len(menu)
    assert first["metrics"] != first["deterministic"]["metrics"]
    # A rejection leaves the client on the deterministic plan.
    assert second["plan"] == second["deterministic"]["plan"]
    assert second["refinement"]["changed"] is False
    assert second["refinement"]["code"] == "low_confidence"
    assert missing["refinement"]["status"] == "unavailable"
    assert missing["refinement"]["code"] == "missing_profile"
    # A pool edge is grouped by the genre the prompt carried.
    assert first["genreRoot"] == "electronic"
    assert missing["genreRoot"] == "electronic"
    json.dumps(records)


def test_genre_root_keeps_the_dataset_genre_outside_pools() -> None:
    records, _refiner = _refined_records(
        {"e0001": _ready(0)}, rows=[_row("e0001", OUT, IN, "rock/0-2")]
    )
    assert records[0]["genreRoot"] == "rock"
    assert records[0]["refinement"]["changed"] is False


def test_refinement_summary_reports_rejections_latency_tokens_and_cost() -> None:
    from run_eval import refinement_summary

    usage = {"input_tokens": 3_000, "output_tokens": 100, "thought_tokens": 300}
    records, _refiner = _refined_records(
        {
            "e0001": _ready(1, latency_ms=2_000, usage=usage, cost_usd=0.004),
            "e0002": _rejected(
                "low_confidence",
                called=True,
                latency_ms=4_000,
                usage=usage,
                cost_usd=0.006,
            ),
        }
    )

    summary = refinement_summary(records)

    assert summary["edges"] == 3
    assert summary["statuses"] == {"ready": 1, "rejected": 1, "unavailable": 1}
    assert summary["codes"] == {"low_confidence": 1, "missing_profile": 1}
    assert summary["calls"] == 2
    assert summary["rejectionRate"] == 0.5
    assert summary["failureRate"] == 0.0
    assert summary["changedRate"] == pytest.approx(1 / 3, abs=1e-4)
    assert summary["latencyMs"]["p50"] == pytest.approx(3_000)
    assert summary["latencyMs"]["p95"] == pytest.approx(3_900)
    assert summary["tokens"]["input"]["mean"] == 3_000
    assert summary["tokens"]["output"]["mean"] == 400
    assert summary["cost"]["totalUsd"] == pytest.approx(0.01)
    assert summary["cost"]["perTransitionUsd"] == pytest.approx(0.005)
    assert summary["candidateIndex"] == {"1": 1}
    delta = summary["delta"]["overall"]
    # Paired deltas keep the edge count instead of a difference of counts.
    assert delta["n"] == 3
    assert set(summary["delta"]) >= {"overall", "byTempoBand", "byGenreRoot", "changed"}
    assert summary["delta"]["changed"]["n"] == 1
    assert summary["delta"]["byTempoBand"]["0-2"]["n"] == 2
    assert summary["deterministic"]["n"] == 3
    assert summary["refined"]["n"] == 3


def test_single_candidate_menus_do_not_count_as_rejected_answers() -> None:
    from run_eval import refinement_summary

    records, _refiner = _refined_records(
        {"e0001": _ready(0, latency_ms=1_000), "e0002": _rejected("single_candidate")}
    )
    summary = refinement_summary(records)
    assert summary["calls"] == 1
    assert summary["rejectionRate"] == 0.0


def test_sg3_criteria_compare_served_and_deterministic_plans() -> None:
    from run_eval import sg3_criteria

    deterministic = {
        "phraseFullyAlignedRate": 0.2,
        "phraseAlignedFraction": 0.5,
        "bassOverlapMsMean": 2_000.0,
        "harmonicClashMsMean": 4_000.0,
        "energyStepMean": 0.05,
        "vocalClashMsMean": 70.0,
    }
    refined = {
        **deterministic,
        "phraseFullyAlignedRate": 0.25,
        "bassOverlapMsMean": 2_500.0,
        "vocalClashMsMean": None,
    }
    stats = {
        "readyViolations": 0,
        "rejectionRate": 0.12,
        "latencyMs": {"p50": 3_000, "p95": 25_000},
    }

    criteria = {
        item["id"]: item
        for item in sg3_criteria(deterministic, refined, stats, provider_kind="cloud")
    }

    assert criteria["policy_violations"]["pass"] is True
    assert criteria["phrase_alignment"]["pass"] is True
    assert criteria["bass_overlap"]["pass"] is False
    assert criteria["harmonic_clash"]["pass"] is True
    assert criteria["energy_continuity"]["pass"] is True
    assert criteria["vocal_clash"]["pass"] is None
    assert criteria["rejection_rate"]["pass"] is False
    assert criteria["latency"]["pass"] is True
    local = {
        item["id"]: item
        for item in sg3_criteria(deterministic, refined, stats, provider_kind="local")
    }
    assert local["latency"]["pass"] is False


def test_refined_report_markdown_has_the_ai_section() -> None:
    from run_eval import refinement_summary

    records, _refiner = _refined_records(
        {"e0001": _ready(1, latency_ms=2_000), "e0002": _rejected("low_confidence")}
    )
    report = build_report(
        records,
        meta={
            "planner": "smart-mix-v3",
            "context": "dj",
            "dataset": {},
            "refine": {
                "model": "gemini/gemini-3.8-flash",
                "providerKind": "cloud",
                "price": {
                    "source": "https://example.test/pricing",
                    "date": "2026-11-07",
                },
            },
        },
    )
    assert report["refinement"] == {
        **refinement_summary(records),
        "criteria": report["refinement"]["criteria"],
    }
    markdown = render_markdown(report)
    for text in (
        "## AI refinement: gemini/gemini-3.8-flash",
        "Rejection rate",
        "Latency",
        "Tokens per transition",
        "## SG3 criteria",
        "## Served minus deterministic",
        "By genre",
        "https://example.test/pricing",
    ):
        assert text in markdown
    # Delta tables keep the edge count unsigned.
    assert "| all edges | 3 |" in markdown


def test_refine_needs_the_v3_planner() -> None:
    from run_eval import parse_args

    base = ["--dsn", "postgresql://crate@localhost/crate", "--dataset", "d.jsonl"]
    with pytest.raises(SystemExit):
        parse_args([*base, "--output", "out", "--refine", "gemini/gemini-3.8-flash"])
    args = parse_args(
        [
            *base,
            "--output",
            "out",
            "--planner",
            "smart-mix-v3",
            "--refine",
            "gemini/gemini-3.8-flash",
            "--max-usd",
            "2.5",
        ]
    )
    assert args.refine == "gemini/gemini-3.8-flash"
    assert args.max_usd == 2.5
    assert args.concurrency == 1
    # One ledger for every cache: a repeat run in its own cache still counts.
    assert args.ledger == args.refine_cache / "ledger.jsonl"
    shared = parse_args(
        [
            *base,
            "--output",
            "out",
            "--planner",
            "smart-mix-v3",
            "--refine",
            "gemini/gemini-3.8-flash",
            "--refine-cache",
            "repeat",
            "--ledger",
            "spend.jsonl",
        ]
    )
    assert shared.ledger == Path("spend.jsonl")


# --- stems layer (Smart Mix Stems ST3) ------------------------------------------------


def _stem_analysis(profile: TrackMixProfile, *, revision: str = "f" * 64, scale=1.0):
    from crate.smart_mix.stems import STEM_SOURCES, StemAnalysis

    windows = -(-round(profile.duration_ms * scale) // 250)
    # Loud vocals and bass in the first half of the track, silence after it.
    half = windows // 2
    loud = bytes([220]) * half + bytes(windows - half)
    return StemAnalysis(
        schema_version="stem-analysis/1",
        producer="crate-server/eval",
        separator={
            "model": "htdemucs",
            "version": "htdemucs-onnx-1",
            "sources": STEM_SOURCES,
        },
        source_revision=revision,
        hop_ms=250,
        levels={
            "drums": bytes([200]) * windows,
            "bass": loud,
            "other": bytes([150]) * windows,
            "vocals": loud,
        },
        duration_ms=round(profile.duration_ms * scale),
    )


def test_stem_analyses_bind_to_profiles_by_uid_and_duration() -> None:
    from run_eval import attach_stem_layers

    profiles = {**_structured_pair(), "missing": None}
    analyses = {
        # A local copy: another source revision, the same duration.
        OUT: _stem_analysis(profiles[OUT]),
        IN: _stem_analysis(profiles[IN], scale=1.05),
        "missing": _stem_analysis(profiles[OUT]),
    }

    attached, counts = attach_stem_layers(profiles, analyses)

    assert counts == {
        "attached": 1,
        "durationMismatch": 1,
        "noAnalysis": 1,
        "noProfile": 1,
    }
    bound = attached[OUT]
    assert bound is not None and bound.stems is not None
    assert bound.stems.vocal_detector == "stem-vocals-1"
    assert attached[IN] is profiles[IN]
    assert attached[OTHER] is profiles[OTHER]


def test_v3_plans_with_the_stems_layer_and_nostems_without_it() -> None:
    from run_eval import PLANNER_RULES, attach_stem_layers

    profiles, counts = attach_stem_layers(
        _structured_pair(),
        {uid: _stem_analysis(p) for uid, p in _structured_pair().items()},
    )
    rows = [_row("e0001", OUT, IN, "electronic/0-2")]
    techno = {OUT: 0.95, IN: 0.95}

    with_stems = evaluate_dataset(
        rows,
        profiles,
        planner="smart-mix-v3",
        context=CONTEXTS["dj"],
        genre_priors=techno,
    )
    without = evaluate_dataset(
        rows,
        profiles,
        planner="smart-mix-v3-nostems",
        context=CONTEXTS["dj"],
        genre_priors=techno,
    )
    plain = evaluate_dataset(
        rows, _structured_pair(), planner="smart-mix-v3", context=CONTEXTS["dj"]
    )

    assert counts["attached"] == 2
    assert with_stems[0]["stemsUsed"] is True
    assert with_stems[0]["stemsGate"] is True
    assert without[0]["stemsUsed"] is False
    # Without the layer, v3 plans the profiles as if they had none.
    assert without[0]["plan"] == plain[0]["plan"]
    assert "stemMetrics" not in plain[0]
    for record in (with_stems[0], without[0]):
        assert set(record["stemMetrics"]) == {"vocalClashMs", "bassClashMs"}
    assert PLANNER_RULES["smart-mix-v3-nostems"] == 1

    report = build_report(
        with_stems,
        meta={"planner": "smart-mix-v3", "stems": {"profiles": counts}},
        baseline=build_report(without, meta={"planner": "smart-mix-v3-nostems"}),
    )
    stems = report["summary"]["stems"]
    assert stems["edgesWithLayers"] == 1 and stems["stemsUsed"] == 1
    assert stems["edgesInFamily"] == 1
    assert report["overall"]["stemsUsedRate"] == 1.0
    assert report["comparison"]["overall"]["stemsUsedRate"] == 1.0
    markdown = render_markdown(report)
    assert "## Stems layer" in markdown
    assert "Stem bass clash (ms)" in markdown
    json.dumps(report)
    # Reports without stems keep their shape.
    assert summarize(plain)["stems"] is None
    assert "## Stems layer" not in render_markdown(build_report(plain, meta={}))


@pytest.mark.parametrize(
    "priors",
    [{OUT: 0.95, IN: 0.15}, {OUT: 0.95}, None],
    ids=["rock", "unknown", "none"],
)
def test_v3_keeps_the_stems_layer_to_the_beatmatch_family(priors) -> None:
    from run_eval import attach_stem_layers

    profiles, _counts = attach_stem_layers(
        _structured_pair(),
        {uid: _stem_analysis(p) for uid, p in _structured_pair().items()},
    )
    rows = [_row("e0001", OUT, IN, "electronic/0-2")]

    gated = evaluate_dataset(
        rows,
        profiles,
        planner="smart-mix-v3",
        context=CONTEXTS["dj"],
        genre_priors=priors,
    )
    plain = evaluate_dataset(
        rows, _structured_pair(), planner="smart-mix-v3", context=CONTEXTS["dj"]
    )

    assert gated[0]["stemsUsed"] is False
    assert gated[0]["stemsGate"] is False
    assert gated[0]["plan"] == plain[0]["plan"]
    assert summarize(gated)["stems"]["edgesInFamily"] == 0


def test_genre_priors_come_from_the_album_and_artist_genres(monkeypatch) -> None:
    import crate.db.queries.smart_mix_genres as genres_module
    from crate.db.queries.smart_mix_genres import TrackGenres

    from run_eval import load_genre_priors

    monkeypatch.setattr(
        genres_module,
        "get_track_genres",
        lambda uids: {
            OUT: TrackGenres(album={"techno": 1.0}),
            IN: TrackGenres(album={"rock": 0.5, "punk": 0.5}),
            OTHER: TrackGenres(artist={"industrial metal": 1.0, "metal": 0.88}),
        },
    )

    assert load_genre_priors([OUT, IN, OTHER]) == {OUT: 0.95, IN: 0.15, OTHER: 1.0}


def test_the_dj_context_is_crate_decks_and_listen_gets_no_stems() -> None:
    # Rules revision 5 (STEM-G1): the stems layer serves Crate Decks only, so the
    # harness's dj context asks as Decks does and Listen's never gets the layer.
    from run_eval import attach_stem_layers

    assert CONTEXTS["dj"].source == "decks"
    assert CONTEXTS["listen"].source == "playlist"
    profiles, _counts = attach_stem_layers(
        _structured_pair(),
        {uid: _stem_analysis(p) for uid, p in _structured_pair().items()},
    )
    rows = [_row("e0001", OUT, IN, "electronic/0-2")]
    techno = {OUT: 0.95, IN: 0.95}

    listen = evaluate_dataset(
        rows,
        profiles,
        planner="smart-mix-v3",
        context=CONTEXTS["listen"],
        genre_priors=techno,
    )
    plain = evaluate_dataset(
        rows, _structured_pair(), planner="smart-mix-v3", context=CONTEXTS["listen"]
    )

    assert listen[0]["stemsUsed"] is False
    assert listen[0]["stemsGate"] is False
    assert listen[0]["plan"] == plain[0]["plan"]

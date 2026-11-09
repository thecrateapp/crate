"""Plan the evaluation edge set with a planner and score every plan.

Loads the current profiles of the dataset's tracks (read-only), plans each
edge with the chosen planner and context, computes the SM0 metrics from
``crate.smart_mix.evaluation`` and writes:

    report.json   per-edge plans and metrics, summaries, optional comparison
    report.md     means, p50/p95, per band/genre/stratum, deltas vs --compare

usage:
    run_eval.py --dsn postgresql://crate:crate@localhost:5433/crate \
        --dataset tools/smart-mix-eval/out/dev/dataset.jsonl \
        --planner smart-mix-v2 --output tools/smart-mix-eval/out/dev/smart-mix-v2 \
        [--context dj] [--compare <other report.json>]

    run_eval.py ... --planner smart-mix-v3 --refine gemini/gemini-3.8-flash \
        --refine-connection <ai_provider_connections.id> [--max-usd 5]

``--refine`` sends every v3 edge's candidate menu to a real model with the SM4
prompt, schema and validation (``refine.py``); the report then serves the
refined plan where the model's choice was accepted, keeps the deterministic plan
and its metrics next to it, and adds the refinement statistics, the paired
differences and the SG3 criteria of the design (§10).

``--stems <folder>`` (Smart Mix Stems, ST3) attaches the stems layer of the
``stem-analysis/1`` files ``separate_pool.py`` wrote to the profiles: every planner
is then scored on the stem vocal and bass clashes too, and ``smart-mix-v3`` plans
with the layer where it applies, while ``smart-mix-v3-nostems`` plans the same
profiles without it (rules revision 1's menus). As in the API, the layer applies only
to edges of the beatmatch family (STEM-G1): the tracks' genre beatmatch priors come
from their album genres, read like the API reads them.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import Counter, defaultdict
from dataclasses import replace
from collections.abc import Callable, Iterable, Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

from common import (
    display_path,
    ensure_app_on_path,
    git_commit,
    open_read_only_database,
    read_jsonl,
    resolve_dsn,
    write_json,
)

ensure_app_on_path()

from crate.smart_mix.evaluation import (  # noqa: E402
    evaluate_transition,
    stem_bass_clash_ms,
    stem_vocal_clash_ms,
)
from crate.smart_mix.models import (  # noqa: E402
    TrackMixProfile,
    TransitionContext,
    TransitionPlan,
)
from crate.smart_mix.planner import (  # noqa: E402
    PlannedTransition,
    plan_transition,
    plan_transition_v3,
)
from crate.smart_mix.candidates import stems_layer_applies  # noqa: E402
from crate.smart_mix.policy import PLANNER_POLICY, PLANNER_POLICY_V3  # noqa: E402
from crate.smart_mix.stems import (  # noqa: E402
    StemAnalysis,
    duration_matches,
    stem_phrase_layer,
)
from build_dataset import GenreRoots  # noqa: E402
from refine import (  # noqa: E402
    Budget,
    EdgeJob,
    EdgeRefinement,
    RateLimiter,
    Refiner,
    environment_api_key,
    parse_reasoning,
    resolve_target,
)

# A planner returns a plan, or a v3 PlannedTransition (its plan plus the menu). It takes
# the two profiles, the context, the two entity UIDs and, as ``genre_priors``, the two
# tracks' genre beatmatch priors (v3 gates the stems layer on them, STEM-G1).
Planner = Callable[..., TransitionPlan | PlannedTransition]
GenrePriors = tuple[float | None, float | None]
NO_PRIORS: GenrePriors = (None, None)


def _plan_smart_mix_v2(
    outgoing: TrackMixProfile | None,
    incoming: TrackMixProfile | None,
    context: TransitionContext,
    outgoing_uid: str,
    incoming_uid: str,
    genre_priors: GenrePriors = NO_PRIORS,
) -> TransitionPlan:
    # The pure planner: no API, no plan cache, no database.
    del genre_priors
    return plan_transition(
        outgoing,
        incoming,
        context,
        outgoing_track_entity_uid=outgoing_uid,
        incoming_track_entity_uid=incoming_uid,
        policy=PLANNER_POLICY,
    )


def _plan_smart_mix_v3(
    outgoing: TrackMixProfile | None,
    incoming: TrackMixProfile | None,
    context: TransitionContext,
    outgoing_uid: str,
    incoming_uid: str,
    genre_priors: GenrePriors = NO_PRIORS,
) -> PlannedTransition:
    # The API's v3 path: candidates on the stored phrases, v2's bar heuristic
    # without them. It reads no beat grid, as the API does not load it.
    return plan_transition_v3(
        outgoing,
        incoming,
        context,
        outgoing_track_entity_uid=outgoing_uid,
        incoming_track_entity_uid=incoming_uid,
        policy=PLANNER_POLICY_V3,
        outgoing_genre_prior=genre_priors[0],
        incoming_genre_prior=genre_priors[1],
    )


# smart-mix-v3 with the stems layer off: the menus of rules revision 1, the
# baseline of the stems evaluation (ST3).
PLANNER_POLICY_V3_NO_STEMS = replace(PLANNER_POLICY_V3, stems_layer=False)


def _plan_smart_mix_v3_no_stems(
    outgoing: TrackMixProfile | None,
    incoming: TrackMixProfile | None,
    context: TransitionContext,
    outgoing_uid: str,
    incoming_uid: str,
    genre_priors: GenrePriors = NO_PRIORS,
) -> PlannedTransition:
    return plan_transition_v3(
        outgoing,
        incoming,
        context,
        outgoing_track_entity_uid=outgoing_uid,
        incoming_track_entity_uid=incoming_uid,
        policy=PLANNER_POLICY_V3_NO_STEMS,
        outgoing_genre_prior=genre_priors[0],
        incoming_genre_prior=genre_priors[1],
    )


PLANNERS: dict[str, Planner] = {
    "smart-mix-v2": _plan_smart_mix_v2,
    "smart-mix-v3": _plan_smart_mix_v3,
    "smart-mix-v3-nostems": _plan_smart_mix_v3_no_stems,
}
PLANNER_RULES = {
    "smart-mix-v2": PLANNER_POLICY.rules_revision,
    "smart-mix-v3": PLANNER_POLICY_V3.rules_revision,
    # Without the layer, revision 2 plans exactly as revision 1 (golden test).
    "smart-mix-v3-nostems": 1,
}

CONTEXTS = {
    # What a DJ client allows: beatmatch with tempo adjustment, the longest
    # blends and the bass handoff. The default, because Smart Mix 3 serves
    # Crate Decks first, and asked as Crate Decks asks (source "decks"), the only
    # client the stems layer serves (STEM-G1, rules revision 5).
    "dj": TransitionContext(
        source="decks",
        automatic=True,
        offline=False,
        preferred_duration_ms=12_000,
        user_cue_profile="auto",
        allow_beatmatch=True,
        allow_tempo_adjustment=True,
        allow_bass_handoff=True,
        allow_long_beatmatch=True,
    ),
    # Listen's defaults: 6 s crossfade, beatmatch, no bass handoff or long blend.
    "listen": TransitionContext(
        source="playlist",
        automatic=True,
        offline=False,
        preferred_duration_ms=6_000,
        user_cue_profile="auto",
        allow_beatmatch=True,
        allow_tempo_adjustment=True,
    ),
}

GROUP_FIELDS = (
    ("n", "Edges"),
    ("beatmatchRate", "Beatmatch"),
    ("violationRate", "Violations"),
    ("phraseFullyAlignedRate", "Start+end on phrase"),
    ("phraseAlignedFraction", "Boundaries aligned"),
    ("bassOverlapMsMean", "Bass overlap ms"),
    ("harmonicClashRate", "Key clash"),
    ("harmonicClashMsMean", "Key clash ms"),
    ("energyStepMean", "Energy step"),
    ("vocalClashMsMean", "Vocal clash ms"),
    ("durationMsMean", "Duration ms"),
    ("unplayedMsMean", "Unplayed ms"),
    ("skippedMsMean", "Skipped ms"),
)
_RATE_FIELDS = {
    "beatmatchRate",
    "violationRate",
    "phraseFullyAlignedRate",
    "phraseAlignedFraction",
    "harmonicClashRate",
}


def percentile(values: Sequence[float], quantile: float) -> float | None:
    """Linear interpolation between closest ranks (NumPy's default)."""
    if not values:
        return None
    ordered = sorted(values)
    position = quantile * (len(ordered) - 1)
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    fraction = position - lower
    return ordered[lower] + (ordered[upper] - ordered[lower]) * fraction


class EdgeRefiner(Protocol):
    def refine_many(
        self, jobs: Sequence[EdgeJob], *, concurrency: int = 1
    ) -> list[EdgeRefinement]: ...


# Pool edge sets carry no genre: their edges are grouped by the genre the prompt
# carried instead.
POOL_GENRE = "pool"


def evaluate_dataset(
    rows: Iterable[Mapping[str, Any]],
    profiles: Mapping[str, TrackMixProfile | None],
    *,
    planner: str,
    context: TransitionContext,
    refiner: EdgeRefiner | None = None,
    genres: Mapping[str, str | None] | None = None,
    genre_root: Callable[[str | None], str] | None = None,
    concurrency: int = 1,
    genre_priors: Mapping[str, float | None] | None = None,
) -> list[dict[str, Any]]:
    """Plan and score every edge; with ``refiner``, refine the v3 menus too.

    A refined record serves the model's plan when it was accepted (``plan`` and
    ``metrics`` are what the client plays) and keeps the planner's own plan and
    metrics under ``deterministic``. ``genres`` maps a track to the genre slug the
    prompt sends; ``genre_root`` resolves it to a root genre for pool edges.
    ``genre_priors`` maps a track to its genre beatmatch prior (unknown when absent),
    which keeps v3's stems layer to the beatmatch family.
    """
    plan_edge = PLANNERS[planner]
    records = []
    jobs: list[EdgeJob] = []
    for row in rows:
        outgoing_uid = str(row["outgoingTrackEntityUid"])
        incoming_uid = str(row["incomingTrackEntityUid"])
        outgoing = profiles.get(outgoing_uid)
        incoming = profiles.get(incoming_uid)
        priors = (
            (genre_priors or {}).get(outgoing_uid),
            (genre_priors or {}).get(incoming_uid),
        )
        planned = plan_edge(
            outgoing,
            incoming,
            context,
            outgoing_uid,
            incoming_uid,
            genre_priors=priors,
        )
        plan = planned.plan if isinstance(planned, PlannedTransition) else planned
        evaluation = evaluate_transition(plan, outgoing, incoming, context=context)
        menu = (
            {
                "structureUsed": planned.structure_used,
                "stemsUsed": planned.stems_used,
                "candidates": len(planned.candidates),
            }
            if isinstance(planned, PlannedTransition)
            else {}
        )
        record: dict[str, Any] = {
            "edgeId": row["edgeId"],
            "stratum": row["stratum"],
            "rootGenre": row["rootGenre"],
            "tempoBand": row["tempoBand"],
            "profiles": {
                "outgoing": _profile_state(
                    outgoing, row.get("outgoingProfileRevision")
                ),
                "incoming": _profile_state(
                    incoming, row.get("incomingProfileRevision")
                ),
            },
            "analyzerVersions": [
                profile.analyzer_version if profile else None
                for profile in (outgoing, incoming)
            ],
            "plan": plan.to_dict(),
            **menu,
            "metrics": evaluation.to_dict(),
        }
        stem_metrics = _stem_metrics(plan, outgoing, incoming)
        if stem_metrics is not None:
            record["stemMetrics"] = stem_metrics
            # Whether the edge is of the beatmatch family the layer applies to.
            record["stemsGate"] = stems_layer_applies(
                PLANNER_POLICY_V3, *priors, source=context.source
            )
        if refiner is not None and isinstance(planned, PlannedTransition):
            prompt_genres = (
                (genres or {}).get(outgoing_uid),
                (genres or {}).get(incoming_uid),
            )
            record["genreRoot"] = _genre_root(row, prompt_genres[0], genre_root)
            record["deterministic"] = {
                "plan": record["plan"],
                "metrics": record["metrics"],
            }
            record["refinement"] = {
                "status": "unavailable",
                "code": "missing_profile",
                "candidates": len(planned.candidates),
                "changed": False,
                "genres": list(prompt_genres),
            }
            if outgoing is not None and incoming is not None:
                jobs.append(
                    EdgeJob(
                        edge_id=str(row["edgeId"]),
                        outgoing=outgoing,
                        incoming=incoming,
                        candidates=planned.candidates,
                        context=context,
                        genres=prompt_genres,
                    )
                )
        records.append(record)
    if refiner is not None and jobs:
        by_edge = {str(record["edgeId"]): record for record in records}
        outcomes = refiner.refine_many(jobs, concurrency=concurrency)
        for job, outcome in zip(jobs, outcomes, strict=True):
            _serve_refinement(by_edge[job.edge_id], job, outcome, context)
    return records


def _stem_metrics(
    plan: TransitionPlan,
    outgoing: TrackMixProfile | None,
    incoming: TrackMixProfile | None,
) -> dict[str, Any] | None:
    """The stem clashes of a plan, when both profiles carry a stems layer."""
    if outgoing is None or incoming is None:
        return None
    if outgoing.stems is None or incoming.stems is None:
        return None
    return {
        "vocalClashMs": stem_vocal_clash_ms(plan, outgoing, incoming),
        "bassClashMs": stem_bass_clash_ms(plan, outgoing, incoming),
    }


def attach_stem_layers(
    profiles: Mapping[str, TrackMixProfile | None],
    analyses: Mapping[str, StemAnalysis],
) -> tuple[dict[str, TrackMixProfile | None], dict[str, int]]:
    """Profiles with the stems layer of their track's analysis, and what happened.

    ``separate_pool.py`` analyses a local copy, so an analysis carries that file's
    source revision: it binds to the profile of the same entity UID when the
    durations agree within 2 % (``duration_matches``), as the server binds an
    analysis to the file it describes. The layer reads the profile's beat grid, as
    the plan API does.
    """
    attached: dict[str, TrackMixProfile | None] = dict(profiles)
    counts: Counter[str] = Counter()
    for uid, profile in profiles.items():
        analysis = analyses.get(uid)
        if profile is None or analysis is None:
            counts["noAnalysis" if profile is not None else "noProfile"] += 1
            continue
        if not duration_matches(analysis.duration_ms, profile.duration_ms):
            counts["durationMismatch"] += 1
            continue
        bound = analysis.model_copy(update={"source_revision": profile.source_revision})
        layer = stem_phrase_layer(profile, bound)
        if layer is None:
            counts["noLayer"] += 1
            continue
        attached[uid] = replace(profile, stems=layer)
        counts["attached"] += 1
    return attached, dict(sorted(counts.items()))


def _serve_refinement(
    record: dict[str, Any],
    job: EdgeJob,
    outcome: EdgeRefinement,
    context: TransitionContext,
) -> None:
    refinement = record["refinement"]
    refinement.update(outcome.to_dict())
    if outcome.status == "ready" and outcome.plan is not None:
        served = outcome.plan.to_dict()
        refinement["changed"] = served != record["deterministic"]["plan"]
        record["plan"] = served
        record["metrics"] = evaluate_transition(
            outcome.plan, job.outgoing, job.incoming, context=context
        ).to_dict()
    else:
        refinement["changed"] = False


def _genre_root(
    row: Mapping[str, Any],
    outgoing_genre: str | None,
    genre_root: Callable[[str | None], str] | None,
) -> str:
    dataset_root = str(row["rootGenre"])
    if dataset_root != POOL_GENRE or genre_root is None:
        return dataset_root
    return genre_root(outgoing_genre)


def summarize(records: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    metrics = [record["metrics"] for record in records]
    alignments = [item["phraseAlignment"] for item in metrics]
    by_basis: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for alignment in alignments:
        if alignment is not None:
            by_basis[alignment["basis"]].append(alignment)
    energy_by_basis: dict[str, list[float]] = defaultdict(list)
    for item in metrics:
        if item["energyStep"] is not None:
            energy_by_basis[item["energyStep"]["basis"]].append(
                item["energyStep"]["value"]
            )
    clashes = [
        item["harmonicClashMs"]
        for item in metrics
        if item["harmonicClashMs"] is not None
    ]
    vocals = [
        item["vocalClashMs"] for item in metrics if item["vocalClashMs"] is not None
    ]
    violating = [item for item in metrics if item["policyViolations"]]
    left_out = [item["musicLeftOut"] for item in metrics if item.get("musicLeftOut")]
    structured = [
        record["structureUsed"] for record in records if "structureUsed" in record
    ]
    stem_metrics = [
        record["stemMetrics"] for record in records if "stemMetrics" in record
    ]
    return {
        "edges": len(records),
        "modes": _counts(item["mode"] for item in metrics),
        "fallbackReasons": _counts(
            item["fallbackReason"] or "none" for item in metrics
        ),
        "curves": _counts(item["curve"] for item in metrics),
        "bassHandoffs": sum(1 for item in metrics if item["bassHandoff"]),
        "profiles": _counts(
            state for record in records for state in record["profiles"].values()
        ),
        "analyzerVersions": _counts(
            version or "missing"
            for record in records
            for version in record.get("analyzerVersions", ())
        ),
        "durationMs": _stats(item["durationMs"] for item in metrics),
        "policyViolations": {
            "plans": len(violating),
            "rate": _rate(len(violating), len(metrics)),
            "codes": _counts(
                code for item in violating for code in item["policyViolations"]
            ),
        },
        "phraseAlignment": {
            "unavailable": sum(1 for alignment in alignments if alignment is None),
            "byBasis": {
                basis: {
                    "n": len(items),
                    "fullyAlignedRate": _rate(
                        sum(1 for a in items if a["aligned"] == a["checked"]),
                        len(items),
                    ),
                    "startAlignedRate": _rate(
                        sum(1 for a in items if a["startAligned"]), len(items)
                    ),
                    "endAlignedRate": _rate(
                        sum(1 for a in items if a["endAligned"]), len(items)
                    ),
                    "alignedFraction": _stats(
                        a["aligned"] / a["checked"] for a in items
                    ),
                }
                for basis, items in sorted(by_basis.items())
            },
        },
        "bassOverlapMs": _stats(item["bassOverlapMs"] for item in metrics),
        "harmonicClashMs": {
            **_stats(clashes),
            "unknown": len(metrics) - len(clashes),
            "clashRate": _rate(sum(1 for value in clashes if value > 0), len(clashes)),
        },
        "energyStep": {
            "unavailable": sum(1 for item in metrics if item["energyStep"] is None),
            "byBasis": {
                basis: _stats(values)
                for basis, values in sorted(energy_by_basis.items())
            },
        },
        "vocalClashMs": {
            **_stats(vocals),
            "unavailable": len(metrics) - len(vocals),
        },
        "musicLeftOutMs": {
            "outgoingUnplayed": _stats(item["outgoingUnplayedMs"] for item in left_out),
            "incomingSkipped": _stats(item["incomingSkippedMs"] for item in left_out),
        },
        "structureUsed": (
            {
                "edges": sum(1 for used in structured if used),
                "rate": _rate(sum(1 for used in structured if used), len(structured)),
            }
            if structured
            else None
        ),
        "stems": (
            {
                "edgesWithLayers": len(stem_metrics),
                "edgesInFamily": sum(
                    1 for record in records if record.get("stemsGate")
                ),
                "stemsUsed": sum(1 for record in records if record.get("stemsUsed")),
                "vocalClashMs": _stats(item["vocalClashMs"] for item in stem_metrics),
                "bassClashMs": _stats(item["bassClashMs"] for item in stem_metrics),
                "vocalClashRate": _rate(
                    sum(1 for item in stem_metrics if item["vocalClashMs"] > 0),
                    len(stem_metrics),
                ),
                "bassClashRate": _rate(
                    sum(1 for item in stem_metrics if item["bassClashMs"] > 0),
                    len(stem_metrics),
                ),
            }
            if stem_metrics
            else None
        ),
    }


def summarize_group(records: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    metrics = [record["metrics"] for record in records]
    alignments = [
        item["phraseAlignment"] for item in metrics if item["phraseAlignment"]
    ]
    clashes = [
        item["harmonicClashMs"]
        for item in metrics
        if item["harmonicClashMs"] is not None
    ]
    energies = [item["energyStep"]["value"] for item in metrics if item["energyStep"]]
    left_out = [item["musicLeftOut"] for item in metrics if item.get("musicLeftOut")]
    stem_metrics = [
        record["stemMetrics"] for record in records if "stemMetrics" in record
    ]
    return {
        "n": len(metrics),
        "beatmatchRate": _rate(
            sum(1 for item in metrics if item["mode"] == "beatmatch"), len(metrics)
        ),
        "violationRate": _rate(
            sum(1 for item in metrics if item["policyViolations"]), len(metrics)
        ),
        "phraseFullyAlignedRate": _rate(
            sum(1 for a in alignments if a["aligned"] == a["checked"]),
            len(alignments),
        ),
        "phraseAlignedFraction": _mean(a["aligned"] / a["checked"] for a in alignments),
        "bassOverlapMsMean": _mean(item["bassOverlapMs"] for item in metrics),
        "harmonicClashRate": _rate(
            sum(1 for value in clashes if value > 0), len(clashes)
        ),
        "harmonicClashMsMean": _mean(clashes),
        "energyStepMean": _mean(energies),
        "vocalClashMsMean": _mean(
            item["vocalClashMs"] for item in metrics if item["vocalClashMs"] is not None
        ),
        "durationMsMean": _mean(item["durationMs"] for item in metrics),
        "unplayedMsMean": _mean(item["outgoingUnplayedMs"] for item in left_out),
        "skippedMsMean": _mean(item["incomingSkippedMs"] for item in left_out),
        "stemEdges": len(stem_metrics),
        "stemsUsedRate": _rate(
            sum(1 for record in records if record.get("stemsUsed")), len(records)
        ),
        "stemVocalClashMsMean": _mean(item["vocalClashMs"] for item in stem_metrics),
        "stemBassClashMsMean": _mean(item["bassClashMs"] for item in stem_metrics),
    }


def build_report(
    records: Sequence[Mapping[str, Any]],
    *,
    meta: Mapping[str, Any],
    baseline: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    report: dict[str, Any] = {
        "meta": dict(meta),
        "summary": summarize(records),
        "overall": summarize_group(records),
        "byTempoBand": _grouped(records, "tempoBand"),
        "byRootGenre": _grouped(records, "rootGenre"),
        "byStratum": _grouped(records, "stratum"),
        "edges": list(records),
        "comparison": None,
    }
    if baseline is not None:
        report["comparison"] = compare_reports(report, baseline)
    if any("refinement" in record for record in records):
        refinement = refinement_summary(records)
        provider_kind = (meta.get("refine") or {}).get("providerKind", "cloud")
        refinement["criteria"] = sg3_criteria(
            refinement["deterministic"],
            refinement["refined"],
            refinement,
            provider_kind=provider_kind,
        )
        report["refinement"] = refinement
    return report


# Design §10: latency p95 targets per provider kind.
LATENCY_P95_TARGET_MS = {"cloud": 30_000, "local": 20_000}
REJECTION_RATE_TARGET = 0.10
_SAME = 1e-9


def refinement_summary(records: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    """What the model did, what it cost, and served minus deterministic metrics.

    The rejection rate counts the answers the validation rejected over all answers
    (ready or rejected); menus with a single candidate never reach the model. The
    failure rate counts transport failures over calls.
    """
    refined = [record for record in records if "refinement" in record]
    items = [record["refinement"] for record in refined]
    called = [item for item in items if item.get("called")]
    answered = [item for item in called if item["status"] in ("ready", "rejected")]
    rejected = [item for item in answered if item["status"] == "rejected"]
    failed = [item for item in called if item["status"] == "failed"]
    ready = [item for item in items if item["status"] == "ready"]
    latencies = [
        item["latencyMs"] for item in called if item.get("latencyMs") is not None
    ]
    usages = [item["usage"] for item in called if item.get("usage")]
    costs = [item["costUsd"] for item in called if item.get("costUsd") is not None]
    deterministic = [_deterministic(record) for record in refined]
    changed = [record for record in refined if record["refinement"]["changed"]]
    changed_deterministic = [_deterministic(record) for record in changed]
    total_cost = sum(costs)
    return {
        "edges": len(refined),
        "statuses": _counts(item["status"] for item in items),
        "codes": _counts(item["code"] for item in items if item.get("code")),
        "calls": len(called),
        "cachedCalls": sum(1 for item in called if item.get("cached")),
        "answers": len(answered),
        "rejectionRate": _rate(len(rejected), len(answered)),
        "failureRate": _rate(len(failed), len(called)),
        "changed": len(changed),
        "changedRate": _rate(len(changed), len(refined)),
        "keptPlannerPlan": sum(1 for item in ready if not item["changed"]),
        "candidateIndex": _counts(str(item["candidateIndex"]) for item in ready),
        "adjustments": _counts(
            name
            for item in ready
            for name, value in (item.get("adjustments") or {}).items()
            if value not in (0, "keep")
        ),
        "confidence": _stats(
            item["confidence"]
            for item in answered
            if item.get("confidence") is not None
        ),
        "readyViolations": sum(
            1
            for record in refined
            if record["refinement"]["status"] == "ready"
            and record["metrics"]["policyViolations"]
        ),
        "latencyMs": {
            **_stats(latencies),
            "max": max(latencies) if latencies else None,
        },
        "tokens": {
            "input": _stats(_tokens(usage, "input_tokens") for usage in usages),
            "output": _stats(
                _tokens(usage, "output_tokens") + _tokens(usage, "thought_tokens")
                for usage in usages
            ),
            "thought": _stats(_tokens(usage, "thought_tokens") for usage in usages),
            "total": _stats(
                _tokens(usage, "input_tokens")
                + _tokens(usage, "output_tokens")
                + _tokens(usage, "thought_tokens")
                for usage in usages
            ),
        },
        "cost": {
            "totalUsd": round(total_cost, 6),
            "perTransitionUsd": round(total_cost / len(costs), 6) if costs else None,
            "per1000TransitionsUsd": round(1000 * total_cost / len(costs), 4)
            if costs
            else None,
            "estimatedCalls": sum(1 for item in called if item.get("costEstimated")),
        },
        "deterministic": summarize_group(deterministic),
        "refined": summarize_group(refined),
        "delta": {
            "overall": _paired_delta(
                summarize_group(refined), summarize_group(deterministic)
            ),
            "changed": _paired_delta(
                summarize_group(changed), summarize_group(changed_deterministic)
            ),
            **{
                group: _paired_group_deltas(refined, deterministic, key)
                for group, key in (
                    ("byTempoBand", "tempoBand"),
                    ("byGenreRoot", "genreRoot"),
                    ("byStratum", "stratum"),
                )
            },
        },
    }


def sg3_criteria(
    deterministic: Mapping[str, Any],
    refined: Mapping[str, Any],
    stats: Mapping[str, Any],
    *,
    provider_kind: str,
) -> list[dict[str, Any]]:
    """The objective criteria of design §10, served plans against deterministic ones.

    ``pass`` is None when a side has no value (no vocal data, no calls).
    """

    def not_worse(key: str, *, higher_is_better: bool = False) -> dict[str, Any]:
        before, after = deterministic.get(key), refined.get(key)
        if before is None or after is None:
            verdict = None
        elif higher_is_better:
            verdict = after >= before - _SAME
        else:
            verdict = after <= before + _SAME
        return {"deterministic": before, "refined": after, "pass": verdict}

    alignment = [
        not_worse("phraseFullyAlignedRate", higher_is_better=True),
        not_worse("phraseAlignedFraction", higher_is_better=True),
    ]
    alignment_pass = (
        None
        if any(item["pass"] is None for item in alignment)
        else all(item["pass"] for item in alignment)
    )
    latency_target = LATENCY_P95_TARGET_MS.get(
        provider_kind, LATENCY_P95_TARGET_MS["cloud"]
    )
    p95 = (stats.get("latencyMs") or {}).get("p95")
    rejection = stats.get("rejectionRate")
    violations = stats.get("readyViolations")
    return [
        {
            "id": "policy_violations",
            "label": "Policy violations in served refined plans",
            "target": "0",
            "deterministic": 0,
            "refined": violations,
            "pass": None if violations is None else violations == 0,
        },
        {
            "id": "phrase_alignment",
            "label": "Phrase alignment (start and end on a boundary; boundaries aligned)",
            "target": ">= deterministic",
            "deterministic": [item["deterministic"] for item in alignment],
            "refined": [item["refined"] for item in alignment],
            "pass": alignment_pass,
        },
        {
            "id": "bass_overlap",
            "label": "Bass overlap, mean ms",
            "target": "<= deterministic",
            **not_worse("bassOverlapMsMean"),
        },
        {
            "id": "harmonic_clash",
            "label": "Harmonic clash, mean ms",
            "target": "<= deterministic",
            **not_worse("harmonicClashMsMean"),
        },
        {
            "id": "energy_continuity",
            "label": "Energy step, mean (0-1)",
            "target": "<= deterministic",
            **not_worse("energyStepMean"),
        },
        {
            "id": "vocal_clash",
            "label": "Vocal clash, mean ms (profiles with voice)",
            "target": "<= deterministic",
            **not_worse("vocalClashMsMean"),
        },
        {
            "id": "rejection_rate",
            "label": "Rejection rate (validation, over answers)",
            "target": f"<= {REJECTION_RATE_TARGET:.0%}",
            "deterministic": None,
            "refined": rejection,
            "pass": None if rejection is None else rejection <= REJECTION_RATE_TARGET,
        },
        {
            "id": "latency",
            "label": f"Latency p95 ({provider_kind})",
            "target": f"<= {latency_target / 1000:.0f} s",
            "deterministic": None,
            "refined": p95,
            "pass": None if p95 is None else p95 <= latency_target,
        },
        {
            "id": "cost",
            "label": "Cost per transition, USD",
            "target": "informative",
            "deterministic": None,
            "refined": (stats.get("cost") or {}).get("perTransitionUsd"),
            "pass": None,
        },
    ]


def _deterministic(record: Mapping[str, Any]) -> dict[str, Any]:
    return {**record, "metrics": record["deterministic"]["metrics"]}


def _paired_group_deltas(
    refined: Sequence[Mapping[str, Any]],
    deterministic: Sequence[Mapping[str, Any]],
    key: str,
) -> dict[str, dict[str, Any]]:
    served = _grouped(refined, key)
    planned = _grouped(deterministic, key)
    return {name: _paired_delta(served[name], planned[name]) for name in served}


def _paired_delta(
    served: Mapping[str, Any], planned: Mapping[str, Any]
) -> dict[str, Any]:
    """Served minus deterministic on the same edges; ``n`` stays the edge count."""
    return {**_delta(served, planned), "n": served["n"]}


def _tokens(usage: Mapping[str, Any], key: str) -> int:
    value = usage.get(key)
    return int(value) if isinstance(value, int) else 0


def compare_reports(
    current: Mapping[str, Any],
    baseline: Mapping[str, Any],
) -> dict[str, Any]:
    """Current minus baseline, overall and per group present in both."""
    current_edges = {edge["edgeId"] for edge in current.get("edges", ())}
    baseline_edges = {edge["edgeId"] for edge in baseline.get("edges", ())}
    return {
        "baseline": {
            key: baseline.get("meta", {}).get(key)
            for key in ("planner", "context", "createdAt", "gitCommit")
        },
        "pairedEdges": len(current_edges & baseline_edges),
        "overall": _delta(current["overall"], baseline["overall"]),
        **{
            group: {
                key: _delta(current[group][key], baseline[group][key])
                for key in sorted(set(current[group]) & set(baseline[group]))
            }
            for group in ("byTempoBand", "byRootGenre", "byStratum")
        },
    }


def render_markdown(report: Mapping[str, Any]) -> str:
    meta = report["meta"]
    summary = report["summary"]
    dataset = meta.get("dataset") or {}
    lines = [
        f"# Smart Mix evaluation: {meta.get('planner', '?')}",
        "",
        f"- Planner: `{meta.get('planner', '?')}`"
        + (
            f" (rules revision {meta['plannerRulesRevision']})"
            if meta.get("plannerRulesRevision") is not None
            else ""
        )
        + f", context `{meta.get('context', '?')}`",
        f"- Dataset: `{dataset.get('path', '?')}`, {dataset.get('edges', '?')} edges,"
        f" sha256 `{str(dataset.get('sha256', '?'))[:12]}`",
    ]
    if meta.get("database"):
        database = meta["database"]
        lines.append(
            f"- Profiles read from `{database.get('host')}:{database.get('port')}/"
            f"{database.get('database')}` in read-only transactions"
        )
    lines += [
        f"- Profiles: {_format_counts(summary['profiles'])};"
        f" analyzers: {_format_counts(summary['analyzerVersions'])}",
        f"- Modes: {_format_counts(summary['modes'])};"
        f" fallbacks: {_format_counts(summary['fallbackReasons'])};"
        f" curves: {_format_counts(summary['curves'])};"
        f" bass handoffs: {summary['bassHandoffs']}",
    ]
    if summary.get("structureUsed"):
        structure = summary["structureUsed"]
        lines.append(
            f"- Planned on stored phrases: {structure['edges']} of {summary['edges']}"
            f" edges ({_percent(structure['rate'])}); the rest used v2's bar heuristic"
        )
    if meta.get("createdAt") or meta.get("gitCommit"):
        lines.append(
            f"- Run {meta.get('createdAt', '?')} at commit"
            f" `{str(meta.get('gitCommit') or '?')[:12]}`"
        )
    lines += ["", "## Overall", "", *_overall_table(summary), ""]
    lines += [
        "Phrase metrics use stored phrases when a profile has them and an 8-bar grid",
        "from the downbeat otherwise (basis `grid`). Overlaps count time with both",
        "decks at half amplitude or more; bass counts the handoff shelf cut too.",
        "",
    ]
    for title, group in (
        ("By tempo band", "byTempoBand"),
        ("By root genre", "byRootGenre"),
        ("By stratum", "byStratum"),
    ):
        lines += [f"## {title}", "", *_group_table(report[group]), ""]
    comparison = report.get("comparison")
    if comparison:
        baseline = comparison["baseline"]
        lines += [
            "## Comparison",
            "",
            f"Current minus `{baseline.get('planner')}` (context"
            f" `{baseline.get('context')}`), {comparison['pairedEdges']} paired edges.",
            "",
            *_group_table({"overall": comparison["overall"]}, signed=True),
            "",
            *_group_table(comparison["byStratum"], signed=True),
            "",
        ]
    else:
        lines += ["## Comparison", "", "None: this report is a baseline.", ""]
    if summary.get("stems"):
        lines += _stems_markdown(report)
    if report.get("refinement"):
        lines += _refinement_markdown(meta.get("refine") or {}, report["refinement"])
    return "\n".join(lines)


STEM_GROUP_FIELDS = (
    ("stemEdges", "Edges with stems"),
    ("stemsUsedRate", "Planned with stems"),
    ("stemVocalClashMsMean", "Stem vocal clash ms"),
    ("stemBassClashMsMean", "Stem bass clash ms"),
    ("vocalClashMsMean", "YAMNet vocal clash ms"),
    ("bassOverlapMsMean", "Bass overlap ms"),
)


def _stems_markdown(report: Mapping[str, Any]) -> list[str]:
    stems = report["summary"]["stems"]
    attached = (report["meta"].get("stems") or {}).get("profiles") or {}
    lines = [
        "## Stems layer",
        "",
        f"{stems['edgesWithLayers']} edges have a stems layer on both tracks"
        f" (profiles: {_format_counts(attached)}), {stems.get('edgesInFamily', 0)} of"
        " them in the beatmatch family (genre priors, STEM-G1);"
        f" {stems['stemsUsed']} were planned with it. Stem clashes count full-level"
        " time (bass: with the handoff shelf) while both phrases have the stem.",
        "",
        "| Metric | n | mean | p50 | p95 |",
        "| --- | ---: | ---: | ---: | ---: |",
        _stats_row("Stem vocal clash (ms)", stems["vocalClashMs"]),
        f"| Stem vocal clash, plans with one | {stems['vocalClashMs']['n']} |"
        f" {_percent(stems['vocalClashRate'])} | | |",
        _stats_row("Stem bass clash (ms)", stems["bassClashMs"]),
        f"| Stem bass clash, plans with one | {stems['bassClashMs']['n']} |"
        f" {_percent(stems['bassClashRate'])} | | |",
        "",
    ]
    groups = {"overall": report["overall"], **report["byRootGenre"]}
    lines += _fields_table(groups, STEM_GROUP_FIELDS, signed=False)
    comparison = report.get("comparison")
    if comparison:
        lines += [
            "",
            "Current minus baseline:",
            "",
            *_fields_table(
                {"overall": comparison["overall"], **comparison["byRootGenre"]},
                STEM_GROUP_FIELDS,
                signed=True,
            ),
        ]
    return [*lines, ""]


def _fields_table(
    groups: Mapping[str, Mapping[str, Any]],
    fields: Sequence[tuple[str, str]],
    *,
    signed: bool,
) -> list[str]:
    rows = [
        "| Group | " + " | ".join(label for _key, label in fields) + " |",
        "| --- |" + " ---: |" * len(fields),
    ]
    for name, values in groups.items():
        cells = []
        for key, _label in fields:
            value = values.get(key)
            if key == "stemsUsedRate":
                cells.append(
                    "n/a"
                    if value is None
                    else ("+" if signed and value > 0 else "") + f"{value * 100:.1f} %"
                )
            elif key == "stemEdges" and signed:
                cells.append("n/a" if value is None else f"{value:,.0f}")
            else:
                cells.append(_group_cell(key, value, signed))
        rows.append(f"| {name} | " + " | ".join(cells) + " |")
    return rows


def _refinement_markdown(
    target: Mapping[str, Any], refinement: Mapping[str, Any]
) -> list[str]:
    config = target.get("config") or {}
    reasoning = config.get("reasoning") or {}
    price = target.get("price")
    latency = refinement["latencyMs"]
    tokens = refinement["tokens"]
    cost = refinement["cost"]
    lines = [
        f"## AI refinement: {target.get('model', '?')}",
        "",
        f"- Connection: {target.get('connectionLabel') or 'none'}"
        f" ({target.get('providerKind', '?')}); prompt `{target.get('promptVersion', '?')}`,"
        f" genre {'sent' if target.get('sendGenre', True) else 'not sent'}",
        f"- Profile: reasoning {_reasoning_label(reasoning)},"
        f" timeout {config.get('timeout_seconds', '?')} s,"
        f" {config.get('max_output_tokens', '?')} output tokens;"
        f" validated for the action: {'yes' if target.get('profileValidated') else 'no'}",
    ]
    if price:
        lines.append(
            f"- Price: {price.get('inputPerMillion', '?')} USD per million input"
            f" tokens, {price.get('outputPerMillion', '?')} per million output tokens"
            f" (thinking included), {price.get('cachedInputPerMillion', '?')} cached;"
            f" {price.get('source', '?')}, read {price.get('date', '?')}"
        )
    lines += [
        f"- Edges: {refinement['edges']}; statuses:"
        f" {_format_counts(refinement['statuses'])}; codes:"
        f" {_format_counts(refinement['codes'])}",
        f"- Calls: {refinement['calls']} ({refinement['cachedCalls']} from the cache),"
        f" {refinement['answers']} answers",
        "",
        "| Measure | Value |",
        "| --- | ---: |",
        f"| Rejection rate (validation, over answers) |"
        f" {_percent(refinement['rejectionRate'])} |",
        f"| Failure rate (transport, over calls) | {_percent(refinement['failureRate'])} |",
        f"| Plans the model changed | {refinement['changed']}"
        f" ({_percent(refinement['changedRate'])}) |",
        f"| Accepted, same plan as the planner | {refinement['keptPlannerPlan']} |",
        f"| Candidate chosen (accepted) | {_format_counts(refinement['candidateIndex'])} |",
        f"| Adjustments requested, not keep or 0 (accepted) |"
        f" {_format_counts(refinement['adjustments'])} |",
        f"| Confidence, mean / p50 / p95 | {_triple(refinement['confidence'], 2)} |",
        f"| Latency p50 / p95 / max (ms) | {_cell(latency['p50'])} /"
        f" {_cell(latency['p95'])} / {_cell(latency['max'])} |",
        f"| Tokens per transition, input (mean / p50 / p95) |"
        f" {_triple(tokens['input'])} |",
        f"| Tokens per transition, output with thinking | {_triple(tokens['output'])} |",
        f"| Tokens per transition, thinking | {_triple(tokens['thought'])} |",
        f"| Tokens per transition, total | {_triple(tokens['total'])} |",
        f"| Cost, total (USD) | {cost['totalUsd']:.4f} |",
        f"| Cost per transition (USD) | {_cell(cost['perTransitionUsd'], 5)} |",
        f"| Cost per 1,000 transitions (USD) | {_cell(cost['per1000TransitionsUsd'], 2)} |",
        f"| Calls costed at their worst case (no usage) | {cost['estimatedCalls']} |",
        "",
        "## SG3 criteria",
        "",
        "Design §10, served plans (the model's where accepted, the planner's"
        " otherwise) against the deterministic v3 plans of the same edges.",
        "",
        "| Criterion | Target | Deterministic | Served | Pass |",
        "| --- | --- | ---: | ---: | --- |",
    ]
    for item in refinement["criteria"]:
        verdict = {True: "yes", False: "no", None: "n/a"}[item["pass"]]
        lines.append(
            f"| {item['label']} | {item['target']} |"
            f" {_criterion_value(item['deterministic'])} |"
            f" {_criterion_value(item['refined'])} | {verdict} |"
        )
    delta = refinement["delta"]
    lines += [
        "",
        "## Served minus deterministic",
        "",
        "All edges, then only the edges whose plan the model changed.",
        "",
        *_group_table(
            {"all edges": delta["overall"], "changed edges": delta["changed"]},
            signed=True,
        ),
        "",
        "### By tempo band",
        "",
        *_group_table(delta["byTempoBand"], signed=True),
        "",
        "### By genre",
        "",
        "Root genre of the outgoing track; pool edges use the genre the prompt sent.",
        "",
        *_group_table(delta["byGenreRoot"], signed=True),
        "",
        "### By stratum",
        "",
        *_group_table(delta["byStratum"], signed=True),
        "",
    ]
    return lines


def _reasoning_label(reasoning: Mapping[str, Any]) -> str:
    mode = reasoning.get("mode", "provider_default")
    if mode == "level":
        return str(reasoning.get("level"))
    if mode == "budget":
        return f"budget {reasoning.get('budget_tokens')}"
    return str(mode)


def _cell(value: float | None, digits: int = 0) -> str:
    if value is None:
        return "n/a"
    return f"{value:,.{digits}f}"


def _triple(values: Mapping[str, Any], digits: int = 0) -> str:
    return " / ".join(_cell(values.get(key), digits) for key in ("mean", "p50", "p95"))


def _criterion_value(value: Any) -> str:
    if value is None:
        return "n/a"
    if isinstance(value, list):
        return " / ".join(_criterion_value(item) for item in value)
    if isinstance(value, float):
        return f"{value:,.4g}"
    return str(value)


def load_profiles(uids: Sequence[str]) -> dict[str, TrackMixProfile | None]:
    from crate.db.repositories.smart_mix import get_track_mix_profiles_by_entity_uids

    profiles: dict[str, TrackMixProfile | None] = {}
    for start in range(0, len(uids), 500):
        batch = list(uids[start : start + 500])
        loaded = get_track_mix_profiles_by_entity_uids(
            batch, include_beat_grid=True, include_structure=True
        )
        profiles.update(zip(batch, loaded, strict=True))
    return profiles


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n\n")[0])
    parser.add_argument("--dsn", help="postgresql:// URL (or SMART_MIX_EVAL_DSN)")
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--planner", choices=sorted(PLANNERS), default="smart-mix-v2")
    parser.add_argument("--context", choices=sorted(CONTEXTS), default="dj")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--compare", type=Path, help="baseline report.json")
    parser.add_argument("--allow-remote-database", action="store_true")
    parser.add_argument("--limit", type=int, help="evaluate only the first N edges")
    parser.add_argument(
        "--stems",
        type=Path,
        action="append",
        default=[],
        metavar="FOLDER",
        help="stem-analysis/1 files written by separate_pool.py (repeatable)",
    )
    refine = parser.add_argument_group("AI refinement (SM5, needs smart-mix-v3)")
    refine.add_argument("--refine", metavar="PROVIDER/MODEL")
    refine.add_argument(
        "--refine-connection",
        metavar="UUID",
        help="ai_provider_connections row whose catalog and endpoint to use",
    )
    refine.add_argument(
        "--refine-reasoning",
        help="low, medium, high, minimal, off, on, default or budget:N;"
        " by default the action's own profile",
    )
    refine.add_argument(
        "--refine-cache",
        type=Path,
        default=Path(__file__).parent / "out" / "refine-cache",
    )
    refine.add_argument(
        "--ledger",
        type=Path,
        help="spend ledger shared by runs (default: ledger.jsonl in --refine-cache)",
    )
    refine.add_argument(
        "--max-usd",
        type=float,
        default=5.0,
        help="stop before the ledger of every run would pass this spend",
    )
    refine.add_argument("--concurrency", type=int, default=1)
    refine.add_argument(
        "--min-interval", type=float, default=1.0, help="seconds between call starts"
    )
    refine.add_argument(
        "--retry-failed", action="store_true", help="call again for cached failures"
    )
    refine.add_argument("--no-send-genre", action="store_true")
    args = parser.parse_args(argv)
    args.dsn = resolve_dsn(args.dsn)
    if not args.dsn:
        parser.error("--dsn or SMART_MIX_EVAL_DSN is required")
    if args.refine and args.planner != "smart-mix-v3":
        parser.error("--refine needs --planner smart-mix-v3")
    if args.ledger is None:
        args.ledger = args.refine_cache / "ledger.jsonl"
    return args


def main(argv: Sequence[str] | None = None) -> int:
    # TEST_GAP: the database wiring is exercised by running the tool against
    # the dev library (see README); planning, metrics and reports are tested.
    args = parse_args(argv)
    database = open_read_only_database(
        args.dsn, allow_remote=args.allow_remote_database
    )
    rows = read_jsonl(args.dataset)
    if args.limit is not None:
        rows = rows[: args.limit]
    uids = sorted(
        {
            str(row[key])
            for row in rows
            for key in ("outgoingTrackEntityUid", "incomingTrackEntityUid")
        }
    )
    profiles = load_profiles(uids)
    stems_meta: dict[str, Any] | None = None
    genre_priors: dict[str, float | None] | None = None
    if args.stems:
        from separate_pool import load_stem_analyses

        analyses: dict[str, StemAnalysis] = {}
        for folder in args.stems:
            analyses.update(load_stem_analyses(folder))
        profiles, attached = attach_stem_layers(profiles, analyses)
        genre_priors = load_genre_priors(uids)
        stems_meta = {
            "folders": [display_path(folder) for folder in args.stems],
            "analyses": len(analyses),
            "profiles": attached,
            "genrePriors": {
                "tracks": len(genre_priors),
                "known": sum(1 for prior in genre_priors.values() if prior is not None),
            },
        }
    context = CONTEXTS[args.context]
    refiner = None
    refine_meta: dict[str, Any] | None = None
    options: dict[str, Any] = {}
    if args.refine:
        refiner, refine_meta = _refiner(args)
        roots = GenreRoots.from_taxonomy()
        options = {
            "refiner": refiner,
            "genres": load_prompt_genres(uids),
            "genre_root": roots.root,
            "concurrency": args.concurrency,
        }
    records = evaluate_dataset(
        rows,
        profiles,
        planner=args.planner,
        context=context,
        genre_priors=genre_priors,
        **options,
    )
    baseline = json.loads(args.compare.read_text()) if args.compare else None
    report = build_report(
        records,
        meta={
            "planner": args.planner,
            "plannerRulesRevision": PLANNER_RULES.get(args.planner),
            "context": args.context,
            "contextValues": context.to_dict(),
            "dataset": {
                "path": display_path(args.dataset),
                "edges": len(rows),
                "sha256": hashlib.sha256(args.dataset.read_bytes()).hexdigest(),
            },
            "database": database,
            "readOnly": True,
            "createdAt": datetime.now(UTC).isoformat(),
            "gitCommit": git_commit(),
            **({"refine": refine_meta} if refine_meta else {}),
            **({"stems": stems_meta} if stems_meta else {}),
        },
        baseline=baseline,
    )
    args.output.mkdir(parents=True, exist_ok=True)
    write_json(args.output / "report.json", report)
    (args.output / "report.md").write_text(render_markdown(report))
    print(f"{len(records)} edges -> {args.output}", file=sys.stderr)
    if refiner is not None:
        spent = refiner.budget.spent_usd
        print(f"AI spend in the ledger: {spent:.4f} USD", file=sys.stderr)
        if refiner.budget_exhausted:
            print(
                f"Stopped at the --max-usd limit ({args.max_usd:.2f} USD): edges"
                " after it are unavailable (budget) in the report",
                file=sys.stderr,
            )
            return 3
    return 0


def _refiner(args: argparse.Namespace) -> tuple[Refiner, dict[str, Any]]:
    """The refiner of ``--refine`` and its report metadata (no secret)."""
    from crate.db.repositories.ai_configuration import get_connection
    from crate.smart_mix_ai import provider_kind

    connection = None
    if args.refine_connection:
        connection = get_connection(args.refine_connection)
        if connection is None:
            raise SystemExit(f"No AI connection {args.refine_connection}")
    target = resolve_target(
        args.refine,
        connection=connection,
        reasoning=parse_reasoning(args.refine_reasoning)
        if args.refine_reasoning
        else None,
    )
    refiner = Refiner(
        target,
        api_key=environment_api_key(target.provider),
        cache_dir=args.refine_cache,
        budget=Budget(args.ledger, args.max_usd),
        limiter=RateLimiter(args.min_interval),
        send_genre=not args.no_send_genre,
        retry_failed=args.retry_failed,
    )
    return refiner, {
        **target.to_meta(),
        "providerKind": provider_kind(target.provider),
        "sendGenre": not args.no_send_genre,
        "maxUsd": args.max_usd,
        "concurrency": args.concurrency,
        "minIntervalSeconds": args.min_interval,
    }


def load_genre_priors(uids: Sequence[str]) -> dict[str, float | None]:
    """Each track's stems gate prior from its album and artist genres, as the plan
    API reads them (STEM-G1, ``stems_gate_prior``); None when unknown."""
    from crate.db.queries import smart_mix_genres
    from crate.smart_mix.candidates import stems_gate_prior

    genres = smart_mix_genres.get_track_genres(list(uids))
    return {
        uid: stems_gate_prior(track.album, track.artist) if track else None
        for uid in uids
        for track in (genres.get(uid),)
    }


def load_prompt_genres(uids: Sequence[str]) -> dict[str, str | None]:
    """Each track's genre slug as the refinement task sends it (its ``_genres``)."""
    from crate.db.queries.smart_mix_refinement import get_track_genre_slugs
    from crate.genre_taxonomy import resolve_genre_slug

    slugs = get_track_genre_slugs(list(uids))
    return {
        uid: (resolve_genre_slug(slug) or slug) if (slug := slugs.get(uid)) else None
        for uid in uids
    }


def _profile_state(profile: TrackMixProfile | None, revision: Any) -> str:
    if profile is None:
        return "missing"
    if revision is not None and profile.profile_revision != revision:
        return "drifted"
    return "current"


def _grouped(
    records: Sequence[Mapping[str, Any]], key: str
) -> dict[str, dict[str, Any]]:
    groups: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for record in records:
        groups[str(record[key])].append(record)
    return {name: summarize_group(items) for name, items in sorted(groups.items())}


def _stats(values: Iterable[float]) -> dict[str, Any]:
    collected = [float(value) for value in values]
    return {
        "n": len(collected),
        "mean": _mean(collected),
        "p50": _round(percentile(collected, 0.5)),
        "p95": _round(percentile(collected, 0.95)),
    }


def _mean(values: Iterable[float]) -> float | None:
    collected = [float(value) for value in values]
    if not collected:
        return None
    return _round(sum(collected) / len(collected))


def _rate(count: int, total: int) -> float | None:
    return _round(count / total) if total else None


def _round(value: float | None) -> float | None:
    return None if value is None else round(value, 4)


def _counts(values: Iterable[str]) -> dict[str, int]:
    return dict(sorted(Counter(values).items()))


def _delta(current: Any, baseline: Any) -> Any:
    if isinstance(current, Mapping) and isinstance(baseline, Mapping):
        return {
            key: _delta(current.get(key), baseline.get(key))
            for key in current
            if key in baseline
        }
    if isinstance(current, (int, float)) and isinstance(baseline, (int, float)):
        return _round(current - baseline)
    return None


def _overall_table(summary: Mapping[str, Any]) -> list[str]:
    rows = [
        "| Metric | n | mean | p50 | p95 |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    violations = summary["policyViolations"]
    rows.append(
        f"| Policy violations (plans) | {summary['edges']} |"
        f" {violations['plans']} ({_percent(violations['rate'])}) | | |"
    )
    if violations["codes"]:
        rows.append(
            f"| Violation codes | | {_format_counts(violations['codes'])} | | |"
        )
    alignment = summary["phraseAlignment"]
    for basis, values in alignment["byBasis"].items():
        rows.append(
            f"| Phrase alignment, start and end on a boundary ({basis}) |"
            f" {values['n']} | {_percent(values['fullyAlignedRate'])} | | |"
        )
        rows.append(
            f"| Phrase alignment, mix start on a boundary ({basis}) | {values['n']} |"
            f" {_percent(values['startAlignedRate'])} | | |"
        )
        rows.append(
            _stats_row(
                f"Phrase alignment, boundaries aligned of 4 ({basis})",
                values["alignedFraction"],
                scale=4,
                digits=2,
            )
        )
    if alignment["unavailable"]:
        rows.append(
            f"| Phrase alignment unavailable (no grid) | {alignment['unavailable']}"
            " | n/a | | |"
        )
    rows.append(_stats_row("Bass overlap (ms)", summary["bassOverlapMs"]))
    clash = summary["harmonicClashMs"]
    rows.append(_stats_row("Harmonic clash (ms)", clash))
    rows.append(
        f"| Harmonic clash, plans with a clash | {clash['n']} |"
        f" {_percent(clash['clashRate'])} | | |"
    )
    if clash["unknown"]:
        rows.append(
            f"| Harmonic clash unknown (no key) | {clash['unknown']} | n/a | | |"
        )
    energy = summary["energyStep"]
    for basis, values in energy["byBasis"].items():
        rows.append(_stats_row(f"Energy step, 0-1 ({basis})", values, digits=3))
    if energy["unavailable"]:
        rows.append(f"| Energy step unavailable | {energy['unavailable']} | n/a | | |")
    vocal = summary["vocalClashMs"]
    if vocal["n"]:
        rows.append(_stats_row("Vocal clash (ms)", vocal))
    else:
        rows.append(
            f"| Vocal clash (ms) | 0 | n/a: no vocal presence in"
            f" {vocal['unavailable']} edges | | |"
        )
    rows.append(_stats_row("Transition duration (ms)", summary["durationMs"]))
    left_out = summary.get("musicLeftOutMs")
    if left_out:
        rows.append(
            _stats_row(
                "Outgoing music after the mix (ms)", left_out["outgoingUnplayed"]
            )
        )
        rows.append(
            _stats_row(
                "Incoming music before the mix (ms)", left_out["incomingSkipped"]
            )
        )
    return rows


def _stats_row(
    label: str,
    values: Mapping[str, Any],
    *,
    scale: float = 1.0,
    digits: int = 0,
) -> str:
    def cell(value: float | None) -> str:
        if value is None:
            return "n/a"
        scaled = value * scale
        return f"{scaled:.{digits}f}" if digits else f"{scaled:,.0f}"

    return (
        f"| {label} | {values['n']} | {cell(values['mean'])} |"
        f" {cell(values['p50'])} | {cell(values['p95'])} |"
    )


def _group_table(
    groups: Mapping[str, Mapping[str, Any]], *, signed: bool = False
) -> list[str]:
    header = "| Group | " + " | ".join(label for _key, label in GROUP_FIELDS) + " |"
    divider = "| --- |" + " ---: |" * len(GROUP_FIELDS)
    rows = [header, divider]
    for name, values in groups.items():
        cells = [
            _group_cell(key, values.get(key), signed) for key, _label in GROUP_FIELDS
        ]
        rows.append(f"| {name} | " + " | ".join(cells) + " |")
    return rows


def _group_cell(key: str, value: Any, signed: bool) -> str:
    if value is None:
        return "n/a"
    # The edge count is a count even in a table of differences.
    sign = "+" if signed and value > 0 and key != "n" else ""
    if key in _RATE_FIELDS:
        return f"{sign}{value * 100:.1f} %"
    if key == "energyStepMean":
        return f"{sign}{value:.3f}"
    return f"{sign}{value:,.0f}"


def _percent(value: float | None) -> str:
    return "n/a" if value is None else f"{value * 100:.1f} %"


def _format_counts(counts: Mapping[str, int]) -> str:
    return ", ".join(f"{key} {value}" for key, value in counts.items()) or "none"


if __name__ == "__main__":
    raise SystemExit(main())

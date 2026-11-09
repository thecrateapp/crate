"""Export the synthetic Smart Mix test pair shown in the engineering blog.

Run from the repository root:
    python3 tools/smart-mix-eval/export_blog_fixture.py
    python3 tools/smart-mix-eval/export_blog_fixture.py --check

The hand-authored voiced_dj fixture and actual planner/evaluator are pinned to
6b53412a6602c1d7fb34c1ef14498f8263b11243. Source drift fails the command rather
than silently claiming old provenance. No checkout, reset, database, network or
audio is required. --check validates the checked-in visual JSON without writing.
"""

import argparse
import json
import subprocess
from collections.abc import Sequence
from dataclasses import replace
from pathlib import Path
from typing import Any

from common import REPO_ROOT, ensure_app_on_path

ensure_app_on_path()

from crate.smart_mix.candidates import plan_transition_candidates  # noqa: E402
from crate.smart_mix.evaluation import (  # noqa: E402
    evaluate_transition,
    incoming_start_ms,
    incoming_tempo,
)
from crate.smart_mix.models import (  # noqa: E402
    VOCAL_THRESHOLD,
    TrackMixProfile,
    TransitionCandidate,
    TransitionContext,
    TransitionPlan,
)
from crate.smart_mix.planner import plan_transition  # noqa: E402
from crate.smart_mix.policy import PLANNER_POLICY_V3  # noqa: E402
from tests.smart_mix_candidate_cases import edge_cases  # noqa: E402

PIN = "6b53412a6602c1d7fb34c1ef14498f8263b11243"
OUTPUT = REPO_ROOT / "app/web/src/data/blog-smart-mix-fixture.json"


def _track(p: TrackMixProfile, label: str) -> dict[str, Any]:
    assert p.phrases and p.vocal_presence and p.bpm
    phrases = []
    for index, phrase in enumerate(p.phrases):
        start = phrase.start_ms
        end = min(
            start + round(phrase.bars * 4 * 60000 / p.bpm),
            p.phrases[index + 1].start_ms
            if index + 1 < len(p.phrases)
            else p.duration_ms,
        )
        voice = p.vocal_presence[index]
        phrases.append(
            {
                "index": index,
                "kind": phrase.kind,
                "bars": phrase.bars,
                "startMs": start,
                "endMs": end,
                "energy": phrase.energy,
                "voiceByte": voice,
                "hasVoice": voice >= VOCAL_THRESHOLD,
            }
        )
    return {
        "label": label,
        "entityUid": p.track_entity_uid,
        "durationMs": p.duration_ms,
        "activeStartMs": p.active_start_ms,
        "activeEndMs": p.active_end_ms,
        "bpm": p.bpm,
        "beatMs": 60000 / p.bpm,
        "phrases": phrases,
    }


def _option(
    choice_id: str,
    label: str,
    plan: TransitionPlan,
    outgoing: TrackMixProfile,
    incoming: TrackMixProfile,
    context: TransitionContext,
    candidate: TransitionCandidate | None = None,
) -> dict[str, Any]:
    metrics = evaluate_transition(
        plan, outgoing, incoming, context=context, policy=PLANNER_POLICY_V3
    ).to_dict()
    assert metrics["policyViolations"] == []
    return {
        "id": choice_id,
        "label": label,
        "rank": candidate.index if candidate else None,
        "structureUsed": candidate.structure_used if candidate else False,
        "outgoingPhrase": candidate.outgoing_phrase if candidate else None,
        "incomingPhrase": candidate.incoming_phrase if candidate else None,
        "lengthBars": candidate.length_bars if candidate else None,
        "plan": plan.to_dict(),
        "geometry": {
            "outgoingStartMs": plan.outgoing_cue_ms,
            "outgoingEndMs": plan.outgoing_cue_ms + plan.duration_ms,
            "incomingStartMs": incoming_start_ms(plan),
            "incomingEndMs": incoming_start_ms(plan)
            + plan.duration_ms * incoming_tempo(plan),
            "incomingPlaybackRate": incoming_tempo(plan),
        },
        "metrics": metrics,
    }


def build_fixture() -> dict[str, Any]:
    """Generate synthetic inputs and genuine planner outputs without external IO."""
    _, out, inc, ctx = next(x for x in edge_cases() if x[0] == "voiced_dj")
    menu = plan_transition_candidates(out, inc, ctx)
    v2 = plan_transition(out, inc, ctx, policy=PLANNER_POLICY_V3)
    plain_out = replace(
        out,
        phrases=None,
        energy_curve=None,
        vocal_presence=None,
        vocal_detector=None,
        structure_confidence=None,
    )
    plain_in = replace(
        inc,
        phrases=None,
        energy_curve=None,
        vocal_presence=None,
        vocal_detector=None,
        structure_confidence=None,
    )
    fallback_menu = plan_transition_candidates(plain_out, plain_in, ctx)
    fallback_v2 = plan_transition(plain_out, plain_in, ctx, policy=PLANNER_POLICY_V3)
    assert fallback_menu[0].to_plan() == fallback_v2
    assert fallback_v2 == v2
    payload = {
        "schemaVersion": 1,
        "kind": "synthetic-test-fixture",
        "label": "Synthetic test tracks · real planner output",
        "fixtureCase": "voiced_dj",
        "sourceCommit": PIN,
        "sourceBaseUrl": f"https://github.com/thecrateapp/crate/blob/{PIN}/",
        "sources": [
            "app/tests/smart_mix_candidate_cases.py",
            "app/tests/test_smart_mix_candidates.py",
            "app/crate/smart_mix/candidates.py",
            "app/crate/smart_mix/planner.py",
            "app/crate/smart_mix/evaluation.py",
            "app/crate/smart_mix/models.py",
            "app/crate/smart_mix/policy.py",
        ],
        "units": {
            "timing": "milliseconds",
            "energy": "phrase mean RMS on a 0..1 scale (-60 dBFS to 0 dBFS); fixture values, not measurements",
            "voice": "fixture byte on detector logarithmic scale; >=90 is treated as voiced, not a probability",
            "vocalClashMs": "10ms-sampled overlap of voiced phrases while both decks crossfade gain >=0.5",
            "omittedMusic": "actual milliseconds from/to active bounds; does not exempt intro/outro",
            "score": "intentionally omitted; not a listening-quality measure",
        },
        "context": {
            "source": ctx.source,
            "automatic": ctx.automatic,
            "preferredDurationMs": ctx.preferred_duration_ms,
            "allowBeatmatch": ctx.allow_beatmatch,
            "allowTempoAdjustment": ctx.allow_tempo_adjustment,
            "allowLongBeatmatch": ctx.allow_long_beatmatch,
            "allowBassHandoff": ctx.allow_bass_handoff,
        },
        "tracks": {
            "outgoing": _track(out, "Outgoing test track"),
            "incoming": _track(inc, "Incoming test track"),
        },
        "choices": [
            _option("v2", "V2 baseline", v2, out, inc, ctx),
            _option(
                "v3",
                "V3 first choice",
                menu[0].to_plan(),
                out,
                inc,
                ctx,
                candidate=menu[0],
            ),
            _option(
                "alternative",
                "V3 alternative",
                menu[1].to_plan(),
                out,
                inc,
                ctx,
                candidate=menu[1],
            ),
        ],
        "fallback": _option(
            "missing-structure",
            "Without structure",
            fallback_v2,
            plain_out,
            plain_in,
            ctx,
            candidate=fallback_menu[0],
        ),
        "fallbackNote": "Remove phrases, energy curve, vocal presence and structure confidence from the same two fixture profiles. The first v3 menu entry equals the unchanged v2 plan; extra heuristic variants may follow. The planner still has tempo, active bounds, intro/outro cues and energy.",
        "disclaimer": "The tracks and their signals are hand-authored test fixtures. Candidate plans and metrics were generated by the actual Crate planner and evaluator. No audio is played. This illustrates the decision; it is not evidence of listening quality.",
    }
    return payload


def _verify_pinned_sources() -> None:
    result = subprocess.run(
        [
            "git",
            "diff",
            "--quiet",
            PIN,
            "--",
            "app/crate/smart_mix",
            "app/tests/smart_mix_candidate_cases.py",
        ],
        cwd=REPO_ROOT,
        check=False,
    )
    if result.returncode:
        raise ValueError(
            f"Planner/fixture sources differ from {PIN}; use that revision or review and update the provenance before exporting."
        )


def main(argv: Sequence[str] | None = None) -> int:
    """Export the fixture or check its stored copy; never check out or reset files."""
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument(
        "--check",
        action="store_true",
        help="fail if the stored JSON differs; do not write",
    )
    args = parser.parse_args(argv)
    try:
        _verify_pinned_sources()
        payload = build_fixture()
        if args.check:
            if json.loads(args.output.read_text()) != payload:
                raise ValueError(f"{args.output} differs from generated planner output")
            print(f"Verified {args.output}")
        else:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(payload, indent=2) + "\n")
            print(f"Wrote {args.output}")
    except (ValueError, OSError) as error:
        parser.exit(1, f"{error}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

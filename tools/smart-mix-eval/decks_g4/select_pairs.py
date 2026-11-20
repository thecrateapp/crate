"""Pick the 10 pairs of the Decks G4 and G4b reports from ``survey.py``'s survey.

The pairs are picked by rule, in this order, each from the edges no earlier rule
took and with no track used twice, so the same survey always gives the same
pairs:

1. ``bass``: two beatmatch plans with ``bassHandoff: balanced`` and an
   equal-power curve (v3), the closest tempo first: the bass handoff Decks
   plays with its EQ.
2. ``long-blend``: one beatmatch plan with the ``dj-blend`` curve (a long blend,
   v3), the longest first.
3. ``tempo``: two adaptive plans that fell back for ``incompatible_tempo`` (v3),
   the largest tempo gap first.
4. ``vocal``: two edges whose outgoing end and incoming start are both voiced
   (the two phrases on each side, YAMNet bytes of the profiles), adaptive or
   beatmatch, the most voiced first.
5. ``long-outro``: two edges whose v3 plan starts more than 10 s before Auto
   DJ's 30 s handover (the director starts late and jumps the incoming deck),
   the latest first.
6. ``unstable``: one adaptive plan that fell back for ``low_confidence`` or
   ``unstable_tempo`` (v3), the latest start against the handover first.

Within a rule, edges with ``full`` profiles on both sides come first, then ties go by
the edge's uids.

usage:
    select_pairs.py --survey survey.json --output pairs.json
"""

from __future__ import annotations

import argparse
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

V3 = "smart-mix-v3"
LATE_MS = 10_000.0
# The harness starts the outgoing deck this long before the earliest of Auto
# DJ's handover, either plan's start and the Outro, so Auto DJ computes its fade
# as it would in a set (decksg4render_test.cpp)
LEAD_IN_MS = 25_000.0


def tempo_gap(edge: dict[str, Any]) -> float:
    out_bpm, in_bpm = edge.get("outgoingBpm"), edge.get("incomingBpm")
    if not out_bpm or not in_bpm:
        return 0.0
    ratio = in_bpm / out_bpm
    folded = min((abs(ratio * factor - 1.0) for factor in (0.5, 1.0, 2.0)))
    return folded


def voiced(edge: dict[str, Any]) -> float:
    return (edge.get("outgoingVoicedEnd") or 0.0) + (
        edge.get("incomingVoicedStart") or 0.0
    )


Rule = tuple[
    str, int, Callable[[dict[str, Any]], bool], Callable[[dict[str, Any]], Any]
]

RULES: list[Rule] = [
    (
        "bass",
        2,
        lambda e: (
            e["plans"][V3]["mode"] == "beatmatch"
            and e["plans"][V3]["bassHandoff"] == "balanced"
            and e["plans"][V3]["curve"] == "equal-power"
        ),
        lambda e: tempo_gap(e),
    ),
    (
        "long-blend",
        1,
        lambda e: (
            e["plans"][V3]["mode"] == "beatmatch"
            and e["plans"][V3]["curve"] == "dj-blend"
        ),
        lambda e: -e["plans"][V3]["durationMs"],
    ),
    (
        "tempo",
        2,
        lambda e: e["plans"][V3]["fallbackReason"] == "incompatible_tempo",
        lambda e: -tempo_gap(e),
    ),
    (
        "vocal",
        2,
        lambda e: (
            (e.get("outgoingVoicedEnd") or 0) > 0
            and (e.get("incomingVoicedStart") or 0) > 0
        ),
        lambda e: -voiced(e),
    ),
    (
        "long-outro",
        2,
        lambda e: e["plans"][V3]["lateByMs"] > LATE_MS,
        lambda e: -e["plans"][V3]["lateByMs"],
    ),
    (
        "unstable",
        1,
        lambda e: (
            e["plans"][V3]["fallbackReason"] in ("low_confidence", "unstable_tempo")
        ),
        lambda e: -e["plans"][V3]["lateByMs"],
    ),
]


def select(edges: list[dict[str, Any]]) -> list[dict[str, Any]]:
    usable = list(edges)
    chosen: list[dict[str, Any]] = []
    used: set[str] = set()
    for name, count, keep, order in RULES:
        candidates = sorted(
            (edge for edge in usable if keep(edge)),
            key=lambda edge: (
                (edge["outgoingQuality"], edge["incomingQuality"]) != ("full", "full"),
                order(edge),
                edge["outgoing"],
                edge["incoming"],
            ),
        )
        taken = 0
        for edge in candidates:
            if taken == count:
                break
            if edge["outgoing"] in used or edge["incoming"] in used:
                continue
            earliest = min(
                edge["autoDj"]["handoverS"] * 1000.0,
                edge["outgoingOutroStartMs"] or edge["autoDj"]["handoverS"] * 1000.0,
                *(plan["directorStartMs"] for plan in edge["plans"].values()),
            )
            chosen.append(
                {
                    "id": f"p{len(chosen) + 1:02d}",
                    "category": name,
                    "renderStartMs": max(0.0, earliest - LEAD_IN_MS),
                    **edge,
                }
            )
            used.update((edge["outgoing"], edge["incoming"]))
            taken += 1
        if taken < count:
            raise SystemExit(f"Rule {name}: only {taken} of {count} edges")
    return chosen


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--survey", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    survey = json.loads(args.survey.read_text())
    pairs = select(survey["edges"])
    args.output.write_text(
        json.dumps({"context": survey["context"], "pairs": pairs}, indent=1)
    )
    for pair in pairs:
        plan = pair["plans"][V3]
        print(
            pair["id"],
            pair["category"],
            plan["mode"],
            plan["fallbackReason"],
            plan["bassHandoff"],
            plan["curve"],
            round(plan["lateByMs"] / 1000, 1),
            pair["outgoingTitle"][:32],
            "->",
            pair["incomingTitle"][:32],
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

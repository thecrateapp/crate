"""The limit cases of G4b: the server's own ``limit_violations`` on the G4 menus.

For every pair of ``fetch_reference_plans.py`` it takes the ``smart-mix-v3`` menu
of Auto DJ's context and writes, as ``make_limit_violation_cases.py`` of Crate
Decks does for its fixture (and with its variation builders):

- every candidate of the menu against the edge's ``policyLimits``;
- the variations of the menu's first candidate built to cross one bound or to sit
  right on it (beatmatch or adaptive, by the plan's mode).

For each case it records the codes the server's function gives, in its order,
and whether the plan mixes. ``decksg4render_test.cpp``'s ``LimitCheckAgreement``
then runs Decks' ``TransitionPlan::limitViolations()`` on the same cases.

usage (with the monorepo's app on the path):
    limit_cases.py --reference reference_plans.json \\
        --decks-cases-tool <crate-decks>/src/test/crate/data/transition-plans/make_limit_violation_cases.py \\
        --output limit_cases.json
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from common import ensure_app_on_path  # noqa: E402

ensure_app_on_path()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--decks-cases-tool", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    spec = importlib.util.spec_from_file_location("decks_cases", args.decks_cases_tool)
    tool = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(tool)
    reference = json.loads(args.reference.read_text())["pairs"]
    cases = []
    for pair_id, plans in sorted(reference.items()):
        served = plans["autoDjV3"]
        limits = served["policyLimits"]
        for candidate in served["candidates"]:
            cases.append(
                tool.case(f"{pair_id}-candidate-{candidate['index']}", candidate["plan"], limits)
            )
        first = served["candidates"][0]["plan"]
        variations = (
            tool.beatmatch_variations if first["mode"] == "beatmatch" else tool.adaptive_variations
        )
        for name, plan_changes, limit_changes in variations(first, limits):
            cases.append(
                tool.case(
                    f"{pair_id}-{name}", *tool.varied(first, limits, plan_changes, limit_changes)
                )
            )
    args.output.write_text(json.dumps({"cases": cases}, indent=1))
    with_codes = sum(1 for case in cases if case["codes"])
    print(f"{len(cases)} cases, {with_codes} with codes -> {args.output}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

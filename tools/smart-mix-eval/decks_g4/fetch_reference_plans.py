"""Fetch the reference plans of the G4 pairs from a Crate dev stack.

For each pair of ``select_pairs.py``:

- ``autoDjV3``: the whole answer of ``smart-mix-v3`` in Auto DJ's context with
  the candidate menu (``localRefinement``) and the edge's ``policyLimits``: the
  menus whose limits ``limit_cases.py`` checks (G4b);
- ``listen``: the plan the Android app asks for the same edge with the
  production flags on (``listen-bass`` of the LV0 report: ``source: playlist``,
  6 s, beatmatch and bass swap allowed) and the server's
  ``smart_mix.listen_planner_version``: what an Android listener of this
  server hears for the pair, rendered as the Android engine plays it.

usage:
    fetch_reference_plans.py --pairs pairs.json --output reference_plans.json
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from survey import AUTO_DJ_CONTEXT, Server, check_dev_stack

LISTEN_CONTEXT = {
    "source": "playlist",
    "automatic": True,
    "offline": False,
    "preferredDurationMs": 6_000,
    "userCueProfile": "default",
    "allowBeatmatch": True,
    "allowTempoAdjustment": True,
    "allowBassHandoff": True,
}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--url", default="http://127.0.0.1:8585")
    parser.add_argument("--email", default=os.environ.get("CRATE_DECKS_LIVE_EMAIL"))
    parser.add_argument(
        "--password", default=os.environ.get("CRATE_DECKS_LIVE_PASSWORD")
    )
    parser.add_argument("--pairs", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    check_dev_stack(args.url)
    server = Server(args.url)
    server.sign_in(args.email, args.password)
    capabilities = server.request("GET", "/api/capabilities")
    listen_planner = (
        capabilities["smart_mix"].get("listen_planner_version") or "smart-mix-v2"
    )
    pairs = json.loads(args.pairs.read_text())["pairs"]

    def ask(planner: str, context: dict) -> list[dict]:
        answer = server.request(
            "POST",
            "/api/playback/transition-plans",
            {
                "plannerVersion": planner,
                "edges": [
                    {
                        "outgoingTrackEntityUid": pair["outgoing"],
                        "incomingTrackEntityUid": pair["incoming"],
                        "context": context,
                    }
                    for pair in pairs
                ],
            },
        )
        return answer["plans"]

    auto_dj = ask("smart-mix-v3", {**AUTO_DJ_CONTEXT, "localRefinement": True})
    listen = ask(listen_planner, LISTEN_CONTEXT)
    result = {
        "listenPlanner": listen_planner,
        "listenContext": LISTEN_CONTEXT,
        "pairs": {
            pair["id"]: {"autoDjV3": menu, "listen": plan}
            for pair, menu, plan in zip(pairs, auto_dj, listen)
        },
    }
    args.output.write_text(json.dumps(result, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

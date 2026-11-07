#!/usr/bin/env python3
"""Downbeats from madmom's RNN and DBN, a second opinion next to All-In-One.

madmom's downbeat network is independent of All-In-One's, so where both agree the
reference downbeats are trustworthy (the arbiter of ``evaluate_structure.py``). The DBN
takes bars of 3 or 4 beats at 100 frames per second. Runs inside ``sg1-allin1:local``,
which has madmom with its models. The models are CC BY-NC-SA 4.0: offline evaluation
only, never in a Crate image.

Writes ``<output>/<stem>.json`` per track:
``{"path": ..., "beats": [[seconds, position], ...]}`` with position 1 on a downbeat.
Tracks whose result exists are skipped.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from structure_eval import read_list


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    parser.add_argument(
        "--list", type=Path, required=True, help="one audio path per line"
    )
    parser.add_argument("--output", type=Path, required=True, help="result folder")
    args = parser.parse_args()

    from madmom.features.downbeats import (
        DBNDownBeatTrackingProcessor,
        RNNDownBeatProcessor,
    )

    args.output.mkdir(parents=True, exist_ok=True)
    rnn = RNNDownBeatProcessor()
    dbn = DBNDownBeatTrackingProcessor(beats_per_bar=[3, 4], fps=100)
    for path in read_list(args.list):
        target = args.output / f"{Path(path).stem}.json"
        if target.exists():
            continue
        started = time.monotonic()
        try:
            beats = dbn(rnn(path))
            target.write_text(
                json.dumps(
                    {"path": path, "beats": [[float(t), int(p)] for t, p in beats]}
                )
            )
            status = "ok"
        except Exception as error:  # noqa: BLE001 - log and keep going
            status = f"{type(error).__name__}: {error}"
        elapsed = time.monotonic() - started
        print(f"{Path(path).name} {status} ({elapsed:.0f} s)", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

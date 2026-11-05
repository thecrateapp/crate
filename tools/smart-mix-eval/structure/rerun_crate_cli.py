#!/usr/bin/env python3
"""Rerun ``crate-cli analyze`` on model beats saved by an earlier run.

Beat This! is most of the cost of an analysis; an analyzer change that only touches
the Rust step (the grid, the downbeat rule, the phrases) is measured by feeding the
saved beats to the new binary instead of running the model again, as the worker does
with stored signals (SM3-D16). The beats go to crate-cli unchanged. ``--meter`` adds
``beats_per_bar`` read from the downbeats by ``beats_per_bar_from_downbeats``, for
records saved before the model gave it.

Reads the ``<stem>.json`` records of ``analyze_with_beats.py`` or ``beat_this_beats.py``
in ``--input`` and writes the same shape to ``--output``, with a fresh ``rust`` part.
Runs inside the analysis worker image (crate-cli and the audio mounts); ``--meter``
needs the repository's ``app/`` on ``PYTHONPATH``. Records whose result exists, or
without beats, are skipped.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

from analyze_with_beats import run_crate_cli


def beats_payload(record: dict[str, Any], *, meter: bool) -> dict[str, Any]:
    """The ``--beats`` JSON for a saved record."""
    beats = list(record["beats_ms"])
    downbeats = list(record.get("downbeats_ms") or [])
    beats_per_bar = record.get("beats_per_bar")
    if meter and beats_per_bar is None:
        from crate.smart_mix.beat_model import beats_per_bar_from_downbeats

        beats_per_bar = beats_per_bar_from_downbeats(beats, downbeats)
    return {
        "tracker": record.get("tracker"),
        "beats_ms": beats,
        "downbeats_ms": downbeats,
        "beats_per_bar": beats_per_bar,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    parser.add_argument("--input", type=Path, required=True, help="saved records")
    parser.add_argument("--output", type=Path, required=True, help="new records")
    parser.add_argument(
        "--crate-cli",
        type=Path,
        default=Path("/usr/local/bin/crate-cli"),
        help="crate-cli binary (default: the analysis image's)",
    )
    parser.add_argument(
        "--meter", action="store_true", help="add beats_per_bar from the downbeats"
    )
    args = parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)
    for source in sorted(args.input.glob("*.json")):
        target = args.output / source.name
        if target.exists():
            continue
        record = json.loads(source.read_text())
        if not record.get("beats_ms"):
            continue
        payload = beats_payload(record, meter=args.meter)
        try:
            rust = run_crate_cli(args.crate_cli, record["path"], payload)
        except subprocess.CalledProcessError as error:
            print(f"{source.stem}: FAILED {(error.stderr or '')[-300:]}", flush=True)
            continue
        except Exception as error:  # noqa: BLE001 - log and keep going
            print(f"{source.stem}: FAILED {type(error).__name__}: {error}", flush=True)
            continue
        new = {key: record.get(key) for key in ("path", "tracker", "beat_cpu_seconds")}
        new.update(
            beats_ms=payload["beats_ms"],
            downbeats_ms=payload["downbeats_ms"],
            beats_per_bar=payload["beats_per_bar"],
            rust=rust,
        )
        target.write_text(json.dumps(new))
        print(f"{source.stem}: anchor {rust.get('downbeatAnchorMs')}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())

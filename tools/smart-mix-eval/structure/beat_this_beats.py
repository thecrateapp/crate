#!/usr/bin/env python3
"""Beats and downbeats from Beat This! (CPJKU, ISMIR 2024) outside Crate's analyzer.

Compares checkpoints and post-processing without building an analysis image:
``--checkpoint`` takes a name Beat This! downloads (``final0``, ``small0``) or a
checkpoint file, and ``--dbn`` uses madmom's DBN instead of peak picking, as the
analyzer does since SM3-D14. Runs inside ``sg1-beatthis:local`` with one torch thread,
so the CPU time per track is comparable with the analysis worker's.

Writes ``<output>/<stem>.json`` per track in the analyzer record shape, which
``rerun_crate_cli.py`` and ``evaluate_structure.py`` read: ``path``, ``tracker``,
``beat_cpu_seconds``, ``beats_ms`` and ``downbeats_ms``. Tracks whose result exists
are skipped.
"""

from __future__ import annotations

import argparse
import json
import resource
from collections.abc import Iterable
from pathlib import Path

from structure_eval import read_list


def milliseconds(seconds: Iterable[float]) -> list[int]:
    """Whole, positive, increasing milliseconds, as the analyzer stores them."""
    return sorted({max(1, round(float(time) * 1000)) for time in seconds})


def tracker_name(checkpoint: str, dbn: bool) -> str:
    """``beat-this-<checkpoint>`` with ``-dbn`` for the DBN, the analyzer's naming."""
    name = Path(checkpoint).stem if checkpoint.endswith(".ckpt") else checkpoint
    return f"beat-this-{name}{'-dbn' if dbn else ''}"


def _cpu_seconds() -> float:
    usage = resource.getrusage(resource.RUSAGE_SELF)
    return usage.ru_utime + usage.ru_stime


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    parser.add_argument(
        "--list", type=Path, required=True, help="one audio path per line"
    )
    parser.add_argument("--output", type=Path, required=True, help="result folder")
    parser.add_argument(
        "--checkpoint", default="small0", help="checkpoint name or .ckpt file"
    )
    parser.add_argument("--dbn", action="store_true", help="madmom DBN post-processing")
    parser.add_argument("--threads", type=int, default=1, help="torch threads")
    args = parser.parse_args()

    import torch
    from beat_this.inference import File2Beats

    torch.set_num_threads(args.threads)
    args.output.mkdir(parents=True, exist_ok=True)
    tracker = File2Beats(checkpoint_path=args.checkpoint, device="cpu", dbn=args.dbn)
    name = tracker_name(args.checkpoint, args.dbn)
    for path in read_list(args.list):
        target = args.output / f"{Path(path).stem}.json"
        if target.exists():
            continue
        started = _cpu_seconds()
        try:
            beats, downbeats = tracker(path)
        except Exception as error:  # noqa: BLE001 - log and keep going
            print(
                f"{Path(path).name} FAILED {type(error).__name__}: {error}", flush=True
            )
            continue
        cpu = _cpu_seconds() - started
        target.write_text(
            json.dumps(
                {
                    "path": path,
                    "tracker": name,
                    "beat_cpu_seconds": round(cpu, 2),
                    "beats_ms": milliseconds(beats),
                    "downbeats_ms": milliseconds(downbeats),
                }
            )
        )
        print(f"{Path(path).name} ok ({cpu:.0f} s CPU)", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

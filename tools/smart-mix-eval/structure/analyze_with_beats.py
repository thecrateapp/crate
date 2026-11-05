#!/usr/bin/env python3
"""Analyze audio files offline the way the analysis worker does, with model beats.

Runs Beat This! with its DBN through ``crate.smart_mix.beat_model`` (SM3-D14), then
the Python analyzer and, with ``--crate-cli``, the Rust one on the same beats. Nothing
is read from or written to a database. Runs inside the analysis worker image, whose
torch, ``beat_this``, madmom and checkpoint are the ones production uses; the
repository's ``app/`` on ``PYTHONPATH`` selects the analyzer code.

Writes ``<output>/<stem>.json`` per track: ``path``, ``tracker``,
``beat_cpu_seconds``, ``beats_ms``, ``downbeats_ms`` and ``beats_per_bar``, then
``python`` (CPU seconds, tracker, quality, BPM, anchor, grid and phrases) and ``rust``
(the profile fields the evaluation reads, with CPU and wall seconds). Tracks whose
result exists are skipped.
"""

from __future__ import annotations

import argparse
import json
import resource
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

from structure_eval import read_list, require_unique_stems

# The profile fields of crate-cli's mixProfile that the evaluation reads.
RUST_FIELDS = (
    "beatTracker",
    "quality",
    "bpm",
    "timeSignature",
    "downbeatAnchorMs",
    "introDownbeatMs",
    "outroDownbeatMs",
    "beatGridMs",
    "phrases",
)


def run_crate_cli(binary: Path, path: str, payload: dict[str, Any] | None) -> dict:
    """``crate-cli analyze`` on ``path`` with the model beats, if any.

    Returns the ``RUST_FIELDS`` of its profile with the child's CPU and wall seconds.
    """
    command = [str(binary), "analyze", "--file", path]
    with tempfile.TemporaryDirectory() as scratch:
        if payload is not None:
            beats_path = Path(scratch) / "beats.json"
            beats_path.write_text(json.dumps(payload))
            command += ["--beats", str(beats_path)]
        before = resource.getrusage(resource.RUSAGE_CHILDREN)
        started = time.monotonic()
        result = subprocess.run(command, capture_output=True, text=True, check=True)
        wall = time.monotonic() - started
        after = resource.getrusage(resource.RUSAGE_CHILDREN)
    cpu = (after.ru_utime + after.ru_stime) - (before.ru_utime + before.ru_stime)
    profile = json.loads(result.stdout)["mixProfile"]
    return {
        "wall_seconds": round(wall, 2),
        "cpu_seconds": round(cpu, 2),
        **{key: profile.get(key) for key in RUST_FIELDS},
    }


def analyze_one(
    path: Path, model: Any, crate_cli: Path | None, python: bool
) -> dict[str, Any]:
    from crate.smart_mix import beat_model

    started = time.process_time()
    beats = beat_model.track_file_beats(path, model=model)
    record: dict[str, Any] = {
        "path": str(path),
        "tracker": model.tracker,
        "beat_cpu_seconds": round(time.process_time() - started, 2),
        "beats_ms": list(beats.beats_ms) if beats else None,
        "downbeats_ms": list(beats.downbeats_ms) if beats else None,
        "beats_per_bar": beats.beats_per_bar if beats else None,
    }
    if python:
        from crate.smart_mix.analyzer import analyze_mix_profile

        started = time.process_time()
        profile = analyze_mix_profile(path, beats)
        record["python"] = {
            "cpu_seconds": round(time.process_time() - started, 2),
            "beat_tracker": profile.beat_tracker,
            "quality": str(profile.quality),
            "bpm": profile.bpm,
            "downbeat_anchor_ms": profile.downbeat_anchor_ms,
            "beat_grid_ms": list(profile.beat_grid_ms),
            "phrases": [phrase.to_dict() for phrase in profile.phrases or ()],
        }
    if crate_cli is not None:
        record["rust"] = run_crate_cli(
            crate_cli, str(path), None if beats is None else beats.to_payload()
        )
    return record


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    parser.add_argument("paths", nargs="*", type=Path, help="audio files")
    parser.add_argument("--list", type=Path, help="file with one audio path per line")
    parser.add_argument("--output", type=Path, required=True, help="result folder")
    parser.add_argument("--crate-cli", type=Path, help="crate-cli binary to run too")
    parser.add_argument(
        "--no-python", action="store_true", help="skip the Python analyzer"
    )
    args = parser.parse_args()
    if args.no_python and args.crate_cli is None:
        parser.error("--no-python needs --crate-cli")

    from crate.smart_mix import beat_model

    model = beat_model.load_beat_model()
    if model is None:
        print(
            "No Beat This! model (torch, beat_this, madmom or weights)", file=sys.stderr
        )
        return 2
    args.output.mkdir(parents=True, exist_ok=True)
    paths = list(args.paths)
    if args.list:
        paths += [Path(line) for line in read_list(args.list)]
    require_unique_stems(paths)
    for path in paths:
        target = args.output / f"{path.stem}.json"
        if target.exists():
            continue
        try:
            record = analyze_one(path, model, args.crate_cli, not args.no_python)
        except Exception as error:  # noqa: BLE001 - log and keep going
            print(f"{path.name}: FAILED {type(error).__name__}: {error}", flush=True)
            continue
        target.write_text(json.dumps(record))
        rust = record.get("rust") or {}
        python = record.get("python") or {}
        print(
            f"{path.name}: {len(record['beats_ms'] or [])} beats "
            f"({record['beat_cpu_seconds']:.1f} s), python anchor "
            f"{python.get('downbeat_anchor_ms')}, rust anchor "
            f"{rust.get('downbeatAnchorMs')}",
            flush=True,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

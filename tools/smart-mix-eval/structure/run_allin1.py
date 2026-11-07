#!/usr/bin/env python3
"""Run All-In-One (``allin1``, harmonix-all) over a list of audio files.

The structure reference of SMB.PR3: sections with labels, beats, beat positions and
downbeats per track. Runs inside the throwaway ``sg1-allin1:local`` image
(``Dockerfile.allin1``), one track at a time on the CPU, and skips tracks whose result
already exists, so an interrupted run resumes and a list can be split into shards for
several containers. Demixed stems and spectrograms go to a temporary folder that is
emptied after every track.

Writes ``<output>/<stem>.json`` per track, as ``allin1`` saves it.
"""

from __future__ import annotations

import argparse
import shutil
import tempfile
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

    import allin1

    args.output.mkdir(parents=True, exist_ok=True)
    paths = read_list(args.list)
    for index, path in enumerate(paths, 1):
        if (args.output / f"{Path(path).stem}.json").exists():
            continue
        started = time.monotonic()
        scratch = Path(tempfile.mkdtemp(prefix="allin1-"))
        try:
            allin1.analyze(
                path,
                out_dir=str(args.output),
                device="cpu",
                demix_dir=str(scratch / "demix"),
                spec_dir=str(scratch / "spec"),
                keep_byproducts=False,
                multiprocess=False,
            )
            status = "ok"
        except Exception as error:  # noqa: BLE001 - log and keep going
            status = f"{type(error).__name__}: {error}"
        finally:
            shutil.rmtree(scratch, ignore_errors=True)
        elapsed = time.monotonic() - started
        print(
            f"{index}/{len(paths)} {Path(path).name} {status} ({elapsed:.0f} s)",
            flush=True,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

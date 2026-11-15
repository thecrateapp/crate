"""Stem analyses for a pool of tracks with the server's own separation (Smart Mix Stems).

The stems input of the evaluation (ST3.PR3): each track goes through
``crate.smart_mix.separation`` unchanged (decode, normalisation, segments, STFT, the
``htdemucs-onnx-1`` graph, iSTFT, overlap-add) and ``analyze_stems``, and its
``stem-analysis/1`` is written to ``--output/<entity_uid>.json``. ``run_eval.py
--stems`` reads that folder. Drum beats are left out: the planner does not read them.

``--provider cuda`` runs the same graph on ONNX Runtime's CUDA provider instead of the
CPU one, to separate a pool in minutes instead of hours; everything around the graph
is the same numpy. It needs ``onnxruntime-gpu`` and the CUDA and cuDNN libraries on
``LD_LIBRARY_PATH``. The sessions run the graph's independent nodes on two inter-op
threads (``parallel-2``), which keeps a session under about 750 MiB of VRAM.
``parity`` separates the same tracks on both providers and reports, per stem, the
largest difference, the SDR of CUDA against CPU and how many level bytes differ.

Nothing is read from a database and nothing is written to one. The ``sourceRevision``
of each analysis is the local file's, so it never matches a profile of another copy:
``run_eval.py --stems`` binds each analysis to the profile it plans with, by entity
UID and duration. Scratch audio (the decoded track and its stems, about 425 MB for
five minutes) goes to ``--scratch``, which must be on disk: never ``/tmp``.

usage:
    separate_pool.py separate --tracks pool.tsv --output out/<set>/stems \\
        --scratch out/scratch [--music-root /music=out/<set>/audio] \\
        [--provider cuda] [--jobs 2] [--threads 4]
    separate_pool.py parity --tracks three.tsv --output out/parity \\
        --scratch out/scratch [--music-root ...] [--threads 8]

``--tracks`` is a TSV of ``<entity_uid>\\t<path>``; ``--music-root`` maps a path prefix
to a local folder, as in ``listen_metrics.py``.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from collections.abc import Iterable, Mapping, Sequence
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from common import ensure_app_on_path, git_commit, write_json

ensure_app_on_path()

import numpy as np  # noqa: E402

from crate.smart_mix.separation import (  # noqa: E402
    PARALLEL_2,
    SESSION_CONFIG,
    SessionConfig,
    analyze_stems,
    model_path,
    separate,
)
from crate.smart_mix.stems import STEM_SOURCES, StemAnalysis  # noqa: E402

PROVIDERS = ("cpu", "cuda")
# tmpfs mounts: scratch audio would live in RAM there.
_MEMORY_ROOTS = (Path("/tmp"), Path("/dev/shm"), Path("/run"))


@dataclass(frozen=True, slots=True)
class PoolTrack:
    entity_uid: str
    path: Path


def read_tracks(path: Path, *, music_root: str = "/music=/music") -> list[PoolTrack]:
    """``<entity_uid>\\t<path>`` rows, the path prefix mapped by ``music_root``."""
    prefix, _, local = music_root.partition("=")
    tracks: list[PoolTrack] = []
    seen: set[str] = set()
    for line in path.read_text().splitlines():
        fields = line.rstrip("\n").split("\t")
        if len(fields) < 2 or not fields[0].strip() or fields[0].startswith("#"):
            continue
        uid, stored = fields[0].strip(), fields[1].strip()
        if uid in seen:
            continue
        seen.add(uid)
        mapped = local + stored[len(prefix) :] if stored.startswith(prefix) else stored
        tracks.append(PoolTrack(uid, Path(mapped)))
    return tracks


def check_scratch(scratch: Path) -> Path:
    """The scratch folder, refused when it lives in memory."""
    resolved = scratch.resolve()
    for root in _MEMORY_ROOTS:
        if resolved == root or root in resolved.parents:
            raise SystemExit(f"--scratch {scratch} is in memory; use a folder on disk")
    resolved.mkdir(parents=True, exist_ok=True)
    return resolved


class CudaGraph:
    """``htdemucs-onnx-1`` on ONNX Runtime's CUDA provider, CPU as ONNX Runtime's
    own fallback for nodes CUDA lacks (the spike found none)."""

    def __init__(
        self, path: Path, *, threads: int, config: SessionConfig = PARALLEL_2
    ) -> None:
        import onnxruntime as ort

        options = ort.SessionOptions()
        options.intra_op_num_threads = max(1, int(threads))
        options.inter_op_num_threads = max(1, config.inter_op_threads)
        options.execution_mode = (
            ort.ExecutionMode.ORT_PARALLEL
            if config.parallel
            else ort.ExecutionMode.ORT_SEQUENTIAL
        )
        options.enable_mem_reuse = config.mem_reuse
        options.enable_mem_pattern = False
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        options.log_severity_level = 3
        self._session = ort.InferenceSession(
            str(path),
            sess_options=options,
            providers=["CUDAExecutionProvider", "CPUExecutionProvider"],
        )
        if self._session.get_providers()[0] != "CUDAExecutionProvider":
            raise RuntimeError(
                "ONNX Runtime did not load the CUDA provider; check LD_LIBRARY_PATH"
            )

    def __call__(
        self, mix: np.ndarray, spec: np.ndarray
    ) -> tuple[np.ndarray, np.ndarray]:
        spec_out, wave_out = self._session.run(
            ["spec_out", "wave_out"], {"mix": mix, "spec": spec}
        )
        return spec_out, wave_out


def make_graph(provider: str, *, threads: int) -> Any:
    """The graph for ``separate``: None lets it build its own CPU session."""
    if provider == "cuda":
        return CudaGraph(model_path(), threads=threads)
    if provider == "cpu":
        return None
    raise ValueError(f"unknown provider {provider!r}")


def analysis_document(analysis: StemAnalysis) -> dict[str, Any]:
    return analysis.model_dump(mode="json", by_alias=True, exclude_none=True)


def sdr_db(reference: np.ndarray, estimate: np.ndarray) -> float:
    """Signal-to-distortion ratio of ``estimate`` against ``reference`` in dB."""
    reference = np.asarray(reference, np.float64)
    error = reference - np.asarray(estimate, np.float64)
    signal = float(np.dot(reference.ravel(), reference.ravel()))
    noise = float(np.dot(error.ravel(), error.ravel()))
    if noise == 0.0:
        return math.inf
    if signal == 0.0:
        return -math.inf
    return 10.0 * math.log10(signal / noise)


def level_differences(left: StemAnalysis, right: StemAnalysis) -> dict[str, Any]:
    """Per stem: windows whose level byte differs and the largest difference."""
    result = {}
    for stem in STEM_SOURCES:
        a = np.frombuffer(getattr(left.levels, stem), np.uint8).astype(int)
        b = np.frombuffer(getattr(right.levels, stem), np.uint8).astype(int)
        if a.size != b.size:
            result[stem] = {"windows": [int(a.size), int(b.size)]}
            continue
        delta = np.abs(a - b)
        result[stem] = {
            "windows": int(a.size),
            "differing": int((delta > 0).sum()),
            "maxByteDelta": int(delta.max(initial=0)),
        }
    return result


# --- workers --------------------------------------------------------------------------

_STATE: dict[str, Any] = {}


def _init_worker(provider: str, threads: int) -> None:
    _STATE["provider"] = provider
    _STATE["threads"] = threads
    _STATE["graph"] = make_graph(provider, threads=threads)


def _separate_job(job: tuple[PoolTrack, str, str]) -> tuple[str, dict[str, Any]]:
    track, scratch, output = job
    started = time.monotonic()
    try:
        with separate(
            track.path,
            threads=_STATE["threads"],
            scratch=Path(scratch),
            graph=_STATE["graph"],
            config=SESSION_CONFIG,
        ) as stems:
            separated = time.monotonic()
            analysis = analyze_stems(stems)
        write_json(
            Path(output) / f"{track.entity_uid}.json", analysis_document(analysis)
        )
        return track.entity_uid, {
            "status": "ok",
            "durationMs": analysis.duration_ms,
            "separateSeconds": round(separated - started, 2),
            "seconds": round(time.monotonic() - started, 2),
        }
    except Exception as error:  # one broken file must not stop the pool
        return track.entity_uid, {
            "status": "failed",
            "error": f"{type(error).__name__}: {error}"[:300],
        }


def run_separate(
    tracks: Sequence[PoolTrack],
    *,
    output: Path,
    scratch: Path,
    provider: str,
    jobs: int,
    threads: int,
    force: bool = False,
) -> dict[str, Any]:
    output.mkdir(parents=True, exist_ok=True)
    todo = [
        track
        for track in tracks
        if force or not (output / f"{track.entity_uid}.json").is_file()
    ]
    print(f"{len(todo)} of {len(tracks)} tracks to separate", file=sys.stderr)
    outcomes: dict[str, dict[str, Any]] = {}
    index_path = output / "index.jsonl"
    started = time.monotonic()
    with (
        ProcessPoolExecutor(
            max_workers=max(1, jobs),
            initializer=_init_worker,
            initargs=(provider, threads),
        ) as pool,
        index_path.open("a") as index,
    ):
        jobs_iter = ((track, str(scratch), str(output)) for track in todo)
        for done, (uid, outcome) in enumerate(pool.map(_separate_job, jobs_iter), 1):
            outcomes[uid] = outcome
            index.write(
                json.dumps({"entityUid": uid, "provider": provider, **outcome}) + "\n"
            )
            index.flush()
            if done % 10 == 0 or outcome["status"] != "ok":
                print(f"  {done}/{len(todo)} {uid} {outcome}", file=sys.stderr)
    return {
        "createdAt": datetime.now(UTC).isoformat(),
        "gitCommit": git_commit(),
        "provider": provider,
        "jobs": jobs,
        "threads": threads,
        "tracks": len(tracks),
        "separated": sum(1 for o in outcomes.values() if o["status"] == "ok"),
        "failed": sorted(u for u, o in outcomes.items() if o["status"] != "ok"),
        "wallSeconds": round(time.monotonic() - started, 1),
    }


def run_parity(
    tracks: Iterable[PoolTrack], *, output: Path, scratch: Path, threads: int
) -> dict[str, Any]:
    """Each track on CPU and on CUDA: stems and level bytes compared."""
    cuda = make_graph("cuda", threads=threads)
    rows = []
    for track in tracks:
        seconds = {}
        with separate(track.path, threads=threads, scratch=scratch) as cpu_stems:
            started = time.monotonic()
            with separate(
                track.path, threads=threads, scratch=scratch, graph=cuda
            ) as cuda_stems:
                seconds["cuda"] = round(time.monotonic() - started, 2)
                stems = {}
                for stem in STEM_SOURCES:
                    reference = cpu_stems.read(stem)
                    estimate = cuda_stems.read(stem)
                    stems[stem] = {
                        "maxAbsDiff": float(np.abs(reference - estimate).max()),
                        "sdrDb": round(sdr_db(reference, estimate), 2),
                    }
                levels = level_differences(
                    analyze_stems(cpu_stems), analyze_stems(cuda_stems)
                )
        rows.append(
            {
                "entityUid": track.entity_uid,
                "frames": cpu_stems.frames,
                "cudaSeconds": seconds["cuda"],
                "stems": stems,
                "levels": levels,
            }
        )
        print(f"  {track.entity_uid} {stems} {levels}", file=sys.stderr)
    result = {
        "createdAt": datetime.now(UTC).isoformat(),
        "gitCommit": git_commit(),
        "threads": threads,
        "tracks": rows,
    }
    write_json(output / "parity.json", result)
    return result


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n\n")[0])
    parser.add_argument("command", choices=("separate", "parity"))
    parser.add_argument("--tracks", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--scratch", type=Path, required=True)
    parser.add_argument(
        "--music-root", default="/music=/music", metavar="DB_PREFIX=LOCAL"
    )
    parser.add_argument("--provider", choices=PROVIDERS, default="cpu")
    parser.add_argument("--jobs", type=int, default=1)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--force", action="store_true")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    # TEST_GAP: separation itself runs the real graph on real audio (see README);
    # the track list, the scratch check and the comparisons are tested.
    args = parse_args(argv)
    tracks = read_tracks(args.tracks, music_root=args.music_root)
    if args.limit is not None:
        tracks = tracks[: args.limit]
    missing = [track.entity_uid for track in tracks if not track.path.is_file()]
    if missing:
        print(f"{len(missing)} tracks have no audio: {missing[:5]}", file=sys.stderr)
        return 2
    scratch = check_scratch(args.scratch)
    args.output.mkdir(parents=True, exist_ok=True)
    if args.command == "parity":
        run_parity(tracks, output=args.output, scratch=scratch, threads=args.threads)
        return 0
    summary = run_separate(
        tracks,
        output=args.output,
        scratch=scratch,
        provider=args.provider,
        jobs=args.jobs,
        threads=args.threads,
        force=args.force,
    )
    write_json(args.output / f"run-{int(time.time())}.json", summary)
    print(json.dumps(summary), file=sys.stderr)
    return 1 if summary["failed"] else 0


def load_stem_analyses(folder: Path) -> Mapping[str, StemAnalysis]:
    """Entity UID -> analysis, from a folder ``separate`` wrote."""
    analyses = {}
    for path in sorted(folder.glob("*.json")):
        if path.name.startswith("run-") or path.name == "parity.json":
            continue
        analyses[path.stem] = StemAnalysis.model_validate_json(path.read_text())
    return analyses


__all__ = [
    "CudaGraph",
    "PoolTrack",
    "check_scratch",
    "level_differences",
    "load_stem_analyses",
    "read_tracks",
    "sdr_db",
]


if __name__ == "__main__":
    raise SystemExit(main())

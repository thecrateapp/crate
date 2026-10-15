"""Compare Smart Mix tempo analysis against BPM tags on a sampled local library."""

from __future__ import annotations

import argparse
import json
import os
import platform
import random
import subprocess
import sys
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

AUDIO_EXTENSIONS = {".flac", ".m4a", ".mp3", ".ogg", ".opus"}
BPM_TAG_KEYS = ("bpm", "BPM", "TBPM", "tmpo", "----:com.apple.iTunes:BPM")
ACC1_TOLERANCE = 0.04
OCTAVE_FACTORS = (1.0, 2.0, 0.5, 3.0, 1.0 / 3.0)
FULL_STABILITY = 0.8
FULL_CONFIDENCE = 0.75


def _first_text(value: Any) -> str | None:
    if value is None:
        return None
    if hasattr(value, "text"):
        value = value.text
    if isinstance(value, (list, tuple)):
        value = value[0] if value else None
    return None if value is None else str(value).strip()


def read_reference(path: Path) -> dict[str, Any] | None:
    import mutagen

    try:
        audio = mutagen.File(path)
    except Exception:
        return None
    tags = getattr(audio, "tags", None)
    if not tags:
        return None
    bpm = None
    for key in BPM_TAG_KEYS:
        try:
            raw = _first_text(tags.get(key))
        except Exception:
            raw = None
        if raw:
            try:
                bpm = float(raw)
            except ValueError:
                continue
            break
    if not bpm or bpm <= 0:
        return None

    def text(*keys: str) -> str:
        for key in keys:
            try:
                value = _first_text(tags.get(key))
            except Exception:
                value = None
            if value:
                return value
        return ""

    return {
        "reference_bpm": bpm,
        "artist": text("albumartist", "artist", "TPE2", "TPE1", "aART", "\xa9ART"),
        "genre": text("genre", "TCON", "\xa9gen") or "unknown",
    }


def sample_tracks(
    candidates: list[dict[str, Any]],
    *,
    size: int,
    per_artist: int,
    seed: int,
    per_genre: int | None = None,
) -> list[dict[str, Any]]:
    rng = random.Random(seed)
    shuffled = sorted(candidates, key=lambda item: item["path"])
    rng.shuffle(shuffled)
    by_artist: dict[str, int] = defaultdict(int)
    by_genre: dict[str, int] = defaultdict(int)
    picked = []
    for item in shuffled:
        artist = item["artist"].casefold()
        genre = str(item.get("genre") or "unknown").casefold()
        if by_artist[artist] >= per_artist:
            continue
        if per_genre is not None and by_genre[genre] >= per_genre:
            continue
        by_artist[artist] += 1
        by_genre[genre] += 1
        picked.append(item)
        if len(picked) == size:
            break
    return sorted(picked, key=lambda item: item["path"])


def tempo_matches(estimate: float | None, reference: float, *, octaves: bool) -> bool:
    if not estimate or estimate <= 0:
        return False
    factors = OCTAVE_FACTORS if octaves else (1.0,)
    return any(
        abs(estimate - reference * factor) <= reference * factor * ACC1_TOLERANCE
        for factor in factors
    )


def summarize(rows: list[dict[str, Any]], analyzer: str) -> dict[str, Any]:
    measured = [row for row in rows if row.get(analyzer, {}).get("ok")]
    count = len(measured)
    if count == 0:
        return {"tracks": 0, "failed": len(rows)}
    results = [row[analyzer] for row in measured]

    def share(flags: list[bool]) -> float:
        return round(sum(flags) / count, 3)

    stabilities = sorted(result["tempo_stability"] or 0.0 for result in results)
    return {
        "tracks": count,
        "failed": len(rows) - count,
        "acc1": share(
            [
                tempo_matches(row[analyzer]["bpm"], row["reference_bpm"], octaves=False)
                for row in measured
            ]
        ),
        "acc2": share(
            [
                tempo_matches(row[analyzer]["bpm"], row["reference_bpm"], octaves=True)
                for row in measured
            ]
        ),
        "median_stability": round(stabilities[count // 2], 3),
        "stable_share": share([value >= FULL_STABILITY for value in stabilities]),
        "confident_share": share(
            [(result["bpm_confidence"] or 0.0) >= FULL_CONFIDENCE for result in results]
        ),
        "downbeat_share": share(
            [result["downbeat_anchor_ms"] is not None for result in results]
        ),
        "full_share": share([result["quality"] == "full" for result in results]),
        "median_seconds": round(
            sorted(result["seconds"] for result in results)[count // 2], 2
        ),
    }


def summarize_by_genre(
    rows: list[dict[str, Any]], analyzers: tuple[str, ...], *, minimum: int = 5
) -> dict[str, Any]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        groups[row["genre"].casefold()].append(row)
    return {
        genre: {analyzer: summarize(members, analyzer) for analyzer in analyzers}
        for genre, members in sorted(groups.items())
        if len(members) >= minimum
    }


PYTHON_ANALYZER = (
    "import json, sys; "
    "from crate.smart_mix.analyzer import analyze_mix_profile; "
    "d = analyze_mix_profile(sys.argv[1]); "
    "print(json.dumps({'bpm': d.bpm, 'bpmConfidence': d.bpm_confidence, "
    "'tempoStability': d.tempo_stability, 'downbeatAnchorMs': d.downbeat_anchor_ms, "
    "'quality': str(getattr(d.quality, 'value', d.quality))}))"
)


def _run_profile(command: list[str], *, profile_key: str | None) -> dict[str, Any]:
    started = time.perf_counter()
    completed = subprocess.run(
        command, capture_output=True, text=True, timeout=900, check=False
    )
    if completed.returncode != 0:
        return {
            "ok": False,
            "exit_code": completed.returncode,
            "error": completed.stderr[-300:],
        }
    payload = json.loads(completed.stdout.strip().splitlines()[-1])
    profile = payload.get(profile_key) or {} if profile_key else payload
    return {
        "ok": True,
        "bpm": profile.get("bpm"),
        "bpm_confidence": profile.get("bpmConfidence"),
        "tempo_stability": profile.get("tempoStability"),
        "downbeat_anchor_ms": profile.get("downbeatAnchorMs"),
        "quality": profile.get("quality"),
        "seconds": round(time.perf_counter() - started, 2),
    }


def _analyze_python(path: str) -> dict[str, Any]:
    return _run_profile([sys.executable, "-c", PYTHON_ANALYZER, path], profile_key=None)


def _analyze_rust(path: str, crate_cli: str) -> dict[str, Any]:
    return _run_profile(
        [crate_cli, "analyze", "--file", path], profile_key="mixProfile"
    )


def _evaluate_track(
    task: tuple[dict[str, Any], str | None, bool],
) -> dict[str, Any]:
    track, crate_cli, with_python = task
    row = dict(track)
    analyzers = []
    if with_python:
        analyzers.append(("python", lambda: _analyze_python(track["path"])))
    if crate_cli:
        analyzers.append(("rust", lambda: _analyze_rust(track["path"], crate_cli)))
    for name, analyze in analyzers:
        try:
            row[name] = analyze()
        except Exception as exc:
            row[name] = {"ok": False, "error": repr(exc)[-300:]}
    return row


def collect_candidates(root: Path) -> list[dict[str, Any]]:
    candidates = []
    for directory, _dirs, files in os.walk(root, followlinks=True):
        for name in files:
            path = Path(directory) / name
            if path.suffix.lower() not in AUDIO_EXTENSIONS:
                continue
            reference = read_reference(path)
            if reference:
                candidates.append({"path": str(path), **reference})
    return candidates


def load_candidates(path: Path) -> list[dict[str, Any]]:
    candidates = []
    for entry in json.loads(path.read_text()):
        reference = read_reference(Path(entry["path"]))
        if not reference:
            continue
        candidates.append(
            {
                **reference,
                "path": entry["path"],
                "artist": entry.get("artist") or reference["artist"],
                "genre": entry.get("genre") or reference["genre"],
                "library_bpm": entry.get("library_bpm"),
            }
        )
    return candidates


def library_result(row: dict[str, Any]) -> dict[str, Any]:
    bpm = row.get("library_bpm")
    if not bpm:
        return {"ok": False, "error": "no library bpm"}
    return {
        "ok": True,
        "bpm": float(bpm),
        "bpm_confidence": None,
        "tempo_stability": None,
        "downbeat_anchor_ms": None,
        "quality": None,
        "seconds": 0.0,
    }


def run(args: argparse.Namespace) -> dict[str, Any]:
    candidates = (
        load_candidates(args.candidates)
        if args.candidates
        else collect_candidates(args.library)
    )
    sample = sample_tracks(
        candidates,
        size=args.size,
        per_artist=args.per_artist,
        seed=args.seed,
        per_genre=args.per_genre,
    )
    analyzers = tuple(
        name
        for name, enabled in (
            ("python", not args.skip_python),
            ("rust", args.crate_cli),
            ("library", args.candidates),
        )
        if enabled
    )
    rows = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        tasks = [(track, args.crate_cli, not args.skip_python) for track in sample]
        for index, row in enumerate(pool.map(_evaluate_track, tasks), start=1):
            if args.candidates:
                row["library"] = library_result(row)
            rows.append(row)
            print(f"{index}/{len(sample)} {Path(row['path']).name}", file=sys.stderr)
    return {
        "kind": "tempo-evaluation",
        "environment": {
            "machine": platform.machine(),
            "cpus": os.cpu_count(),
            "python": platform.python_version(),
            "crate_cli": args.crate_cli,
            "note": args.note,
        },
        "dataset": {
            "library": str(args.library),
            "reference": "file BPM tags",
            "candidates": len(candidates),
            "sample_size": len(sample),
            "per_artist": args.per_artist,
            "seed": args.seed,
        },
        "metrics": {
            "acc1_tolerance": ACC1_TOLERANCE,
            "octave_factors": list(OCTAVE_FACTORS),
            "overall": {analyzer: summarize(rows, analyzer) for analyzer in analyzers},
            "by_genre": summarize_by_genre(rows, analyzers),
        },
        "tracks": rows,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--library", type=Path)
    parser.add_argument("--candidates", type=Path)
    parser.add_argument("--per-genre", type=int)
    parser.add_argument("--size", type=int, default=120)
    parser.add_argument("--per-artist", type=int, default=3)
    parser.add_argument("--seed", type=int, default=20261014)
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--crate-cli")
    parser.add_argument("--skip-python", action="store_true")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--note", default="")
    args = parser.parse_args(argv)
    if not args.library and not args.candidates:
        parser.error("--library or --candidates is required")
    artifact = run(args)
    args.output.write_text(json.dumps(artifact, indent=2) + "\n")
    print(json.dumps(artifact["metrics"]["overall"], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

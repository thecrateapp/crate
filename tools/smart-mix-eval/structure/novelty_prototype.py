#!/usr/bin/env python3
"""The SM3-D17 prototype: harmony and timbre in the section novelty.

Replays the phrase segmentation on per-bar features with the v7 novelty (level and
band balance) plus a harmony (chroma) and a timbre (MFCC) term, sweeping their weights
and the boundary cost, and scores each variant against All-In-One's sections.

- ``extract <analysis> <features>``: for every analyzer record with a grid and a
  downbeat, decodes the track as the Python analyzer does and saves its per-bar
  features (level, band balance, music, chroma, MFCC, bar times) to
  ``<features>/<stem>.npz``. Runs inside the analysis worker image with the
  repository's ``app/`` on ``PYTHONPATH``.
- ``evaluate <features> <allin1> <out.json>``: segments every track for each variant
  with the production peaks and dynamic programme, and averages ``mir_eval`` boundary
  precision, recall and F1 at 0.5 s, 3 s and one bar over two halves of the tracks
  (``tune``, the even positions in stem order, and ``held``, the odd ones). Needs
  ``mir_eval`` next to the app's dependencies.

Variants: ``base`` is the v7 novelty alone; ``A`` adds the production terms
(``structure._harmony_timbre``: distance between the four-bar mean chroma and MFCC
before and after a boundary), which SM3-D17 kept with weights 2 and 8 and a 4 dB
cost; ``B`` adds a Foote checkerboard kernel of 4 + 4 bars over the bar
self-similarity of chroma and MFCC, which it rejected. Both standardise each MFCC
coefficient over the music bars, dividing by at least ``structure.MFCC_STD_FLOOR``.
"""

from __future__ import annotations

import argparse
import json
import math
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import numpy as np

from structure_eval import (
    detection,
    read_json_dir,
    section_intervals,
)

KERNEL_BARS = 4  # bars on each side, the production novelty window
VARIANTS = ("A", "B")
WINDOW_NAMES = ("0.5s", "3s", "bar")


def extract(analysis: Path, features: Path) -> None:
    from crate.smart_mix import analyzer, structure
    from crate.smart_mix.cue_detection import frame_rms
    from crate.smart_mix.phrase_grid import downbeats_from_anchor

    features.mkdir(parents=True, exist_ok=True)
    for stem, record in read_json_dir(analysis).items():
        target = features / f"{stem}.npz"
        if target.exists():
            continue
        profile = record.get("rust") or {}
        grid, anchor = profile.get("beatGridMs") or [], profile.get("downbeatAnchorMs")
        if not grid or anchor is None:
            continue
        try:
            loaded = analyzer._load_audio(Path(record["path"]))
            audio, rate = loaded.head, loaded.sample_rate
            _, _, chroma, bands, mfcc = analyzer._frame_features(audio, rate)
            heads = tuple(beat for beat in grid if beat <= len(audio) * 1000 / rate)
            bars = structure._bars(heads, downbeats_from_anchor(heads, anchor))
            frames = structure.EnergyFrames(
                rms=frame_rms(audio, rate),
                bands_db=bands,
                band_hop=analyzer.HOP_LENGTH,
                chroma=chroma,
                mfcc=mfcc,
            )
            bar_features = structure._bar_features(bars, frames, rate)
            np.savez(
                target,
                levels=np.array(bar_features.levels),
                shapes=np.array(bar_features.shapes),
                music=np.array(bar_features.music),
                chroma=np.asarray(bar_features.chroma),
                mfcc=np.asarray(bar_features.mfcc),
                start_ms=np.array([bar.start_ms for bar in bars]),
                end_ms=np.array([bar.end_ms for bar in bars]),
                start_beat=np.array([bar.start_beat for bar in bars]),
            )
            print(f"{stem}: {len(bars)} bars", flush=True)
        except Exception as error:  # noqa: BLE001 - log and keep going
            print(f"{stem}: FAILED {type(error).__name__}: {error}", flush=True)


def _cosine_similarity(matrix: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    unit = matrix / np.where(norms > 0, norms, 1.0)
    return unit @ unit.T


def _standardized(mfcc: np.ndarray) -> np.ndarray:
    """Each coefficient minus its mean, over its deviation or ``MFCC_STD_FLOOR``.

    The larger of the two, as the production timbre term divides (variant A), so the
    bar-to-bar noise of a near-static loop stays noise.
    """
    from crate.smart_mix import structure

    deviation = mfcc.std(axis=0)
    return (mfcc - mfcc.mean(axis=0)) / np.maximum(deviation, structure.MFCC_STD_FLOOR)


def foote_terms(
    chroma: np.ndarray, mfcc: np.ndarray, gaps: Sequence[bool]
) -> tuple[list[float], list[float]]:
    """Variant B: within-window minus across-window similarity at each boundary.

    Boundaries closer than ``KERNEL_BARS`` to either end, gap bars and windows without
    a non-gap bar get 0, as in the production novelty.
    """
    count = len(gaps)
    harmony, timbre = [0.0] * (count + 1), [0.0] * (count + 1)
    if count == 0:
        return harmony, timbre
    z = _standardized(np.asarray(mfcc, dtype=float).reshape(count, -1))
    similarities = (
        (
            _cosine_similarity(np.asarray(chroma, dtype=float).reshape(count, -1)),
            harmony,
        ),
        (
            np.exp(
                -np.square(z[:, None, :] - z[None, :, :]).sum(axis=2)
                / (2.0 * z.shape[1])
            ),
            timbre,
        ),
    )
    for boundary in range(KERNEL_BARS, count - KERNEL_BARS + 1):
        if gaps[boundary]:
            continue
        before = [b for b in range(boundary - KERNEL_BARS, boundary) if not gaps[b]]
        after = [b for b in range(boundary, boundary + KERNEL_BARS) if not gaps[b]]
        if not before or not after:
            continue
        for similarity, out in similarities:
            within = (
                similarity[np.ix_(before, before)].mean()
                + similarity[np.ix_(after, after)].mean()
            ) / 2.0
            across = similarity[np.ix_(before, after)].mean()
            out[boundary] = max(0.0, float(within - across))
    return harmony, timbre


def extra_terms(
    variant: str, chroma: np.ndarray, mfcc: np.ndarray, gaps: list[bool]
) -> tuple[list[float], list[float]]:
    """Unweighted harmony and timbre per bar boundary for a variant."""
    if variant == "A":
        from crate.smart_mix import structure

        return structure._harmony_timbre(chroma, mfcc, gaps)
    if variant == "B":
        return foote_terms(chroma, mfcc, gaps)
    raise ValueError(f"unknown variant {variant!r}")


def combined_novelty(
    base: Sequence[float],
    harmony: Sequence[float],
    timbre: Sequence[float],
    harmony_weight: float,
    timbre_weight: float,
) -> list[float]:
    return [
        value + harmony_weight * h + timbre_weight * t
        for value, h, t in zip(base, harmony, timbre, strict=True)
    ]


def _floats(text: str) -> list[float]:
    return [float(value) for value in text.split(",") if value.strip()]


def evaluate(
    features: Path,
    allin1: Path,
    out: Path,
    *,
    harmony_weights: Sequence[float],
    timbre_weights: Sequence[float],
    costs: Sequence[float],
) -> dict[str, Any]:
    from crate.smart_mix import structure

    prepared = []
    for index, path in enumerate(sorted(features.glob("*.npz"))):
        reference_path = allin1 / f"{path.stem}.json"
        if not reference_path.exists():
            continue
        reference = section_intervals(json.loads(reference_path.read_text()))
        data = dict(np.load(path))
        music = [bool(m) for m in data["music"]]
        indices = [i for i, is_music in enumerate(music) if is_music]
        if (
            not indices
            or indices[-1] + 1 - indices[0] < structure.MIN_STRUCTURE_BARS
            or len(reference) < 2
        ):
            continue
        first, last = indices[0], indices[-1] + 1
        gaps = structure._gaps(music[first:last])
        levels = [float(x) for x in data["levels"][first:last]]
        shapes = [tuple(float(v) for v in row) for row in data["shapes"][first:last]]
        # Zero chroma and MFCC give no harmony or timbre: the v7 novelty.
        base = structure._novelty(
            levels,
            shapes,
            gaps,
            np.zeros((len(levels), 12)),
            np.zeros((len(levels), structure.MFCC_COEFFICIENTS)),
        )
        span = [
            structure._Bar(int(b), int(s), int(e))
            for b, s, e in zip(
                data["start_beat"][first:last],
                data["start_ms"][first:last],
                data["end_ms"][first:last],
            )
        ]
        terms = {
            variant: extra_terms(
                variant, data["chroma"][first:last], data["mfcc"][first:last], gaps
            )
            for variant in VARIANTS
        }
        bar = float(np.median(data["end_ms"] - data["start_ms"])) / 1000
        split = "held" if index % 2 else "tune"
        prepared.append((split, reference, gaps, base, span, terms, bar))

    variants = [("base", 0.0, 0.0, cost) for cost in costs]
    for variant in VARIANTS:
        for harmony_weight in harmony_weights:
            for timbre_weight in timbre_weights:
                if harmony_weight or timbre_weight:
                    variants += [
                        (variant, harmony_weight, timbre_weight, cost) for cost in costs
                    ]
    saved_cost = structure.BOUNDARY_COST_DB
    results: dict[str, Any] = {}
    try:
        for variant, harmony_weight, timbre_weight, cost in variants:
            structure.BOUNDARY_COST_DB = cost
            scores: dict[str, list] = {"tune": [], "held": []}
            for split, reference, gaps, base, span, terms, bar in prepared:
                novelty = base
                if variant != "base":
                    harmony, timbre = terms[variant]
                    novelty = combined_novelty(
                        base, harmony, timbre, harmony_weight, timbre_weight
                    )
                starts, _confidence = structure._best_grid(
                    novelty, structure._peaks(novelty, gaps), span
                )
                if len(starts) < 2:
                    continue
                edges = [
                    span[i].start_ms / 1000 if i < len(span) else span[-1].end_ms / 1000
                    for i in starts
                ]
                estimate = np.array(list(zip(edges, edges[1:])), dtype=float)
                scores[split].append(
                    [
                        detection(reference, estimate, window)
                        for window in (0.5, 3.0, bar)
                    ]
                )
            summary: dict[str, Any] = {}
            for split, rows in scores.items():
                summary[split] = {
                    name: [
                        round(float(np.mean([row[k][i] for row in rows])), 4)
                        if rows
                        else math.nan
                        for i in range(3)
                    ]
                    for k, name in enumerate(WINDOW_NAMES)
                }
                summary[split]["tracks"] = len(rows)
            results[f"{variant}:{harmony_weight}:{timbre_weight}:{cost}"] = summary
    finally:
        structure.BOUNDARY_COST_DB = saved_cost
    out.write_text(json.dumps(results, indent=1))
    return results


def best_variants(results: dict[str, Any], base_key: str, count: int = 6) -> list[str]:
    """Variants whose tuning precision at 3 s is not below the base's, by tuning F1."""
    base = results[base_key]["tune"]["3s"]
    eligible = [
        key
        for key in results
        if key != base_key and results[key]["tune"]["3s"][0] >= base[0]
    ]
    return sorted(
        eligible, key=lambda key: results[key]["tune"]["3s"][2], reverse=True
    )[:count]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    commands = parser.add_subparsers(dest="command", required=True)
    extract_parser = commands.add_parser("extract", help="save per-bar features")
    extract_parser.add_argument("analysis", type=Path, help="analyzer records")
    extract_parser.add_argument("features", type=Path, help="feature folder")
    evaluate_parser = commands.add_parser("evaluate", help="sweep the variants")
    evaluate_parser.add_argument("features", type=Path)
    evaluate_parser.add_argument("allin1", type=Path)
    evaluate_parser.add_argument("out", type=Path, help="results JSON")
    evaluate_parser.add_argument("--harmony-weights", default="0,1,2,4,6,8,12")
    evaluate_parser.add_argument("--timbre-weights", default="0,1,2,4,6,8,12")
    evaluate_parser.add_argument(
        "--costs", default="1,4", help="boundary costs in dB (v7 used 1, SM3-D17 4)"
    )
    args = parser.parse_args()
    if args.command == "extract":
        extract(args.analysis, args.features)
        return 0
    costs = _floats(args.costs)
    results = evaluate(
        args.features,
        args.allin1,
        args.out,
        harmony_weights=_floats(args.harmony_weights),
        timbre_weights=_floats(args.timbre_weights),
        costs=costs,
    )
    base_key = f"base:0.0:0.0:{costs[0]}"
    print("base", base_key, results[base_key])
    for key in best_variants(results, base_key):
        print(key, results[key])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

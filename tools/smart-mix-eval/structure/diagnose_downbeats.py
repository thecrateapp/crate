#!/usr/bin/env python3
"""Why do phrase boundaries miss All-In-One's sections? A per-track downbeat diagnosis.

The diagnosis behind SM3-D14. For every phrase-mixed track with phrases and an
All-In-One result it prints:

- the bar length against All-In-One's (median downbeat gap), to catch half or double
  tempo;
- where the phrase boundaries fall on All-In-One's downbeat grid (fraction of a bar);
- the signed offset, in bars, from each All-In-One section boundary to the nearest
  phrase boundary;
- the section recall within one bar, and the recall of the same boundaries shifted at
  random (chance level);
- which beat of the bar the boundaries land on according to All-In-One and to madmom,
  and how the three opinions vote;
- with ``--beat-this``, on the tracks where All-In-One and madmom agree (the arbiter),
  whether the boundaries and the Beat This! downbeats hit the reference, and whether
  keeping the phrase grid but taking the bar phase from Beat This! would.

The phrases are the baseline's (``--baseline``), or with ``--analysis`` those of the
analyzer records. Needs ``numpy`` only.
"""

from __future__ import annotations

import argparse
import random
import statistics
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from structure_eval import (
    AGREEMENT_SHARE,
    BOUNDARY_TOLERANCE_S,
    CROSSFADE_GENRES,
    BaselineTrack,
    bar_seconds,
    baseline_intervals,
    interval_boundaries,
    load_baseline,
    madmom_downbeat_times,
    model_downbeat_times,
    phrase_intervals,
    read_json_dir,
    section_changes,
    shared,
)

CHANCE_SHIFTS = 50
OFFSET_LIMIT_BARS = 9


@dataclass(frozen=True)
class Estimate:
    stem: str
    genre: str
    boundaries: list[float]
    bar: float
    phrase_bars: list[int]
    confidence: float | None


def baseline_estimates(baseline: Mapping[str, BaselineTrack]) -> list[Estimate]:
    return [
        Estimate(
            stem=stem,
            genre=track.genre,
            boundaries=interval_boundaries(baseline_intervals(track.phrases)),
            bar=track.bar_seconds() or 0.0,
            phrase_bars=[phrase.bars for phrase in track.phrases],
            confidence=track.confidence,
        )
        for stem, track in baseline.items()
        if track.phrases
    ]


def analysis_estimates(
    records: Mapping[str, Mapping[str, Any]], baseline: Mapping[str, BaselineTrack]
) -> list[Estimate]:
    estimates = []
    for stem, record in records.items():
        profile = record.get("rust") or {}
        intervals = phrase_intervals(profile)
        if not len(intervals):
            continue
        known = baseline.get(stem)
        estimates.append(
            Estimate(
                stem=stem,
                genre=known.genre if known else "?",
                boundaries=interval_boundaries(intervals),
                bar=bar_seconds(profile),
                phrase_bars=[phrase["bars"] for phrase in profile["phrases"]],
                confidence=None,
            )
        )
    return estimates


def recall(
    reference: Sequence[float], ours: Sequence[float], tolerance: float
) -> float:
    return sum(
        1 for b in reference if any(abs(b - o) <= tolerance for o in ours)
    ) / len(reference)


def nearest(values: Sequence[float], time: float) -> int:
    return min(range(len(values)), key=lambda index: abs(values[index] - time))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    parser.add_argument("--allin1", type=Path, required=True)
    parser.add_argument("--madmom", type=Path, action="append", default=[])
    parser.add_argument(
        "--beat-this", type=Path, help="Beat This! records (beat_this_beats.py)"
    )
    parser.add_argument("--baseline", type=Path, action="append", default=[])
    parser.add_argument("--tracks", type=Path, action="append", default=[])
    parser.add_argument("--analysis", type=Path, help="diagnose these records instead")
    parser.add_argument("--seed", type=int, default=7, help="seed of the chance shifts")
    args = parser.parse_args()

    allin1 = read_json_dir(args.allin1)
    baseline = load_baseline(args.baseline, args.tracks)
    estimates = (
        analysis_estimates(read_json_dir(args.analysis), baseline)
        if args.analysis
        else baseline_estimates(baseline)
    )
    madmom: dict[str, list[tuple[float, int]]] = {}
    for folder in args.madmom:
        for stem, record in read_json_dir(folder).items():
            madmom[stem] = [(float(t), int(p)) for t, p in record["beats"]]
    rng = random.Random(args.seed)
    ratios, phases, offsets, lengths = Counter(), Counter(), Counter(), Counter()
    real, chance = [], []
    landed: list[tuple[Estimate, int, float, Mapping[str, Any]]] = []
    print(
        f"{'track':40} {'bpm':>6} {'ratio':>5} {'phase':>5} {'recall':>6} {'chance':>6}"
        "  offsets (bars)"
    )
    for estimate in sorted(estimates, key=lambda e: e.stem):
        result = allin1.get(estimate.stem)
        if result is None or estimate.genre in CROSSFADE_GENRES:
            continue
        reference, _label_changes = section_changes(result)
        downbeats = result["downbeats"]
        if not reference or len(downbeats) < 2:
            continue
        reference_bar = statistics.median(
            b - a for a, b in zip(downbeats, downbeats[1:])
        )
        ratio = estimate.bar / reference_bar
        ratios[round(ratio, 1)] += 1
        lengths.update(estimate.phrase_bars)
        ours = estimate.boundaries
        track_phases = [
            round((o - downbeats[nearest(downbeats, o)]) / reference_bar, 1)
            for o in ours
        ]
        phases.update(track_phases)
        beats, positions = result["beats"], result["beat_positions"]
        position, hits = Counter(
            positions[nearest(beats, o)] for o in ours
        ).most_common(1)[0]
        landed.append((estimate, position, hits / len(ours), result))
        signed = [
            round((ours[nearest(ours, b)] - b) / reference_bar) for b in reference
        ]
        offsets.update(
            max(-OFFSET_LIMIT_BARS, min(OFFSET_LIMIT_BARS, s)) for s in signed
        )
        duration = ours[-1]
        shifted = []
        for _ in range(CHANCE_SHIFTS):
            shift = rng.uniform(0, duration)
            moved = [(o + shift) % duration for o in ours]
            shifted.append(recall(reference, moved, estimate.bar))
        real.append(recall(reference, ours, estimate.bar))
        chance.append(statistics.mean(shifted))
        print(
            f"{estimate.stem[:40]:40} {result['bpm']:>6} {ratio:>5.2f} "
            f"{statistics.median(abs(p) for p in track_phases):>5.2f} {real[-1]:>6.0%} "
            f"{chance[-1]:>6.0%}  {signed}"
        )
    if not real:
        print("No track with phrases and an All-In-One result.")
        return 1
    print()
    print(
        f"tracks {len(real)} · mean recall {statistics.mean(real):.0%} · "
        f"mean chance {statistics.mean(chance):.0%}"
    )
    print("bar ratio, ours / All-In-One:", dict(sorted(ratios.items())))
    print(
        "boundary phase on All-In-One's downbeats (bars):", dict(sorted(phases.items()))
    )
    print(
        f"signed offset from each section boundary to ours (bars, ±{OFFSET_LIMIT_BARS} "
        "= more):",
        dict(sorted(offsets.items())),
    )
    print("phrase lengths (bars):", dict(sorted(lengths.items())))
    print()
    print("Beat of the bar our boundaries land on (1 = downbeat), by All-In-One and by")
    print("madmom; a1~madmom = share of All-In-One's downbeats madmom also marks 1:")
    votes: Counter[tuple[bool, bool, bool]] = Counter()
    for estimate, position, share, result in sorted(
        landed, key=lambda row: (row[1], row[0].stem)
    ):
        extra = ""
        beats = madmom.get(estimate.stem)
        if beats:
            times = [t for t, _p in beats]

            def madmom_position(time: float, beats=beats, times=times) -> int:
                return beats[nearest(times, time)][1]

            mm_position, mm_hits = Counter(
                madmom_position(o) for o in estimate.boundaries
            ).most_common(1)[0]
            a1_down = [
                b for b, p in zip(result["beats"], result["beat_positions"]) if p == 1
            ]
            agreement = sum(1 for b in a1_down if madmom_position(b) == 1) / max(
                1, len(a1_down)
            )
            extra = (
                f"  madmom {mm_position} ({mm_hits / len(estimate.boundaries):.0%})"
                f"  a1~madmom {agreement:.0%}"
            )
            votes[(position == 1, mm_position == 1, agreement >= 0.5)] += 1
        confidence = (
            f"{estimate.confidence:.2f}" if estimate.confidence is not None else "  — "
        )
        print(
            f"  All-In-One {position} ({share:.0%})  conf {confidence}{extra}  "
            f"{estimate.stem[:40]}"
        )
    agree = sum(1 for _e, position, _s, _r in landed if position == 1)
    print(f"on All-In-One's downbeat in {agree}/{len(landed)} tracks")
    labels = {
        (True, True, True): "all three agree",
        (False, False, True): "All-In-One and madmom against us",
        (True, False, False): "us and All-In-One against madmom",
        (False, True, False): "us and madmom against All-In-One",
    }
    for key, count in votes.most_common():
        print(f"  {labels.get(key, f'no majority {key}')}: {count}")
    if args.beat_this:
        beat_this_vote(landed, madmom, read_json_dir(args.beat_this))
    return 0


def beat_this_vote(
    landed: Sequence[tuple[Estimate, int, float, Mapping[str, Any]]],
    madmom: Mapping[str, Sequence[tuple[float, int]]],
    beat_this: Mapping[str, Mapping[str, Any]],
) -> None:
    """On arbiter tracks: do our boundaries and Beat This! hit the reference downbeats?"""
    print()
    print("Arbiter = All-In-One and madmom share ≥90 % of their downbeats.")
    print("Ours against Beat This! on the arbiter's downbeats (≥90 % = right):")
    consensus = ours_ok = model_ok = both = phase_ok = 0
    for estimate, _position, _share, result in sorted(landed, key=lambda r: r[0].stem):
        stem = estimate.stem
        if stem not in madmom or stem not in beat_this:
            continue
        a1_down = [
            b for b, p in zip(result["beats"], result["beat_positions"]) if p == 1
        ]
        mm_down = madmom_downbeat_times({"beats": madmom[stem]})
        model_down = model_downbeat_times(beat_this[stem])
        a1_mm = shared(a1_down, mm_down)
        a1_model = shared(a1_down, model_down)
        ours = estimate.boundaries
        ours_hit = shared(ours, a1_down, BOUNDARY_TOLERANCE_S)
        # Keep our beat grid, let Beat This! pick which of every four beats is the one.
        beat = estimate.bar / 4
        moved = max(
            ([o + k * beat for o in ours] for k in range(4)),
            key=lambda shifted: shared(shifted, model_down, BOUNDARY_TOLERANCE_S),
        )
        phase_hit = shared(moved, a1_down, BOUNDARY_TOLERANCE_S)
        status = "arbiter" if a1_mm >= AGREEMENT_SHARE else "no arbiter"
        print(
            f"  {status:10} a1~mm {a1_mm:4.0%}  a1~beat-this {a1_model:4.0%}  ours on a1 "
            f"downbeats {ours_hit:4.0%}  with the Beat This! phase {phase_hit:4.0%}  "
            f"{stem[:40]}"
        )
        if a1_mm >= AGREEMENT_SHARE:
            consensus += 1
            ours_ok += ours_hit >= AGREEMENT_SHARE
            model_ok += a1_model >= AGREEMENT_SHARE
            both += ours_hit >= AGREEMENT_SHARE and a1_model >= AGREEMENT_SHARE
            phase_ok += phase_hit >= AGREEMENT_SHARE
    print(
        f"Arbiter tracks: {consensus} · ours right {ours_ok} · Beat This! right "
        f"{model_ok} · both {both} · our grid with the Beat This! phase right {phase_ok}"
    )


if __name__ == "__main__":
    raise SystemExit(main())

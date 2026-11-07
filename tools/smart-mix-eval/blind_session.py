"""Blind A/B listening session over rendered transition pairs (SM0.PR2, SG3).

Each pair has two renders of the same edge (for example ``smart-mix-v3`` and
``smart-mix-v3`` plus AI). The session shuffles the pairs and which render is
A or B, plays both, asks for a 1-5 rating of each and appends them to
``ratings.csv`` without the labels. When every pair is rated it writes the
labels into the CSV and prints the summary: mean rating, wins, ties, losses
and the worst rating per label. SG3 asks the AI to win or tie in at least
60 % of the pairs with no render rated below 2.

The order comes from ``--seed``, so an interrupted session resumes where it
stopped. Do not open ``ratings.csv`` before the end: the labels are only
written then.

manifest.json (paths relative to it):

    {"pairs": [{"pair": "e0001",
                "renders": {"smart-mix-v3": "v3/e0001.wav",
                            "smart-mix-v3-ai": "ai/e0001.wav"}}]}

usage:
    blind_session.py --manifest manifest.json --ratings ratings.csv [--seed sg3]
"""

from __future__ import annotations

import argparse
import csv
import json
import random
import shlex
import subprocess
from collections import defaultdict
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

FIELDS = ("trial", "pair", "slot", "rating", "label")
DEFAULT_PLAYER = "ffplay -nodisp -autoexit -loglevel error"
DEFAULT_SEED = "smart-mix-blind"
REPLAY = "r"


@dataclass(frozen=True, slots=True)
class Pair:
    pair: str
    renders: tuple[tuple[str, Path], tuple[str, Path]]


@dataclass(frozen=True, slots=True)
class Trial:
    index: int
    pair: str
    a: tuple[str, Path]
    b: tuple[str, Path]


def load_manifest(path: Path) -> list[Pair]:
    payload = json.loads(Path(path).read_text())
    base = Path(path).parent
    pairs = []
    for item in payload["pairs"]:
        renders = sorted(item["renders"].items())
        if len(renders) != 2:
            raise ValueError(f"Pair {item['pair']!r} needs exactly two renders")
        resolved = tuple((label, base / render) for label, render in renders)
        for label, render in resolved:
            if not render.is_file():
                raise ValueError(f"Missing render for {item['pair']!r} {label!r}")
        pairs.append(Pair(pair=str(item["pair"]), renders=(resolved[0], resolved[1])))
    return pairs


def shuffle_trials(pairs: Sequence[Pair], seed: str) -> list[Trial]:
    generator = random.Random(seed)
    order = list(pairs)
    generator.shuffle(order)
    trials = []
    for index, pair in enumerate(order, start=1):
        first, second = pair.renders
        if generator.random() < 0.5:
            first, second = second, first
        trials.append(Trial(index=index, pair=pair.pair, a=first, b=second))
    return trials


def run_session(
    trials: Sequence[Trial],
    ratings_path: Path,
    *,
    play: Callable[[Path], Any],
    ask: Callable[[str], str],
    say: Callable[[str], Any] = print,
) -> None:
    """Rate every trial not yet in ``ratings_path``; labels stay hidden."""
    rated = {int(row["trial"]) for row in _read_rows(ratings_path)}
    if not ratings_path.exists():
        _write_rows(ratings_path, [])
    for trial in trials:
        if trial.index in rated:
            continue
        say(f"Pair {trial.index}/{len(trials)}: playing A then B ({REPLAY} replays)")
        _play_pair(trial, play, say)
        ratings = []
        for slot in ("A", "B"):
            ratings.append(_ask_rating(slot, trial, ask, play, say))
        with ratings_path.open("a", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=FIELDS)
            for slot, rating in zip(("A", "B"), ratings, strict=True):
                writer.writerow(
                    {
                        "trial": trial.index,
                        "pair": trial.pair,
                        "slot": slot,
                        "rating": rating,
                        "label": "",
                    }
                )


def reveal(trials: Sequence[Trial], ratings_path: Path) -> list[dict[str, str]]:
    """Write each rating's label into ``ratings_path`` and return the rows."""
    labels = {
        (str(trial.index), slot): label
        for trial in trials
        for slot, (label, _path) in (("A", trial.a), ("B", trial.b))
    }
    rows = [
        {**row, "label": labels[(row["trial"], row["slot"])]}
        for row in _read_rows(ratings_path)
    ]
    _write_rows(ratings_path, rows)
    return rows


def summarize_ratings(rows: Iterable[Mapping[str, str]]) -> dict[str, dict[str, Any]]:
    by_pair: dict[str, list[tuple[str, int]]] = defaultdict(list)
    for row in rows:
        by_pair[row["pair"]].append((row["label"], int(row["rating"])))
    totals: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"pairs": 0, "ratings": [], "wins": 0, "ties": 0, "losses": 0}
    )
    for entries in by_pair.values():
        if len(entries) != 2:
            continue
        (left_label, left), (right_label, right) = entries
        for label, own, other in (
            (left_label, left, right),
            (right_label, right, left),
        ):
            total = totals[label]
            total["pairs"] += 1
            total["ratings"].append(own)
            outcome = "wins" if own > other else "ties" if own == other else "losses"
            total[outcome] += 1
    return {
        label: {
            "pairs": total["pairs"],
            "mean": round(sum(total["ratings"]) / len(total["ratings"]), 4),
            "wins": total["wins"],
            "ties": total["ties"],
            "losses": total["losses"],
            "winOrTieRate": round((total["wins"] + total["ties"]) / total["pairs"], 4),
            "worst": min(total["ratings"]),
        }
        for label, total in sorted(totals.items())
    }


def _play_pair(trial: Trial, play: Callable[[Path], Any], say: Callable[[str], Any]):
    say("A")
    play(trial.a[1])
    say("B")
    play(trial.b[1])


def _ask_rating(
    slot: str,
    trial: Trial,
    ask: Callable[[str], str],
    play: Callable[[Path], Any],
    say: Callable[[str], Any],
) -> int:
    while True:
        answer = ask(f"Rating for {slot} (1-5): ").strip().lower()
        if answer == REPLAY:
            _play_pair(trial, play, say)
            continue
        if answer in {"1", "2", "3", "4", "5"}:
            return int(answer)
        say("Answer 1, 2, 3, 4 or 5")


def _read_rows(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(newline="") as handle:
        return list(csv.DictReader(handle))


def _write_rows(path: Path, rows: Iterable[Mapping[str, Any]]) -> None:
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--ratings", type=Path, required=True)
    parser.add_argument("--seed", default=DEFAULT_SEED)
    parser.add_argument("--player", default=DEFAULT_PLAYER)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    # TEST_GAP: playback through an external player and the terminal prompt
    # need a person; the session logic is tested with scripted answers.
    args = parse_args(argv)
    trials = shuffle_trials(load_manifest(args.manifest), args.seed)
    player = shlex.split(args.player)

    def play(path: Path) -> None:
        subprocess.run([*player, str(path)], check=False)

    run_session(trials, args.ratings, play=play, ask=input)
    rows = reveal(trials, args.ratings)
    print(json.dumps(summarize_ratings(rows), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

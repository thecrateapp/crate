from __future__ import annotations

import csv
import json
from pathlib import Path

import pytest

from blind_session import (
    load_manifest,
    reveal,
    run_session,
    shuffle_trials,
    summarize_ratings,
)


def _manifest(tmp_path: Path, count: int = 4) -> Path:
    pairs = []
    for index in range(count):
        for label in ("v3", "v3-ai"):
            (tmp_path / f"e{index}-{label}.wav").write_bytes(b"RIFF")
        pairs.append(
            {
                "pair": f"e{index:04d}",
                "renders": {
                    "v3": f"e{index}-v3.wav",
                    "v3-ai": f"e{index}-v3-ai.wav",
                },
            }
        )
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps({"pairs": pairs}))
    return path


class _Script:
    def __init__(self, answers: list[str]) -> None:
        self.answers = list(answers)
        self.prompts: list[str] = []

    def __call__(self, prompt: str) -> str:
        self.prompts.append(prompt)
        if not self.answers:
            raise EOFError
        return self.answers.pop(0)


def _rows(path: Path) -> list[dict[str, str]]:
    with path.open(newline="") as handle:
        return list(csv.DictReader(handle))


def test_load_manifest_resolves_paths_next_to_it(tmp_path: Path) -> None:
    pairs = load_manifest(_manifest(tmp_path, count=1))

    assert pairs[0].pair == "e0000"
    assert pairs[0].renders == (
        ("v3", tmp_path / "e0-v3.wav"),
        ("v3-ai", tmp_path / "e0-v3-ai.wav"),
    )


def test_load_manifest_requires_two_existing_renders(tmp_path: Path) -> None:
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps({"pairs": [{"pair": "x", "renders": {"a": "a.wav"}}]}))

    with pytest.raises(ValueError, match="two renders"):
        load_manifest(path)


def test_shuffle_trials_is_seeded_and_swaps_sides(tmp_path: Path) -> None:
    pairs = load_manifest(_manifest(tmp_path, count=12))

    first = shuffle_trials(pairs, seed="sg3")
    again = shuffle_trials(pairs, seed="sg3")
    other = shuffle_trials(pairs, seed="other")

    assert first == again
    assert [trial.pair for trial in first] != [trial.pair for trial in other]
    assert {trial.a[0] for trial in first} == {"v3", "v3-ai"}
    assert sorted(trial.pair for trial in first) == [pair.pair for pair in pairs]


def test_session_writes_ratings_blind_and_reveals_at_the_end(tmp_path: Path) -> None:
    trials = shuffle_trials(load_manifest(_manifest(tmp_path)), seed="sg3")
    ratings = tmp_path / "ratings.csv"
    played: list[Path] = []
    printed: list[str] = []
    ask = _Script(["4", "2", "r", "3", "3", "x", "5", "1", "2", "4"])

    run_session(trials, ratings, play=played.append, ask=ask, say=printed.append)

    blind_rows = _rows(ratings)
    assert [row["rating"] for row in blind_rows] == [
        "4",
        "2",
        "3",
        "3",
        "5",
        "1",
        "2",
        "4",
    ]
    assert all(row["label"] == "" for row in blind_rows)
    transcript = "\n".join(printed + ask.prompts)
    assert "v3" not in transcript
    # Each trial plays A then B; "r" replays the pair once more.
    assert len(played) == 2 * len(trials) + 2

    revealed = reveal(trials, ratings)

    assert [row["label"] for row in _rows(ratings)] == [
        label for trial in trials for label in (trial.a[0], trial.b[0])
    ]
    assert len(revealed) == 8


def test_session_resumes_after_an_interruption(tmp_path: Path) -> None:
    trials = shuffle_trials(load_manifest(_manifest(tmp_path)), seed="sg3")
    ratings = tmp_path / "ratings.csv"

    with pytest.raises(EOFError):
        run_session(
            trials,
            ratings,
            play=lambda _path: None,
            ask=_Script(["4", "2", "3"]),
            say=lambda _text: None,
        )
    assert len(_rows(ratings)) == 2

    run_session(
        trials,
        ratings,
        play=lambda _path: None,
        ask=_Script(["3", "3", "5", "1", "2", "4"]),
        say=lambda _text: None,
    )

    assert [row["trial"] for row in _rows(ratings)] == [
        "1",
        "1",
        "2",
        "2",
        "3",
        "3",
        "4",
        "4",
    ]


def test_summarize_ratings_counts_wins_ties_and_worst() -> None:
    rows = [
        {"trial": "1", "pair": "e1", "slot": "A", "rating": "4", "label": "ai"},
        {"trial": "1", "pair": "e1", "slot": "B", "rating": "3", "label": "v3"},
        {"trial": "2", "pair": "e2", "slot": "A", "rating": "3", "label": "v3"},
        {"trial": "2", "pair": "e2", "slot": "B", "rating": "3", "label": "ai"},
        {"trial": "3", "pair": "e3", "slot": "A", "rating": "1", "label": "ai"},
        {"trial": "3", "pair": "e3", "slot": "B", "rating": "4", "label": "v3"},
    ]

    summary = summarize_ratings(rows)

    assert summary["ai"] == {
        "pairs": 3,
        "mean": pytest.approx(8 / 3, abs=1e-4),
        "wins": 1,
        "ties": 1,
        "losses": 1,
        "winOrTieRate": pytest.approx(2 / 3, abs=1e-4),
        "worst": 1,
    }
    assert summary["v3"]["wins"] == 1 and summary["v3"]["worst"] == 3

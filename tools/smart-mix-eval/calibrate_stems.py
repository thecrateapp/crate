"""Calibrate the presence cuts of the stems layer (Smart Mix Stems ST3, design §5).

A phrase has a stem when its mean level byte is at least the stem's floor and within
the stem's drop of the track's loudest phrase of that stem
(``crate.smart_mix.stems.PresenceCut``). This tool measures where to put both:

- **Vocals**, against the SG1b lyrics labels (LRCLIB synced lyrics: a phrase has voice
  when the lyrics cover a quarter of it, none when they do not touch it). Each
  ``(floor, drop)`` of a grid is scored by balanced accuracy, chosen on four folds of
  tracks and measured on the fifth, as SG1b chose YAMNet's cut; per genre it is set
  against YAMNet's stored byte (``VOCAL_THRESHOLD``) on the same phrases.
- **Bass and drums** have no labels. The tool reports, per stem, the distribution of
  each phrase's level below the track's loudest phrase and of the loudest phrase
  itself, their valleys, and, for each drop of a grid, the share of phrases marked
  present by phrase kind (a peak should have drums and bass, a break or an intro
  often lacks one) and by genre bucket.

Phrases come from the labels (the lyrics set) and, with ``--dataset``, from the
stored profiles of an evaluation set (read-only), whose layer the planner reads
(``stem_phrase_layer``). Analyses are those ``separate_pool.py`` wrote, bound to a
profile by entity UID and duration as ``run_eval.py --stems`` binds them.

usage:
    calibrate_stems.py --stems out/st3/stems/lyrics --labels labels.csv \\
        [--yamnet phrase_windows.csv] \\
        [--stems out/st3/stems/electronic --dataset out/electronic/dataset.jsonl \\
         --groups out/electronic/pool/groups.tsv] --output out/st3/calibration
"""

from __future__ import annotations

import argparse
import csv
import math
import sys
from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from common import (
    ensure_app_on_path,
    git_commit,
    open_read_only_database,
    read_jsonl,
    resolve_dsn,
    write_json,
)

ensure_app_on_path()

from crate.smart_mix.models import VOCAL_LOG_FLOOR, VOCAL_THRESHOLD  # noqa: E402
from crate.smart_mix.stems import (  # noqa: E402
    STEM_PRESENCE_CUTS,
    StemAnalysis,
    duration_matches,
    span_mean_byte,
    stem_phrase_layer,
)

BYTES_PER_DB = 255.0 / 60.0
FOLDS = 5
STEMS = ("vocals", "bass", "drums")
# The grid: floors every byte from -50 to -10 dBFS, drops every 3 dB to 36 dB and
# "none" (only the floor).
FLOORS = tuple(range(42, 213))
DROPS = (*(round(db * BYTES_PER_DB) for db in range(3, 37, 3)), 255)
REPORT_DROPS_DB = (6, 9, 12, 15, 18, 24)


@dataclass(frozen=True, slots=True)
class PhraseRow:
    """One phrase: its stem means, its track's loudest phrases, a label or a kind."""

    entity_uid: str
    genre: str
    means: Mapping[str, int]
    loudest: Mapping[str, int]
    label: int | None = None
    kind: str | None = None
    yamnet: int | None = None
    source: str = "lyrics"


# --- pure measurements ---------------------------------------------------------------


def present(level: int, loudest: int, floor: int, drop: int) -> bool:
    return level >= floor and level >= loudest - drop


def confusion(pairs: Iterable[tuple[bool, int]]) -> dict[str, Any]:
    """Precision, recall, specificity, balanced accuracy and F1 of (predicted, label)."""
    counts = Counter((bool(predicted), int(label)) for predicted, label in pairs)
    tp, fp = counts[(True, 1)], counts[(True, 0)]
    fn, tn = counts[(False, 1)], counts[(False, 0)]
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    specificity = tn / (tn + fp) if tn + fp else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {
        "n": tp + fp + fn + tn,
        "positives": tp + fn,
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "specificity": round(specificity, 4),
        "balancedAccuracy": round((recall + specificity) / 2, 4),
        "f1": round(f1, 4),
    }


def fit_cut(
    rows: Sequence[PhraseRow],
    stem: str,
    *,
    floors: Sequence[int] = FLOORS,
    drops: Sequence[int] = DROPS,
) -> tuple[int, int]:
    """The (floor, drop) with the best balanced accuracy on labelled rows; ties keep
    the better F1, then the wider drop (the simpler rule) and the lower floor."""
    labelled = [row for row in rows if row.label is not None]
    best: tuple[tuple[float, float, int, int], tuple[int, int]] | None = None
    for drop in drops:
        for floor in floors:
            scores = confusion(
                (
                    present(row.means[stem], row.loudest[stem], floor, drop),
                    int(row.label or 0),
                )
                for row in labelled
            )
            key = (scores["balancedAccuracy"], scores["f1"], drop, -floor)
            if best is None or key > best[0]:
                best = (key, (floor, drop))
    if best is None:
        raise ValueError("no labelled phrases")
    return best[1]


def fold_of(entity_uid: str, folds: int = FOLDS) -> int:
    """SG1b's deterministic fold: the UID's leading hex digits."""
    return int(entity_uid.replace("-", "")[:8], 16) % folds


def cross_validate(
    rows: Sequence[PhraseRow], stem: str, *, folds: int = FOLDS
) -> dict[str, Any]:
    """The cut chosen on all folds but one, measured on that one; then on all rows."""
    labelled = [row for row in rows if row.label is not None]
    results = []
    for fold in range(folds):
        train = [row for row in labelled if fold_of(row.entity_uid, folds) != fold]
        test = [row for row in labelled if fold_of(row.entity_uid, folds) == fold]
        if not train or not test:
            continue
        floor, drop = fit_cut(train, stem)
        results.append(
            {
                "fold": fold,
                "floor": floor,
                "drop": drop,
                **confusion(
                    (
                        present(row.means[stem], row.loudest[stem], floor, drop),
                        int(row.label or 0),
                    )
                    for row in test
                ),
            }
        )
    floor, drop = fit_cut(labelled, stem)
    keys = ("precision", "recall", "specificity", "balancedAccuracy", "f1")
    return {
        "folds": results,
        "cv": {
            key: round(sum(r[key] for r in results) / len(results), 4) for key in keys
        }
        if results
        else None,
        "all": {
            "floor": floor,
            "drop": drop,
            **confusion(
                (
                    present(row.means[stem], row.loudest[stem], floor, drop),
                    int(row.label or 0),
                )
                for row in labelled
            ),
        },
    }


def histogram(values: Iterable[float], *, width: float) -> dict[str, int]:
    counts: Counter[float] = Counter()
    for value in values:
        counts[math.floor(value / width) * width] += 1
    return {f"{key:g}": counts[key] for key in sorted(counts)}


def valley(values: Sequence[float], *, width: float) -> float | None:
    """The emptiest bin between the two highest modes of a smoothed histogram."""
    if len(values) < 10:
        return None
    low = math.floor(min(values) / width)
    high = math.floor(max(values) / width)
    counts = [0] * (high - low + 1)
    for value in values:
        counts[math.floor(value / width) - low] += 1
    smooth = [
        (counts[max(0, i - 1)] + 2 * counts[i] + counts[min(len(counts) - 1, i + 1)])
        / 4
        for i in range(len(counts))
    ]
    peaks = [
        i
        for i in range(len(smooth))
        if smooth[i] > 0
        and (i == 0 or smooth[i] >= smooth[i - 1])
        and (i == len(smooth) - 1 or smooth[i] >= smooth[i + 1])
    ]
    if len(peaks) < 2:
        return None
    first, second = sorted(sorted(peaks, key=lambda i: smooth[i])[-2:])
    if second - first < 2:
        return None
    lowest = min(range(first + 1, second), key=lambda i: smooth[i])
    return (lowest + low + 0.5) * width


def yamnet_byte(scores: Sequence[float]) -> int:
    """``crate.smart_mix.vocals.phrase_vocal_presence`` of one phrase's patch scores."""
    if not scores:
        return 0
    floor = math.log10(VOCAL_LOG_FLOOR)
    logs = [math.log10(max(float(score), VOCAL_LOG_FLOOR)) for score in scores]
    level = (sum(logs) / len(logs) - floor) / -floor
    return round(255 * min(1.0, max(0.0, level)))


# --- inputs -------------------------------------------------------------------------


def label_rows(
    labels: Sequence[Mapping[str, str]],
    analyses: Mapping[str, StemAnalysis],
    yamnet: Mapping[tuple[str, int], int] | None = None,
) -> list[PhraseRow]:
    """Labelled phrases of the lyrics set; the loudest phrase is over all of its
    track's labelled phrases, ambiguous ones included."""
    by_track: dict[str, list[Mapping[str, str]]] = defaultdict(list)
    for row in labels:
        by_track[row["entity_uid"]].append(row)
    rows: list[PhraseRow] = []
    for uid, phrases in sorted(by_track.items()):
        analysis = analyses.get(uid)
        if analysis is None:
            continue
        means = []
        for phrase in phrases:
            spans = {
                stem: span_mean_byte(
                    getattr(analysis.levels, stem),
                    int(phrase["start_ms"]),
                    int(phrase["end_ms"]),
                    analysis.hop_ms,
                )
                for stem in STEMS
            }
            means.append(spans)
        valid = [m for m in means if all(v is not None for v in m.values())]
        if not valid:
            continue
        loudest = {stem: max(int(m[stem] or 0) for m in valid) for stem in STEMS}
        for phrase, mean in zip(phrases, means, strict=True):
            if any(value is None for value in mean.values()):
                continue
            label = phrase.get("label", "").strip()
            rows.append(
                PhraseRow(
                    entity_uid=uid,
                    genre=phrase.get("genre") or "?",
                    means={stem: int(mean[stem] or 0) for stem in STEMS},
                    loudest=loudest,
                    label=int(label) if label in ("0", "1") else None,
                    yamnet=(yamnet or {}).get((uid, int(phrase["phrase_index"]))),
                )
            )
    return rows


def profile_rows(
    profiles: Mapping[str, Any],
    analyses: Mapping[str, StemAnalysis],
    groups: Mapping[str, str],
    *,
    source: str,
) -> list[PhraseRow]:
    """Phrases of an evaluation set's stored profiles, as the planner's layer reads
    them, with their kind."""
    rows: list[PhraseRow] = []
    for uid, profile in sorted(profiles.items()):
        analysis = analyses.get(uid)
        if profile is None or analysis is None or not profile.phrases:
            continue
        if not duration_matches(analysis.duration_ms, profile.duration_ms):
            continue
        bound = analysis.model_copy(update={"source_revision": profile.source_revision})
        layer = stem_phrase_layer(profile, bound)
        if layer is None:
            continue
        loudest = {
            stem: max(getattr(entry, stem) for entry in layer.phrases) for stem in STEMS
        }
        for phrase, entry in zip(profile.phrases, layer.phrases, strict=True):
            rows.append(
                PhraseRow(
                    entity_uid=uid,
                    genre=groups.get(uid, source),
                    means={stem: getattr(entry, stem) for stem in STEMS},
                    loudest=loudest,
                    kind=phrase.kind,
                    source=source,
                )
            )
    return rows


def read_yamnet(path: Path) -> dict[tuple[str, int], int]:
    result = {}
    with path.open() as handle:
        for row in csv.DictReader(handle):
            scores = [float(v) for v in (row.get("scores") or "").split(";") if v]
            result[(row["entity_uid"], int(row["phrase_index"]))] = yamnet_byte(scores)
    return result


# --- report -------------------------------------------------------------------------


def unsupervised(rows: Sequence[PhraseRow], stem: str) -> dict[str, Any]:
    tracks = {row.entity_uid: row.loudest[stem] for row in rows}
    relative = [(row.means[stem] - row.loudest[stem]) / BYTES_PER_DB for row in rows]
    loudest_db = [value / BYTES_PER_DB - 60 for value in tracks.values()]
    by_drop = {}
    for drop_db in REPORT_DROPS_DB:
        drop = round(drop_db * BYTES_PER_DB)
        floor = STEM_PRESENCE_CUTS[stem].floor
        by_kind: dict[str, list[bool]] = defaultdict(list)
        by_genre: dict[str, list[bool]] = defaultdict(list)
        for row in rows:
            flag = present(row.means[stem], row.loudest[stem], floor, drop)
            by_kind[row.kind or "lyrics"].append(flag)
            by_genre[row.genre].append(flag)
        by_drop[str(drop_db)] = {
            "byKind": {k: _share(v) for k, v in sorted(by_kind.items())},
            "byGenre": {k: _share(v) for k, v in sorted(by_genre.items())},
        }
    return {
        "phrases": len(rows),
        "tracks": len(tracks),
        "relativeDbHistogram": histogram(relative, width=3),
        "relativeDbValley": valley(relative, width=1.5),
        "loudestDbfsHistogram": histogram(loudest_db, width=3),
        "loudestDbfsValley": valley(loudest_db, width=1.5),
        "presentShareByDrop": by_drop,
    }


def _share(flags: Sequence[bool]) -> dict[str, Any]:
    return {"n": len(flags), "present": round(sum(flags) / len(flags), 3)}


def vocal_report(rows: Sequence[PhraseRow]) -> dict[str, Any]:
    labelled = [row for row in rows if row.label is not None]
    validation = cross_validate(labelled, "vocals")
    floor, drop = validation["all"]["floor"], validation["all"]["drop"]
    by_genre = {}
    groups: dict[str, list[PhraseRow]] = defaultdict(list)
    for row in labelled:
        groups[row.genre].append(row)
    with_yamnet = [row for row in labelled if row.yamnet is not None]
    for genre, items in sorted(groups.items()):
        both = [row for row in items if row.yamnet is not None]
        by_genre[genre] = {
            "stem": confusion(
                (
                    present(row.means["vocals"], row.loudest["vocals"], floor, drop),
                    int(row.label or 0),
                )
                for row in items
            ),
            "yamnet": confusion(
                ((row.yamnet or 0) >= VOCAL_THRESHOLD, int(row.label or 0))
                for row in both
            )
            if both
            else None,
        }
    return {
        "labelledPhrases": len(labelled),
        "tracks": len({row.entity_uid for row in labelled}),
        "validation": validation,
        "yamnetOnTheSamePhrases": confusion(
            ((row.yamnet or 0) >= VOCAL_THRESHOLD, int(row.label or 0))
            for row in with_yamnet
        )
        if with_yamnet
        else None,
        "stemOnYamnetPhrases": confusion(
            (
                present(row.means["vocals"], row.loudest["vocals"], floor, drop),
                int(row.label or 0),
            )
            for row in with_yamnet
        )
        if with_yamnet
        else None,
        "byGenre": by_genre,
    }


def render_markdown(result: Mapping[str, Any]) -> str:
    lines = ["# Stems layer presence cuts", ""]
    vocals = result.get("vocals")
    if vocals:
        cv = vocals["validation"]
        chosen = cv["all"]
        lines += [
            f"Vocals: {vocals['labelledPhrases']} labelled phrases of"
            f" {vocals['tracks']} tracks.",
            "",
            "| Rule | Precision | Recall | Specificity | Balanced accuracy | F1 |",
            "| --- | ---: | ---: | ---: | ---: | ---: |",
            _confusion_row("Stem, 5-fold CV", cv["cv"]),
            _confusion_row(
                f"Stem, all (floor {chosen['floor']}, drop {chosen['drop']})", chosen
            ),
        ]
        if vocals.get("yamnetOnTheSamePhrases"):
            lines.append(
                _confusion_row(
                    f"YAMNet byte >= {VOCAL_THRESHOLD}, same phrases",
                    vocals["yamnetOnTheSamePhrases"],
                )
            )
            lines.append(
                _confusion_row("Stem on those phrases", vocals["stemOnYamnetPhrases"])
            )
        lines += [
            "",
            "Folds: "
            + ", ".join(f"{fold['floor']}/{fold['drop']}" for fold in cv["folds"]),
            "",
            "| Genre | Phrases | Stem BA | Stem P | Stem R | Stem spec | YAMNet BA |"
            " YAMNet P | YAMNet R | YAMNet spec |",
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
        ]
        for genre, values in vocals["byGenre"].items():
            stem, yam = values["stem"], values["yamnet"] or {}
            lines.append(
                f"| {genre} | {stem['n']} | {stem['balancedAccuracy']:.2f} |"
                f" {stem['precision']:.2f} | {stem['recall']:.2f} |"
                f" {stem['specificity']:.2f} | {_num(yam.get('balancedAccuracy'))} |"
                f" {_num(yam.get('precision'))} | {_num(yam.get('recall'))} |"
                f" {_num(yam.get('specificity'))} |"
            )
        lines.append("")
    for stem in ("bass", "drums", "vocals"):
        values = result.get("unsupervised", {}).get(stem)
        if not values:
            continue
        lines += [
            f"## {stem}: {values['phrases']} phrases of {values['tracks']} tracks",
            "",
            f"- Valley of the level below the loudest phrase: {values['relativeDbValley']} dB",
            f"- Valley of the loudest phrase: {values['loudestDbfsValley']} dBFS",
            "",
            "| Drop (dB) | "
            + " | ".join(
                sorted(next(iter(values["presentShareByDrop"].values()))["byKind"])
            )
            + " |",
        ]
        kinds = sorted(next(iter(values["presentShareByDrop"].values()))["byKind"])
        lines.append("| --- |" + " ---: |" * len(kinds))
        for drop, shares in values["presentShareByDrop"].items():
            lines.append(
                f"| {drop} | "
                + " | ".join(
                    f"{shares['byKind'][kind]['present']:.2f}" for kind in kinds
                )
                + " |"
            )
        lines += ["", "Level below the loudest phrase (dB, 3 dB bins):", ""]
        lines.append(
            ", ".join(f"{k}: {v}" for k, v in values["relativeDbHistogram"].items())
        )
        lines += ["", "Loudest phrase (dBFS, 3 dB bins):", ""]
        lines.append(
            ", ".join(f"{k}: {v}" for k, v in values["loudestDbfsHistogram"].items())
        )
        lines.append("")
    return "\n".join(lines) + "\n"


def _confusion_row(label: str, values: Mapping[str, Any]) -> str:
    return (
        f"| {label} | {values['precision']:.2f} | {values['recall']:.2f} |"
        f" {values['specificity']:.2f} | {values['balancedAccuracy']:.2f} |"
        f" {values['f1']:.2f} |"
    )


def _num(value: Any) -> str:
    return "n/a" if value is None else f"{value:.2f}"


# --- command line -------------------------------------------------------------------


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n\n")[0])
    parser.add_argument("--stems", type=Path, action="append", required=True)
    parser.add_argument("--labels", type=Path, help="SG1b labels.csv")
    parser.add_argument("--yamnet", type=Path, help="SG1b phrase_windows.csv")
    parser.add_argument(
        "--dataset", type=Path, action="append", default=[], help="an eval set"
    )
    parser.add_argument("--groups", type=Path, action="append", default=[])
    parser.add_argument("--dsn", help="postgresql:// URL (or SMART_MIX_EVAL_DSN)")
    parser.add_argument("--allow-remote-database", action="store_true")
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    # TEST_GAP: reading the database and the folders runs against the eval copy (see
    # README); the cuts, folds, histograms and confusion counts are tested.
    from separate_pool import load_stem_analyses

    args = parse_args(argv)
    analyses: dict[str, StemAnalysis] = {}
    for folder in args.stems:
        analyses.update(load_stem_analyses(folder))
    rows: list[PhraseRow] = []
    if args.labels:
        with args.labels.open() as handle:
            labels = list(csv.DictReader(handle))
        yamnet = read_yamnet(args.yamnet) if args.yamnet else None
        rows += label_rows(labels, analyses, yamnet)
    if args.dataset:
        from run_eval import load_profiles

        dsn = resolve_dsn(args.dsn)
        if not dsn:
            print("--dataset needs --dsn or SMART_MIX_EVAL_DSN", file=sys.stderr)
            return 2
        open_read_only_database(dsn, allow_remote=args.allow_remote_database)
        groups: dict[str, str] = {}
        for path in args.groups:
            for line in path.read_text().splitlines():
                fields = line.split("\t")
                if len(fields) >= 2 and not line.startswith("#"):
                    groups[fields[0].strip()] = fields[1].strip()
        for dataset in args.dataset:
            uids = sorted(
                {
                    str(row[key])
                    for row in read_jsonl(dataset)
                    for key in ("outgoingTrackEntityUid", "incomingTrackEntityUid")
                }
            )
            rows += profile_rows(
                load_profiles(uids), analyses, groups, source=dataset.parent.name
            )
    result: dict[str, Any] = {
        "meta": {
            "createdAt": datetime.now(UTC).isoformat(),
            "gitCommit": git_commit(),
            "analyses": len(analyses),
            "phrases": len(rows),
            "sources": dict(Counter(row.source for row in rows)),
            "currentCuts": {
                stem: {"floor": cut.floor, "drop": cut.drop}
                for stem, cut in STEM_PRESENCE_CUTS.items()
            },
        },
        "unsupervised": {stem: unsupervised(rows, stem) for stem in STEMS},
    }
    if any(row.label is not None for row in rows):
        result["vocals"] = vocal_report(rows)
    args.output.mkdir(parents=True, exist_ok=True)
    write_json(args.output / "calibration.json", result)
    (args.output / "calibration.md").write_text(render_markdown(result))
    print(f"{len(rows)} phrases -> {args.output}", file=sys.stderr)
    return 0


__all__ = [
    "PhraseRow",
    "confusion",
    "cross_validate",
    "fit_cut",
    "fold_of",
    "histogram",
    "label_rows",
    "present",
    "valley",
    "yamnet_byte",
]

if __name__ == "__main__":
    raise SystemExit(main())

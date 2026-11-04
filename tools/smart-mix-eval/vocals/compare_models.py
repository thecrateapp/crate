#!/usr/bin/env python3
"""Compare voice models on the stored Smart Mix phrases (SMV.PR1, SM3-D13).

A measurement tool, outside the production path. ``score`` decodes each track once per
sample rate, runs every chosen model over short windows and writes, per backend, the
window scores of each stored v7 phrase and the CPU time per track. ``evaluate`` compares
those scores with the hand labels of ``vocals_labels.csv``: ROC AUC of the phrase mean,
and a phrase byte (the fraction of its windows at or above a window threshold, 0-255)
whose two thresholds are chosen by cross-validation grouped by track.

``score`` reads a development database only, like ``export_phrases.py``: it refuses
any host that is not this machine unless ``--allow-remote-database`` is given, and
every session is read-only. ``evaluate`` needs neither the database nor the models.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import resource
import statistics
import sys
import time
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from export_phrases import (
    APP_ROOT,
    DEFAULT_LABELS,
    DSN_ENVIRONMENT_VARIABLE,
    UnsafeDatabaseError,
    database_environment,
    local_path,
    read_csv,
    read_track_uids,
    stored_phrase_rows,
)

WINDOW_FIELDS = (
    "entity_uid",
    "phrase_index",
    "start_ms",
    "end_ms",
    "n_windows",
    "mean",
    "windows",
)
CPU_FIELDS = ("entity_uid", "seconds", "decode_cpu", "model_cpu")
WINDOWS_PREFIX = "vocals_windows_"
CPU_PREFIX = "vocals_cpu_"
META_PREFIX = "vocals_meta_"
FOLDS = 5
# Candidate window thresholds, readable values from 1e-4 to 0.9. Voice scores of the
# AudioSet models sit mostly far below 0.5, so the low end is dense.
WINDOW_THRESHOLDS = (
    0.0001,
    0.0002,
    0.0003,
    0.0005,
    0.0007,
    0.001,
    0.0015,
    0.002,
    0.003,
    0.005,
    0.007,
    0.01,
    0.015,
    0.02,
    0.03,
    0.05,
    0.07,
    0.1,
    0.15,
    0.2,
    0.3,
    0.4,
    0.5,
    0.6,
    0.7,
    0.8,
    0.9,
)
# Sung or spoken voice in the AudioSet ontology; each model keeps the names it has.
AUDIOSET_VOICE = frozenset(
    {
        "Speech",
        "Male speech, man speaking",
        "Female speech, woman speaking",
        "Child speech, kid speaking",
        "Narration, monologue",
        "Singing",
        "Male singing",
        "Female singing",
        "Child singing",
        "Synthetic singing",
        "Choir",
        "Chant",
        "Rapping",
    }
)

YAMNET_GRAPH = "audioset-yamnet-1.pb"
YAMNET_LABELS = "audioset-yamnet-1.json"
YAMNET_HOP_S = 0.48  # patchHopSize 48 frames of 10 ms
YAMNET_FIRST_CENTRE_S = 0.48  # half a 0.96 s patch
EFFNET_GRAPH = "discogs-effnet-bs64-1.pb"
EFFNET_VOICE_GRAPH = "voice_instrumental-discogs-effnet-1.pb"
EFFNET_VOICE_LABELS = "voice_instrumental-discogs-effnet-1.json"
EFFNET_HOP_S = 62 * 256 / 16_000  # patchHopSize 62 frames of 256 samples
EFFNET_FIRST_CENTRE_S = 128 * 256 / 16_000 / 2  # half a 128-frame patch
PANNS_DATA_DIR = Path("/app/panns_data")  # where the analysis image keeps CNN14
PANNS_CHECKPOINT = PANNS_DATA_DIR / "Cnn14_mAP=0.431.pth"
PANNS_LABELS = PANNS_DATA_DIR / "class_labels_indices.csv"
PANNS_RATE = 32_000
PANNS_WINDOW_S = 2.0
PANNS_HOP_S = 1.0
PANNS_BATCH = 32

# audio -> (window centres in seconds, voice score per window)
Scorer = Callable[[Any], tuple[Sequence[float], Sequence[float]]]
Decoder = Callable[[Path, int], Sequence[float]]
Track = tuple[str, Path, Sequence[Mapping[str, Any]]]


@dataclass(frozen=True)
class Backend:
    title: str
    sample_rate: int
    # Relative paths live in --models-dir; absolute ones ship in the analysis image.
    model_files: tuple[str | Path, ...]
    load: Callable[[Path | None], Scorer]

    def model_paths(self, models_dir: Path | None) -> list[Path]:
        paths = []
        for name in self.model_files:
            path = Path(name)
            if not path.is_absolute():
                if models_dir is None:
                    raise ValueError(f"{self.title} needs --models-dir")
                path = models_dir / path
            paths.append(path)
        return paths


@dataclass(frozen=True)
class PhraseWindows:
    entity_uid: str
    phrase_index: int
    start_ms: int
    end_ms: int
    scores: tuple[float, ...]
    mean: float | None = field(default=None, compare=False)

    def __post_init__(self) -> None:
        if self.mean is None and self.scores:
            object.__setattr__(self, "mean", sum(self.scores) / len(self.scores))


@dataclass(frozen=True)
class LabelledPhrase:
    entity_uid: str
    vocal: bool
    mean: float
    scores: tuple[float, ...]


@dataclass(frozen=True)
class Thresholds:
    window: float
    byte: int


@dataclass(frozen=True)
class Confusion:
    tp: int
    fp: int
    fn: int
    tn: int

    def __add__(self, other: Confusion) -> Confusion:
        return Confusion(
            self.tp + other.tp,
            self.fp + other.fp,
            self.fn + other.fn,
            self.tn + other.tn,
        )

    @property
    def precision(self) -> float | None:
        return _ratio(self.tp, self.tp + self.fp)

    @property
    def recall(self) -> float | None:
        return _ratio(self.tp, self.tp + self.fn)

    @property
    def f1(self) -> float:
        return _f1(self.tp, self.fp, self.fn)

    @property
    def specificity(self) -> float | None:
        return _ratio(self.tn, self.tn + self.fp)

    @property
    def npv(self) -> float | None:
        return _ratio(self.tn, self.tn + self.fn)

    def metrics(self) -> dict[str, Any]:
        return {
            "precision": self.precision,
            "recall": self.recall,
            "f1": self.f1,
            "specificity": self.specificity,
            "npv": self.npv,
            "counts": {"tp": self.tp, "fp": self.fp, "fn": self.fn, "tn": self.tn},
        }


@dataclass(frozen=True)
class CrossValidation:
    confusion: Confusion
    thresholds: tuple[Thresholds, ...]


def _ratio(numerator: int, denominator: int) -> float | None:
    return numerator / denominator if denominator else None


def _f1(tp: int, fp: int, fn: int) -> float:
    return 2 * tp / (2 * tp + fp + fn) if tp else 0.0


# Windows and phrases


def phrase_windows(
    entity_uid: str,
    rows: Sequence[Mapping[str, Any]],
    centres_s: Sequence[float],
    scores: Sequence[float],
) -> list[PhraseWindows]:
    """Each phrase keeps the windows whose centre falls in [start, end)."""
    pairs = [(float(c), float(s)) for c, s in zip(centres_s, scores, strict=True)]
    phrases = []
    for row in rows:
        start_s, end_s = int(row["start_ms"]) / 1_000, int(row["end_ms"]) / 1_000
        phrases.append(
            PhraseWindows(
                entity_uid=entity_uid,
                phrase_index=int(row["phrase_index"]),
                start_ms=int(row["start_ms"]),
                end_ms=int(row["end_ms"]),
                scores=tuple(s for c, s in pairs if start_s <= c < end_s),
            )
        )
    return phrases


def window_row(phrase: PhraseWindows) -> dict[str, Any]:
    return {
        "entity_uid": phrase.entity_uid,
        "phrase_index": phrase.phrase_index,
        "start_ms": phrase.start_ms,
        "end_ms": phrase.end_ms,
        "n_windows": len(phrase.scores),
        "mean": "" if phrase.mean is None else f"{phrase.mean:.4f}",
        "windows": " ".join(f"{score:.4f}" for score in phrase.scores),
    }


def write_windows(path: Path, phrases: Iterable[PhraseWindows]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=WINDOW_FIELDS)
        writer.writeheader()
        writer.writerows(window_row(phrase) for phrase in phrases)


def read_windows(path: Path) -> list[PhraseWindows]:
    return [
        PhraseWindows(
            entity_uid=row["entity_uid"],
            phrase_index=int(row["phrase_index"]),
            start_ms=int(row["start_ms"]),
            end_ms=int(row["end_ms"]),
            scores=tuple(float(value) for value in row["windows"].split()),
            mean=float(row["mean"]) if row["mean"] else None,
        )
        for row in read_csv(path)
    ]


def phrase_byte(scores: Sequence[float], window_threshold: float) -> int:
    """255 times the fraction of windows at or above the threshold; 0 without windows."""
    if not scores:
        return 0
    voiced = sum(1 for score in scores if score >= window_threshold)
    return round(255 * voiced / len(scores))


def voice_class_indices(labels: Sequence[str]) -> list[int]:
    return [index for index, name in enumerate(labels) if name in AUDIOSET_VOICE]


# Metrics


def auc(scores: Sequence[float], labels: Sequence[bool]) -> float | None:
    """ROC AUC by the rank-sum formula, ties counted half; None without both classes."""
    ranked = sorted(zip(scores, labels, strict=True), key=lambda pair: pair[0])
    positives = sum(1 for _score, label in ranked if label)
    negatives = len(ranked) - positives
    if not positives or not negatives:
        return None
    rank_sum = 0.0
    start = 0
    while start < len(ranked):
        end = start
        while end + 1 < len(ranked) and ranked[end + 1][0] == ranked[start][0]:
            end += 1
        rank = (start + end) / 2 + 1
        rank_sum += rank * sum(1 for _s, label in ranked[start : end + 1] if label)
        start = end + 1
    return (rank_sum - positives * (positives + 1) / 2) / (positives * negatives)


def track_folds(entity_uids: Iterable[str], folds: int = FOLDS) -> dict[str, int]:
    """Deterministic folds: tracks sorted by entity UID, dealt round-robin."""
    return {uid: index % folds for index, uid in enumerate(sorted(set(entity_uids)))}


def confusion_at(
    phrases: Iterable[LabelledPhrase], thresholds: Thresholds
) -> Confusion:
    tp = fp = fn = tn = 0
    for phrase in phrases:
        voice = phrase_byte(phrase.scores, thresholds.window) >= thresholds.byte
        if voice and phrase.vocal:
            tp += 1
        elif voice:
            fp += 1
        elif phrase.vocal:
            fn += 1
        else:
            tn += 1
    return Confusion(tp, fp, fn, tn)


def choose_thresholds(
    phrases: Sequence[LabelledPhrase],
    window_thresholds: Sequence[float] = WINDOW_THRESHOLDS,
) -> Thresholds:
    """The (window, byte) pair with the best F1; ties keep the lowest of both."""
    best, best_f1 = Thresholds(window_thresholds[0], 1), -1.0
    positives = sum(1 for phrase in phrases if phrase.vocal)
    for window in window_thresholds:
        voice_bytes, other_bytes = [0] * 256, [0] * 256
        for phrase in phrases:
            byte = phrase_byte(phrase.scores, window)
            (voice_bytes if phrase.vocal else other_bytes)[byte] += 1
        # Phrases at or above each byte threshold, from 255 down.
        tp = fp = 0
        above: list[tuple[int, int]] = [(0, 0)] * 256
        for byte in range(255, 0, -1):
            tp, fp = tp + voice_bytes[byte], fp + other_bytes[byte]
            above[byte] = (tp, fp)
        for byte in range(1, 256):
            tp, fp = above[byte]
            f1 = _f1(tp, fp, positives - tp)
            if f1 > best_f1:
                best, best_f1 = Thresholds(window, byte), f1
    return best


def cross_validate(
    phrases: Sequence[LabelledPhrase],
    *,
    folds: int = FOLDS,
    window_thresholds: Sequence[float] = WINDOW_THRESHOLDS,
) -> CrossValidation:
    """Thresholds learnt on the other folds, counts pooled over the held-out ones."""
    fold_of = track_folds((phrase.entity_uid for phrase in phrases), folds)
    total = Confusion(0, 0, 0, 0)
    chosen = []
    for fold in range(folds):
        held_out = [p for p in phrases if fold_of[p.entity_uid] == fold]
        if not held_out:
            continue
        training = [p for p in phrases if fold_of[p.entity_uid] != fold]
        thresholds = choose_thresholds(training, window_thresholds)
        chosen.append(thresholds)
        total += confusion_at(held_out, thresholds)
    return CrossValidation(total, tuple(chosen))


def always_voice(phrases: Sequence[LabelledPhrase]) -> Confusion:
    positives = sum(1 for phrase in phrases if phrase.vocal)
    return Confusion(tp=positives, fp=len(phrases) - positives, fn=0, tn=0)


def _nearest_rank(values: Sequence[float], quantile: float) -> float:
    ordered = sorted(values)
    return ordered[max(0, math.ceil(quantile * len(ordered)) - 1)]


def summarize_cpu(rows: Sequence[Mapping[str, str]]) -> dict[str, Any] | None:
    """Process CPU seconds per track (mean, p50, p95) and per minute of audio."""
    if not rows:
        return None
    seconds = [float(row["seconds"]) for row in rows]
    decode = [float(row["decode_cpu"]) for row in rows]
    model = [float(row["model_cpu"]) for row in rows]
    minutes = sum(seconds) / 60
    return {
        "tracks": len(rows),
        "audio_minutes": round(minutes, 2),
        "decode_mean": round(statistics.mean(decode), 3),
        "model_mean": round(statistics.mean(model), 3),
        "model_p50": round(statistics.median(model), 3),
        "model_p95": round(_nearest_rank(model, 0.95), 3),
        "model_per_audio_minute": round(sum(model) / minutes, 3) if minutes else None,
    }


# Backends: heavy imports stay inside the loaders.
# TEST_GAP: the loaders and the decoder need Essentia, PyTorch and model files that are
# not in the test image (and the Essentia ones may not be redistributed); they are
# checked by running score in the analysis image, as the README describes.


def _essentia_standard() -> Any:
    import essentia

    essentia.log.infoActive = False
    essentia.log.warningActive = False
    import essentia.standard as standard

    return standard


def decode_with_essentia(path: Path, sample_rate: int) -> Any:
    standard = _essentia_standard()
    loader = standard.MonoLoader(
        filename=str(path), sampleRate=sample_rate, resampleQuality=4
    )
    return loader()


def _load_yamnet(models_dir: Path | None) -> Scorer:
    import numpy as np

    assert models_dir is not None
    standard = _essentia_standard()
    classes = json.loads((models_dir / YAMNET_LABELS).read_text())["classes"]
    voice = voice_class_indices(classes)
    model = standard.TensorflowPredictVGGish(
        graphFilename=str(models_dir / YAMNET_GRAPH),
        input="melspectrogram",
        output="activations",
        patchHopSize=48,
    )

    def score(audio: Any) -> tuple[Any, Any]:
        activations = np.asarray(model(audio)).reshape(-1, len(classes))
        scores = activations[:, voice].max(axis=1, initial=0.0)
        centres = np.arange(len(scores)) * YAMNET_HOP_S + YAMNET_FIRST_CENTRE_S
        return centres, scores

    return score


def _load_effnet(models_dir: Path | None) -> Scorer:
    import numpy as np

    assert models_dir is not None
    standard = _essentia_standard()
    classes = json.loads((models_dir / EFFNET_VOICE_LABELS).read_text())["classes"]
    voice = classes.index("voice")
    embed = standard.TensorflowPredictEffnetDiscogs(
        graphFilename=str(models_dir / EFFNET_GRAPH), output="PartitionedCall:1"
    )
    head = standard.TensorflowPredict2D(
        graphFilename=str(models_dir / EFFNET_VOICE_GRAPH), output="model/Softmax"
    )

    def score(audio: Any) -> tuple[Any, Any]:
        probabilities = np.asarray(head(embed(audio))).reshape(-1, len(classes))
        scores = probabilities[:, voice]
        centres = np.arange(len(scores)) * EFFNET_HOP_S + EFFNET_FIRST_CENTRE_S
        return centres, scores

    return score


def _load_panns(_models_dir: Path | None) -> Scorer:
    import numpy as np
    import torch
    from panns_inference import AudioTagging

    with PANNS_LABELS.open(newline="") as handle:
        labels = [row["display_name"] for row in csv.DictReader(handle)]
    voice = voice_class_indices(labels)
    tagger = AudioTagging(checkpoint_path=str(PANNS_CHECKPOINT), device="cpu")
    window, hop = int(PANNS_WINDOW_S * PANNS_RATE), int(PANNS_HOP_S * PANNS_RATE)

    def score(audio: Any) -> tuple[Any, Any]:
        samples = np.asarray(audio, dtype=np.float32)
        starts = list(range(0, max(1, len(samples) - window + 1), hop))
        clips = np.stack(
            [
                np.pad(
                    samples[start : start + window],
                    (0, max(0, start + window - len(samples))),
                )
                for start in starts
            ]
        )
        batches = []
        with torch.no_grad():
            for first in range(0, len(clips), PANNS_BATCH):
                clipwise, _embedding = tagger.inference(
                    clips[first : first + PANNS_BATCH]
                )
                batches.append(np.asarray(clipwise))
        scores = np.concatenate(batches)[:, voice].max(axis=1)
        centres = np.asarray(starts) / PANNS_RATE + PANNS_WINDOW_S / 2
        return centres, scores

    return score


BACKENDS: dict[str, Backend] = {
    "yamnet-essentia": Backend(
        title="YAMNet (AudioSet), Essentia graph",
        sample_rate=16_000,
        model_files=(YAMNET_GRAPH, YAMNET_LABELS),
        load=_load_yamnet,
    ),
    "effnet": Backend(
        title="Essentia voice/instrumental on Discogs-EffNet",
        sample_rate=16_000,
        model_files=(EFFNET_GRAPH, EFFNET_VOICE_GRAPH, EFFNET_VOICE_LABELS),
        load=_load_effnet,
    ),
    "panns": Backend(
        title="PANNs CNN14 (AudioSet)",
        sample_rate=PANNS_RATE,
        model_files=(PANNS_CHECKPOINT, PANNS_LABELS),
        load=_load_panns,
    ),
}


# score


def score_tracks(
    tracks: Iterable[Track],
    backends: Mapping[str, Backend],
    scorers: Mapping[str, Scorer],
    decode: Decoder,
    output: Path,
) -> None:
    """Decode each track once per sample rate and append each backend's rows."""
    output.mkdir(parents=True, exist_ok=True)
    rates = sorted({backend.sample_rate for backend in backends.values()})
    handles, windows, cpu = {}, {}, {}
    try:
        for name in backends:
            handles[name] = (
                (output / f"{WINDOWS_PREFIX}{name}.csv").open("w", newline=""),
                (output / f"{CPU_PREFIX}{name}.csv").open("w", newline=""),
            )
            windows[name] = csv.DictWriter(handles[name][0], fieldnames=WINDOW_FIELDS)
            cpu[name] = csv.DictWriter(handles[name][1], fieldnames=CPU_FIELDS)
            windows[name].writeheader()
            cpu[name].writeheader()
        for number, (uid, path, rows) in enumerate(tracks, start=1):
            audio, decode_cpu = {}, {}
            for rate in rates:
                started = time.process_time()
                audio[rate] = decode(path, rate)
                decode_cpu[rate] = time.process_time() - started
            progress = []
            for name, backend in backends.items():
                samples = audio[backend.sample_rate]
                started = time.process_time()
                centres, scores = scorers[name](samples)
                model_cpu = time.process_time() - started
                windows[name].writerows(
                    window_row(phrase)
                    for phrase in phrase_windows(uid, rows, centres, scores)
                )
                cpu[name].writerow(
                    {
                        "entity_uid": uid,
                        "seconds": f"{len(samples) / backend.sample_rate:.1f}",
                        "decode_cpu": f"{decode_cpu[backend.sample_rate]:.2f}",
                        "model_cpu": f"{model_cpu:.2f}",
                    }
                )
                for handle in handles[name]:
                    handle.flush()
                progress.append(f"{name} {model_cpu:.1f}s")
            print(f"{number} {uid}  " + ", ".join(progress), flush=True)
    finally:
        for pair in handles.values():
            for handle in pair:
                handle.close()


def backend_meta(
    name: str,
    backend: Backend,
    models_dir: Path | None,
    *,
    run_backends: Sequence[str],
    peak_rss_mb: float,
) -> dict[str, Any]:
    files = {path.name: path.stat().st_size for path in backend.model_paths(models_dir)}
    return {
        "backend": name,
        "title": backend.title,
        "sample_rate": backend.sample_rate,
        "model_files": files,
        "model_mb": round(sum(files.values()) / 1_000_000, 1),
        # The process peak covers every backend scored in the same run.
        "peak_rss_mb": round(peak_rss_mb, 1),
        "run_backends": list(run_backends),
    }


def _parse_backends(value: str) -> list[str]:
    names = [name.strip() for name in value.split(",") if name.strip()]
    unknown = [name for name in names if name not in BACKENDS]
    if unknown or not names:
        raise ValueError(
            f"Unknown backend {', '.join(unknown) or '(none)'}; "
            f"choose from {', '.join(BACKENDS)}"
        )
    return list(dict.fromkeys(names))


def run_score(args: argparse.Namespace) -> int:
    try:
        names = _parse_backends(args.backends)
    except ValueError as error:
        print(error, file=sys.stderr)
        return 2
    uids = read_track_uids(args.tracks, args.tracks_file)
    if not uids:
        print("No tracks given.", file=sys.stderr)
        return 2
    if not args.dsn:
        print(f"Set --dsn or {DSN_ENVIRONMENT_VARIABLE}.", file=sys.stderr)
        return 2
    try:
        environment = database_environment(
            args.dsn, allow_remote=args.allow_remote_database
        )
    except UnsafeDatabaseError as error:
        print(error, file=sys.stderr)
        return 2
    backends = {name: BACKENDS[name] for name in names}
    try:
        missing = [
            str(path)
            for backend in backends.values()
            for path in backend.model_paths(args.models_dir)
            if not path.is_file()
        ]
    except ValueError as error:
        print(error, file=sys.stderr)
        return 2
    if missing:
        print("Missing model files: " + ", ".join(missing), file=sys.stderr)
        return 2

    os.environ.update(environment)
    if str(APP_ROOT) not in sys.path:
        sys.path.insert(0, str(APP_ROOT))
    tracks: list[Track] = []
    for uid in uids:
        stored = stored_phrase_rows(uid)
        if stored is None:
            print(f"{uid}  skipped: no stored phrases (analyze it with v7 first)")
            continue
        track, rows = stored
        path = local_path(track["path"], args.library_root, args.music_root)
        tracks.append((uid, path, rows))
    print(f"{len(tracks)} tracks, {sum(len(rows) for *_, rows in tracks)} phrases")

    scorers = {
        name: backend.load(args.models_dir) for name, backend in backends.items()
    }
    score_tracks(tracks, backends, scorers, decode_with_essentia, args.output)
    # Linux reports ru_maxrss in KiB.
    peak_rss_mb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
    for name, backend in backends.items():
        meta = backend_meta(
            name,
            backend,
            args.models_dir,
            run_backends=names,
            peak_rss_mb=peak_rss_mb,
        )
        (args.output / f"{META_PREFIX}{name}.json").write_text(
            json.dumps(meta, indent=2, sort_keys=True) + "\n"
        )
    print(f"Window scores in {args.output}")
    return 0


# evaluate


def _discover_backends(windows_dir: Path) -> list[str]:
    found = {
        path.name[len(WINDOWS_PREFIX) : -len(".csv")]
        for path in windows_dir.glob(f"{WINDOWS_PREFIX}*.csv")
    }
    return [name for name in BACKENDS if name in found] + sorted(found - set(BACKENDS))


def evaluate(
    labels: Sequence[Mapping[str, Any]],
    windows: Mapping[str, Sequence[PhraseWindows]],
    *,
    cpu: Mapping[str, Sequence[Mapping[str, str]]] | None = None,
    meta: Mapping[str, Mapping[str, Any]] | None = None,
    folds: int = FOLDS,
    window_thresholds: Sequence[float] = WINDOW_THRESHOLDS,
) -> dict[str, Any]:
    """Every backend on the same phrases: labelled and with windows in all of them."""
    cpu, meta = cpu or {}, meta or {}
    indexed = {
        name: {(p.entity_uid, p.phrase_index): p for p in phrases}
        for name, phrases in windows.items()
    }
    labelled = [row for row in labels if str(row["vocal"]).strip() in {"0", "1"}]
    left_out = {"not_scored": 0, "moved": 0, "no_windows": 0}
    kept: list[tuple[Mapping[str, Any], dict[str, PhraseWindows]]] = []
    for row in labelled:
        key = (str(row["entity_uid"]), int(row["phrase_index"]))
        scored = {name: index.get(key) for name, index in indexed.items()}
        found = {name: p for name, p in scored.items() if p is not None}
        if len(found) < len(scored):
            left_out["not_scored"] += 1
        elif any(p.start_ms != int(row["start_ms"]) for p in found.values()):
            left_out["moved"] += 1
        elif any(not p.scores for p in found.values()):
            left_out["no_windows"] += 1
        else:
            kept.append((row, found))

    def phrases_of(name: str) -> list[LabelledPhrase]:
        return [
            LabelledPhrase(
                entity_uid=str(row["entity_uid"]),
                vocal=str(row["vocal"]).strip() == "1",
                mean=found[name].mean or 0.0,
                scores=found[name].scores,
            )
            for row, found in kept
        ]

    reference = [
        LabelledPhrase(str(row["entity_uid"]), str(row["vocal"]).strip() == "1", 0, ())
        for row, _found in kept
    ]
    voice = sum(1 for phrase in reference if phrase.vocal)
    report: dict[str, Any] = {
        "phrases": {
            "labelled": len(labelled),
            "evaluated": len(kept),
            "tracks": len({phrase.entity_uid for phrase in reference}),
            "voice": voice,
            "no_voice": len(kept) - voice,
            "left_out": left_out,
        },
        "folds": folds,
        "window_thresholds": list(window_thresholds),
        "baseline": {"auc": 0.5, **always_voice(reference).metrics()},
        "backends": {},
    }
    for name in windows:
        phrases = phrases_of(name)
        result = cross_validate(
            phrases, folds=folds, window_thresholds=window_thresholds
        )
        recommended = (
            {
                "window_threshold": statistics.median(
                    t.window for t in result.thresholds
                ),
                "byte_threshold": round(
                    statistics.median(t.byte for t in result.thresholds)
                ),
            }
            if result.thresholds
            else None
        )
        report["backends"][name] = {
            "title": BACKENDS[name].title if name in BACKENDS else name,
            "auc": auc([p.mean for p in phrases], [p.vocal for p in phrases]),
            **result.confusion.metrics(),
            "fold_thresholds": [
                {"window_threshold": t.window, "byte_threshold": t.byte}
                for t in result.thresholds
            ],
            "recommended": recommended,
            "cpu": summarize_cpu(cpu.get(name, ())),
            "model": dict(meta[name]) if name in meta else None,
        }
    return report


def _number(value: float | None, digits: int = 2) -> str:
    return "n/a" if value is None else f"{value:.{digits}f}"


def render_markdown(report: Mapping[str, Any]) -> str:
    phrases = report["phrases"]
    left_out = phrases["left_out"]
    lines = [
        "# Voice per phrase: model comparison (SMV.PR1)",
        "",
        f"- Labels: {report.get('labels', '?')}",
        f"- Window scores: {report.get('windows', '?')}",
        f"- Phrases: {phrases['evaluated']} of {phrases['labelled']} labelled, in"
        f" {phrases['tracks']} tracks; voice {phrases['voice']}, no voice"
        f" {phrases['no_voice']}. Left out: {left_out['not_scored']} not scored by"
        f" every backend, {left_out['moved']} whose phrase moved since labelling,"
        f" {left_out['no_windows']} without windows in some backend.",
        "",
        "AUC ranks phrases by their mean window score. The phrase byte is 255 times",
        "the fraction of its windows at or above the window threshold, and a phrase",
        "has voice when its byte reaches the byte threshold. Both thresholds are",
        f"chosen by {report['folds']}-fold cross-validation grouped by track, with",
        "the best F1 on the training folds; the other metrics pool the held-out",
        "folds. The thresholds shown are the median of the folds.",
        "",
        "| Backend | AUC | Precision | Recall | F1 | Specificity | NPV |"
        " Window threshold | Byte threshold |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    baseline = report["baseline"]
    lines.append(
        f"| Always voice (baseline) | {baseline['auc']:.3f} |"
        f" {_number(baseline['precision'])} | {_number(baseline['recall'])} |"
        f" {_number(baseline['f1'])} | {_number(baseline['specificity'])} |"
        f" {_number(baseline['npv'])} | n/a | n/a |"
    )
    for name, result in report["backends"].items():
        recommended = result["recommended"] or {}
        window = recommended.get("window_threshold")
        byte = recommended.get("byte_threshold")
        lines.append(
            f"| {name} | {_number(result['auc'], 3)} |"
            f" {_number(result['precision'])} | {_number(result['recall'])} |"
            f" {_number(result['f1'])} | {_number(result['specificity'])} |"
            f" {_number(result['npv'])} | {'n/a' if window is None else f'{window:g}'} |"
            f" {'n/a' if byte is None else byte} |"
        )
    lines += ["", "## Backends", ""]
    for name, result in report["backends"].items():
        folds = ", ".join(
            f"{t['window_threshold']:g}/{t['byte_threshold']}"
            for t in result["fold_thresholds"]
        )
        lines.append(f"- `{name}`: {result['title']}. Fold thresholds: {folds}.")
    lines += [
        "",
        "## Cost",
        "",
        "Process CPU time, every thread counted. Decode is at the backend's sample rate,",
        "shared by backends with the same rate. Peak RSS is the whole scoring run's.",
        "",
        "| Backend | Tracks | Audio min | Decode s/track | Model s/track (mean) |"
        " p50 | p95 | Model s per audio min | Model MB | Peak RSS MB |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for name, result in report["backends"].items():
        cpu = result["cpu"] or {}
        model = result["model"] or {}
        lines.append(
            f"| {name} | {cpu.get('tracks', 'n/a')} |"
            f" {_number(cpu.get('audio_minutes'), 0)} |"
            f" {_number(cpu.get('decode_mean'), 1)} |"
            f" {_number(cpu.get('model_mean'), 1)} |"
            f" {_number(cpu.get('model_p50'), 1)} |"
            f" {_number(cpu.get('model_p95'), 1)} |"
            f" {_number(cpu.get('model_per_audio_minute'), 2)} |"
            f" {_number(model.get('model_mb'), 1)} |"
            f" {_number(model.get('peak_rss_mb'), 0)} |"
        )
    return "\n".join(lines) + "\n"


def run_evaluate(args: argparse.Namespace) -> int:
    if args.backends:
        names = [name.strip() for name in args.backends.split(",") if name.strip()]
    else:
        names = _discover_backends(args.windows)
    if not names:
        print(f"No {WINDOWS_PREFIX}*.csv in {args.windows}", file=sys.stderr)
        return 2
    missing = [
        str(path)
        for name in names
        if not (path := args.windows / f"{WINDOWS_PREFIX}{name}.csv").is_file()
    ]
    if missing:
        print("Missing window scores: " + ", ".join(missing), file=sys.stderr)
        return 2
    windows = {
        name: read_windows(args.windows / f"{WINDOWS_PREFIX}{name}.csv")
        for name in names
    }
    cpu = {name: read_csv(args.windows / f"{CPU_PREFIX}{name}.csv") for name in names}
    meta = {
        name: json.loads(path.read_text())
        for name in names
        if (path := args.windows / f"{META_PREFIX}{name}.json").is_file()
    }
    report = {
        "labels": str(args.labels),
        "windows": str(args.windows),
        **evaluate(read_csv(args.labels), windows, cpu=cpu, meta=meta),
    }
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "report.json").write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n"
    )
    markdown = render_markdown(report)
    (args.output / "report.md").write_text(markdown)
    print(markdown)
    return 0


def _parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    commands = parser.add_subparsers(dest="command", required=True)

    score = commands.add_parser("score", help="Score stored phrases with each backend")
    score.add_argument("tracks", nargs="*", help="Track entity UIDs")
    score.add_argument("--tracks-file", type=Path, help="One entity UID per line")
    score.add_argument(
        "--backends",
        default="yamnet-essentia",
        help=f"Comma-separated, from: {', '.join(BACKENDS)}",
    )
    score.add_argument(
        "--models-dir", type=Path, help="Folder with the downloaded Essentia models"
    )
    score.add_argument("--output", type=Path, required=True)
    score.add_argument("--dsn", default=os.environ.get(DSN_ENVIRONMENT_VARIABLE))
    score.add_argument("--allow-remote-database", action="store_true")
    score.add_argument(
        "--library-root",
        default="/music",
        help="Prefix of the paths stored in the database (default /music)",
    )
    score.add_argument(
        "--music-root", type=Path, help="Local folder that holds --library-root"
    )
    score.set_defaults(run=run_score)

    evaluation = commands.add_parser(
        "evaluate", help="Compare the window scores with the hand labels"
    )
    evaluation.add_argument("--labels", type=Path, default=DEFAULT_LABELS)
    evaluation.add_argument(
        "--windows", type=Path, required=True, help="The output folder of score"
    )
    evaluation.add_argument("--output", type=Path, required=True)
    evaluation.add_argument(
        "--backends", help="Comma-separated; default: every windows file found"
    )
    evaluation.set_defaults(run=run_evaluate)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv)
    return args.run(args)


if __name__ == "__main__":
    sys.exit(main())

"""Beats and downbeats from Beat This! for Smart Mix profiles (SM3-D14).

Beat This! (Foscarin, Schlüter and Widmer, ISMIR 2024; CPJKU, code and weights MIT) is
run with its DBN post-processing: madmom's ``DBNDownBeatTrackingProcessor`` with 3 or 4
beats per bar. Its plain peak picking leaves spurious beats 80-100 ms apart in about
half the tracks, so a grid built on them slips the bar and many tracks lost their
downbeat. The profile task runs it before the analysis and hands the result to the
analyzer, Rust or Python: both take these beats instead of their own tracker, keep
fitting the constant grid, and take the bar phase from the model's downbeats
(``crate.smart_mix.phrase_grid.downbeat_anchor_from_model``).

Only the analysis worker has torch, ``beat_this``, madmom and the checkpoint, which the
image bakes in; nothing is ever downloaded at run time. libsndfile reads the audio; what
it cannot open (AAC in MP4, the library's ``.m4a``) is decoded by ffmpeg, which the
worker images install. Without them, when the model
fails or for tracks over ``BEAT_MODEL_MAX_SECONDS``, there are no model beats and the
analysis keeps its own tracker: without madmom the model is off, never run without its
DBN. ``CRATE_BEAT_THIS_CHECKPOINT`` names the checkpoint (``small0`` by default,
``final0`` if it proves clearly better) and the profile records it, with the
post-processing, in ``beat_tracker`` (``beat-this-small0-dbn``).
"""

from __future__ import annotations

import importlib.util
import logging
import math
import os
import re
import subprocess
from bisect import bisect_left
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Protocol

import numpy as np

log = logging.getLogger(__name__)

# A DJ set or a long live recording would cost minutes of CPU per track.
BEAT_MODEL_MAX_SECONDS = 600
MODEL_SAMPLE_RATE = 22_050
CHECKPOINT_ENV = "CRATE_BEAT_THIS_CHECKPOINT"
WEIGHTS_ENV = "CRATE_BEAT_THIS_WEIGHTS"
DEFAULT_CHECKPOINT = "small0"
MODELS_DIR = Path("/app/models")
THREADS_ENV = "TORCH_NUM_THREADS"
_TRACKER_PREFIX = "beat-this-"
# The post-processing is part of the tracker: beats from Beat This!'s plain peak
# picking were named without it.
_TRACKER_SUFFIX = "-dbn"
BEAT_TRACKER = f"{_TRACKER_PREFIX}{DEFAULT_CHECKPOINT}{_TRACKER_SUFFIX}"
# Short enough for the tracker name to fit the profile (MAX_BEAT_TRACKER, 32).
_CHECKPOINT_NAME = re.compile(r"[a-z0-9_-]{1,18}")
# Besides torch, which only PANNS=off builds leave out. madmom runs the DBN.
_MODEL_MODULES = ("beat_this", "madmom")
# Beat This!'s own DBN post-processing (``beat_this.model.postprocessor``): bars of 3 or
# 4 beats, 55-215 BPM, its 50 fps frames.
DBN_BEATS_PER_BAR = (3, 4)
DBN_MIN_BPM = 55.0
DBN_MAX_BPM = 215.0
DBN_TRANSITION_LAMBDA = 100
MODEL_FPS = 50
_ACTIVATION_EPSILON = 1e-5
_READ_BLOCK_FRAMES = 65_536
# Decoding a ten-minute track takes ffmpeg a few seconds; a hung decoder must not hold
# the task.
_FFMPEG_TIMEOUT_SECONDS = 120


@dataclass(frozen=True, slots=True)
class BeatTrack:
    """Model beats and downbeats in whole, positive, strictly increasing milliseconds.

    ``beats_per_bar`` is the bar length the DBN chose (3 or 4), or None when the bars
    are not all the same length. Both analyzers phrase only bars of four beats: any
    other length gives the profile that time signature, no downbeat and no phrases.
    """

    tracker: str
    beats_ms: tuple[int, ...]
    downbeats_ms: tuple[int, ...]
    beats_per_bar: int | None = None
    # log p(3 beats) - log p(4 beats) of the DBN's two bar lengths, per 1,000 frames,
    # and the second model's verdict when the DBN chose three (``meter_arbiter``).
    meter_margin: float | None = None
    meter_arbiter: str | None = None

    def to_payload(self) -> dict[str, Any]:
        """The JSON that ``crate-cli analyze --beats`` reads."""
        return {
            "tracker": self.tracker,
            "beats_ms": list(self.beats_ms),
            "downbeats_ms": list(self.downbeats_ms),
            "beats_per_bar": self.beats_per_bar,
        }


def beats_per_bar_from_downbeats(
    beats_ms: Sequence[int], downbeats_ms: Sequence[int]
) -> int | None:
    """The beats from each downbeat to the next, when every bar has as many.

    The DBN keeps one bar length per track, 3 or 4 beats; the beats before the first
    downbeat and after the last one form no whole bar and do not count.
    """
    beats = sorted(beats_ms)
    starts = [bisect_left(beats, downbeat) for downbeat in sorted(downbeats_ms)]
    lengths = {end - start for start, end in zip(starts, starts[1:])}
    if len(lengths) != 1:
        return None
    (length,) = lengths
    return length if length > 0 else None


@dataclass(frozen=True, slots=True)
class BarPath:
    """The DBN's best path with bars of ``beats_per_bar``: times in seconds."""

    beats_per_bar: int
    beats: np.ndarray
    downbeats: np.ndarray
    log_probability: float


@dataclass(frozen=True, slots=True)
class BarPaths:
    """The DBN decoded once per bar length it allows, over the same activations."""

    paths: tuple[BarPath, ...]
    frames: int

    def best(self) -> BarPath | None:
        """The path madmom's processor keeps: the highest log probability, the first
        bar length on a tie."""
        if not self.paths:
            return None
        # max keeps the first of equal keys, as np.argmax does.
        return max(self.paths, key=lambda path: path.log_probability)

    def path(self, beats_per_bar: int) -> BarPath | None:
        return next(
            (path for path in self.paths if path.beats_per_bar == beats_per_bar), None
        )

    def meter_margin(self) -> float | None:
        """log p(3) - log p(4) per 1,000 frames: above 0 the DBN prefers three."""
        three, four = self.path(3), self.path(4)
        if three is None or four is None or self.frames <= 0:
            return None
        return (three.log_probability - four.log_probability) / self.frames * 1_000


class BeatModel(Protocol):
    tracker: str

    def __call__(
        self, signal: np.ndarray, sample_rate: int
    ) -> BarPaths | tuple[Any, Any]:
        """The DBN's paths per bar length, or beat and downbeat times in seconds."""
        ...


class BeatThisModel:
    """Beat This! on the CPU, with madmom's DBN, from a local checkpoint.

    It runs Beat This!'s frames and decodes its DBN itself, with the same settings as
    Beat This!'s ``Audio2Beats(dbn=True)``, so the paths of both bar lengths are kept
    for the meter rule; the winner is what ``Audio2Beats`` gives.
    """

    def __init__(self, path: Path, tracker: str) -> None:
        from beat_this.inference import Audio2Frames
        from madmom.features.downbeats import DBNDownBeatTrackingProcessor

        self.tracker = tracker
        self._frames = Audio2Frames(checkpoint_path=str(path), device="cpu")
        self._dbn = DBNDownBeatTrackingProcessor(
            beats_per_bar=list(DBN_BEATS_PER_BAR),
            min_bpm=DBN_MIN_BPM,
            max_bpm=DBN_MAX_BPM,
            fps=MODEL_FPS,
            transition_lambda=DBN_TRANSITION_LAMBDA,
        )

    def __call__(self, signal: np.ndarray, sample_rate: int) -> BarPaths:
        import torch

        torch.set_num_threads(_torch_threads())
        beat_logits, downbeat_logits = self._frames(signal, sample_rate)
        return decode_bar_paths(
            self._dbn, combined_activations(beat_logits, downbeat_logits)
        )


def combined_activations(beat_logits: Any, downbeat_logits: Any) -> np.ndarray:
    """Beat This!'s logits as the DBN's two-class input, as its post-processing builds
    it: beat without downbeat, and downbeat, kept away from 0 and 1."""
    epsilon = _ACTIVATION_EPSILON
    beat = beat_logits.double().sigmoid() * (1 - epsilon) + epsilon / 2
    downbeat = downbeat_logits.double().sigmoid() * (1 - epsilon) + epsilon / 2
    beat_np = beat.cpu().numpy()
    downbeat_np = downbeat.cpu().numpy()
    return np.vstack((np.maximum(beat_np - downbeat_np, epsilon / 2), downbeat_np)).T


def decode_bar_paths(dbn: Any, activations: np.ndarray) -> BarPaths:
    """Every bar length of madmom's ``DBNDownBeatTrackingProcessor``, decoded apart.

    The same steps as its ``process`` (threshold, one Viterbi pass per bar length,
    beats at the activation peak of each beat range), but it keeps every path and its
    log probability instead of only the best one.
    """
    from madmom.features.downbeats import threshold_activations

    first = 0
    if dbn.threshold:
        activations, first = threshold_activations(activations, dbn.threshold)
    if not activations.any():
        return BarPaths(paths=(), frames=0)
    paths = []
    for beats_per_bar, hmm in zip(dbn.beats_per_bar, dbn.hmms):
        path, log_probability = hmm.viterbi(activations)
        beats, numbers = _path_beats(dbn, hmm, activations, path, first)
        paths.append(
            BarPath(
                beats_per_bar=int(beats_per_bar),
                beats=beats,
                downbeats=beats[numbers == 1],
                log_probability=float(log_probability),
            )
        )
    return BarPaths(paths=tuple(paths), frames=int(len(activations)))


def _path_beats(
    dbn: Any, hmm: Any, activations: np.ndarray, path: np.ndarray, first: int
) -> tuple[np.ndarray, np.ndarray]:
    """Beat times (s) and beat numbers of one HMM path, as madmom's ``process``."""
    state_space = hmm.transition_model.state_space
    beat_numbers = state_space.state_positions[path].astype(int) + 1
    if dbn.correct:
        beat_range = hmm.observation_model.pointers[path] >= 1
        if not beat_range.any():
            return np.empty(0), np.empty(0, dtype=int)
        edges = np.nonzero(np.diff(beat_range.astype(int)))[0] + 1
        if beat_range[0]:
            edges = np.r_[0, edges]
        if beat_range[-1]:
            edges = np.r_[edges, beat_range.size]
        frames = np.empty(0, dtype=int)
        if edges.any():
            for left, right in edges.reshape((-1, 2)):
                # Beat and downbeat activations together: argmax on the flattened
                # pair, halved, as madmom does.
                peak = np.argmax(activations[left:right]) // 2 + left
                frames = np.hstack((frames, peak))
    else:
        frames = np.nonzero(np.diff(beat_numbers))[0] + 1
    return (frames + first) / float(dbn.fps), beat_numbers[frames]


MeterArbiter = Callable[[], "int | None"]


def checkpoint_name() -> str:
    """The configured checkpoint: a short identifier, never a path or a URL."""
    name = (os.environ.get(CHECKPOINT_ENV) or "").strip()
    return name if _CHECKPOINT_NAME.fullmatch(name) else DEFAULT_CHECKPOINT


def beat_tracker_name() -> str:
    return f"{_TRACKER_PREFIX}{checkpoint_name()}{_TRACKER_SUFFIX}"


def weights_path() -> Path:
    explicit = (os.environ.get(WEIGHTS_ENV) or "").strip()
    if explicit:
        return Path(explicit)
    return MODELS_DIR / f"beat_this-{checkpoint_name()}.ckpt"


def _torch_threads() -> int:
    try:
        return max(1, int(os.environ.get(THREADS_ENV) or 1))
    except ValueError:
        return 1


@lru_cache(maxsize=1)
def load_beat_model() -> BeatModel | None:
    """The process-wide model, or None when it cannot run.

    Only an image built without torch (``PANNS=off``) lacks the model on purpose, and
    that is logged at info. With torch, a missing package or missing weights mean a
    broken image, so they are logged as warnings. ``beat_this`` downloads any
    checkpoint it cannot open as a file, so the file is checked first: the weights only
    ever come from the image.
    """
    if not _installed("torch"):
        log.info("No torch in this image; Smart Mix keeps its own beat tracker")
        return None
    missing = [module for module in _MODEL_MODULES if not _installed(module)]
    if missing:
        log.warning(
            "Beat This! needs %s, which is not installed; Smart Mix keeps its own "
            "beat tracker",
            ", ".join(missing),
        )
        return None
    path = weights_path()
    if not path.is_file():
        log.warning(
            "No Beat This! weights at %s; Smart Mix keeps its own beat tracker", path
        )
        return None
    try:
        return BeatThisModel(path, beat_tracker_name())
    except Exception:
        log.warning(
            "Beat This! at %s could not be loaded; Smart Mix keeps its own beat tracker",
            path,
            exc_info=True,
        )
        return None


def _installed(module: str) -> bool:
    """Whether ``module`` can be imported, without importing it."""
    try:
        return importlib.util.find_spec(module) is not None
    except (ImportError, ValueError):
        return False


def track_beats(
    audio: np.ndarray,
    sample_rate: int,
    *,
    model: BeatModel | None = None,
    arbiter: MeterArbiter | None = None,
) -> BeatTrack | None:
    """Beats and downbeats of mono audio, or None when the model gives none.

    When the DBN prefers bars of three, ``arbiter`` (madmom's own downbeat model,
    ``crate.smart_mix.meter_arbiter``) must agree; otherwise the track takes the DBN's
    four-beat path (option D of the three-beat bar plan). Without an arbiter, or when
    it fails, the DBN's choice stands.
    """
    samples = np.asarray(audio, dtype=np.float32)
    if samples.ndim == 2:
        samples = samples.mean(axis=1)
    samples = samples.reshape(-1)
    if sample_rate <= 0 or samples.size > BEAT_MODEL_MAX_SECONDS * sample_rate:
        return None
    beat_model = model if model is not None else load_beat_model()
    if beat_model is None:
        return None
    try:
        result = beat_model(samples, sample_rate)
    except Exception:
        log.warning(
            "Beat This! failed; the analysis keeps its own beat tracker", exc_info=True
        )
        return None
    meter_margin: float | None = None
    meter_arbiter: str | None = None
    if isinstance(result, BarPaths):
        chosen = result.best()
        if chosen is None:
            log.info(
                "Beat This! found no beats; the analysis keeps its own beat tracker"
            )
            return None
        meter_margin = result.meter_margin()
        chosen, meter_arbiter = _arbitrate_meter(result, chosen, arbiter)
        beats, downbeats = chosen.beats, chosen.downbeats
    else:
        beats, downbeats = result
    beats_ms = _milliseconds(beats)
    if not beats_ms:
        log.info("Beat This! found no beats; the analysis keeps its own beat tracker")
        return None
    downbeats_ms = _milliseconds(downbeats)
    return BeatTrack(
        tracker=beat_model.tracker,
        beats_ms=beats_ms,
        downbeats_ms=downbeats_ms,
        beats_per_bar=beats_per_bar_from_downbeats(beats_ms, downbeats_ms),
        meter_margin=None if meter_margin is None else round(meter_margin, 3),
        meter_arbiter=meter_arbiter,
    )


def _arbitrate_meter(
    paths: BarPaths, chosen: BarPath, arbiter: MeterArbiter | None
) -> tuple[BarPath, str | None]:
    """The path a track keeps, and the arbiter's verdict when it was asked."""
    four = paths.path(4)
    if chosen.beats_per_bar != 3 or four is None or arbiter is None:
        return chosen, None
    from crate.smart_mix.meter_arbiter import ARBITER_NAME

    try:
        meter = arbiter()
    except Exception:
        log.warning(
            "The madmom meter arbiter failed; the track keeps the DBN's bars of three",
            exc_info=True,
        )
        return chosen, None
    if meter == 4:
        log.info("The DBN heard bars of three and madmom four: the track takes four")
        return four, f"{ARBITER_NAME}-4"
    if meter == 3:
        return chosen, f"{ARBITER_NAME}-3"
    return chosen, None


def track_file_beats(
    path: str | Path,
    *,
    model: BeatModel | None = None,
    arbiter: Callable[[Path], int | None] | None = None,
) -> BeatTrack | None:
    """``track_beats`` for an audio file, decoded only when the model can run.

    ``arbiter`` reads the file again when the DBN prefers bars of three; by default
    madmom's (``crate.smart_mix.meter_arbiter.load_meter_arbiter``).
    """
    beat_model = model if model is not None else load_beat_model()
    if beat_model is None:
        return None
    try:
        duration = _duration_seconds(Path(path))
        if duration > BEAT_MODEL_MAX_SECONDS:
            log.info(
                "Beat This! skips %s (%.0f s, limit %d s); the analysis keeps its own "
                "beat tracker",
                path,
                duration,
                BEAT_MODEL_MAX_SECONDS,
            )
            return None
        signal, sample_rate = _load_signal(Path(path))
    except Exception:
        log.warning(
            "Beat This! could not decode %s; the analysis keeps its own beat tracker",
            path,
            exc_info=True,
        )
        return None
    file_arbiter = arbiter
    if file_arbiter is None and model is None:
        from crate.smart_mix.meter_arbiter import load_meter_arbiter

        file_arbiter = load_meter_arbiter()
    source = Path(path)
    return track_beats(
        signal,
        sample_rate,
        model=beat_model,
        arbiter=None if file_arbiter is None else (lambda: file_arbiter(source)),
    )


def _milliseconds(seconds: Sequence[float] | np.ndarray) -> tuple[int, ...]:
    values = np.asarray(seconds, dtype=np.float64).reshape(-1)
    return tuple(
        sorted(
            {
                max(1, round(float(value) * 1_000))
                for value in values
                if math.isfinite(value) and value >= 0
            }
        )
    )


def _duration_seconds(path: Path) -> float:
    try:
        import soundfile as sf

        return float(sf.info(str(path)).duration)
    except Exception:
        return _ffprobe_duration(path)


def _load_signal(
    path: Path, target_rate: int = MODEL_SAMPLE_RATE
) -> tuple[np.ndarray, int]:
    """Mono float32 audio at ``target_rate``, the model's by default (Beat This! would
    resample it anyway)."""
    try:
        import soundfile as sf

        with sf.SoundFile(str(path)) as source:
            mono, rate = _read_mono(source), int(source.samplerate)
    except Exception:
        return _ffmpeg_mono(path, target_rate), target_rate
    if rate != target_rate and mono.size:
        import soxr

        mono = soxr.resample(mono, rate, target_rate)
        rate = target_rate
    return np.ascontiguousarray(mono, dtype=np.float32), rate


def _ffprobe_duration(path: Path) -> float:
    """The container's duration, as players read it, for files libsndfile cannot open."""
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        capture_output=True,
        check=True,
        text=True,
        timeout=_FFMPEG_TIMEOUT_SECONDS,
    )
    return float(result.stdout.strip())


def _ffmpeg_mono(path: Path, rate: int = MODEL_SAMPLE_RATE) -> np.ndarray:
    """The first audio stream as mono float32 at ``rate``, decoded by ffmpeg.

    ffmpeg decodes it as players do: it trims the encoder delay an MP4 edit list marks
    and decodes HE-AAC with its SBR band, so the beats fall where a player plays them.
    """
    result = subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-v",
            "error",
            "-i",
            str(path),
            "-map",
            "0:a:0",
            "-ac",
            "1",
            "-ar",
            str(rate),
            "-f",
            "f32le",
            "pipe:1",
        ],
        capture_output=True,
        check=True,
        timeout=_FFMPEG_TIMEOUT_SECONDS,
    )
    return np.frombuffer(result.stdout, dtype="<f4").astype(np.float32)


def _read_mono(source) -> np.ndarray:
    blocks = []
    while True:
        block = source.read(_READ_BLOCK_FRAMES, dtype="float32", always_2d=True)
        if block.size == 0:
            break
        blocks.append(block.mean(axis=1))
    return np.concatenate(blocks) if blocks else np.zeros(0, dtype=np.float32)


__all__ = [
    "BEAT_MODEL_MAX_SECONDS",
    "BEAT_TRACKER",
    "BarPath",
    "BarPaths",
    "CHECKPOINT_ENV",
    "DEFAULT_CHECKPOINT",
    "MODEL_SAMPLE_RATE",
    "WEIGHTS_ENV",
    "BeatModel",
    "BeatThisModel",
    "BeatTrack",
    "beat_tracker_name",
    "beats_per_bar_from_downbeats",
    "checkpoint_name",
    "combined_activations",
    "decode_bar_paths",
    "load_beat_model",
    "track_beats",
    "track_file_beats",
    "weights_path",
]

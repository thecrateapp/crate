"""Source separation of Smart Mix playlist tracks on the server (Smart Mix Stems, ST2).

The server separates the tracks of Smart Mix playlists into drums, bass, other and
vocals with ``htdemucs-onnx-1``: Demucs v4 ``htdemucs`` exported to ONNX by Crate Decks,
the network only, run here on ONNX Runtime CPU (STEM-D3). Everything around the network
is numpy in this module, ported from Crate Decks' reference
(``tools/crate-stems/stems_dsp.py``) with the same parameters (spike report section 5),
so both producers of ``stem-analysis/1`` come from one separator:

- the whole track is normalised by the mean and the unbiased standard deviation of its
  mono mix;
- it is cut into segments of 343,980 samples (7.8 s at 44.1 kHz) every 257,985
  samples, each centred in a full segment with real neighbouring samples or zeros;
- each segment's STFT (n_fft 4096, hop 1024, periodic Hann, normalised, reflect
  padding, centred, the Nyquist bin and two edge frames dropped) goes into the graph
  with the segment itself; each stem is the iSTFT of the graph's masked spectrogram plus
  its time branch;
- the segments are joined by a triangular overlap-add (``shifts=0``, overlap 0.25) and
  de-normalised.

**Memory.** The analysis worker recycles a process above 1.5 GB, so nothing here holds
a whole track. ffmpeg decodes the file to float32 in the scratch directory, the
normalisation reads it twice in blocks, and the overlap-add streams: once a segment has
run, the samples no later segment touches are final and go to one float32 file per stem.
What stays in memory is a few segments' worth of arrays, whatever the track's length.
Scratch lives on the music volume (:mod:`crate.smart_mix.stem_storage`), never in
``/tmp``: the separated stems of a five-minute track are about 425 MB.

The API image has no numpy and never imports this module.
"""

from __future__ import annotations

import ctypes
import gc
import importlib.util
import logging
import math
import os
import shutil
import subprocess
import tempfile
from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from types import TracebackType
from typing import Any

import numpy as np

from crate.smart_mix.source import smart_mix_source_revision
from crate.smart_mix.stems import (
    STEM_ANALYSIS_SCHEMA,
    STEM_HOP_MS,
    STEM_SOURCES,
    StemAnalysis,
    encode_levels,
)

log = logging.getLogger(__name__)

SEPARATOR_MODEL = "htdemucs"
# The same identifier Crate Decks uses for the same graph and DSP (STEM-D3).
SEPARATOR_VERSION = "htdemucs-onnx-1"
# The server's producer; the suffix changes when this module changes what it produces.
SERVER_PRODUCER = "crate-server/stems-1"
MODEL_FILE = f"{SEPARATOR_VERSION}.onnx"
MODEL_ENV = "CRATE_HTDEMUCS_ONNX"
MODELS_DIR = Path("/app/models")
THREADS_ENV = "CRATE_STEMS_THREADS"
DEFAULT_THREADS = 4

SAMPLE_RATE = 44_100
CHANNELS = 2
SOURCES = STEM_SOURCES
NFFT = 4096
HOP = NFFT // 4  # 1024
BINS = NFFT // 2  # 2048: the Nyquist bin is dropped
PRE_PAD = HOP // 2 * 3  # 1536
EDGE_FRAMES = 2  # frames dropped on each side after the STFT
SEGMENT = int(SAMPLE_RATE * 7.8)  # 343980
OVERLAP = 0.25
STRIDE = int((1 - OVERLAP) * SEGMENT)  # 257985
SEGMENT_FRAMES = math.ceil(SEGMENT / HOP)  # 336
NORM_EPS = 1e-8
# torch.hann_window(4096) is periodic.
WINDOW = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(NFFT) / NFFT)

# Normalising a track needs its standard deviation; a second is plenty for that.
MIN_SECONDS = 1
_FRAME_BYTES = 4 * CHANNELS
_READ_BLOCK_FRAMES = 1 << 20
_DECODE_TIMEOUT_SECONDS = 900

GraphFn = Callable[[np.ndarray, np.ndarray], tuple[np.ndarray, np.ndarray]]
SegmentModel = Callable[[np.ndarray], np.ndarray]


class SeparationError(RuntimeError):
    """A track that cannot be separated: undecodable, too short, or no graph."""


# --- DSP around the graph (Crate Decks' stems_dsp.py) --------------------------------


def stft(x: np.ndarray) -> np.ndarray:
    """(C, L) real -> (C, 2048, ceil(L / 1024)) complex: ``HTDemucs._spec``.

    Reflect-pads 1536 samples on the left and up to a multiple of the hop plus 1536 on
    the right, runs a centred (reflect) STFT with a periodic Hann window, normalised
    (divided by 64), then drops the Nyquist bin and two frames on each side.
    """
    length = x.shape[-1]
    frames_out = math.ceil(length / HOP)
    padded = np.pad(
        np.asarray(x, np.float64),
        ((0, 0), (PRE_PAD, PRE_PAD + frames_out * HOP - length)),
        mode="reflect",
    )
    padded = np.pad(padded, ((0, 0), (NFFT // 2, NFFT // 2)), mode="reflect")
    n_frames = 1 + (padded.shape[-1] - NFFT) // HOP
    frames = np.lib.stride_tricks.sliding_window_view(padded, NFFT, axis=-1)[:, ::HOP][
        :, :n_frames
    ]
    z = np.fft.rfft(frames * WINDOW, axis=-1) / math.sqrt(NFFT)
    z = z.transpose(0, 2, 1)
    return z[:, :BINS, EDGE_FRAMES : EDGE_FRAMES + frames_out]


def istft(z: np.ndarray, length: int) -> np.ndarray:
    """(..., C, 2048, T) complex -> (..., C, length) real: ``HTDemucs._ispec``.

    Restores the Nyquist bin and two frames on each side as zeros, runs a centred,
    normalised inverse STFT (multiply by 64, window, overlap-add, divide by the summed
    squared window) and trims the 1536-sample pre-pad.
    """
    z = np.asarray(z)
    bins, n_frames = z.shape[-2:]
    padded = np.zeros(
        z.shape[:-2] + (n_frames + 2 * EDGE_FRAMES, bins + 1), np.complex128
    )
    padded[..., EDGE_FRAMES : EDGE_FRAMES + n_frames, :bins] = np.swapaxes(z, -1, -2)
    return _istft_frames(padded, length)


def _istft_frames(padded: np.ndarray, length: int) -> np.ndarray:
    """:func:`istft` of a spectrum already laid out as (..., frames, 2049) with its
    Nyquist bin and edge frames restored: each frame's bins are contiguous, so the
    inverse FFT runs along the last axis."""
    n_frames = padded.shape[-2]
    frames = np.fft.irfft(padded, n=NFFT, axis=-1)
    frames *= WINDOW * math.sqrt(NFFT)
    y = _overlap_frames(frames, n_frames)
    envelope = _istft_envelope(n_frames)
    padded_length = HOP * math.ceil(length / HOP) + 2 * PRE_PAD
    start = NFFT // 2
    y = y[..., start : start + padded_length] / envelope[start : start + padded_length]
    return y[..., PRE_PAD : PRE_PAD + length]


_HOPS_PER_FRAME = NFFT // HOP


def _overlap_frames(frames: np.ndarray, n_frames: int) -> np.ndarray:
    """Overlap-add (..., T, NFFT) frames at the hop: (..., NFFT + HOP * (T - 1)).

    A frame spans four hops, so this adds four shifted views instead of looping over
    frames; the later hops of a frame go first, so each sample sums its frames in the
    order of the reference loop.
    """
    lead = frames.shape[:-2]
    parts = frames.reshape(lead + (n_frames, _HOPS_PER_FRAME, HOP))
    blocks = np.zeros(lead + (n_frames + _HOPS_PER_FRAME - 1, HOP))
    for k in reversed(range(_HOPS_PER_FRAME)):
        blocks[..., k : k + n_frames, :] += parts[..., k, :]
    return blocks.reshape(lead + (-1,))


@lru_cache(maxsize=8)
def _istft_envelope(n_frames: int) -> np.ndarray:
    squares = np.broadcast_to(WINDOW**2, (n_frames, NFFT))
    envelope = _overlap_frames(squares, n_frames)
    envelope.setflags(write=False)
    return envelope


def to_cac(z: np.ndarray) -> np.ndarray:
    """(C, F, T) complex -> (1, 2C, F, T) float32, channels [L.re, L.im, R.re, R.im].

    The layout of the graph input ``spec``.
    """
    c, f, t = z.shape
    parts = np.stack([np.real(z), np.imag(z)], axis=1)
    return parts.reshape(1, 2 * c, f, t).astype(np.float32)


def from_cac(m: np.ndarray) -> np.ndarray:
    """(S, 2C, F, T) real -> (S, C, F, T) complex: the inverse of :func:`to_cac`."""
    s, c2, f, t = m.shape
    m = np.asarray(m).reshape(s, c2 // 2, 2, f, t)
    z = np.empty((s, c2 // 2, f, t), np.complex128)
    z.real = m[:, :, 0]
    z.imag = m[:, :, 1]
    return z


def segment_stems(spec_out: np.ndarray, wave_out: np.ndarray) -> np.ndarray:
    """The graph outputs of one segment -> (S, C, L) stems in float64.

    Each stem is iSTFT(``spec_out``) + ``wave_out``, one stem at a time so the
    complex intermediates stay a quarter of their size.
    """
    sources, channels, length = wave_out.shape[1:]
    bins, n_frames = spec_out.shape[-2:]
    stems = np.empty((sources, channels, length))
    padded = np.zeros((channels, n_frames + 2 * EDGE_FRAMES, bins + 1), np.complex128)
    spectrum = padded[:, EDGE_FRAMES : EDGE_FRAMES + n_frames, :bins]
    for index in range(sources):
        # from_cac without the copy: channels [L.re, L.im, R.re, R.im].
        cac = spec_out[0, index]
        spectrum.real = np.swapaxes(cac[0::2], -1, -2)
        spectrum.imag = np.swapaxes(cac[1::2], -1, -2)
        stems[index] = _istft_frames(padded, length)
        stems[index] += wave_out[0, index]
    return stems


def normalisation(wav: np.ndarray) -> tuple[float, float]:
    """Mean and scale of a whole track from its mono mix (``demucs.api.Separator``).

    The scale is the unbiased standard deviation (``ddof=1``) plus 1e-8.
    """
    ref = np.asarray(wav, np.float64).mean(axis=0)
    return float(ref.mean()), float(ref.std(ddof=1) + NORM_EPS)


def ola_weight(segment: int = SEGMENT) -> np.ndarray:
    """The triangular overlap-add weight of one segment (``demucs.apply.apply_model``).

    [1, 2, ..., segment // 2] then [segment - segment // 2, ..., 1], divided by its
    maximum. A shorter last segment uses the first samples of this weight.
    """
    weight = np.concatenate(
        [np.arange(1, segment // 2 + 1), np.arange(segment - segment // 2, 0, -1)]
    ).astype(np.float64)
    return weight / weight.max()


def segment_offsets(length: int, stride: int = STRIDE) -> list[int]:
    return list(range(0, length, stride))


def overlap_add(
    read: Callable[[int, int], np.ndarray],
    length: int,
    model: SegmentModel,
    *,
    segment: int = SEGMENT,
    stride: int = STRIDE,
) -> Iterator[tuple[int, np.ndarray]]:
    """Segment a track, run ``model`` on each padded segment and overlap-add, streaming.

    ``read(lo, hi)`` returns the track's (C, hi - lo) samples; ``model`` maps a
    (C, segment) array to (S, C, segment). Yields ``(start, block)`` in order, where
    ``block`` is the final (S, C, n) output from ``start``: once a segment has run, no
    later one touches the samples before the next offset. The blocks join into
    ``demucs.apply.apply_model`` with ``split=True`` (Crate Decks' ``overlap_add``),
    with the same sums in the same order.
    """
    if stride <= 0 or stride > segment:
        raise ValueError("the stride must be positive and at most the segment")
    weight = ola_weight(segment)
    acc: np.ndarray | None = None
    weights = np.zeros(segment)
    for offset in segment_offsets(length, stride):
        chunk = min(segment, length - offset)
        y = _center_trim(
            model(_padded_chunk(read, length, offset, chunk, segment)), chunk
        )
        if acc is None:
            acc = np.zeros(y.shape[:-1] + (segment,))
        acc[..., :chunk] += weight[:chunk] * y
        weights[:chunk] += weight[:chunk]
        last = offset + stride >= length
        final = chunk if last else stride
        yield offset, acc[..., :final] / weights[:final]
        if not last:
            acc[..., : segment - stride] = acc[..., stride:]
            acc[..., segment - stride :] = 0.0
            weights[: segment - stride] = weights[stride:]
            weights[segment - stride :] = 0.0


def _padded_chunk(
    read: Callable[[int, int], np.ndarray],
    length: int,
    offset: int,
    chunk: int,
    target: int,
) -> np.ndarray:
    """demucs ``TensorChunk(x, offset, chunk).padded(target)``: the chunk centred in
    ``target`` samples, with real samples where the track has them and zeros past its
    ends."""
    start = offset - (target - chunk) // 2
    end = start + target
    lo, hi = max(0, start), min(length, end)
    return np.pad(read(lo, hi), ((0, 0), (lo - start, end - hi)))


def _center_trim(y: np.ndarray, length: int) -> np.ndarray:
    """demucs ``center_trim``: delta // 2 samples off the left, the rest off the right."""
    delta = y.shape[-1] - length
    if delta == 0:
        return y
    return y[..., delta // 2 : y.shape[-1] - (delta - delta // 2)]


def _graph_model(graph: GraphFn) -> SegmentModel:
    def run(segment: np.ndarray) -> np.ndarray:
        mix = segment[None].astype(np.float32)
        spec_out, wave_out = graph(mix, to_cac(stft(mix[0])))
        return segment_stems(spec_out, wave_out)

    return run


# --- ONNX Runtime ---------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class SessionConfig:
    """How ONNX Runtime plans the graph's memory and runs its nodes.

    ``sequential`` is ONNX Runtime's default. ``parallel-2`` runs independent nodes on
    two inter-op threads, which also plans no buffer reuse across the encoder and the
    decoder. ``no-mem-reuse`` keeps the sequential executor without that reuse.
    """

    name: str
    parallel: bool = False
    inter_op_threads: int = 1
    mem_reuse: bool = True


SEQUENTIAL = SessionConfig("sequential")
PARALLEL_2 = SessionConfig("parallel-2", parallel=True, inter_op_threads=2)
NO_MEM_REUSE = SessionConfig("no-mem-reuse", mem_reuse=False)
SESSION_CONFIGS = {
    config.name: config for config in (SEQUENTIAL, PARALLEL_2, NO_MEM_REUSE)
}
# Measured on a 312 s track with 4 threads (smart-mix-operations.md, "Server
# separation"): the sequential executor's buffer reuse holds about 3.8 GB, above the
# 1.5 GB at which the worker recycles a process; without it the peak is about 1 GB
# and a segment runs a little faster. parallel-2 peaks lower still, about 0.8 GB, but
# spends 40-60 % more CPU per segment, the scarcer resource on the server.
SESSION_CONFIG = NO_MEM_REUSE


class OnnxGraph:
    """``htdemucs-onnx-1`` on ONNX Runtime's CPU provider."""

    def __init__(
        self,
        path: Path,
        *,
        threads: int,
        config: SessionConfig = SESSION_CONFIG,
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
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        options.log_severity_level = 3
        # Spinning threads read as load, and the resource governor defers work on
        # load; idle threads sleep instead.
        options.add_session_config_entry("session.intra_op.allow_spinning", "0")
        options.add_session_config_entry("session.inter_op.allow_spinning", "0")
        self.config = config
        self._session = ort.InferenceSession(
            str(path), sess_options=options, providers=["CPUExecutionProvider"]
        )

    def __call__(
        self, mix: np.ndarray, spec: np.ndarray
    ) -> tuple[np.ndarray, np.ndarray]:
        spec_out, wave_out = self._session.run(
            ["spec_out", "wave_out"], {"mix": mix, "spec": spec}
        )
        return spec_out, wave_out


def model_path() -> Path:
    explicit = (os.environ.get(MODEL_ENV) or "").strip()
    return Path(explicit) if explicit else MODELS_DIR / MODEL_FILE


def separation_threads() -> int:
    """``CRATE_STEMS_THREADS`` (1-64), 4 by default."""
    try:
        threads = int(os.environ.get(THREADS_ENV) or DEFAULT_THREADS)
    except ValueError:
        return DEFAULT_THREADS
    return min(64, max(1, threads))


def separation_unavailable_reason() -> str | None:
    """Why this process cannot separate, or None when it can."""
    try:
        installed = importlib.util.find_spec("onnxruntime") is not None
    except (ImportError, ValueError):
        installed = False
    if not installed:
        return "onnxruntime is not installed"
    path = model_path()
    if not path.is_file():
        return f"no htdemucs graph at {path}"
    return None


# --- Separation -----------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class SeparatedStems:
    """The four stems of a track, one float32 file each in a scratch directory.

    Each file holds interleaved stereo frames at 44.1 kHz. ``source_revision`` is the
    file's revision when separation started. Closing removes the directory; use it as a
    context manager.
    """

    directory: Path
    frames: int
    source_revision: str
    sample_rate: int = SAMPLE_RATE

    @property
    def duration_ms(self) -> int:
        return round(self.frames * 1000 / self.sample_rate)

    def path(self, stem: str) -> Path:
        if stem not in SOURCES:
            raise ValueError(f"unknown stem {stem!r}")
        return self.directory / f"{stem}.f32"

    def read(self, stem: str, start: int = 0, count: int | None = None) -> np.ndarray:
        """(2, n) float32 frames of a stem."""
        return _read_frames(self.path(stem), start, count, self.frames)

    def blocks(self, stem: str, size: int = _READ_BLOCK_FRAMES) -> Iterator[np.ndarray]:
        """The stem in (2, n) float32 blocks of ``size`` frames, the last one shorter."""
        for start in range(0, self.frames, size):
            yield self.read(stem, start, min(size, self.frames - start))

    def close(self) -> None:
        shutil.rmtree(self.directory, ignore_errors=True)

    def __enter__(self) -> SeparatedStems:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.close()


def separate(
    path: str | Path,
    *,
    threads: int,
    scratch: Path,
    graph: GraphFn | None = None,
    config: SessionConfig = SESSION_CONFIG,
) -> SeparatedStems:
    """Separate an audio file into drums, bass, other and vocals.

    Works in a new directory inside ``scratch``, which must be on the music volume
    (:func:`crate.smart_mix.stem_storage.scratch_directory`). On success only the four
    stem files remain there, owned by the returned :class:`SeparatedStems`; on any
    failure the directory is removed before the error propagates. ``graph`` replaces
    the ONNX graph (tests); otherwise ``htdemucs-onnx-1`` runs on ``threads`` threads.
    """
    source = Path(path)
    source_revision = smart_mix_source_revision(source)
    work = Path(tempfile.mkdtemp(prefix="separate-", dir=scratch))
    try:
        decoded = work / "input.f32"
        frames = _decode(source, decoded, threads=threads)
        if frames < MIN_SECONDS * SAMPLE_RATE:
            raise SeparationError(
                f"{source.name} is too short to separate ({frames} frames)"
            )
        if graph is None:
            reason = separation_unavailable_reason()
            if reason is not None:
                raise SeparationError(reason)
            graph = OnnxGraph(model_path(), threads=threads, config=config)
        _separate_file(decoded, frames, graph, work)
        decoded.unlink()
        # The session's memory goes back before Beat This! loads torch.
        graph = None
        _release_freed_memory()
        return SeparatedStems(
            directory=work, frames=frames, source_revision=source_revision
        )
    except BaseException:
        shutil.rmtree(work, ignore_errors=True)
        raise


def _release_freed_memory() -> None:
    """Return the heap ONNX Runtime freed to the system (glibc ``malloc_trim``).

    Freed memory otherwise stays in the process, and the worker recycles a process by
    its peak RSS.
    """
    gc.collect()
    try:
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except (OSError, AttributeError):
        pass


def _decode(source: Path, out: Path, *, threads: int) -> int:
    """Decode the first audio stream to stereo float32 at 44.1 kHz; returns frames."""
    from crate.resource_governor import low_priority_command

    command = [
        "ffmpeg",
        "-nostdin",
        "-v",
        "error",
        "-threads",
        str(max(1, threads)),
        "-i",
        str(source),
        "-map",
        "0:a:0",
        "-vn",
        "-ac",
        str(CHANNELS),
        "-ar",
        str(SAMPLE_RATE),
        "-f",
        "f32le",
        "-acodec",
        "pcm_f32le",
        "-y",
        str(out),
    ]
    try:
        result = subprocess.run(
            low_priority_command(command),
            capture_output=True,
            timeout=_DECODE_TIMEOUT_SECONDS,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise SeparationError(
            f"ffmpeg could not decode {source.name}: {error}"
        ) from error
    if result.returncode != 0:
        detail = result.stderr.decode("utf-8", "replace").strip().splitlines()
        raise SeparationError(
            f"ffmpeg could not decode {source.name}: "
            f"{detail[-1] if detail else f'exit {result.returncode}'}"
        )
    return out.stat().st_size // _FRAME_BYTES


def _read_frames(path: Path, start: int, count: int | None, frames: int) -> np.ndarray:
    count = frames - start if count is None else count
    data = np.fromfile(
        path, dtype="<f4", count=count * CHANNELS, offset=start * _FRAME_BYTES
    )
    return data.reshape(-1, CHANNELS).T


def _file_normalisation(path: Path, frames: int) -> tuple[float, float]:
    """:func:`normalisation` of a decoded file, two passes over blocks of it."""
    total = 0.0
    for start in range(0, frames, _READ_BLOCK_FRAMES):
        block = _read_frames(
            path, start, min(_READ_BLOCK_FRAMES, frames - start), frames
        )
        total += float(block.astype(np.float64).mean(axis=0).sum())
    mean = total / frames
    squares = 0.0
    for start in range(0, frames, _READ_BLOCK_FRAMES):
        block = _read_frames(
            path, start, min(_READ_BLOCK_FRAMES, frames - start), frames
        )
        deviation = block.astype(np.float64).mean(axis=0) - mean
        squares += float(np.dot(deviation, deviation))
    return mean, math.sqrt(squares / (frames - 1)) + NORM_EPS


def _separate_file(decoded: Path, frames: int, graph: GraphFn, work: Path) -> None:
    mean, scale = _file_normalisation(decoded, frames)

    def read(lo: int, hi: int) -> np.ndarray:
        return (
            _read_frames(decoded, lo, hi - lo, frames).astype(np.float64) - mean
        ) / scale

    outputs = [open(work / f"{stem}.f32", "wb") for stem in SOURCES]  # noqa: SIM115
    try:
        for _start, block in overlap_add(read, frames, _graph_model(graph)):
            stems = block * scale + mean
            for index, handle in enumerate(outputs):
                handle.write(
                    np.ascontiguousarray(stems[index].T, dtype="<f4").tobytes()
                )
    finally:
        for handle in outputs:
            handle.close()


# --- Analysis -------------------------------------------------------------------------


def analyze_stems(
    stems: SeparatedStems,
    *,
    hop_ms: int = STEM_HOP_MS,
    drum_beats_ms: Sequence[int] | None = None,
) -> StemAnalysis:
    """The ``stem-analysis/1`` of separated stems, as the server's producer.

    Each stem's level is the RMS of its mono mix (the mean of both channels) over
    windows of ``hop_ms`` (11,025 samples), from the start of the track; the last window
    may be short and covers the samples it has. Levels are dBFS encoded with
    :func:`crate.smart_mix.stems.encode_levels`. Drum beats past the audio are dropped;
    none at all are left out.
    """
    if hop_ms != STEM_HOP_MS:
        raise ValueError(f"stem-analysis/1 has {STEM_HOP_MS} ms windows")
    hop = stems.sample_rate * hop_ms // 1000
    duration_ms = stems.duration_ms
    beats = sorted({int(b) for b in drum_beats_ms or () if 0 <= int(b) <= duration_ms})
    return StemAnalysis.model_validate(
        {
            "schema": STEM_ANALYSIS_SCHEMA,
            "producer": SERVER_PRODUCER,
            "separator": {
                "model": SEPARATOR_MODEL,
                "version": SEPARATOR_VERSION,
                "sources": list(SOURCES),
            },
            "sourceRevision": stems.source_revision,
            "hopMs": hop_ms,
            "levels": {
                stem: encode_levels(window_levels_db(stems.blocks(stem, hop * 64), hop))
                for stem in SOURCES
            },
            "drumBeatsMs": beats or None,
            "durationMs": duration_ms,
        }
    )


def window_levels_db(blocks: Iterator[np.ndarray], hop: int) -> np.ndarray:
    """RMS in dBFS of the mono mix per window of ``hop`` samples.

    ``blocks`` are consecutive (C, n) arrays whose lengths, except the last one's, are
    multiples of ``hop``. Silence is -inf.
    """
    levels: list[np.ndarray] = []
    for block in blocks:
        mono = np.asarray(block, np.float64).mean(axis=0)
        whole = mono.size // hop
        squares = (mono[: whole * hop].reshape(whole, hop) ** 2).mean(axis=1)
        if mono.size > whole * hop:
            rest = mono[whole * hop :]
            squares = np.append(squares, float(np.dot(rest, rest)) / rest.size)
        levels.append(squares)
    power = np.concatenate(levels) if levels else np.zeros(0)
    with np.errstate(divide="ignore"):
        return 10 * np.log10(power)


def drum_beats(stems: SeparatedStems, *, model: Any = None) -> list[int]:
    """Beats tracked on the drum stem by Beat This! with its DBN (STEM-D4).

    The same model and post-processing as the profiles' beats
    (:mod:`crate.smart_mix.beat_model`), on the drum stem's mono mix at the model's
    rate. They are stored and measured, never used for the grid. Empty when the model
    is not in this image, fails, finds no beats or the track is over its limit.
    """
    from crate.smart_mix.beat_model import (
        BEAT_MODEL_MAX_SECONDS,
        MODEL_SAMPLE_RATE,
        track_beats,
    )

    if stems.frames > BEAT_MODEL_MAX_SECONDS * stems.sample_rate:
        return []
    mono = np.concatenate(
        [block.mean(axis=0, dtype=np.float32) for block in stems.blocks("drums")]
    )
    if stems.sample_rate != MODEL_SAMPLE_RATE:
        import soxr

        mono = soxr.resample(mono, stems.sample_rate, MODEL_SAMPLE_RATE)
    track = track_beats(
        np.ascontiguousarray(mono, dtype=np.float32), MODEL_SAMPLE_RATE, model=model
    )
    return list(track.beats_ms) if track is not None else []


__all__ = [
    "BINS",
    "DEFAULT_THREADS",
    "EDGE_FRAMES",
    "HOP",
    "MODEL_ENV",
    "NFFT",
    "NO_MEM_REUSE",
    "PARALLEL_2",
    "PRE_PAD",
    "SAMPLE_RATE",
    "SEGMENT",
    "SEGMENT_FRAMES",
    "SEPARATOR_MODEL",
    "SEPARATOR_VERSION",
    "SEQUENTIAL",
    "SERVER_PRODUCER",
    "SESSION_CONFIG",
    "SESSION_CONFIGS",
    "SOURCES",
    "STRIDE",
    "THREADS_ENV",
    "OnnxGraph",
    "SeparatedStems",
    "SeparationError",
    "SessionConfig",
    "analyze_stems",
    "drum_beats",
    "from_cac",
    "istft",
    "model_path",
    "normalisation",
    "ola_weight",
    "overlap_add",
    "segment_offsets",
    "segment_stems",
    "separate",
    "separation_threads",
    "separation_unavailable_reason",
    "stft",
    "to_cac",
    "window_levels_db",
]

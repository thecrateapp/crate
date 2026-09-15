"""Versioned, compact spectrum artefacts for the custom Cast receiver."""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import subprocess
import struct
import tempfile
import threading
from collections.abc import Callable
from dataclasses import dataclass
from io import BufferedIOBase
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import numpy as np


MAGIC = b"CRSP"
FORMAT_VERSION = 1
BAND_COUNT = 24
SAMPLE_RATE = 12_000
SAMPLE_INTERVAL_MS = 100
MAX_DURATION_MS = 4 * 60 * 60 * 1000
MAX_FRAME_COUNT = MAX_DURATION_MS // SAMPLE_INTERVAL_MS
MEDIA_TYPE = "application/vnd.crate.cast-spectrum"
NORMALIZATION_FLOOR_DB = -80

_HEADER = struct.Struct(">4sBBHIIhH")
_MIN_FREQUENCY_HZ = 50.0
_MAX_FREQUENCY_HZ = SAMPLE_RATE / 2
_DYNAMIC_RANGE_DB = 80.0


@dataclass(frozen=True, slots=True)
class SpectrumEnvelope:
    version: int
    band_count: int
    sample_interval_ms: int
    frame_count: int
    duration_ms: int
    normalization_floor_db: int
    frames: bytes


@dataclass(frozen=True, slots=True)
class SpectrumWriteResult:
    etag: str
    byte_size: int
    frame_count: int
    duration_ms: int
    band_count: int = BAND_COUNT
    sample_interval_ms: int = SAMPLE_INTERVAL_MS


class SpectrumGenerationCancelled(Exception):
    """Raised when a running spectrum extraction is cancelled."""


def _validated_frames(frames: np.ndarray) -> np.ndarray:
    import numpy as np

    values = np.asarray(frames)
    if values.ndim != 2 or values.shape[1] != BAND_COUNT:
        raise ValueError(f"Spectrum frames must have shape (n, {BAND_COUNT})")
    if values.shape[0] > MAX_FRAME_COUNT:
        raise ValueError("Spectrum exceeds the maximum supported duration")
    if values.dtype != np.uint8:
        raise ValueError("Spectrum frames must use uint8 values")
    return np.ascontiguousarray(values)


def encode_spectrum(
    frames: np.ndarray,
    *,
    duration_ms: int,
    sample_interval_ms: int = SAMPLE_INTERVAL_MS,
) -> bytes:
    values = _validated_frames(frames)
    if not 0 <= duration_ms <= MAX_DURATION_MS:
        raise ValueError("Spectrum duration is outside the supported range")
    if sample_interval_ms != SAMPLE_INTERVAL_MS:
        raise ValueError("Unsupported spectrum sample interval")
    header = _HEADER.pack(
        MAGIC,
        FORMAT_VERSION,
        BAND_COUNT,
        sample_interval_ms,
        values.shape[0],
        int(duration_ms),
        NORMALIZATION_FLOOR_DB,
        0,
    )
    return header + values.tobytes()


def decode_spectrum(payload: bytes) -> SpectrumEnvelope:
    if len(payload) < _HEADER.size:
        raise ValueError("Spectrum payload is truncated")
    (
        magic,
        version,
        bands,
        interval_ms,
        frame_count,
        duration_ms,
        normalization_floor_db,
        reserved,
    ) = _HEADER.unpack_from(payload)
    if magic != MAGIC:
        raise ValueError("Invalid spectrum magic")
    if version != FORMAT_VERSION:
        raise ValueError("Unsupported spectrum format version")
    if bands != BAND_COUNT or interval_ms != SAMPLE_INTERVAL_MS:
        raise ValueError("Unsupported spectrum dimensions")
    if normalization_floor_db != NORMALIZATION_FLOOR_DB or reserved != 0:
        raise ValueError("Unsupported spectrum normalization")
    if frame_count > MAX_FRAME_COUNT or duration_ms > MAX_DURATION_MS:
        raise ValueError("Spectrum payload exceeds its limits")
    expected_size = _HEADER.size + frame_count * bands
    if len(payload) != expected_size:
        raise ValueError("Spectrum payload length does not match its header")
    return SpectrumEnvelope(
        version=version,
        band_count=bands,
        sample_interval_ms=interval_ms,
        frame_count=frame_count,
        duration_ms=duration_ms,
        normalization_floor_db=normalization_floor_db,
        frames=payload[_HEADER.size :],
    )


def analyse_pcm(samples: np.ndarray, *, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    """Convert mono floating-point PCM into 24 perceptual spectrum bands at 10 fps."""
    import numpy as np

    if sample_rate != SAMPLE_RATE:
        raise ValueError(f"PCM must be resampled to {SAMPLE_RATE} Hz")
    values = np.asarray(samples, dtype=np.float32).reshape(-1)
    frame_samples = sample_rate * SAMPLE_INTERVAL_MS // 1000
    frame_count = min(len(values) // frame_samples, MAX_FRAME_COUNT)
    if frame_count == 0:
        return np.empty((0, BAND_COUNT), dtype=np.uint8)

    framed = values[: frame_count * frame_samples].reshape(frame_count, frame_samples)
    window = np.hanning(frame_samples).astype(np.float32)
    magnitudes = np.abs(np.fft.rfft(framed * window, axis=1))
    magnitudes *= 2.0 / max(float(window.sum()), 1.0)
    frequencies = np.fft.rfftfreq(frame_samples, 1.0 / sample_rate)
    edges = np.geomspace(_MIN_FREQUENCY_HZ, _MAX_FREQUENCY_HZ, BAND_COUNT + 1)

    bands = np.empty((frame_count, BAND_COUNT), dtype=np.float32)
    for index in range(BAND_COUNT):
        upper_inclusive = index == BAND_COUNT - 1
        mask = (frequencies >= edges[index]) & (
            frequencies <= edges[index + 1]
            if upper_inclusive
            else frequencies < edges[index + 1]
        )
        if not np.any(mask):
            bands[:, index] = 0.0
        else:
            bands[:, index] = magnitudes[:, mask].max(axis=1)

    levels_db = 20.0 * np.log10(np.maximum(bands, 1e-8))
    normalized = np.clip(
        (levels_db - NORMALIZATION_FLOOR_DB) / _DYNAMIC_RANGE_DB,
        0.0,
        1.0,
    )
    return np.rint(normalized * 255.0).astype(np.uint8)


def analyse_pcm_stream(
    stream: BufferedIOBase,
    *,
    cancelled: Callable[[], bool] | None = None,
) -> tuple[np.ndarray, int]:
    """Incrementally consume ffmpeg float32 PCM without retaining source audio."""
    import numpy as np

    is_cancelled = cancelled or (lambda: False)
    frame_samples = SAMPLE_RATE * SAMPLE_INTERVAL_MS // 1000
    frame_bytes = frame_samples * np.dtype(np.float32).itemsize
    batch_frames = 10
    buffer = bytearray()
    encoded_frames = bytearray()
    frame_count = 0

    while frame_count < MAX_FRAME_COUNT:
        if is_cancelled():
            raise SpectrumGenerationCancelled
        wanted = min(batch_frames, MAX_FRAME_COUNT - frame_count) * frame_bytes
        chunk = stream.read(wanted)
        if not chunk:
            break
        buffer.extend(chunk)
        available = min(len(buffer) // frame_bytes, MAX_FRAME_COUNT - frame_count)
        if available == 0:
            continue
        consumed = available * frame_bytes
        samples = np.frombuffer(memoryview(buffer)[:consumed], dtype="<f4").copy()
        encoded_frames.extend(analyse_pcm(samples).tobytes())
        del buffer[:consumed]
        frame_count += available

    frames = np.frombuffer(encoded_frames, dtype=np.uint8).reshape(
        frame_count, BAND_COUNT
    )
    return frames, frame_count * SAMPLE_INTERVAL_MS


def source_fingerprint(track: dict, source_path: Path) -> str:
    stat = source_path.stat()
    identity = {
        "pipeline": f"cast-spectrum-v{FORMAT_VERSION}",
        "track_id": track.get("id"),
        "entity_uid": str(track.get("entity_uid") or ""),
        "library_path": str(track.get("path") or ""),
        "size": int(stat.st_size),
        "mtime_ns": int(stat.st_mtime_ns),
    }
    encoded = json.dumps(identity, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def spectrum_artifact_relative_path(fingerprint: str) -> PurePosixPath:
    normalized = fingerprint.strip().lower()
    if len(normalized) != 64 or any(
        char not in "0123456789abcdef" for char in normalized
    ):
        raise ValueError("Invalid spectrum source fingerprint")
    return PurePosixPath("cast-spectrum", normalized[:2], f"{normalized}.crsp.gz")


def write_spectrum_artifact(
    destination: Path,
    frames: np.ndarray,
    *,
    duration_ms: int,
) -> SpectrumWriteResult:
    values = _validated_frames(frames)
    compressed = gzip.compress(
        encode_spectrum(values, duration_ms=duration_ms),
        compresslevel=6,
        mtime=0,
    )
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            prefix=f".{destination.name}.",
            suffix=".tmp",
            dir=destination.parent,
            delete=False,
        ) as handle:
            temp_path = Path(handle.name)
            handle.write(compressed)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, destination)
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)

    return SpectrumWriteResult(
        etag=hashlib.sha256(compressed).hexdigest(),
        byte_size=len(compressed),
        frame_count=values.shape[0],
        duration_ms=duration_ms,
    )


def generate_spectrum_artifact(
    source_path: Path,
    destination: Path,
    *,
    cancelled: Callable[[], bool] | None = None,
    popen_factory: Callable[..., subprocess.Popen] = subprocess.Popen,
) -> SpectrumWriteResult:
    """Decode one audio source with ffmpeg and atomically publish its spectrum."""
    from crate.resource_governor import low_priority_command

    if not source_path.is_file():
        raise FileNotFoundError(source_path)
    command = low_priority_command(
        [
            "ffmpeg",
            "-v",
            "error",
            "-nostdin",
            "-i",
            str(source_path),
            "-t",
            str(MAX_DURATION_MS / 1000),
            "-map",
            "0:a:0",
            "-vn",
            "-sn",
            "-dn",
            "-ac",
            "1",
            "-ar",
            str(SAMPLE_RATE),
            "-f",
            "f32le",
            "pipe:1",
        ]
    )
    process = popen_factory(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if process.stdout is None or process.stderr is None:
        process.kill()
        raise RuntimeError("ffmpeg pipes were not created")

    error_output = bytearray()

    def drain_errors() -> None:
        while chunk := process.stderr.read(4096):
            remaining = 16_384 - len(error_output)
            if remaining > 0:
                error_output.extend(chunk[:remaining])

    error_thread = threading.Thread(target=drain_errors, daemon=True)
    error_thread.start()
    try:
        frames, duration_ms = analyse_pcm_stream(
            process.stdout,
            cancelled=cancelled,
        )
    except SpectrumGenerationCancelled:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
        raise
    finally:
        process.stdout.close()

    try:
        return_code = process.wait(timeout=15)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)
        raise RuntimeError("ffmpeg did not exit after spectrum extraction") from None
    finally:
        error_thread.join(timeout=2)
        process.stderr.close()

    if return_code != 0:
        detail = error_output.decode("utf-8", "replace").strip()
        raise RuntimeError(detail or f"ffmpeg exited with status {return_code}")
    return write_spectrum_artifact(destination, frames, duration_ms=duration_ms)

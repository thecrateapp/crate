"""Generate deterministic long PCM WAV files for native WebAudio memory probes."""

from __future__ import annotations

import argparse
import random
import wave
from pathlib import Path

SAMPLE_RATE = 44_100
CHANNELS = 2
SAMPLE_WIDTH = 2


def parse_track(value: str) -> tuple[str, float]:
    name, separator, raw_duration = value.partition("=")
    if not separator or not name.replace("_", "").replace("-", "").isalnum():
        raise argparse.ArgumentTypeError("track must be NAME=SECONDS")
    try:
        duration_seconds = float(raw_duration)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("track duration must be numeric") from exc
    if duration_seconds <= 0:
        raise argparse.ArgumentTypeError("track duration must be positive")
    return name, duration_seconds


def write_wav_fixture(
    path: Path,
    *,
    duration_seconds: float,
    seed: int,
    sample_rate: int = SAMPLE_RATE,
) -> int:
    if duration_seconds <= 0:
        raise ValueError("duration_seconds must be positive")
    if sample_rate <= 0:
        raise ValueError("sample_rate must be positive")

    frame_count = int(duration_seconds * sample_rate)
    if frame_count < 1:
        raise ValueError("duration_seconds must produce at least one sample frame")

    bytes_per_frame = CHANNELS * SAMPLE_WIDTH
    block_frames = min(sample_rate, frame_count)
    block = random.Random(seed).randbytes(block_frames * bytes_per_frame)
    path.parent.mkdir(parents=True, exist_ok=True)

    with wave.open(str(path), "wb") as output:
        output.setparams(
            (CHANNELS, SAMPLE_WIDTH, sample_rate, frame_count, "NONE", "not compressed")
        )
        for offset in range(0, frame_count, block_frames):
            frames = min(block_frames, frame_count - offset)
            output.writeframesraw(block[: frames * bytes_per_frame])

    return frame_count


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--track", action="append", type=parse_track, required=True)
    args = parser.parse_args()
    names = [name for name, _duration in args.track]
    if len(names) != len(set(names)):
        parser.error("track names must be unique")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    for index, (name, duration_seconds) in enumerate(args.track):
        path = args.output_dir / f"{name}.wav"
        frames = write_wav_fixture(
            path,
            duration_seconds=duration_seconds,
            seed=index + 1,
        )
        print(
            f"{path}: {frames} frames at {SAMPLE_RATE} Hz, "
            f"{duration_seconds:.2f} seconds, {path.stat().st_size} bytes",
            flush=True,
        )


if __name__ == "__main__":
    main()

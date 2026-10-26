"""Measure Smart Mix analyzer time and peak memory on a generated audio corpus."""

from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import time
import wave
from pathlib import Path
from typing import Any, Callable, Iterator

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[2]
APP_ROOT = REPO_ROOT / "app"
SAMPLE_RATE = 22_050
BLOCK_FRAMES = SAMPLE_RATE * 10
PYTHON_ANALYZER = (
    "import sys; "
    "from crate.smart_mix.analyzer import analyze_mix_profile; "
    "analyze_mix_profile(sys.argv[1])"
)


def _blocks(seconds: float) -> Iterator[np.ndarray]:
    total = int(seconds * SAMPLE_RATE)
    for start in range(0, total, BLOCK_FRAMES):
        yield np.arange(start, min(total, start + BLOCK_FRAMES), dtype=np.float64)


def click_frames(bpm: float, seconds: float) -> Iterator[np.ndarray]:
    beat_frames = SAMPLE_RATE * 60.0 / bpm
    pulse_frames = int(0.025 * SAMPLE_RATE)
    for frames in _blocks(seconds):
        offset = np.mod(frames, beat_frames)
        pulse = np.where(
            offset < pulse_frames, np.exp(-7.0 * offset / pulse_frames), 0.0
        )
        mono = 0.9 * pulse + 0.05 * np.sin(2.0 * np.pi * 220.0 * frames / SAMPLE_RATE)
        yield np.column_stack((mono, mono))


def opposite_phase_frames(seconds: float) -> Iterator[np.ndarray]:
    for frames in _blocks(seconds):
        tone = np.sin(2.0 * np.pi * 997.0 * frames / SAMPLE_RATE)
        yield np.column_stack((0.9 * tone, -0.8 * tone))


def silence_frames(seconds: float) -> Iterator[np.ndarray]:
    for frames in _blocks(seconds):
        yield np.zeros((frames.size, 2))


def write_wav(path: Path, blocks: Iterator[np.ndarray]) -> int:
    count = 0
    with wave.open(str(path), "wb") as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(SAMPLE_RATE)
        for block in blocks:
            pcm = (np.clip(block, -1.0, 1.0) * 32_767).astype("<i2")
            output.writeframes(pcm.tobytes())
            count += block.shape[0]
    return count


def generated_corpus(
    long_duration_seconds: int,
) -> list[tuple[str, Callable[[], Iterator]]]:
    return [
        ("click-120.wav", lambda: click_frames(120.0, 30.0)),
        ("click-174.wav", lambda: click_frames(174.0, 30.0)),
        ("opposite-phase.wav", lambda: opposite_phase_frames(20.0)),
        ("silence.wav", lambda: silence_frames(10.0)),
        (
            f"long-{long_duration_seconds}.wav",
            lambda: click_frames(124.0, float(long_duration_seconds)),
        ),
    ]


def run_measured(command: list[str], *, env: dict[str, str]) -> dict[str, Any]:
    started = time.perf_counter()
    process = subprocess.Popen(
        command, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE
    )
    _pid, status, usage = os.wait4(process.pid, 0)
    seconds = time.perf_counter() - started
    error = process.stderr.read().decode(errors="replace") if process.stderr else ""
    max_rss_mb = usage.ru_maxrss / (1024 * 1024 if sys.platform == "darwin" else 1024)
    exit_code = os.waitstatus_to_exitcode(status)
    return {
        "status": "measured" if exit_code == 0 else "failed",
        "exit_code": exit_code,
        "seconds": round(seconds, 3),
        "max_rss_mb": round(max_rss_mb, 1),
        **({"error": error[-500:]} if exit_code else {}),
    }


def find_crate_cli(explicit: str | None) -> Path | None:
    candidates = [
        explicit,
        os.environ.get("CRATE_CLI_BINARY"),
        str(REPO_ROOT / "tools/crate-cli/target/release/crate-cli"),
        shutil.which("crate-cli"),
    ]
    return next(
        (
            Path(candidate)
            for candidate in candidates
            if candidate and Path(candidate).is_file()
        ),
        None,
    )


def run(args: argparse.Namespace) -> dict[str, Any]:
    crate_cli = find_crate_cli(args.crate_cli)
    env = {**os.environ, "PYTHONPATH": str(APP_ROOT)}
    files: list[dict[str, Any]] = []
    with tempfile.TemporaryDirectory(prefix="smart-mix-lab-") as directory:
        for name, frames in generated_corpus(args.long_duration_seconds):
            path = Path(directory) / name
            frame_count = write_wav(path, frames())
            duration_seconds = round(frame_count / SAMPLE_RATE, 1)
            files.append(
                {
                    "name": name,
                    "analyzer": "python",
                    "duration_seconds": duration_seconds,
                    **run_measured(
                        [sys.executable, "-c", PYTHON_ANALYZER, str(path)], env=env
                    ),
                }
            )
            if crate_cli is not None:
                files.append(
                    {
                        "name": name,
                        "analyzer": "rust",
                        "duration_seconds": duration_seconds,
                        **run_measured(
                            [str(crate_cli), "analyze", "--file", str(path)], env=env
                        ),
                    }
                )
    return {
        "kind": "analysis",
        "command": " ".join(sys.argv),
        "commit": _git("rev-parse", "HEAD"),
        "dirty": bool(_git("status", "--porcelain")),
        "environment": {
            "hardware": {
                "machine": platform.machine(),
                "cpus": os.cpu_count(),
                "platform": platform.platform(),
            },
            "versions": {
                "python": platform.python_version(),
                "crate_cli": str(crate_cli) if crate_cli else None,
            },
            "note": args.note,
        },
        "dataset": {
            "fixture": args.fixture,
            "sample_rate": SAMPLE_RATE,
            "long_duration_seconds": args.long_duration_seconds,
        },
        "warmup": 1,
        "iterations": 1,
        "concurrency": 1,
        "files": files,
        "suites": {"rust_parity": args.rust_parity},
    }


def _git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=REPO_ROOT, capture_output=True, text=True, check=False
    ).stdout.strip()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture", choices=["generated-v1"], default="generated-v1")
    parser.add_argument("--long-duration-seconds", type=int, default=7_200)
    parser.add_argument("--crate-cli")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--rust-parity", default="not-run")
    parser.add_argument("--note", default="")
    args = parser.parse_args(argv)
    artifact = run(args)
    args.output.write_text(json.dumps(artifact, indent=2) + "\n")
    for item in artifact["files"]:
        print(
            f"{item['analyzer']:6} {item['name']:22} {item['status']:8} "
            f"{item.get('seconds', '-')}s {item.get('max_rss_mb', '-')} MB"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

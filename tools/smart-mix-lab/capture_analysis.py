"""Measure Smart Mix transitions in a PCM bus capture.

The Android debug build writes a 6-channel WAV (mix L/R, deck 0 L/R, deck 1 L/R)
plus a JSON summary with transition markers and underrun counters. This tool
measures the release gates on that capture: clipping and true peak of the mix,
phase error between the decks during beatmatched blends, and the bass handoff.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import soundfile
from scipy import signal

FULL_SCALE = 32767
TRUE_PEAK_LIMIT_DBTP = -1.0
PHASE_P95_LIMIT_MS = 20.0
ENVELOPE_RATE = 1000
PHASE_WINDOW_S = 2.0
PHASE_HOP_S = 0.5
MIN_DECK_RMS_DBFS = -50.0
BASS_CUTOFF_HZ = 150.0
MIN_BEAT_MS = 400.0
MAX_BEAT_MS = 750.0
SEARCH_MIN_BEAT_MS = 300.0
SEARCH_MAX_BEAT_MS = 1100.0
TEMPO_REFERENCE_S = 8.0
MAX_CAPTURE_GAP_S = 1.0


@dataclass(frozen=True)
class Capture:
    sample_rate: int
    mix: np.ndarray
    decks: tuple[np.ndarray, np.ndarray]
    summary: dict[str, Any]
    beat_period_ms: float | None = None


@dataclass(frozen=True)
class Transition:
    label: str
    start: int
    end: int
    beatmatch: bool
    engaged: bool
    bass: str


def load_capture(
    wav_path: Path,
    summary_path: Path | None = None,
    beat_period_ms: float | None = None,
) -> Capture:
    audio, sample_rate = soundfile.read(wav_path, dtype="int16", always_2d=True)
    if audio.shape[1] != 6:
        raise ValueError(f"expected 6 channels, found {audio.shape[1]}")
    samples = audio.astype(np.float64) / FULL_SCALE
    summary_file = summary_path or wav_path.with_suffix(".json")
    summary = json.loads(summary_file.read_text()) if summary_file.exists() else {}
    return Capture(
        sample_rate=int(sample_rate),
        mix=samples[:, 0:2],
        decks=(samples[:, 2:4], samples[:, 4:6]),
        summary=summary,
        beat_period_ms=beat_period_ms,
    )


def parse_transitions(summary: dict[str, Any], total_frames: int) -> list[Transition]:
    transitions: list[Transition] = []
    current: dict[str, Any] | None = None
    for marker in summary.get("markers", []):
        frame_text, _, label = marker.partition(":")
        frame = int(frame_text)
        if label.startswith("start "):
            fields = dict(part.split("=", 1) for part in label.split() if "=" in part)
            current = {"label": label, "start": frame, "fields": fields}
        elif current is not None and label.split()[0] in {"completed", "cancelled"}:
            fields = current["fields"]
            transitions.append(
                Transition(
                    label=current["label"],
                    start=current["start"],
                    end=min(frame, total_frames),
                    beatmatch=fields.get("mode") == "BEATMATCH",
                    engaged=fields.get("engaged") == "true",
                    bass=fields.get("bass", "none"),
                )
            )
            current = None
    return transitions


def true_peak_dbtp(audio: np.ndarray) -> float:
    if not audio.size:
        return float("-inf")
    upsampled = signal.resample_poly(audio, 4, 1, axis=0)
    peak = float(np.max(np.abs(upsampled)))
    return float(20.0 * np.log10(peak)) if peak > 0 else float("-inf")


def rms_dbfs(audio: np.ndarray) -> float:
    rms = float(np.sqrt(np.mean(np.square(audio)))) if audio.size else 0.0
    return float(20.0 * np.log10(rms)) if rms > 0 else float("-inf")


def onset_envelope(audio: np.ndarray, sample_rate: int) -> np.ndarray:
    mono = audio.mean(axis=1)
    sos = signal.butter(2, 60.0, "highpass", fs=sample_rate, output="sos")
    filtered = signal.sosfilt(sos, mono)
    hop = sample_rate // ENVELOPE_RATE
    frames = len(filtered) // hop
    energy = np.sqrt(
        np.mean(np.square(filtered[: frames * hop].reshape(frames, hop)), axis=1)
    )
    flux = np.maximum(np.diff(energy, prepend=energy[:1]), 0.0)
    return flux - flux.mean() if flux.size else flux


def beat_period_ms(envelope: np.ndarray) -> float:
    if envelope.size < 2 * ENVELOPE_RATE:
        return 500.0
    correlation = signal.correlate(envelope, envelope, mode="full", method="fft")
    correlation = correlation[envelope.size - 1 :]
    low, high = (
        int(SEARCH_MIN_BEAT_MS),
        min(int(SEARCH_MAX_BEAT_MS), correlation.size - 2),
    )
    lag = low + int(np.argmax(correlation[low : high + 1]))
    if 0 < lag < correlation.size - 1:
        before, peak, after = correlation[lag - 1 : lag + 2]
        curvature = before - 2 * peak + after
        period = lag + (0.5 * (before - after) / curvature if curvature else 0.0)
    else:
        period = float(lag)
    while period > MAX_BEAT_MS:
        period /= 2
    while period < MIN_BEAT_MS:
        period *= 2
    return float(period)


def comb_phase_ms(envelope: np.ndarray, period_ms: float) -> float:
    period = max(1, int(round(period_ms)))
    beats = envelope.size // period
    if beats < 2:
        return float("nan")
    folded = envelope[: beats * period].reshape(beats, period).sum(axis=0)
    smoothed = np.convolve(
        np.concatenate([folded[-4:], folded, folded[:4]]), np.ones(9) / 9, "valid"
    )
    return float(np.argmax(smoothed))


def wrap_ms(value: float, period_ms: float) -> float:
    return float((value + period_ms / 2) % period_ms - period_ms / 2)


def phase_errors_ms(
    outgoing: np.ndarray,
    incoming: np.ndarray,
    sample_rate: int,
    period_ms: float | None = None,
    tempo_reference: np.ndarray | None = None,
) -> tuple[list[float], float]:
    out_env = onset_envelope(outgoing, sample_rate)
    in_env = onset_envelope(incoming, sample_rate)
    reference = (
        onset_envelope(tempo_reference, sample_rate)
        if tempo_reference is not None and tempo_reference.shape[0] >= sample_rate * 2
        else out_env
    )
    period = period_ms or beat_period_ms(reference)
    window = int(PHASE_WINDOW_S * ENVELOPE_RATE)
    hop = int(PHASE_HOP_S * ENVELOPE_RATE)
    errors: list[float] = []
    for start in range(0, min(out_env.size, in_env.size) - window + 1, hop):
        out_phase = comb_phase_ms(out_env[start : start + window], period)
        in_phase = comb_phase_ms(in_env[start : start + window], period)
        if np.isnan(out_phase) or np.isnan(in_phase):
            continue
        errors.append(wrap_ms(in_phase - out_phase, period))
    return errors, period


def low_band_share_db(audio: np.ndarray, sample_rate: int) -> float:
    mono = audio.mean(axis=1)
    total = float(np.sum(np.square(mono)))
    if total <= 0:
        return float("nan")
    sos = signal.butter(4, BASS_CUTOFF_HZ, "lowpass", fs=sample_rate, output="sos")
    low = signal.sosfilt(sos, mono)
    return 10.0 * np.log10(max(float(np.sum(np.square(low))), 1e-12) / total)


def split_by_role(capture: Capture, start: int, end: int) -> tuple[int, int]:
    first, second = (deck[start:end] for deck in capture.decks)
    quarter = max(1, (end - start) // 4)
    first_trend = rms_dbfs(first[-quarter:]) - rms_dbfs(first[:quarter])
    second_trend = rms_dbfs(second[-quarter:]) - rms_dbfs(second[:quarter])
    return (0, 1) if first_trend < second_trend else (1, 0)


def analyze_transition(capture: Capture, transition: Transition) -> dict[str, Any]:
    rate = capture.sample_rate
    out_index, in_index = split_by_role(capture, transition.start, transition.end)
    outgoing = capture.decks[out_index][transition.start : transition.end]
    incoming = capture.decks[in_index][transition.start : transition.end]
    reference_start = max(0, transition.start - int(TEMPO_REFERENCE_S * rate))
    tempo_reference = capture.decks[out_index][reference_start : transition.start]
    length = transition.end - transition.start
    result: dict[str, Any] = {
        "label": transition.label,
        "durationMs": round(length * 1000 / rate),
        "beatmatch": transition.beatmatch,
        "engaged": transition.engaged,
        "bass": transition.bass,
    }
    core = slice(int(length * 0.15), int(length * 0.85))
    if min(rms_dbfs(outgoing[core]), rms_dbfs(incoming[core])) < MIN_DECK_RMS_DBFS:
        result["status"] = "insufficient_signal"
        return result
    window = capture.mix[transition.start : transition.end]
    result["clippedSamples"] = int(np.count_nonzero(np.abs(window) >= 1.0))
    result["truePeakDbtp"] = round(true_peak_dbtp(window), 2)
    if transition.beatmatch and transition.engaged:
        errors, period = phase_errors_ms(
            outgoing[core],
            incoming[core],
            rate,
            capture.beat_period_ms,
            tempo_reference,
        )
        if errors:
            absolute = np.abs(errors)
            result["phase"] = {
                "beatPeriodMs": round(period, 1),
                "windows": len(errors),
                "p50Ms": round(float(np.percentile(absolute, 50)), 1),
                "p95Ms": round(float(np.percentile(absolute, 95)), 1),
                "maxMs": round(float(absolute.max()), 1),
            }
    early = slice(int(length * 0.1), int(length * 0.35))
    late = slice(int(length * 0.65), int(length * 0.9))
    result["bassShareDb"] = {
        "incomingEarly": round(low_band_share_db(incoming[early], rate), 1),
        "incomingLate": round(low_band_share_db(incoming[late], rate), 1),
        "outgoingEarly": round(low_band_share_db(outgoing[early], rate), 1),
        "outgoingLate": round(low_band_share_db(outgoing[late], rate), 1),
    }
    result["status"] = "measured"
    return result


def capture_gap_s(capture: Capture) -> float | None:
    started = capture.summary.get("startedAtMs")
    stopped = capture.summary.get("stoppedAtMs")
    if started is None or stopped is None:
        return None
    wall_s = (int(stopped) - int(started)) / 1000
    return round(wall_s - capture.mix.shape[0] / capture.sample_rate, 2)


def analyze(capture: Capture) -> dict[str, Any]:
    total = capture.mix.shape[0]
    if total == 0 or rms_dbfs(capture.mix) < MIN_DECK_RMS_DBFS:
        return {"status": "insufficient_signal", "frames": total, "passed": False}
    transitions = parse_transitions(capture.summary, total)
    measured = [analyze_transition(capture, item) for item in transitions]
    clipped = int(np.count_nonzero(np.abs(capture.mix) >= 1.0))
    peak = true_peak_dbtp(capture.mix)
    dropped = int(capture.summary.get("droppedFrames", 0))
    phase_p95 = [item["phase"]["p95Ms"] for item in measured if "phase" in item]
    mixed = [item for item in measured if "clippedSamples" in item]
    gap_s = capture_gap_s(capture)
    gates = {
        "clipping": all(item["clippedSamples"] == 0 for item in mixed),
        "truePeak": all(item["truePeakDbtp"] <= TRUE_PEAK_LIMIT_DBTP for item in mixed),
        "captureIntact": dropped == 0,
        "captureContinuous": gap_s is not None and gap_s <= MAX_CAPTURE_GAP_S,
        "signal": all(item["status"] == "measured" for item in measured),
    }
    if phase_p95:
        gates["phaseP95"] = max(phase_p95) <= PHASE_P95_LIMIT_MS
    gates = {name: bool(value) for name, value in gates.items()}
    return {
        "status": "measured" if measured else "no_transitions",
        "frames": total,
        "durationS": round(total / capture.sample_rate, 2),
        "captureClippedSamples": clipped,
        "captureTruePeakDbtp": round(peak, 2),
        "underruns": int(capture.summary.get("underruns", 0)),
        "droppedFrames": dropped,
        "busStallPolls": int(capture.summary.get("busStallPolls", 0)),
        "captureGapS": gap_s,
        "transitions": measured,
        "gates": gates,
        "passed": bool(measured) and all(gates.values()),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capture", type=Path, required=True)
    parser.add_argument("--summary", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--bpm", type=float, help="Known tempo of the outgoing track")
    args = parser.parse_args(argv)
    period = 60_000.0 / args.bpm if args.bpm else None
    result = analyze(load_capture(args.capture, args.summary, period))
    text = json.dumps(result, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text + "\n")
    print(text)
    return 0 if result.get("passed") else 1


if __name__ == "__main__":
    sys.exit(main())

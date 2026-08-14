from __future__ import annotations

from dataclasses import dataclass

import numpy as np


MIN_ACTIVE_DBFS = -55.0
ACTIVE_RANGE_DB = 35.0
DEFAULT_MIX_WINDOW_MS = 4_000


@dataclass(frozen=True, slots=True)
class MixCuePoints:
    intro_cue_ms: int | None
    outro_cue_ms: int | None
    active_start_ms: int | None
    active_end_ms: int | None


def detect_mix_cues(
    audio: np.ndarray,
    sample_rate: int,
    beat_grid_ms: tuple[int, ...] = (),
) -> MixCuePoints:
    if sample_rate <= 0 or audio.size == 0:
        return MixCuePoints(None, None, None, None)

    frame_length = max(256, round(sample_rate * 0.05))
    hop_length = max(128, frame_length // 2)
    rms = _frame_rms(audio, frame_length, hop_length)
    if rms.size == 0:
        return MixCuePoints(None, None, None, None)

    dbfs = 20.0 * np.log10(rms + 1e-10)
    peak_dbfs = float(np.max(dbfs))
    threshold = max(MIN_ACTIVE_DBFS, peak_dbfs - ACTIVE_RANGE_DB)
    active_frames = np.flatnonzero(dbfs >= threshold)
    if active_frames.size == 0:
        return MixCuePoints(None, None, None, None)

    active_start_ms = round(int(active_frames[0]) * hop_length * 1_000 / sample_rate)
    active_end_ms = min(
        round(audio.size * 1_000 / sample_rate),
        round(
            (int(active_frames[-1]) * hop_length + frame_length) * 1_000 / sample_rate
        ),
    )
    intro_cue_ms = next(
        (beat for beat in beat_grid_ms if beat >= active_start_ms),
        active_start_ms,
    )
    outro_target_ms = max(
        intro_cue_ms,
        active_end_ms - DEFAULT_MIX_WINDOW_MS,
    )
    outro_cue_ms = next(
        (beat for beat in reversed(beat_grid_ms) if beat <= outro_target_ms),
        outro_target_ms,
    )
    if outro_cue_ms < intro_cue_ms:
        outro_cue_ms = outro_target_ms

    return MixCuePoints(
        intro_cue_ms=intro_cue_ms,
        outro_cue_ms=outro_cue_ms,
        active_start_ms=active_start_ms,
        active_end_ms=active_end_ms,
    )


def _frame_rms(
    audio: np.ndarray,
    frame_length: int,
    hop_length: int,
) -> np.ndarray:
    if audio.size < frame_length:
        return np.array(
            [float(np.sqrt(np.mean(np.square(audio, dtype=np.float64))))],
            dtype=np.float64,
        )
    starts = range(0, audio.size - frame_length + 1, hop_length)
    return np.fromiter(
        (
            float(
                np.sqrt(
                    np.mean(
                        np.square(
                            audio[start : start + frame_length],
                            dtype=np.float64,
                        )
                    )
                )
            )
            for start in starts
        ),
        dtype=np.float64,
    )

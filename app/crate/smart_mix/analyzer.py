from __future__ import annotations

import math
import warnings
from pathlib import Path

import numpy as np

from crate.smart_mix.camelot import to_camelot
from crate.smart_mix.cue_detection import detect_mix_cues
from crate.smart_mix.models import MixProfileQuality, TrackMixProfileDraft


ANALYZER_NAME = "crate-python"
ANALYZER_VERSION = "smart-mix-v1"
TARGET_SAMPLE_RATE = 22_050
HOP_LENGTH = 256
WINDOW_SECONDS = 5.0

_KEY_NAMES = (
    "C",
    "C#",
    "D",
    "D#",
    "E",
    "F",
    "F#",
    "G",
    "G#",
    "A",
    "A#",
    "B",
)
_MAJOR_PROFILE = np.array(
    [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
)
_MINOR_PROFILE = np.array(
    [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
)


def analyze_mix_profile(filepath: str | Path) -> TrackMixProfileDraft:
    import librosa

    audio, sample_rate = _load_audio(Path(filepath))
    duration_ms = round(audio.size * 1_000 / sample_rate)
    if audio.size < sample_rate * 2:
        return TrackMixProfileDraft(
            analyzer=ANALYZER_NAME,
            analyzer_version=ANALYZER_VERSION,
            duration_ms=duration_ms,
            quality=MixProfileQuality.UNAVAILABLE,
        )

    onset_envelope = librosa.onset.onset_strength(
        y=audio,
        sr=sample_rate,
        hop_length=HOP_LENGTH,
    )
    _, beat_frames = librosa.beat.beat_track(
        onset_envelope=onset_envelope,
        sr=sample_rate,
        hop_length=HOP_LENGTH,
        sparse=True,
    )
    beat_frames = np.asarray(beat_frames, dtype=int).reshape(-1)
    beat_grid_ms = tuple(
        sorted(
            {
                round(float(frame) * HOP_LENGTH * 1_000 / sample_rate)
                for frame in beat_frames
            }
        )
    )
    bpm, bpm_confidence, tempo_stability = _tempo_features(
        beat_grid_ms,
        onset_envelope,
        beat_frames,
    )
    downbeat_anchor_ms, time_signature = _downbeat_features(
        beat_grid_ms,
        onset_envelope,
        beat_frames,
        bpm_confidence,
    )
    key, scale, camelot, key_confidence = _key_features(audio, sample_rate)
    cues = detect_mix_cues(audio, sample_rate, beat_grid_ms)
    intro = _window_features(
        audio,
        sample_rate,
        cues.intro_cue_ms,
        direction="forward",
    )
    outro = _window_features(
        audio,
        sample_rate,
        cues.active_end_ms,
        direction="backward",
    )
    global_features = _signal_features(audio, sample_rate)
    quality = _profile_quality(
        beat_grid_ms=beat_grid_ms,
        bpm_confidence=bpm_confidence,
        tempo_stability=tempo_stability,
        downbeat_anchor_ms=downbeat_anchor_ms,
    )

    return TrackMixProfileDraft(
        analyzer=ANALYZER_NAME,
        analyzer_version=ANALYZER_VERSION,
        duration_ms=duration_ms,
        quality=quality,
        bpm=bpm,
        bpm_confidence=bpm_confidence,
        tempo_stability=tempo_stability,
        beat_anchor_ms=beat_grid_ms[0] if beat_grid_ms else None,
        downbeat_anchor_ms=downbeat_anchor_ms,
        time_signature=time_signature,
        beat_grid_ms=beat_grid_ms,
        key=key,
        scale=scale,
        camelot=camelot,
        key_confidence=key_confidence,
        intro_cue_ms=cues.intro_cue_ms,
        outro_cue_ms=cues.outro_cue_ms,
        intro_lufs=intro["lufs"],
        outro_lufs=outro["lufs"],
        true_peak_dbfs=global_features["true_peak_dbfs"],
        intro_energy=intro["energy"],
        outro_energy=outro["energy"],
        intro_spectral_density=intro["spectral_density"],
        outro_spectral_density=outro["spectral_density"],
        global_energy=global_features["energy"],
        danceability=_danceability(bpm_confidence, tempo_stability, bpm),
        valence=None,
    )


def _load_audio(path: Path) -> tuple[np.ndarray, int]:
    if not path.is_file():
        raise FileNotFoundError(path)

    import librosa

    try:
        import soundfile as sf

        audio, sample_rate = sf.read(path, dtype="float32", always_2d=False)
        if getattr(audio, "ndim", 1) > 1:
            audio = np.mean(audio, axis=1)
    except Exception:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            audio, sample_rate = librosa.load(path, sr=None, mono=True)

    audio = np.asarray(audio, dtype=np.float32)
    audio = np.nan_to_num(audio, copy=False)
    if sample_rate > TARGET_SAMPLE_RATE:
        audio = librosa.resample(
            audio,
            orig_sr=sample_rate,
            target_sr=TARGET_SAMPLE_RATE,
        )
        sample_rate = TARGET_SAMPLE_RATE
    return audio, int(sample_rate)


def _tempo_features(
    beat_grid_ms: tuple[int, ...],
    onset_envelope: np.ndarray,
    beat_frames: np.ndarray,
) -> tuple[float | None, float, float]:
    if len(beat_grid_ms) < 4:
        return None, 0.0, 0.0

    intervals = np.diff(np.asarray(beat_grid_ms, dtype=np.float64))
    median_interval = float(np.median(intervals))
    if median_interval <= 0:
        return None, 0.0, 0.0

    bpm = 60_000.0 / median_interval
    third = max(2, intervals.size // 3)
    early_interval = float(np.median(intervals[:third]))
    late_interval = float(np.median(intervals[-third:]))
    drift_ratio = abs(late_interval - early_interval) / median_interval
    residual = np.abs(intervals - median_interval)
    jitter_ratio = float(np.median(residual)) / median_interval
    tempo_stability = max(
        0.0,
        min(1.0, 1.0 - drift_ratio / 0.25 - jitter_ratio / 0.20),
    )

    valid_frames = beat_frames[(beat_frames >= 0) & (beat_frames < onset_envelope.size)]
    if valid_frames.size:
        beat_strength = float(np.mean(onset_envelope[valid_frames]))
        reference = float(np.percentile(onset_envelope, 95)) + 1e-8
        strength_ratio = min(1.0, beat_strength / reference)
    else:
        strength_ratio = 0.0
    coverage = min(1.0, len(beat_grid_ms) / 16.0)
    confidence = max(
        0.0,
        min(
            1.0,
            0.5 * tempo_stability + 0.35 * strength_ratio + 0.15 * coverage,
        ),
    )
    return round(bpm, 3), round(confidence, 4), round(tempo_stability, 4)


def _downbeat_features(
    beat_grid_ms: tuple[int, ...],
    onset_envelope: np.ndarray,
    beat_frames: np.ndarray,
    bpm_confidence: float,
) -> tuple[int | None, int | None]:
    if len(beat_grid_ms) < 12 or bpm_confidence < 0.65:
        return None, None
    valid_count = min(len(beat_grid_ms), beat_frames.size)
    strengths = np.array(
        [
            float(onset_envelope[frame]) if 0 <= frame < onset_envelope.size else 0.0
            for frame in beat_frames[:valid_count]
        ],
        dtype=np.float64,
    )
    phase_scores = np.array([float(np.mean(strengths[phase::4])) for phase in range(4)])
    ordered = np.sort(phase_scores)
    onset_contrast = float(np.std(onset_envelope)) / (
        float(np.mean(onset_envelope)) + 1e-8
    )
    if onset_contrast < 1.0 or ordered[-1] <= 0 or ordered[-1] < ordered[-2] * 1.2:
        return None, None
    phase = int(np.argmax(phase_scores))
    return beat_grid_ms[phase], 4


def _key_features(
    audio: np.ndarray,
    sample_rate: int,
) -> tuple[str | None, str | None, str | None, float]:
    import librosa

    max_samples = min(audio.size, sample_rate * 90)
    with warnings.catch_warnings():
        warnings.filterwarnings(
            "ignore",
            message="Trying to estimate tuning from empty frequency set.",
            category=UserWarning,
        )
        chroma = librosa.feature.chroma_stft(
            y=audio[:max_samples],
            sr=sample_rate,
            hop_length=HOP_LENGTH,
        )
    if chroma.size == 0:
        return None, None, None, 0.0
    chroma_mean = np.mean(chroma, axis=1)
    if float(np.sum(chroma_mean)) <= 1e-8:
        return None, None, None, 0.0

    candidates: list[tuple[float, str, str]] = []
    for index, key_name in enumerate(_KEY_NAMES):
        observed = np.roll(chroma_mean, -index)
        candidates.append(
            (
                _safe_correlation(observed, _MAJOR_PROFILE),
                key_name,
                "major",
            )
        )
        candidates.append(
            (
                _safe_correlation(observed, _MINOR_PROFILE),
                key_name,
                "minor",
            )
        )
    candidates.sort(reverse=True, key=lambda candidate: candidate[0])
    best_score, key, scale = candidates[0]
    second_score = candidates[1][0]
    confidence = max(
        0.0,
        min(
            1.0,
            (best_score + 1.0) * 0.35 + max(0.0, best_score - second_score),
        ),
    )
    try:
        camelot = to_camelot(key, scale)
    except ValueError:
        camelot = None
    return key, scale, camelot, round(confidence, 4)


def _safe_correlation(left: np.ndarray, right: np.ndarray) -> float:
    if float(np.std(left)) <= 1e-8:
        return -1.0
    value = float(np.corrcoef(left, right)[0, 1])
    return value if math.isfinite(value) else -1.0


def _window_features(
    audio: np.ndarray,
    sample_rate: int,
    anchor_ms: int | None,
    *,
    direction: str,
) -> dict[str, float | None]:
    if anchor_ms is None:
        return {"lufs": None, "energy": None, "spectral_density": None}
    anchor_sample = round(anchor_ms * sample_rate / 1_000)
    window_samples = round(WINDOW_SECONDS * sample_rate)
    if direction == "forward":
        start = max(0, anchor_sample)
        end = min(audio.size, start + window_samples)
    else:
        end = min(audio.size, anchor_sample)
        start = max(0, end - window_samples)
    return _signal_features(audio[start:end], sample_rate)


def _signal_features(
    audio: np.ndarray,
    sample_rate: int,
) -> dict[str, float | None]:
    import librosa

    if audio.size == 0:
        return {
            "lufs": None,
            "energy": None,
            "spectral_density": None,
            "true_peak_dbfs": None,
        }
    rms = float(np.sqrt(np.mean(np.square(audio, dtype=np.float64))))
    dbfs = 20.0 * math.log10(rms + 1e-10)
    energy = max(0.0, min(1.0, (dbfs + 60.0) / 60.0))
    centroid = float(
        np.mean(
            librosa.feature.spectral_centroid(
                y=audio,
                sr=sample_rate,
                hop_length=HOP_LENGTH,
            )
        )
    )
    spectral_density = max(
        0.0,
        min(1.0, math.log1p(centroid) / math.log1p(sample_rate / 2.0)),
    )
    true_peak = float(np.max(np.abs(audio)))
    return {
        "lufs": round(dbfs, 3),
        "energy": round(energy, 4),
        "spectral_density": round(spectral_density, 4),
        "true_peak_dbfs": round(20.0 * math.log10(true_peak + 1e-10), 3),
    }


def _danceability(
    bpm_confidence: float,
    tempo_stability: float,
    bpm: float | None,
) -> float:
    if bpm is None:
        return 0.0
    tempo_score = max(0.0, min(1.0, 1.0 - abs(bpm - 120.0) / 100.0))
    return round(
        0.45 * bpm_confidence + 0.4 * tempo_stability + 0.15 * tempo_score,
        4,
    )


def _profile_quality(
    *,
    beat_grid_ms: tuple[int, ...],
    bpm_confidence: float,
    tempo_stability: float,
    downbeat_anchor_ms: int | None,
) -> MixProfileQuality:
    if (
        len(beat_grid_ms) >= 12
        and bpm_confidence >= 0.75
        and tempo_stability >= 0.8
        and downbeat_anchor_ms is not None
    ):
        return MixProfileQuality.FULL
    return MixProfileQuality.PARTIAL

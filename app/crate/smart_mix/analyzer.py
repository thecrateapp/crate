from __future__ import annotations

import math
import warnings
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from crate.smart_mix.camelot import to_camelot
from crate.smart_mix.cue_detection import detect_mix_cues
from crate.smart_mix.models import MixProfileQuality, TrackMixProfileDraft
from crate.smart_mix.versions import ANALYZER_VERSION, PYTHON_ANALYZER


ANALYZER_NAME = PYTHON_ANALYZER
TARGET_SAMPLE_RATE = 22_050
HOP_LENGTH = 256
TEMPO_PRIOR_OCTAVES = 1.5
_FFT_SIZE = 2048
_MEL_BANDS = 128
_LOW_BAND_HZ = 200.0
_DOWNBEAT_WINDOW_SECONDS = 0.046
_DOWNBEAT_MIN_BEATS = 16
_DOWNBEAT_MIN_CONFIDENCE = 0.65
_DOWNBEAT_MARGIN = 0.3
WINDOW_SECONDS = 5.0
FULL_SCAN_HEAD_SECONDS = 240
FULL_SCAN_TAIL_SECONDS = 120
_READ_BLOCK_FRAMES = 65_536

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

    loaded = _load_audio(Path(filepath))
    audio, sample_rate = loaded.head, loaded.sample_rate
    duration_ms = loaded.duration_ms
    if audio.size < sample_rate * 2:
        return TrackMixProfileDraft(
            analyzer=ANALYZER_NAME,
            analyzer_version=ANALYZER_VERSION,
            duration_ms=duration_ms,
            quality=MixProfileQuality.UNAVAILABLE,
        )

    onset_envelope, low_onsets, chroma = _frame_features(audio, sample_rate)
    tempo = librosa.feature.tempo(
        onset_envelope=onset_envelope,
        sr=sample_rate,
        hop_length=HOP_LENGTH,
        std_bpm=TEMPO_PRIOR_OCTAVES,
    )
    _, beat_frames = librosa.beat.beat_track(
        onset_envelope=onset_envelope,
        sr=sample_rate,
        hop_length=HOP_LENGTH,
        bpm=float(np.atleast_1d(tempo)[0]),
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
        beat_frames,
        bpm_confidence,
        onsets=onset_envelope,
        low_onsets=low_onsets,
        chroma=chroma,
        window_frames=max(
            1, round(_DOWNBEAT_WINDOW_SECONDS * sample_rate / HOP_LENGTH)
        ),
    )
    key, scale, camelot, key_confidence = _key_features(audio, sample_rate)
    cues = detect_mix_cues(audio, sample_rate, beat_grid_ms)
    intro = _window_features(
        audio,
        sample_rate,
        cues.intro_cue_ms,
        direction="forward",
    )
    outro_cue_ms, active_end_ms = cues.outro_cue_ms, cues.active_end_ms
    if loaded.tail is None:
        outro = _window_features(
            audio,
            sample_rate,
            cues.active_end_ms,
            direction="backward",
        )
    else:
        tail_cues = detect_mix_cues(loaded.tail, sample_rate)
        outro_cue_ms = _offset_ms(tail_cues.outro_cue_ms, loaded.tail_start_ms)
        active_end_ms = _offset_ms(tail_cues.active_end_ms, loaded.tail_start_ms)
        outro = _window_features(
            loaded.tail,
            sample_rate,
            tail_cues.active_end_ms,
            direction="backward",
        )
    global_features = _signal_features(audio, sample_rate)
    quality = (
        MixProfileQuality.PARTIAL
        if loaded.tail is not None
        else _profile_quality(
            beat_grid_ms=beat_grid_ms,
            bpm_confidence=bpm_confidence,
            tempo_stability=tempo_stability,
            downbeat_anchor_ms=downbeat_anchor_ms,
        )
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
        outro_cue_ms=outro_cue_ms,
        active_start_ms=cues.active_start_ms,
        active_end_ms=active_end_ms,
        intro_energy=intro["energy"],
        outro_energy=outro["energy"],
        intro_spectral_density=intro["spectral_density"],
        outro_spectral_density=outro["spectral_density"],
        global_energy=global_features["energy"],
        danceability=_danceability(bpm_confidence, tempo_stability, bpm),
        valence=None,
    )


@dataclass(frozen=True, slots=True)
class _LoadedAudio:
    head: np.ndarray
    tail: np.ndarray | None
    tail_start_ms: int
    sample_rate: int
    duration_ms: int


def _load_audio(path: Path) -> _LoadedAudio:
    if not path.is_file():
        raise FileNotFoundError(path)
    try:
        import soundfile as sf

        with sf.SoundFile(path) as source:
            return _load_bounded(
                lambda frames: _read_mono(source, frames),
                lambda frame: source.seek(frame),
                total_frames=source.frames,
                sample_rate=source.samplerate,
            )
    except Exception:
        return _load_with_librosa(path)


def _load_bounded(read, seek, *, total_frames: int, sample_rate: int) -> _LoadedAudio:
    head_frames = FULL_SCAN_HEAD_SECONDS * sample_rate
    tail_frames = FULL_SCAN_TAIL_SECONDS * sample_rate
    duration_ms = round(total_frames * 1_000 / sample_rate)
    if total_frames <= head_frames + tail_frames:
        head, rate = _to_analysis_rate(read(total_frames), sample_rate)
        return _LoadedAudio(head, None, 0, rate, duration_ms)
    head, rate = _to_analysis_rate(read(head_frames), sample_rate)
    tail_start = total_frames - tail_frames
    seek(tail_start)
    tail, _ = _to_analysis_rate(read(tail_frames), sample_rate)
    tail_start_ms = round(tail_start * 1_000 / sample_rate)
    return _LoadedAudio(head, tail, tail_start_ms, rate, duration_ms)


def _read_mono(source, frames: int) -> np.ndarray:
    blocks = []
    remaining = frames
    while remaining > 0:
        block = source.read(
            min(_READ_BLOCK_FRAMES, remaining),
            dtype="float32",
            always_2d=True,
        )
        if block.size == 0:
            break
        blocks.append(block.mean(axis=1))
        remaining -= block.shape[0]
    return np.concatenate(blocks) if blocks else np.zeros(0, dtype=np.float32)


def _load_with_librosa(path: Path) -> _LoadedAudio:
    import librosa

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        duration_seconds = float(librosa.get_duration(path=path))
        if duration_seconds <= FULL_SCAN_HEAD_SECONDS + FULL_SCAN_TAIL_SECONDS:
            audio, sample_rate = librosa.load(path, sr=None, mono=True)
            head, rate = _to_analysis_rate(audio, int(sample_rate))
            return _LoadedAudio(head, None, 0, rate, round(duration_seconds * 1_000))
        head_audio, sample_rate = librosa.load(
            path, sr=None, mono=True, duration=FULL_SCAN_HEAD_SECONDS
        )
        tail_offset = duration_seconds - FULL_SCAN_TAIL_SECONDS
        tail_audio, _ = librosa.load(path, sr=None, mono=True, offset=tail_offset)
    head, rate = _to_analysis_rate(head_audio, int(sample_rate))
    tail, _ = _to_analysis_rate(tail_audio, int(sample_rate))
    return _LoadedAudio(
        head,
        tail,
        round(tail_offset * 1_000),
        rate,
        round(duration_seconds * 1_000),
    )


def _to_analysis_rate(audio: np.ndarray, sample_rate: int) -> tuple[np.ndarray, int]:
    import librosa

    audio = np.nan_to_num(np.asarray(audio, dtype=np.float32), copy=False)
    if sample_rate > TARGET_SAMPLE_RATE:
        return (
            librosa.resample(audio, orig_sr=sample_rate, target_sr=TARGET_SAMPLE_RATE),
            TARGET_SAMPLE_RATE,
        )
    return audio, int(sample_rate)


def _offset_ms(position_ms: int | None, offset_ms: int) -> int | None:
    return None if position_ms is None else position_ms + offset_ms


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

    bpm = 60_000.0 / float(np.mean(intervals))
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


def _frame_features(
    audio: np.ndarray, sample_rate: int
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    import librosa

    power = np.abs(librosa.stft(audio, n_fft=_FFT_SIZE, hop_length=HOP_LENGTH)) ** 2
    mel_db = librosa.power_to_db(
        librosa.feature.melspectrogram(S=power, sr=sample_rate, n_mels=_MEL_BANDS),
        top_db=80.0,
    )
    centers = librosa.mel_frequencies(n_mels=_MEL_BANDS + 2, fmax=sample_rate / 2)[1:-1]
    low_bands = max(1, int(np.sum(centers < _LOW_BAND_HZ)))
    onsets = librosa.onset.onset_strength(
        S=mel_db, sr=sample_rate, hop_length=HOP_LENGTH, n_fft=_FFT_SIZE
    )
    low_onsets = librosa.onset.onset_strength(
        S=mel_db[:low_bands], sr=sample_rate, hop_length=HOP_LENGTH, n_fft=_FFT_SIZE
    )
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", category=UserWarning)
        chroma = librosa.feature.chroma_stft(S=power, sr=sample_rate)
    lead = 1 + _FFT_SIZE // (2 * HOP_LENGTH)
    chroma = np.pad(chroma, ((0, 0), (lead - 1, 0)), mode="edge")[:, : onsets.size]
    return onsets, low_onsets, chroma.T


def _standardized(values: np.ndarray) -> np.ndarray:
    deviation = float(np.std(values))
    if deviation <= 1e-8:
        return np.zeros_like(values)
    return (values - float(np.mean(values))) / deviation


def _best_phase(scores: np.ndarray, indices: range) -> tuple[int, float] | None:
    phases = [
        [scores[index] for index in indices if index % 4 == phase] for phase in range(4)
    ]
    if any(not members for members in phases):
        return None
    means = np.array([float(np.mean(members)) for members in phases])
    ordered = np.sort(means)[::-1]
    return int(np.argmax(means)), float(ordered[0] - ordered[1])


def _downbeat_phase(
    beat_frames: np.ndarray,
    *,
    onsets: np.ndarray,
    low_onsets: np.ndarray,
    chroma: np.ndarray,
    window_frames: int,
) -> int | None:
    count = beat_frames.size
    if count < _DOWNBEAT_MIN_BEATS:
        return None

    def window_peak(values: np.ndarray, frame: int) -> float:
        start = max(0, frame - window_frames)
        end = min(values.size, frame + window_frames + 1)
        return float(np.max(values[start:end])) if start < end else 0.0

    def harmonic_change(index: int) -> float:
        if index == 0 or index + 1 == count:
            return 0.0
        before = chroma[beat_frames[index - 1] : beat_frames[index]].sum(axis=0)
        after = chroma[beat_frames[index] : beat_frames[index + 1]].sum(axis=0)
        norm = float(np.linalg.norm(before) * np.linalg.norm(after))
        return 0.0 if norm <= 1e-8 else 1.0 - float(np.dot(before, after)) / norm

    low = _standardized(np.array([window_peak(low_onsets, f) for f in beat_frames]))
    broad = _standardized(np.array([window_peak(onsets, f) for f in beat_frames]))
    harmonic = _standardized(np.array([harmonic_change(i) for i in range(count)]))
    scores = low + harmonic + 0.5 * broad
    overall = _best_phase(scores, range(count))
    if overall is None or overall[1] < _DOWNBEAT_MARGIN:
        return None
    middle = count // 2
    first = _best_phase(scores, range(middle))
    second = _best_phase(scores, range(middle, count))
    if first is None or second is None:
        return None
    return overall[0] if first[0] == overall[0] == second[0] else None


def _downbeat_features(
    beat_grid_ms: tuple[int, ...],
    beat_frames: np.ndarray,
    bpm_confidence: float,
    *,
    onsets: np.ndarray,
    low_onsets: np.ndarray,
    chroma: np.ndarray,
    window_frames: int,
) -> tuple[int | None, int | None]:
    if bpm_confidence < _DOWNBEAT_MIN_CONFIDENCE:
        return None, None
    valid_count = min(len(beat_grid_ms), beat_frames.size)
    phase = _downbeat_phase(
        beat_frames[:valid_count],
        onsets=onsets,
        low_onsets=low_onsets,
        chroma=chroma,
        window_frames=window_frames,
    )
    if phase is None:
        return None, None
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
        return {"energy": None, "spectral_density": None}
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
        return {"energy": None, "spectral_density": None}
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
    return {
        "energy": round(energy, 4),
        "spectral_density": round(spectral_density, 4),
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

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any


class MixProfileQuality(StrEnum):
    FULL = "full"
    PARTIAL = "partial"
    LEGACY = "legacy"
    UNAVAILABLE = "unavailable"


class TransitionMode(StrEnum):
    GAPLESS = "gapless"
    ADAPTIVE = "adaptive"
    BEATMATCH = "beatmatch"


class TransitionFallbackReason(StrEnum):
    MISSING_PROFILE = "missing_profile"
    LOW_CONFIDENCE = "low_confidence"
    UNSTABLE_TEMPO = "unstable_tempo"
    INCOMPATIBLE_TEMPO = "incompatible_tempo"
    INCOMPATIBLE_METER = "incompatible_meter"
    PRELOAD_DEADLINE = "preload_deadline"
    OFFLINE_UNAVAILABLE = "offline_unavailable"


@dataclass(frozen=True, slots=True)
class TrackMixProfile:
    track_entity_uid: str
    profile_version: int
    profile_revision: str
    analyzer: str
    analyzer_version: str
    source_revision: str
    duration_ms: int
    quality: MixProfileQuality | str
    analyzed_at: datetime
    bpm: float | None = None
    bpm_confidence: float | None = None
    tempo_stability: float | None = None
    beat_anchor_ms: int | None = None
    downbeat_anchor_ms: int | None = None
    time_signature: int | None = None
    beat_grid_format: str | None = None
    beat_grid_ms: tuple[int, ...] = ()
    key: str | None = None
    scale: str | None = None
    camelot: str | None = None
    key_confidence: float | None = None
    intro_cue_ms: int | None = None
    outro_cue_ms: int | None = None
    intro_lufs: float | None = None
    outro_lufs: float | None = None
    true_peak_dbfs: float | None = None
    intro_energy: float | None = None
    outro_energy: float | None = None
    intro_spectral_density: float | None = None
    outro_spectral_density: float | None = None
    global_energy: float | None = None
    danceability: float | None = None
    valence: float | None = None
    bliss_vector_revision: str | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "quality", MixProfileQuality(self.quality))
        _require_positive_int("profile_version", self.profile_version)
        for field_name in (
            "duration_ms",
            "beat_anchor_ms",
            "downbeat_anchor_ms",
            "intro_cue_ms",
            "outro_cue_ms",
        ):
            _require_non_negative_ms(field_name, getattr(self, field_name))
        object.__setattr__(
            self,
            "beat_grid_ms",
            tuple(
                _validated_ms("beat_grid_ms", position)
                for position in self.beat_grid_ms
            ),
        )
        if any(
            current <= previous
            for previous, current in zip(
                self.beat_grid_ms, self.beat_grid_ms[1:], strict=False
            )
        ):
            raise ValueError("beat_grid_ms must be strictly increasing")
        for field_name in (
            "bpm_confidence",
            "tempo_stability",
            "key_confidence",
            "intro_energy",
            "outro_energy",
            "intro_spectral_density",
            "outro_spectral_density",
            "global_energy",
            "danceability",
            "valence",
        ):
            value = getattr(self, field_name)
            if value is not None:
                object.__setattr__(self, field_name, _clamp_confidence(value))
        if self.analyzed_at.tzinfo is None:
            raise ValueError("analyzed_at must be timezone-aware")

    def to_summary_dict(self) -> dict[str, Any]:
        return self._serialize(include_beat_grid=False)

    def to_full_dict(self) -> dict[str, Any]:
        return self._serialize(include_beat_grid=True)

    def _serialize(self, *, include_beat_grid: bool) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "trackEntityUid": self.track_entity_uid,
            "profileVersion": self.profile_version,
            "profileRevision": self.profile_revision,
            "analyzer": self.analyzer,
            "analyzerVersion": self.analyzer_version,
            "sourceRevision": self.source_revision,
            "durationMs": self.duration_ms,
            "bpm": self.bpm,
            "bpmConfidence": self.bpm_confidence,
            "tempoStability": self.tempo_stability,
            "beatAnchorMs": self.beat_anchor_ms,
            "downbeatAnchorMs": self.downbeat_anchor_ms,
            "timeSignature": self.time_signature,
            "beatGridFormat": self.beat_grid_format,
            "key": self.key,
            "scale": self.scale,
            "camelot": self.camelot,
            "keyConfidence": self.key_confidence,
            "introCueMs": self.intro_cue_ms,
            "outroCueMs": self.outro_cue_ms,
            "introLufs": self.intro_lufs,
            "outroLufs": self.outro_lufs,
            "truePeakDbfs": self.true_peak_dbfs,
            "introEnergy": self.intro_energy,
            "outroEnergy": self.outro_energy,
            "introSpectralDensity": self.intro_spectral_density,
            "outroSpectralDensity": self.outro_spectral_density,
            "globalEnergy": self.global_energy,
            "danceability": self.danceability,
            "valence": self.valence,
            "blissVectorRevision": self.bliss_vector_revision,
            "quality": MixProfileQuality(self.quality).value,
            "analyzedAt": _isoformat(self.analyzed_at),
        }
        if include_beat_grid:
            payload["beatGridMs"] = list(self.beat_grid_ms)
        return payload


@dataclass(frozen=True, slots=True)
class TransitionContext:
    source: str
    automatic: bool
    offline: bool
    preferred_duration_ms: int
    user_cue_profile: str
    allow_beatmatch: bool
    allow_tempo_adjustment: bool

    def __post_init__(self) -> None:
        if self.source not in {
            "album",
            "playlist",
            "radio",
            "shuffle",
            "infinite",
            "manual",
        }:
            raise ValueError(f"Unsupported transition source: {self.source!r}")
        _require_non_negative_ms("preferred_duration_ms", self.preferred_duration_ms)

    def to_dict(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "automatic": self.automatic,
            "offline": self.offline,
            "preferredDurationMs": self.preferred_duration_ms,
            "userCueProfile": self.user_cue_profile,
            "allowBeatmatch": self.allow_beatmatch,
            "allowTempoAdjustment": self.allow_tempo_adjustment,
        }


@dataclass(frozen=True, slots=True)
class TransitionPlan:
    planner_version: int
    outgoing_track_entity_uid: str
    incoming_track_entity_uid: str
    mode: TransitionMode | str
    duration_ms: int
    outgoing_cue_ms: int
    incoming_cue_ms: int
    incoming_tempo_ratio: float
    beat_phase_offset_ms: int
    handoff_progress: float
    outgoing_gain_db: float
    incoming_gain_db: float
    curve: str
    bass_handoff: str
    confidence: float
    fallback_reason: TransitionFallbackReason | str | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "mode", TransitionMode(self.mode))
        if self.fallback_reason is not None:
            object.__setattr__(
                self,
                "fallback_reason",
                TransitionFallbackReason(self.fallback_reason),
            )
        _require_positive_int("planner_version", self.planner_version)
        for field_name in (
            "duration_ms",
            "outgoing_cue_ms",
            "incoming_cue_ms",
            "beat_phase_offset_ms",
        ):
            _require_non_negative_ms(field_name, getattr(self, field_name))
        ratio = float(self.incoming_tempo_ratio)
        if not math.isfinite(ratio) or ratio < 0.94 or ratio > 1.06:
            raise ValueError("incoming_tempo_ratio must be between 0.94 and 1.06")
        object.__setattr__(self, "incoming_tempo_ratio", ratio)
        object.__setattr__(
            self, "handoff_progress", _clamp_confidence(self.handoff_progress)
        )
        object.__setattr__(self, "confidence", _clamp_confidence(self.confidence))
        if self.curve != "equal-power":
            raise ValueError(f"Unsupported transition curve: {self.curve!r}")
        if self.bass_handoff not in {"none", "balanced"}:
            raise ValueError(f"Unsupported bass handoff: {self.bass_handoff!r}")

    def to_dict(self) -> dict[str, Any]:
        return {
            "plannerVersion": self.planner_version,
            "outgoingTrackEntityUid": self.outgoing_track_entity_uid,
            "incomingTrackEntityUid": self.incoming_track_entity_uid,
            "mode": TransitionMode(self.mode).value,
            "durationMs": self.duration_ms,
            "outgoingCueMs": self.outgoing_cue_ms,
            "incomingCueMs": self.incoming_cue_ms,
            "incomingTempoRatio": self.incoming_tempo_ratio,
            "beatPhaseOffsetMs": self.beat_phase_offset_ms,
            "handoffProgress": self.handoff_progress,
            "outgoingGainDb": self.outgoing_gain_db,
            "incomingGainDb": self.incoming_gain_db,
            "curve": self.curve,
            "bassHandoff": self.bass_handoff,
            "confidence": self.confidence,
            "fallbackReason": (
                TransitionFallbackReason(self.fallback_reason).value
                if self.fallback_reason is not None
                else None
            ),
        }


def _require_positive_int(name: str, value: int) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValueError(f"{name} must be a positive integer")


def _validated_ms(name: str, value: int) -> int:
    _require_non_negative_ms(name, value)
    return value


def _require_non_negative_ms(name: str, value: int | None) -> None:
    if value is None:
        return
    if isinstance(value, bool) or not isinstance(value, int):
        raise TypeError(f"{name} must be an integer number of milliseconds")
    if value < 0:
        raise ValueError(f"{name} must not be negative")


def _clamp_confidence(value: float) -> float:
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("confidence values must be finite")
    return max(0.0, min(1.0, number))


def _isoformat(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")

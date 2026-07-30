from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class SmartMixApiModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class SmartMixRequestModel(SmartMixApiModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class MixProfileResponse(SmartMixApiModel):
    track_entity_uid: UUID = Field(alias="trackEntityUid")
    profile_version: int = Field(alias="profileVersion", ge=1)
    profile_revision: str = Field(alias="profileRevision")
    analyzer: str
    analyzer_version: str = Field(alias="analyzerVersion")
    source_revision: str = Field(alias="sourceRevision")
    duration_ms: int = Field(alias="durationMs", ge=0)
    quality: Literal["full", "partial", "legacy", "unavailable"]
    analyzed_at: datetime = Field(alias="analyzedAt")
    bpm: float | None = Field(default=None, gt=0)
    bpm_confidence: float | None = Field(
        default=None,
        alias="bpmConfidence",
        ge=0.0,
        le=1.0,
    )
    tempo_stability: float | None = Field(
        default=None,
        alias="tempoStability",
        ge=0.0,
        le=1.0,
    )
    beat_anchor_ms: int | None = Field(default=None, alias="beatAnchorMs", ge=0)
    downbeat_anchor_ms: int | None = Field(
        default=None,
        alias="downbeatAnchorMs",
        ge=0,
    )
    time_signature: int | None = Field(
        default=None,
        alias="timeSignature",
        ge=1,
    )
    beat_grid_format: str | None = Field(default=None, alias="beatGridFormat")
    beat_grid_ms: list[int] | None = Field(default=None, alias="beatGridMs")
    key: str | None = None
    scale: str | None = None
    camelot: str | None = None
    key_confidence: float | None = Field(
        default=None,
        alias="keyConfidence",
        ge=0.0,
        le=1.0,
    )
    intro_cue_ms: int | None = Field(default=None, alias="introCueMs", ge=0)
    outro_cue_ms: int | None = Field(default=None, alias="outroCueMs", ge=0)
    intro_lufs: float | None = Field(default=None, alias="introLufs")
    outro_lufs: float | None = Field(default=None, alias="outroLufs")
    true_peak_dbfs: float | None = Field(default=None, alias="truePeakDbfs")
    intro_energy: float | None = Field(
        default=None,
        alias="introEnergy",
        ge=0.0,
        le=1.0,
    )
    outro_energy: float | None = Field(
        default=None,
        alias="outroEnergy",
        ge=0.0,
        le=1.0,
    )
    intro_spectral_density: float | None = Field(
        default=None,
        alias="introSpectralDensity",
        ge=0.0,
        le=1.0,
    )
    outro_spectral_density: float | None = Field(
        default=None,
        alias="outroSpectralDensity",
        ge=0.0,
        le=1.0,
    )
    global_energy: float | None = Field(
        default=None,
        alias="globalEnergy",
        ge=0.0,
        le=1.0,
    )
    danceability: float | None = Field(default=None, ge=0.0, le=1.0)
    valence: float | None = Field(default=None, ge=0.0, le=1.0)
    bliss_vector_revision: str | None = Field(
        default=None,
        alias="blissVectorRevision",
    )


class TransitionContextRequest(SmartMixRequestModel):
    source: Literal[
        "album",
        "playlist",
        "radio",
        "shuffle",
        "infinite",
        "manual",
    ]
    automatic: bool
    offline: bool
    preferred_duration_ms: int = Field(
        alias="preferredDurationMs",
        ge=0,
        le=12_000,
    )
    user_cue_profile: str = Field(
        alias="userCueProfile",
        min_length=1,
        max_length=64,
    )
    allow_beatmatch: bool = Field(alias="allowBeatmatch")
    allow_tempo_adjustment: bool = Field(alias="allowTempoAdjustment")


class TransitionEdgeRequest(SmartMixRequestModel):
    outgoing_track_entity_uid: UUID = Field(alias="outgoingTrackEntityUid")
    incoming_track_entity_uid: UUID = Field(alias="incomingTrackEntityUid")
    context: TransitionContextRequest


class TransitionPlanBatchRequest(SmartMixRequestModel):
    planner_version: Literal["smart-mix-v1"] = Field(alias="plannerVersion")
    edges: list[TransitionEdgeRequest] = Field(min_length=1, max_length=32)


class TransitionPlanResponse(SmartMixApiModel):
    planner_version: Literal[1] = Field(alias="plannerVersion")
    outgoing_track_entity_uid: UUID = Field(alias="outgoingTrackEntityUid")
    incoming_track_entity_uid: UUID = Field(alias="incomingTrackEntityUid")
    mode: Literal["gapless", "adaptive", "beatmatch"]
    duration_ms: int = Field(alias="durationMs", ge=0)
    outgoing_cue_ms: int = Field(alias="outgoingCueMs", ge=0)
    incoming_cue_ms: int = Field(alias="incomingCueMs", ge=0)
    incoming_tempo_ratio: float = Field(
        alias="incomingTempoRatio",
        ge=0.94,
        le=1.06,
    )
    beat_phase_offset_ms: int = Field(alias="beatPhaseOffsetMs", ge=0)
    handoff_progress: float = Field(
        alias="handoffProgress",
        ge=0.0,
        le=1.0,
    )
    outgoing_gain_db: float = Field(alias="outgoingGainDb")
    incoming_gain_db: float = Field(alias="incomingGainDb")
    curve: Literal["equal-power"]
    bass_handoff: Literal["none", "balanced"] = Field(alias="bassHandoff")
    confidence: float = Field(ge=0.0, le=1.0)
    fallback_reason: (
        Literal[
            "missing_profile",
            "low_confidence",
            "unstable_tempo",
            "incompatible_tempo",
            "incompatible_meter",
            "preload_deadline",
            "offline_unavailable",
        ]
        | None
    ) = Field(default=None, alias="fallbackReason")


class TransitionPlanBatchResponse(SmartMixApiModel):
    planner_version: Literal["smart-mix-v1"] = Field(alias="plannerVersion")
    plans: list[TransitionPlanResponse]


class CompatibilityScoreResponse(SmartMixApiModel):
    planner_version: int = Field(serialization_alias="plannerVersion")
    overall: float = Field(ge=0.0, le=1.0)
    signal_confidence: float = Field(
        ge=0.0,
        le=1.0,
        serialization_alias="signalConfidence",
    )
    tempo: float = Field(ge=0.0, le=1.0)
    harmonic: float = Field(ge=0.0, le=1.0)
    harmonic_relationship: Literal[
        "same",
        "adjacent",
        "relative",
        "incompatible",
        "unknown",
    ] = Field(serialization_alias="harmonicRelationship")
    energy: float = Field(ge=0.0, le=1.0)
    danceability: float = Field(ge=0.0, le=1.0)
    valence: float = Field(ge=0.0, le=1.0)
    bliss: float = Field(ge=0.0, le=1.0)
    genre: float = Field(ge=0.0, le=1.0)


class CompatibleTrackResponse(SmartMixApiModel):
    track_id: int = Field(serialization_alias="trackId")
    track_entity_uid: str = Field(serialization_alias="trackEntityUid")
    title: str
    artist: str
    album: str
    score: float = Field(ge=0.0, le=1.0)
    confidence: float = Field(ge=0.0, le=1.0)
    score_breakdown: CompatibilityScoreResponse = Field(
        serialization_alias="scoreBreakdown"
    )
    fallback_reasons: list[str] = Field(
        default_factory=list,
        serialization_alias="fallbackReasons",
    )


class CompatibleTracksResponse(SmartMixApiModel):
    seed_track_entity_uid: str = Field(serialization_alias="seedTrackEntityUid")
    scope: Literal["local"]
    planner_version: Literal["smart-mix-v1"] = Field(
        serialization_alias="plannerVersion"
    )
    items: list[CompatibleTrackResponse]


__all__ = [
    "CompatibilityScoreResponse",
    "CompatibleTrackResponse",
    "CompatibleTracksResponse",
    "MixProfileResponse",
    "TransitionContextRequest",
    "TransitionEdgeRequest",
    "TransitionPlanBatchRequest",
    "TransitionPlanBatchResponse",
    "TransitionPlanResponse",
]

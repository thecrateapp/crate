from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


# Planner identifiers the plan batch accepts (SM3-D3); smart-mix-v2 is the default.
PlannerIdentifier = Literal["smart-mix-v2", "smart-mix-v3"]


class SmartMixApiModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class SmartMixRequestModel(SmartMixApiModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class StemPhraseLevelsResponse(SmartMixApiModel):
    start_ms: int = Field(alias="startMs", ge=0)
    end_ms: int = Field(alias="endMs", ge=0)
    drums: int = Field(ge=0, le=255)
    bass: int = Field(ge=0, le=255)
    other: int = Field(ge=0, le=255)
    vocals: int = Field(ge=0, le=255)


class StemsLayerResponse(SmartMixApiModel):
    """Per-phrase stem levels of a profile (Smart Mix Stems, STEM-D4)."""

    producer: str = Field(
        description="Producer of the analysis: crate-server/<version> or "
        "crate-decks/<version>."
    )
    separator_model: Literal["htdemucs", "htdemucs_ft"] = Field(alias="separatorModel")
    separator_version: str = Field(alias="separatorVersion")
    phrases: list[StemPhraseLevelsResponse] = Field(
        description=(
            "One entry per phrase of the profile, in order: the mean level byte of each "
            "stem over the phrase (RMS dBFS, linear from -60 dB at 0 to 0 dB at 255)."
        )
    )


class StemAnalysisUploadResponse(SmartMixApiModel):
    result: Literal["stored", "replaced", "kept_stronger"] = Field(
        description=(
            "stored or replaced: the upload is the track's Decks analysis. "
            "kept_stronger: nothing was stored, because the server keeps a stronger "
            "analysis of the same file, or an equal one of its own."
        )
    )


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
    bpm: float | None = Field(
        default=None,
        gt=0,
        description=(
            "Global tempo. From analyzer v6, a whole (or half) BPM when the track keeps "
            "a constant tempo that rounds to it within 25 ms over the track; otherwise "
            "the fitted tempo."
        ),
    )
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
    beat_grid_ms: list[int] | None = Field(
        default=None,
        alias="beatGridMs",
        description=(
            "Absolute beat positions in ms. From analyzer v6, a constant grid at `bpm` "
            "when the track keeps one tempo, otherwise the tracked beats."
        ),
    )
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
    intro_bpm: float | None = Field(default=None, alias="introBpm", gt=0)
    intro_beat_ms: int | None = Field(default=None, alias="introBeatMs", ge=0)
    outro_bpm: float | None = Field(default=None, alias="outroBpm", gt=0)
    outro_beat_ms: int | None = Field(default=None, alias="outroBeatMs", ge=0)
    intro_tempo_stability: float | None = Field(
        default=None, alias="introTempoStability", ge=0.0, le=1.0
    )
    outro_tempo_stability: float | None = Field(
        default=None, alias="outroTempoStability", ge=0.0, le=1.0
    )
    intro_downbeat_ms: int | None = Field(default=None, alias="introDownbeatMs", ge=0)
    outro_downbeat_ms: int | None = Field(default=None, alias="outroDownbeatMs", ge=0)
    intro_lufs: float | None = Field(default=None, alias="introLufs")
    outro_lufs: float | None = Field(default=None, alias="outroLufs")
    true_peak_dbfs: float | None = Field(default=None, alias="truePeakDbfs")
    integrated_lufs: float | None = Field(default=None, alias="integratedLufs")
    measurement_version: str | None = Field(default=None, alias="measurementVersion")
    active_start_ms: int | None = Field(
        default=None,
        alias="activeStartMs",
        ge=0,
        description=(
            "Musical start: first 50 ms RMS frame (25 ms hop) within 35 dB of the "
            "loudest frame and above -55 dBFS. Not a -60 dB silence threshold."
        ),
    )
    active_end_ms: int | None = Field(
        default=None,
        alias="activeEndMs",
        ge=0,
        description=(
            "Musical end: end of the last 50 ms RMS frame within 35 dB of the loudest "
            "frame and above -55 dBFS (for long tracks, of the last 120 s). A fade or "
            "reverb tail can continue after it, so it usually falls 1-6 s before a "
            "-60 dB end of sound such as Mixxx's."
        ),
    )
    duration_source: Literal["decoder", "library"] = Field(
        default="decoder", alias="durationSource"
    )
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
    stems: StemsLayerResponse | None = Field(
        default=None,
        description=(
            "Stems layer, with detail=full only, when a stem analysis of the profile's "
            "file applies: the same source revision and a duration within 2 %."
        ),
    )


class SetHistoryEntryRequest(SmartMixRequestModel):
    """One of the last transitions a client played, as numbers only (SM3-D6)."""

    mode: Literal["gapless", "adaptive", "beatmatch"]
    duration_bars: int = Field(alias="durationBars", ge=0, le=128)
    delta_energy: float = Field(alias="deltaEnergy", ge=-1.0, le=1.0)


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
    allow_bass_handoff: bool = Field(default=False, alias="allowBassHandoff")
    allow_long_beatmatch: bool = Field(default=False, alias="allowLongBeatmatch")
    set_history: list[SetHistoryEntryRequest] | None = Field(
        default=None,
        alias="setHistory",
        max_length=3,
        description=(
            "Up to the last three transitions the client played, oldest first, for "
            "the energy arc of the set. The deterministic planners do not read it, "
            "so it does not change the plan or its cache."
        ),
    )
    ai_refinement: bool = Field(
        default=False,
        alias="aiRefinement",
        description=(
            "smart-mix-v3 only: also return `refinement`, the plan an AI model "
            "chose from the planner's candidates (SM3-D4). The deterministic plan "
            "is always returned and does not depend on this flag. smart-mix-v2 "
            "ignores it."
        ),
    )


class TransitionEdgeRequest(SmartMixRequestModel):
    outgoing_track_entity_uid: UUID = Field(alias="outgoingTrackEntityUid")
    incoming_track_entity_uid: UUID = Field(alias="incomingTrackEntityUid")
    context: TransitionContextRequest


class TransitionPlanBatchRequest(SmartMixRequestModel):
    planner_version: PlannerIdentifier = Field(
        default="smart-mix-v2",
        alias="plannerVersion",
        description=(
            "smart-mix-v3 places the mix on the analyzed phrases when both "
            "profiles have them and falls back to smart-mix-v2's bar heuristic "
            "otherwise. Each plan keeps plannerVersion 2: the plan format is the "
            "same."
        ),
    )
    edges: list[TransitionEdgeRequest] = Field(min_length=1, max_length=32)


class _TransitionPlanFields(SmartMixApiModel):
    planner_version: Literal[2] = Field(alias="plannerVersion")
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
    beat_phase_offset_ms: int = Field(
        alias="beatPhaseOffsetMs",
        ge=0,
        description=(
            "Beatmatch only, in output time (the outgoing tempo), below one outgoing "
            "beat. The incoming track starts this much after `incomingCueMs` when the "
            "outgoing reaches `outgoingCueMs`: in incoming track time, start at "
            "incomingCueMs + beatPhaseOffsetMs * incomingTempoRatio. Never subtract it."
        ),
    )
    handoff_progress: float = Field(
        alias="handoffProgress",
        ge=0.0,
        le=1.0,
    )
    outgoing_gain_db: float = Field(alias="outgoingGainDb")
    incoming_gain_db: float = Field(alias="incomingGainDb")
    curve: Literal["equal-power", "dj-blend"]
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
            "insufficient_window",
        ]
        | None
    ) = Field(default=None, alias="fallbackReason")


class RefinedTransitionPlanResponse(_TransitionPlanFields):
    """A plan rebuilt from the candidate an AI model chose and validated again."""


RefinementReasonCode = Literal[
    "disabled",
    "no_model",
    "budget",
    "missing_profile",
    "single_candidate",
    "permission_denied",
    "scope_missing",
    "rate_limited",
    "rejected",
    "failed",
]


class TransitionRefinementResponse(SmartMixApiModel):
    status: Literal["ready", "pending", "unavailable"] = Field(
        description=(
            "ready: `plan` is the refined plan. pending: queued; request the same "
            "edge again, at most every 5 s. unavailable: keep the deterministic "
            "plan; `reasonCode` says why."
        )
    )
    reason_code: RefinementReasonCode | None = Field(default=None, alias="reasonCode")
    plan: RefinedTransitionPlanResponse | None = None
    source: Literal["ai"] | None = None
    model_label: str | None = Field(default=None, alias="modelLabel", max_length=200)
    reason: str | None = Field(default=None, max_length=240)
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    prompt_version: str | None = Field(default=None, alias="promptVersion")
    candidate_index: int | None = Field(default=None, alias="candidateIndex", ge=0)


class TransitionPlanResponse(_TransitionPlanFields):
    structure_used: bool | None = Field(
        default=None,
        alias="structureUsed",
        description=(
            "smart-mix-v3 only: whether the plan was chosen on the stored phrases of "
            "both tracks. False when either track has none and the bar heuristic "
            "planned the edge. Absent from smart-mix-v2 plans."
        ),
    )

    refinement: TransitionRefinementResponse | None = Field(
        default=None,
        description=(
            "Only when the edge asked for `aiRefinement` with smart-mix-v3 "
            "(SM3-D4). Absent otherwise."
        ),
    )


class TransitionPlanBatchResponse(SmartMixApiModel):
    planner_version: PlannerIdentifier = Field(alias="plannerVersion")
    plans: list[TransitionPlanResponse]


class ContinuationDescriptor(SmartMixRequestModel):
    batch_index: int | None = Field(default=None, alias="batchIndex", ge=0)
    kind: Literal["shaped_radio", "seeded_radio"]
    session_id: str | None = Field(
        default=None, alias="sessionId", min_length=1, max_length=128
    )
    seed_type: (
        Literal["artist", "track", "album", "playlist", "home_playlist"] | None
    ) = Field(default=None, alias="seedType")
    seed_id: str | None = Field(
        default=None, alias="seedId", min_length=1, max_length=256
    )

    @model_validator(mode="after")
    def _require_kind_fields(self) -> "ContinuationDescriptor":
        if self.kind == "shaped_radio" and not self.session_id:
            raise ValueError("shaped_radio needs sessionId")
        if self.session_id:
            self.session_id = str(UUID(self.session_id))
        if self.kind == "seeded_radio" and not (self.seed_type and self.seed_id):
            raise ValueError("seeded_radio needs seedType and seedId")
        return self


class PlaybackContinuationTokenRequest(SmartMixRequestModel):
    descriptor: ContinuationDescriptor | None = None


class PlaybackContinuationRequest(SmartMixRequestModel):
    batch_index: int | None = Field(default=None, alias="batchIndex", ge=0)
    planner_version: Literal["smart-mix-v2"] = Field(alias="plannerVersion")
    after_track_entity_uid: UUID | None = Field(
        default=None, alias="afterTrackEntityUid"
    )
    recent_entity_uids: list[UUID] = Field(
        default_factory=list, alias="recentEntityUids", max_length=200
    )
    limit: int = Field(default=10, ge=1, le=30)
    delivery: str = Field(
        default="original", min_length=1, max_length=32, pattern=r"^[a-z_]+$"
    )
    context: TransitionContextRequest


class ContinuationTrackResponse(SmartMixApiModel):
    id: str
    entity_uid: UUID = Field(alias="entityUid")
    url: str
    title: str
    artist: str
    album: str | None = None
    duration_ms: int | None = Field(default=None, alias="durationMs")
    source: dict


class PlaybackContinuationResponse(SmartMixApiModel):
    status: Literal["ok", "retryable_empty", "exhausted", "auth_required"] = "ok"
    session_id: str | None = Field(default=None, alias="sessionId")
    batch_index: int | None = Field(default=None, alias="batchIndex")
    tracks: list[ContinuationTrackResponse]
    plans: list[TransitionPlanResponse]
    exhausted: bool


class PlaybackContinuationTokenResponse(SmartMixApiModel):
    token: str
    expires_at: datetime = Field(alias="expiresAt")


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
    transition: float | None = Field(default=None, ge=0.0, le=1.0)
    beatmatch_affinity: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        serialization_alias="beatmatchAffinity",
    )
    beatmatchable: bool | None = None
    tempo_flow: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        serialization_alias="tempoFlow",
    )
    level: float | None = Field(default=None, ge=0.0, le=1.0)
    brightness: float | None = Field(default=None, ge=0.0, le=1.0)
    silence: float | None = Field(default=None, ge=0.0, le=1.0)


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
    duration: float | None = None
    bpm: float | None = None
    camelot: str | None = None
    energy: float | None = Field(default=None, ge=0.0, le=1.0)
    year: str | None = None
    genre: str | None = None
    cover_url: str | None = Field(default=None, serialization_alias="coverUrl")
    album_id: int | None = Field(default=None, serialization_alias="albumId")


class CompatibleTracksResponse(SmartMixApiModel):
    seed_track_entity_uid: str = Field(serialization_alias="seedTrackEntityUid")
    scope: Literal["local"]
    planner_version: Literal["smart-mix-v2"] = Field(
        serialization_alias="plannerVersion"
    )
    context: Literal["auto", "beatmatch", "smooth"] | None = None
    items: list[CompatibleTrackResponse]


__all__ = [
    "CompatibilityScoreResponse",
    "CompatibleTrackResponse",
    "CompatibleTracksResponse",
    "MixProfileResponse",
    "PlannerIdentifier",
    "SetHistoryEntryRequest",
    "StemAnalysisUploadResponse",
    "StemPhraseLevelsResponse",
    "StemsLayerResponse",
    "TransitionContextRequest",
    "TransitionEdgeRequest",
    "TransitionPlanBatchRequest",
    "TransitionPlanBatchResponse",
    "TransitionPlanResponse",
]

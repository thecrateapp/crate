from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class SmartMixApiModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


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
]

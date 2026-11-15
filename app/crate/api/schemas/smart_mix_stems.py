"""Responses of the stems reads for the admin and of the Smart Mix limit (ST2.PR4)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field

from crate.api.schemas.smart_mix import (
    SmartMixApiModel,
    SmartMixPlaylistStateCounts,
    StemsLayerResponse,
)
from crate.smart_mix.stems import StemLevels


class SmartMixLimitErrorResponse(SmartMixApiModel):
    """A Smart Mix playlist change refused by one of the instance's limits."""

    detail: str = Field(description="The refusal in English.")
    limit: Literal["playlist", "user"] = Field(
        description=(
            "playlist: tracks of this Smart Mix playlist. user: distinct tracks of all "
            "of the owner's Smart Mix playlists."
        )
    )
    max_tracks: int = Field(
        serialization_alias="maxTracks", ge=1, description="The limit."
    )
    tracks: int = Field(ge=0, description="The tracks the change would have led to.")


class SmartMixUserRef(SmartMixApiModel):
    id: int
    username: str | None


class SmartMixTrackPhraseResponse(SmartMixApiModel):
    start_ms: int = Field(serialization_alias="startMs", ge=0)
    end_ms: int = Field(serialization_alias="endMs", ge=0)
    kind: str
    bars: int = Field(ge=0)
    voiced: bool | None = Field(
        description="The profile's voice in the phrase; null without a detector."
    )


class SmartMixTrackStemAnalysisResponse(SmartMixApiModel):
    producer_kind: Literal["server", "decks"] = Field(
        serialization_alias="producerKind"
    )
    producer: str
    separator_model: Literal["htdemucs", "htdemucs_ft"] = Field(
        serialization_alias="separatorModel"
    )
    separator_version: str = Field(serialization_alias="separatorVersion")
    source_revision: str = Field(serialization_alias="sourceRevision")
    hop_ms: int = Field(serialization_alias="hopMs")
    duration_ms: int = Field(serialization_alias="durationMs", gt=0)
    levels: StemLevels
    drum_beats_ms: list[int] | None = Field(serialization_alias="drumBeatsMs")
    current: bool = Field(description="It describes the track's current file.")
    chosen: bool = Field(
        description="Smart Mix uses it: the strongest current analysis, the server's "
        "on a tie."
    )
    created_at: datetime = Field(serialization_alias="createdAt")
    updated_at: datetime = Field(serialization_alias="updatedAt")
    contributed_by: SmartMixUserRef | None = Field(
        serialization_alias="contributedBy",
        description="The user who uploaded a Decks analysis.",
    )


class SmartMixTrackStemJobResponse(SmartMixApiModel):
    state: Literal["pending", "analyzing", "ready", "failed"] = Field(
        description=(
            "ready: a server analysis of the current file exists. pending, analyzing "
            "and failed are the job's own; a finished job whose analysis no longer "
            "applies is pending."
        )
    )
    attempts: int = Field(ge=0)
    max_attempts: int = Field(serialization_alias="maxAttempts", ge=1)
    requested_at: datetime | None = Field(serialization_alias="requestedAt")
    started_at: datetime | None = Field(serialization_alias="startedAt")
    finished_at: datetime | None = Field(serialization_alias="finishedAt")
    last_error: str | None = Field(
        serialization_alias="lastError",
        description="Why the last attempt failed; only for library.analysis.manage.",
    )
    seconds_per_track: int = Field(
        serialization_alias="secondsPerTrack",
        ge=0,
        description="The server's recent separation time per track, or its estimate.",
    )


class SmartMixTrackStemFileResponse(SmartMixApiModel):
    size_bytes: int = Field(serialization_alias="bytes", gt=0)
    separator_model: str = Field(serialization_alias="separatorModel")
    separator_version: str = Field(serialization_alias="separatorVersion")
    source_revision: str = Field(serialization_alias="sourceRevision")
    current: bool = Field(description="It was separated from the current file.")
    created_at: datetime = Field(serialization_alias="createdAt")
    last_used_at: datetime = Field(serialization_alias="lastUsedAt")


class SmartMixTrackPlaylistResponse(SmartMixApiModel):
    playlist_id: int = Field(serialization_alias="playlistId")
    name: str
    owner: SmartMixUserRef | None
    enabled: bool
    ready: int = Field(ge=0, description="Local tracks with stems, while on.")
    total: int = Field(ge=0, description="Distinct local tracks, while on.")


class SmartMixTrackStemsResponse(SmartMixApiModel):
    """A track's stems: what the admin's Audio profile dialog shows in its Stems tab."""

    track_id: int = Field(serialization_alias="trackId")
    track_entity_uid: str | None = Field(serialization_alias="trackEntityUid")
    duration_ms: int | None = Field(
        serialization_alias="durationMs",
        ge=0,
        description="The current profile's duration, else the library's.",
    )
    source_revision: str | None = Field(
        serialization_alias="sourceRevision",
        description="The current file's revision; null without a current profile.",
    )
    profile_analyzed_at: datetime | None = Field(
        serialization_alias="profileAnalyzedAt",
        description="When the track's profile was analysed.",
    )
    source_stale_at: datetime | None = Field(
        serialization_alias="sourceStaleAt",
        description="When the file changed after its profile was analysed.",
    )
    vocal_detector: str | None = Field(serialization_alias="vocalDetector")
    phrases: list[SmartMixTrackPhraseResponse] = Field(
        description="The current profile's phrases; empty without one."
    )
    analyses: list[SmartMixTrackStemAnalysisResponse] = Field(
        description="Every stored analysis, of any source revision; server first."
    )
    stems: StemsLayerResponse | None = Field(
        description="The stems layer of the chosen analysis, as profiles serve it."
    )
    job: SmartMixTrackStemJobResponse | None
    file: SmartMixTrackStemFileResponse | None = Field(
        description="The stem file the server keeps for Crate Decks."
    )
    playlists: list[SmartMixTrackPlaylistResponse] = Field(
        description=(
            "Smart Mix playlists holding the track: all of them for "
            "library.analysis.manage, else those the caller owns or belongs to."
        )
    )


class SmartMixStemFailureResponse(SmartMixApiModel):
    track_id: int = Field(serialization_alias="trackId")
    title: str | None
    artist: str | None
    attempts: int = Field(ge=0)
    last_error: str | None = Field(serialization_alias="lastError")
    finished_at: datetime | None = Field(serialization_alias="finishedAt")


class SmartMixAdminPlaylistResponse(SmartMixApiModel):
    playlist_id: int = Field(serialization_alias="playlistId")
    name: str
    owner: SmartMixUserRef | None
    enabled: bool
    enabled_at: datetime | None = Field(serialization_alias="enabledAt")
    disabled_at: datetime | None = Field(serialization_alias="disabledAt")
    last_used_at: datetime | None = Field(serialization_alias="lastUsedAt")
    total: int = Field(ge=0, description="Distinct local tracks.")
    counts: SmartMixPlaylistStateCounts = Field(description="Zero while off.")
    estimated_seconds_left: int | None = Field(
        serialization_alias="estimatedSecondsLeft",
        ge=0,
        description="Time left for its pending and analysing tracks; null when none.",
    )
    failures: list[SmartMixStemFailureResponse] = Field(
        description="Its latest failed tracks (three at most), while on."
    )
    file_bytes: int = Field(serialization_alias="fileBytes", ge=0)
    files: int = Field(ge=0)


class SmartMixStemStorageResponse(SmartMixApiModel):
    used_bytes: int = Field(serialization_alias="usedBytes", ge=0)
    files: int = Field(ge=0)
    evictable_bytes: int = Field(
        serialization_alias="evictableBytes",
        ge=0,
        description="Files of tracks in no Smart Mix playlist that is on: evicted first.",
    )


class SmartMixStemSettingsResponse(SmartMixApiModel):
    max_tracks_per_playlist: int = Field(
        serialization_alias="maxTracksPerPlaylist", ge=1
    )
    max_tracks_per_user: int | None = Field(
        serialization_alias="maxTracksPerUser", ge=1
    )
    quota_gib: int = Field(serialization_alias="quotaGib", ge=0)
    uploads_enabled: bool = Field(serialization_alias="uploadsEnabled")


class SmartMixStemOverviewResponse(SmartMixApiModel):
    playlists_on: int = Field(serialization_alias="playlistsOn", ge=0)
    playlists_off: int = Field(serialization_alias="playlistsOff", ge=0)
    tracks: int = Field(
        ge=0,
        description="Distinct local tracks of the Smart Mix playlists that are on.",
    )
    counts: SmartMixPlaylistStateCounts
    estimated_seconds_left: int | None = Field(
        serialization_alias="estimatedSecondsLeft", ge=0
    )
    seconds_per_track: int = Field(serialization_alias="secondsPerTrack", ge=0)
    server_separator: str | None = Field(serialization_alias="serverSeparator")
    storage: SmartMixStemStorageResponse
    settings: SmartMixStemSettingsResponse


class SmartMixAdminPlaylistsResponse(SmartMixApiModel):
    playlists: list[SmartMixAdminPlaylistResponse]
    overview: SmartMixStemOverviewResponse


__all__ = [
    "SmartMixAdminPlaylistResponse",
    "SmartMixAdminPlaylistsResponse",
    "SmartMixLimitErrorResponse",
    "SmartMixStemFailureResponse",
    "SmartMixStemOverviewResponse",
    "SmartMixStemSettingsResponse",
    "SmartMixStemStorageResponse",
    "SmartMixTrackPhraseResponse",
    "SmartMixTrackPlaylistResponse",
    "SmartMixTrackStemAnalysisResponse",
    "SmartMixTrackStemFileResponse",
    "SmartMixTrackStemJobResponse",
    "SmartMixTrackStemsResponse",
    "SmartMixUserRef",
]

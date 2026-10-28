"""Schema models for management and admin operations."""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from crate.api.schemas.common import OkResponse, SnapshotMetadataResponse


class DeleteRequest(BaseModel):
    mode: str = "db_only"


class TrackQuarantineRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class TrackRestoreRequest(BaseModel):
    quarantine_path: str = Field(min_length=1, max_length=2000)
    target_path: str | None = Field(default=None, max_length=2000)
    reason: str | None = Field(default=None, max_length=500)


class TrackQuarantineFileRequest(BaseModel):
    quarantine_path: str = Field(min_length=1, max_length=2000)
    reason: str | None = Field(default=None, max_length=500)


class TrackQuarantineEntryResponse(BaseModel):
    quarantine_path: str
    filename: str
    size_bytes: int
    modified_at: datetime
    suggested_target_path: str
    title: str | None = None
    artist: str | None = None
    album: str | None = None
    albumartist: str | None = None
    track_number: str | None = None
    disc_number: str | None = None
    year: str | None = None
    genre: str | None = None
    duration: float | None = None
    bitrate: int | None = None
    sample_rate: int | None = None
    bit_depth: int | None = None


class TrackQuarantineListResponse(BaseModel):
    items: list[TrackQuarantineEntryResponse] = Field(default_factory=list)
    count: int


class TrackMoveRequest(BaseModel):
    target_album_id: int = Field(ge=1)
    reason: str | None = Field(default=None, max_length=500)


class AlbumMoveToArtistRequest(BaseModel):
    target_artist_id: int = Field(ge=1)
    reason: str | None = Field(default=None, max_length=500)


class AlbumMergeRequest(BaseModel):
    target_album_id: int = Field(ge=1)
    reason: str | None = Field(default=None, max_length=500)


class AlbumSplitRequest(BaseModel):
    target_album_name: str = Field(min_length=1, max_length=300)
    track_ids: list[int] = Field(min_length=1, max_length=5000)
    reason: str | None = Field(default=None, max_length=500)


class ArtistMergeRequest(BaseModel):
    target_artist_id: int = Field(ge=1)
    reason: str | None = Field(default=None, max_length=500)


class LibraryContributionResponse(BaseModel):
    id: int
    user_id: int
    user_email: str | None = None
    user_username: str | None = None
    user_name: str | None = None
    user_avatar: str | None = None
    source: str
    source_ref: str
    album_id: int | None = None
    album_entity_uid: str | None = None
    album_slug: str | None = None
    artist_name: str
    album_name: str
    status: str
    imported_at: datetime | str | None = None
    withdrawn_at: datetime | str | None = None
    has_cover: bool | None = None
    track_count: int | None = None
    total_duration: int | None = None

    @field_validator("album_entity_uid", mode="before")
    @classmethod
    def coerce_album_entity_uid(cls, value: Any) -> str | None:
        return str(value) if value is not None else None

    @field_validator("total_duration", mode="before")
    @classmethod
    def coerce_total_duration(cls, value: Any) -> int | None:
        if value is None or value == "":
            return None
        return int(float(value))


class LibraryContributionListResponse(BaseModel):
    items: list[LibraryContributionResponse] = Field(default_factory=list)
    count: int


class RepairRequest(BaseModel):
    dry_run: bool = True
    auto_only: bool = True


class RepairIssuesRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    issues: list[dict[str, Any]] = Field(default_factory=list, max_length=20)
    preparation_task_id: str | None = Field(default=None, max_length=100)
    dry_run: bool = False
    plan_version: str | None = Field(default=None, max_length=100)
    plan_item_ids: list[str] = Field(default_factory=list, max_length=20)
    confirm_risky: bool = False

    @model_validator(mode="after")
    def _validate_selection(self):
        if not self.dry_run and not self.plan_version:
            raise ValueError("A repair plan version is required for execution")
        if not self.dry_run and not self.preparation_task_id:
            raise ValueError("A completed repair preparation is required for execution")
        if len(self.plan_item_ids) != len(set(self.plan_item_ids)):
            raise ValueError("Duplicate repair item IDs")
        identifiers = [issue.get("id") for issue in self.issues]
        if any(type(value) is not int or value < 1 for value in identifiers):
            raise ValueError("Canonical persisted issue IDs are required")
        if len(identifiers) != len(set(identifiers)):
            raise ValueError("Duplicate repair issue IDs")
        return self


class RepairPreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    issues: list[dict[str, Any]] = Field(default_factory=list, max_length=20)
    issue_ids: list[int] = Field(default_factory=list, max_length=20)
    auto_only: bool = False

    @model_validator(mode="after")
    def _canonical_ids(self):
        if self.issue_ids and self.issues:
            raise ValueError("Use issue_ids or the legacy issues field, not both")
        ids = self.issue_ids or [issue.get("id") for issue in self.issues]
        if any(type(value) is not int or value < 1 for value in ids) or len(
            set(ids)
        ) != len(ids):
            raise ValueError("Canonical unique positive issue IDs are required")
        return self


class RepairCatalogEntryResponse(BaseModel):
    check_type: str
    scanner_method: str
    fixer_method: str | None = None
    support: str
    risk: str
    scope: str
    requires_confirmation: bool = False
    supports_batch: bool = True
    supports_artist_scope: bool = True
    supports_global_scope: bool = True
    supports_bulk_fix: bool = False
    auto_fixable: bool


class RepairCatalogResponse(BaseModel):
    items: list[RepairCatalogEntryResponse] = Field(default_factory=list)


class RepairPlanItemResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    issue_id: int | None = None
    item_key: str | None = None
    plan_item_id: str | None = None
    check_type: str
    severity: str | None = None
    description: str | None = None
    support: str
    risk: str | None = None
    scope: str | None = None
    requires_confirmation: bool = False
    supports_batch: bool = True
    supports_artist_scope: bool = True
    supports_global_scope: bool = True
    auto_fixable: bool = False
    executable: bool = False
    action: str | None = None
    target: str | None = None
    message: str | None = None
    fs_write: bool = False
    details: dict[str, Any] | list[Any] | str | None = None
    issue: dict[str, Any] = Field(default_factory=dict)


class RepairPreviewResponse(BaseModel):
    artist: str | None = None
    task_id: str | None = None
    preparation_task_id: str | None = None
    status: str = "ready"
    error: str | None = None
    document: dict[str, Any] | None = None
    result: dict[str, Any] | None = None
    items: list[RepairPlanItemResponse] = Field(default_factory=list)
    total: int = 0
    executable: int = 0
    manual_only: int = 0
    plan_version: str | None = None
    generated_at: datetime | str | None = None


class ArtistRepairPlanResponse(RepairPreviewResponse):
    artist: str = ""


class MoveRequest(BaseModel):
    new_name: str


class WipeRequest(BaseModel):
    rebuild: bool = False


class EnrichMbidsRequest(BaseModel):
    artist: str | None = None
    min_score: int | float | None = None
    release_types_only: bool = False
    release_dates_only: bool = False


class StorageMigrationRequest(BaseModel):
    artist: str | None = None


class PortableMetadataAlbumStatusResponse(BaseModel):
    sidecar_path: str | None = None
    sidecar_written_at: datetime | str | None = None
    audio_tags_written_at: datetime | str | None = None
    tracks: int = 0
    tags_written: int = 0
    tag_errors: int = 0
    export_path: str | None = None
    exported_at: datetime | str | None = None
    updated_at: datetime | str | None = None


class PortableAlbumSidecarResponse(BaseModel):
    schema_version: int = 1
    artist: dict[str, Any] = Field(default_factory=dict)
    album: dict[str, Any] = Field(default_factory=dict)
    tracks: list[dict[str, Any]] = Field(default_factory=list)
    portable_metadata: PortableMetadataAlbumStatusResponse = Field(
        default_factory=PortableMetadataAlbumStatusResponse
    )


class PortableMetadataRequest(BaseModel):
    album_id: int | None = None
    album_entity_uid: str | None = None
    artist: str | None = None
    write_audio_tags: bool = True
    write_sidecars: bool = True
    limit: int | None = Field(default=None, ge=1, le=10000)


class PortableRehydrateRequest(BaseModel):
    root_path: str | None = None
    limit: int | None = Field(default=None, ge=1, le=10000)


class RichMetadataExportRequest(BaseModel):
    album_id: int | None = None
    album_entity_uid: str | None = None
    artist: str | None = None
    export_root: str | None = None
    include_audio: bool = False
    write_rich_tags: bool = True
    limit: int | None = Field(default=None, ge=1, le=10000)


class LyricsSyncRequest(BaseModel):
    artist: str | None = None
    album_id: int | None = None
    album_entity_uid: str | None = None
    track_id: int | None = Field(default=None, ge=1)
    track_entity_uid: str | None = None
    force: bool = False
    refresh_mode: Literal["missing", "due", "upgrade"] = "missing"
    limit: int = Field(default=500, ge=1, le=5000)
    delay_seconds: float = Field(default=0.2, ge=0, le=10)


class HealthIssueResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: int
    check_type: str
    severity: str
    description: str
    details_json: dict[str, Any] | list[Any] | str | None = None
    auto_fixable: bool | None = None
    status: str | None = None
    created_at: datetime | str | None = None
    resolved_at: datetime | str | None = None
    artist_id: int | None = None
    album_id: int | None = None
    last_seen_at: datetime | str | None = None


class HealthCheckRunResponse(BaseModel):
    last_run_at: str | None = None
    duration_ms: int = 0
    issue_count: int = 0


class HealthReportResponse(BaseModel):
    issues: list[HealthIssueResponse] = Field(default_factory=list)
    summary: dict[str, int] = Field(default_factory=dict)
    total: int


class HealthIssuesResponse(BaseModel):
    issues: list[HealthIssueResponse] = Field(default_factory=list)
    counts: dict[str, int] = Field(default_factory=dict)
    total: int


class AdminHealthSnapshotResponse(BaseModel):
    snapshot: SnapshotMetadataResponse
    issues: list[HealthIssueResponse] = Field(default_factory=list)
    counts: dict[str, int] = Field(default_factory=dict)
    total: int = 0
    filter: str | None = None
    runs: dict[str, HealthCheckRunResponse] = Field(default_factory=dict)


class CheckTypeMutationResponse(OkResponse):
    check_type: str


class HealthFixTypeResponse(BaseModel):
    task_id: str | None = None
    task_ids: list[str] = []
    fixable: int
    allowed: bool = True
    reason: str | None = None


class ArtistHealthIssuesResponse(BaseModel):
    artist: str
    issues: list[HealthIssueResponse] = Field(default_factory=list)
    count: int


class ArtistRepairResponse(BaseModel):
    task_id: str | None = None
    count: int


class AnalysisTrackSummaryResponse(BaseModel):
    title: str | None = None
    artist: str | None = None
    album: str | None = None
    bpm: float | int | None = None
    audio_key: str | None = None
    energy: float | None = None
    danceability: float | None = None
    has_mood: bool | None = None
    updated_at: datetime | str | None = None


class BlissTrackSummaryResponse(BaseModel):
    title: str | None = None
    artist: str | None = None
    album: str | None = None
    updated_at: datetime | str | None = None


class FingerprintTrackSummaryResponse(BlissTrackSummaryResponse):
    source: str | None = None


class AnalysisStatusResponse(BaseModel):
    total: int = 0
    analysis_done: int = 0
    analysis_pending: int = 0
    analysis_active: int = 0
    analysis_failed: int = 0
    bliss_done: int = 0
    bliss_pending: int = 0
    bliss_active: int = 0
    bliss_failed: int = 0
    fingerprint_done: int = 0
    fingerprint_pending: int = 0
    fingerprint_chromaprint: int = 0
    fingerprint_pcm: int = 0
    chromaprint_available: bool = False
    fingerprint_strategy: str = "unavailable"
    total_albums: int = 0
    lyrics_cached: int = 0
    lyrics_found: int = 0
    lyrics_missing: int = 0
    portable_sidecar_albums: int = 0
    portable_audio_tag_albums: int = 0
    portable_audio_tag_tracks: int = 0
    portable_tag_errors: int = 0
    rich_export_albums: int = 0
    rich_export_tracks: int = 0
    last_analyzed: AnalysisTrackSummaryResponse = Field(
        default_factory=AnalysisTrackSummaryResponse
    )
    last_bliss: BlissTrackSummaryResponse = Field(
        default_factory=BlissTrackSummaryResponse
    )
    last_fingerprinted: FingerprintTrackSummaryResponse = Field(
        default_factory=FingerprintTrackSummaryResponse
    )


class AuditLogEntryResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: int
    timestamp: datetime | str | None = None
    action: str
    target_type: str
    target_name: str
    details: dict[str, Any] = Field(default_factory=dict)
    user_id: int | None = None
    task_id: str | None = None


class AuditLogResponse(BaseModel):
    entries: list[AuditLogEntryResponse] = Field(default_factory=list)
    total: int
    limit: int
    offset: int


class StorageV2StatusResponse(BaseModel):
    total_artists: int = 0
    migrated_artists: int = 0
    total_albums: int = 0
    migrated_albums: int = 0
    total_tracks: int = 0
    migrated_tracks: int = 0

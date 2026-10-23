"""Closed, bounded public inputs for the diagnostic catalog."""

from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from crate.repair_catalog import REPAIR_CATALOG_BY_CHECK
from crate.task_registry import TASK_TYPES

Limit = Annotated[int, Field(strict=True, ge=1, le=100)]
Cursor = Annotated[str, Field(max_length=2048)]
Identifier = Annotated[str, Field(min_length=1, max_length=128)]
JobState = Literal[
    "pending", "running", "delegated", "completing", "completed", "failed", "cancelled"
]


class ClosedInput(BaseModel):
    model_config = ConfigDict(extra="forbid")


class InstanceInput(ClosedInput):
    pass


class QualityInput(ClosedInput):
    category: (
        Literal["corrupt", "low_bitrate", "lossy_with_lossless", "mixed_format_albums"]
        | None
    ) = None
    limit: Limit = 50
    cursor: Cursor | None = None


class IssuesInput(ClosedInput):
    check_type: Annotated[str, Field(min_length=1, max_length=80)] | None = None
    severity: Literal["low", "medium", "high", "critical"] | None = None
    artist_uid: Identifier | None = None
    limit: Limit = 20
    cursor: Cursor | None = None

    @model_validator(mode="after")
    def require_known_check(self):
        if (
            self.check_type is not None
            and self.check_type not in REPAIR_CATALOG_BY_CHECK
        ):
            raise ValueError("Unknown check type")
        return self


class ArtistInput(ClosedInput):
    artist_uid: Identifier | None = None
    name: Annotated[str, Field(min_length=2, max_length=200)] | None = None
    limit: Limit = 20

    @model_validator(mode="after")
    def require_one_identity(self):
        if (self.artist_uid is None) == (self.name is None):
            raise ValueError("Supply exactly one of artist_uid or name")
        return self


class JobsInput(ClosedInput):
    states: Annotated[list[JobState], Field(max_length=7)] | None = None
    types: Annotated[list[Identifier], Field(max_length=10)] | None = None
    limit: Limit = 20
    cursor: Cursor | None = None

    @model_validator(mode="after")
    def require_known_types(self):
        if self.types and any(item not in TASK_TYPES for item in self.types):
            raise ValueError("Unknown job type")
        return self


class JobInput(ClosedInput):
    job_id: Identifier


EntityUID = Annotated[
    str,
    Field(
        pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
    ),
]
IdempotencyKey = Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")]


PipelineName = Literal[
    "import",
    "enrichment",
    "analysis",
    "bliss",
    "playback",
    "projector",
    "federation",
    "acquisition",
]


class PipelineInput(ClosedInput):
    pipeline: PipelineName


class SmartMixStatusInput(ClosedInput):
    track_uids: Annotated[list[EntityUID], Field(max_length=50)] | None = None

    @model_validator(mode="after")
    def unique_tracks(self):
        if self.track_uids is not None and len(
            {uid.lower() for uid in self.track_uids}
        ) != len(self.track_uids):
            raise ValueError("Duplicate track UUIDs")
        return self


class PlanInput(ClosedInput):
    plan_id: EntityUID
    limit: Limit = 50
    cursor: Cursor | None = None


class HealthCheckInput(ClosedInput):
    artist_uid: EntityUID | None = None
    check_type: Literal["has_photo_desync"] = "has_photo_desync"
    idempotency_key: IdempotencyKey
    scope: Literal["artist", "global"] | None = None
    check_types: Annotated[list[str], Field(min_length=1, max_length=17)] | None = None
    plan_id: EntityUID | None = None
    plan_version: Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")] | None = None

    @model_validator(mode="after")
    def validate_selection(self):
        if self.plan_id:
            if (
                not self.plan_version
                or self.scope
                or self.check_types
                or self.artist_uid
            ):
                raise ValueError("Apply requires only the plan and version")
        elif self.plan_version:
            raise ValueError("A plan ID is required")
        elif self.scope or self.check_types is not None:
            if self.scope not in {"artist", "global"} or not self.check_types:
                raise ValueError("An explicit scope and checks are required")
            if (self.scope == "artist") != bool(self.artist_uid):
                raise ValueError("Artist scope requires an artist UID")
            if len(set(self.check_types)) != len(self.check_types) or any(
                c not in REPAIR_CATALOG_BY_CHECK for c in self.check_types
            ):
                raise ValueError("Unknown or duplicate checks")
        elif not self.artist_uid:
            raise ValueError("An artist UID is required")
        return self


class RepairPreviewInput(ClosedInput):
    issue_id: Annotated[int, Field(strict=True, gt=0)] | None = None
    issue_ids: (
        Annotated[
            list[Annotated[int, Field(strict=True, gt=0)]],
            Field(min_length=1, max_length=20),
        ]
        | None
    ) = None
    idempotency_key: IdempotencyKey | None = None

    @model_validator(mode="after")
    def validate_selection(self):
        if self.issue_ids is not None:
            if (
                self.issue_id is not None
                or not self.idempotency_key
                or len(set(self.issue_ids)) != len(self.issue_ids)
            ):
                raise ValueError(
                    "Exact unique issue IDs and an idempotency key are required"
                )
        elif self.issue_id is None or self.idempotency_key is not None:
            raise ValueError("A single directed issue ID is required")
        return self


class RepairApplyInput(ClosedInput):
    plan_id: EntityUID
    plan_version: Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
    idempotency_key: IdempotencyKey


class QualityRunInput(ClosedInput):
    idempotency_key: IdempotencyKey
    scope: Literal["global"] | None = None
    plan_id: EntityUID | None = None
    plan_version: Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")] | None = None

    @model_validator(mode="after")
    def validate_stage(self):
        if self.plan_id:
            if not self.plan_version or self.scope:
                raise ValueError("Apply requires only the plan and version")
        elif self.plan_version or self.scope != "global":
            raise ValueError("An explicit global scope is required")
        return self


class MetadataPatch(ClosedInput):
    bio: Annotated[str, Field(max_length=50000)] | None = None
    tags: (
        Annotated[
            list[Annotated[str, Field(min_length=1, max_length=200)]],
            Field(max_length=100),
        ]
        | None
    ) = None
    genres: (
        Annotated[
            list[Annotated[str, Field(min_length=1, max_length=200)]],
            Field(max_length=100),
        ]
        | None
    ) = None
    urls: (
        Annotated[
            dict[str, Annotated[str, Field(max_length=4096)]], Field(max_length=30)
        ]
        | None
    ) = None
    mbid: Annotated[str, Field(max_length=4096)] | None = None
    country: Annotated[str, Field(max_length=4096)] | None = None
    area: Annotated[str, Field(max_length=4096)] | None = None
    formed: Annotated[str, Field(max_length=4096)] | None = None
    ended: Annotated[str, Field(max_length=4096)] | None = None
    artist_type: Annotated[str, Field(max_length=4096)] | None = None
    bandcamp_url: Annotated[str, Field(max_length=4096)] | None = None
    title: Annotated[str, Field(max_length=4096)] | None = None
    artist: Annotated[str, Field(max_length=4096)] | None = None
    albumartist: Annotated[str, Field(max_length=4096)] | None = None
    album: Annotated[str, Field(max_length=4096)] | None = None
    date: Annotated[str, Field(max_length=4096)] | None = None
    genre: Annotated[str, Field(max_length=4096)] | None = None
    tracknumber: Annotated[str, Field(max_length=4096)] | None = None
    discnumber: Annotated[str, Field(max_length=4096)] | None = None


class MetadataPreviewInput(ClosedInput):
    entity_type: Literal["artist", "album", "track"]
    entity_uid: EntityUID
    patch: MetadataPatch
    idempotency_key: IdempotencyKey

    @model_validator(mode="after")
    def validate_patch(self):
        from crate.agent_metadata import _patch

        _patch(self.entity_type, self.patch.model_dump(exclude_unset=True))
        return self


class AnalysisPlanInput(ClosedInput):
    track_uids: Annotated[list[EntityUID], Field(min_length=1, max_length=200)]
    pipelines: Annotated[
        list[Literal["analysis", "bliss"]], Field(min_length=1, max_length=2)
    ] = ["analysis", "bliss"]
    mode: Literal["pending", "refresh"] = "pending"
    idempotency_key: IdempotencyKey

    @model_validator(mode="after")
    def validate_unique(self):
        if len(set(self.track_uids)) != len(self.track_uids) or len(
            set(self.pipelines)
        ) != len(self.pipelines):
            raise ValueError("Duplicate targets or pipelines")
        return self


class EnrichmentPlanInput(ClosedInput):
    artist_uids: Annotated[list[EntityUID], Field(min_length=1, max_length=20)]
    providers: Annotated[
        list[Literal["lastfm", "spotify", "musicbrainz", "discogs", "setlist"]],
        Field(min_length=1, max_length=5),
    ]
    facets: Annotated[
        list[
            Literal[
                "biography",
                "tags",
                "genres",
                "identity",
                "urls",
                "members",
                "popularity",
                "similar_artists",
                "setlists",
            ]
        ],
        Field(min_length=1, max_length=9),
    ]
    mode: Literal["missing", "refresh"] = "missing"
    idempotency_key: IdempotencyKey

    @model_validator(mode="after")
    def validate_unique(self):
        if any(
            len(set(values)) != len(values)
            for values in (self.artist_uids, self.providers, self.facets)
        ):
            raise ValueError("Duplicate targets, providers or facets")
        return self


class AnalysisStatusInput(ClosedInput):
    track_uids: (
        Annotated[list[EntityUID], Field(min_length=1, max_length=200)] | None
    ) = None
    plan_id: EntityUID | None = None
    limit: Limit = 50
    cursor: Cursor | None = None

    @model_validator(mode="after")
    def validate_selection(self):
        if bool(self.track_uids) == bool(self.plan_id):
            raise ValueError("Choose track UIDs or an owned plan")
        if self.track_uids and len(set(self.track_uids)) != len(self.track_uids):
            raise ValueError("Duplicate tracks")
        return self


class LibrarySyncPlanInput(ClosedInput):
    scope: Literal["album", "artist", "global"]
    entity_uid: EntityUID | None = None
    limit: Limit = 100
    idempotency_key: IdempotencyKey

    @model_validator(mode="after")
    def validate_scope(self):
        if (self.scope == "global") == bool(self.entity_uid):
            raise ValueError("Only album and artist scopes require an entity UID")
        if self.scope == "global" and "limit" not in self.model_fields_set:
            raise ValueError("Global sync requires an explicit album limit")
        return self


class MetadataExportPlanInput(ClosedInput):
    album_uids: Annotated[list[EntityUID], Field(min_length=1, max_length=20)]
    destination_preset: Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")]
    idempotency_key: IdempotencyKey

    @model_validator(mode="after")
    def validate_unique(self):
        if len(set(self.album_uids)) != len(self.album_uids):
            raise ValueError("Duplicate albums")
        return self


class MetadataRehydratePlanInput(ClosedInput):
    album_uids: Annotated[list[EntityUID], Field(min_length=1, max_length=20)]
    source_preset: Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")]
    conflict_policy: Literal["fill_missing", "replace_unlocked"] = "fill_missing"
    idempotency_key: IdempotencyKey

    @model_validator(mode="after")
    def validate_unique(self):
        if len(set(self.album_uids)) != len(self.album_uids):
            raise ValueError("Duplicate albums")
        return self


class JobRetryInput(JobInput):
    idempotency_key: IdempotencyKey


class DiagnosticsInput(ClosedInput):
    source: Literal["worker_logs", "worker_status", "analysis_status", "metric_series"]
    series: (
        Literal[
            "worker.queue.wait",
            "worker.task.duration",
            "worker.queue.depth",
            "worker.queue.running",
            "worker.resource.defer_seconds",
            "worker.resource.load_ratio",
            "worker.resource.memory_available_percent",
            "mcp.tool.latency_ms",
            "mcp.tool.response_bytes",
            "mcp.tool.denied",
            "mcp.tool.rate_limited",
            "mcp.tool.conflict",
            "mcp.tool.deduplicated",
            "mcp.job.verification_failed",
            "mcp.job.failed",
            "mcp.job.completed",
            "mcp.job.cancelled",
            "mcp.job.partial",
            "mcp.auth.denied",
            "mcp.auth.unavailable",
        ]
        | None
    ) = None
    minutes: Annotated[int, Field(strict=True, ge=1, le=100)] = 60
    task_id: Identifier | None = None
    since: datetime | None = None
    until: datetime | None = None
    limit: Limit = 20

    @model_validator(mode="after")
    def validate_source_filters(self):
        if (self.source == "metric_series") != bool(self.series):
            raise ValueError(
                "An enumerated metric series is required only for metric_series"
            )
        if self.source != "metric_series" and "minutes" in self.model_fields_set:
            raise ValueError("Minute windows apply only to metrics")
        if self.source != "worker_logs" and any((self.task_id, self.since, self.until)):
            raise ValueError("Time and task filters apply only to worker_logs")
        for value in (self.since, self.until):
            if value is not None and value.tzinfo is None:
                raise ValueError("Timestamps require a timezone")
        return self


class DiagnosticOutput(ClosedInput):
    schema_version: Literal["1"]
    availability: Literal["available", "stale", "unavailable"]
    source: str | None = None
    observed_at: str | None = None
    reason: str | None = None
    data: Any = None
    returned_count: int = 0
    truncated: bool = False
    next_cursor: str | None = None
    snapshot: dict[str, Any] | None = None
    checks: dict[str, Any] | None = None
    total: int | None = None
    coverage: str | None = None
    sample_truncated: bool | None = None
    window: dict[str, str] | None = None
    interpretation: str | None = None
    error: dict[str, Any] | None = None


class ConfirmationInput(ClosedInput):
    plan_id: Identifier
    plan_version: Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
    apply_after_approval: Annotated[bool, Field(strict=True)] = False


class ConfirmationStatusInput(ClosedInput):
    confirmation_id: Annotated[str, Field(pattern=r"^[a-f0-9]{32}$")]

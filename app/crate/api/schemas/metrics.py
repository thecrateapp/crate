"""Metrics provenance is additive to the existing numeric response fields."""

from typing import Any, Literal

from pydantic import BaseModel, Field, RootModel

Availability = Literal["available", "empty", "stale", "partial", "unavailable"]


class MetricSummary(BaseModel):
    count: int = Field(ge=0)
    avg: float
    min: float
    max: float
    sum: float
    availability: Availability = "unavailable"
    reason: str | None = None
    source: Literal["redis_v2"] = "redis_v2"
    sample_kind: Literal["observations"] = "observations"
    sample_count: int = Field(default=0, ge=0)
    eligible_count: int = Field(default=0, ge=0)
    observed_at: str | None = None
    age_seconds: float | None = None
    window_minutes: int = Field(default=5, ge=1, le=10080)


class MetricHistoryStatus(BaseModel):
    source: Literal["postgresql_v2"]
    availability: Availability
    cutover_at: str | None
    legacy_status: Literal["unverified"]
    legacy_combined: Literal[False]
    retention_days: Literal[8] = 8
    collection: dict[str, Any] = Field(default_factory=dict)
    retention: dict[str, Any] = Field(default_factory=dict)


class CollectorLocalHealth(BaseModel):
    scope: Literal["process"]
    coverage: Literal["local_only"]
    availability: Availability
    started_at: str
    observed_at: str | None = None
    last_write_at: str | None
    last_error_at: str | None
    last_error_reason: str | None = None
    counters: dict[str, int]
    queue_depth: int = Field(ge=0)
    queue_capacity: int = Field(ge=1)
    buffer_max_age_seconds: int = Field(default=300, ge=1)


class MetricsSummaryMetadata(BaseModel):
    schema_version: Literal[2]
    generated_at: str
    history: MetricHistoryStatus
    collector_local: CollectorLocalHealth


class MetricsSummaryResponse(
    RootModel[dict[str, MetricSummary | MetricsSummaryMetadata]]
):
    pass


class MetricsDashboardResponse(BaseModel):
    summary: MetricsSummaryResponse
    system: dict[str, Any]
    tasks: list[dict[str, Any]]
    playback_delivery: dict[str, Any]
    route_latency: list[dict[str, Any]]
    timeseries: dict[str, list[dict[str, Any]]]
    timeseries_status: dict[str, dict[str, Any]] = Field(default_factory=dict)
    route_latency_status: dict[str, Any] = Field(default_factory=dict)


class MetricsRoutesResponse(BaseModel):
    availability: Availability = "unavailable"
    reason: str | None = None
    source: Literal["redis_v2"] = "redis_v2"
    sample_kind: Literal["bounded_samples"] = "bounded_samples"
    sample_count: int = Field(default=0, ge=0)
    observed_count: int = Field(default=0, ge=0)
    truncated: bool = False
    window_minutes: int = Field(default=15, ge=1, le=240)
    minutes: int
    limit: int
    target: str | None
    routes: list[dict[str, Any]]


class MetricsTimeseriesResponse(BaseModel):
    name: str
    period: Literal["minute", "hour", "day"]
    data: list[dict[str, Any]]
    status: dict[str, Any]

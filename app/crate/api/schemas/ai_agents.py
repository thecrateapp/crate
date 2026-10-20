"""Closed, bounded admin AI contracts. Credentials are write-only."""

from typing import Annotated, Literal

from pydantic import Field, model_validator

from crate.ai.contracts import (
    AIAction,
    LegacyProfileConfig,
    LegacyOptions,
    ClosedModel,
    ModelCapabilities,
    ModelID,
    ProfileConfig,
    Provider,
    ReasoningConfig,
    ShortText,
)

ID = Annotated[str, Field(min_length=1, max_length=200)]
UUIDText = Annotated[
    str,
    Field(
        pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
    ),
]
Revision = Annotated[int, Field(ge=0, le=2147483647)]
Stamp = Annotated[str, Field(max_length=100)]
Code = Annotated[str, Field(max_length=80, pattern=r"^[A-Z0-9_]+$")]
Fingerprint = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]


class ConnectionCreate(ClosedModel):
    label: ShortText
    provider: Provider
    endpoint: Annotated[str, Field(max_length=2048)] | None = None
    enabled: bool = True
    max_concurrent: int = Field(default=2, ge=1, le=8)
    daily_calls: int = Field(default=1000, ge=1, le=100000)
    daily_tokens: int = Field(default=1000000, ge=1, le=1000000000)


class ConnectionPatch(ClosedModel):
    expected_revision: Revision
    label: ShortText | None = None
    endpoint: Annotated[str, Field(max_length=2048)] | None = None
    enabled: bool | None = None
    max_concurrent: Annotated[int, Field(ge=1, le=8)] | None = None
    daily_calls: Annotated[int, Field(ge=1, le=100000)] | None = None
    daily_tokens: Annotated[int, Field(ge=1, le=1000000000)] | None = None

    @model_validator(mode="after")
    def reject_null_changes(self):
        if any(
            getattr(self, name) is None for name in self.model_fields_set - {"endpoint"}
        ):
            raise ValueError("Only endpoint can be cleared")
        return self


class CredentialWrite(ClosedModel):
    expected_revision: Revision
    api_key: (
        Annotated[str, Field(min_length=1, max_length=4096, pattern=r"^[!-~]+$")] | None
    )


class ManualModel(ClosedModel):
    expected_revision: Revision
    model_id: ModelID


class RefreshRequest(ClosedModel):
    expected_revision: Revision


class ProfileCreate(ClosedModel):
    label: ShortText
    connection_id: UUIDText
    model_id: ModelID
    config: ProfileConfig = Field(default_factory=ProfileConfig)


class ProfileVersionCreate(ClosedModel):
    expected_version: Annotated[int, Field(ge=1, le=2147483646)]
    connection_id: UUIDText
    model_id: ModelID
    config: ProfileConfig = Field(default_factory=ProfileConfig)


class BindingChange(ClosedModel):
    action_id: ID
    profile_id: UUIDText
    profile_version: Annotated[int, Field(ge=1, le=2147483647)]
    expected_revision: Revision
    enabled: bool = True


class BindingBatch(ClosedModel):
    changes: list[BindingChange] = Field(min_length=1, max_length=11)


class Activation(ClosedModel):
    expected_revision: Revision
    expected_review_fingerprint: Fingerprint


class ProbeRequest(ClosedModel):
    acknowledged_billable: Literal[True]
    idempotency_key: Annotated[
        str, Field(min_length=1, max_length=120, pattern=r"^[A-Za-z0-9_-]+$")
    ]
    expected_fingerprint: Fingerprint


class ConnectionMetadata(ClosedModel):
    id: ID
    persistent_id: UUIDText | None
    label: ShortText
    provider: Provider
    revision: Revision
    endpoint: Annotated[str, Field(max_length=2048)] | None
    enabled: bool
    model_count: int = Field(ge=0, le=500)
    catalog_status: Literal["pending", "ready", "error"]
    catalog_error_code: Code | None
    catalog_updated_at: Stamp | None
    max_concurrent: int
    daily_calls: int
    daily_tokens: int
    source: Literal["none", "stored", "environment"]
    has_key: bool
    last4: Annotated[str, Field(max_length=4)] | None
    read_only: bool


class Connection(ConnectionMetadata):
    model_catalog: list[ModelCapabilities] = Field(max_length=500)


class CatalogModel(ModelCapabilities):
    # Per-image token reservation; None means image features cannot be admitted.
    image_token_bound: int | None = None


class ModelsResponse(ClosedModel):
    models: list[CatalogModel] = Field(max_length=500)
    status: Literal["pending", "ready", "error"]
    updated_at: Stamp | None
    error_code: Code | None


class ProfileVersion(ClosedModel):
    profile_id: UUIDText
    version: int
    connection_id: UUIDText
    model_id: ModelID
    config: ProfileConfig | LegacyProfileConfig
    fingerprint: Fingerprint
    created_at: Stamp
    image_token_bound: int | None = None


class Profile(ClosedModel):
    id: UUIDText
    label: ShortText
    current_version: int
    created_at: Stamp


class ProfileWithVersions(Profile):
    versions: list[ProfileVersion] = Field(max_length=1000)


class Binding(ClosedModel):
    action_id: ID
    profile_id: UUIDText
    profile_version: int
    revision: int
    enabled: bool


class BindingsResponse(ClosedModel):
    bindings: list[Binding] = Field(max_length=11)


class Engine(ClosedModel):
    provider: Provider
    supported: bool


class LegacyActionPreview(ClosedModel):
    action_id: ID
    provider: ShortText
    supported: bool
    model_id: ModelID
    legacy_model: ShortText
    endpoint: Annotated[str, Field(max_length=2048)] | None
    legacy_options: LegacyOptions
    effective_timeout_seconds: Annotated[int, Field(ge=1, le=300)] | None
    legacy_enabled: bool = True


class DefaultModelFeature(ClosedModel):
    action_id: ID
    status: Literal["default", "override", "incompatible"]
    reason: Code | None


class DefaultModelState(ClosedModel):
    connection_id: ID
    model_id: ModelID
    reasoning: ReasoningConfig
    available: bool
    error_code: Code | None
    features: list[DefaultModelFeature] = Field(max_length=11)


class Snapshot(ClosedModel):
    truncated: bool
    revision: Revision
    migrated: bool
    review_fingerprint: Fingerprint
    legacy_actions: list[LegacyActionPreview] = Field(max_length=11)
    actions: list[AIAction] = Field(max_length=11)
    engines: list[Engine] = Field(max_length=3)
    connections: list[ConnectionMetadata] = Field(max_length=1003)
    profiles: list[ProfileWithVersions] = Field(max_length=1000)
    bindings: list[Binding] = Field(max_length=11)
    default_model: DefaultModelState | None = None


class FeatureModelAssignment(ClosedModel):
    connection_id: ID  # public id: "env:<provider>" or UUID
    model_id: ModelID
    reasoning: ReasoningConfig = Field(default_factory=ReasoningConfig)
    expected_revision: Revision
    expected_review_fingerprint: Fingerprint


class ModelAssignment(FeatureModelAssignment):
    dry_run: bool = False


class AssignmentOutcome(ClosedModel):
    action_id: ID
    outcome: Literal[
        "applied", "unchanged", "kept_legacy", "kept_current", "turned_off", "blocked"
    ]
    reason: Code | None
    adjustments: list[Literal["reasoning", "image_detail"]] = Field(
        default_factory=list, max_length=2
    )
    # The feature's switch after applying: False when turned off, None if blocked.
    enabled: bool | None = None


class ModelAssignmentResult(ClosedModel):
    dry_run: bool
    activation: bool  # dry run: applying would activate; apply: it activated
    revision: Revision
    review_fingerprint: Fingerprint
    outcomes: list[AssignmentOutcome] = Field(max_length=11)


class ActivationResponse(ClosedModel):
    active: bool
    revision: Revision
    activated_at: Stamp | None


class Enqueued(ClosedModel):
    task_id: ID | None
    deduplicated: bool
    max_timeout_seconds: int | None = None
    max_input_tokens: int | None = None
    max_output_tokens: int | None = None


class JobOutcome(ClosedModel):
    status: Literal["succeeded", "failed", "duplicate"]
    error_code: Code | None = None
    model_count: Annotated[int, Field(ge=0, le=500)] | None = None
    compatible: bool | None = None


class JobResponse(ClosedModel):
    id: ID
    type: Literal["ai_catalog_refresh", "ai_profile_test"]
    status: Literal[
        "pending",
        "running",
        "completed",
        "failed",
        "cancelled",
        "completing",
        "delegated",
    ]
    result: JobOutcome | None


class Invocation(ClosedModel):
    id: UUIDText
    connection_id: UUIDText
    invocation_kind: Literal["action", "probe"]
    action_id: ID | None
    profile_id: UUIDText | None
    profile_version: int | None
    model_id: ModelID
    reported_model: ModelID | None
    actor_id: int | None
    job_id: ID | None
    status: Literal["reserved", "succeeded", "failed", "timeout", "cancelled"]
    input_tokens: int | None
    output_tokens: int | None
    thought_tokens: int | None
    cached_input_tokens: int | None
    total_tokens: int | None
    charged_tokens: int
    reserved_tokens: int
    metering_mode: Literal["enforced", "legacy_tracking"] = "enforced"
    usage_known: bool
    error_code: Code | None
    duration_ms: int
    estimated_cost: float | None
    created_at: Stamp
    finished_at: Stamp | None


class Activity(ClosedModel):
    items: list[Invocation] = Field(max_length=200)
    next_cursor: Annotated[str, Field(max_length=2048)] | None


class UsageTotals(ClosedModel):
    unknown_calls: int = 0
    calls: int
    tokens: int
    completed: int
    failed: int
    estimated_cost: float | None


class DailyUsage(UsageTotals):
    day: Stamp
    connection_id: UUIDText
    invocation_kind: Literal["action", "probe"]
    action_id: ID | None


class Usage(ClosedModel):
    legacy_usage_unknown: bool = False
    truncated: bool = False
    totals: UsageTotals
    daily: list[DailyUsage] = Field(max_length=5000)


class ActionAvailability(ClosedModel):
    action_id: ID
    available: bool
    status: Literal["legacy", "configured", "unavailable"]
    provider: ID | None
    model_id: ModelID | None
    fingerprint: Fingerprint | None
    error_code: Code | None

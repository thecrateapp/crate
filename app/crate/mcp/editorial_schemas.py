"""Closed MCP inputs for the existing system-playlist editorial model."""

from typing import Annotated, Literal

from pydantic import Field, model_validator

from crate.mcp.schemas import ClosedInput, EntityUID, IdempotencyKey

PlaylistId = Annotated[int, Field(strict=True, ge=1)]
Page = Annotated[int, Field(strict=True, ge=0, le=10000)]
PageSize = Annotated[int, Field(strict=True, ge=1, le=50)]
Title = Annotated[str, Field(min_length=1, max_length=160)]
Description = Annotated[str, Field(max_length=2000)]


class EditorialList(ClosedInput):
    limit: PageSize = 20
    offset: Page = 0


class EditorialGet(ClosedInput):
    playlist_id: PlaylistId
    section: Literal["tracks", "exclusions", "history"] = "tracks"
    limit: PageSize = 20
    offset: Page = 0


class EditorialOptions(ClosedInput):
    artist_name: Annotated[str, Field(max_length=200)] | None = None
    genre_name: Annotated[str, Field(max_length=200)] | None = None


class EditorialCandidates(ClosedInput):
    query: Annotated[str, Field(min_length=2, max_length=120)]
    limit: PageSize = 20


class EditorialPrepare(ClosedInput):
    kind: Literal[
        "create", "duplicate", "edit", "refine", "regenerate", "refresh_policy"
    ]
    playlist_id: PlaylistId | None = None
    name: Title | None = None
    description: Description | None = None
    generation_mode: Literal["static", "smart"] | None = None
    smart_rules: dict | None = None
    track_uids: Annotated[list[EntityUID], Field(max_length=100)] | None = None
    exclude_track_uids: Annotated[list[EntityUID], Field(max_length=100)] | None = None
    auto_refresh_enabled: bool | None = None
    idempotency_key: IdempotencyKey

    @model_validator(mode="after")
    def validate_kind(self):
        if (self.kind in {"create"}) != (self.playlist_id is None):
            raise ValueError("An existing playlist ID is required except for create")
        if self.kind == "create" and not self.name:
            raise ValueError("A title is required for create")
        if self.kind == "refresh_policy" and self.auto_refresh_enabled is None:
            raise ValueError("A refresh policy is required")
        if self.kind != "refresh_policy" and self.auto_refresh_enabled is not None:
            raise ValueError("Refresh policy requires a separate plan")
        if self.kind in {"regenerate", "refresh_policy"} and (
            self.track_uids is not None or self.smart_rules is not None
        ):
            raise ValueError("This operation uses the existing rules")
        if self.kind == "duplicate" and any(
            item is not None
            for item in (
                self.generation_mode,
                self.smart_rules,
                self.track_uids,
                self.exclude_track_uids,
            )
        ):
            raise ValueError("Duplicate copies the exact existing selection and rules")
        if self.kind == "create" and self.generation_mode is None:
            raise ValueError("Create requires a generation mode")
        if self.generation_mode == "static" and self.smart_rules is not None:
            raise ValueError("Static playlists cannot contain smart rules")
        if self.generation_mode == "smart" and self.track_uids is not None:
            raise ValueError(
                "Smart selection comes from rules and persistent overrides"
            )
        if self.kind == "regenerate" and self.exclude_track_uids is not None:
            raise ValueError("Use refine to add exclusions before regeneration")
        if self.exclude_track_uids is not None and self.kind not in {"refine", "edit"}:
            raise ValueError("Exclusions require an existing edit or refinement")
        if self.kind in {"refine", "regenerate", "refresh_policy"} and any(
            item is not None
            for item in (self.name, self.description, self.generation_mode)
        ):
            raise ValueError("Use edit for playlist metadata changes")
        if self.kind == "refine" and (
            self.smart_rules is not None or self.track_uids is not None
        ):
            raise ValueError("Refine accepts only exact exclusions")
        if self.smart_rules is not None:
            from crate.playlist_rule_contract import validate_smart_rules

            validate_smart_rules(self.smart_rules)
        for items in (self.track_uids, self.exclude_track_uids):
            if items is not None and len(items) != len(set(items)):
                raise ValueError("Duplicate track UID")
        return self


class EditorialPlanRead(ClosedInput):
    plan_id: EntityUID
    limit: PageSize = 20
    offset: Page = 0


class EditorialPlanApply(ClosedInput):
    plan_id: EntityUID
    plan_version: Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
    idempotency_key: IdempotencyKey


class EditorialPublication(ClosedInput):
    playlist_id: PlaylistId | None = None
    expected_revision: Annotated[int, Field(strict=True, ge=1)] | None = None
    is_active: bool | None = None
    plan_id: EntityUID | None = None
    plan_version: Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")] | None = None
    idempotency_key: IdempotencyKey

    @model_validator(mode="after")
    def stage(self):
        if self.plan_id:
            if self.plan_version is None or any(
                item is not None
                for item in (self.playlist_id, self.expected_revision, self.is_active)
            ):
                raise ValueError("Plan publication needs only ID and version")
        elif (
            any(
                item is None
                for item in (self.playlist_id, self.expected_revision, self.is_active)
            )
            or self.plan_version
        ):
            raise ValueError("Visibility change needs playlist ID, revision and state")
        return self

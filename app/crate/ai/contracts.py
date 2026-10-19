"""Finite configuration contracts; provider metadata is never arbitrary config."""

from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

Provider = Literal["gemini", "deepseek", "ollama"]
ImageDetail = Literal["default", "high", "ultra_high"]
ModelID = Annotated[
    str, Field(min_length=1, max_length=200, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:/-]*$")
]
ShortText = Annotated[str, Field(min_length=1, max_length=200)]
Level = Annotated[str, Field(min_length=1, max_length=24, pattern=r"^[a-z][a-z0-9_]*$")]


class AIConfigurationError(ValueError):
    """Public error containing only a closed code and safe message."""

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)


class ClosedModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)


class ReasoningConfig(ClosedModel):
    mode: Literal["provider_default", "disabled", "level", "budget"] = (
        "provider_default"
    )
    level: Level | None = None
    budget_tokens: int | None = Field(default=None, ge=0, le=131072)

    @model_validator(mode="after")
    def coherent_mode(self) -> Self:
        if (self.mode == "level") != (self.level is not None):
            raise ValueError("A level is required only in level mode")
        if (self.mode == "budget") != (self.budget_tokens is not None):
            raise ValueError("A budget is required only in budget mode")
        return self


class ProfileConfig(ClosedModel):
    reasoning: ReasoningConfig = Field(default_factory=ReasoningConfig)
    image_detail: ImageDetail = "default"
    timeout_seconds: int = Field(default=45, ge=1, le=90)
    max_output_tokens: int = Field(default=2048, ge=1, le=16000)
    max_input_tokens: int = Field(default=16384, ge=1, le=131072)


class ModelCapabilities(ClosedModel):
    provider: Provider
    model_id: ModelID
    label: ShortText
    input_modalities: list[Literal["text", "image", "audio", "video", "pdf"]] = Field(
        default_factory=list, max_length=5
    )
    structured_output: bool = False
    reasoning_levels: list[Level] = Field(default_factory=list, max_length=16)
    reasoning_disabled: bool = False
    thinking_budget_min: int | None = Field(default=None, ge=0, le=131072)
    thinking_budget_max: int | None = Field(default=None, ge=0, le=131072)
    max_output_tokens: int | None = Field(default=None, ge=1, le=2097152)
    context_window: int | None = Field(default=None, ge=1, le=16777216)
    validated: bool = False
    source: Literal["pending", "manifest", "provider", "provider+manifest"] = "pending"
    image_details: list[ImageDetail] = Field(
        default_factory=lambda: ["default"], min_length=1, max_length=3
    )

    @model_validator(mode="after")
    def coherent_capabilities(self) -> Self:
        if "://" in self.model_id or ".." in self.model_id or "//" in self.model_id:
            raise ValueError("Invalid model identifier")
        if (self.thinking_budget_min is None) != (self.thinking_budget_max is None):
            raise ValueError("Both budget bounds are required")
        if (
            self.thinking_budget_min is not None
            and self.thinking_budget_max is not None
            and self.thinking_budget_min > self.thinking_budget_max
        ):
            raise ValueError("Invalid budget range")
        return self


class ActionMaxima(ClosedModel):
    timeout_seconds: int = Field(ge=1, le=90)
    max_output_tokens: int = Field(ge=1, le=16000)
    max_input_tokens: int = Field(default=131072, ge=1, le=131072)
    max_image_pixels: int | None = Field(default=None, ge=1, le=20000000)
    max_proposals: int | None = Field(default=None, ge=1, le=200)
    max_selected: int | None = Field(default=None, ge=1, le=50)


class AIAction(ClosedModel):
    id: ShortText
    label: ShortText
    group: ShortText
    input: Literal["text", "image"]
    permission: ShortText
    location: ShortText
    maxima: ActionMaxima
    description: Annotated[str, Field(min_length=1, max_length=500)]


class LegacyOptions(ClosedModel):
    timeout_seconds: Annotated[int, Field(ge=1, le=300)] | None = None
    max_tokens: Annotated[int, Field(ge=1, le=16000)] | None = None
    image_detail: Literal["default", "ultra_high"] = "default"


class LegacyProfileConfig(ClosedModel):
    kind: Literal["legacy_snapshot"] = "legacy_snapshot"
    action_id: ShortText
    legacy_model: ShortText
    legacy_options: LegacyOptions

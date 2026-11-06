"""Finite configuration contracts; provider metadata is never arbitrary config."""

from dataclasses import dataclass
from types import MappingProxyType
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

Provider = Literal["gemini", "deepseek", "ollama", "openai_compatible"]
OpenAICompatibleTemplate = Literal["moonshot", "dashscope_intl", "openrouter", "custom"]
# How a model takes its native reasoning control on the wire:
# thinking={"type": ...} (Kimi K2), enable_thinking=<bool> (Qwen on DashScope),
# reasoning_effort=<level> (Kimi K3) or reasoning={"effort"|"enabled": ...}
# (OpenRouter). "none" sends nothing and leaves the provider's default.
ReasoningControl = Literal[
    "none", "thinking", "enable_thinking", "reasoning_effort", "reasoning"
]
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
    mode: Literal["provider_default", "enabled", "disabled", "level", "budget"] = (
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
    reasoning_enabled: bool = False
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
    legacy_deadline_seconds: Annotated[float, Field(gt=0, le=86400)] | None = None


@dataclass(frozen=True)
class OpenAICompatibleTemplateSpec:
    """A reviewed origin: where requests go and which reasoning controls it takes.

    A predefined template fixes its HTTPS origin and path prefix. The custom
    template has neither; its origin needs the admin's confirmation and may only
    use one of the predefined prefixes.
    """

    origin: str | None
    path_prefix: str | None
    reasoning: frozenset[str]
    requires_key: bool


# Verified 2026-11-06 against the providers' API references:
# https://platform.kimi.ai/docs/guide/use-kimi-k2-thinking-model
# https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions
# https://openrouter.ai/docs/use-cases/reasoning-tokens
OPENAI_COMPATIBLE_TEMPLATES = MappingProxyType(
    {
        "moonshot": OpenAICompatibleTemplateSpec(
            "https://api.moonshot.ai",
            "/v1",
            frozenset({"none", "thinking", "reasoning_effort"}),
            True,
        ),
        "dashscope_intl": OpenAICompatibleTemplateSpec(
            "https://dashscope-intl.aliyuncs.com",
            "/compatible-mode/v1",
            frozenset({"none", "enable_thinking"}),
            True,
        ),
        "openrouter": OpenAICompatibleTemplateSpec(
            "https://openrouter.ai",
            "/api/v1",
            frozenset({"none", "reasoning"}),
            True,
        ),
        # vLLM, LM Studio and other self-hosted servers: a key is optional.
        "custom": OpenAICompatibleTemplateSpec(
            None,
            None,
            frozenset({"none", "thinking", "enable_thinking", "reasoning_effort"}),
            False,
        ),
    }
)
OPENAI_COMPATIBLE_PATH_PREFIXES = tuple(
    dict.fromkeys(
        spec.path_prefix
        for spec in OPENAI_COMPATIBLE_TEMPLATES.values()
        if spec.path_prefix is not None
    )
)
MAX_MANIFEST_ENTRIES = 50


class ModelManifestEntry(ClosedModel):
    """One model an admin declares for an openai_compatible connection.

    `/models` lists identifiers only, so limits, the structured output mode and
    the native reasoning control are declared here; the transport sends exactly
    these and infers nothing from a model's name.
    """

    model_id: ModelID
    label: ShortText | None = None
    context_window: int = Field(ge=1, le=16777216)
    max_output_tokens: int = Field(ge=1, le=2097152)
    structured_output: Literal["json_object", "json_schema"]
    reasoning: ReasoningControl = "none"
    reasoning_levels: list[Level] = Field(default_factory=list, max_length=16)

    @model_validator(mode="after")
    def coherent_entry(self) -> Self:
        if "://" in self.model_id or ".." in self.model_id or "//" in self.model_id:
            raise ValueError("Invalid model identifier")
        if self.max_output_tokens > self.context_window:
            raise ValueError("Output exceeds the context window")
        if len(set(self.reasoning_levels)) != len(self.reasoning_levels):
            raise ValueError("Duplicate reasoning level")
        if self.reasoning == "reasoning_effort" and not self.reasoning_levels:
            raise ValueError("reasoning_effort needs its levels")
        if self.reasoning_levels and self.reasoning not in {
            "reasoning_effort",
            "reasoning",
        }:
            raise ValueError("Levels need a level-based reasoning control")
        return self

"""Trusted capability normalization and profile validation.

Manifest verified 2026-10-19 against official model cards and thinking docs:
https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash
https://ai.google.dev/gemini-api/docs/models/gemini-2.5-pro
https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite
https://ai.google.dev/gemini-api/docs/media-resolution
https://ai.google.dev/gemini-api/docs/generate-content/thinking
https://api-docs.deepseek.com/api/list-models/
https://api-docs.deepseek.com/guides/json_mode/
https://api-docs.deepseek.com/guides/thinking_mode/
https://github.com/ollama/ollama/blob/main/docs/api.md
https://docs.ollama.com/capabilities/thinking
"""

from typing import Any

from pydantic import ValidationError

from crate.ai.actions import get_action
from crate.ai.contracts import AIConfigurationError, ModelCapabilities, ProfileConfig

_GEMINI_MANIFEST: dict[str, dict[str, Any]] = {
    "gemini-3.8-flash": {
        "reasoning_levels": ["low", "medium", "high"],
        "image_details": ["default", "high", "ultra_high"],
    },
    "gemini-2.5-flash": {
        "thinking_budget_min": 0,
        "thinking_budget_max": 24576,
        "reasoning_disabled": True,
    },
    "gemini-2.5-pro": {"thinking_budget_min": 128, "thinking_budget_max": 32768},
    "gemini-2.5-flash-lite": {
        "thinking_budget_min": 512,
        "thinking_budget_max": 24576,
        "reasoning_disabled": True,
    },
}


def _positive(value: Any) -> int:
    if type(value) is not int or not 1 <= value <= 16777216:
        raise ValueError("Invalid token limit")
    return value


def _strings(value: Any, maximum: int = 16) -> list[str]:
    if (
        not isinstance(value, list)
        or len(value) > maximum
        or any(not isinstance(item, str) or not 1 <= len(item) <= 40 for item in value)
    ):
        raise ValueError("Invalid capability list")
    return list(dict.fromkeys(value))


def model_capabilities(
    provider: str, model_id: str, metadata: dict | None = None
) -> ModelCapabilities:
    """Normalize only protocol fields; callers supply authenticated catalog metadata."""
    data: dict[str, Any] = {
        "provider": provider,
        "model_id": model_id,
        "label": model_id,
    }
    try:
        if metadata is not None and not isinstance(metadata, dict):
            raise ValueError("Invalid metadata")
        meta = metadata or {}
        label = meta.get("displayName" if provider == "gemini" else "name")
        if label is not None:
            data["label"] = label
        if provider == "gemini":
            manifest = _GEMINI_MANIFEST.get(model_id)
            if manifest:
                data.update(
                    input_modalities=["text", "image", "audio", "video", "pdf"],
                    structured_output=True,
                    max_output_tokens=65536,
                    context_window=1048576,
                    validated=True,
                    source="provider+manifest" if metadata is not None else "manifest",
                    image_details=["default", "high"],
                )
                data.update(manifest)
            for field, native in (
                ("max_output_tokens", "outputTokenLimit"),
                ("context_window", "inputTokenLimit"),
            ):
                if native in meta:
                    data[field] = _positive(meta[native])
            if (
                "supportedGenerationMethods" in meta
                and "generateContent"
                not in _strings(meta["supportedGenerationMethods"])
            ):
                data.update(validated=False, structured_output=False)
        elif provider == "deepseek" and metadata is not None:
            modalities = _strings(meta.get("input_modalities", []), 5)
            outputs = _strings(meta.get("output_modalities", []), 5)
            if any(item not in {"text", "image"} for item in modalities):
                raise ValueError("Invalid modality")
            data.update(input_modalities=modalities)
            for field in ("max_output_tokens", "context_window"):
                if field in meta:
                    data[field] = _positive(meta[field])
            effort = meta.get("effort")
            if effort is not None:
                if not isinstance(effort, dict):
                    raise ValueError("Invalid effort")
                levels = _strings(effort.get("supported_levels", []))
                if any(
                    level not in {"low", "medium", "high", "max", "xhigh"}
                    for level in levels
                ):
                    raise ValueError("Unsupported native effort")
                if "default_level" in effort and effort["default_level"] not in levels:
                    raise ValueError("Invalid effort default")
                data.update(
                    reasoning_levels=levels,
                    reasoning_disabled=True,
                    reasoning_enabled=True,
                )
            compatible = (
                "text" in modalities
                and outputs == ["text"]
                and all(
                    field in data for field in ("context_window", "max_output_tokens")
                )
            )
            data.update(
                structured_output=compatible,
                validated=compatible,
                source="provider" if compatible else "pending",
            )
        elif provider == "ollama" and metadata is not None:
            caps = _strings(meta.get("capabilities", []))
            if "completion" in caps:
                data.update(
                    input_modalities=["text", "image"]
                    if "vision" in caps
                    else ["text"],
                    structured_output=True,
                    validated=True,
                    source="provider",
                )
            # Only /show thinking.values declares native controls; a generic
            # capability or a friendly family/name cannot establish toggle/levels.
            thinking = meta.get("thinking")
            if thinking is not None:
                if not isinstance(thinking, dict):
                    raise ValueError("Invalid thinking metadata")
                values = thinking.get("values")
                if (
                    not isinstance(values, list)
                    or not 1 <= len(values) <= 16
                    or any(type(value) not in {str, bool} for value in values)
                ):
                    raise ValueError("Invalid thinking values")
                if "default" in thinking and not any(
                    type(value) is type(thinking["default"])
                    and value == thinking["default"]
                    for value in values
                ):
                    raise ValueError("Invalid thinking default")
                data.update(
                    reasoning_levels=[
                        value for value in values if isinstance(value, str)
                    ],
                    reasoning_disabled=any(value is False for value in values),
                    reasoning_enabled=any(value is True for value in values),
                )
            info = meta.get("model_info", {})
            if not isinstance(info, dict):
                raise ValueError("Invalid model info")
            architecture = info.get("general.architecture")
            if isinstance(architecture, str) and len(architecture) <= 100:
                context = info.get(f"{architecture}.context_length")
                if context is not None:
                    data["context_window"] = _positive(context)
        return ModelCapabilities.model_validate(data)
    except (ValueError, TypeError, ValidationError):
        raise AIConfigurationError(
            "AI_CATALOG_INVALID", "Invalid model capability metadata"
        ) from None


def validate_profile(
    config: ProfileConfig, model: ModelCapabilities, action_id: str | None = None
) -> ProfileConfig:
    """Reject incompatible native options rather than silently translating them."""

    def reject(message: str) -> None:
        raise AIConfigurationError("AI_PROFILE_INCOMPATIBLE", message)

    if not model.validated:
        raise AIConfigurationError(
            "AI_MODEL_UNVALIDATED", "Model capabilities are pending validation"
        )
    if not model.structured_output or "text" not in model.input_modalities:
        reject("Model does not support the structured text contract")
    if config.image_detail not in model.image_details:
        reject("Image detail is not supported by this model")
    reasoning = config.reasoning
    if reasoning.mode == "enabled" and not model.reasoning_enabled:
        reject("Thinking cannot be explicitly enabled for this model")
    if reasoning.mode == "disabled" and not model.reasoning_disabled:
        reject("Thinking cannot be disabled for this model")
    if reasoning.mode == "level" and reasoning.level not in model.reasoning_levels:
        reject("Reasoning level is not supported by this model")
    if reasoning.mode == "budget":
        if (
            model.thinking_budget_min is None
            or model.thinking_budget_max is None
            or reasoning.budget_tokens is None
        ):
            reject("Thinking budget is not supported by this model")
        elif (
            not model.thinking_budget_min
            <= reasoning.budget_tokens
            <= model.thinking_budget_max
        ):
            reject("Thinking budget exceeds model bounds")
        if reasoning.budget_tokens == 0 and not model.reasoning_disabled:
            reject("Thinking cannot be disabled for this model")
        if (
            reasoning.budget_tokens is not None
            and reasoning.budget_tokens > config.max_output_tokens
        ):
            reject("Thinking budget exceeds the generation budget")
    if (
        model.max_output_tokens is not None
        and config.max_output_tokens > model.max_output_tokens
    ):
        reject("Output exceeds model bounds")
    if (
        model.context_window is not None
        and config.max_input_tokens + config.max_output_tokens > model.context_window
    ):
        reject("Input and output exceed the context window")
    if action_id is not None:
        action = get_action(action_id)
        if action.input == "image" and "image" not in model.input_modalities:
            raise AIConfigurationError(
                "AI_ACTION_NEEDS_IMAGE", "Action requires image input"
            )
        if (
            config.timeout_seconds > action.maxima.timeout_seconds
            or config.max_output_tokens > action.maxima.max_output_tokens
            or config.max_input_tokens > action.maxima.max_input_tokens
        ):
            reject("Profile exceeds action bounds")
    return config


# Manifest revision 2026-10-19. Official per-image maxima plus margin:
# Gemini 3 default/high ~1120, ultra_high ~2240; DeepSeek vision upper bound 1024.
# These conservative admission estimates are not exact provider invoice counts.
def image_token_bound(model: ModelCapabilities) -> int | None:
    if not model.validated or "image" not in model.input_modalities:
        return None
    if model.provider == "gemini" and model.model_id == "gemini-3.8-flash":
        return 4096
    if model.provider == "deepseek":
        return 2048
    return None

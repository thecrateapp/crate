"""Derive per-action profiles from one chosen model, within each action's own limits.

Pure derivation: no database access. A single model (plus a requested reasoning
configuration) is projected onto every registered action, producing either a
validated :class:`~crate.ai.contracts.ProfileConfig` or a closed incompatibility
reason per action.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Literal

from crate.ai.actions import ACTIONS, get_action
from crate.ai.capabilities import image_token_bound, validate_profile
from crate.ai.contracts import (
    AIConfigurationError,
    ImageDetail,
    ModelCapabilities,
    ProfileConfig,
    ReasoningConfig,
)

MIN_INPUT_TOKENS = 4096
PREFERRED_IMAGE_DETAIL: dict[str, ImageDetail] = {"shows.extract.vision": "ultra_high"}


@dataclass(frozen=True)
class DerivedConfig:
    action_id: str
    config: ProfileConfig | None
    reason: str | None = None
    adjustments: tuple[Literal["reasoning", "image_detail"], ...] = ()


def require_supported_reasoning(
    model: ModelCapabilities, reasoning: ReasoningConfig
) -> None:
    """Validate a requested reasoning configuration against a model, with no action."""
    max_output_tokens = min(
        16000,
        model.max_output_tokens or 16000,
        (model.context_window or 16001) - 1,
    )
    if max_output_tokens < 1:
        # No probe fits (context_window=1); no action could run on this model either.
        raise AIConfigurationError(
            "AI_MODEL_INCOMPATIBLE", "Model context window is too small"
        )
    config = ProfileConfig(
        reasoning=reasoning,
        timeout_seconds=1,
        max_output_tokens=max_output_tokens,
        max_input_tokens=1,
    )
    validate_profile(config, model)


def _image_detail(
    model: ModelCapabilities, action_id: str, is_image_action: bool
) -> tuple[ImageDetail | None, bool]:
    if is_image_action:
        candidates: list[ImageDetail] = [
            PREFERRED_IMAGE_DETAIL.get(action_id, "default"),
            "high",
            "default",
        ]
    else:
        preferred: ImageDetail = (
            "default" if "default" in model.image_details else model.image_details[0]
        )
        candidates = [preferred]
    chosen = next(
        (detail for detail in candidates if detail in model.image_details), None
    )
    return chosen, chosen is not None and chosen != candidates[0]


def _resolve_reasoning(
    reasoning: ReasoningConfig, model: ModelCapabilities, output: int
) -> tuple[ReasoningConfig, bool]:
    if reasoning.mode != "budget":
        return reasoning, False
    budget = min(reasoning.budget_tokens or 0, output)
    minimum = model.thinking_budget_min or 0
    if budget < minimum or (budget == 0 and not model.reasoning_disabled):
        resolved = ReasoningConfig()
    else:
        resolved = ReasoningConfig(mode="budget", budget_tokens=budget)
    return resolved, resolved != reasoning


def derive_action_config(
    model: ModelCapabilities, reasoning: ReasoningConfig, action_id: str
) -> DerivedConfig:
    action = get_action(action_id)
    is_image_action = action.input == "image"

    if is_image_action:
        if "image" not in model.input_modalities:
            return DerivedConfig(action_id, None, "AI_ACTION_NEEDS_IMAGE")
        if image_token_bound(model) is None:
            return DerivedConfig(action_id, None, "AI_IMAGE_BOUND_UNKNOWN")

    timeout = action.maxima.timeout_seconds

    output = action.maxima.max_output_tokens
    if model.max_output_tokens is not None:
        output = min(output, model.max_output_tokens)

    input_tokens = action.maxima.max_input_tokens
    if model.context_window is not None:
        input_tokens = min(input_tokens, model.context_window - output)
    if input_tokens < MIN_INPUT_TOKENS:
        return DerivedConfig(action_id, None, "AI_CONTEXT_TOO_SMALL")

    image_detail, image_detail_adjusted = _image_detail(
        model, action_id, is_image_action
    )
    if image_detail is None:
        return DerivedConfig(action_id, None, "AI_PROFILE_INCOMPATIBLE")
    resolved_reasoning, reasoning_adjusted = _resolve_reasoning(
        reasoning, model, output
    )

    adjustments: list[Literal["reasoning", "image_detail"]] = []
    if reasoning_adjusted:
        adjustments.append("reasoning")
    if image_detail_adjusted:
        adjustments.append("image_detail")

    config = ProfileConfig(
        reasoning=resolved_reasoning,
        image_detail=image_detail,
        timeout_seconds=timeout,
        max_output_tokens=output,
        max_input_tokens=input_tokens,
    )
    try:
        validate_profile(config, model, action_id)
    except AIConfigurationError as error:
        return DerivedConfig(action_id, None, error.code)
    return DerivedConfig(action_id, config, None, tuple(adjustments))


def derive_all(
    model: ModelCapabilities,
    reasoning: ReasoningConfig,
    action_ids: Iterable[str] | None = None,
) -> list[DerivedConfig]:
    if action_ids is None:
        ordered = list(ACTIONS)
    else:
        requested = list(action_ids)
        unknown = [action_id for action_id in requested if action_id not in ACTIONS]
        if unknown:
            raise AIConfigurationError("AI_ACTION_UNKNOWN", "Unknown action")
        selected = set(requested)
        ordered = [action_id for action_id in ACTIONS if action_id in selected]
    return [derive_action_config(model, reasoning, action_id) for action_id in ordered]

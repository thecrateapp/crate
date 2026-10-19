"""Deriving per-feature configuration from a single chosen model, with no DB access."""

import pytest

from crate.ai.actions import ACTIONS
from crate.ai.capabilities import model_capabilities, validate_profile
from crate.ai.contracts import AIConfigurationError, ModelCapabilities, ReasoningConfig
from crate.ai.default_model import (
    derive_action_config,
    derive_all,
    require_supported_reasoning,
)

GEMINI_38 = model_capabilities("gemini", "gemini-3.8-flash")
GEMINI_25 = model_capabilities("gemini", "gemini-2.5-flash")
OLLAMA_TEXT = model_capabilities(
    "ollama",
    "qwen3:8b",
    {
        "capabilities": ["completion"],
        "model_info": {"general.architecture": "qwen3", "qwen3.context_length": 40960},
    },
)
DEEPSEEK_VISION = model_capabilities(
    "deepseek",
    "deepseek-vl",
    {
        "input_modalities": ["text", "image"],
        "output_modalities": ["text"],
        "max_output_tokens": 8192,
        "context_window": 131072,
    },
)
HIGH = ReasoningConfig(mode="level", level="high")
PROVIDER_DEFAULT = ReasoningConfig()

IMAGE_ACTIONS = {"shows.extract.vision", "artwork.hero.analyze"}


def _derived(model, reasoning, action_id):
    results = derive_all(model, reasoning, [action_id])
    assert len(results) == 1
    return results[0]


def test_features_take_their_action_maxima_within_model_bounds():
    results = {d.action_id: d for d in derive_all(GEMINI_38, HIGH)}

    refine = results["music_paths.refine"].config
    assert (
        refine.timeout_seconds,
        refine.max_output_tokens,
        refine.max_input_tokens,
    ) == (
        8,
        4096,
        131072,
    )
    assert refine.reasoning.level == "high"

    for action_id in ("genres.eq.propose", "playlists.description.generate"):
        config = results[action_id].config
        assert (config.timeout_seconds, config.max_output_tokens) == (45, 2048)

    extract_text = results["shows.extract.text"].config
    assert (
        extract_text.timeout_seconds,
        extract_text.max_output_tokens,
        extract_text.max_input_tokens,
    ) == (45, 16000, 131072)

    for d in results.values():
        assert d.adjustments == ()


def test_model_output_and_context_bound_the_derived_limits():
    results = {d.action_id: d for d in derive_all(DEEPSEEK_VISION, PROVIDER_DEFAULT)}

    extract_text = results["shows.extract.text"].config
    assert (extract_text.max_output_tokens, extract_text.max_input_tokens) == (
        8192,
        122880,
    )

    eq = results["genres.eq.propose"].config
    assert (eq.max_output_tokens, eq.max_input_tokens) == (2048, 129024)


def test_text_only_models_cannot_take_image_features():
    results = derive_all(OLLAMA_TEXT, PROVIDER_DEFAULT)
    by_id = {d.action_id: d for d in results}

    incompatible = {d.action_id for d in results if d.config is None}
    assert incompatible == IMAGE_ACTIONS
    for action_id in IMAGE_ACTIONS:
        assert by_id[action_id].reason == "AI_ACTION_NEEDS_IMAGE"

    compatible = [d for d in results if d.config is not None]
    assert len(compatible) == len(ACTIONS) - 2

    assert by_id["shows.extract.text"].config.max_input_tokens == 24960


def test_image_features_need_a_known_image_token_bound():
    results = {d.action_id: d for d in derive_all(GEMINI_25, PROVIDER_DEFAULT)}

    for action_id in IMAGE_ACTIONS:
        d = results[action_id]
        assert d.config is None
        assert d.reason == "AI_IMAGE_BOUND_UNKNOWN"

    for action_id, d in results.items():
        if action_id not in IMAGE_ACTIONS:
            assert d.config is not None


def test_poster_import_prefers_the_highest_image_detail():
    gemini_vision = _derived(GEMINI_38, PROVIDER_DEFAULT, "shows.extract.vision")
    assert gemini_vision.config.image_detail == "ultra_high"
    assert gemini_vision.adjustments == ()

    gemini_hero = _derived(GEMINI_38, PROVIDER_DEFAULT, "artwork.hero.analyze")
    assert gemini_hero.config.image_detail == "default"

    deepseek_vision = _derived(
        DEEPSEEK_VISION, PROVIDER_DEFAULT, "shows.extract.vision"
    )
    assert deepseek_vision.config.image_detail == "default"
    assert deepseek_vision.adjustments == ("image_detail",)


def test_thinking_budget_fits_each_feature_output():
    budget = ReasoningConfig(mode="budget", budget_tokens=4096)
    eq = _derived(GEMINI_25, budget, "genres.eq.propose")
    assert eq.config.reasoning.budget_tokens == 2048
    assert eq.adjustments == ("reasoning",)

    extract_text = _derived(GEMINI_25, budget, "shows.extract.text")
    assert extract_text.config.reasoning.budget_tokens == 4096
    assert extract_text.adjustments == ()

    tiny_output_pro = model_capabilities(
        "gemini", "gemini-2.5-pro", {"outputTokenLimit": 100}
    )
    small_budget = ReasoningConfig(mode="budget", budget_tokens=1024)
    results = derive_all(tiny_output_pro, small_budget)
    compatible = [d for d in results if d.config is not None]
    assert compatible, "expected at least one compatible text action"
    for d in compatible:
        assert d.config.reasoning.mode == "provider_default"
        assert d.adjustments == ("reasoning",)


def test_small_context_windows_are_reported():
    small_context_ollama = model_capabilities(
        "ollama",
        "tiny:1b",
        {
            "capabilities": ["completion"],
            "model_info": {"general.architecture": "tiny", "tiny.context_length": 8192},
        },
    )
    results = {
        d.action_id: d for d in derive_all(small_context_ollama, PROVIDER_DEFAULT)
    }

    eq = results["genres.eq.propose"]
    assert eq.config is not None
    assert eq.config.max_input_tokens == 6144

    extract_text = results["shows.extract.text"]
    assert extract_text.config is None
    assert extract_text.reason == "AI_CONTEXT_TOO_SMALL"


def test_request_reasoning_must_be_native_to_the_model():
    with pytest.raises(AIConfigurationError) as excinfo:
        require_supported_reasoning(
            GEMINI_38, ReasoningConfig(mode="level", level="minimal")
        )
    assert excinfo.value.code == "AI_PROFILE_INCOMPATIBLE"

    with pytest.raises(AIConfigurationError) as excinfo:
        require_supported_reasoning(
            GEMINI_25, ReasoningConfig(mode="level", level="high")
        )
    assert excinfo.value.code == "AI_PROFILE_INCOMPATIBLE"

    with pytest.raises(AIConfigurationError) as excinfo:
        require_supported_reasoning(
            GEMINI_25, ReasoningConfig(mode="budget", budget_tokens=24576)
        )
    assert excinfo.value.code == "AI_PROFILE_INCOMPATIBLE"

    with pytest.raises(AIConfigurationError) as excinfo:
        require_supported_reasoning(
            model_capabilities("gemini", "gemini-9"), PROVIDER_DEFAULT
        )
    assert excinfo.value.code == "AI_MODEL_UNVALIDATED"


def test_every_derived_config_passes_profile_validation():
    cases = [
        (GEMINI_38, PROVIDER_DEFAULT),
        (GEMINI_38, HIGH),
        (GEMINI_25, PROVIDER_DEFAULT),
        (GEMINI_25, ReasoningConfig(mode="budget", budget_tokens=4096)),
        (OLLAMA_TEXT, PROVIDER_DEFAULT),
        (DEEPSEEK_VISION, PROVIDER_DEFAULT),
    ]
    for model, reasoning in cases:
        for d in derive_all(model, reasoning):
            if d.config is None:
                continue
            validate_profile(d.config, model, d.action_id)
            action = ACTIONS[d.action_id]
            assert d.config.timeout_seconds <= action.maxima.timeout_seconds
            assert d.config.max_output_tokens <= action.maxima.max_output_tokens
            assert d.config.max_input_tokens <= action.maxima.max_input_tokens


def test_derive_action_config_matches_the_single_action_entry_from_derive_all():
    direct = derive_action_config(GEMINI_38, HIGH, "music_paths.refine")
    (via_all,) = derive_all(GEMINI_38, HIGH, ["music_paths.refine"])
    assert direct == via_all


def test_derive_all_keeps_action_order_and_rejects_unknown_actions():
    results = derive_all(GEMINI_38, HIGH, ["genres.eq.propose", "shows.extract.vision"])
    assert [d.action_id for d in results] == [
        "shows.extract.vision",
        "genres.eq.propose",
    ]

    with pytest.raises(AIConfigurationError) as excinfo:
        derive_all(GEMINI_38, HIGH, ["nope"])
    assert excinfo.value.code == "AI_ACTION_UNKNOWN"


def test_unsupported_image_detail_is_a_closed_reason():
    only_ultra = ModelCapabilities.model_validate(
        GEMINI_38.model_dump() | {"image_details": ["ultra_high"]}
    )

    results = {d.action_id: d for d in derive_all(only_ultra, HIGH)}

    hero = results["artwork.hero.analyze"]
    assert hero.config is None
    assert hero.reason == "AI_PROFILE_INCOMPATIBLE"
    assert results["shows.extract.vision"].config.image_detail == "ultra_high"


def test_degenerate_context_window_is_a_closed_reasoning_error():
    degenerate = ModelCapabilities.model_validate(
        OLLAMA_TEXT.model_dump() | {"context_window": 1}
    )

    with pytest.raises(AIConfigurationError) as excinfo:
        require_supported_reasoning(degenerate, PROVIDER_DEFAULT)

    assert excinfo.value.code == "AI_MODEL_INCOMPATIBLE"
    assert all(
        d.reason == "AI_CONTEXT_TOO_SMALL"
        for d in derive_all(degenerate, PROVIDER_DEFAULT, ["genres.eq.propose"])
    )

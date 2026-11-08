"""AI refinement of evaluated edges (Smart Mix 3, SM5): mocked provider, no network."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from refine import (
    API_KEY_VARIABLES,
    FAILED_CODES,
    PRICES,
    Budget,
    BudgetExceeded,
    EdgeJob,
    RateLimiter,
    RefineTarget,
    Refiner,
    call_cost_usd,
    environment_api_key,
    parse_reasoning,
    parse_target,
    resolve_target,
)
from crate.ai.contracts import AIConfigurationError, ProfileConfig, ReasoningConfig
from crate.ai.transport import NativeResponse
from crate.llm.prompts.smart_mix_transition import (
    SYSTEM_PROMPT,
    SmartMixRefinementResponse,
    build_refinement_input,
    render_refinement_prompt,
)
from crate.smart_mix.candidates import plan_transition_candidates
from crate.smart_mix.policy import PLANNER_POLICY_V3
from tests.smart_mix_candidate_cases import (
    INCOMING_LAYOUT,
    INCOMING_UID,
    OUTGOING_LAYOUT,
    OUTGOING_UID,
    context,
    profile,
)

SECRET = "test-key-that-must-never-be-written"
USAGE = {
    "input_tokens": 3_000,
    "output_tokens": 120,
    "thought_tokens": 200,
    "cached_input_tokens": 0,
    "total_tokens": 3_320,
}
CATALOG_FLASH = {
    "label": "Gemini 3.8 Flash",
    "source": "provider+manifest",
    "model_id": "gemini-3.8-flash",
    "provider": "gemini",
    "validated": True,
    "image_details": ["default", "high", "ultra_high"],
    "context_window": 1_048_576,
    "input_modalities": ["text", "image"],
    "reasoning_levels": ["low", "medium", "high"],
    "max_output_tokens": 65_536,
    "reasoning_enabled": False,
    "structured_output": True,
    "reasoning_disabled": False,
    "thinking_budget_max": None,
    "thinking_budget_min": None,
}
CATALOG_PENDING = {
    "label": "Gemini 3.1 Pro Preview",
    "source": "pending",
    "model_id": "gemini-3.1-pro-preview",
    "provider": "gemini",
    "validated": False,
    "image_details": ["default"],
    "context_window": 1_048_576,
    "input_modalities": [],
    "reasoning_levels": [],
    "max_output_tokens": 65_536,
    "reasoning_enabled": False,
    "structured_output": False,
    "reasoning_disabled": False,
    "thinking_budget_max": None,
    "thinking_budget_min": None,
}


def _connection(*models: dict, secret_source: str = "environment") -> dict:
    return {
        "id": "f0028100-fb55-58c5-8a93-bb95dee25e3f",
        "label": "Environment gemini",
        "provider": "gemini",
        "secret_source": secret_source,
        "endpoint": None,
        "enabled": True,
        "model_catalog": list(models),
    }


def _target() -> RefineTarget:
    return resolve_target(
        "gemini/gemini-3.8-flash", connection=_connection(CATALOG_FLASH)
    )


def _job(
    edge_id: str = "e0001", *, menu: int | None = None, **profile_overrides
) -> EdgeJob:
    outgoing = profile(OUTGOING_UID, layout=OUTGOING_LAYOUT, **profile_overrides)
    incoming = profile(INCOMING_UID, layout=INCOMING_LAYOUT)
    ctx = context()
    candidates = plan_transition_candidates(
        outgoing,
        incoming,
        ctx,
        PLANNER_POLICY_V3,
        outgoing_track_entity_uid=OUTGOING_UID,
        incoming_track_entity_uid=INCOMING_UID,
    )
    return EdgeJob(
        edge_id=edge_id,
        outgoing=outgoing,
        incoming=incoming,
        candidates=tuple(candidates[:menu]),
        context=ctx,
        genres=("techno", "house"),
    )


def _answer(**overrides) -> str:
    values = {
        "candidate_index": 1,
        "outgoing_phrase_shift": 0,
        "incoming_phrase_shift": 0,
        "length_step": 0,
        "bass_handoff": "keep",
        "reason": "Longer phrase-aligned blend.",
        "confidence": 0.8,
        "notes": [],
    }
    values.update(overrides)
    return json.dumps(values)


class FakeTransport:
    """Stands in for ``crate.ai.transport.generate``: records calls, never connects."""

    def __init__(self, *answers: str | Exception) -> None:
        self.answers = list(answers)
        self.calls: list[dict] = []

    def __call__(self, context, *, api_key, prompt, response_schema, system=""):
        self.calls.append(
            {
                "context": context,
                "api_key": api_key,
                "prompt": prompt,
                "response_schema": response_schema,
                "system": system,
            }
        )
        answer = self.answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return NativeResponse(answer, dict(USAGE), "gemini-3.8-flash-001", 1_234)


def _refiner(tmp_path: Path, transport, **options) -> Refiner:
    return Refiner(
        _target(),
        api_key=SECRET,
        cache_dir=tmp_path / "cache",
        budget=options.pop("budget", Budget(tmp_path / "cache" / "ledger.jsonl", 5.0)),
        transport=transport,
        limiter=RateLimiter(0.0),
        **options,
    )


def test_parse_target_reads_provider_and_model() -> None:
    assert parse_target("gemini/gemini-3.8-flash") == ("gemini", "gemini-3.8-flash")
    assert parse_target("ollama/qwen3:8b") == ("ollama", "qwen3:8b")
    for invalid in ("gemini-3.8-flash", "openai/gpt", "gemini/", "/model"):
        with pytest.raises(ValueError):
            parse_target(invalid)


def test_parse_reasoning_maps_the_cli_values() -> None:
    assert parse_reasoning("low") == ReasoningConfig(mode="level", level="low")
    assert parse_reasoning("off") == ReasoningConfig(mode="disabled")
    assert parse_reasoning("default") == ReasoningConfig()
    assert parse_reasoning("budget:256") == ReasoningConfig(
        mode="budget", budget_tokens=256
    )
    with pytest.raises(ValueError):
        parse_reasoning("extreme")


def test_resolve_target_derives_the_action_profile_from_the_catalog() -> None:
    target = _target()
    assert target.provider == "gemini"
    assert target.model_id == "gemini-3.8-flash"
    assert target.connection_label == "Environment gemini"
    # The action's own limits (45 s, 1,024 output tokens) and its preferred low
    # reasoning, as the admin's default-model flow binds it (SM4.PR1).
    assert target.config.timeout_seconds == 45
    assert target.config.max_output_tokens == 1_024
    assert target.config.reasoning == ReasoningConfig(mode="level", level="low")
    assert target.profile_validated is True


def test_resolve_target_marks_an_unvalidated_model_with_a_reasoning_override() -> None:
    with pytest.raises(ValueError, match="not validated"):
        resolve_target(
            "gemini/gemini-3.1-pro-preview", connection=_connection(CATALOG_PENDING)
        )
    target = resolve_target(
        "gemini/gemini-3.1-pro-preview",
        connection=_connection(CATALOG_PENDING),
        reasoning=parse_reasoning("low"),
    )
    assert target.profile_validated is False
    assert target.config.reasoning == ReasoningConfig(mode="level", level="low")
    assert target.config.max_output_tokens == 1_024
    assert target.config.timeout_seconds == 45


def test_resolve_target_refuses_other_providers_models_and_stored_secrets() -> None:
    with pytest.raises(ValueError, match="provider"):
        resolve_target("deepseek/deepseek-flash", connection=_connection(CATALOG_FLASH))
    with pytest.raises(ValueError, match="catalog"):
        resolve_target("gemini/gemini-9-ultra", connection=_connection(CATALOG_FLASH))
    with pytest.raises(ValueError, match="environment"):
        resolve_target(
            "gemini/gemini-3.8-flash",
            connection=_connection(CATALOG_FLASH, secret_source="stored"),
        )


def test_environment_api_key_uses_the_server_variable_names(monkeypatch) -> None:
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setenv("AUDIOMUSE_GEMINI_API_KEY", " key ")
    assert environment_api_key("gemini") == "key"
    monkeypatch.delenv("AUDIOMUSE_GEMINI_API_KEY")
    with pytest.raises(ValueError, match="GEMINI_API_KEY"):
        environment_api_key("gemini")
    assert environment_api_key("ollama") == ""


def test_call_cost_bills_thinking_as_output_and_discounts_cached_input() -> None:
    price = PRICES["gemini/gemini-3.8-flash"]
    usage = dict(USAGE, cached_input_tokens=1_000)
    expected = (
        2_000 * price.input_per_million
        + 1_000 * price.cached_input_per_million
        + 320 * price.output_per_million
    ) / 1_000_000
    assert call_cost_usd(usage, price) == pytest.approx(expected)
    assert call_cost_usd(None, price) is None


def test_refine_sends_the_sm4_prompt_and_applies_the_answer(tmp_path) -> None:
    job = _job()
    transport = FakeTransport(_answer())
    result = _refiner(tmp_path, transport).refine(job)

    (call,) = transport.calls
    expected_prompt = render_refinement_prompt(
        build_refinement_input(
            job.outgoing,
            job.incoming,
            job.candidates,
            policy=PLANNER_POLICY_V3,
            context=job.context,
            genres=job.genres,
            send_genre=True,
        )
    )
    assert call["prompt"] == expected_prompt
    assert call["system"] == SYSTEM_PROMPT
    assert call["response_schema"] == SmartMixRefinementResponse.model_json_schema()
    assert call["context"]["model_id"] == "gemini-3.8-flash"
    assert call["context"]["config"]["reasoning"] == {
        "mode": "level",
        "level": "low",
        "budget_tokens": None,
    }

    assert result.status == "ready"
    assert result.code is None
    assert result.candidate_index == 1
    assert result.plan == job.candidates[1].to_plan()
    assert result.latency_ms == 1_234
    assert result.usage == USAGE
    assert result.cost_usd == pytest.approx(
        call_cost_usd(USAGE, PRICES["gemini/gemini-3.8-flash"])
    )
    assert result.cached is False
    assert result.reported_model == "gemini-3.8-flash-001"


def test_refine_without_genre_sends_none(tmp_path) -> None:
    job = _job()
    transport = FakeTransport(_answer())
    _refiner(tmp_path, transport, send_genre=False).refine(job)
    payload = json.loads(transport.calls[0]["prompt"])
    assert "genre" not in payload["out"]
    assert "genre" not in payload["in"]


def test_single_candidate_is_rejected_without_a_call(tmp_path) -> None:
    job = _job()
    single = EdgeJob(
        edge_id=job.edge_id,
        outgoing=job.outgoing,
        incoming=job.incoming,
        candidates=job.candidates[:1],
        context=job.context,
        genres=job.genres,
    )
    transport = FakeTransport()
    result = _refiner(tmp_path, transport).refine(single)
    assert transport.calls == []
    assert (result.status, result.code) == ("rejected", "single_candidate")
    assert result.called is False


@pytest.mark.parametrize(
    ("answer", "code"),
    [
        ("not json", "response_invalid"),
        (_answer(extra="field"), "response_invalid"),
        (_answer(candidate_index=5), "unknown_candidate"),
        (_answer(confidence=0.3), "low_confidence"),
    ],
)
def test_invalid_answers_are_rejected_with_the_sm4_codes(
    tmp_path, answer, code
) -> None:
    result = _refiner(tmp_path, FakeTransport(answer)).refine(_job(menu=3))
    assert (result.status, result.code) == ("rejected", code)
    assert result.called is True
    assert result.cost_usd is not None


def test_error_mapping_and_key_names_match_the_server() -> None:
    from crate.ai import configuration
    from crate.worker_handlers import smart_mix_refinement as task

    assert FAILED_CODES == task.FAILED_CODES
    for provider, names in API_KEY_VARIABLES.items():
        assert names == configuration._KEYS[provider]


def test_a_transport_invalid_response_is_a_response_invalid_rejection(tmp_path) -> None:
    transport = FakeTransport(AIConfigurationError("AI_RESPONSE_INVALID", "bad"))
    result = _refiner(tmp_path, transport).refine(_job())
    assert (result.status, result.code) == ("rejected", "response_invalid")
    # No usage came back: the ledger keeps the call's worst case.
    assert result.cost_estimated is True


def test_transport_failure_is_stored_and_never_retried_blindly(tmp_path) -> None:
    failing = FakeTransport(AIConfigurationError("AI_PROVIDER_TIMEOUT", "timeout"))
    first = _refiner(tmp_path, failing).refine(_job())
    assert (first.status, first.code) == ("failed", "AI_PROVIDER_TIMEOUT")

    rerun = FakeTransport(_answer())
    again = _refiner(tmp_path, rerun).refine(_job())
    assert rerun.calls == []
    assert (again.status, again.code) == ("failed", "AI_PROVIDER_TIMEOUT")
    assert again.cached is True

    retried = _refiner(tmp_path, rerun, retry_failed=True).refine(_job())
    assert len(rerun.calls) == 1
    assert retried.status == "ready"


def test_cached_answers_are_not_paid_again(tmp_path) -> None:
    first = _refiner(tmp_path, FakeTransport(_answer())).refine(_job())
    transport = FakeTransport()
    second = _refiner(tmp_path, transport).refine(_job())
    assert transport.calls == []
    assert second.cached is True
    assert second.status == first.status
    assert second.plan == first.plan
    assert second.latency_ms == first.latency_ms
    assert second.cost_usd == first.cost_usd


def test_a_changed_prompt_is_a_new_cache_entry(tmp_path) -> None:
    _refiner(tmp_path, FakeTransport(_answer())).refine(_job())
    transport = FakeTransport(_answer())
    _refiner(tmp_path, transport).refine(_job(global_energy=0.2))
    assert len(transport.calls) == 1


def test_budget_stops_before_a_call_that_could_exceed_it(tmp_path) -> None:
    ledger = tmp_path / "cache" / "ledger.jsonl"
    transport = FakeTransport(_answer(), _answer())
    first_job = _job("e0001")
    refiner = _refiner(tmp_path, transport, budget=Budget(ledger, 1.0))
    worst = refiner.worst_case_usd(first_job)
    # The reservation is the most a call can cost: the byte count of the input as
    # tokens (the runtime's admission bound) and every output token.
    assert worst > call_cost_usd(USAGE, PRICES["gemini/gemini-3.8-flash"])
    refiner.refine(first_job)
    spent = Budget(ledger, 1.0).spent_usd
    assert spent == pytest.approx(
        call_cost_usd(USAGE, PRICES["gemini/gemini-3.8-flash"])
    )

    # A fresh run reads what earlier runs spent from the ledger.
    tight = Budget(ledger, spent + worst - 0.0001)
    with pytest.raises(BudgetExceeded):
        _refiner(tmp_path, transport, budget=tight).refine(_job("e0002", bpm=126.0))
    assert len(transport.calls) == 1


def test_refine_many_marks_edges_after_the_budget_as_unavailable(tmp_path) -> None:
    ledger = tmp_path / "cache" / "ledger.jsonl"
    transport = FakeTransport(_answer(), _answer())
    jobs = [_job("e0001"), _job("e0002", global_energy=0.2)]
    worst = _refiner(tmp_path, transport).worst_case_usd(jobs[0])
    refiner = _refiner(tmp_path, transport, budget=Budget(ledger, worst + 0.0005))
    results = refiner.refine_many(jobs, concurrency=1)
    assert results[0].status == "ready"
    assert (results[1].status, results[1].code) == ("unavailable", "budget")
    assert refiner.budget_exhausted is True
    assert len(transport.calls) == 1


def test_rate_limiter_spaces_call_starts() -> None:
    now = [100.0]
    slept: list[float] = []

    def sleep(seconds: float) -> None:
        slept.append(seconds)
        now[0] += seconds

    limiter = RateLimiter(2.0, clock=lambda: now[0], sleep=sleep)
    limiter.wait()
    limiter.wait()
    now[0] += 0.5
    limiter.wait()
    assert slept == [pytest.approx(2.0), pytest.approx(1.5)]


def test_no_secret_reaches_the_cache_or_the_ledger(tmp_path) -> None:
    _refiner(tmp_path, FakeTransport(_answer())).refine(_job())
    _refiner(
        tmp_path,
        FakeTransport(AIConfigurationError("AI_PROVIDER_FAILED", "failed")),
    ).refine(_job(global_energy=0.3))
    for path in (tmp_path / "cache").rglob("*"):
        if path.is_file():
            assert SECRET not in path.read_text()


def test_target_metadata_names_the_price_source() -> None:
    meta = _target().to_meta()
    assert meta["model"] == "gemini/gemini-3.8-flash"
    assert meta["price"]["source"].startswith("https://")
    assert meta["price"]["date"] == "2026-11-07"
    assert meta["config"] == ProfileConfig.model_validate(meta["config"]).model_dump(
        mode="json"
    )
    assert "api_key" not in json.dumps(meta)


def test_a_balanced_answer_on_a_crossfade_is_rejected_and_never_offered(
    tmp_path,
) -> None:
    # The answer most of SM5 revision 1's rejections had: balanced bass on a
    # crossfade candidate. The validation still rejects it; the prompt now lists
    # only keep and none for every crossfade candidate.
    job = _job(menu=4, bpm=140.0)
    assert all(candidate.mode == "adaptive" for candidate in job.candidates)
    transport = FakeTransport(_answer(candidate_index=1, bass_handoff="balanced"))
    result = _refiner(tmp_path, transport).refine(job)

    assert (result.status, result.code) == ("rejected", "bass_handoff_not_allowed")
    offered = [
        item["bassOk"]
        for item in json.loads(transport.calls[0]["prompt"])["candidates"]
    ]
    assert offered == [["keep", "none"]] * len(job.candidates)

"""The `smart_mix_refine_transition` task (SM4.PR2): one model call, never logged."""

from __future__ import annotations

import logging
from types import SimpleNamespace

import pytest

from crate.ai.contracts import AIConfigurationError
from crate.llm.prompts.smart_mix_transition import SmartMixRefinementResponse
from crate.smart_mix_ai import REFINE_ACTION, edge_refinement_key
from crate.worker_handlers import smart_mix_refinement as worker
from tests.smart_mix_candidate_cases import (
    INCOMING_LAYOUT,
    INCOMING_UID,
    OUTGOING_LAYOUT,
    OUTGOING_UID,
    context,
    profile,
)

FINGERPRINT = "c" * 64
CONTEXT = {
    **context().to_dict(),
    "allowLongBeatmatch": True,
    "setHistory": [{"mode": "beatmatch", "durationBars": 32, "deltaEnergy": -0.1}],
}
REASON = "Long blend from the outro into the intro, vocals apart."


def _profiles(revision="profile-v1"):
    return [
        profile(
            OUTGOING_UID,
            layout=OUTGOING_LAYOUT,
            vocals=[100, 20, 140, 30, 150, 20],
            profile_revision=revision,
        ),
        profile(
            INCOMING_UID,
            layout=INCOMING_LAYOUT,
            vocals=[10, 20, 140, 30, 150, 20],
            profile_revision=revision,
        ),
    ]


def _params(**overrides):
    params = {
        "outgoing_track_entity_uid": OUTGOING_UID,
        "incoming_track_entity_uid": INCOMING_UID,
        "outgoing_profile_revision": "profile-v1",
        "incoming_profile_revision": "profile-v1",
        "context": CONTEXT,
        "send_genre": True,
        "ai_acceptance": {"action_id": REFINE_ACTION, "fingerprint": FINGERPRINT},
        "actor_user_id": 5,
    }
    params.update(overrides)
    params["refinement_key"] = edge_refinement_key(
        outgoing_track_entity_uid=params["outgoing_track_entity_uid"],
        incoming_track_entity_uid=params["incoming_track_entity_uid"],
        outgoing_profile_revision=params["outgoing_profile_revision"],
        incoming_profile_revision=params["incoming_profile_revision"],
        context=params["context"],
        config_fingerprint=FINGERPRINT,
        send_genre=params["send_genre"],
    )
    return params


def _answer(**overrides):
    values = {
        "candidate_index": 1,
        "outgoing_phrase_shift": 0,
        "incoming_phrase_shift": 0,
        "length_step": 0,
        "bass_handoff": "keep",
        "reason": REASON,
        "confidence": 0.82,
        "notes": ["secret note from the model"],
    }
    values.update(overrides)
    answer = SmartMixRefinementResponse.model_validate(values)
    object.__setattr__(answer, "_ai_model_id", "qwen3.8:27b")
    object.__setattr__(
        answer, "_ai_invocation_id", "1b4e28ba-2fa1-11d2-883f-0016d3cca427"
    )
    return answer


@pytest.fixture
def env(monkeypatch):
    state = SimpleNamespace(
        stored={},
        saved=[],
        cached={},
        deleted=[],
        budget=[],
        calls=[],
        prompts=[],
        profiles=_profiles(),
        answer=_answer(),
        error=None,
    )

    def resume(action_id, accepted, *, actor_id=None, job_id=None):
        assert action_id == REFINE_ACTION
        if accepted.get("fingerprint") != FINGERPRINT:
            raise AIConfigurationError("AI_CONTEXT_STALE", "stale")
        return {
            "context": {
                "action_id": REFINE_ACTION,
                "config_fingerprint": FINGERPRINT,
                "model_id": "qwen3.8:27b",
                "provider": "ollama",
            },
            "actor_id": actor_id,
            "job_id": job_id,
        }

    def execute(action_id, response_model, prompt, *, system="", **call):
        state.calls.append((action_id, response_model, call))
        state.prompts.append(prompt)
        if state.error is not None:
            raise state.error
        return state.answer

    monkeypatch.setattr(worker, "get_many", lambda keys: dict(state.stored))
    monkeypatch.setattr(worker, "save", lambda row: state.saved.append(dict(row)))
    monkeypatch.setattr(
        worker,
        "get_track_mix_profiles_by_entity_uids",
        lambda uids, **kwargs: list(state.profiles),
    )
    monkeypatch.setattr(
        worker,
        "get_track_genre_slugs",
        lambda uids: {OUTGOING_UID: "techno", INCOMING_UID: "minimal-techno"},
    )
    monkeypatch.setattr(worker, "resume_action", resume)
    monkeypatch.setattr(worker, "execute_structured", execute)
    monkeypatch.setattr(
        worker,
        "set_smart_mix_refined_plan_caches",
        lambda entries, **kwargs: state.cached.update(entries),
    )
    monkeypatch.setattr(
        worker,
        "delete_smart_mix_refined_plan_caches",
        lambda keys: state.deleted.extend(keys),
    )
    monkeypatch.setattr(
        worker,
        "mark_budget_exhausted",
        lambda fingerprint: state.budget.append(fingerprint),
    )
    return state


def _run(params, task_id="task-1"):
    return worker._handle_smart_mix_refine_transition(task_id, params, {})


def test_ready_on_valid_response(env):
    params = _params()

    result = _run(params)

    assert result == {"status": "ready", "candidate_index": 1, "code": None}
    [(action_id, model, call)] = env.calls
    assert action_id == REFINE_ACTION and model is SmartMixRefinementResponse
    assert call["job_id"] == "task-1" and call["actor_id"] == 5
    [row] = env.saved
    key = params["refinement_key"]
    assert row["refinement_key"] == key
    assert row["status"] == "ready" and row["outcome_code"] is None
    assert row["planner_identifier"] == "smart-mix-v3"
    assert row["prompt_version"] == "sm3-refine-1"
    assert row["config_fingerprint"] == FINGERPRINT
    assert row["model_label"] == "qwen3.8:27b"
    assert row["invocation_id"] == "1b4e28ba-2fa1-11d2-883f-0016d3cca427"
    assert row["plan"]["outgoingTrackEntityUid"] == OUTGOING_UID
    assert row["reason"] == REASON and row["confidence"] == 0.82
    assert row["latency_ms"] >= 0
    assert env.cached[key]["status"] == "ready"
    assert env.cached[key]["plan"] == row["plan"]
    assert env.cached[key]["candidateIndex"] == 1
    # The genre went in, as Settings allow it.
    assert '"genre":"minimal-techno"' in env.prompts[0]

    # A redelivered task finds the stored refinement and pays nothing.
    env.stored = {key: {**row, "plan": row["plan"]}}
    assert _run(params)["status"] == "skipped"
    assert len(env.calls) == 1


def test_rejected_on_invalid_response(env):
    env.answer = _answer(candidate_index=3, confidence=0.3)

    result = _run(_params())

    assert result == {
        "status": "rejected",
        "candidate_index": 3,
        "code": "low_confidence",
    }
    [row] = env.saved
    assert row["status"] == "rejected" and row["plan"] is None
    assert row["outcome_code"] == "low_confidence"
    assert row["reason"] == REASON

    env.saved.clear()
    env.error = AIConfigurationError("AI_RESPONSE_INVALID", "invalid")
    assert _run(_params())["code"] == "response_invalid"
    assert env.saved[0]["status"] == "rejected"


def test_failed_on_transport_error_without_retry(env):
    from crate.actors import TASK_POOL_CONFIG

    env.error = AIConfigurationError("AI_PROVIDER_TIMEOUT", "timeout")
    params = _params()

    result = _run(params)

    assert result["status"] == "failed"
    assert result["error"] == "AI_PROVIDER_TIMEOUT"
    assert len(env.calls) == 1
    [row] = env.saved
    assert (row["status"], row["outcome_code"]) == ("failed", "AI_PROVIDER_TIMEOUT")
    assert env.cached[params["refinement_key"]]["status"] == "failed"
    assert TASK_POOL_CONFIG["smart_mix_refine_transition"].max_retries == 0


def test_stale_when_profile_revision_changed(env):
    env.profiles = _profiles(revision="profile-v2")
    params = _params()

    assert _run(params) == {"status": "stale"}
    assert env.calls == [] and env.saved == []
    assert env.deleted == [params["refinement_key"]]

    # So is a configuration that changed after the request accepted it.
    env.profiles = _profiles()
    stale = _params(ai_acceptance={"action_id": REFINE_ACTION, "fingerprint": "d" * 64})
    result = _run(stale)
    assert result["status"] == "unavailable"
    assert result["error_code"] == "AI_CONTEXT_STALE"
    assert env.calls == [] and env.saved == []


def test_budget_refusal_marks_unavailable(env):
    env.error = AIConfigurationError("AI_DAILY_TOKEN_LIMIT", "budget")
    params = _params()

    result = _run(params)

    assert result == {"status": "unavailable", "error_code": "AI_DAILY_TOKEN_LIMIT"}
    assert env.budget == [FINGERPRINT]
    # Nothing is stored: once the budget resets the edge is refined.
    assert env.saved == []
    assert env.cached == {}
    assert env.deleted == [params["refinement_key"]]


def test_single_candidate_menu_is_not_sent(env):
    params = _params(context={**CONTEXT, "source": "album"})

    result = _run(params)

    assert result == {
        "status": "rejected",
        "candidate_index": None,
        "code": "single_candidate",
    }
    assert env.calls == []
    assert env.saved[0]["outcome_code"] == "single_candidate"


def test_never_logs_prompt_or_response(env, caplog):
    caplog.set_level(logging.DEBUG)
    results = [_run(_params())]
    env.error = AIConfigurationError("AI_PROVIDER_FAILED", "Provider request failed")
    results.append(_run(_params()))
    # An unexpected error is contained too: an error tracker could otherwise
    # capture the frame that holds the prompt.
    env.error = RuntimeError("boom")
    results.append(_run(_params()))
    assert results[-1] == {"status": "failed", "error": "SMART_MIX_REFINEMENT_FAILED"}

    prompt = env.prompts[0]
    logged = "\n".join(
        f"{record.getMessage()} {record.exc_text or ''}" for record in caplog.records
    )
    for secret in (
        REASON,
        "secret note from the model",
        prompt,
        prompt[:80],
        '"phrases"',
        "minimal-techno",
    ):
        assert secret not in logged
        assert all(secret not in str(result) for result in results)


def test_cleanup_touches_reads_then_deletes_unread(monkeypatch):
    reads = [["a", "b"], ["c"], []]
    touched, deleted = [], [5000, 12]
    monkeypatch.setattr(
        worker, "pop_smart_mix_refinement_reads", lambda count: reads.pop(0)
    )
    monkeypatch.setattr(worker, "touch", lambda keys: touched.append(keys) or len(keys))
    monkeypatch.setattr(
        worker,
        "cleanup_unread_refinements",
        lambda *, older_than_days, limit: deleted.pop(0),
    )
    monkeypatch.setattr(worker, "is_cancelled", lambda task_id: False)

    result = worker._handle_cleanup_smart_mix_refinements("task-9", {}, {})

    # Reads are recorded first, so nothing read since the last run is deleted.
    assert touched == [["a", "b"], ["c"]]
    assert result == {"touched": 3, "deleted": 5012}


def test_cleanup_is_scheduled_daily_on_maintenance():
    from crate.actors import TASK_POOL_CONFIG
    from crate.scheduler import DEFAULT_SCHEDULES

    config = TASK_POOL_CONFIG["cleanup_smart_mix_refinements"]
    assert (config.queue, config.priority, config.max_retries) == ("maintenance", 3, 0)
    assert config.time_limit_seconds == 600
    assert DEFAULT_SCHEDULES["cleanup_smart_mix_refinements"] == 86400

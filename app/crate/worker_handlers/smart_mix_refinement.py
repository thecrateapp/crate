"""Smart Mix transition refinement in the `ai` lane (SM4.PR2, SM3-D4).

`smart_mix_refine_transition` makes at most one model call per refinement key:

1. A key already stored is served from the table; nothing is paid again.
2. The profiles are read again: a changed revision ends the task as `stale`
   (the API keys the new revision itself).
3. `resume_action` re-checks the accepted configuration and the actor; the key
   is recomputed with it, so the result is stored under the identity it paid for.
4. The candidate menu is rebuilt, the numeric input built and sent with
   `execute_structured`, and `apply_refinement` validates the answer.
5. The outcome is stored (`ready`, `rejected` or `failed`) and cached.

A refusal before anything is sent (budget, configuration, authority) stores
nothing, so the edge can be refined once the cause clears. Nothing logs or
returns the prompt or the answer; unexpected errors are contained and reported
by type only, so no error tracker captures a frame that holds them.
"""

from __future__ import annotations

import logging
import time
from typing import Any

from crate.ai.consumers import resume_action
from crate.ai.contracts import AIConfigurationError
from crate.ai.runtime import execute_structured
from crate.db.cache_store import (
    delete_smart_mix_refined_plan_caches,
    pop_smart_mix_refinement_reads,
    set_smart_mix_refined_plan_caches,
)
from crate.db.queries.smart_mix_refinement import get_track_genre_slugs
from crate.db.repositories.smart_mix import get_track_mix_profiles_by_entity_uids
from crate.db.repositories.smart_mix_refinements import (
    cleanup_unread_refinements,
    get_many,
    save,
    touch,
)
from crate.genre_taxonomy import resolve_genre_slug
from crate.llm.prompts.smart_mix_transition import (
    PROMPT_VERSION,
    SYSTEM_PROMPT,
    SmartMixRefinementResponse,
    build_refinement_input,
    render_refinement_prompt,
)
from crate.smart_mix.candidates import plan_transition_candidates
from crate.smart_mix.policy import PLANNER_POLICY_V3
from crate.smart_mix.refinement import (
    RefinementOutcome,
    apply_refinement,
    context_from_payload,
    deterministic_plan_hash,
)
from crate.worker_handlers import is_cancelled
from crate.smart_mix_ai import (
    REFINE_ACTION,
    edge_refinement_key,
    mark_budget_exhausted,
    refined_cache_entry,
)

log = logging.getLogger(__name__)

POLICY = PLANNER_POLICY_V3
# Refused before anything was sent: nothing is stored.
BUDGET_CODES = frozenset({"AI_DAILY_CALL_LIMIT", "AI_DAILY_TOKEN_LIMIT"})
# The call went out (or this input can never fit the profile): stored as failed.
FAILED_CODES = frozenset(
    {"AI_PROVIDER_FAILED", "AI_PROVIDER_TIMEOUT", "AI_INPUT_TOO_LARGE"}
)
UNEXPECTED_ERROR = "SMART_MIX_REFINEMENT_FAILED"


def _handle_smart_mix_refine_transition(
    task_id: str, params: dict, config: dict
) -> dict:
    del config
    try:
        key = str(params["refinement_key"])
        outgoing_uid = str(params["outgoing_track_entity_uid"])
        incoming_uid = str(params["incoming_track_entity_uid"])
        revisions = (
            str(params["outgoing_profile_revision"]),
            str(params["incoming_profile_revision"]),
        )
        context_payload = dict(params["context"])
        context = context_from_payload(context_payload)
        send_genre = bool(params.get("send_genre", True))
    except (KeyError, TypeError, ValueError):
        return {"status": "failed", "error": "Invalid refinement task parameters"}

    stored = get_many([key]).get(key)
    if stored is not None:
        set_smart_mix_refined_plan_caches({key: refined_cache_entry(stored)})
        return {"status": "skipped", "reason": "stored"}

    outgoing, incoming = get_track_mix_profiles_by_entity_uids(
        [outgoing_uid, incoming_uid], include_structure=True
    )
    if (
        outgoing is None
        or incoming is None
        or (outgoing.profile_revision, incoming.profile_revision) != revisions
    ):
        delete_smart_mix_refined_plan_caches([key])
        return {"status": "stale"}

    try:
        call = resume_action(
            REFINE_ACTION,
            params.get("ai_acceptance"),
            actor_id=params.get("actor_user_id"),
            job_id=task_id,
        )
    except AIConfigurationError as error:
        delete_smart_mix_refined_plan_caches([key])
        return {"status": "unavailable", "error_code": error.code}
    fingerprint = str(call["context"]["config_fingerprint"])
    if key != edge_refinement_key(
        outgoing_track_entity_uid=outgoing_uid,
        incoming_track_entity_uid=incoming_uid,
        outgoing_profile_revision=revisions[0],
        incoming_profile_revision=revisions[1],
        context=context_payload,
        config_fingerprint=fingerprint,
        send_genre=send_genre,
    ):
        delete_smart_mix_refined_plan_caches([key])
        return {"status": "stale"}

    row: dict[str, Any] = {
        "refinement_key": key,
        "from_entity_uid": outgoing_uid,
        "to_entity_uid": incoming_uid,
        "from_profile_revision": revisions[0],
        "to_profile_revision": revisions[1],
        "planner_identifier": POLICY.identifier,
        "rules_revision": POLICY.rules_revision,
        "prompt_version": PROMPT_VERSION,
        "config_fingerprint": fingerprint,
        "model_label": call["context"].get("model_id"),
    }
    try:
        return _refine(row, call, outgoing, incoming, context, params, send_genre)
    except Exception as error:
        # Never let the prompt or answer reach a log or an error tracker.
        log.warning(
            "Smart Mix refinement %s failed (%s)", key[:12], type(error).__name__
        )
        delete_smart_mix_refined_plan_caches([key])
        return {"status": "failed", "error": UNEXPECTED_ERROR}


def _refine(row, call, outgoing, incoming, context, params, send_genre) -> dict:
    key = row["refinement_key"]
    candidates = plan_transition_candidates(
        outgoing,
        incoming,
        context,
        POLICY,
        outgoing_track_entity_uid=row["from_entity_uid"],
        incoming_track_entity_uid=row["to_entity_uid"],
    )
    row["deterministic_plan_hash"] = deterministic_plan_hash(candidates)
    if len(candidates) < 2:
        return _store(row, status="rejected", code="single_candidate")
    genres = (
        _genres(row["from_entity_uid"], row["to_entity_uid"])
        if send_genre
        else (None, None)
    )
    prompt = render_refinement_prompt(
        build_refinement_input(
            outgoing,
            incoming,
            candidates,
            policy=POLICY,
            context=context,
            genres=genres,
            send_genre=send_genre,
            set_history=params["context"].get("setHistory") or (),
        )
    )
    started = time.monotonic()
    try:
        response = execute_structured(
            REFINE_ACTION,
            SmartMixRefinementResponse,
            prompt,
            system=SYSTEM_PROMPT,
            **call,
        )
    except AIConfigurationError as error:
        row["latency_ms"] = _elapsed_ms(started)
        if error.code in BUDGET_CODES:
            mark_budget_exhausted(row["config_fingerprint"])
            delete_smart_mix_refined_plan_caches([key])
            return {"status": "unavailable", "error_code": error.code}
        if error.code == "AI_RESPONSE_INVALID":
            return _store(row, status="rejected", code="response_invalid")
        if error.code in FAILED_CODES:
            _store(row, status="failed", code=error.code)
            return {"status": "failed", "error": error.code}
        delete_smart_mix_refined_plan_caches([key])
        return {"status": "unavailable", "error_code": error.code}
    row["latency_ms"] = _elapsed_ms(started)
    row["model_label"] = getattr(response, "_ai_model_id", None) or row["model_label"]
    row["invocation_id"] = getattr(response, "_ai_invocation_id", None)
    outcome = apply_refinement(
        candidates, response, (outgoing, incoming), POLICY, context=context
    )
    return _store(row, outcome=outcome)


def _store(
    row: dict[str, Any],
    *,
    status: str | None = None,
    code: str | None = None,
    outcome: RefinementOutcome | None = None,
) -> dict:
    if outcome is not None:
        status, code = outcome.status, outcome.code
        row.update(
            candidate_index=outcome.candidate_index,
            adjustments=outcome.adjustments,
            plan=None if outcome.plan is None else outcome.plan.to_dict(),
            reason=outcome.reason,
            confidence=outcome.confidence,
        )
    row.update(status=status, outcome_code=code)
    for field in ("candidate_index", "adjustments", "plan", "reason", "confidence"):
        row.setdefault(field, None)
    row.setdefault("latency_ms", None)
    row.setdefault("invocation_id", None)
    save(row)
    set_smart_mix_refined_plan_caches({row["refinement_key"]: refined_cache_entry(row)})
    log.info(
        "Smart Mix refinement %s %s%s",
        row["refinement_key"][:12],
        status,
        f" ({code})" if code else "",
    )
    return {
        "status": status,
        "candidate_index": row["candidate_index"],
        "code": code,
    }


def _genres(outgoing_uid: str, incoming_uid: str) -> tuple[str | None, str | None]:
    slugs = get_track_genre_slugs([outgoing_uid, incoming_uid])

    def canonical(uid: str) -> str | None:
        slug = slugs.get(uid)
        return (resolve_genre_slug(slug) or slug) if slug else None

    return canonical(outgoing_uid), canonical(incoming_uid)


def _elapsed_ms(started: float) -> int:
    return max(0, round((time.monotonic() - started) * 1000))


# Retention (SM3-D5): refinements unread for this long are deleted.
RETENTION_DAYS = 180
_READS_BATCH = 1000
_CLEANUP_BATCH = 5000


def _handle_cleanup_smart_mix_refinements(
    task_id: str, params: dict, config: dict
) -> dict:
    """Record the reads the plan API queued, then delete unread refinements."""
    del params, config
    touched = 0
    while keys := pop_smart_mix_refinement_reads(_READS_BATCH):
        touched += touch(keys)
        if is_cancelled(task_id):
            return {"touched": touched, "deleted": 0, "cancelled": True}
    deleted = 0
    while True:
        batch = cleanup_unread_refinements(
            older_than_days=RETENTION_DAYS, limit=_CLEANUP_BATCH
        )
        deleted += batch
        if batch < _CLEANUP_BATCH or is_cancelled(task_id):
            break
    return {"touched": touched, "deleted": deleted}


SMART_MIX_REFINEMENT_TASK_HANDLERS = {
    "smart_mix_refine_transition": _handle_smart_mix_refine_transition,
    "cleanup_smart_mix_refinements": _handle_cleanup_smart_mix_refinements,
}

__all__ = ["SMART_MIX_REFINEMENT_TASK_HANDLERS"]

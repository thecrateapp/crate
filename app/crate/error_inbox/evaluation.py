"""Evaluate the AI triage against labelled issues without storing a triage (gate EG2).

The maintainer's tool, `tools/error-inbox-eval/run_eval.py`, never calls a model and
never sees a digest. It runs `crate.error_inbox.evaluation_cli` inside the worker
container, and that CLI only reads, queues and collects:

1. `plan_evaluation`: which of the given short ids have a stored digest, about how
   large each request is and which model the `ops.error.triage` binding points at.
2. `queue_evaluation`: pins the binding the plan showed (`accept_action` plus the
   fingerprint the plan returned) and queues one `evaluate_error_triage` task on the
   `ai_bulk` lane.
3. `evaluation_result`: the task's per-issue answers and the token usage of its
   calls, from `ai_invocations`.

The task body, `run_evaluation`, makes the calls. For each issue it builds exactly
the request `triage_issue` builds (`build_request`) and validates the answer the
same way (`check_output`), but it saves nothing to `error_issue_triage` and ignores
any triage already stored, so an evaluation never changes the inbox and can be run
again with another model. It keeps only the closed fields of each answer:
classification, severity, `duplicate_of` (a candidate's short id) and confidence.
The summary, hypothesis and next step are free text that can echo event content, so
they are dropped. The reference labels never leave the maintainer's machine; only
short ids reach the server.

Each call has its own idempotency key, `eval:<task id>:<short id>`, so a redelivered
task never pays twice for an issue. The handler that names the structured executor
lives in `crate.worker_handlers.error_inbox`; nothing here calls a model on its own.
"""

from __future__ import annotations

import logging
import re
from collections import Counter
from collections.abc import Callable, Iterable, Mapping
from typing import Any

from crate.ai.consumers import accept_action, resume_action
from crate.ai.contracts import AIConfigurationError
from crate.ai.runtime import action_availability, estimated_input_tokens
from crate.db.queries.error_issues import get_triage_input, issue_ids_by_short_id
from crate.error_inbox.priority import CRITICAL_TRIAGE_CONFIDENCE
from crate.error_inbox.triage import (
    INVALID_OUTPUT_CODE,
    StructuredExecutor,
    build_request,
)
from crate.llm.prompts.error_triage import candidate_ids, check_output

log = logging.getLogger(__name__)

EVAL_TASK = "evaluate_error_triage"
EVAL_ACTION = "ops.error.triage"
MAX_EVAL_ISSUES = 100
SHORT_ID = re.compile(r"[A-Z0-9][A-Z0-9_-]{0,62}-[A-Z0-9]+")
SKIP_REASONS = frozenset({"not_in_inbox", "no_digest", "over_input_limit"})
ITEM_FAILED_CODE = "EVAL_ITEM_FAILED"

Progress = Callable[[int, int, str], None]


def normalise_short_ids(values: Any) -> list[str]:
    """Upper-case, unique short ids in the given order, or ValueError.

    At most `MAX_EVAL_ISSUES`; each must look like a Sentry short id
    (`CRATE-LISTEN-1A`), at most 64 characters.
    """
    if not isinstance(values, list) or len(values) > MAX_EVAL_ISSUES:
        raise ValueError(f"Expected a list of at most {MAX_EVAL_ISSUES} short ids")
    ids: list[str] = []
    for value in values:
        if not isinstance(value, str) or len(value) > 64:
            raise ValueError("Invalid short id")
        short_id = value.strip().upper()
        if not SHORT_ID.fullmatch(short_id):
            raise ValueError("Invalid short id")
        ids.append(short_id)
    return list(dict.fromkeys(ids))


def _skipped(values: Any) -> list[dict[str, str]]:
    if values is None:
        return []
    if not isinstance(values, list) or len(values) > MAX_EVAL_ISSUES:
        raise ValueError("Invalid skipped list")
    skipped = []
    for value in values:
        if not isinstance(value, Mapping) or value.get("reason") not in SKIP_REASONS:
            raise ValueError("Invalid skipped issue")
        [short_id] = normalise_short_ids([value.get("short_id")])
        skipped.append({"short_id": short_id, "reason": str(value["reason"])})
    return skipped


def _limits(config: Mapping[str, Any] | None) -> dict[str, int | None]:
    config = config if isinstance(config, Mapping) else {}

    def number(key: str) -> int | None:
        value = config.get(key)
        return value if type(value) is int else None

    return {
        "max_input_tokens": number("max_input_tokens"),
        "max_output_tokens": number("max_output_tokens"),
        "timeout_seconds": number("timeout_seconds"),
    }


def _model(context: Mapping[str, Any]) -> dict[str, Any]:
    """Who answers: provider, model and profile identity, never credentials."""
    return {
        "mode": context.get("mode"),
        "provider": context.get("provider"),
        "model_id": context.get("model_id"),
        "profile_id": context.get("profile_id"),
        "profile_version": context.get("profile_version"),
        "limits": _limits(context.get("config")),
    }


def _binding() -> dict[str, Any]:
    """The current binding of `ops.error.triage`, read-only (nothing is accepted)."""
    from crate.ai.configuration import get_action_configuration

    availability = action_availability(EVAL_ACTION)
    binding: dict[str, Any] = {
        "action_id": EVAL_ACTION,
        "available": bool(availability["available"]),
        "status": availability["status"],
        "error_code": availability["error_code"],
        "fingerprint": availability["fingerprint"],
        "provider": availability["provider"],
        "model_id": availability["model_id"],
        "profile_id": None,
        "profile_version": None,
        "limits": _limits(None),
    }
    if binding["available"]:
        try:
            context = get_action_configuration(EVAL_ACTION)
        except AIConfigurationError as error:
            binding.update(available=False, error_code=error.code)
        else:
            binding.update(
                {k: v for k, v in _model(context).items() if k not in {"mode"}}
            )
    return binding


def _request_size(data: Mapping[str, Any]) -> dict[str, Any]:
    digest = data["digest"]
    candidates = candidate_ids(data["candidates"])
    frame_count = len(digest.get("frames") or [])
    system, response_model, prompt = build_request(
        "triage", data, candidates, frame_count
    )
    return {
        "estimated_input_tokens": estimated_input_tokens(
            prompt, system, response_model.model_json_schema()
        ),
        "candidates": len(candidates),
        "frames": frame_count,
    }


def _input(issue_id: str | None) -> tuple[Mapping | None, str | None]:
    """The triage input of one issue, or why it cannot be evaluated."""
    data = get_triage_input(issue_id) if issue_id else None
    if data is None:
        return None, "not_in_inbox"
    if not isinstance(data.get("digest"), Mapping) or not data.get("digest_hash"):
        return None, "no_digest"
    return data, None


def plan_evaluation(short_ids: Any) -> dict[str, Any]:
    """What an evaluation of these issues would send, without sending anything.

    Each item is `ready` (one call) or `skipped` with a reason: `not_in_inbox`,
    `no_digest`, or `over_input_limit` when the request is larger than the bound
    profile accepts (the call would fail before anything is sent). Items carry sizes
    and counts only, never digest content. `calls` is the number of ready items.
    """
    ids = normalise_short_ids(short_ids)
    binding = _binding()
    limit = binding["limits"]["max_input_tokens"]
    found = issue_ids_by_short_id(ids)
    items: list[dict[str, Any]] = []
    for short_id in ids:
        data, reason = _input(found.get(short_id))
        if data is None:
            items.append({"short_id": short_id, "status": "skipped", "reason": reason})
            continue
        size = _request_size(data)
        if limit is not None and size["estimated_input_tokens"] > limit:
            items.append(
                {
                    "short_id": short_id,
                    "status": "skipped",
                    "reason": "over_input_limit",
                    **size,
                }
            )
            continue
        items.append({"short_id": short_id, "status": "ready", **size})
    return {
        **binding,
        "items": items,
        "calls": sum(item["status"] == "ready" for item in items),
        "max_issues": MAX_EVAL_ISSUES,
    }


def _active_evaluation() -> str | None:
    from crate.db.queries.tasks import list_tasks

    for status in ("running", "pending"):
        rows = list_tasks(status=status, task_type=EVAL_TASK, limit=1)
        if rows:
            return str(rows[0]["id"])
    return None


def queue_evaluation(
    short_ids: Any,
    *,
    expected_fingerprint: Any,
    skipped: Any = None,
    actor_id: int | None = None,
) -> dict[str, Any]:
    """Queue one `evaluate_error_triage` task for the given (ready) short ids.

    The binding is accepted now and must still be the one the plan showed
    (`expected_fingerprint`), otherwise `AI_CONTEXT_STALE` and nothing is queued.
    One evaluation runs at a time: while another is pending or running, its task id
    comes back with `deduplicated: true`.
    """
    from crate.db.repositories.tasks import create_task_dedup

    ids = normalise_short_ids(short_ids)
    if not ids:
        raise ValueError("Nothing to evaluate")
    if not isinstance(expected_fingerprint, str) or not expected_fingerprint:
        raise ValueError("The plan's binding fingerprint is required")
    acceptance = accept_action(EVAL_ACTION)
    if acceptance["fingerprint"] != expected_fingerprint:
        raise AIConfigurationError(
            "AI_CONTEXT_STALE",
            "The triage binding changed after the plan; plan again before running",
        )
    task_id = create_task_dedup(
        EVAL_TASK,
        {
            "short_ids": ids,
            "skipped": _skipped(skipped),
            "ai_acceptance": acceptance,
            "actor_user_id": actor_id,
        },
        dedup_key=EVAL_TASK,
        origin="admin",
        actor_user_id=actor_id,
    )
    if task_id is None:
        return {"task_id": _active_evaluation(), "deduplicated": True}
    return {"task_id": task_id, "deduplicated": False, "calls": len(ids)}


def evaluate_issue(
    short_id: str,
    issue_id: str | None,
    *,
    execute: StructuredExecutor,
    context: dict,
    job_id: str,
    actor_id: int | None = None,
) -> dict[str, Any]:
    """Triage one issue's current digest and keep only the closed answer.

    The answer is validated like `triage_issue` validates it and never saved.
    """
    data, reason = _input(issue_id)
    if data is None:
        return {"short_id": short_id, "status": "skipped", "reason": reason}
    digest = data["digest"]
    candidates = candidate_ids(data["candidates"])
    frame_count = len(digest.get("frames") or [])
    base: dict[str, Any] = {
        "short_id": short_id,
        "candidate_ids": candidates,
        "frames": frame_count,
    }
    system, response_model, prompt = build_request(
        "triage", data, candidates, frame_count
    )
    try:
        result = execute(
            EVAL_ACTION,
            response_model,
            prompt,
            system=system,
            context=context,
            actor_id=actor_id,
            job_id=job_id,
            idempotency_key=f"eval:{job_id}:{short_id}",
        )
        check_output(result, candidates=candidates, frame_count=frame_count)
    except AIConfigurationError as error:
        status = "invalid_output" if error.code == INVALID_OUTPUT_CODE else "failed"
        return {**base, "status": status, "error_code": error.code}
    except ValueError:
        return {**base, "status": "invalid_output", "error_code": INVALID_OUTPUT_CODE}
    return {
        **base,
        "status": "ok",
        "prediction": {
            "classification": result.classification,
            "severity": result.severity,
            "duplicate_of": result.duplicate_of,
            "confidence": round(float(result.confidence), 3),
        },
        "invocation_id": getattr(result, "_ai_invocation_id", None),
    }


def _request(params: Mapping[str, Any]) -> tuple[list[str], list, Mapping, int | None]:
    ids = normalise_short_ids(params.get("short_ids"))
    acceptance = params.get("ai_acceptance")
    actor_id = params.get("actor_user_id")
    if (
        not ids
        or not isinstance(acceptance, Mapping)
        or isinstance(actor_id, bool)
        or (actor_id is not None and not isinstance(actor_id, int))
    ):
        raise ValueError("Invalid evaluation request")
    return ids, _skipped(params.get("skipped")), acceptance, actor_id


def _counts(items: Iterable[Mapping[str, Any]]) -> dict[str, int]:
    counts = Counter(str(item["status"]) for item in items)
    return {
        status: counts.get(status, 0)
        for status in ("ok", "invalid_output", "failed", "skipped", "not_run")
    }


def run_evaluation(
    task_id: str,
    params: Mapping[str, Any],
    *,
    execute: StructuredExecutor,
    cancelled: Callable[[], bool] = lambda: False,
    progress: Progress | None = None,
) -> dict[str, Any]:
    """The `evaluate_error_triage` task: one validated call per issue, nothing saved.

    A cancellation stops before the next issue; the rest are `not_run` and the
    answers already paid for stay in the result. Per-issue failures (invalid
    output, provider errors, an exhausted task budget) are recorded on the item and
    the run goes on.
    """
    try:
        ids, skipped, acceptance, actor_id = _request(params)
    except ValueError:
        return {
            "status": "failed",
            "error_code": "ERROR_TRIAGE_EVAL_INVALID_REQUEST",
            "error": "Invalid evaluation request",
        }
    try:
        call = resume_action(
            EVAL_ACTION, dict(acceptance), actor_id=actor_id, job_id=task_id
        )
    except AIConfigurationError as error:
        return {
            "status": "failed",
            "error_code": error.code,
            "error": "The triage binding is not usable; plan and queue again.",
            "expected": True,
        }
    context = call["context"]
    found = issue_ids_by_short_id(ids)
    items: list[dict[str, Any]] = []
    stopped = False
    for index, short_id in enumerate(ids):
        if stopped or cancelled():
            stopped = True
            items.append(
                {"short_id": short_id, "status": "not_run", "reason": "cancelled"}
            )
            continue
        if progress is not None:
            progress(index, len(ids), short_id)
        try:
            item = evaluate_issue(
                short_id,
                found.get(short_id),
                execute=execute,
                context=context,
                job_id=task_id,
                actor_id=actor_id,
            )
        except Exception:  # noqa: BLE001 — one issue must not discard the paid answers.
            log.warning("Triage evaluation of %s failed", short_id, exc_info=True)
            item = {
                "short_id": short_id,
                "status": "failed",
                "error_code": ITEM_FAILED_CODE,
            }
        items.append(item)
    if progress is not None:
        progress(len(ids), len(ids), "")
    return {
        "status": "completed",
        "action_id": EVAL_ACTION,
        "model": _model(context),
        "critical_confidence": CRITICAL_TRIAGE_CONFIDENCE,
        "items": items,
        "skipped": skipped,
        "counts": _counts(items),
        "cancelled": stopped,
    }


_TERMINAL = frozenset({"completed", "failed", "cancelled"})
_USAGE_FIELDS = (
    "status",
    "error_code",
    "model_id",
    "reported_model",
    "usage_known",
    "input_tokens",
    "cached_input_tokens",
    "output_tokens",
    "thought_tokens",
    "total_tokens",
    "reserved_tokens",
    "charged_tokens",
    "duration_ms",
)


def _invocations(task_id: str) -> list[dict[str, Any]]:
    """Token usage of the task's calls, keyed back to the short id it evaluated."""
    from crate.db.repositories.ai_usage import list_invocations

    marker = f":eval:{task_id}:"
    rows: list[dict[str, Any]] = []
    cursor = None
    for _ in range(10):
        page = list_invocations(
            {"job_id": task_id, "action_id": EVAL_ACTION}, limit=200, cursor=cursor
        )
        for row in page["items"]:
            key = str(row.get("idempotency_key") or "")
            short_id = key.split(marker, 1)[1] if marker in key else None
            rows.append(
                {"short_id": short_id, **{k: row.get(k) for k in _USAGE_FIELDS}}
            )
        cursor = page["next_cursor"]
        if not cursor:
            break
    return rows


def _safe_result(result: Any) -> dict[str, Any] | None:
    """The task result without anything but the evaluation's own closed fields."""
    if not isinstance(result, Mapping):
        return None
    allowed = {
        "status",
        "error_code",
        "action_id",
        "model",
        "critical_confidence",
        "items",
        "skipped",
        "counts",
        "cancelled",
    }
    return {key: result[key] for key in allowed if key in result}


def evaluation_result(task_id: Any) -> dict[str, Any]:
    """The state of one evaluation task and, once it ended, its answers and usage."""
    from crate.db.queries.tasks import get_task

    if not isinstance(task_id, str) or not 0 < len(task_id) <= 200:
        raise ValueError("Invalid task id")
    task = get_task(task_id)
    if task is None or task.get("type") != EVAL_TASK:
        raise ValueError("Unknown evaluation task")
    status = str(task.get("status"))
    finished = status in _TERMINAL
    return {
        "task_id": task_id,
        "status": status,
        "finished": finished,
        "progress": task.get("progress") if not finished else None,
        "created_at": task.get("created_at"),
        "started_at": task.get("started_at"),
        "updated_at": task.get("updated_at"),
        "result": _safe_result(task.get("result")) if finished else None,
        "invocations": _invocations(task_id) if finished else [],
    }


__all__ = [
    "EVAL_ACTION",
    "EVAL_TASK",
    "MAX_EVAL_ISSUES",
    "SKIP_REASONS",
    "evaluate_issue",
    "evaluation_result",
    "normalise_short_ids",
    "plan_evaluation",
    "queue_evaluation",
    "run_evaluation",
]

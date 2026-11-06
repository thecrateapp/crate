"""AI triage and investigation of one error issue (`ops.error.triage`, `ops.error.investigate`).

`triage_issue` loads the issue's digest and at most ten duplicate candidates (same
`group_key` or same main exception type), makes one structured call and stores the
validated result in `error_issue_triage`. Nothing else is stored: not the prompt and
not the raw response. Output outside the closed schema, a `duplicate_of` outside
the candidates or a frame index outside the digest fail the call as
`AI_RESPONSE_INVALID`, and nothing is saved.

One result per issue, kind and digest: an existing result is returned without a
call. The call's idempotency key keeps a redelivered task from paying twice:

- without `attempt` (automatic triage) it is `issue_id:kind:digest_hash`, so a
  digest is sent at most once, whether its call succeeded or failed;
- with `attempt` (a person's Investigate or Triage backlog, keyed by the task id) it
  is `issue_id:kind:digest_hash:attempt`, so a person can retry a digest whose
  earlier call failed. Only a saved result counts as done.

An input larger than the profile allows (AI_INPUT_TOO_LARGE) is refused before
anything is reserved; the outcome then carries the size the call needed and the
profile's limit, so the task can say which setting to raise. The digest is never
trimmed to fit.

The caller passes the structured executor (`crate.ai.runtime.execute_structured`).
Only an AI-lane task handler may do that: naming the executor makes the handler the
root of the model-calling chain that `tests/test_ai_architecture.py` checks, and the
executor itself refuses to run outside an AI-lane task.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import asdict, dataclass
from typing import Any, Literal, Protocol, TypeVar

from crate.ai.contracts import AIConfigurationError
from crate.ai.runtime import action_availability, estimated_input_tokens
from crate.db.queries.error_issues import get_triage_input
from crate.db.repositories.error_issues import save_triage
from crate.llm.prompts.error_investigate import (
    INVESTIGATION_SYSTEM_PROMPT,
    ErrorInvestigationResponse,
    build_investigation_prompt,
)
from crate.llm.prompts.error_triage import (
    TRIAGE_SYSTEM_PROMPT,
    ErrorAssessment,
    ErrorTriageResponse,
    bind_response_model,
    build_triage_prompt,
    candidate_ids,
    check_output,
)

TriageKind = Literal["triage", "investigation"]
TriageStatus = Literal[
    "saved",
    "existing",
    "not_found",
    "no_digest",
    "unavailable",
    "invalid_output",
    "failed",
]

ACTION_BY_KIND: dict[str, str] = {
    "triage": "ops.error.triage",
    "investigation": "ops.error.investigate",
}
INVALID_OUTPUT_CODE = "AI_RESPONSE_INVALID"
INPUT_TOO_LARGE_CODE = "AI_INPUT_TOO_LARGE"

# Reads extra evidence for an investigation from the triage input (Sentry counts).
EvidenceReader = Callable[[Mapping[str, Any]], Mapping[str, Any] | None]

T = TypeVar("T", bound=ErrorAssessment)


class StructuredExecutor(Protocol):
    """The subset of `crate.ai.runtime.execute_structured` the triage uses."""

    def __call__(
        self,
        action_id: str,
        response_model: type[T],
        prompt: str,
        /,
        *,
        system: str = ...,
        context: dict | None = ...,
        actor_id: int | None = ...,
        job_id: str | None = ...,
        idempotency_key: str | None = ...,
    ) -> T: ...


@dataclass(frozen=True)
class TriageOutcome:
    status: TriageStatus
    kind: str
    issue_id: str
    digest_hash: str | None = None
    triage_id: str | None = None
    error_code: str | None = None
    # AI_INPUT_TOO_LARGE: the tokens the call needed and the profile's limit.
    input_tokens: int | None = None
    input_limit: int | None = None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def idempotency_key(
    issue_id: str, kind: str, digest_hash: str, attempt: str | None = None
) -> str:
    key = f"{issue_id}:{kind}:{digest_hash}"
    return f"{key}:{attempt}" if attempt else key


def _input_limit(context: Mapping[str, Any] | None) -> int | None:
    config = (context or {}).get("config")
    value = config.get("max_input_tokens") if isinstance(config, Mapping) else None
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _request(
    kind: str,
    data: Mapping[str, Any],
    candidates: list[str],
    frame_count: int,
    evidence: Mapping[str, Any] | None = None,
) -> tuple[str, type[ErrorTriageResponse] | type[ErrorInvestigationResponse], str]:
    digest = data["digest"]
    if kind == "investigation":
        prompt = build_investigation_prompt(
            data,
            digest,
            data["candidates"],
            current_triage=data.get("current_triage"),
            evidence=evidence,
        )
        model = bind_response_model(
            ErrorInvestigationResponse, candidates=candidates, frame_count=frame_count
        )
        return INVESTIGATION_SYSTEM_PROMPT, model, prompt
    prompt = build_triage_prompt(data, digest, data["candidates"])
    return (
        TRIAGE_SYSTEM_PROMPT,
        bind_response_model(
            ErrorTriageResponse, candidates=candidates, frame_count=frame_count
        ),
        prompt,
    )


def triage_issue(
    issue_id: str,
    kind: TriageKind,
    actor_id: int | None,
    *,
    execute: StructuredExecutor,
    context: dict | None = None,
    job_id: str | None = None,
    attempt: str | None = None,
    evidence: EvidenceReader | None = None,
) -> TriageOutcome:
    """Triage or investigate one issue's current digest and store the validated result.

    `context` is the configuration a queued task accepted (`resume_action`); without
    it the action's current configuration is checked here and resolved at the call.
    `attempt` scopes the idempotency key to one explicit request (see the module
    docstring). `evidence` is read only for an investigation that will call the
    model. AI capacity deferrals propagate; every other closed AI error becomes an
    outcome.
    """
    action_id = ACTION_BY_KIND.get(kind)
    if action_id is None:
        raise ValueError(f"Unsupported triage kind: {kind!r}")

    def outcome(status: TriageStatus, **fields: Any) -> TriageOutcome:
        return TriageOutcome(status=status, kind=kind, issue_id=issue_id, **fields)

    data = get_triage_input(issue_id)
    if data is None:
        return outcome("not_found")
    digest, digest_hash = data["digest"], data["digest_hash"]
    if not isinstance(digest, Mapping) or not digest_hash:
        return outcome("no_digest")
    if kind in data["done_kinds"]:
        return outcome("existing", digest_hash=digest_hash)
    if context is None:
        availability = action_availability(action_id)
        if not availability["available"]:
            return outcome(
                "unavailable",
                digest_hash=digest_hash,
                error_code=availability["error_code"],
            )

    candidates = candidate_ids(data["candidates"])
    frame_count = len(digest.get("frames") or [])
    extra = evidence(data) if evidence is not None and kind == "investigation" else None
    system, response_model, prompt = _request(
        kind, data, candidates, frame_count, extra
    )
    try:
        result = execute(
            action_id,
            response_model,
            prompt,
            system=system,
            context=context,
            actor_id=actor_id,
            job_id=job_id,
            idempotency_key=idempotency_key(data["id"], kind, digest_hash, attempt),
        )
        check_output(result, candidates=candidates, frame_count=frame_count)
    except AIConfigurationError as error:
        if error.code == INPUT_TOO_LARGE_CODE:
            return outcome(
                "failed",
                digest_hash=digest_hash,
                error_code=error.code,
                input_tokens=estimated_input_tokens(
                    prompt, system, response_model.model_json_schema()
                ),
                input_limit=_input_limit(context),
            )
        status: TriageStatus = (
            "invalid_output" if error.code == INVALID_OUTPUT_CODE else "failed"
        )
        return outcome(status, digest_hash=digest_hash, error_code=error.code)
    except ValueError:
        return outcome(
            "invalid_output", digest_hash=digest_hash, error_code=INVALID_OUTPUT_CODE
        )

    by_short_id = {
        str(candidate["short_id"]): candidate["id"]
        for candidate in reversed(data["candidates"])
        if candidate.get("short_id")
    }
    triage_id = save_triage(
        data["id"],
        kind=kind,
        digest_hash=digest_hash,
        classification=result.classification,
        severity=result.severity,
        summary=result.summary,
        confidence=result.confidence,
        hypothesis=result.hypothesis,
        next_step=result.next_step,
        duplicate_of=(
            by_short_id.get(result.duplicate_of) if result.duplicate_of else None
        ),
        suspected_frames=list(dict.fromkeys(result.suspected_frames)),
        invocation_id=getattr(result, "_ai_invocation_id", None),
    )
    if triage_id is None:
        # Purged during the call, or a concurrent run stored this digest first.
        return outcome(
            "existing" if get_triage_input(issue_id) else "not_found",
            digest_hash=digest_hash,
        )
    return outcome("saved", digest_hash=digest_hash, triage_id=triage_id)


__all__ = [
    "ACTION_BY_KIND",
    "INPUT_TOO_LARGE_CODE",
    "INVALID_OUTPUT_CODE",
    "EvidenceReader",
    "StructuredExecutor",
    "TriageKind",
    "TriageOutcome",
    "TriageStatus",
    "idempotency_key",
    "triage_issue",
]

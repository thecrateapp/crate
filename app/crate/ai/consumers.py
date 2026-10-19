"""Safe queued acceptance references and private invocation arguments for domains."""

from crate.ai import configuration
from crate.ai.contracts import AIConfigurationError


def acceptance_reference(context: dict) -> dict:
    """Only this allowlist may enter generic task parameters."""
    return {
        "action_id": context["action_id"],
        "fingerprint": context["config_fingerprint"],
        **{
            key: context[key]
            for key in ("profile_id", "profile_version")
            if key in context
        },
    }


def accept_action(action_id: str) -> dict:
    return acceptance_reference(configuration.resolve_action(action_id))


def resume_action(
    action_id: str, accepted: dict | None, *, actor_id=None, job_id=None
) -> dict:
    """Reconstruct exactly the accepted identity or fail closed for old/stale jobs."""
    if (
        not accepted
        or accepted.get("action_id") != action_id
        or not accepted.get("fingerprint")
    ):
        raise AIConfigurationError(
            "AI_CONTEXT_STALE", "Queued action requires renewed acceptance"
        )
    context = configuration.resolve_action(
        action_id, expected_fingerprint=accepted["fingerprint"]
    )
    return {"context": context, "actor_id": actor_id, "job_id": job_id}


def resolve_call(action_id: str, *, actor_id=None) -> dict:
    return {"context": configuration.resolve_action(action_id), "actor_id": actor_id}


def revalidate_call(call: dict | None) -> None:
    if call is not None:
        configuration.revalidate_context(call["context"])


def item_call(call: dict | None, item: str) -> dict | None:
    """Each batch item owns one stable claim; private context stays in memory."""
    return (
        {**call, "idempotency_key": f"job:{call.get('job_id')}:{item}"}
        if call is not None
        else None
    )

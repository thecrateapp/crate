"""Explicit queued catalog discovery and one-shot synthetic profile tests."""

import importlib
import time

from crate.ai import configuration as service
from crate.ai.contracts import AIConfigurationError
from crate.db.queries.tasks import get_task
from crate.db.repositories import ai_usage as usage
from crate.db.repositories.tasks import create_task_dedup


def queue_refresh(id, expected_revision, actor_id):
    conn = service._connection(id, persist=True, expected_revision=expected_revision)
    # Environment CAS is checked atomically before its endpoint synchronization.
    if conn["secret_source"] != "environment" and expected_revision != conn["revision"]:
        raise AIConfigurationError(
            "AI_CONFIGURATION_CONFLICT", "Connection changed; reload"
        )
    fingerprint = service._catalog_fingerprint(conn)
    task_id = create_task_dedup(
        "ai_catalog_refresh",
        {"connection_id": conn["id"], "fingerprint": fingerprint, "actor_id": actor_id},
        dedup_key=f"ai:catalog:{conn['id']}:{fingerprint}",
        actor_user_id=actor_id,
    )
    return {"task_id": task_id, "deduplicated": task_id is None}


def queue_probe(id, version, expected_fingerprint, idempotency_key, actor_id):
    context = service.resolve_profile(id, version)
    if context["profile_fingerprint"] != expected_fingerprint:
        raise AIConfigurationError(
            "AI_CONTEXT_STALE", "Profile changed; reload before testing"
        )
    task_id = create_task_dedup(
        "ai_profile_test",
        {
            "profile_id": id,
            "version": version,
            "fingerprint": context["config_fingerprint"],
            "idempotency_key": idempotency_key,
            "actor_id": actor_id,
        },
        dedup_key=f"ai:probe:{actor_id}:{idempotency_key}",
        actor_user_id=actor_id,
    )
    config = context["config"]
    return {
        "task_id": task_id,
        "deduplicated": task_id is None,
        "max_timeout_seconds": config["timeout_seconds"],
        "max_input_tokens": config["max_input_tokens"],
        "max_output_tokens": config["max_output_tokens"],
    }


def run_probe(context, *, actor_id, job_id, idempotency_key):
    """Task 4 supplies runtime.execute_probe, a single transport call without reservation.

    Transport receives exact context options and only fixed synthetic data/schema.
    Return {compatible:bool,usage:dict|None,reported_model:str|None}; no source/response.
    This operation owns reservation/finalization; transport must never retry/fallback.
    """
    service.revalidate_context(context)
    try:
        execute_probe = importlib.import_module("crate.ai.runtime").execute_probe
    except (ImportError, AttributeError):
        raise AIConfigurationError(
            "AI_RUNTIME_UNAVAILABLE", "Synthetic transport is not available"
        ) from None
    config = context["config"]
    invocation = usage.reserve_invocation(
        context,
        idempotency_key=f"probe:{actor_id}:{idempotency_key}",
        input_tokens=config["max_input_tokens"],
        output_tokens=config["max_output_tokens"],
        actor_id=actor_id,
        job_id=job_id,
    )
    if not invocation["claimed"]:
        return {"status": "duplicate"}
    started = time.monotonic()
    try:
        key = service.load_context_key(context)
        result = execute_probe(
            context,
            api_key=key,
            prompt='Return {"ok":true} for this synthetic compatibility check.',
            response_schema={
                "type": "object",
                "properties": {"ok": {"type": "boolean"}},
                "required": ["ok"],
                "additionalProperties": False,
            },
        )
        compatible = result.get("compatible") is True
        usage.finish_invocation(
            invocation["id"],
            result.get("usage"),
            "succeeded" if compatible else "failed",
            reported_model=result.get("reported_model"),
            duration_ms=int((time.monotonic() - started) * 1000),
        )
        return {
            "status": "succeeded" if compatible else "failed",
            "compatible": compatible,
        }
    except Exception:
        usage.finish_invocation(
            invocation["id"],
            None,
            "failed",
            error_code="AI_PROBE_FAILED",
            duration_ms=int((time.monotonic() - started) * 1000),
        )
        return {"status": "failed", "error_code": "AI_PROBE_FAILED"}


def job(id):
    row = get_task(id)
    if row is None or row["type"] not in {"ai_catalog_refresh", "ai_profile_test"}:
        raise AIConfigurationError("AI_JOB_UNKNOWN", "Job does not exist")
    from crate.api.schemas.ai_agents import JobOutcome

    result = row.get("result")
    safe = None
    if isinstance(result, dict):
        # Validate only our finite result; arbitrary task exception strings never escape.
        try:
            safe = JobOutcome.model_validate(result).model_dump()
        except ValueError:
            safe = {"status": "failed", "error_code": "AI_JOB_FAILED"}
    return {
        "id": str(row["id"]),
        "type": row["type"],
        "status": row["status"],
        "result": safe,
    }


def activity(filters, limit, cursor):
    from crate.api.schemas.ai_agents import Invocation

    result = usage.list_invocations(filters, limit=limit, cursor=cursor)
    allowed = set(Invocation.model_fields)
    return {
        "items": [
            {k: v for k, v in row.items() if k in allowed} for row in result["items"]
        ],
        "next_cursor": result["next_cursor"],
    }

"""Maintenance operations: current human permissions and immutable context checks."""

from crate.ai import configuration as service
from crate.ai import discovery, operations
from crate.ai.contracts import AIConfigurationError
from crate.api.permissions import get_user_capabilities
from crate.credentials import load_secret
from crate.db.repositories import ai_configuration as store
from crate.db.repositories.auth_users import get_user_by_id
from crate.db.queries.tasks import get_task


def _actor(task_id, params, capability):
    user = get_user_by_id(params["actor_id"])
    if (
        not user
        or not user.get("is_active", True)
        or (user.get("status") or "active") != "active"
        or not (
            {capability, "ai.config.read"}
            if capability == "ai.tests.run"
            else {capability}
        )
        <= get_user_capabilities(user)
    ):
        raise AIConfigurationError("AI_PERMISSION_REVOKED", "Permission was revoked")
    task = get_task(task_id)
    expected_type = (
        "ai_profile_test" if capability == "ai.tests.run" else "ai_catalog_refresh"
    )
    if (
        not task
        or task.get("actor_user_id") != params["actor_id"]
        or task.get("type") != expected_type
        or task.get("retry_of")
    ):
        raise AIConfigurationError(
            "AI_TASK_PROVENANCE", "Use a new dedicated human request"
        )


def handle_refresh(task_id, params, config):
    try:
        _actor(task_id, params, "ai.config.manage")
        conn = service._connection(params["connection_id"])
        if not conn["enabled"]:
            raise AIConfigurationError(
                "AI_CONNECTION_UNAVAILABLE", "Connection is disabled"
            )
        fingerprint = service._catalog_fingerprint(conn)
        if fingerprint != params["fingerprint"]:
            raise AIConfigurationError("AI_CONTEXT_STALE", "Connection changed")
        key = (
            service._environment_key(conn["provider"])
            if conn["secret_source"] == "environment"
            else load_secret(conn["secret_ref"], scope="ai")["api_key"]
            if conn["secret_source"] == "stored"
            else None
        )
        try:
            models = discovery.discover_models(
                conn["provider"], api_key=key, endpoint=conn["endpoint"]
            )
        except AIConfigurationError as error:
            store.save_model_catalog(
                conn["id"],
                conn["model_catalog"],
                "error",
                conn["revision"],
                error_code=error.code,
            )
            raise
        store.save_model_catalog(conn["id"], models, "ready", conn["revision"])
        return {"status": "succeeded", "model_count": len(models)}
    except AIConfigurationError as error:
        return {"status": "failed", "error_code": error.code}
    except Exception:
        return {"status": "failed", "error_code": "AI_CATALOG_FAILED"}


def handle_probe(task_id, params, config):
    try:
        _actor(task_id, params, "ai.tests.run")
        context = service.resolve_profile(params["profile_id"], params["version"])
        if context["config_fingerprint"] != params["fingerprint"]:
            raise AIConfigurationError("AI_CONTEXT_STALE", "Profile changed")
        return operations.run_probe(
            context,
            actor_id=params["actor_id"],
            job_id=task_id,
            idempotency_key=params["idempotency_key"],
        )
    except AIConfigurationError as error:
        return {"status": "failed", "error_code": error.code}
    except Exception:
        return {"status": "failed", "error_code": "AI_PROBE_FAILED"}


AI_CONFIGURATION_TASK_HANDLERS = {
    "ai_catalog_refresh": handle_refresh,
    "ai_profile_test": handle_probe,
}

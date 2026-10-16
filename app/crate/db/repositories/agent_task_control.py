"""Closed task controls with retained domain authority and exact ownership."""

from sqlalchemy import text

from crate.agent_access import AgentPrincipal, authorization_context
from crate.agent_diagnostics import DiagnosticError
from crate.db.repositories import agent_requests as requests
from crate.db.repositories.task_control import request_cancellation
from crate.db.repositories.tasks import create_task
from crate.db.tx import optional_scope

# Only these handlers have reviewed replay semantics and cooperative checkpoints.
TASK_CONTROLS = {
    "health_check": {"grant": "library.health.run", "retry": False, "cancel": True},
    "compute_analytics": {"grant": "ops.schedules.run", "retry": True, "cancel": True},
    "quality_check": {"grant": "library.quality.run", "retry": True, "cancel": True},
    "compute_popularity": {
        "grant": "library.enrichment.run",
        "retry": False,
        "cancel": True,
    },
    "popularity_chunk": {
        "grant": "library.enrichment.run",
        "retry": False,
        "cancel": True,
    },
    "agent_maintenance": {"grant": None, "retry": False, "cancel": True},
}


def principal_context(principal):
    return {
        "principal_id": principal.id,
        "credential_id": principal.credential_id,
        "authorization_context": authorization_context(principal),
    }


def _task(current, task_id, *, lock=False):
    row = (
        current.execute(
            text("SELECT * FROM tasks WHERE id=:id" + (" FOR UPDATE" if lock else "")),
            {"id": task_id},
        )
        .mappings()
        .first()
    )
    if row is None:
        raise DiagnosticError("NOT_FOUND", "Task was not found")
    return dict(row)


def _grants(row, principal, operation, scope):
    contract = TASK_CONTROLS.get(row["type"])
    action = "retry" if operation == "job_retry" else "cancel"
    if contract is None or not contract[action]:
        raise DiagnosticError(
            "NOT_EXECUTABLE",
            "This task type has no reviewed control contract; reconcile its effects and prepare a new domain plan",
        )
    context = row.get("origin_context") or {}
    grants = set(row.get("required_grants") or [])
    if row["origin"] == "agent":
        if (
            row.get("origin_principal_id") is None
            or str(row["origin_principal_id"]) != principal.id
            or context.get("authorization_context", {})
            != authorization_context(principal)
        ):
            raise DiagnosticError(
                "FORBIDDEN", "Task belongs to another integration or authorization"
            )
    elif scope == "instance" and row["origin"] in {"admin", "scheduler"}:
        grants.add("ops.jobs.manage_instance")
    else:
        raise DiagnosticError(
            "FORBIDDEN",
            "Instance task control requires explicit instance scope and grant",
        )
    grants.add("ops.jobs.retry" if action == "retry" else "ops.jobs.cancel")
    if contract["grant"]:
        grants.add(contract["grant"])
    if not grants <= principal.grants:
        raise DiagnosticError(
            "FORBIDDEN", "Original operation and instance grants are required"
        )
    return sorted(grants)


def _fingerprint(row):
    return requests._hash(
        {
            key: row.get(key)
            for key in (
                "id",
                "type",
                "status",
                "origin",
                "origin_principal_id",
                "origin_context",
                "required_grants",
                "retry_of",
                "retry_root",
                "retry_depth",
                "params_json",
                "cancellation_requested_at",
            )
        }
    )


def _retry_parameters(row):
    expected = {"scope": "global"} if row["type"] == "quality_check" else {}
    if row["params_json"] not in (expected, None if not expected else expected):
        raise DiagnosticError(
            "NOT_EXECUTABLE",
            "This maintenance variant requires a new explicit domain plan",
        )
    return expected


def inspect_control(principal, operation, parameters, *, session=None):
    with optional_scope(session) as current:
        row = _task(current, parameters["job_id"])
        grants = _grants(row, principal, operation, parameters.get("scope", "own"))
        if operation == "job_retry":
            if row["status"] != "failed" or row["cancellation_requested_at"]:
                raise DiagnosticError(
                    "STATE_CONFLICT",
                    "Only failed work without cancellation uncertainty can be retried",
                )
            if row["parent_task_id"]:
                raise DiagnosticError(
                    "NOT_EXECUTABLE", "Delegated children require a new parent plan"
                )
            root = row["retry_root"] or row["id"]
            if current.execute(
                text(
                    "SELECT 1 FROM tasks WHERE retry_root=:root AND retry_depth>0 AND status IN ('pending','running','delegated','completing') LIMIT 1"
                ),
                {"root": root},
            ).first():
                raise DiagnosticError(
                    "STATE_CONFLICT", "This retry lineage already has active work"
                )
            attempts = current.execute(
                text(
                    "SELECT COUNT(*) FROM tasks WHERE retry_root=:root AND retry_depth>0"
                ),
                {"root": root},
            ).scalar_one()
            if row["retry_depth"] >= 3 or attempts >= 3:
                raise DiagnosticError("LIMIT_EXCEEDED", "Task retry budget exhausted")
            _retry_parameters(row)
        elif row["status"] not in {"pending", "running", "delegated"}:
            raise DiagnosticError("STATE_CONFLICT", "Task is terminal or finalizing")
        return {
            "job_id": row["id"],
            "type": row["type"],
            "scope": parameters.get("scope", "own"),
            "status": row["status"],
            "origin": row["origin"],
            "required_grants": grants,
            "fingerprint": _fingerprint(row),
            "principal": principal_context(principal),
        }


def apply_control(operation, execution):
    context = execution["principal"]
    auth = context["authorization_context"]
    principal = AgentPrincipal(
        context["principal_id"],
        context["credential_id"],
        "Task control",
        frozenset(execution["required_grants"]),
        authorization_id=auth.get("authorization_id"),
        actor_user_id=auth.get("actor_user_id"),
        client_id=auth.get("client_id"),
        accepted_scopes=frozenset(auth["accepted_scopes"]) if auth else None,
    )
    with optional_scope(None) as current:
        requests._authorize(
            current, principal, execution["required_grants"], worker=True
        )
        row = _task(current, execution["job_id"], lock=True)
        if _fingerprint(row) != execution["fingerprint"]:
            raise DiagnosticError("PLAN_STALE", "Task changed after preview")
        _grants(row, principal, operation, execution["scope"])
        if operation == "job_cancel":
            result = request_cancellation(
                row["id"],
                actor_user_id=principal.actor_user_id,
                principal_id=principal.id,
                session=current,
            )
        else:
            root = row["retry_root"] or row["id"]
            current.execute(
                text("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))"),
                {"key": "task:retry:" + root},
            )
            inspect_control(
                principal,
                operation,
                {"job_id": row["id"], "scope": execution["scope"]},
                session=current,
            )
            task_id = create_task(
                row["type"],
                _retry_parameters(row),
                origin="agent",
                actor_user_id=principal.actor_user_id,
                agent_context=principal_context(principal),
                required_grants=execution["required_grants"],
                retry_of=row["id"],
                session=current,
            )
            current.execute(
                text("UPDATE tasks SET max_retries=0 WHERE id=:id"), {"id": task_id}
            )
            result = {"task_id": task_id, "status": "queued", "retry_of": row["id"]}
        requests._audit(
            current,
            principal,
            "agent.task." + ("retry" if operation == "job_retry" else "cancel"),
            job_id=result["task_id"],
        )
        return result


def check_task_authority(task_id):
    """Raw catalog jobs retain the authorization that admitted them."""
    with optional_scope(None) as current:
        row = (
            current.execute(
                text(
                    "SELECT status,origin,origin_context,origin_principal_id,required_grants,cancellation_requested_at FROM tasks WHERE id=:id"
                ),
                {"id": task_id},
            )
            .mappings()
            .first()
        )
        if row is None:
            return True
        stopping = (
            row["status"] == "cancelled" or row["cancellation_requested_at"] is not None
        )
        if row["origin"] != "agent":
            return stopping
        if not row["origin_context"] or row["origin_principal_id"] is None:
            raise DiagnosticError(
                "FORBIDDEN", "Agent task has no retained authorization"
            )
        context = row["origin_context"]
        auth = context.get("authorization_context") or {}
        principal = AgentPrincipal(
            str(row["origin_principal_id"]),
            context["credential_id"],
            "Task",
            frozenset(row["required_grants"]),
            authorization_id=auth.get("authorization_id"),
            actor_user_id=auth.get("actor_user_id"),
            client_id=auth.get("client_id"),
            accepted_scopes=frozenset(auth["accepted_scopes"]) if auth else None,
        )
        requests._authorize(current, principal, row["required_grants"], worker=True)
        return stopping


__all__ = [
    "TASK_CONTROLS",
    "principal_context",
    "inspect_control",
    "apply_control",
    "check_task_authority",
]

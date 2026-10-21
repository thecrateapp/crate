"""Durable acceptance and execution of the bounded agent command catalogue."""

import hashlib
import json
import re
from uuid import UUID, uuid4

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.agent_access import AgentPrincipal, authorization_context
from crate.agent_diagnostics import DiagnosticError
from crate.db.domain_events import append_domain_event
from crate.db.health import upsert_health_issue
from crate.db.repositories.tasks_mutations import create_task, update_task
from crate.db.tx import optional_scope
from crate.db.ui_snapshot_writes import mark_ui_snapshots_stale
from crate.health_issue_text import describe_health_issue

_ACTIVE = ("pending", "running", "delegated", "completing")
_SCOPES = {
    "extract_shows": "curation.shows.write",
    "run_health_check": "library.health.run",
    "apply_repairs": "library.repair.photo_flag",
}
_PERMANENT = {
    "FORBIDDEN",
    "ARTIST_NOT_FOUND",
    "PATH_UNSAFE",
    "INVALID_ARGUMENT",
    "PLAN_STALE",
    "EVIDENCE_STALE",
}


def _hash(value: dict) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode()
    ).hexdigest()


def _uuid(value: str) -> str:
    try:
        return str(UUID(value))
    except (ValueError, TypeError, AttributeError):
        raise DiagnosticError("INVALID_ARGUMENT", "A valid UUID is required") from None


def _key(value: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(
        r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", value
    ):
        raise DiagnosticError(
            "INVALID_ARGUMENT",
            "Idempotency key must contain 1 to 128 ASCII letters, digits, dots, underscores, colons or hyphens",
        )
    return value


def _authorize(current, principal, grants, *, worker=False):
    current.execute(text("SET LOCAL statement_timeout = '5s'"))
    current.execute(text("SET LOCAL lock_timeout = '2s'"))
    if principal.authorization_id:
        from crate.db.repositories.mcp_oauth import lock_delegated_authorization

        lock_delegated_authorization(principal.authorization_id, session=current)
    row = (
        current.execute(
            text("""
        SELECT p.enabled, p.grants, p.kind, p.human_owner_user_id, c.revoked_at, c.expires_at > NOW() AS unexpired
        FROM agent_principals p JOIN agent_credentials c ON c.principal_id = p.id
        WHERE p.id = :principal_id AND c.id = :credential_id
        FOR SHARE OF p, c
    """),
            {"principal_id": principal.id, "credential_id": principal.credential_id},
        )
        .mappings()
        .first()
    )
    if (
        row is None
        or not row["enabled"]
        or row["revoked_at"] is not None
        or (not worker and not row["unexpired"])
    ):
        raise DiagnosticError(
            "FORBIDDEN", "Integration or credential is no longer authorized"
        )
    if not set(grants) <= set(row["grants"]) or (
        not worker and not set(grants) <= principal.grants
    ):
        raise DiagnosticError(
            "FORBIDDEN", "Required integration permissions are not granted"
        )
    if row["kind"] == "human" or principal.human_actor_id is not None:
        from crate.db.repositories.show_editor_access import authorize_show_editor

        authorize_show_editor(current, principal, row, grants)
        return
    if row["kind"] == "delegated":
        from crate.db.repositories.mcp_oauth import delegated_authorization_grants

        if not principal.authorization_id:
            raise DiagnosticError(
                "FORBIDDEN", "Delegated authorization context is required"
            )
        effective = delegated_authorization_grants(
            principal.authorization_id,
            principal_id=principal.id,
            actor_user_id=principal.actor_user_id,
            client_id=principal.client_id,
            accepted_scopes=principal.accepted_scopes or principal.grants,
            session=current,
            worker=worker,
        )
        if not set(grants) <= effective:
            raise DiagnosticError(
                "FORBIDDEN", "Delegated authority no longer permits the operation"
            )
    elif principal.authorization_id:
        raise DiagnosticError(
            "FORBIDDEN", "Delegation does not belong to this integration"
        )


def _require_legacy_policy(current, principal):
    required = current.execute(
        text("SELECT require_approval FROM agent_principals WHERE id=:id FOR SHARE"),
        {"id": principal.id},
    ).scalar_one()
    if required:
        raise DiagnosticError(
            "APPROVAL_REQUIRED", "Use an exact reviewed plan for this integration"
        )


def _lock_principal(current, principal_id):
    current.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": "agent:principal:" + principal_id},
    )


def _audit(
    current,
    principal,
    action,
    *,
    job_id=None,
    artist_uid=None,
    plan_id=None,
    trace_id=None,
    result=None,
):
    details = {
        "principal_id": principal.id,
        "credential_id": principal.credential_id,
        **authorization_context(principal),
        "job_id": job_id,
        "artist_uid": artist_uid,
        "plan_id": plan_id,
        "trace_id": str(trace_id)[:128] if trace_id else None,
    }
    if result:
        details["result"] = result
    current.execute(
        text("""
        INSERT INTO audit_log (timestamp, action, target_type, target_name, details_json)
        VALUES (NOW(), :action, 'agent_job', :target, CAST(:details AS jsonb))
    """),
        {
            "action": action,
            "target": job_id or plan_id or artist_uid,
            "details": json.dumps(details, default=str),
        },
    )


def _job(current, job_id, *, lock=False):
    suffix = " FOR UPDATE OF j, t" if lock else ""
    # Inner join deliberately treats a purged runtime task as an expired result.
    row = (
        current.execute(
            text(
                """
        SELECT j.*, j.principal_id::text AS principal_id,
               j.credential_id::text AS credential_id, j.artist_uid::text AS artist_uid,
               t.status, t.type AS task_type
        FROM agent_jobs j JOIN tasks t ON t.id = j.task_id
        WHERE j.task_id = :job_id
    """
                + suffix
            ),
            {"job_id": job_id},
        )
        .mappings()
        .first()
    )
    if row is None:
        return None
    from crate.agent_operation_catalog import interrupted_operation_result

    job = dict(row)
    job["result"] = interrupted_operation_result(
        job["operation"], job["status"], job.get("effect_started_at"), job["result"]
    )
    return job


def _summary(row, replayed=False):
    if row is None:
        raise DiagnosticError(
            "RESULT_EXPIRED",
            "This request was accepted previously; its job result has expired",
        )
    result = row["result"]
    if row["operation"] in {"prepare_operation", "apply_operation", "extract_shows"}:
        from crate.agent_operation_catalog import operation_result_summary

        result = operation_result_summary(
            result, plan_id=row["payload"].get("plan_id"), job_id=row["task_id"]
        )
    return {
        "job_id": row["task_id"],
        "status": row["status"],
        "operation": row["operation"],
        "artist_uid": row["artist_uid"],
        "replayed": replayed,
        "retry_of": row["retry_of"],
        "result": result,
    }


def _replay(current, principal, operation, key, payload_hash):
    row = (
        current.execute(
            text("""
        SELECT payload_hash, task_id FROM agent_requests
        WHERE principal_id = :principal_id AND operation = :operation AND idempotency_key = :key
    """),
            {"principal_id": principal.id, "operation": operation, "key": key},
        )
        .mappings()
        .first()
    )
    if row is None:
        return None
    if row["payload_hash"] != payload_hash:
        raise DiagnosticError(
            "IDEMPOTENCY_CONFLICT", "Idempotency key was used with a different request"
        )
    job = _job(current, row["task_id"])
    if job is not None and (
        job.get("authorization_context") or {}
    ) != authorization_context(principal):
        raise DiagnosticError(
            "FORBIDDEN", "The accepted request belongs to a different authorization"
        )
    return _summary(job, True)


def _remember_request(current, principal, operation, key, payload_hash, job_id):
    current.execute(
        text("""
        INSERT INTO agent_requests (principal_id, operation, idempotency_key, payload_hash, task_id)
        VALUES (:principal_id, :operation, :key, :hash, :job_id)
    """),
        {
            "principal_id": principal.id,
            "operation": operation,
            "key": key,
            "hash": payload_hash,
            "job_id": job_id,
        },
    )


def _accept(
    current,
    principal,
    operation,
    payload,
    key,
    *,
    request_operation=None,
    request_hash=None,
    retry_of=None,
    retry_root=None,
    retry_depth=0,
    trace_id=None,
):
    request_operation = request_operation or operation
    payload_hash = _hash(payload)
    request_hash = request_hash or payload_hash
    target_keys = payload.get("target_keys") or (
        ["artist:" + payload["artist_uid"]] if payload.get("artist_uid") else []
    )
    current.execute(
        text(
            "SELECT pg_advisory_xact_lock(hashtextextended('agent:library-admission',0))"
        )
    )
    active = (
        current.execute(
            text("""
        SELECT j.task_id, j.principal_id::text AS principal_id, j.operation, j.payload_hash, j.authorization_context
        FROM agent_jobs j JOIN tasks t ON t.id = j.task_id
        WHERE t.status = ANY(:active) AND
          (j.target_keys && CAST(:targets AS text[])
           OR (:library_target AND 'library:global'=ANY(j.target_keys))
           OR (:global_target AND EXISTS(SELECT 1 FROM unnest(j.target_keys) k WHERE k~'^(artist|album|track|library):')))
        LIMIT 1
    """),
            {
                "targets": target_keys,
                "global_target": "library:global" in target_keys,
                "library_target": any(
                    key.split(":", 1)[0] in {"artist", "album", "track", "library"}
                    for key in target_keys
                ),
                "active": list(_ACTIVE),
            },
        )
        .mappings()
        .first()
    )
    if active:
        if (
            active["principal_id"] == principal.id
            and active["operation"] == operation
            and active["payload_hash"] == payload_hash
            and active["authorization_context"] == authorization_context(principal)
        ):
            _remember_request(
                current,
                principal,
                request_operation,
                key,
                request_hash,
                active["task_id"],
            )
            return _summary(_job(current, active["task_id"]), True)
        raise DiagnosticError(
            "TARGET_BUSY", "The artist already has active maintenance work"
        )
    # A show readiness probe is a non-billable worker check that runs on its own
    # when the import view opens. It neither takes nor waits for the editor's one
    # outstanding job; it still counts toward the extraction allowance.
    probe = operation == "extract_shows" and payload.get("readiness_probe") is True
    outstanding = (
        not probe
        and current.execute(
            text("""
        SELECT 1 FROM agent_jobs j JOIN tasks t ON t.id = j.task_id
        WHERE j.principal_id = :principal_id AND t.status = ANY(:active)
        AND (:control = FALSE OR j.payload->>'domain_operation'='job_cancel')
        AND NOT (j.operation = 'extract_shows'
                 AND COALESCE(j.payload->>'readiness_probe', 'false') = 'true')
        LIMIT 1
    """),
            {
                "principal_id": principal.id,
                "active": list(_ACTIVE),
                "control": payload.get("domain_operation") == "job_cancel",
            },
        ).first()
    )
    if outstanding:
        raise DiagnosticError(
            "LIMIT_EXCEEDED",
            "This integration already has an active maintenance job",
            retry_after=5,
        )
    task_type = (
        "soulseek_download"
        if payload.get("domain_operation") in {"acquisition", "acquisition_publish"}
        else "show_extract"
        if operation == "extract_shows"
        else "agent_control"
        if payload.get("domain_operation") == "job_cancel"
        else "agent_maintenance"
        if operation in {"prepare_operation", "apply_operation"}
        else "health_check"
        if operation == "run_health_check"
        else "repair"
    )
    task_id = create_task(
        task_type,
        {"agent_command": True, "artist_uid": payload.get("artist_uid")},
        session=current,
    )
    # Retries require an explicit, separately authorized command; the actor cannot auto retry.
    current.execute(
        text("UPDATE tasks SET max_retries = 0 WHERE id = :id"), {"id": task_id}
    )
    grants = (
        payload["required_grants"]
        if operation in {"prepare_operation", "apply_operation"}
        else [_SCOPES[operation]] + (["ops.jobs.retry"] if retry_of else [])
    )
    current.execute(
        text("""
        INSERT INTO agent_jobs (task_id, principal_id, credential_id, operation, artist_uid, payload,
            payload_hash, required_grants, retry_of, retry_root, retry_depth, trace_id, authorization_context, target_keys)
        VALUES (:task_id, :principal_id, :credential_id, :operation, :artist_uid, CAST(:payload AS jsonb),
            :payload_hash, :grants, :retry_of, :retry_root, :retry_depth, :trace_id, CAST(:authorization_context AS jsonb), :target_keys)
    """),
        {
            "task_id": task_id,
            "principal_id": principal.id,
            "credential_id": principal.credential_id,
            "operation": operation,
            "artist_uid": payload.get("artist_uid"),
            "target_keys": target_keys,
            "payload": json.dumps(payload),
            "payload_hash": payload_hash,
            "grants": grants,
            "retry_of": retry_of,
            "retry_root": retry_root or task_id,
            "retry_depth": retry_depth,
            "trace_id": str(trace_id)[:128] if trace_id else None,
            "authorization_context": json.dumps(authorization_context(principal)),
        },
    )
    from crate.db.repositories.agent_task_control import principal_context
    from crate.db.repositories.task_control import record_task_provenance

    record_task_provenance(
        task_id,
        origin="admin" if principal.human_actor_id is not None else "agent",
        actor_user_id=principal.actor_user_id,
        agent_context=principal_context(principal),
        required_grants=grants,
        retry_of=retry_of,
        session=current,
    )
    _remember_request(current, principal, request_operation, key, request_hash, task_id)
    _audit(
        current,
        principal,
        "agent.command.accepted",
        job_id=task_id,
        artist_uid=payload.get("artist_uid"),
        plan_id=payload.get("plan_id"),
        trace_id=trace_id,
    )
    return _summary(_job(current, task_id))


def accept_health_check(
    principal: AgentPrincipal,
    artist_uid: str,
    idempotency_key: str,
    *,
    trace_id=None,
    session: Session | None = None,
) -> dict:
    payload = {"artist_uid": _uuid(artist_uid), "check_type": "has_photo_desync"}
    key = _key(idempotency_key)
    with optional_scope(session) as current:
        _authorize(current, principal, {"library.health.run"})
        _require_legacy_policy(current, principal)
        _lock_principal(current, principal.id)
        replay = _replay(current, principal, "run_health_check", key, _hash(payload))
        if replay:
            return replay
        if not current.execute(
            text("SELECT 1 FROM library_artists WHERE entity_uid = :uid"),
            {"uid": payload["artist_uid"]},
        ).first():
            raise DiagnosticError("ARTIST_NOT_FOUND", "Artist no longer exists")
        return _accept(
            current, principal, "run_health_check", payload, key, trace_id=trace_id
        )


def _plan(current, principal_id, plan_id, *, lock=False):
    suffix = " FOR UPDATE OF p" if lock else ""
    row = (
        current.execute(
            text(
                """
        SELECT p.*, p.id::text AS id, p.artist_uid::text AS artist_uid,
               o.observation, p.expires_at > NOW() AS unexpired
        FROM agent_repair_plans p LEFT JOIN agent_photo_observations o ON o.id = p.observation_id
        WHERE p.id = :id AND p.principal_id = :principal_id
    """
                + suffix
            ),
            {"id": plan_id, "principal_id": principal_id},
        )
        .mappings()
        .first()
    )
    if row is None:
        raise DiagnosticError("NOT_FOUND", "Repair plan was not found")
    return dict(row)


def accept_apply(
    principal: AgentPrincipal,
    plan_id: str,
    plan_version: str,
    idempotency_key: str,
    *,
    trace_id=None,
    session: Session | None = None,
) -> dict:
    plan_id, key = _uuid(plan_id), _key(idempotency_key)
    request_payload = {"plan_id": plan_id, "plan_version": plan_version}
    with optional_scope(session) as current:
        from crate.db.repositories.agent_plans import (
            reserve_plan_approval,
            validate_plan_authorization,
        )

        _authorize(current, principal, {"library.repair.photo_flag"})
        _lock_principal(current, principal.id)
        replay = _replay(
            current, principal, "apply_repairs", key, _hash(request_payload)
        )
        if replay and replay["status"] in {"completed", "failed", "cancelled"}:
            return replay
        plan = _plan(current, principal.id, plan_id, lock=True)
        if plan.get("operation", "repair_photo_flag") != "repair_photo_flag":
            raise DiagnosticError(
                "FORBIDDEN", "This plan requires its library operation grant"
            )
        validate_plan_authorization(current, plan, principal, job_id=plan["task_id"])
        if replay:
            return replay
        if plan["version"] != plan_version:
            raise DiagnosticError(
                "PLAN_STALE", "Plan version does not match the immutable preview"
            )
        if plan["task_id"]:
            summary = _summary(_job(current, plan["task_id"]), True)
            _remember_request(
                current,
                principal,
                "apply_repairs",
                key,
                _hash(request_payload),
                plan["task_id"],
            )
            return summary
        if not plan["unexpired"] or plan["state"] not in {"ready", "authorized"}:
            raise DiagnosticError(
                "PLAN_STALE", "Repair plan is no longer ready or has expired"
            )
        payload = {**request_payload, "artist_uid": plan["artist_uid"]}
        summary = _accept(
            current,
            principal,
            "apply_repairs",
            payload,
            key,
            request_hash=_hash(request_payload),
            trace_id=trace_id,
        )
        current.execute(
            text(
                "UPDATE agent_repair_plans SET state = 'queued', task_id = :task_id WHERE id = :id"
            ),
            {"task_id": summary["job_id"], "id": plan_id},
        )
        reserve_plan_approval(current, plan_id, summary["job_id"])
        return summary


def retry_job(
    principal: AgentPrincipal,
    job_id: str,
    idempotency_key: str,
    *,
    trace_id=None,
    session: Session | None = None,
) -> dict:
    key = _key(idempotency_key)
    with optional_scope(session) as current:
        _authorize(current, principal, {"ops.jobs.retry", "library.health.run"})
        _require_legacy_policy(current, principal)
        _lock_principal(current, principal.id)
        request_hash = _hash({"job_id": job_id})
        replay = _replay(current, principal, "retry_job", key, request_hash)
        if replay:
            return replay
        job = _job(current, job_id, lock=True)
        if (
            job is None
            or job["principal_id"] != principal.id
            or job.get("authorization_context") != authorization_context(principal)
        ):
            raise DiagnosticError("NOT_FOUND", "Owned agent job was not found")
        if job["operation"] != "run_health_check":
            raise DiagnosticError(
                "NOT_RETRIABLE", "Only targeted health checks can be retried"
            )
        if job["status"] != "failed":
            raise DiagnosticError(
                "STATE_CONFLICT", "Only failed health checks can be retried"
            )
        if ((job["result"] or {}).get("execution") or {}).get(
            "error_code"
        ) in _PERMANENT:
            raise DiagnosticError(
                "NOT_RETRIABLE", "The failure requires an operator or a new request"
            )
        retry_count = current.execute(
            text(
                "SELECT COUNT(*) FROM agent_jobs WHERE retry_root = :root AND retry_of IS NOT NULL"
            ),
            {"root": job["retry_root"]},
        ).scalar_one()
        if retry_count >= 3:
            raise DiagnosticError(
                "NOT_RETRIABLE", "Health check retry budget is exhausted"
            )
        return _accept(
            current,
            principal,
            "run_health_check",
            job["payload"],
            key,
            request_operation="retry_job",
            request_hash=request_hash,
            retry_of=job_id,
            retry_root=job["retry_root"],
            retry_depth=int(retry_count) + 1,
            trace_id=trace_id,
        )


def cancel_job(
    principal: AgentPrincipal,
    job_id: str,
    *,
    trace_id=None,
    session: Session | None = None,
) -> dict:
    with optional_scope(session) as current:
        _authorize(current, principal, {"ops.jobs.cancel_pending"})
        _require_legacy_policy(current, principal)
        _lock_principal(current, principal.id)
        job = _job(current, job_id, lock=True)
        if (
            job is None
            or job["principal_id"] != principal.id
            or job.get("authorization_context") != authorization_context(principal)
        ):
            raise DiagnosticError("NOT_FOUND", "Owned agent job was not found")
        if job["operation"] not in {"run_health_check", "apply_repairs"}:
            raise DiagnosticError(
                "NOT_EXECUTABLE",
                "Only directed health checks and pilot repairs can be cancelled",
            )
        _authorize(current, principal, job["required_grants"])
        if job["status"] == "cancelled":
            return _summary(job, True)
        if job["status"] != "pending":
            raise DiagnosticError(
                "STATE_CONFLICT", "The job has already started or finished"
            )
        result = {
            "execution": {"status": "cancelled"},
            "verification": {"status": "not_required"},
            "projection": {"status": "not_required"},
        }
        _store_result(current, job, result, "cancelled")
        _audit(
            current,
            principal,
            "agent.command.cancelled",
            job_id=job_id,
            artist_uid=job["artist_uid"],
            trace_id=trace_id,
        )
        return _summary(_job(current, job_id))


def _principal_for_job(job):
    context = job.get("authorization_context") or {}
    return AgentPrincipal(
        job["principal_id"],
        job["credential_id"],
        "Agent job",
        frozenset(job["required_grants"]),
        authorization_id=context.get("authorization_id"),
        actor_user_id=context.get("actor_user_id"),
        client_id=context.get("client_id"),
        accepted_scopes=frozenset(context["accepted_scopes"]) if context else None,
        human_actor_id=context.get("human_actor_id"),
    )


def _execution_job(current, task_id):
    # Lock authorization first everywhere, so revocation is ordered before effects.
    initial = _job(current, task_id)
    if initial is None:
        raise DiagnosticError("NOT_FOUND", "Agent job was not found")
    _authorize(
        current, _principal_for_job(initial), initial["required_grants"], worker=True
    )
    if initial["operation"] == "run_health_check":
        _require_legacy_policy(current, _principal_for_job(initial))
    job = _job(current, task_id, lock=True)
    if job is None:
        raise DiagnosticError("NOT_FOUND", "Agent job was not found")
    if job["result"] is not None:
        return job
    if job["status"] != "running":
        raise DiagnosticError(
            "STATE_CONFLICT", "Agent job has not been claimed for execution"
        )
    expected = (
        "soulseek_download"
        if job["payload"].get("domain_operation")
        in {"acquisition", "acquisition_publish"}
        else "show_extract"
        if job["operation"] == "extract_shows"
        else "agent_control"
        if job["payload"].get("domain_operation") == "job_cancel"
        else "agent_maintenance"
        if job["operation"] in {"prepare_operation", "apply_operation"}
        else "health_check"
        if job["operation"] == "run_health_check"
        else "repair"
    )
    if job["task_type"] != expected:
        raise DiagnosticError(
            "STATE_CONFLICT", "Agent job type does not match its command"
        )
    return job


def load_job_for_execution(task_id: str, *, session: Session | None = None) -> dict:
    with optional_scope(session) as current:
        job = _execution_job(current, task_id)
        if job["result"] is not None:
            return job
        if job["operation"] == "apply_repairs":
            from crate.db.repositories.agent_plans import validate_plan_authorization

            plan = _plan(current, job["principal_id"], job["payload"]["plan_id"])
            validate_plan_authorization(
                current, plan, _principal_for_job(job), worker=True, job_id=task_id
            )
            if not plan["unexpired"] or plan["state"] != "queued":
                raise DiagnosticError(
                    "PLAN_STALE", "Repair plan expired or is no longer queued"
                )
            job["plan"] = plan
        return job


def _observation(value, artist_uid):
    if not isinstance(value, dict) or value.get("artist_uid") != artist_uid:
        raise DiagnosticError(
            "INVALID_ARGUMENT", "Observation must identify the exact job artist"
        )
    if not isinstance(value.get("db_has_photo"), bool) or not isinstance(
        value.get("fs_has_photo"), bool
    ):
        raise DiagnosticError(
            "INVALID_ARGUMENT", "Observation photo values must be booleans"
        )
    if not re.fullmatch("[a-f0-9]{64}", str(value.get("filesystem_fingerprint", ""))):
        raise DiagnosticError(
            "INVALID_ARGUMENT", "Observation must contain a filesystem fingerprint"
        )
    return {
        key: value.get(key)
        for key in (
            "artist_uid",
            "name",
            "folder_name",
            "db_has_photo",
            "fs_has_photo",
            "filesystem_fingerprint",
            "observed_at",
        )
    }


def _store_result(current, job, result, status):
    task_state = (
        current.execute(
            text(
                "SELECT status,cancellation_requested_at FROM tasks WHERE id=:id FOR UPDATE"
            ),
            {"id": job["task_id"]},
        )
        .mappings()
        .one()
    )
    acknowledge_on_return = (
        task_state["cancellation_requested_at"] is not None
        and task_state["status"] in {"running", "delegated"}
        and status in {"completed", "failed", "cancelled"}
    )
    result["status"] = "cancelled" if acknowledge_on_return else status
    if status == "failed":
        result["error_code"] = result["execution"].get("error_code")
        result["error"] = result["execution"].get("error")
    current.execute(
        text(
            "UPDATE agent_jobs SET result = CAST(:result AS jsonb) WHERE task_id = :id"
        ),
        {"result": json.dumps(result, default=str), "id": job["task_id"]},
    )
    task_result = result
    if job["operation"] in {"prepare_operation", "apply_operation", "extract_shows"}:
        from crate.agent_operation_catalog import public_operation_result

        task_result = public_operation_result(result)
    update_task(
        job["task_id"],
        status=None if acknowledge_on_return else status,
        result=task_result,
        session=current,
    )
    if job["operation"] == "apply_repairs" or (
        job["operation"] == "apply_operation" and job["payload"].get("plan_id")
    ):
        execution = result["execution"]["status"]
        state = (
            "applied"
            if execution in ("applied", "already_satisfied", "completed", "requeued")
            else execution
        )
        if state not in ("applied", "partial", "conflict", "failed", "cancelled"):
            state = "failed"
        current.execute(
            text(
                "UPDATE agent_repair_plans SET state = :state, result = CAST(:result AS jsonb) WHERE task_id = :id"
            ),
            {
                "state": state,
                "result": json.dumps(result, default=str),
                "id": job["task_id"],
            },
        )


def _check_current_artist(current, observation):
    row = (
        current.execute(
            text("""
        SELECT name, folder_name, has_photo FROM library_artists WHERE entity_uid = :uid FOR UPDATE
    """),
            {"uid": observation["artist_uid"]},
        )
        .mappings()
        .first()
    )
    if row is None:
        raise DiagnosticError("ARTIST_NOT_FOUND", "Artist no longer exists")
    if (
        row["name"] != observation["name"]
        or row["folder_name"] != observation["folder_name"]
        or bool(row["has_photo"]) != observation["db_has_photo"]
    ):
        raise DiagnosticError(
            "EVIDENCE_STALE", "Artist changed while the filesystem was being observed"
        )


def record_photo_observation(
    task_id: str, observation: dict, *, session: Session | None = None
) -> dict:
    with optional_scope(session) as current:
        job = _execution_job(current, task_id)
        if job["result"] is not None:
            return job["result"]
        if job["operation"] != "run_health_check":
            raise DiagnosticError(
                "STATE_CONFLICT", "Job is not a targeted health check"
            )
        value = _observation(observation, job["artist_uid"])
        _check_current_artist(current, value)
        issue_id = None
        if value["db_has_photo"] != value["fs_has_photo"]:
            details = {
                "artist": value["name"],
                "artist_uid": value["artist_uid"],
                "folder_name": value["folder_name"],
                "db_has_photo": value["db_has_photo"],
                "fs_has_photo": value["fs_has_photo"],
            }
            issue_id = upsert_health_issue(
                "has_photo_desync",
                "low",
                describe_health_issue("has_photo_desync", details),
                details,
                True,
                session=current,
            )
        else:
            _resolve_artist_issue(current, job["artist_uid"])
        observation_id = str(uuid4())
        current.execute(
            text("""
            INSERT INTO agent_photo_observations (id, task_id, artist_uid, issue_id, observation)
            VALUES (:id, :task_id, :uid, :issue_id, CAST(:observation AS jsonb))
        """),
            {
                "id": observation_id,
                "task_id": task_id,
                "uid": job["artist_uid"],
                "issue_id": issue_id,
                "observation": json.dumps(value, default=str),
            },
        )
        result = {
            "execution": {
                "status": "completed",
                "observation_id": observation_id,
                "issue_id": issue_id,
                "artist_uid": job["artist_uid"],
                "db_has_photo": value["db_has_photo"],
                "fs_has_photo": value["fs_has_photo"],
                "observed_at": value["observed_at"],
            },
            "verification": {"status": "observed"},
            "projection": {"status": "pending"},
        }
        _store_result(current, job, result, "completed")
        _audit(
            current,
            _principal_for_job(job),
            "agent.health.observed",
            job_id=task_id,
            artist_uid=job["artist_uid"],
            trace_id=job["trace_id"],
            result=result,
        )
        _signal(current, job, value["name"])
        return result


def _resolve_artist_issue(current, artist_uid):
    current.execute(
        text("""
        UPDATE health_issues SET status = 'fixed', resolved_at = NOW()
        WHERE check_type = 'has_photo_desync' AND status = 'open'
          AND artist_id = (SELECT id FROM library_artists WHERE entity_uid = :uid)
    """),
        {"uid": artist_uid},
    )


def _signal(current, job, artist_name):
    mark_ui_snapshots_stale(scope="ops:health", session=current)
    append_domain_event(
        "ui.invalidate",
        {"scope": "artist:" + job["artist_uid"], "artist": artist_name},
        scope="ui.invalidate",
        subject_key="artist:" + job["artist_uid"],
        session=current,
    )
    append_domain_event(
        "health.updated",
        {"artist_uid": job["artist_uid"], "check_type": "has_photo_desync"},
        scope="ops",
        subject_key="global",
        session=current,
    )


def complete_photo_repair(
    task_id: str, observation: dict, *, session: Session | None = None
) -> dict:
    from crate.db.jobs.artist_photo import compare_and_set_artist_photo
    from crate.db.repositories.agent_plans import validate_plan_authorization

    with optional_scope(session) as current:
        job = _execution_job(current, task_id)
        if job["result"] is not None:
            return job["result"]
        if job["operation"] != "apply_repairs":
            raise DiagnosticError("STATE_CONFLICT", "Job is not a photo flag repair")
        plan = _plan(current, job["principal_id"], job["payload"]["plan_id"], lock=True)
        validate_plan_authorization(
            current, plan, _principal_for_job(job), worker=True, job_id=task_id
        )
        if (
            not plan["unexpired"]
            or plan["state"] != "queued"
            or plan["version"] != job["payload"]["plan_version"]
            or plan["task_id"] != task_id
        ):
            raise DiagnosticError(
                "PLAN_STALE", "Repair plan is expired, changed or already consumed"
            )
        value = _observation(observation, job["artist_uid"])
        original = plan["observation"]
        for field in (
            "artist_uid",
            "name",
            "folder_name",
            "filesystem_fingerprint",
            "fs_has_photo",
        ):
            if value[field] != original[field]:
                raise DiagnosticError(
                    "PLAN_STALE",
                    "Artist identity or photo evidence changed after preview",
                )
        outcome = compare_and_set_artist_photo(
            job["artist_uid"],
            expected_has_photo=plan["before_value"],
            expected_name=original["name"],
            expected_folder_name=original["folder_name"],
            has_photo=plan["after_value"],
            session=current,
        )
        if outcome == "not_found":
            raise DiagnosticError("ARTIST_NOT_FOUND", "Artist no longer exists")
        if outcome == "conflict":
            raise DiagnosticError(
                "PLAN_STALE", "Artist no longer matches the plan preconditions"
            )
        result = {
            "execution": {
                "status": outcome,
                "artist_uid": job["artist_uid"],
                "plan_id": plan["id"],
                "before": plan["before_value"],
                "after": plan["after_value"],
            },
            "verification": {"status": "pending"},
            "projection": {"status": "pending"},
        }
        _store_result(current, job, result, "running")
        _audit(
            current,
            _principal_for_job(job),
            "agent.repair.applied",
            job_id=task_id,
            artist_uid=job["artist_uid"],
            plan_id=plan["id"],
            trace_id=job["trace_id"],
            result=result,
        )
        _signal(current, job, value["name"])
        return result


def record_photo_verification(
    task_id: str,
    observation: dict | None,
    *,
    error_code=None,
    session: Session | None = None,
) -> dict:
    with optional_scope(session) as current:
        job = _job(current, task_id, lock=True)
        if job is None or job["operation"] != "apply_repairs" or not job["result"]:
            raise DiagnosticError(
                "STATE_CONFLICT", "Repair has no persisted effect to verify"
            )
        result = job["result"]
        if result["execution"]["status"] not in ("applied", "already_satisfied"):
            return result
        if result["verification"]["status"] != "pending":
            return result
        plan = _plan(current, job["principal_id"], job["payload"]["plan_id"])
        original = plan["observation"]
        if observation is None:
            result["verification"] = {
                "status": "pending",
                "error_code": error_code or "FILESYSTEM_UNAVAILABLE",
            }
        else:
            value = _observation(observation, job["artist_uid"])
            verified = (
                all(
                    value[field] == original[field]
                    for field in (
                        "artist_uid",
                        "name",
                        "folder_name",
                        "filesystem_fingerprint",
                    )
                )
                and value["db_has_photo"]
                == value["fs_has_photo"]
                == plan["after_value"]
            )
            result["verification"] = {
                "status": "verified" if verified else "conflict",
                "observed_at": value["observed_at"],
            }
            if verified:
                try:
                    _check_current_artist(current, value)
                except DiagnosticError:
                    result["verification"]["status"] = "conflict"
                else:
                    try:
                        _authorize(
                            current,
                            _principal_for_job(job),
                            job["required_grants"],
                            worker=True,
                        )
                    except DiagnosticError:
                        pass  # Recording an existing effect is allowed; revoked jobs cannot resolve issues.
                    else:
                        _resolve_artist_issue(current, job["artist_uid"])
        _store_result(current, job, result, "completed")
        _audit(
            current,
            _principal_for_job(job),
            "agent.repair.verified",
            job_id=task_id,
            artist_uid=job["artist_uid"],
            plan_id=plan["id"],
            trace_id=job["trace_id"],
            result=result,
        )
        _signal(current, job, original["name"])
        return result


def fail_job(
    task_id: str, code: str, message: str, *, session: Session | None = None
) -> dict:
    from crate.agent_diagnostics import _text

    with optional_scope(session) as current:
        job = _job(current, task_id, lock=True)
        if job is None:
            raise DiagnosticError("NOT_FOUND", "Agent job was not found")
        if job["result"]:
            return job["result"]
        result = {
            "execution": {
                "status": "conflict"
                if code in {"PLAN_STALE", "EVIDENCE_STALE"}
                else "failed",
                "error_code": code,
                "error": _text(message, 512),
            },
            "verification": {"status": "not_required"},
            "projection": {"status": "not_required"},
        }
        _store_result(current, job, result, "failed")
        _audit(
            current,
            _principal_for_job(job),
            "agent.command.failed",
            job_id=task_id,
            artist_uid=job["artist_uid"],
            trace_id=job["trace_id"],
            result=result,
        )
        return result


__all__ = [
    "accept_apply",
    "accept_health_check",
    "cancel_job",
    "complete_photo_repair",
    "fail_job",
    "load_job_for_execution",
    "record_photo_observation",
    "record_photo_verification",
    "retry_job",
]

"""One persisted plan model with exact human decisions and transactional reservation."""

import json
from typing import Literal
from uuid import UUID

from sqlalchemy import text

from crate.agent_access import AgentPrincipal, authorization_context
from crate.agent_diagnostics import DiagnosticError, _safe
from crate.agent_operation_catalog import interrupted_operation_result
from crate.db.repositories.agent_human_sessions import require_agent_human_capabilities
from crate.db.repositories.agent_requests import _hash
from crate.db.tx import optional_scope, read_scope


def _document(row):
    if row.get("document") is not None:
        content = {
            **row["document"],
            "authorization_context": row["authorization_context"],
            "policy_revision": row["policy_revision"],
            "approval_required": row["approval_required"],
            "expires_at": row["expires_at"].isoformat(),
        }
        count = len(content["targets"])
        return {
            **content,
            "plan_id": row["id"],
            "principal_id": str(row["principal_id"]),
            "plan_version": row["version"],
            "content_hash": _hash(content),
            "authorization_context_hash": _hash(row["authorization_context"]),
            "state": row["state"],
            "created_at": row["created_at"].isoformat(),
            "job_id": row["task_id"],
            "target_count": count,
            "returned_count": count,
            "truncated": False,
            "result": row["result"],
        }
    observation = row["observation"]
    content = {
        "operation": "repair_photo_flag",
        "targets": [{"artist_uid": row["artist_uid"], "name": observation["name"]}],
        "source_versions": {
            "observation_id": str(row["observation_id"]),
            "observed_at": observation["observed_at"],
            "filesystem_fingerprint": observation["filesystem_fingerprint"],
        },
        "changes": [
            {
                "artist_uid": row["artist_uid"],
                "field": "has_photo",
                "before": row["before_value"],
                "after": row["after_value"],
            }
        ],
        "impact": {
            "artist_count": 1,
            "database_fields": 1,
            "filesystem_writes": False,
            "notifications": False,
        },
        "risk": "low",
        "reversibility": "The flag can be recomputed from current photo evidence; restoring the old flag can reintroduce inconsistency.",
        "authorization_context": row["authorization_context"],
        "policy_revision": row["policy_revision"],
        "approval_required": row["approval_required"],
        "expires_at": row["expires_at"].isoformat(),
    }
    return {
        "plan_id": row["id"],
        "principal_id": str(row["principal_id"]),
        "plan_version": row["version"],
        "content_hash": _hash(content),
        "authorization_context_hash": _hash(row["authorization_context"]),
        "state": row["state"],
        "created_at": row["created_at"].isoformat(),
        "job_id": row["task_id"],
        "target_count": 1,
        "returned_count": 1,
        "truncated": False,
        "result": row["result"],
        **content,
    }


def _get(current, plan_id, *, lock=False):
    try:
        plan_id = str(UUID(str(plan_id)))
    except (ValueError, TypeError):
        raise DiagnosticError("INVALID_ARGUMENT", "A plan UUID is required") from None
    row = (
        current.execute(
            text(
                """
        SELECT p.*, p.id::text AS id, p.artist_uid::text AS artist_uid, o.observation,
               p.expires_at > NOW() AS unexpired,
               j.operation AS job_operation, j.effect_started_at, t.status AS task_status
        FROM agent_repair_plans p LEFT JOIN agent_photo_observations o ON o.id = p.observation_id
        LEFT JOIN agent_jobs j ON j.task_id = p.task_id
        LEFT JOIN tasks t ON t.id = j.task_id
        WHERE p.id = :id
    """
                + (" FOR UPDATE OF p" if lock else "")
            ),
            {"id": plan_id},
        )
        .mappings()
        .first()
    )
    if row is None:
        raise DiagnosticError("NOT_FOUND", "Plan was not found")
    plan = dict(row)
    if plan["result"] is None:
        result = interrupted_operation_result(
            plan["job_operation"], plan["task_status"], plan["effect_started_at"], None
        )
        if result is not None:
            plan["result"] = result
            plan["state"] = result["execution"]["status"]
    return plan


def get_plan(plan_id: str, *, session=None) -> dict:
    def _read(current):
        row = _get(current, plan_id)
        document = _document(row)
        return (
            json.loads(json.dumps(document, default=str, allow_nan=False))
            if row.get("document") is not None
            else {key: _safe(value) for key, value in document.items()}
        )

    if session is not None:
        return _read(session)
    with read_scope() as current:
        return _read(current)


def get_owned_plan(principal: AgentPrincipal, plan_id: str, *, session=None) -> dict:
    from crate.db.repositories.agent_requests import _authorize

    def _read(current):
        row = _get(current, plan_id)
        if str(row["principal_id"]) != principal.id or row[
            "authorization_context"
        ] != authorization_context(principal):
            raise DiagnosticError("NOT_FOUND", "Owned plan was not found")
        _authorize(current, principal, set(row["required_grants"]))
        return get_plan(row["id"], session=current)

    if session is not None:
        return _read(session)
    with read_scope() as current:
        return _read(current)


def get_owned_analysis_references(
    principal: AgentPrincipal, plan_id: str, *, session=None
) -> dict:
    def _read(current):
        document = get_owned_plan(principal, plan_id, session=current)
        if document["operation"] != "analysis":
            raise DiagnosticError("INVALID_ARGUMENT", "An analysis plan is required")
        row = _get(current, plan_id)
        return {
            "state": row["state"],
            "references": row["execution_data"]["references"],
        }

    if session is not None:
        return _read(session)
    with read_scope() as current:
        return _read(current)


_VISIBLE_PLANS_SQL = """
    WITH visible AS (
        SELECT p.id, p.principal_id, p.artist_uid, p.version, p.operation,
               p.approval_required, p.created_at, p.expires_at, p.task_id,
               CASE WHEN p.result IS NULL AND j.operation='apply_operation'
                              AND t.status IN ('failed','cancelled','completed')
                    THEN CASE WHEN j.effect_started_at IS NOT NULL THEN 'partial'
                              WHEN t.status='cancelled' THEN 'cancelled' ELSE 'failed' END
                    ELSE p.state END AS state,
               pr.name AS integration_name, pr.kind AS integration_kind,
               CASE WHEN p.document IS NULL THEN 1
                    ELSE COALESCE(jsonb_array_length(p.document->'targets'), 0) END AS target_count,
               COALESCE(p.document->>'risk', 'low') AS risk,
               p.expires_at <= NOW() AS expired
        FROM agent_repair_plans p LEFT JOIN agent_jobs j ON j.task_id=p.task_id
        LEFT JOIN tasks t ON t.id=j.task_id
        JOIN agent_principals pr ON pr.id = p.principal_id
    )
"""


def list_plans(
    *,
    state: str | None = None,
    view: Literal["pending", "history"] | None = None,
    limit: int = 20,
    before: str | None = None,
    operations: list[str] | None = None,
    session=None,
) -> list[dict]:
    def _read(current):
        return [
            dict(row)
            for row in current.execute(
                text(
                    _VISIBLE_PLANS_SQL
                    + """
            SELECT id::text AS plan_id, principal_id::text, artist_uid::text, version AS plan_version,
                   state, operation, approval_required, created_at, expires_at, task_id AS job_id,
                   integration_name, integration_kind, target_count, risk, expired
            FROM visible WHERE (:state IS NULL OR state = :state)
              AND (:operations IS NULL OR operation=ANY(CAST(:operations AS text[])))
              AND (:view IS NULL OR (:view = 'pending') = (state = 'awaiting_approval' AND NOT expired))
              AND (:before IS NULL OR (created_at, id) <
                   (SELECT created_at, id FROM agent_repair_plans WHERE id = CAST(:before AS uuid)))
            ORDER BY created_at DESC, id DESC LIMIT :limit
        """
                ),
                {
                    "state": state,
                    "view": view,
                    "before": before,
                    "operations": operations,
                    "limit": min(max(limit, 1), 101),
                },
            ).mappings()
        ]

    if session is not None:
        return _read(session)
    with read_scope() as current:
        return _read(current)


def count_pending_plans(*, operations: list[str] | None = None, session=None) -> int:
    def _read(current):
        return current.execute(
            text(
                _VISIBLE_PLANS_SQL
                + """
            SELECT COUNT(*) FROM visible WHERE state = 'awaiting_approval' AND NOT expired
              AND (:operations IS NULL OR operation = ANY(CAST(:operations AS text[])))
        """
            ),
            {"operations": operations},
        ).scalar_one()

    if session is not None:
        return _read(session)
    with read_scope() as current:
        return _read(current)


def validate_plan_authorization(current, plan, principal, *, worker=False, job_id=None):
    policy = (
        current.execute(
            text("""
        SELECT policy_revision, require_approval FROM agent_principals WHERE id = :id FOR SHARE
    """),
            {"id": principal.id},
        )
        .mappings()
        .one()
    )
    if str(plan["principal_id"]) != principal.id or plan[
        "authorization_context"
    ] != authorization_context(principal):
        raise DiagnosticError(
            "FORBIDDEN", "Plan belongs to a different integration authorization"
        )
    if plan["policy_revision"] != policy["policy_revision"] or plan[
        "approval_required"
    ] != (policy["require_approval"] or plan.get("mandatory_approval", False)):
        raise DiagnosticError(
            "PLAN_STALE", "Integration policy changed; prepare a new plan"
        )
    if not plan["approval_required"]:
        return
    approval = (
        current.execute(
            text("""
        SELECT * FROM agent_plan_approvals WHERE plan_id = :id FOR UPDATE
    """),
            {"id": plan["id"]},
        )
        .mappings()
        .first()
    )
    document = _document(plan)
    if (
        not approval
        or approval["decision"] != "approved"
        or approval["plan_version"] != plan["version"]
        or approval["content_hash"] != document["content_hash"]
        or approval["policy_revision"] != policy["policy_revision"]
        or approval["authorization_context"] != authorization_context(principal)
        or (
            approval["reserved_job_id"] is not None
            and approval["reserved_job_id"] != job_id
        )
        or (worker and approval["reserved_job_id"] != job_id)
    ):
        raise DiagnosticError(
            "APPROVAL_REQUIRED", "An exact current human approval is required"
        )
    valid = current.execute(
        text("SELECT :expiry > NOW()"), {"expiry": approval["expires_at"]}
    ).scalar_one()
    if not valid:
        raise DiagnosticError("PLAN_STALE", "Human approval has expired")


def reserve_plan_approval(current, plan_id, job_id):
    current.execute(
        text(
            "UPDATE agent_plan_approvals SET reserved_job_id = :job WHERE plan_id = :id AND reserved_job_id IS NULL"
        ),
        {"id": plan_id, "job": job_id},
    )


def decide_plan(
    actor: dict,
    plan_id: str,
    *,
    decision: str,
    plan_version: str,
    content_hash: str,
    policy_revision: int,
    authorization_context_hash: str,
    session=None,
) -> dict:
    if decision not in {"approved", "rejected"}:
        raise DiagnosticError("INVALID_ARGUMENT", "Unsupported human decision")
    with optional_scope(session) as current:
        require_agent_human_capabilities(
            actor, {"agents.plans.approve", "agents.plans.review"}, session=current
        )
        initial = _get(current, plan_id)
        from crate.agent_operation_catalog import OPERATIONS

        capability = OPERATIONS.get(initial["operation"], (None, "library.repair.run"))[
            1
        ]
        require_agent_human_capabilities(
            actor,
            {"agents.plans.approve", "agents.plans.review", capability},
            session=current,
        )
        plan = _get(current, plan_id, lock=True)
        document = _document(plan)
        if decision == "approved" and document.get("executable") is False:
            raise DiagnosticError(
                "NOT_EXECUTABLE",
                "Manual plans can be rejected but cannot authorize execution",
            )
        policy = (
            current.execute(
                text(
                    "SELECT enabled, grants, policy_revision, require_approval, kind, human_owner_user_id FROM agent_principals WHERE id = :id FOR SHARE"
                ),
                {"id": plan["principal_id"]},
            )
            .mappings()
            .one()
        )
        if (
            not plan["unexpired"]
            or not policy["enabled"]
            or not set(plan["required_grants"]) <= set(policy["grants"])
            or policy["policy_revision"] != policy_revision
            or plan["policy_revision"] != policy_revision
            or not plan["approval_required"]
            or document["content_hash"] != content_hash
            or plan["version"] != plan_version
            or _hash(plan["authorization_context"]) != authorization_context_hash
        ):
            raise DiagnosticError(
                "PLAN_STALE", "The reviewed plan or policy is no longer current"
            )
        previous = (
            current.execute(
                text("SELECT * FROM agent_plan_approvals WHERE plan_id = :id"),
                {"id": plan["id"]},
            )
            .mappings()
            .first()
        )
        if previous:
            if (
                previous["decision"] == decision
                and previous["content_hash"] == content_hash
            ):
                return {key: _safe(value) for key, value in document.items()}
            raise DiagnosticError(
                "STATE_CONFLICT", "The plan already has a human decision"
            )
        if plan["state"] != "awaiting_approval":
            raise DiagnosticError("STATE_CONFLICT", "Plan is not awaiting human review")
        context = plan["authorization_context"]
        if context.get("human_actor_id") is not None:
            from crate.db.repositories.show_editor_access import authorize_show_editor

            owner = AgentPrincipal(
                str(plan["principal_id"]),
                "",
                "Admin show editor",
                frozenset(plan["required_grants"]),
                actor_user_id=context.get("actor_user_id"),
                human_actor_id=context["human_actor_id"],
            )
            authorize_show_editor(current, owner, policy, plan["required_grants"])
        elif context:
            from crate.db.repositories.mcp_oauth import delegated_authorization_grants

            grants = delegated_authorization_grants(
                context["authorization_id"],
                principal_id=str(plan["principal_id"]),
                actor_user_id=context["actor_user_id"],
                client_id=context["client_id"],
                accepted_scopes=context["accepted_scopes"],
                session=current,
                worker=True,
            )
            if not set(plan["required_grants"]) <= grants:
                raise DiagnosticError(
                    "FORBIDDEN", "The delegated operation is no longer authorized"
                )
        current.execute(
            text("""
            INSERT INTO agent_plan_approvals (plan_id, principal_id, plan_version, content_hash,
                authorization_context, policy_revision, decision, approved_by, expires_at)
            VALUES (:id, :principal, :version, :hash, CAST(:context AS jsonb), :policy, :decision, :user, :expiry)
        """),
            {
                "id": plan["id"],
                "principal": plan["principal_id"],
                "version": plan_version,
                "hash": content_hash,
                "context": json.dumps(context),
                "policy": policy_revision,
                "decision": decision,
                "user": actor["id"],
                "expiry": plan["expires_at"],
            },
        )
        state = "authorized" if decision == "approved" else "rejected"
        current.execute(
            text("UPDATE agent_repair_plans SET state = :state WHERE id = :id"),
            {"id": plan["id"], "state": state},
        )
        current.execute(
            text("""
            INSERT INTO audit_log (timestamp, user_id, action, target_type, target_name, details_json)
            VALUES (NOW(), :user, :action, 'agent_plan', :id, CAST(:details AS jsonb))
        """),
            {
                "user": actor["id"],
                "action": f"agent.plan.{decision}",
                "id": plan["id"],
                "details": json.dumps(
                    {
                        "principal_id": str(plan["principal_id"]),
                        "plan_id": plan["id"],
                        "plan_version": plan_version,
                        "content_hash": content_hash,
                        "policy_revision": policy_revision,
                        **context,
                    }
                ),
            },
        )
        return get_plan(plan["id"], session=current)


__all__ = [
    "count_pending_plans",
    "decide_plan",
    "get_plan",
    "get_owned_plan",
    "list_plans",
    "reserve_plan_approval",
    "validate_plan_authorization",
]

"""Native-only review receipts composed with the existing plan/admission transaction."""

import json
import os
import re
import secrets
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import text

from crate.agent_access import actions_enabled, authorization_context
from crate.agent_diagnostics import DiagnosticError
from crate.agent_operation_catalog import OPERATIONS
from crate.agent_telegram import plan_pages
from crate.db.repositories import agent_plans as plans
from crate.db.repositories import agent_requests as requests
from crate.db.repositories.agent_human_sessions import (
    TelegramHuman,
    require_agent_human_capabilities,
)
from crate.db.tx import optional_scope, read_scope


def _instance():
    value = os.environ.get("CRATE_AGENT_INSTANCE_ID", "")
    if not value or len(value) > 128:
        raise DiagnosticError(
            "UNAVAILABLE", "Native instance identity is not configured"
        )
    return value


def bind_human(actor, principal_id, telegram_user_id, *, session=None):
    """One-time authenticated Admin provisioning, always linked to that human."""
    if type(telegram_user_id) is not int or telegram_user_id <= 0:
        raise DiagnosticError(
            "INVALID_ARGUMENT", "A numeric private Telegram user is required"
        )
    principal_id = requests._uuid(principal_id)
    with optional_scope(session) as current:
        require_agent_human_capabilities(
            actor,
            {
                "agents.integrations.manage",
                "agents.plans.approve",
                "agents.plans.review",
            },
            session=current,
        )
        if (
            current.execute(
                text("SELECT id FROM agent_principals WHERE id=:id FOR UPDATE"),
                {"id": principal_id},
            ).first()
            is None
        ):
            raise DiagnosticError("NOT_FOUND", "Integration was not found")
        current.execute(
            text(
                "UPDATE agent_telegram_bindings SET revoked_at=NOW() WHERE instance_id=:instance AND principal_id=:principal AND revoked_at IS NULL"
            ),
            {"instance": _instance(), "principal": principal_id},
        )
        binding_id = str(uuid4())
        current.execute(
            text("""INSERT INTO agent_telegram_bindings
            (id,instance_id,principal_id,user_id,telegram_user_id,chat_id)
            VALUES (:id,:instance,:principal,:user,:telegram,:telegram)"""),
            {
                "id": binding_id,
                "instance": _instance(),
                "principal": principal_id,
                "user": actor["id"],
                "telegram": telegram_user_id,
            },
        )
        _audit(
            current,
            actor,
            "agent.telegram.bound",
            principal_id,
            {"binding_id": binding_id, "telegram_user_id": telegram_user_id},
        )
        return {
            "binding_id": binding_id,
            "instance_id": _instance(),
            "telegram_user_id": telegram_user_id,
        }


def list_bindings(*, principal_id=None, session=None) -> dict:
    """Active approver bindings of this instance; empty when it has no identity."""
    instance = os.environ.get("CRATE_AGENT_INSTANCE_ID", "")
    if not instance or len(instance) > 128:
        return {"instance_id": None, "items": []}
    principal = requests._uuid(principal_id) if principal_id else None

    def _read(current):
        return [
            dict(row)
            for row in current.execute(
                text("""
                SELECT b.id::text AS binding_id, b.principal_id::text AS principal_id,
                       p.name AS principal_name, b.user_id, u.username,
                       b.telegram_user_id, b.created_at
                FROM agent_telegram_bindings b
                JOIN agent_principals p ON p.id = b.principal_id
                LEFT JOIN users u ON u.id = b.user_id
                WHERE b.instance_id = :instance AND b.revoked_at IS NULL
                  AND (CAST(:principal AS uuid) IS NULL OR b.principal_id = CAST(:principal AS uuid))
                ORDER BY b.created_at DESC, b.id
                LIMIT 100
            """),
                {"instance": instance, "principal": principal},
            ).mappings()
        ]

    if session is not None:
        return {"instance_id": instance, "items": _read(session)}
    with read_scope() as current:
        return {"instance_id": instance, "items": _read(current)}


def revoke_binding(actor, binding_id, *, session=None) -> dict:
    """Remove an approver; its pending native confirmations can no longer approve."""
    binding_id = requests._uuid(binding_id)
    with optional_scope(session) as current:
        require_agent_human_capabilities(
            actor, {"agents.integrations.manage"}, session=current
        )
        row = (
            current.execute(
                text(
                    "UPDATE agent_telegram_bindings SET revoked_at=NOW() WHERE id=:id AND instance_id=:instance AND revoked_at IS NULL RETURNING principal_id::text, telegram_user_id"
                ),
                {"id": binding_id, "instance": _instance()},
            )
            .mappings()
            .first()
        )
        if row is None:
            raise DiagnosticError("NOT_FOUND", "Approver binding was not found")
        _audit(
            current,
            actor,
            "agent.telegram.unbound",
            row["principal_id"],
            {"binding_id": binding_id, "telegram_user_id": row["telegram_user_id"]},
        )
        return {"revoked": True}


def _audit(current, actor, action, principal_id, details):
    current.execute(
        text("""
        INSERT INTO audit_log (timestamp,user_id,action,target_type,target_name,details_json)
        VALUES (NOW(),:user,:action,'agent_principal',:principal,CAST(:details AS jsonb))
    """),
        {
            "user": actor["id"],
            "action": action,
            "principal": principal_id,
            "details": json.dumps({"principal_id": principal_id, **details}),
        },
    )


def _binding(current, binding_id):
    row = (
        current.execute(
            text(
                "SELECT * FROM agent_telegram_bindings WHERE id=:id AND revoked_at IS NULL AND instance_id=:instance FOR SHARE"
            ),
            {"id": binding_id, "instance": _instance()},
        )
        .mappings()
        .first()
    )
    if not row:
        raise DiagnosticError("FORBIDDEN", "Native human binding is unavailable")
    return row


def _actor(binding):
    return TelegramHuman(id=binding["user_id"], telegram_binding_id=str(binding["id"]))


def _identity(plan):
    return {
        key: plan[key]
        for key in (
            "plan_version",
            "content_hash",
            "policy_revision",
            "authorization_context_hash",
        )
    }


def approval_policy(principal, *, session=None):
    with optional_scope(session) as current:
        requests._authorize(current, principal, set())
        row = (
            current.execute(
                text(
                    "SELECT require_approval,policy_revision,grants FROM agent_principals WHERE id=:id"
                ),
                {"id": principal.id},
            )
            .mappings()
            .one()
        )
        from crate.operator_provenance import is_operator

        return {
            "operator_provenance_required": is_operator(principal.id),
            "principal_id": principal.id,
            "credential_id": principal.credential_id,
            "require_approval": row["require_approval"],
            "policy_revision": row["policy_revision"],
            "grants": sorted(set(row["grants"]) & principal.grants),
            "actions_enabled": actions_enabled(),
            "instance_id": os.environ.get("CRATE_AGENT_INSTANCE_ID"),
        }


def get_confirmation_status(principal, confirmation_id, *, session=None):
    """Bounded originating-integration read; never changes delivery or authority."""
    if not isinstance(confirmation_id, str) or not re.fullmatch(
        r"[a-f0-9]{32}", confirmation_id
    ):
        raise DiagnosticError(
            "INVALID_ARGUMENT", "An exact confirmation ID is required"
        )

    def read(current):
        row = (
            current.execute(
                text("""
            SELECT c.*, p.required_grants, b.revoked_at AS binding_revoked,
                   b.instance_id, b.principal_id::text AS principal_id
            FROM agent_telegram_confirmations c
            JOIN agent_telegram_bindings b ON b.id=c.binding_id
            JOIN agent_repair_plans p ON p.id=c.plan_id AND p.principal_id=b.principal_id
            WHERE c.id=:id AND b.principal_id=:principal AND b.instance_id=:instance
        """),
                {
                    "id": confirmation_id,
                    "principal": principal.id,
                    "instance": _instance(),
                },
            )
            .mappings()
            .first()
        )
        if (
            not row
            or row["binding_revoked"] is not None
            or str(row["credential_id"]) != principal.credential_id
            or row["origin"].get("principal_id") != principal.id
            or row["origin"].get("credential_id") != principal.credential_id
            or row["origin"].get("authorization_context")
            != authorization_context(principal)
        ):
            raise DiagnosticError("NOT_FOUND", "Owned confirmation is unavailable")
        requests._authorize(current, principal, row["required_grants"])
        result = row["result"]
        monitoring: dict[str, Any] = dict(
            (result or {}).get("monitoring")
            or {
                "state": "unverified"
                if (result or {}).get("job")
                else "not_applicable",
                "reason": "No native supervisor enrollment receipt",
            }
        )
        exhausted = row["delivery_attempts"] >= 20
        if monitoring["state"] == "confirmed":
            expires_at = monitoring.get("expires_at")
            if (
                isinstance(expires_at, bool)
                or not isinstance(expires_at, (int, float))
                or expires_at <= datetime.now(UTC).timestamp()
            ):
                monitoring.update(
                    state="unavailable", reason="Enrollment receipt expired or invalid"
                )
        if exhausted and monitoring["state"] == "unverified":
            monitoring.update(
                state="unavailable",
                reason="Native enrollment/delivery retries exhausted",
            )
        return {
            "confirmation_id": confirmation_id,
            "plan_id": str(row["plan_id"]),
            "state": row["state"],
            "result": {
                key: value for key, value in result.items() if key != "monitoring"
            }
            if result
            else None,
            "delivery": {
                "state": "delivered"
                if row["outcome_message_id"]
                else "exhausted"
                if exhausted
                else "pending",
                "attempts": row["delivery_attempts"],
                "max_attempts": 20,
                "retry_exhausted": exhausted,
            },
            "monitoring": monitoring,
        }

    if session is not None:
        return read(session)
    with read_scope() as current:
        return read(current)


def request_confirmation(
    principal, plan_id, plan_version, *, apply_after_approval=False, session=None
):
    if not actions_enabled():
        raise DiagnosticError("FORBIDDEN", "Domain actions are disabled")
    with optional_scope(session) as current:
        requests._authorize(current, principal, set())
        requests._lock_principal(current, principal.id)
        plan = plans._get(current, plan_id, lock=True)
        requests._authorize(current, principal, plan["required_grants"])
        policy = approval_policy(principal, session=current)
        if str(plan["principal_id"]) != principal.id or plan[
            "authorization_context"
        ] != authorization_context(principal):
            raise DiagnosticError(
                "FORBIDDEN", "Plan belongs to another integration authorization"
            )
        if (
            not policy["require_approval"]
            or not plan["approval_required"]
            or policy["policy_revision"] != plan["policy_revision"]
            or not plan["unexpired"]
            or plan["version"] != plan_version
        ):
            raise DiagnosticError(
                "PLAN_STALE", "An exact current approval-required plan is required"
            )
        existing = (
            current.execute(
                text("SELECT * FROM agent_telegram_confirmations WHERE plan_id=:id"),
                {"id": plan_id},
            )
            .mappings()
            .first()
        )
        if existing:
            if (
                str(existing["credential_id"]) != principal.credential_id
                or existing["apply_after_approval"] != apply_after_approval
            ):
                raise DiagnosticError(
                    "STATE_CONFLICT",
                    "Confirmation is bound to its original credential and apply choice",
                )
            return {"confirmation_id": existing["id"], "state": existing["state"]}
        if plan["state"] != "awaiting_approval":
            raise DiagnosticError("STATE_CONFLICT", "Plan is not awaiting approval")
        binding = (
            current.execute(
                text(
                    "SELECT * FROM agent_telegram_bindings WHERE principal_id=:principal AND instance_id=:instance AND revoked_at IS NULL FOR SHARE"
                ),
                {"principal": principal.id, "instance": _instance()},
            )
            .mappings()
            .first()
        )
        if not binding:
            raise DiagnosticError(
                "FORBIDDEN", "An independent native human binding is required"
            )
        require_agent_human_capabilities(
            _actor(binding),
            {
                "agents.plans.review",
                "agents.plans.approve",
                OPERATIONS.get(plan["operation"], (None, "library.repair.run"))[1],
            },
            session=current,
        )
        from crate.operator_provenance import validate

        validate(principal.id, plans._reviewed_provenance(plan))
        document = plans._document(plan, identity=True)
        confirmation_id = secrets.token_hex(16)
        pages = plan_pages(document, apply_after_approval=apply_after_approval)
        current.execute(
            text("""INSERT INTO agent_telegram_confirmations
            (id,binding_id,plan_id,credential_id,origin,identity,pages,apply_after_approval,apply_key,expires_at)
            VALUES (:id,:binding,:plan,:credential,CAST(:origin AS jsonb),CAST(:identity AS jsonb),CAST(:pages AS jsonb),:apply,:key,LEAST(:expiry,NOW()+INTERVAL '15 minutes'))"""),
            {
                "id": confirmation_id,
                "binding": binding["id"],
                "plan": plan_id,
                "credential": principal.credential_id,
                "origin": json.dumps(
                    {
                        "principal_id": principal.id,
                        "credential_id": principal.credential_id,
                        "required_grants": sorted(principal.grants),
                        "authorization_context": authorization_context(principal),
                    }
                ),
                "identity": json.dumps(_identity(document)),
                "pages": json.dumps(pages),
                "apply": apply_after_approval,
                "key": "telegram:" + confirmation_id,
                "expiry": plan["expires_at"],
            },
        )
        return {
            "confirmation_id": confirmation_id,
            "state": "pending",
            "page_count": len(pages),
        }


def _presentation(row, binding):
    index = row["page_index"]
    return {
        "confirmation_id": row["id"],
        "chat_id": binding["chat_id"],
        "page_index": index,
        "page_count": len(row["pages"]),
        "text": f"Exact plan — page {index + 1}/{len(row['pages'])}\n"
        + row["pages"][index],
    }


def native_event(event, transport_nonce, *, session=None):
    """Only the HMAC HTTP boundary calls this; model tools cannot construct events."""
    if event["instance_id"] != _instance():
        raise DiagnosticError("FORBIDDEN", "Wrong native instance")
    with optional_scope(session) as current:
        current.execute(text("SET LOCAL statement_timeout = '5s'"))
        current.execute(text("SET LOCAL lock_timeout = '2s'"))
        current.execute(
            text(
                "DELETE FROM agent_telegram_receipts WHERE created_at<NOW()-INTERVAL '1 day' AND update_id IS NULL AND query_id IS NULL"
            )
        )
        callback = event["kind"] == "callback"
        recorded = current.execute(
            text("""INSERT INTO agent_telegram_receipts
            (transport_nonce,instance_id,update_id,query_id) VALUES (:nonce,:instance,:update,:query)
            ON CONFLICT DO NOTHING RETURNING transport_nonce"""),
            {
                "nonce": transport_nonce,
                "instance": _instance(),
                "update": event.get("update_id") if callback else None,
                "query": event.get("query_id") if callback else None,
            },
        ).first()
        if recorded is None:
            raise DiagnosticError(
                "REPLAY",
                "Native update has already been consumed; inspect the plan/job",
            )
        current.execute(
            text(
                """UPDATE agent_telegram_confirmations SET state='expired',result='{"state":"expired"}'::jsonb,
                delivery_attempts=0,next_delivery_at=NOW()
                WHERE expires_at<=NOW() AND state IN ('pending','presented')"""
            )
        )
        if event["kind"] == "pending":
            row = (
                current.execute(
                    text("""SELECT c.* FROM agent_telegram_confirmations c
                JOIN agent_telegram_bindings b ON b.id=c.binding_id
                WHERE b.instance_id=:instance AND b.revoked_at IS NULL
                AND (c.state='pending' OR (c.result IS NOT NULL AND c.outcome_message_id IS NULL))
                AND c.delivery_attempts<20 AND c.next_delivery_at<=NOW()
                ORDER BY c.created_at LIMIT 1 FOR UPDATE OF c"""),
                    {"instance": _instance()},
                )
                .mappings()
                .first()
            )
            if not row:
                return {"state": "idle"}
            binding = _binding(current, row["binding_id"])
            current.execute(
                text(
                    "UPDATE agent_telegram_confirmations SET delivery_attempts=delivery_attempts+1,next_delivery_at=NOW()+INTERVAL '10 seconds' WHERE id=:id"
                ),
                {"id": row["id"]},
            )
            if row["result"] is not None:
                return {
                    "state": "outcome",
                    "confirmation_id": row["id"],
                    "chat_id": binding["chat_id"],
                    "result": row["result"],
                    "delivery_attempts": row["delivery_attempts"] + 1,
                    "max_delivery_attempts": 20,
                }
            return {"state": "page", **_presentation(row, binding)}
        row = (
            current.execute(
                text(
                    "SELECT * FROM agent_telegram_confirmations WHERE id=:id FOR UPDATE"
                ),
                {"id": event["confirmation_id"]},
            )
            .mappings()
            .first()
        )
        if not row:
            raise DiagnosticError("NOT_FOUND", "Confirmation is unavailable")
        # Same principal-before-binding order as provisioning and worker admission.
        current.execute(
            text(
                "SELECT p.id FROM agent_principals p JOIN agent_telegram_bindings b ON b.principal_id=p.id WHERE b.id=:binding FOR SHARE OF p"
            ),
            {"binding": row["binding_id"]},
        ).all()
        binding = _binding(current, row["binding_id"])
        if event["chat_id"] != binding["chat_id"]:
            raise DiagnosticError("FORBIDDEN", "Wrong private chat")
        if event["kind"] in {"watch_enrolled", "watch_unavailable"}:
            result = row["result"]
            if not result or (result.get("job") or {}).get("job_id") != event["job_id"]:
                raise DiagnosticError(
                    "STATE_CONFLICT", "Watch receipt must match the admitted job"
                )
            now = datetime.now(UTC).timestamp()
            expires = event.get("watch_expires_at")
            confirmed = event["kind"] == "watch_enrolled"
            if confirmed and (
                type(expires) not in (int, float)
                or not now < expires <= now + 72 * 3600
            ):
                raise DiagnosticError(
                    "INVALID_ARGUMENT", "Current bounded watch expiry required"
                )
            monitoring = {
                "state": "confirmed" if confirmed else "unavailable",
                "source": "native_supervisor_enrollment_receipt",
                "job_id": event["job_id"],
                "observed_at": datetime.now(UTC).isoformat(),
                "expires_at": expires if confirmed else None,
                "reason": "Enrollment acknowledged; live execution/verification remain separate"
                if confirmed
                else "Supervisor watch enrollment unavailable",
            }
            result = {**result, "monitoring": monitoring}
            current.execute(
                text(
                    "UPDATE agent_telegram_confirmations SET result=CAST(:result AS jsonb) WHERE id=:id"
                ),
                {"id": row["id"], "result": json.dumps(result)},
            )
            return {"state": "watch_recorded", "monitoring": monitoring}
        if event["kind"] == "outcome_delivered":
            if row["result"] is None:
                raise DiagnosticError(
                    "STATE_CONFLICT", "No native outcome is available"
                )
            current.execute(
                text(
                    "UPDATE agent_telegram_confirmations SET outcome_message_id=:message WHERE id=:id AND outcome_message_id IS NULL"
                ),
                {"message": event["message_id"], "id": row["id"]},
            )
            return {"state": "outcome_delivered"}
        if row["state"] == "expired":
            return {"state": "expired"}
        if event["kind"] == "delivered":
            if row["state"] != "pending" or event["page_index"] != row["page_index"]:
                raise DiagnosticError(
                    "STATE_CONFLICT", "Page delivery is no longer current"
                )
            current.execute(
                text(
                    "UPDATE agent_telegram_confirmations SET delivered_count=:count,message_id=:message,state='presented' WHERE id=:id"
                ),
                {
                    "count": row["page_index"] + 1,
                    "message": event["message_id"],
                    "id": row["id"],
                },
            )
            return {
                "state": "presented",
                "last_page": row["page_index"] + 1 == len(row["pages"]),
            }
        if (
            event["user_id"] != binding["telegram_user_id"]
            or event["chat_type"] != "private"
        ):
            raise DiagnosticError("FORBIDDEN", "Wrong native human identity")
        if event["message_id"] != row["message_id"] or row["state"] != "presented":
            raise DiagnosticError("STATE_CONFLICT", "Button is no longer current")
        if event["action"] == "next":
            if row["delivered_count"] >= len(row["pages"]):
                raise DiagnosticError(
                    "STATE_CONFLICT", "All pages were already presented"
                )
            current.execute(
                text(
                    "UPDATE agent_telegram_confirmations SET page_index=page_index+1,state='pending',message_id=NULL,delivery_attempts=0,next_delivery_at=NOW() WHERE id=:id"
                ),
                {"id": row["id"]},
            )
            return {"state": "next_page"}
        if event["action"] == "approve" and row["delivered_count"] != len(row["pages"]):
            raise DiagnosticError(
                "APPROVAL_REQUIRED", "Every exact plan page must be presented first"
            )
        decision = "approved" if event["action"] == "approve" else "rejected"
        actor = _actor(binding)
        plans.decide_plan(
            actor,
            str(row["plan_id"]),
            decision=decision,
            **row["identity"],
            session=current,
        )
        result: dict[str, Any] = {"state": decision, "plan_id": str(row["plan_id"])}
        if decision == "approved" and row["apply_after_approval"]:
            try:
                # A savepoint preserves the human decision on a revoked originating
                # credential; no job/effect survives failed admission.
                with current.begin_nested():
                    if not actions_enabled():
                        raise DiagnosticError(
                            "FORBIDDEN", "Domain actions are disabled"
                        )
                    principal = requests._principal_for_job(row["origin"])
                    plan = plans._get(current, str(row["plan_id"]))
                    if plan["operation"] == "repair_photo_flag":
                        job = requests.accept_apply(
                            principal,
                            str(row["plan_id"]),
                            row["identity"]["plan_version"],
                            row["apply_key"],
                            session=current,
                        )
                    else:
                        from crate.db.repositories.agent_operation_jobs import (
                            apply_operation,
                        )

                        job = apply_operation(
                            principal,
                            plan["operation"],
                            str(row["plan_id"]),
                            row["identity"]["plan_version"],
                            row["apply_key"],
                            session=current,
                        )
                    result["job"] = job
            except DiagnosticError as error:
                result.update(state="approved_apply_unavailable", reason=error.code)
        current.execute(
            text(
                "UPDATE agent_telegram_confirmations SET state=:state,result=CAST(:result AS jsonb),delivery_attempts=0,next_delivery_at=NOW() WHERE id=:id"
            ),
            {
                "id": row["id"],
                "state": result["state"],
                "result": json.dumps(result, default=str),
            },
        )
        return result


__all__ = [
    "approval_policy",
    "bind_human",
    "get_confirmation_status",
    "list_bindings",
    "native_event",
    "request_confirmation",
    "revoke_binding",
]

"""Immutable one-change plans prepared exclusively from persisted evidence."""

import json
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.agent_access import AgentPrincipal, authorization_context
from crate.agent_diagnostics import DiagnosticError
from crate.db.repositories.agent_requests import _audit, _authorize, _hash
from crate.db.tx import optional_scope


def preview_repair(
    principal: AgentPrincipal,
    issue_id: int,
    *,
    trace_id=None,
    session: Session | None = None,
) -> dict:
    if isinstance(issue_id, bool) or not isinstance(issue_id, int) or issue_id <= 0:
        raise DiagnosticError("INVALID_ARGUMENT", "Issue ID must be a positive integer")
    with optional_scope(session) as current:
        _authorize(current, principal, {"library.repair.photo_flag"})
        policy = (
            current.execute(
                text(
                    "SELECT policy_revision, require_approval FROM agent_principals WHERE id = :id FOR SHARE"
                ),
                {"id": principal.id},
            )
            .mappings()
            .one()
        )
        context = authorization_context(principal)
        row = (
            current.execute(
                text("""
            SELECT o.id::text, o.artist_uid::text, o.observation, o.observed_at,
                   a.name, a.folder_name, a.has_photo
            FROM agent_photo_observations o JOIN agent_jobs j ON j.task_id = o.task_id
            JOIN health_issues h ON h.id = o.issue_id
            JOIN library_artists a ON a.entity_uid = o.artist_uid
            WHERE o.issue_id = :issue_id AND j.principal_id = :principal_id
              AND o.observed_at >= NOW() - INTERVAL '15 minutes'
              AND h.status = 'open' AND h.check_type = 'has_photo_desync'
            ORDER BY o.observed_at DESC LIMIT 1
        """),
                {"issue_id": issue_id, "principal_id": principal.id},
            )
            .mappings()
            .first()
        )
        if row is None:
            raise DiagnosticError(
                "EVIDENCE_STALE",
                "Run a targeted health check with this integration before preparing a repair",
            )
        value = row["observation"]
        if (
            value["db_has_photo"] == value["fs_has_photo"]
            or row["name"] != value["name"]
            or row["folder_name"] != value["folder_name"]
            or bool(row["has_photo"]) != value["db_has_photo"]
        ):
            raise DiagnosticError(
                "EVIDENCE_STALE",
                "Artist changed after the observation; run its health check again",
            )
        plan_id = str(uuid4())
        version = _hash(
            {
                "id": plan_id,
                "principal_id": principal.id,
                "issue_id": issue_id,
                "observation_id": row["id"],
                "observation": value,
                "policy_revision": policy["policy_revision"],
                "authorization_context": context,
            }
        )
        saved = (
            current.execute(
                text("""
            INSERT INTO agent_repair_plans (id, principal_id, artist_uid, issue_id, observation_id,
                version, before_value, after_value, expires_at, state, approval_required, policy_revision, authorization_context)
            VALUES (:id, :principal_id, :artist_uid, :issue_id, :observation_id, :version, :before, :after, LEAST(NOW() + INTERVAL '15 minutes', :observed_at + INTERVAL '15 minutes'), :state, :approval_required, :policy_revision, CAST(:context AS jsonb))
            RETURNING created_at, expires_at
        """),
                {
                    "id": plan_id,
                    "principal_id": principal.id,
                    "artist_uid": row["artist_uid"],
                    "issue_id": issue_id,
                    "observation_id": row["id"],
                    "version": version,
                    "observed_at": row["observed_at"],
                    "before": value["db_has_photo"],
                    "after": value["fs_has_photo"],
                    "state": "awaiting_approval"
                    if policy["require_approval"]
                    else "ready",
                    "approval_required": policy["require_approval"],
                    "policy_revision": policy["policy_revision"],
                    "context": json.dumps(context),
                },
            )
            .mappings()
            .one()
        )
        _audit(
            current,
            principal,
            "agent.repair.previewed",
            artist_uid=row["artist_uid"],
            plan_id=plan_id,
            trace_id=trace_id,
        )
        from crate.db.repositories.agent_plans import get_plan

        return {
            **get_plan(plan_id, session=current),
            "plan_id": plan_id,
            "plan_version": version,
            "artist_uid": row["artist_uid"],
            "issue_id": issue_id,
            "check_type": "has_photo_desync",
            "before": {"has_photo": value["db_has_photo"]},
            "after": {"has_photo": value["fs_has_photo"]},
            "state": "awaiting_approval" if policy["require_approval"] else "ready",
            "created_at": saved["created_at"].isoformat(),
            "expires_at": saved["expires_at"].isoformat(),
            "observation_id": row["id"],
            "observed_at": row["observed_at"].isoformat(),
        }


__all__ = ["preview_repair"]

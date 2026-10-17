"""Durable cancellation requests, worker acknowledgement and task provenance."""

import json

from sqlalchemy import text

from crate.db.repositories.tasks_shared import register_tasks_surface_signal
from crate.db.tx import optional_scope, read_scope

_TERMINAL = {"completed", "failed", "cancelled"}


def _view(row, state, children=0):
    return {
        "task_id": row["id"],
        "status": row["status"],
        "cancellation_requested": row["cancellation_requested_at"] is not None,
        "request_state": state,
        "affected_children": children,
    }


def cancellation_requested(task_id: str, *, session=None) -> bool:
    def _read(current):
        return bool(
            current.execute(
                text("""SELECT status='cancelled' OR cancellation_requested_at IS NOT NULL
            FROM tasks WHERE id=:id"""),
                {"id": task_id},
            ).scalar_one_or_none()
        )

    if session is not None:
        return _read(session)
    with read_scope() as current:
        return _read(current)


def request_cancellation(
    task_id: str, *, actor_user_id=None, principal_id=None, session=None
) -> dict:
    from crate.agent_diagnostics import DiagnosticError

    with optional_scope(session) as current:
        root = (
            current.execute(
                text("SELECT * FROM tasks WHERE id=:id FOR UPDATE"), {"id": task_id}
            )
            .mappings()
            .first()
        )
        if root is None:
            raise DiagnosticError("NOT_FOUND", "Task was not found")
        if root["status"] in _TERMINAL:
            return _view(root, "already_terminal")
        if root["status"] == "completing":
            raise DiagnosticError(
                "STATE_CONFLICT", "Task finalization cannot be cancelled"
            )
        descendants = list(
            current.execute(
                text("""WITH RECURSIVE tree AS (
            SELECT id,parent_task_id,0 AS depth,ARRAY[id] AS path FROM tasks WHERE id=:id
            UNION ALL SELECT t.id,t.parent_task_id,p.depth+1,p.path||t.id
            FROM tasks t JOIN tree p ON t.parent_task_id=p.id
            WHERE p.depth<17 AND NOT t.id=ANY(p.path)
            ) SELECT t.*,tree.depth FROM tasks t JOIN tree ON tree.id=t.id
            ORDER BY tree.depth,t.id LIMIT 201 FOR UPDATE OF t"""),
                {"id": task_id},
            ).mappings()
        )
        if len(descendants) > 200 or any(row["depth"] > 16 for row in descendants):
            raise DiagnosticError(
                "LIMIT_EXCEEDED", "Task cancellation exceeds its descendant budget"
            )
        if any(row["status"] == "completing" for row in descendants):
            raise DiagnosticError(
                "STATE_CONFLICT",
                "A child is already finalizing; retry after it finishes",
            )
        active = [row["id"] for row in descendants if row["status"] not in _TERMINAL]
        empty_result = json.dumps(
            {
                "status": "cancelled",
                "execution": {"status": "cancelled", "effects": "not_started"},
                "verification": {"status": "not_required"},
            }
        )
        current.execute(
            text("""UPDATE tasks SET
            cancellation_actor_user_id=CASE WHEN cancellation_requested_at IS NULL THEN :actor ELSE cancellation_actor_user_id END,
            cancellation_principal_id=CASE WHEN cancellation_requested_at IS NULL THEN CAST(:principal AS uuid) ELSE cancellation_principal_id END,
            cancellation_requested_at=COALESCE(cancellation_requested_at,NOW()),
            cancellation_acknowledged_at=CASE WHEN status='pending' THEN NOW() ELSE cancellation_acknowledged_at END,
            result_json=CASE WHEN status='pending' THEN CAST(:result AS jsonb) ELSE result_json END,
            status=CASE WHEN status='pending' THEN 'cancelled' ELSE status END,updated_at=NOW()
            WHERE id=ANY(:ids)"""),
            {
                "actor": actor_user_id,
                "principal": principal_id,
                "ids": active,
                "result": empty_result,
            },
        )
        for descendant in reversed(descendants):
            if descendant["status"] == "delegated":
                acknowledge_cancellation(descendant["id"], session=current)
        register_tasks_surface_signal(current)
        row = (
            current.execute(text("SELECT * FROM tasks WHERE id=:id"), {"id": task_id})
            .mappings()
            .one()
        )
        return _view(
            row,
            "cancelled" if row["status"] == "cancelled" else "cancellation_requested",
            max(0, len(active) - 1),
        )


def acknowledge_cancellation(task_id: str, result=None, *, session=None) -> dict | None:
    with optional_scope(session) as current:
        row = (
            current.execute(
                text("SELECT * FROM tasks WHERE id=:id FOR UPDATE"), {"id": task_id}
            )
            .mappings()
            .first()
        )
        if row is None or row["cancellation_requested_at"] is None:
            return None
        if row["status"] in _TERMINAL:
            return _view(row, "already_terminal")
        active_child = current.execute(
            text(
                "SELECT 1 FROM tasks WHERE parent_task_id=:id AND status NOT IN ('completed','failed','cancelled') LIMIT 1"
            ),
            {"id": task_id},
        ).scalar_one_or_none()
        if active_child:
            return None
        children = [
            dict(child)
            for child in current.execute(
                text(
                    "SELECT id,status FROM tasks WHERE parent_task_id=:id ORDER BY id"
                ),
                {"id": task_id},
            ).mappings()
        ]
        evidence = dict(result or row["result_json"] or {})
        evidence["status"] = "cancelled"
        evidence["execution"] = {
            "status": "partial" if row["started_at"] else "cancelled",
            "effects": "may_be_partial_or_complete"
            if row["started_at"]
            else "not_started",
            **(evidence.get("execution") or {}),
        }
        evidence["verification"] = {
            "status": "manual_reconciliation_required"
            if row["started_at"]
            else "not_required",
            **(evidence.get("verification") or {}),
        }
        if children:
            evidence["children"] = children
        current.execute(
            text("""UPDATE tasks SET status='cancelled',cancellation_acknowledged_at=NOW(),
            result_json=CAST(:result AS jsonb),heartbeat_at=NULL,worker_id=NULL,updated_at=NOW()
            WHERE id=:id"""),
            {"id": task_id, "result": json.dumps(evidence, default=str)},
        )
        register_tasks_surface_signal(current)
        return {
            "task_id": task_id,
            "status": "cancelled",
            "cancellation_requested": True,
            "request_state": "cancelled",
            "result": evidence,
        }


def record_task_provenance(
    task_id: str,
    *,
    origin="unknown",
    actor_user_id=None,
    agent_context=None,
    required_grants=None,
    retry_of=None,
    schedule_name=None,
    session=None,
) -> None:
    if origin not in {"unknown", "admin", "agent", "scheduler", "worker"}:
        raise ValueError("Unsupported task origin")
    context = agent_context or {}
    with optional_scope(session) as current:
        root, depth = task_id, 0
        if retry_of:
            previous = (
                current.execute(
                    text(
                        "SELECT COALESCE(retry_root,id) AS root,retry_depth FROM tasks WHERE id=:id"
                    ),
                    {"id": retry_of},
                )
                .mappings()
                .one()
            )
            root, depth = previous["root"], previous["retry_depth"] + 1
        current.execute(
            text("""UPDATE tasks SET origin=:origin,actor_user_id=:actor,
            origin_principal_id=CAST(:principal AS uuid),origin_context=CAST(:context AS jsonb),
            required_grants=:grants,retry_of=:retry_of,retry_root=:root,retry_depth=:depth,schedule_name=:schedule
            WHERE id=:id"""),
            {
                "id": task_id,
                "origin": origin,
                "actor": actor_user_id,
                "principal": context.get("principal_id"),
                "context": json.dumps(context) if context else None,
                "grants": sorted(required_grants or []),
                "retry_of": retry_of,
                "root": root,
                "depth": depth,
                "schedule": schedule_name,
            },
        )


__all__ = [
    "request_cancellation",
    "acknowledge_cancellation",
    "cancellation_requested",
    "record_task_provenance",
]

"""Human-owned prepared repair jobs, consumed once by an exact selection."""

from __future__ import annotations

import json
from collections.abc import Callable
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from crate.api.permissions import get_user_capabilities
from crate.db.repositories.auth_user_accounts import get_user_by_id
from crate.db.repositories.tasks import create_task
from crate.db.tx import optional_scope, read_scope
from crate.repair_selection import select_repair_items


def _authority(current, actor_user_id: int) -> None:
    current.execute(
        text("SELECT id FROM users WHERE id=:id FOR SHARE"), {"id": actor_user_id}
    ).all()
    current.execute(
        text("SELECT role FROM user_roles WHERE user_id=:id FOR SHARE"),
        {"id": actor_user_id},
    ).all()
    user = get_user_by_id(actor_user_id, session=current)
    if (
        not user
        or (user.get("status") or "active") != "active"
        or "library.repair.run" not in get_user_capabilities(user)
    ):
        raise ValueError("Repair permission is no longer available")


def _preparation(current, task_id: str, actor_user_id: int, *, locked=False) -> dict:
    row = (
        current.execute(
            text(
                "SELECT t.*,p.payload AS repair_payload,p.expires_at AS preparation_expires_at FROM tasks t LEFT JOIN admin_repair_preparations p ON p.task_id=t.id WHERE t.id=:id"
                + (" FOR UPDATE OF t" if locked else "")
            ),
            {"id": task_id},
        )
        .mappings()
        .first()
    )
    if (
        not row
        or row["type"] != "prepare_library_repairs"
        or (row["params_json"] or {}).get("actor_user_id") != actor_user_id
    ):
        raise ValueError("Repair preparation was not found")
    created_at = row["created_at"]
    if isinstance(created_at, str):
        created_at = datetime.fromisoformat(created_at)
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) - created_at > timedelta(hours=1):
        raise ValueError("Repair preparation expired; prepare a new plan")
    if row.get("preparation_expires_at") and row[
        "preparation_expires_at"
    ] <= datetime.now(timezone.utc):
        raise ValueError("Repair preparation expired; prepare a new plan")
    return dict(row)


def read_admin_repair_preparation(
    task_id: str, actor_user_id: int, *, session=None
) -> dict:
    def read(current):
        _authority(current, actor_user_id)
        row = _preparation(current, task_id, actor_user_id)
        result = row.get("repair_payload") or {}
        return {
            "task_id": task_id,
            "preparation_task_id": task_id,
            "status": row["status"],
            "artist": (row["params_json"] or {}).get("artist", ""),
            **(result.get("preview") or {}),
            "error": "Repair preparation failed"
            if row["status"] in {"failed", "cancelled"}
            else None,
            "result": result.get("execution_result"),
        }

    if session is not None:
        return read(session)
    with read_scope() as current:
        return read(current)


def accept_admin_repair_selection(
    task_id: str,
    actor_user_id: int,
    *,
    plan_version: str,
    plan_item_ids: list[str],
    confirm_risky: bool,
    session=None,
) -> str:
    with optional_scope(session) as current:
        _authority(current, actor_user_id)
        row = _preparation(current, task_id, actor_user_id, locked=True)
        if row["status"] != "completed":
            raise ValueError("Repair preparation is not complete")
        result = row["repair_payload"] or {}
        select_repair_items(
            result["preview"],
            plan_item_ids,
            expected_version=plan_version,
            confirm_risky=confirm_risky,
        )
        selection = {
            "plan_version": plan_version,
            "plan_item_ids": sorted(plan_item_ids),
            "confirm_risky": confirm_risky,
        }
        if result.get("consumed_by"):
            if result.get("selection") != selection:
                raise ValueError(
                    "Repair preparation was already used for another selection"
                )
            return result["consumed_by"]
        queued = create_task(
            "repair",
            {
                "preparation_task_id": task_id,
                "actor_user_id": actor_user_id,
                **selection,
            },
            session=current,
        )
        result.update(consumed_by=queued, selection=selection)
        current.execute(
            text(
                "UPDATE admin_repair_preparations SET payload=CAST(:result AS jsonb) WHERE task_id=:id"
            ),
            {"id": task_id, "result": json.dumps(result, default=str)},
        )
        return queued


def load_admin_repair_execution(
    task_id: str, preparation_task_id: str, actor_user_id: int, *, session=None
) -> dict:
    with optional_scope(session) as current:
        _authority(current, actor_user_id)
        row = _preparation(current, preparation_task_id, actor_user_id, locked=True)
        result = row["repair_payload"] or {}
        if row["status"] != "completed" or result.get("consumed_by") != task_id:
            raise ValueError("Repair selection is not authorized for this task")
        if result.get("execution_result"):
            return {"result": result["execution_result"]}
        if result.get("effect_started"):
            return {
                "result": {
                    "status": "partial",
                    "error": "A previous delivery may have started effects; prepare a fresh plan after reconciliation",
                    "verification": {"status": "manual_reconciliation_required"},
                }
            }
        selected = select_repair_items(
            result["preview"],
            result["selection"]["plan_item_ids"],
            expected_version=result["selection"]["plan_version"],
            confirm_risky=result["selection"]["confirm_risky"],
        )
        ids = {item["issue_id"] for item in selected}
        execution = {
            "executable": True,
            "items": [
                item
                for item in result["compiled"]["execution"]["items"]
                if item["issue_id"] in ids
            ],
        }
        if len(execution["items"]) != len(ids):
            raise ValueError("Prepared repair selection is incomplete")
        result["effect_started"] = True
        current.execute(
            text(
                "UPDATE admin_repair_preparations SET payload=CAST(:result AS jsonb) WHERE task_id=:id"
            ),
            {"id": preparation_task_id, "result": json.dumps(result, default=str)},
        )
        return {"execution": execution, "selected": selected}


def with_admin_repair_authority(actor_user_id: int, effect: Callable, *, session=None):
    with optional_scope(session) as current:
        _authority(current, actor_user_id)
        return effect()


def finish_admin_repair_execution(
    task_id: str, preparation_task_id: str, result: dict, *, session=None
) -> dict:
    with optional_scope(session) as current:
        row = current.execute(
            text(
                "SELECT p.payload FROM admin_repair_preparations p JOIN tasks t ON t.id=p.task_id WHERE t.id=:id FOR UPDATE OF t"
            ),
            {"id": preparation_task_id},
        ).scalar_one()
        if row.get("consumed_by") != task_id:
            raise ValueError("Repair execution owner changed")
        if row.get("execution_result"):
            return row["execution_result"]
        row["execution_result"] = result
        current.execute(
            text(
                "UPDATE admin_repair_preparations SET payload=CAST(:result AS jsonb) WHERE task_id=:id"
            ),
            {"id": preparation_task_id, "result": json.dumps(row, default=str)},
        )
        return result


def store_admin_repair_preparation(
    task_id: str, actor_user_id: int, payload: dict, *, session=None
) -> dict:
    with optional_scope(session) as current:
        _authority(current, actor_user_id)
        _preparation(current, task_id, actor_user_id, locked=True)
        current.execute(
            text(
                "INSERT INTO admin_repair_preparations(task_id,actor_user_id,payload) VALUES (:id,:actor,CAST(:payload AS jsonb)) ON CONFLICT(task_id) DO NOTHING"
            ),
            {
                "id": task_id,
                "actor": actor_user_id,
                "payload": json.dumps(payload, default=str),
            },
        )
        return current.execute(
            text("SELECT payload FROM admin_repair_preparations WHERE task_id=:id"),
            {"id": task_id},
        ).scalar_one()["preview"]


__all__ = [
    "read_admin_repair_preparation",
    "accept_admin_repair_selection",
    "load_admin_repair_execution",
    "with_admin_repair_authority",
    "finish_admin_repair_execution",
    "store_admin_repair_preparation",
]

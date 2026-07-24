"""Admin APIs for the canonical global catalog."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from crate.api.permissions import require_permission
from crate.db.queries.admin_global_catalog import (
    get_global_catalog_admin_status,
    list_global_catalog_duplicate_candidates,
    list_global_catalog_runs,
)
from crate.db.repositories.tasks import create_task_dedup
from crate.federation.global_decisions import record_match_decision

router = APIRouter(prefix="/api/admin/global-catalog", tags=["admin"])


class ReconcileRequest(BaseModel):
    mode: str = Field("incremental", pattern="^(incremental|full)$")


class DecisionRequest(BaseModel):
    entity_type: str
    decision_type: str
    source_a: dict[str, Any]
    source_b: dict[str, Any]
    target_global_uid: str | None = None
    reason: str | None = None


@router.get("/status")
def global_catalog_status(request: Request):
    require_permission(request, "federation.nodes.view")
    return get_global_catalog_admin_status()


@router.get("/runs")
def global_catalog_runs(request: Request, limit: int = 25):
    require_permission(request, "federation.nodes.view")
    return {"items": list_global_catalog_runs(limit=limit)}


@router.get("/duplicates")
def global_catalog_duplicates(request: Request, limit: int = 50):
    require_permission(request, "federation.nodes.view")
    return {"items": list_global_catalog_duplicate_candidates(limit=limit)}


@router.post("/reconcile")
def global_catalog_reconcile(request: Request, body: ReconcileRequest):
    require_permission(request, "federation.policy.manage")
    task_type = (
        "global_catalog_reconcile_full"
        if body.mode == "full"
        else "global_catalog_reconcile_incremental"
    )
    task_id = create_task_dedup(
        task_type,
        {"triggered_by": "admin"},
        dedup_key=f"manual:{task_type}",
    )
    return {"task_id": task_id, "status": "queued"}


@router.post("/decisions")
def global_catalog_decision(request: Request, body: DecisionRequest):
    user = require_permission(request, "federation.policy.manage")
    return record_match_decision(
        entity_type=body.entity_type,
        decision_type=body.decision_type,
        source_a=body.source_a,
        source_b=body.source_b,
        target_global_uid=body.target_global_uid,
        reason=body.reason,
        admin_user_id=int(user["id"]),
    )


__all__ = [
    "get_global_catalog_admin_status",
    "list_global_catalog_duplicate_candidates",
    "list_global_catalog_runs",
    "router",
]

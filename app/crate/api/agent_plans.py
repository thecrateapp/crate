"""Complete exact-plan review by independent human cookie sessions."""

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from crate.api.agent_guards import require_agent_admin_session
from crate.api.agent_integrations import (
    invoke,
    private_response,
)
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES
from crate.api.schemas import (
    AgentCollectionResponse,
    AgentPlanCountsResponse,
    PlanDecision,
)
from crate.db.repositories import agent_plans as store
from crate.agent_operation_catalog import OPERATIONS

router = APIRouter(
    prefix="/api/admin/agent-plans",
    tags=["agents"],
    dependencies=[Depends(private_response)],
)


def _reviewer(request, capability="agents.plans.review"):
    actor = require_agent_admin_session(request, capability)
    if "agents.plans.review" not in actor["capabilities"]:
        raise HTTPException(403, "Plan domain permission is required")
    return actor


def _visible_operations(actor) -> list[str]:
    operations = [
        operation
        for operation, (_grant, capability) in OPERATIONS.items()
        if capability in actor["capabilities"]
    ]
    if "library.repair.run" in actor["capabilities"]:
        operations.append("repair_photo_flag")
    return operations


@router.get(
    "",
    response_model=AgentCollectionResponse,
    responses=AUTH_ERROR_RESPONSES,
    openapi_extra={"security": [{"cookieAuth": []}]},
    summary="List persisted agent plans awaiting human review",
)
def plans(
    request: Request,
    state: str | None = Query(None, max_length=40),
    view: Literal["pending", "history"] | None = Query(None),
    limit: int = Query(20, ge=1, le=100),
    cursor: UUID | None = None,
):
    actor = _reviewer(request)
    rows = store.list_plans(
        state=state,
        view=view,
        limit=limit + 1,
        before=str(cursor) if cursor else None,
        operations=_visible_operations(actor),
    )
    return {
        "items": rows[:limit],
        "next_cursor": rows[limit - 1]["plan_id"] if len(rows) > limit else None,
    }


@router.get(
    "/summary",
    response_model=AgentPlanCountsResponse,
    responses=AUTH_ERROR_RESPONSES,
    openapi_extra={"security": [{"cookieAuth": []}]},
    summary="Count agent plans waiting for this reviewer",
)
def plans_summary(request: Request):
    actor = _reviewer(request)
    return {
        "awaiting_approval": store.count_pending_plans(
            operations=_visible_operations(actor)
        )
    }


@router.get(
    "/{plan_id}",
    response_model=dict,
    responses=AUTH_ERROR_RESPONSES,
    openapi_extra={"security": [{"cookieAuth": []}]},
    summary="Read the full exact plan, sources, impact and approval identity",
)
def plan(request: Request, plan_id: UUID):
    actor = _reviewer(request)
    document = invoke(store.get_plan, str(plan_id))
    capability = OPERATIONS.get(document["operation"], (None, "library.repair.run"))[1]
    if capability not in actor["capabilities"]:
        raise HTTPException(403, "Plan domain permission is required")
    return document


@router.post(
    "/{plan_id}/approve",
    response_model=dict,
    responses=AUTH_ERROR_RESPONSES,
    openapi_extra={"security": [{"cookieAuth": []}]},
    summary="Approve exactly the reviewed plan and current policy",
)
def approve_plan(request: Request, plan_id: UUID, body: PlanDecision):
    actor = _reviewer(request, "agents.plans.approve")
    return invoke(
        store.decide_plan, actor, str(plan_id), decision="approved", **body.model_dump()
    )


@router.post(
    "/{plan_id}/reject",
    response_model=dict,
    responses=AUTH_ERROR_RESPONSES,
    openapi_extra={"security": [{"cookieAuth": []}]},
    summary="Reject exactly the reviewed agent plan",
)
def reject_plan(request: Request, plan_id: UUID, body: PlanDecision):
    actor = _reviewer(request, "agents.plans.approve")
    return invoke(
        store.decide_plan, actor, str(plan_id), decision="rejected", **body.model_dump()
    )

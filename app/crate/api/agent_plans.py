"""Complete exact-plan review by independent human cookie sessions."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from crate.api.agent_guards import require_agent_admin_session
from crate.api.agent_integrations import (
    invoke,
    private_response,
)
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES
from crate.api.schemas import AgentCollectionResponse, PlanDecision
from crate.db.repositories import agent_plans as store

router = APIRouter(
    prefix="/api/admin/agent-plans",
    tags=["agents"],
    dependencies=[Depends(private_response)],
)


def _reviewer(request, capability="agents.plans.review"):
    actor = require_agent_admin_session(request, capability)
    if (
        "library.repair.run" not in actor["capabilities"]
        or "agents.plans.review" not in actor["capabilities"]
    ):
        raise HTTPException(403, "Plan domain permission is required")
    return actor


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
    limit: int = Query(20, ge=1, le=100),
    cursor: UUID | None = None,
):
    _reviewer(request)
    rows = store.list_plans(
        state=state, limit=limit + 1, before=str(cursor) if cursor else None
    )
    return {
        "items": rows[:limit],
        "next_cursor": rows[limit - 1]["plan_id"] if len(rows) > limit else None,
    }


@router.get(
    "/{plan_id}",
    response_model=dict,
    responses=AUTH_ERROR_RESPONSES,
    openapi_extra={"security": [{"cookieAuth": []}]},
    summary="Read the full exact plan, sources, impact and approval identity",
)
def plan(request: Request, plan_id: UUID):
    _reviewer(request)
    return invoke(store.get_plan, str(plan_id))


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

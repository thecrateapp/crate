"""Administrative controls for optional external-feed AI enrichment."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from crate.api.openapi_responses import (
    AUTH_ERROR_RESPONSES,
    error_response,
    merge_responses,
)
from crate.api.permissions import require_permission
from crate.api.schemas.common import TaskEnqueueResponse
from crate.db.repositories.external_feeds import (
    apply_external_feed_cluster_enrichment,
    apply_external_feed_show_enrichment,
    get_external_feed_enrichment,
    get_external_feed_item,
    list_external_feed_enrichments_for_review,
    revert_external_feed_cluster_enrichment,
    review_external_feed_enrichment,
)
from crate.db.repositories.tasks import (
    create_task_dedup,
    find_active_task_by_type_params,
)
from crate.feeds.ai_enrichment import ai_enrichment_enabled


router = APIRouter(prefix="/api/admin/external-feeds", tags=["external-feeds"])

_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        404: error_response("The external feed item was not found."),
        409: error_response("Enrichment is already running."),
        503: error_response("External feed AI enrichment is disabled."),
    },
)


class ExternalFeedEnrichmentRequest(BaseModel):
    operation: Literal["summary", "classify", "cluster", "extract_show"] = "summary"
    language: str = Field(default="English", min_length=2, max_length=40)


class ExternalFeedReviewRequest(BaseModel):
    decision: Literal["accept", "reject"]
    rejection_reason: str | None = Field(default=None, max_length=1000)


@router.get(
    "/enrichments/review",
    responses=AUTH_ERROR_RESPONSES,
    summary="List current external feed AI proposals for review",
)
def list_external_feed_review_queue(
    request: Request,
    review_status: Literal["pending", "accepted", "rejected"] | None = "pending",
    limit: int = 100,
):
    require_permission(request, "library.metadata.write")
    return {
        "items": list_external_feed_enrichments_for_review(
            review_status=review_status, limit=limit
        )
    }


@router.get(
    "/enrichments/{enrichment_id}",
    responses=_RESPONSES,
    summary="Get one external feed AI proposal",
)
def get_external_feed_review_item(request: Request, enrichment_id: int):
    require_permission(request, "library.metadata.write")
    enrichment = get_external_feed_enrichment(enrichment_id)
    if enrichment is None:
        raise HTTPException(status_code=404, detail="Enrichment not found")
    return enrichment


@router.post(
    "/enrichments/{enrichment_id}/review",
    responses=merge_responses(
        AUTH_ERROR_RESPONSES,
        {
            404: error_response("The enrichment is missing or no longer current."),
            422: error_response("A rejection reason is required."),
        },
    ),
    summary="Accept or reject an external feed AI proposal",
)
def review_external_feed(
    request: Request,
    enrichment_id: int,
    body: ExternalFeedReviewRequest,
):
    user = require_permission(request, "library.metadata.write")
    try:
        enrichment = review_external_feed_enrichment(
            enrichment_id,
            reviewer_id=int(user["id"]),
            decision=body.decision,
            rejection_reason=body.rejection_reason,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if enrichment is None:
        raise HTTPException(
            status_code=404,
            detail="Enrichment is missing, failed, or no longer current",
        )
    return enrichment


@router.post(
    "/enrichments/{enrichment_id}/apply-shows",
    responses=merge_responses(
        AUTH_ERROR_RESPONSES,
        {
            404: error_response("The enrichment is missing."),
            422: error_response("The show proposal cannot be applied."),
        },
    ),
    summary="Apply an accepted external feed show proposal",
)
def apply_external_feed_shows(request: Request, enrichment_id: int):
    user = require_permission(request, "library.metadata.write")
    try:
        result = apply_external_feed_show_enrichment(
            enrichment_id,
            applied_by_user_id=int(user["id"]),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=404, detail="Enrichment not found")
    return result


@router.post(
    "/enrichments/{enrichment_id}/apply-cluster",
    responses=merge_responses(
        AUTH_ERROR_RESPONSES,
        {
            404: error_response("The enrichment is missing."),
            422: error_response("The cluster proposal cannot be applied."),
        },
    ),
    summary="Hide the related items from an accepted external feed cluster",
)
def apply_external_feed_cluster(request: Request, enrichment_id: int):
    user = require_permission(request, "library.metadata.write")
    try:
        result = apply_external_feed_cluster_enrichment(
            enrichment_id,
            applied_by_user_id=int(user["id"]),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=404, detail="Enrichment not found")
    return result


@router.post(
    "/enrichments/{enrichment_id}/revert-cluster",
    responses=merge_responses(
        AUTH_ERROR_RESPONSES,
        {
            404: error_response("The enrichment is missing."),
            422: error_response("The cluster application cannot be reverted."),
        },
    ),
    summary="Restore the related items hidden by an external feed cluster",
)
def revert_external_feed_cluster(request: Request, enrichment_id: int):
    user = require_permission(request, "library.metadata.write")
    try:
        result = revert_external_feed_cluster_enrichment(
            enrichment_id,
            reverted_by_user_id=int(user["id"]),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=404, detail="Enrichment not found")
    return result


@router.post(
    "/items/{item_id}/enrich",
    response_model=TaskEnqueueResponse,
    responses=_RESPONSES,
    summary="Queue AI enrichment for an external feed item",
)
def enrich_external_feed_item(
    request: Request,
    item_id: int,
    body: ExternalFeedEnrichmentRequest | None = None,
):
    require_permission(request, "library.metadata.write")
    if not ai_enrichment_enabled():
        raise HTTPException(
            status_code=503,
            detail="External feed AI enrichment is disabled",
        )

    item = get_external_feed_item(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="External feed item not found")

    payload = body or ExternalFeedEnrichmentRequest()
    language = payload.language.strip() or "English"
    operation = payload.operation
    dedup_key = (
        f"external-feed-enrichment:{item_id}:{operation}:"
        f"{item['content_hash']}:{language.casefold()}"
    )
    params = {
        "item_id": item_id,
        "operation": operation,
        "language": language,
    }
    task_id = create_task_dedup(
        "external_feeds_enrich_item",
        params,
        dedup_key=dedup_key,
    )
    if task_id is None:
        task_id = find_active_task_by_type_params(
            "external_feeds_enrich_item", dedup_key=dedup_key
        )
    if task_id is None:
        raise HTTPException(status_code=409, detail="Enrichment is already running")
    return {"task_id": task_id}


__all__ = [
    "ExternalFeedEnrichmentRequest",
    "ExternalFeedReviewRequest",
    "apply_external_feed_cluster",
    "apply_external_feed_shows",
    "enrich_external_feed_item",
    "get_external_feed_review_item",
    "list_external_feed_review_queue",
    "review_external_feed",
    "revert_external_feed_cluster",
    "router",
]

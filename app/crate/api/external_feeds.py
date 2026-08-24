"""Administrative controls for optional external-feed AI enrichment."""

from __future__ import annotations

import logging
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
    list_external_feed_sources,
    list_external_feed_items_for_source,
    list_external_feed_enrichments_for_review,
    mark_external_feed_source_due,
    revert_external_feed_cluster_enrichment,
    review_external_feed_enrichment,
    update_external_feed_source,
    upsert_external_feed_source,
)
from crate.db.repositories.tasks import (
    create_task_dedup,
    find_active_task_by_type_params,
)
from crate.feeds.ai_enrichment import ai_enrichment_enabled
from crate.feeds.editorial import validate_editorial_feed_url


router = APIRouter(prefix="/api/admin/external-feeds", tags=["external-feeds"])
log = logging.getLogger(__name__)

_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        404: error_response("The external feed item was not found."),
        409: error_response("Enrichment is already running."),
        503: error_response("External feed AI enrichment is disabled."),
    },
)


class ExternalFeedEnrichmentRequest(BaseModel):
    operation: Literal[
        "summary", "classify", "cluster", "extract_show", "associate_artist"
    ] = "summary"
    language: str = Field(default="English", min_length=2, max_length=40)


class ExternalFeedReviewRequest(BaseModel):
    decision: Literal["accept", "reject"]
    rejection_reason: str | None = Field(default=None, max_length=1000)


class PublisherFeedSourceCreateRequest(BaseModel):
    source_url: str = Field(min_length=1, max_length=2048)
    canonical_url: str | None = Field(default=None, max_length=2048)
    display_name: str = Field(min_length=1, max_length=160)
    publisher_name: str | None = Field(default=None, max_length=160)
    category: str | None = Field(default=None, max_length=80)
    language: str = Field(
        default="en", min_length=2, max_length=3, pattern=r"^[a-zA-Z]{2,3}$"
    )
    logo_url: str | None = Field(default=None, max_length=2048)
    terms_url: str | None = Field(default=None, max_length=2048)
    ai_policy: Literal["enabled", "manual", "disabled"] = "enabled"
    refresh_interval_seconds: int = Field(default=86400, ge=300, le=604800)


class PublisherFeedSourceUpdateRequest(BaseModel):
    state: Literal["active", "disabled"] | None = None
    display_name: str | None = Field(default=None, min_length=1, max_length=160)
    publisher_name: str | None = Field(default=None, max_length=160)
    category: str | None = Field(default=None, max_length=80)
    language: str | None = Field(
        default=None, min_length=2, max_length=3, pattern=r"^[a-zA-Z]{2,3}$"
    )
    logo_url: str | None = Field(default=None, max_length=2048)
    terms_url: str | None = Field(default=None, max_length=2048)
    ai_policy: Literal["enabled", "manual", "disabled"] | None = None
    refresh_interval_seconds: int | None = Field(default=None, ge=300, le=604800)


def _validate_publisher_urls(
    body: PublisherFeedSourceCreateRequest,
) -> dict[str, str | None]:
    try:
        source_url = validate_editorial_feed_url(body.source_url)
        canonical_url = validate_editorial_feed_url(
            body.canonical_url or body.source_url
        )
        logo_url = validate_editorial_feed_url(body.logo_url) if body.logo_url else None
        terms_url = (
            validate_editorial_feed_url(body.terms_url) if body.terms_url else None
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        "source_url": source_url,
        "canonical_url": canonical_url,
        "logo_url": logo_url,
        "terms_url": terms_url,
    }


@router.get(
    "/sources",
    responses=AUTH_ERROR_RESPONSES,
    summary="List admin-managed global RSS sources",
)
def list_publisher_feed_sources(request: Request, limit: int = 100):
    require_permission(request, "settings.manage")
    return {"items": list_external_feed_sources(scope="publisher", limit=limit)}


@router.post(
    "/sources",
    responses=merge_responses(
        AUTH_ERROR_RESPONSES, {422: error_response("Invalid RSS source.")}
    ),
    summary="Register a global RSS source",
)
def create_publisher_feed_source(
    request: Request, body: PublisherFeedSourceCreateRequest
):
    require_permission(request, "settings.manage")
    urls = _validate_publisher_urls(body)
    try:
        source = upsert_external_feed_source(
            source_kind="publisher_rss",
            source_scope="publisher",
            source_url=urls["source_url"] or "",
            canonical_url=urls["canonical_url"],
            artist_id=None,
            association_method="admin_allowlist",
            display_name=body.display_name,
            publisher_name=body.publisher_name or body.display_name,
            category=body.category,
            language=body.language,
            logo_url=urls["logo_url"],
            terms_url=urls["terms_url"],
            ai_policy=body.ai_policy,
            parser_version="editorial-feed-v1",
            refresh_interval_seconds=body.refresh_interval_seconds,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    task_id = create_task_dedup(
        "external_feeds_refresh_editorial",
        {"source_id": int(source["id"]), "limit": 1},
        dedup_key=f"external-feed-source-refresh:{source['id']}",
    )
    return {"source": source, "task_id": task_id}


@router.patch(
    "/sources/{source_id}",
    responses=merge_responses(
        AUTH_ERROR_RESPONSES, {404: error_response("Source not found.")}
    ),
    summary="Update a global RSS source",
)
def update_publisher_feed_source(
    request: Request, source_id: int, body: PublisherFeedSourceUpdateRequest
):
    require_permission(request, "settings.manage")
    try:
        changes = body.model_dump(exclude_none=True)
        source = update_external_feed_source(
            source_id,
            **changes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if source is None:
        raise HTTPException(status_code=404, detail="Publisher RSS source not found")
    return source


@router.post(
    "/sources/{source_id}/refresh",
    responses=merge_responses(
        AUTH_ERROR_RESPONSES, {404: error_response("Source not found.")}
    ),
    summary="Refresh one global RSS source now",
)
def refresh_publisher_feed_source(request: Request, source_id: int):
    require_permission(request, "settings.manage")
    source = mark_external_feed_source_due(source_id)
    if source is None:
        raise HTTPException(status_code=404, detail="Publisher RSS source not found")
    task_id = create_task_dedup(
        "external_feeds_refresh_editorial",
        {"source_id": int(source_id), "limit": 1},
        dedup_key=f"external-feed-source-refresh:{source_id}",
    )
    return {"source_id": int(source_id), "task_id": task_id}


@router.get(
    "/sources/{source_id}/items",
    responses=merge_responses(
        AUTH_ERROR_RESPONSES, {404: error_response("Source not found.")}
    ),
    summary="Preview cached items from a global RSS source",
)
def list_publisher_feed_items(request: Request, source_id: int, limit: int = 10):
    require_permission(request, "settings.manage")
    return {"items": list_external_feed_items_for_source(source_id, limit=limit)}


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
    follow_up_task_id = None
    result_json = enrichment.get("result_json") or {}
    if (
        body.decision == "accept"
        and enrichment.get("operation") == "classify"
        and result_json.get("classification") == "tour"
        and ai_enrichment_enabled()
    ):
        item_id = int(enrichment["item_id"])
        language = str(enrichment.get("language") or "English")
        dedup_key = (
            f"external-feed-auto-show-extraction:{item_id}:"
            f"{enrichment['source_content_hash']}:{language.casefold()}"
        )
        try:
            follow_up_task_id = create_task_dedup(
                "external_feeds_enrich_item",
                {
                    "item_id": item_id,
                    "operation": "extract_show",
                    "language": language,
                },
                dedup_key=dedup_key,
            )
            if follow_up_task_id is None:
                follow_up_task_id = find_active_task_by_type_params(
                    "external_feeds_enrich_item",
                    dedup_key=dedup_key,
                )
        except Exception:
            log.warning(
                "Could not queue show extraction for accepted tour enrichment %s",
                enrichment_id,
                exc_info=True,
            )
    cluster_task_id = None
    if (
        body.decision == "accept"
        and enrichment.get("operation") == "associate_artist"
        and ai_enrichment_enabled()
    ):
        item_id = int(enrichment["item_id"])
        item = get_external_feed_item(item_id)
        source_content_hash = str(enrichment.get("source_content_hash") or "")
        if (
            item is not None
            and item.get("artist_id") is not None
            and str(item.get("content_hash") or "") == source_content_hash
        ):
            language = str(enrichment.get("language") or "English")
            dedup_key = (
                f"external-feed-auto-cluster:{item_id}:"
                f"{source_content_hash}:{language.casefold()}"
            )
            try:
                cluster_task_id = create_task_dedup(
                    "external_feeds_enrich_item",
                    {
                        "item_id": item_id,
                        "operation": "cluster",
                        "language": language,
                    },
                    dedup_key=dedup_key,
                )
                if cluster_task_id is None:
                    cluster_task_id = find_active_task_by_type_params(
                        "external_feeds_enrich_item",
                        dedup_key=dedup_key,
                    )
            except Exception:
                log.warning(
                    "Could not queue clustering for accepted artist association %s",
                    enrichment_id,
                    exc_info=True,
                )
    enrichment["follow_up_task_id"] = follow_up_task_id
    enrichment["cluster_task_id"] = cluster_task_id
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
    "PublisherFeedSourceCreateRequest",
    "PublisherFeedSourceUpdateRequest",
    "apply_external_feed_cluster",
    "apply_external_feed_shows",
    "create_publisher_feed_source",
    "enrich_external_feed_item",
    "get_external_feed_review_item",
    "list_external_feed_review_queue",
    "list_publisher_feed_sources",
    "list_publisher_feed_items",
    "refresh_publisher_feed_source",
    "review_external_feed",
    "revert_external_feed_cluster",
    "update_publisher_feed_source",
    "router",
]

"""Optional AI enrichment for already-ingested external feed items."""

from __future__ import annotations

from datetime import datetime, timezone
import os
from typing import Any

from crate.llm import ask_structured, get_config
from crate.llm.prompts.feed_artist_association import (
    FEED_ARTIST_ASSOCIATION_SYSTEM_PROMPT,
    FeedArtistAssociationResponse,
    PROMPT_VERSION as ARTIST_ASSOCIATION_PROMPT_VERSION,
    build_feed_artist_association_prompt,
)
from crate.llm.prompts.feed_classification import (
    FEED_CLASSIFICATION_SYSTEM_PROMPT,
    FeedClassificationResponse,
    PROMPT_VERSION as CLASSIFICATION_PROMPT_VERSION,
    build_feed_classification_prompt,
)
from crate.llm.prompts.feed_clustering import (
    FEED_CLUSTERING_SYSTEM_PROMPT,
    FeedClusterResponse,
    PROMPT_VERSION as CLUSTERING_PROMPT_VERSION,
    build_feed_clustering_prompt,
)
from crate.llm.prompts.feed_show_extraction import (
    FEED_SHOW_EXTRACTION_SYSTEM_PROMPT,
    FeedShowExtractionResponse,
    PROMPT_VERSION as SHOW_EXTRACTION_PROMPT_VERSION,
    build_feed_show_extraction_prompt,
)
from crate.llm.prompts.feed_summary import (
    FEED_SUMMARY_SYSTEM_PROMPT,
    PROMPT_VERSION,
    FeedSummaryResponse,
    build_feed_summary_prompt,
)


def ai_enrichment_enabled() -> bool:
    raw = os.environ.get("CRATE_EXTERNAL_FEED_AI_ENABLED", "false")
    return raw.strip().casefold() in {"1", "true", "yes", "on"}


def summarize_external_feed_item(
    item: dict[str, Any], *, language: str = "English"
) -> dict[str, Any]:
    """Generate a reviewable summary without changing the source item."""
    if not str(item.get("title") or "").strip():
        raise ValueError("External feed item title is required")
    if not str(item.get("content_hash") or "").strip():
        raise ValueError("External feed item content hash is required")

    response = ask_structured(
        FeedSummaryResponse,
        build_feed_summary_prompt(item=item, language=language),
        system=FEED_SUMMARY_SYSTEM_PROMPT,
    )
    return {
        "operation": "summary",
        "prompt_version": PROMPT_VERSION,
        "source_content_hash": str(item["content_hash"]),
        "language": language,
        "summary": response.summary,
        "key_points": response.key_points,
        "warnings": response.warnings,
        "model": get_config().get("model"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


def classify_external_feed_item(
    item: dict[str, Any], *, language: str = "English"
) -> dict[str, Any]:
    """Generate a reviewable editorial classification without changing the source item."""
    if not str(item.get("title") or "").strip():
        raise ValueError("External feed item title is required")
    if not str(item.get("content_hash") or "").strip():
        raise ValueError("External feed item content hash is required")

    response = ask_structured(
        FeedClassificationResponse,
        build_feed_classification_prompt(item=item, language=language),
        system=FEED_CLASSIFICATION_SYSTEM_PROMPT,
    )
    return {
        "operation": "classify",
        "prompt_version": CLASSIFICATION_PROMPT_VERSION,
        "source_content_hash": str(item["content_hash"]),
        "language": language,
        "classification": response.classification,
        "confidence": response.confidence,
        "reasons": response.reasons,
        "warnings": response.warnings,
        "model": get_config().get("model"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


def associate_external_feed_item(
    item: dict[str, Any],
    candidates: list[dict[str, Any]],
    *,
    language: str = "English",
) -> dict[str, Any]:
    """Generate a reviewable local-artist association proposal."""
    if not str(item.get("title") or "").strip():
        raise ValueError("External feed item title is required")
    if not str(item.get("content_hash") or "").strip():
        raise ValueError("External feed item content hash is required")
    if not candidates:
        raise ValueError("At least one artist candidate is required")

    response = ask_structured(
        FeedArtistAssociationResponse,
        build_feed_artist_association_prompt(
            item=item, candidates=candidates, language=language
        ),
        system=FEED_ARTIST_ASSOCIATION_SYSTEM_PROMPT,
    )
    candidate_ids = {int(candidate["artist_id"]) for candidate in candidates}
    if response.artist_id is not None and response.artist_id not in candidate_ids:
        raise ValueError("Model selected an artist outside the supplied candidate list")
    return {
        "operation": "associate_artist",
        "prompt_version": ARTIST_ASSOCIATION_PROMPT_VERSION,
        "source_content_hash": str(item["content_hash"]),
        "language": language,
        "artist_id": response.artist_id,
        "artist_name": next(
            (
                str(candidate.get("artist_name") or "")
                for candidate in candidates
                if int(candidate["artist_id"]) == response.artist_id
            ),
            None,
        ),
        "confidence": response.confidence,
        "reason": response.reason,
        "warnings": response.warnings,
        "candidates": candidates,
        "model": get_config().get("model"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


def cluster_external_feed_item(
    item: dict[str, Any],
    candidates: list[dict[str, Any]],
    *,
    language: str = "English",
) -> dict[str, Any]:
    """Generate a reviewable semantic cluster without merging source items."""
    if not str(item.get("title") or "").strip():
        raise ValueError("External feed item title is required")
    if not str(item.get("content_hash") or "").strip():
        raise ValueError("External feed item content hash is required")

    base = {
        "operation": "cluster",
        "prompt_version": CLUSTERING_PROMPT_VERSION,
        "source_content_hash": str(item["content_hash"]),
        "language": language,
        "cluster_type": "other",
        "members": [],
        "confidence": 0.0,
        "rationale": "No related candidate items were available.",
        "warnings": ["No related candidate items were available."],
        "model": get_config().get("model"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    if not candidates:
        return base

    response = ask_structured(
        FeedClusterResponse,
        build_feed_clustering_prompt(
            item=item, candidates=candidates, language=language
        ),
        system=FEED_CLUSTERING_SYSTEM_PROMPT,
    )
    contexts = {int(item["id"]): item}
    contexts.update(
        {
            int(candidate["id"]): candidate
            for candidate in candidates
            if candidate.get("id") is not None
        }
    )
    members: list[dict[str, Any]] = []
    seen_ids: set[int] = set()
    representative_count = 0
    for member in response.members:
        member_id = int(member.item_id)
        context = contexts.get(member_id)
        if context is None:
            raise ValueError("Cluster response contains an unknown candidate item")
        if member_id in seen_ids:
            continue
        seen_ids.add(member_id)
        if member.role == "representative":
            representative_count += 1
        published_at = context.get("published_at")
        members.append(
            {
                **member.model_dump(mode="json"),
                "title": str(context.get("title") or "Untitled item"),
                "source_kind": str(context.get("source_kind") or "external"),
                "canonical_url": context.get("canonical_url")
                or context.get("source_url"),
                "published_at": (
                    published_at.isoformat()
                    if isinstance(published_at, datetime)
                    else published_at
                ),
            }
        )
    if members and (len(members) < 2 or int(item["id"]) not in seen_ids):
        raise ValueError("Cluster response must include the target and a related item")
    if members and representative_count != 1:
        raise ValueError("Cluster response must contain one representative item")

    return {
        **base,
        "cluster_type": response.cluster_type,
        "members": members,
        "confidence": response.confidence,
        "rationale": response.rationale,
        "warnings": response.warnings,
    }


def extract_shows_from_external_feed_item(
    item: dict[str, Any], *, language: str = "English"
) -> dict[str, Any]:
    """Generate reviewable show proposals without mutating the show catalogue."""
    if not str(item.get("title") or "").strip():
        raise ValueError("External feed item title is required")
    if not str(item.get("content_hash") or "").strip():
        raise ValueError("External feed item content hash is required")

    response = ask_structured(
        FeedShowExtractionResponse,
        build_feed_show_extraction_prompt(item=item, language=language),
        system=FEED_SHOW_EXTRACTION_SYSTEM_PROMPT,
    )
    result = response.model_dump(mode="json")
    return {
        "operation": "extract_show",
        "prompt_version": SHOW_EXTRACTION_PROMPT_VERSION,
        "source_content_hash": str(item["content_hash"]),
        "language": language,
        "shows": result["shows"],
        "warnings": result["warnings"],
        "model": get_config().get("model"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


__all__ = [
    "associate_external_feed_item",
    "ai_enrichment_enabled",
    "classify_external_feed_item",
    "cluster_external_feed_item",
    "extract_shows_from_external_feed_item",
    "summarize_external_feed_item",
]

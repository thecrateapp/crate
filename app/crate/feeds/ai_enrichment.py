"""Optional AI enrichment for already-ingested external feed items."""

from __future__ import annotations

from datetime import datetime, timezone
import os
from typing import Any

from crate.llm import ask_structured, get_config
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


__all__ = ["ai_enrichment_enabled", "summarize_external_feed_item"]

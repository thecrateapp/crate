"""Background ingestion for experimental external feeds."""

from __future__ import annotations

import logging
import os
from collections.abc import Callable
from random import random
from typing import Any

import requests

from crate.db.repositories.external_feeds import (
    get_external_feed_item,
    list_external_feed_cluster_candidates,
    list_bandcamp_feed_candidates,
    list_due_external_feed_sources,
    mark_external_feed_enrichment_failed,
    mark_external_feed_enrichment_ready,
    mark_external_feed_source_failure,
    mark_external_feed_source_not_found,
    mark_external_feed_source_not_modified,
    upsert_external_feed_item,
    upsert_external_feed_source,
    queue_external_feed_item_enrichment,
)
from crate.db.repositories.external_feed_associations import (
    associate_external_feed_item_deterministically,
    list_library_artists_for_feed_association,
)
from crate.db.repositories.tasks import create_task_dedup
from crate.feeds.ai_enrichment import (
    ai_enrichment_enabled,
    associate_external_feed_item,
    classify_external_feed_item,
    cluster_external_feed_item,
    extract_shows_from_external_feed_item,
    summarize_external_feed_item,
)
from crate.feeds.artist_association import rank_artist_association_candidates
from crate.feeds.rss import (
    PARSER_VERSION,
    RSSFeedError,
    RSSFeedHTTPError,
    RSSFeedNotFoundError,
    discover_rss_feed_from_page,
    fetch_rss_feed,
)
from crate.db.events import emit_task_event
from crate.feeds.editorial import (
    EDITORIAL_SOURCE_KINDS,
    PARSER_VERSION as EDITORIAL_PARSER_VERSION,
    PUBLISHER_SOURCE_KINDS,
    can_fetch_editorial_source,
    fetch_editorial_feed,
)
from crate.feeds.sources import select_bandcamp_feed_candidates
from crate.worker_handlers import TaskHandler, is_cancelled

log = logging.getLogger(__name__)

DEFAULT_MAX_SOURCES = 25
MAX_MAX_SOURCES = 100
DEFAULT_TIMEOUT_SECONDS = 20.0
MAX_RETRY_DELAY_SECONDS = 21600


def external_rss_enabled() -> bool:
    raw = os.environ.get("CRATE_EXTERNAL_RSS_ENABLED", "false")
    return raw.strip().casefold() in {"1", "true", "yes", "on"}


def external_rss_max_sources() -> int:
    try:
        value = int(
            os.environ.get("CRATE_EXTERNAL_RSS_MAX_SOURCES", str(DEFAULT_MAX_SOURCES))
        )
    except (TypeError, ValueError):
        value = DEFAULT_MAX_SOURCES
    return max(1, min(value, MAX_MAX_SOURCES))


def external_rss_timeout() -> float:
    try:
        value = float(
            os.environ.get("CRATE_EXTERNAL_RSS_TIMEOUT", str(DEFAULT_TIMEOUT_SECONDS))
        )
    except (TypeError, ValueError):
        value = DEFAULT_TIMEOUT_SECONDS
    return max(1.0, min(value, 120.0))


def external_feed_ai_enabled() -> bool:
    return ai_enrichment_enabled()


def _external_feed_discovery_limit(params: dict) -> int:
    requested_limit = params.get("limit")
    try:
        return (
            max(1, min(int(requested_limit), MAX_MAX_SOURCES))
            if requested_limit
            else external_rss_max_sources()
        )
    except (TypeError, ValueError):
        return external_rss_max_sources()


def _handle_external_feeds_discover_sources(
    task_id: str,
    params: dict,
    config: dict,
) -> dict[str, Any]:
    """Discover public Bandcamp RSS links from persisted artist candidates."""
    del config
    if not external_rss_enabled():
        return {
            "enabled": False,
            "candidates_checked": 0,
            "sources_registered": 0,
        }

    limit = _external_feed_discovery_limit(params)
    rows = list_bandcamp_feed_candidates(limit=limit)
    candidates = select_bandcamp_feed_candidates(rows, limit=limit)
    stats: dict[str, Any] = {
        "enabled": True,
        "candidates_checked": 0,
        "candidates_with_feed": 0,
        "sources_registered": 0,
        "candidates_without_feed": 0,
        "candidates_failed": 0,
    }
    emit_task_event(
        task_id,
        "external_feeds.discovery.started",
        {"candidates": len(candidates), "limit": limit},
    )

    for candidate in candidates:
        if is_cancelled(task_id):
            break
        stats["candidates_checked"] += 1
        try:
            source_url = discover_rss_feed_from_page(
                str(candidate["artist_url"]),
                timeout=external_rss_timeout(),
            )
            if not source_url:
                stats["candidates_without_feed"] += 1
                continue
            stats["candidates_with_feed"] += 1
            upsert_external_feed_source(
                source_kind="bandcamp_rss",
                source_url=source_url,
                canonical_url=str(candidate["artist_url"]),
                artist_id=candidate.get("artist_id"),
                association_method=str(candidate["association_method"]),
                parser_version=PARSER_VERSION,
            )
            stats["sources_registered"] += 1
        except RSSFeedNotFoundError:
            stats["candidates_without_feed"] += 1
        except (
            RSSFeedHTTPError,
            RSSFeedError,
            requests.RequestException,
            ValueError,
        ) as exc:
            stats["candidates_failed"] += 1
            log.warning(
                "Bandcamp RSS discovery failed for %s: %s",
                candidate.get("artist_url"),
                exc,
            )

    emit_task_event(task_id, "external_feeds.discovery.finished", stats)
    return stats


def _handle_external_feeds_enrich_item(
    task_id: str,
    params: dict,
    config: dict,
) -> dict[str, Any]:
    """Generate one reviewable AI proposal for an ingested feed item."""
    del config
    raw_item_id: Any = params.get("item_id")
    try:
        item_id = int(raw_item_id)
    except (TypeError, ValueError):
        return {"error": "External feed item_id is required"}

    if not external_feed_ai_enabled():
        return {"enabled": False, "item_id": item_id, "status": "disabled"}

    item = get_external_feed_item(item_id)
    if item is None:
        return {"error": "External feed item not found", "item_id": item_id}

    operation = str(params.get("operation") or "summary")
    if operation not in {
        "summary",
        "classify",
        "cluster",
        "extract_show",
        "associate_artist",
    }:
        return {"error": "Unsupported external feed AI operation"}

    if operation == "summary":
        from crate.llm.prompts.feed_summary import PROMPT_VERSION
    elif operation == "classify":
        from crate.llm.prompts.feed_classification import PROMPT_VERSION
    elif operation == "cluster":
        from crate.llm.prompts.feed_clustering import PROMPT_VERSION
    elif operation == "associate_artist":
        from crate.llm.prompts.feed_artist_association import PROMPT_VERSION
    else:
        from crate.llm.prompts.feed_show_extraction import PROMPT_VERSION

    enrichment = queue_external_feed_item_enrichment(
        item_id=item_id,
        operation=operation,
        source_content_hash=str(item["content_hash"]),
        prompt_version=PROMPT_VERSION,
        language=str(params.get("language") or "English"),
    )
    enrichment_id = int(enrichment["id"])
    if enrichment["status"] == "ready":
        return {
            "enabled": True,
            "item_id": item_id,
            "enrichment_id": enrichment_id,
            "status": "ready",
            "result": enrichment.get("result_json") or {},
        }

    emit_task_event(
        task_id,
        "external_feeds.enrichment.started",
        {"item_id": item_id, "enrichment_id": enrichment_id},
    )
    try:
        language = str(params.get("language") or "English")
        if operation == "summary":
            result = summarize_external_feed_item(item, language=language)
        elif operation == "classify":
            result = classify_external_feed_item(item, language=language)
        elif operation == "cluster":
            candidates = list_external_feed_cluster_candidates(item_id)
            result = cluster_external_feed_item(item, candidates, language=language)
        elif operation == "associate_artist":
            candidates = list_library_artists_for_feed_association()
            ranked = rank_artist_association_candidates(
                item=item,
                artists=candidates,
            )
            if not ranked["candidates"]:
                result = {
                    "operation": "associate_artist",
                    "prompt_version": PROMPT_VERSION,
                    "source_content_hash": str(item["content_hash"]),
                    "language": language,
                    "artist_id": None,
                    "artist_name": None,
                    "confidence": 0.0,
                    "reason": "No ambiguous artist candidate remained for review.",
                    "warnings": ["No artist association was selected."],
                    "candidates": [],
                    "model": None,
                    "generated_at": None,
                }
            else:
                result = associate_external_feed_item(
                    item, ranked["candidates"], language=language
                )
        else:
            result = extract_shows_from_external_feed_item(item, language=language)
        mark_external_feed_enrichment_ready(
            enrichment_id,
            result=result,
            model=str(result.get("model") or "") or None,
            prompt_version=str(result["prompt_version"]),
        )
    except Exception as exc:
        error = str(exc)[:1000] or "External feed AI enrichment failed"
        mark_external_feed_enrichment_failed(enrichment_id, error=error)
        emit_task_event(
            task_id,
            "external_feeds.enrichment.finished",
            {"item_id": item_id, "enrichment_id": enrichment_id, "error": error},
        )
        log.warning("External feed AI enrichment failed for %s: %s", item_id, exc)
        return {"error": error, "item_id": item_id, "enrichment_id": enrichment_id}

    emit_task_event(
        task_id,
        "external_feeds.enrichment.finished",
        {"item_id": item_id, "enrichment_id": enrichment_id, "status": "ready"},
    )
    return {
        "enabled": True,
        "item_id": item_id,
        "enrichment_id": enrichment_id,
        "status": "ready",
        "result": result,
    }


def _retry_delay_seconds(
    source: dict[str, Any], retry_after_seconds: int | None = None
) -> int:
    failures = int(source.get("consecutive_failures") or 0) + 1
    base = retry_after_seconds
    if base is None:
        interval = max(300, int(source.get("refresh_interval_seconds") or 21600))
        base = min(MAX_RETRY_DELAY_SECONDS, interval * (2 ** min(failures - 1, 5)))
    base = max(0, int(base))
    jitter_limit = min(300, max(1, base // 4))
    return base + int(random() * (jitter_limit + 1))


def _list_due_editorial_feed_sources(
    limit: int, source_id: int | None = None
) -> list[dict[str, Any]]:
    sources: list[dict[str, Any]] = []
    for source_kind in sorted(EDITORIAL_SOURCE_KINDS | PUBLISHER_SOURCE_KINDS):
        sources.extend(
            list_due_external_feed_sources(
                limit=limit, source_kind=source_kind, source_id=source_id
            )
        )
    return sorted(
        sources,
        key=lambda source: (
            source.get("next_fetch_at") is not None,
            str(source.get("next_fetch_at") or ""),
            int(source.get("id") or 0),
        ),
    )[:limit]


def _refresh_external_feed_sources(
    task_id: str,
    params: dict,
    config: dict,
    *,
    source_loader: Callable[[int], list[dict[str, Any]]],
    feed_fetcher: Callable[..., Any],
    parser_version: str,
    event_name: str,
    error_label: str,
    robots_checker: Callable[..., bool] | None = None,
) -> dict[str, Any]:
    """Refresh registered external feeds without touching the read path."""
    del config
    if not external_rss_enabled():
        return {"enabled": False, "sources_checked": 0}

    limit = _external_feed_discovery_limit(params)

    stats: dict[str, Any] = {
        "enabled": True,
        "sources_checked": 0,
        "sources_succeeded": 0,
        "sources_not_modified": 0,
        "sources_not_found": 0,
        "sources_failed": 0,
        "items_upserted": 0,
        "enrichments_queued": 0,
        "classifications_queued": 0,
        "clusters_queued": 0,
        "artist_associations_auto": 0,
        "artist_associations_queued": 0,
    }
    if robots_checker is not None:
        stats["sources_blocked_by_robots"] = 0

    sources = source_loader(limit)
    association_artists: list[dict[str, Any]] | None = None
    emit_task_event(
        task_id,
        f"{event_name}.started",
        {"sources_due": len(sources), "limit": limit},
    )

    for source in sources:
        if is_cancelled(task_id):
            break
        stats["sources_checked"] += 1
        source_id = int(source["id"])
        try:
            if robots_checker is not None and not robots_checker(
                str(source["source_url"]),
                timeout=external_rss_timeout(),
            ):
                mark_external_feed_source_failure(
                    source_id,
                    error="Blocked by robots.txt",
                    retry_after_seconds=_retry_delay_seconds(source),
                )
                stats["sources_failed"] += 1
                stats["sources_blocked_by_robots"] += 1
                continue

            result = feed_fetcher(
                str(source["source_url"]),
                etag=source.get("etag"),
                last_modified=source.get("last_modified"),
                timeout=external_rss_timeout(),
            )
            if result.not_modified:
                mark_external_feed_source_not_modified(
                    source_id,
                    etag=result.etag,
                    last_modified=result.last_modified,
                )
                stats["sources_not_modified"] += 1
                continue

            for item in result.items:
                persisted_item = upsert_external_feed_item(
                    source_id=source_id,
                    artist_id=source.get("artist_id"),
                    item_kind=item.item_kind,
                    source_url=str(source["source_url"]),
                    title=item.title,
                    content_hash=item.content_hash,
                    parser_version=parser_version,
                    canonical_url=item.canonical_url,
                    external_guid=item.external_guid,
                    author=item.author,
                    excerpt=item.excerpt,
                    published_at=item.published_at,
                    payload=item.payload,
                )
                stats["items_upserted"] += 1
                item_id = persisted_item.get("id") if persisted_item else None
                content_hash = str(
                    (persisted_item or {}).get("content_hash") or item.content_hash
                )
                association: dict[str, Any] | None = None
                if (
                    item_id is not None
                    and source.get("source_kind") in PUBLISHER_SOURCE_KINDS
                    and (persisted_item or {}).get("state", "active") == "active"
                ):
                    try:
                        if association_artists is None:
                            association_artists = (
                                list_library_artists_for_feed_association()
                            )
                        association = associate_external_feed_item_deterministically(
                            int(item_id), artists=association_artists
                        )
                        if association.get("applied"):
                            stats["artist_associations_auto"] += 1
                        elif (
                            association.get("requires_review")
                            and source.get("ai_policy", "enabled") == "enabled"
                            and external_feed_ai_enabled()
                        ):
                            queued_association = create_task_dedup(
                                "external_feeds_enrich_item",
                                {
                                    "item_id": int(item_id),
                                    "operation": "associate_artist",
                                    "language": "English",
                                },
                                dedup_key=(
                                    f"external-feed-auto-association:{item_id}:"
                                    f"{content_hash}"
                                ),
                            )
                            if queued_association is not None:
                                stats["artist_associations_queued"] += 1
                    except Exception:
                        log.warning(
                            "Could not associate external feed item %s with an artist",
                            item_id,
                            exc_info=True,
                        )
                if (
                    source.get("source_kind") in PUBLISHER_SOURCE_KINDS
                    and source.get("ai_policy", "enabled") == "enabled"
                    and external_feed_ai_enabled()
                    and (persisted_item or {}).get("state", "active") == "active"
                ):
                    if item_id is not None:
                        try:
                            queued_task = create_task_dedup(
                                "external_feeds_enrich_item",
                                {
                                    "item_id": int(item_id),
                                    "operation": "summary",
                                    "language": "English",
                                },
                                dedup_key=(
                                    f"external-feed-auto-summary:{item_id}:"
                                    f"{content_hash}"
                                ),
                            )
                            if queued_task is not None:
                                stats["enrichments_queued"] += 1
                        except Exception:
                            log.warning(
                                "Could not queue AI summary for external feed item %s",
                                item_id,
                                exc_info=True,
                            )
                        try:
                            queued_classification = create_task_dedup(
                                "external_feeds_enrich_item",
                                {
                                    "item_id": int(item_id),
                                    "operation": "classify",
                                    "language": "English",
                                },
                                dedup_key=(
                                    f"external-feed-auto-classification:{item_id}:"
                                    f"{content_hash}"
                                ),
                            )
                            if queued_classification is not None:
                                stats["classifications_queued"] += 1
                        except Exception:
                            log.warning(
                                "Could not queue AI classification for external feed item %s",
                                item_id,
                                exc_info=True,
                            )
                        associated_artist = bool(
                            (persisted_item or {}).get("artist_id") is not None
                            or (
                                association is not None
                                and (
                                    association.get("applied")
                                    or association.get("already_associated")
                                )
                            )
                        )
                        if associated_artist:
                            try:
                                queued_cluster = create_task_dedup(
                                    "external_feeds_enrich_item",
                                    {
                                        "item_id": int(item_id),
                                        "operation": "cluster",
                                        "language": "English",
                                    },
                                    dedup_key=(
                                        f"external-feed-auto-cluster:{item_id}:"
                                        f"{content_hash}"
                                    ),
                                )
                                if queued_cluster is not None:
                                    stats["clusters_queued"] += 1
                            except Exception:
                                log.warning(
                                    "Could not queue AI cluster for external feed item %s",
                                    item_id,
                                    exc_info=True,
                                )
            mark_external_feed_source_not_modified(
                source_id,
                etag=result.etag,
                last_modified=result.last_modified,
            )
            stats["sources_succeeded"] += 1
        except RSSFeedHTTPError as exc:
            if exc.status_code == 404:
                mark_external_feed_source_not_found(
                    source_id,
                    error=str(exc),
                )
                stats["sources_not_found"] += 1
            else:
                mark_external_feed_source_failure(
                    source_id,
                    error=str(exc),
                    retry_after_seconds=_retry_delay_seconds(
                        source, exc.retry_after_seconds
                    ),
                )
                stats["sources_failed"] += 1
        except (RSSFeedError, requests.RequestException, ValueError) as exc:
            mark_external_feed_source_failure(
                source_id,
                error=str(exc) or f"{error_label} refresh failed",
                retry_after_seconds=_retry_delay_seconds(source),
            )
            stats["sources_failed"] += 1
            log.warning("External feed %s failed: %s", source_id, exc)

    emit_task_event(task_id, f"{event_name}.finished", stats)
    return stats


def _handle_external_feeds_refresh(
    task_id: str,
    params: dict,
    config: dict,
) -> dict[str, Any]:
    """Refresh due Bandcamp RSS sources without touching the read path."""
    return _refresh_external_feed_sources(
        task_id,
        params,
        config,
        source_loader=lambda limit: list_due_external_feed_sources(
            limit=limit, source_kind="bandcamp_rss"
        ),
        feed_fetcher=fetch_rss_feed,
        parser_version=PARSER_VERSION,
        event_name="external_feeds.refresh",
        error_label="RSS",
    )


def _handle_external_feeds_refresh_editorial(
    task_id: str,
    params: dict,
    config: dict,
) -> dict[str, Any]:
    """Refresh registered editorial sources after a robots.txt check."""
    source_id = params.get("source_id")
    source_loader = _list_due_editorial_feed_sources
    if source_id is not None:
        selected_source_id = int(source_id)

        def source_loader(limit: int) -> list[dict[str, Any]]:
            return _list_due_editorial_feed_sources(limit, source_id=selected_source_id)

    return _refresh_external_feed_sources(
        task_id,
        params,
        config,
        source_loader=source_loader,
        feed_fetcher=fetch_editorial_feed,
        parser_version=EDITORIAL_PARSER_VERSION,
        event_name="external_feeds.editorial_refresh",
        error_label="Editorial feed",
        robots_checker=can_fetch_editorial_source,
    )


FEED_TASK_HANDLERS: dict[str, TaskHandler] = {
    "external_feeds_discover_sources": _handle_external_feeds_discover_sources,
    "external_feeds_enrich_item": _handle_external_feeds_enrich_item,
    "external_feeds_refresh_editorial": _handle_external_feeds_refresh_editorial,
    "external_feeds_refresh": _handle_external_feeds_refresh,
}


__all__ = [
    "FEED_TASK_HANDLERS",
    "_handle_external_feeds_discover_sources",
    "_handle_external_feeds_enrich_item",
    "_handle_external_feeds_refresh_editorial",
    "_handle_external_feeds_refresh",
    "external_rss_enabled",
    "external_feed_ai_enabled",
    "external_rss_max_sources",
    "external_rss_timeout",
]

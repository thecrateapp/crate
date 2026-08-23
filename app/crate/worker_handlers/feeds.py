"""Background ingestion for experimental external feeds."""

from __future__ import annotations

import logging
import os
from random import random
from typing import Any

import requests

from crate.db.repositories.external_feeds import (
    list_bandcamp_feed_candidates,
    list_due_external_feed_sources,
    mark_external_feed_source_failure,
    mark_external_feed_source_not_found,
    mark_external_feed_source_not_modified,
    upsert_external_feed_item,
    upsert_external_feed_source,
)
from crate.feeds.rss import (
    PARSER_VERSION,
    RSSFeedError,
    RSSFeedHTTPError,
    RSSFeedNotFoundError,
    discover_rss_feed_from_page,
    fetch_rss_feed,
)
from crate.feeds.sources import select_bandcamp_feed_candidates
from crate.db.events import emit_task_event
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


def _handle_external_feeds_refresh(
    task_id: str,
    params: dict,
    config: dict,
) -> dict[str, Any]:
    """Refresh due Bandcamp RSS sources without touching the read path."""
    del config
    if not external_rss_enabled():
        return {"enabled": False, "sources_checked": 0}

    requested_limit = params.get("limit")
    try:
        limit = (
            max(1, min(int(requested_limit), MAX_MAX_SOURCES))
            if requested_limit
            else external_rss_max_sources()
        )
    except (TypeError, ValueError):
        limit = external_rss_max_sources()

    stats: dict[str, Any] = {
        "enabled": True,
        "sources_checked": 0,
        "sources_succeeded": 0,
        "sources_not_modified": 0,
        "sources_not_found": 0,
        "sources_failed": 0,
        "items_upserted": 0,
    }
    sources = list_due_external_feed_sources(limit=limit, source_kind="bandcamp_rss")
    emit_task_event(
        task_id,
        "external_feeds.refresh.started",
        {"sources_due": len(sources), "limit": limit},
    )

    for source in sources:
        if is_cancelled(task_id):
            break
        stats["sources_checked"] += 1
        source_id = int(source["id"])
        try:
            result = fetch_rss_feed(
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
                upsert_external_feed_item(
                    source_id=source_id,
                    artist_id=source.get("artist_id"),
                    item_kind=item.item_kind,
                    source_url=str(source["source_url"]),
                    title=item.title,
                    content_hash=item.content_hash,
                    parser_version=PARSER_VERSION,
                    canonical_url=item.canonical_url,
                    external_guid=item.external_guid,
                    author=item.author,
                    excerpt=item.excerpt,
                    published_at=item.published_at,
                    payload=item.payload,
                )
                stats["items_upserted"] += 1
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
                error=str(exc) or "RSS refresh failed",
                retry_after_seconds=_retry_delay_seconds(source),
            )
            stats["sources_failed"] += 1
            log.warning("External feed %s failed: %s", source_id, exc)

    emit_task_event(task_id, "external_feeds.refresh.finished", stats)
    return stats


FEED_TASK_HANDLERS: dict[str, TaskHandler] = {
    "external_feeds_discover_sources": _handle_external_feeds_discover_sources,
    "external_feeds_refresh": _handle_external_feeds_refresh,
}


__all__ = [
    "FEED_TASK_HANDLERS",
    "_handle_external_feeds_discover_sources",
    "_handle_external_feeds_refresh",
    "external_rss_enabled",
    "external_rss_max_sources",
    "external_rss_timeout",
]

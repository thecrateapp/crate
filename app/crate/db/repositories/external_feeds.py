"""Persistence helpers for allowlisted external feed sources and items."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime, timedelta, timezone
import hashlib
import json
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from sqlalchemy import text

from crate.db.tx import read_scope, transaction_scope


DEFAULT_REFRESH_INTERVAL_SECONDS = 21600
MAX_REFRESH_INTERVAL_SECONDS = 604800
MAX_PAYLOAD_BYTES = 64 * 1024
MAX_ERROR_LENGTH = 1000

_SOURCE_KINDS = {
    "bandcamp_rss",
    "artist_site",
    "label",
    "newsletter",
    "blog",
    "event_page",
}
_ITEM_KINDS = {"news", "announcement", "release", "other"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _clean_http_url(value: Any, *, required: bool) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        if required:
            raise ValueError("External feed URL is required")
        return None

    parsed = urlsplit(raw)
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
        raise ValueError("External feed URL must be an HTTP(S) URL")
    if parsed.username or parsed.password:
        raise ValueError("External feed URL cannot contain credentials")
    try:
        port = parsed.port
    except ValueError as exc:
        raise ValueError("External feed URL has an invalid port") from exc

    host = parsed.hostname.lower()
    if ":" in host and not host.startswith("["):
        host = f"[{host}]"
    if port is not None:
        host = f"{host}:{port}"
    return urlunsplit(
        (
            parsed.scheme.lower(),
            host,
            parsed.path or "",
            parsed.query,
            "",
        )
    )


def _required_http_url(value: Any) -> str:
    result = _clean_http_url(value, required=True)
    if result is None:
        raise ValueError("External feed URL is required")
    return result


def _clean_text(value: Any, *, max_length: int, required: bool = False) -> str | None:
    result = str(value or "").strip()
    if not result:
        if required:
            raise ValueError("External feed value is required")
        return None
    return result[:max_length]


def _required_text(value: Any, *, max_length: int) -> str:
    result = _clean_text(value, max_length=max_length, required=True)
    if result is None:
        raise ValueError("External feed value is required")
    return result


def _validate_refresh_interval(value: int) -> int:
    interval = int(value)
    if not 300 <= interval <= MAX_REFRESH_INTERVAL_SECONDS:
        raise ValueError("External feed refresh interval must be 300..604800 seconds")
    return interval


def _bounded_payload(payload: Mapping[str, Any] | None) -> dict[str, Any]:
    value = dict(payload or {})
    encoded = json.dumps(value, default=str, ensure_ascii=False, sort_keys=True)
    encoded_bytes = encoded.encode("utf-8")
    if len(encoded_bytes) <= MAX_PAYLOAD_BYTES:
        return value
    return {
        "truncated": True,
        "sha256": hashlib.sha256(encoded_bytes).hexdigest(),
        "size_bytes": len(encoded_bytes),
    }


def _row(result: Any) -> dict[str, Any] | None:
    record = result.mappings().first()
    return dict(record) if record else None


def upsert_external_feed_source(
    *,
    source_kind: str,
    source_url: str,
    canonical_url: str | None = None,
    artist_id: int | None = None,
    association_method: str | None = None,
    parser_version: str,
    refresh_interval_seconds: int = DEFAULT_REFRESH_INTERVAL_SECONDS,
) -> dict[str, Any]:
    """Create or update a source without resetting its HTTP cache state."""
    if source_kind not in _SOURCE_KINDS:
        raise ValueError(f"Unsupported external feed source kind: {source_kind}")
    source_url = _required_http_url(source_url)
    canonical_url = _clean_http_url(canonical_url, required=False)
    parser_version = _required_text(parser_version, max_length=128)
    interval = _validate_refresh_interval(refresh_interval_seconds)

    with transaction_scope() as session:
        result = session.execute(
            text(
                """
                INSERT INTO external_feed_sources (
                    source_kind, source_url, canonical_url, artist_id,
                    association_method, parser_version, refresh_interval_seconds
                ) VALUES (
                    :source_kind, :source_url, :canonical_url, :artist_id,
                    :association_method, :parser_version, :refresh_interval_seconds
                )
                ON CONFLICT (source_url) DO UPDATE SET
                    source_kind = EXCLUDED.source_kind,
                    canonical_url = COALESCE(
                        EXCLUDED.canonical_url,
                        external_feed_sources.canonical_url
                    ),
                    artist_id = COALESCE(
                        EXCLUDED.artist_id,
                        external_feed_sources.artist_id
                    ),
                    association_method = COALESCE(
                        EXCLUDED.association_method,
                        external_feed_sources.association_method
                    ),
                    parser_version = EXCLUDED.parser_version,
                    refresh_interval_seconds = EXCLUDED.refresh_interval_seconds,
                    updated_at = NOW()
                RETURNING *
                """
            ),
            {
                "source_kind": source_kind,
                "source_url": source_url,
                "canonical_url": canonical_url,
                "artist_id": artist_id,
                "association_method": association_method,
                "parser_version": parser_version,
                "refresh_interval_seconds": interval,
            },
        )
        return dict(result.mappings().one())


def get_external_feed_source(source_id: int) -> dict[str, Any] | None:
    with read_scope() as session:
        return _row(
            session.execute(
                text("SELECT * FROM external_feed_sources WHERE id = :source_id"),
                {"source_id": source_id},
            )
        )


def list_bandcamp_feed_candidates(*, limit: int = 100) -> list[dict[str, Any]]:
    """List persisted artist URLs eligible for public Bandcamp RSS discovery."""
    bounded_limit = max(1, min(int(limit), 500))
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                WITH candidates AS (
                    SELECT
                        la.id AS artist_id,
                        la.name AS artist_name,
                        la.bandcamp_url AS artist_url,
                        'explicit_artist_url' AS association_method
                    FROM library_artists la
                    WHERE NULLIF(trim(coalesce(la.bandcamp_url, '')), '') IS NOT NULL

                    UNION ALL

                    SELECT
                        la.id AS artist_id,
                        la.name AS artist_name,
                        la.bandcamp_url AS artist_url,
                        'followed_artist' AS association_method
                    FROM user_global_artist_follows f
                    JOIN global_catalog_artists ga
                      ON ga.global_artist_uid = f.global_artist_uid
                    JOIN library_artists la ON la.id = ga.local_artist_id
                    WHERE NULLIF(trim(coalesce(la.bandcamp_url, '')), '') IS NOT NULL

                    UNION ALL

                    SELECT
                        la.id AS artist_id,
                        la.name AS artist_name,
                        la.bandcamp_url AS artist_url,
                        'followed_artist' AS association_method
                    FROM user_follows uf
                    JOIN library_artists la
                      ON lower(la.name) = lower(uf.artist_name)
                    WHERE NULLIF(trim(coalesce(la.bandcamp_url, '')), '') IS NOT NULL

                    UNION ALL

                    SELECT
                        la.id AS artist_id,
                        COALESCE(la.name, bi.artist_name) AS artist_name,
                        bi.artist_url AS artist_url,
                        CASE ubi.relation_type
                            WHEN 'wishlist' THEN 'bandcamp_wishlist'
                            WHEN 'following' THEN 'bandcamp_following'
                        END AS association_method
                    FROM user_bandcamp_items ubi
                    JOIN bandcamp_connections bc
                      ON bc.id = ubi.connection_id
                     AND bc.user_id = ubi.user_id
                     AND bc.status = 'connected'
                     AND bc.revoked_at IS NULL
                    JOIN bandcamp_items bi ON bi.id = ubi.bandcamp_item_id
                    LEFT JOIN library_artists la
                      ON lower(la.name) = lower(bi.artist_name)
                    WHERE ubi.relation_type IN ('wishlist', 'following')
                      AND ubi.removed_at IS NULL
                      AND NULLIF(trim(coalesce(bi.artist_url, '')), '') IS NOT NULL
                )
                SELECT DISTINCT ON (
                    lower(regexp_replace(trim(artist_url), '/+$', ''))
                )
                    artist_id, artist_name, artist_url, association_method
                FROM candidates
                ORDER BY
                    lower(regexp_replace(trim(artist_url), '/+$', '')),
                    CASE association_method
                        WHEN 'followed_artist' THEN 0
                        WHEN 'bandcamp_wishlist' THEN 1
                        WHEN 'bandcamp_following' THEN 2
                        ELSE 3
                    END,
                    artist_name ASC NULLS LAST,
                    artist_url ASC
                LIMIT :limit
                """
            ),
            {"limit": bounded_limit},
        ).mappings()
        return [dict(row) for row in rows]


def list_due_external_feed_sources(
    *,
    limit: int = 50,
    now: datetime | None = None,
    source_kind: str | None = None,
) -> list[dict[str, Any]]:
    bounded_limit = max(1, min(int(limit), 500))
    due_at = now or _now()
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT *
                FROM external_feed_sources
                WHERE state IN ('active', 'degraded')
                  AND (next_fetch_at IS NULL OR next_fetch_at <= :now)
                  AND (:source_kind IS NULL OR source_kind = :source_kind)
                ORDER BY next_fetch_at ASC NULLS FIRST, id ASC
                LIMIT :limit
                """
            ),
            {"now": due_at, "limit": bounded_limit, "source_kind": source_kind},
        ).mappings()
        return [dict(row) for row in rows]


def mark_external_feed_source_not_modified(
    source_id: int,
    *,
    etag: str | None = None,
    last_modified: str | None = None,
    checked_at: datetime | None = None,
) -> dict[str, Any] | None:
    checked_at = checked_at or _now()
    with transaction_scope() as session:
        return _row(
            session.execute(
                text(
                    """
                    UPDATE external_feed_sources
                    SET state = 'active',
                        etag = COALESCE(:etag, etag),
                        last_modified = COALESCE(:last_modified, last_modified),
                        last_checked_at = :checked_at,
                        last_success_at = :checked_at,
                        last_error_at = NULL,
                        last_error = NULL,
                        consecutive_failures = 0,
                        next_fetch_at = :checked_at
                            + refresh_interval_seconds * INTERVAL '1 second',
                        updated_at = :checked_at
                    WHERE id = :source_id
                    RETURNING *
                    """
                ),
                {
                    "source_id": source_id,
                    "etag": _clean_text(etag, max_length=256),
                    "last_modified": _clean_text(last_modified, max_length=256),
                    "checked_at": checked_at,
                },
            )
        )


def mark_external_feed_source_failure(
    source_id: int,
    *,
    error: str,
    failed_at: datetime | None = None,
    retry_after_seconds: int | None = None,
) -> dict[str, Any] | None:
    failed_at = failed_at or _now()
    error = _required_text(error, max_length=MAX_ERROR_LENGTH)
    with transaction_scope() as session:
        source = _row(
            session.execute(
                text(
                    """
                    SELECT refresh_interval_seconds, consecutive_failures
                    FROM external_feed_sources
                    WHERE id = :source_id
                    FOR UPDATE
                    """
                ),
                {"source_id": source_id},
            )
        )
        if source is None:
            return None

        failures = int(source["consecutive_failures"]) + 1
        delay = (
            int(retry_after_seconds)
            if retry_after_seconds is not None
            else min(
                21600,
                int(source["refresh_interval_seconds"]) * (2 ** min(failures - 1, 5)),
            )
        )
        if delay < 0:
            raise ValueError("External feed retry delay cannot be negative")
        return _row(
            session.execute(
                text(
                    """
                    UPDATE external_feed_sources
                    SET state = 'degraded',
                        last_checked_at = :failed_at,
                        last_error_at = :failed_at,
                        last_error = :error,
                        consecutive_failures = :failures,
                        next_fetch_at = :next_fetch_at,
                        updated_at = :failed_at
                    WHERE id = :source_id
                    RETURNING *
                    """
                ),
                {
                    "source_id": source_id,
                    "failed_at": failed_at,
                    "error": error,
                    "failures": failures,
                    "next_fetch_at": failed_at + timedelta(seconds=delay),
                },
            )
        )


def mark_external_feed_source_not_found(
    source_id: int,
    *,
    error: str = "External feed source not found",
    checked_at: datetime | None = None,
) -> dict[str, Any] | None:
    """Stop polling a source after a definitive HTTP 404."""
    checked_at = checked_at or _now()
    error = _required_text(error, max_length=MAX_ERROR_LENGTH)
    with transaction_scope() as session:
        return _row(
            session.execute(
                text(
                    """
                    UPDATE external_feed_sources
                    SET state = 'not_found',
                        last_checked_at = :checked_at,
                        last_error_at = :checked_at,
                        last_error = :error,
                        next_fetch_at = NULL,
                        updated_at = :checked_at
                    WHERE id = :source_id
                    RETURNING *
                    """
                ),
                {
                    "source_id": source_id,
                    "checked_at": checked_at,
                    "error": error,
                },
            )
        )


def upsert_external_feed_item(
    *,
    source_id: int,
    item_kind: str,
    source_url: str,
    title: str,
    content_hash: str,
    parser_version: str,
    canonical_url: str | None = None,
    external_guid: str | None = None,
    artist_id: int | None = None,
    author: str | None = None,
    excerpt: str | None = None,
    published_at: datetime | None = None,
    payload: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Upsert an item and mark cross-item content duplicates explicitly."""
    if item_kind not in _ITEM_KINDS:
        raise ValueError(f"Unsupported external feed item kind: {item_kind}")
    source_url = _required_http_url(source_url)
    canonical_url = _clean_http_url(canonical_url, required=False)
    title = _required_text(title, max_length=512)
    content_hash = _required_text(content_hash, max_length=128)
    parser_version = _required_text(parser_version, max_length=128)
    external_guid = _clean_text(external_guid, max_length=512)
    author = _clean_text(author, max_length=256)
    excerpt = _clean_text(excerpt, max_length=10000)
    payload_json = json.dumps(
        _bounded_payload(payload),
        default=str,
        ensure_ascii=False,
    )

    with transaction_scope() as session:
        existing = None
        if external_guid:
            existing = _row(
                session.execute(
                    text(
                        """
                        SELECT *
                        FROM external_feed_items
                        WHERE source_id = :source_id
                          AND external_guid = :external_guid
                        LIMIT 1
                        """
                    ),
                    {"source_id": source_id, "external_guid": external_guid},
                )
            )
        if existing is None and canonical_url:
            existing = _row(
                session.execute(
                    text(
                        """
                        SELECT *
                        FROM external_feed_items
                        WHERE source_id = :source_id
                          AND canonical_url = :canonical_url
                        LIMIT 1
                        """
                    ),
                    {"source_id": source_id, "canonical_url": canonical_url},
                )
            )
        if existing is None and not external_guid and not canonical_url:
            existing = _row(
                session.execute(
                    text(
                        """
                        SELECT *
                        FROM external_feed_items
                        WHERE source_id = :source_id
                          AND content_hash = :content_hash
                        LIMIT 1
                        """
                    ),
                    {"source_id": source_id, "content_hash": content_hash},
                )
            )

        existing_id = existing["id"] if existing else None
        duplicate_of_id = session.execute(
            text(
                """
                SELECT id
                FROM external_feed_items
                WHERE content_hash = :content_hash
                  AND (:existing_id IS NULL OR id <> :existing_id)
                  AND state IN ('active', 'duplicate')
                ORDER BY (state = 'active') DESC, id ASC
                LIMIT 1
                """
            ),
            {"content_hash": content_hash, "existing_id": existing_id},
        ).scalar_one_or_none()
        state = "duplicate" if duplicate_of_id is not None else "active"

        values = {
            "source_id": source_id,
            "artist_id": artist_id,
            "item_kind": item_kind,
            "state": state,
            "external_guid": external_guid,
            "source_url": source_url,
            "canonical_url": canonical_url,
            "title": title,
            "author": author,
            "excerpt": excerpt,
            "published_at": published_at,
            "content_hash": content_hash,
            "duplicate_of_id": duplicate_of_id,
            "payload_json": payload_json,
            "parser_version": parser_version,
        }
        if existing_id is None:
            result = session.execute(
                text(
                    """
                    INSERT INTO external_feed_items (
                        source_id, artist_id, item_kind, state, external_guid,
                        source_url, canonical_url, title, author, excerpt,
                        published_at, content_hash, duplicate_of_id,
                        payload_json, parser_version
                    ) VALUES (
                        :source_id, :artist_id, :item_kind, :state, :external_guid,
                        :source_url, :canonical_url, :title, :author, :excerpt,
                        :published_at, :content_hash, :duplicate_of_id,
                        CAST(:payload_json AS jsonb), :parser_version
                    )
                    RETURNING *
                    """
                ),
                values,
            )
        else:
            values["id"] = existing_id
            result = session.execute(
                text(
                    """
                    UPDATE external_feed_items
                    SET artist_id = :artist_id,
                        item_kind = :item_kind,
                        state = :state,
                        external_guid = :external_guid,
                        source_url = :source_url,
                        canonical_url = :canonical_url,
                        title = :title,
                        author = :author,
                        excerpt = :excerpt,
                        published_at = :published_at,
                        content_hash = :content_hash,
                        duplicate_of_id = :duplicate_of_id,
                        payload_json = CAST(:payload_json AS jsonb),
                        parser_version = :parser_version,
                        updated_at = NOW()
                    WHERE id = :id
                    RETURNING *
                    """
                ),
                values,
            )
        return dict(result.mappings().one())


__all__ = [
    "get_external_feed_source",
    "list_bandcamp_feed_candidates",
    "list_due_external_feed_sources",
    "mark_external_feed_source_failure",
    "mark_external_feed_source_not_found",
    "mark_external_feed_source_not_modified",
    "upsert_external_feed_item",
    "upsert_external_feed_source",
]

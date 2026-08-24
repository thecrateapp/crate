"""Persistence helpers for allowlisted external feed sources and items."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime, timedelta, timezone
import hashlib
import json
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from sqlalchemy import text

from crate.db.serialize import serialize_rows
from crate.db.repositories.external_feed_associations import (
    apply_external_feed_artist_association,
)
from crate.db.repositories.shows import upsert_show
from crate.db.tx import read_scope, transaction_scope
from crate.llm.prompts.feed_clustering import FeedClusterResponse
from crate.llm.prompts.feed_show_extraction import FeedShowExtractionResponse


DEFAULT_REFRESH_INTERVAL_SECONDS = 21600
MAX_REFRESH_INTERVAL_SECONDS = 604800
MAX_PAYLOAD_BYTES = 64 * 1024
MAX_ERROR_LENGTH = 1000

_SOURCE_KINDS = {
    "bandcamp_rss",
    "publisher_rss",
    "artist_site",
    "label",
    "newsletter",
    "blog",
    "event_page",
}
_SOURCE_SCOPES = {"artist", "label", "publisher"}
_AI_POLICIES = {"enabled", "manual", "disabled"}
_ITEM_KINDS = {"news", "announcement", "release", "other"}
_ENRICHMENT_OPERATIONS = {
    "summary",
    "cluster",
    "classify",
    "extract_show",
    "associate_artist",
}


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
    source_scope: str | None = None,
    display_name: str | None = None,
    publisher_name: str | None = None,
    category: str | None = None,
    logo_url: str | None = None,
    terms_url: str | None = None,
    ai_policy: str = "enabled",
) -> dict[str, Any]:
    """Create or update a source without resetting its HTTP cache state."""
    if source_kind not in _SOURCE_KINDS:
        raise ValueError(f"Unsupported external feed source kind: {source_kind}")
    source_url = _required_http_url(source_url)
    canonical_url = _clean_http_url(canonical_url, required=False)
    parser_version = _required_text(parser_version, max_length=128)
    interval = _validate_refresh_interval(refresh_interval_seconds)
    resolved_scope = source_scope or (
        "publisher" if source_kind == "publisher_rss" else "artist"
    )
    if resolved_scope not in _SOURCE_SCOPES:
        raise ValueError(f"Unsupported external feed source scope: {resolved_scope}")
    if source_kind == "publisher_rss" and artist_id is not None:
        raise ValueError("Publisher RSS sources cannot be associated with an artist")
    if source_kind == "publisher_rss" and resolved_scope != "publisher":
        raise ValueError("Publisher RSS sources must use publisher scope")
    if ai_policy not in _AI_POLICIES:
        raise ValueError(f"Unsupported external feed AI policy: {ai_policy}")

    with transaction_scope() as session:
        result = session.execute(
            text(
                """
                INSERT INTO external_feed_sources (
                    source_kind, source_url, canonical_url, artist_id,
                    association_method, parser_version, refresh_interval_seconds,
                    source_scope, display_name, publisher_name, category, logo_url,
                    terms_url, ai_policy
                ) VALUES (
                    :source_kind, :source_url, :canonical_url, :artist_id,
                    :association_method, :parser_version, :refresh_interval_seconds,
                    :source_scope, :display_name, :publisher_name, :category,
                    :logo_url, :terms_url, :ai_policy
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
                    source_scope = EXCLUDED.source_scope,
                    display_name = COALESCE(
                        EXCLUDED.display_name, external_feed_sources.display_name
                    ),
                    publisher_name = COALESCE(
                        EXCLUDED.publisher_name, external_feed_sources.publisher_name
                    ),
                    category = COALESCE(
                        EXCLUDED.category, external_feed_sources.category
                    ),
                    logo_url = COALESCE(
                        EXCLUDED.logo_url, external_feed_sources.logo_url
                    ),
                    terms_url = COALESCE(
                        EXCLUDED.terms_url, external_feed_sources.terms_url
                    ),
                    ai_policy = EXCLUDED.ai_policy,
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
                "source_scope": resolved_scope,
                "display_name": _clean_text(display_name, max_length=160),
                "publisher_name": _clean_text(publisher_name, max_length=160),
                "category": _clean_text(category, max_length=80),
                "logo_url": _clean_http_url(logo_url, required=False),
                "terms_url": _clean_http_url(terms_url, required=False),
                "ai_policy": ai_policy,
            },
        )
        return dict(result.mappings().one())


def list_external_feed_sources(
    *, scope: str | None = None, limit: int = 100
) -> list[dict[str, Any]]:
    """List configured sources with lightweight ingestion statistics."""
    if scope is not None and scope not in _SOURCE_SCOPES:
        raise ValueError(f"Unsupported external feed source scope: {scope}")
    bounded_limit = max(1, min(int(limit), 500))
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT
                    efs.*,
                    COUNT(efi.id) FILTER (
                        WHERE efi.state = 'active'
                    ) AS active_item_count,
                    MAX(efi.published_at) FILTER (
                        WHERE efi.state = 'active'
                    ) AS latest_item_published_at
                FROM external_feed_sources efs
                LEFT JOIN external_feed_items efi ON efi.source_id = efs.id
                WHERE (:scope IS NULL OR efs.source_scope = :scope)
                GROUP BY efs.id
                ORDER BY efs.updated_at DESC, efs.id DESC
                LIMIT :limit
                """
            ),
            {"scope": scope, "limit": bounded_limit},
        ).mappings()
        return serialize_rows(rows)


def list_external_feed_items_for_source(
    source_id: int, *, limit: int = 10
) -> list[dict[str, Any]]:
    """List cached public items for an admin source preview."""
    bounded_limit = max(1, min(int(limit), 50))
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT
                    efi.id,
                    efi.item_kind,
                    efi.title,
                    efi.author,
                    efi.excerpt,
                    efi.canonical_url,
                    efi.published_at,
                    efi.discovered_at,
                    efi.content_hash,
                    efs.display_name,
                    efs.publisher_name
                FROM external_feed_items efi
                JOIN external_feed_sources efs ON efs.id = efi.source_id
                WHERE efi.source_id = :source_id
                  AND efs.source_kind = 'publisher_rss'
                  AND efs.source_scope = 'publisher'
                  AND efi.state = 'active'
                  AND efi.duplicate_of_id IS NULL
                ORDER BY efi.published_at DESC NULLS LAST, efi.id DESC
                LIMIT :limit
                """
            ),
            {"source_id": int(source_id), "limit": bounded_limit},
        ).mappings()
        return serialize_rows(rows)


def update_external_feed_source(
    source_id: int,
    *,
    state: str | None = None,
    display_name: str | None = None,
    publisher_name: str | None = None,
    category: str | None = None,
    logo_url: str | None = None,
    terms_url: str | None = None,
    ai_policy: str | None = None,
    refresh_interval_seconds: int | None = None,
) -> dict[str, Any] | None:
    """Update admin-editable metadata without resetting fetch state."""
    allowed_states = {"active", "disabled"}
    if state is not None and state not in allowed_states:
        raise ValueError(f"Unsupported external feed state: {state}")
    if ai_policy is not None and ai_policy not in _AI_POLICIES:
        raise ValueError(f"Unsupported external feed AI policy: {ai_policy}")
    interval = (
        _validate_refresh_interval(refresh_interval_seconds)
        if refresh_interval_seconds is not None
        else None
    )
    with transaction_scope() as session:
        return _row(
            session.execute(
                text(
                    """
                    UPDATE external_feed_sources
                    SET state = COALESCE(:state, state),
                        display_name = COALESCE(:display_name, display_name),
                        publisher_name = COALESCE(:publisher_name, publisher_name),
                        category = COALESCE(:category, category),
                        logo_url = COALESCE(:logo_url, logo_url),
                        terms_url = COALESCE(:terms_url, terms_url),
                        ai_policy = COALESCE(:ai_policy, ai_policy),
                        refresh_interval_seconds = COALESCE(
                            :refresh_interval_seconds, refresh_interval_seconds
                        ),
                        updated_at = NOW()
                    WHERE id = :source_id
                      AND source_kind = 'publisher_rss'
                      AND source_scope = 'publisher'
                    RETURNING *
                    """
                ),
                {
                    "source_id": int(source_id),
                    "state": state,
                    "display_name": _clean_text(display_name, max_length=160),
                    "publisher_name": _clean_text(publisher_name, max_length=160),
                    "category": _clean_text(category, max_length=80),
                    "logo_url": _clean_http_url(logo_url, required=False),
                    "terms_url": _clean_http_url(terms_url, required=False),
                    "ai_policy": ai_policy,
                    "refresh_interval_seconds": interval,
                },
            )
        )


def mark_external_feed_source_due(source_id: int) -> dict[str, Any] | None:
    """Make one publisher source eligible for the next worker pass."""
    with transaction_scope() as session:
        return _row(
            session.execute(
                text(
                    """
                    UPDATE external_feed_sources
                    SET state = 'active', next_fetch_at = NOW(), updated_at = NOW()
                    WHERE id = :source_id
                      AND source_kind = 'publisher_rss'
                      AND source_scope = 'publisher'
                    RETURNING *
                    """
                ),
                {"source_id": int(source_id)},
            )
        )


def get_external_feed_source(source_id: int) -> dict[str, Any] | None:
    with read_scope() as session:
        return _row(
            session.execute(
                text("SELECT * FROM external_feed_sources WHERE id = :source_id"),
                {"source_id": source_id},
            )
        )


def get_external_feed_item(item_id: int) -> dict[str, Any] | None:
    """Return one active feed item with the source context used by enrichment."""
    with read_scope() as session:
        return _row(
            session.execute(
                text(
                    """
                    SELECT
                        efi.*,
                        efs.source_kind,
                        efs.source_url AS feed_source_url,
                        efs.canonical_url AS artist_url,
                        la.name AS artist_name
                    FROM external_feed_items efi
                    JOIN external_feed_sources efs ON efs.id = efi.source_id
                    LEFT JOIN library_artists la ON la.id = efi.artist_id
                    WHERE efi.id = :item_id
                      AND efi.state = 'active'
                    """
                ),
                {"item_id": int(item_id)},
            )
        )


def list_external_feed_cluster_candidates(
    item_id: int, *, limit: int = 12, window_days: int = 45
) -> list[dict[str, Any]]:
    """List nearby active items from the same artist for semantic clustering."""
    bounded_limit = max(1, min(int(limit), 50))
    bounded_window = max(1, min(int(window_days), 180))
    with read_scope() as session:
        target = _row(
            session.execute(
                text(
                    """
                    SELECT artist_id, published_at
                    FROM external_feed_items
                    WHERE id = :item_id AND state = 'active'
                    """
                ),
                {"item_id": int(item_id)},
            )
        )
        if target is None or target.get("artist_id") is None:
            return []
        published_at = target.get("published_at")
        rows = session.execute(
            text(
                """
                SELECT
                    efi.*,
                    efs.source_kind,
                    efs.source_url AS feed_source_url,
                    efs.canonical_url AS artist_url,
                    CASE
                        WHEN efs.source_kind = 'publisher_rss' THEN NULL
                        ELSE COALESCE(
                            la.name,
                            NULLIF(efi.payload_json ->> 'author', '')
                        )
                    END AS artist_name
                FROM external_feed_items efi
                JOIN external_feed_sources efs ON efs.id = efi.source_id
                LEFT JOIN library_artists la ON la.id = efi.artist_id
                WHERE efi.id <> :item_id
                  AND efi.artist_id = :artist_id
                  AND efi.state = 'active'
                  AND efi.duplicate_of_id IS NULL
                  AND (
                      :published_at IS NULL
                      OR efi.published_at IS NULL
                      OR efi.published_at BETWEEN
                          :window_start AND :window_end
                  )
                ORDER BY efi.published_at DESC NULLS LAST, efi.id DESC
                LIMIT :limit
                """
            ),
            {
                "item_id": int(item_id),
                "artist_id": int(target["artist_id"]),
                "published_at": published_at,
                "window_start": published_at - timedelta(days=bounded_window)
                if published_at
                else None,
                "window_end": published_at + timedelta(days=bounded_window)
                if published_at
                else None,
                "limit": bounded_limit,
            },
        ).mappings()
        return serialize_rows(rows)


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


def list_external_feed_items_for_user(
    user_id: int, *, limit: int = 100
) -> list[dict[str, Any]]:
    """Return global editorial items plus private items from the user's Bandcamp graph."""
    bounded_limit = max(1, min(int(limit), 500))
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT
                    efi.*,
                    efs.source_kind,
                    efs.source_url AS feed_source_url,
                    efs.canonical_url AS artist_url,
                    efs.association_method,
                    efs.source_scope,
                    efs.display_name,
                    efs.publisher_name,
                    efs.category,
                    accepted_enrichment.result_json AS accepted_enrichment_json,
                    accepted_enrichment.model AS accepted_enrichment_model,
                    accepted_enrichment.prompt_version
                        AS accepted_enrichment_prompt_version,
                    accepted_classification.result_json
                        AS accepted_classification_json,
                    accepted_cluster.id AS accepted_cluster_enrichment_id,
                    accepted_cluster.result_json AS accepted_cluster_json,
                    accepted_cluster.cluster_applied_at
                        AS accepted_cluster_applied_at,
                    accepted_cluster.cluster_reverted_at
                        AS accepted_cluster_reverted_at,
                    CASE
                        WHEN efs.source_kind = 'publisher_rss' THEN item_artist.name
                        ELSE COALESCE(
                            la.name,
                            item_artist.name,
                            NULLIF(efi.payload_json ->> 'author', '')
                        )
                    END AS artist_name,
                    CASE
                        WHEN efs.source_kind = 'publisher_rss' THEN item_artist.slug
                        ELSE COALESCE(la.slug, item_artist.slug)
                    END AS artist_slug
                FROM external_feed_items efi
                JOIN external_feed_sources efs ON efs.id = efi.source_id
                LEFT JOIN library_artists la ON la.id = efs.artist_id
                LEFT JOIN library_artists item_artist ON item_artist.id = efi.artist_id
                LEFT JOIN LATERAL (
                    SELECT
                        efe.result_json,
                        efe.model,
                        efe.prompt_version
                    FROM external_feed_enrichments efe
                    WHERE efe.item_id = efi.id
                      AND efe.operation = 'summary'
                      AND efe.status = 'ready'
                      AND efe.review_status = 'accepted'
                      AND efe.source_content_hash = efi.content_hash
                    ORDER BY efe.id DESC
                    LIMIT 1
                ) accepted_enrichment ON TRUE
                LEFT JOIN LATERAL (
                    SELECT efe.result_json
                    FROM external_feed_enrichments efe
                    WHERE efe.item_id = efi.id
                      AND efe.operation = 'classify'
                      AND efe.status = 'ready'
                      AND efe.review_status = 'accepted'
                      AND efe.source_content_hash = efi.content_hash
                    ORDER BY efe.id DESC
                    LIMIT 1
                ) accepted_classification ON TRUE
                LEFT JOIN LATERAL (
                    SELECT
                        efe.id,
                        efe.result_json,
                        efe.cluster_applied_at,
                        efe.cluster_reverted_at
                    FROM external_feed_enrichments efe
                    WHERE efe.item_id = efi.id
                      AND efe.operation = 'cluster'
                      AND efe.status = 'ready'
                      AND efe.review_status = 'accepted'
                      AND efe.source_content_hash = efi.content_hash
                    ORDER BY efe.id DESC
                    LIMIT 1
                ) accepted_cluster ON TRUE
                WHERE efi.state = 'active'
                  AND efi.duplicate_of_id IS NULL
                  AND efs.state IN ('active', 'degraded')
                    AND (
                      (
                          efs.source_kind = 'publisher_rss'
                          AND efs.source_scope = 'publisher'
                      )
                      OR (
                          efs.source_kind = 'bandcamp_rss'
                          AND EXISTS (
                              SELECT 1
                              FROM bandcamp_connections bc
                              WHERE bc.user_id = :user_id
                                AND bc.status = 'connected'
                                AND bc.revoked_at IS NULL
                          )
                          AND (
                              EXISTS (
                                  SELECT 1
                                  FROM user_global_artist_follows ugaf
                                  JOIN global_catalog_artists ga
                                    ON ga.global_artist_uid = ugaf.global_artist_uid
                                  WHERE ugaf.user_id = :user_id
                                    AND ga.local_artist_id = efs.artist_id
                              )
                              OR EXISTS (
                                  SELECT 1
                                  FROM user_follows uf
                                  WHERE uf.user_id = :user_id
                                    AND lower(uf.artist_name) = lower(la.name)
                              )
                              OR EXISTS (
                                  SELECT 1
                                  FROM user_bandcamp_items ubi
                                  JOIN bandcamp_connections bc
                                    ON bc.id = ubi.connection_id
                                   AND bc.user_id = ubi.user_id
                                   AND bc.status = 'connected'
                                   AND bc.revoked_at IS NULL
                                  JOIN bandcamp_items bi
                                    ON bi.id = ubi.bandcamp_item_id
                                  WHERE ubi.user_id = :user_id
                                    AND ubi.relation_type IN ('wishlist', 'following')
                                    AND ubi.removed_at IS NULL
                                    AND lower(regexp_replace(
                                        trim(coalesce(bi.artist_url, '')), '/+$', ''
                                    )) = lower(regexp_replace(
                                        trim(coalesce(efs.canonical_url, '')), '/+$', ''
                                    ))
                              )
                          )
                      )
                  )
                ORDER BY efi.published_at DESC NULLS LAST, efi.id DESC
                LIMIT :limit
                """
            ),
            {"user_id": user_id, "limit": bounded_limit},
        ).mappings()
        return _attach_feed_cluster_context(serialize_rows(rows))


def list_external_feed_items_for_artist(
    user_id: int,
    artist_id: int,
    *,
    limit: int = 30,
    offset: int = 0,
) -> list[dict[str, Any]]:
    """Return only feed items explicitly associated with one library artist."""
    bounded_limit = max(1, min(int(limit), 100))
    bounded_offset = max(0, min(int(offset), 10000))
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT
                    efi.*,
                    efs.source_kind,
                    efs.source_url AS feed_source_url,
                    efs.canonical_url AS artist_url,
                    efs.association_method,
                    efs.source_scope,
                    efs.display_name,
                    efs.publisher_name,
                    efs.category,
                    accepted_enrichment.result_json AS accepted_enrichment_json,
                    accepted_enrichment.model AS accepted_enrichment_model,
                    accepted_enrichment.prompt_version
                        AS accepted_enrichment_prompt_version,
                    accepted_classification.result_json
                        AS accepted_classification_json,
                    CASE
                        WHEN efs.source_kind = 'publisher_rss' THEN item_artist.name
                        ELSE COALESCE(source_artist.name, item_artist.name)
                    END AS artist_name
                FROM external_feed_items efi
                JOIN external_feed_sources efs ON efs.id = efi.source_id
                LEFT JOIN library_artists source_artist
                    ON source_artist.id = efs.artist_id
                LEFT JOIN library_artists item_artist
                    ON item_artist.id = efi.artist_id
                LEFT JOIN LATERAL (
                    SELECT
                        efe.result_json,
                        efe.model,
                        efe.prompt_version
                    FROM external_feed_enrichments efe
                    WHERE efe.item_id = efi.id
                      AND efe.operation = 'summary'
                      AND efe.status = 'ready'
                      AND efe.review_status = 'accepted'
                      AND efe.source_content_hash = efi.content_hash
                    ORDER BY efe.id DESC
                    LIMIT 1
                ) accepted_enrichment ON TRUE
                LEFT JOIN LATERAL (
                    SELECT efe.result_json
                    FROM external_feed_enrichments efe
                    WHERE efe.item_id = efi.id
                      AND efe.operation = 'classify'
                      AND efe.status = 'ready'
                      AND efe.review_status = 'accepted'
                      AND efe.source_content_hash = efi.content_hash
                    ORDER BY efe.id DESC
                    LIMIT 1
                ) accepted_classification ON TRUE
                WHERE efi.state = 'active'
                  AND efi.duplicate_of_id IS NULL
                  AND efs.state IN ('active', 'degraded')
                  AND (efs.artist_id = :artist_id OR efi.artist_id = :artist_id)
                  AND (
                      efs.source_kind <> 'bandcamp_rss'
                      OR EXISTS (
                          SELECT 1
                          FROM bandcamp_connections bc
                          WHERE bc.user_id = :user_id
                            AND bc.status = 'connected'
                            AND bc.revoked_at IS NULL
                      )
                  )
                ORDER BY efi.published_at DESC NULLS LAST, efi.id DESC
                LIMIT :limit OFFSET :offset
                """
            ),
            {
                "user_id": int(user_id),
                "artist_id": int(artist_id),
                "limit": bounded_limit,
                "offset": bounded_offset,
            },
        ).mappings()
        return _attach_feed_cluster_context(serialize_rows(rows))


def _attach_feed_cluster_context(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Attach safe, current cluster metadata to every visible cluster member."""
    visible_by_id = {
        int(row["id"]): row for row in rows if isinstance(row.get("id"), int)
    }

    for row in rows:
        enrichment_id = row.get("accepted_cluster_enrichment_id")
        result = row.get("accepted_cluster_json")
        if not isinstance(enrichment_id, int) or not isinstance(result, Mapping):
            continue
        try:
            proposal = FeedClusterResponse.model_validate(result)
        except ValueError:
            # A malformed historical proposal must not break the user feed.
            continue

        members: list[dict[str, Any]] = []
        for member in proposal.members:
            member_row = visible_by_id.get(member.item_id)
            member_context: dict[str, Any] = {
                "id": member.item_id,
                "role": member.role,
                "reason": member.reason,
                "visible": member_row is not None,
            }
            if member_row is not None:
                for field in ("title", "canonical_url", "published_at"):
                    value = member_row.get(field)
                    if value is not None and str(value).strip():
                        member_context[field] = str(value).strip()
                source = member_row.get("source_kind")
                if source is not None and str(source).strip():
                    member_context["source"] = str(source).strip()
            members.append(member_context)

        cluster = {
            "cluster_id": f"external-feed-cluster:{enrichment_id}",
            "enrichment_id": enrichment_id,
            "cluster_type": proposal.cluster_type,
            "confidence": proposal.confidence,
            "rationale": proposal.rationale,
            "applied": bool(
                row.get("accepted_cluster_applied_at") is not None
                and row.get("accepted_cluster_reverted_at") is None
            ),
            "members": members,
        }
        for member in proposal.members:
            member_row = visible_by_id.get(member.item_id)
            if member_row is None:
                continue
            member_row.setdefault("feed_clusters", []).append(cluster)

    for row in rows:
        row.pop("accepted_cluster_enrichment_id", None)
        row.pop("accepted_cluster_json", None)
        row.pop("accepted_cluster_applied_at", None)
        row.pop("accepted_cluster_reverted_at", None)
    return rows


def list_due_external_feed_sources(
    *,
    limit: int = 50,
    now: datetime | None = None,
    source_kind: str | None = None,
    source_id: int | None = None,
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
                  AND (:source_id IS NULL OR id = :source_id)
                ORDER BY next_fetch_at ASC NULLS FIRST, id ASC
                LIMIT :limit
                """
            ),
            {
                "now": due_at,
                "limit": bounded_limit,
                "source_kind": source_kind,
                "source_id": source_id,
            },
        ).mappings()
        return [dict(row) for row in rows]


def get_external_feed_item_enrichment(
    *, item_id: int, operation: str = "summary"
) -> dict[str, Any] | None:
    if operation not in _ENRICHMENT_OPERATIONS:
        raise ValueError(f"Unsupported external feed AI operation: {operation}")
    with read_scope() as session:
        return _row(
            session.execute(
                text(
                    """
                    SELECT *
                    FROM external_feed_enrichments
                    WHERE item_id = :item_id
                      AND operation = :operation
                    ORDER BY id DESC
                    LIMIT 1
                    """
                ),
                {"item_id": int(item_id), "operation": operation},
            )
        )


def list_external_feed_enrichments_for_review(
    *, review_status: str | None = "pending", limit: int = 100
) -> list[dict[str, Any]]:
    """List current AI proposals with enough context for curator review."""
    if review_status not in {None, "pending", "accepted", "rejected"}:
        raise ValueError(f"Unsupported external feed review status: {review_status}")
    bounded_limit = max(1, min(int(limit), 200))
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT
                    efe.*,
                    efi.title,
                    efi.item_kind,
                    efi.source_url,
                    efi.canonical_url,
                    efi.excerpt,
                    efi.published_at,
                    efi.content_hash AS current_content_hash,
                    efs.source_kind,
                    efs.source_url AS feed_source_url,
                    efs.canonical_url AS artist_url,
                    efi.artist_id AS associated_artist_id,
                    efi.artist_association_method,
                    efi.artist_association_confidence,
                    efi.artist_associated_at,
                    efi.artist_associated_by_user_id,
                    COALESCE(
                        la.name,
                        NULLIF(efi.payload_json ->> 'author', '')
                    ) AS artist_name
                FROM external_feed_enrichments efe
                JOIN external_feed_items efi ON efi.id = efe.item_id
                JOIN external_feed_sources efs ON efs.id = efi.source_id
                LEFT JOIN library_artists la ON la.id = efi.artist_id
                WHERE efe.status = 'ready'
                  AND efi.state = 'active'
                  AND efe.source_content_hash = efi.content_hash
                  AND (:review_status IS NULL OR efe.review_status = :review_status)
                ORDER BY efi.published_at DESC NULLS LAST, efe.updated_at DESC,
                    efe.id DESC
                LIMIT :limit
                """
            ),
            {"review_status": review_status, "limit": bounded_limit},
        ).mappings()
        return serialize_rows(rows)


def get_external_feed_enrichment(enrichment_id: int) -> dict[str, Any] | None:
    with read_scope() as session:
        return _row(
            session.execute(
                text(
                    """
                    SELECT
                        efe.*,
                        efi.title,
                        efi.item_kind,
                        efi.source_url,
                        efi.canonical_url,
                        efi.excerpt,
                        efi.published_at,
                        efi.content_hash AS current_content_hash,
                        efs.source_kind,
                        efs.source_url AS feed_source_url,
                        efs.canonical_url AS artist_url,
                        efi.artist_id AS associated_artist_id,
                        efi.artist_association_method,
                        efi.artist_association_confidence,
                        efi.artist_associated_at,
                        efi.artist_associated_by_user_id,
                        COALESCE(
                            la.name,
                            NULLIF(efi.payload_json ->> 'author', '')
                        ) AS artist_name
                    FROM external_feed_enrichments efe
                    JOIN external_feed_items efi ON efi.id = efe.item_id
                    JOIN external_feed_sources efs ON efs.id = efi.source_id
                    LEFT JOIN library_artists la ON la.id = efi.artist_id
                    WHERE efe.id = :enrichment_id
                    """
                ),
                {"enrichment_id": int(enrichment_id)},
            )
        )


def review_external_feed_enrichment(
    enrichment_id: int,
    *,
    reviewer_id: int,
    decision: str,
    rejection_reason: str | None = None,
) -> dict[str, Any] | None:
    """Record editorial acceptance or rejection of a current AI proposal."""
    if decision not in {"accept", "reject"}:
        raise ValueError(f"Unsupported external feed review decision: {decision}")
    reason = _clean_text(rejection_reason, max_length=1000)
    if decision == "reject" and not reason:
        raise ValueError("A rejection reason is required")
    review_status = "accepted" if decision == "accept" else "rejected"
    with transaction_scope() as session:
        result = session.execute(
            text(
                """
                UPDATE external_feed_enrichments AS efe
                SET review_status = :review_status,
                    reviewed_by_user_id = :reviewer_id,
                    reviewed_at = NOW(),
                    rejection_reason = :rejection_reason,
                    updated_at = NOW()
                FROM external_feed_items efi
                WHERE efe.id = :enrichment_id
                  AND efi.id = efe.item_id
                  AND efe.status = 'ready'
                  AND efi.state = 'active'
                  AND efe.source_content_hash = efi.content_hash
                RETURNING efe.*
                """
            ),
            {
                "enrichment_id": int(enrichment_id),
                "reviewer_id": int(reviewer_id),
                "review_status": review_status,
                "rejection_reason": reason if decision == "reject" else None,
            },
        )
        row = _row(result)
        if (
            row is not None
            and decision == "accept"
            and row["operation"] == ("associate_artist")
        ):
            apply_external_feed_artist_association(
                session,
                enrichment_id=int(enrichment_id),
                applied_by_user_id=int(reviewer_id),
            )
        return row


def apply_external_feed_show_enrichment(
    enrichment_id: int, *, applied_by_user_id: int
) -> dict[str, Any] | None:
    """Apply an accepted current show proposal to the shared show catalogue."""
    with transaction_scope() as session:
        row = _row(
            session.execute(
                text(
                    """
                    SELECT
                        efe.*,
                        efi.state AS item_state,
                        efi.content_hash AS current_content_hash,
                        COALESCE(
                            la.name,
                            NULLIF(efi.payload_json ->> 'author', '')
                        ) AS artist_name
                    FROM external_feed_enrichments efe
                    JOIN external_feed_items efi ON efi.id = efe.item_id
                    LEFT JOIN library_artists la ON la.id = efi.artist_id
                    WHERE efe.id = :enrichment_id
                    FOR UPDATE OF efe, efi
                    """
                ),
                {"enrichment_id": int(enrichment_id)},
            )
        )
        if row is None:
            return None

        existing_show_ids = [
            int(value) for value in (row.get("applied_show_ids") or [])
        ]
        if existing_show_ids:
            return {
                "enrichment_id": int(enrichment_id),
                "show_ids": existing_show_ids,
                "applied": True,
                "already_applied": True,
            }
        if row["operation"] != "extract_show":
            raise ValueError("Only show extraction proposals can be applied")
        if row["status"] != "ready":
            raise ValueError("Show proposal is not ready")
        if row["review_status"] != "accepted":
            raise ValueError("Show proposal must be accepted before applying")
        if row["item_state"] != "active":
            raise ValueError("External feed item is no longer active")
        if row["source_content_hash"] != row["current_content_hash"]:
            raise ValueError("Show proposal is stale because the source changed")

        artist_name = str(row.get("artist_name") or "").strip()
        if not artist_name:
            raise ValueError("Show proposal has no associated artist")

        try:
            proposal = FeedShowExtractionResponse.model_validate(
                row.get("result_json") or {}
            )
        except ValueError as exc:
            raise ValueError("Show proposal has an invalid result") from exc
        if not proposal.shows:
            raise ValueError("Show proposal contains no events")

        show_ids: list[int] = []
        for index, candidate in enumerate(proposal.shows):
            show_id = upsert_show(
                external_id=f"external-feed-ai:{enrichment_id}:{index}",
                artist_name=artist_name,
                date=candidate.event_date.isoformat(),
                local_time=candidate.local_time,
                venue=candidate.venue,
                address_line1=candidate.address_line1,
                city=candidate.city,
                region=candidate.region,
                postal_code=candidate.postal_code,
                country=candidate.country,
                country_code=candidate.country_code,
                url=str(candidate.url) if candidate.url else None,
                tickets_url=(
                    str(candidate.tickets_url) if candidate.tickets_url else None
                ),
                status="scheduled",
                source="external_feed_ai",
            )
            if show_id is None:
                raise RuntimeError("Show upsert did not return an id")
            show_ids.append(int(show_id))

        session.execute(
            text(
                """
                UPDATE external_feed_enrichments
                SET applied_at = NOW(),
                    applied_by_user_id = :applied_by_user_id,
                    applied_show_ids = CAST(:applied_show_ids AS jsonb),
                    updated_at = NOW()
                WHERE id = :enrichment_id
                """
            ),
            {
                "enrichment_id": int(enrichment_id),
                "applied_by_user_id": int(applied_by_user_id),
                "applied_show_ids": json.dumps(show_ids),
            },
        )
        return {
            "enrichment_id": int(enrichment_id),
            "show_ids": show_ids,
            "applied": True,
            "already_applied": False,
        }


def _load_cluster_application_row(session, enrichment_id: int) -> dict[str, Any] | None:
    return _row(
        session.execute(
            text(
                """
                SELECT
                    efe.*,
                    efi.state AS item_state,
                    efi.artist_id AS item_artist_id,
                    efi.content_hash AS current_content_hash
                FROM external_feed_enrichments efe
                JOIN external_feed_items efi ON efi.id = efe.item_id
                WHERE efe.id = :enrichment_id
                FOR UPDATE OF efe, efi
                """
            ),
            {"enrichment_id": int(enrichment_id)},
        )
    )


def _parse_cluster_application(row: Mapping[str, Any]) -> tuple[int, list[int]]:
    if row["operation"] != "cluster":
        raise ValueError("Only clustering proposals can be applied")
    try:
        proposal = FeedClusterResponse.model_validate(row.get("result_json") or {})
    except ValueError as exc:
        raise ValueError("Cluster proposal has an invalid result") from exc

    representative_ids = [
        int(member.item_id)
        for member in proposal.members
        if member.role == "representative"
    ]
    member_ids = [int(member.item_id) for member in proposal.members]
    related_ids = [
        int(member.item_id) for member in proposal.members if member.role == "related"
    ]
    if len(member_ids) != len(set(member_ids)):
        raise ValueError("Cluster proposal contains duplicate item IDs")
    if len(representative_ids) != 1:
        raise ValueError("Cluster proposal must contain one representative item")
    if not related_ids:
        raise ValueError("Cluster proposal contains no related items")
    if int(row["item_id"]) not in member_ids:
        raise ValueError("Cluster proposal does not include its target item")
    return representative_ids[0], related_ids


def apply_external_feed_cluster_enrichment(
    enrichment_id: int, *, applied_by_user_id: int
) -> dict[str, Any] | None:
    """Hide accepted related items while preserving an explicit undo path."""
    with transaction_scope() as session:
        row = _load_cluster_application_row(session, enrichment_id)
        if row is None:
            return None
        representative_id, related_ids = _parse_cluster_application(row)
        existing_ids = [
            int(value) for value in (row.get("cluster_applied_item_ids") or [])
        ]
        if (
            row.get("cluster_applied_at") is not None
            and row.get("cluster_reverted_at") is None
        ):
            return {
                "enrichment_id": int(enrichment_id),
                "representative_item_id": representative_id,
                "related_item_ids": existing_ids,
                "applied": True,
                "already_applied": True,
            }
        if row["status"] != "ready":
            raise ValueError("Cluster proposal is not ready")
        if row["review_status"] != "accepted":
            raise ValueError("Cluster proposal must be accepted before applying")
        if row["item_state"] != "active":
            raise ValueError("External feed item is no longer active")
        if row["current_content_hash"] != row["source_content_hash"]:
            raise ValueError("Cluster proposal is stale because the source changed")
        if row.get("item_artist_id") is None:
            raise ValueError("Cluster proposal has no associated artist")

        member_ids = [representative_id, *related_ids]
        locked_items: dict[int, dict[str, Any]] = {}
        for member_id in sorted(set(member_ids)):
            member_row = _row(
                session.execute(
                    text(
                        """
                        SELECT id, state, artist_id, duplicate_of_id
                        FROM external_feed_items
                        WHERE id = :item_id
                        FOR UPDATE
                        """
                    ),
                    {"item_id": member_id},
                )
            )
            if member_row is None:
                raise ValueError("Cluster proposal references a missing item")
            if member_row["state"] != "active":
                raise ValueError("Cluster proposal references an inactive item")
            if member_row["artist_id"] != row["item_artist_id"]:
                raise ValueError("Cluster proposal references a different artist")
            locked_items[member_id] = member_row

        representative = locked_items[representative_id]
        if representative["duplicate_of_id"] is not None:
            raise ValueError("Cluster representative is already hidden as a duplicate")

        applied_ids: list[int] = []
        for related_id in related_ids:
            duplicate_of_id = locked_items[related_id]["duplicate_of_id"]
            if duplicate_of_id is not None and duplicate_of_id != representative_id:
                raise ValueError(
                    "A related item is already assigned to another duplicate"
                )
            if duplicate_of_id is None:
                session.execute(
                    text(
                        """
                        UPDATE external_feed_items
                        SET duplicate_of_id = :representative_id,
                            updated_at = NOW()
                        WHERE id = :item_id
                        """
                    ),
                    {"item_id": related_id, "representative_id": representative_id},
                )
            applied_ids.append(related_id)

        session.execute(
            text(
                """
                UPDATE external_feed_enrichments
                SET cluster_applied_at = NOW(),
                    cluster_applied_by_user_id = :applied_by_user_id,
                    cluster_applied_item_ids = CAST(:item_ids AS jsonb),
                    cluster_reverted_at = NULL,
                    cluster_reverted_by_user_id = NULL,
                    updated_at = NOW()
                WHERE id = :enrichment_id
                """
            ),
            {
                "enrichment_id": int(enrichment_id),
                "applied_by_user_id": int(applied_by_user_id),
                "item_ids": json.dumps(applied_ids),
            },
        )
        return {
            "enrichment_id": int(enrichment_id),
            "representative_item_id": representative_id,
            "related_item_ids": applied_ids,
            "applied": True,
            "already_applied": False,
        }


def revert_external_feed_cluster_enrichment(
    enrichment_id: int, *, reverted_by_user_id: int
) -> dict[str, Any] | None:
    """Restore only related items hidden by the last cluster application."""
    with transaction_scope() as session:
        row = _load_cluster_application_row(session, enrichment_id)
        if row is None:
            return None
        representative_id, _ = _parse_cluster_application(row)
        applied_ids = [
            int(value) for value in (row.get("cluster_applied_item_ids") or [])
        ]
        if not applied_ids or row.get("cluster_reverted_at") is not None:
            return {
                "enrichment_id": int(enrichment_id),
                "representative_item_id": representative_id,
                "restored_item_ids": [],
                "restored": True,
                "already_reverted": True,
            }

        restored_ids: list[int] = []
        for related_id in applied_ids:
            result = session.execute(
                text(
                    """
                    UPDATE external_feed_items
                    SET duplicate_of_id = NULL,
                        updated_at = NOW()
                    WHERE id = :item_id
                      AND duplicate_of_id = :representative_id
                    RETURNING id
                    """
                ),
                {"item_id": related_id, "representative_id": representative_id},
            )
            if result.scalar_one_or_none() is not None:
                restored_ids.append(related_id)

        session.execute(
            text(
                """
                UPDATE external_feed_enrichments
                SET cluster_reverted_at = NOW(),
                    cluster_reverted_by_user_id = :reverted_by_user_id,
                    updated_at = NOW()
                WHERE id = :enrichment_id
                """
            ),
            {
                "enrichment_id": int(enrichment_id),
                "reverted_by_user_id": int(reverted_by_user_id),
            },
        )
        return {
            "enrichment_id": int(enrichment_id),
            "representative_item_id": representative_id,
            "restored_item_ids": restored_ids,
            "restored": True,
            "already_reverted": False,
        }


def queue_external_feed_item_enrichment(
    *,
    item_id: int,
    operation: str,
    source_content_hash: str,
    prompt_version: str,
    language: str = "English",
    model: str | None = None,
) -> dict[str, Any]:
    """Create one deduplicated enrichment proposal for the current item hash."""
    if operation not in _ENRICHMENT_OPERATIONS:
        raise ValueError(f"Unsupported external feed AI operation: {operation}")
    content_hash = _required_text(source_content_hash, max_length=128)
    prompt_version = _required_text(prompt_version, max_length=128)
    language = _required_text(language, max_length=40)
    with transaction_scope() as session:
        item = _row(
            session.execute(
                text(
                    """
                    SELECT state, content_hash
                    FROM external_feed_items
                    WHERE id = :item_id
                    FOR UPDATE
                    """
                ),
                {"item_id": int(item_id)},
            )
        )
        if item is None:
            raise ValueError("External feed item not found")
        if item["state"] != "active":
            raise ValueError("External feed item must be active")
        if item["content_hash"] != content_hash:
            raise ValueError("External feed item content has changed")

        result = session.execute(
            text(
                """
                INSERT INTO external_feed_enrichments (
                    item_id, operation, status, source_content_hash,
                    language, model, prompt_version
                ) VALUES (
                    :item_id, :operation, 'pending', :source_content_hash,
                    :language, :model, :prompt_version
                )
                ON CONFLICT (item_id, operation, source_content_hash, language) DO UPDATE SET
                    status = CASE
                        WHEN external_feed_enrichments.status IN ('failed', 'stale')
                            THEN 'pending'
                        ELSE external_feed_enrichments.status
                    END,
                    result_json = CASE
                        WHEN external_feed_enrichments.status IN ('failed', 'stale')
                            THEN '{}'::jsonb
                        ELSE external_feed_enrichments.result_json
                    END,
                    error = CASE
                        WHEN external_feed_enrichments.status IN ('failed', 'stale')
                            THEN NULL
                        ELSE external_feed_enrichments.error
                    END,
                    review_status = CASE
                        WHEN external_feed_enrichments.status IN ('failed', 'stale')
                            THEN 'pending'
                        ELSE external_feed_enrichments.review_status
                    END,
                    model = COALESCE(EXCLUDED.model, external_feed_enrichments.model),
                    prompt_version = EXCLUDED.prompt_version,
                    updated_at = NOW()
                RETURNING *
                """
            ),
            {
                "item_id": int(item_id),
                "operation": operation,
                "source_content_hash": content_hash,
                "language": language,
                "model": _clean_text(model, max_length=256),
                "prompt_version": prompt_version,
            },
        )
        return dict(result.mappings().one())


def mark_external_feed_enrichment_ready(
    enrichment_id: int,
    *,
    result: Mapping[str, Any],
    model: str | None,
    prompt_version: str,
) -> dict[str, Any] | None:
    payload = json.dumps(dict(result), default=str, ensure_ascii=False)
    with transaction_scope() as session:
        return _row(
            session.execute(
                text(
                    """
                    UPDATE external_feed_enrichments
                    SET status = 'ready',
                        result_json = CAST(:result_json AS jsonb),
                        model = :model,
                        prompt_version = :prompt_version,
                        error = NULL,
                        updated_at = NOW()
                    WHERE id = :enrichment_id
                    RETURNING *
                    """
                ),
                {
                    "enrichment_id": int(enrichment_id),
                    "result_json": payload,
                    "model": _clean_text(model, max_length=256),
                    "prompt_version": _required_text(prompt_version, max_length=128),
                },
            )
        )


def mark_external_feed_enrichment_failed(
    enrichment_id: int, *, error: str
) -> dict[str, Any] | None:
    with transaction_scope() as session:
        return _row(
            session.execute(
                text(
                    """
                    UPDATE external_feed_enrichments
                    SET status = 'failed',
                        error = :error,
                        updated_at = NOW()
                    WHERE id = :enrichment_id
                    RETURNING *
                    """
                ),
                {
                    "enrichment_id": int(enrichment_id),
                    "error": _required_text(error, max_length=1000),
                },
            )
        )


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
                        payload_json, parser_version, artist_association_method,
                        artist_association_confidence, artist_associated_at
                    ) VALUES (
                        :source_id, :artist_id, :item_kind, :state, :external_guid,
                        :source_url, :canonical_url, :title, :author, :excerpt,
                        :published_at, :content_hash, :duplicate_of_id,
                        CAST(:payload_json AS jsonb), :parser_version,
                        CASE WHEN :artist_id IS NOT NULL THEN 'source_artist' END,
                        CASE WHEN :artist_id IS NOT NULL THEN 1.0 END,
                        CASE WHEN :artist_id IS NOT NULL THEN NOW() END
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
                    SET artist_id = CASE
                            WHEN :artist_id IS NOT NULL THEN :artist_id
                            WHEN external_feed_items.content_hash <> :content_hash
                                THEN NULL
                            ELSE external_feed_items.artist_id
                        END,
                        artist_association_method = CASE
                            WHEN :artist_id IS NOT NULL THEN 'source_artist'
                            WHEN external_feed_items.content_hash <> :content_hash
                                THEN NULL
                            ELSE external_feed_items.artist_association_method
                        END,
                        artist_association_confidence = CASE
                            WHEN :artist_id IS NOT NULL THEN 1.0
                            WHEN external_feed_items.content_hash <> :content_hash
                                THEN NULL
                            ELSE external_feed_items.artist_association_confidence
                        END,
                        artist_associated_at = CASE
                            WHEN :artist_id IS NOT NULL THEN NOW()
                            WHEN external_feed_items.content_hash <> :content_hash
                                THEN NULL
                            ELSE external_feed_items.artist_associated_at
                        END,
                        artist_associated_by_user_id = CASE
                            WHEN :artist_id IS NOT NULL THEN NULL
                            WHEN external_feed_items.content_hash <> :content_hash
                                THEN NULL
                            ELSE external_feed_items.artist_associated_by_user_id
                        END,
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
    "get_external_feed_item",
    "get_external_feed_enrichment",
    "get_external_feed_item_enrichment",
    "get_external_feed_source",
    "list_external_feed_sources",
    "list_external_feed_items_for_source",
    "list_external_feed_items_for_artist",
    "list_external_feed_cluster_candidates",
    "apply_external_feed_cluster_enrichment",
    "apply_external_feed_show_enrichment",
    "list_bandcamp_feed_candidates",
    "list_external_feed_items_for_user",
    "list_external_feed_enrichments_for_review",
    "list_due_external_feed_sources",
    "mark_external_feed_enrichment_failed",
    "mark_external_feed_enrichment_ready",
    "mark_external_feed_source_failure",
    "mark_external_feed_source_due",
    "revert_external_feed_cluster_enrichment",
    "mark_external_feed_source_not_found",
    "mark_external_feed_source_not_modified",
    "queue_external_feed_item_enrichment",
    "review_external_feed_enrichment",
    "update_external_feed_source",
    "upsert_external_feed_item",
    "upsert_external_feed_source",
]

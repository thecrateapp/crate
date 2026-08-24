"""Allowlisted RSS/Atom adapters for editorial artist and label sources."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any
from urllib.parse import urlsplit, urlunsplit
from urllib.robotparser import RobotFileParser

import requests

from crate.db.repositories.external_feeds import upsert_external_feed_source
from crate.feeds.rss import (
    DEFAULT_MAX_BYTES,
    DEFAULT_MAX_ITEMS,
    RSSFeedFetchResult,
    RSSFeedHTTPError,
    RSSFeedInvalidError,
    RSSFeedNotFoundError,
    RSSFeedItem,
    build_conditional_headers,
    parse_feed_payload,
)


EDITORIAL_SOURCE_KINDS = frozenset(
    {"artist_site", "label", "newsletter", "blog", "event_page"}
)
PUBLISHER_SOURCE_KINDS = frozenset({"publisher_rss"})
EDITORIAL_ASSOCIATION_METHODS = frozenset(
    {"artist_official", "label_official", "newsletter_opt_in", "admin_allowlist"}
)
PARSER_VERSION = "editorial-feed-v1"
DEFAULT_TIMEOUT_SECONDS = 20.0
_ALLOWED_CONTENT_TYPES = {
    "application/atom+xml",
    "application/rss+xml",
    "application/xml",
    "text/xml",
}
_USER_AGENT = "Crate/1.0 (+https://cratemusic.app)"

EditorialFeedFetchResult = RSSFeedFetchResult
EditorialFeedItem = RSSFeedItem
EditorialFeedHTTPError = RSSFeedHTTPError
EditorialFeedInvalidError = RSSFeedInvalidError
EditorialFeedNotFoundError = RSSFeedNotFoundError


def validate_editorial_feed_url(value: str) -> str:
    raw = str(value or "").strip()
    parsed = urlsplit(raw)
    if parsed.scheme.casefold() != "https" or not parsed.hostname:
        raise ValueError("Editorial feed URL must use HTTPS")
    if parsed.username or parsed.password:
        raise ValueError("Editorial feed URL cannot contain credentials")
    try:
        port = parsed.port
    except ValueError as exc:
        raise ValueError("Editorial feed URL has an invalid port") from exc
    host = parsed.hostname.casefold()
    if port is not None:
        host = f"{host}:{port}"
    return urlunsplit(("https", host, parsed.path or "", parsed.query, ""))


def register_editorial_feed_source(
    *,
    source_kind: str,
    source_url: str,
    canonical_url: str,
    artist_id: int,
    association_method: str,
    allowed_hosts: Sequence[str],
    refresh_interval_seconds: int = 21600,
) -> dict[str, Any]:
    """Register one explicitly allowlisted editorial feed source."""
    if source_kind not in EDITORIAL_SOURCE_KINDS:
        raise ValueError(f"Unsupported editorial source kind: {source_kind}")
    if association_method not in EDITORIAL_ASSOCIATION_METHODS:
        raise ValueError(
            f"Unsupported editorial association method: {association_method}"
        )
    if int(artist_id) <= 0:
        raise ValueError("Editorial source requires a positive artist association")

    normalized_source_url = validate_editorial_feed_url(source_url)
    normalized_canonical_url = validate_editorial_feed_url(canonical_url)
    allowlist = {
        str(host).strip().casefold().rstrip(".")
        for host in allowed_hosts
        if str(host).strip()
    }
    source_host = (
        (urlsplit(normalized_source_url).hostname or "").casefold().rstrip(".")
    )
    if source_host not in allowlist:
        raise ValueError("Editorial feed host is not in the allowlist")

    return upsert_external_feed_source(
        source_kind=source_kind,
        source_url=normalized_source_url,
        canonical_url=normalized_canonical_url,
        artist_id=int(artist_id),
        association_method=association_method,
        parser_version=PARSER_VERSION,
        refresh_interval_seconds=refresh_interval_seconds,
    )


def parse_editorial_feed_payload(
    payload: bytes | str,
    *,
    source_url: str,
    max_bytes: int = DEFAULT_MAX_BYTES,
    max_items: int = DEFAULT_MAX_ITEMS,
) -> tuple[EditorialFeedItem, ...]:
    """Parse generic RSS/Atom while delegating source validation to this adapter."""
    return parse_feed_payload(
        payload,
        source_url=source_url,
        max_bytes=max_bytes,
        max_items=max_items,
        parser_version=PARSER_VERSION,
        source_url_validator=validate_editorial_feed_url,
    )


def fetch_editorial_feed(
    source_url: str,
    *,
    session: requests.Session | Any | None = None,
    etag: str | None = None,
    last_modified: str | None = None,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
    max_bytes: int = DEFAULT_MAX_BYTES,
    max_items: int = DEFAULT_MAX_ITEMS,
) -> EditorialFeedFetchResult:
    """Fetch one allowlisted editorial feed with conditional HTTP requests."""
    source_url = validate_editorial_feed_url(source_url)
    if timeout <= 0:
        raise ValueError("Editorial feed request timeout must be positive")
    client = session or requests.Session()
    response = client.get(
        source_url,
        headers={
            **build_conditional_headers(etag=etag, last_modified=last_modified),
            "Accept": "application/atom+xml, application/rss+xml, application/xml",
            "User-Agent": _USER_AGENT,
        },
        timeout=timeout,
        allow_redirects=True,
    )
    redirected_url = getattr(response, "url", None)
    if redirected_url:
        redirected_url = validate_editorial_feed_url(str(redirected_url))
        if urlsplit(redirected_url).hostname != urlsplit(source_url).hostname:
            raise EditorialFeedInvalidError(
                "Editorial feed redirect is outside the source allowlist"
            )
        source_url = redirected_url

    headers = response.headers or {}
    etag_value = _header(headers, "ETag") or etag
    last_modified_value = _header(headers, "Last-Modified") or last_modified
    content_type = _content_type(_header(headers, "Content-Type"))
    if response.status_code == 304:
        return EditorialFeedFetchResult(
            not_modified=True,
            items=(),
            etag=etag_value,
            last_modified=last_modified_value,
            content_type=content_type,
        )
    if response.status_code == 404:
        raise EditorialFeedNotFoundError()
    if response.status_code >= 400:
        raise EditorialFeedHTTPError(
            response.status_code,
            retry_after_seconds=_retry_after_seconds(_header(headers, "Retry-After")),
        )
    if content_type and content_type not in _ALLOWED_CONTENT_TYPES:
        raise EditorialFeedInvalidError(
            f"Editorial feed response has unsupported content type: {content_type}"
        )
    items = parse_editorial_feed_payload(
        response.content,
        source_url=source_url,
        max_bytes=max_bytes,
        max_items=max_items,
    )
    return EditorialFeedFetchResult(
        not_modified=False,
        items=items,
        etag=etag_value,
        last_modified=last_modified_value,
        content_type=content_type,
    )


def can_fetch_editorial_source(
    source_url: str,
    *,
    session: requests.Session | Any | None = None,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
) -> bool:
    """Evaluate robots.txt conservatively before polling a registered source."""
    source_url = validate_editorial_feed_url(source_url)
    parsed = urlsplit(source_url)
    robots_url = urlunsplit(("https", parsed.netloc, "/robots.txt", "", ""))
    client = session or requests.Session()
    response = client.get(
        robots_url,
        headers={"User-Agent": _USER_AGENT},
        timeout=timeout,
        allow_redirects=False,
    )
    if response.status_code == 404:
        return True
    if response.status_code >= 400 or 300 <= response.status_code < 400:
        return False
    parser = RobotFileParser()
    parser.set_url(robots_url)
    parser.parse(response.text.splitlines())
    return parser.can_fetch(_USER_AGENT, source_url)


def _header(headers: Any, name: str) -> str | None:
    value = headers.get(name)
    if value is not None:
        return str(value).strip() or None
    expected = name.casefold()
    for key, candidate in headers.items():
        if str(key).casefold() == expected:
            return str(candidate).strip() or None
    return None


def _content_type(value: str | None) -> str | None:
    return value.split(";", 1)[0].strip().casefold() if value else None


def _retry_after_seconds(value: str | None) -> int | None:
    if not value:
        return None
    try:
        return max(0, int(value))
    except ValueError:
        return None


__all__ = [
    "EDITORIAL_ASSOCIATION_METHODS",
    "EDITORIAL_SOURCE_KINDS",
    "PUBLISHER_SOURCE_KINDS",
    "EditorialFeedFetchResult",
    "EditorialFeedHTTPError",
    "EditorialFeedInvalidError",
    "EditorialFeedItem",
    "EditorialFeedNotFoundError",
    "PARSER_VERSION",
    "can_fetch_editorial_source",
    "fetch_editorial_feed",
    "parse_editorial_feed_payload",
    "register_editorial_feed_source",
    "validate_editorial_feed_url",
]

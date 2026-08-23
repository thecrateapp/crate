"""Experimental Bandcamp RSS adapter.

Bandcamp RSS is not treated as a stable provider. This module deliberately
keeps network access, XML parsing, host validation and conditional requests
behind one small adapter so the worker can be disabled without affecting the
Listen read path.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import hashlib
from html import unescape
from html.parser import HTMLParser
import re
from typing import Any
from urllib.parse import urljoin, urlsplit, urlunsplit
import xml.etree.ElementTree as ET

import requests


PARSER_VERSION = "bandcamp-rss-v1"
DEFAULT_TIMEOUT_SECONDS = 20.0
DEFAULT_MAX_BYTES = 512 * 1024
DEFAULT_MAX_ITEMS = 100
DEFAULT_MAX_PAGE_BYTES = 512 * 1024
_ALLOWED_CONTENT_TYPES = {
    "application/atom+xml",
    "application/rss+xml",
    "application/xml",
    "text/xml",
}
_FEED_LINK_TYPES = {"application/atom+xml", "application/rss+xml", "application/xml"}
_HTML_TAG_RE = re.compile(r"<[^>]*>")
_WHITESPACE_RE = re.compile(r"\s+")


class RSSFeedError(RuntimeError):
    """Base error for the experimental RSS provider."""


class RSSFeedInvalidError(RSSFeedError):
    """The response is not a supported, safe RSS/Atom document."""


class RSSFeedHTTPError(RSSFeedError):
    """The provider returned an HTTP error."""

    def __init__(
        self,
        status_code: int,
        *,
        retry_after_seconds: int | None = None,
    ) -> None:
        self.status_code = status_code
        self.retry_after_seconds = retry_after_seconds
        super().__init__(f"Bandcamp RSS request failed with HTTP {status_code}")


class RSSFeedNotFoundError(RSSFeedHTTPError):
    """The configured RSS URL does not exist."""

    def __init__(self) -> None:
        super().__init__(404)


@dataclass(frozen=True)
class RSSFeedItem:
    """Stable, sanitized fields extracted from one RSS/Atom entry."""

    external_guid: str | None
    title: str
    canonical_url: str | None
    published_at: datetime | None
    author: str | None
    excerpt: str | None
    image_url: str | None
    item_kind: str
    content_hash: str
    payload: dict[str, Any]


@dataclass(frozen=True)
class RSSFeedFetchResult:
    """Result of one conditional RSS request."""

    not_modified: bool
    items: tuple[RSSFeedItem, ...]
    etag: str | None
    last_modified: str | None
    content_type: str | None


def build_conditional_headers(
    *, etag: str | None = None, last_modified: str | None = None
) -> dict[str, str]:
    """Build cache validators without forwarding arbitrary source headers."""
    headers: dict[str, str] = {}
    if etag and etag.strip():
        headers["If-None-Match"] = etag.strip()[:256]
    if last_modified and last_modified.strip():
        headers["If-Modified-Since"] = last_modified.strip()[:256]
    return headers


def discover_feed_url(page_url: str, html_payload: bytes | str) -> str | None:
    """Find a same-site RSS/Atom alternate link in a public Bandcamp page."""
    page_url = _validate_bandcamp_url(page_url)
    parser = _AlternateLinkParser()
    try:
        parser.feed(
            html_payload.decode("utf-8", errors="replace")
            if isinstance(html_payload, bytes)
            else html_payload
        )
    except Exception as exc:  # pragma: no cover - HTMLParser is intentionally tolerant
        raise RSSFeedInvalidError(
            "Could not inspect HTML for RSS autodiscovery"
        ) from exc

    page_host = urlsplit(page_url).hostname
    for href, media_type in parser.links:
        if media_type not in _FEED_LINK_TYPES:
            continue
        candidate = urljoin(page_url, href)
        try:
            candidate = _validate_bandcamp_url(candidate)
        except ValueError:
            continue
        if urlsplit(candidate).hostname == page_host or _is_bandcamp_host(
            urlsplit(candidate).hostname
        ):
            return candidate
    return None


def parse_rss_payload(
    payload: bytes | str,
    *,
    source_url: str,
    max_bytes: int = DEFAULT_MAX_BYTES,
    max_items: int = DEFAULT_MAX_ITEMS,
) -> tuple[RSSFeedItem, ...]:
    """Parse a bounded RSS 2.0 or Atom payload into stable feed items."""
    _validate_bandcamp_url(source_url)
    if max_bytes <= 0:
        raise RSSFeedInvalidError("RSS document maximum size must be positive")
    if max_items <= 0:
        raise RSSFeedInvalidError(
            "RSS document maximum number of items must be positive"
        )

    raw = payload.encode("utf-8") if isinstance(payload, str) else bytes(payload)
    if len(raw) > max_bytes:
        raise RSSFeedInvalidError("RSS document exceeds the maximum size")
    upper = raw[:4096].upper()
    if b"<!DOCTYPE HTML" in upper:
        raise RSSFeedInvalidError("RSS response is not valid XML")
    if b"<!DOCTYPE" in upper or b"<!ENTITY" in upper or b"SYSTEM" in upper:
        raise RSSFeedInvalidError("DOCTYPE or ENTITY declarations are not allowed")

    try:
        root = ET.fromstring(raw)
    except (ET.ParseError, ValueError) as exc:
        raise RSSFeedInvalidError("RSS response is not valid XML") from exc

    root_name = _local_name(root.tag)
    if root_name not in {"rss", "feed", "rdf"}:
        raise RSSFeedInvalidError("RSS response is not an RSS or Atom XML document")

    entries = [
        element
        for element in root.iter()
        if _local_name(element.tag) in {"item", "entry"}
    ]
    items: list[RSSFeedItem] = []
    seen: set[tuple[str, str]] = set()
    for entry in entries[:max_items]:
        item = _normalize_entry(entry)
        if item is None:
            continue
        identity = (item.external_guid or "", item.canonical_url or item.content_hash)
        if identity in seen:
            continue
        seen.add(identity)
        items.append(item)
    return tuple(items)


def fetch_rss_feed(
    source_url: str,
    *,
    session: requests.Session | Any | None = None,
    etag: str | None = None,
    last_modified: str | None = None,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
    max_bytes: int = DEFAULT_MAX_BYTES,
    max_items: int = DEFAULT_MAX_ITEMS,
) -> RSSFeedFetchResult:
    """Fetch and parse one Bandcamp feed with conditional HTTP validators."""
    source_url = _validate_bandcamp_url(source_url)
    if timeout <= 0:
        raise ValueError("RSS request timeout must be positive")
    client = session or requests.Session()
    response = client.get(
        source_url,
        headers=build_conditional_headers(etag=etag, last_modified=last_modified),
        timeout=timeout,
        allow_redirects=True,
    )
    redirected_url = getattr(response, "url", None)
    if redirected_url:
        try:
            _validate_bandcamp_url(str(redirected_url))
        except ValueError as exc:
            raise RSSFeedInvalidError(
                "RSS response redirected outside Bandcamp"
            ) from exc
    response_headers = response.headers or {}
    response_etag = _header(response_headers, "ETag") or etag
    response_last_modified = _header(response_headers, "Last-Modified") or last_modified
    content_type = _content_type(_header(response_headers, "Content-Type"))

    if response.status_code == 304:
        return RSSFeedFetchResult(
            not_modified=True,
            items=(),
            etag=response_etag,
            last_modified=response_last_modified,
            content_type=content_type,
        )
    if response.status_code == 404:
        raise RSSFeedNotFoundError()
    if response.status_code >= 400:
        raise RSSFeedHTTPError(
            response.status_code,
            retry_after_seconds=_retry_after_seconds(
                _header(response_headers, "Retry-After")
            ),
        )
    if content_type and content_type not in _ALLOWED_CONTENT_TYPES:
        raise RSSFeedInvalidError(
            f"RSS response has unsupported content type: {content_type}"
        )

    items = parse_rss_payload(
        response.content,
        source_url=source_url,
        max_bytes=max_bytes,
        max_items=max_items,
    )
    return RSSFeedFetchResult(
        not_modified=False,
        items=items,
        etag=response_etag,
        last_modified=response_last_modified,
        content_type=content_type,
    )


def discover_rss_feed_from_page(
    page_url: str,
    *,
    session: requests.Session | Any | None = None,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
    max_bytes: int = DEFAULT_MAX_PAGE_BYTES,
) -> str | None:
    """Discover a public RSS/Atom alternate from one Bandcamp artist page."""
    page_url = _validate_bandcamp_url(page_url)
    if timeout <= 0:
        raise ValueError("RSS discovery request timeout must be positive")
    if max_bytes <= 0:
        raise ValueError("RSS discovery document maximum size must be positive")

    client = session or requests.Session()
    response = client.get(
        page_url,
        headers={
            "Accept": "text/html,application/xhtml+xml",
            "User-Agent": "Crate/1.0 (+https://cratemusic.app)",
        },
        timeout=timeout,
        allow_redirects=True,
    )
    redirected_url = getattr(response, "url", None)
    if redirected_url:
        try:
            page_url = _validate_bandcamp_url(str(redirected_url))
        except ValueError as exc:
            raise RSSFeedInvalidError(
                "RSS discovery response redirected outside Bandcamp"
            ) from exc
    response_headers = response.headers or {}
    if response.status_code == 404:
        raise RSSFeedNotFoundError()
    if response.status_code >= 400:
        raise RSSFeedHTTPError(
            response.status_code,
            retry_after_seconds=_retry_after_seconds(
                _header(response_headers, "Retry-After")
            ),
        )
    if len(response.content) > max_bytes:
        raise RSSFeedInvalidError("Bandcamp page exceeds the discovery size limit")
    return discover_feed_url(page_url, response.content)


class _AlternateLinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: list[tuple[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "link":
            return
        values = {key.lower(): (value or "").strip() for key, value in attrs}
        rel = {value.casefold() for value in values.get("rel", "").split()}
        media_type = values.get("type", "").split(";", 1)[0].casefold()
        href = values.get("href", "")
        if "alternate" in rel and href and media_type:
            self.links.append((href, media_type))


def _normalize_entry(entry: ET.Element) -> RSSFeedItem | None:
    title = _clean_text(_child_text(entry, {"title"}))
    if not title:
        return None

    external_guid = _clean_text(_child_text(entry, {"guid", "id"}))
    canonical_url = _extract_link(entry)
    if canonical_url is None and external_guid:
        canonical_url = _clean_url(external_guid)
    published_at = _parse_datetime(
        _child_text(entry, {"pubdate", "published", "updated", "date"})
    )
    author = _clean_text(_child_text(entry, {"creator", "author", "name"}))
    excerpt = _clean_excerpt(
        _child_text(entry, {"description", "summary", "content", "encoded"})
    )
    image_url = _extract_image_url(entry)
    item_kind = _item_kind(entry)
    content_hash = _content_hash(
        external_guid=external_guid,
        canonical_url=canonical_url,
        title=title,
        published_at=published_at,
        excerpt=excerpt,
    )
    payload = {
        "external_guid": external_guid,
        "title": title,
        "canonical_url": canonical_url,
        "published_at": published_at.isoformat() if published_at else None,
        "author": author,
        "excerpt": excerpt,
        "image_url": image_url,
        "item_kind": item_kind,
        "parser_version": PARSER_VERSION,
    }
    return RSSFeedItem(
        external_guid=external_guid,
        title=title,
        canonical_url=canonical_url,
        published_at=published_at,
        author=author,
        excerpt=excerpt,
        image_url=image_url,
        item_kind=item_kind,
        content_hash=content_hash,
        payload=payload,
    )


def _extract_link(entry: ET.Element) -> str | None:
    candidates: list[tuple[str, str]] = []
    for child in entry:
        if _local_name(child.tag) != "link":
            continue
        href = _clean_text(child.attrib.get("href")) or _clean_text(child.text)
        if not href:
            continue
        candidates.append((str(child.attrib.get("rel") or "alternate"), href))
    for rel, value in candidates:
        if rel.casefold() == "alternate":
            cleaned = _clean_url(value)
            if cleaned:
                return cleaned
    return _clean_url(candidates[0][1]) if candidates else None


def _extract_image_url(entry: ET.Element) -> str | None:
    for element in entry.iter():
        local = _local_name(element.tag)
        if local in {"content", "thumbnail", "enclosure", "image"}:
            value = element.attrib.get("url") or element.attrib.get("href")
            if value:
                cleaned = _clean_url(value)
                if cleaned:
                    return cleaned
        if local == "url" and element.text:
            cleaned = _clean_url(element.text)
            if cleaned:
                return cleaned
    return None


def _item_kind(entry: ET.Element) -> str:
    categories: set[str] = set()
    for element in entry:
        if _local_name(element.tag) not in {"category", "type"}:
            continue
        value = _clean_text(element.text)
        if value:
            categories.add(value.casefold())
    if categories & {"news", "article"}:
        return "news"
    if categories & {"announcement", "event"}:
        return "announcement"
    return "release"


def _child_text(element: ET.Element, names: set[str]) -> str | None:
    for child in element.iter():
        if child is element:
            continue
        if _local_name(child.tag) in names:
            text = "".join(child.itertext()).strip()
            if text:
                return text
    return None


def _parse_datetime(value: str | None) -> datetime | None:
    value = _clean_text(value)
    if not value:
        return None
    try:
        parsed = parsedate_to_datetime(value)
    except (TypeError, ValueError, OverflowError):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _clean_excerpt(value: str | None) -> str | None:
    value = _clean_text(value)
    if not value:
        return None
    plain = _HTML_TAG_RE.sub(" ", unescape(value))
    plain = _WHITESPACE_RE.sub(" ", plain).strip()
    plain = re.sub(r"\s+([.,!?;:])", r"\1", plain)
    return plain[:10000] or None


def _clean_text(value: Any) -> str | None:
    if value is None:
        return None
    result = str(value).strip()
    return result or None


def _clean_url(value: Any) -> str | None:
    raw = _clean_text(value)
    if not raw:
        return None
    parsed = urlsplit(raw)
    if parsed.scheme.casefold() not in {"http", "https"} or not parsed.hostname:
        return None
    if parsed.username or parsed.password:
        return None
    return urlunsplit(
        (parsed.scheme.casefold(), parsed.netloc, parsed.path or "", parsed.query, "")
    )


def _validate_bandcamp_url(value: str) -> str:
    cleaned = _clean_url(value)
    if (
        cleaned is None
        or urlsplit(cleaned).scheme != "https"
        or not _is_bandcamp_host(urlsplit(cleaned).hostname)
    ):
        raise ValueError("Bandcamp RSS URL must use an HTTPS Bandcamp host")
    return cleaned


def _is_bandcamp_host(hostname: str | None) -> bool:
    host = (hostname or "").casefold().rstrip(".")
    return host == "bandcamp.com" or host.endswith(".bandcamp.com")


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].casefold()


def _content_hash(
    *,
    external_guid: str | None,
    canonical_url: str | None,
    title: str,
    published_at: datetime | None,
    excerpt: str | None,
) -> str:
    value = "\n".join(
        (
            external_guid or "",
            canonical_url or "",
            title,
            published_at.isoformat() if published_at else "",
            excerpt or "",
        )
    )
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _header(headers: Mapping[str, Any], name: str) -> str | None:
    value = headers.get(name)
    if value is not None:
        return str(value).strip() or None
    expected = name.casefold()
    for key, candidate in headers.items():
        if str(key).casefold() == expected:
            result = str(candidate).strip()
            return result or None
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
    "PARSER_VERSION",
    "RSSFeedError",
    "RSSFeedFetchResult",
    "RSSFeedHTTPError",
    "RSSFeedInvalidError",
    "RSSFeedItem",
    "RSSFeedNotFoundError",
    "build_conditional_headers",
    "discover_feed_url",
    "discover_rss_feed_from_page",
    "fetch_rss_feed",
    "parse_rss_payload",
]

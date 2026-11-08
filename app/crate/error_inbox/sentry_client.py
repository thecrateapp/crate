"""Minimal Sentry REST client for the error inbox worker.

Synchronous httpx, no transport retries, no redirects, no proxies from the
environment, a 15 s timeout and a response byte cap. Errors are typed and never
carry the token or the response body. Self-hosted hosts are resolved once per
request; every answer must pass the address guard and the socket connects to the
checked address while Host and TLS SNI keep the configured hostname.

Never call this from an HTTP request handler: only worker tasks talk to Sentry.
"""

from __future__ import annotations

import json
import logging
import re
import socket
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from urllib.parse import quote, urlsplit

import httpx

from crate.error_inbox.config import (
    ErrorTrackingConfig,
    ErrorTrackingConfigError,
    check_resolved_address,
)

log = logging.getLogger(__name__)

REQUEST_TIMEOUT_SECONDS = 15.0
MAX_RESPONSE_BYTES = 8 * 1024 * 1024
# Sentry's cloud serves the API root only here, not on the regional hosts.
SENTRY_CLOUD_ROOT = "https://sentry.io"
PAGE_SIZE = 100
DEFAULT_MAX_PAGES = 5
# Errors only: performance issues (N+1, slow queries) belong to their own backlog.
LIST_QUERY = "is:unresolved issue.category:error"
# `statsPeriod` also filters the listing to issues seen in the period, so the full
# listing uses a wide window and a second 24 h listing gives the users of the day.
LIST_STATS_PERIOD = "90d"
RECENT_STATS_PERIOD = "24h"
GROUP_STATS_PERIOD = "24h"
STATUSES = frozenset({"resolved", "resolvedInNextRelease", "unresolved", "ignored"})
SUBSTATUSES = frozenset(
    {
        "archived_until_escalating",
        "archived_until_condition_met",
        "archived_forever",
        "escalating",
        "ongoing",
        "regressed",
        "new",
    }
)
_LEVELS = frozenset({"fatal", "error", "warning", "info", "debug"})
_STATUS_MAP = {
    "resolved": "resolved",
    "resolvedInNextRelease": "resolved",
    "ignored": "ignored",
    "muted": "ignored",
    "archived": "ignored",
}
_PRIORITIES = frozenset({"high", "medium", "low"})
_ISSUE_ID = re.compile(r"^\d{1,20}$")
_SHORT_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,62}-[A-Za-z0-9]+$")
_TAG_KEY = re.compile(r"^[a-z][a-z0-9_.]{0,31}$")
MAX_TAG_VALUES = 10
MAX_TAG_VALUE_LENGTH = 200
_STATS_PERIOD = re.compile(r"^[1-9]\d{0,2}[hd]$")
_LINK = re.compile(r"<[^>]*>((?:\s*;\s*[A-Za-z]+=\"[^\"]*\")*)")
_LINK_ATTRIBUTE = re.compile(r"([A-Za-z]+)=\"([^\"]*)\"")
READ_SCOPES = frozenset({"event:read", "event:write", "event:admin"})
WRITE_SCOPES = frozenset({"event:write", "event:admin"})

Resolver = Callable[..., list[tuple]]


class SentryAPIError(Exception):
    def __init__(self, code: str, message: str, *, status: int | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


class SentryAuthError(SentryAPIError):
    pass


class SentryForbiddenError(SentryAPIError):
    pass


class SentryNotFoundError(SentryAPIError):
    pass


class SentryRateLimitedError(SentryAPIError):
    def __init__(
        self, code: str, message: str, *, status: int | None, retry_after: int | None
    ) -> None:
        super().__init__(code, message, status=status)
        self.retry_after = retry_after


class SentryServerError(SentryAPIError):
    pass


class SentryUnavailableError(SentryAPIError):
    pass


@dataclass(frozen=True, slots=True)
class IssuePage:
    issues: list[dict[str, Any]]
    next_cursor: str | None


@dataclass(frozen=True, slots=True)
class IssueListing:
    issues: list[dict[str, Any]]
    pages: int
    truncated: bool


def scope_access(scopes: frozenset[str]) -> dict[str, bool]:
    return {"read": bool(scopes & READ_SCOPES), "write": bool(scopes & WRITE_SCOPES)}


def _to_int(value: Any) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return max(int(value), 0)
    except (TypeError, ValueError):
        return None


def _to_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else None


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _text(value: Any, limit: int) -> str | None:
    if not isinstance(value, str) or not value:
        return None
    return value[:limit]


def _release(value: Any) -> str | None:
    if isinstance(value, Mapping):
        value = value.get("version")
    return _text(value, 300)


def normalize_issue(raw: Mapping[str, Any]) -> dict[str, Any]:
    """Map a Sentry issue to the columns of `error_issues`. Raises ValueError if unusable.

    Releases are None for a listed issue: List an Organization's Issues has no
    `firstRelease` or `lastRelease` (no `expand` adds them). Retrieve an Issue
    (`get_issue`) carries both as release objects.
    """
    external_id = str(raw.get("id") or "")
    short_id = _text(raw.get("shortId"), 128)
    project = raw.get("project")
    project_slug = (
        _text(project.get("slug"), 100) if isinstance(project, Mapping) else None
    )
    if not _ISSUE_ID.match(external_id) or not short_id or not project_slug:
        raise ValueError("Sentry issue is missing id, shortId or project")
    lifetime = _mapping(raw.get("lifetime"))
    events_window = _to_int(raw.get("count")) or 0
    users_window = _to_int(raw.get("userCount")) or 0
    buckets = _mapping(raw.get("stats")).get(GROUP_STATS_PERIOD)
    events_24h = None
    if isinstance(buckets, list):
        events_24h = sum(
            _to_int(bucket[1]) or 0
            for bucket in buckets
            if isinstance(bucket, (list, tuple)) and len(bucket) == 2
        )
    level = raw.get("level")
    priority = raw.get("priority")
    permalink = _text(raw.get("permalink"), 2048)
    if permalink and not permalink.startswith("https://"):
        permalink = None
    return {
        "external_id": external_id,
        "short_id": short_id,
        "project_slug": project_slug,
        "service": project_slug,
        "title": _text(raw.get("title"), 300) or short_id,
        "culprit": _text(raw.get("culprit"), 300),
        "level": level if level in _LEVELS else "error",
        "status": _STATUS_MAP.get(str(raw.get("status") or ""), "unresolved"),
        "substatus": _text(raw.get("substatus"), 64),
        "sentry_priority": priority if priority in _PRIORITIES else None,
        "issue_category": _text(raw.get("issueCategory"), 32),
        "events_total": _to_int(lifetime.get("count")) or events_window,
        "users_total": _to_int(lifetime.get("userCount")) or users_window,
        "events_window": events_window,
        "users_window": users_window,
        "events_24h": events_24h,
        "first_seen": _to_datetime(raw.get("firstSeen")),
        "last_seen": _to_datetime(raw.get("lastSeen")),
        "first_release": _release(raw.get("firstRelease")),
        "last_release": _release(raw.get("lastRelease")),
        "permalink": permalink,
    }


def merge_recent_window(
    issues: list[dict[str, Any]], recent: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Add `users_24h` from the 24 h listing to the issues of the full listing.

    An issue missing from the 24 h listing had no events that day. Its event buckets
    stay authoritative for `events_24h`; the 24 h count only fills them in when
    Sentry sent none. Issues only in the 24 h listing (the full one was truncated)
    are kept: they are the active ones.
    """
    recent_by_id = {issue["external_id"]: issue for issue in recent}
    merged: list[dict[str, Any]] = []
    for issue in issues:
        match = recent_by_id.pop(issue["external_id"], None)
        merged.append(_with_recent_counts(issue, match))
    merged.extend(_with_recent_counts(issue, issue) for issue in recent_by_id.values())
    return merged


def _with_recent_counts(
    issue: dict[str, Any], recent: dict[str, Any] | None
) -> dict[str, Any]:
    users_24h = recent["users_window"] if recent else 0
    events_24h = issue.get("events_24h")
    if events_24h is None:
        events_24h = recent["events_window"] if recent else 0
    return {**issue, "users_24h": users_24h, "events_24h": events_24h}


def _next_cursor(link_header: str | None) -> str | None:
    for match in _LINK.finditer(link_header or ""):
        attributes = dict(_LINK_ATTRIBUTE.findall(match.group(1)))
        if attributes.get("rel") == "next":
            if attributes.get("results") == "true" and attributes.get("cursor"):
                return attributes["cursor"]
            return None
    return None


def _issue_id(issue_id: str) -> str:
    value = str(issue_id)
    if not _ISSUE_ID.match(value):
        raise ValueError("Invalid Sentry issue id")
    return value


class SentryClient:
    def __init__(
        self,
        config: ErrorTrackingConfig,
        token: str,
        *,
        transport: httpx.BaseTransport | None = None,
        resolver: Resolver = socket.getaddrinfo,
        timeout: float = REQUEST_TIMEOUT_SECONDS,
    ) -> None:
        self._config = config
        self._resolver = resolver
        self._origin = urlsplit(config.base_url)
        self._client = httpx.Client(
            timeout=timeout,
            follow_redirects=False,
            trust_env=False,
            transport=transport,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
                "User-Agent": "crate-error-inbox",
            },
        )

    def __enter__(self) -> SentryClient:
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()

    def close(self) -> None:
        self._client.close()

    # -- transport -------------------------------------------------------

    def _target(self, path: str) -> tuple[str, dict[str, str], dict[str, Any]]:
        if self._config.is_cloud:
            return f"{self._config.base_url}{path}", {}, {}
        hostname = self._origin.hostname or ""
        port = self._origin.port or 443
        try:
            answers = self._resolver(hostname, port, type=socket.SOCK_STREAM)
            addresses = list(
                dict.fromkeys(
                    check_resolved_address(str(answer[4][0])) for answer in answers
                )
            )
        except ErrorTrackingConfigError:
            raise SentryUnavailableError(
                "SENTRY_HOST_DISALLOWED", "Sentry host resolves to a disallowed address"
            ) from None
        except OSError:
            raise SentryUnavailableError(
                "SENTRY_UNAVAILABLE", "Sentry host could not be resolved"
            ) from None
        if not addresses:
            raise SentryUnavailableError(
                "SENTRY_UNAVAILABLE", "Sentry host has no usable address"
            )
        host = f"[{addresses[0]}]" if ":" in addresses[0] else addresses[0]
        return (
            f"https://{host}:{port}{path}",
            {"Host": self._origin.netloc},
            {"sni_hostname": hostname},
        )

    def _raise_for_status(self, response: httpx.Response) -> None:
        status = response.status_code
        if 200 <= status < 300:
            return
        if status == 401:
            raise SentryAuthError(
                "SENTRY_AUTH", "Sentry rejected the token", status=status
            )
        if status == 403:
            raise SentryForbiddenError(
                "SENTRY_FORBIDDEN", "The token lacks a required scope", status=status
            )
        if status == 404:
            raise SentryNotFoundError(
                "SENTRY_NOT_FOUND", "Sentry resource not found", status=status
            )
        if status == 429:
            raise SentryRateLimitedError(
                "SENTRY_RATE_LIMITED",
                "Sentry rate limit reached",
                status=status,
                retry_after=_to_int(response.headers.get("Retry-After")),
            )
        if status >= 500:
            raise SentryServerError(
                "SENTRY_SERVER", "Sentry returned a server error", status=status
            )
        if 300 <= status < 400:
            raise SentryUnavailableError(
                "SENTRY_REDIRECT", "Sentry answered with a redirect", status=status
            )
        raise SentryAPIError(
            f"SENTRY_HTTP_{status}", "Sentry rejected the request", status=status
        )

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: list[tuple[str, str]] | None = None,
        body: Mapping[str, Any] | None = None,
        origin: str | None = None,
    ) -> tuple[Any, httpx.Headers]:
        # `origin` is only ever SENTRY_CLOUD_ROOT, for a cloud configuration.
        url, headers, extensions = (
            (f"{origin}{path}", {}, {}) if origin else self._target(path)
        )
        try:
            with self._client.stream(
                method,
                url,
                params=tuple(params) if params is not None else None,
                json=body,
                headers=headers,
                extensions=extensions,
            ) as response:
                self._raise_for_status(response)
                data = bytearray()
                for chunk in response.iter_bytes(chunk_size=65536):
                    if len(data) + len(chunk) > MAX_RESPONSE_BYTES:
                        raise SentryUnavailableError(
                            "SENTRY_RESPONSE_TOO_LARGE",
                            "Sentry response exceeds the size cap",
                        )
                    data.extend(chunk)
                return (json.loads(data) if data else None), response.headers
        except SentryAPIError:
            raise
        except httpx.TimeoutException:
            raise SentryUnavailableError(
                "SENTRY_TIMEOUT", "Sentry request timed out"
            ) from None
        except (httpx.HTTPError, OSError, ValueError, RecursionError):
            # Never chain: transport errors and bodies may echo request data.
            raise SentryUnavailableError(
                "SENTRY_UNAVAILABLE", "Sentry could not be reached or answered badly"
            ) from None

    def _organization_path(self, suffix: str) -> str:
        return f"/api/0/organizations/{self._config.organization}/{suffix}"

    # -- API ---------------------------------------------------------------

    def list_unresolved(
        self, *, cursor: str | None = None, stats_period: str = LIST_STATS_PERIOD
    ) -> IssuePage:
        if not isinstance(stats_period, str) or not _STATS_PERIOD.match(stats_period):
            raise ValueError("Unsupported Sentry stats period")
        params = [
            ("query", LIST_QUERY),
            ("statsPeriod", stats_period),
            ("groupStatsPeriod", GROUP_STATS_PERIOD),
            ("limit", str(PAGE_SIZE)),
            *(("project", project) for project in self._config.projects),
            *(
                ("environment", environment)
                for environment in self._config.environments
            ),
        ]
        if cursor:
            params.append(("cursor", cursor))
        data, headers = self._request(
            "GET", self._organization_path("issues/"), params=params
        )
        if not isinstance(data, list):
            raise SentryUnavailableError(
                "SENTRY_INVALID_RESPONSE", "Unexpected issue list"
            )
        issues = []
        for raw in data:
            try:
                issues.append(normalize_issue(raw))
            except (ValueError, AttributeError):
                log.warning("Skipping a Sentry issue without id, shortId or project")
        return IssuePage(issues=issues, next_cursor=_next_cursor(headers.get("link")))

    def iter_unresolved(
        self,
        *,
        max_pages: int = DEFAULT_MAX_PAGES,
        stats_period: str = LIST_STATS_PERIOD,
    ) -> IssueListing:
        issues: list[dict[str, Any]] = []
        cursor: str | None = None
        for page_number in range(1, max_pages + 1):
            page = self.list_unresolved(cursor=cursor, stats_period=stats_period)
            issues.extend(page.issues)
            cursor = page.next_cursor
            if cursor is None:
                return IssueListing(issues=issues, pages=page_number, truncated=False)
        return IssueListing(issues=issues, pages=max_pages, truncated=True)

    def get_issue(self, issue_id: str) -> dict[str, Any]:
        """One issue (Retrieve an Issue), with the releases the listing leaves out."""
        path = self._organization_path(f"issues/{_issue_id(issue_id)}/")
        data, _ = self._request("GET", path)
        try:
            return normalize_issue(data)
        except (ValueError, AttributeError):
            raise SentryUnavailableError(
                "SENTRY_INVALID_RESPONSE", "Unexpected issue"
            ) from None

    def resolve_short_id(self, short_id: str) -> dict[str, Any]:
        """The issue a short id names (Resolve a Short ID), normalized like a listed one.

        `GET /organizations/{org}/shortids/{short_id}/` answers with the issue as
        `group`. A merged issue's short id resolves to the issue it was merged
        into, so the caller compares `short_id`. Unknown or deleted: 404.
        """
        if (
            not isinstance(short_id, str)
            or len(short_id) > 64
            or not _SHORT_ID.match(short_id)
        ):
            raise ValueError("Invalid Sentry short id")
        path = self._organization_path(f"shortids/{quote(short_id, safe='')}/")
        data, _ = self._request("GET", path)
        group = data.get("group") if isinstance(data, Mapping) else None
        try:
            if not isinstance(group, Mapping):
                raise ValueError("No issue in the answer")
            return normalize_issue(group)
        except (ValueError, AttributeError, TypeError):
            raise SentryUnavailableError(
                "SENTRY_INVALID_RESPONSE", "Unexpected short id answer"
            ) from None

    def latest_event(self, issue_id: str) -> dict[str, Any]:
        path = self._organization_path(f"issues/{_issue_id(issue_id)}/events/latest/")
        data, _ = self._request("GET", path)
        if not isinstance(data, dict):
            raise SentryUnavailableError("SENTRY_INVALID_RESPONSE", "Unexpected event")
        return data

    def tag_values(self, issue_id: str, key: str) -> dict[str, Any]:
        """Event counts of one tag's top values for an issue (Retrieve Tag Details).

        Filtered to the configured environments. Values are capped in number and
        length here; the caller still sanitises them before they go anywhere.
        """
        if not isinstance(key, str) or not _TAG_KEY.match(key):
            raise ValueError("Unsupported tag key")
        path = self._organization_path(f"issues/{_issue_id(issue_id)}/tags/{key}/")
        params = [
            ("environment", environment) for environment in self._config.environments
        ]
        data, _ = self._request("GET", path, params=params)
        if not isinstance(data, Mapping):
            raise SentryUnavailableError(
                "SENTRY_INVALID_RESPONSE", "Unexpected tag details"
            )
        top: list[dict[str, Any]] = []
        for item in data.get("topValues") or []:
            if not isinstance(item, Mapping):
                continue
            value = item.get("value")
            count = _to_int(item.get("count"))
            if value is None or count is None:
                continue
            top.append(
                {
                    "value": str(value)[:MAX_TAG_VALUE_LENGTH],
                    "count": count,
                    "first_seen": _to_datetime(item.get("firstSeen")),
                    "last_seen": _to_datetime(item.get("lastSeen")),
                }
            )
            if len(top) == MAX_TAG_VALUES:
                break
        return {
            "key": key,
            "total": _to_int(data.get("totalValues")),
            "unique": _to_int(data.get("uniqueValues")),
            "top": top,
        }

    def update_status(
        self, issue_id: str, status: str, *, substatus: str | None = None
    ) -> dict[str, Any]:
        path = self._organization_path(f"issues/{_issue_id(issue_id)}/")
        if status not in STATUSES:
            raise ValueError("Unsupported Sentry status")
        if substatus is not None and substatus not in SUBSTATUSES:
            raise ValueError("Unsupported Sentry substatus")
        body: dict[str, Any] = {"status": status}
        if substatus is not None:
            body["substatus"] = substatus
        data, _ = self._request("PUT", path, body=body)
        try:
            return normalize_issue(data)
        except (ValueError, AttributeError):
            raise SentryUnavailableError(
                "SENTRY_INVALID_RESPONSE", "Unexpected issue"
            ) from None

    def check_scopes(self) -> frozenset[str]:
        """Scopes of the token, read from the API root (`auth.scopes`).

        On Sentry's cloud the root is only served by `sentry.io`: the regional
        hosts (`us.sentry.io`, `de.sentry.io`) answer 404 for it, so a regional
        base URL asks `sentry.io` for this one call.
        """
        origin = SENTRY_CLOUD_ROOT if self._config.is_cloud else None
        data, _ = self._request("GET", "/api/0/", origin=origin)
        auth = data.get("auth") if isinstance(data, Mapping) else None
        scopes = auth.get("scopes") if isinstance(auth, Mapping) else None
        if not isinstance(scopes, list):
            return frozenset()
        return frozenset(scope for scope in scopes if isinstance(scope, str))


__all__ = [
    "LIST_STATS_PERIOD",
    "RECENT_STATS_PERIOD",
    "IssueListing",
    "IssuePage",
    "SentryAPIError",
    "SentryAuthError",
    "SentryClient",
    "SentryForbiddenError",
    "SentryNotFoundError",
    "SentryRateLimitedError",
    "SentryServerError",
    "SentryUnavailableError",
    "merge_recent_window",
    "normalize_issue",
    "scope_access",
]

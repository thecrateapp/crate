"""A fake Sentry organisation behind `httpx.MockTransport` for the error inbox tasks.

Nothing here reaches the network: the client factory always injects the transport.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from typing import Any

import httpx

from crate.error_inbox.sentry_client import SentryClient

TOKEN = "sntrys_synthetic_inbox_token"
ORGANIZATION = "ninja-development"
ISSUES_PATH = f"/api/0/organizations/{ORGANIZATION}/issues/"
_ISSUE = re.compile(rf"^{re.escape(ISSUES_PATH)}(\d+)/$")
_LATEST = re.compile(rf"^{re.escape(ISSUES_PATH)}(\d+)/events/latest/$")
FULL_SCOPES = ("org:read", "project:read", "event:read", "event:write")


def raw_issue(issue_id: int | str, **overrides: Any) -> dict[str, Any]:
    issue: dict[str, Any] = {
        "id": str(issue_id),
        "shortId": f"CRATE-API-{issue_id}",
        "title": "IntegrityError: duplicate key value violates unique constraint",
        "culprit": "library_pipeline",
        "level": "error",
        "status": "unresolved",
        "substatus": "ongoing",
        "priority": "medium",
        "issueCategory": "error",
        "count": "12",
        "userCount": 2,
        "lifetime": {"count": "40", "userCount": 5},
        "stats": {"24h": [[1762214400, 1], [1762218000, 1]]},
        "firstSeen": "2026-10-06T15:45:00.123456Z",
        "lastSeen": "2026-11-04T08:14:00Z",
        "firstRelease": {"version": "crate-8ba478ac"},
        "lastRelease": {"version": "crate-4ba9e59a"},
        "project": {"id": "1", "slug": "crate-api"},
        "permalink": f"https://ninja-development.sentry.io/issues/{issue_id}/",
    }
    issue.update(overrides)
    return issue


def raw_event(
    issue_id: int | str,
    *,
    service: str | None = "api",
    exception: str = "IntegrityError",
    function: str = "run",
) -> dict[str, Any]:
    tags = [{"key": "environment", "value": "production"}]
    if service is not None:
        tags.append({"key": "service", "value": service})
    return {
        "eventID": f"{int(issue_id):032x}",
        "platform": "python",
        "release": {"version": "crate-4ba9e59a"},
        "message": "",
        "entries": [
            {
                "type": "exception",
                "data": {
                    "values": [
                        {
                            "type": exception,
                            "value": "duplicate key value for /music/Artist/a.flac",
                            "module": "sqlalchemy.exc",
                            "stacktrace": {
                                "frames": [
                                    {
                                        "inApp": True,
                                        "module": "crate.worker_handlers.library",
                                        "function": function,
                                        "filename": "crate/worker_handlers/library.py",
                                        "lineNo": 12,
                                        "context": [[12, "session.execute(stmt)"]],
                                        "vars": {"password": "never-in-digest"},
                                    }
                                ]
                            },
                        }
                    ]
                },
            }
        ],
        "tags": tags,
    }


class FakeSentry:
    """Answers the endpoints the inbox uses and records every request."""

    def __init__(self) -> None:
        self.full: list[dict[str, Any]] = []
        self.recent: list[dict[str, Any]] = []
        self.issues: dict[str, dict[str, Any]] = {}
        self.events: dict[str, dict[str, Any]] = {}
        self.scopes: list[str] | None = list(FULL_SCOPES)
        self.page_size = 100
        self.requests: list[httpx.Request] = []
        self.fail: Callable[[httpx.Request], httpx.Response | None] | None = None

    def factory(self, config, token) -> SentryClient:
        return SentryClient(config, token, transport=httpx.MockTransport(self))

    def paths(self, method: str | None = None) -> list[str]:
        return [
            request.url.path
            for request in self.requests
            if method is None or request.method == method
        ]

    def latest_event_ids(self) -> list[str]:
        return [
            match.group(1)
            for path in self.paths("GET")
            if (match := _LATEST.match(path)) is not None
        ]

    def issue_ids(self, method: str = "GET") -> list[str]:
        return [
            match.group(1)
            for path in self.paths(method)
            if (match := _ISSUE.match(path)) is not None
        ]

    def _listing(self, request: httpx.Request) -> httpx.Response:
        period = request.url.params.get("statsPeriod")
        items = self.recent if period == "24h" else self.full
        page = int(request.url.params.get("cursor") or 0)
        start = page * self.page_size
        chunk = items[start : start + self.page_size]
        more = start + self.page_size < len(items)
        link = (
            f'<https://sentry.io{ISSUES_PATH}?cursor={page + 1}>; rel="next"; '
            f'results="{"true" if more else "false"}"; cursor="{page + 1}"'
        )
        return httpx.Response(200, json=chunk, headers={"Link": link})

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.fail is not None:
            response = self.fail(request)
            if response is not None:
                return response
        path = request.url.path
        if path == "/api/0/":
            auth = {} if self.scopes is None else {"scopes": self.scopes}
            return httpx.Response(200, json={"version": "0", "auth": auth})
        if path == ISSUES_PATH and request.method == "GET":
            return self._listing(request)
        if match := _LATEST.match(path):
            event = self.events.get(match.group(1))
            if event is None:
                return httpx.Response(404, json={"detail": "not found"})
            return httpx.Response(200, json=event)
        if match := _ISSUE.match(path):
            issue = self.issues.get(match.group(1))
            if issue is None:
                return httpx.Response(404, json={"detail": "not found"})
            if request.method == "PUT":
                body = json.loads(request.content)
                status = body["status"]
                issue = {
                    **issue,
                    "status": "resolved"
                    if status == "resolvedInNextRelease"
                    else status,
                    "substatus": body.get("substatus"),
                }
                self.issues[match.group(1)] = issue
            return httpx.Response(200, json=issue)
        return httpx.Response(404, json={"detail": "unknown endpoint"})


def configure(**overrides: Any):
    """Store error tracking settings and a token, like the connection panel will."""
    from crate.error_inbox.config import save_config

    payload = {
        "organization": ORGANIZATION,
        "projects": ["crate-api", "crate-workers"],
        "environments": ["production"],
    }
    payload.update(overrides)
    return save_config(payload, sentry_token=TOKEN)

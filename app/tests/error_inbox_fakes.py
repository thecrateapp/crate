"""A fake Sentry organisation and a fake GitHub behind `httpx.MockTransport` for the
error inbox tasks.

Nothing here reaches the network: the client factories always inject the transport.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from typing import Any

import httpx

from crate.error_inbox.github_client import GitHubClient
from crate.error_inbox.sentry_client import SentryClient

TOKEN = "sntrys_synthetic_inbox_token"
GITHUB_TOKEN = "github_pat_synthetic_fix_dispatch_token"
FIX_SETTINGS = {"repository": "thecrateapp/crate", "workflow": "error-autofix.yml"}
DISPATCH_PATH = (
    "/repos/thecrateapp/crate/actions/workflows/error-autofix.yml/dispatches"
)
ORGANIZATION = "ninja-development"
ISSUES_PATH = f"/api/0/organizations/{ORGANIZATION}/issues/"
_ISSUE = re.compile(rf"^{re.escape(ISSUES_PATH)}(\d+)/$")
_LATEST = re.compile(rf"^{re.escape(ISSUES_PATH)}(\d+)/events/latest/$")
_TAG = re.compile(rf"^{re.escape(ISSUES_PATH)}(\d+)/tags/([a-z0-9_.]+)/$")
SHORT_IDS_PATH = f"/api/0/organizations/{ORGANIZATION}/shortids/"
_SHORT = re.compile(rf"^{re.escape(SHORT_IDS_PATH)}([^/]+)/$")
FULL_SCOPES = ("org:read", "project:read", "event:read", "event:write")
# Retrieve an Issue has these; List an Organization's Issues does not.
DETAIL_ONLY_FIELDS = ("firstRelease", "lastRelease")


def raw_issue(issue_id: int | str, **overrides: Any) -> dict[str, Any]:
    """An issue as Retrieve an Issue answers it; the fake's listing drops releases."""
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


def listed_issue(issue: dict[str, Any]) -> dict[str, Any]:
    """An issue as List an Organization's Issues answers it: without releases."""
    return {key: value for key, value in issue.items() if key not in DETAIL_ONLY_FIELDS}


class FakeSentry:
    """Answers the endpoints the inbox uses and records every request.

    `issues` holds the issue details; a listed issue missing there is answered from
    the listing's own entry, releases included, as Sentry would.
    """

    def __init__(self) -> None:
        self.full: list[dict[str, Any]] = []
        self.recent: list[dict[str, Any]] = []
        self.issues: dict[str, dict[str, Any]] = {}
        self.events: dict[str, dict[str, Any]] = {}
        # Retrieve Tag Details answers by issue id, then tag key.
        self.tags: dict[str, dict[str, dict[str, Any]]] = {}
        # Short ids of merged issues and the issue id Sentry resolves them to.
        self.merged: dict[str, str] = {}
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

    def resolved_short_ids(self) -> list[str]:
        return [
            match.group(1)
            for path in self.paths("GET")
            if (match := _SHORT.match(path)) is not None
        ]

    def _short_id(self, short_id: str) -> httpx.Response:
        issue_id = self.merged.get(short_id) or next(
            (
                key
                for key, issue in self.issues.items()
                if str(issue.get("shortId", "")).upper() == short_id.upper()
            ),
            None,
        )
        issue = self.issues.get(issue_id) if issue_id else None
        if issue is None:
            return httpx.Response(404, json={"detail": "not found"})
        return httpx.Response(
            200,
            json={
                "organizationSlug": ORGANIZATION,
                "projectSlug": issue["project"]["slug"],
                "groupId": issue["id"],
                "shortId": issue["shortId"],
                "group": issue,
            },
        )

    def tag_keys(self) -> list[str]:
        return [
            match.group(2)
            for path in self.paths("GET")
            if (match := _TAG.match(path)) is not None
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
        chunk = [listed_issue(item) for item in items[start : start + self.page_size]]
        more = start + self.page_size < len(items)
        link = (
            f'<https://sentry.io{ISSUES_PATH}?cursor={page + 1}>; rel="next"; '
            f'results="{"true" if more else "false"}"; cursor="{page + 1}"'
        )
        return httpx.Response(200, json=chunk, headers={"Link": link})

    def _listed(self, issue_id: str) -> dict[str, Any] | None:
        return next(
            (issue for issue in (*self.full, *self.recent) if issue["id"] == issue_id),
            None,
        )

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
        if match := _SHORT.match(path):
            return self._short_id(match.group(1))
        if match := _TAG.match(path):
            detail = self.tags.get(match.group(1), {}).get(match.group(2))
            if detail is None:
                return httpx.Response(404, json={"detail": "not found"})
            return httpx.Response(200, json=detail)
        if match := _LATEST.match(path):
            event = self.events.get(match.group(1))
            if event is None:
                return httpx.Response(404, json={"detail": "not found"})
            return httpx.Response(200, json=event)
        if match := _ISSUE.match(path):
            issue = self.issues.get(match.group(1))
            if issue is None and request.method == "GET":
                issue = self._listed(match.group(1))
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


def configure_fix(github_token: str | None = GITHUB_TOKEN, **fix: Any):
    """Error tracking plus Launch fix, with a GitHub token unless told otherwise."""
    from crate.error_inbox.config import save_config

    payload = {
        "organization": ORGANIZATION,
        "projects": ["crate-api", "crate-workers"],
        "environments": ["production"],
        "fix": {**FIX_SETTINGS, **fix},
    }
    return save_config(payload, sentry_token=TOKEN, github_token=github_token)


class FakeGitHub:
    """Answers `workflow_dispatch` with `status` and records every request."""

    def __init__(self, status: int = 204, headers: dict[str, str] | None = None):
        self.status = status
        self.headers = headers or {}
        self.requests: list[httpx.Request] = []
        self.tokens: list[str] = []

    def factory(self, token: str) -> GitHubClient:
        self.tokens.append(token)
        return GitHubClient(token, transport=httpx.MockTransport(self))

    def bodies(self) -> list[dict[str, Any]]:
        return [json.loads(request.content) for request in self.requests]

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return httpx.Response(
            self.status,
            headers=self.headers,
            json=None if self.status == 204 else {"message": "synthetic body"},
        )


def tag_detail(key: str, *values: tuple[str, int]) -> dict[str, Any]:
    """A Retrieve Tag Details answer with the given (value, count) pairs."""
    return {
        "key": key,
        "name": key.title(),
        "uniqueValues": len(values),
        "totalValues": sum(count for _, count in values),
        "topValues": [
            {
                "key": value,
                "name": value,
                "value": value,
                "count": count,
                "firstSeen": "2026-11-01T10:00:00Z",
                "lastSeen": "2026-11-04T08:00:00Z",
            }
            for value, count in values
        ],
    }


TRIAGE_ACTION = "ops.error.triage"
INVESTIGATE_ACTION = "ops.error.investigate"


def configure_ai(
    monkeypatch,
    actions=(TRIAGE_ACTION, INVESTIGATE_ACTION),
    *,
    max_input_tokens: int = 65536,
) -> None:
    """An active AI configuration with `actions` bound to one Gemini profile.

    Only the provider transport is faked by the tests that call the model.
    """
    from sqlalchemy import text

    from crate.ai import configuration
    from crate.ai.capabilities import model_capabilities
    from crate.db.repositories import ai_configuration as store
    from crate.db.tx import transaction_scope

    monkeypatch.setenv("GEMINI_API_KEY", "synthetic-key")
    connection = configuration.ensure_environment_connection("gemini")
    store.save_model_catalog(
        connection["id"],
        [model_capabilities("gemini", "gemini-2.5-flash").model_dump(mode="json")],
        "ready",
        1,
    )
    profile = configuration.create_profile(
        {
            "label": "Errors",
            "connection_id": connection["id"],
            "model_id": "gemini-2.5-flash",
            "config": {"max_input_tokens": max_input_tokens},
        },
        None,
    )
    if actions:
        configuration.apply_bindings(
            [
                {
                    "action_id": action_id,
                    "profile_id": profile["id"],
                    "profile_version": 1,
                    "enabled": True,
                    "expected_revision": 0,
                }
                for action_id in actions
            ],
            None,
        )
    with transaction_scope() as session:
        session.execute(text("UPDATE ai_configuration_state SET active = TRUE"))

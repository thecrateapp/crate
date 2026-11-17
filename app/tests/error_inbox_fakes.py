"""A fake Sentry organisation, a fake GitHub and a fake factory bug API behind
`httpx.MockTransport` for the error inbox tasks.

Nothing here reaches the network: the client factories always inject the transport.
"""

from __future__ import annotations

import json
import re
import uuid
from collections.abc import Callable
from typing import Any

import httpx

from crate.error_inbox.factory_client import FactoryClient
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


def configure_fix(
    github_token: str | None = GITHUB_TOKEN,
    factory_token: str | None = None,
    **fix: Any,
):
    """Error tracking plus Launch fix, with a GitHub token unless told otherwise."""
    from crate.error_inbox.config import save_config

    payload = {
        "organization": ORGANIZATION,
        "projects": ["crate-api", "crate-workers"],
        "environments": ["production"],
        "fix": {**FIX_SETTINGS, **fix},
    }
    return save_config(
        payload,
        sentry_token=TOKEN,
        github_token=github_token,
        factory_token=factory_token,
    )


def configure_factory(**fix: Any):
    """Launch fix with the factory executor and both tokens."""
    return configure_fix(
        factory_token=FACTORY_TOKEN,
        executor="factory",
        factory=FACTORY_SETTINGS,
        **fix,
    )


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


FIXER = "crate-error-autofix[bot]"
REPOSITORY = "thecrateapp/crate"
_REPO = re.escape(REPOSITORY)
_DISPATCH = re.compile(rf"^/repos/{_REPO}/actions/workflows/([^/]+)/dispatches$")
_RUNS = re.compile(rf"^/repos/{_REPO}/actions/workflows/([^/]+)/runs$")
_RUN = re.compile(rf"^/repos/{_REPO}/actions/runs/(\d+)$")
_CANCEL = re.compile(rf"^/repos/{_REPO}/actions/runs/(\d+)/cancel$")
_PULLS = re.compile(rf"^/repos/{_REPO}/pulls$")
_PULL = re.compile(rf"^/repos/{_REPO}/pulls/(\d+)$")
_MERGE = re.compile(rf"^/repos/{_REPO}/pulls/(\d+)/merge$")
_CHECKS = re.compile(rf"^/repos/{_REPO}/commits/([0-9a-f]{{40}})/check-runs$")
_STATUS = re.compile(rf"^/repos/{_REPO}/commits/([0-9a-f]{{40}})/status$")
_REF = re.compile(rf"^/repos/{_REPO}/git/refs/heads/(.+)$")


def iso(value) -> str:
    return value.strftime("%Y-%m-%dT%H:%M:%SZ")


def sha_for(seed: int | str) -> str:
    import hashlib

    return hashlib.sha1(str(seed).encode()).hexdigest()


class FakeGitHubRepo:
    """One GitHub repository behind `httpx.MockTransport`: workflow runs, pull
    requests, checks, the ready-for-review mutation, merges and branches.

    It answers only the endpoints the error fix tasks use and records every request.
    """

    def __init__(self) -> None:
        from datetime import datetime, timezone

        self.now = lambda: datetime.now(timezone.utc)
        self.runs: dict[int, dict[str, Any]] = {}
        self.pulls: dict[int, dict[str, Any]] = {}
        self.checks: dict[str, list[dict[str, Any]]] = {}
        self.statuses: dict[str, dict[str, Any]] = {}
        self.branches: set[str] = set()
        self.requests: list[httpx.Request] = []
        self.tokens: list[str] = []
        self.dispatch_status = 204
        self.merge_status: int | None = None
        self.delete_status: int | None = None
        self.graphql_errors: list[dict[str, Any]] | None = None
        self.fail: Callable[[httpx.Request], httpx.Response | None] | None = None
        self._next_run = 9000
        self._next_pull = 40

    def factory(self, token: str) -> GitHubClient:
        self.tokens.append(token)
        return GitHubClient(token, transport=httpx.MockTransport(self))

    # -- state ----------------------------------------------------------------------

    def add_run(
        self,
        short_id: str,
        *,
        status: str = "in_progress",
        conclusion: str | None = None,
        created_at=None,
        title: str | None = None,
    ) -> int:
        self._next_run += 1
        run_id = self._next_run
        self.runs[run_id] = {
            "id": run_id,
            "display_title": title or f"Error Autofix {short_id}",
            "status": status,
            "conclusion": conclusion,
            "event": "workflow_dispatch",
            "created_at": iso(created_at or self.now()),
            "html_url": f"https://github.com/{REPOSITORY}/actions/runs/{run_id}",
        }
        return run_id

    def finish_run(self, run_id: int, conclusion: str = "success") -> None:
        self.runs[run_id].update(status="completed", conclusion=conclusion)

    def add_pull(
        self,
        short_id: str,
        run_id: int | str,
        *,
        draft: bool = True,
        author: str = FIXER,
        labels: tuple[str, ...] = ("autofix",),
        mergeable: bool | None = True,
        sha: str | None = None,
        created_at=None,
        branch: str | None = None,
        head_repository: str = REPOSITORY,
    ) -> dict[str, Any]:
        self._next_pull += 1
        number = self._next_pull
        ref = branch or f"autofix/{short_id.lower()}-{run_id}"
        stamp = iso(created_at or self.now())
        pull = {
            "number": number,
            "node_id": f"PR_kw{number}",
            "html_url": f"https://github.com/{REPOSITORY}/pull/{number}",
            "state": "open",
            "draft": draft,
            "merged": False,
            "merged_at": None,
            "mergeable": mergeable,
            "mergeable_state": "draft" if draft else "clean",
            "head": {
                "sha": sha or sha_for(f"{short_id}-{number}"),
                "ref": ref,
                "repo": {"full_name": head_repository},
            },
            "user": {"login": author, "type": "Bot"},
            "labels": [{"name": label} for label in labels],
            "created_at": stamp,
            "updated_at": stamp,
            "body": f"Fix attempt for `{short_id}`.\n\nFixes {short_id}",
        }
        self.pulls[number] = pull
        self.branches.add(ref)
        return pull

    def set_checks(
        self, sha: str, *checks: tuple[str, str, str | None], started_at=None
    ):
        """Check runs of `sha` as (name, status, conclusion)."""
        stamp = iso(started_at or self.now())
        self.checks[sha] = [
            {
                "name": name,
                "status": status,
                "conclusion": conclusion,
                "started_at": stamp,
            }
            for name, status, conclusion in checks
        ]

    def paths(self, method: str | None = None) -> list[str]:
        return [
            request.url.path
            for request in self.requests
            if method is None or request.method == method
        ]

    # -- transport ------------------------------------------------------------------

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.fail is not None:
            response = self.fail(request)
            if response is not None:
                return response
        path, method = request.url.path, request.method
        if method == "POST" and _DISPATCH.match(path):
            return httpx.Response(self.dispatch_status)
        if method == "GET" and _RUNS.match(path):
            return self._list_runs(request)
        if (match := _RUN.match(path)) and method == "GET":
            run = self.runs.get(int(match.group(1)))
            return httpx.Response(200, json=run) if run else self._missing()
        if (match := _CANCEL.match(path)) and method == "POST":
            run = self.runs.get(int(match.group(1)))
            if run is None:
                return self._missing()
            if run["status"] == "completed":
                return httpx.Response(409, json={"message": "finished"})
            run.update(status="completed", conclusion="cancelled")
            return httpx.Response(202, json={})
        if method == "GET" and _PULLS.match(path):
            return self._list_pulls(request)
        if match := _PULL.match(path):
            pull = self.pulls.get(int(match.group(1)))
            if pull is None:
                return self._missing()
            if method == "PATCH":
                if json.loads(request.content).get("state") == "closed":
                    pull["state"] = "closed"
                return httpx.Response(200, json=pull)
            return httpx.Response(200, json=pull)
        if (match := _MERGE.match(path)) and method == "PUT":
            return self._merge(int(match.group(1)), json.loads(request.content))
        if (match := _CHECKS.match(path)) and method == "GET":
            runs = self.checks.get(match.group(1), [])
            return httpx.Response(
                200, json={"total_count": len(runs), "check_runs": runs}
            )
        if (match := _STATUS.match(path)) and method == "GET":
            status = self.statuses.get(
                match.group(1), {"state": "pending", "total_count": 0, "statuses": []}
            )
            return httpx.Response(200, json=status)
        if path == "/graphql" and method == "POST":
            return self._graphql(json.loads(request.content))
        if (match := _REF.match(path)) and method == "DELETE":
            if self.delete_status is not None:
                return httpx.Response(self.delete_status, json={"message": "no"})
            branch = match.group(1)
            if branch not in self.branches:
                return httpx.Response(422, json={"message": "Reference does not exist"})
            self.branches.discard(branch)
            return httpx.Response(204)
        return httpx.Response(404, json={"message": "unknown endpoint"})

    def _missing(self) -> httpx.Response:
        return httpx.Response(404, json={"message": "Not Found"})

    def _list_runs(self, request: httpx.Request) -> httpx.Response:
        created = request.url.params.get("created", "")
        since = created.removeprefix(">=")
        runs = sorted(
            self.runs.values(), key=lambda run: run["created_at"], reverse=True
        )
        runs = [run for run in runs if not since or run["created_at"] >= since]
        return httpx.Response(
            200, json={"total_count": len(runs), "workflow_runs": runs}
        )

    def _list_pulls(self, request: httpx.Request) -> httpx.Response:
        pulls = sorted(
            self.pulls.values(), key=lambda pull: pull["number"], reverse=True
        )
        head = request.url.params.get("head")
        if head:
            owner, _, branch = head.partition(":")
            pulls = [
                pull
                for pull in pulls
                if pull["head"]["ref"] == branch
                and pull["head"]["repo"]["full_name"].split("/")[0] == owner
            ]
        return httpx.Response(200, json=pulls)

    def _merge(self, number: int, body: dict[str, Any]) -> httpx.Response:
        pull = self.pulls.get(number)
        if pull is None:
            return self._missing()
        if self.merge_status is not None:
            return httpx.Response(self.merge_status, json={"message": "refused"})
        if body.get("sha") != pull["head"]["sha"]:
            return httpx.Response(409, json={"message": "Head branch was modified"})
        if pull["draft"] or pull["state"] != "open":
            return httpx.Response(405, json={"message": "not mergeable"})
        pull.update(state="closed", merged=True, merged_at=iso(self.now()))
        return httpx.Response(
            200, json={"merged": True, "sha": sha_for(f"merge-{number}")}
        )

    def _graphql(self, body: dict[str, Any]) -> httpx.Response:
        if self.graphql_errors is not None:
            return httpx.Response(
                200, json={"data": None, "errors": self.graphql_errors}
            )
        node_id = body.get("variables", {}).get("id")
        pull = next(
            (pull for pull in self.pulls.values() if pull["node_id"] == node_id), None
        )
        if pull is None:
            return httpx.Response(
                200, json={"data": None, "errors": [{"type": "NOT_FOUND"}]}
            )
        pull.update(draft=False, mergeable_state="blocked", updated_at=iso(self.now()))
        return httpx.Response(
            200,
            json={
                "data": {
                    "markPullRequestReadyForReview": {"pullRequest": {"isDraft": False}}
                }
            },
        )


FACTORY_URL = "http://100.101.102.103:8788"
FACTORY_TOKEN = "synthetic-factory-bugs-token"
FACTORY_FIXER = "crate-factory[bot]"
FACTORY_SETTINGS = {"base_url": FACTORY_URL, "pr_author": FACTORY_FIXER}
_BUG = re.compile(r"^/v1/bugs/([^/]+)$")
_BUG_CANCEL = re.compile(r"^/v1/bugs/([^/]+)/cancel$")
_ENDED_BUG_STATES = frozenset(
    {"rejected", "merged", "closed", "not_reproduced", "failed", "cancelled"}
)


class FakeFactory:
    """The factory's bug API (`/v1/bugs`) behind `httpx.MockTransport`.

    Submissions are idempotent on `Idempotency-Key`, as the factory's are. Records
    every request and the URL and token each client was built with. With
    `lose_submit_answer` a submission is stored and then its answer is lost, as
    when the connection drops after the factory committed.
    """

    def __init__(self) -> None:
        self.bugs: dict[str, dict[str, Any]] = {}
        self.requests: list[httpx.Request] = []
        self.clients: list[tuple[str, str]] = []
        self.fail: Callable[[httpx.Request], httpx.Response | None] | None = None
        self.lose_submit_answer = False

    def factory(self, base_url: str, token: str) -> FactoryClient:
        self.clients.append((base_url, token))
        return FactoryClient(base_url, token, transport=httpx.MockTransport(self))

    def bodies(self, method: str = "POST") -> list[dict[str, Any]]:
        return [
            json.loads(request.content)
            for request in self.requests
            if request.method == method and request.content
        ]

    def paths(self, method: str | None = None) -> list[str]:
        return [
            request.url.path
            for request in self.requests
            if method is None or request.method == method
        ]

    def only_bug(self) -> dict[str, Any]:
        [bug] = self.bugs.values()
        return bug

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.fail is not None:
            response = self.fail(request)
            if response is not None:
                return response
        path, method = request.url.path, request.method
        if path == "/v1/bugs" and method == "POST":
            response = self._submit(request)
            if self.lose_submit_answer:
                raise httpx.ReadTimeout("the answer was lost", request=request)
            return response
        if path == "/v1/bugs" and method == "GET":
            params = request.url.params
            bugs = [
                bug
                for bug in reversed(list(self.bugs.values()))
                if bug["short_id"] == params.get("short_id", bug["short_id"])
                and bug["repository"] == params.get("repository", bug["repository"])
            ]
            return httpx.Response(200, json={"request_id": "r", "data": bugs})
        if (match := _BUG.match(path)) and method == "GET":
            bug = self.bugs.get(match.group(1))
            return self._data(bug) if bug else self._missing()
        if (match := _BUG_CANCEL.match(path)) and method == "POST":
            bug = self.bugs.get(match.group(1))
            if bug is None:
                return self._missing()
            if bug["state"] in _ENDED_BUG_STATES:
                return httpx.Response(
                    409, json={"code": "INVALID_STATE", "message": "already ended"}
                )
            bug["state"] = "cancelled"
            return self._data(bug)
        return self._missing()

    def _submit(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        key = request.headers.get("idempotency-key")
        if key is None:
            return httpx.Response(428, json={"code": "IDEMPOTENCY_KEY_REQUIRED"})
        if key != body["run_id"]:
            return httpx.Response(422, json={"code": "INVALID_SCHEMA"})
        for bug in self.bugs.values():
            if bug["external_run_id"] == key:
                return self._data(bug, replayed=True)
        bug_id = str(uuid.uuid4())
        self.bugs[bug_id] = {
            "id": bug_id,
            "repository": body["repository"],
            "short_id": body["short_id"],
            "external_run_id": key,
            "state": "received",
            "run_id": None,
            "spec_id": str(uuid.uuid4()),
            "branch": None,
            "pr_number": None,
            "pr_url": None,
            "summary": None,
            "created_at": "2026-11-17T10:00:00.000Z",
            "updated_at": "2026-11-17T10:00:00.000Z",
        }
        return self._data(self.bugs[bug_id], status=201, replayed=False)

    def _data(
        self, bug: dict[str, Any], *, status: int = 200, replayed: bool | None = None
    ) -> httpx.Response:
        body: dict[str, Any] = {"request_id": str(uuid.uuid4()), "data": bug}
        if replayed is not None:
            body["replayed"] = replayed
        return httpx.Response(status, json=body)

    def _missing(self) -> httpx.Response:
        return httpx.Response(404, json={"code": "NOT_FOUND", "message": "no bug"})

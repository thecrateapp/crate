"""Minimal GitHub REST client for Launch fix and the review of its pull requests.

Synchronous httpx against `api.github.com` only, with the fine-grained token stored
for Launch fix. No retries: a dispatch starts a workflow run and a merge changes the
repository, so the worker tries once and reports a typed error. No redirects, no
proxies from the environment and a 15 s timeout. Errors never carry the token or a
response body; bodies are read only from successful answers, at most
`MAX_RESPONSE_BYTES`, and parsed into the few fields the callers need.

What each call needs from the token (fine-grained permissions on the repository):

- `dispatch_workflow`, `list_workflow_runs`, `get_workflow_run`,
  `cancel_workflow_run`: Actions (read; write to dispatch and cancel).
- `list_pulls`, `get_pull`: Pull requests read.
- `list_check_runs`: Checks read; `combined_status`: Commit statuses read.
- `mark_ready_for_review`, `close_pull`: Pull requests write.
- `merge_pull`: Pull requests and Contents write. `delete_branch`: Contents write.

Never call this from an HTTP request handler: only the error fix tasks do.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from datetime import datetime
from typing import Any
from urllib.parse import quote

import httpx

GITHUB_API_ROOT = "https://api.github.com"
GITHUB_API_VERSION = "2022-11-28"
REQUEST_TIMEOUT_SECONDS = 15.0
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_CHECK_RUN_PAGES = 3
_NAME = re.compile(r"^[A-Za-z0-9_.-]{1,100}$")
_WORKFLOW = re.compile(r"^[A-Za-z0-9_.-]{1,100}\.ya?ml$")
_REF = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_./-]{0,99}$")
_BRANCH = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_./-]{0,254}$")
_SHA = re.compile(r"^[0-9a-f]{40}$")
_NODE_ID = re.compile(r"^[A-Za-z0-9_=-]{1,100}$")
_MAX_INPUTS = 10
_MAX_INPUT_LENGTH = 1000
MERGE_METHODS = frozenset({"merge", "squash", "rebase"})

_READY_FOR_REVIEW = """
mutation($id: ID!) {
  markPullRequestReadyForReview(input: {pullRequestId: $id}) {
    pullRequest { isDraft }
  }
}
"""


class GitHubAPIError(Exception):
    def __init__(self, code: str, message: str, *, status: int | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


class GitHubAuthError(GitHubAPIError):
    """401: the token is wrong, expired or revoked."""


class GitHubForbiddenError(GitHubAPIError):
    """403: the token lacks the permission the call needs."""


class GitHubNotFoundError(GitHubAPIError):
    """404: no such repository, workflow, run or pull request for this token."""


class GitHubValidationError(GitHubAPIError):
    """422: GitHub refused the request's content."""


class GitHubNotMergeableError(GitHubAPIError):
    """405 on merge: branch protection, checks or conflicts keep it from merging."""


class GitHubConflictError(GitHubAPIError):
    """409: the head moved since it was approved, or the run already finished."""


class GitHubRateLimitedError(GitHubAPIError):
    pass


class GitHubServerError(GitHubAPIError):
    pass


class GitHubUnavailableError(GitHubAPIError):
    pass


class GitHubResponseError(GitHubAPIError):
    """A successful answer Crate cannot read: too large or not the expected JSON."""


def _segment(value: str, pattern: re.Pattern[str], name: str) -> str:
    if not isinstance(value, str) or not pattern.match(value) or value in {".", ".."}:
        raise ValueError(f"Invalid {name}")
    return value


def _repository_path(repository: str) -> str:
    if not isinstance(repository, str):
        raise ValueError("Invalid repository")
    owner, _, name = repository.partition("/")
    return (
        f"{_segment(owner, _NAME, 'repository')}/{_segment(name, _NAME, 'repository')}"
    )


def _positive(value: Any, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValueError(f"Invalid {name}")
    return value


def _sha(value: Any) -> str:
    if not isinstance(value, str) or not _SHA.match(value):
        raise ValueError("Invalid commit sha")
    return value


def _branch(value: Any) -> str:
    if (
        not isinstance(value, str)
        or not _BRANCH.match(value)
        or ".." in value
        or value.endswith(("/", ".lock"))
    ):
        raise ValueError("Invalid branch")
    return value


def _inputs(inputs: Mapping[str, str]) -> dict[str, str]:
    if not isinstance(inputs, Mapping) or len(inputs) > _MAX_INPUTS:
        raise ValueError("Invalid workflow inputs")
    checked: dict[str, str] = {}
    for key, value in inputs.items():
        if (
            not isinstance(key, str)
            or not _NAME.match(key)
            or not isinstance(value, str)
            or len(value) > _MAX_INPUT_LENGTH
        ):
            raise ValueError("Invalid workflow inputs")
        checked[key] = value
    return checked


def _raise_for_status(response: httpx.Response, permission: str) -> None:
    """Typed error for a failed answer; `permission` names what a 403 lacks."""
    status = response.status_code
    if 200 <= status < 300:
        return
    if status == 401:
        raise GitHubAuthError("GITHUB_AUTH", "GitHub rejected the token", status=status)
    if status == 429 or (
        status == 403 and response.headers.get("x-ratelimit-remaining") == "0"
    ):
        raise GitHubRateLimitedError(
            "GITHUB_RATE_LIMITED", "GitHub rate limit reached", status=status
        )
    if status == 403:
        raise GitHubForbiddenError(
            "GITHUB_FORBIDDEN",
            f"The GitHub token cannot do this (it needs {permission})",
            status=status,
        )
    if status == 404:
        raise GitHubNotFoundError(
            "GITHUB_NOT_FOUND",
            "GitHub could not find the repository, workflow or pull request "
            "for this token",
            status=status,
        )
    if status == 405:
        raise GitHubNotMergeableError(
            "GITHUB_NOT_MERGEABLE",
            "GitHub refused to merge: branch protection, checks or conflicts",
            status=status,
        )
    if status == 409:
        raise GitHubConflictError(
            "GITHUB_CONFLICT",
            "GitHub refused: the pull request or run changed meanwhile",
            status=status,
        )
    if status == 422:
        raise GitHubValidationError(
            "GITHUB_VALIDATION",
            "GitHub refused the request: check the workflow, its ref and inputs",
            status=status,
        )
    if status >= 500:
        raise GitHubServerError(
            "GITHUB_SERVER", "GitHub returned a server error", status=status
        )
    if 300 <= status < 400:
        raise GitHubUnavailableError(
            "GITHUB_REDIRECT", "GitHub answered with a redirect", status=status
        )
    raise GitHubAPIError(
        f"GITHUB_HTTP_{status}", "GitHub rejected the request", status=status
    )


def _iso(value: datetime) -> str:
    return value.strftime("%Y-%m-%dT%H:%M:%SZ")


class GitHubClient:
    def __init__(
        self,
        token: str,
        *,
        transport: httpx.BaseTransport | None = None,
        timeout: float = REQUEST_TIMEOUT_SECONDS,
    ) -> None:
        self._client = httpx.Client(
            base_url=GITHUB_API_ROOT,
            timeout=timeout,
            follow_redirects=False,
            trust_env=False,
            transport=transport,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": GITHUB_API_VERSION,
                "User-Agent": "crate-error-inbox",
            },
        )

    def __enter__(self) -> GitHubClient:
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()

    def close(self) -> None:
        self._client.close()

    def _call(
        self,
        method: str,
        path: str,
        *,
        permission: str,
        params: Mapping[str, Any] | None = None,
        body: Any = None,
        read: bool = False,
    ) -> Any:
        """One request; the JSON answer when `read`, else None. Never retried."""
        try:
            with self._client.stream(
                method,
                path,
                params=dict(params) if params else None,
                json=body,
            ) as response:
                _raise_for_status(response, permission)
                if not read:
                    return None
                chunks: list[bytes] = []
                size = 0
                for chunk in response.iter_bytes():
                    size += len(chunk)
                    if size > MAX_RESPONSE_BYTES:
                        raise GitHubResponseError(
                            "GITHUB_RESPONSE_TOO_LARGE",
                            "GitHub sent more than Crate reads",
                        )
                    chunks.append(chunk)
        except GitHubAPIError:
            raise
        except httpx.TimeoutException:
            raise GitHubUnavailableError(
                "GITHUB_TIMEOUT", "GitHub did not answer in time"
            ) from None
        except (httpx.HTTPError, OSError):
            # Never chain: transport errors may echo request data.
            raise GitHubUnavailableError(
                "GITHUB_UNAVAILABLE", "GitHub could not be reached"
            ) from None
        try:
            return json.loads(b"".join(chunks))
        except ValueError:
            raise GitHubResponseError(
                "GITHUB_UNEXPECTED_RESPONSE", "GitHub sent an unreadable answer"
            ) from None

    def _object(self, value: Any) -> dict[str, Any]:
        if not isinstance(value, dict):
            raise GitHubResponseError(
                "GITHUB_UNEXPECTED_RESPONSE", "GitHub sent an unexpected answer"
            )
        return value

    def _objects(self, value: Any) -> list[dict[str, Any]]:
        if not isinstance(value, list):
            raise GitHubResponseError(
                "GITHUB_UNEXPECTED_RESPONSE", "GitHub sent an unexpected answer"
            )
        return [item for item in value if isinstance(item, dict)]

    # -- Actions ------------------------------------------------------------------

    def dispatch_workflow(
        self, repository: str, workflow: str, ref: str, inputs: Mapping[str, str]
    ) -> None:
        """Start one run of `workflow` on `ref` (`workflow_dispatch`). Never retried."""
        path = (
            f"/repos/{_repository_path(repository)}/actions/workflows/"
            f"{_segment(workflow, _WORKFLOW, 'workflow')}/dispatches"
        )
        if not isinstance(ref, str) or not _REF.match(ref) or ".." in ref:
            raise ValueError("Invalid ref")
        body = {"ref": ref, "inputs": _inputs(inputs)}
        self._call("POST", path, permission="Actions write", body=body)

    def list_workflow_runs(
        self,
        repository: str,
        workflow: str,
        *,
        created_since: datetime,
        event: str = "workflow_dispatch",
        per_page: int = 30,
    ) -> list[dict[str, Any]]:
        """Runs of `workflow` created since `created_since`, newest first."""
        path = (
            f"/repos/{_repository_path(repository)}/actions/workflows/"
            f"{_segment(workflow, _WORKFLOW, 'workflow')}/runs"
        )
        answer = self._object(
            self._call(
                "GET",
                path,
                permission="Actions read",
                params={
                    "event": _segment(event, _NAME, "event"),
                    "created": f">={_iso(created_since)}",
                    "per_page": max(1, min(int(per_page), 100)),
                },
                read=True,
            )
        )
        return self._objects(answer.get("workflow_runs", []))

    def get_workflow_run(self, repository: str, run_id: int) -> dict[str, Any]:
        path = (
            f"/repos/{_repository_path(repository)}/actions/runs/"
            f"{_positive(run_id, 'run id')}"
        )
        return self._object(
            self._call("GET", path, permission="Actions read", read=True)
        )

    def cancel_workflow_run(self, repository: str, run_id: int) -> bool:
        """Cancel a run; False when it had already finished."""
        path = (
            f"/repos/{_repository_path(repository)}/actions/runs/"
            f"{_positive(run_id, 'run id')}/cancel"
        )
        try:
            self._call("POST", path, permission="Actions write")
        except GitHubConflictError:
            return False
        return True

    # -- pull requests ------------------------------------------------------------------

    def list_pulls(
        self,
        repository: str,
        *,
        head: str | None = None,
        state: str = "all",
        per_page: int = 50,
    ) -> list[dict[str, Any]]:
        """Pull requests, newest first; `head` is a branch of the same repository."""
        repo = _repository_path(repository)
        params: dict[str, Any] = {
            "state": state if state in {"open", "closed", "all"} else "all",
            "sort": "created",
            "direction": "desc",
            "per_page": max(1, min(int(per_page), 100)),
        }
        if head is not None:
            params["head"] = f"{repo.split('/')[0]}:{_branch(head)}"
        return self._objects(
            self._call(
                "GET",
                f"/repos/{repo}/pulls",
                permission="Pull requests read",
                params=params,
                read=True,
            )
        )

    def get_pull(self, repository: str, number: int) -> dict[str, Any]:
        path = (
            f"/repos/{_repository_path(repository)}/pulls/"
            f"{_positive(number, 'pull request number')}"
        )
        return self._object(
            self._call("GET", path, permission="Pull requests read", read=True)
        )

    def list_check_runs(self, repository: str, sha: str) -> list[dict[str, Any]]:
        """The latest check run of each check on `sha`, at most three pages."""
        path = f"/repos/{_repository_path(repository)}/commits/{_sha(sha)}/check-runs"
        runs: list[dict[str, Any]] = []
        for page in range(1, MAX_CHECK_RUN_PAGES + 1):
            answer = self._object(
                self._call(
                    "GET",
                    path,
                    permission="Checks read",
                    params={"filter": "latest", "per_page": 100, "page": page},
                    read=True,
                )
            )
            batch = self._objects(answer.get("check_runs", []))
            runs.extend(batch)
            total = answer.get("total_count")
            if len(batch) < 100 or not isinstance(total, int) or len(runs) >= total:
                break
        return runs

    def combined_status(self, repository: str, sha: str) -> dict[str, Any]:
        """Commit statuses (the API before checks) of `sha`, combined by GitHub."""
        path = f"/repos/{_repository_path(repository)}/commits/{_sha(sha)}/status"
        return self._object(
            self._call("GET", path, permission="Commit statuses read", read=True)
        )

    def mark_ready_for_review(self, node_id: str) -> None:
        """Turn a draft into a pull request ready for review (GraphQL only)."""
        answer = self._object(
            self._call(
                "POST",
                "/graphql",
                permission="Pull requests write",
                body={
                    "query": _READY_FOR_REVIEW,
                    "variables": {"id": _segment(node_id, _NODE_ID, "node id")},
                },
                read=True,
            )
        )
        errors = answer.get("errors")
        if errors:
            kinds = {
                str(error.get("type"))
                for error in errors
                if isinstance(error, dict) and error.get("type")
            }
            if "FORBIDDEN" in kinds:
                raise GitHubForbiddenError(
                    "GITHUB_FORBIDDEN",
                    "The GitHub token cannot do this (it needs Pull requests write)",
                )
            if "NOT_FOUND" in kinds:
                raise GitHubNotFoundError(
                    "GITHUB_NOT_FOUND", "GitHub could not find the pull request"
                )
            raise GitHubValidationError(
                "GITHUB_VALIDATION", "GitHub refused to mark the pull request ready"
            )

    def merge_pull(
        self, repository: str, number: int, *, sha: str, method: str = "merge"
    ) -> dict[str, Any]:
        """Merge only if the head is still `sha`; GitHub enforces branch protection."""
        if method not in MERGE_METHODS:
            raise ValueError("Invalid merge method")
        path = (
            f"/repos/{_repository_path(repository)}/pulls/"
            f"{_positive(number, 'pull request number')}/merge"
        )
        return self._object(
            self._call(
                "PUT",
                path,
                permission="Pull requests and Contents write",
                body={"sha": _sha(sha), "merge_method": method},
                read=True,
            )
        )

    def close_pull(self, repository: str, number: int) -> None:
        path = (
            f"/repos/{_repository_path(repository)}/pulls/"
            f"{_positive(number, 'pull request number')}"
        )
        self._call(
            "PATCH", path, permission="Pull requests write", body={"state": "closed"}
        )

    def delete_branch(self, repository: str, branch: str) -> bool:
        """Delete a branch; False when it was already gone."""
        path = (
            f"/repos/{_repository_path(repository)}/git/refs/heads/"
            f"{quote(_branch(branch), safe='/')}"
        )
        try:
            self._call("DELETE", path, permission="Contents write")
        except (GitHubValidationError, GitHubNotFoundError):
            # 422 "Reference does not exist"; 404 when the ref is gone too.
            return False
        return True


__all__ = [
    "GITHUB_API_ROOT",
    "MAX_RESPONSE_BYTES",
    "GitHubAPIError",
    "GitHubAuthError",
    "GitHubClient",
    "GitHubConflictError",
    "GitHubForbiddenError",
    "GitHubNotFoundError",
    "GitHubNotMergeableError",
    "GitHubRateLimitedError",
    "GitHubResponseError",
    "GitHubServerError",
    "GitHubUnavailableError",
    "GitHubValidationError",
]

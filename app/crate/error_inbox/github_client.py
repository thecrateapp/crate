"""Minimal GitHub REST client for Launch fix: one `workflow_dispatch` call.

Synchronous httpx against `api.github.com` only, with a fine-grained token that
holds Actions read and write on one repository (EI-D10). No retries: a dispatch
starts a workflow run, so the worker tries once and reports a typed error. No
redirects, no proxies from the environment and a 15 s timeout. Errors never carry
the token or the response body, which is never read.

Never call this from an HTTP request handler: only `dispatch_error_fix` does.
"""

from __future__ import annotations

import re
from collections.abc import Mapping

import httpx

GITHUB_API_ROOT = "https://api.github.com"
GITHUB_API_VERSION = "2022-11-28"
REQUEST_TIMEOUT_SECONDS = 15.0
_NAME = re.compile(r"^[A-Za-z0-9_.-]{1,100}$")
_WORKFLOW = re.compile(r"^[A-Za-z0-9_.-]{1,100}\.ya?ml$")
_REF = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_./-]{0,99}$")
_MAX_INPUTS = 10
_MAX_INPUT_LENGTH = 1000


class GitHubAPIError(Exception):
    def __init__(self, code: str, message: str, *, status: int | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


class GitHubAuthError(GitHubAPIError):
    """401: the token is wrong, expired or revoked."""


class GitHubForbiddenError(GitHubAPIError):
    """403: the token lacks Actions write on the repository."""


class GitHubNotFoundError(GitHubAPIError):
    """404: no such repository or workflow, or the token cannot see it."""


class GitHubValidationError(GitHubAPIError):
    """422: the workflow has no `workflow_dispatch`, the ref or an input is wrong."""


class GitHubRateLimitedError(GitHubAPIError):
    pass


class GitHubServerError(GitHubAPIError):
    pass


class GitHubUnavailableError(GitHubAPIError):
    pass


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


def _raise_for_status(response: httpx.Response) -> None:
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
            "The GitHub token cannot run this workflow (it needs Actions write)",
            status=status,
        )
    if status == 404:
        raise GitHubNotFoundError(
            "GITHUB_NOT_FOUND",
            "GitHub could not find the repository or workflow for this token",
            status=status,
        )
    if status == 422:
        raise GitHubValidationError(
            "GITHUB_VALIDATION",
            "GitHub refused the dispatch: check the workflow, its ref and inputs",
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
        try:
            with self._client.stream("POST", path, json=body) as response:
                _raise_for_status(response)
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


__all__ = [
    "GITHUB_API_ROOT",
    "GitHubAPIError",
    "GitHubAuthError",
    "GitHubClient",
    "GitHubForbiddenError",
    "GitHubNotFoundError",
    "GitHubRateLimitedError",
    "GitHubServerError",
    "GitHubUnavailableError",
    "GitHubValidationError",
]

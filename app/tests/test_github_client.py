"""GitHub REST client for Launch fix: request shape, typed errors, no retries."""

from __future__ import annotations

import json

import httpx
import pytest

from crate.error_inbox.autofix import workflow_inputs
from crate.error_inbox.github_client import (
    GitHubAPIError,
    GitHubAuthError,
    GitHubClient,
    GitHubForbiddenError,
    GitHubNotFoundError,
    GitHubRateLimitedError,
    GitHubServerError,
    GitHubUnavailableError,
    GitHubValidationError,
)

TOKEN = "github_pat_synthetic_client_token"
REPOSITORY = "thecrateapp/crate"
WORKFLOW = "error-autofix.yml"


def _client(handler) -> GitHubClient:
    return GitHubClient(TOKEN, transport=httpx.MockTransport(handler))


def _dispatch(client: GitHubClient, **overrides) -> None:
    args = {
        "repository": REPOSITORY,
        "workflow": WORKFLOW,
        "ref": "main",
        "inputs": workflow_inputs("CRATE-API-1F", ""),
        **overrides,
    }
    client.dispatch_workflow(
        args["repository"], args["workflow"], args["ref"], args["inputs"]
    )


def test_dispatch_payload_has_only_short_id_and_note():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(204)

    with _client(handler) as client:
        client.dispatch_workflow(
            REPOSITORY,
            WORKFLOW,
            "main",
            workflow_inputs("CRATE-API-1F", "Started after the last deploy."),
        )

    [request] = seen
    assert request.method == "POST"
    assert str(request.url) == (
        "https://api.github.com/repos/thecrateapp/crate/actions/workflows/"
        "error-autofix.yml/dispatches"
    )
    assert request.headers["authorization"] == f"Bearer {TOKEN}"
    assert request.headers["accept"] == "application/vnd.github+json"
    assert request.headers["x-github-api-version"] == "2022-11-28"
    assert json.loads(request.content) == {
        "ref": "main",
        "inputs": {
            "sentry_issue": "CRATE-API-1F",
            "note": "Started after the last deploy.",
        },
    }


@pytest.mark.parametrize(
    "status,headers,error_type,code",
    [
        (401, {}, GitHubAuthError, "GITHUB_AUTH"),
        (403, {}, GitHubForbiddenError, "GITHUB_FORBIDDEN"),
        (404, {}, GitHubNotFoundError, "GITHUB_NOT_FOUND"),
        (422, {}, GitHubValidationError, "GITHUB_VALIDATION"),
        (429, {}, GitHubRateLimitedError, "GITHUB_RATE_LIMITED"),
        (
            403,
            {"x-ratelimit-remaining": "0"},
            GitHubRateLimitedError,
            "GITHUB_RATE_LIMITED",
        ),
        (502, {}, GitHubServerError, "GITHUB_SERVER"),
        (302, {"location": "https://evil.example/"}, GitHubUnavailableError, None),
        (418, {}, GitHubAPIError, "GITHUB_HTTP_418"),
    ],
)
def test_typed_errors(status, headers, error_type, code):
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(
            status,
            headers=headers,
            json={"message": f"body mentions {TOKEN} and must stay unread"},
        )

    with pytest.raises(error_type) as caught:
        _dispatch(_client(handler))

    assert caught.value.code == (code or "GITHUB_REDIRECT")
    assert caught.value.status == status
    assert TOKEN not in str(caught.value)
    assert "body mentions" not in str(caught.value)
    # No retries and no redirects: one request whatever the answer.
    assert len(calls) == 1


@pytest.mark.parametrize(
    "failure,code",
    [
        (httpx.ConnectTimeout("connect timed out"), "GITHUB_TIMEOUT"),
        (httpx.ConnectError(f"refused for {TOKEN}"), "GITHUB_UNAVAILABLE"),
    ],
)
def test_transport_errors_are_typed_and_not_chained(failure, code):
    def handler(request: httpx.Request) -> httpx.Response:
        raise failure

    with pytest.raises(GitHubUnavailableError) as caught:
        _dispatch(_client(handler))

    assert caught.value.code == code
    assert caught.value.__cause__ is None
    assert caught.value.__suppress_context__ is True
    assert TOKEN not in str(caught.value)


@pytest.mark.parametrize(
    "overrides",
    [
        {"repository": "thecrateapp"},
        {"repository": "../crate"},
        {"repository": "thecrateapp/crate/issues"},
        {"repository": "thecrateapp/.."},
        {"workflow": "../secrets.yml"},
        {"workflow": "error-autofix.sh"},
        {"ref": "main..evil"},
        {"ref": "-main"},
        {"inputs": {"sentry_issue": 1}},
        {"inputs": {"sentry issue": "CRATE-API-1F"}},
        {"inputs": {"note": "x" * 1001}},
    ],
)
def test_rejects_unsafe_targets_before_sending(overrides):
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(204)

    with pytest.raises(ValueError):
        _dispatch(_client(handler), **overrides)
    assert calls == []


def test_client_ignores_environment_proxies_and_redirects(monkeypatch):
    monkeypatch.setenv("HTTPS_PROXY", "http://proxy.invalid:3128")
    client = GitHubClient(TOKEN)
    try:
        assert client._client.follow_redirects is False
        assert client._client.trust_env is False
        assert client._client.base_url.host == "api.github.com"
    finally:
        client.close()

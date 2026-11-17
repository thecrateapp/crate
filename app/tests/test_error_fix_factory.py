"""The `factory` executor: the factory's bug API client, the state mapping and the
settings it needs.

No database: the factory is `FakeFactory` or a bare `httpx.MockTransport`.
"""

from __future__ import annotations

import json
import uuid

import httpx
import pytest

from crate.error_inbox.config import (
    ErrorTrackingConfigError,
    FactorySettings,
    FixSettings,
    parse_config,
    validate_factory_url,
)
from crate.error_inbox.executors import (
    FACTORY_STATES,
    FactoryExecutor,
    FixBug,
    RunObservation,
)
from crate.error_inbox.factory_client import FactoryAPIError, FactoryClient
from tests.error_inbox_fakes import (
    FACTORY_FIXER,
    FACTORY_URL,
    REPOSITORY,
    FakeFactory,
)

TOKEN = "synthetic-factory-bugs-token"
RUN_ID = "0b6f7c1e-8a2d-4c3b-9f10-5e6d7c8b9a01"
ISSUE_ID = "3f1d2c4b-5a69-4788-9abc-def012345678"
SECRET_BODY = "synthetic body echoing the token " + TOKEN
PAYLOAD = {
    "version": 1,
    "issue": {"short_id": "CRATE-API-1F", "service": "api"},
    "releases": {"first": None, "last": None},
    "digest": None,
    "candidates": [],
    "triage": None,
}
# The factory's bug states (`BUG_STATES` in packages/contracts/src/bug.ts).
BUG_STATES = (
    "received",
    "rejected",
    "accepted",
    "reproducing",
    "fixing",
    "checking",
    "needs_decision",
    "awaiting_publication",
    "awaiting_review",
    "merged",
    "closed",
    "not_reproduced",
    "failed",
    "cancelled",
)


def _fix(**factory) -> FixSettings:
    return FixSettings(
        repository=REPOSITORY,
        workflow="error-autofix.yml",
        secret_ref="ref",
        executor="factory",
        factory=FactorySettings(
            **{
                "base_url": FACTORY_URL,
                "pr_author": FACTORY_FIXER,
                "secret_ref": "factory-ref",
                **factory,
            }
        ),
    )


def _bug(**overrides) -> FixBug:
    values = {
        "run_id": RUN_ID,
        "issue_id": ISSUE_ID,
        "short_id": "CRATE-API-1F",
        "note": "Look at the pool.",
        "repository": REPOSITORY,
        "base_ref": "main",
        "payload": PAYLOAD,
    }
    values.update(overrides)
    return FixBug(**values)


def _client(handler) -> FactoryClient:
    return FactoryClient(FACTORY_URL, TOKEN, transport=httpx.MockTransport(handler))


# -- submit -----------------------------------------------------------------------


def test_submit_posts_the_bug_with_its_run_id_as_idempotency_key():
    factory = FakeFactory()
    with factory.factory(FACTORY_URL, TOKEN) as client:
        executor = FactoryExecutor(_fix(), client)
        submission = executor.submit(_bug())

    [request] = factory.requests
    assert (request.method, str(request.url)) == ("POST", f"{FACTORY_URL}/v1/bugs")
    assert request.headers["authorization"] == f"Bearer {TOKEN}"
    assert request.headers["idempotency-key"] == RUN_ID
    assert request.headers["content-type"] == "application/json"
    # Exactly `bugSubmitInputSchema`: the factory refuses any other key.
    assert json.loads(request.content) == {
        "run_id": RUN_ID,
        "issue_id": ISSUE_ID,
        "short_id": "CRATE-API-1F",
        "note": "Look at the pool.",
        "repository": REPOSITORY,
        "base_ref": "main",
        "payload": PAYLOAD,
    }
    bug = factory.only_bug()
    assert submission.external_run_id == bug["id"]
    assert submission.external_run_url is None


def test_a_repeated_submission_gets_the_same_bug():
    factory = FakeFactory()
    with factory.factory(FACTORY_URL, TOKEN) as client:
        executor = FactoryExecutor(_fix(), client)
        first = executor.submit(_bug())
        second = executor.submit(_bug())
    assert first == second
    assert len(factory.bugs) == 1
    assert [r.headers["idempotency-key"] for r in factory.requests] == [RUN_ID] * 2


def test_submit_needs_the_payload_and_a_valid_run_id():
    factory = FakeFactory()
    with factory.factory(FACTORY_URL, TOKEN) as client:
        executor = FactoryExecutor(_fix(), client)
        with pytest.raises(ErrorTrackingConfigError) as missing:
            executor.submit(_bug(payload=None))
        assert missing.value.code == "ERROR_FIX_PAYLOAD_UNAVAILABLE"
        with pytest.raises(ValueError):
            executor.submit(_bug(run_id="Not A Run Id"))
    assert factory.requests == []


def test_submit_refuses_an_answer_without_a_bug_id():
    def handler(request):
        return httpx.Response(201, json={"data": {"state": "received"}})

    with _client(handler) as client:
        with pytest.raises(FactoryAPIError) as error:
            FactoryExecutor(_fix(), client).submit(_bug())
    assert error.value.code == "FACTORY_UNEXPECTED_RESPONSE"


# -- refresh ------------------------------------------------------------------------


def test_every_factory_state_maps_to_a_run_state():
    assert set(FACTORY_STATES) == set(BUG_STATES)


@pytest.mark.parametrize(
    ("state", "expected"),
    [
        ("received", "queued"),
        ("accepted", "queued"),
        ("reproducing", "running"),
        ("fixing", "running"),
        ("checking", "running"),
        ("needs_decision", "running"),
        ("awaiting_publication", "running"),
        ("awaiting_review", "succeeded"),
        ("merged", "succeeded"),
        ("rejected", "failed"),
        ("not_reproduced", "failed"),
        ("failed", "failed"),
        ("cancelled", "cancelled"),
        ("closed", "cancelled"),
    ],
)
def test_refresh_maps_the_bug_state(state, expected):
    factory = FakeFactory()
    with factory.factory(FACTORY_URL, TOKEN) as client:
        executor = FactoryExecutor(_fix(), client)
        bug_id = executor.submit(_bug()).external_run_id
        factory.bugs[str(bug_id)]["state"] = state
        observed = executor.refresh({"external_run_id": bug_id})
    assert observed.state == expected
    assert observed.external_run_id == bug_id
    assert observed.details == {"factory_state": state}
    assert factory.requests[-1].method == "GET"
    assert factory.requests[-1].url.path == f"/v1/bugs/{bug_id}"


def test_refresh_reads_the_pull_request_branch_and_summary():
    factory = FakeFactory()
    with factory.factory(FACTORY_URL, TOKEN) as client:
        executor = FactoryExecutor(_fix(), client)
        bug_id = str(executor.submit(_bug()).external_run_id)
        observed = executor.refresh({"external_run_id": bug_id})
        assert (observed.pull_number, observed.branch, observed.summary) == (
            None,
            None,
            None,
        )
        factory.bugs[bug_id].update(
            state="awaiting_review",
            branch="autofix/crate-api-1f-7d3c2b1a-0000-4000-8000-000000000001",
            pr_number=41,
            pr_url=f"https://github.com/{REPOSITORY}/pull/41",
            summary="Reproduced with a failing test and fixed.",
        )
        observed = executor.refresh({"external_run_id": bug_id})
    assert observed == RunObservation(
        state="succeeded",
        external_run_id=bug_id,
        pull_number=41,
        branch="autofix/crate-api-1f-7d3c2b1a-0000-4000-8000-000000000001",
        summary="Reproduced with a failing test and fixed.",
        details={"factory_state": "awaiting_review"},
    )


def test_refresh_without_a_bug_id_waits_and_unknown_states_are_typed():
    factory = FakeFactory()
    with factory.factory(FACTORY_URL, TOKEN) as client:
        executor = FactoryExecutor(_fix(), client)
        assert executor.refresh({"external_run_id": None}).state == "queued"
        assert factory.requests == []
        bug_id = str(executor.submit(_bug()).external_run_id)
        factory.bugs[bug_id].update(state="exploded", pr_number=True)
        with pytest.raises(FactoryAPIError) as unknown:
            executor.refresh({"external_run_id": bug_id})
    assert unknown.value.code == "FACTORY_UNEXPECTED_RESPONSE"


# -- cancel -------------------------------------------------------------------------


def test_cancel_is_best_effort():
    factory = FakeFactory()
    with factory.factory(FACTORY_URL, TOKEN) as client:
        executor = FactoryExecutor(_fix(), client)
        assert executor.cancel({"external_run_id": None}) is False
        assert factory.requests == []
        bug_id = str(executor.submit(_bug()).external_run_id)
        assert executor.cancel({"external_run_id": bug_id}) is True
        assert factory.bugs[bug_id]["state"] == "cancelled"
        assert factory.requests[-1].url.path == f"/v1/bugs/{bug_id}/cancel"
        # A bug that already ended: the factory answers 409.
        factory.bugs[bug_id]["state"] = "merged"
        assert executor.cancel({"external_run_id": bug_id}) is False
        with pytest.raises(FactoryAPIError) as missing:
            executor.cancel({"external_run_id": str(uuid.uuid4())})
    assert missing.value.code == "FACTORY_NOT_FOUND"


def test_bug_ids_are_checked_before_any_call():
    factory = FakeFactory()
    with factory.factory(FACTORY_URL, TOKEN) as client:
        for bad in ("../runs", "ABC", f"{uuid.uuid4()}/reject"):
            with pytest.raises(ValueError):
                client.get_bug(bad)
            with pytest.raises(ValueError):
                client.cancel_bug(bad)
    assert factory.requests == []


# -- errors -------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("status", "code"),
    [
        (401, "FACTORY_AUTH"),
        (403, "FACTORY_FORBIDDEN"),
        (404, "FACTORY_NOT_FOUND"),
        (409, "FACTORY_CONFLICT"),
        (413, "FACTORY_VALIDATION"),
        (422, "FACTORY_VALIDATION"),
        (428, "FACTORY_VALIDATION"),
        (429, "FACTORY_RATE_LIMITED"),
        (500, "FACTORY_SERVER"),
        (503, "FACTORY_SERVER"),
        (302, "FACTORY_REDIRECT"),
        (418, "FACTORY_HTTP_418"),
    ],
)
def test_failed_answers_are_typed_without_secrets_or_bodies(status, code):
    def handler(request):
        return httpx.Response(
            status,
            headers={"location": f"{FACTORY_URL}/elsewhere"},
            json={"code": "BUG_LIMIT", "message": SECRET_BODY},
        )

    with _client(handler) as client:
        with pytest.raises(FactoryAPIError) as error:
            client.submit_bug({"run_id": RUN_ID})
    assert (error.value.code, error.value.status) == (code, status)
    assert TOKEN not in str(error.value)
    assert "synthetic body" not in str(error.value)
    assert error.value.__cause__ is None


@pytest.mark.parametrize(
    ("raised", "code"),
    [
        (httpx.ReadTimeout(f"timed out with Bearer {TOKEN}"), "FACTORY_TIMEOUT"),
        (httpx.ConnectError(f"refused, Bearer {TOKEN}"), "FACTORY_UNAVAILABLE"),
    ],
)
def test_transport_failures_are_typed_and_never_chained(raised, code):
    def handler(request):
        raise raised

    with _client(handler) as client:
        with pytest.raises(FactoryAPIError) as error:
            client.get_bug(str(uuid.uuid4()))
    assert error.value.code == code
    assert TOKEN not in str(error.value)
    assert error.value.__cause__ is None and error.value.__suppress_context__


@pytest.mark.parametrize(
    ("content", "code"),
    [
        (b"not json", "FACTORY_UNEXPECTED_RESPONSE"),
        (b'{"data": []}', "FACTORY_UNEXPECTED_RESPONSE"),
        (b'{"id": "flat, not enveloped"}', "FACTORY_UNEXPECTED_RESPONSE"),
        (
            b'{"data": {"x": "' + b"a" * (300 * 1024) + b'"}}',
            "FACTORY_RESPONSE_TOO_LARGE",
        ),
    ],
)
def test_successful_answers_must_be_bounded_envelopes(content, code):
    def handler(request):
        return httpx.Response(200, content=content)

    with _client(handler) as client:
        with pytest.raises(FactoryAPIError) as error:
            client.get_bug(str(uuid.uuid4()))
    assert error.value.code == code


def test_the_client_never_follows_redirects_or_uses_proxies(monkeypatch):
    monkeypatch.setenv("HTTP_PROXY", "http://proxy.invalid:3128")
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(307, headers={"location": "http://169.254.169.254/"})

    with _client(handler) as client:
        with pytest.raises(FactoryAPIError) as error:
            client.get_bug(str(uuid.uuid4()))
    assert error.value.code == "FACTORY_REDIRECT"
    assert len(calls) == 1


# -- settings -----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("http://100.101.102.103:8788", "http://100.101.102.103:8788"),
        ("http://100.64.0.1:8788/", "http://100.64.0.1:8788"),
        ("http://[fd7a:115c:a1e0::1]:8788", "http://[fd7a:115c:a1e0::1]:8788"),
        ("http://factory.tail1234.ts.net:8788", "http://factory.tail1234.ts.net:8788"),
        ("https://factory.example.com", "https://factory.example.com"),
        ("HTTPS://Factory.Example.com:8443", "https://factory.example.com:8443"),
    ],
)
def test_factory_urls(raw, expected):
    assert validate_factory_url(raw) == expected


@pytest.mark.parametrize(
    ("raw", "message"),
    [
        ("http://factory.example.com", "only accepted on the tailnet"),
        ("http://192.168.1.10:8788", "only accepted on the tailnet"),
        ("http://127.0.0.1:8788", "only accepted on the tailnet"),
        ("ftp://100.101.102.103", "HTTP or HTTPS"),
        ("http://169.254.169.254", "not allowed"),
        ("https://metadata.google.internal", "Metadata"),
        ("https://user:pass@factory.example.com", "bare origin"),
        ("https://factory.example.com/v1", "bare origin"),
        ("https://factory.example.com?x=1", "bare origin"),
        ("https://factory.example.com/%2e%2e", "Invalid factory URL"),
        ("https://fact ory.example.com", "Invalid factory URL"),
        ("", "Invalid factory URL"),
    ],
)
def test_factory_urls_refused(raw, message):
    with pytest.raises(ErrorTrackingConfigError) as refused:
        validate_factory_url(raw)
    assert message in refused.value.message


def _settings(**factory):
    return {
        "organization": "ninja-development",
        "fix": {
            "repository": REPOSITORY,
            "workflow": "error-autofix.yml",
            "executor": "factory",
            "factory": {
                "base_url": FACTORY_URL,
                "pr_author": FACTORY_FIXER,
                **factory,
            },
        },
    }


@pytest.mark.parametrize(
    "login", ["", "crate-factory", "someone", "Crate-Factory[bot]", "a" * 40 + "[bot]"]
)
def test_the_pr_author_is_a_github_app_login(login):
    with pytest.raises(ErrorTrackingConfigError) as refused:
        parse_config(_settings(pr_author=login))
    assert "pr_author" in refused.value.message
    with pytest.raises(ErrorTrackingConfigError):
        parse_config(_settings(pr_author=None))


def test_launch_fix_with_the_factory_needs_both_tokens():
    config = parse_config(_settings())
    assert config.fix is not None
    assert not config.fix_ready
    assert _fix().ready
    assert not _fix(secret_ref=None).ready
    github_actions = parse_config(
        {**_settings(), "fix": {**_settings()["fix"], "executor": "github_actions"}}
    )
    assert github_actions.fix is not None
    # The factory's settings stay, so its open runs can still be followed.
    assert github_actions.fix.factory is not None
    assert github_actions.fix.pr_authors["factory"] == FACTORY_FIXER

"""Sentry REST client: request shape, pagination, typed errors and host pinning."""

from __future__ import annotations

import json
import socket
from datetime import datetime, timezone

import httpx
import pytest

from crate.error_inbox.config import parse_config
from crate.error_inbox.sentry_client import (
    RECENT_STATS_PERIOD,
    SentryAuthError,
    SentryClient,
    SentryForbiddenError,
    SentryNotFoundError,
    SentryRateLimitedError,
    SentryServerError,
    SentryUnavailableError,
    merge_recent_window,
    normalize_issue,
    scope_access,
)

TOKEN = "sntrys_synthetic_token_value"
CONFIG = parse_config(
    {
        "base_url": "https://us.sentry.io",
        "organization": "ninja-development",
        "projects": ["crate-api", "crate-workers"],
        "environments": ["production"],
    }
)


def _issue(issue_id: int, **overrides):
    issue = {
        "id": str(issue_id),
        "shortId": f"CRATE-API-{issue_id}",
        "title": "IntegrityError: duplicate key",
        "culprit": "library_pipeline",
        "level": "error",
        "status": "unresolved",
        "substatus": "ongoing",
        "priority": "high",
        "issueCategory": "error",
        "count": "12",
        "userCount": 2,
        "lifetime": {"count": "40", "userCount": 5},
        "stats": {"24h": [[1762214400, 3], [1762218000, 0], [1762221600, 5]]},
        "firstSeen": "2026-10-06T15:45:00.123456Z",
        "lastSeen": "2026-11-04T08:14:00Z",
        "firstRelease": {"version": "crate-8ba478ac"},
        "lastRelease": {"version": "crate-4ba9e59a"},
        "project": {"id": "1", "slug": "crate-api"},
        "permalink": f"https://ninja-development.sentry.io/issues/{issue_id}/",
    }
    issue.update(overrides)
    return issue


def _link(next_cursor: str, results: bool) -> str:
    base = "https://us.sentry.io/api/0/organizations/ninja-development/issues/"
    return (
        f'<{base}?cursor=0:0:1>; rel="previous"; results="false"; cursor="0:0:1", '
        f'<{base}?cursor={next_cursor}>; rel="next"; results="{str(results).lower()}"; '
        f'cursor="{next_cursor}"'
    )


def _client(handler, *, config=CONFIG, resolver=None) -> SentryClient:
    kwargs = {"transport": httpx.MockTransport(handler)}
    if resolver is not None:
        kwargs["resolver"] = resolver
    return SentryClient(config, TOKEN, **kwargs)


def test_list_request_shape():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=[_issue(1)])

    page = _client(handler).list_unresolved()

    request = seen[0]
    assert request.method == "GET"
    assert request.url.host == "us.sentry.io"
    assert request.url.path == "/api/0/organizations/ninja-development/issues/"
    # Only errors: performance issues live in their own backlog (gate EG1).
    assert request.url.params.get("query") == "is:unresolved issue.category:error"
    assert request.url.params.get("statsPeriod") == "90d"
    assert request.url.params.get("groupStatsPeriod") == "24h"
    assert request.url.params.get("limit") == "100"
    assert request.url.params.get_list("project") == ["crate-api", "crate-workers"]
    assert request.url.params.get_list("environment") == ["production"]
    assert "cursor" not in request.url.params
    assert request.headers["authorization"] == f"Bearer {TOKEN}"
    assert [issue["short_id"] for issue in page.issues] == ["CRATE-API-1"]
    assert page.next_cursor is None


def test_list_takes_the_stats_period():
    periods: list[str | None] = []

    def handler(request: httpx.Request) -> httpx.Response:
        periods.append(request.url.params.get("statsPeriod"))
        return httpx.Response(200, json=[_issue(1)])

    client = _client(handler)
    client.list_unresolved(stats_period=RECENT_STATS_PERIOD)
    client.iter_unresolved(stats_period=RECENT_STATS_PERIOD)

    assert periods == ["24h", "24h"]


@pytest.mark.parametrize("period", ["", "0h", "24", "1y", "24h&query=is:resolved"])
def test_list_rejects_invalid_stats_period_before_sending(period):
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("no request expected")

    with pytest.raises(ValueError):
        _client(handler).list_unresolved(stats_period=period)


def test_recent_window_sets_users_24h():
    full = [
        normalize_issue(_issue(1, userCount=9, stats={})),
        normalize_issue(_issue(2, userCount=4)),
    ]
    recent = [normalize_issue(_issue(1, count="6", userCount=3))]

    merged = merge_recent_window(full, recent)

    by_id = {issue["external_id"]: issue for issue in merged}
    # Issue 1 had no 24h buckets: the 24h listing gives both counts.
    assert by_id["1"]["users_24h"] == 3
    assert by_id["1"]["events_24h"] == 6
    # Issue 2 was quiet for a day: no users, and its buckets stay authoritative.
    assert by_id["2"]["users_24h"] == 0
    assert by_id["2"]["events_24h"] == 8
    assert "users_24h" not in full[0]


def test_recent_window_keeps_active_issues_missing_from_a_truncated_listing():
    full = [normalize_issue(_issue(1))]
    recent = [normalize_issue(_issue(1)), normalize_issue(_issue(2, userCount=5))]

    merged = merge_recent_window(full, recent)

    assert [issue["external_id"] for issue in merged] == ["1", "2"]
    assert merged[1]["users_24h"] == 5


def test_lists_pages_until_cap():
    cursors: list[str | None] = []

    def handler(request: httpx.Request) -> httpx.Response:
        cursors.append(request.url.params.get("cursor"))
        index = len(cursors)
        return httpx.Response(
            200,
            json=[_issue(index * 10 + 1), _issue(index * 10 + 2)],
            headers={"Link": _link(f"0:{index * 100}:0", True)},
        )

    listing = _client(handler).iter_unresolved(max_pages=3)

    assert cursors == [None, "0:100:0", "0:200:0"]
    assert listing.pages == 3
    assert listing.truncated is True
    assert len(listing.issues) == 6


def test_listing_stops_when_next_page_has_no_results():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        has_more = len(calls) == 1
        return httpx.Response(
            200,
            json=[_issue(len(calls))],
            headers={"Link": _link(f"0:{len(calls) * 100}:0", has_more)},
        )

    listing = _client(handler).iter_unresolved(max_pages=5)

    assert len(calls) == 2
    assert listing.truncated is False
    assert [issue["external_id"] for issue in listing.issues] == ["1", "2"]


def test_parses_stats_24h():
    issue = normalize_issue(_issue(7, title="x" * 400))

    assert issue == {
        "external_id": "7",
        "short_id": "CRATE-API-7",
        "project_slug": "crate-api",
        "service": "crate-api",
        "title": "x" * 300,
        "culprit": "library_pipeline",
        "level": "error",
        "status": "unresolved",
        "substatus": "ongoing",
        "sentry_priority": "high",
        "issue_category": "error",
        "events_total": 40,
        "users_total": 5,
        "events_window": 12,
        "users_window": 2,
        "events_24h": 8,
        "first_seen": datetime(2026, 10, 6, 15, 45, 0, 123456, tzinfo=timezone.utc),
        "last_seen": datetime(2026, 11, 4, 8, 14, tzinfo=timezone.utc),
        "first_release": "crate-8ba478ac",
        "last_release": "crate-4ba9e59a",
        "permalink": "https://ninja-development.sentry.io/issues/7/",
    }


def test_normalize_maps_statuses_and_unknown_values():
    ignored = normalize_issue(
        _issue(8, status="ignored", substatus="archived_until_escalating", stats={})
    )
    muted = normalize_issue(
        _issue(9, status="muted", level="sample", priority="urgent")
    )
    bare = normalize_issue(
        _issue(10, lifetime=None, firstRelease=None, permalink="javascript:alert(1)")
    )

    assert ignored["status"] == "ignored"
    assert ignored["substatus"] == "archived_until_escalating"
    assert ignored["events_24h"] is None
    assert muted["status"] == "ignored"
    assert muted["level"] == "error"
    assert muted["sentry_priority"] is None
    assert bare["events_total"] == 12
    assert bare["users_total"] == 2
    assert bare["first_release"] is None
    assert bare["permalink"] is None


def test_get_issue_and_latest_event_paths():
    paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        paths.append(request.url.path)
        if request.url.path.endswith("/events/latest/"):
            return httpx.Response(200, json={"eventID": "e" * 32, "entries": []})
        return httpx.Response(200, json=_issue(42))

    client = _client(handler)
    issue = client.get_issue("42")
    event = client.latest_event("42")

    assert paths == [
        "/api/0/organizations/ninja-development/issues/42/",
        "/api/0/organizations/ninja-development/issues/42/events/latest/",
    ]
    assert issue["short_id"] == "CRATE-API-42"
    assert event["eventID"] == "e" * 32


def test_update_status_payload():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(
            200,
            json=_issue(42, status="ignored", substatus="archived_until_escalating"),
        )

    issue = _client(handler).update_status(
        "42", "ignored", substatus="archived_until_escalating"
    )

    assert seen[0].method == "PUT"
    assert seen[0].url.path == "/api/0/organizations/ninja-development/issues/42/"
    assert json.loads(seen[0].content) == {
        "status": "ignored",
        "substatus": "archived_until_escalating",
    }
    assert issue["status"] == "ignored"


def test_update_status_rejects_unknown_values_before_sending():
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("no request expected")

    client = _client(handler)

    with pytest.raises(ValueError):
        client.update_status("42", "deleted")
    with pytest.raises(ValueError):
        client.update_status("42", "ignored", substatus="forever-ish")
    with pytest.raises(ValueError):
        client.update_status("../../projects", "resolved")


@pytest.mark.parametrize(
    ("status", "error"),
    [
        (401, SentryAuthError),
        (403, SentryForbiddenError),
        (404, SentryNotFoundError),
        (429, SentryRateLimitedError),
        (302, SentryUnavailableError),
    ],
)
def test_auth_error_is_typed(status, error):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            status,
            json={"detail": f"token {TOKEN} rejected"},
            headers={"Retry-After": "30", "Location": "https://evil.example/"},
        )

    with pytest.raises(error) as raised:
        _client(handler).get_issue("42")

    assert raised.value.status == status
    assert TOKEN not in str(raised.value)
    assert TOKEN not in repr(raised.value)
    if status == 429:
        assert raised.value.retry_after == 30


def test_no_retry_on_5xx():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(502, text="bad gateway")

    with pytest.raises(SentryServerError):
        _client(handler).list_unresolved()

    assert len(calls) == 1


def test_network_errors_and_bad_json_are_typed():
    def offline(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    def garbage(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"<html>")

    with pytest.raises(SentryUnavailableError):
        _client(offline).list_unresolved()
    with pytest.raises(SentryUnavailableError):
        _client(garbage).list_unresolved()


def test_response_size_is_capped(monkeypatch):
    from crate.error_inbox import sentry_client

    monkeypatch.setattr(sentry_client, "MAX_RESPONSE_BYTES", 1024)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=json.dumps([_issue(1)] * 20).encode())

    with pytest.raises(SentryUnavailableError) as raised:
        _client(handler).list_unresolved()

    assert raised.value.code == "SENTRY_RESPONSE_TOO_LARGE"


def test_check_scopes_reads_the_token_scopes():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/0/"
        return httpx.Response(
            200, json={"version": "0", "auth": {"scopes": ["org:read", "event:read"]}}
        )

    scopes = _client(handler).check_scopes()

    assert scopes == frozenset({"org:read", "event:read"})
    assert scope_access(scopes) == {"read": True, "write": False}
    assert scope_access(frozenset({"event:write"})) == {"read": True, "write": True}
    assert scope_access(frozenset({"org:read"})) == {"read": False, "write": False}


SELF_HOSTED = parse_config(
    {"base_url": "https://sentry.home.lan:9000", "organization": "home"}
)


def _resolver(*addresses):
    def resolve(host, port, *args, **kwargs):
        assert host == "sentry.home.lan"
        assert port == 9000
        return [
            (
                socket.AF_INET6 if ":" in address else socket.AF_INET,
                socket.SOCK_STREAM,
                6,
                "",
                (address, port),
            )
            for address in addresses
        ]

    return resolve


def test_self_hosted_connects_to_the_checked_address():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=[])

    _client(
        handler, config=SELF_HOSTED, resolver=_resolver("10.0.0.5")
    ).list_unresolved()

    request = seen[0]
    assert request.url.host == "10.0.0.5"
    assert request.url.port == 9000
    assert request.headers["host"] == "sentry.home.lan:9000"
    assert request.extensions["sni_hostname"] == "sentry.home.lan"


def test_self_hosted_refuses_link_local_resolution():
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("no request expected")

    client = _client(
        handler, config=SELF_HOSTED, resolver=_resolver("10.0.0.5", "169.254.169.254")
    )

    with pytest.raises(SentryUnavailableError) as raised:
        client.list_unresolved()

    assert raised.value.code == "SENTRY_HOST_DISALLOWED"

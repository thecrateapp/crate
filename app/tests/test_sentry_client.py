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


def _release_object(version: str) -> dict:
    """A release as Retrieve an Issue serializes `firstRelease` and `lastRelease`."""
    return {
        "id": 1,
        "version": version,
        "shortVersion": version,
        "status": "open",
        "versionInfo": {"package": None, "version": {"raw": version}},
        "ref": None,
        "url": None,
        "dateReleased": None,
        "dateCreated": "2026-10-06T15:40:00Z",
        "data": {},
        "newGroups": 0,
        "owner": None,
        "commitCount": 0,
        "lastCommit": None,
        "deployCount": 0,
        "lastDeploy": None,
        "authors": [],
        "projects": [],
        "firstEvent": None,
        "lastEvent": None,
        "currentProjectMeta": {},
        "userAgent": None,
    }


def test_releases_come_from_the_issue_detail_not_the_listing():
    listed = _issue(42)
    # List an Organization's Issues has no release fields at all.
    del listed["firstRelease"], listed["lastRelease"]
    details = {
        "42": _issue(
            42, firstRelease=_release_object("crate-8ba478ac"), lastRelease=None
        ),
        "43": _issue(
            43,
            firstRelease=_release_object("crate-8ba478ac"),
            lastRelease=_release_object("crate-4ba9e59a"),
        ),
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/organizations/ninja-development/issues/"):
            return httpx.Response(200, json=[listed])
        return httpx.Response(200, json=details[request.url.path.split("/")[-2]])

    client = _client(handler)
    [issue] = client.list_unresolved().issues

    assert (issue["first_release"], issue["last_release"]) == (None, None)
    first_only = client.get_issue("42")
    assert (first_only["first_release"], first_only["last_release"]) == (
        "crate-8ba478ac",
        None,
    )
    both = client.get_issue("43")
    assert (both["first_release"], both["last_release"]) == (
        "crate-8ba478ac",
        "crate-4ba9e59a",
    )


def test_resolve_short_id_reads_the_org_scoped_endpoint():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(
            200,
            json={
                "organizationSlug": "ninja-development",
                "projectSlug": "crate-api",
                "groupId": "42",
                "shortId": "CRATE-API-42",
                "group": _issue(42),
            },
        )

    issue = _client(handler).resolve_short_id("CRATE-API-42")

    [request] = seen
    # The regional host serves organization endpoints; only the API root is not.
    assert str(request.url) == (
        "https://us.sentry.io/api/0/organizations/ninja-development/shortids/"
        "CRATE-API-42/"
    )
    assert request.headers["Authorization"] == f"Bearer {TOKEN}"
    assert (issue["external_id"], issue["short_id"]) == ("42", "CRATE-API-42")
    assert issue["first_release"] == "crate-8ba478ac"


@pytest.mark.parametrize(
    "short_id", ["", "-API-1", "../issues/1", "CRATE API-1", "X" * 65 + "-1"]
)
def test_resolve_short_id_rejects_odd_ids_before_sending(short_id):
    client = _client(lambda request: pytest.fail("sent"))

    with pytest.raises(ValueError):
        client.resolve_short_id(short_id)


@pytest.mark.parametrize(
    "status,body,error",
    [
        (404, {"detail": "not found"}, SentryNotFoundError),
        (200, {"groupId": "42"}, SentryUnavailableError),
        (200, {"group": {"id": "42"}}, SentryUnavailableError),
        (200, ["CRATE-API-42"], SentryUnavailableError),
    ],
)
def test_resolve_short_id_errors_are_typed(status, body, error):
    client = _client(lambda request: httpx.Response(status, json=body))

    with pytest.raises(error):
        client.resolve_short_id("CRATE-API-42")


def test_tag_values_reads_the_documented_endpoint_on_the_configured_host():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(
            200,
            json={
                "key": "release",
                "name": "Release",
                "uniqueValues": 13,
                "totalValues": 40,
                "topValues": [
                    {
                        "key": "crate-b",
                        "name": "crate-b",
                        "value": "crate-b",
                        "count": 30,
                        "firstSeen": "2026-11-01T10:00:00Z",
                        "lastSeen": "2026-11-04T08:00:00Z",
                    },
                    {"value": "x" * 300, "count": "7"},
                    {"value": None, "count": 1},
                    "not an object",
                    *({"value": f"crate-{n}", "count": 1} for n in range(20)),
                ],
            },
        )

    detail = _client(handler).tag_values("42", "release")

    [request] = seen
    # Regional host, organization-scoped path, configured environments only.
    assert request.url.host == "us.sentry.io"
    assert request.url.path == (
        "/api/0/organizations/ninja-development/issues/42/tags/release/"
    )
    assert request.url.params.get_list("environment") == ["production"]
    assert (detail["key"], detail["total"], detail["unique"]) == ("release", 40, 13)
    assert len(detail["top"]) == 10
    assert detail["top"][0] == {
        "value": "crate-b",
        "count": 30,
        "first_seen": datetime(2026, 11, 1, 10, tzinfo=timezone.utc),
        "last_seen": datetime(2026, 11, 4, 8, tzinfo=timezone.utc),
    }
    assert detail["top"][1]["value"] == "x" * 200 and detail["top"][1]["count"] == 7


@pytest.mark.parametrize("key", ["", "Release", "../events", "user.email/x", "a" * 33])
def test_tag_values_rejects_odd_keys_before_sending(key):
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("no request expected")

    with pytest.raises(ValueError):
        _client(handler).tag_values("42", key)
    with pytest.raises(ValueError):
        _client(handler).tag_values("../42", "release")


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


@pytest.mark.parametrize("region", ["https://us.sentry.io", "https://de.sentry.io"])
def test_regional_host_reads_scopes_from_sentry_io(region):
    # The regional hosts answer 404 for the API root; only sentry.io serves it.
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path == "/api/0/":
            if request.url.host != "sentry.io":
                return httpx.Response(404, json={"detail": "Not found"})
            return httpx.Response(200, json={"auth": {"scopes": ["event:write"]}})
        return httpx.Response(200, json=[_issue(1)])

    config = parse_config({"base_url": region, "organization": "example-org"})
    client = _client(handler, config=config)

    assert client.check_scopes() == frozenset({"event:write"})
    client.list_unresolved()

    root, listing = seen
    assert (root.url.host, root.headers["authorization"]) == (
        "sentry.io",
        f"Bearer {TOKEN}",
    )
    assert listing.url.host == region.removeprefix("https://")


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

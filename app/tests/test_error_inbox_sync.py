"""The Sentry sync pass against PostgreSQL and a fake Sentry (`httpx.MockTransport`)."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import text

from tests.error_inbox_fakes import TOKEN, FakeSentry, configure, raw_event, raw_issue


def _scope():
    from crate.db.tx import transaction_scope

    return transaction_scope()


def _rows() -> dict[str, dict]:
    with _scope() as session:
        rows = session.execute(
            text(
                """
                SELECT id::text AS id, external_id, service, status, substatus,
                       users_24h, events_24h, crate_score, digest, digest_hash,
                       digest_event_id, group_key, closed_at, synced_at
                FROM error_issues
                """
            )
        ).mappings()
        return {row["external_id"]: dict(row) for row in rows}


def _state(key="error_inbox"):
    from crate.db.ops_runtime import get_ops_runtime_state

    return get_ops_runtime_state(key)


def _sync(fake: FakeSentry, **kwargs):
    from crate.worker_handlers.error_inbox import sync_issues

    return sync_issues(client_factory=fake.factory, **kwargs)


def _fake_with(*issues, recent=(), events=True) -> FakeSentry:
    fake = FakeSentry()
    fake.full = list(issues)
    fake.recent = list(recent)
    if events:
        fake.events = {issue["id"]: raw_event(issue["id"]) for issue in issues}
    return fake


def test_not_configured_is_a_noop(pg_db):
    def factory(config, token):
        raise AssertionError("no client expected without configuration")

    from crate.worker_handlers.error_inbox import sync_issues

    assert sync_issues(client_factory=factory) == {
        "status": "skipped",
        "reason": "not_configured",
    }
    assert _rows() == {}
    assert _state() is None


def test_handler_is_a_noop_without_configuration(pg_db):
    from crate.worker_handlers.error_inbox import ERROR_INBOX_TASK_HANDLERS

    handler = ERROR_INBOX_TASK_HANDLERS["sync_error_issues"]

    assert handler("task-1", {}, {})["status"] == "skipped"


def test_first_sync_inserts_and_scores(pg_db):
    from crate.error_inbox.priority import crate_score

    configure()
    critical = raw_issue(
        1,
        level="fatal",
        substatus="escalating",
        priority="high",
        stats={"24h": [[1762214400, 7], [1762218000, 1]]},
    )
    quiet = raw_issue(2, level="warning", substatus="ongoing", priority="low")
    fake = _fake_with(critical, quiet, recent=[raw_issue(1, userCount=3)])
    fake.events["2"] = raw_event(2, service=None)

    result = _sync(fake)

    assert result["status"] == "ok"
    assert result["error_code"] is None
    assert result["counts"] == {
        "listed": 2,
        "listed_recent": 1,
        "upserted": 2,
        "digests_fetched": 2,
        "status_refreshed": 0,
        "purged": 0,
    }
    rows = _rows()
    # The service tag of the latest event wins; without one the project slug stays.
    assert rows["1"]["service"] == "api"
    assert rows["2"]["service"] == "crate-api"
    assert rows["1"]["crate_score"] == crate_score(
        {
            "level": "fatal",
            "substatus": "escalating",
            "service": "api",
            "users_24h": 3,
            "events_24h": 8,
            "sentry_priority": "high",
        }
    )
    assert rows["2"]["crate_score"] == crate_score(
        {
            "level": "warning",
            "substatus": "ongoing",
            "service": "crate-api",
            "users_24h": 0,
            "events_24h": 2,
            "sentry_priority": "low",
        }
    )
    assert rows["1"]["digest_event_id"] == f"{1:032x}"
    assert len(rows["1"]["digest_hash"]) == 64
    assert len(rows["1"]["group_key"]) == 16
    digest = rows["1"]["digest"]
    assert digest["exceptions"][0]["type"] == "IntegrityError"
    assert "never-in-digest" not in json.dumps(digest)
    assert "/music/<path>" in digest["exceptions"][0]["value"]
    state = _state()
    assert state["status"] == "ok"
    assert state["counts"] == result["counts"]
    assert state["last_success_at"] == state["finished_at"]
    assert state["truncated"] == {"full": False, "recent": False}


def test_second_pass_keeps_service_and_skips_unchanged_events(pg_db):
    configure()
    fake = _fake_with(raw_issue(1, level="fatal"))
    _sync(fake)
    before = _rows()["1"]
    fake.requests.clear()

    result = _sync(fake)

    after = _rows()["1"]
    assert result["counts"]["digests_fetched"] == 0
    assert fake.latest_event_ids() == []
    # The refresh scores with the service the latest event gave, not the project.
    assert after["service"] == "api"
    assert after["crate_score"] == before["crate_score"]
    assert after["digest_hash"] == before["digest_hash"]


def test_changed_last_seen_refetches_the_latest_event(pg_db):
    configure()
    fake = _fake_with(raw_issue(1))
    _sync(fake)
    fake.full = [raw_issue(1, lastSeen="2026-11-04T09:00:00Z")]
    fake.events["1"] = raw_event(1, service="worker-fast", exception="KeyError")
    fake.requests.clear()

    result = _sync(fake)

    assert fake.latest_event_ids() == ["1"]
    assert result["counts"]["digests_fetched"] == 1
    row = _rows()["1"]
    assert row["service"] == "worker-fast"
    assert row["digest"]["exceptions"][0]["type"] == "KeyError"


def test_users_24h_from_recent_listing(pg_db):
    configure()
    fake = _fake_with(
        raw_issue(1, userCount=9),
        raw_issue(2, userCount=4),
        recent=[raw_issue(1, userCount=3), raw_issue(3, userCount=2, count="5")],
    )
    fake.events["3"] = raw_event(3)

    _sync(fake)

    rows = _rows()
    # 90-day user counts never stand in for the day's users.
    assert rows["1"]["users_24h"] == 3
    assert rows["2"]["users_24h"] == 0
    # Only in the 24 h listing (the full one was cut short): kept, it is active.
    assert rows["3"]["users_24h"] == 2


def test_event_fetch_cap_prioritises_score(pg_db):
    from crate.worker_handlers.error_inbox import MAX_EVENT_FETCHES

    configure()
    loud = [raw_issue(index, level="fatal", priority="high") for index in range(1, 26)]
    quiet = [raw_issue(index, level="info", priority="low") for index in range(26, 31)]
    # Listed quiet first: the order of the listing must not decide.
    fake = _fake_with(*quiet, *loud)

    first = _sync(fake)

    fetched = fake.latest_event_ids()
    assert len(fetched) == MAX_EVENT_FETCHES == 25
    assert set(fetched) == {str(index) for index in range(1, 26)}
    assert first["counts"]["digests_fetched"] == 25
    rows = _rows()
    assert all(rows[str(index)]["digest_hash"] is None for index in range(26, 31))

    fake.requests.clear()
    second = _sync(fake)

    # Issues left without a digest are picked up on the next pass.
    assert sorted(fake.latest_event_ids(), key=int) == [str(i) for i in range(26, 31)]
    assert second["counts"]["digests_fetched"] == 5


def test_missing_issue_marked_resolved(pg_db):
    configure()
    fake = _fake_with(raw_issue(1), raw_issue(2), raw_issue(3), raw_issue(4))
    _sync(fake)
    synced_before = _rows()["4"]["synced_at"]

    fake.full = [raw_issue(1)]
    fake.issues = {
        "2": raw_issue(2, status="resolved", substatus=None),
        "4": raw_issue(4, substatus="ongoing"),
    }
    fake.requests.clear()
    result = _sync(fake)

    rows = _rows()
    assert rows["2"]["status"] == "resolved"
    assert rows["2"]["closed_at"] is not None
    # Gone from Sentry (deleted or merged): closed so the purge removes it.
    assert rows["3"]["status"] == "resolved"
    assert rows["3"]["closed_at"] is not None
    # Still open in Sentry: refreshed, so it rotates behind the others next time.
    assert rows["4"]["status"] == "unresolved"
    assert rows["4"]["synced_at"] > synced_before
    assert rows["1"]["status"] == "unresolved"
    assert result["counts"]["status_refreshed"] == 3
    assert sorted(fake.issue_ids("GET")) == ["2", "3", "4"]


def test_status_refresh_is_capped(pg_db):
    from crate.worker_handlers.error_inbox import MAX_STATUS_REFRESHES

    configure()
    issues = [raw_issue(index) for index in range(1, 56)]
    fake = _fake_with(*issues, events=False)
    _sync(fake)
    fake.full = []
    fake.issues = {issue["id"]: {**issue, "status": "resolved"} for issue in issues}
    fake.requests.clear()

    result = _sync(fake)

    assert result["counts"]["status_refreshed"] == MAX_STATUS_REFRESHES == 50
    statuses = [row["status"] for row in _rows().values()]
    assert statuses.count("resolved") == 50
    assert statuses.count("unresolved") == 5


def test_truncation_recorded(pg_db, caplog):
    configure()
    fake = _fake_with(*(raw_issue(index) for index in range(1, 8)), events=False)
    fake.recent = [raw_issue(1)]
    fake.page_size = 1

    with caplog.at_level(logging.WARNING, logger="crate.worker_handlers.error_inbox"):
        result = _sync(fake)

    assert result["truncated"] == {"full": True, "recent": False}
    assert result["counts"]["listed"] == 5
    state = _state()
    assert state["truncated"] == {"full": True, "recent": False}
    assert state["pages"] == {"full": 5, "recent": 1}
    assert "truncated" in caplog.text


def _connection_refused(request: httpx.Request) -> httpx.Response:
    raise httpx.ConnectError("connection refused", request=request)


@pytest.mark.parametrize(
    "failure, code",
    [
        (_connection_refused, "SENTRY_UNAVAILABLE"),
        (lambda request: httpx.Response(503), "SENTRY_SERVER"),
        (
            # The 24 h listing fails after the full one succeeded: still no write.
            lambda request: (
                httpx.Response(502)
                if request.url.params.get("statsPeriod") == "24h"
                else None
            ),
            "SENTRY_SERVER",
        ),
    ],
)
def test_sentry_down_keeps_previous_rows(pg_db, failure, code):
    configure()
    fake = _fake_with(raw_issue(1), raw_issue(2))
    _sync(fake)
    before = _rows()
    first_state = _state()

    fake.full = [raw_issue(1, level="fatal"), raw_issue(9)]
    fake.fail = failure
    result = _sync(fake)

    assert result["status"] == "failed"
    assert result["error_code"] == code
    assert code in result["error"]
    # Sentry being down is shown on the page, not reported to Sentry.
    assert result["expected"] is True
    assert _rows() == before
    state = _state()
    assert state["status"] == "failed"
    assert state["error_code"] == code
    assert state["last_success_at"] == first_state["finished_at"]


def test_unexpected_sentry_response_is_still_reported(pg_db):
    # A listing that is not a list points at a Crate/Sentry mismatch, not at the
    # settings, so the worker keeps reporting it.
    configure()
    fake = _fake_with(raw_issue(1))
    fake.fail = lambda request: (
        httpx.Response(200, json={"unexpected": True})
        if request.url.path.endswith("/issues/")
        else None
    )

    result = _sync(fake)

    assert result["status"] == "failed"
    assert result["error_code"] == "SENTRY_INVALID_RESPONSE"
    assert result["expected"] is False


def test_auth_error_surfaces_in_runtime_state(pg_db, caplog):
    from crate.error_inbox.config import load_config
    from crate.worker_handlers.error_inbox import known_write_access

    configure()
    fake = _fake_with(raw_issue(1))
    _sync(fake)
    before = _rows()
    fake.fail = lambda request: httpx.Response(401, json={"detail": TOKEN})

    with caplog.at_level(logging.DEBUG):
        result = _sync(fake)

    assert result["status"] == "failed"
    assert result["error_code"] == "SENTRY_AUTH"
    assert result["expected"] is True
    assert _rows() == before
    state = _state()
    assert state["error_code"] == "SENTRY_AUTH"
    access = _state("error_inbox_access")
    assert (access["read"], access["write"]) == (False, False)
    assert access["error_code"] == "SENTRY_AUTH"
    config = load_config()
    assert config is not None
    assert known_write_access(config) is False
    for payload in (state, access, result):
        assert TOKEN not in json.dumps(payload, default=str)
    assert TOKEN not in caplog.text


def test_sync_records_scope_access(pg_db):
    from crate.error_inbox.config import load_config
    from crate.worker_handlers.error_inbox import known_write_access

    configure()
    fake = _fake_with(raw_issue(1))
    fake.scopes = ["org:read", "project:read", "event:read"]

    _sync(fake)

    access = _state("error_inbox_access")
    assert (access["read"], access["write"], access["source"]) == (True, False, "sync")
    config = load_config()
    assert config is not None
    assert known_write_access(config) is False


def test_event_errors_keep_the_listing_and_report_partial(pg_db):
    configure()
    fake = _fake_with(raw_issue(1), raw_issue(2))
    fake.fail = lambda request: (
        httpx.Response(429, headers={"Retry-After": "30"})
        if request.url.path.endswith("/events/latest/")
        else None
    )

    result = _sync(fake)

    assert result["status"] == "partial"
    assert result["error_code"] == "SENTRY_RATE_LIMITED"
    rows = _rows()
    assert sorted(rows) == ["1", "2"]
    assert all(row["digest_hash"] is None for row in rows.values())
    # Rate limited: the pass stops calling Sentry after the first refusal.
    assert len(fake.latest_event_ids()) == 1
    assert _state()["last_success_at"] is not None


def test_issue_without_events_is_skipped(pg_db):
    configure()
    fake = _fake_with(raw_issue(1), raw_issue(2))
    del fake.events["1"]

    result = _sync(fake)

    assert result["status"] == "ok"
    assert result["counts"]["digests_fetched"] == 1
    assert _rows()["1"]["digest_hash"] is None


def test_purges_closed_issues(pg_db):
    from crate.db.repositories.error_issues import upsert_issues

    configure()
    old = datetime.now(timezone.utc) - timedelta(days=45)
    upsert_issues(
        [
            {
                "external_id": "77",
                "short_id": "CRATE-API-77",
                "project_slug": "crate-api",
                "title": "Old",
                "level": "error",
                "status": "resolved",
            }
        ],
        synced_at=old,
    )
    fake = _fake_with(raw_issue(1))

    result = _sync(fake)

    assert result["counts"]["purged"] == 1
    assert sorted(_rows()) == ["1"]


def test_cancellation_and_budget_stop_sentry_calls(pg_db):
    configure()
    fake = _fake_with(raw_issue(1), raw_issue(2))

    cancelled = _sync(fake, cancelled=lambda: True)

    assert cancelled["status"] == "partial"
    assert fake.latest_event_ids() == []
    assert _state()["cancelled"] is True

    ticks = iter([0.0, 0.0, 1_000.0, 1_000.0, 1_000.0])
    fake.requests.clear()
    exhausted = _sync(fake, clock=lambda: next(ticks, 1_000.0))

    assert exhausted["status"] == "partial"
    assert exhausted["budget_exhausted"] is True
    assert len(fake.latest_event_ids()) == 1


def test_unexpected_error_is_recorded_and_raised(pg_db):
    configure()
    fake = _fake_with(raw_issue(1))

    def explode(request):
        raise RuntimeError("bug")

    fake.fail = explode

    with pytest.raises(RuntimeError):
        _sync(fake)

    state = _state()
    assert state["status"] == "failed"
    assert state["error_code"] == "ERROR_INBOX_SYNC_FAILED"


def test_missing_token_is_a_typed_failure(pg_db):
    from crate.error_inbox.config import save_config

    save_config({"organization": "ninja-development"})

    result = _sync(FakeSentry())

    assert result["status"] == "failed"
    assert result["error_code"] == "ERROR_TRACKING_TOKEN_MISSING"
    assert _state()["error_code"] == "ERROR_TRACKING_TOKEN_MISSING"

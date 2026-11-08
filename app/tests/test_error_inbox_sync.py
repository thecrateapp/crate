"""The Sentry sync pass against PostgreSQL and a fake Sentry (`httpx.MockTransport`)."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import text

from tests.error_inbox_fakes import (
    TOKEN,
    FakeSentry,
    configure,
    configure_ai,
    raw_event,
    raw_issue,
)


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
        "releases_fetched": 2,
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


# -- releases: the listing has none ------------------------------------------------


def _releases() -> dict[str, tuple[str | None, str | None]]:
    with _scope() as session:
        rows = session.execute(
            text("SELECT external_id, first_release, last_release FROM error_issues")
        ).all()
    return {row.external_id: (row.first_release, row.last_release) for row in rows}


def test_releases_from_the_latest_event_and_the_issue_detail(pg_db):
    configure()
    fake = _fake_with(raw_issue(1), raw_issue(2))
    # The latest event of issue 2 has no release: Sentry knows no first release.
    del fake.events["2"]["release"]

    result = _sync(fake)

    assert result["status"] == "ok"
    assert result["counts"]["releases_fetched"] == 1
    # One issue detail, only for the issue whose events carry a release.
    assert fake.issue_ids("GET") == ["1"]
    assert _releases() == {
        "1": ("crate-8ba478ac", "crate-4ba9e59a"),
        "2": (None, None),
    }

    # The next listings still have no releases: nothing is cleared or read again.
    fake.requests.clear()
    again = _sync(fake)

    assert again["counts"]["releases_fetched"] == 0
    assert fake.issue_ids("GET") == []
    assert _releases()["1"] == ("crate-8ba478ac", "crate-4ba9e59a")


def test_a_new_latest_event_moves_the_last_release(pg_db):
    configure()
    fake = _fake_with(raw_issue(1))
    _sync(fake)
    fake.full = [raw_issue(1, lastSeen="2026-11-04T09:00:00Z")]
    fake.events["1"] = {**raw_event(1), "release": {"version": "crate-77aa00bb"}}
    fake.requests.clear()

    _sync(fake)

    assert fake.latest_event_ids() == ["1"]
    assert fake.issue_ids("GET") == []
    assert _releases()["1"] == ("crate-8ba478ac", "crate-77aa00bb")


def test_rows_synced_before_the_fix_fill_on_the_next_pass(pg_db):
    configure()
    fake = _fake_with(*(raw_issue(index) for index in range(1, 21)))
    _sync(fake)
    # What production holds: digests stored, no release on any open issue.
    with _scope() as session:
        session.execute(
            text("UPDATE error_issues SET first_release = NULL, last_release = NULL")
        )
    fake.requests.clear()

    result = _sync(fake)

    # The stored digests are not downloaded again; one detail per issue fills both.
    assert fake.latest_event_ids() == []
    assert len(fake.issue_ids("GET")) == 20
    assert result["counts"]["releases_fetched"] == 20
    assert set(_releases().values()) == {("crate-8ba478ac", "crate-4ba9e59a")}


def test_release_lookups_are_capped_highest_score_first(pg_db, monkeypatch):
    from crate.worker_handlers import error_inbox

    assert error_inbox.MAX_RELEASE_LOOKUPS == 25
    monkeypatch.setattr(error_inbox, "MAX_RELEASE_LOOKUPS", 2)
    configure()
    levels = {1: "info", 2: "fatal", 3: "warning", 4: "error", 5: "info"}
    fake = _fake_with(
        *(raw_issue(index, level=level) for index, level in levels.items())
    )

    first = _sync(fake)

    assert first["counts"]["releases_fetched"] == 2
    assert fake.issue_ids("GET") == ["2", "4"]
    releases = _releases()
    assert {key for key, value in releases.items() if value[0]} == {"2", "4"}
    # The latest event already gave every issue its last release.
    assert {value[1] for value in releases.values()} == {"crate-4ba9e59a"}

    passes = []
    for _ in range(3):
        fake.requests.clear()
        _sync(fake)
        passes.append(fake.issue_ids("GET"))

    # Equal scores and last seen: by issue id.
    assert passes == [["3", "1"], ["5"], []]
    assert all(value[0] == "crate-8ba478ac" for value in _releases().values())


def test_release_lookups_share_the_status_check_budget(pg_db, monkeypatch):
    from crate.db.repositories.error_issues import upsert_issues
    from crate.error_inbox.sentry_client import normalize_issue
    from crate.worker_handlers import error_inbox

    monkeypatch.setattr(error_inbox, "MAX_STATUS_REFRESHES", 3)
    configure()
    # Open in Crate, gone from the listing: each needs a status check.
    upsert_issues([normalize_issue(raw_issue(index)) for index in (7, 8, 9)])
    fake = _fake_with(raw_issue(1), raw_issue(2))
    fake.issues = {str(index): raw_issue(index) for index in (7, 8, 9)}

    result = _sync(fake)

    # Release lookups first, then one status check with what is left of the 3.
    assert fake.issue_ids("GET") == ["1", "2", "7"]
    assert result["counts"]["releases_fetched"] == 2
    assert result["counts"]["status_refreshed"] == 1


def test_a_detail_without_a_first_release_is_read_once(pg_db):
    configure()
    fake = _fake_with(raw_issue(1), raw_issue(2), raw_issue(3))
    fake.issues = {"1": raw_issue(1, firstRelease=None, lastRelease=None)}
    fake.fail = lambda request: (
        httpx.Response(404, json={"detail": "not found"})
        if request.method == "GET" and request.url.path.endswith("/issues/2/")
        else None
    )

    first = _sync(fake)

    assert first["status"] == "ok"
    assert sorted(fake.issue_ids("GET")) == ["1", "2", "3"]
    assert first["counts"]["releases_fetched"] == 2
    assert _state("error_inbox_release_checks")["external_ids"] == ["1", "2"]
    assert _releases() == {
        "1": (None, "crate-4ba9e59a"),
        "2": (None, "crate-4ba9e59a"),
        "3": ("crate-8ba478ac", "crate-4ba9e59a"),
    }

    fake.requests.clear()
    _sync(fake)
    assert fake.issue_ids("GET") == []

    # An issue that leaves the listing leaves the record too.
    fake.full = [raw_issue(2), raw_issue(3)]
    fake.fail = None
    fake.issues = {}
    _sync(fake)
    assert _state("error_inbox_release_checks")["external_ids"] == ["2"]


def test_a_refused_release_lookup_stops_the_pass_and_retries_later(pg_db):
    configure()
    fake = _fake_with(raw_issue(1), raw_issue(2))
    fake.fail = lambda request: (
        httpx.Response(429, headers={"Retry-After": "30"})
        if request.method == "GET" and request.url.path.endswith(("/1/", "/2/"))
        else None
    )

    result = _sync(fake)

    assert result["status"] == "partial"
    assert result["error_code"] == "SENTRY_RATE_LIMITED"
    assert len(fake.issue_ids("GET")) == 1
    assert {value[0] for value in _releases().values()} == {None}
    assert _state("error_inbox_release_checks") is None

    fake.fail = None
    fake.requests.clear()
    assert _sync(fake)["counts"]["releases_fetched"] == 2
    assert {value[0] for value in _releases().values()} == {"crate-8ba478ac"}


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


# -- automatic triage (E2.PR2, design §7.1) -----------------------------------------


def _queued_triages() -> dict[str, dict]:
    """Queued triage tasks by the external id of their issue."""
    with _scope() as session:
        rows = session.execute(
            text(
                """
                SELECT i.external_id, t.params_json, t.origin, t.actor_user_id,
                       t.status
                FROM tasks t
                JOIN error_issues i ON i.id = CAST(t.params_json ->> 'issue_id' AS uuid)
                WHERE t.type = 'triage_error_issue'
                """
            )
        ).mappings()
        found = {}
        for row in rows:
            task = dict(row)
            if isinstance(task["params_json"], str):
                task["params_json"] = json.loads(task["params_json"])
            found[row["external_id"]] = task
        return found


def _age_automatic_triage(hours: int = 25) -> None:
    with _scope() as session:
        session.execute(
            text(
                "UPDATE error_issues SET auto_triage_at = auto_triage_at - "
                "make_interval(hours => :hours) WHERE auto_triage_at IS NOT NULL"
            ),
            {"hours": hours},
        )


def _automatic(monkeypatch, daily_max: int = 30) -> None:
    configure(triage={"automatic": True, "daily_max": daily_max})
    configure_ai(monkeypatch, ("ops.error.triage",))


def test_enqueues_triage_for_new_regressed_escalating(pg_db, monkeypatch):
    _automatic(monkeypatch)
    fake = _fake_with(
        raw_issue(1, substatus="new"),
        raw_issue(2, substatus="regressed"),
        raw_issue(3, substatus="escalating"),
        # Never triaged and steady: left to Triage backlog.
        raw_issue(4, substatus="ongoing"),
    )

    result = _sync(fake)

    assert result["status"] == "ok"
    assert result["triage"] == {
        "status": "queued",
        "queued": 3,
        "queued_24h": 3,
        "daily_max": 30,
        "deduplicated": 0,
    }
    assert _state()["triage"] == result["triage"]
    queued = _queued_triages()
    assert set(queued) == {"1", "2", "3"}
    rows = _rows()
    for external_id, task in queued.items():
        params = task["params_json"]
        assert params["issue_id"] == rows[external_id]["id"]
        assert params["digest_hash"] == rows[external_id]["digest_hash"]
        assert params["origin"] == "automatic"
        assert params["actor_user_id"] is None
        assert params["ai_acceptance"]["action_id"] == "ops.error.triage"
        assert (task["origin"], task["actor_user_id"]) == ("worker", None)
    with _scope() as session:
        marked = dict(
            session.execute(
                text("SELECT external_id, auto_triage_hash FROM error_issues")
            ).all()
        )
    assert marked == {
        "1": rows["1"]["digest_hash"],
        "2": rows["2"]["digest_hash"],
        "3": rows["3"]["digest_hash"],
        "4": None,
    }

    # The next pass finds nothing new to queue.
    again = _sync(fake)
    assert again["triage"]["status"] == "idle"
    assert again["triage"]["queued"] == 0
    assert len(_queued_triages()) == 3


def test_respects_daily_cap_by_score(pg_db, monkeypatch):
    _automatic(monkeypatch, daily_max=2)
    fake = _fake_with(
        raw_issue(1, substatus="new", level="warning"),
        raw_issue(2, substatus="new", level="fatal"),
        raw_issue(3, substatus="new", level="error"),
        raw_issue(4, substatus="new", level="info"),
    )

    first = _sync(fake)

    assert set(_queued_triages()) == {"2", "3"}
    assert (first["triage"]["queued"], first["triage"]["queued_24h"]) == (2, 2)

    capped = _sync(fake)
    assert capped["triage"] == {
        "status": "cap_reached",
        "queued": 0,
        "queued_24h": 2,
        "daily_max": 2,
    }
    assert set(_queued_triages()) == {"2", "3"}

    # A day later the cap has room again for the next ones by score.
    _age_automatic_triage()
    later = _sync(fake)
    assert later["triage"]["queued"] == 2
    assert set(_queued_triages()) == {"1", "2", "3", "4"}


def test_no_triage_when_automatic_off(pg_db, monkeypatch):
    configure()
    configure_ai(monkeypatch, ("ops.error.triage",))
    fake = _fake_with(raw_issue(1, substatus="new"))

    result = _sync(fake)

    assert result["triage"] == {"status": "off", "queued": 0}
    assert _queued_triages() == {}


def test_no_triage_without_a_model_until_one_is_bound(pg_db, monkeypatch):
    configure(triage={"automatic": True})
    configure_ai(monkeypatch, actions=())
    fake = _fake_with(raw_issue(1, substatus="new"))

    result = _sync(fake)

    assert result["status"] == "ok"
    assert result["triage"]["status"] == "unavailable"
    assert result["triage"]["error_code"] == "AI_ACTION_DISABLED"
    assert _queued_triages() == {}
    # Nothing was marked: the issue is queued once a model is bound.
    assert _rows()["1"]["digest_hash"]
    with _scope() as session:
        assert (
            session.execute(text("SELECT auto_triage_hash FROM error_issues")).scalar()
            is None
        )


def test_failed_automatic_triage_is_not_requeued(pg_db, monkeypatch):
    _automatic(monkeypatch)
    fake = _fake_with(raw_issue(1, substatus="new"))
    _sync(fake)
    with _scope() as session:
        session.execute(
            text("UPDATE tasks SET status = 'failed' WHERE type = 'triage_error_issue'")
        )

    # Neither the next pass nor the next day sends the same digest again.
    assert _sync(fake)["triage"]["queued"] == 0
    _age_automatic_triage()
    assert _sync(fake)["triage"]["queued"] == 0
    assert len(_queued_triages()) == 1


def test_digest_change_retriages(pg_db, monkeypatch):
    from crate.db.repositories.error_issues import save_triage

    _automatic(monkeypatch)
    fake = _fake_with(
        # Steady, triaged by hand before automatic triage was on.
        raw_issue(1, substatus="ongoing"),
        # New: queued at once.
        raw_issue(2, substatus="new"),
    )
    _sync(fake)
    first = _rows()
    assert set(_queued_triages()) == {"2"}
    save_triage(
        first["1"]["id"],
        kind="triage",
        digest_hash=first["1"]["digest_hash"],
        classification="bug",
        severity="medium",
        summary="Duplicate key in the library pipeline.",
        confidence=0.7,
    )

    # Both issues raise something else now: a new digest.
    fake.full = [
        raw_issue(1, substatus="ongoing", lastSeen="2026-11-05T08:00:00Z"),
        raw_issue(2, substatus="ongoing", lastSeen="2026-11-05T08:00:00Z"),
    ]
    fake.events = {
        "1": raw_event(1, exception="KeyError", function="load"),
        "2": raw_event(2, exception="KeyError", function="load"),
    }
    changed = _sync(fake)
    rows = _rows()

    assert rows["1"]["digest_hash"] != first["1"]["digest_hash"]
    # Issue 1 was triaged for its old digest: the new one is triaged at once.
    queued = _queued_triages()
    assert set(queued) == {"1", "2"}
    assert queued["1"]["params_json"]["digest_hash"] == rows["1"]["digest_hash"]
    assert changed["triage"]["queued"] == 1
    # Issue 2 was queued less than a day ago: its new digest waits for the window.
    assert queued["2"]["params_json"]["digest_hash"] == first["2"]["digest_hash"]

    _age_automatic_triage()
    _sync(fake)
    with _scope() as session:
        hashes = {
            row.digest_hash
            for row in session.execute(
                text(
                    """
                    SELECT i.external_id, t.params_json ->> 'digest_hash' AS digest_hash
                    FROM tasks t
                    JOIN error_issues i
                      ON i.id = CAST(t.params_json ->> 'issue_id' AS uuid)
                    WHERE t.type = 'triage_error_issue' AND i.external_id = '2'
                    """
                )
            )
        }
    assert hashes == {first["2"]["digest_hash"], rows["2"]["digest_hash"]}


def test_a_triage_queue_failure_does_not_fail_the_sync(pg_db, monkeypatch, caplog):
    _automatic(monkeypatch)

    def broken(*args, **kwargs):
        raise RuntimeError("synthetic queue failure")

    monkeypatch.setattr("crate.worker_handlers.error_inbox.queue_triages", broken)

    with caplog.at_level(logging.ERROR, logger="crate.worker_handlers.error_inbox"):
        result = _sync(_fake_with(raw_issue(1, substatus="new")))

    assert result["status"] == "ok"
    assert result["triage"] == {
        "status": "failed",
        "queued": 0,
        "error_code": "ERROR_TRIAGE_FAILED",
    }
    assert "Could not queue automatic error triage" in caplog.text

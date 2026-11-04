"""Error inbox admin API: capabilities, filters, status tasks and the connection.

Reads come from PostgreSQL; writes enqueue tasks. No handler may reach Sentry.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from tests.error_inbox_fakes import ORGANIZATION, TOKEN, configure

NOW = datetime.now(timezone.utc).replace(microsecond=0)
VIEW = "ops.errors.view"
MANAGE = "ops.errors.manage"
RUNTIME = "ops.runtime.manage"
ALL = frozenset({VIEW, MANAGE, RUNTIME})
BASE = "/api/admin/errors"


# -- fixtures -------------------------------------------------------------------


@pytest.fixture
def api(pg_db, test_app, monkeypatch):
    """The test client, acting as user 1 with only the capabilities in `caps`."""
    session = {"caps": set(ALL), "user": True}

    async def resolve_user(self, request):
        if not session["user"]:
            return None
        return {"id": _user_id(), "role": "user", "username": "errors"}

    def has_capability(user, capability):
        return bool(user) and capability in session["caps"]

    monkeypatch.setattr("crate.api.auth.AuthMiddleware.resolve_user", resolve_user)
    monkeypatch.setattr("crate.api.permissions.has_capability", has_capability)
    test_app.session = session
    return test_app


def _as(client, *caps: str) -> None:
    client.session["caps"] = set(caps)


def _scope():
    from crate.db.tx import transaction_scope

    return transaction_scope()


def _user_id() -> int:
    with _scope() as session:
        return session.execute(text("SELECT min(id) FROM users")).scalar_one()


def _row(external_id, **overrides):
    row = {
        "external_id": str(external_id),
        "short_id": f"CRATE-API-{external_id}",
        "project_slug": "crate-api",
        "service": "api",
        "title": f"IntegrityError number {external_id}",
        "culprit": "library_pipeline",
        "level": "error",
        "status": "unresolved",
        "substatus": "ongoing",
        "sentry_priority": "high",
        "issue_category": "error",
        "events_total": 10,
        "users_total": 1,
        "events_24h": 2,
        "users_24h": 1,
        "first_seen": NOW - timedelta(days=3),
        "last_seen": NOW - timedelta(hours=1),
        "first_release": "crate-a",
        "last_release": "crate-b",
        "permalink": f"https://{ORGANIZATION}.sentry.io/issues/{external_id}/",
        "crate_score": 40,
    }
    row.update(overrides)
    return row


def seed_issues(*rows) -> dict[str, str]:
    """Upsert rows and return their ids by external id."""
    from crate.db.repositories.error_issues import upsert_issues

    upsert_issues(list(rows) or [_row(1)], synced_at=NOW)
    with _scope() as session:
        found = session.execute(
            text("SELECT external_id, id::text AS id FROM error_issues")
        ).all()
    return {row.external_id: row.id for row in found}


def set_digest(issue_id: str, digest_hash: str = "current") -> None:
    from crate.db.repositories.error_issues import set_digest as store

    store(
        issue_id,
        digest={
            "v": 1,
            "event_id": "e" * 32,
            "platform": "python",
            "release": "crate-b",
            "message": None,
            "exceptions": [
                {
                    "type": "IntegrityError",
                    "value": "duplicate key",
                    "module": "sqlalchemy.exc",
                    "mechanism": "logging",
                    "handled": True,
                }
            ],
            "frames": [
                {
                    "module": "crate.library_sync",
                    "function": "run",
                    "filename": "crate/library_sync.py",
                    "lineno": 12,
                    "context": [[11, "def run():"], [12, "    raise Boom()"]],
                }
            ],
            "tags": {"service": "api", "environment": "production"},
            "breadcrumbs": [{"category": "query", "level": "info", "message": "x"}],
            "truncated": False,
        },
        digest_event_id="e" * 32,
        digest_hash=digest_hash,
        group_key="g" * 16,
    )


def insert_triage(issue_id: str, digest_hash: str = "current", **values) -> None:
    params = {
        "issue_id": issue_id,
        "digest_hash": digest_hash,
        "classification": "infrastructure",
        "severity": "critical",
        "confidence": 0.9,
        "summary": "Database restarted during the sync",
        **values,
    }
    with _scope() as session:
        session.execute(
            text(
                """
                INSERT INTO error_issue_triage
                    (issue_id, kind, digest_hash, classification, severity, summary,
                     suspected_frames, confidence)
                VALUES (CAST(:issue_id AS uuid), 'triage', :digest_hash,
                        :classification, :severity, :summary, '[0]'::jsonb, :confidence)
                """
            ),
            params,
        )


def record_access(*, write: bool | None, credential: str | None = None) -> None:
    from crate.db.ops_runtime import set_ops_runtime_state
    from crate.error_inbox.config import load_config
    from crate.error_inbox.state import ACCESS_STATE_KEY, credential_fingerprint

    config = load_config()
    set_ops_runtime_state(
        ACCESS_STATE_KEY,
        {
            "version": 1,
            "read": True,
            "write": write,
            "credential": credential
            or (credential_fingerprint(config) if config else None),
            "source": "connection_test",
            "checked_at": NOW.isoformat(),
            "error_code": None,
        },
    )


def record_sync(**overrides) -> dict:
    from crate.db.ops_runtime import set_ops_runtime_state
    from crate.error_inbox.state import SYNC_STATE_KEY

    state = {
        "version": 1,
        "status": "ok",
        "started_at": (NOW - timedelta(seconds=30)).isoformat(),
        "finished_at": NOW.isoformat(),
        "last_success_at": NOW.isoformat(),
        "error_code": None,
        "counts": {"listed": 5, "upserted": 5},
        "pages": {"full": 1, "recent": 1},
        "truncated": {"full": False, "recent": True},
        "budget_exhausted": False,
        "cancelled": False,
        **overrides,
    }
    set_ops_runtime_state(SYNC_STATE_KEY, state)
    return state


def _task(task_id: str) -> dict:
    with _scope() as session:
        row = (
            session.execute(
                text(
                    "SELECT type, params_json, actor_user_id FROM tasks WHERE id = :id"
                ),
                {"id": task_id},
            )
            .mappings()
            .one()
        )
    params = row["params_json"]
    return {
        "type": row["type"],
        "params": json.loads(params) if isinstance(params, str) else params,
        "actor_user_id": row["actor_user_id"],
    }


def _task_count() -> int:
    with _scope() as session:
        return session.execute(text("SELECT count(*) FROM tasks")).scalar_one()


def _code(response) -> str | None:
    return response.headers.get("X-Crate-Error")


# -- capabilities ---------------------------------------------------------------


def test_list_requires_view(api):
    ids = seed_issues(_row(1))
    reads = (BASE, f"{BASE}/summary", f"{BASE}/{ids['1']}")

    _as(api, MANAGE, RUNTIME)
    for path in reads:
        assert api.get(path).status_code == 403, path

    api.session["user"] = False
    for path in reads:
        assert api.get(path).status_code == 401, path

    api.session["user"] = True
    _as(api, VIEW)
    for path in reads:
        assert api.get(path).status_code == 200, path


def test_status_requires_manage_and_enqueues(api):
    configure()
    ids = seed_issues(_row(1))
    issue_id = ids["1"]

    _as(api, VIEW, RUNTIME)
    denied = api.post(f"{BASE}/{issue_id}/status", json={"status": "resolved"})
    assert denied.status_code == 403
    assert _task_count() == 0

    _as(api, MANAGE)
    resolve = api.post(
        f"{BASE}/{issue_id}/status",
        json={"status": "resolved", "in_next_release": True},
    )
    assert resolve.status_code == 202, resolve.text
    assert resolve.json() == {"task_id": resolve.json()["task_id"]}
    task = _task(resolve.json()["task_id"])
    assert task == {
        "type": "update_error_issue_status",
        "params": {
            "issue_id": issue_id,
            "status": "resolved",
            "in_next_release": True,
            "actor_id": _user_id(),
        },
        "actor_user_id": _user_id(),
    }

    ignore = api.post(
        f"{BASE}/{issue_id}/status",
        json={"status": "ignored", "substatus": "archived_until_escalating"},
    )
    assert ignore.status_code == 202
    assert _task(ignore.json()["task_id"])["params"] == {
        "issue_id": issue_id,
        "status": "ignored",
        "substatus": "archived_until_escalating",
        "actor_id": _user_id(),
    }

    reopen = api.post(f"{BASE}/{issue_id}/status", json={"status": "unresolved"})
    assert reopen.status_code == 202
    assert _task(reopen.json()["task_id"])["params"] == {
        "issue_id": issue_id,
        "status": "unresolved",
        "actor_id": _user_id(),
    }

    # A repeated click while the first change is pending returns the same task.
    again = api.post(f"{BASE}/{issue_id}/status", json={"status": "unresolved"})
    assert again.json()["task_id"] == reopen.json()["task_id"]
    assert _task_count() == 3


def test_status_refused_when_write_scope_missing(api):
    configure()
    issue_id = seed_issues(_row(1))["1"]

    record_access(write=False)
    refused = api.post(f"{BASE}/{issue_id}/status", json={"status": "resolved"})
    assert refused.status_code == 409
    assert _code(refused) == "ERROR_TRACKING_WRITE_SCOPE_MISSING"
    assert _task_count() == 0
    detail = api.get(f"{BASE}/{issue_id}").json()
    assert detail["write_access"] is False

    # Access recorded for another token says nothing about the current one.
    record_access(write=False, credential="0" * 16)
    assert api.get(f"{BASE}/{issue_id}").json()["write_access"] is None
    accepted = api.post(f"{BASE}/{issue_id}/status", json={"status": "resolved"})
    assert accepted.status_code == 202

    record_access(write=True)
    assert api.get(f"{BASE}/{issue_id}").json()["write_access"] is True


def test_status_needs_configuration_an_issue_and_a_valid_body(api):
    issue_id = seed_issues(_row(1))["1"]

    unconfigured = api.post(f"{BASE}/{issue_id}/status", json={"status": "resolved"})
    assert unconfigured.status_code == 409
    assert _code(unconfigured) == "ERROR_TRACKING_NOT_CONFIGURED"

    configure()
    for missing in ("00000000-0000-0000-0000-000000000000", "not-a-uuid"):
        response = api.post(f"{BASE}/{missing}/status", json={"status": "resolved"})
        assert response.status_code == 404
        assert _code(response) == "ERROR_ISSUE_NOT_FOUND"
        assert "not found" in response.text

    for body in (
        {"status": "deleted"},
        {"status": "ignored", "in_next_release": True},
        {"status": "ignored", "substatus": "forever-and-ever"},
        {"status": "resolved", "actor_id": 99},
        {},
    ):
        response = api.post(f"{BASE}/{issue_id}/status", json=body)
        assert response.status_code == 422, body
        assert _code(response) == "ERROR_INBOX_INVALID_REQUEST"
    assert _task_count() == 0


# -- reads ----------------------------------------------------------------------


def test_list_filters_and_cursor(api):
    ids = seed_issues(
        _row(1, service="readplane", crate_score=80),
        _row(2, service="api", crate_score=20),
        _row(3, service="api", crate_score=30, last_release="crate-c"),
        _row(4, service="api", crate_score=90, status="resolved"),
    )
    set_digest(ids["2"])
    insert_triage(ids["2"], classification="infrastructure", severity="critical")

    def listed(**params):
        response = api.get(BASE, params=params)
        assert response.status_code == 200, response.text
        return [item["id"] for item in response.json()["items"]]

    # Critical lane first: a score of 80, then a confident critical triage.
    assert listed() == [ids["1"], ids["2"], ids["3"]]
    assert listed(lane="critical") == [ids["1"], ids["2"]]
    assert listed(service="api") == [ids["2"], ids["3"]]
    assert listed(status="resolved") == [ids["4"]]
    assert len(listed(status="all")) == 4
    assert listed(classification="infrastructure") == [ids["2"]]
    assert listed(release="crate-c") == [ids["3"]]
    assert listed(service="") == [ids["1"], ids["2"], ids["3"]]

    first = api.get(BASE, params={"limit": 2}).json()
    second = api.get(BASE, params={"limit": 2, "cursor": first["next_cursor"]}).json()
    assert [item["id"] for item in first["items"]] == [ids["1"], ids["2"]]
    assert [item["id"] for item in second["items"]] == [ids["3"]]
    assert second["next_cursor"] is None

    item = first["items"][1]
    assert item["critical"] is True
    assert item["classification"] == "infrastructure"
    assert item["severity"] == "critical"
    assert item["group_key"] == "g" * 16
    assert item["permalink"].startswith("https://")
    assert datetime.fromisoformat(item["synced_at"]).tzinfo is not None


@pytest.mark.parametrize(
    "params",
    [
        {"status": "open"},
        {"lane": "urgent"},
        {"classification": "flaky"},
        {"limit": 0},
        {"limit": 201},
        {"cursor": "abc"},
        {"cursor": "9999999"},
        {"service": "s" * 101},
    ],
)
def test_list_rejects_invalid_filters(api, params):
    response = api.get(BASE, params=params)

    assert response.status_code == 400
    assert _code(response) == "ERROR_INBOX_INVALID_FILTER"


def test_detail_has_digest_triage_and_404s(api):
    ids = seed_issues(_row(1))
    set_digest(ids["1"])
    insert_triage(ids["1"])

    detail = api.get(f"{BASE}/{ids['1']}")

    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert body["provider"] == "sentry"
    assert body["external_id"] == "1"
    assert body["digest"]["frames"][0]["context"] == [
        [11, "def run():"],
        [12, "    raise Boom()"],
    ]
    assert body["digest"]["exceptions"][0]["type"] == "IntegrityError"
    assert body["digest_hash"] == "current"
    assert [triage["summary"] for triage in body["triages"]] == [
        "Database restarted during the sync"
    ]
    assert body["triages"][0]["suspected_frames"] == [0]
    assert body["write_access"] is None

    for missing in ("00000000-0000-0000-0000-000000000000", "CRATE-API-1"):
        response = api.get(f"{BASE}/{missing}")
        assert response.status_code == 404
        assert _code(response) == "ERROR_ISSUE_NOT_FOUND"
        assert "not found" in response.text


def test_summary_reports_counts_configuration_and_sync(api):
    ids = seed_issues(_row(1, crate_score=85), _row(2, first_seen=NOW))

    unconfigured = api.get(f"{BASE}/summary").json()
    assert unconfigured["configured"] is False
    assert unconfigured["sync"] is None

    configure()
    record_sync(status="partial", error_code="SENTRY_UNAVAILABLE")
    body = api.get(f"{BASE}/summary").json()

    assert body["configured"] is True
    assert (body["open"], body["critical_open"], body["new_24h"]) == (2, 1, 1)
    assert body["top_critical"] == [
        {
            "id": ids["1"],
            "short_id": "CRATE-API-1",
            "title": "IntegrityError number 1",
            "service": "api",
            "crate_score": 85,
        }
    ]
    assert body["services"][0]["service"] == "api"
    assert body["sync"]["status"] == "partial"
    assert body["sync"]["error_code"] == "SENTRY_UNAVAILABLE"
    assert body["sync"]["truncated"] == {"full": False, "recent": True}
    assert body["sync"]["counts"] == {"listed": 5, "upserted": 5}
    assert "pages" not in body["sync"]


# -- connection -------------------------------------------------------------------


def test_connection_requires_runtime_manage(api):
    _as(api, VIEW, MANAGE)
    assert api.get(f"{BASE}/connection").status_code == 403
    assert (
        api.put(
            f"{BASE}/connection", json={"organization": ORGANIZATION, "token": TOKEN}
        ).status_code
        == 403
    )
    assert api.post(f"{BASE}/connection/test").status_code == 403

    _as(api, RUNTIME)
    assert api.get(f"{BASE}/connection").status_code == 200
    saved = api.put(
        f"{BASE}/connection", json={"organization": ORGANIZATION, "token": TOKEN}
    )
    assert saved.status_code == 200, saved.text
    assert api.post(f"{BASE}/connection/test").status_code == 202


def test_connection_defaults_when_unset(api):
    response = api.get(f"{BASE}/connection")

    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert response.json() == {
        "configured": False,
        "provider": "sentry",
        "base_url": "https://sentry.io",
        "organization": None,
        "projects": [],
        "environments": [],
        "has_token": False,
        "access": None,
        "sync": None,
    }


def test_token_never_returned(api):
    ids = seed_issues(_row(1))
    payload = {
        "base_url": "https://de.sentry.io",
        "organization": ORGANIZATION,
        "projects": ["crate-api", "crate-workers"],
        "environments": ["production"],
        "token": TOKEN,
    }
    bodies = []

    saved = api.put(f"{BASE}/connection", json=payload)
    assert saved.status_code == 200, saved.text
    bodies.append(saved.text)
    assert saved.json()["has_token"] is True
    assert saved.json()["configured"] is True
    assert saved.json()["base_url"] == "https://de.sentry.io"
    record_access(write=True)
    record_sync()

    # A rejected body that carries the token must not echo it back.
    for invalid in (
        {**payload, "projects": "crate-api"},
        {**payload, "organization": None},
        {**payload, "base_url": "http://sentry.example.com"},
    ):
        rejected = api.put(f"{BASE}/connection", json=invalid)
        assert rejected.status_code == 422
        bodies.append(rejected.text)
        bodies.append(json.dumps(dict(rejected.headers)))

    # Omitted, null and blank tokens keep the stored one.
    for kept in ({}, {"token": None}, {"token": "  "}):
        response = api.put(
            f"{BASE}/connection", json={"organization": ORGANIZATION, **kept}
        )
        assert response.status_code == 200, response.text
        assert response.json()["has_token"] is True
        assert response.json()["access"]["write"] is True
        bodies.append(response.text)

    for path in (
        f"{BASE}/connection",
        f"{BASE}/summary",
        BASE,
        f"{BASE}/{ids['1']}",
    ):
        response = api.get(path)
        assert response.status_code == 200
        bodies.append(response.text)
    bodies.append(api.post(f"{BASE}/connection/test").text)
    bodies.append(
        api.post(f"{BASE}/{ids['1']}/status", json={"status": "resolved"}).text
    )

    for body in bodies:
        assert TOKEN not in body
    with _scope() as session:
        stored = session.execute(
            text("SELECT value FROM settings WHERE key = 'error_tracking'")
        ).scalar_one()
        tasks = session.execute(text("SELECT params_json::text FROM tasks")).all()
    assert TOKEN not in stored
    assert all(TOKEN not in row[0] for row in tasks)

    from crate.error_inbox.config import load_config, load_sentry_token

    assert load_sentry_token(load_config()) == TOKEN


@pytest.mark.parametrize(
    "base_url,message",
    [
        ("http://sentry.example.com", "The Sentry URL must use HTTPS"),
        ("https://169.254.169.254", "Sentry host resolves to a disallowed address"),
        ("https://metadata.google.internal", "Metadata endpoints are not allowed"),
        ("https://sentry.io/api/0/", "The Sentry URL must be a bare https origin"),
    ],
)
def test_put_connection_rejects_invalid_base_url(api, base_url, message):
    response = api.put(
        f"{BASE}/connection",
        json={"base_url": base_url, "organization": ORGANIZATION, "token": TOKEN},
    )

    assert response.status_code == 422
    assert _code(response) == "ERROR_TRACKING_INVALID"
    assert response.json() == {"detail": message}
    assert api.get(f"{BASE}/connection").json()["configured"] is False


def test_put_connection_keeps_triage_and_fix_settings(api):
    configure(
        triage={"automatic": True, "daily_max": 12},
        fix={"repository": "thecrateapp/crate", "workflow": "error-autofix.yml"},
    )

    response = api.put(
        f"{BASE}/connection",
        json={"organization": ORGANIZATION, "projects": ["crate-api"]},
    )

    assert response.status_code == 200, response.text
    from crate.error_inbox.config import load_config

    config = load_config()
    assert config is not None
    assert config.projects == ("crate-api",)
    assert config.environments == ()
    assert config.triage.automatic is True and config.triage.daily_max == 12
    assert config.fix is not None and config.fix.repository == "thecrateapp/crate"


def test_connection_reports_access_and_sync(api):
    configure()
    sync = record_sync(status="failed", error_code="SENTRY_AUTH")
    record_access(write=False)

    body = api.get(f"{BASE}/connection").json()

    assert body["configured"] is True
    assert body["has_token"] is True
    assert body["organization"] == ORGANIZATION
    assert body["projects"] == ["crate-api", "crate-workers"]
    assert body["access"]["read"] is True
    assert body["access"]["write"] is False
    assert body["access"]["source"] == "connection_test"
    assert body["sync"]["status"] == "failed"
    assert body["sync"]["error_code"] == "SENTRY_AUTH"
    assert datetime.fromisoformat(
        body["sync"]["finished_at"]
    ) == datetime.fromisoformat(sync["finished_at"])

    # Saving a new token resets the access: the old token's check says nothing
    # about it, and the issue detail no longer trusts the old answer either.
    issue_id = seed_issues(_row(1))["1"]
    saved = api.put(
        f"{BASE}/connection",
        json={"organization": ORGANIZATION, "token": "sntrys_replacement_token"},
    )
    access = saved.json()["access"]
    assert access["read"] is None and access["write"] is None
    assert access["error_code"] is None
    assert access["source"] == "token_saved"
    assert access["checked_at"] is not None
    assert api.get(f"{BASE}/connection").json()["access"] == access
    assert api.get(f"{BASE}/{issue_id}").json()["write_access"] is None


def test_connection_shows_a_failed_connection_test(api):
    """The UI reloads the connection after a test: the failure must be there."""
    from crate.error_inbox.config import load_config
    from crate.error_inbox.state import record_access

    configure()
    config = load_config()
    assert config is not None
    record_access(
        config,
        source="connection_test",
        access={"read": False, "write": False},
        error_code="SENTRY_AUTH",
    )

    access = api.get(f"{BASE}/connection").json()["access"]

    assert access["read"] is False
    assert access["write"] is False
    assert access["error_code"] == "SENTRY_AUTH"
    assert access["source"] == "connection_test"
    assert datetime.fromisoformat(access["checked_at"]).tzinfo is not None

    # Replaced outside the admin (no reset): the stored check is still shown,
    # while status changes only trust access recorded for the current token.
    configure()
    issue_id = seed_issues(_row(1))["1"]
    assert api.get(f"{BASE}/connection").json()["access"]["error_code"] == (
        "SENTRY_AUTH"
    )
    assert api.get(f"{BASE}/{issue_id}").json()["write_access"] is None


def test_connection_test_enqueues_once(api):
    refused = api.post(f"{BASE}/connection/test")
    assert refused.status_code == 409
    assert _code(refused) == "ERROR_TRACKING_NOT_CONFIGURED"

    configure()
    first = api.post(f"{BASE}/connection/test")
    second = api.post(f"{BASE}/connection/test")

    assert first.status_code == 202, first.text
    assert second.json() == first.json()
    task = _task(first.json()["task_id"])
    assert task["type"] == "test_error_tracking_connection"
    assert task["params"] == {}
    assert task["actor_user_id"] == _user_id()


# -- EI-D3: no outbound calls -------------------------------------------------------


def test_no_outbound_http_in_handlers(api, monkeypatch):
    import httpx
    import requests
    import urllib.request

    calls = []

    def refuse(*args, **kwargs):
        calls.append(args[:1])
        raise AssertionError("An error inbox handler made an outbound call")

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", refuse)
    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", refuse)
    monkeypatch.setattr(requests.Session, "send", refuse)
    monkeypatch.setattr(urllib.request, "urlopen", refuse)
    monkeypatch.setattr("crate.error_inbox.sentry_client.SentryClient.__init__", refuse)

    issue_id = seed_issues(_row(1))["1"]
    set_digest(issue_id)
    responses = [
        api.put(
            f"{BASE}/connection",
            json={
                "base_url": "https://sentry.example.com",
                "organization": ORGANIZATION,
                "token": TOKEN,
            },
        ),
        api.get(f"{BASE}/connection"),
        api.post(f"{BASE}/connection/test"),
        api.get(BASE),
        api.get(f"{BASE}/summary"),
        api.get(f"{BASE}/{issue_id}"),
        api.post(f"{BASE}/{issue_id}/status", json={"status": "resolved"}),
    ]

    assert [response.status_code for response in responses] == [
        200,
        200,
        202,
        200,
        200,
        200,
        202,
    ]
    assert calls == []

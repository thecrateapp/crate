"""Status changes and the connection test against PostgreSQL and a fake Sentry."""

from __future__ import annotations

import json

import httpx
import pytest
from sqlalchemy import text

from tests.error_inbox_fakes import TOKEN, FakeSentry, configure, raw_issue


def _scope():
    from crate.db.tx import transaction_scope

    return transaction_scope()


def _seed_issue(external_id="1", **overrides) -> str:
    from crate.db.queries.error_issues import sync_state
    from crate.db.repositories.error_issues import upsert_issues
    from crate.error_inbox.sentry_client import normalize_issue

    upsert_issues([normalize_issue(raw_issue(external_id, **overrides))])
    return sync_state([external_id])[external_id]["id"]


def _row(issue_id: str) -> dict:
    with _scope() as session:
        return dict(
            session.execute(
                text(
                    "SELECT status, substatus, closed_at FROM error_issues "
                    "WHERE id = CAST(:id AS uuid)"
                ),
                {"id": issue_id},
            )
            .mappings()
            .one()
        )


def _audit_rows() -> list[dict]:
    with _scope() as session:
        rows = session.execute(
            text(
                "SELECT action, target_type, target_name, details_json, user_id, task_id "
                "FROM audit_log WHERE target_type = 'error_issue' ORDER BY id"
            )
        ).mappings()
        return [dict(row) for row in rows]


def _access_state():
    from crate.db.ops_runtime import get_ops_runtime_state

    return get_ops_runtime_state("error_inbox_access")


def _update(fake: FakeSentry, params: dict, task_id="task-status-1"):
    from crate.worker_handlers.error_inbox import update_issue_status

    return update_issue_status(task_id, params, client_factory=fake.factory)


def _check(fake: FakeSentry):
    from crate.worker_handlers.error_inbox import check_connection

    return check_connection(client_factory=fake.factory)


def _fake_for(issue_id="1") -> FakeSentry:
    fake = FakeSentry()
    fake.issues[issue_id] = raw_issue(issue_id)
    return fake


def test_resolve_calls_sentry_and_audits(pg_db):
    configure()
    issue_id = _seed_issue()
    fake = _fake_for()

    result = _update(fake, {"issue_id": issue_id, "status": "resolved", "actor_id": 7})

    assert result == {
        "status": "succeeded",
        "issue_id": issue_id,
        "short_id": "CRATE-API-1",
        "issue_status": "resolved",
        "substatus": None,
        "recorded": True,
    }
    puts = [request for request in fake.requests if request.method == "PUT"]
    assert len(puts) == 1
    assert puts[0].url.path == "/api/0/organizations/ninja-development/issues/1/"
    assert json.loads(puts[0].content) == {"status": "resolved"}
    row = _row(issue_id)
    assert row["status"] == "resolved"
    assert row["closed_at"] is not None
    [audit] = _audit_rows()
    assert audit["action"] == "error_issue.status.update"
    assert audit["target_name"] == "CRATE-API-1"
    assert audit["user_id"] == 7
    assert audit["task_id"] == "task-status-1"
    details = audit["details_json"]
    assert details["from"] == {"status": "unresolved", "substatus": "ongoing"}
    assert details["to"] == {"status": "resolved", "substatus": None}
    assert details["external_id"] == "1"
    # Closed metadata only: never the title or event text.
    assert "IntegrityError" not in json.dumps(details)


@pytest.mark.parametrize(
    "params, body, status, substatus",
    [
        (
            {"status": "ignored", "substatus": "archived_until_escalating"},
            {"status": "ignored", "substatus": "archived_until_escalating"},
            "ignored",
            "archived_until_escalating",
        ),
        (
            {"status": "resolved", "in_next_release": True},
            {"status": "resolvedInNextRelease"},
            "resolved",
            None,
        ),
        (
            {"status": "unresolved", "substatus": "ongoing"},
            {"status": "unresolved", "substatus": "ongoing"},
            "unresolved",
            "ongoing",
        ),
    ],
)
def test_status_payloads(pg_db, params, body, status, substatus):
    configure()
    issue_id = _seed_issue()
    fake = _fake_for()

    result = _update(fake, {"issue_id": issue_id, "actor_id": 1, **params})

    assert result["status"] == "succeeded"
    [put] = [request for request in fake.requests if request.method == "PUT"]
    assert json.loads(put.content) == body
    row = _row(issue_id)
    assert (row["status"], row["substatus"]) == (status, substatus)


def test_without_event_write_scope_is_refused(pg_db):
    configure()
    issue_id = _seed_issue()
    fake = _fake_for()
    fake.scopes = ["org:read", "project:read", "event:read"]
    assert _check(fake)["access"] == {"read": True, "write": False}
    fake.requests.clear()

    result = _update(fake, {"issue_id": issue_id, "status": "resolved", "actor_id": 1})

    assert result["status"] == "failed"
    assert result["error_code"] == "SENTRY_WRITE_SCOPE_MISSING"
    assert fake.requests == []
    assert _row(issue_id)["status"] == "unresolved"
    assert _audit_rows() == []


def test_access_of_a_replaced_token_is_not_trusted(pg_db):
    configure()
    issue_id = _seed_issue()
    fake = _fake_for()
    fake.scopes = ["event:read"]
    _check(fake)

    from crate.error_inbox.config import save_config

    save_config({"organization": "ninja-development"}, sentry_token="sntrys_rotated")
    result = _update(fake, {"issue_id": issue_id, "status": "resolved", "actor_id": 1})

    # The recorded refusal belonged to the previous token: Sentry decides now.
    assert result["status"] == "succeeded"
    assert any(request.method == "PUT" for request in fake.requests)


def test_sentry_refusal_changes_nothing_locally(pg_db):
    configure()
    issue_id = _seed_issue()
    fake = _fake_for()
    fake.fail = lambda request: (
        httpx.Response(403, json={"detail": TOKEN}) if request.method == "PUT" else None
    )

    result = _update(fake, {"issue_id": issue_id, "status": "ignored", "actor_id": 1})

    assert result["status"] == "failed"
    assert result["error_code"] == "SENTRY_FORBIDDEN"
    assert TOKEN not in json.dumps(result)
    assert _row(issue_id)["status"] == "unresolved"
    assert _audit_rows() == []


@pytest.mark.parametrize(
    "params",
    [
        {"status": "resolved"},
        {"status": "closed", "actor_id": 1},
        {"status": ["resolved"], "actor_id": 1},
        {"status": "ignored", "substatus": "whenever", "actor_id": 1},
        {"status": "ignored", "substatus": ["new"], "actor_id": 1},
        {"status": "ignored", "in_next_release": True, "actor_id": 1},
        {"status": "resolved", "actor_id": True},
        {"status": "resolved", "actor_id": "1"},
    ],
)
def test_invalid_requests_are_refused_before_sentry(params):
    from crate.worker_handlers.error_inbox import update_issue_status

    def factory(config, token):
        raise AssertionError("no client expected")

    result = update_issue_status(
        "task-x",
        {"issue_id": "00000000-0000-0000-0000-000000000001", **params},
        client_factory=factory,
    )

    assert result["status"] == "failed"
    assert result["error_code"] == "ERROR_ISSUE_INVALID_REQUEST"


def test_unknown_issue_and_missing_configuration(pg_db):
    fake = FakeSentry()
    unknown = {
        "issue_id": "00000000-0000-0000-0000-000000000001",
        "status": "resolved",
        "actor_id": 1,
    }

    assert _update(fake, unknown)["error_code"] == "ERROR_ISSUE_NOT_FOUND"

    issue_id = _seed_issue()
    result = _update(fake, {**unknown, "issue_id": issue_id})

    assert result["error_code"] == "ERROR_TRACKING_NOT_CONFIGURED"
    assert fake.requests == []


def test_status_handler_is_registered(pg_db):
    from crate.worker_handlers.error_inbox import ERROR_INBOX_TASK_HANDLERS

    handler = ERROR_INBOX_TASK_HANDLERS["update_error_issue_status"]

    assert handler("task-x", {"status": "nope"}, {})["error_code"] == (
        "ERROR_ISSUE_INVALID_REQUEST"
    )


# -- connection test ----------------------------------------------------------


def test_connection_test_records_access(pg_db, caplog):
    configure()
    fake = FakeSentry()

    result = _check(fake)

    assert result == {"status": "succeeded", "access": {"read": True, "write": True}}
    assert fake.paths() == ["/api/0/"]
    state = _access_state()
    assert (state["read"], state["write"]) == (True, True)
    assert state["source"] == "connection_test"
    assert state["error_code"] is None
    assert len(state["credential"]) == 16
    assert TOKEN not in json.dumps(state, default=str)
    assert TOKEN not in caplog.text


def test_connection_test_auth_error(pg_db):
    configure()
    fake = FakeSentry()
    fake.fail = lambda request: httpx.Response(401, json={"detail": TOKEN})

    result = _check(fake)

    assert result["status"] == "failed"
    assert result["error_code"] == "SENTRY_AUTH"
    assert result["access"] == {"read": False, "write": False}
    assert TOKEN not in json.dumps(result)
    state = _access_state()
    assert (state["read"], state["write"], state["error_code"]) == (
        False,
        False,
        "SENTRY_AUTH",
    )


def test_connection_test_unavailable_and_unreported_scopes_are_unknown(pg_db):
    from crate.error_inbox.config import load_config
    from crate.worker_handlers.error_inbox import known_write_access

    configure()
    fake = FakeSentry()
    fake.scopes = None

    assert _check(fake)["access"] == {"read": None, "write": None}
    config = load_config()
    assert config is not None
    assert known_write_access(config) is None

    fake.fail = lambda request: httpx.Response(503)
    result = _check(fake)

    assert result["error_code"] == "SENTRY_SERVER"
    assert result["access"] == {"read": None, "write": None}


def test_connection_test_without_configuration_or_token(pg_db):
    from crate.error_inbox.config import save_config

    fake = FakeSentry()

    assert _check(fake)["error_code"] == "ERROR_TRACKING_NOT_CONFIGURED"
    assert _access_state() is None

    save_config({"organization": "ninja-development"})
    result = _check(fake)

    assert result["error_code"] == "ERROR_TRACKING_TOKEN_MISSING"
    assert _access_state()["error_code"] == "ERROR_TRACKING_TOKEN_MISSING"
    assert fake.requests == []


def test_connection_handler_is_registered(pg_db):
    from crate.worker_handlers.error_inbox import ERROR_INBOX_TASK_HANDLERS

    handler = ERROR_INBOX_TASK_HANDLERS["test_error_tracking_connection"]

    assert handler("task-x", {}, {})["error_code"] == "ERROR_TRACKING_NOT_CONFIGURED"

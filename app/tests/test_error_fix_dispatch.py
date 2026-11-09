"""Launch fix (E3): the API queues `dispatch_error_fix`, the task opens a fix run and
dispatches the autofix workflow once per issue every 24 hours with only the short id
and the note.

GitHub is always the `FakeGitHub` transport; nothing reaches the network.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import text

from tests.error_inbox_fakes import (
    DISPATCH_PATH,
    GITHUB_TOKEN,
    ORGANIZATION,
    TOKEN,
    FakeGitHub,
    configure,
    configure_fix,
    raw_issue,
)

VIEW = "ops.errors.view"
MANAGE = "ops.errors.manage"
RUNTIME = "ops.runtime.manage"
BASE = "/api/admin/errors"
WORKFLOW_FILE = Path(__file__).resolve().parents[2] / (
    ".github/workflows/error-autofix.yml"
)


# -- helpers --------------------------------------------------------------------


@pytest.fixture
def api(pg_db, test_app, monkeypatch):
    """The test client as the seeded admin, with only the capabilities in `caps`."""
    session = {"caps": {VIEW, MANAGE, RUNTIME}}

    async def resolve_user(self, request):
        return {"id": _admin_id(), "role": "user", "username": "errors"}

    def has_capability(user, capability):
        return bool(user) and capability in session["caps"]

    monkeypatch.setattr("crate.api.auth.AuthMiddleware.resolve_user", resolve_user)
    monkeypatch.setattr("crate.api.permissions.has_capability", has_capability)
    test_app.session = session
    return test_app


def _scope():
    from crate.db.tx import transaction_scope

    return transaction_scope()


def _admin_id() -> int:
    with _scope() as session:
        return session.execute(text("SELECT min(id) FROM users")).scalar_one()


def _seed_issue(external_id="1", **overrides) -> str:
    from crate.db.queries.error_issues import sync_state
    from crate.db.repositories.error_issues import upsert_issues
    from crate.error_inbox.sentry_client import normalize_issue

    upsert_issues([normalize_issue(raw_issue(external_id, **overrides))])
    return sync_state([external_id])[external_id]["id"]


def _fix_columns(issue_id: str) -> dict:
    with _scope() as session:
        return dict(
            session.execute(
                text(
                    "SELECT fix_requested_at, fix_requested_by FROM error_issues "
                    "WHERE id = CAST(:id AS uuid)"
                ),
                {"id": issue_id},
            )
            .mappings()
            .one()
        )


def _age_request(issue_id: str, hours: float) -> None:
    with _scope() as session:
        session.execute(
            text(
                "UPDATE error_issues SET fix_requested_at = now() - "
                "make_interval(secs => :seconds) WHERE id = CAST(:id AS uuid)"
            ),
            {"id": issue_id, "seconds": hours * 3600},
        )


def _audit_rows() -> list[dict]:
    with _scope() as session:
        rows = session.execute(
            text(
                "SELECT action, target_type, target_name, details_json, user_id, "
                "task_id FROM audit_log WHERE action = 'error_issue.fix.dispatch' "
                "ORDER BY id"
            )
        ).mappings()
        return [dict(row) for row in rows]


def _fix_tasks() -> list[dict]:
    with _scope() as session:
        rows = session.execute(
            text(
                "SELECT params_json, actor_user_id FROM tasks "
                "WHERE type = 'dispatch_error_fix' ORDER BY created_at"
            )
        ).mappings()
        return [
            {
                "params": json.loads(row["params_json"])
                if isinstance(row["params_json"], str)
                else row["params_json"],
                "actor_user_id": row["actor_user_id"],
            }
            for row in rows
        ]


def _fix_runs(issue_id: str) -> list[dict]:
    with _scope() as session:
        rows = session.execute(
            text(
                "SELECT id::text AS id, status, executor, repository, base_ref, "
                "requested_by, error_code FROM error_fix_runs "
                "WHERE issue_id = CAST(:id AS uuid) ORDER BY requested_at"
            ),
            {"id": issue_id},
        ).mappings()
        return [dict(row) for row in rows]


def _finish_runs(issue_id: str) -> None:
    """What the tracker does to a run that never opened a pull request."""
    with _scope() as session:
        session.execute(
            text(
                "UPDATE error_fix_runs SET status = 'expired', finished_at = now() "
                "WHERE issue_id = CAST(:id AS uuid) "
                "AND status IN ('requested', 'running', 'pr_open')"
            ),
            {"id": issue_id},
        )


def _dispatch(fake: FakeGitHub, params: dict, task_id: str = "task-fix-1") -> dict:
    from crate.worker_handlers.error_fixes import dispatch_fix

    return dispatch_fix(task_id, params, client_factory=fake.factory)


def _params(issue_id: str, actor_id: int, note: str = "") -> dict:
    return {"issue_id": issue_id, "note": note, "actor_id": actor_id}


def _code(response) -> str | None:
    return response.headers.get("X-Crate-Error")


# -- the plan's tests -----------------------------------------------------------------


def test_dedup_within_24h(api):
    configure_fix()
    issue_id = _seed_issue()
    actor = _admin_id()
    fake = FakeGitHub()

    first = _dispatch(fake, _params(issue_id, actor))
    assert first["status"] == "succeeded", first

    # The task refuses a second dispatch without calling GitHub...
    second = _dispatch(fake, _params(issue_id, actor), task_id="task-fix-2")
    assert second["status"] == "failed"
    assert second["error_code"] == "ERROR_FIX_RECENTLY_REQUESTED"
    assert second["expected"] is True
    assert len(fake.requests) == 1

    # ...and the API refuses to queue one, and says when it is possible again.
    refused = api.post(f"{BASE}/{issue_id}/fix", json={})
    assert refused.status_code == 409
    assert _code(refused) == "ERROR_FIX_RECENTLY_REQUESTED"
    assert _fix_tasks() == []
    fix = api.get(f"{BASE}/{issue_id}").json()["fix"]
    available_at = datetime.fromisoformat(fix["available_at"])
    assert timedelta(hours=23) < available_at - datetime.now(timezone.utc)

    # After 24 hours the issue can be dispatched again, once its run has ended.
    _age_request(issue_id, 24.5)
    assert api.get(f"{BASE}/{issue_id}").json()["fix"]["available_at"] is None
    in_progress = _dispatch(fake, _params(issue_id, actor), task_id="task-fix-3")
    assert in_progress["error_code"] == "ERROR_FIX_IN_PROGRESS"
    assert in_progress["expected"] is True
    refused = api.post(f"{BASE}/{issue_id}/fix", json={})
    assert refused.status_code == 409
    assert _code(refused) == "ERROR_FIX_IN_PROGRESS"
    assert len(fake.requests) == 1

    _finish_runs(issue_id)
    third = _dispatch(fake, _params(issue_id, actor), task_id="task-fix-4")
    assert third["status"] == "succeeded", third
    assert len(fake.requests) == 2
    assert [run["status"] for run in _fix_runs(issue_id)] == ["expired", "requested"]


def test_records_request_and_audits(api):
    configure_fix()
    issue_id = _seed_issue()
    actor = _admin_id()
    fake = FakeGitHub()
    note = "Started after the last deploy."

    result = _dispatch(fake, _params(issue_id, actor, note))

    assert result["status"] == "succeeded"
    assert result["short_id"] == "CRATE-API-1"
    assert result["actions_url"] == (
        "https://github.com/thecrateapp/crate/actions/workflows/error-autofix.yml"
    )
    [request] = fake.requests
    assert request.url.path == DISPATCH_PATH
    # Only the short id and the note leave Crate: no title, digest or event text.
    assert fake.bodies() == [
        {"ref": "main", "inputs": {"sentry_issue": "CRATE-API-1", "note": note}}
    ]
    assert fake.tokens == [GITHUB_TOKEN]

    columns = _fix_columns(issue_id)
    assert columns["fix_requested_by"] == actor
    assert columns["fix_requested_at"] == datetime.fromisoformat(result["requested_at"])
    [run] = _fix_runs(issue_id)
    assert run == {
        "id": result["run_id"],
        "status": "requested",
        "executor": "github_actions",
        "repository": "thecrateapp/crate",
        "base_ref": "main",
        "requested_by": actor,
        "error_code": None,
    }
    [audit] = _audit_rows()
    assert audit["target_type"] == "error_issue"
    assert audit["target_name"] == "CRATE-API-1"
    assert audit["user_id"] == actor
    assert audit["task_id"] == "task-fix-1"
    assert audit["details_json"] == {
        "issue_id": issue_id,
        "provider": "sentry",
        "external_id": "1",
        "run_id": result["run_id"],
        "executor": "github_actions",
        "repository": "thecrateapp/crate",
        "workflow": "error-autofix.yml",
        "ref": "main",
        "has_note": True,
    }
    serialized = json.dumps(audit["details_json"])
    assert note not in serialized and "IntegrityError" not in serialized

    detail = api.get(f"{BASE}/{issue_id}").json()
    assert detail["fix_requested_by"] == actor
    assert detail["fix_requested_by_name"]
    assert detail["fix_requested_at"] is not None
    assert detail["fix_status"] == "requested"
    [shown] = detail["fix_runs"]
    assert shown["id"] == result["run_id"]
    assert shown["requested_by_name"] == detail["fix_requested_by_name"]
    assert shown["review"] == {
        "can_merge": False,
        "blockers": ["FIX_RUN_NOT_OPEN"],
        "can_discard": True,
    }


def test_hidden_when_not_configured(api):
    issue_id = _seed_issue()

    # Error tracking without Launch fix.
    configure()
    assert api.get(f"{BASE}/{issue_id}").json()["fix"] is None
    assert api.get(f"{BASE}/connection").json()["fix"] is None
    refused = api.post(f"{BASE}/{issue_id}/fix", json={"note": "x"})
    assert refused.status_code == 409
    assert _code(refused) == "ERROR_FIX_NOT_CONFIGURED"

    # Settings without a GitHub token are not enough either.
    configure_fix(github_token=None)
    assert api.get(f"{BASE}/{issue_id}").json()["fix"] is None
    assert api.get(f"{BASE}/connection").json()["fix"]["has_token"] is False
    assert api.post(f"{BASE}/{issue_id}/fix", json={}).status_code == 409
    assert _fix_tasks() == []
    fake = FakeGitHub()
    unconfigured = _dispatch(fake, _params(issue_id, _admin_id()))
    assert unconfigured["error_code"] == "ERROR_FIX_NOT_CONFIGURED"
    assert fake.requests == []

    configure_fix()
    fix = api.get(f"{BASE}/{issue_id}").json()["fix"]
    assert fix == {
        "repository": "thecrateapp/crate",
        "workflow": "error-autofix.yml",
        "executor": "github_actions",
        "actions_url": (
            "https://github.com/thecrateapp/crate/actions/workflows/error-autofix.yml"
        ),
        "supported": True,
        "available_at": None,
    }


def test_note_length_cap(api):
    configure_fix()
    issue_id = _seed_issue()

    too_long = api.post(f"{BASE}/{issue_id}/fix", json={"note": "x" * 501})
    assert too_long.status_code == 422
    assert _code(too_long) == "ERROR_INBOX_INVALID_REQUEST"
    assert "x" * 501 not in too_long.text
    extra = api.post(f"{BASE}/{issue_id}/fix", json={"note": "", "ref": "evil"})
    assert extra.status_code == 422
    assert _fix_tasks() == []

    # The cap counts characters, like the workflow's ${#NOTE} under C.UTF-8.
    accepted = api.post(f"{BASE}/{issue_id}/fix", json={"note": "é" * 500})
    assert accepted.status_code == 202, accepted.text
    [task] = _fix_tasks()
    assert task["params"]["note"] == "é" * 500

    # The task re-checks a note it did not get from the API.
    fake = FakeGitHub()
    result = _dispatch(fake, _params(issue_id, _admin_id(), "x" * 501))
    assert result["error_code"] == "ERROR_FIX_INVALID_REQUEST"
    assert fake.requests == []
    assert _fix_columns(issue_id)["fix_requested_at"] is None


# -- more of the contract -----------------------------------------------------------


def test_launch_fix_requires_manage_and_enqueues_once(api):
    configure_fix()
    issue_id = _seed_issue()

    api.session["caps"] = {VIEW, RUNTIME}
    assert api.post(f"{BASE}/{issue_id}/fix", json={}).status_code == 403
    assert _fix_tasks() == []

    api.session["caps"] = {VIEW, MANAGE}
    first = api.post(f"{BASE}/{issue_id}/fix", json={"note": "Look at the pool."})
    assert first.status_code == 202, first.text
    assert first.headers["Cache-Control"] == "no-store"
    second = api.post(f"{BASE}/{issue_id}/fix", json={})
    assert second.json() == first.json()
    assert _fix_tasks() == [
        {
            "params": {
                "issue_id": issue_id,
                "note": "Look at the pool.",
                "actor_id": _admin_id(),
            },
            "actor_user_id": _admin_id(),
        }
    ]

    for missing in ("00000000-0000-0000-0000-000000000000", "not-a-uuid"):
        response = api.post(f"{BASE}/{missing}/fix", json={})
        assert response.status_code == 404
        assert _code(response) == "ERROR_ISSUE_NOT_FOUND"


def test_failed_dispatch_releases_the_claim(api):
    configure_fix()
    issue_id = _seed_issue()
    actor = _admin_id()

    forbidden = FakeGitHub(status=403)
    result = _dispatch(forbidden, _params(issue_id, actor))

    assert result["status"] == "failed"
    assert result["error_code"] == "GITHUB_FORBIDDEN"
    assert result["expected"] is True
    assert GITHUB_TOKEN not in json.dumps(result)
    assert len(forbidden.requests) == 1
    assert _fix_columns(issue_id) == {
        "fix_requested_at": None,
        "fix_requested_by": None,
    }
    assert _audit_rows() == []
    # The failed attempt stays visible in the detail, with GitHub's answer.
    [run] = _fix_runs(issue_id)
    assert run["id"] == result["run_id"]
    assert (run["status"], run["error_code"]) == ("failed", "GITHUB_FORBIDDEN")

    # Nothing blocks the next attempt once the token is fixed.
    retry = _dispatch(FakeGitHub(), _params(issue_id, actor), task_id="task-fix-2")
    assert retry["status"] == "succeeded"
    assert len(_audit_rows()) == 1


def test_failed_dispatch_keeps_an_older_request(api):
    configure_fix()
    issue_id = _seed_issue()
    actor = _admin_id()
    assert _dispatch(FakeGitHub(), _params(issue_id, actor))["status"] == "succeeded"
    _age_request(issue_id, 30)
    _finish_runs(issue_id)
    before = _fix_columns(issue_id)

    result = _dispatch(FakeGitHub(status=422), _params(issue_id, actor), "task-fix-2")

    assert result["error_code"] == "GITHUB_VALIDATION"
    assert _fix_columns(issue_id) == before


def test_unsupported_short_ids_are_refused(api):
    configure_fix()
    issue_id = _seed_issue("7", shortId="MYAPP-7")

    assert api.get(f"{BASE}/{issue_id}").json()["fix"]["supported"] is False
    refused = api.post(f"{BASE}/{issue_id}/fix", json={})
    assert refused.status_code == 409
    assert _code(refused) == "ERROR_FIX_UNSUPPORTED_ISSUE"

    fake = FakeGitHub()
    result = _dispatch(fake, _params(issue_id, _admin_id()))
    assert result["error_code"] == "ERROR_FIX_UNSUPPORTED_ISSUE"
    assert fake.requests == []
    assert _fix_columns(issue_id)["fix_requested_at"] is None
    assert _fix_runs(issue_id) == []


def test_invalid_task_params_are_refused(pg_db):
    fake = FakeGitHub()
    for params in (
        {},
        {"issue_id": "x", "note": "", "actor_id": "7"},
        {"issue_id": "x", "note": None, "actor_id": 7},
        {"issue_id": "x", "note": "", "actor_id": True},
    ):
        result = _dispatch(fake, params)
        assert result["error_code"] == "ERROR_FIX_INVALID_REQUEST", params
    missing = _dispatch(
        fake, _params("00000000-0000-0000-0000-000000000000", 1, "note")
    )
    assert missing["error_code"] == "ERROR_ISSUE_NOT_FOUND"
    assert fake.requests == []


def test_put_connection_stores_fix_settings_and_a_write_only_token(api):
    from crate.credentials import CredentialSecretError, load_secret
    from crate.error_inbox.config import load_config, load_github_token

    base = {"organization": ORGANIZATION, "token": TOKEN}
    fix = {"repository": "thecrateapp/crate", "workflow": "error-autofix.yml"}
    bodies = []

    saved = api.put(
        f"{BASE}/connection", json={**base, "fix": {**fix, "token": GITHUB_TOKEN}}
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["fix"] == {
        **fix,
        "ref": "main",
        "executor": "github_actions",
        "has_token": True,
        "actions_url": (
            "https://github.com/thecrateapp/crate/actions/workflows/error-autofix.yml"
        ),
    }
    bodies.append(saved.text)
    first_ref = load_config().fix.secret_ref

    # Omitted `fix`, or `fix` without a token, keeps the stored token.
    kept = api.put(f"{BASE}/connection", json={"organization": ORGANIZATION})
    assert kept.json()["fix"]["has_token"] is True
    moved = api.put(
        f"{BASE}/connection",
        json={"organization": ORGANIZATION, "fix": {**fix, "ref": "release"}},
    )
    assert moved.json()["fix"]["ref"] == "release"
    assert moved.json()["fix"]["has_token"] is True
    assert load_config().fix.secret_ref == first_ref
    bodies += [kept.text, moved.text]

    # Classic tokens cannot be limited to one repository and Actions.
    classic = api.put(
        f"{BASE}/connection",
        json={**base, "fix": {**fix, "token": "ghp_classic_token_value"}},
    )
    assert classic.status_code == 422
    assert _code(classic) == "ERROR_TRACKING_INVALID"
    assert "fine-grained" in classic.json()["detail"]
    assert "ghp_classic_token_value" not in classic.text
    for invalid in (
        {"repository": "thecrateapp", "workflow": "error-autofix.yml"},
        {"repository": "thecrateapp/..", "workflow": "error-autofix.yml"},
        {"repository": "thecrateapp/crate", "workflow": "../x.yml"},
        {"workflow": "error-autofix.yml", "token": GITHUB_TOKEN},
    ):
        rejected = api.put(f"{BASE}/connection", json={**base, "fix": invalid})
        assert rejected.status_code == 422, invalid
        bodies.append(rejected.text)

    # A new token replaces and revokes the previous one.
    rotated = api.put(
        f"{BASE}/connection",
        json={**base, "fix": {**fix, "token": "github_pat_rotated_token"}},
    )
    assert rotated.status_code == 200
    config = load_config()
    assert load_github_token(config) == "github_pat_rotated_token"
    with pytest.raises(CredentialSecretError):
        load_secret(first_ref)

    # `fix: null` turns Launch fix off and revokes its token.
    off = api.put(f"{BASE}/connection", json={**base, "fix": None})
    assert off.json()["fix"] is None
    with pytest.raises(CredentialSecretError):
        load_secret(config.fix.secret_ref)
    bodies += [rotated.text, off.text, api.get(f"{BASE}/connection").text]

    for body in bodies:
        assert GITHUB_TOKEN not in body
        assert "github_pat_rotated_token" not in body
    with _scope() as session:
        stored = session.execute(
            text("SELECT value FROM settings WHERE key = 'error_tracking'")
        ).scalar_one()
    assert "github_pat_" not in stored


def test_no_outbound_http_when_launching(api, monkeypatch):
    def refuse(*args, **kwargs):
        raise AssertionError("An error inbox handler built a GitHub client")

    monkeypatch.setattr("crate.error_inbox.github_client.GitHubClient.__init__", refuse)
    configure_fix()
    issue_id = _seed_issue()

    assert api.post(f"{BASE}/{issue_id}/fix", json={}).status_code == 202
    assert api.get(f"{BASE}/{issue_id}").status_code == 200


# -- the workflow contract ------------------------------------------------------------


def test_inputs_match_the_workflow():
    """Crate validates exactly what `error-autofix.yml` validates in its first step."""
    from crate.error_inbox.autofix import (
        MAX_NOTE_LENGTH,
        MAX_SHORT_ID_LENGTH,
        SHORT_ID_PATTERN,
    )

    workflow = WORKFLOW_FILE.read_text()
    assert f"pattern='{SHORT_ID_PATTERN}'" in workflow
    assert f"(( ${{#SENTRY_ISSUE}} > {MAX_SHORT_ID_LENGTH} ))" in workflow
    assert f"(( ${{#NOTE}} > {MAX_NOTE_LENGTH} ))" in workflow
    inputs = re.search(r"workflow_dispatch:\n\s+inputs:\n(.*?)\n\S", workflow, re.S)
    assert inputs is not None
    names = re.findall(r"^ {6}(\w+):$", inputs.group(1), re.M)
    assert names == ["sentry_issue", "note"]


@pytest.mark.parametrize(
    "short_id,supported",
    [
        ("CRATE-API-1F", True),
        ("CRATE-WORKERS-2A", True),
        ("CRATE-MEDIA-WORKER-9", True),
        ("crate-api-1f", False),
        ("CRATE-1F", False),
        ("CRATE-API-", False),
        ("CRATE-API-1F\n", False),
        ("CRATE-API-1F; rm", False),
        ("MYAPP-API-1", False),
        ("CRATE-" + "A" * 56 + "-1", True),
        ("CRATE-" + "A" * 57 + "-1", False),
        (None, False),
    ],
)
def test_short_id_validation_matches_the_workflow(short_id, supported):
    from crate.error_inbox.autofix import supports_short_id

    assert supports_short_id(short_id) is supported

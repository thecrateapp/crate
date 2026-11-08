"""Fix runs: the tracker follows each Launch fix to its pull request, Approve & merge
merges it once its checks pass, and Discard closes it and deletes its branch.

GitHub is always `FakeGitHubRepo` behind `httpx.MockTransport`; nothing reaches the
network.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import text

from tests.error_inbox_fakes import (
    FIXER,
    GITHUB_TOKEN,
    REPOSITORY,
    FakeGitHubRepo,
    configure,
    configure_fix,
    raw_issue,
)

VIEW = "ops.errors.view"
MANAGE = "ops.errors.manage"
BASE = "/api/admin/errors"
SHORT_ID = "CRATE-API-1"


# -- helpers --------------------------------------------------------------------


@pytest.fixture
def api(pg_db, test_app, monkeypatch):
    session = {"caps": {VIEW, MANAGE}}

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


def _launch(repo: FakeGitHubRepo, issue_id: str) -> str:
    from crate.worker_handlers.error_fixes import dispatch_fix

    result = dispatch_fix(
        "task-launch",
        {"issue_id": issue_id, "note": "", "actor_id": _admin_id()},
        client_factory=repo.factory,
    )
    assert result["status"] == "succeeded", result
    return result["run_id"]


def _track(repo: FakeGitHubRepo, **kwargs) -> dict:
    from crate.worker_handlers.error_fixes import track_fixes

    return track_fixes("task-track", client_factory=repo.factory, **kwargs)


def _run(run_id: str) -> dict:
    from crate.db.queries.error_fix_runs import get_fix_run

    run = get_fix_run(run_id)
    assert run is not None
    return run


def _shift(run_id: str, **hours: float) -> None:
    """Move a run's timestamps into the past, as if time had passed."""
    with _scope() as session:
        for column, value in hours.items():
            session.execute(
                text(
                    f"UPDATE error_fix_runs SET {column} = {column} - "
                    "make_interval(secs => :seconds) WHERE id = CAST(:id AS uuid)"
                ),
                {"id": run_id, "seconds": value * 3600},
            )


def _audits(action: str) -> list[dict]:
    with _scope() as session:
        rows = session.execute(
            text(
                "SELECT target_name, details_json, user_id, task_id FROM audit_log "
                "WHERE action = :action ORDER BY id"
            ),
            {"action": action},
        ).mappings()
        return [dict(row) for row in rows]


def _tasks(task_type: str) -> list[dict]:
    with _scope() as session:
        rows = session.execute(
            text(
                "SELECT params_json FROM tasks WHERE type = :type ORDER BY created_at"
            ),
            {"type": task_type},
        ).scalars()
        return [json.loads(row) if isinstance(row, str) else row for row in rows]


def _code(response) -> str | None:
    return response.headers.get("X-Crate-Error")


def _open_pull(repo: FakeGitHubRepo, issue_id: str, *, draft=False, **pull) -> tuple:
    """A launched run whose pull request the tracker already found."""
    run_id = _launch(repo, issue_id)
    workflow_run = repo.add_run(SHORT_ID)
    raw = repo.add_pull(SHORT_ID, workflow_run, draft=draft, **pull)
    sha = raw["head"]["sha"]
    if not draft:
        repo.set_checks(sha, ("backend", "completed", "success"))
    assert _track(repo)["status"] == "succeeded"
    run = _run(run_id)
    assert run["status"] == "pr_open", run
    return run_id, raw


# -- the tracker ------------------------------------------------------------------


def test_tracker_follows_a_run_to_its_merged_pull_request(api):
    configure_fix()
    issue_id = _seed_issue()
    repo = FakeGitHubRepo()
    run_id = _launch(repo, issue_id)
    assert _run(run_id)["status"] == "requested"

    # Nothing on GitHub yet: the run waits.
    assert _track(repo)["status"] == "succeeded"
    assert _run(run_id)["status"] == "requested"
    assert _run(run_id)["checked_at"] is not None

    # The workflow run appears under its name; runs of other issues are ignored.
    repo.add_run("CRATE-API-2")
    workflow_run = repo.add_run(SHORT_ID)
    _track(repo)
    run = _run(run_id)
    assert run["status"] == "running"
    assert run["external_run_id"] == str(workflow_run)
    assert run["external_run_url"] == (
        f"https://github.com/{REPOSITORY}/actions/runs/{workflow_run}"
    )

    # The workflow opens a draft pull request on its fix branch.
    raw = repo.add_pull(SHORT_ID, workflow_run)
    repo.set_checks(raw["head"]["sha"], ("backend", "completed", "skipped"))
    _track(repo)
    run = _run(run_id)
    assert run["status"] == "pr_open"
    assert run["pr_number"] == raw["number"]
    assert run["pr_url"] == raw["html_url"]
    assert run["branch"] == f"autofix/crate-api-1-{workflow_run}"
    assert (run["pr_draft"], run["pr_labeled"], run["pr_author"]) == (
        True,
        True,
        FIXER,
    )
    assert run["pr_head_sha"] == raw["head"]["sha"]
    assert run["ci_state"] == "success"

    # Someone merges it on GitHub: the run ends and its branch goes.
    raw.update(state="closed", merged=True, merged_at=raw["created_at"])
    _track(repo)
    run = _run(run_id)
    assert run["status"] == "merged"
    assert run["finished_at"] is not None
    assert run["cleanup_state"] == "done"
    assert raw["head"]["ref"] not in repo.branches
    assert f"/repos/{REPOSITORY}/git/refs/heads/{raw['head']['ref']}" in repo.paths(
        "DELETE"
    )
    assert _audits("error_issue.fix.merged") == []

    # Finished runs are not tracked again.
    calls = len(repo.requests)
    assert _track(repo) == {"status": "skipped", "reason": "no_runs"}
    assert len(repo.requests) == calls
    assert set(repo.tokens) == {GITHUB_TOKEN}


def test_closed_pull_request_closes_the_run_and_deletes_its_branch(api):
    configure_fix()
    issue_id = _seed_issue()
    repo = FakeGitHubRepo()
    run_id, raw = _open_pull(repo, issue_id)

    raw["state"] = "closed"
    _track(repo)
    run = _run(run_id)
    assert (run["status"], run["pr_state"], run["cleanup_state"]) == (
        "closed",
        "closed",
        "done",
    )
    assert run["summary"] == "Closed on GitHub without merging."


def test_branch_cleanup_without_contents_write_is_recorded(api):
    configure_fix()
    issue_id = _seed_issue()
    repo = FakeGitHubRepo()
    run_id, raw = _open_pull(repo, issue_id)

    repo.delete_status = 403
    raw["state"] = "closed"
    _track(repo)
    assert _run(run_id)["cleanup_state"] == "failed"

    # A transient failure is retried by the next pass instead.
    other = _seed_issue("2", shortId="CRATE-API-2")
    repo.delete_status = None
    second = _launch(repo, other)
    workflow_run = repo.add_run("CRATE-API-2")
    pull = repo.add_pull("CRATE-API-2", workflow_run)
    _track(repo)
    repo.delete_status = 502
    pull["state"] = "closed"
    _track(repo)
    assert _run(second)["cleanup_state"] == "pending"
    repo.delete_status = None
    _track(repo)
    assert _run(second)["cleanup_state"] == "done"


@pytest.mark.parametrize(
    "conclusion,status,code",
    [
        ("success", "failed", "FIX_NOT_PROPOSED"),
        ("failure", "failed", "FIX_RUN_FAILED"),
        ("cancelled", "cancelled", None),
    ],
)
def test_finished_runs_without_a_pull_request(api, conclusion, status, code):
    configure_fix()
    issue_id = _seed_issue()
    repo = FakeGitHubRepo()
    run_id = _launch(repo, issue_id)
    workflow_run = repo.add_run(SHORT_ID, status="completed", conclusion=conclusion)

    _track(repo)

    run = _run(run_id)
    assert (run["status"], run["error_code"]) == (status, code)
    assert run["external_run_id"] == str(workflow_run)
    assert run["finished_at"] is not None


def test_runs_without_a_pull_request_expire_and_are_cancelled(api):
    configure_fix()
    issue_id = _seed_issue()
    repo = FakeGitHubRepo()
    run_id = _launch(repo, issue_id)
    workflow_run = repo.add_run(
        SHORT_ID, created_at=datetime.now(timezone.utc) - timedelta(hours=7)
    )
    _shift(run_id, requested_at=7)

    _track(repo)

    run = _run(run_id)
    assert (run["status"], run["error_code"]) == ("expired", "FIX_NO_PULL_REQUEST")
    assert repo.runs[workflow_run]["conclusion"] == "cancelled"
    assert f"/repos/{REPOSITORY}/actions/runs/{workflow_run}/cancel" in repo.paths(
        "POST"
    )
    # The issue can get a new fix once the 24-hour window passes.
    assert _run(run_id)["status"] not in {"requested", "running", "pr_open"}


def test_pull_request_found_without_the_run_name(api):
    """A workflow without `run-name`: the branch names the run."""
    configure_fix()
    issue_id = _seed_issue()
    repo = FakeGitHubRepo()
    run_id = _launch(repo, issue_id)
    workflow_run = repo.add_run(SHORT_ID, title="Error Autofix")
    # A pull request of the same issue from before this request is not this run's.
    repo.add_pull(
        SHORT_ID, 1, created_at=datetime.now(timezone.utc) - timedelta(days=2)
    )
    raw = repo.add_pull(SHORT_ID, workflow_run)

    _track(repo)

    run = _run(run_id)
    assert run["status"] == "pr_open"
    assert run["pr_number"] == raw["number"]
    assert run["external_run_id"] == str(workflow_run)


def test_tracker_stops_on_a_rejected_token_and_skips_without_settings(api):
    configure_fix()
    issue_id = _seed_issue()
    repo = FakeGitHubRepo()
    run_id = _launch(repo, issue_id)
    repo.fail = lambda request: httpx.Response(401, json={"message": "Bad"})

    result = _track(repo)

    assert result["status"] == "failed"
    assert result["error_code"] == "GITHUB_AUTH"
    assert result["expected"] is True
    assert GITHUB_TOKEN not in json.dumps(result)
    assert _run(run_id)["status"] == "requested"

    # Other errors are recorded on the run and the pass goes on.
    repo.fail = lambda request: httpx.Response(502)
    assert _track(repo)["errors"] == {"GITHUB_SERVER": 1}
    assert _run(run_id)["error_code"] == "GITHUB_SERVER"

    configure()  # Launch fix off: the tracker does not call GitHub.
    calls = len(repo.requests)
    skipped = _track(repo)
    assert skipped["status"] == "skipped"
    assert skipped["reason"] == "ERROR_FIX_NOT_CONFIGURED"
    assert len(repo.requests) == calls


def test_tracker_is_scheduled_only_while_runs_need_it(api):
    from crate.scheduler import (
        DEFAULT_SCHEDULES,
        ERROR_FIX_SCHEDULED_TASKS,
        _scheduled_task_enabled,
    )

    assert DEFAULT_SCHEDULES["track_error_fixes"] == 300
    assert ERROR_FIX_SCHEDULED_TASKS == {"track_error_fixes"}
    issue_id = _seed_issue()
    configure_fix()
    assert _scheduled_task_enabled("track_error_fixes") is False

    repo = FakeGitHubRepo()
    run_id = _launch(repo, issue_id)
    assert _scheduled_task_enabled("track_error_fixes") is True

    configure()
    assert _scheduled_task_enabled("track_error_fixes") is False
    configure_fix()
    _shift(run_id, requested_at=7)
    _track(repo)
    assert _run(run_id)["status"] == "expired"
    assert _scheduled_task_enabled("track_error_fixes") is False


# -- Approve & merge ----------------------------------------------------------------


def test_approve_and_merge_a_ready_green_pull_request(api):
    configure_fix()
    issue_id = _seed_issue()
    repo = FakeGitHubRepo()
    run_id, raw = _open_pull(repo, issue_id)
    sha = raw["head"]["sha"]

    detail = api.get(f"{BASE}/{issue_id}").json()
    [shown] = detail["fix_runs"]
    assert shown["review"] == {"can_merge": True, "blockers": [], "can_discard": True}
    assert shown["ci_state"] == "success"

    queued = api.post(
        f"{BASE}/{issue_id}/fix-runs/{run_id}/merge", json={"head_sha": sha}
    )
    assert queued.status_code == 202, queued.text
    assert _tasks("merge_error_fix") == [
        {"run_id": run_id, "head_sha": sha, "actor_id": _admin_id()}
    ]

    from crate.worker_handlers.error_fixes import merge_fix

    result = merge_fix(
        "task-merge",
        {"run_id": run_id, "head_sha": sha, "actor_id": _admin_id()},
        client_factory=repo.factory,
    )

    assert result == {"status": "succeeded", "run_id": run_id, "merged": True}
    [merge_request] = [r for r in repo.requests if r.method == "PUT"]
    assert json.loads(merge_request.content) == {"sha": sha, "merge_method": "merge"}
    run = _run(run_id)
    assert (run["status"], run["pr_state"], run["cleanup_state"]) == (
        "merged",
        "merged",
        "pending",
    )
    assert run["merge_requested_by"] == _admin_id()
    [approved] = _audits("error_issue.fix.merge_approved")
    [merged] = _audits("error_issue.fix.merged")
    for audit in (approved, merged):
        assert audit["target_name"] == SHORT_ID
        assert audit["user_id"] == _admin_id()
        assert audit["task_id"] == "task-merge"
        assert audit["details_json"]["sha"] == sha
        assert audit["details_json"]["pr_number"] == raw["number"]
    assert approved["details_json"]["was_draft"] is False

    # The next pass deletes the merged branch.
    _track(repo)
    assert _run(run_id)["cleanup_state"] == "done"
    assert raw["head"]["ref"] not in repo.branches


def test_approving_a_draft_marks_it_ready_and_merges_after_its_checks(api):
    configure_fix()
    issue_id = _seed_issue()
    repo = FakeGitHubRepo()
    run_id, raw = _open_pull(repo, issue_id, draft=True)
    sha = raw["head"]["sha"]
    # The draft's CI jobs were skipped; they only run once it is ready.
    an_hour_ago = datetime.now(timezone.utc) - timedelta(hours=1)
    repo.set_checks(sha, ("backend", "completed", "skipped"), started_at=an_hour_ago)
    _track(repo)
    assert api.get(f"{BASE}/{issue_id}").json()["fix_runs"][0]["review"]["can_merge"]

    from crate.worker_handlers.error_fixes import merge_fix

    result = merge_fix(
        "task-merge",
        {"run_id": run_id, "head_sha": sha, "actor_id": _admin_id()},
        client_factory=repo.factory,
    )

    assert result == {
        "status": "succeeded",
        "run_id": run_id,
        "merged": False,
        "waiting_for": "checks",
    }
    assert "/graphql" in repo.paths("POST")
    assert raw["draft"] is False
    run = _run(run_id)
    assert run["merge_sha"] == sha
    assert run["ready_at"] is not None
    assert run["status"] == "pr_open"
    assert api.get(f"{BASE}/{issue_id}").json()["fix_runs"][0]["review"][
        "blockers"
    ] == ["CHECKS_PENDING", "ALREADY_APPROVED"]

    # Only the old, skipped checks exist: no merge.
    _track(repo)
    assert _run(run_id)["ci_state"] == "pending"
    assert "PUT" not in {request.method for request in repo.requests}

    # CI runs on the ready pull request and passes: the tracker merges it.
    started = run["ready_at"] + timedelta(seconds=30)
    repo.set_checks(sha, ("backend", "in_progress", None), started_at=started)
    _track(repo)
    assert _run(run_id)["status"] == "pr_open"
    repo.set_checks(sha, ("backend", "completed", "success"), started_at=started)
    _track(repo)
    run = _run(run_id)
    assert run["status"] == "merged"
    assert run["summary"] == "Merged from Crate after the checks passed."
    [merged] = _audits("error_issue.fix.merged")
    assert merged["user_id"] == _admin_id()
    assert merged["task_id"] == "task-track"


def _approve(repo: FakeGitHubRepo, run_id: str, sha: str) -> dict:
    from crate.worker_handlers.error_fixes import merge_fix

    return merge_fix(
        "task-merge",
        {"run_id": run_id, "head_sha": sha, "actor_id": _admin_id()},
        client_factory=repo.factory,
    )


def test_an_approval_is_dropped_when_the_head_moves(api):
    configure_fix()
    issue_id = _seed_issue()
    repo = FakeGitHubRepo()
    run_id, raw = _open_pull(repo, issue_id, draft=True)
    assert _approve(repo, run_id, raw["head"]["sha"])["status"] == "succeeded"

    raw["head"]["sha"] = "f" * 40  # someone pushed after the approval
    _track(repo)

    run = _run(run_id)
    assert run["merge_requested_at"] is None
    assert run["merge_sha"] is None
    assert run["error_code"] == "FIX_HEAD_CHANGED"
    assert run["summary"].startswith("New commits arrived after the approval")
    assert "PUT" not in {request.method for request in repo.requests}
    # The pull request is ready now: a new approval waits for green checks.
    refused = _approve(repo, run_id, "f" * 40)
    assert refused["error_code"] == "ERROR_FIX_NOT_MERGEABLE"
    assert refused["blockers"] == ["CHECKS_PENDING"]


def test_an_approval_is_dropped_when_checks_fail_or_take_too_long(api):
    configure_fix()
    issue_id = _seed_issue()
    repo = FakeGitHubRepo()
    run_id, raw = _open_pull(repo, issue_id, draft=True)
    sha = raw["head"]["sha"]
    assert _approve(repo, run_id, sha)["status"] == "succeeded"

    after = _run(run_id)["ready_at"] + timedelta(seconds=5)
    repo.set_checks(sha, ("backend", "completed", "failure"), started_at=after)
    _track(repo)

    run = _run(run_id)
    assert run["merge_requested_at"] is None
    assert (run["error_code"], run["ci_state"]) == ("FIX_CHECKS_FAILED", "failure")
    assert "PUT" not in {request.method for request in repo.requests}

    # A second draft whose checks never finish: the approval lapses after 3 hours.
    other = _seed_issue("2", shortId="CRATE-API-2")
    second = _launch(repo, other)
    pull = repo.add_pull("CRATE-API-2", repo.add_run("CRATE-API-2"))
    _track(repo)
    assert _approve(repo, second, pull["head"]["sha"])["status"] == "succeeded"
    _shift(second, merge_requested_at=4)
    _track(repo)
    run = _run(second)
    assert (run["error_code"], run["merge_requested_at"]) == (
        "FIX_APPROVAL_EXPIRED",
        None,
    )


def test_github_refusing_the_merge_drops_the_approval(api):
    configure_fix()
    issue_id = _seed_issue()
    repo = FakeGitHubRepo()
    run_id, raw = _open_pull(repo, issue_id)
    repo.merge_status = 405

    from crate.worker_handlers.error_fixes import merge_fix

    result = merge_fix(
        "task-merge",
        {"run_id": run_id, "head_sha": raw["head"]["sha"], "actor_id": _admin_id()},
        client_factory=repo.factory,
    )

    assert result["status"] == "failed"
    assert result["error_code"] == "FIX_MERGE_REFUSED"
    run = _run(run_id)
    assert run["status"] == "pr_open"
    assert run["merge_requested_at"] is None
    assert _audits("error_issue.fix.merged") == []


def test_merge_requests_are_refused_unless_the_pull_request_qualifies(api):
    configure_fix()
    issue_id = _seed_issue()
    repo = FakeGitHubRepo()
    run_id, raw = _open_pull(repo, issue_id)
    sha = raw["head"]["sha"]
    url = f"{BASE}/{issue_id}/fix-runs/{run_id}/merge"

    api.session["caps"] = {VIEW}
    assert api.post(url, json={"head_sha": sha}).status_code == 403
    api.session["caps"] = {VIEW, MANAGE}

    moved = api.post(url, json={"head_sha": "a" * 40})
    assert moved.status_code == 409
    assert _code(moved) == "ERROR_FIX_HEAD_CHANGED"
    assert api.post(url, json={"head_sha": "not-a-sha"}).status_code == 422
    assert api.post(url, json={"head_sha": sha, "force": True}).status_code == 422

    missing = api.post(
        f"{BASE}/{issue_id}/fix-runs/00000000-0000-0000-0000-000000000000/merge",
        json={"head_sha": sha},
    )
    assert (missing.status_code, _code(missing)) == (404, "ERROR_FIX_RUN_NOT_FOUND")
    other_issue = _seed_issue("2", shortId="CRATE-API-2")
    elsewhere = api.post(
        f"{BASE}/{other_issue}/fix-runs/{run_id}/merge", json={"head_sha": sha}
    )
    assert elsewhere.status_code == 404

    # Pull requests from another account, without the label or with pending
    # checks are not Crate's to merge.
    raw["user"]["login"] = "someone"
    raw["labels"] = []
    repo.set_checks(sha, ("backend", "in_progress", None))
    _track(repo)
    refused = api.post(url, json={"head_sha": sha})
    assert refused.status_code == 409
    assert _code(refused) == "ERROR_FIX_NOT_MERGEABLE"
    for blocker in ("PR_NOT_FROM_FIXER", "PR_NOT_LABELLED", "CHECKS_PENDING"):
        assert blocker in refused.json()["detail"]
    assert _tasks("merge_error_fix") == []

    # The task re-checks GitHub even when the API let it through.
    from crate.worker_handlers.error_fixes import merge_fix

    result = merge_fix(
        "task-merge",
        {"run_id": run_id, "head_sha": sha, "actor_id": _admin_id()},
        client_factory=repo.factory,
    )
    assert result["error_code"] == "ERROR_FIX_NOT_MERGEABLE"
    assert set(result["blockers"]) >= {"PR_NOT_FROM_FIXER", "PR_NOT_LABELLED"}
    assert _audits("error_issue.fix.merge_approved") == []

    configure()
    off = api.post(url, json={"head_sha": sha})
    assert (off.status_code, _code(off)) == (409, "ERROR_FIX_NOT_CONFIGURED")


# -- Discard --------------------------------------------------------------------------


def test_discard_closes_the_pull_request_and_deletes_its_branch(api):
    configure_fix()
    issue_id = _seed_issue()
    repo = FakeGitHubRepo()
    run_id, raw = _open_pull(repo, issue_id, draft=True)
    url = f"{BASE}/{issue_id}/fix-runs/{run_id}/discard"

    api.session["caps"] = {VIEW}
    assert api.post(url).status_code == 403
    api.session["caps"] = {VIEW, MANAGE}
    assert api.post(url).status_code == 202
    assert _tasks("discard_error_fix") == [{"run_id": run_id, "actor_id": _admin_id()}]

    from crate.worker_handlers.error_fixes import discard_fix

    result = discard_fix(
        "task-discard",
        {"run_id": run_id, "actor_id": _admin_id()},
        client_factory=repo.factory,
    )

    assert result == {"status": "succeeded", "run_id": run_id, "cleanup_state": "done"}
    assert raw["state"] == "closed"
    assert raw["head"]["ref"] not in repo.branches
    run = _run(run_id)
    assert (run["status"], run["pr_state"], run["summary"]) == (
        "cancelled",
        "closed",
        "Discarded from Crate.",
    )
    [audit] = _audits("error_issue.fix.discarded")
    assert audit["user_id"] == _admin_id()
    assert audit["details_json"]["pr_number"] == raw["number"]
    assert audit["details_json"]["previous_status"] == "pr_open"

    again = api.post(url)
    assert (again.status_code, _code(again)) == (409, "ERROR_FIX_RUN_CLOSED")
    detail = api.get(f"{BASE}/{issue_id}").json()
    assert detail["fix_runs"][0]["review"]["can_discard"] is False


def test_discard_before_a_pull_request_cancels_the_run(api):
    from crate.worker_handlers.error_fixes import discard_fix

    configure_fix()
    issue_id = _seed_issue()
    repo = FakeGitHubRepo()
    run_id = _launch(repo, issue_id)
    workflow_run = repo.add_run(SHORT_ID)
    _track(repo)
    assert _run(run_id)["status"] == "running"

    result = discard_fix(
        "task-discard",
        {"run_id": run_id, "actor_id": _admin_id()},
        client_factory=repo.factory,
    )

    assert result["status"] == "succeeded"
    assert repo.runs[workflow_run]["conclusion"] == "cancelled"
    assert _run(run_id)["status"] == "cancelled"

    # A run never found on GitHub ends without any call.
    other = _seed_issue("2", shortId="CRATE-API-2")
    second = _launch(repo, other)
    calls = len(repo.requests)
    result = discard_fix(
        "task-discard-2",
        {"run_id": second, "actor_id": _admin_id()},
        client_factory=repo.factory,
    )
    assert result["status"] == "succeeded"
    assert len(repo.requests) == calls
    assert _run(second)["summary"].startswith("Discarded before its run was found")


def test_discard_refuses_pull_requests_crate_did_not_open(api):
    from crate.worker_handlers.error_fixes import discard_fix

    configure_fix()
    issue_id = _seed_issue()
    repo = FakeGitHubRepo()
    run_id, raw = _open_pull(repo, issue_id)
    raw["user"]["login"] = "a-maintainer"

    result = discard_fix(
        "task-discard",
        {"run_id": run_id, "actor_id": _admin_id()},
        client_factory=repo.factory,
    )

    assert result["error_code"] == "ERROR_FIX_NOT_DISCARDABLE"
    assert result["expected"] is True
    assert raw["state"] == "open"
    assert raw["head"]["ref"] in repo.branches
    assert "PATCH" not in {request.method for request in repo.requests}
    assert _run(run_id)["status"] == "pr_open"


# -- the inbox ------------------------------------------------------------------------


def test_pending_review_lane_and_summary(api):
    configure_fix()
    with_pr = _seed_issue()
    _seed_issue("2", shortId="CRATE-API-2")
    repo = FakeGitHubRepo()
    _open_pull(repo, with_pr, draft=True)

    review = api.get(BASE, params={"lane": "review"}).json()["items"]
    assert [item["id"] for item in review] == [with_pr]
    assert review[0]["fix_status"] == "pr_open"
    everything = {
        item["short_id"]: item["fix_status"] for item in api.get(BASE).json()["items"]
    }
    assert everything == {SHORT_ID: "pr_open", "CRATE-API-2": None}
    assert api.get(f"{BASE}/summary").json()["pending_review"] == 1
    assert api.get(BASE, params={"lane": "nope"}).status_code == 400


def test_no_github_call_from_the_api(api, monkeypatch):
    configure_fix()
    issue_id = _seed_issue()
    repo = FakeGitHubRepo()
    run_id, raw = _open_pull(repo, issue_id)

    def refuse(*args, **kwargs):
        raise AssertionError("An API handler built a GitHub client")

    monkeypatch.setattr("crate.error_inbox.github_client.GitHubClient.__init__", refuse)
    assert api.get(f"{BASE}/{issue_id}").status_code == 200
    assert api.get(BASE, params={"lane": "review"}).status_code == 200
    merge = api.post(
        f"{BASE}/{issue_id}/fix-runs/{run_id}/merge",
        json={"head_sha": raw["head"]["sha"]},
    )
    assert merge.status_code == 202
    assert api.post(f"{BASE}/{issue_id}/fix-runs/{run_id}/discard").status_code == 202
    for body in (merge.text, api.get(f"{BASE}/{issue_id}").text):
        assert GITHUB_TOKEN not in body

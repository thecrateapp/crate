"""Fix run rules, the GitHub client calls behind them and the executor interface.

No database: GitHub is `FakeGitHubRepo` or a bare `httpx.MockTransport`.
"""

from __future__ import annotations

import json
from dataclasses import replace
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from crate.error_inbox import fix_runs
from crate.error_inbox.fix_runs import (
    CLOSED,
    EXPIRED,
    FAILED,
    MERGED,
    OPEN_STATUSES,
    PR_OPEN,
    REQUESTED,
    RUNNING,
    STATUSES,
    TERMINAL_STATUSES,
    can_transition,
    merge_blockers,
)
from tests.error_inbox_fakes import FIXER, REPOSITORY, FakeGitHubRepo, sha_for

NOW = datetime(2026, 11, 8, 12, 0, tzinfo=timezone.utc)
SHA = sha_for("head")


def _run(**overrides):
    run = {
        "status": PR_OPEN,
        "executor": "github_actions",
        "short_id": "CRATE-API-1F",
        "pr_state": "open",
        "pr_author": FIXER,
        "pr_labeled": True,
        "branch": "autofix/crate-api-1f-123",
        "pr_mergeable": True,
        "pr_mergeable_state": "clean",
        "pr_draft": False,
        "ci_state": "success",
        "merge_requested_at": None,
    }
    run.update(overrides)
    return run


# -- lifecycle ----------------------------------------------------------------------


def test_the_state_machine():
    assert set(STATUSES) == OPEN_STATUSES | TERMINAL_STATUSES
    assert OPEN_STATUSES.isdisjoint(TERMINAL_STATUSES)
    for terminal in TERMINAL_STATUSES:
        assert not any(can_transition(terminal, target) for target in STATUSES)
    assert can_transition(REQUESTED, RUNNING)
    assert can_transition(REQUESTED, PR_OPEN)
    assert can_transition(RUNNING, PR_OPEN)
    assert can_transition(PR_OPEN, MERGED)
    assert can_transition(PR_OPEN, CLOSED)
    # A pull request decides how a run ends; it cannot fail or expire.
    assert not can_transition(PR_OPEN, FAILED)
    assert not can_transition(PR_OPEN, EXPIRED)
    assert not can_transition(PR_OPEN, RUNNING)
    assert not can_transition(RUNNING, REQUESTED)
    # The database admits the same statuses.
    from crate.db.schema_sections.error_fix_runs_v154 import (
        V154_OPEN_STATUSES,
        V154_STATUSES,
    )

    assert V154_STATUSES == ", ".join(f"'{status}'" for status in STATUSES)
    assert set(V154_OPEN_STATUSES.replace("'", "").split(", ")) == OPEN_STATUSES


def test_expiry_windows():
    run = {"status": RUNNING, "requested_at": NOW - timedelta(hours=5)}
    assert not fix_runs.expired(run, NOW)
    assert fix_runs.expired({**run, "requested_at": NOW - timedelta(hours=7)}, NOW)
    assert not fix_runs.expired(
        {"status": PR_OPEN, "requested_at": NOW - timedelta(days=3)}, NOW
    )
    approved = {"merge_requested_at": NOW - timedelta(hours=2)}
    assert not fix_runs.approval_expired(approved, NOW)
    assert fix_runs.approval_expired(
        {"merge_requested_at": NOW - timedelta(hours=4)}, NOW
    )
    assert not fix_runs.approval_expired({"merge_requested_at": None}, NOW)


def test_fix_branches():
    assert fix_runs.branch_prefix("CRATE-API-1F") == "autofix/crate-api-1f-"
    assert fix_runs.fix_branch("CRATE-API-1F", "77") == "autofix/crate-api-1f-77"
    assert fix_runs.is_fix_branch("autofix/crate-api-1f-77", "CRATE-API-1F")
    assert fix_runs.run_id_from_branch("autofix/crate-api-1f-77", "CRATE-API-1F") == (
        "77"
    )
    for branch in (
        "autofix/crate-api-1f-",
        "autofix/crate-api-2-77",
        "autofix/crate-api-1f-77/../main",
        "main",
        "feature/crate-api-1f-77",
        None,
    ):
        assert not fix_runs.is_fix_branch(branch, "CRATE-API-1F"), branch
    assert fix_runs.fixes_line("CRATE-API-1F") == "Fixes CRATE-API-1F"


def test_sanitized_summaries():
    text = "Fixed it.\n\nToken github_pat_abc123 see https://x.example/a?b=c " + (
        "word " * 100
    )
    summary = fix_runs.sanitize_summary(text)
    assert summary is not None
    assert len(summary) <= fix_runs.MAX_SUMMARY_LENGTH
    assert "github_pat_" not in summary
    assert "https://" not in summary
    assert "\n" not in summary
    assert fix_runs.sanitize_summary("   ") is None
    assert fix_runs.sanitize_summary(None) is None
    assert "<email>" in fix_runs.sanitize_summary("mail me at a@b.example")


# -- Approve & merge guards -----------------------------------------------------------


def test_merge_blockers_accept_only_qualifying_pull_requests():
    assert merge_blockers(_run()) == []
    # A draft is accepted unless a check failed: its checks run once it is ready.
    assert merge_blockers(_run(pr_draft=True, ci_state="none")) == []
    assert merge_blockers(_run(pr_draft=True, ci_state="failure")) == ["CHECKS_FAILED"]
    cases = {
        "PR_NOT_FROM_FIXER": {"pr_author": "someone"},
        "PR_NOT_LABELLED": {"pr_labeled": False},
        "PR_BRANCH_UNEXPECTED": {"branch": "main"},
        "PR_CONFLICTS": {"pr_mergeable": False},
        "PR_MERGEABILITY_UNKNOWN": {"pr_mergeable": None},
        "CHECKS_PENDING": {"ci_state": "pending"},
        "CHECKS_FAILED": {"ci_state": "failure"},
        "ALREADY_APPROVED": {"merge_requested_at": NOW},
    }
    for blocker, overrides in cases.items():
        assert merge_blockers(_run(**overrides)) == [blocker], blocker
    assert merge_blockers(_run(ci_state="none")) == ["CHECKS_PENDING"]
    assert merge_blockers(_run(pr_mergeable_state="dirty")) == ["PR_CONFLICTS"]
    assert merge_blockers(_run(status=RUNNING)) == ["FIX_RUN_NOT_OPEN"]
    assert merge_blockers(_run(pr_state="closed")) == ["PR_NOT_OPEN"]
    # An executor without a known GitHub account never qualifies.
    assert "PR_NOT_FROM_FIXER" in merge_blockers(_run(executor="factory"))


def test_discard_is_for_open_runs_only():
    for status in OPEN_STATUSES:
        assert fix_runs.can_discard({"status": status})
    for status in TERMINAL_STATUSES:
        assert not fix_runs.can_discard({"status": status})


# -- the bug a fixer receives ---------------------------------------------------------


def test_bug_payload_carries_no_titles_links_or_raw_events():
    triage_input = {
        "id": "issue-uuid",
        "external_id": "42",
        "short_id": "CRATE-API-1F",
        "title": "IntegrityError for alice@example.com",
        "culprit": "library_pipeline",
        "permalink": "https://ninja.sentry.io/issues/42/",
        "service": "api",
        "level": "error",
        "status": "unresolved",
        "substatus": "regressed",
        "events_24h": 3,
        "first_release": "crate-aaa",
        "last_release": "crate-bbb",
        "digest": {
            "v": 1,
            "exceptions": [{"type": "IntegrityError", "value": "duplicate key"}],
            "frames": [{"module": "crate.db", "function": "upsert"}],
        },
        "candidates": [
            {
                "short_id": "CRATE-API-2",
                "same_group": True,
                "exception": {"type": "IntegrityError", "value": "dup"},
                "top_frame": {"module": "crate.db", "function": "upsert"},
                "title": "never sent",
            }
        ],
        "current_triage": {
            "classification": "bug",
            "severity": "high",
            "summary": "Duplicate insert.",
            "hypothesis": "Race.",
            "confidence": 0.8,
            "next_step": "not part of the contract",
        },
    }

    payload = fix_runs.bug_payload(triage_input)

    assert payload["version"] == 1
    assert payload["issue"]["short_id"] == "CRATE-API-1F"
    assert payload["releases"] == {"first": "crate-aaa", "last": "crate-bbb"}
    assert payload["digest"]["frames"][0]["index"] == 0
    assert payload["candidates"][0]["short_id"] == "CRATE-API-2"
    assert payload["triage"] == {
        "classification": "bug",
        "severity": "high",
        "summary": "Duplicate insert.",
        "hypothesis": "Race.",
        "confidence": 0.8,
    }
    serialized = json.dumps(payload)
    for forbidden in ("alice@example.com", "library_pipeline", "sentry.io", "never"):
        assert forbidden not in serialized
    assert "external_id" not in payload["issue"]
    assert fix_runs.bug_payload({"short_id": "X"})["digest"] is None


# -- checks and pull requests ---------------------------------------------------------


def test_ci_state_combines_check_runs_and_statuses():
    from crate.error_inbox.pull_requests import ci_state

    def check(status="completed", conclusion="success", started=NOW):
        return {
            "status": status,
            "conclusion": conclusion,
            "started_at": started.isoformat().replace("+00:00", "Z"),
        }

    none = {"state": "pending", "total_count": 0}
    assert ci_state([], none) == "none"
    assert ci_state([check(), check(conclusion="skipped")], none) == "success"
    assert ci_state([check(), check(status="in_progress", conclusion=None)], none) == (
        "pending"
    )
    assert ci_state([check(), check(conclusion="timed_out")], none) == "failure"
    assert ci_state([check(conclusion="cancelled")], none) == "failure"
    assert ci_state([check()], {"state": "failure", "total_count": 1}) == "failure"
    assert ci_state([check()], {"state": "pending", "total_count": 2}) == "pending"
    assert ci_state([], {"state": "success", "total_count": 1}) == "success"
    # After a draft is marked ready, only checks started since then count.
    old = check(conclusion="skipped", started=NOW - timedelta(hours=1))
    assert ci_state([old], none, since=NOW) == "pending"
    assert ci_state(
        [old, check(started=NOW + timedelta(seconds=5))], none, since=NOW
    ) == ("success")


def test_parse_pull_keeps_only_safe_fields():
    from crate.error_inbox.github_client import GitHubResponseError
    from crate.error_inbox.pull_requests import parse_pull

    repo = FakeGitHubRepo()
    raw = repo.add_pull("CRATE-API-1F", 77, labels=("autofix", "bug"))
    pull = parse_pull(raw)
    assert (pull.number, pull.state, pull.draft, pull.labeled) == (
        raw["number"],
        "open",
        True,
        True,
    )
    assert pull.head_repository == REPOSITORY
    assert pull.author == FIXER

    merged = parse_pull({**raw, "state": "closed", "merged_at": "2026-11-08T10:00:00Z"})
    assert merged.state == "merged"
    hostile = parse_pull(
        {
            **raw,
            "html_url": "javascript:alert(1)",
            "head": {"sha": "nope", "ref": "x"},
            "mergeable": "yes",
        }
    )
    assert (hostile.url, hostile.head_sha, hostile.mergeable) == (None, None, None)
    with pytest.raises(GitHubResponseError):
        parse_pull({"number": True})


# -- the GitHub client ----------------------------------------------------------------


def _client(handler):
    from crate.error_inbox.github_client import GitHubClient

    return GitHubClient("github_pat_test", transport=httpx.MockTransport(handler))


def test_client_maps_review_answers_to_typed_errors():
    from crate.error_inbox import github_client as gh

    with _client(lambda request: httpx.Response(405, json={})) as client:
        with pytest.raises(gh.GitHubNotMergeableError):
            client.merge_pull(REPOSITORY, 3, sha=SHA)
    with _client(lambda request: httpx.Response(409, json={})) as client:
        with pytest.raises(gh.GitHubConflictError):
            client.merge_pull(REPOSITORY, 3, sha=SHA)
        assert client.cancel_workflow_run(REPOSITORY, 9) is False
    with _client(lambda request: httpx.Response(422, json={})) as client:
        assert client.delete_branch(REPOSITORY, "autofix/crate-api-1-9") is False
    with _client(lambda request: httpx.Response(403, json={})) as client:
        with pytest.raises(gh.GitHubForbiddenError) as forbidden:
            client.delete_branch(REPOSITORY, "autofix/crate-api-1-9")
    assert "Contents write" in str(forbidden.value)
    with _client(lambda request: httpx.Response(302)) as client:
        with pytest.raises(gh.GitHubUnavailableError):
            client.get_pull(REPOSITORY, 3)


def test_client_refuses_invalid_input_before_calling():
    calls = []

    def record(request):
        calls.append(request)
        return httpx.Response(200, json={})

    with _client(record) as client:
        for call in (
            lambda: client.merge_pull(REPOSITORY, 3, sha="abc"),
            lambda: client.merge_pull(REPOSITORY, 3, sha=SHA, method="force"),
            lambda: client.merge_pull("owner/../x", 3, sha=SHA),
            lambda: client.get_pull(REPOSITORY, 0),
            lambda: client.get_pull(REPOSITORY, True),
            lambda: client.delete_branch(REPOSITORY, "autofix/../main"),
            lambda: client.delete_branch(REPOSITORY, "x/"),
            lambda: client.list_check_runs(REPOSITORY, "HEAD"),
            lambda: client.mark_ready_for_review("bad id!"),
        ):
            with pytest.raises(ValueError):
                call()
    assert calls == []


def test_client_reads_bounded_json():
    from crate.error_inbox import github_client as gh

    huge = b"[" + b"0," * (gh.MAX_RESPONSE_BYTES // 2) + b"0]"
    with _client(lambda request: httpx.Response(200, content=huge)) as client:
        with pytest.raises(gh.GitHubResponseError) as large:
            client.list_pulls(REPOSITORY)
    assert large.value.code == "GITHUB_RESPONSE_TOO_LARGE"
    with _client(lambda request: httpx.Response(200, content=b"<html>")) as client:
        with pytest.raises(gh.GitHubResponseError):
            client.get_pull(REPOSITORY, 3)
    with _client(lambda request: httpx.Response(200, json=[1, 2])) as client:
        with pytest.raises(gh.GitHubResponseError):
            client.get_pull(REPOSITORY, 3)


def test_check_runs_are_paged_at_most_three_times():
    pages = []

    def handler(request):
        pages.append(int(request.url.params["page"]))
        assert request.url.params["filter"] == "latest"
        runs = [{"status": "completed", "conclusion": "success"}] * 100
        return httpx.Response(200, json={"total_count": 1000, "check_runs": runs})

    with _client(handler) as client:
        assert len(client.list_check_runs(REPOSITORY, SHA)) == 300
    assert pages == [1, 2, 3]


def test_ready_for_review_uses_graphql_and_maps_its_errors():
    from crate.error_inbox import github_client as gh

    repo = FakeGitHubRepo()
    pull = repo.add_pull("CRATE-API-1F", 77)
    with repo.factory("github_pat_test") as client:
        client.mark_ready_for_review(pull["node_id"])
        assert pull["draft"] is False
        [request] = repo.requests
        assert request.url.path == "/graphql"
        body = json.loads(request.content)
        assert "markPullRequestReadyForReview" in body["query"]
        assert body["variables"] == {"id": pull["node_id"]}

        repo.graphql_errors = [{"type": "FORBIDDEN", "message": "Resource not"}]
        with pytest.raises(gh.GitHubForbiddenError):
            client.mark_ready_for_review(pull["node_id"])
        repo.graphql_errors = [{"message": "other"}]
        with pytest.raises(gh.GitHubValidationError):
            client.mark_ready_for_review(pull["node_id"])


# -- executors ------------------------------------------------------------------------


def _fix_settings(**overrides):
    from crate.error_inbox.config import FixSettings

    return FixSettings(
        repository=REPOSITORY,
        workflow="error-autofix.yml",
        secret_ref="ref",
        **overrides,
    )


def test_github_actions_executor_finds_its_run_and_pull_request():
    from crate.error_inbox.executors import GitHubActionsExecutor

    repo = FakeGitHubRepo()
    requested_at = datetime.now(timezone.utc)
    repo.add_run("CRATE-API-1F", created_at=requested_at - timedelta(hours=3))
    repo.add_run("CRATE-API-2")
    mine = repo.add_run("CRATE-API-1F")
    run = {"short_id": "CRATE-API-1F", "requested_at": requested_at}
    with repo.factory("github_pat_test") as client:
        executor = GitHubActionsExecutor(_fix_settings(), client)
        assert executor.pr_author == FIXER
        assert executor.sends_payload is False

        observed = executor.refresh(run)
        assert (observed.state, observed.external_run_id) == ("running", str(mine))
        assert observed.pull_number is None

        pull = repo.add_pull("CRATE-API-1F", mine)
        observed = executor.refresh({**run, "external_run_id": str(mine)})
        assert observed.pull_number == pull["number"]
        assert observed.branch == pull["head"]["ref"]
        # The exact branch is asked for once the run is known.
        assert repo.requests[-1].url.params["head"] == (
            f"thecrateapp:autofix/crate-api-1f-{mine}"
        )

        repo.finish_run(mine, "failure")
        assert executor.refresh({**run, "external_run_id": str(mine)}).state == (
            "failed"
        )
        assert executor.cancel({"external_run_id": str(mine)}) is False
        assert executor.cancel({"external_run_id": None}) is False


def test_github_actions_executor_submits_only_the_short_id_and_note():
    from crate.error_inbox.autofix import AutofixInputError
    from crate.error_inbox.executors import FixBug, GitHubActionsExecutor

    repo = FakeGitHubRepo()
    bug = FixBug(
        run_id="run",
        issue_id="issue",
        short_id="CRATE-API-1F",
        note="Look at the pool.",
        repository=REPOSITORY,
        base_ref="main",
        payload={"digest": "never sent"},
    )
    with repo.factory("github_pat_test") as client:
        executor = GitHubActionsExecutor(_fix_settings(), client)
        submission = executor.submit(bug)
        assert submission.external_run_id is None
        [request] = repo.requests
        assert json.loads(request.content) == {
            "ref": "main",
            "inputs": {"sentry_issue": "CRATE-API-1F", "note": "Look at the pool."},
        }
        with pytest.raises(AutofixInputError):
            executor.submit(replace(bug, short_id="MYAPP-1"))
        assert len(repo.requests) == 1


def test_only_available_executors_are_built():
    from crate.error_inbox.config import ErrorTrackingConfigError
    from crate.error_inbox.executors import GitHubActionsExecutor, build_executor

    repo = FakeGitHubRepo()
    with repo.factory("github_pat_test") as client:
        assert isinstance(
            build_executor(_fix_settings(), client), GitHubActionsExecutor
        )
        with pytest.raises(ErrorTrackingConfigError) as unavailable:
            build_executor(_fix_settings(executor="factory"), client)
    assert unavailable.value.code == "ERROR_FIX_EXECUTOR_UNAVAILABLE"


def test_fix_executor_setting():
    from crate.error_inbox.config import ErrorTrackingConfigError, parse_config

    base = {
        "organization": "ninja-development",
        "fix": {"repository": REPOSITORY, "workflow": "error-autofix.yml"},
    }
    config = parse_config(base)
    assert config.fix is not None
    assert config.fix.executor == "github_actions"
    assert config.to_settings()["fix"]["executor"] == "github_actions"
    assert parse_config(config.to_settings()).fix == config.fix
    for executor, message in (("factory", "not available"), ("cron", "must be one")):
        with pytest.raises(ErrorTrackingConfigError) as refused:
            parse_config({**base, "fix": {**base["fix"], "executor": executor}})
        assert message in refused.value.message


def test_the_workflow_names_its_runs_after_the_short_id():
    from pathlib import Path

    from crate.error_inbox.executors import RUN_NAME_PREFIX

    workflow = (
        Path(__file__).resolve().parents[2] / ".github/workflows/error-autofix.yml"
    ).read_text()
    assert f"run-name: {RUN_NAME_PREFIX}${{{{ inputs.sentry_issue }}}}" in workflow
    assert 'branch="autofix/${SENTRY_ISSUE,,}-${GITHUB_RUN_ID}"' in workflow
    assert "--add-label autofix" in workflow
    assert 'grep -qxF "Fixes $SENTRY_ISSUE"' in workflow

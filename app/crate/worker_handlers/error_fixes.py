"""Error fix tasks: Launch fix, the tracking of fix runs and the review of their
pull requests. Only these tasks talk to GitHub for the error inbox; the admin API
reads PostgreSQL and queues them.

- `dispatch_error_fix` (fast, 30 s, no retries): a person pressed Launch fix. It
  claims the issue (at most once every 24 hours, one open run per issue), opens a
  fix run and hands the bug to the executor `fix.executor` names, once. A refused
  submission fails the run and gives the claim back.
- `track_error_fixes` (maintenance, 120 s, scheduled every 5 minutes while a run is
  open or has a branch to delete): follows each run to its pull request and records
  its state, draft or ready, mergeability and the combined state of its checks.
  Runs move to `merged` or `closed` with their pull request; runs with no pull
  request after `NO_PR_EXPIRY` expire. It merges approved pull requests once their
  checks pass and deletes the branches of finished runs.
- `merge_error_fix` (fast, 60 s): Approve & merge. Re-reads the pull request and
  refuses unless it still is the commit the person approved, from the executor's
  GitHub account, labelled `autofix`, on a fix branch, mergeable and, when ready,
  green. A draft is marked ready for review; its checks only run then, so the
  tracker merges it once they pass. GitHub enforces branch protection on the merge.
- `discard_error_fix` (fast, 60 s): closes the pull request and deletes its branch,
  or cancels a run that has none yet, and marks the run cancelled.

Every merge and discard is audited with the person who asked. Tokens never reach a
log, a result or a run; neither do response bodies.
"""

from __future__ import annotations

import logging
import time
from collections import Counter
from collections.abc import Callable, Mapping
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from typing import Any

from crate.db.queries.error_fix_runs import get_fix_run, trackable_fix_runs
from crate.db.queries.error_issues import get_issue, get_triage_input
from crate.db.repositories.error_fix_runs import (
    audit_fix_run,
    clear_merge_approval,
    record_merge_approval,
    start_fix_run,
    update_fix_run,
)
from crate.db.repositories.error_issues import audit_fix_request, release_fix_request
from crate.error_inbox.autofix import (
    MAX_NOTE_LENGTH,
    REQUEST_COOLDOWN,
    AutofixInputError,
    workflow_inputs,
)
from crate.error_inbox.config import (
    ErrorTrackingConfig,
    ErrorTrackingConfigError,
    FixSettings,
    load_config,
    load_github_token,
)
from crate.error_inbox.executors import FixBug, FixExecutor, build_executor
from crate.error_inbox.fix_runs import (
    CANCELLED,
    CLEANUP_EXPIRY,
    CLOSED,
    EXPIRED,
    FAILED,
    MERGED,
    PR_AUTHORS,
    PR_OPEN,
    REQUESTED,
    RUNNING,
    approval_expired,
    bug_payload,
    can_discard,
    expired,
    is_fix_branch,
    merge_blockers,
    sanitize_summary,
    valid_sha,
)
from crate.error_inbox.github_client import (
    GitHubAPIError,
    GitHubAuthError,
    GitHubClient,
    GitHubConflictError,
    GitHubForbiddenError,
    GitHubNotMergeableError,
    GitHubRateLimitedError,
)
from crate.error_inbox.pull_requests import (
    PullRequestState,
    github_url,
    observe,
    parse_pull,
)
from crate.worker_handlers import TaskHandler, is_cancelled

log = logging.getLogger(__name__)

GitHubClientFactory = Callable[[str], GitHubClient]

# Leaves room under the 120 s task limit to record what was read.
TRACK_BUDGET_SECONDS = 90.0
# The repository merges pull requests with merge commits.
MERGE_METHOD = "merge"

# Failures the Errors page explains; the task still fails, the worker does not
# report it to Sentry.
EXPECTED_FAILURE_CODES = frozenset(
    {
        "ERROR_FIX_ALREADY_APPROVED",
        "ERROR_FIX_EXECUTOR_UNAVAILABLE",
        "ERROR_FIX_HEAD_CHANGED",
        "ERROR_FIX_IN_PROGRESS",
        "ERROR_FIX_NOT_CONFIGURED",
        "ERROR_FIX_NOT_DISCARDABLE",
        "ERROR_FIX_NOT_MERGEABLE",
        "ERROR_FIX_RECENTLY_REQUESTED",
        "ERROR_FIX_RUN_CLOSED",
        "ERROR_FIX_RUN_NOT_FOUND",
        "ERROR_FIX_UNSUPPORTED_ISSUE",
        "ERROR_ISSUE_NOT_FOUND",
        "ERROR_TRACKING_INVALID",
        "GITHUB_AUTH",
        "GITHUB_CONFLICT",
        "GITHUB_FORBIDDEN",
        "GITHUB_NOT_FOUND",
        "GITHUB_NOT_MERGEABLE",
        "GITHUB_RATE_LIMITED",
        "GITHUB_REDIRECT",
        "GITHUB_SERVER",
        "GITHUB_TIMEOUT",
        "GITHUB_UNAVAILABLE",
        "GITHUB_VALIDATION",
    }
)

# Run summaries Crate writes; the admin shows them as they are.
SUMMARY = {
    "dispatch_failed": "The fixer could not be started.",
    "no_fix": "The fixer finished without proposing a change.",
    "run_failed": "The fixer's run failed before it opened a pull request.",
    "run_cancelled": "The fixer's run was cancelled outside Crate.",
    "expired": "No pull request appeared within 6 hours.",
    "merged": "Merged on GitHub.",
    "merged_by_crate": "Merged from Crate after the checks passed.",
    "closed": "Closed on GitHub without merging.",
    "discarded": "Discarded from Crate.",
    "discarded_early": (
        "Discarded before its run was found. If a pull request appears, close it "
        "on GitHub."
    ),
    "head_changed": "New commits arrived after the approval. Review and approve again.",
    "approval_expired": "The checks did not pass within 3 hours of the approval.",
    "checks_failed": "Checks failed after the approval. Nothing was merged.",
    "conflicts": "The pull request has conflicts. Nothing was merged.",
    "merge_refused": (
        "GitHub refused the merge: branch protection, checks or conflicts. "
        "Nothing was merged."
    ),
    "merge_forbidden": (
        "The GitHub token cannot merge (it needs Pull requests and Contents write)."
    ),
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _failed(code: str, message: str, **extra: Any) -> dict[str, Any]:
    return {
        "status": "failed",
        "error_code": code,
        "error": message,
        "expected": code in EXPECTED_FAILURE_CODES,
        **extra,
    }


@dataclass(frozen=True, slots=True)
class _Setup:
    config: ErrorTrackingConfig
    fix: FixSettings
    token: str


def _setup() -> _Setup:
    """The Launch fix settings and token, or a typed configuration error."""
    config = load_config()
    if config is None or config.fix is None:
        raise ErrorTrackingConfigError(
            "ERROR_FIX_NOT_CONFIGURED", "Launch fix is not configured"
        )
    return _Setup(config=config, fix=config.fix, token=load_github_token(config))


def _executor_for(
    run: Mapping[str, Any], fix: FixSettings, client: GitHubClient
) -> FixExecutor:
    """The executor that started `run`, on the repository it started in."""
    return build_executor(
        replace(fix, executor=str(run["executor"]), repository=str(run["repository"])),
        client,
    )


# -- Launch fix ---------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class _FixRequest:
    issue_id: str
    note: str
    actor_id: int


def _actor(params: Mapping[str, Any]) -> int:
    actor_id = params.get("actor_id")
    if isinstance(actor_id, bool) or not isinstance(actor_id, int):
        raise ValueError("Invalid actor")
    return actor_id


def _fix_request(params: Mapping[str, Any]) -> _FixRequest:
    issue_id = params.get("issue_id")
    note = params.get("note", "")
    if (
        not isinstance(issue_id, str)
        or not isinstance(note, str)
        or len(note) > MAX_NOTE_LENGTH
    ):
        raise ValueError("Invalid fix request")
    return _FixRequest(issue_id=issue_id, note=note, actor_id=_actor(params))


_REFUSALS = {
    "not_found": ("ERROR_ISSUE_NOT_FOUND", "The issue is no longer in the inbox"),
    "recently_requested": (
        "ERROR_FIX_RECENTLY_REQUESTED",
        "A fix for this issue was launched less than 24 hours ago",
    ),
    "in_progress": (
        "ERROR_FIX_IN_PROGRESS",
        "This issue already has a fix in progress; discard it first",
    ),
}


def dispatch_fix(
    task_id: str,
    params: Mapping[str, Any],
    *,
    client_factory: GitHubClientFactory | None = None,
) -> dict[str, Any]:
    """Open a fix run for one issue and submit it to the executor, once.

    The issue is claimed and the run opened before GitHub is called, so a second
    launch cannot pass while the first is in flight; a refused submission fails
    the run and releases the claim. The workflow executor sends only the short id
    and the note.
    """
    try:
        request = _fix_request(params)
    except ValueError:
        return _failed("ERROR_FIX_INVALID_REQUEST", "Invalid fix request")
    issue = get_issue(request.issue_id)
    if issue is None:
        return _failed("ERROR_ISSUE_NOT_FOUND", "The issue is no longer in the inbox")
    try:
        setup = _setup()
        # The workflow's own checks of the short id and note, before anything else.
        workflow_inputs(issue["short_id"], request.note)
    except (ErrorTrackingConfigError, AutofixInputError) as error:
        return _failed(error.code, error.message)
    fix = setup.fix

    requested_at = _now()
    started = start_fix_run(
        request.issue_id,
        user_id=request.actor_id,
        executor=fix.executor,
        repository=fix.repository,
        base_ref=fix.ref,
        at=requested_at,
        cooldown=REQUEST_COOLDOWN,
    )
    if "refused" in started:
        return _failed(*_REFUSALS[started["refused"]])
    run_id = str(started["run_id"])

    def give_back(code: str) -> None:
        update_fix_run(
            run_id,
            {
                "status": FAILED,
                "error_code": code[:64],
                "summary": SUMMARY["dispatch_failed"],
                "finished_at": _now(),
            },
            expected_status=REQUESTED,
        )
        release_fix_request(
            request.issue_id,
            requested_at=requested_at,
            previous_at=started["previous_at"],
            previous_by=started["previous_by"],
        )

    try:
        with (client_factory or GitHubClient)(setup.token) as client:
            executor = build_executor(fix, client)
            payload = None
            if executor.sends_payload:
                triage_input = get_triage_input(request.issue_id)
                payload = bug_payload(triage_input) if triage_input else None
            submission = executor.submit(
                FixBug(
                    run_id=run_id,
                    issue_id=request.issue_id,
                    short_id=issue["short_id"],
                    note=request.note,
                    repository=fix.repository,
                    base_ref=fix.ref,
                    payload=payload,
                )
            )
    except (GitHubAPIError, ErrorTrackingConfigError) as error:
        # Includes timeouts, where GitHub may have started the run: the person can
        # try again at once and the workflow's concurrency group queues a repeat.
        log.warning("Launch fix dispatch failed: %s", error.code)
        give_back(error.code)
        return _failed(error.code, str(error), run_id=run_id)
    except Exception:
        give_back("ERROR_FIX_DISPATCH_FAILED")
        raise
    known = {
        key: value
        for key, value in (
            ("external_run_id", submission.external_run_id),
            ("external_run_url", github_url(submission.external_run_url)),
        )
        if value
    }
    if known:
        update_fix_run(run_id, known, expected_status=REQUESTED)
    audit_fix_request(
        request.issue_id,
        actor_id=request.actor_id,
        task_id=task_id,
        at=requested_at,
        details={
            "issue_id": request.issue_id,
            "provider": issue["provider"],
            "external_id": issue["external_id"],
            "run_id": run_id,
            "executor": fix.executor,
            "repository": fix.repository,
            "workflow": fix.workflow,
            "ref": fix.ref,
            "has_note": bool(request.note),
        },
    )
    return {
        "status": "succeeded",
        "issue_id": request.issue_id,
        "short_id": issue["short_id"],
        "run_id": run_id,
        "requested_at": requested_at.isoformat(),
        "actions_url": fix.actions_url,
    }


# -- tracking -----------------------------------------------------------------------


def _pull_fields(pull: PullRequestState, ci: str | None) -> dict[str, Any]:
    return {
        "pr_number": pull.number,
        "pr_url": pull.url,
        "pr_state": pull.state,
        "pr_draft": pull.draft,
        "pr_mergeable": pull.mergeable,
        "pr_mergeable_state": pull.mergeable_state,
        "pr_head_sha": pull.head_sha,
        "pr_author": pull.author,
        "pr_labeled": pull.labeled,
        "branch": pull.head_ref,
        "ci_state": ci,
    }


def _own_branch(run: Mapping[str, Any], pull: PullRequestState | None = None) -> bool:
    """A branch Crate may delete: named after the issue, in the run's repository."""
    branch = pull.head_ref if pull is not None else run.get("branch")
    same_repository = (
        pull is None or pull.head_repository is None
    ) or pull.head_repository == run.get("repository")
    return same_repository and is_fix_branch(branch, str(run.get("short_id") or ""))


class _Tracker:
    def __init__(
        self,
        task_id: str,
        setup: _Setup,
        client: GitHubClient,
        now: Callable[[], datetime],
    ) -> None:
        self.task_id = task_id
        self.setup = setup
        self.client = client
        self.now = now
        self.counts: Counter[str] = Counter()

    def track(self, run: Mapping[str, Any]) -> None:
        """One look at a run. A pull request found now is followed from the next pass."""
        status = run["status"]
        if status in {REQUESTED, RUNNING}:
            self._follow_run(run)
        elif status == PR_OPEN:
            self._follow_pull(run)
        elif run.get("cleanup_state") == "pending":
            self._cleanup(run)

    def _follow_run(self, run: Mapping[str, Any]) -> None:
        executor = _executor_for(run, self.setup.fix, self.client)
        observation = executor.refresh(run)
        now = self.now()
        changes: dict[str, Any] = {"checked_at": now, "error_code": None}
        if observation.external_run_id:
            changes["external_run_id"] = observation.external_run_id[:128]
        if observation.external_run_url:
            changes["external_run_url"] = github_url(observation.external_run_url)
        if observation.summary:
            # Written by the fixer: only a short, sanitized sentence is kept.
            changes["summary"] = sanitize_summary(observation.summary)
        if observation.pull_number:
            pull, ci = observe(
                self.client, str(run["repository"]), observation.pull_number
            )
            changes.update(_pull_fields(pull, ci))
            changes.update(
                status=PR_OPEN,
                started_at=run.get("started_at") or now,
                pr_opened_at=pull.created_at or now,
            )
            self.counts["pr_opened"] += 1
        elif observation.state == "succeeded":
            changes.update(
                status=FAILED,
                error_code="FIX_NOT_PROPOSED",
                summary=SUMMARY["no_fix"],
                finished_at=now,
            )
            self.counts["failed"] += 1
        elif observation.state == "failed":
            changes.update(
                status=FAILED,
                error_code="FIX_RUN_FAILED",
                summary=SUMMARY["run_failed"],
                finished_at=now,
            )
            self.counts["failed"] += 1
        elif observation.state == "cancelled":
            changes.update(
                status=CANCELLED, summary=SUMMARY["run_cancelled"], finished_at=now
            )
            self.counts["cancelled"] += 1
        elif expired(run, now):
            if observation.state == "running":
                try:
                    executor.cancel({**run, **changes})
                except GitHubAPIError as error:
                    log.info("Could not cancel an expired fix run: %s", error.code)
            changes.update(
                status=EXPIRED,
                error_code="FIX_NO_PULL_REQUEST",
                summary=SUMMARY["expired"],
                finished_at=now,
            )
            self.counts["expired"] += 1
        elif observation.state == "running" and run["status"] == REQUESTED:
            changes.update(status=RUNNING, started_at=now)
            self.counts["running"] += 1
        update_fix_run(str(run["id"]), changes, expected_status=run["status"])

    def _follow_pull(self, run: Mapping[str, Any]) -> None:
        now = self.now()
        pull, ci = observe(
            self.client,
            str(run["repository"]),
            int(run["pr_number"]),
            checks_since=run.get("ready_at"),
        )
        changes: dict[str, Any] = {**_pull_fields(pull, ci), "checked_at": now}
        if pull.state in {"merged", "closed"}:
            merged = pull.state == "merged"
            changes.update(
                status=MERGED if merged else CLOSED,
                summary=SUMMARY["merged" if merged else "closed"],
                finished_at=now,
                cleanup_state="pending" if _own_branch(run, pull) else "none",
            )
            self.counts["merged" if merged else "closed"] += 1
            if update_fix_run(str(run["id"]), changes, expected_status=PR_OPEN):
                self._cleanup({**run, **changes})
            return
        update_fix_run(str(run["id"]), changes, expected_status=PR_OPEN)
        if run.get("merge_requested_at") is not None:
            self._merge_approved({**run, **changes}, pull, ci)

    def _drop_approval(self, run: Mapping[str, Any], code: str, summary: str) -> None:
        clear_merge_approval(str(run["id"]), error_code=code, summary=summary)
        self.counts["approvals_dropped"] += 1

    def _merge_approved(
        self, run: Mapping[str, Any], pull: PullRequestState, ci: str | None
    ) -> None:
        """Merge an approved pull request once its checks pass, or drop the approval."""
        if pull.head_sha != run.get("merge_sha"):
            self._drop_approval(run, "FIX_HEAD_CHANGED", SUMMARY["head_changed"])
            return
        if ci == "failure":
            self._drop_approval(run, "FIX_CHECKS_FAILED", SUMMARY["checks_failed"])
            return
        if pull.mergeable is False:
            self._drop_approval(run, "FIX_CONFLICTS", SUMMARY["conflicts"])
            return
        if approval_expired(run, self.now()):
            self._drop_approval(
                run, "FIX_APPROVAL_EXPIRED", SUMMARY["approval_expired"]
            )
            return
        if pull.draft and pull.node_id:
            # The approval asked for it; try again if marking it ready failed.
            self.client.mark_ready_for_review(pull.node_id)
            return
        if ci != "success" or pull.mergeable is not True:
            return
        merge(self.client, run, pull, task_id=self.task_id, now=self.now())
        self.counts["merged"] += 1

    def _cleanup(self, run: Mapping[str, Any]) -> None:
        """Delete the branch of a finished run; give up after `CLEANUP_EXPIRY`."""
        state = _delete_branch(self.client, run)
        finished_at = run.get("finished_at")
        if (
            state == "pending"
            and isinstance(finished_at, datetime)
            and self.now() - finished_at > CLEANUP_EXPIRY
        ):
            state = "failed"
        update_fix_run(
            str(run["id"]),
            {"cleanup_state": state, "checked_at": self.now()},
        )
        self.counts[f"cleanup_{state}"] += 1


def _delete_branch(client: GitHubClient, run: Mapping[str, Any]) -> str:
    """`done`, `failed` (the token may not delete branches) or `pending` (retry)."""
    if not _own_branch(run):
        return "none"
    try:
        client.delete_branch(str(run["repository"]), str(run["branch"]))
    except (GitHubForbiddenError, GitHubAuthError):
        return "failed"
    except GitHubAPIError as error:
        log.info("Could not delete a fix branch yet: %s", error.code)
        return "pending"
    return "done"


def merge(
    client: GitHubClient,
    run: Mapping[str, Any],
    pull: PullRequestState,
    *,
    task_id: str,
    now: datetime,
) -> bool:
    """Merge the approved commit; GitHub refuses if anything moved or blocks it.

    Returns True when merged. A refusal drops the approval with the reason.
    """
    run_id = str(run["id"])
    sha = str(run["merge_sha"])
    try:
        client.merge_pull(
            str(run["repository"]), pull.number, sha=sha, method=MERGE_METHOD
        )
    except GitHubConflictError:
        clear_merge_approval(
            run_id, error_code="FIX_HEAD_CHANGED", summary=SUMMARY["head_changed"]
        )
        return False
    except GitHubNotMergeableError:
        clear_merge_approval(
            run_id, error_code="FIX_MERGE_REFUSED", summary=SUMMARY["merge_refused"]
        )
        return False
    except (GitHubForbiddenError, GitHubAuthError) as error:
        clear_merge_approval(
            run_id, error_code=error.code, summary=SUMMARY["merge_forbidden"]
        )
        return False
    update_fix_run(
        run_id,
        {
            "status": MERGED,
            "pr_state": "merged",
            "summary": SUMMARY["merged_by_crate"],
            "error_code": None,
            "finished_at": now,
            "checked_at": now,
            "cleanup_state": "pending" if _own_branch(run, pull) else "none",
        },
        expected_status=PR_OPEN,
    )
    audit_fix_run(
        run_id,
        action="error_issue.fix.merged",
        actor_id=run.get("merge_requested_by"),
        task_id=task_id,
        at=now,
        details={
            "run_id": run_id,
            "issue_id": run.get("issue_id"),
            "repository": run.get("repository"),
            "pr_number": pull.number,
            "sha": sha,
            "merge_method": MERGE_METHOD,
        },
    )
    return True


def track_fixes(
    task_id: str = "",
    *,
    client_factory: GitHubClientFactory | None = None,
    now: Callable[[], datetime] = _now,
    cancelled: Callable[[], bool] = lambda: False,
    budget_seconds: float = TRACK_BUDGET_SECONDS,
) -> dict[str, Any]:
    """One tracking pass over the open runs, least recently checked first."""
    runs = trackable_fix_runs()
    if not runs:
        return {"status": "skipped", "reason": "no_runs"}
    try:
        setup = _setup()
    except ErrorTrackingConfigError as error:
        return {"status": "skipped", "reason": error.code, "runs": len(runs)}
    started = time.monotonic()
    tracked = 0
    errors: Counter[str] = Counter()
    with (client_factory or GitHubClient)(setup.token) as client:
        tracker = _Tracker(task_id, setup, client, now)
        for run in runs:
            if cancelled() or time.monotonic() - started > budget_seconds:
                break
            try:
                tracker.track(run)
            except (GitHubAuthError, GitHubRateLimitedError) as error:
                # The token or the rate limit stops every run: try next pass.
                return _failed(
                    error.code,
                    str(error),
                    tracked=tracked,
                    counts=dict(tracker.counts),
                )
            except (GitHubAPIError, ErrorTrackingConfigError) as error:
                log.info("Could not track fix run %s: %s", run["id"], error.code)
                errors[error.code] += 1
                update_fix_run(
                    str(run["id"]),
                    {"checked_at": now(), "error_code": error.code[:64]},
                )
            tracked += 1
    return {
        "status": "succeeded",
        "tracked": tracked,
        "pending": len(runs) - tracked,
        "counts": dict(tracker.counts),
        "errors": dict(errors),
    }


# -- Approve & merge and Discard ----------------------------------------------------


def _run_request(params: Mapping[str, Any]) -> tuple[str, int]:
    run_id = params.get("run_id")
    if not isinstance(run_id, str):
        raise ValueError("Invalid run")
    return run_id, _actor(params)


def merge_fix(
    task_id: str,
    params: Mapping[str, Any],
    *,
    client_factory: GitHubClientFactory | None = None,
) -> dict[str, Any]:
    """Approve & merge one run's pull request, as the person who asked."""
    try:
        run_id, actor_id = _run_request(params)
        raw_sha = params.get("head_sha")
        if not valid_sha(raw_sha):
            raise ValueError("Invalid head")
        head_sha = str(raw_sha)
    except ValueError:
        return _failed("ERROR_FIX_INVALID_REQUEST", "Invalid merge request")
    run = get_fix_run(run_id)
    if run is None:
        return _failed("ERROR_FIX_RUN_NOT_FOUND", "The fix run no longer exists")
    if run["status"] != PR_OPEN or not run.get("pr_number"):
        return _failed("ERROR_FIX_RUN_CLOSED", "The fix has no open pull request")
    try:
        setup = _setup()
    except ErrorTrackingConfigError as error:
        return _failed(error.code, error.message)
    now = _now()
    try:
        with (client_factory or GitHubClient)(setup.token) as client:
            pull, ci = observe(client, str(run["repository"]), int(run["pr_number"]))
            fields = _pull_fields(pull, ci)
            update_fix_run(
                run_id, {**fields, "checked_at": now}, expected_status=PR_OPEN
            )
            current = {**run, **fields}
            if pull.head_sha != head_sha:
                return _failed(
                    "ERROR_FIX_HEAD_CHANGED",
                    "The pull request changed after you reviewed it; review it again",
                )
            blockers = merge_blockers(current)
            if blockers:
                return _failed(
                    "ERROR_FIX_NOT_MERGEABLE",
                    "The pull request cannot be merged from Crate now",
                    blockers=blockers,
                )
            ready_at = None
            if pull.draft:
                if not pull.node_id:
                    return _failed(
                        "ERROR_FIX_NOT_MERGEABLE",
                        "GitHub did not identify the pull request",
                    )
                client.mark_ready_for_review(pull.node_id)
                ready = parse_pull(client.get_pull(str(run["repository"]), pull.number))
                # GitHub's clock: the checks that count start after this.
                ready_at = ready.updated_at or now
                update_fix_run(
                    run_id, _pull_fields(ready, "pending"), expected_status=PR_OPEN
                )
            if not record_merge_approval(
                run_id, user_id=actor_id, head_sha=head_sha, ready_at=ready_at, at=now
            ):
                return _failed(
                    "ERROR_FIX_ALREADY_APPROVED",
                    "Someone approved this pull request already",
                )
            audit_fix_run(
                run_id,
                action="error_issue.fix.merge_approved",
                actor_id=actor_id,
                task_id=task_id,
                at=now,
                details={
                    "run_id": run_id,
                    "issue_id": run["issue_id"],
                    "repository": run["repository"],
                    "pr_number": pull.number,
                    "sha": head_sha,
                    "was_draft": pull.draft,
                },
            )
            if pull.draft or ci != "success" or pull.mergeable is not True:
                return {
                    "status": "succeeded",
                    "run_id": run_id,
                    "merged": False,
                    "waiting_for": "checks",
                }
            approved = {
                **current,
                "merge_sha": head_sha,
                "merge_requested_by": actor_id,
            }
            merged = merge(client, approved, pull, task_id=task_id, now=now)
    except GitHubAPIError as error:
        log.warning("Approve & merge failed: %s", error.code)
        return _failed(error.code, str(error), run_id=run_id)
    if not merged:
        latest = get_fix_run(run_id) or {}
        return _failed(
            str(latest.get("error_code") or "GITHUB_NOT_MERGEABLE"),
            str(latest.get("summary") or SUMMARY["merge_refused"]),
            run_id=run_id,
        )
    return {"status": "succeeded", "run_id": run_id, "merged": True}


def discard_fix(
    task_id: str,
    params: Mapping[str, Any],
    *,
    client_factory: GitHubClientFactory | None = None,
) -> dict[str, Any]:
    """Close the run's pull request and delete its branch, or stop its run."""
    try:
        run_id, actor_id = _run_request(params)
    except ValueError:
        return _failed("ERROR_FIX_INVALID_REQUEST", "Invalid discard request")
    run = get_fix_run(run_id)
    if run is None:
        return _failed("ERROR_FIX_RUN_NOT_FOUND", "The fix run no longer exists")
    if not can_discard(run):
        return _failed("ERROR_FIX_RUN_CLOSED", "The fix is already finished")
    try:
        setup = _setup()
    except ErrorTrackingConfigError as error:
        return _failed(error.code, error.message)
    now = _now()
    changes: dict[str, Any] = {
        "status": CANCELLED,
        "summary": SUMMARY["discarded"],
        "error_code": None,
        "finished_at": now,
        "checked_at": now,
    }
    details: dict[str, Any] = {
        "run_id": run_id,
        "issue_id": run["issue_id"],
        "repository": run["repository"],
    }
    try:
        with (client_factory or GitHubClient)(setup.token) as client:
            if run["status"] == PR_OPEN and run.get("pr_number"):
                pull = parse_pull(
                    client.get_pull(str(run["repository"]), int(run["pr_number"]))
                )
                author = PR_AUTHORS.get(str(run["executor"]))
                if pull.author != author or not _own_branch(run, pull):
                    return _failed(
                        "ERROR_FIX_NOT_DISCARDABLE",
                        "Crate only closes pull requests its fixer opened on a fix "
                        "branch; close this one on GitHub",
                    )
                if pull.state == "open":
                    client.close_pull(str(run["repository"]), pull.number)
                changes.update(
                    pr_state="closed" if pull.state == "open" else pull.state
                )
                changes["cleanup_state"] = _delete_branch(
                    client, {**run, "branch": pull.head_ref}
                )
                details.update(pr_number=pull.number, branch=pull.head_ref)
            else:
                executor = _executor_for(run, setup.fix, client)
                if run.get("external_run_id"):
                    executor.cancel(run)
                    details["external_run_id"] = run["external_run_id"]
                else:
                    changes["summary"] = SUMMARY["discarded_early"]
    except GitHubAPIError as error:
        log.warning("Discard failed: %s", error.code)
        return _failed(error.code, str(error), run_id=run_id)
    if not update_fix_run(run_id, changes, expected_status=run["status"]):
        return _failed(
            "ERROR_FIX_RUN_CLOSED", "The fix changed meanwhile; look at it again"
        )
    audit_fix_run(
        run_id,
        action="error_issue.fix.discarded",
        actor_id=actor_id,
        task_id=task_id,
        at=now,
        details={**details, "previous_status": run["status"]},
    )
    return {
        "status": "succeeded",
        "run_id": run_id,
        "cleanup_state": changes.get("cleanup_state", run.get("cleanup_state")),
    }


# -- task handlers --------------------------------------------------------------


def _handle_dispatch_error_fix(task_id: str, params: dict, config: dict) -> dict:
    return dispatch_fix(task_id, params)


def _handle_track_error_fixes(task_id: str, params: dict, config: dict) -> dict:
    return track_fixes(task_id, cancelled=lambda: is_cancelled(task_id))


def _handle_merge_error_fix(task_id: str, params: dict, config: dict) -> dict:
    return merge_fix(task_id, params)


def _handle_discard_error_fix(task_id: str, params: dict, config: dict) -> dict:
    return discard_fix(task_id, params)


ERROR_FIX_TASK_HANDLERS: dict[str, TaskHandler] = {
    "dispatch_error_fix": _handle_dispatch_error_fix,
    "track_error_fixes": _handle_track_error_fixes,
    "merge_error_fix": _handle_merge_error_fix,
    "discard_error_fix": _handle_discard_error_fix,
}

__all__ = [
    "ERROR_FIX_TASK_HANDLERS",
    "EXPECTED_FAILURE_CODES",
    "MERGE_METHOD",
    "SUMMARY",
    "TRACK_BUDGET_SECONDS",
    "discard_fix",
    "dispatch_fix",
    "merge",
    "merge_fix",
    "track_fixes",
]

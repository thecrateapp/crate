"""Fix executors: who works on an error issue once a person presses Launch fix.

An executor takes one bug, works on it somewhere else and publishes its fix as a
pull request in the configured repository. Crate only needs three things from it,
the `FixExecutor` protocol:

- `submit(bug)`: start an attempt. Called once per run, never retried; the run id
  is the idempotency key the fixer must honour.
- `refresh(run)`: what the attempt is doing now and, once it exists, the number of
  its pull request.
- `cancel(run)`: stop an attempt that has not finished. Best effort.

The pull request itself is followed and reviewed by Crate
(`crate.error_inbox.pull_requests`), whatever executor opened it. `fix.executor`
selects the executor; `github_actions` is the only one today. `factory`, the Crate
Software Factory, is the next one: `docs/technical/error-fix-executors.md` is the
contract it implements.

Executors run inside worker tasks only, never in an HTTP request.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Literal, Protocol

from crate.error_inbox.autofix import workflow_inputs
from crate.error_inbox.config import ErrorTrackingConfigError, FixSettings
from crate.error_inbox.fix_runs import (
    GITHUB_ACTIONS,
    PR_AUTHORS,
    fix_branch,
    is_fix_branch,
    run_id_from_branch,
)
from crate.error_inbox.github_client import GitHubClient
from crate.error_inbox.pull_requests import github_url, parse_pull

ExecutorState = Literal["queued", "running", "succeeded", "failed", "cancelled"]

# `run-name` of `.github/workflows/error-autofix.yml`: how Crate finds the run a
# dispatch started (the dispatch answer carries no run id).
RUN_NAME_PREFIX = "Error Autofix "
# GitHub's clock and Crate's may disagree a little.
CLOCK_SKEW = timedelta(minutes=2)
_ACTIVE_RUN_STATUSES = frozenset(
    {"queued", "in_progress", "waiting", "requested", "pending"}
)


@dataclass(frozen=True, slots=True)
class FixBug:
    """One bug handed to an executor. `payload` is `fix_runs.bug_payload`, and only
    executors with `sends_payload` get it built."""

    run_id: str
    issue_id: str
    short_id: str
    note: str
    repository: str
    base_ref: str
    payload: Mapping[str, Any] | None = None


@dataclass(frozen=True, slots=True)
class Submission:
    external_run_id: str | None = None
    external_run_url: str | None = None


@dataclass(frozen=True, slots=True)
class RunObservation:
    """What the executor reports about a run. `pull_number` once its PR exists."""

    state: ExecutorState
    external_run_id: str | None = None
    external_run_url: str | None = None
    pull_number: int | None = None
    branch: str | None = None
    summary: str | None = None
    details: Mapping[str, Any] = field(default_factory=dict)


class FixExecutor(Protocol):
    name: str
    # The GitHub login the executor opens pull requests with.
    pr_author: str
    # Whether `submit` needs the bug payload (the workflow reads Sentry itself).
    sends_payload: bool

    def submit(self, bug: FixBug) -> Submission: ...

    def refresh(self, run: Mapping[str, Any]) -> RunObservation: ...

    def cancel(self, run: Mapping[str, Any]) -> bool: ...


def _run_state(raw: Mapping[str, Any]) -> ExecutorState:
    status = raw.get("status")
    if status in _ACTIVE_RUN_STATUSES:
        return "running"
    if status != "completed":
        return "queued"
    conclusion = raw.get("conclusion")
    if conclusion == "success":
        return "succeeded"
    if conclusion == "cancelled":
        return "cancelled"
    return "failed"


def _time(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


class GitHubActionsExecutor:
    """`.github/workflows/error-autofix.yml`: dispatched with the short id and note.

    The workflow names its run `Error Autofix <SHORT-ID>` and pushes
    `autofix/<short id in lower case>-<run id>`, so Crate finds the run by name and
    the pull request by branch, then reads the run id back from the branch.
    """

    name = GITHUB_ACTIONS
    pr_author = PR_AUTHORS[GITHUB_ACTIONS]
    sends_payload = False

    def __init__(self, fix: FixSettings, client: GitHubClient) -> None:
        self._fix = fix
        self._client = client

    def submit(self, bug: FixBug) -> Submission:
        inputs = workflow_inputs(bug.short_id, bug.note)
        self._client.dispatch_workflow(
            self._fix.repository, self._fix.workflow, self._fix.ref, inputs
        )
        return Submission()

    def _find_run(self, short_id: str, since: datetime) -> Mapping[str, Any] | None:
        title = f"{RUN_NAME_PREFIX}{short_id}"
        runs = [
            run
            for run in self._client.list_workflow_runs(
                self._fix.repository, self._fix.workflow, created_since=since
            )
            if run.get("display_title") == title
            and isinstance(run.get("id"), int)
            and not isinstance(run.get("id"), bool)
        ]
        # Newest first from GitHub: the oldest match is the run this request started.
        return runs[-1] if runs else None

    def _find_pull(
        self, short_id: str, run_id: str | None, since: datetime
    ) -> Mapping[str, Any] | None:
        if run_id is not None:
            pulls = self._client.list_pulls(
                self._fix.repository, head=fix_branch(short_id, run_id), per_page=5
            )
        else:
            pulls = self._client.list_pulls(self._fix.repository, per_page=50)
        matches = []
        for raw in pulls:
            pull = parse_pull(raw)
            if (
                is_fix_branch(pull.head_ref, short_id)
                and pull.head_repository == self._fix.repository
                and (pull.created_at is None or pull.created_at >= since)
            ):
                matches.append((raw, pull))
        return matches[-1][0] if matches else None

    def refresh(self, run: Mapping[str, Any]) -> RunObservation:
        short_id = str(run["short_id"])
        requested_at = run["requested_at"]
        since = requested_at - CLOCK_SKEW
        run_id = run.get("external_run_id")
        if run_id and str(run_id).isdigit():
            workflow_run: Mapping[str, Any] | None = self._client.get_workflow_run(
                self._fix.repository, int(run_id)
            )
        else:
            workflow_run = self._find_run(short_id, since)
            if workflow_run is not None:
                run_id = str(workflow_run["id"])
        pull_number = run.get("pr_number")
        branch = run.get("branch")
        if not pull_number:
            raw_pull = self._find_pull(short_id, run_id, since)
            if raw_pull is not None:
                pull = parse_pull(raw_pull)
                pull_number, branch = pull.number, pull.head_ref
                run_id = run_id or run_id_from_branch(pull.head_ref, short_id)
        if workflow_run is None and run_id and str(run_id).isdigit():
            workflow_run = self._client.get_workflow_run(
                self._fix.repository, int(run_id)
            )
        state: ExecutorState = (
            _run_state(workflow_run) if workflow_run is not None else "queued"
        )
        return RunObservation(
            state=state,
            external_run_id=run_id,
            external_run_url=github_url(workflow_run.get("html_url"))
            if workflow_run is not None
            else None,
            pull_number=pull_number,
            branch=branch,
            details={
                "conclusion": workflow_run.get("conclusion")
                if workflow_run is not None
                else None
            },
        )

    def cancel(self, run: Mapping[str, Any]) -> bool:
        run_id = run.get("external_run_id")
        if not run_id or not str(run_id).isdigit():
            return False
        return self._client.cancel_workflow_run(self._fix.repository, int(run_id))


def build_executor(fix: FixSettings, client: GitHubClient) -> FixExecutor:
    """The executor `fix.executor` names, with a client holding the fix token."""
    if fix.executor == GITHUB_ACTIONS:
        return GitHubActionsExecutor(fix, client)
    raise ErrorTrackingConfigError(
        "ERROR_FIX_EXECUTOR_UNAVAILABLE",
        f"The {fix.executor} executor is not available in this version of Crate",
    )


__all__ = [
    "CLOCK_SKEW",
    "RUN_NAME_PREFIX",
    "ExecutorState",
    "FixBug",
    "FixExecutor",
    "GitHubActionsExecutor",
    "RunObservation",
    "Submission",
    "build_executor",
]

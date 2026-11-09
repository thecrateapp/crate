"""Fix runs: the lifecycle of one attempt to fix an error issue, whoever runs it.

A run starts when a person presses Launch fix and ends when its pull request is
merged or closed, or when it fails, is discarded or expires. The executor named in
`fix.executor` does the work (`crate.error_inbox.executors`); Crate follows the
pull request on GitHub itself, so every executor is reviewed the same way. The
contract for executors is `docs/technical/error-fix-executors.md`.

    requested ──> running ──> pr_open ──> merged
        │            │           ├──────> closed     (closed on GitHub)
        │            │           └──────> cancelled  (Discard)
        ├────────────┴─────────> failed     (the executor failed or proposed nothing)
        ├────────────┴─────────> cancelled  (Discard before a pull request exists)
        └────────────┴─────────> expired    (no pull request within NO_PR_EXPIRY)

`requested` can also go straight to `pr_open` when the first look already finds the
pull request. The terminal states never change again.

Nothing here talks to GitHub or PostgreSQL: these are the rules the tasks, the API
and the views share.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from datetime import datetime, timedelta
from typing import Any

from crate.error_inbox.digest import sanitize_text
from crate.llm.prompts.error_triage import candidate_view, digest_view, issue_view

GITHUB_ACTIONS = "github_actions"
FACTORY = "factory"
EXECUTORS = (GITHUB_ACTIONS, FACTORY)
DEFAULT_EXECUTOR = GITHUB_ACTIONS
# Executors Crate can run today. `factory` is reserved for the Crate Software
# Factory; the settings refuse it until its executor exists.
AVAILABLE_EXECUTORS = frozenset({GITHUB_ACTIONS})

REQUESTED = "requested"
RUNNING = "running"
PR_OPEN = "pr_open"
MERGED = "merged"
CLOSED = "closed"
FAILED = "failed"
CANCELLED = "cancelled"
EXPIRED = "expired"
STATUSES = (REQUESTED, RUNNING, PR_OPEN, MERGED, CLOSED, FAILED, CANCELLED, EXPIRED)
OPEN_STATUSES = frozenset({REQUESTED, RUNNING, PR_OPEN})
TERMINAL_STATUSES = frozenset({MERGED, CLOSED, FAILED, CANCELLED, EXPIRED})
TRANSITIONS: dict[str, frozenset[str]] = {
    REQUESTED: frozenset({RUNNING, PR_OPEN, FAILED, CANCELLED, EXPIRED}),
    RUNNING: frozenset({PR_OPEN, FAILED, CANCELLED, EXPIRED}),
    PR_OPEN: frozenset({MERGED, CLOSED, CANCELLED}),
    **{status: frozenset() for status in TERMINAL_STATUSES},
}

CI_STATES = ("pending", "success", "failure", "none")
PR_STATES = ("open", "closed", "merged")
CLEANUP_STATES = ("none", "pending", "done", "failed")

# A run without a pull request this long after the request expires. The workflow
# needs at most 40 minutes (30 for the agent, 10 to publish) plus the queue.
NO_PR_EXPIRY = timedelta(hours=6)
# An approval waits this long for the checks of the approved commit to pass.
MERGE_APPROVAL_EXPIRY = timedelta(hours=3)
# A branch Crate could not delete is retried for this long, then left alone.
CLEANUP_EXPIRY = timedelta(days=7)

# Pull request conventions every executor follows (see the contract).
FIX_LABEL = "autofix"
BRANCH_PREFIX = "autofix/"
# The GitHub account each executor opens pull requests with. Approve & merge only
# accepts pull requests from it.
PR_AUTHORS = {GITHUB_ACTIONS: "crate-error-autofix[bot]"}

MAX_SUMMARY_LENGTH = 280
_SHA = re.compile(r"^[0-9a-f]{40}$")
_BRANCH_SUFFIX = re.compile(r"^[a-z0-9][a-z0-9._-]{0,99}$")
_SECRET = re.compile(
    r"(github_pat_|ghp_|gho_|ghs_|ghu_|sntrys_|sntryu_|sk-)[A-Za-z0-9_\-]+"
)
_URL = re.compile(r"https?://\S+")

# Why Approve & merge is not available; the admin turns each into a sentence.
BLOCKER_NOT_OPEN = "FIX_RUN_NOT_OPEN"
BLOCKER_PR_CLOSED = "PR_NOT_OPEN"
BLOCKER_AUTHOR = "PR_NOT_FROM_FIXER"
BLOCKER_LABEL = "PR_NOT_LABELLED"
BLOCKER_BRANCH = "PR_BRANCH_UNEXPECTED"
BLOCKER_CONFLICTS = "PR_CONFLICTS"
BLOCKER_UNKNOWN = "PR_MERGEABILITY_UNKNOWN"
BLOCKER_CHECKS_PENDING = "CHECKS_PENDING"
BLOCKER_CHECKS_FAILED = "CHECKS_FAILED"
BLOCKER_APPROVED = "ALREADY_APPROVED"


def can_transition(current: str, target: str) -> bool:
    return target in TRANSITIONS.get(current, frozenset())


def is_open(status: Any) -> bool:
    return status in OPEN_STATUSES


def branch_prefix(short_id: str) -> str:
    """`autofix/<short id in lower case>-`: what every fix branch starts with."""
    return f"{BRANCH_PREFIX}{short_id.lower()}-"


def fix_branch(short_id: str, run_id: str) -> str:
    return f"{branch_prefix(short_id)}{run_id}"


def is_fix_branch(branch: Any, short_id: str) -> bool:
    """A branch named after the issue: the only branches Crate ever deletes."""
    if not isinstance(branch, str) or not isinstance(short_id, str):
        return False
    prefix = branch_prefix(short_id)
    return branch.startswith(prefix) and bool(
        _BRANCH_SUFFIX.match(branch[len(prefix) :])
    )


def run_id_from_branch(branch: Any, short_id: str) -> str | None:
    """The executor run id a fix branch ends with, when it is one."""
    if not is_fix_branch(branch, short_id):
        return None
    return branch[len(branch_prefix(short_id)) :]


def fixes_line(short_id: str) -> str:
    return f"Fixes {short_id}"


def valid_sha(value: Any) -> bool:
    return isinstance(value, str) and _SHA.match(value) is not None


def sanitize_summary(value: Any) -> str | None:
    """A short plain sentence for the run: no controls, links or token-like text."""
    if not isinstance(value, str):
        return None
    text = _URL.sub("<link>", _SECRET.sub("<redacted>", value))
    text = sanitize_text(" ".join(text.split()), MAX_SUMMARY_LENGTH)
    return text or None


def expired(run: Mapping[str, Any], now: datetime) -> bool:
    """A run with no pull request yet, past its window."""
    requested_at = run.get("requested_at")
    return (
        run.get("status") in {REQUESTED, RUNNING}
        and isinstance(requested_at, datetime)
        and now - requested_at > NO_PR_EXPIRY
    )


def approval_expired(run: Mapping[str, Any], now: datetime) -> bool:
    approved_at = run.get("merge_requested_at")
    return isinstance(approved_at, datetime) and now - approved_at > (
        MERGE_APPROVAL_EXPIRY
    )


def merge_blockers(run: Mapping[str, Any]) -> list[str]:
    """Why Approve & merge cannot start now; empty when it can.

    Only an open pull request from the executor's GitHub account, with the
    `autofix` label, on a branch named after the issue, that GitHub can merge. A
    ready pull request needs its checks green; a draft is accepted unless a check
    already failed, because its checks only run once it is ready for review (the
    approval then waits for them, see `crate.worker_handlers.error_fixes`).
    """
    blockers: list[str] = []
    if run.get("status") != PR_OPEN:
        return [BLOCKER_NOT_OPEN]
    if run.get("pr_state") != "open":
        return [BLOCKER_PR_CLOSED]
    author = PR_AUTHORS.get(str(run.get("executor")))
    if author is None or run.get("pr_author") != author:
        blockers.append(BLOCKER_AUTHOR)
    if run.get("pr_labeled") is not True:
        blockers.append(BLOCKER_LABEL)
    if not is_fix_branch(run.get("branch"), str(run.get("short_id") or "")):
        blockers.append(BLOCKER_BRANCH)
    if run.get("pr_mergeable") is False or run.get("pr_mergeable_state") == "dirty":
        blockers.append(BLOCKER_CONFLICTS)
    elif run.get("pr_mergeable") is None:
        blockers.append(BLOCKER_UNKNOWN)
    ci = run.get("ci_state")
    if ci == "failure":
        blockers.append(BLOCKER_CHECKS_FAILED)
    elif not run.get("pr_draft") and ci != "success":
        blockers.append(BLOCKER_CHECKS_PENDING)
    if run.get("merge_requested_at") is not None:
        blockers.append(BLOCKER_APPROVED)
    return blockers


def can_discard(run: Mapping[str, Any]) -> bool:
    return is_open(run.get("status"))


# -- the bug a fixer receives ----------------------------------------------------------

BUG_PAYLOAD_VERSION = 1
_TRIAGE_FIELDS = ("classification", "severity", "summary", "hypothesis", "confidence")


def bug_payload(triage_input: Mapping[str, Any]) -> dict[str, Any]:
    """What an executor may send to a fixer about one issue (contract v1).

    Built from `crate.db.queries.error_issues.get_triage_input`, the same view the AI
    triage reads: the short id and counts, the sanitized digest, at most ten
    duplicate candidates reduced to their main exception and innermost frame, the
    releases and the latest triage of the current digest. Never the title, the
    culprit, links, raw events or the person's identity.
    """
    issue = issue_view(triage_input)
    digest = triage_input.get("digest")
    triage = triage_input.get("current_triage")
    return {
        "version": BUG_PAYLOAD_VERSION,
        "issue": issue,
        "releases": {
            "first": triage_input.get("first_release"),
            "last": triage_input.get("last_release"),
        },
        "digest": digest_view(digest) if isinstance(digest, Mapping) else None,
        "candidates": [
            candidate_view(candidate)
            for candidate in _candidates(triage_input.get("candidates"))
        ],
        "triage": {key: triage.get(key) for key in _TRIAGE_FIELDS}
        if isinstance(triage, Mapping)
        else None,
    }


def _candidates(value: Any) -> Sequence[Mapping[str, Any]]:
    if not isinstance(value, (list, tuple)):
        return []
    return [item for item in value if isinstance(item, Mapping)]


__all__ = [
    "AVAILABLE_EXECUTORS",
    "BLOCKER_APPROVED",
    "BLOCKER_AUTHOR",
    "BLOCKER_BRANCH",
    "BLOCKER_CHECKS_FAILED",
    "BLOCKER_CHECKS_PENDING",
    "BLOCKER_CONFLICTS",
    "BLOCKER_LABEL",
    "BLOCKER_NOT_OPEN",
    "BLOCKER_PR_CLOSED",
    "BLOCKER_UNKNOWN",
    "BRANCH_PREFIX",
    "BUG_PAYLOAD_VERSION",
    "CANCELLED",
    "CI_STATES",
    "CLEANUP_EXPIRY",
    "CLEANUP_STATES",
    "CLOSED",
    "DEFAULT_EXECUTOR",
    "EXECUTORS",
    "EXPIRED",
    "FACTORY",
    "FAILED",
    "FIX_LABEL",
    "GITHUB_ACTIONS",
    "MAX_SUMMARY_LENGTH",
    "MERGED",
    "MERGE_APPROVAL_EXPIRY",
    "NO_PR_EXPIRY",
    "OPEN_STATUSES",
    "PR_AUTHORS",
    "PR_OPEN",
    "PR_STATES",
    "REQUESTED",
    "RUNNING",
    "STATUSES",
    "TERMINAL_STATUSES",
    "TRANSITIONS",
    "approval_expired",
    "branch_prefix",
    "bug_payload",
    "can_discard",
    "can_transition",
    "expired",
    "fix_branch",
    "fixes_line",
    "is_fix_branch",
    "is_open",
    "merge_blockers",
    "run_id_from_branch",
    "sanitize_summary",
    "valid_sha",
]

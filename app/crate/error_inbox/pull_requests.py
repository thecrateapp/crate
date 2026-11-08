"""What Crate reads from, and does to, the pull request of a fix run on GitHub.

Every executor publishes its fix as a pull request in the configured repository,
following the conventions in `docs/technical/error-fix-executors.md`, so Crate
reviews them all the same way: it reads the pull request and the checks of its head
commit, and on a person's request marks it ready, merges it, or closes it and
deletes its branch. GitHub enforces branch protection on every merge; Crate never
asks it to bypass anything.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from crate.error_inbox.fix_runs import FIX_LABEL, valid_sha
from crate.error_inbox.github_client import GitHubClient, GitHubResponseError

# Check run conclusions that block a merge. `neutral` and `skipped` do not.
FAILED_CONCLUSIONS = frozenset(
    {
        "failure",
        "timed_out",
        "cancelled",
        "action_required",
        "startup_failure",
        "stale",
    }
)
MAX_URL_LENGTH = 2048


@dataclass(frozen=True, slots=True)
class PullRequestState:
    number: int
    url: str | None
    node_id: str | None
    state: str  # open, closed or merged
    draft: bool
    mergeable: bool | None
    mergeable_state: str | None
    head_sha: str | None
    head_ref: str | None
    head_repository: str | None
    author: str | None
    labels: tuple[str, ...]
    created_at: datetime | None
    updated_at: datetime | None

    @property
    def labeled(self) -> bool:
        return FIX_LABEL in self.labels


def _text(value: Any, limit: int = 255) -> str | None:
    return value[:limit] if isinstance(value, str) and value else None


def _time(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def github_url(value: Any) -> str | None:
    """Only links to github.com are stored and shown."""
    if (
        isinstance(value, str)
        and len(value) <= MAX_URL_LENGTH
        and value.startswith("https://github.com/")
        and not any(ord(char) <= 32 for char in value)
    ):
        return value
    return None


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def parse_pull(raw: Mapping[str, Any]) -> PullRequestState:
    number = raw.get("number")
    if isinstance(number, bool) or not isinstance(number, int) or number <= 0:
        raise GitHubResponseError(
            "GITHUB_UNEXPECTED_RESPONSE", "GitHub sent a pull request without a number"
        )
    head = _mapping(raw.get("head"))
    head_repo = _mapping(head.get("repo"))
    user = _mapping(raw.get("user"))
    labels = raw.get("labels")
    labels = labels if isinstance(labels, list) else []
    merged = bool(raw.get("merged")) or bool(raw.get("merged_at"))
    state = "merged" if merged else ("open" if raw.get("state") == "open" else "closed")
    mergeable = raw.get("mergeable")
    sha = head.get("sha")
    return PullRequestState(
        number=number,
        url=github_url(raw.get("html_url")),
        node_id=_text(raw.get("node_id"), 100),
        state=state,
        draft=bool(raw.get("draft")),
        mergeable=mergeable if isinstance(mergeable, bool) else None,
        mergeable_state=_text(raw.get("mergeable_state"), 32),
        head_sha=sha if valid_sha(sha) else None,
        head_ref=_text(head.get("ref")),
        head_repository=_text(head_repo.get("full_name"), 201),
        author=_text(user.get("login"), 100),
        labels=tuple(
            str(label.get("name"))
            for label in labels
            if isinstance(label, Mapping) and isinstance(label.get("name"), str)
        ),
        created_at=_time(raw.get("created_at")),
        updated_at=_time(raw.get("updated_at")),
    )


def ci_state(
    check_runs: Iterable[Mapping[str, Any]],
    status: Mapping[str, Any] | None,
    *,
    since: datetime | None = None,
) -> str:
    """`failure`, `pending`, `success` or `none` for a commit's checks.

    Any failed check or failing commit status is a failure; anything still running
    is pending; otherwise success, or none when the commit has no checks at all.
    With `since`, checks must have started after it: a draft's checks only run once
    it is ready, and until they start the commit only has the draft's skipped ones.
    """
    runs = list(check_runs)
    combined = status or {}
    has_statuses = int(combined.get("total_count") or 0) > 0
    combined_state = combined.get("state") if has_statuses else None
    if combined_state in {"failure", "error"} or any(
        run.get("status") == "completed" and run.get("conclusion") in FAILED_CONCLUSIONS
        for run in runs
    ):
        return "failure"
    if since is not None and not any(
        (started := _time(run.get("started_at"))) is not None and started >= since
        for run in runs
    ):
        return "pending"
    if combined_state == "pending" or any(
        run.get("status") != "completed" for run in runs
    ):
        return "pending"
    if runs or has_statuses:
        return "success"
    return "none"


def observe(
    client: GitHubClient,
    repository: str,
    number: int,
    *,
    checks_since: datetime | None = None,
) -> tuple[PullRequestState, str | None]:
    """The pull request and, while it is open, the state of its head's checks."""
    pull = parse_pull(client.get_pull(repository, number))
    if pull.state != "open" or pull.head_sha is None:
        return pull, None
    checks = client.list_check_runs(repository, pull.head_sha)
    status = client.combined_status(repository, pull.head_sha)
    return pull, ci_state(checks, status, since=checks_since)


__all__ = [
    "FAILED_CONCLUSIONS",
    "PullRequestState",
    "ci_state",
    "github_url",
    "observe",
    "parse_pull",
]

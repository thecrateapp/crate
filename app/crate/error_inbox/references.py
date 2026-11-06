"""Reference issues the inbox does not hold, read from Sentry and kept in memory.

The triage evaluation (`crate.error_inbox.evaluation`) measures the triage against
issues labelled by hand; many of them were resolved or filtered out of the inbox
since. `fetch_references` reads each one with the stored Sentry connection and
builds its triage input exactly as the sync would store it: the short id is
resolved (`shortids`), the issue and its latest event are read, and the digest is
`build_digest`'s. Nothing is written: the digests live in the task's memory only,
never in `error_issues`, a file, a log line or a task result.

`with_references` gives an issue its duplicate candidates over the inbox and these
in-memory issues together, with the inbox's rule (same group key or same main
exception) and order, at most ten, so duplicate answers can be measured on issues
the inbox no longer holds.

Sentry reads run only in the evaluation task, never in an HTTP request.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from crate.db.queries.error_issues import (
    MAX_DUPLICATE_CANDIDATES,
    duplicate_candidates,
)
from crate.error_inbox.config import (
    ErrorTrackingConfig,
    ErrorTrackingConfigError,
    load_config,
    load_sentry_token,
)
from crate.error_inbox.digest import (
    build_digest,
    digest_hash,
    group_key,
    service_tag,
)
from crate.error_inbox.priority import crate_score
from crate.error_inbox.sentry_client import (
    SentryAPIError,
    SentryAuthError,
    SentryClient,
    SentryForbiddenError,
    SentryNotFoundError,
    SentryRateLimitedError,
    merge_recent_window,
)

log = logging.getLogger(__name__)

# Why the task skips an issue it looked for in Sentry.
FETCH_SKIP_REASONS = frozenset(
    {"not_found", "merged", "no_event", "fetch_failed", "fetch_budget"}
)
FETCH_FAILED_CODE = "EVAL_FETCH_FAILED"

# Sentry reads for issues the inbox does not hold: three requests each (resolve the
# short id, read the issue, read its latest event), at most four a second, a 429
# waited out once (Retry-After, at most a minute), all within one budget.
FETCH_BUDGET_SECONDS = 600.0
FETCH_TIMEOUT_SECONDS = 10.0
FETCH_INTERVAL_SECONDS = 0.25
FETCH_REQUESTS_PER_ISSUE = 3
DEFAULT_RETRY_AFTER_SECONDS = 10.0
MAX_RETRY_AFTER_SECONDS = 60.0

FETCH_PHASE = "fetch"
EVALUATE_PHASE = "evaluate"
# phase, done, total, the short id at hand.
Progress = Callable[[str, int, int, str], None]
SentryFactory = Callable[[ErrorTrackingConfig, str], SentryClient]

# What an in-memory issue keeps of Sentry's issue: what the inbox row stores and the
# prompt may show. Title, culprit and permalink are dropped.
_ISSUE_FIELDS = (
    "external_id",
    "short_id",
    "service",
    "level",
    "status",
    "substatus",
    "issue_category",
    "events_24h",
    "users_24h",
    "events_total",
    "users_total",
    "first_seen",
    "last_seen",
    "first_release",
    "last_release",
)


def sentry_source() -> dict[str, Any]:
    """Whether the task can fetch issues the inbox does not hold.

    Reads the stored settings only: no Sentry request and no token.
    """
    try:
        config = load_config()
    except ErrorTrackingConfigError as error:
        return {"available": False, "error_code": error.code}
    if config is None:
        return {"available": False, "error_code": "ERROR_TRACKING_NOT_CONFIGURED"}
    if not config.secret_ref:
        return {"available": False, "error_code": "ERROR_TRACKING_TOKEN_MISSING"}
    return {"available": True, "error_code": None}


@dataclass
class Fetched:
    """Issues built in memory from Sentry, by short id, and why others were skipped.

    `issues` hold digests: they stay in the task's memory and never reach the
    result, a log line or the database.
    """

    issues: dict[str, dict[str, Any]] = field(default_factory=dict)
    skipped: dict[str, dict[str, Any]] = field(default_factory=dict)
    requests: int = 0
    budget_exhausted: bool = False

    def summary(self, wanted: int) -> dict[str, Any]:
        return {
            "wanted": wanted,
            "built": len(self.issues),
            "skipped": len(self.skipped),
            "requests": self.requests,
            "budget_exhausted": self.budget_exhausted,
        }


class _Skip(Exception):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class _Paced:
    """Sentry requests at most every `FETCH_INTERVAL_SECONDS`; a 429 is waited out
    once (its Retry-After, at most `MAX_RETRY_AFTER_SECONDS`) when the wait ends
    before the deadline."""

    def __init__(
        self,
        fetched: Fetched,
        *,
        deadline: float,
        clock: Callable[[], float],
        sleep: Callable[[float], None],
    ) -> None:
        self.fetched = fetched
        self.deadline = deadline
        self.clock = clock
        self.sleep = sleep
        self.last: float | None = None

    def __call__(self, method: Callable[..., Any], *args: Any) -> Any:
        for attempt in range(2):
            if self.last is not None:
                gap = self.last + FETCH_INTERVAL_SECONDS - self.clock()
                if gap > 0:
                    self.sleep(gap)
            self.last = self.clock()
            self.fetched.requests += 1
            try:
                return method(*args)
            except SentryRateLimitedError as error:
                wait = min(
                    float(error.retry_after or DEFAULT_RETRY_AFTER_SECONDS),
                    MAX_RETRY_AFTER_SECONDS,
                )
                if attempt or self.clock() + wait >= self.deadline:
                    raise
                self.sleep(wait)
        raise AssertionError("unreachable")


def reference_input(
    issue: Mapping[str, Any], event: Mapping[str, Any]
) -> dict[str, Any]:
    """The triage input of an issue the inbox does not hold, as the sync stores one.

    `issue` is Sentry's issue (`get_issue`), `event` its latest event. Like an
    issue the listing no longer returns it has no users in the last 24 hours; its
    service is the event's `service` tag, else the project; the digest, its hash,
    group key and score are the sync's.
    """
    [row] = merge_recent_window([dict(issue)], [])
    digest = build_digest(event)
    row["service"] = service_tag(digest) or row["service"]
    return {
        "id": None,
        **{key: row.get(key) for key in _ISSUE_FIELDS},
        "crate_score": crate_score(row),
        "group_key": group_key(digest),
        "digest": digest,
        "digest_hash": digest_hash(digest),
        "candidates": [],
        "current_triage": None,
        "done_kinds": [],
    }


def _reference(call: _Paced, client: SentryClient, short_id: str) -> dict[str, Any]:
    try:
        found = call(client.resolve_short_id, short_id)
    except SentryNotFoundError:
        raise _Skip("not_found") from None
    if str(found["short_id"]).upper() != short_id:
        # Sentry answers a merged issue's short id with the issue it joined.
        raise _Skip("merged")
    try:
        issue = call(client.get_issue, found["external_id"])
    except SentryNotFoundError:
        raise _Skip("not_found") from None
    try:
        event = call(client.latest_event, issue["external_id"])
    except SentryNotFoundError:
        raise _Skip("no_event") from None
    return reference_input(issue, event)


def fetch_references(
    short_ids: list[str],
    *,
    client_factory: SentryFactory | None = None,
    cancelled: Callable[[], bool] = lambda: False,
    progress: Progress | None = None,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
) -> Fetched:
    """Build the triage input of these issues from Sentry, in memory, one by one.

    Without a Sentry connection each is skipped as `not_in_inbox`. Otherwise one
    issue Sentry no longer has (`not_found`), merged (`merged`) or without events
    (`no_event`), one failed read (`fetch_failed`, with the Sentry code) or the end
    of `FETCH_BUDGET_SECONDS` (`fetch_budget`) skips that issue and the next is
    read; a rejected token (401/403) skips the rest without asking again. A
    cancellation stops before the next issue and leaves the rest undecided.
    """
    fetched = Fetched()
    if not short_ids:
        return fetched
    try:
        config = load_config()
        if config is None:
            fetched.skipped = {
                short_id: {"reason": "not_in_inbox"} for short_id in short_ids
            }
            return fetched
        token = load_sentry_token(config)
    except ErrorTrackingConfigError as error:
        fetched.skipped = {
            short_id: {"reason": "fetch_failed", "error_code": error.code}
            for short_id in short_ids
        }
        return fetched
    factory = client_factory or (
        lambda config, token: SentryClient(config, token, timeout=FETCH_TIMEOUT_SECONDS)
    )
    deadline = clock() + FETCH_BUDGET_SECONDS
    call = _Paced(fetched, deadline=deadline, clock=clock, sleep=sleep)
    rejected: str | None = None
    with factory(config, token) as client:
        for index, short_id in enumerate(short_ids):
            if cancelled():
                break
            if progress is not None:
                progress(FETCH_PHASE, index, len(short_ids), short_id)
            if rejected is not None:
                fetched.skipped[short_id] = {
                    "reason": "fetch_failed",
                    "error_code": rejected,
                }
                continue
            if clock() >= deadline:
                fetched.budget_exhausted = True
                fetched.skipped[short_id] = {"reason": "fetch_budget"}
                continue
            try:
                fetched.issues[short_id] = _reference(call, client, short_id)
            except _Skip as skip:
                fetched.skipped[short_id] = {"reason": skip.reason}
            except (SentryAuthError, SentryForbiddenError) as error:
                rejected = error.code
                fetched.skipped[short_id] = {
                    "reason": "fetch_failed",
                    "error_code": error.code,
                }
            except SentryAPIError as error:
                fetched.skipped[short_id] = {
                    "reason": "fetch_failed",
                    "error_code": error.code,
                }
            except Exception as error:  # noqa: BLE001 — one issue must not stop the rest.
                # Only the type: a message could echo event content.
                log.warning(
                    "Reading reference issue %s from Sentry failed (%s)",
                    short_id,
                    type(error).__name__,
                )
                fetched.skipped[short_id] = {
                    "reason": "fetch_failed",
                    "error_code": FETCH_FAILED_CODE,
                }
    if progress is not None:
        progress(FETCH_PHASE, len(short_ids), len(short_ids), "")
    return fetched


# -- duplicate candidates over the inbox and the in-memory issues ---------------


def _exception_type(digest: Any) -> str | None:
    exceptions = digest.get("exceptions") if isinstance(digest, Mapping) else None
    last = exceptions[-1] if isinstance(exceptions, list) and exceptions else None
    value = last.get("type") if isinstance(last, Mapping) else None
    return value if isinstance(value, str) and value else None


def _matches(target: Mapping[str, Any], other: Mapping[str, Any]) -> bool:
    """`get_triage_input`'s rule: the same group key or the same main exception."""
    key = target.get("group_key")
    kind = _exception_type(target.get("digest"))
    return (key is not None and other.get("group_key") == key) or (
        kind is not None and _exception_type(other.get("digest")) == kind
    )


def _as_candidate(
    reference: Mapping[str, Any], target: Mapping[str, Any]
) -> dict[str, Any]:
    """An in-memory issue in the shape of an inbox candidate (no row id)."""
    digest = reference["digest"]
    exceptions = digest.get("exceptions") or []
    frames = digest.get("frames") or []
    seen = reference.get("last_seen")
    key = target.get("group_key")
    return {
        "id": None,
        "short_id": reference["short_id"],
        "service": reference.get("service"),
        "level": reference.get("level"),
        "status": reference.get("status"),
        "substatus": reference.get("substatus"),
        "last_seen": seen.isoformat() if isinstance(seen, datetime) else seen,
        "events_24h": reference.get("events_24h"),
        "same_group": key is not None and reference.get("group_key") == key,
        "exception": exceptions[-1] if exceptions else None,
        "top_frame": frames[-1] if frames else None,
        "message": digest.get("message"),
        "crate_score": reference.get("crate_score"),
    }


_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def _microseconds(value: Any) -> int | None:
    """A timestamp in whole microseconds, as PostgreSQL orders them; None if absent."""
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value)
        except ValueError:
            return None
    if not isinstance(value, datetime):
        return None
    aware = value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
    return (aware - _EPOCH) // timedelta(microseconds=1)


def _rank(candidate: Mapping[str, Any]) -> tuple:
    """The inbox's candidate order: same group, open, score, last seen, id.

    Inbox rows come before in-memory issues on a complete tie.
    """
    seen = _microseconds(candidate.get("last_seen"))
    score = candidate.get("crate_score")
    return (
        not candidate.get("same_group"),
        candidate.get("status") != "unresolved",
        -(score if isinstance(score, int) else 0),
        seen is None,
        -seen if seen is not None else 0,
        candidate.get("id") is None,
        str(candidate.get("id") or candidate.get("short_id") or ""),
    )


def with_references(
    target: Mapping[str, Any],
    listed: list[dict[str, Any]],
    references: Mapping[str, Mapping[str, Any]],
) -> list[dict[str, Any]]:
    """The target's inbox candidates (`listed`) plus the in-memory issues that match.

    Ranked as the inbox ranks candidates and capped at ten; without a matching
    in-memory issue the inbox's list comes back unchanged.
    """
    own = str(target.get("short_id") or "").upper()
    extra = [
        _as_candidate(reference, target)
        for short_id, reference in references.items()
        if short_id != own and _matches(target, reference)
    ]
    if not extra:
        return list(listed)
    return sorted([*listed, *extra], key=_rank)[:MAX_DUPLICATE_CANDIDATES]


def inbox_candidates(
    references: Mapping[str, Mapping[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    """The inbox's candidates of each in-memory issue, in one query."""
    if not references:
        return {}
    lists = duplicate_candidates(
        [
            {
                "external_id": reference.get("external_id"),
                "group_key": reference.get("group_key"),
                "exception_type": _exception_type(reference.get("digest")),
            }
            for reference in references.values()
        ]
    )
    return dict(zip(references, lists, strict=True))


__all__ = [
    "EVALUATE_PHASE",
    "FETCH_BUDGET_SECONDS",
    "FETCH_FAILED_CODE",
    "FETCH_PHASE",
    "FETCH_REQUESTS_PER_ISSUE",
    "FETCH_SKIP_REASONS",
    "Fetched",
    "Progress",
    "SentryFactory",
    "fetch_references",
    "inbox_candidates",
    "reference_input",
    "sentry_source",
    "with_references",
]

"""Error inbox tasks: the Sentry sync, status changes, the connection test and AI
triage. Launch fix and the review of fix pull requests live in
`crate.worker_handlers.error_fixes`.

Only these tasks talk to Sentry (EI-D3); the admin reads PostgreSQL. No
HTTP call runs inside a database transaction: every repository call opens and closes
its own scope between requests. Tokens are handed to the clients and nothing else:
they never reach a log line, a task result or the runtime state, and neither do
response bodies or event text.

Runtime state (`ops_runtime_state`) the admin API and MCP read; the keys and the
write-access check live in `crate.error_inbox.state`:

- `error_inbox`, written by every sync pass (see `_SyncReport.state`): `status`
  (`ok`, `partial` or `failed`), `started_at`, `finished_at`, `last_success_at`,
  the typed `error_code` of the pass, `counts` (`listed`, `listed_recent`,
  `upserted`, `digests_fetched`, `releases_fetched`, `status_refreshed`,
  `purged`), `pages`, `truncated` (`full`, `recent`), `budget_exhausted` and
  `cancelled`.
- `error_inbox_access`: `read` and `write` (true, false or null when unknown),
  `credential` (a hash of the token's secret ref, never the token), `source`
  (`sync` or `connection_test`), `checked_at` and `error_code`.

Releases: Sentry's issues listing carries none. `last_release` comes from the
latest event the sync already downloads and `first_release` from the issue detail,
read once per issue (`refresh_releases`); a listing never clears either. Only the
sync uses a third key, `error_inbox_release_checks`: the listed issues whose detail
had no first release, so it is not read again.

Write access (EI-D4) comes from `check_scopes`. The connection test records it every
time it runs; each sync pass records it when the scope check succeeds or the token
is rejected, so it stays current within one schedule interval of a token or scope
change. `update_error_issue_status` refuses without calling Sentry only when the
recorded access belongs to the current token and says `write: false`. Unknown access
(never checked, a different token, or Sentry did not report scopes) lets Sentry
decide, and a 403 comes back as `SENTRY_FORBIDDEN`.

AI triage (E2): with `triage.automatic` on, each sync pass ends by queuing
`triage_error_issue` for the open issues that need it (`queue_automatic_triage`,
design §7.1), at most `triage.daily_max` a day, highest score first, never the same
digest twice. `triage_error_issue` and `investigate_error_issue` run on the `ai`
lane inside the actor's capacity window: each resumes the configuration accepted
when it was queued and makes one model call through `crate.error_inbox.triage`.
The investigation first reads events per release and the tag distribution from
Sentry (`crate.error_inbox.evidence`). Failures come back as typed results the
admin shows as they are; they are expected (configuration or model answers), so
the worker does not report them to Sentry.

`evaluate_error_triage` (gate EG2) runs on the `ai_bulk` lane: one triage call per
issue a maintainer listed, validated like a real triage and never saved
(`crate.error_inbox.evaluation`). Listed issues the inbox no longer holds are first
read from Sentry and kept in memory (`crate.error_inbox.references`). The
maintainer queues it with `tools/error-inbox-eval/run_eval.py`; no route or
schedule does.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from crate.ai.consumers import accept_action, resume_action
from crate.ai.contracts import AIConfigurationError
from crate.ai.runtime import execute_structured
from crate.db.ops_runtime import get_ops_runtime_state, set_ops_runtime_state
from crate.db.queries.error_issues import (
    auto_triage_plan,
    get_issue,
    open_ids_not_in,
    release_candidates,
    sync_state,
)
from crate.db.repositories.error_issues import (
    TRIAGE_ORIGINS,
    mark_status,
    purge_closed,
    queue_triages,
    record_status_change,
    set_digest,
    set_releases,
    upsert_issues,
)
from crate.error_inbox.config import (
    ErrorTrackingConfig,
    ErrorTrackingConfigError,
    load_config,
    load_sentry_token,
)
from crate.error_inbox.digest import build_digest, digest_hash, group_key, service_tag
from crate.error_inbox.evaluation import run_evaluation
from crate.error_inbox.evidence import fetch_evidence
from crate.error_inbox.priority import crate_score
from crate.error_inbox.state import (
    ACCESS_STATE_KEY,
    STATE_VERSION,
    SYNC_STATE_KEY,
    known_write_access,
    record_access,
)
from crate.error_inbox.triage import (
    ACTION_BY_KIND,
    INPUT_TOO_LARGE_CODE,
    OUTPUT_LIMIT_CODE,
    StructuredExecutor,
    TriageOutcome,
    triage_issue,
)
from crate.error_inbox.sentry_client import (
    LIST_STATS_PERIOD,
    RECENT_STATS_PERIOD,
    SUBSTATUSES,
    SentryAPIError,
    SentryAuthError,
    SentryClient,
    SentryNotFoundError,
    merge_recent_window,
    scope_access,
)
from crate.task_progress import TaskProgress, emit_progress
from crate.worker_handlers import TaskHandler, is_cancelled

log = logging.getLogger(__name__)

ClientFactory = Callable[[ErrorTrackingConfig, str], SentryClient]

MAX_LIST_PAGES = 5
MAX_EVENT_FETCHES = 25
# Issue details read one by one per pass, release lookups and status checks together.
MAX_STATUS_REFRESHES = 50
# The share of those reads release lookups may take; status checks keep the rest.
MAX_RELEASE_LOOKUPS = 25
RELEASE_CHECKS_KEY = "error_inbox_release_checks"
# Leaves room under the 120 s task limit to write what was fetched and the state.
SYNC_BUDGET_SECONDS = 90.0
ISSUE_STATUSES = frozenset({"resolved", "ignored", "unresolved"})
MAX_EVENT_ID_LENGTH = 64
_UNKNOWN_ACCESS: dict[str, bool | None] = {"read": None, "write": None}


def _now() -> datetime:
    return datetime.now(timezone.utc)


# Failures caused by Sentry or by the connection settings, which the Errors page
# and the System Health tile already explain. The task still fails, but the
# worker does not report it to Sentry. Codes that point at a Crate bug (an
# unexpected response, an unreadable stored token, an invalid request) are not
# listed and are still reported.
EXPECTED_FAILURE_CODES = frozenset(
    {
        "ERROR_ISSUE_NOT_FOUND",
        "ERROR_TRACKING_INVALID",
        "ERROR_TRACKING_NOT_CONFIGURED",
        "ERROR_TRACKING_TOKEN_MISSING",
        "SENTRY_AUTH",
        "SENTRY_FORBIDDEN",
        "SENTRY_HOST_DISALLOWED",
        "SENTRY_NOT_FOUND",
        "SENTRY_RATE_LIMITED",
        "SENTRY_REDIRECT",
        "SENTRY_SERVER",
        "SENTRY_TIMEOUT",
        "SENTRY_UNAVAILABLE",
        "SENTRY_WRITE_SCOPE_MISSING",
    }
)


def _failed(code: str, message: str, **extra: Any) -> dict[str, Any]:
    return {
        "status": "failed",
        "error_code": code,
        "error": message,
        "expected": code in EXPECTED_FAILURE_CODES,
        **extra,
    }


# -- access (EI-D4) -----------------------------------------------------------


def _access_from_scopes(scopes: frozenset[str]) -> dict[str, bool | None]:
    # An empty answer means Sentry did not report scopes, not that there are none.
    if not scopes:
        return dict(_UNKNOWN_ACCESS)
    return dict(scope_access(scopes))


# -- sync ---------------------------------------------------------------------


@dataclass
class _SyncReport:
    started_at: datetime
    status: str = "ok"
    error_code: str | None = None
    counts: dict[str, int] = field(
        default_factory=lambda: {
            "listed": 0,
            "listed_recent": 0,
            "upserted": 0,
            "digests_fetched": 0,
            "releases_fetched": 0,
            "status_refreshed": 0,
            "purged": 0,
        }
    )
    pages: dict[str, int] = field(default_factory=lambda: {"full": 0, "recent": 0})
    truncated: dict[str, bool] = field(
        default_factory=lambda: {"full": False, "recent": False}
    )
    budget_exhausted: bool = False
    cancelled: bool = False
    # What the pass queued for automatic triage (`queue_automatic_triage`).
    triage: dict[str, Any] | None = None

    def fail(self, code: str) -> None:
        self.status = "failed"
        self.error_code = code

    def interrupt(self, code: str) -> None:
        self.status = "partial"
        self.error_code = code

    def state(self, previous: Mapping[str, Any] | None) -> dict[str, Any]:
        finished_at = _now().isoformat()
        last_success_at = (
            (previous or {}).get("last_success_at")
            if self.status == "failed"
            else finished_at
        )
        return {
            "version": STATE_VERSION,
            "status": self.status,
            "started_at": self.started_at.isoformat(),
            "finished_at": finished_at,
            "last_success_at": last_success_at,
            "error_code": self.error_code,
            "counts": dict(self.counts),
            "pages": dict(self.pages),
            "truncated": dict(self.truncated),
            "budget_exhausted": self.budget_exhausted,
            "cancelled": self.cancelled,
            "triage": self.triage,
        }

    def result(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "status": self.status,
            "error_code": self.error_code,
            "counts": dict(self.counts),
            "truncated": dict(self.truncated),
            "budget_exhausted": self.budget_exhausted,
            "triage": self.triage,
        }
        if self.status == "failed":
            result["error"] = f"Error inbox sync failed ({self.error_code})"
            result["expected"] = self.error_code in EXPECTED_FAILURE_CODES
        return result


def _record_sync_state(report: _SyncReport) -> None:
    previous = get_ops_runtime_state(SYNC_STATE_KEY)
    set_ops_runtime_state(SYNC_STATE_KEY, report.state(previous))


def _unique(issues: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    # A listing can repeat an issue that moved between pages while it was read.
    unique: dict[str, dict[str, Any]] = {}
    for issue in issues:
        unique.setdefault(issue["external_id"], issue)
    return list(unique.values())


def _scored(
    issues: Sequence[dict[str, Any]], stored: Mapping[str, Mapping[str, Any]]
) -> list[dict[str, Any]]:
    """Score with the stored service: it comes from the latest event's tag."""
    rows = []
    for issue in issues:
        before = stored.get(issue["external_id"]) or {}
        service = before.get("service") or issue["service"]
        row = {**issue, "service": service}
        row["crate_score"] = crate_score(row)
        rows.append(row)
    return rows


def _upsert(issues: Sequence[dict[str, Any]], synced_at: datetime) -> list[dict]:
    rows = _scored(issues, sync_state([issue["external_id"] for issue in issues]))
    upsert_issues(rows, synced_at=synced_at)
    return rows


def _needs_digest(row: Mapping[str, Any], before: Mapping[str, Any] | None) -> bool:
    return (
        before is None
        or before.get("digest_hash") is None
        or before.get("last_seen") != row.get("last_seen")
    )


def _priority(row: Mapping[str, Any]) -> tuple[int, float, str]:
    last_seen = row.get("last_seen")
    return (
        -int(row["crate_score"]),
        -last_seen.timestamp() if isinstance(last_seen, datetime) else 0.0,
        row["external_id"],
    )


def _event_id(digest: Mapping[str, Any]) -> str | None:
    value = digest.get("event_id")
    if not isinstance(value, str) or len(value) > MAX_EVENT_ID_LENGTH:
        return None
    return value or None


def _release_checks() -> set[str]:
    state = get_ops_runtime_state(RELEASE_CHECKS_KEY) or {}
    ids = state.get("external_ids")
    if not isinstance(ids, list):
        return set()
    return {value for value in ids if isinstance(value, str)}


def _record_release_checks(
    previous: set[str], answered: set[str], listed: Sequence[str]
) -> None:
    # Only listed issues can be looked up again, so the others are dropped.
    checks = (previous | answered) & set(listed)
    if checks != previous:
        set_ops_runtime_state(
            RELEASE_CHECKS_KEY,
            {"version": STATE_VERSION, "external_ids": sorted(checks)},
        )


class _Pass:
    def __init__(
        self,
        client: SentryClient,
        config: ErrorTrackingConfig,
        report: _SyncReport,
        *,
        cancelled: Callable[[], bool],
        clock: Callable[[], float],
    ) -> None:
        self.client = client
        self.config = config
        self.report = report
        self.cancelled = cancelled
        self.clock = clock
        self.deadline = clock() + SYNC_BUDGET_SECONDS
        self.issue_reads = 0

    def should_stop(self) -> bool:
        if self.cancelled():
            self.report.cancelled = True
            return True
        if self.clock() >= self.deadline:
            self.report.budget_exhausted = True
            return True
        return False

    def run(self) -> None:
        report = self.report
        try:
            scopes = self.client.check_scopes()
        except SentryAuthError:
            record_access(
                self.config,
                source="sync",
                access={"read": False, "write": False},
                error_code="SENTRY_AUTH",
            )
            raise
        record_access(self.config, source="sync", access=_access_from_scopes(scopes))

        # Both listings come before any write: a failure keeps the previous rows.
        full = self.client.iter_unresolved(
            max_pages=MAX_LIST_PAGES, stats_period=LIST_STATS_PERIOD
        )
        recent = self.client.iter_unresolved(
            max_pages=MAX_LIST_PAGES, stats_period=RECENT_STATS_PERIOD
        )
        for name, listing in (("full", full), ("recent", recent)):
            report.pages[name] = listing.pages
            report.truncated[name] = listing.truncated
            if listing.truncated:
                log.warning(
                    "Sentry %s issue listing truncated at %d pages",
                    name,
                    MAX_LIST_PAGES,
                )
        report.counts["listed"] = len(full.issues)
        report.counts["listed_recent"] = len(recent.issues)
        issues = merge_recent_window(_unique(full.issues), _unique(recent.issues))

        stored = sync_state([issue["external_id"] for issue in issues])
        rows = _scored(issues, stored)
        report.counts["upserted"] = upsert_issues(rows, synced_at=report.started_at)

        listed = [row["external_id"] for row in rows]
        error_code = self.refresh_digests(rows, stored)
        if error_code is None:
            error_code = self.refresh_releases(listed)
        if error_code is None:
            error_code = self.refresh_missing(listed)
        if error_code is not None:
            log.warning("Error inbox sync stopped early: %s", error_code)
            report.interrupt(error_code)
        elif report.cancelled or report.budget_exhausted:
            report.status = "partial"
        report.counts["purged"] = purge_closed()

    def refresh_digests(
        self,
        rows: Sequence[dict[str, Any]],
        stored: Mapping[str, Mapping[str, Any]],
    ) -> str | None:
        """Latest event of new or changed issues, highest score first, capped."""
        candidates = sorted(
            (row for row in rows if _needs_digest(row, stored.get(row["external_id"]))),
            key=_priority,
        )[:MAX_EVENT_FETCHES]
        if not candidates:
            return None
        local = sync_state([row["external_id"] for row in candidates])
        for row in candidates:
            target = local.get(row["external_id"])
            if target is None:
                continue
            if self.should_stop():
                return None
            try:
                event = self.client.latest_event(row["external_id"])
            except SentryNotFoundError:
                continue
            except SentryAPIError as error:
                return error.code
            digest = build_digest(event)
            tag = service_tag(digest)
            score = crate_score({**row, "service": tag or row["service"]})
            set_digest(
                target["id"],
                digest=digest,
                digest_event_id=_event_id(digest),
                digest_hash=digest_hash(digest),
                group_key=group_key(digest),
                service=tag,
                crate_score=score,
                last_release=digest.get("release"),
            )
            self.report.counts["digests_fetched"] += 1
        return None

    def refresh_releases(self, listed: Sequence[str]) -> str | None:
        """First and last release of listed issues that lack a first one, capped.

        The listing carries no releases; the issue detail does. Candidates are open
        issues whose latest event has a release, highest score first. A detail read
        fills the issue for good, so it is read once; one without a first release is
        remembered and not read again while the issue stays listed.
        """
        room = min(MAX_RELEASE_LOOKUPS, MAX_STATUS_REFRESHES - self.issue_reads)
        checked = _release_checks()
        candidates = release_candidates(listed, exclude=sorted(checked), limit=room)
        answered: set[str] = set()
        error_code: str | None = None
        for item in candidates:
            if self.should_stop():
                break
            self.issue_reads += 1
            try:
                issue = self.client.get_issue(item["external_id"])
            except SentryNotFoundError:
                answered.add(item["external_id"])
                continue
            except SentryAPIError as error:
                error_code = error.code
                break
            set_releases(
                item["id"],
                first_release=issue.get("first_release"),
                last_release=issue.get("last_release"),
            )
            self.report.counts["releases_fetched"] += 1
            if not issue.get("first_release"):
                answered.add(item["external_id"])
        _record_release_checks(checked, answered, listed)
        return error_code

    def refresh_missing(self, listed: Sequence[str]) -> str | None:
        """Status of open local issues the listing no longer returns, capped.

        The details read for releases this pass count against the same cap.
        """
        missing = open_ids_not_in(
            listed, limit=max(MAX_STATUS_REFRESHES - self.issue_reads, 0)
        )
        fetched: list[dict[str, Any]] = []
        gone: list[str] = []
        error_code: str | None = None
        for item in missing:
            if self.should_stop():
                break
            self.issue_reads += 1
            try:
                fetched.append(self.client.get_issue(item["external_id"]))
            except SentryNotFoundError:
                # Deleted or merged in Sentry: close it so the purge removes it.
                gone.append(item["id"])
            except SentryAPIError as error:
                error_code = error.code
                break
        if fetched:
            # Absent from the 24 h listing: no users that day.
            _upsert(merge_recent_window(fetched, []), self.report.started_at)
        if gone:
            mark_status(gone, "resolved")
        self.report.counts["status_refreshed"] = len(fetched) + len(gone)
        return error_code


def sync_issues(
    *,
    client_factory: ClientFactory | None = None,
    cancelled: Callable[[], bool] = lambda: False,
    clock: Callable[[], float] = time.monotonic,
) -> dict[str, Any]:
    """One sync pass. A no-op when error tracking is not configured."""
    report = _SyncReport(started_at=_now())
    try:
        config = load_config()
    except ErrorTrackingConfigError as error:
        report.fail(error.code)
        _record_sync_state(report)
        return report.result()
    if config is None:
        return {"status": "skipped", "reason": "not_configured"}

    factory = client_factory or SentryClient
    try:
        token = load_sentry_token(config)
        with factory(config, token) as client:
            _Pass(client, config, report, cancelled=cancelled, clock=clock).run()
    except (ErrorTrackingConfigError, SentryAPIError) as error:
        log.warning("Error inbox sync failed: %s", error.code)
        report.fail(error.code)
    except Exception:
        report.fail("ERROR_INBOX_SYNC_FAILED")
        try:
            _record_sync_state(report)
        except Exception:
            log.warning("Could not record the error inbox sync state", exc_info=True)
        raise
    if report.status != "failed" and not report.cancelled:
        report.triage = _automatic_triage(config)
    _record_sync_state(report)
    return report.result()


# -- automatic triage (E2, design §7.1) ------------------------------------------

TRIAGE_ACTION = ACTION_BY_KIND["triage"]


def queue_automatic_triage(
    config: ErrorTrackingConfig,
    *,
    now: datetime | None = None,
    accept: Callable[[str], dict] = accept_action,
) -> dict[str, Any]:
    """Queue triage for the open issues that need it, within the daily cap.

    Candidates are open issues whose current digest has no triage and that are new,
    regressed or escalating, or whose digest changed since an earlier triage or
    automatic attempt. Highest score first, at most `triage.daily_max` issues in 24
    hours, each issue at most once a day and each digest only once. The accepted
    configuration travels with the tasks; nothing is queued when the action has no
    usable model.
    """
    settings = config.triage
    if not settings.automatic:
        return {"status": "off", "queued": 0}
    plan = auto_triage_plan(daily_max=settings.daily_max, now=now)
    report: dict[str, Any] = {
        "status": "idle",
        "queued": 0,
        "queued_24h": plan["queued_24h"],
        "daily_max": settings.daily_max,
    }
    if not plan["candidates"]:
        if plan["room"] == 0:
            report["status"] = "cap_reached"
        return report
    try:
        acceptance = accept(TRIAGE_ACTION)
    except AIConfigurationError as error:
        return {**report, "status": "unavailable", "error_code": error.code}
    queued = queue_triages(
        plan["candidates"], origin="automatic", acceptance=acceptance, at=now
    )
    return {
        **report,
        "status": "queued",
        "queued": len(queued["task_ids"]),
        "queued_24h": plan["queued_24h"] + len(queued["task_ids"]),
        "deduplicated": queued["deduplicated"],
    }


def _automatic_triage(config: ErrorTrackingConfig) -> dict[str, Any]:
    # The sync itself succeeded: a failure to queue triage is reported, not raised.
    try:
        return queue_automatic_triage(config)
    except Exception:
        log.exception("Could not queue automatic error triage")
        return {"status": "failed", "queued": 0, "error_code": "ERROR_TRIAGE_FAILED"}


# -- status changes -------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class _StatusRequest:
    issue_id: str
    status: str
    substatus: str | None
    in_next_release: bool
    actor_id: int

    @property
    def sentry_status(self) -> str:
        if self.status == "resolved" and self.in_next_release:
            return "resolvedInNextRelease"
        return self.status


def _status_request(params: Mapping[str, Any]) -> _StatusRequest:
    issue_id = params.get("issue_id")
    status = params.get("status")
    substatus = params.get("substatus")
    in_next_release = params.get("in_next_release", False)
    actor_id = params.get("actor_id")
    if (
        not isinstance(issue_id, str)
        or not isinstance(status, str)
        or status not in ISSUE_STATUSES
        or (
            substatus is not None
            and (not isinstance(substatus, str) or substatus not in SUBSTATUSES)
        )
        or not isinstance(in_next_release, bool)
        or (in_next_release and status != "resolved")
        or isinstance(actor_id, bool)
        or not isinstance(actor_id, int)
    ):
        raise ValueError("Invalid status change request")
    return _StatusRequest(
        issue_id=issue_id,
        status=status,
        substatus=substatus,
        in_next_release=in_next_release,
        actor_id=actor_id,
    )


def update_issue_status(
    task_id: str,
    params: Mapping[str, Any],
    *,
    client_factory: ClientFactory | None = None,
) -> dict[str, Any]:
    """Change an issue's status in Sentry for a person, then locally, audited."""
    try:
        request = _status_request(params)
    except ValueError:
        return _failed("ERROR_ISSUE_INVALID_REQUEST", "Invalid status change request")
    issue = get_issue(request.issue_id)
    if issue is None:
        return _failed("ERROR_ISSUE_NOT_FOUND", "The issue is no longer in the inbox")
    try:
        config = load_config()
        if config is None:
            return _failed(
                "ERROR_TRACKING_NOT_CONFIGURED", "Error tracking is not configured"
            )
        if known_write_access(config) is False:
            return _failed(
                "SENTRY_WRITE_SCOPE_MISSING",
                "The Sentry token lacks event:write; the inbox is read-only",
            )
        token = load_sentry_token(config)
        with (client_factory or SentryClient)(config, token) as client:
            updated = client.update_status(
                str(issue["external_id"]),
                request.sentry_status,
                substatus=request.substatus,
            )
    except (ErrorTrackingConfigError, SentryAPIError) as error:
        log.warning("Sentry status update failed: %s", error.code)
        return _failed(error.code, str(error))
    recorded = record_status_change(
        request.issue_id,
        status=updated["status"],
        substatus=updated.get("substatus"),
        actor_id=request.actor_id,
        task_id=task_id,
    )
    return {
        "status": "succeeded",
        "issue_id": request.issue_id,
        "short_id": issue["short_id"],
        "issue_status": updated["status"],
        "substatus": updated.get("substatus"),
        "recorded": recorded,
    }


# -- connection test --------------------------------------------------------------


def check_connection(*, client_factory: ClientFactory | None = None) -> dict[str, Any]:
    """Check the token's scopes and record the access the inbox can rely on."""
    try:
        config = load_config()
    except ErrorTrackingConfigError as error:
        return _failed(error.code, str(error))
    if config is None:
        return _failed(
            "ERROR_TRACKING_NOT_CONFIGURED", "Error tracking is not configured"
        )
    try:
        token = load_sentry_token(config)
        with (client_factory or SentryClient)(config, token) as client:
            scopes = client.check_scopes()
    except (ErrorTrackingConfigError, SentryAPIError) as error:
        access: dict[str, bool | None] = (
            {"read": False, "write": False}
            if isinstance(error, SentryAuthError)
            else dict(_UNKNOWN_ACCESS)
        )
        record_access(
            config, source="connection_test", access=access, error_code=error.code
        )
        return _failed(error.code, str(error), access=access)
    access = _access_from_scopes(scopes)
    record_access(config, source="connection_test", access=access)
    return {"status": "succeeded", "access": access}


# -- AI triage and investigation tasks (E2) ---------------------------------------

ACTION_LABEL = {
    "triage": "Triage error issue",
    "investigation": "Investigate error issue",
}
_UNAVAILABLE_CODES = frozenset(
    {
        "AI_ACTION_DISABLED",
        "AI_ACTION_UNKNOWN",
        "AI_CONNECTION_UNAVAILABLE",
        "AI_CREDENTIAL_REQUIRED",
        "AI_CREDENTIAL_UNAVAILABLE",
        "AI_PROFILE_INCOMPATIBLE",
        "AI_PROFILE_UNKNOWN",
        "AI_RUNTIME_UNAVAILABLE",
    }
)


@dataclass(frozen=True, slots=True)
class _TriageRequest:
    issue_id: str
    origin: str
    actor_id: int | None
    acceptance: Mapping[str, Any] | None


def _triage_request(params: Mapping[str, Any], kind: str) -> _TriageRequest:
    issue_id = params.get("issue_id")
    origin = params.get("origin", "investigate" if kind == "investigation" else None)
    actor_id = params.get("actor_user_id")
    acceptance = params.get("ai_acceptance")
    allowed = {"investigate"} if kind == "investigation" else TRIAGE_ORIGINS
    if (
        not isinstance(issue_id, str)
        or origin not in allowed
        or isinstance(actor_id, bool)
        or (actor_id is not None and not isinstance(actor_id, int))
        # A person's request carries the person; automatic triage carries nobody.
        or (origin == "automatic") != (actor_id is None)
        or (acceptance is not None and not isinstance(acceptance, Mapping))
    ):
        raise ValueError("Invalid triage request")
    return _TriageRequest(issue_id, str(origin), actor_id, acceptance)


def ai_problem_text(
    kind: str, code: str | None, outcome: TriageOutcome | None = None
) -> str:
    """A plain account of a failed triage or investigation, for the task result."""
    label = ACTION_LABEL.get(kind, "this action")
    if code == INPUT_TOO_LARGE_CODE:
        if outcome is not None and outcome.input_tokens and outcome.input_limit:
            return (
                f"This issue needs about {outcome.input_tokens:,} input tokens; the "
                f"AI profile bound to {label} allows {outcome.input_limit:,}. Raise "
                "its input limit in AI models and try again."
            )
        return (
            f"This issue is larger than the AI profile bound to {label} accepts. "
            "Raise its input limit in AI models and try again."
        )
    if code == OUTPUT_LIMIT_CODE:
        limit = (
            f"{outcome.output_limit:,}-token "
            if outcome is not None and outcome.output_limit
            else ""
        )
        return (
            f"The answer was cut off at the AI profile's {limit}output limit, so "
            f"nothing was saved. Raise it for {label} in AI models, or use a model "
            "that reasons less."
        )
    if code == "AI_RESPONSE_INVALID":
        return (
            "The model's answer did not match the expected format, so nothing was "
            "saved. Try again or bind another model."
        )
    if code in _UNAVAILABLE_CODES:
        return f"No usable model is bound to {label}. Bind one in AI models."
    if code == "AI_CONTEXT_STALE":
        return "The AI configuration changed after this was queued. Start it again."
    if code == "AI_AUTHORITY_REVOKED":
        return "The person who asked for this can no longer manage errors."
    if code == "AI_EXECUTION_ALREADY_ACCEPTED":
        return (
            "This event was already sent to the model by an earlier attempt that "
            "saved nothing. Use Investigate or Triage backlog to try again."
        )
    if code in {"AI_PROVIDER_TIMEOUT", "AI_TASK_DEADLINE"}:
        return "The model did not answer in time. Try again."
    if code in {"AI_DAILY_CALL_LIMIT", "AI_DAILY_TOKEN_LIMIT"}:
        return "The AI connection reached its daily limit. Try again tomorrow."
    if code == "AI_CONCURRENCY_LIMIT":
        return "The AI connection stayed busy. Try again in a few minutes."
    return f"The AI call failed ({code or 'unknown error'})."


def _ai_failed(
    kind: str,
    code: str | None,
    outcome: TriageOutcome | None = None,
    **extra: Any,
) -> dict[str, Any]:
    return {
        **extra,
        "status": "failed",
        "kind": kind,
        "error_code": code,
        "error": ai_problem_text(kind, code, outcome),
        # Configuration and model answers, shown in the admin and in AI activity.
        "expected": True,
    }


def run_triage_task(
    task_id: str,
    params: Mapping[str, Any],
    *,
    kind: str,
    execute: StructuredExecutor,
    sentry_factory: ClientFactory | None = None,
) -> dict[str, Any]:
    """One triage or investigation task. The handler names the executor."""
    try:
        request = _triage_request(params, kind)
    except ValueError:
        return _failed("ERROR_TRIAGE_INVALID_REQUEST", "Invalid triage request")
    try:
        call = resume_action(
            ACTION_BY_KIND[kind],
            dict(request.acceptance) if request.acceptance else None,
            actor_id=request.actor_id,
            job_id=task_id,
        )
    except AIConfigurationError as error:
        return _ai_failed(kind, error.code, issue_id=request.issue_id)

    evidence: dict[str, Any] = {}

    def read_evidence(data: Mapping[str, Any]) -> dict[str, Any]:
        found = fetch_evidence(
            str(data.get("external_id") or ""),
            data["digest"],
            client_factory=sentry_factory,
        )
        evidence.update(found.summary())
        return found.data

    outcome = triage_issue(
        request.issue_id,
        "investigation" if kind == "investigation" else "triage",
        request.actor_id,
        execute=execute,
        context=call["context"],
        job_id=task_id,
        # Automatic triage sends a digest once; a person's request is its own attempt.
        attempt=None if request.origin == "automatic" else task_id,
        evidence=read_evidence if kind == "investigation" else None,
    )
    base: dict[str, Any] = {
        "kind": kind,
        "issue_id": request.issue_id,
        "digest_hash": outcome.digest_hash,
    }
    if evidence:
        base["evidence"] = evidence
    if outcome.status in {"saved", "existing"}:
        return {"status": outcome.status, "triage_id": outcome.triage_id, **base}
    if outcome.status in {"not_found", "no_digest"}:
        return {"status": "skipped", "reason": outcome.status, **base}
    return _ai_failed(
        kind,
        outcome.error_code,
        outcome,
        issue_id=request.issue_id,
        digest_hash=outcome.digest_hash,
        input_tokens=outcome.input_tokens,
        input_limit=outcome.input_limit,
        output_limit=outcome.output_limit,
        **({"evidence": evidence} if evidence else {}),
    )


# -- task handlers --------------------------------------------------------------


def _handle_sync_error_issues(task_id: str, params: dict, config: dict) -> dict:
    return sync_issues(cancelled=lambda: is_cancelled(task_id))


def _handle_update_error_issue_status(task_id: str, params: dict, config: dict) -> dict:
    return update_issue_status(task_id, params)


def _handle_test_error_tracking_connection(
    task_id: str, params: dict, config: dict
) -> dict:
    return check_connection()


# The AI-lane handlers name the structured executor themselves: that makes them the
# roots of the model-calling chain tests/test_ai_architecture.py checks.
def _handle_triage_error_issue(task_id: str, params: dict, config: dict) -> dict:
    return run_triage_task(task_id, params, kind="triage", execute=execute_structured)


def _handle_investigate_error_issue(task_id: str, params: dict, config: dict) -> dict:
    return run_triage_task(
        task_id, params, kind="investigation", execute=execute_structured
    )


# Phases of an evaluation: reading reference issues from Sentry, then the calls.
EVALUATION_PHASES = {"fetch": "fetch_references", "evaluate": "evaluate_triage"}


def _handle_evaluate_error_triage(task_id: str, params: dict, config: dict) -> dict:
    progress = TaskProgress(
        phase=EVALUATION_PHASES["evaluate"], phase_count=len(EVALUATION_PHASES)
    )

    def report(phase: str, done: int, total: int, short_id: str) -> None:
        phases = list(EVALUATION_PHASES)
        progress.phase = EVALUATION_PHASES.get(phase, phase)
        progress.phase_index = phases.index(phase) if phase in phases else 0
        progress.done, progress.total, progress.item = done, total, short_id
        emit_progress(task_id, progress, force=done == total)

    return run_evaluation(
        task_id,
        params,
        execute=execute_structured,
        cancelled=lambda: is_cancelled(task_id),
        progress=report,
    )


ERROR_INBOX_TASK_HANDLERS: dict[str, TaskHandler] = {
    "sync_error_issues": _handle_sync_error_issues,
    "update_error_issue_status": _handle_update_error_issue_status,
    "test_error_tracking_connection": _handle_test_error_tracking_connection,
    "triage_error_issue": _handle_triage_error_issue,
    "investigate_error_issue": _handle_investigate_error_issue,
    "evaluate_error_triage": _handle_evaluate_error_triage,
}

__all__ = [
    "ACCESS_STATE_KEY",
    "ERROR_INBOX_TASK_HANDLERS",
    "MAX_EVENT_FETCHES",
    "MAX_LIST_PAGES",
    "MAX_STATUS_REFRESHES",
    "SYNC_STATE_KEY",
    "ai_problem_text",
    "check_connection",
    "known_write_access",
    "queue_automatic_triage",
    "run_triage_task",
    "sync_issues",
    "update_issue_status",
]

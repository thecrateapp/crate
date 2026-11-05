"""Error inbox tasks: the Sentry sync, status changes and the connection test.

Only these tasks talk to Sentry (EI-D3); the admin reads PostgreSQL. No HTTP call
runs inside a database transaction: every repository call opens and closes its own
scope between requests. The token is handed to the client and nothing else: it never
reaches a log line, a task result or the runtime state, and neither do response
bodies or event text.

Runtime state (`ops_runtime_state`) the admin API and MCP read; the keys and the
write-access check live in `crate.error_inbox.state`:

- `error_inbox`, written by every sync pass (see `_SyncReport.state`): `status`
  (`ok`, `partial` or `failed`), `started_at`, `finished_at`, `last_success_at`,
  the typed `error_code` of the pass, `counts` (`listed`, `listed_recent`,
  `upserted`, `digests_fetched`, `status_refreshed`, `purged`), `pages`,
  `truncated` (`full`, `recent`), `budget_exhausted` and `cancelled`.
- `error_inbox_access`: `read` and `write` (true, false or null when unknown),
  `credential` (a hash of the token's secret ref, never the token), `source`
  (`sync` or `connection_test`), `checked_at` and `error_code`.

Write access (EI-D4) comes from `check_scopes`. The connection test records it every
time it runs; each sync pass records it when the scope check succeeds or the token
is rejected, so it stays current within one schedule interval of a token or scope
change. `update_error_issue_status` refuses without calling Sentry only when the
recorded access belongs to the current token and says `write: false`. Unknown access
(never checked, a different token, or Sentry did not report scopes) lets Sentry
decide, and a 403 comes back as `SENTRY_FORBIDDEN`.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from crate.db.ops_runtime import get_ops_runtime_state, set_ops_runtime_state
from crate.db.queries.error_issues import get_issue, open_ids_not_in, sync_state
from crate.db.repositories.error_issues import (
    mark_status,
    purge_closed,
    record_status_change,
    set_digest,
    upsert_issues,
)
from crate.error_inbox.config import (
    ErrorTrackingConfig,
    ErrorTrackingConfigError,
    load_config,
    load_sentry_token,
)
from crate.error_inbox.digest import build_digest, digest_hash, group_key
from crate.error_inbox.priority import crate_score
from crate.error_inbox.state import (
    ACCESS_STATE_KEY,
    STATE_VERSION,
    SYNC_STATE_KEY,
    known_write_access,
    record_access,
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
from crate.worker_handlers import TaskHandler, is_cancelled

log = logging.getLogger(__name__)

ClientFactory = Callable[[ErrorTrackingConfig, str], SentryClient]

MAX_LIST_PAGES = 5
MAX_EVENT_FETCHES = 25
MAX_STATUS_REFRESHES = 50
# Leaves room under the 120 s task limit to write what was fetched and the state.
SYNC_BUDGET_SECONDS = 90.0
ISSUE_STATUSES = frozenset({"resolved", "ignored", "unresolved"})
MAX_SERVICE_LENGTH = 100
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
        }

    def result(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "status": self.status,
            "error_code": self.error_code,
            "counts": dict(self.counts),
            "truncated": dict(self.truncated),
            "budget_exhausted": self.budget_exhausted,
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


def _service_tag(digest: Mapping[str, Any]) -> str | None:
    tags = digest.get("tags")
    value = tags.get("service") if isinstance(tags, Mapping) else None
    if not isinstance(value, str):
        return None
    return value.strip()[:MAX_SERVICE_LENGTH] or None


def _event_id(digest: Mapping[str, Any]) -> str | None:
    value = digest.get("event_id")
    if not isinstance(value, str) or len(value) > MAX_EVENT_ID_LENGTH:
        return None
    return value or None


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

        error_code = self.refresh_digests(rows, stored)
        if error_code is None:
            error_code = self.refresh_missing([row["external_id"] for row in rows])
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
            tag = _service_tag(digest)
            score = crate_score({**row, "service": tag or row["service"]})
            set_digest(
                target["id"],
                digest=digest,
                digest_event_id=_event_id(digest),
                digest_hash=digest_hash(digest),
                group_key=group_key(digest),
                service=tag,
                crate_score=score,
            )
            self.report.counts["digests_fetched"] += 1
        return None

    def refresh_missing(self, listed: Sequence[str]) -> str | None:
        """Status of open local issues the listing no longer returns, capped."""
        missing = open_ids_not_in(listed, limit=MAX_STATUS_REFRESHES)
        fetched: list[dict[str, Any]] = []
        gone: list[str] = []
        error_code: str | None = None
        for item in missing:
            if self.should_stop():
                break
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
    _record_sync_state(report)
    return report.result()


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


# -- task handlers --------------------------------------------------------------


def _handle_sync_error_issues(task_id: str, params: dict, config: dict) -> dict:
    return sync_issues(cancelled=lambda: is_cancelled(task_id))


def _handle_update_error_issue_status(task_id: str, params: dict, config: dict) -> dict:
    return update_issue_status(task_id, params)


def _handle_test_error_tracking_connection(
    task_id: str, params: dict, config: dict
) -> dict:
    return check_connection()


ERROR_INBOX_TASK_HANDLERS: dict[str, TaskHandler] = {
    "sync_error_issues": _handle_sync_error_issues,
    "update_error_issue_status": _handle_update_error_issue_status,
    "test_error_tracking_connection": _handle_test_error_tracking_connection,
}

__all__ = [
    "ACCESS_STATE_KEY",
    "ERROR_INBOX_TASK_HANDLERS",
    "MAX_EVENT_FETCHES",
    "MAX_LIST_PAGES",
    "MAX_STATUS_REFRESHES",
    "SYNC_STATE_KEY",
    "check_connection",
    "known_write_access",
    "sync_issues",
    "update_issue_status",
]

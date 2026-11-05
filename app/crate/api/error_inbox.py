"""Error inbox admin API: Sentry issues synced into Crate.

Reads come from PostgreSQL and `ops_runtime_state`; writes enqueue worker tasks. No
handler calls Sentry, GitHub or a model (EI-D3). Errors carry their code in the
`X-Crate-Error` header and the message in `detail`, like the other admin routers.

The Sentry token is accepted only by `PUT /connection`. It is never returned, never
logged and never echoed in a validation error.
"""

from __future__ import annotations

from typing import NoReturn

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute

from crate.api.openapi_responses import (
    AUTH_ERROR_RESPONSES,
    OpenApiResponses,
    error_response,
    merge_responses,
)
from crate.api.permissions import require_permission
from crate.api.schemas.common import TaskEnqueueResponse
from crate.api.schemas.error_inbox import (
    Classification,
    ErrorIssueDetail,
    ErrorIssueList,
    ErrorIssueStatusChange,
    ErrorSummary,
    ErrorTrackingConnection,
    ErrorTrackingConnectionUpdate,
    IssueLane,
    IssueStatusFilter,
)
from crate.db.queries.error_issues import MAX_LIST_LIMIT, get_issue, list_issues
from crate.db.repositories.tasks import (
    create_task,
    create_task_dedup,
    find_active_task_by_type_params,
)
from crate.error_inbox import views
from crate.error_inbox.config import ErrorTrackingConfigError, save_config
from crate.error_inbox.state import record_access, write_access

VIEW = "ops.errors.view"
MANAGE = "ops.errors.manage"
CONNECTION = "ops.runtime.manage"
STATUS_TASK = "update_error_issue_status"
CONNECTION_TEST_TASK = "test_error_tracking_connection"
CONNECTION_TEST_DEDUP_KEY = "error-tracking:connection-test"


def _fail(status: int, code: str, message: str) -> NoReturn:
    raise HTTPException(
        status, message, headers={"X-Crate-Error": code, "Cache-Control": "no-store"}
    )


class ErrorInboxRoute(APIRoute):
    """Map request validation to the inbox error codes without echoing the input."""

    def get_route_handler(self):
        handler = super().get_route_handler()
        if "GET" in (self.methods or ()):
            failure = (400, "ERROR_INBOX_INVALID_FILTER", "Invalid error inbox filter")
        elif self.path.endswith("/connection"):
            failure = (
                422,
                "ERROR_TRACKING_INVALID",
                "Invalid error tracking settings",
            )
        else:
            failure = (422, "ERROR_INBOX_INVALID_REQUEST", "Invalid request")

        async def validated(request):
            try:
                return await handler(request)
            except RequestValidationError:
                _fail(*failure)

        return validated


def private_response(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


router = APIRouter(
    prefix="/api/admin/errors",
    tags=["errors"],
    route_class=ErrorInboxRoute,
    dependencies=[Depends(private_response)],
)

_NOT_FOUND: OpenApiResponses = {
    404: error_response("ERROR_ISSUE_NOT_FOUND: error issue not found.")
}
_NOT_CONFIGURED: OpenApiResponses = {
    409: error_response("ERROR_TRACKING_NOT_CONFIGURED: no settings or no token.")
}
_STATUS_CONFLICT: OpenApiResponses = {
    409: error_response(
        "ERROR_TRACKING_NOT_CONFIGURED, or ERROR_TRACKING_WRITE_SCOPE_MISSING when the "
        "token is known to lack event:write."
    )
}


def _enqueue(task_type: str, params: dict, *, dedup_key: str, actor_id: int) -> str:
    """Queue once per dedup key; an identical pending request returns its task."""
    options = {"origin": "admin", "actor_user_id": actor_id}
    return (
        create_task_dedup(task_type, params, dedup_key=dedup_key, **options)
        or find_active_task_by_type_params(task_type, dedup_key=dedup_key)
        # The previous task finished between both calls: queue a fresh one.
        or create_task(task_type, params, dedup_key=dedup_key, **options)
    )


@router.get(
    "",
    response_model=ErrorIssueList,
    responses=merge_responses(
        AUTH_ERROR_RESPONSES,
        {400: error_response("ERROR_INBOX_INVALID_FILTER: invalid filter or cursor.")},
    ),
    summary="List error inbox issues, critical lane first",
)
def list_errors(
    request: Request,
    status: IssueStatusFilter = "unresolved",
    lane: IssueLane = "all",
    service: str | None = Query(None, max_length=100),
    classification: Classification | None = None,
    release: str | None = Query(
        None,
        max_length=300,
        description="Matches the issue's first or last release.",
    ),
    limit: int = Query(50, ge=1, le=MAX_LIST_LIMIT),
    cursor: str | None = Query(None, max_length=16),
):
    require_permission(request, VIEW)
    try:
        return list_issues(
            status=status,
            critical_only=lane == "critical",
            service=service or None,
            classification=classification,
            release=release or None,
            limit=limit,
            cursor=cursor or None,
        )
    except ValueError:
        _fail(400, "ERROR_INBOX_INVALID_FILTER", "Invalid error inbox filter")


@router.get(
    "/summary",
    response_model=ErrorSummary,
    responses=AUTH_ERROR_RESPONSES,
    summary="Error inbox counts, top critical issues and the last sync",
)
def error_summary(request: Request):
    require_permission(request, VIEW)
    return views.inbox_summary()


@router.get(
    "/connection",
    response_model=ErrorTrackingConnection,
    responses=AUTH_ERROR_RESPONSES,
    summary="Read the error tracking connection without its token",
)
def get_connection(request: Request):
    require_permission(request, CONNECTION)
    return views.connection_view()


@router.put(
    "/connection",
    response_model=ErrorTrackingConnection,
    responses=merge_responses(
        AUTH_ERROR_RESPONSES,
        {422: error_response("ERROR_TRACKING_INVALID: the settings were rejected.")},
    ),
    summary="Save the error tracking connection; the token is write-only",
)
def put_connection(request: Request, body: ErrorTrackingConnectionUpdate):
    require_permission(request, CONNECTION)
    current = views.stored_connection().config
    # Triage and fix settings are not edited here (E2/E3): keep the stored ones.
    preserved = (
        {key: current.to_settings()[key] for key in ("triage", "fix")}
        if current
        else {}
    )
    token = body.new_token()
    try:
        saved = save_config({**preserved, **body.settings()}, sentry_token=token)
    except ErrorTrackingConfigError as error:
        _fail(422, "ERROR_TRACKING_INVALID", error.message)
    if token is not None:
        # The previous check described the old token: the new one is unknown.
        record_access(saved, source="token_saved", access={"read": None, "write": None})
    return views.connection_view()


@router.post(
    "/connection/test",
    status_code=202,
    response_model=TaskEnqueueResponse,
    response_model_exclude_none=True,
    responses=merge_responses(AUTH_ERROR_RESPONSES, _NOT_CONFIGURED),
    summary="Queue a check of the Sentry token's access",
)
def test_connection(request: Request):
    actor = require_permission(request, CONNECTION)
    if not views.stored_connection().configured:
        _fail(409, "ERROR_TRACKING_NOT_CONFIGURED", "Error tracking is not configured")
    task_id = _enqueue(
        CONNECTION_TEST_TASK,
        {},
        dedup_key=CONNECTION_TEST_DEDUP_KEY,
        actor_id=int(actor["id"]),
    )
    return {"task_id": task_id}


@router.get(
    "/{issue_id}",
    response_model=ErrorIssueDetail,
    responses=merge_responses(AUTH_ERROR_RESPONSES, _NOT_FOUND),
    summary="Read one issue with its digest and triage",
)
def error_detail(request: Request, issue_id: str):
    require_permission(request, VIEW)
    issue = views.issue_detail(issue_id)
    if issue is None:
        _fail(404, "ERROR_ISSUE_NOT_FOUND", "Error issue not found")
    return issue


@router.post(
    "/{issue_id}/status",
    status_code=202,
    response_model=TaskEnqueueResponse,
    response_model_exclude_none=True,
    responses=merge_responses(
        AUTH_ERROR_RESPONSES,
        _NOT_FOUND,
        _STATUS_CONFLICT,
        {422: error_response("The status change is invalid.")},
    ),
    summary="Queue a status change of an issue in Sentry",
)
def change_status(request: Request, issue_id: str, body: ErrorIssueStatusChange):
    actor = require_permission(request, MANAGE)
    issue = get_issue(issue_id)
    if issue is None:
        _fail(404, "ERROR_ISSUE_NOT_FOUND", "Error issue not found")
    stored = views.stored_connection()
    if not stored.configured:
        _fail(409, "ERROR_TRACKING_NOT_CONFIGURED", "Error tracking is not configured")
    if write_access(stored.config, stored.access_state) is False:
        _fail(
            409,
            "ERROR_TRACKING_WRITE_SCOPE_MISSING",
            "The Sentry token lacks event:write; the inbox is read-only",
        )
    actor_id = int(actor["id"])
    params: dict = {"issue_id": issue["id"], "status": body.status}
    if body.substatus is not None:
        params["substatus"] = body.substatus
    if body.in_next_release:
        params["in_next_release"] = True
    params["actor_id"] = actor_id
    dedup_key = ":".join(
        (
            "error-issue-status",
            issue["id"],
            body.status,
            body.substatus or "",
            "next-release" if body.in_next_release else "",
        )
    )
    return {
        "task_id": _enqueue(STATUS_TASK, params, dedup_key=dedup_key, actor_id=actor_id)
    }


__all__ = ["router"]

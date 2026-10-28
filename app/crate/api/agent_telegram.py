"""Independent native Telegram events, authenticated separately from MCP."""

import os
from pathlib import Path
from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import TypeAdapter, ValidationError
from starlette.concurrency import run_in_threadpool

from crate.agent_diagnostics import DiagnosticError
from crate.agent_telegram import CALLBACK_PATH, verify_transport
from crate.api.agent_guards import require_agent_admin_session
from crate.api.agent_integrations import invoke, private_response
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES
from crate.api.schemas.agent_telegram import (
    NativeEvent,
    TelegramApproverBindings,
    TelegramBindingInput,
    TelegramBindingResult,
    TelegramBindingRevoked,
)
from crate.db.repositories.agent_telegram import (
    bind_human,
    list_bindings,
    native_event,
    revoke_binding,
)

router = APIRouter(tags=["agents"], dependencies=[Depends(private_response)])


@router.get(
    "/api/admin/agent-telegram/bindings",
    response_model=TelegramApproverBindings,
    responses=AUTH_ERROR_RESPONSES,
    openapi_extra={"security": [{"cookieAuth": []}]},
    summary="List the humans bound to approve plans from Telegram on this instance",
)
def bindings(
    request: Request,
    principal_id: str | None = Query(None, max_length=64),
):
    require_agent_admin_session(request, "agents.integrations.manage")
    return invoke(list_bindings, principal_id=principal_id)


@router.delete(
    "/api/admin/agent-telegram/bindings/{binding_id}",
    response_model=TelegramBindingRevoked,
    responses=AUTH_ERROR_RESPONSES,
    openapi_extra={"security": [{"cookieAuth": []}]},
    summary="Remove a Telegram approver binding; its pending approvals stop counting",
)
def unbind(request: Request, binding_id: str):
    actor = require_agent_admin_session(request, "agents.integrations.manage")
    return invoke(revoke_binding, actor, binding_id)


@router.post(
    "/api/admin/agent-telegram/bind",
    response_model=TelegramBindingResult,
    responses=AUTH_ERROR_RESPONSES,
    openapi_extra={"security": [{"cookieAuth": []}]},
    summary="Bind this independent human to a fixed private Telegram account",
)
def bind(request: Request, body: TelegramBindingInput):
    actor = require_agent_admin_session(request, "agents.integrations.manage")
    return invoke(bind_human, actor, str(body.principal_id), body.telegram_user_id)


def _verified_event(body, headers):
    try:
        key = (
            Path(
                os.environ.get(
                    "CRATE_TELEGRAM_KEY_FILE",
                    "/run/crate-telegram-secrets/callback-key",
                )
            )
            .read_bytes()
            .strip()
        )
        nonce = verify_transport(body, headers, key)
        event = TypeAdapter(cast(Any, NativeEvent)).validate_json(body).model_dump()
        return native_event(event, nonce)
    except (OSError, DiagnosticError, ValidationError) as error:
        code = error.code if isinstance(error, DiagnosticError) else "FORBIDDEN"
        raise HTTPException(403, code) from None


@router.post(
    CALLBACK_PATH,
    response_model=dict,
    responses=AUTH_ERROR_RESPONSES,
    openapi_extra={"security": [{"nativeTelegramHmac": []}]},
    summary="Accept signed native Telegram delivery and human callback receipts",
)
async def events(request: Request):
    if request.headers.get("authorization"):
        raise HTTPException(403, "Native HMAC authentication is required")
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 16384:
            raise HTTPException(413, "Native event is too large")
    return await run_in_threadpool(_verified_event, bytes(body), request.headers)

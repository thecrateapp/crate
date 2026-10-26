"""Closed native Telegram transport and lossless, plain-text plan presentation."""

import hashlib
import hmac
import json
import re
import time
import unicodedata

from crate.agent_diagnostics import DiagnosticError

CALLBACK_PATH = "/api/internal/agent-telegram/events"


def plan_pages(document: dict, *, apply_after_approval: bool) -> list[str]:
    # JSON escapes controls and delimiters losslessly. Escape invisible formatting
    # characters too; never let an untrusted title disguise another proposed effect.
    raw = json.dumps(
        {"apply_after_approval": apply_after_approval, "exact_plan": document},
        sort_keys=True,
        ensure_ascii=False,
        indent=2,
    )
    raw = "".join(
        json.dumps(char, ensure_ascii=True)[1:-1]
        if unicodedata.category(char) == "Cf"
        else char
        for char in raw
    )
    if len(raw.encode("utf-8")) > 180000:
        raise DiagnosticError(
            "LIMIT_EXCEEDED", "Narrow the plan before requesting review"
        )
    pages, chunk, size = [], [], 0
    for char in raw:
        length = len(char.encode("utf-8"))
        if size + length > 3200:
            pages.append("".join(chunk))
            chunk, size = [], 0
        chunk.append(char)
        size += length
    if chunk:
        pages.append("".join(chunk))
    return pages


def verify_transport(body: bytes, headers, key: bytes, *, now=None) -> str:
    timestamp = headers.get("x-crate-timestamp", "")
    nonce = headers.get("x-crate-nonce", "")
    signature = headers.get("x-crate-signature", "")
    if (
        len(key) < 32
        or len(body) > 16384
        or not re.fullmatch(r"[0-9]{10}", timestamp)
        or abs((time.time() if now is None else now) - int(timestamp)) > 60
        or not re.fullmatch(r"[a-f0-9]{32}", nonce)
    ):
        raise DiagnosticError("FORBIDDEN", "Invalid native transport")
    expected = hmac.new(
        key,
        b"POST\n"
        + CALLBACK_PATH.encode()
        + b"\n"
        + timestamp.encode()
        + b"\n"
        + nonce.encode()
        + b"\n"
        + body,
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise DiagnosticError("FORBIDDEN", "Invalid native transport")
    return nonce


def request_plan_confirmation(
    principal, plan_id, plan_version, apply_after_approval=False, *, trace_id=None
):
    from crate.db.repositories.agent_telegram import request_confirmation

    return {
        "schema_version": "1",
        "availability": "available",
        "source": "native_plan_confirmation",
        "data": request_confirmation(
            principal, plan_id, plan_version, apply_after_approval=apply_after_approval
        ),
    }


__all__ = ["plan_pages", "request_plan_confirmation", "verify_transport"]

"""Launch fix (E3): the contract with `.github/workflows/error-autofix.yml`.

The repository and its Actions logs are public, so a dispatch carries only the
Sentry short id and an optional note, never event text. Both are validated here the
way the workflow's first step validates them, so Crate refuses before GitHub does:

- `sentry_issue` matches `^CRATE-[A-Z0-9-]+-[0-9A-Z]+$` and has at most 64 characters;
- `note` has at most 500 characters.

A person can launch a fix for an issue at most once every 24 hours.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta
from typing import Any

# Kept equal to the workflow's `pattern` and limits (see test_error_fix_dispatch.py).
SHORT_ID_PATTERN = r"^CRATE-[A-Z0-9-]+-[0-9A-Z]+$"
MAX_SHORT_ID_LENGTH = 64
MAX_NOTE_LENGTH = 500
REQUEST_COOLDOWN = timedelta(hours=24)
_SHORT_ID = re.compile(SHORT_ID_PATTERN.removeprefix("^").removesuffix("$"))


class AutofixInputError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def supports_short_id(short_id: Any) -> bool:
    """Whether the workflow accepts this Sentry short id."""
    return (
        isinstance(short_id, str)
        and len(short_id) <= MAX_SHORT_ID_LENGTH
        and _SHORT_ID.fullmatch(short_id) is not None
    )


def workflow_inputs(short_id: Any, note: Any) -> dict[str, str]:
    """The only inputs a dispatch sends: the short id and the note."""
    if not supports_short_id(short_id):
        raise AutofixInputError(
            "ERROR_FIX_UNSUPPORTED_ISSUE",
            "The autofix workflow only accepts Crate short ids such as CRATE-API-1F",
        )
    if not isinstance(note, str) or len(note) > MAX_NOTE_LENGTH:
        raise AutofixInputError(
            "ERROR_FIX_INVALID_NOTE",
            f"The note must be text of at most {MAX_NOTE_LENGTH} characters",
        )
    return {"sentry_issue": short_id, "note": note}


def next_request_at(requested_at: datetime | None, now: datetime) -> datetime | None:
    """When the issue can be dispatched again, or None when it can be now."""
    if requested_at is None:
        return None
    available_at = requested_at + REQUEST_COOLDOWN
    return available_at if available_at > now else None


__all__ = [
    "MAX_NOTE_LENGTH",
    "MAX_SHORT_ID_LENGTH",
    "REQUEST_COOLDOWN",
    "SHORT_ID_PATTERN",
    "AutofixInputError",
    "next_request_at",
    "supports_short_id",
    "workflow_inputs",
]

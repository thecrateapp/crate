"""Persistence for the error tracking connection: one settings row and encrypted tokens.

Tokens never enter `settings`; the row only keeps opaque `secret_ref`s: the Sentry
token's at the top level and the GitHub token's (Launch fix) under `fix`. A save that
carries a new token revokes the previous secret in the same transaction, and a save
without `fix` revokes the GitHub token.
"""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.repositories.settings import get_setting, set_setting
from crate.db.tx import optional_scope

ERROR_TRACKING_SETTINGS_KEY = "error_tracking"
SENTRY_TOKEN_SCOPE = "error_tracking_sentry"
GITHUB_TOKEN_SCOPE = "error_tracking_github"
_LOCK_KEY = "crate.error_tracking.settings"


def read_error_tracking_settings(
    *, session: Session | None = None
) -> dict[str, Any] | None:
    """Stored settings, or None when unset. Raises ValueError on corrupt JSON."""
    raw = get_setting(ERROR_TRACKING_SETTINGS_KEY, session=session)
    if not raw:
        return None
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError("error_tracking settings are not an object")
    return value


def save_error_tracking_settings(
    settings: dict[str, Any],
    *,
    sentry_token: str | None = None,
    github_token: str | None = None,
    session: Session | None = None,
) -> dict[str, Any]:
    """Store validated settings; secret refs always come from storage, never the caller."""
    from crate.credentials import revoke_secret, store_secret

    with optional_scope(session) as current:
        current.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:lock_key, 0))"),
            {"lock_key": _LOCK_KEY},
        )
        try:
            existing = read_error_tracking_settings(session=current) or {}
        except ValueError:
            existing = {}
        secret_ref = existing.get("secret_ref")
        if sentry_token is not None:
            if secret_ref:
                revoke_secret(secret_ref, session=current)
            secret_ref = store_secret(
                SENTRY_TOKEN_SCOPE, {"token": sentry_token}, session=current
            )
        stored = {**settings, "secret_ref": secret_ref}
        previous_fix = existing.get("fix")
        fix_ref = (
            previous_fix.get("secret_ref") if isinstance(previous_fix, dict) else None
        )
        fix = stored.get("fix")
        if isinstance(fix, dict):
            if github_token is not None:
                if fix_ref:
                    revoke_secret(fix_ref, session=current)
                fix_ref = store_secret(
                    GITHUB_TOKEN_SCOPE, {"token": github_token}, session=current
                )
            stored["fix"] = {**fix, "secret_ref": fix_ref}
        else:
            if github_token is not None:
                raise ValueError("A GitHub token needs fix settings")
            if fix_ref:
                # Launch fix is off: its token goes with it.
                revoke_secret(fix_ref, session=current)
        set_setting(
            ERROR_TRACKING_SETTINGS_KEY,
            json.dumps(stored, sort_keys=True),
            session=current,
        )
        return stored


__all__ = [
    "ERROR_TRACKING_SETTINGS_KEY",
    "GITHUB_TOKEN_SCOPE",
    "SENTRY_TOKEN_SCOPE",
    "read_error_tracking_settings",
    "save_error_tracking_settings",
]

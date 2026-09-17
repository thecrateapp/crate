"""Authentication mechanisms for Crate's OpenSubsonic profile."""

from __future__ import annotations

import hashlib
import hmac
import secrets
from typing import Any

from crate.credentials import (
    CredentialSecretError,
    load_secret,
)
from crate.db.repositories.subsonic_credentials import (
    get_user_subsonic_credential_by_api_key_digest,
    get_user_subsonic_credential_by_identity,
    get_user_subsonic_credential_by_user_id,
    revoke_user_subsonic_credential,
    rotate_user_subsonic_credential,
)
from crate.subsonic.errors import ErrorCode, OpenSubsonicError
from crate.subsonic.params import RequestParameters

_CREDENTIAL_FIELDS = frozenset({"u", "p", "t", "s", "apikey"})
_SECRET_SCOPE = "opensubsonic"


def authenticate(params: RequestParameters, *, session=None) -> dict[str, Any]:
    """Authenticate supported API-key or legacy Subsonic mechanisms."""
    normalized = {str(name).lower(): values for name, values in params.values.items()}
    present = _CREDENTIAL_FIELDS.intersection(normalized)
    if any(len(normalized[name]) > 1 for name in present):
        raise _auth_error(
            ErrorCode.CONFLICTING_AUTH_MECHANISMS,
            "Ambiguous repeated authentication parameter",
        )
    api_key = _first(normalized, "apikey")
    username = _first(normalized, "u")
    password = _first(normalized, "p")
    token = _first(normalized, "t")
    salt = _first(normalized, "s")

    has_legacy_mechanism = bool(present.intersection({"u", "p", "t", "s"}))
    if api_key is not None and has_legacy_mechanism:
        raise _auth_error(
            ErrorCode.CONFLICTING_AUTH_MECHANISMS,
            "Conflicting authentication mechanisms",
        )
    if password is not None and (token is not None or salt is not None):
        raise _auth_error(
            ErrorCode.CONFLICTING_AUTH_MECHANISMS,
            "Conflicting authentication mechanisms",
        )

    if "apikey" in present:
        if not api_key:
            raise _auth_error(ErrorCode.INVALID_API_KEY, "Invalid API key")
        digest = hashlib.sha256(api_key.encode("utf-8")).hexdigest()
        user = get_user_subsonic_credential_by_api_key_digest(digest, session=session)
        if not user:
            raise _auth_error(ErrorCode.INVALID_API_KEY, "Invalid API key")
        _ensure_active(user)
        return _public_user(user)

    if password is not None:
        if not username:
            raise _auth_error(
                ErrorCode.INVALID_CREDENTIALS, "Wrong username or password"
            )
        user = _get_legacy_user(username, session=session)
        if not user or not _matches_secret(user, password, session=session):
            raise _auth_error(
                ErrorCode.INVALID_CREDENTIALS, "Wrong username or password"
            )
        _ensure_active(user)
        return _public_user(user)

    if token is not None or salt is not None:
        if not username or not token or not salt:
            raise _auth_error(
                ErrorCode.AUTH_MECHANISM_UNSUPPORTED,
                "Unsupported or incomplete authentication mechanism",
            )
        user = _get_legacy_user(username, session=session)
        if not user or not _matches_challenge(user, token, salt, session=session):
            raise _auth_error(
                ErrorCode.INVALID_CREDENTIALS, "Wrong username or password"
            )
        _ensure_active(user)
        return _public_user(user)

    raise _auth_error(
        ErrorCode.AUTH_MECHANISM_UNSUPPORTED,
        "Unsupported or incomplete authentication mechanism",
    )


def create_user_credential(user_id: int, *, session=None) -> str:
    """Rotate the user's dedicated credential and return it for one-time display."""
    secret = secrets.token_urlsafe(32)
    rotate_user_subsonic_credential(user_id, secret, session=session)
    return secret


def has_user_credential(user_id: int, *, session=None) -> bool:
    return get_user_subsonic_credential_by_user_id(user_id, session=session) is not None


def revoke_user_credential(user_id: int, *, session=None) -> bool:
    return revoke_user_subsonic_credential(user_id, session=session)


def _get_legacy_user(identity: str, *, session=None) -> dict[str, Any] | None:
    return get_user_subsonic_credential_by_identity(identity, session=session)


def _matches_secret(user: dict[str, Any], supplied: str, *, session=None) -> bool:
    if supplied.startswith("enc:"):
        try:
            supplied = bytes.fromhex(supplied[4:]).decode("utf-8")
        except (ValueError, UnicodeDecodeError):
            return False
    secret = _load_password_secret(user, session=session)
    return secret is not None and hmac.compare_digest(secret, supplied)


def _matches_challenge(
    user: dict[str, Any], token: str, salt: str, *, session=None
) -> bool:
    secret = _load_password_secret(user, session=session)
    if secret is None:
        return False
    expected = hashlib.md5(
        (secret + salt).encode("utf-8"), usedforsecurity=False
    ).hexdigest()
    return hmac.compare_digest(expected, token.lower())


def _load_password_secret(user: dict[str, Any], *, session=None) -> str | None:
    secret_ref = user.get("secret_ref")
    if not secret_ref:
        return None
    try:
        payload = load_secret(secret_ref, scope=_SECRET_SCOPE, session=session)
    except CredentialSecretError:
        return None
    secret = payload.get("secret")
    return secret if isinstance(secret, str) else None


def _ensure_active(user: dict[str, Any]) -> None:
    if (
        str(user.get("status") or "").lower() != "active"
        or user.get("deleted_at") is not None
        or user.get("suspended_at") is not None
    ):
        raise _auth_error(ErrorCode.NOT_AUTHORIZED, "User is not authorized")


def _public_user(user: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in user.items()
        if key
        not in {
            "secret_ref",
            "api_key_digest",
            "subsonic_token",
            "password_hash",
        }
    }


def _first(values: dict[str, tuple[str, ...]], name: str) -> str | None:
    items = values.get(name)
    return items[0] if items else None


def _auth_error(code: ErrorCode, message: str) -> OpenSubsonicError:
    return OpenSubsonicError(code, message)


__all__ = [
    "authenticate",
    "create_user_credential",
    "has_user_credential",
    "revoke_user_credential",
]

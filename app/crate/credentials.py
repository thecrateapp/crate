"""Shared encrypted storage for recoverable third-party credentials."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from crate.db.repositories.credential_secrets import (
    delete_expired_credential_secrets,
    get_credential_secret,
    insert_credential_secret,
    revoke_credential_scope,
    revoke_credential_secret,
    rewrap_credential_secrets,
)
from crate.db.repositories.settings import get_setting


class CredentialSecretError(RuntimeError):
    pass


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _credential_key(*, require_strong_key=False, session=None) -> bytes:
    configured = os.environ.get("CRATE_CREDENTIAL_KEY", "").strip()
    if configured:
        try:
            Fernet(configured.encode("utf-8"))
            return configured.encode("utf-8")
        except Exception as exc:
            raise CredentialSecretError("Invalid CRATE_CREDENTIAL_KEY") from exc

    if require_strong_key:
        raise CredentialSecretError("AI credentials require CRATE_CREDENTIAL_KEY")

    try:
        root_secret = (
            os.environ.get("JWT_SECRET")
            or get_setting("jwt_secret", session=session)
            or ""
        )
    except Exception:
        root_secret = os.environ.get("JWT_SECRET", "")
    if not root_secret:
        root_secret = "crate-development-credential-key"
    digest = hashlib.sha256(root_secret.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


def _fernet(*, session=None) -> Fernet:
    return Fernet(_credential_key(session=session))


def _reader(*, session=None) -> MultiFernet:
    keys = [_credential_key(session=session)]
    previous = os.environ.get("CRATE_CREDENTIAL_PREVIOUS_KEYS", "")
    for value in previous.replace(",", " ").split():
        try:
            Fernet(value.encode())
        except (ValueError, TypeError) as exc:
            raise CredentialSecretError(
                "Invalid CRATE_CREDENTIAL_PREVIOUS_KEYS"
            ) from exc
        keys.append(value.encode())
    # Legacy secrets may use either environment or DB JWT. Accept both during migration.
    roots = [os.environ.get("JWT_SECRET", "")]
    try:
        roots.append(get_setting("jwt_secret", session=session) or "")
    except Exception:
        pass
    for root in roots:
        if root:
            keys.append(
                base64.urlsafe_b64encode(hashlib.sha256(root.encode()).digest())
            )
    return MultiFernet([Fernet(key) for key in dict.fromkeys(keys)])


def _secret_ref(scope: str) -> str:
    clean_scope = "".join(ch for ch in scope.lower() if ch.isalnum() or ch in "-_")
    return f"{clean_scope}:{secrets.token_urlsafe(24)}"


def store_secret(
    scope: str,
    payload: dict[str, Any],
    *,
    ttl_seconds: int | None = None,
    require_strong_key: bool = False,
    session=None,
) -> str:
    """Encrypt and store a credential payload, returning an opaque reference."""
    ref = _secret_ref(scope)
    now = _utc_now()
    expires_at = now + timedelta(seconds=ttl_seconds) if ttl_seconds else None
    plaintext = json.dumps(payload, sort_keys=True).encode("utf-8")
    ciphertext = (
        Fernet(_credential_key(require_strong_key=require_strong_key, session=session))
        .encrypt(plaintext)
        .decode("utf-8")
    )
    insert_credential_secret(
        secret_ref=ref,
        scope=scope,
        ciphertext=ciphertext,
        expires_at=expires_at,
        now=now,
        session=session,
    )
    return ref


def load_secret(
    secret_ref: str, *, scope: str | None = None, session=None
) -> dict[str, Any]:
    """Load and decrypt a credential payload."""
    row = get_credential_secret(secret_ref, session=session)
    if not row or row.get("revoked_at"):
        raise CredentialSecretError("Credential secret not found")
    if scope and row["scope"] != scope:
        raise CredentialSecretError("Credential secret scope mismatch")
    expires_at = row.get("expires_at")
    if expires_at and expires_at <= _utc_now():
        raise CredentialSecretError("Credential secret expired")
    try:
        data = _reader(session=session).decrypt(str(row["ciphertext"]).encode("utf-8"))
    except InvalidToken as exc:
        raise CredentialSecretError("Credential secret cannot be decrypted") from exc
    payload = json.loads(data.decode("utf-8"))
    if not isinstance(payload, dict):
        raise CredentialSecretError("Credential secret payload is invalid")
    return payload


def rewrap_secrets(
    *, limit: int = 100, after_ref: str | None = None, session=None
) -> dict:
    """Reencrypt at most 500 rows with explicit current key; caller drives cursor.

    Returns {scanned,rewrapped,next_cursor}. No secrets or refs besides the paging
    cursor are returned. Failure rolls back the batch; never invokes providers.
    """
    writer = Fernet(_credential_key(require_strong_key=True, session=session))

    def transform(ciphertext, current):
        raw = ciphertext.encode()
        try:
            writer.decrypt(raw)
            return ciphertext
        except InvalidToken:
            try:
                clear = _reader(session=current).decrypt(raw)
            except InvalidToken as exc:
                raise CredentialSecretError(
                    "Credential secret cannot be decrypted"
                ) from exc
            return writer.encrypt(clear).decode()

    return rewrap_credential_secrets(
        transform, limit=limit, after_ref=after_ref, session=session
    )


def revoke_secret(secret_ref: str, *, session=None) -> None:
    now = _utc_now()
    revoke_credential_secret(secret_ref, now=now, session=session)


def revoke_scope(scope: str, *, session=None) -> int:
    now = _utc_now()
    return revoke_credential_scope(scope, now=now, session=session)


def purge_expired_secrets(*, session=None) -> int:
    now = _utc_now()
    return delete_expired_credential_secrets(now=now, session=session)


def fingerprint_secret(payload: dict[str, Any]) -> str:
    sanitized = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256(sanitized.encode("utf-8")).hexdigest()[:16]


def redacted(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return "********"
    return f"{value[:3]}...{value[-3:]}"


__all__ = [
    "CredentialSecretError",
    "fingerprint_secret",
    "load_secret",
    "purge_expired_secrets",
    "redacted",
    "rewrap_secrets",
    "revoke_scope",
    "revoke_secret",
    "store_secret",
]

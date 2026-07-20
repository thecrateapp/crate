from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from cryptography.fernet import Fernet, InvalidToken

from crate.db.repositories.settings import get_setting
from crate.db.repositories.credential_secrets import (
    delete_expired_credential_secrets,
    get_credential_secret,
    insert_credential_secret,
    revoke_credential_scope,
    revoke_credential_secret,
)


class CredentialSecretError(RuntimeError):
    pass


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _credential_key() -> bytes:
    configured = os.environ.get("CRATE_CREDENTIAL_KEY", "").strip()
    if configured:
        try:
            Fernet(configured.encode("utf-8"))
            return configured.encode("utf-8")
        except Exception as exc:
            raise CredentialSecretError("Invalid CRATE_CREDENTIAL_KEY") from exc

    try:
        root_secret = os.environ.get("JWT_SECRET") or get_setting("jwt_secret") or ""
    except Exception:
        root_secret = os.environ.get("JWT_SECRET", "")
    if not root_secret:
        root_secret = "crate-development-credential-key"
    digest = hashlib.sha256(root_secret.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


def _fernet() -> Fernet:
    return Fernet(_credential_key())


def _secret_ref(scope: str) -> str:
    clean_scope = "".join(ch for ch in scope.lower() if ch.isalnum() or ch in "-_")
    return f"{clean_scope}:{secrets.token_urlsafe(24)}"


def store_secret(
    scope: str,
    payload: dict[str, Any],
    *,
    ttl_seconds: int | None = None,
    session=None,
) -> str:
    """Encrypt and store a credential payload, returning an opaque reference."""
    ref = _secret_ref(scope)
    now = _utc_now()
    expires_at = now + timedelta(seconds=ttl_seconds) if ttl_seconds else None
    plaintext = json.dumps(payload, sort_keys=True).encode("utf-8")
    ciphertext = _fernet().encrypt(plaintext).decode("utf-8")
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
        data = _fernet().decrypt(str(row["ciphertext"]).encode("utf-8"))
    except InvalidToken as exc:
        raise CredentialSecretError("Credential secret cannot be decrypted") from exc
    payload = json.loads(data.decode("utf-8"))
    if not isinstance(payload, dict):
        raise CredentialSecretError("Credential secret payload is invalid")
    return payload


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

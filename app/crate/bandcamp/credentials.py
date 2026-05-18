from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import text

from crate.db.repositories.settings import get_setting
from crate.db.tx import optional_scope, transaction_scope


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
    with optional_scope(session) as s:
        s.execute(
            text("""
            INSERT INTO credential_secrets (
                secret_ref, scope, ciphertext, expires_at, created_at, updated_at
            )
            VALUES (
                :secret_ref, :scope, :ciphertext, :expires_at, :created_at, :updated_at
            )
            """),
            {
                "secret_ref": ref,
                "scope": scope,
                "ciphertext": ciphertext,
                "expires_at": expires_at,
                "created_at": now,
                "updated_at": now,
            },
        )
    return ref


def load_secret(
    secret_ref: str, *, scope: str | None = None, session=None
) -> dict[str, Any]:
    """Load and decrypt a credential payload."""
    with optional_scope(session) as s:
        row = (
            s.execute(
                text("""
                SELECT scope, ciphertext, expires_at, revoked_at
                FROM credential_secrets
                WHERE secret_ref = :secret_ref
                """),
                {"secret_ref": secret_ref},
            )
            .mappings()
            .first()
        )
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
    with optional_scope(session) as s:
        s.execute(
            text("""
            UPDATE credential_secrets
            SET revoked_at = :now, updated_at = :now
            WHERE secret_ref = :secret_ref
            """),
            {"secret_ref": secret_ref, "now": now},
        )


def revoke_scope(scope: str, *, session=None) -> int:
    now = _utc_now()
    with optional_scope(session) as s:
        result = s.execute(
            text("""
            UPDATE credential_secrets
            SET revoked_at = :now, updated_at = :now
            WHERE scope = :scope AND revoked_at IS NULL
            """),
            {"scope": scope, "now": now},
        )
        return int(getattr(result, "rowcount", 0) or 0)


def purge_expired_secrets(*, session=None) -> int:
    now = _utc_now()
    with optional_scope(session) as s:
        result = s.execute(
            text("""
            DELETE FROM credential_secrets
            WHERE expires_at IS NOT NULL AND expires_at <= :now
            """),
            {"now": now},
        )
        return int(getattr(result, "rowcount", 0) or 0)


def fingerprint_secret(payload: dict[str, Any]) -> str:
    sanitized = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256(sanitized.encode("utf-8")).hexdigest()[:16]


def redacted(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return "********"
    return f"{value[:3]}...{value[-3:]}"


def store_secret_transactional(
    scope: str, payload: dict[str, Any], *, ttl_seconds: int | None = None
) -> str:
    with transaction_scope() as session:
        return store_secret(scope, payload, ttl_seconds=ttl_seconds, session=session)

from __future__ import annotations

from contextlib import nullcontext
from datetime import datetime
from typing import Any

from sqlalchemy import text

from crate.db.tx import optional_scope, read_scope


def insert_credential_secret(
    *,
    secret_ref: str,
    scope: str,
    ciphertext: str,
    expires_at: datetime | None,
    now: datetime,
    session=None,
) -> None:
    with optional_scope(session) as current:
        current.execute(
            text("""
            INSERT INTO credential_secrets (
                secret_ref, scope, ciphertext, expires_at, created_at, updated_at
            ) VALUES (
                :secret_ref, :scope, :ciphertext, :expires_at, :created_at, :updated_at
            )
            """),
            {
                "secret_ref": secret_ref,
                "scope": scope,
                "ciphertext": ciphertext,
                "expires_at": expires_at,
                "created_at": now,
                "updated_at": now,
            },
        )


def get_credential_secret(secret_ref: str, *, session=None) -> dict[str, Any] | None:
    with nullcontext(session) if session is not None else read_scope() as current:
        row = (
            current.execute(
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
    return dict(row) if row else None


def revoke_credential_secret(secret_ref: str, *, now: datetime, session=None) -> None:
    with optional_scope(session) as current:
        current.execute(
            text("""
            UPDATE credential_secrets
            SET revoked_at = :now, updated_at = :now
            WHERE secret_ref = :secret_ref
            """),
            {"secret_ref": secret_ref, "now": now},
        )


def revoke_credential_scope(scope: str, *, now: datetime, session=None) -> int:
    with optional_scope(session) as current:
        result = current.execute(
            text("""
            UPDATE credential_secrets
            SET revoked_at = :now, updated_at = :now
            WHERE scope = :scope AND revoked_at IS NULL
            """),
            {"scope": scope, "now": now},
        )
        return int(getattr(result, "rowcount", 0) or 0)


def delete_expired_credential_secrets(*, now: datetime, session=None) -> int:
    with optional_scope(session) as current:
        result = current.execute(
            text("""
            DELETE FROM credential_secrets
            WHERE expires_at IS NOT NULL AND expires_at <= :now
            """),
            {"now": now},
        )
        return int(getattr(result, "rowcount", 0) or 0)


def rewrap_credential_secrets(
    transform, *, limit=100, after_ref=None, session=None
) -> dict:
    """Locked keyset batch; transform receives ciphertext and the existing session."""
    with optional_scope(session) as current:
        with current.begin_nested():
            rows = (
                current.execute(
                    text("""SELECT secret_ref,ciphertext FROM credential_secrets
                WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at>NOW())
                  AND (:after IS NULL OR secret_ref>:after)
                ORDER BY secret_ref LIMIT :limit FOR UPDATE"""),
                    {"after": after_ref, "limit": min(max(limit, 1), 500)},
                )
                .mappings()
                .all()
            )
            changed = 0
            for row in rows:
                replacement = transform(row["ciphertext"], current)
                if replacement != row["ciphertext"]:
                    current.execute(
                        text(
                            "UPDATE credential_secrets SET ciphertext=:ciphertext,updated_at=NOW() WHERE secret_ref=:ref"
                        ),
                        {"ciphertext": replacement, "ref": row["secret_ref"]},
                    )
                    changed += 1
            return {
                "scanned": len(rows),
                "rewrapped": changed,
                "next_cursor": rows[-1]["secret_ref"]
                if len(rows) == min(max(limit, 1), 500)
                else None,
            }


__all__ = [
    "delete_expired_credential_secrets",
    "get_credential_secret",
    "insert_credential_secret",
    "rewrap_credential_secrets",
    "revoke_credential_scope",
    "revoke_credential_secret",
]

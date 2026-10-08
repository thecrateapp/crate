"""Database access for per-user OpenSubsonic credentials."""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text

from crate.db.tx import optional_scope


_USER_CREDENTIAL_FIELDS = """
    u.id, u.email, u.username, u.name, u.role, u.status, u.suspended_at,
    u.deleted_at, c.secret_ref, c.api_key_digest
"""

_MIGRATION_LOCK = "crate.opensubsonic.credentials.migration"


def lock_subsonic_credential_migration(session) -> None:
    session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:lock_key, 0))"),
        {"lock_key": _MIGRATION_LOCK},
    )


def rotate_user_subsonic_credential(user_id: int, secret: str, *, session=None) -> None:
    from crate.credentials import revoke_secret, store_secret

    with optional_scope(session) as current:
        lock_subsonic_credential_migration(current)
        existing = get_user_subsonic_credential_by_user_id(user_id, session=current)
        if existing:
            revoke_secret(existing["secret_ref"], session=current)
        secret_ref = store_secret("opensubsonic", {"secret": secret}, session=current)
        upsert_user_subsonic_credential(
            user_id=user_id,
            secret_ref=secret_ref,
            api_key_digest=hashlib.sha256(secret.encode("utf-8")).hexdigest(),
            now=datetime.now(timezone.utc),
            session=current,
        )


def revoke_user_subsonic_credential(user_id: int, *, session=None) -> bool:
    from crate.credentials import revoke_secret

    with optional_scope(session) as current:
        lock_subsonic_credential_migration(current)
        existing = get_user_subsonic_credential_by_user_id(user_id, session=current)
        if not existing:
            return False
        revoke_secret(existing["secret_ref"], session=current)
        delete_user_subsonic_credential(user_id, session=current)
    return True


def get_user_subsonic_credential_by_identity(
    identity: str, *, session=None
) -> dict[str, Any] | None:
    with optional_scope(session) as current:
        row = (
            current.execute(
                text(f"""
                    SELECT {_USER_CREDENTIAL_FIELDS}
                    FROM users AS u
                    LEFT JOIN user_subsonic_credentials AS c ON c.user_id = u.id
                    WHERE lower(u.email) = lower(:identity)
                       OR lower(coalesce(u.username, '')) = lower(:identity)
                    ORDER BY (lower(u.email) = lower(:identity)) DESC
                    LIMIT 1
                """),
                {"identity": identity},
            )
            .mappings()
            .first()
        )
    return dict(row) if row else None


def get_user_subsonic_credential_by_api_key_digest(
    digest: str, *, session=None
) -> dict[str, Any] | None:
    with optional_scope(session) as current:
        row = (
            current.execute(
                text(f"""
                    SELECT {_USER_CREDENTIAL_FIELDS}
                    FROM user_subsonic_credentials AS c
                    JOIN users AS u ON u.id = c.user_id
                    WHERE c.api_key_digest = :digest
                    LIMIT 1
                """),
                {"digest": digest},
            )
            .mappings()
            .first()
        )
    return dict(row) if row else None


def get_user_subsonic_credential_by_user_id(
    user_id: int, *, session=None
) -> dict[str, Any] | None:
    with optional_scope(session) as current:
        row = (
            current.execute(
                text("""
                    SELECT user_id, secret_ref, api_key_digest, created_at, updated_at
                    FROM user_subsonic_credentials
                    WHERE user_id = :user_id
                """),
                {"user_id": user_id},
            )
            .mappings()
            .first()
        )
    return dict(row) if row else None


def upsert_user_subsonic_credential(
    *,
    user_id: int,
    secret_ref: str,
    api_key_digest: str,
    now: datetime,
    session=None,
) -> None:
    with optional_scope(session) as current:
        current.execute(
            text("""
                INSERT INTO user_subsonic_credentials (
                    user_id, secret_ref, api_key_digest, created_at, updated_at
                ) VALUES (
                    :user_id, :secret_ref, :api_key_digest, :now, :now
                )
                ON CONFLICT (user_id) DO UPDATE SET
                    secret_ref = EXCLUDED.secret_ref,
                    api_key_digest = EXCLUDED.api_key_digest,
                    updated_at = EXCLUDED.updated_at
            """),
            {
                "user_id": user_id,
                "secret_ref": secret_ref,
                "api_key_digest": api_key_digest,
                "now": now,
            },
        )


def delete_user_subsonic_credential(user_id: int, *, session=None) -> None:
    with optional_scope(session) as current:
        current.execute(
            text("""
                DELETE FROM user_subsonic_credentials
                WHERE user_id = :user_id
            """),
            {"user_id": user_id},
        )


__all__ = [
    "delete_user_subsonic_credential",
    "get_user_subsonic_credential_by_api_key_digest",
    "get_user_subsonic_credential_by_identity",
    "get_user_subsonic_credential_by_user_id",
    "lock_subsonic_credential_migration",
    "revoke_user_subsonic_credential",
    "rotate_user_subsonic_credential",
    "upsert_user_subsonic_credential",
]

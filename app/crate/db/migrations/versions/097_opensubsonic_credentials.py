"""Move plaintext Subsonic tokens into the encrypted credential vault.

Revision ID: 097
Revises: 096
"""

from __future__ import annotations

import hashlib

from alembic import op
from sqlalchemy import text


revision = "097"
down_revision = "096"
branch_labels = None
depends_on = None

_MIGRATION_LOCK = "crate.opensubsonic.credentials.migration"
_CREDENTIAL_SCOPE = "opensubsonic"


def upgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:lock_key, 0))"),
        {"lock_key": _MIGRATION_LOCK},
    )
    op.execute("""
        CREATE TABLE IF NOT EXISTS user_subsonic_credentials (
            user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            secret_ref TEXT NOT NULL UNIQUE
                REFERENCES credential_secrets(secret_ref) ON DELETE RESTRICT,
            api_key_digest TEXT NOT NULL UNIQUE,
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL,
            CONSTRAINT ck_user_subsonic_api_key_digest
                CHECK (api_key_digest ~ '^[0-9a-f]{64}$')
        )
    """)
    migrate_legacy_subsonic_tokens(bind)


def migrate_legacy_subsonic_tokens(connection) -> int:
    """Encrypt legacy tokens once, clear their plaintext column and return count."""
    from crate.credentials import store_secret

    connection.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:lock_key, 0))"),
        {"lock_key": _MIGRATION_LOCK},
    )
    rows = (
        connection.execute(
            text("""
            SELECT id, subsonic_token
            FROM users
            WHERE subsonic_token IS NOT NULL AND subsonic_token <> ''
            ORDER BY id
            FOR UPDATE
        """)
        )
        .mappings()
        .all()
    )
    migrated = 0
    for row in rows:
        user_id = int(row["id"])
        token = str(row["subsonic_token"])
        existing = connection.execute(
            text("""
                SELECT 1 FROM user_subsonic_credentials
                WHERE user_id = :user_id
            """),
            {"user_id": user_id},
        ).first()
        if not existing:
            now = connection.execute(text("SELECT now()")).scalar_one()
            secret_ref = store_secret(
                _CREDENTIAL_SCOPE, {"secret": token}, session=connection
            )
            connection.execute(
                text("""
                    INSERT INTO user_subsonic_credentials (
                        user_id, secret_ref, api_key_digest, created_at, updated_at
                    ) VALUES (
                        :user_id, :secret_ref, :api_key_digest, :now, :now
                    )
                    ON CONFLICT (user_id) DO NOTHING
                """),
                {
                    "user_id": user_id,
                    "secret_ref": secret_ref,
                    "api_key_digest": hashlib.sha256(token.encode("utf-8")).hexdigest(),
                    "now": now,
                },
            )
            migrated += 1
        connection.execute(
            text("UPDATE users SET subsonic_token = NULL WHERE id = :user_id"),
            {"user_id": user_id},
        )
    return migrated


def downgrade() -> None:
    from crate.credentials import load_secret, revoke_scope

    bind = op.get_bind()
    rows = (
        bind.execute(
            text("""
            SELECT user_id, secret_ref
            FROM user_subsonic_credentials
            ORDER BY user_id
        """)
        )
        .mappings()
        .all()
    )
    for row in rows:
        secret = load_secret(
            str(row["secret_ref"]), scope=_CREDENTIAL_SCOPE, session=bind
        )
        bind.execute(
            text("""
                UPDATE users SET subsonic_token = :token WHERE id = :user_id
            """),
            {"token": secret["secret"], "user_id": row["user_id"]},
        )
    revoke_scope(_CREDENTIAL_SCOPE, session=bind)
    op.execute("DROP TABLE IF EXISTS user_subsonic_credentials")

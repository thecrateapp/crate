"""Add artist suggestions and multi-role assignments.

Revision ID: 039
Revises: 037
"""

from typing import Sequence, Union

from alembic import op


revision: str = "039"
down_revision: Union[str, None] = "037"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS user_roles (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role TEXT NOT NULL,
            assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (user_id, role)
        )
    """)
    op.execute("""
        INSERT INTO user_roles (user_id, role, assigned_at)
        SELECT id, COALESCE(NULLIF(TRIM(role), ''), 'user'), NOW()
        FROM users
        ON CONFLICT (user_id, role) DO NOTHING
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_user_roles_role
        ON user_roles(role, user_id)
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS artist_suggestions (
            id BIGSERIAL PRIMARY KEY,
            artist_name TEXT NOT NULL,
            normalized_artist_name TEXT NOT NULL,
            artist_url TEXT,
            note TEXT,
            status TEXT NOT NULL DEFAULT 'new',
            created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            triaged_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            linked_artist_id INTEGER REFERENCES library_artists(id) ON DELETE SET NULL,
            linked_task_id TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            resolved_at TIMESTAMPTZ,
            CHECK (status IN ('new', 'triaged', 'searching', 'accepted', 'dismissed', 'downloaded'))
        )
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_artist_suggestions_open_key
        ON artist_suggestions(normalized_artist_name)
        WHERE status IN ('new', 'triaged', 'searching')
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_artist_suggestions_status_created
        ON artist_suggestions(status, created_at DESC)
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS artist_suggestion_supporters (
            suggestion_id BIGINT NOT NULL REFERENCES artist_suggestions(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            artist_url TEXT,
            note TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (suggestion_id, user_id)
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_artist_suggestion_supporters_user
        ON artist_suggestion_supporters(user_id, created_at DESC)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS artist_suggestion_supporters")
    op.execute("DROP TABLE IF EXISTS artist_suggestions")
    op.execute("DROP TABLE IF EXISTS user_roles")

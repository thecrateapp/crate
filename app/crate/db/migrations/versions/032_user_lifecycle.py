"""Add user lifecycle status fields.

Revision ID: 032
Revises: 031
"""

from typing import Sequence, Union

from alembic import op


revision: str = "032"
down_revision: Union[str, None] = "031"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
        ADD COLUMN IF NOT EXISTS status_reason TEXT,
        ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS suspended_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_users_status ON users(status)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_users_status")
    op.execute("""
        ALTER TABLE users
        DROP COLUMN IF EXISTS deleted_by,
        DROP COLUMN IF EXISTS deleted_at,
        DROP COLUMN IF EXISTS suspended_by,
        DROP COLUMN IF EXISTS suspended_at,
        DROP COLUMN IF EXISTS status_reason,
        DROP COLUMN IF EXISTS status
    """)

"""Add manual field locks for library entities.

Revision ID: 033
Revises: 032
"""

from typing import Sequence, Union

from alembic import op


revision: str = "033"
down_revision: Union[str, None] = "032"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS library_field_locks (
            entity_type TEXT NOT NULL,
            entity_id BIGINT NOT NULL,
            field_name TEXT NOT NULL,
            locked_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            reason TEXT,
            source TEXT NOT NULL DEFAULT 'manual_edit',
            PRIMARY KEY (entity_type, entity_id, field_name)
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_library_field_locks_entity
        ON library_field_locks(entity_type, entity_id)
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_library_field_locks_entity")
    op.execute("DROP TABLE IF EXISTS library_field_locks")

"""Preserve legacy overlay inserts after global taxonomy identity.

Revision ID: 063
Revises: 062
"""

from collections.abc import Sequence

from alembic import op


revision = "063"
down_revision = "062"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE genre_taxonomy_nodes
        ALTER COLUMN global_genre_uid SET DEFAULT gen_random_uuid()
        """
    )
    op.execute(
        """
        ALTER TABLE genre_taxonomy_nodes
        ALTER COLUMN taxonomy_id SET DEFAULT 'crate-core'
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE genre_taxonomy_nodes
        ALTER COLUMN taxonomy_id DROP DEFAULT
        """
    )
    op.execute(
        """
        ALTER TABLE genre_taxonomy_nodes
        ALTER COLUMN global_genre_uid DROP DEFAULT
        """
    )

"""Add curated cover path to genre taxonomy nodes.

Revision ID: 048
Revises: 047
Create Date: 2026-06-13
"""

from collections.abc import Sequence

from alembic import op

revision = "048"
down_revision = "047"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE genre_taxonomy_nodes ADD COLUMN IF NOT EXISTS cover_path TEXT"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE genre_taxonomy_nodes DROP COLUMN IF EXISTS cover_path")

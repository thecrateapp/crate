"""Add provenance metadata to genre taxonomy edges.

Revision ID: 042
Revises: 041
Create Date: 2026-05-28
"""

from collections.abc import Sequence

from alembic import op

revision = "042"
down_revision = "041"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE genre_taxonomy_edges ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'"
    )
    op.execute(
        "ALTER TABLE genre_taxonomy_edges ADD COLUMN IF NOT EXISTS confidence DOUBLE PRECISION NOT NULL DEFAULT 1.0"
    )
    op.execute(
        "ALTER TABLE genre_taxonomy_edges ADD COLUMN IF NOT EXISTS evidence_json JSONB"
    )
    op.execute(
        """
        ALTER TABLE genre_taxonomy_edges
        ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
        """
    )
    op.execute(
        "ALTER TABLE genre_taxonomy_edges ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT FALSE"
    )
    op.execute(
        "ALTER TABLE genre_taxonomy_edges ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE genre_taxonomy_edges DROP COLUMN IF EXISTS updated_at")
    op.execute("ALTER TABLE genre_taxonomy_edges DROP COLUMN IF EXISTS locked")
    op.execute("ALTER TABLE genre_taxonomy_edges DROP COLUMN IF EXISTS created_by")
    op.execute("ALTER TABLE genre_taxonomy_edges DROP COLUMN IF EXISTS evidence_json")
    op.execute("ALTER TABLE genre_taxonomy_edges DROP COLUMN IF EXISTS confidence")
    op.execute("ALTER TABLE genre_taxonomy_edges DROP COLUMN IF EXISTS source")

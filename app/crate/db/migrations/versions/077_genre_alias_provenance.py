"""Track genre alias provenance and quarantine unclassified legacy aliases.

Revision ID: 077
Revises: 076
"""

from collections.abc import Sequence

from alembic import op


revision = "077"
down_revision = "076"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE genre_taxonomy_aliases
        ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'legacy'
        """
    )
    op.execute(
        """
        ALTER TABLE genre_taxonomy_aliases
        ADD COLUMN IF NOT EXISTS confidence DOUBLE PRECISION
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'genre_taxonomy_aliases_origin_check'
            ) THEN
                ALTER TABLE genre_taxonomy_aliases
                ADD CONSTRAINT genre_taxonomy_aliases_origin_check
                CHECK (origin IN ('core', 'manual', 'inferred', 'legacy'));
            END IF;
        END
        $$
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'genre_taxonomy_aliases_confidence_check'
            ) THEN
                ALTER TABLE genre_taxonomy_aliases
                ADD CONSTRAINT genre_taxonomy_aliases_confidence_check
                CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1));
            END IF;
        END
        $$
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_genre_taxonomy_aliases_origin
        ON genre_taxonomy_aliases (origin)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_genre_taxonomy_aliases_origin")
    op.execute(
        """
        ALTER TABLE genre_taxonomy_aliases
        DROP CONSTRAINT IF EXISTS genre_taxonomy_aliases_confidence_check
        """
    )
    op.execute(
        """
        ALTER TABLE genre_taxonomy_aliases
        DROP CONSTRAINT IF EXISTS genre_taxonomy_aliases_origin_check
        """
    )
    op.execute("ALTER TABLE genre_taxonomy_aliases DROP COLUMN IF EXISTS confidence")
    op.execute("ALTER TABLE genre_taxonomy_aliases DROP COLUMN IF EXISTS origin")

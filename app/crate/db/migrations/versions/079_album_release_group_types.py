"""Persist MusicBrainz release-group types across the global catalog."""

from alembic import op


revision = "079"
down_revision = "078"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in ("library_albums", "global_catalog_albums"):
        op.execute(
            f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS "
            "release_group_primary_type TEXT"
        )
        op.execute(
            f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS "
            "release_group_secondary_types JSONB"
        )
        op.execute(
            f"UPDATE {table} SET release_group_secondary_types = '[]'::jsonb "
            "WHERE release_group_secondary_types IS NULL"
        )
        op.execute(
            f"ALTER TABLE {table} ALTER COLUMN release_group_secondary_types "
            "SET DEFAULT '[]'::jsonb"
        )
        op.execute(
            f"ALTER TABLE {table} ALTER COLUMN release_group_secondary_types "
            "SET NOT NULL"
        )


def downgrade() -> None:
    for table in ("global_catalog_albums", "library_albums"):
        op.execute(
            f"ALTER TABLE {table} DROP COLUMN IF EXISTS release_group_secondary_types"
        )
        op.execute(
            f"ALTER TABLE {table} DROP COLUMN IF EXISTS release_group_primary_type"
        )

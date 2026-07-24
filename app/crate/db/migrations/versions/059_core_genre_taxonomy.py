"""Versioned core genre taxonomy identity.

Revision ID: 059
Revises: 058
"""

from collections.abc import Sequence

from alembic import op

from crate.genre_taxonomy import get_core_taxonomy_descriptor


revision = "059"
down_revision = "058"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    descriptor = get_core_taxonomy_descriptor()
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS genre_taxonomy_releases (
            taxonomy_id TEXT NOT NULL,
            version TEXT NOT NULL,
            digest TEXT NOT NULL,
            signature TEXT,
            published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            active BOOLEAN NOT NULL DEFAULT FALSE,
            PRIMARY KEY (taxonomy_id, version)
        )
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_genre_taxonomy_releases_active
        ON genre_taxonomy_releases (taxonomy_id)
        WHERE active
        """
    )
    op.execute(
        "ALTER TABLE genre_taxonomy_nodes ADD COLUMN IF NOT EXISTS global_genre_uid UUID"
    )
    op.execute(
        "ALTER TABLE genre_taxonomy_nodes ADD COLUMN IF NOT EXISTS taxonomy_id TEXT"
    )
    op.execute(
        "ALTER TABLE genre_taxonomy_nodes ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'overlay'"
    )
    op.execute(
        "UPDATE genre_taxonomy_nodes SET global_genre_uid = COALESCE(global_genre_uid, entity_uid, gen_random_uuid())"
    )
    op.execute(
        "UPDATE genre_taxonomy_nodes SET taxonomy_id = COALESCE(taxonomy_id, 'crate-core')"
    )
    op.execute(
        "ALTER TABLE genre_taxonomy_nodes ALTER COLUMN global_genre_uid SET NOT NULL"
    )
    op.execute("ALTER TABLE genre_taxonomy_nodes ALTER COLUMN taxonomy_id SET NOT NULL")
    op.execute(
        """
        ALTER TABLE genre_taxonomy_nodes
        ADD CONSTRAINT genre_taxonomy_nodes_origin_check
        CHECK (origin IN ('core', 'overlay'))
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_genre_taxonomy_nodes_global_uid
        ON genre_taxonomy_nodes(taxonomy_id, global_genre_uid)
        """
    )
    op.execute(
        f"""
        INSERT INTO genre_taxonomy_releases (taxonomy_id, version, digest, active)
        VALUES ('{descriptor["taxonomy_id"]}', '{descriptor["version"]}', '{descriptor["digest"]}', TRUE)
        ON CONFLICT (taxonomy_id, version) DO UPDATE
        SET digest = EXCLUDED.digest, active = TRUE
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_genre_taxonomy_releases_active")
    op.execute("DROP INDEX IF EXISTS idx_genre_taxonomy_nodes_global_uid")
    op.execute(
        "ALTER TABLE genre_taxonomy_nodes DROP CONSTRAINT IF EXISTS genre_taxonomy_nodes_origin_check"
    )
    op.execute("ALTER TABLE genre_taxonomy_nodes DROP COLUMN IF EXISTS origin")
    op.execute("ALTER TABLE genre_taxonomy_nodes DROP COLUMN IF EXISTS taxonomy_id")
    op.execute(
        "ALTER TABLE genre_taxonomy_nodes DROP COLUMN IF EXISTS global_genre_uid"
    )
    op.execute("DROP TABLE IF EXISTS genre_taxonomy_releases")

"""Attributed global catalog genre projections.

Revision ID: 060
Revises: 059
"""

from collections.abc import Sequence

from alembic import op


revision = "060"
down_revision = "059"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS global_catalog_genre_assertions (
            id BIGSERIAL PRIMARY KEY,
            source_id BIGINT NOT NULL REFERENCES global_catalog_sources(id) ON DELETE CASCADE,
            global_genre_uid UUID,
            taxonomy_id TEXT NOT NULL,
            taxonomy_version TEXT,
            taxonomy_digest TEXT,
            raw_label TEXT NOT NULL,
            mapping_method TEXT NOT NULL,
            confidence NUMERIC(4,3) NOT NULL DEFAULT 1.0,
            weight NUMERIC(6,3) NOT NULL DEFAULT 1.0,
            is_direct BOOLEAN NOT NULL DEFAULT TRUE,
            source_revision TEXT,
            asserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            invalidated_at TIMESTAMPTZ,
            CONSTRAINT global_catalog_genre_assertions_method_check
                CHECK (mapping_method IN (
                    'declared_core', 'local_alias', 'receiver_mapping', 'unmapped'
                )),
            CONSTRAINT global_catalog_genre_assertions_confidence_check
                CHECK (confidence >= 0 AND confidence <= 1),
            CONSTRAINT global_catalog_genre_assertions_weight_check
                CHECK (weight >= 0 AND weight <= 1)
        )
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_global_catalog_genre_assertions_active
        ON global_catalog_genre_assertions (
            source_id,
            raw_label,
            COALESCE(global_genre_uid, '00000000-0000-0000-0000-000000000000'::uuid)
        )
        WHERE invalidated_at IS NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_global_catalog_genre_assertions_source
        ON global_catalog_genre_assertions (source_id)
        WHERE invalidated_at IS NULL
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS global_catalog_entity_genres (
            entity_type TEXT NOT NULL,
            global_entity_uid UUID NOT NULL,
            global_genre_uid UUID NOT NULL,
            direct_score NUMERIC(6,3) NOT NULL DEFAULT 0,
            aggregate_score NUMERIC(6,3) NOT NULL DEFAULT 0,
            supporting_source_count INTEGER NOT NULL DEFAULT 0,
            supporting_node_count INTEGER NOT NULL DEFAULT 0,
            preferred_for_display BOOLEAN NOT NULL DEFAULT FALSE,
            computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (entity_type, global_entity_uid, global_genre_uid),
            CONSTRAINT global_catalog_entity_genres_entity_type_check
                CHECK (entity_type IN ('artist', 'album', 'track')),
            CONSTRAINT global_catalog_entity_genres_direct_score_check
                CHECK (direct_score >= 0 AND direct_score <= 1),
            CONSTRAINT global_catalog_entity_genres_aggregate_score_check
                CHECK (aggregate_score >= 0 AND aggregate_score <= 1)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_global_catalog_entity_genres_genre
        ON global_catalog_entity_genres (global_genre_uid, entity_type)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_global_catalog_entity_genres_genre")
    op.execute("DROP TABLE IF EXISTS global_catalog_entity_genres")
    op.execute("DROP INDEX IF EXISTS idx_global_catalog_genre_assertions_source")
    op.execute("DROP INDEX IF EXISTS idx_global_catalog_genre_assertions_active")
    op.execute("DROP TABLE IF EXISTS global_catalog_genre_assertions")

"""Add the materialized global-catalog search projection.

Revision ID: 074
Revises: 073
"""

from collections.abc import Sequence

from alembic import op


revision = "074"
down_revision = "073"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS global_catalog_search_documents (
            entity_type TEXT NOT NULL
                CHECK (entity_type IN ('artist', 'album', 'track')),
            global_entity_uid UUID NOT NULL,
            search_text TEXT NOT NULL,
            normalized_text TEXT NOT NULL,
            payload_json JSONB NOT NULL,
            source_count INTEGER NOT NULL DEFAULT 0,
            has_local BOOLEAN NOT NULL DEFAULT false,
            has_remote BOOLEAN NOT NULL DEFAULT false,
            has_healthy_source BOOLEAN NOT NULL DEFAULT false,
            search_vector TSVECTOR GENERATED ALWAYS AS (
                to_tsvector('simple', COALESCE(search_text, ''))
            ) STORED,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (entity_type, global_entity_uid)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_global_search_documents_fts
        ON global_catalog_search_documents USING gin(search_vector)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_global_search_documents_text_trgm
        ON global_catalog_search_documents USING gin(search_text gin_trgm_ops)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_global_search_documents_normalized_trgm
        ON global_catalog_search_documents USING gin(normalized_text gin_trgm_ops)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_global_search_documents_ranking
        ON global_catalog_search_documents (
            entity_type, has_local DESC, has_healthy_source DESC,
            source_count DESC, updated_at DESC
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS global_catalog_search_projection_state (
            singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
            status TEXT NOT NULL DEFAULT 'warming'
                CHECK (status IN (
                    'warming', 'backfilling', 'ready', 'refreshing',
                    'degraded', 'failed'
                )),
            cursor_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            total_documents BIGINT NOT NULL DEFAULT 0,
            last_error TEXT,
            started_at TIMESTAMPTZ,
            completed_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        INSERT INTO global_catalog_search_projection_state (singleton, status)
        VALUES (true, 'warming')
        ON CONFLICT (singleton) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS global_catalog_search_projection_state")
    op.execute("DROP TABLE IF EXISTS global_catalog_search_documents")

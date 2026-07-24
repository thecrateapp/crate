"""Global federated content facet cache.

Revision ID: 056
Revises: 055
"""

from collections.abc import Sequence

from alembic import op


revision = "056"
down_revision = "055"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS global_content_cache (
            cache_key TEXT PRIMARY KEY,
            entity_type TEXT NOT NULL,
            global_entity_uid UUID NOT NULL,
            facet TEXT NOT NULL,
            source_node_uid UUID,
            remote_entity_uid TEXT,
            source_revision TEXT,
            content_type TEXT,
            payload_json JSONB,
            blob_path TEXT,
            expires_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_global_content_cache_entity
        ON global_content_cache(entity_type, global_entity_uid, facet)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_global_content_cache_source
        ON global_content_cache(source_node_uid, remote_entity_uid)
        WHERE source_node_uid IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_global_content_cache_source")
    op.execute("DROP INDEX IF EXISTS idx_global_content_cache_entity")
    op.execute("DROP TABLE IF EXISTS global_content_cache")

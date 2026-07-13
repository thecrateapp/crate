"""Durable node-first catalog readiness and dirty-source state.

Revision ID: 058
Revises: 057
"""

from collections.abc import Sequence

from alembic import op


revision = "058"
down_revision = "057"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS global_catalog_state (
            singleton BOOLEAN PRIMARY KEY DEFAULT TRUE,
            status TEXT NOT NULL DEFAULT 'cold',
            generation UUID NOT NULL,
            bootstrap_cursor_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            user_refs_backfilled_at TIMESTAMPTZ,
            last_full_reconcile_at TIMESTAMPTZ,
            last_error TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT global_catalog_state_singleton_check CHECK (singleton),
            CONSTRAINT global_catalog_state_status_check
                CHECK (status IN ('cold', 'backfilling', 'ready', 'failed'))
        )
        """
    )
    op.execute(
        """
        INSERT INTO global_catalog_state (singleton, status, generation)
        VALUES (TRUE, 'cold', gen_random_uuid())
        ON CONFLICT (singleton) DO NOTHING
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS global_catalog_dirty_sources (
            id BIGSERIAL PRIMARY KEY,
            dedupe_key TEXT NOT NULL UNIQUE,
            entity_type TEXT NOT NULL,
            source_kind TEXT NOT NULL,
            local_entity_uid UUID,
            node_uid UUID,
            remote_entity_uid TEXT,
            operation TEXT NOT NULL,
            source_revision TEXT,
            requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            claimed_at TIMESTAMPTZ,
            completed_at TIMESTAMPTZ,
            attempts INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            CONSTRAINT global_catalog_dirty_sources_entity_type_check
                CHECK (entity_type IN ('artist', 'album', 'track')),
            CONSTRAINT global_catalog_dirty_sources_kind_check
                CHECK (source_kind IN ('local', 'federated')),
            CONSTRAINT global_catalog_dirty_sources_operation_check
                CHECK (operation IN ('upsert', 'delete')),
            CONSTRAINT global_catalog_dirty_sources_local_ref_check
                CHECK (
                    source_kind <> 'local' OR local_entity_uid IS NOT NULL
                ),
            CONSTRAINT global_catalog_dirty_sources_federated_ref_check
                CHECK (
                    source_kind <> 'federated'
                    OR (node_uid IS NOT NULL AND remote_entity_uid IS NOT NULL)
                )
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_global_catalog_dirty_sources_pending
        ON global_catalog_dirty_sources (requested_at, id)
        WHERE completed_at IS NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_global_catalog_dirty_sources_pending")
    op.execute("DROP TABLE IF EXISTS global_catalog_dirty_sources")
    op.execute("DROP TABLE IF EXISTS global_catalog_state")
